// Current audit acceptance suite. Historical release snapshots remain separate.
import { spawnSync } from 'node:child_process';
const files = [
  'operational_coherence',
  'audit_completion', 'audit_completion_browser', 'smoke', 'technician_flow',
  'workshop_operational_simplification', 'canonical_task_model_p1003',
  'canonical_roles_statuses_v236', 'quality_controller_role_v235',
  'close_invoice_hard_lock_v2302', 'reception_delivery_sheet_v231c',
  'role_based_workspaces_qc_view_v2325', 'quiet_save_notifications_v2231',
  'indexeddb_outbox_runtime_p0012', 'offline_concurrency_chaos_p010',
  'granular_sync_outbox_p009', 'workshop_001b_dependency_dag',
  'planning_acceptance_safety_p1002',
  'mobile_offline_recovery', 'mobile_orientation_keyboard', 'mobile_pwa_resume',
  'pwa_deploy_asset_version_consistency_cache001', 'pwa_cache_version_contract',
  'release_fingerprint_portability',
];
const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...files.map(name => `tests/${name}.test.mjs`)], { stdio: 'inherit' });
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
