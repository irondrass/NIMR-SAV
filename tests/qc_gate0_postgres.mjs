// Disposable PostgreSQL integration test. Local claim settings are NOT real JWT evidence.
// The real-JWT tests live in qc_gate0_staging.mjs. No network ports are published here.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
if (!process.argv.includes('--local-postgres')) throw new Error('Require --local-postgres');
const container = `nimr-qc-gate0-${randomUUID().slice(0, 8)}`;
const read = n => fs.readFileSync(`supabase/migrations/${n}`, 'utf8');
function definition(source, name) {
  return source.match(new RegExp(`create or replace function ${name.replaceAll('.', '\\.')}\\([\\s\\S]*?as\\s+(\\$[a-z_]*\\$)[\\s\\S]*?\\1\\s*;`, 'i'))[0];
}
function docker(args, input) { return execFileSync('docker', args, { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 60000 }); }
function sql(s) { return docker(['exec', '-i', container, 'psql', '-X', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q'], s); }
const hardening = read('20260923213000_qc_pro_booking_authority_hardening.sql');
const finalization = read('20260905230951_operational_finalization_quality_sync.sql');
const guard = read('20260906001634_audit_completion_private_api.sql');
const migration = read('20260926195055_qc_gate0_atomic_booking_completion.sql');
const cutoverRepair = read('20260926202209_qc_gate0_cutover_upsert_existing_case.sql');
const secAuditName = fs.readdirSync('supabase/migrations').find(name => name.includes('_sec_audit_001_null_auth_guard_hardening.sql'));
if (!secAuditName) throw new Error('SEC-AUDIT-001 migration missing');
const secAuditMigration = read(secAuditName);
const secAudit001BName = fs.readdirSync('supabase/migrations')
  .find(name => name.includes('_sec_audit_001b_role_matrix_prod_preflight.sql'));
if (!secAudit001BName) throw new Error('SEC-AUDIT-001B migration missing');
const secAudit001BMigration = read(secAudit001BName);
let created = false;
try {
  docker(['run', '-d', '--name', container, '--network', 'none', '--tmpfs', '/var/lib/postgresql/data', '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:15-alpine']); created = true;
  let ready = false;
  for (let i = 0; i < 30; i++) {
    try { docker(['exec', container, 'pg_isready', '-U', 'postgres']); ready = true; break; } catch { await new Promise(r => setTimeout(r, 500)); }
  }
  if (!ready) throw new Error('Local PostgreSQL unavailable');
  sql(`
create role anon; create role authenticated; create role service_role;
create schema auth; create schema nimr_internal;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
create sequence public.nimr_sync_entity_version_seq start 100;
create table public.sync_entities (workshop_id uuid, entity_type text, entity_id text, payload jsonb, entity_version bigint, last_operation_id text, deleted_at timestamptz, updated_at timestamptz, primary key(workshop_id,entity_type,entity_id));
create table public.sync_entity_operation_receipts (workshop_id uuid, local_operation_id text, entity_type text, entity_id text, accepted_version bigint, primary key(workshop_id,local_operation_id));
create table public.planning_resources (id uuid primary key, workshop_id uuid, local_id text, type text, active boolean, deleted_at timestamptz);
create table public.workshop_members (workshop_id uuid, user_id uuid, role text, resource_id uuid, deleted_at timestamptz);
create function public.nimr_current_workshop_role(w uuid) returns text language sql stable as $$ select role from public.workshop_members where workshop_id=w and user_id=auth.uid() and deleted_at is null $$;
create function public.nimr_current_resource_id(w uuid) returns uuid language sql stable as $$ select resource_id from public.workshop_members where workshop_id=w and user_id=auth.uid() and deleted_at is null $$;
${definition(finalization, 'public.nimr_has_workshop_role')}
${definition(finalization, 'public.nimr_finalization_issue')}
${definition(finalization, 'public.nimr_guard_operational_finalization')}
${definition(guard, 'public.nimr_guard_client_commitment')}
create trigger nimr_client_commitment_guard after insert or update on sync_entities for each row execute function nimr_guard_client_commitment();
create trigger nimr_operational_finalization_guard after insert or update on sync_entities for each row execute function nimr_guard_operational_finalization();
create function public.nimr_apply_quality_review_v3(uuid,text,text,text,jsonb,text,text,bigint) returns jsonb language sql as $$ select '{}'::jsonb $$;
create function nimr_internal.nimr_apply_quality_review_v3(uuid,text,text,text,jsonb,text,text,bigint) returns jsonb language sql as $$ select '{}'::jsonb $$;
${hardening}
`);
  const setup = `
insert into planning_resources values ('00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000001','qc','controle',true,null);
insert into workshop_members values
('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','directeur',null,null),
('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000004','controle_qualite','00000000-0000-0000-0000-000000000003',null),
('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000005','admin_technique',null,null),
('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000006','chef_atelier',null,null),
('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000007','reception',null,null);
create function public.test_assert(ok boolean, label text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'ASSERT: %',label; end if; end $$;
create function public.test_case(id text) returns void language plpgsql as $$ begin
  insert into sync_entities values ('00000000-0000-0000-0000-000000000001','case',id,'{"flags":{"received":true,"workCompleted":true,"qualityApproved":false,"delivered":false},"receptionWorkflow":{"qualityStatus":"not_started"},"durations":{"mechanical":1}}',1,'seed',null,now());
end $$;
create function public.test_booking(id text, cid text) returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
  insert into sync_entities values ('00000000-0000-0000-0000-000000000001','booking',id,jsonb_build_object('id',id,'caseId',cid,'key','quality','primaryResourceId','qc','qualityAssignmentMode','quality_controller','status','planned'),nextval('nimr_sync_entity_version_seq'),'seed-booking',null,now());
end $$;
create function public.test_review(cid text, verdict text, op text) returns jsonb language plpgsql as $$ declare checks jsonb; begin
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000004',true);
  select jsonb_object_agg(k,'ok') into checks from unnest(array['documentary.work_order_complete','documentary.authorizations_present','documentary.operations_recorded','documentary.technician_notes_complete','general.no_warning_lights','general.no_leak','general.reassembly_secure','general.repaired_functions_verified','general.no_tools_left','mechanical.repair_function','mechanical.fasteners','mechanical.no_leak','mechanical.noise_vibration','mechanical.temperature_pressure','delivery.clean_vehicle','delivery.no_new_damage','delivery.protections_removed','delivery.client_items_present','delivery.documents_ready']) k;
  if verdict='rejected' then checks:=checks || '{"mechanical.noise_vibration":"nok"}'::jsonb; end if;
  return public.nimr_apply_quality_review_v3('00000000-0000-0000-0000-000000000001',cid,verdict,'test rework',op,checks,'mechanical',null);
end $$;
`;
  sql(setup);
  sql(`begin; select test_case('baseline'); select test_booking('baseline-qc','baseline');
do $$ begin
 begin perform test_review('baseline','validated','baseline-op'); raise exception 'Expected booking deadlock not reproduced';
 exception when check_violation then if sqlerrm <> 'Des opérations partagées restent à terminer avant le contrôle ou la remise.' then raise; end if; end;
end $$; rollback;`);
  console.log('PASS baseline real PostgreSQL reproduces 23514');
  sql(migration);
  sql(cutoverRepair);
  sql(`begin;
select test_case('loop'); select test_booking('qc1','loop');
select test_review('loop','rejected','nok1');
select test_assert((select payload->>'status'='completed' from sync_entities where entity_id='qc1'),'NOK closes QC1');
-- The normal sync RPC uses INSERT ... ON CONFLICT UPDATE, including after NOK.
-- This must run the UPDATE authority check, not reject the proposed INSERT first.
insert into sync_entities(workshop_id,entity_type,entity_id,payload,entity_version,last_operation_id,deleted_at,updated_at)
select workshop_id,entity_type,entity_id,jsonb_set(payload,'{flags,workCompleted}','true'),entity_version+1,'sync-after-nok',null,now()
from sync_entities where entity_id='loop'
on conflict (workshop_id,entity_type,entity_id) do update
set payload=excluded.payload,entity_version=excluded.entity_version,last_operation_id=excluded.last_operation_id,updated_at=excluded.updated_at;
select test_assert((select payload #>> '{flags,workCompleted}'='true' from sync_entities where entity_id='loop'),'normal sync after NOK');
select test_assert((select payload #>> '{serverAuthority,authorizedBy}'='00000000-0000-0000-0000-000000000002' from sync_entities where entity_id='qc1'),'authority preserved');
select test_assert((select count(*)=1 from sync_entities where payload->>'isRework'='true'),'one rework created');
select test_review('loop','rejected','nok1');
select test_assert((select count(*)=1 from sync_entities where payload->>'isRework'='true'),'idempotent NOK');
update sync_entities set payload=payload||'{"status":"completed"}' where payload->>'isRework'='true';
update sync_entities set payload=jsonb_set(payload,'{flags,workCompleted}','true') where entity_id='loop';
select test_booking('qc2','loop');
-- Ordinary QC caller still cannot close a booking, forge history or reassign authority.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000004',true);
do $$ begin
 begin update sync_entities set payload=payload||'{"status":"completed"}' where entity_id='qc2'; raise exception 'Expected assignment denial'; exception when insufficient_privilege then null; end;
end $$;
-- Insert another open productive task: validation must roll back its own QC closure.
insert into sync_entities values ('00000000-0000-0000-0000-000000000001','booking','other','{"caseId":"loop","key":"mechanical","status":"planned"}',900,'other',null,now());
do $$ begin
 begin perform test_review('loop','validated','ok2'); raise exception 'Expected unfinished-work denial'; exception when check_violation then null; end;
end $$;
select test_assert((select payload->>'status'='planned' from sync_entities where entity_id='qc2'),'QC closure rolled back');
select test_assert(not exists(select 1 from sync_entity_operation_receipts where local_operation_id='quality-review-v3:ok2:quality-booking'),'booking receipt rolled back');
select test_assert((select payload #>> '{flags,qualityApproved}'='false' from sync_entities where entity_id='loop'),'case decision rolled back');
update sync_entities set payload=payload||'{"status":"completed"}' where entity_id='other';
select test_review('loop','validated','ok2');
select test_assert((select payload->>'status'='completed' from sync_entities where entity_id='qc2'),'QC2 closes');
select test_assert((select payload #>> '{flags,qualityApproved}'='true' from sync_entities where entity_id='loop'),'QC2 validates');
select test_review('loop','validated','ok2');
select test_assert((select count(*)=1 from sync_entity_operation_receipts where local_operation_id='quality-review-v3:ok2'),'idempotent OK');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
update sync_entities set payload=jsonb_set(payload,'{flags,delivered}','true') where entity_id='loop';
select test_assert((select payload #>> '{flags,delivered}'='true' from sync_entities where entity_id='loop'),'delivery after QC');
rollback;
begin;
select test_case('bypass');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
do $$ begin
 begin insert into sync_entities values ('00000000-0000-0000-0000-000000000001','case','prevalidated','{"flags":{"qualityApproved":true},"receptionWorkflow":{"qualityStatus":"validated"}}',2,'forged-create',null,now()); raise exception 'Expected prevalidated case denial'; exception when insufficient_privilege then null; end;
end $$;
do $$ begin
 begin update sync_entities set payload=jsonb_set(payload,'{flags,qualityApproved}','true') where entity_id='bypass'; raise exception 'Expected cutover denial'; exception when insufficient_privilege then null; end;
end $$;
do $$ begin
 begin insert into sync_entities(workshop_id,entity_type,entity_id,payload,entity_version,last_operation_id,updated_at)
   select workshop_id,entity_type,entity_id,jsonb_set(payload,'{flags,qualityApproved}','true'),3,'forged-upsert',now()
   from sync_entities where entity_id='bypass'
   on conflict (workshop_id,entity_type,entity_id) do update set payload=excluded.payload;
   raise exception 'Expected forged UPSERT denial'; exception when insufficient_privilege then null; end;
end $$;
rollback;`);
  console.log('PASS migrated PostgreSQL: NOK, rework, new QC, atomic rollback, receipts, idempotency, authority, cutover, delivery');
  sql(secAuditMigration);
  sql(`begin;
select set_config('request.jwt.claim.sub','',true);
insert into sync_entities values (
  '00000000-0000-0000-0000-000000000001','case','sec-neutral',
  '{"flags":{"received":false,"workCompleted":false,"qualityApproved":false,"delivered":false},"receptionWorkflow":{"qualityStatus":"not_started"}}',
  1001,'sec-neutral',null,now()
);
insert into sync_entities values (
  '00000000-0000-0000-0000-000000000001','booking','sec-booking',
  '{"caseId":"sec-neutral","key":"mechanical","status":"planned"}',
  1002,'sec-booking',null,now()
);
do $$ begin
  begin update sync_entities set payload=jsonb_set(payload,'{flags,qualityApproved}','true') where entity_id='sec-neutral'; raise exception 'Expected NULL QC denial';
  exception when insufficient_privilege then null; end;
end $$;
update sync_entities set payload=payload||'{"customerName":"Unrelated update"}' where entity_id='sec-neutral';
select test_assert((select payload->>'customerName'='Unrelated update' from sync_entities where entity_id='sec-neutral'),'NULL unrelated case write allowed');
update sync_entities set payload=payload||'{"status":"completed"}' where entity_id='sec-booking';
select test_assert((select payload->>'status'='completed' from sync_entities where entity_id='sec-booking'),'NULL non-case write allowed');
do $$ begin
  begin update sync_entities set payload=payload||'{"clientCommitment":{"note":"forged"}}' where entity_id='sec-neutral'; raise exception 'Expected NULL client commitment denial';
  exception when insufficient_privilege then null; end;
end $$;
do $$ begin
  begin update sync_entities set deleted_at=now() where entity_id='sec-neutral'; raise exception 'Expected NULL deletion denial';
  exception when insufficient_privilege then null; end;
end $$;
do $$ begin
  begin update sync_entities set payload=jsonb_set(payload,'{flags,delivered}','true') where entity_id='sec-neutral'; raise exception 'Expected NULL delivery denial';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000099',true);
do $$ begin
  begin update sync_entities set payload=jsonb_set(payload,'{flags,qualityApproved}','true') where entity_id='sec-neutral'; raise exception 'Expected unauthorized QC denial';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
insert into sync_entities values (
  '00000000-0000-0000-0000-000000000001','case','sec-authorized',
  '{"flags":{"received":true,"workCompleted":true,"qualityApproved":false,"delivered":false},"receptionWorkflow":{"qualityStatus":"not_started"}}',
  1003,'sec-authorized',null,now()
);
select test_booking('sec-authorized-qc','sec-authorized');
select test_review('sec-authorized','validated','sec-authorized-op');
select test_assert((select payload #>> '{flags,qualityApproved}'='true' from sync_entities where entity_id='sec-authorized'),'authorized QC RPC unchanged');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
update sync_entities set payload=jsonb_set(payload,'{flags,delivered}','true') where entity_id='sec-authorized';
select test_assert((select payload #>> '{flags,delivered}'='true' from sync_entities where entity_id='sec-authorized'),'authenticated delivery unchanged');
select set_config('request.jwt.claim.sub','',true);
do $$ begin
  begin update sync_entities set payload=payload||'{"closedAt":"2026-09-27T01:00:00Z"}' where entity_id='sec-authorized'; raise exception 'Expected NULL closure denial';
  exception when insufficient_privilege then null; end;
end $$;
do $$ begin
  begin update sync_entities set payload=payload||'{"archivedAt":"2026-09-27T01:00:00Z"}' where entity_id='sec-authorized'; raise exception 'Expected NULL archive denial';
  exception when insufficient_privilege then null; end;
end $$;
do $$ begin
  begin update sync_entities set payload=jsonb_set(payload,'{flags,invoiced}','true') where entity_id='sec-authorized'; raise exception 'Expected NULL invoicing denial';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
update sync_entities set payload=payload||'{"closedAt":"2026-09-27T01:00:00Z"}' where entity_id='sec-authorized';
select test_assert((select payload->>'closedAt'='2026-09-27T01:00:00Z' from sync_entities where entity_id='sec-authorized'),'authenticated finalization unchanged');
do $$ begin
  begin update sync_entities set payload=jsonb_set(payload,'{flags,delivered}','true') where entity_id='sec-neutral'; raise exception 'Expected finalization invariant denial';
  exception when check_violation then null; end;
end $$;
do $$ begin
  begin update sync_entities set payload=payload||'{"closedAt":"2026-09-27T00:00:00Z"}' where entity_id='sec-neutral'; raise exception 'Expected closure invariant denial';
  exception when check_violation then null; end;
end $$;
rollback;`);
  console.log('PASS SEC-AUDIT-001 PostgreSQL: NULL protected denials, unrelated writes, role contracts, RPC and finalization invariants');

  sql(`drop trigger nimr_04_quality_domain_authority on sync_entities;`);

  let preflightBlocked = false;

  try {
    sql(secAudit001BMigration);
  } catch (error) {
    const message = `${error.stderr || ''}\n${error.message || ''}`;

    if (!/SEC-AUDIT-001B prerequisite missing: active QC authority trigger/iu.test(message)) {
      throw error;
    }

    preflightBlocked = true;
  }

  if (!preflightBlocked) {
    throw new Error(
      'SEC-AUDIT-001B must block deployment when QC trigger is absent'
    );
  }

  console.log('PASS SEC-AUDIT-001B production prerequisite fail-closed');

  sql(`
create trigger nimr_04_quality_domain_authority
before insert or update on sync_entities
for each row execute function nimr_guard_quality_domain_authority();
`);

  sql(secAudit001BMigration);

  sql(`begin;

select set_config(
  'request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000000002',
  true
);

select test_case('sec-delete-null');
select test_case('sec-delete-directeur');
select test_case('sec-delete-chef');
select test_case('sec-delete-reception');
select test_case('sec-delete-admin');
select test_case('sec-client-reception');

select set_config('request.jwt.claim.sub','',true);

do $$ begin
  begin
    update sync_entities
       set deleted_at=now()
     where entity_id='sec-delete-null';

    raise exception 'Expected NULL deletion denial';
  exception when insufficient_privilege then null;
  end;
end $$;

select set_config(
  'request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000000002',
  true
);

do $$ begin
  begin
    update sync_entities
       set deleted_at=now()
     where entity_id='sec-delete-directeur';

    raise exception 'Expected directeur deletion denial';
  exception when insufficient_privilege then null;
  end;
end $$;

select set_config(
  'request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000000006',
  true
);

do $$ begin
  begin
    update sync_entities
       set deleted_at=now()
     where entity_id='sec-delete-chef';

    raise exception 'Expected chef_atelier deletion denial';
  exception when insufficient_privilege then null;
  end;
end $$;

select set_config(
  'request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000000007',
  true
);

do $$ begin
  begin
    update sync_entities
       set deleted_at=now()
     where entity_id='sec-delete-reception';

    raise exception 'Expected reception deletion denial';
  exception when insufficient_privilege then null;
  end;
end $$;

update sync_entities
   set payload = payload || '{"clientCommitment":{"note":"allowed"}}'
 where entity_id='sec-client-reception';

select test_assert(
  (
    select payload #>> '{clientCommitment,note}'='allowed'
    from sync_entities
    where entity_id='sec-client-reception'
  ),
  'reception client commitment remains allowed'
);

select set_config(
  'request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000000005',
  true
);

update sync_entities
   set deleted_at=now()
 where entity_id='sec-delete-admin';

select test_assert(
  (
    select deleted_at is not null
    from sync_entities
    where entity_id='sec-delete-admin'
  ),
  'admin_technique deletion allowed'
);

rollback;`);

  console.log('PASS SEC-AUDIT-001B PostgreSQL: admin-only deletion + unchanged reception commitment');
} catch (e) {
  console.error(e.stderr?.toString() || e.message); process.exitCode = 1;
} finally {
  if (created) { docker(['rm', '-f', container]); console.log('PASS disposable local database removed'); }
}
