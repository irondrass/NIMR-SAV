-- P0-010: server-authoritative entity concurrency and durable conflicts.
-- Lock order is always parent case -> booking. Entity advisory locks also
-- serialize creates, for which SELECT ... FOR UPDATE cannot lock a missing row.

begin;

create sequence if not exists public.nimr_sync_entity_version_seq as bigint;

-- Legacy P0-009 versions are opaque, client-generated bigint tokens. Keep the
-- rows unchanged and start the server sequence strictly above their maximum.
select pg_catalog.setval(
  'public.nimr_sync_entity_version_seq'::regclass,
  greatest(coalesce((select max(entity_version) from public.sync_entities), 0) + 1, 1),
  false
);

create table if not exists public.sync_entity_conflicts (
  id uuid primary key default gen_random_uuid(),
  workshop_id uuid not null references public.workshops(id) on delete cascade,
  entity_type text not null check (entity_type in ('case', 'booking', 'workshop_settings')),
  entity_id text not null,
  base_version bigint,
  server_version bigint,
  local_operation_id text not null,
  action text not null check (action in ('upsert', 'delete')),
  local_payload jsonb not null default '{}'::jsonb,
  server_payload jsonb not null default '{}'::jsonb,
  server_last_operation_id text,
  server_deleted_at timestamptz,
  detected_at timestamptz not null default clock_timestamp(),
  status text not null default 'open' check (status in ('open', 'resolved')),
  resolved_at timestamptz,
  resolution text,
  created_by uuid references auth.users(id) on delete set null,
  constraint sync_entity_conflicts_workshop_operation_unique
    unique (workshop_id, local_operation_id)
);

create index if not exists sync_entity_conflicts_open_workshop_entity_idx
  on public.sync_entity_conflicts (workshop_id, entity_type, entity_id, status, detected_at desc)
  where status = 'open';

-- Accepted operation receipts make idempotency durable beyond the lifetime of
-- sync_entities.last_operation_id. A response-lost U1 remains recognizable
-- after a later U2 has changed the same canonical row.
create table if not exists public.sync_entity_operation_receipts (
  workshop_id uuid not null references public.workshops(id) on delete cascade,
  local_operation_id text not null,
  entity_type text not null,
  entity_id text not null,
  accepted_version bigint not null,
  accepted_at timestamptz not null default clock_timestamp(),
  primary key (workshop_id, local_operation_id)
);

alter table public.sync_entity_conflicts enable row level security;
alter table public.sync_entity_operation_receipts enable row level security;
alter table public.sync_entities enable row level security;
alter table public.app_settings enable row level security;

drop policy if exists sync_entity_conflicts_member_select on public.sync_entity_conflicts;
create policy sync_entity_conflicts_member_select
on public.sync_entity_conflicts for select to authenticated
using (public.nimr_is_workshop_member(workshop_id));

drop policy if exists sync_entity_operation_receipts_member_select on public.sync_entity_operation_receipts;
create policy sync_entity_operation_receipts_member_select
on public.sync_entity_operation_receipts for select to authenticated
using (public.nimr_is_workshop_member(workshop_id));

revoke all on table public.sync_entity_conflicts from anon, authenticated;
revoke all on table public.sync_entity_operation_receipts from anon, authenticated;
grant select on table public.sync_entity_conflicts to authenticated;

-- Direct writes would bypass CAS. Only the guarded v2 RPC may mutate these.
revoke insert, update, delete on table public.sync_entities from authenticated;
grant select on table public.sync_entities to authenticated;

create index if not exists sync_entities_active_booking_parent_idx
  on public.sync_entities (workshop_id, (payload ->> 'caseId'), entity_id)
  where entity_type = 'booking' and deleted_at is null;

-- Fail closed for already-open P0-009 clients. The exact legacy signature is
-- retained only so PostgREST returns a deterministic upgrade error and the old
-- browser keeps its durable outbox instead of bypassing CAS.
create or replace function public.nimr_apply_sync_entity(
  p_workshop_id uuid,
  p_entity_type text,
  p_entity_id text,
  p_payload jsonb,
  p_entity_version bigint,
  p_operation_id text,
  p_deleted boolean default false
)
returns public.sync_entities
language plpgsql
set search_path = pg_catalog, public
as $nimr$
begin
  raise exception 'client upgrade required: CAS baseVersion required'
    using errcode = 'P0001', hint = 'Use nimr_apply_sync_entity_v2';
end
$nimr$;

revoke all on function public.nimr_apply_sync_entity(uuid, text, text, jsonb, bigint, text, boolean) from public, anon;
grant execute on function public.nimr_apply_sync_entity(uuid, text, text, jsonb, bigint, text, boolean) to authenticated;

create or replace function public.nimr_apply_sync_entity_v2(
  p_workshop_id uuid,
  p_entity_type text,
  p_entity_id text,
  p_payload jsonb,
  p_base_version bigint,
  p_operation_id text,
  p_deleted boolean
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $nimr$
declare
  current_row public.sync_entities;
  parent_row public.sync_entities;
  accepted_receipt public.sync_entity_operation_receipts;
  existing_conflict public.sync_entity_conflicts;
  conflict_row public.sync_entity_conflicts;
  applied public.sync_entities;
  child record;
  new_version bigint;
  child_version bigint;
  now_value timestamptz := clock_timestamp();
  parent_case_id text;
  bounded_payload jsonb;
begin
  if p_entity_type not in ('case', 'booking') then
    raise exception 'unsupported entity_type: %', p_entity_type using errcode = '22023';
  end if;
  if nullif(p_entity_id, '') is null or nullif(p_operation_id, '') is null then
    raise exception 'entity_id and operation_id are required' using errcode = '22023';
  end if;
  if not public.nimr_has_workshop_role(
    p_workshop_id,
    array['admin_technique', 'directeur', 'chef_atelier', 'reception', 'technicien']
  ) then
    raise exception 'workshop access denied' using errcode = '42501';
  end if;

  select * into accepted_receipt
  from public.sync_entity_operation_receipts
  where workshop_id = p_workshop_id and local_operation_id = p_operation_id;
  if found then
    select * into current_row from public.sync_entities
    where workshop_id = p_workshop_id
      and entity_type = accepted_receipt.entity_type
      and entity_id = accepted_receipt.entity_id;
    return jsonb_build_object(
      'status', 'idempotent', 'accepted', true, 'idempotent', true,
      'conflict', false, 'accepted_version', accepted_receipt.accepted_version,
      'server_version', current_row.entity_version,
      'canonical', to_jsonb(current_row)
    );
  end if;

  select * into existing_conflict
  from public.sync_entity_conflicts
  where workshop_id = p_workshop_id and local_operation_id = p_operation_id;
  if found then
    select * into current_row from public.sync_entities
    where workshop_id = existing_conflict.workshop_id
      and entity_type = existing_conflict.entity_type
      and entity_id = existing_conflict.entity_id;
    return jsonb_build_object(
      'status', 'conflict', 'accepted', false, 'idempotent', true,
      'conflict', true,
      'conflict_id', existing_conflict.id,
      'base_version', existing_conflict.base_version,
      'local_payload', existing_conflict.local_payload,
      'server_payload', existing_conflict.server_payload,
      'detected_at', existing_conflict.detected_at,
      'conflict_server_version', existing_conflict.server_version,
      'conflict_canonical', case when existing_conflict.server_version is null then null else jsonb_build_object(
        'workshop_id', existing_conflict.workshop_id,
        'entity_type', existing_conflict.entity_type,
        'entity_id', existing_conflict.entity_id,
        'payload', existing_conflict.server_payload,
        'entity_version', existing_conflict.server_version,
        'last_operation_id', existing_conflict.server_last_operation_id,
        'deleted_at', existing_conflict.server_deleted_at,
        'updated_at', existing_conflict.detected_at
      ) end,
      'server_version', current_row.entity_version,
      'canonical', case when current_row.entity_id is null then null else to_jsonb(current_row) end
    );
  end if;

  -- Parent-first lock order. Advisory locks cover absent rows as well as rows.
  if p_entity_type = 'booking' and not p_deleted then
    parent_case_id := nullif(p_payload ->> 'caseId', '');
    if parent_case_id is not null then
      perform pg_advisory_xact_lock(hashtextextended(
        p_workshop_id::text || ':case:' || parent_case_id, 0
      ));
      select * into parent_row from public.sync_entities
      where workshop_id = p_workshop_id and entity_type = 'case' and entity_id = parent_case_id
      for update;
    end if;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    p_workshop_id::text || ':' || p_entity_type || ':' || p_entity_id, 0
  ));
  select * into current_row from public.sync_entities
  where workshop_id = p_workshop_id and entity_type = p_entity_type and entity_id = p_entity_id
  for update;

  -- Close the concurrent-retry race: another transaction may have committed
  -- this operation while we waited for the advisory/entity lock.
  select * into accepted_receipt
  from public.sync_entity_operation_receipts
  where workshop_id = p_workshop_id and local_operation_id = p_operation_id;
  if found then
    select * into current_row from public.sync_entities
    where workshop_id = p_workshop_id
      and entity_type = accepted_receipt.entity_type
      and entity_id = accepted_receipt.entity_id;
    return jsonb_build_object(
      'status', 'idempotent', 'accepted', true, 'idempotent', true,
      'conflict', false, 'accepted_version', accepted_receipt.accepted_version,
      'server_version', current_row.entity_version,
      'canonical', to_jsonb(current_row)
    );
  end if;
  select * into existing_conflict
  from public.sync_entity_conflicts
  where workshop_id = p_workshop_id and local_operation_id = p_operation_id;
  if found then
    select * into current_row from public.sync_entities
    where workshop_id = existing_conflict.workshop_id
      and entity_type = existing_conflict.entity_type
      and entity_id = existing_conflict.entity_id;
    return jsonb_build_object(
      'status', 'conflict', 'accepted', false, 'idempotent', true,
      'conflict', true,
      'conflict_id', existing_conflict.id,
      'base_version', existing_conflict.base_version,
      'local_payload', existing_conflict.local_payload,
      'server_payload', existing_conflict.server_payload,
      'detected_at', existing_conflict.detected_at,
      'conflict_server_version', existing_conflict.server_version,
      'conflict_canonical', case when existing_conflict.server_version is null then null else jsonb_build_object(
        'workshop_id', existing_conflict.workshop_id,
        'entity_type', existing_conflict.entity_type,
        'entity_id', existing_conflict.entity_id,
        'payload', existing_conflict.server_payload,
        'entity_version', existing_conflict.server_version,
        'last_operation_id', existing_conflict.server_last_operation_id,
        'deleted_at', existing_conflict.server_deleted_at,
        'updated_at', existing_conflict.detected_at
      ) end,
      'server_version', current_row.entity_version,
      'canonical', case when current_row.entity_id is null then null else to_jsonb(current_row) end
    );
  end if;

  if (current_row.entity_id is null and p_base_version is not null)
     or (current_row.entity_id is not null and p_base_version is null)
     or (current_row.entity_id is not null and current_row.entity_version <> p_base_version)
     or (p_entity_type = 'booking' and not p_deleted
         and (parent_case_id is null or parent_row.entity_id is null or parent_row.deleted_at is not null)) then
    insert into public.sync_entity_conflicts (
      workshop_id, entity_type, entity_id, base_version, server_version,
      local_operation_id, action, local_payload, server_payload,
      server_last_operation_id, server_deleted_at, created_by
    ) values (
      p_workshop_id, p_entity_type, p_entity_id, p_base_version,
      current_row.entity_version, p_operation_id,
      case when p_deleted then 'delete' else 'upsert' end,
      coalesce(p_payload, '{}'::jsonb), coalesce(current_row.payload, '{}'::jsonb),
      current_row.last_operation_id, current_row.deleted_at, auth.uid()
    )
    on conflict (workshop_id, local_operation_id) do update
      set local_operation_id = excluded.local_operation_id
    returning * into conflict_row;
    return jsonb_build_object(
      'status', 'conflict', 'accepted', false, 'idempotent', false,
      'conflict', true,
      'conflict_id', conflict_row.id,
      'base_version', conflict_row.base_version,
      'local_payload', conflict_row.local_payload,
      'server_payload', conflict_row.server_payload,
      'detected_at', conflict_row.detected_at,
      'conflict_server_version', conflict_row.server_version,
      'conflict_canonical', case when current_row.entity_id is null then null else to_jsonb(current_row) end,
      'server_version', current_row.entity_version,
      'canonical', case when current_row.entity_id is null then null else to_jsonb(current_row) end
    );
  end if;

  new_version := nextval('public.nimr_sync_entity_version_seq'::regclass);
  bounded_payload := case
    when p_deleted and p_entity_type = 'case' and nullif(p_payload ->> 'projectionLocalId', '') is not null
      then jsonb_build_object('projectionLocalId', p_payload ->> 'projectionLocalId')
    when p_deleted then '{}'::jsonb
    else coalesce(p_payload, '{}'::jsonb)
  end;
  insert into public.sync_entities (
    workshop_id, entity_type, entity_id, payload, entity_version,
    last_operation_id, deleted_at, updated_at
  ) values (
    p_workshop_id, p_entity_type, p_entity_id, bounded_payload, new_version,
    p_operation_id, case when p_deleted then now_value else null end, now_value
  )
  on conflict (workshop_id, entity_type, entity_id) do update
    set payload = excluded.payload,
        entity_version = excluded.entity_version,
        last_operation_id = excluded.last_operation_id,
        deleted_at = excluded.deleted_at,
        updated_at = excluded.updated_at
  returning * into applied;

  insert into public.sync_entity_operation_receipts (
    workshop_id, local_operation_id, entity_type, entity_id, accepted_version
  ) values (p_workshop_id, p_operation_id, p_entity_type, p_entity_id, new_version);

  if p_entity_type = 'case' and p_deleted then
    for child in
      select entity_id from public.sync_entities
      where workshop_id = p_workshop_id and entity_type = 'booking'
        and deleted_at is null and payload ->> 'caseId' = p_entity_id
      order by entity_id
    loop
      perform pg_advisory_xact_lock(hashtextextended(
        p_workshop_id::text || ':booking:' || child.entity_id, 0
      ));
      child_version := nextval('public.nimr_sync_entity_version_seq'::regclass);
      update public.sync_entities
      set payload = '{}'::jsonb,
          entity_version = child_version,
          last_operation_id = p_operation_id || ':cascade-booking:' || child.entity_id,
          deleted_at = now_value,
          updated_at = now_value
      where workshop_id = p_workshop_id and entity_type = 'booking'
        and entity_id = child.entity_id and deleted_at is null;
    end loop;
  end if;

  return jsonb_build_object(
    'status', 'accepted', 'accepted', true, 'idempotent', false,
    'conflict', false, 'accepted_version', new_version,
    'server_version', new_version,
    'canonical', to_jsonb(applied)
  );
end
$nimr$;

revoke all on function public.nimr_apply_sync_entity_v2(uuid, text, text, jsonb, bigint, text, boolean) from public, anon;
grant execute on function public.nimr_apply_sync_entity_v2(uuid, text, text, jsonb, bigint, text, boolean) to authenticated;

-- Compact workshop settings remain in app_settings, with CAS metadata added to
-- that canonical row rather than creating a competing settings store.
alter table public.app_settings add column if not exists entity_version bigint;
alter table public.app_settings add column if not exists last_operation_id text;
update public.app_settings
set entity_version = nextval('public.nimr_sync_entity_version_seq'::regclass)
where setting_key = 'workshop_settings' and entity_version is null;

revoke insert, update, delete on table public.app_settings from authenticated;
revoke all on table public.app_settings from anon;
grant select on table public.app_settings to authenticated;

create or replace function public.nimr_apply_workshop_settings_v2(
  p_workshop_id uuid,
  p_payload jsonb,
  p_base_version bigint,
  p_operation_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $nimr$
declare
  current_row public.app_settings;
  receipt public.sync_entity_operation_receipts;
  conflict_row public.sync_entity_conflicts;
  new_version bigint;
begin
  if not public.nimr_has_workshop_role(
    p_workshop_id,
    array['admin_technique', 'directeur', 'chef_atelier', 'reception']
  ) then
    raise exception 'workshop access denied' using errcode = '42501';
  end if;
  select * into receipt from public.sync_entity_operation_receipts
  where workshop_id = p_workshop_id and local_operation_id = p_operation_id;
  if found then
    select * into current_row from public.app_settings
    where workshop_id = p_workshop_id and setting_key = 'workshop_settings';
    return jsonb_build_object('status','idempotent','accepted',true,'idempotent',true,
      'conflict',false,'accepted_version',receipt.accepted_version,
      'server_version',current_row.entity_version,'canonical',to_jsonb(current_row));
  end if;
  select * into conflict_row from public.sync_entity_conflicts
  where workshop_id = p_workshop_id and local_operation_id = p_operation_id;
  if found then
    select * into current_row from public.app_settings
    where workshop_id = p_workshop_id and setting_key = 'workshop_settings';
    return jsonb_build_object('status','conflict','accepted',false,'idempotent',true,
      'conflict',true,'conflict_id',conflict_row.id,
      'base_version',conflict_row.base_version,'local_payload',conflict_row.local_payload,
      'server_payload',conflict_row.server_payload,'detected_at',conflict_row.detected_at,
      'conflict_server_version',conflict_row.server_version,
      'conflict_canonical',case when conflict_row.server_version is null then null else jsonb_build_object('workshop_id',p_workshop_id,'setting_key','workshop_settings',
        'value',conflict_row.server_payload,'entity_version',conflict_row.server_version,
        'last_operation_id',conflict_row.server_last_operation_id,'updated_at',conflict_row.detected_at) end,
      'server_version',current_row.entity_version,
      'canonical',case when current_row.workshop_id is null then null else to_jsonb(current_row) end);
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_workshop_id::text || ':workshop_settings', 0));
  select * into current_row from public.app_settings
  where workshop_id = p_workshop_id and setting_key = 'workshop_settings' for update;
  select * into receipt from public.sync_entity_operation_receipts
  where workshop_id = p_workshop_id and local_operation_id = p_operation_id;
  if found then
    return jsonb_build_object('status','idempotent','accepted',true,'idempotent',true,
      'conflict',false,'accepted_version',receipt.accepted_version,
      'server_version',current_row.entity_version,'canonical',to_jsonb(current_row));
  end if;
  select * into conflict_row from public.sync_entity_conflicts
  where workshop_id = p_workshop_id and local_operation_id = p_operation_id;
  if found then
    select * into current_row from public.app_settings
    where workshop_id = p_workshop_id and setting_key = 'workshop_settings';
    return jsonb_build_object('status','conflict','accepted',false,'idempotent',true,
      'conflict',true,'conflict_id',conflict_row.id,
      'base_version',conflict_row.base_version,'local_payload',conflict_row.local_payload,
      'server_payload',conflict_row.server_payload,'detected_at',conflict_row.detected_at,
      'conflict_server_version',conflict_row.server_version,
      'conflict_canonical',case when conflict_row.server_version is null then null else jsonb_build_object('workshop_id',p_workshop_id,'setting_key','workshop_settings',
        'value',conflict_row.server_payload,'entity_version',conflict_row.server_version,
        'last_operation_id',conflict_row.server_last_operation_id,'updated_at',conflict_row.detected_at) end,
      'server_version',current_row.entity_version,
      'canonical',case when current_row.workshop_id is null then null else to_jsonb(current_row) end);
  end if;
  if (current_row.workshop_id is null and p_base_version is not null)
     or (current_row.workshop_id is not null and p_base_version is null)
     or (current_row.workshop_id is not null and current_row.entity_version <> p_base_version) then
    insert into public.sync_entity_conflicts (
      workshop_id, entity_type, entity_id, base_version, server_version,
      local_operation_id, action, local_payload, server_payload,
      server_last_operation_id, created_by
    ) values (
      p_workshop_id, 'workshop_settings', 'workshop_settings', p_base_version,
      current_row.entity_version, p_operation_id, 'upsert', coalesce(p_payload,'{}'::jsonb),
      coalesce(current_row.value,'{}'::jsonb), current_row.last_operation_id, auth.uid()
    ) on conflict (workshop_id, local_operation_id) do update
      set local_operation_id = excluded.local_operation_id
    returning * into conflict_row;
    return jsonb_build_object('status','conflict','accepted',false,'idempotent',false,
      'conflict',true,'conflict_id',conflict_row.id,
      'base_version',conflict_row.base_version,'local_payload',conflict_row.local_payload,
      'server_payload',conflict_row.server_payload,'detected_at',conflict_row.detected_at,
      'conflict_server_version',conflict_row.server_version,
      'conflict_canonical',case when current_row.workshop_id is null then null else to_jsonb(current_row) end,
      'server_version',current_row.entity_version,
      'canonical',case when current_row.workshop_id is null then null else to_jsonb(current_row) end);
  end if;
  new_version := nextval('public.nimr_sync_entity_version_seq'::regclass);
  insert into public.app_settings (
    workshop_id, setting_key, value, description, updated_by, updated_at,
    entity_version, last_operation_id
  ) values (
    p_workshop_id, 'workshop_settings', coalesce(p_payload,'{}'::jsonb),
    'Réglages atelier granulaires P0-010 CAS', auth.uid(), clock_timestamp(),
    new_version, p_operation_id
  ) on conflict (workshop_id, setting_key) do update
    set value = excluded.value, description = excluded.description,
        updated_by = excluded.updated_by, updated_at = excluded.updated_at,
        entity_version = excluded.entity_version,
        last_operation_id = excluded.last_operation_id
  returning * into current_row;
  insert into public.sync_entity_operation_receipts (
    workshop_id, local_operation_id, entity_type, entity_id, accepted_version
  ) values (p_workshop_id, p_operation_id, 'workshop_settings', 'workshop_settings', new_version);
  return jsonb_build_object('status','accepted','accepted',true,'idempotent',false,
    'conflict',false,'accepted_version',new_version,
    'server_version',new_version,'canonical',to_jsonb(current_row));
end
$nimr$;

revoke all on function public.nimr_apply_workshop_settings_v2(uuid, jsonb, bigint, text) from public, anon;
grant execute on function public.nimr_apply_workshop_settings_v2(uuid, jsonb, bigint, text) to authenticated;

create or replace function public.nimr_resolve_sync_entity_conflict(
  p_workshop_id uuid,
  p_conflict_id uuid,
  p_resolution text
)
returns public.sync_entity_conflicts
language plpgsql
security definer
set search_path = pg_catalog, public
as $nimr$
declare
  target_conflict public.sync_entity_conflicts;
  resolved public.sync_entity_conflicts;
begin
  select * into target_conflict from public.sync_entity_conflicts
  where workshop_id = p_workshop_id and id = p_conflict_id
  for update;
  if target_conflict.id is null then
    return null;
  end if;
  if p_resolution not in ('accept_server', 'keep_local') then
    raise exception 'unsupported conflict resolution' using errcode = '22023';
  end if;
  if target_conflict.entity_type = 'workshop_settings' then
    if not public.nimr_has_workshop_role(
      target_conflict.workshop_id,
      array['admin_technique', 'directeur', 'chef_atelier', 'reception']
    ) then
      raise exception 'workshop access denied' using errcode = '42501';
    end if;
  elsif target_conflict.entity_type in ('case', 'booking') then
    if not public.nimr_has_workshop_role(
      target_conflict.workshop_id,
      array['admin_technique', 'directeur', 'chef_atelier', 'reception', 'technicien']
    ) then
      raise exception 'workshop access denied' using errcode = '42501';
    end if;
  else
    raise exception 'unsupported conflict entity type' using errcode = '42501';
  end if;
  if target_conflict.status = 'resolved' then
    return target_conflict;
  end if;
  update public.sync_entity_conflicts
  set status = 'resolved', resolved_at = clock_timestamp(), resolution = p_resolution
  where id = target_conflict.id and workshop_id = target_conflict.workshop_id
  returning * into resolved;
  return resolved;
end
$nimr$;

revoke all on function public.nimr_resolve_sync_entity_conflict(uuid, uuid, text) from public, anon;
grant execute on function public.nimr_resolve_sync_entity_conflict(uuid, uuid, text) to authenticated;

commit;
