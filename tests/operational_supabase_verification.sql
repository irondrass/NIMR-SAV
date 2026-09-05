-- Run as project SQL administrator. All synthetic data is rolled back.
begin;
do $test$
declare
  w uuid := '00000000-0000-0000-0000-000000000001';
  c text := '__nimr_operational_verification_' || gen_random_uuid()::text;
  actor uuid;
  result jsonb;
  version_value bigint;
begin
  select user_id into actor from public.workshop_members
    where workshop_id=w and deleted_at is null and role='admin_technique' limit 1;
  if actor is null then raise exception 'An active workshop administrator is required for this verification.'; end if;
  if public.nimr_has_workshop_role(gen_random_uuid(),array['admin_technique']) is distinct from false then
    raise exception 'FAIL: unknown workshop must return false, never NULL';
  end if;
  if has_function_privilege('anon','public.nimr_apply_quality_review_v2(uuid,text,text,text,text,bigint)','EXECUTE') then
    raise exception 'FAIL: anonymous RPC access';
  end if;
  if has_table_privilege('authenticated','public.sync_entity_operation_receipts','SELECT') then
    raise exception 'FAIL: receipt table should remain private';
  end if;
  insert into public.sync_entities(workshop_id,entity_type,entity_id,payload,entity_version,last_operation_id)
    values(w,'case',c,'{"clientName":"Synthetic verification","flags":{"received":true,"workCompleted":false}}',0,c);
  begin
    update public.sync_entities set payload=payload || '{"closedAt":"2026-09-06T00:00:00Z"}' where workshop_id=w and entity_id=c;
    raise exception 'FAIL: premature closure accepted';
  exception when check_violation then null; end;
  perform set_config('request.jwt.claim.sub',actor::text,true);
  perform set_config('role','authenticated',true);
  begin
    perform public.nimr_apply_quality_review_v2(w,c,'validated','Verification',c||':quality',0);
    raise exception 'FAIL: unfinished work accepted';
  exception when check_violation then null; end;
  perform set_config('role','postgres',true);
  update public.sync_entities set payload=jsonb_set(payload,'{flags,workCompleted}','true') where workshop_id=w and entity_id=c;
  perform set_config('role','authenticated',true);
  result := public.nimr_apply_quality_review_v2(w,c,'validated','Verification',c||':quality',999);
  if result->>'status' is distinct from 'conflict' then raise exception 'FAIL: stale decision accepted'; end if;
  result := public.nimr_apply_quality_review_v2(w,c,'validated','Verification',c||':quality',0);
  if result->>'accepted' is distinct from 'true' then raise exception 'FAIL: valid quality review rejected'; end if;
  if result #>> '{canonical,payload,clientName}' is distinct from 'Synthetic verification' then raise exception 'FAIL: non-quality data changed'; end if;
  version_value := (result->>'accepted_version')::bigint;
  result := public.nimr_apply_quality_review_v2(w,c,'validated','Verification',c||':quality',0);
  if result->>'idempotent' is distinct from 'true' or (result->>'accepted_version')::bigint <> version_value then raise exception 'FAIL: retry not idempotent'; end if;
  perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
  begin
    perform public.nimr_apply_quality_review_v1(w,c,'rejected','Unauthorized',c||':denied');
    raise exception 'FAIL: non-member accepted by legacy QC RPC';
  exception when insufficient_privilege then null; end;
  begin
    perform public.nimr_apply_quality_review_v2(w,c,'rejected','Unauthorized',c||':denied2',version_value);
    raise exception 'FAIL: non-member accepted by QC v2';
  exception when insufficient_privilege then null; end;
  perform set_config('role','postgres',true);
end;
$test$;
rollback;
select 'PASS: role denial, private receipts, physical handover gate, unfinished work, stale decision, valid review, preserved fields and idempotent retry; synthetic data rolled back' as verification;
