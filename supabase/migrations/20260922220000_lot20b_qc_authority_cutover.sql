-- LOT 20B / Phase 2 CUTOVER
-- Appliquer uniquement APRES déploiement du frontend utilisant nimr_apply_quality_review_v3.

create or replace function public.nimr_guard_quality_domain_authority()
returns trigger
language plpgsql
set search_path to 'pg_catalog','public'
as $function$
declare
  old_payload jsonb := case when tg_op='UPDATE' then coalesce(old.payload,'{}'::jsonb) else '{}'::jsonb end;
  new_payload jsonb := coalesce(new.payload,'{}'::jsonb);
  qc_changed boolean := false;
begin
  if auth.uid() is null or new.entity_type <> 'case' then
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

drop trigger if exists nimr_04_quality_domain_authority on public.sync_entities;
create trigger nimr_04_quality_domain_authority
before insert or update on public.sync_entities
for each row execute function public.nimr_guard_quality_domain_authority();

revoke all on function public.nimr_guard_quality_domain_authority() from public, anon, authenticated;
comment on function public.nimr_guard_quality_domain_authority() is
  'LOT20B cutover: QC domain mutations must pass through nimr_apply_quality_review_v3.';
