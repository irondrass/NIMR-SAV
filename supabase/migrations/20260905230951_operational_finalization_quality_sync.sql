-- v23.3.33. No historical payload rewrite and no widening of workshop roles.
-- Production prerequisite: SEC-002 / nimr_apply_quality_review_v1, verified deployed.
begin;

-- SQL NULL must deny membership, including IF NOT checks in existing RPCs.
create or replace function public.nimr_has_workshop_role(target_workshop_id uuid, allowed_roles text[])
returns boolean language sql stable security definer set search_path = pg_catalog, public
as $fn$ select coalesce(public.nimr_current_workshop_role(target_workshop_id) = any(allowed_roles), false) $fn$;

create schema if not exists nimr_internal;
revoke all on schema nimr_internal from public, anon;
grant usage on schema nimr_internal to authenticated;

create or replace function public.nimr_finalization_issue(p_payload jsonb, p_delivery boolean)
returns text language plpgsql immutable security invoker
set search_path = pg_catalog, public
as $fn$
begin
  if p_payload #>> '{flags,received}' is distinct from 'true' then
    return 'Confirmer la réception physique du véhicule.';
  end if;
  if p_payload #>> '{flags,workCompleted}' is distinct from 'true' then
    return 'Terminer les travaux avant la finalisation.';
  end if;
  if coalesce(p_payload->>'blockerReason', '') <> ''
    or p_payload->>'partsStatus' in ('waiting_parts', 'blocked_parts') then
    return 'Résoudre le blocage avant la finalisation.';
  end if;
  if exists (select 1 from jsonb_array_elements(case
      when jsonb_typeof(p_payload->'customerClaims') = 'array' then p_payload->'customerClaims' else '[]'::jsonb end) c
      where c->>'status' in ('open', 'in_progress', 'unresolved')) then
    return 'Traiter les réclamations client encore ouvertes.';
  end if;
  if p_delivery and (coalesce(p_payload #>> '{receptionWorkflow,qualityStatus}', '') in ('rejected', 'rework', 'in_progress')
    or (p_payload #>> '{flags,qualityApproved}' is distinct from 'true'
      and p_payload #>> '{receptionWorkflow,qualityStatus}' is distinct from 'validated')) then
    return 'Valider le contrôle qualité avant la remise du véhicule.';
  end if;
  return null;
end;
$fn$;
revoke all on function public.nimr_finalization_issue(jsonb, boolean) from public, anon;
grant execute on function public.nimr_finalization_issue(jsonb, boolean) to authenticated;

create or replace function public.nimr_guard_operational_finalization()
returns trigger language plpgsql security invoker
set search_path = pg_catalog, public
as $fn$
declare
  previous jsonb := '{}'::jsonb;
  quality_changed boolean;
  quality_validated boolean;
  delivery_started boolean;
  issue text;
begin
  if new.entity_type <> 'case' or new.deleted_at is not null then return new; end if;
  if tg_op = 'UPDATE' then previous := coalesce(old.payload, '{}'::jsonb); end if;
  quality_changed := (new.payload #> '{receptionWorkflow,qualityStatus}' is distinct from previous #> '{receptionWorkflow,qualityStatus}')
    or (new.payload #> '{flags,qualityApproved}' is distinct from previous #> '{flags,qualityApproved}')
    or (nullif(new.payload #>> '{receptionWorkflow,qualityReviewedAt}', '') is not null
      and new.payload #>> '{receptionWorkflow,qualityReviewedAt}' is distinct from previous #>> '{receptionWorkflow,qualityReviewedAt}');
  quality_validated := quality_changed and (new.payload #>> '{flags,qualityApproved}' = 'true'
    or new.payload #>> '{receptionWorkflow,qualityStatus}' = 'validated');
  delivery_started := new.payload #>> '{flags,delivered}' = 'true'
    and previous #>> '{flags,delivered}' is distinct from 'true';

  -- Ignore default not_started/false normalization. Actual decisions require a QC role.
  if quality_changed and (new.payload #>> '{flags,qualityApproved}' = 'true'
    or coalesce(new.payload #>> '{receptionWorkflow,qualityStatus}', 'not_started') <> 'not_started'
    or previous #>> '{flags,qualityApproved}' = 'true') then
    if auth.uid() is not null and not public.nimr_has_workshop_role(new.workshop_id,
      array['admin_technique','directeur','chef_atelier','controle_qualite']) then
      raise exception 'quality review access denied' using errcode = '42501';
    end if;
    if previous #>> '{flags,delivered}' = 'true' or nullif(previous->>'archivedAt', '') is not null then
      raise exception 'Le dossier livré ou archivé ne peut plus recevoir une décision qualité.' using errcode = '23514';
    end if;
  end if;
  if delivery_started and auth.uid() is not null and not public.nimr_has_workshop_role(new.workshop_id,
    array['admin_technique','directeur','chef_atelier','reception']) then
    raise exception 'delivery access denied' using errcode = '42501';
  end if;
  if quality_validated or delivery_started then
    issue := public.nimr_finalization_issue(new.payload, coalesce(delivery_started, false));
    if issue is not null then raise exception '%', issue using errcode = '23514'; end if;
  end if;
  if ((nullif(new.payload->>'archivedAt', '') is not null and nullif(previous->>'archivedAt', '') is null)
    or (nullif(new.payload->>'closedAt', '') is not null and nullif(previous->>'closedAt', '') is null)
    or (new.payload #>> '{flags,invoiced}' = 'true' and previous #>> '{flags,invoiced}' is distinct from 'true'))
    and new.payload #>> '{flags,delivered}' is distinct from 'true' then
    raise exception 'Confirmer la remise physique avant la clôture ou l''archivage.' using errcode = '23514';
  end if;
  return new;
end;
$fn$;
revoke all on function public.nimr_guard_operational_finalization() from public, anon, authenticated;
-- AFTER observes the actual old row for INSERT ... ON CONFLICT DO UPDATE.
drop trigger if exists nimr_operational_finalization_guard on public.sync_entities;
create trigger nimr_operational_finalization_guard after insert or update on public.sync_entities
for each row execute function public.nimr_guard_operational_finalization();

-- The receipt table has no client SELECT grant. Keep privileged receipt access
-- in a non-exposed schema with an explicit workshop/role check, never grant
-- clients access to all receipts and never accept arbitrary case payloads.
create or replace function nimr_internal.nimr_apply_quality_review_v2(
  p_workshop_id uuid, p_case_id text, p_quality_status text, p_reason text,
  p_operation_id text, p_base_version bigint
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, public
as $fn$
declare current_row public.sync_entities;
begin
  if auth.uid() is null or not public.nimr_has_workshop_role(p_workshop_id,
    array['admin_technique','directeur','chef_atelier','controle_qualite']) then
    raise exception 'quality review access denied' using errcode = '42501';
  end if;
  if nullif(trim(p_case_id), '') is null or nullif(trim(p_operation_id), '') is null then
    raise exception 'case_id and operation_id are required' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_workshop_id::text || ':case:' || p_case_id, 0));
  select * into current_row from public.sync_entities
    where workshop_id=p_workshop_id and entity_type='case' and entity_id=p_case_id;
  -- A lost acknowledgement remains retryable even after another edit.
  if exists (select 1 from public.sync_entity_operation_receipts
    where workshop_id=p_workshop_id and local_operation_id='quality-review:' || trim(p_operation_id)
      and entity_type='case' and entity_id=p_case_id) then
    return public.nimr_apply_quality_review_v1(p_workshop_id,p_case_id,p_quality_status,p_reason,p_operation_id);
  end if;
  if current_row.entity_id is null or current_row.deleted_at is not null then
    raise exception 'Dossier absent ou supprimé.' using errcode='P0002';
  end if;
  if current_row.entity_version is distinct from p_base_version then
    return jsonb_build_object('status','conflict','accepted',false,'conflict',true,
      'base_version',p_base_version,'server_version',current_row.entity_version,
      'canonical',to_jsonb(current_row),'conflict_canonical',to_jsonb(current_row),
      'conflict_server_version',current_row.entity_version,'server_payload',current_row.payload,
      'detected_at',clock_timestamp());
  end if;
  return public.nimr_apply_quality_review_v1(p_workshop_id,p_case_id,p_quality_status,p_reason,p_operation_id);
end;
$fn$;
revoke all on function nimr_internal.nimr_apply_quality_review_v2(uuid,text,text,text,text,bigint) from public, anon;
grant execute on function nimr_internal.nimr_apply_quality_review_v2(uuid,text,text,text,text,bigint) to authenticated;

create or replace function public.nimr_apply_quality_review_v2(
  p_workshop_id uuid, p_case_id text, p_quality_status text, p_reason text,
  p_operation_id text, p_base_version bigint
) returns jsonb language sql security invoker set search_path = pg_catalog, public
as $fn$ select nimr_internal.nimr_apply_quality_review_v2(p_workshop_id,p_case_id,p_quality_status,p_reason,p_operation_id,p_base_version) $fn$;
revoke all on function public.nimr_apply_quality_review_v2(uuid,text,text,text,text,bigint) from public, anon;
grant execute on function public.nimr_apply_quality_review_v2(uuid,text,text,text,text,bigint) to authenticated;
notify pgrst, 'reload schema';
commit;
