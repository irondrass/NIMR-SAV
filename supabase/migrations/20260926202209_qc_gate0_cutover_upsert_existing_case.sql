-- QC-PRO-001 Gate 0: preserve cutover authority for existing-case UPSERTs.
-- LOCAL ONLY. This second migration requires separate staging authorization.
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
  if auth.uid() is null or new.entity_type <> 'case' then
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

  if qc_changed and coalesce(current_setting('nimr.quality_review_v3',true),'') <> 'on' then
    raise exception 'quality domain changes must use nimr_apply_quality_review_v3' using errcode='42501';
  end if;

  return new;
end;
$function$;
revoke all on function public.nimr_guard_quality_domain_authority() from public, anon, authenticated;
comment on function public.nimr_guard_quality_domain_authority() is
  'QC-PRO Gate 0: new cases cannot arrive prevalidated; existing-case UPSERT proceeds to UPDATE cutover checks.';
commit;
