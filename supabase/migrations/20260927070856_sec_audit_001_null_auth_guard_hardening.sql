-- SEC-AUDIT-001 F1: fail closed for NULL-auth protected domain mutations.
-- Mutation-sensitive hardening only; unrelated and non-case writes remain unchanged.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '60s';

create or replace function public.nimr_guard_quality_domain_authority()
returns trigger
language plpgsql
set search_path to 'pg_catalog','public'
as $function$
declare
  old_payload jsonb := case when tg_op='UPDATE' then coalesce(old.payload,'{}'::jsonb) else '{}'::jsonb end;
  new_payload jsonb := coalesce(new.payload,'{}'::jsonb);
  qc_changed boolean := false;
  insert_quality_status text := lower(trim(coalesce(new_payload #>> '{receptionWorkflow,qualityStatus}','not_started')));
  insert_history jsonb := case
    when jsonb_typeof(new_payload #> '{receptionWorkflow,qualityReviewHistory}')='array'
      then new_payload #> '{receptionWorkflow,qualityReviewHistory}'
    else '[]'::jsonb
  end;
begin
  if new.entity_type <> 'case' then
    return new;
  end if;

  if tg_op='INSERT' then
    -- Generic sync UPSERT proposes INSERT before PostgreSQL resolves its conflict.
    -- Existing live cases must reach the UPDATE trigger, which compares every QC field.
    -- A genuinely new or deleted case must still begin without a QC decision.
    if exists (
      select 1 from public.sync_entities existing
      where existing.workshop_id = new.workshop_id
        and existing.entity_type = 'case'
        and existing.entity_id = new.entity_id
        and existing.deleted_at is null
    ) then
      return new;
    end if;
    if coalesce(new_payload #>> '{flags,qualityApproved}','false')='true'
       or insert_quality_status not in ('','not_started')
       or jsonb_array_length(insert_history) > 0
       or nullif(trim(coalesce(new_payload #>> '{receptionWorkflow,qualityReviewedAt}','')),'') is not null
       or nullif(trim(coalesce(new_payload #>> '{receptionWorkflow,readyForDeliveryAt}','')),'') is not null
       or nullif(trim(coalesce(new_payload #>> '{receptionWorkflow,qualityRevalidatedAt}','')),'') is not null
       or nullif(trim(coalesce(new_payload #>> '{receptionWorkflow,qualityReturnRequestedAt}','')),'') is not null
       or nullif(trim(coalesce(new_payload #>> '{receptionWorkflow,qualityReturnReason}','')),'') is not null
       or nullif(trim(coalesce(new_payload #>> '{receptionWorkflow,qualityReworkRequestedAt}','')),'') is not null
       or nullif(trim(coalesce(new_payload #>> '{receptionWorkflow,qualityReworkBookingId}','')),'') is not null
       or nullif(trim(coalesce(new_payload #>> '{receptionWorkflow,qualityReworkStepKey}','')),'') is not null
       or coalesce(new_payload #>> '{receptionWorkflow,qualityReworkCycle}','') not in ('','0')
       or nullif(trim(coalesce(new_payload #>> '{receptionWorkflow,qualityReworkCompletedAt}','')),'') is not null
    then
      raise exception 'new case cannot contain completed quality decision state'
        using errcode='42501';
    end if;

    return new;
  end if;

  qc_changed :=
       new_payload->'qualityChecklist' is distinct from old_payload->'qualityChecklist'
    or new_payload #> '{flags,qualityApproved}' is distinct from old_payload #> '{flags,qualityApproved}'
    or new_payload #> '{receptionWorkflow,qualityStatus}' is distinct from old_payload #> '{receptionWorkflow,qualityStatus}'
    or new_payload #> '{receptionWorkflow,qualityReviewedAt}' is distinct from old_payload #> '{receptionWorkflow,qualityReviewedAt}'
    or new_payload #> '{receptionWorkflow,qualityReviewHistory}' is distinct from old_payload #> '{receptionWorkflow,qualityReviewHistory}'
    or new_payload #> '{receptionWorkflow,readyForDeliveryAt}' is distinct from old_payload #> '{receptionWorkflow,readyForDeliveryAt}'
    or new_payload #> '{receptionWorkflow,qualityRevalidatedAt}' is distinct from old_payload #> '{receptionWorkflow,qualityRevalidatedAt}'
    or new_payload #> '{receptionWorkflow,qualityReturnRequestedAt}' is distinct from old_payload #> '{receptionWorkflow,qualityReturnRequestedAt}'
    or new_payload #> '{receptionWorkflow,qualityReturnReason}' is distinct from old_payload #> '{receptionWorkflow,qualityReturnReason}'
    or new_payload #> '{receptionWorkflow,qualityReworkRequestedAt}' is distinct from old_payload #> '{receptionWorkflow,qualityReworkRequestedAt}'
    or new_payload #> '{receptionWorkflow,qualityReworkBookingId}' is distinct from old_payload #> '{receptionWorkflow,qualityReworkBookingId}'
    or new_payload #> '{receptionWorkflow,qualityReworkStepKey}' is distinct from old_payload #> '{receptionWorkflow,qualityReworkStepKey}'
    or new_payload #> '{receptionWorkflow,qualityReworkCycle}' is distinct from old_payload #> '{receptionWorkflow,qualityReworkCycle}'
    or new_payload #> '{receptionWorkflow,qualityReworkCompletedAt}' is distinct from old_payload #> '{receptionWorkflow,qualityReworkCompletedAt}';

  if qc_changed and (
    auth.uid() is null
    or coalesce(current_setting('nimr.quality_review_v3',true),'') <> 'on'
  ) then
    raise exception 'quality domain changes must use nimr_apply_quality_review_v3' using errcode='42501';
  end if;

  return new;
end;
$function$;

create or replace function public.nimr_guard_client_commitment()
returns trigger language plpgsql security invoker set search_path=pg_catalog,public
as $guard$
declare previous jsonb := '{}'::jsonb; changed boolean; deciding boolean;
begin
  if new.entity_type <> 'case' then return new; end if;
  if tg_op='UPDATE' then previous:=coalesce(old.payload,'{}'::jsonb); end if;
  if new.deleted_at is not null then
    if auth.uid() is null or not public.nimr_has_workshop_role(new.workshop_id,array['admin_technique','directeur','chef_atelier','reception']) then
      raise exception 'case deletion access denied' using errcode='42501';
    end if;
    return new;
  end if;
  changed := exists(select 1 from unnest(array['promisedAt','nextContactAt','lastContactAt','note']) k
      where coalesce(new.payload #>> array['clientCommitment',k],'') <> coalesce(previous #>> array['clientCommitment',k],''))
    or exists(select 1 from unnest(array['ownerId','dueAt','note']) k
      where coalesce(new.payload #>> array['exceptionFollowup',k],'') <> coalesce(previous #>> array['exceptionFollowup',k],''))
    or coalesce(new.payload #>> '{flags,received}','false') <> coalesce(previous #>> '{flags,received}','false');
  if changed and (auth.uid() is null or not public.nimr_has_workshop_role(new.workshop_id,array['admin_technique','directeur','chef_atelier','reception'])) then
    raise exception 'client commitment or reception access denied' using errcode='42501';
  end if;
  deciding := (new.payload #>> '{flags,delivered}'='true' and previous #>> '{flags,delivered}' is distinct from 'true')
    or (new.payload #>> '{flags,qualityApproved}'='true' and previous #>> '{flags,qualityApproved}' is distinct from 'true');
  if deciding and exists(select 1 from public.sync_entities b where b.workshop_id=new.workshop_id
      and b.entity_type='booking' and b.deleted_at is null and b.payload->>'caseId'=new.entity_id
      and coalesce(b.payload->>'type','work') <> 'leave'
      and coalesce(b.payload->>'status','planned') not in ('completed','done')
      and coalesce(b.payload->>'temporary','false') <> 'true') then
    raise exception 'Des opérations partagées restent à terminer avant le contrôle ou la remise.' using errcode='23514';
  end if;
  return new;
end;
$guard$;

create or replace function public.nimr_guard_operational_finalization()
returns trigger language plpgsql security invoker
set search_path = pg_catalog, public
as $fn$
declare
  previous jsonb := '{}'::jsonb;
  quality_changed boolean;
  quality_validated boolean;
  delivery_started boolean;
  finalization_started boolean;
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
  finalization_started :=
       (nullif(new.payload->>'archivedAt', '') is not null
        and nullif(previous->>'archivedAt', '') is null)
    or (nullif(new.payload->>'closedAt', '') is not null
        and nullif(previous->>'closedAt', '') is null)
    or (new.payload #>> '{flags,invoiced}' = 'true'
        and previous #>> '{flags,invoiced}' is distinct from 'true');

  -- Ignore default not_started/false normalization. Actual decisions require a QC role.
  if quality_changed and (new.payload #>> '{flags,qualityApproved}' = 'true'
    or coalesce(new.payload #>> '{receptionWorkflow,qualityStatus}', 'not_started') <> 'not_started'
    or previous #>> '{flags,qualityApproved}' = 'true') then
    if auth.uid() is null or not public.nimr_has_workshop_role(new.workshop_id,
      array['admin_technique','directeur','chef_atelier','controle_qualite']) then
      raise exception 'quality review access denied' using errcode = '42501';
    end if;
    if previous #>> '{flags,delivered}' = 'true' or nullif(previous->>'archivedAt', '') is not null then
      raise exception 'Le dossier livré ou archivé ne peut plus recevoir une décision qualité.' using errcode = '23514';
    end if;
  end if;
  if delivery_started and (auth.uid() is null or not public.nimr_has_workshop_role(new.workshop_id,
    array['admin_technique','directeur','chef_atelier','reception'])) then
    raise exception 'delivery access denied' using errcode = '42501';
  end if;
  if quality_validated or delivery_started then
    issue := public.nimr_finalization_issue(new.payload, coalesce(delivery_started, false));
    if issue is not null then raise exception '%', issue using errcode = '23514'; end if;
  end if;
  if finalization_started and auth.uid() is null then
    raise exception 'finalization access denied'
      using errcode='42501';
  end if;
  if finalization_started
    and new.payload #>> '{flags,delivered}' is distinct from 'true' then
    raise exception 'Confirmer la remise physique avant la clôture ou l''archivage.' using errcode = '23514';
  end if;
  return new;
end;
$fn$;

comment on function public.nimr_guard_quality_domain_authority() is
  'SEC-AUDIT-001: NULL auth cannot bypass QC authority; unrelated writes remain unaffected.';
comment on function public.nimr_guard_client_commitment() is
  'SEC-AUDIT-001: NULL auth cannot mutate client commitment, reception, or case deletion authority.';
comment on function public.nimr_guard_operational_finalization() is
  'SEC-AUDIT-001: NULL auth cannot bypass quality, delivery, or finalization authority.';

commit;
