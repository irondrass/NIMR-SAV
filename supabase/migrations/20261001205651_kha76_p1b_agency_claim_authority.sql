-- KHA-76 P1B — server-authoritative agency warranty draft authority.
-- Scope: OR agency ownership + structured diagnostic + create/update draft RPCs + append-only audit.
-- No submission/review/OEM/payment/stock authority. Generic repair_claims DML stays revoked.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.repair_orders
  add column if not exists agency_id text;

alter table public.repair_claims
  add column if not exists agency_complaint_verbatim text,
  add column if not exists agency_diagnostic_findings text,
  add column if not exists agency_suspected_cause text,
  add column if not exists agency_causal_part_reference text,
  add column if not exists agency_dtc jsonb,
  add column if not exists agency_mileage_at_diagnosis integer,
  add column if not exists agency_diagnostic_recorded_at timestamptz,
  add column if not exists agency_diagnostic_recorded_by uuid,
  add column if not exists agency_idempotency_key text;

do $p1b$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.repair_orders'::regclass
      and conname='repair_orders_agency_id_format_check'
  ) then
    alter table public.repair_orders
      add constraint repair_orders_agency_id_format_check
      check (
        agency_id is null
        or (
          pg_catalog.length(pg_catalog.btrim(agency_id)) between 1 and 128
          and agency_id = pg_catalog.btrim(agency_id)
        )
      ) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid='public.repair_claims'::regclass
      and conname='repair_claims_agency_mileage_check'
  ) then
    alter table public.repair_claims
      add constraint repair_claims_agency_mileage_check
      check (
        agency_mileage_at_diagnosis is null
        or agency_mileage_at_diagnosis between 0 and 5000000
      ) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid='public.repair_claims'::regclass
      and conname='repair_claims_agency_dtc_array_check'
  ) then
    alter table public.repair_claims
      add constraint repair_claims_agency_dtc_array_check
      check (
        agency_dtc is null
        or pg_catalog.jsonb_typeof(agency_dtc) = 'array'
      ) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid='public.repair_claims'::regclass
      and conname='repair_claims_agency_idempotency_key_format_check'
  ) then
    alter table public.repair_claims
      add constraint repair_claims_agency_idempotency_key_format_check
      check (
        agency_idempotency_key is null
        or (
          pg_catalog.length(pg_catalog.btrim(agency_idempotency_key)) between 1 and 128
          and agency_idempotency_key = pg_catalog.btrim(agency_idempotency_key)
        )
      ) not valid;
  end if;
end
$p1b$;

alter table public.repair_orders validate constraint repair_orders_agency_id_format_check;
alter table public.repair_claims validate constraint repair_claims_agency_mileage_check;
alter table public.repair_claims validate constraint repair_claims_agency_dtc_array_check;
alter table public.repair_claims validate constraint repair_claims_agency_idempotency_key_format_check;

create index if not exists repair_orders_workshop_agency_active_idx
  on public.repair_orders (workshop_id, agency_id, id)
  where agency_id is not null and deleted_at is null;

create unique index if not exists repair_claims_agency_idempotency_uidx
  on public.repair_claims (workshop_id, agency_id, agency_idempotency_key)
  where agency_id is not null
    and agency_idempotency_key is not null
    and deleted_at is null;

create table if not exists public.warranty_agency_claim_events (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  workshop_id uuid not null,
  agency_id text not null,
  claim_id uuid not null,
  actor_user_id uuid,
  action text not null,
  claim_version bigint not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint warranty_agency_claim_events_workshop_fkey
    foreign key (workshop_id) references public.workshops(id) on delete cascade,
  constraint warranty_agency_claim_events_claim_scope_fkey
    foreign key (workshop_id, claim_id)
    references public.repair_claims(workshop_id, id) on delete cascade,
  constraint warranty_agency_claim_events_actor_fkey
    foreign key (actor_user_id) references auth.users(id) on delete set null,
  constraint warranty_agency_claim_events_action_check
    check (action in ('agency_draft_created','agency_diagnostic_updated')),
  constraint warranty_agency_claim_events_agency_id_format_check
    check (
      pg_catalog.length(pg_catalog.btrim(agency_id)) between 1 and 128
      and agency_id = pg_catalog.btrim(agency_id)
    )
);

create index if not exists warranty_agency_claim_events_claim_idx
  on public.warranty_agency_claim_events (workshop_id, claim_id, created_at);

alter table public.warranty_agency_claim_events enable row level security;

drop policy if exists warranty_agency_claim_events_agency_select
  on public.warranty_agency_claim_events;
create policy warranty_agency_claim_events_agency_select
  on public.warranty_agency_claim_events
  for select
  to authenticated
  using (
    nimr_internal.nimr_is_warranty_agency_member(workshop_id, agency_id)
  );

drop policy if exists warranty_agency_claim_events_internal_select
  on public.warranty_agency_claim_events;
create policy warranty_agency_claim_events_internal_select
  on public.warranty_agency_claim_events
  for select
  to authenticated
  using (
    nimr_internal.nimr_has_workshop_role(
      workshop_id,
      array['admin_technique','directeur','responsable_garantie_support']
    )
  );

revoke all privileges on table public.warranty_agency_claim_events
  from public, anon, authenticated;
grant select on table public.warranty_agency_claim_events
  to authenticated;

create or replace function nimr_internal.nimr_normalize_agency_diagnostic(
  p_diagnostic jsonb
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $p1b$
declare
  unknown_field text;
  complaint_value text;
  findings_value text;
  cause_value text;
  part_value text;
  mileage_numeric numeric;
  mileage_value integer;
  dtc_value jsonb;
  dtc_item jsonb;
  dtc_text text;
  dtc_normalized jsonb := '[]'::jsonb;
begin
  if pg_catalog.jsonb_typeof(p_diagnostic) <> 'object' then
    raise exception 'P1B_DIAGNOSTIC_OBJECT_REQUIRED' using errcode='22023';
  end if;

  select key into unknown_field
  from pg_catalog.jsonb_object_keys(p_diagnostic) as key
  where key <> all(array[
    'complaintVerbatim',
    'findings',
    'suspectedCause',
    'causalPartReference',
    'dtc',
    'mileageAtDiagnosis'
  ]::text[])
  limit 1;

  if unknown_field is not null then
    raise exception 'P1B_UNKNOWN_DIAGNOSTIC_FIELD: %', unknown_field using errcode='22023';
  end if;

  complaint_value := nullif(pg_catalog.btrim(p_diagnostic ->> 'complaintVerbatim'), '');
  findings_value := nullif(pg_catalog.btrim(p_diagnostic ->> 'findings'), '');
  cause_value := nullif(pg_catalog.btrim(p_diagnostic ->> 'suspectedCause'), '');
  part_value := nullif(pg_catalog.btrim(p_diagnostic ->> 'causalPartReference'), '');

  if complaint_value is null then
    raise exception 'P1B_COMPLAINT_REQUIRED' using errcode='22023';
  end if;
  if findings_value is null then
    raise exception 'P1B_FINDINGS_REQUIRED' using errcode='22023';
  end if;
  if cause_value is null then
    raise exception 'P1B_SUSPECTED_CAUSE_REQUIRED' using errcode='22023';
  end if;

  if pg_catalog.length(complaint_value) > 4000
     or pg_catalog.length(findings_value) > 8000
     or pg_catalog.length(cause_value) > 4000
     or pg_catalog.length(coalesce(part_value,'')) > 200 then
    raise exception 'P1B_DIAGNOSTIC_TEXT_TOO_LONG' using errcode='22023';
  end if;

  if not (p_diagnostic ? 'mileageAtDiagnosis')
     or pg_catalog.jsonb_typeof(p_diagnostic -> 'mileageAtDiagnosis') <> 'number' then
    raise exception 'P1B_MILEAGE_INVALID' using errcode='22023';
  end if;

  mileage_numeric := (p_diagnostic ->> 'mileageAtDiagnosis')::numeric;
  if mileage_numeric <> pg_catalog.trunc(mileage_numeric)
     or mileage_numeric < 0
     or mileage_numeric > 5000000 then
    raise exception 'P1B_MILEAGE_INVALID' using errcode='22023';
  end if;
  mileage_value := mileage_numeric::integer;

  dtc_value := coalesce(p_diagnostic -> 'dtc', '[]'::jsonb);
  if pg_catalog.jsonb_typeof(dtc_value) <> 'array'
     or pg_catalog.jsonb_array_length(dtc_value) > 50 then
    raise exception 'P1B_DTC_INVALID' using errcode='22023';
  end if;

  for dtc_item in
    select value from pg_catalog.jsonb_array_elements(dtc_value)
  loop
    if pg_catalog.jsonb_typeof(dtc_item) <> 'string' then
      raise exception 'P1B_DTC_INVALID' using errcode='22023';
    end if;
    dtc_text := nullif(pg_catalog.btrim(dtc_item #>> '{}'), '');
    if dtc_text is null or pg_catalog.length(dtc_text) > 64 then
      raise exception 'P1B_DTC_INVALID' using errcode='22023';
    end if;
    dtc_normalized := dtc_normalized || pg_catalog.jsonb_build_array(dtc_text);
  end loop;

  return pg_catalog.jsonb_build_object(
    'complaintVerbatim', complaint_value,
    'findings', findings_value,
    'suspectedCause', cause_value,
    'causalPartReference', part_value,
    'dtc', dtc_normalized,
    'mileageAtDiagnosis', mileage_value
  );
end
$p1b$;

revoke all on function nimr_internal.nimr_normalize_agency_diagnostic(jsonb)
  from public, anon, authenticated;

create or replace function public.nimr_create_agency_warranty_draft(
  p_workshop_id uuid,
  p_repair_order_id uuid,
  p_diagnostic jsonb,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $p1b$
declare
  actor_uid uuid;
  agency_scope_count integer;
  agency_id_value text;
  idempotency_key_value text;
  normalized jsonb;
  repair_order_row public.repair_orders%rowtype;
  existing_claim public.repair_claims%rowtype;
  claim_id_value uuid;
  claim_version_value bigint;
begin
  actor_uid := auth.uid();
  if actor_uid is null then
    raise exception 'P1B_AUTH_REQUIRED' using errcode='42501';
  end if;
  if p_workshop_id is null or p_repair_order_id is null then
    raise exception 'P1B_REPAIR_ORDER_SCOPE_FORBIDDEN' using errcode='42501';
  end if;

  select count(*), min(agency_id)
  into agency_scope_count, agency_id_value
  from public.warranty_agency_members
  where workshop_id = p_workshop_id
    and user_id = auth.uid()
    and capability = 'agent_agence'
    and active = true
    and deleted_at is null;

  if agency_scope_count = 0 then
    raise exception 'P1B_AGENCY_SCOPE_FORBIDDEN' using errcode='42501';
  end if;
  if agency_scope_count > 1 then
    raise exception 'P1B_AGENCY_SCOPE_AMBIGUOUS' using errcode='42501';
  end if;

  idempotency_key_value := nullif(pg_catalog.btrim(p_idempotency_key), '');
  if idempotency_key_value is null then
    raise exception 'P1B_IDEMPOTENCY_KEY_REQUIRED' using errcode='22023';
  end if;
  if pg_catalog.length(idempotency_key_value) > 128 then
    raise exception 'P1B_IDEMPOTENCY_KEY_TOO_LONG' using errcode='22023';
  end if;

  select *
  into repair_order_row
  from public.repair_orders
  where id = p_repair_order_id
    and workshop_id = p_workshop_id
    and agency_id = agency_id_value
    and deleted_at is null
  for share;

  if not found then
    raise exception 'P1B_REPAIR_ORDER_SCOPE_FORBIDDEN' using errcode='42501';
  end if;

  select *
  into existing_claim
  from public.repair_claims
  where workshop_id = p_workshop_id
    and agency_id = agency_id_value
    and agency_idempotency_key = idempotency_key_value
    and deleted_at is null
  for update;

  if found then
    if existing_claim.repair_order_id is distinct from p_repair_order_id
       or existing_claim.type <> 'garantie' then
      raise exception 'P1B_IDEMPOTENCY_CONFLICT' using errcode='23505';
    end if;

    return pg_catalog.jsonb_build_object(
      'id', existing_claim.id,
      'workshop_id', existing_claim.workshop_id,
      'agency_id', existing_claim.agency_id,
      'repair_order_id', existing_claim.repair_order_id,
      'status', existing_claim.status,
      'version', existing_claim.version,
      'idempotent', true
    );
  end if;

  normalized := nimr_internal.nimr_normalize_agency_diagnostic(p_diagnostic);
  claim_id_value := pg_catalog.gen_random_uuid();

  insert into public.repair_claims (
    id,
    workshop_id,
    local_id,
    repair_order_id,
    number,
    title,
    status,
    include_in_planning,
    estimate_number,
    or_number,
    source_file,
    vehicle_area,
    type,
    expert_approved,
    client_approved,
    amount,
    agency_id,
    agency_complaint_verbatim,
    agency_diagnostic_findings,
    agency_suspected_cause,
    agency_causal_part_reference,
    agency_dtc,
    agency_mileage_at_diagnosis,
    agency_diagnostic_recorded_at,
    agency_diagnostic_recorded_by,
    agency_idempotency_key,
    created_by,
    updated_by,
    sync_source
  ) values (
    claim_id_value,
    p_workshop_id,
    'agency:' || claim_id_value::text,
    p_repair_order_id,
    null,
    'Garantie agence — ' || pg_catalog.left(normalized ->> 'complaintVerbatim', 120),
    'draft',
    false,
    repair_order_row.estimate_number,
    repair_order_row.order_number,
    null,
    null,
    'garantie',
    false,
    false,
    null,
    agency_id_value,
    normalized ->> 'complaintVerbatim',
    normalized ->> 'findings',
    normalized ->> 'suspectedCause',
    normalized ->> 'causalPartReference',
    normalized -> 'dtc',
    (normalized ->> 'mileageAtDiagnosis')::integer,
    pg_catalog.clock_timestamp(),
    actor_uid,
    idempotency_key_value,
    auth.uid(),
    auth.uid(),
    'warranty_network'
  )
  returning version into claim_version_value;

  insert into public.warranty_agency_claim_events (
    workshop_id,
    agency_id,
    claim_id,
    actor_user_id,
    action,
    claim_version,
    details
  ) values (
    p_workshop_id,
    agency_id_value,
    claim_id_value,
    actor_uid,
    'agency_draft_created',
    claim_version_value,
    pg_catalog.jsonb_build_object(
      'repair_order_id', p_repair_order_id,
      'idempotency_key', idempotency_key_value
    )
  );

  return pg_catalog.jsonb_build_object(
    'id', claim_id_value,
    'workshop_id', p_workshop_id,
    'agency_id', agency_id_value,
    'repair_order_id', p_repair_order_id,
    'status', 'draft',
    'version', claim_version_value,
    'idempotent', false
  );
end
$p1b$;

create or replace function public.nimr_update_agency_warranty_draft(
  p_claim_id uuid,
  p_expected_version bigint,
  p_diagnostic jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $p1b$
declare
  actor_uid uuid;
  normalized jsonb;
  claim_row public.repair_claims%rowtype;
  new_version bigint;
begin
  actor_uid := auth.uid();
  if actor_uid is null then
    raise exception 'P1B_AUTH_REQUIRED' using errcode='42501';
  end if;
  if p_claim_id is null or p_expected_version is null or p_expected_version < 1 then
    raise exception 'P1B_VERSION_CONFLICT' using errcode='40001';
  end if;

  select *
  into claim_row
  from public.repair_claims
  where id = p_claim_id
    and deleted_at is null
  for update;

  if not found
     or claim_row.type <> 'garantie'
     or claim_row.agency_id is null
     or not exists (
       select 1
       from public.warranty_agency_members
       where workshop_id = claim_row.workshop_id
         and agency_id = claim_row.agency_id
         and user_id = auth.uid()
         and capability = 'agent_agence'
         and active = true
         and deleted_at is null
     ) then
    raise exception 'P1B_CLAIM_SCOPE_FORBIDDEN' using errcode='42501';
  end if;

  if claim_row.status <> 'draft'
     or claim_row.expert_approved
     or claim_row.client_approved then
    raise exception 'P1B_DRAFT_LOCKED' using errcode='42501';
  end if;

  if claim_row.version <> p_expected_version then
    raise exception 'P1B_VERSION_CONFLICT' using errcode='40001';
  end if;

  if not exists (
    select 1
    from public.repair_orders
    where id = claim_row.repair_order_id
      and workshop_id = claim_row.workshop_id
      and agency_id = claim_row.agency_id
      and deleted_at is null
  ) then
    raise exception 'P1B_REPAIR_ORDER_SCOPE_FORBIDDEN' using errcode='42501';
  end if;

  normalized := nimr_internal.nimr_normalize_agency_diagnostic(p_diagnostic);

  update public.repair_claims
  set
    title = 'Garantie agence — ' || pg_catalog.left(normalized ->> 'complaintVerbatim', 120),
    agency_complaint_verbatim = normalized ->> 'complaintVerbatim',
    agency_diagnostic_findings = normalized ->> 'findings',
    agency_suspected_cause = normalized ->> 'suspectedCause',
    agency_causal_part_reference = normalized ->> 'causalPartReference',
    agency_dtc = normalized -> 'dtc',
    agency_mileage_at_diagnosis = (normalized ->> 'mileageAtDiagnosis')::integer,
    agency_diagnostic_recorded_at = pg_catalog.clock_timestamp(),
    agency_diagnostic_recorded_by = actor_uid,
    updated_by = actor_uid
  where id = p_claim_id
    and version = p_expected_version
  returning version into new_version;

  if new_version is null then
    raise exception 'P1B_VERSION_CONFLICT' using errcode='40001';
  end if;

  insert into public.warranty_agency_claim_events (
    workshop_id,
    agency_id,
    claim_id,
    actor_user_id,
    action,
    claim_version,
    details
  ) values (
    claim_row.workshop_id,
    claim_row.agency_id,
    p_claim_id,
    actor_uid,
    'agency_diagnostic_updated',
    new_version,
    pg_catalog.jsonb_build_object(
      'repair_order_id', claim_row.repair_order_id
    )
  );

  return pg_catalog.jsonb_build_object(
    'id', p_claim_id,
    'workshop_id', claim_row.workshop_id,
    'agency_id', claim_row.agency_id,
    'repair_order_id', claim_row.repair_order_id,
    'status', claim_row.status,
    'version', new_version
  );
end
$p1b$;

revoke all on function public.nimr_create_agency_warranty_draft(uuid, uuid, jsonb, text)
  from public;
revoke all on function public.nimr_create_agency_warranty_draft(uuid, uuid, jsonb, text)
  from anon;
grant execute on function public.nimr_create_agency_warranty_draft(uuid, uuid, jsonb, text)
  to authenticated;

revoke all on function public.nimr_update_agency_warranty_draft(uuid, bigint, jsonb)
  from public;
revoke all on function public.nimr_update_agency_warranty_draft(uuid, bigint, jsonb)
  from anon;
grant execute on function public.nimr_update_agency_warranty_draft(uuid, bigint, jsonb)
  to authenticated;

revoke insert, update, delete on table public.repair_claims
  from authenticated;
revoke insert, update, delete on table public.repair_claims
  from anon;

comment on function public.nimr_create_agency_warranty_draft(uuid, uuid, jsonb, text) is
  'KHA-76 P1B bounded agency draft creation. Agency comes from server membership; OR must be assigned to same agency.';
comment on function public.nimr_update_agency_warranty_draft(uuid, bigint, jsonb) is
  'KHA-76 P1B bounded same-agency draft diagnostic update with optimistic version check.';

commit;
