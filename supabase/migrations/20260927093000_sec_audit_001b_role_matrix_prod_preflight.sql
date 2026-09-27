-- SEC-AUDIT-001B
-- Restore canonical case-deletion authority:
-- admin_technique only, while NULL auth remains fail-closed.
--
-- This migration deliberately DOES NOT install a missing QC cutover.
-- It fails closed if SEC-AUDIT-001/QC prerequisites are not active.

begin;

set local lock_timeout = '3s';
set local statement_timeout = '60s';

do $preflight$
declare
  qc_guard_oid oid :=
    to_regprocedure('public.nimr_guard_quality_domain_authority()');

  finalization_guard_oid oid :=
    to_regprocedure('public.nimr_guard_operational_finalization()');

  client_guard_oid oid :=
    to_regprocedure('public.nimr_guard_client_commitment()');

  qc_definition text;
  finalization_definition text;
begin
  if qc_guard_oid is null then
    raise exception
      'SEC-AUDIT-001B prerequisite missing: QC authority guard'
      using errcode='55000';
  end if;

  if finalization_guard_oid is null then
    raise exception
      'SEC-AUDIT-001B prerequisite missing: operational finalization guard'
      using errcode='55000';
  end if;

  if client_guard_oid is null then
    raise exception
      'SEC-AUDIT-001B prerequisite missing: client commitment guard'
      using errcode='55000';
  end if;

  if not exists (
    select 1
    from pg_trigger t
    where t.tgrelid = 'public.sync_entities'::regclass
      and t.tgfoid = qc_guard_oid
      and t.tgname = 'nimr_04_quality_domain_authority'
      and not t.tgisinternal
      and t.tgenabled <> 'D'
  ) then
    raise exception
      'SEC-AUDIT-001B prerequisite missing: active QC authority trigger'
      using errcode='55000';
  end if;

  if not exists (
    select 1
    from pg_trigger t
    where t.tgrelid = 'public.sync_entities'::regclass
      and t.tgfoid = finalization_guard_oid
      and t.tgname = 'nimr_operational_finalization_guard'
      and not t.tgisinternal
      and t.tgenabled <> 'D'
  ) then
    raise exception
      'SEC-AUDIT-001B prerequisite missing: active finalization trigger'
      using errcode='55000';
  end if;

  if not exists (
    select 1
    from pg_trigger t
    where t.tgrelid = 'public.sync_entities'::regclass
      and t.tgfoid = client_guard_oid
      and t.tgname = 'nimr_client_commitment_guard'
      and not t.tgisinternal
      and t.tgenabled <> 'D'
  ) then
    raise exception
      'SEC-AUDIT-001B prerequisite missing: active client commitment trigger'
      using errcode='55000';
  end if;

  qc_definition := lower(pg_get_functiondef(qc_guard_oid));

  if position('auth.uid() is null' in qc_definition) = 0
     or position('nimr.quality_review_v3' in qc_definition) = 0 then
    raise exception
      'SEC-AUDIT-001B prerequisite missing: SEC-AUDIT-001 QC hardening'
      using errcode='55000';
  end if;

  finalization_definition :=
    lower(pg_get_functiondef(finalization_guard_oid));

  if position(
       'finalization_started'
       in finalization_definition
     ) = 0
     or position(
       'finalization access denied'
       in finalization_definition
     ) = 0
     or position(
       'auth.uid() is null'
       in finalization_definition
     ) = 0 then
    raise exception
      'SEC-AUDIT-001B prerequisite missing: SEC-AUDIT-001 finalization hardening'
      using errcode='55000';
  end if;
end;
$preflight$;

create or replace function public.nimr_guard_client_commitment()
returns trigger
language plpgsql
security invoker
set search_path=pg_catalog,public
as $guard$
declare
  previous jsonb := '{}'::jsonb;
  changed boolean;
  deciding boolean;
begin
  if new.entity_type <> 'case' then
    return new;
  end if;

  if tg_op='UPDATE' then
    previous := coalesce(old.payload,'{}'::jsonb);
  end if;

  if new.deleted_at is not null then
    if auth.uid() is null
       or not public.nimr_has_workshop_role(
         new.workshop_id,
         array['admin_technique']
       ) then
      raise exception 'case deletion access denied'
        using errcode='42501';
    end if;

    return new;
  end if;

  changed :=
    exists(
      select 1
      from unnest(
        array['promisedAt','nextContactAt','lastContactAt','note']
      ) k
      where coalesce(
        new.payload #>> array['clientCommitment',k],
        ''
      ) <> coalesce(
        previous #>> array['clientCommitment',k],
        ''
      )
    )
    or exists(
      select 1
      from unnest(array['ownerId','dueAt','note']) k
      where coalesce(
        new.payload #>> array['exceptionFollowup',k],
        ''
      ) <> coalesce(
        previous #>> array['exceptionFollowup',k],
        ''
      )
    )
    or coalesce(
      new.payload #>> '{flags,received}',
      'false'
    ) <> coalesce(
      previous #>> '{flags,received}',
      'false'
    );

  if changed and (
    auth.uid() is null
    or not public.nimr_has_workshop_role(
      new.workshop_id,
      array['admin_technique','directeur','chef_atelier','reception']
    )
  ) then
    raise exception
      'client commitment or reception access denied'
      using errcode='42501';
  end if;

  deciding :=
    (
      new.payload #>> '{flags,delivered}'='true'
      and previous #>> '{flags,delivered}' is distinct from 'true'
    )
    or (
      new.payload #>> '{flags,qualityApproved}'='true'
      and previous #>> '{flags,qualityApproved}' is distinct from 'true'
    );

  if deciding and exists (
    select 1
    from public.sync_entities b
    where b.workshop_id = new.workshop_id
      and b.entity_type = 'booking'
      and b.deleted_at is null
      and b.payload->>'caseId' = new.entity_id
      and coalesce(b.payload->>'type','work') <> 'leave'
      and coalesce(
        b.payload->>'status',
        'planned'
      ) not in ('completed','done')
      and coalesce(
        b.payload->>'temporary',
        'false'
      ) <> 'true'
  ) then
    raise exception
      'Des opérations partagées restent à terminer avant le contrôle ou la remise.'
      using errcode='23514';
  end if;

  return new;
end;
$guard$;

comment on function public.nimr_guard_client_commitment() is
  'SEC-AUDIT-001B: NULL auth fails closed; case deletion remains admin_technique-only; client commitment roles unchanged.';

commit;