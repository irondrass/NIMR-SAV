-- P0-009: canonical lossless envelopes for application entities that cannot be
-- reconstructed from the existing reporting/planning projections.
begin;

create table if not exists public.sync_entities (
  workshop_id uuid not null references public.workshops(id) on delete cascade,
  entity_type text not null check (entity_type in ('case', 'booking')),
  entity_id text not null,
  payload jsonb not null default '{}'::jsonb,
  entity_version bigint not null default 0,
  last_operation_id text not null,
  deleted_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (workshop_id, entity_type, entity_id)
);

create index if not exists sync_entities_workshop_cursor_idx
  on public.sync_entities(workshop_id, entity_type, updated_at, entity_id);
create index if not exists sync_entities_workshop_tombstone_idx
  on public.sync_entities(workshop_id, entity_type, deleted_at, entity_id)
  where deleted_at is not null;

with latest_backup as (
  select distinct on (workshop_id) workshop_id, state, updated_at
  from public.cloud_backups
  where state is not null
  order by workshop_id, updated_at desc, id desc
), legacy_cases as (
  select backup.workshop_id, item.payload, item.payload ->> 'id' as entity_id, backup.updated_at
  from latest_backup backup
  cross join lateral jsonb_array_elements(coalesce(backup.state -> 'cases', '[]'::jsonb)) item(payload)
)
insert into public.sync_entities (workshop_id, entity_type, entity_id, payload, entity_version, last_operation_id, deleted_at, created_at, updated_at)
select workshop_id, 'case', entity_id, payload,
  case when coalesce(payload ->> 'localRevision', '') ~ '^[0-9]+$' then (payload ->> 'localRevision')::bigint else 0 end,
  'legacy-bootstrap:' || md5(workshop_id::text || ':case:' || entity_id), null,
  coalesce(updated_at, clock_timestamp()), coalesce(updated_at, clock_timestamp())
from legacy_cases
where coalesce(entity_id, '') <> ''
on conflict (workshop_id, entity_type, entity_id) do nothing;

with latest_backup as (
  select distinct on (workshop_id) workshop_id, state, updated_at
  from public.cloud_backups
  where state is not null
  order by workshop_id, updated_at desc, id desc
), legacy_bookings as (
  select backup.workshop_id, item.payload, item.payload ->> 'id' as entity_id, backup.updated_at
  from latest_backup backup
  cross join lateral jsonb_array_elements(coalesce(backup.state -> 'bookings', '[]'::jsonb)) item(payload)
)
insert into public.sync_entities (workshop_id, entity_type, entity_id, payload, entity_version, last_operation_id, deleted_at, created_at, updated_at)
select workshop_id, 'booking', entity_id, payload,
  case when coalesce(payload ->> 'version', payload ->> 'localRevision', '') ~ '^[0-9]+$' then coalesce(payload ->> 'version', payload ->> 'localRevision')::bigint else 0 end,
  'legacy-bootstrap:' || md5(workshop_id::text || ':booking:' || entity_id), null,
  coalesce(updated_at, clock_timestamp()), coalesce(updated_at, clock_timestamp())
from legacy_bookings
where coalesce(entity_id, '') <> ''
on conflict (workshop_id, entity_type, entity_id) do nothing;

with latest_backup as (
  select distinct on (workshop_id) workshop_id, state, updated_at
  from public.cloud_backups
  where state is not null
  order by workshop_id, updated_at desc, id desc
), legacy_audit as (
  select backup.workshop_id, item.payload,
    coalesce(nullif(item.payload ->> 'id', ''), 'legacy-audit:' || md5(item.payload::text)) as local_id,
    backup.updated_at
  from latest_backup backup
  cross join lateral jsonb_array_elements(coalesce(backup.state -> 'auditLog', '[]'::jsonb)) item(payload)
)
insert into public.audit_logs (workshop_id, local_id, repair_order_id, action, entity_type, entity_id, before_data, after_data, created_at)
select workshop_id, local_id, null,
  coalesce(nullif(payload ->> 'label', ''), nullif(payload ->> 'type', ''), 'Audit atelier'),
  'application_audit', null, null, payload, coalesce(updated_at, clock_timestamp())
from legacy_audit
on conflict (workshop_id, local_id) do nothing;

with latest_backup as (
  select distinct on (workshop_id) workshop_id, state, updated_at
  from public.cloud_backups
  where state is not null
  order by workshop_id, updated_at desc, id desc
)
insert into public.app_settings (workshop_id, setting_key, value, description, updated_at)
select workshop_id, 'workshop_settings',
  jsonb_build_object(
    'schemaVersion', 1,
    'settings', coalesce(state -> 'settings', '{}'::jsonb),
    'workHours', coalesce(state -> 'workHours', '{}'::jsonb),
    'holidays', coalesce(state -> 'holidays', '[]'::jsonb),
    'resources', coalesce(state -> 'resources', '[]'::jsonb),
    'planningDate', coalesce(state -> 'planningDate', 'null'::jsonb),
    'exportedAt', to_jsonb(coalesce(updated_at, clock_timestamp()))
  ),
  'Réglages atelier migrés depuis la dernière sauvegarde cloud P0-009',
  coalesce(updated_at, clock_timestamp())
from latest_backup
on conflict (workshop_id, setting_key) do nothing;

alter table public.sync_entities enable row level security;

drop policy if exists nimr_sync_entities_select on public.sync_entities;
drop policy if exists nimr_sync_entities_insert on public.sync_entities;
drop policy if exists nimr_sync_entities_update on public.sync_entities;

create policy nimr_sync_entities_select on public.sync_entities for select to authenticated
using (public.nimr_is_workshop_member(workshop_id));

create policy nimr_sync_entities_insert on public.sync_entities for insert to authenticated
with check (public.nimr_has_workshop_role(workshop_id, array['admin_technique', 'directeur', 'chef_atelier', 'reception', 'technicien']));

create policy nimr_sync_entities_update on public.sync_entities for update to authenticated
using (public.nimr_has_workshop_role(workshop_id, array['admin_technique', 'directeur', 'chef_atelier', 'reception', 'technicien']))
with check (public.nimr_has_workshop_role(workshop_id, array['admin_technique', 'directeur', 'chef_atelier', 'reception', 'technicien']));

revoke all on table public.sync_entities from anon;
grant select, insert, update on table public.sync_entities to authenticated;

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
declare
  existing public.sync_entities;
  applied public.sync_entities;
begin
  if p_entity_type not in ('case', 'booking') then
    raise exception 'unsupported entity_type: %', p_entity_type using errcode = '22023';
  end if;
  if not public.nimr_has_workshop_role(
    p_workshop_id,
    array['admin_technique', 'directeur', 'chef_atelier', 'reception', 'technicien']
  ) then
    raise exception 'workshop access denied' using errcode = '42501';
  end if;

  select * into existing
  from public.sync_entities
  where workshop_id = p_workshop_id
    and entity_type = p_entity_type
    and entity_id = p_entity_id
  for update;

  if found and existing.last_operation_id = p_operation_id then
    return existing;
  end if;
  if found and existing.entity_version > greatest(0, p_entity_version) then
    return existing;
  end if;
  if found
    and existing.entity_version = greatest(0, p_entity_version)
    and existing.deleted_at is not null
    and not p_deleted then
    return existing;
  end if;

  insert into public.sync_entities (
    workshop_id, entity_type, entity_id, payload, entity_version,
    last_operation_id, deleted_at, updated_at
  ) values (
    p_workshop_id,
    p_entity_type,
    p_entity_id,
    case
      when p_deleted and p_entity_type = 'case' and nullif(p_payload ->> 'projectionLocalId', '') is not null
        then jsonb_build_object('projectionLocalId', p_payload ->> 'projectionLocalId')
      when p_deleted then '{}'::jsonb
      else coalesce(p_payload, '{}'::jsonb)
    end,
    greatest(0, p_entity_version),
    p_operation_id,
    case when p_deleted then clock_timestamp() else null end,
    clock_timestamp()
  )
  on conflict (workshop_id, entity_type, entity_id) do update
  set payload = excluded.payload,
      entity_version = excluded.entity_version,
      last_operation_id = excluded.last_operation_id,
      deleted_at = excluded.deleted_at,
      updated_at = clock_timestamp()
  returning * into applied;

  return applied;
end
$nimr$;

revoke all on function public.nimr_apply_sync_entity(uuid, text, text, jsonb, bigint, text, boolean) from public;
grant execute on function public.nimr_apply_sync_entity(uuid, text, text, jsonb, bigint, text, boolean) to authenticated;

alter table public.sync_entities replica identity full;
do $nimr$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'sync_entities'
  ) then
    alter publication supabase_realtime add table public.sync_entities;
  end if;
end
$nimr$;

commit;;
