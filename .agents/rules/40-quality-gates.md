# RULE 40: NIMR-SAV QUALITY GATES & VERIFICATION COMMANDS

## 1. Execution Principle
- Always run the narrowest relevant test first.
- Progress to broader regression suites before pre-commit reporting.
- If a gate cannot be executed, explicitly report:
  `GATE: <name> | STATUS: NOT RUN | REASON: <why> | RISK: <risk assessment>`
- Never report PASS for an unexecuted command.

## 2. V23 Legacy Application Quality Gates
All commands run from the repository root:

1. **Syntax Check**:
   ```bash
   node --check <modified-file>.js
   ```
2. **Targeted Domain Tests**:
   - Identity: `node tests/sec_secure_identity_onboarding_sec001.test.mjs`
   - Identity Mapping: `node tests/identity_001e_technician_resource_mapping.test.mjs`
   - Planning Assignment: `node tests/planning_resource_assignment.test.mjs`
   - Planning Conflicts: `node tests/planning_resources_conflicts.test.mjs`
   - Workshop DAG: `node tests/workshop_001b_dependency_dag.test.mjs`
   - Supabase Sync: `node tests/supabase_sync_integrity.test.mjs`
   - Technician Flow: `node tests/technician_flow.test.mjs`
   - Estimate Import: `node tests/estimate_regression.mjs`
3. **Audit & Release Suite**:
   ```bash
   node tests/run-audit-release.mjs
   ```
   *(Note: Release fingerprint check in `pwa_deploy_asset_version_consistency_cache001` intentionally fails during un-packaged functional edits prior to version bump).*
4. **Git Formatting & Whitespace Check**:
   ```bash
   git diff --check
   ```

## 3. V24 React Application Quality Gates
All commands run from `apps/nimr-sav-react/`:

1. **Unit & Component Tests**:
   ```bash
   npm run test
   ```
2. **ESLint Static Analysis**:
   ```bash
   npm run lint
   ```
3. **TypeScript Typecheck & Build**:
   ```bash
   npm run build
   ```
