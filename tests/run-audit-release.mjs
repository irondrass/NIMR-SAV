// Current audit acceptance suite. Historical release snapshots remain separate.
// Performance-sensitive benchmarks (workshop_001b_dependency_dag) execute in an
// isolated child process so unrelated suite activity cannot interfere with the
// strict wall-clock benchmark threshold measured in milliseconds.
import { spawnSync } from 'node:child_process';

// --- Invocation A: Functional release suite (excludes DAG benchmark) ---
const functionalFiles = [
  'operational_coherence',
  'audit_completion', 'audit_completion_browser', 'smoke', 'technician_flow',
  'workshop_operational_simplification', 'work_authorization_001', 'canonical_task_model_p1003',
  'canonical_roles_statuses_v236', 'quality_controller_role_v235',
  'close_invoice_hard_lock_v2302', 'reception_delivery_sheet_v231c',
  'role_based_workspaces_qc_view_v2325', 'quiet_save_notifications_v2231',
  'indexeddb_outbox_runtime_p0012', 'offline_concurrency_chaos_p010',
  'granular_sync_outbox_p009',
  'planning_acceptance_safety_p1002',
  'mobile_offline_recovery', 'mobile_orientation_keyboard', 'mobile_pwa_resume',
  'pwa_deploy_asset_version_consistency_cache001', 'pwa_cache_version_contract',
  'release_fingerprint_portability',
  'sync_role_transport_001',
  'offline_auth_001',
  'sync_conflict_ux_p1_matrix',
];

console.log('--- RELEASE AUDIT: Functional suite ---');
const functionalResult = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...functionalFiles.map(name => `tests/${name}.test.mjs`)], { stdio: 'inherit' });
if (functionalResult.error) console.error(functionalResult.error.message);

// --- Invocation B: Isolated DAG performance benchmark ---
const dagFiles = ['workshop_001b_dependency_dag'];

console.log('--- RELEASE AUDIT: Isolated DAG benchmark ---');
const dagResult = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...dagFiles.map(name => `tests/${name}.test.mjs`)], { stdio: 'inherit' });
if (dagResult.error) console.error(dagResult.error.message);

// Exit 0 only when BOTH invocations succeed.
const functionalOk = (functionalResult.status ?? 1) === 0;
const dagOk = (dagResult.status ?? 1) === 0;
if (!functionalOk) console.error('RELEASE AUDIT FAILED: Functional suite returned non-zero exit.');
if (!dagOk) console.error('RELEASE AUDIT FAILED: DAG benchmark returned non-zero exit.');
process.exitCode = (functionalOk && dagOk) ? 0 : 1;
