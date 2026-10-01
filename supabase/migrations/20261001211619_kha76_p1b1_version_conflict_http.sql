-- KHA-76 P1B.1 — prevent PostgREST retry loop for optimistic version conflicts.
-- SQLSTATE 40001 is reserved for serialization failures and is retried by PostgREST 14.
-- PT412 maps the business conflict to HTTP 412 Precondition Failed without transient retries.

begin;
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
    raise sqlstate 'PT412' using message = 'P1B_VERSION_CONFLICT';
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
    raise sqlstate 'PT412' using message = 'P1B_VERSION_CONFLICT';
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
    raise sqlstate 'PT412' using message = 'P1B_VERSION_CONFLICT';
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
revoke all on function public.nimr_update_agency_warranty_draft(uuid, bigint, jsonb)
  from public, anon;
grant execute on function public.nimr_update_agency_warranty_draft(uuid, bigint, jsonb)
  to authenticated;

comment on function public.nimr_update_agency_warranty_draft(uuid, bigint, jsonb) is
  'KHA-76 P1B.1 bounded same-agency draft update; optimistic version conflicts return HTTP 412.';

commit;
