import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createNimrVmContext } from "./helpers/nimr_vm_context.mjs";
import { createGranularSupabaseAdapter } from "./helpers/granular_supabase_adapter.mjs";

const WORKSHOP_ID = "00000000-0000-0000-0000-000000000001";
const CASE_ID = "case-c96c07eb-9acd-4c20-8af5-bdefc928d54a";
const syncSource = fs.readFileSync(new URL("../js/supabase-sync.js", import.meta.url), "utf8");

function loadSyncVm(label, options = {}) {
  const contract = createNimrVmContext({
    filename: `${label}-state.js`,
    console: { ...console, warn() {}, error() {} },
    ...options,
  });
  contract.context.state = contract.run("state");
  contract.context.getSupabaseWorkshopId = () => WORKSHOP_ID;
  contract.context.getSupabaseConfig = () => ({
    backupTable: "cloud_backups",
    backupKey: "nimr-sav-main",
  });
  vm.runInContext(syncSource, contract.context, { filename: `${label}-supabase-sync.js` });
  contract.context.__productionRenderSupabaseSyncHealth = contract.context.renderSupabaseSyncHealth;
  contract.context.guardSensitiveAction = () => ({ ok: true });
  contract.context.hasPermission = () => true;
  contract.context.navigator.onLine = true;
  contract.context.getSupabaseUser = async () => ({ id: "user-director", email: "director@example.test" });
  contract.context.render = () => {};
  contract.context.setSupabaseStatus = () => {};
  contract.context.setSupabaseDetails = () => {};
  contract.context.quietNotify = () => {};
  contract.context.notifyUser = () => {};
  contract.context.renderSupabaseSyncHealth = async () => {};
  contract.context.createSyncSafetySnapshot = async () => ({ ok: true });
  contract.context.restoreGranularWorkshopSettings = async () => false;
  return contract;
}

function makeCase(id, overrides = {}) {
  return {
    id,
    clientName: `Client ${id}`,
    vehicle: "Véhicule test",
    plate: `PL-${id}`,
    orNavNumber: `OR-${id}`,
    status: "in_progress",
    localRevision: 59,
    history: [
      { action: "Création", date: "2026-09-01T08:00:00Z" },
      { action: "Diagnostic", date: "2026-09-01T09:00:00Z" },
      { action: "Planning", date: "2026-09-02T10:00:00Z" },
      { action: "Pièces reçues", date: "2026-09-02T14:00:00Z" },
      { action: "Travaux carrosserie", date: "2026-09-03T08:00:00Z" },
      { action: "Peinture", date: "2026-09-03T11:00:00Z" },
    ],
    updatedAt: "2026-09-03T11:00:00.000Z",
    ...overrides,
  };
}

function makeConflictedOutboxOp(caseId, revision, opIndex, overrides = {}) {
  return {
    operationId: `op-${revision}`,
    workshopId: WORKSHOP_ID,
    entityType: "case",
    entityId: caseId,
    action: "upsert",
    baseVersion: 30 + opIndex,
    expectedVersion: 30 + opIndex,
    syncStatus: "conflicted",
    conflictId: `server-conflict-${revision}`,
    retryCount: 0,
    payload: {
      entity: {
        id: caseId,
        clientName: `Client ${caseId}`,
        status: "planning",
        localRevision: revision,
        history: [{ action: `Historical Rev ${revision}`, date: "2026-09-01T08:00:00Z" }],
        updatedAt: `2026-09-01T0${opIndex}:00:00.000Z`,
      },
      projectionLocalId: `OR-${caseId}`,
    },
    ...overrides,
  };
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

// -------------------------------------------------------------
// 1. 5 conflicted upserts same case => one group
// 2. Grouping never loses operation IDs
// -------------------------------------------------------------
test("1 & 2. 5 conflicted upserts same case collapse into one group without losing operation IDs", async () => {
  const vmInst = loadSyncVm("group-test");
  const revisions = [55, 79, 102, 129, 152];
  const operations = revisions.map((rev, idx) => makeConflictedOutboxOp(CASE_ID, rev, idx));

  const conflicts = [{
    id: "conflict-local-1",
    type: "server_entity_conflict",
    workshopId: WORKSHOP_ID,
    entityType: "case",
    entityId: CASE_ID,
    caseId: CASE_ID,
    status: "open",
    serverConflictId: "server-conflict-152",
    localOperationId: "op-152",
  }];

  const grouped = vmInst.context.groupConflictedEntities(conflicts, operations);
  assert.equal(grouped.length, 1, "Must collapse all 5 operations into exactly ONE group");
  const group = grouped[0];
  assert.equal(group.isGrouped, true);
  assert.equal(group.historicalCount, 5);
  assert.deepEqual(Array.from(group.operationIds), ["op-55", "op-79", "op-102", "op-129", "op-152"], "Grouping must retain all operation IDs");
  assert.deepEqual(Array.from(group.historicalRevisions), revisions, "Grouping must retain all historical revisions");
});

// -------------------------------------------------------------
// 3. Keep local uses CURRENT state.cases payload, not revision-152 payload
// 4. Exactly one replacement operation
// 5. baseVersion equals fresh server version 35
// 6. Old operations remain until replacement ACK
// -------------------------------------------------------------
test("3, 4, 5, 6. Keep local uses CURRENT state.cases, creates 1 replacement with baseVersion 35, preserves old ops", async () => {
  const vmInst = loadSyncVm("keep-local-test");
  const adapter = createGranularSupabaseAdapter({ workshopId: WORKSHOP_ID });
  vmInst.context.getSupabaseClient = () => adapter.client;

  // Server canonical entity at version 35 with status 'planning'
  adapter.entities.set(`${WORKSHOP_ID}|case|${CASE_ID}`, {
    workshop_id: WORKSHOP_ID,
    entity_type: "case",
    entity_id: CASE_ID,
    entity_version: 35,
    last_operation_id: "op-server-canonical",
    deleted_at: null,
    updated_at: "2026-09-02T10:00:00.000Z",
    payload: { id: CASE_ID, status: "planning", localRevision: 35 },
  });

  // Current local state has status: "in_progress", localRevision: 59, 6 history entries
  const currentCase = makeCase(CASE_ID, { status: "in_progress", localRevision: 59 });
  vmInst.context.state.cases = [currentCase];

  // 5 conflicted historical operations in outbox
  const revisions = [55, 79, 102, 129, 152];
  const operations = revisions.map((rev, idx) => makeConflictedOutboxOp(CASE_ID, rev, idx));
  for (const op of operations) {
    await vmInst.context.putDurableOutboxOperation(op);
  }

  const conflicts = [{
    id: "conflict-local-1",
    type: "server_entity_conflict",
    workshopId: WORKSHOP_ID,
    entityType: "case",
    entityId: CASE_ID,
    status: "open",
    localOperationId: "op-152",
    serverConflictId: "server-conflict-152",
  }];
  vmInst.context.state.syncConflicts = conflicts;

  const grouped = vmInst.context.groupConflictedEntities(conflicts, operations);
  const resolutionResult = await vmInst.context.resolveCanonicalConcurrencyConflict(grouped[0], "keep_local");

  assert.equal(resolutionResult.ok, true);
  assert.equal(resolutionResult.serverVersion, 35, "Must use fresh server canonical entity_version");

  const outboxAfter = await vmInst.context.loadDurableOutboxOperations();
  // Check 4: Exactly one replacement operation created + 5 old ops remain (total 6)
  assert.equal(outboxAfter.length, 6, "Must keep 5 old operations + add 1 new replacement operation");

  const replacement = outboxAfter.find((op) => op.operationId === resolutionResult.replacementOperationId);
  assert.ok(replacement, "Replacement operation must exist in outbox");
  assert.equal(replacement.syncStatus, "pending");

  // Check 3: Current state.cases payload was used, not revision-152 snapshot
  assert.equal(replacement.payload.entity.status, "in_progress");
  assert.equal(replacement.payload.entity.localRevision, 59);
  assert.equal(replacement.payload.entity.history.length, 6);

  // Check 5: baseVersion and expectedVersion equal fresh server version 35
  assert.equal(replacement.baseVersion, 35);
  assert.equal(replacement.expectedVersion, 35);

  // Check 6: All 5 old operations are still present and conflicted
  const remainingOld = outboxAfter.filter((op) => revisions.map((r) => `op-${r}`).includes(op.operationId));
  assert.equal(remainingOld.length, 5);
  assert.ok(remainingOld.every((op) => op.syncStatus === "conflicted"));
});

// -------------------------------------------------------------
// 7. ACK settles all five
// -------------------------------------------------------------
test("7. Replacement ACK atomically settles all five historical operations and resolves server conflict", async () => {
  const vmInst = loadSyncVm("ack-settle-test");
  const adapter = createGranularSupabaseAdapter({ workshopId: WORKSHOP_ID });
  vmInst.context.getSupabaseClient = () => adapter.client;

  // Record server conflicts in adapter
  const revisions = [55, 79, 102, 129, 152];
  revisions.forEach((rev) => {
    adapter.recordServerConflict({
      id: `server-conflict-${rev}`,
      workshop_id: WORKSHOP_ID,
      local_operation_id: `op-${rev}`,
      entity_type: "case",
      entity_id: CASE_ID,
      status: "open",
    });
  });

  adapter.entities.set(`${WORKSHOP_ID}|case|${CASE_ID}`, {
    workshop_id: WORKSHOP_ID,
    entity_type: "case",
    entity_id: CASE_ID,
    entity_version: 35,
    payload: { id: CASE_ID, status: "planning" },
  });

  vmInst.context.state.cases = [makeCase(CASE_ID)];
  const operations = revisions.map((rev, idx) => makeConflictedOutboxOp(CASE_ID, rev, idx));
  for (const op of operations) {
    await vmInst.context.putDurableOutboxOperation(op);
  }

  const conflicts = [{
    id: "conflict-local-1",
    type: "server_entity_conflict",
    workshopId: WORKSHOP_ID,
    entityType: "case",
    entityId: CASE_ID,
    status: "open",
    localOperationId: "op-152",
  }];
  vmInst.context.state.syncConflicts = conflicts;

  const grouped = vmInst.context.groupConflictedEntities(conflicts, operations);
  const res = await vmInst.context.resolveCanonicalConcurrencyConflict(grouped[0], "keep_local");

  // Now simulate successful ACK of replacement operation
  const ackOutcome = await vmInst.context.settleAcknowledgedReplacementOperation(
    adapter.client,
    res.replacementOperationId,
    { accepted: true, serverVersion: 36, updatedAt: "2026-09-03T12:00:00Z" },
  );
  assert.equal(ackOutcome.settled, true);

  // Outbox must be completely clean (0 operations)
  const remainingOutbox = await vmInst.context.loadDurableOutboxOperations();
  assert.equal(remainingOutbox.length, 0, "All five old operations + replacement must be settled from outbox");

  // Local conflict must be resolved
  assert.equal(vmInst.context.state.syncConflicts[0].status, "resolved");
  assert.equal(vmInst.context.state.syncConflicts[0].decision, "kept_local");

  // Server conflict records must be resolved
  revisions.forEach((rev) => {
    const sc = adapter.serverConflicts.get(`server-conflict-${rev}`);
    assert.equal(sc?.status, "resolved");
  });
});

// -------------------------------------------------------------
// 8. Failed replacement preserves all five
// -------------------------------------------------------------
test("8. Failed replacement preserves all five operations in outbox", async () => {
  const vmInst = loadSyncVm("failed-replacement-test");
  const adapter = createGranularSupabaseAdapter({ workshopId: WORKSHOP_ID });
  vmInst.context.getSupabaseClient = () => adapter.client;

  adapter.entities.set(`${WORKSHOP_ID}|case|${CASE_ID}`, {
    workshop_id: WORKSHOP_ID,
    entity_type: "case",
    entity_id: CASE_ID,
    entity_version: 35,
    payload: { id: CASE_ID },
  });

  vmInst.context.state.cases = [makeCase(CASE_ID)];
  const revisions = [55, 79, 102, 129, 152];
  const operations = revisions.map((rev, idx) => makeConflictedOutboxOp(CASE_ID, rev, idx));
  for (const op of operations) {
    await vmInst.context.putDurableOutboxOperation(op);
  }

  const conflicts = [{
    id: "conflict-local-1",
    type: "server_entity_conflict",
    workshopId: WORKSHOP_ID,
    entityType: "case",
    entityId: CASE_ID,
    status: "open",
    localOperationId: "op-152",
  }];
  vmInst.context.state.syncConflicts = conflicts;

  const grouped = vmInst.context.groupConflictedEntities(conflicts, operations);
  await vmInst.context.resolveCanonicalConcurrencyConflict(grouped[0], "keep_local");

  // Inject failure for subsequent RPC / send
  adapter.injectFailure(new Error("Network timeout or CAS failure"));

  // Check outbox still has all 5 original operations
  const outbox = await vmInst.context.loadDurableOutboxOperations();
  const oldRemaining = outbox.filter((op) => revisions.map((r) => `op-${r}`).includes(op.operationId));
  assert.equal(oldRemaining.length, 5, "All 5 historical operations must remain untouched on failure");
  assert.equal(vmInst.context.state.syncConflicts[0].status, "open", "Conflict must not be falsely marked resolved");
});

// -------------------------------------------------------------
// 9 & 10. Accept cloud fetch/apply once and settles all five
// -------------------------------------------------------------
test("9 & 10. Accept cloud applies server canonical once and settles all five historical operations", async () => {
  const vmInst = loadSyncVm("accept-cloud-test");
  const adapter = createGranularSupabaseAdapter({ workshopId: WORKSHOP_ID });
  vmInst.context.getSupabaseClient = () => adapter.client;

  // Server canonical has status 'planning', version 35
  adapter.entities.set(`${WORKSHOP_ID}|case|${CASE_ID}`, {
    workshop_id: WORKSHOP_ID,
    entity_type: "case",
    entity_id: CASE_ID,
    entity_version: 35,
    payload: { id: CASE_ID, status: "planning", localRevision: 35 },
  });

  const revisions = [55, 79, 102, 129, 152];
  revisions.forEach((rev) => {
    adapter.recordServerConflict({
      id: `server-conflict-${rev}`,
      workshop_id: WORKSHOP_ID,
      entity_type: "case",
      entity_id: CASE_ID,
      status: "open",
    });
  });

  vmInst.context.state.cases = [makeCase(CASE_ID, { status: "in_progress", localRevision: 59 })];
  const operations = revisions.map((rev, idx) => makeConflictedOutboxOp(CASE_ID, rev, idx));
  for (const op of operations) {
    await vmInst.context.putDurableOutboxOperation(op);
  }

  const conflicts = [{
    id: "conflict-local-1",
    type: "server_entity_conflict",
    workshopId: WORKSHOP_ID,
    entityType: "case",
    entityId: CASE_ID,
    status: "open",
    localOperationId: "op-152",
  }];
  vmInst.context.state.syncConflicts = conflicts;

  const grouped = vmInst.context.groupConflictedEntities(conflicts, operations);
  const result = await vmInst.context.resolveCanonicalConcurrencyConflict(grouped[0], "accept_cloud");

  assert.equal(result.ok, true);
  assert.equal(result.serverVersion, 35);

  // Local state is updated to cloud state
  const updatedCase = vmInst.context.state.cases.find((c) => c.id === CASE_ID);
  assert.equal(updatedCase.status, "planning", "Must apply server canonical status");
  assert.equal(updatedCase.localRevision, 35, "Must apply server canonical revision");

  // Outbox is empty (all 5 settled)
  const remainingOutbox = await vmInst.context.loadDurableOutboxOperations();
  assert.equal(remainingOutbox.length, 0, "All 5 historical outbox operations must be settled");

  // Local conflict is resolved
  assert.equal(vmInst.context.state.syncConflicts[0].status, "resolved");
  assert.equal(vmInst.context.state.syncConflicts[0].decision, "accepted_cloud");

  // Server conflicts are resolved
  revisions.forEach((rev) => {
    assert.equal(adapter.serverConflicts.get(`server-conflict-${rev}`)?.status, "resolved");
  });
});

// -------------------------------------------------------------
// 11. Unrelated conflict untouched
// -------------------------------------------------------------
test("11. Unrelated conflict for another case remains untouched when group resolves", async () => {
  const vmInst = loadSyncVm("unrelated-conflict-test");
  const adapter = createGranularSupabaseAdapter({ workshopId: WORKSHOP_ID });
  vmInst.context.getSupabaseClient = () => adapter.client;

  const OTHER_CASE_ID = "case-other-456";
  adapter.entities.set(`${WORKSHOP_ID}|case|${CASE_ID}`, {
    workshop_id: WORKSHOP_ID,
    entity_type: "case",
    entity_id: CASE_ID,
    entity_version: 35,
    payload: { id: CASE_ID, status: "planning" },
  });

  vmInst.context.state.cases = [makeCase(CASE_ID), makeCase(OTHER_CASE_ID)];

  // Outbox has 5 ops for CASE_ID + 1 op for OTHER_CASE_ID
  const revisions = [55, 79, 102, 129, 152];
  for (const [idx, rev] of revisions.entries()) {
    adapter.recordServerConflict({ id: `server-conflict-${rev}`, workshop_id: WORKSHOP_ID, status: "open" });
    await vmInst.context.putDurableOutboxOperation(makeConflictedOutboxOp(CASE_ID, rev, idx));
  }
  adapter.recordServerConflict({ id: "server-conflict-other", workshop_id: WORKSHOP_ID, status: "open" });
  const otherOp = makeConflictedOutboxOp(OTHER_CASE_ID, 12, 0, { conflictId: "server-conflict-other" });
  await vmInst.context.putDurableOutboxOperation(otherOp);

  const conflicts = [
    { id: "conflict-1", type: "server_entity_conflict", workshopId: WORKSHOP_ID, entityType: "case", entityId: CASE_ID, status: "open", localOperationId: "op-152" },
    { id: "conflict-2", type: "server_entity_conflict", workshopId: WORKSHOP_ID, entityType: "case", entityId: OTHER_CASE_ID, status: "open", localOperationId: "op-12" },
  ];
  vmInst.context.state.syncConflicts = conflicts;

  const allOps = await vmInst.context.loadDurableOutboxOperations();
  const grouped = vmInst.context.groupConflictedEntities(conflicts, allOps);
  assert.equal(grouped.length, 2, "Must produce two independent groups");

  const targetGroup = grouped.find((g) => g.entityId === CASE_ID);
  await vmInst.context.resolveCanonicalConcurrencyConflict(targetGroup, "accept_cloud");

  const outboxAfter = await vmInst.context.loadDurableOutboxOperations();
  assert.equal(outboxAfter.length, 1, "Only OTHER_CASE_ID operation should remain");
  assert.equal(outboxAfter[0].operationId, "op-12");

  const otherConflict = vmInst.context.state.syncConflicts.find((c) => c.entityId === OTHER_CASE_ID);
  assert.equal(otherConflict.status, "open", "Unrelated conflict must remain open");
});

// -------------------------------------------------------------
// 12. Resolved server workshop_settings stale local entry self-reconciles
// -------------------------------------------------------------
test("12. Resolved server workshop_settings stale local entry self-reconciles via positive server evidence", async () => {
  const vmInst = loadSyncVm("reconcile-settings-test");
  const adapter = createGranularSupabaseAdapter({ workshopId: WORKSHOP_ID });
  vmInst.context.getSupabaseClient = () => adapter.client;

  // Server has resolved conflict row
  adapter.recordServerConflict({
    id: "sc-settings-resolved",
    workshop_id: WORKSHOP_ID,
    entity_type: "workshop_settings",
    entity_id: "workshop_settings",
    status: "resolved",
    resolution: "accept_server",
    resolved_at: "2026-09-02T12:00:00Z",
  });

  // Stale local conflict entry with lost serverConflictId
  vmInst.context.state.syncConflicts = [{
    id: "local-settings-conflict-1",
    type: "server_entity_conflict",
    workshopId: WORKSHOP_ID,
    entityType: "workshop_settings",
    entityId: "workshop_settings",
    status: "open",
    serverConflictId: "",
    localOperationId: "",
  }];

  const reconcileResult = await vmInst.context.reconcileServerResolvedConflicts(adapter.client, WORKSHOP_ID);
  assert.equal(reconcileResult.reconciled, 1);

  const localEntry = vmInst.context.state.syncConflicts[0];
  assert.equal(localEntry.status, "resolved", "Stale local conflict must become resolved");
  assert.equal(localEntry.decision, "accepted_cloud");
  assert.equal(localEntry.resolution, "accept_server");
});

// -------------------------------------------------------------
// 13. Unresolved server conflict never auto-closes
// -------------------------------------------------------------
test("13. Unresolved server conflict never auto-closes without positive server evidence", async () => {
  const vmInst = loadSyncVm("never-auto-close-test");
  const adapter = createGranularSupabaseAdapter({ workshopId: WORKSHOP_ID });
  vmInst.context.getSupabaseClient = () => adapter.client;

  // Server has OPEN conflict row
  adapter.recordServerConflict({
    id: "sc-case-open",
    workshop_id: WORKSHOP_ID,
    entity_type: "case",
    entity_id: CASE_ID,
    status: "open",
  });

  vmInst.context.state.syncConflicts = [{
    id: "local-open-conflict",
    type: "server_entity_conflict",
    workshopId: WORKSHOP_ID,
    entityType: "case",
    entityId: CASE_ID,
    status: "open",
  }];

  const reconcileResult = await vmInst.context.reconcileServerResolvedConflicts(adapter.client, WORKSHOP_ID);
  assert.equal(reconcileResult.reconciled, 0);
  assert.equal(vmInst.context.state.syncConflicts[0].status, "open", "Open server conflict must never auto-close");
});

// -------------------------------------------------------------
// 14. No five sequential server writes
// -------------------------------------------------------------
test("14. Accept cloud does not trigger five sequential server entity CAS writes", async () => {
  const vmInst = loadSyncVm("no-sequential-writes-test");
  const adapter = createGranularSupabaseAdapter({ workshopId: WORKSHOP_ID });
  vmInst.context.getSupabaseClient = () => adapter.client;

  adapter.entities.set(`${WORKSHOP_ID}|case|${CASE_ID}`, {
    workshop_id: WORKSHOP_ID,
    entity_type: "case",
    entity_id: CASE_ID,
    entity_version: 35,
    payload: { id: CASE_ID, status: "planning" },
  });

  const revisions = [55, 79, 102, 129, 152];
  for (const [idx, rev] of revisions.entries()) {
    adapter.recordServerConflict({ id: `server-conflict-${rev}`, workshop_id: WORKSHOP_ID, status: "open" });
    await vmInst.context.putDurableOutboxOperation(makeConflictedOutboxOp(CASE_ID, rev, idx));
  }

  const conflicts = [{
    id: "conflict-local-1",
    type: "server_entity_conflict",
    workshopId: WORKSHOP_ID,
    entityType: "case",
    entityId: CASE_ID,
    status: "open",
  }];
  vmInst.context.state.syncConflicts = conflicts;

  const ops = await vmInst.context.loadDurableOutboxOperations();
  const grouped = vmInst.context.groupConflictedEntities(conflicts, ops);

  // Monitor calls to adapter.client.rpc("nimr_apply_sync_entity_v2")
  const initialSendCount = adapter.calls.filter((c) => c.table === "nimr_apply_sync_entity_v2").length;
  await vmInst.context.resolveCanonicalConcurrencyConflict(grouped[0], "accept_cloud");

  // In accept_cloud, zero entity mutations should be sent to server (only conflict resolution RPC)
  const subsequentSends = adapter.calls.filter((c) => c.table === "nimr_apply_sync_entity_v2").length - initialSendCount;
  assert.equal(subsequentSends, 0, "No CAS upserts should be sent to the server in accept_cloud");
});

// -------------------------------------------------------------
// 15. Fail-closed on missing local entity for keep_local
// -------------------------------------------------------------
test("15. Fail-closed on missing local entity when keep_local is chosen", async () => {
  const vmInst = loadSyncVm("fail-closed-test");
  const adapter = createGranularSupabaseAdapter({ workshopId: WORKSHOP_ID });
  vmInst.context.getSupabaseClient = () => adapter.client;

  adapter.entities.set(`${WORKSHOP_ID}|case|${CASE_ID}`, {
    workshop_id: WORKSHOP_ID,
    entity_type: "case",
    entity_id: CASE_ID,
    entity_version: 35,
    payload: { id: CASE_ID },
  });

  // Local state cases is EMPTY
  vmInst.context.state.cases = [];

  const op = makeConflictedOutboxOp(CASE_ID, 152, 0);
  await vmInst.context.putDurableOutboxOperation(op);

  const conflict = {
    id: "conflict-local-1",
    type: "server_entity_conflict",
    workshopId: WORKSHOP_ID,
    entityType: "case",
    entityId: CASE_ID,
    status: "open",
    localOperationId: op.operationId,
  };
  vmInst.context.state.syncConflicts = [conflict];

  await assert.rejects(
    async () => {
      await vmInst.context.resolveCanonicalConcurrencyConflict(conflict, "keep_local");
    },
    /Entité locale introuvable|Dossier introuvable localement/u,
    "Must fail closed when local case is missing from state",
  );
});

// -------------------------------------------------------------
// 16. KEEP_LOCAL through resolveSyncConflict remains OPEN before ACK
// -------------------------------------------------------------
test("16. KEEP_LOCAL through resolveSyncConflict remains OPEN before ACK", async () => {
  const vmInst = loadSyncVm("keep-local-open-test");
  const adapter = createGranularSupabaseAdapter({ workshopId: WORKSHOP_ID });
  vmInst.context.getSupabaseClient = () => adapter.client;

  adapter.entities.set(`${WORKSHOP_ID}|case|${CASE_ID}`, {
    workshop_id: WORKSHOP_ID,
    entity_type: "case",
    entity_id: CASE_ID,
    entity_version: 35,
    payload: { id: CASE_ID, status: "planning" },
  });

  vmInst.context.state.cases = [makeCase(CASE_ID, { status: "in_progress", localRevision: 59 })];
  const op = makeConflictedOutboxOp(CASE_ID, 152, 0);
  await vmInst.context.putDurableOutboxOperation(op);

  const conflict = {
    id: "conflict-local-1",
    conflictKey: "conflict-local-1",
    type: "server_entity_conflict",
    workshopId: WORKSHOP_ID,
    entityType: "case",
    entityId: CASE_ID,
    status: "open",
    localOperationId: op.operationId,
    serverConflictId: "server-conflict-152",
  };
  vmInst.context.state.syncConflicts = [conflict];

  // Resolve through the real resolveSyncConflict path
  const res = vmInst.context.resolveSyncConflict("conflict-local-1", "keep_local");
  assert.equal(res.ok, true);
  await res.completion;

  // After keep_local enqueues replacement, conflict MUST remain OPEN!
  assert.equal(vmInst.context.state.syncConflicts[0].status, "open", "Conflict must remain OPEN while replacement is pending");
  assert.equal(vmInst.context.state.syncConflicts[0].pendingResolution, true, "Must be marked pending resolution");
  assert.equal(vmInst.context.state.syncConflicts[0].resolutionStage, "awaiting_ack");

  // Only after ACK + settlement does it transition to resolved
  adapter.recordServerConflict({ id: "server-conflict-152", status: "open", workshop_id: WORKSHOP_ID });
  const outbox = await vmInst.context.loadDurableOutboxOperations();
  const replacement = outbox.find((o) => o.operationId !== op.operationId);
  assert.ok(replacement);

  await vmInst.context.settleAcknowledgedReplacementOperation(adapter.client, replacement.operationId, { accepted: true, serverVersion: 36 });
  assert.equal(vmInst.context.state.syncConflicts[0].status, "resolved");
  assert.equal(vmInst.context.state.syncConflicts[0].decision, "kept_local");
});

// -------------------------------------------------------------
// 17. ACK + RPC failure preserves recoverable evidence and OPEN state
// -------------------------------------------------------------
test("17. ACK + RPC failure preserves recoverable evidence and OPEN state", async () => {
  const vmInst = loadSyncVm("ack-rpc-failure-test");
  const adapter = createGranularSupabaseAdapter({ workshopId: WORKSHOP_ID });
  vmInst.context.getSupabaseClient = () => adapter.client;

  adapter.recordServerConflict({
    id: "server-conflict-1",
    workshop_id: WORKSHOP_ID,
    status: "open",
  });

  const historicalOp = makeConflictedOutboxOp(CASE_ID, 152, 0, { conflictId: "server-conflict-1" });
  await vmInst.context.putDurableOutboxOperation(historicalOp);

  const replacement = {
    operationId: "op-replacement-fail",
    workshopId: WORKSHOP_ID,
    entityType: "case",
    entityId: CASE_ID,
    action: "upsert",
    baseVersion: 35,
    expectedVersion: 35,
    syncStatus: "pending",
    replacesOperationIds: [historicalOp.operationId],
    replacesConflictIds: ["server-conflict-1"],
    payload: { entity: makeCase(CASE_ID) },
  };
  await vmInst.context.putDurableOutboxOperation(replacement);

  const conflict = {
    id: "conflict-local-1",
    type: "server_entity_conflict",
    workshopId: WORKSHOP_ID,
    entityType: "case",
    entityId: CASE_ID,
    status: "open",
    serverConflictId: "server-conflict-1",
  };
  vmInst.context.state.syncConflicts = [conflict];

  // Inject failure on RPC
  adapter.injectFailure(new Error("Supabase RPC timeout"));

  await assert.rejects(
    async () => {
      await vmInst.context.settleAcknowledgedReplacementOperation(
        adapter.client,
        replacement.operationId,
        { accepted: true, serverVersion: 36 },
      );
    },
    /Supabase RPC timeout/u,
  );

  // Both operations MUST be preserved in outbox
  const outbox = await vmInst.context.loadDurableOutboxOperations();
  assert.equal(outbox.length, 2, "Historical operation and replacement must both remain in outbox");
  const settlingOp = outbox.find((o) => o.operationId === replacement.operationId);
  assert.equal(settlingOp.syncStatus, "settling", "Replacement must retain settling status for retry");

  // Local conflict remains OPEN
  assert.equal(vmInst.context.state.syncConflicts[0].status, "open", "Local conflict must remain OPEN on RPC failure");
});

// -------------------------------------------------------------
// 18. Retry settlement after ACK does NOT resend entity CAS
// -------------------------------------------------------------
test("18. Retry settlement after ACK does NOT resend entity CAS", async () => {
  const vmInst = loadSyncVm("retry-settlement-no-cas-test");
  const adapter = createGranularSupabaseAdapter({ workshopId: WORKSHOP_ID });
  vmInst.context.getSupabaseClient = () => adapter.client;

  adapter.recordServerConflict({
    id: "server-conflict-1",
    workshop_id: WORKSHOP_ID,
    status: "open",
  });

  const historicalOp = makeConflictedOutboxOp(CASE_ID, 152, 0, { conflictId: "server-conflict-1" });
  await vmInst.context.putDurableOutboxOperation(historicalOp);

  // Op is in "settling" status with casAcknowledged true
  const replacement = {
    operationId: "op-replacement-retry",
    workshopId: WORKSHOP_ID,
    entityType: "case",
    entityId: CASE_ID,
    action: "upsert",
    baseVersion: 35,
    expectedVersion: 35,
    syncStatus: "settling",
    casAcknowledged: true,
    replacesOperationIds: [historicalOp.operationId],
    replacesConflictIds: ["server-conflict-1"],
    payload: { entity: makeCase(CASE_ID) },
  };
  await vmInst.context.putDurableOutboxOperation(replacement);

  vmInst.context.state.syncConflicts = [{
    id: "conflict-local-1",
    type: "server_entity_conflict",
    workshopId: WORKSHOP_ID,
    entityType: "case",
    entityId: CASE_ID,
    status: "open",
    serverConflictId: "server-conflict-1",
  }];

  const initialCasCount = adapter.calls.filter((c) => c.table === "nimr_apply_sync_entity_v2").length;

  const outcome = await vmInst.context.processGranularOutboxOperation(
    adapter.client,
    { id: "user-director" },
    replacement,
  );
  assert.equal(outcome.settled, true);

  const subsequentCas = adapter.calls.filter((c) => c.table === "nimr_apply_sync_entity_v2").length - initialCasCount;
  assert.equal(subsequentCas, 0, "Retry of settlement saga must NEVER resend entity CAS");

  // Outbox is now settled
  const outbox = await vmInst.context.loadDurableOutboxOperations();
  assert.equal(outbox.length, 0);
  assert.equal(vmInst.context.state.syncConflicts[0].status, "resolved");
});

// -------------------------------------------------------------
// 19. Mixed resolved/open rows same entity do not auto-close
// -------------------------------------------------------------
test("19. Mixed resolved/open rows same entity do not auto-close", async () => {
  const vmInst = loadSyncVm("mixed-rows-test");
  const adapter = createGranularSupabaseAdapter({ workshopId: WORKSHOP_ID });
  vmInst.context.getSupabaseClient = () => adapter.client;

  // Two server rows for the same case: one resolved, one open
  adapter.recordServerConflict({
    id: "sc-resolved-1",
    workshop_id: WORKSHOP_ID,
    entity_type: "case",
    entity_id: CASE_ID,
    status: "resolved",
    resolution: "accept_server",
  });
  adapter.recordServerConflict({
    id: "sc-open-2",
    workshop_id: WORKSHOP_ID,
    entity_type: "case",
    entity_id: CASE_ID,
    status: "open",
  });

  // Damaged local entry with no serverConflictId and no localOperationId
  vmInst.context.state.syncConflicts = [{
    id: "conflict-local-damaged",
    type: "server_entity_conflict",
    workshopId: WORKSHOP_ID,
    entityType: "case",
    entityId: CASE_ID,
    status: "open",
  }];

  const result = await vmInst.context.reconcileServerResolvedConflicts(adapter.client, WORKSHOP_ID);
  assert.equal(result.reconciled, 0, "Must not auto-close when an open server row exists for the same entity");
  assert.equal(vmInst.context.state.syncConflicts[0].status, "open", "Damaged local conflict must remain open");
});

// -------------------------------------------------------------
// 20. All-compatible resolved rows allow damaged-entry reconciliation
// -------------------------------------------------------------
test("20. All-compatible resolved rows allow damaged-entry reconciliation", async () => {
  const vmInst = loadSyncVm("compatible-resolved-test");
  const adapter = createGranularSupabaseAdapter({ workshopId: WORKSHOP_ID });
  vmInst.context.getSupabaseClient = () => adapter.client;

  adapter.recordServerConflict({
    id: "sc-resolved-1",
    workshop_id: WORKSHOP_ID,
    entity_type: "case",
    entity_id: CASE_ID,
    status: "resolved",
    resolution: "accept_server",
  });
  adapter.recordServerConflict({
    id: "sc-resolved-2",
    workshop_id: WORKSHOP_ID,
    entity_type: "case",
    entity_id: CASE_ID,
    status: "resolved",
    resolution: "accept_server",
  });

  vmInst.context.state.syncConflicts = [{
    id: "conflict-local-damaged",
    type: "server_entity_conflict",
    workshopId: WORKSHOP_ID,
    entityType: "case",
    entityId: CASE_ID,
    status: "open",
  }];

  const result = await vmInst.context.reconcileServerResolvedConflicts(adapter.client, WORKSHOP_ID);
  assert.equal(result.reconciled, 1, "Must reconcile when all candidate server rows are compatibly resolved");
  assert.equal(vmInst.context.state.syncConflicts[0].status, "resolved");
  assert.equal(vmInst.context.state.syncConflicts[0].decision, "accepted_cloud");
});

// -------------------------------------------------------------
// 21. Production-like unknown/local-only conflict ID returns null and is never sent
// -------------------------------------------------------------
test("21. Production-like unknown/local-only conflict ID returns null without error and is never sent", async () => {
  const vmInst = loadSyncVm("unknown-conflict-id-test");
  const adapter = createGranularSupabaseAdapter({ workshopId: WORKSHOP_ID });
  vmInst.context.getSupabaseClient = () => adapter.client;

  // Production returns NULL without a PostgreSQL error for an unknown ID.
  const adapterRes = await adapter.client.rpc("nimr_resolve_sync_entity_conflict", {
    p_workshop_id: WORKSHOP_ID,
    p_conflict_id: "conflict-local-fake",
    p_resolution: "accept_server",
  });
  assert.equal(adapterRes.data, null);
  assert.equal(adapterRes.error, null);

  // Verify client never sends conflict-local-1 as p_conflict_id
  adapter.entities.set(`${WORKSHOP_ID}|case|${CASE_ID}`, {
    workshop_id: WORKSHOP_ID,
    entity_type: "case",
    entity_id: CASE_ID,
    entity_version: 35,
    payload: { id: CASE_ID },
  });
  vmInst.context.state.cases = [makeCase(CASE_ID)];

  const op = makeConflictedOutboxOp(CASE_ID, 152, 0, { conflictId: "" });
  await vmInst.context.putDurableOutboxOperation(op);

  const localConflict = {
    id: "conflict-local-1",
    type: "server_entity_conflict",
    workshopId: WORKSHOP_ID,
    entityType: "case",
    entityId: CASE_ID,
    status: "open",
    localOperationId: op.operationId,
  };
  vmInst.context.state.syncConflicts = [localConflict];

  const grouped = vmInst.context.groupConflictedEntities([localConflict], [op]);
  await assert.rejects(
    vmInst.context.resolveCanonicalConcurrencyConflict(grouped[0], "keep_local"),
    /Couverture des conflits serveur incomplète/u,
  );

  const resolveCalls = adapter.calls.filter((c) => c.table === "nimr_resolve_sync_entity_conflict");
  assert.ok(!resolveCalls.some((c) => c.rows?.[0]?.p_conflict_id === "conflict-local-1"), "conflict-local-1 must never be sent as p_conflict_id");
  assert.equal((await vmInst.context.loadDurableOutboxOperations()).length, 1, "No replacement is created from a local-only conflict ID");
});

// -------------------------------------------------------------
// 22. ACCEPT_CLOUD partial RPC failure remains recoverable
// -------------------------------------------------------------
test("22. ACCEPT_CLOUD partial RPC failure remains recoverable", async () => {
  const vmInst = loadSyncVm("accept-cloud-failure-test");
  const adapter = createGranularSupabaseAdapter({ workshopId: WORKSHOP_ID });
  vmInst.context.getSupabaseClient = () => adapter.client;

  adapter.entities.set(`${WORKSHOP_ID}|case|${CASE_ID}`, {
    workshop_id: WORKSHOP_ID,
    entity_type: "case",
    entity_id: CASE_ID,
    entity_version: 35,
    payload: { id: CASE_ID, status: "planning" },
  });

  adapter.recordServerConflict({
    id: "server-conflict-152",
    workshop_id: WORKSHOP_ID,
    status: "open",
  });

  const op = makeConflictedOutboxOp(CASE_ID, 152, 0, { conflictId: "server-conflict-152" });
  await vmInst.context.putDurableOutboxOperation(op);

  const conflict = {
    id: "conflict-local-1",
    type: "server_entity_conflict",
    workshopId: WORKSHOP_ID,
    entityType: "case",
    entityId: CASE_ID,
    status: "open",
    serverConflictId: "server-conflict-152",
  };
  vmInst.context.state.syncConflicts = [conflict];
  const grouped = vmInst.context.groupConflictedEntities([conflict], [op]);

  adapter.injectFailure(new Error("RPC network failure"));

  await assert.rejects(
    async () => {
      await vmInst.context.resolveCanonicalConcurrencyConflict(grouped[0], "accept_cloud");
    },
    /RPC network failure/u,
  );

  // Outbox operation is preserved, NOT destroyed
  const outbox = await vmInst.context.loadDurableOutboxOperations();
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0].syncStatus, "conflicted");

  // Local conflict remains open
  assert.equal(vmInst.context.state.syncConflicts[0].status, "open");
});

// -------------------------------------------------------------
// 23. ACCEPT_CLOUD retry converges without reapplying five historical ops
// -------------------------------------------------------------
test("23. ACCEPT_CLOUD retry converges without reapplying five historical ops", async () => {
  const vmInst = loadSyncVm("accept-cloud-retry-test");
  const adapter = createGranularSupabaseAdapter({ workshopId: WORKSHOP_ID });
  vmInst.context.getSupabaseClient = () => adapter.client;

  adapter.entities.set(`${WORKSHOP_ID}|case|${CASE_ID}`, {
    workshop_id: WORKSHOP_ID,
    entity_type: "case",
    entity_id: CASE_ID,
    entity_version: 35,
    payload: { id: CASE_ID, status: "planning" },
  });

  const revisions = [55, 79, 102, 129, 152];
  for (const [idx, rev] of revisions.entries()) {
    adapter.recordServerConflict({
      id: `server-conflict-${rev}`,
      workshop_id: WORKSHOP_ID,
      status: "open",
    });
    await vmInst.context.putDurableOutboxOperation(makeConflictedOutboxOp(CASE_ID, rev, idx, {
      conflictId: `server-conflict-${rev}`,
    }));
  }

  const conflicts = [{
    id: "conflict-local-1",
    type: "server_entity_conflict",
    workshopId: WORKSHOP_ID,
    entityType: "case",
    entityId: CASE_ID,
    status: "open",
  }];
  vmInst.context.state.syncConflicts = conflicts;

  const ops = await vmInst.context.loadDurableOutboxOperations();
  const grouped = vmInst.context.groupConflictedEntities(conflicts, ops);

  // First attempt fails partially on adapter
  adapter.injectFailure(new Error("Transient failure"));
  await assert.rejects(async () => {
    await vmInst.context.resolveCanonicalConcurrencyConflict(grouped[0], "accept_cloud");
  });

  // Clear failure and retry
  adapter.clearFailure();
  const initialCasWrites = adapter.calls.filter((c) => c.table === "nimr_apply_sync_entity_v2").length;
  const retryRes = await vmInst.context.resolveCanonicalConcurrencyConflict(grouped[0], "accept_cloud");
  assert.equal(retryRes.ok, true);

  // Converges: zero entity CAS writes
  const subsequentCasWrites = adapter.calls.filter((c) => c.table === "nimr_apply_sync_entity_v2").length - initialCasWrites;
  assert.equal(subsequentCasWrites, 0, "Accept cloud retry must never send entity CAS writes");

  // All 5 operations settled from outbox
  const remainingOutbox = await vmInst.context.loadDurableOutboxOperations();
  assert.equal(remainingOutbox.length, 0);

  // Local conflict resolved
  assert.equal(vmInst.context.state.syncConflicts[0].status, "resolved");
});

// -------------------------------------------------------------
// 24. Real public drain resumes a persisted settling saga after reload
// -------------------------------------------------------------
test("24. autoBackupToSupabase resumes persisted settling after reload without entity CAS", async () => {
  const adapter = createGranularSupabaseAdapter({ workshopId: WORKSHOP_ID });
  adapter.recordServerConflict({
    id: "server-conflict-restart",
    workshop_id: WORKSHOP_ID,
    local_operation_id: "op-restart-history",
    entity_type: "case",
    entity_id: CASE_ID,
    status: "open",
  });

  const beforeReload = loadSyncVm("settling-restart-before");
  const historical = makeConflictedOutboxOp(CASE_ID, 201, 0, {
    operationId: "op-restart-history",
    conflictId: "server-conflict-restart",
  });
  await beforeReload.context.putDurableOutboxOperation(historical);
  await beforeReload.context.putDurableOutboxOperation({
    operationId: "op-restart-replacement",
    workshopId: WORKSHOP_ID,
    entityType: "case",
    entityId: CASE_ID,
    action: "upsert",
    baseVersion: 35,
    expectedVersion: 35,
    syncStatus: "settling",
    casAcknowledged: true,
    casObserved: {
      workshopId: WORKSHOP_ID,
      entityType: "case",
      entityId: CASE_ID,
      serverVersion: 36,
      lastOperationId: "op-restart-replacement",
      deleted: false,
      updatedAt: "2026-09-03T12:00:00.000Z",
    },
    replacesOperationIds: [historical.operationId],
    replacesConflictIds: ["server-conflict-restart"],
    replacesLocalConflictIds: ["local-conflict-restart"],
    payload: { entity: makeCase(CASE_ID, { status: "completed" }) },
  });
  beforeReload.context.state.syncConflicts = [{
    id: "local-conflict-restart",
    type: "server_entity_conflict",
    workshopId: WORKSHOP_ID,
    entityType: "case",
    entityId: CASE_ID,
    status: "open",
    localOperationId: historical.operationId,
    serverConflictId: "server-conflict-restart",
  }];
  await beforeReload.context.saveState({ skipCloud: true, skipSnapshot: true, boundedEntityDetection: true });

  const persistedLocalStorage = Object.fromEntries(beforeReload.localStorage.values);
  const afterReload = loadSyncVm("settling-restart-after", { localStorage: persistedLocalStorage });
  afterReload.context.getSupabaseClient = () => adapter.client;
  const casBefore = adapter.calls.filter((call) => call.table === "nimr_apply_sync_entity_v2").length;

  const result = await afterReload.context.autoBackupToSupabase("restart-drain", { force: true });

  assert.equal(result.acknowledged, true);
  assert.equal(result.processed, 1, "Normal drain must select the persisted settling envelope");
  const casAfter = adapter.calls.filter((call) => call.table === "nimr_apply_sync_entity_v2").length;
  assert.equal(casAfter - casBefore, 0, "Settlement restart must never resend business CAS");
  assert.equal((await afterReload.context.loadDurableOutboxOperations()).length, 0, "Settlement must converge and drain all saga evidence");
  assert.equal(afterReload.context.state.syncConflicts[0].status, "resolved");
});

// -------------------------------------------------------------
// 25. Settling is active durable local intent
// -------------------------------------------------------------
test("25. settling is detected as an active durable operation", async () => {
  const vmInst = loadSyncVm("settling-active-intent");
  await vmInst.context.putDurableOutboxOperation({
    operationId: "op-settling-active",
    workshopId: WORKSHOP_ID,
    entityType: "case",
    entityId: CASE_ID,
    action: "upsert",
    baseVersion: 7,
    syncStatus: "settling",
    casAcknowledged: true,
    payload: { entity: makeCase(CASE_ID) },
  });
  const active = await vmInst.context.findActiveDurableOutboxOperationForEntity(WORKSHOP_ID, "case", CASE_ID);
  assert.equal(active?.operationId, "op-settling-active");
  assert.equal(active?.syncStatus, "settling");
});

// -------------------------------------------------------------
// 26. Reconciliation matches the real production schema
// -------------------------------------------------------------
test("26. reconciliation selects production id and never conflict_id or resolved_by", async () => {
  const vmInst = loadSyncVm("production-conflict-schema");
  const adapter = createGranularSupabaseAdapter({ workshopId: WORKSHOP_ID });
  vmInst.context.getSupabaseClient = () => adapter.client;
  adapter.recordServerConflict({
    id: "server-schema-id",
    workshop_id: WORKSHOP_ID,
    local_operation_id: "op-schema",
    entity_type: "case",
    entity_id: CASE_ID,
    status: "resolved",
    resolution: "accept_server",
    resolved_at: "2026-09-03T12:30:00.000Z",
  });
  vmInst.context.state.syncConflicts = [{
    id: "local-schema-conflict",
    type: "server_entity_conflict",
    workshopId: WORKSHOP_ID,
    entityType: "case",
    entityId: CASE_ID,
    status: "open",
    serverConflictId: "server-schema-id",
  }];

  const result = await vmInst.context.reconcileServerResolvedConflicts(adapter.client, WORKSHOP_ID);
  assert.equal(result.reconciled, 1);
  const selectCall = adapter.calls.find((call) => call.table === "sync_entity_conflicts" && call.operation === "select");
  assert.ok(selectCall);
  assert.match(selectCall.columns, /(^|,\s*)id(\s*,|$)/u);
  assert.doesNotMatch(selectCall.columns, /conflict_id|resolved_by/u);
  assert.equal(vmInst.context.state.syncConflicts[0].serverConflictId, "server-schema-id");
});

// -------------------------------------------------------------
// 27. NULL/no-error RPC result is failed settlement evidence
// -------------------------------------------------------------
test("27. production-like RPC data null is rejected and settlement evidence stays open", async () => {
  const vmInst = loadSyncVm("null-rpc-evidence");
  const adapter = createGranularSupabaseAdapter({ workshopId: WORKSHOP_ID });
  vmInst.context.getSupabaseClient = () => adapter.client;
  const historical = makeConflictedOutboxOp(CASE_ID, 202, 0, {
    operationId: "op-null-history",
    conflictId: "server-conflict-unknown",
  });
  await vmInst.context.putDurableOutboxOperation(historical);
  await vmInst.context.putDurableOutboxOperation({
    operationId: "op-null-replacement",
    workshopId: WORKSHOP_ID,
    entityType: "case",
    entityId: CASE_ID,
    action: "upsert",
    baseVersion: 35,
    syncStatus: "pending",
    replacesOperationIds: [historical.operationId],
    replacesConflictIds: ["server-conflict-unknown"],
    replacesLocalConflictIds: ["local-null-conflict"],
    payload: { entity: makeCase(CASE_ID) },
  });
  vmInst.context.state.syncConflicts = [{
    id: "local-null-conflict",
    type: "server_entity_conflict",
    workshopId: WORKSHOP_ID,
    entityType: "case",
    entityId: CASE_ID,
    status: "open",
    localOperationId: historical.operationId,
    serverConflictId: "server-conflict-unknown",
  }];

  await assert.rejects(
    vmInst.context.settleAcknowledgedReplacementOperation(
      adapter.client,
      "op-null-replacement",
      { accepted: true, serverVersion: 36 },
    ),
    /Preuve positive de résolution absente ou invalide/u,
  );
  const retained = await vmInst.context.loadDurableOutboxOperations();
  assert.equal(retained.length, 2);
  assert.equal(retained.find((entry) => entry.operationId === "op-null-replacement")?.syncStatus, "settling");
  assert.equal(vmInst.context.state.syncConflicts[0].status, "open");
});

// -------------------------------------------------------------
// 28. Idempotent resolved row is positive evidence
// -------------------------------------------------------------
test("28. idempotent already-resolved conflict RPC evidence succeeds", async () => {
  const vmInst = loadSyncVm("idempotent-resolution-evidence");
  const adapter = createGranularSupabaseAdapter({ workshopId: WORKSHOP_ID });
  vmInst.context.getSupabaseClient = () => adapter.client;
  adapter.recordServerConflict({
    id: "server-conflict-idempotent",
    workshop_id: WORKSHOP_ID,
    local_operation_id: "op-idempotent-history",
    entity_type: "case",
    entity_id: CASE_ID,
    status: "resolved",
    resolution: "keep_local",
    resolved_at: "2026-09-03T13:00:00.000Z",
  });
  const historical = makeConflictedOutboxOp(CASE_ID, 203, 0, {
    operationId: "op-idempotent-history",
    conflictId: "server-conflict-idempotent",
  });
  await vmInst.context.putDurableOutboxOperation(historical);
  const replacement = {
    operationId: "op-idempotent-replacement",
    workshopId: WORKSHOP_ID,
    entityType: "case",
    entityId: CASE_ID,
    action: "upsert",
    baseVersion: 36,
    syncStatus: "settling",
    casAcknowledged: true,
    replacesOperationIds: [historical.operationId],
    replacesConflictIds: ["server-conflict-idempotent"],
    replacesLocalConflictIds: ["local-idempotent-conflict"],
    payload: { entity: makeCase(CASE_ID) },
  };
  await vmInst.context.putDurableOutboxOperation(replacement);
  vmInst.context.state.syncConflicts = [{
    id: "local-idempotent-conflict",
    type: "server_entity_conflict",
    workshopId: WORKSHOP_ID,
    entityType: "case",
    entityId: CASE_ID,
    status: "open",
    localOperationId: historical.operationId,
    serverConflictId: "server-conflict-idempotent",
  }];

  const outcome = await vmInst.context.processGranularOutboxOperation(adapter.client, { id: "user-director" }, replacement);
  assert.equal(outcome.settled, true);
  assert.equal((await vmInst.context.loadDurableOutboxOperations()).length, 0);
  assert.equal(vmInst.context.state.syncConflicts[0].status, "resolved");
  assert.equal(adapter.calls.filter((call) => call.table === "nimr_apply_sync_entity_v2").length, 0);
});

// -------------------------------------------------------------
// 29. N/N server-conflict coverage is mandatory before KEEP_LOCAL
// -------------------------------------------------------------
test("29. KEEP_LOCAL allows 5/5 mappings and blocks 5/4 before business CAS", async () => {
  const seedCoverageScenario = async (label, mappedCount) => {
    const vmInst = loadSyncVm(label);
    const adapter = createGranularSupabaseAdapter({ workshopId: WORKSHOP_ID });
    vmInst.context.getSupabaseClient = () => adapter.client;
    adapter.entities.set(`${WORKSHOP_ID}|case|${CASE_ID}`, {
      workshop_id: WORKSHOP_ID,
      entity_type: "case",
      entity_id: CASE_ID,
      entity_version: 35,
      payload: { id: CASE_ID, status: "planning" },
    });
    vmInst.context.state.cases = [makeCase(CASE_ID)];
    const revisions = [301, 302, 303, 304, 305];
    const operations = revisions.map((revision, index) => makeConflictedOutboxOp(CASE_ID, revision, index, { conflictId: "" }));
    for (const [index, operation] of operations.entries()) {
      await vmInst.context.putDurableOutboxOperation(operation);
      if (index < mappedCount) {
        adapter.recordServerConflict({
          id: `server-mapped-${index + 1}`,
          workshop_id: WORKSHOP_ID,
          local_operation_id: operation.operationId,
          entity_type: "case",
          entity_id: CASE_ID,
          status: "open",
        });
      }
    }
    const conflict = {
      id: `local-coverage-${mappedCount}`,
      type: "server_entity_conflict",
      workshopId: WORKSHOP_ID,
      entityType: "case",
      entityId: CASE_ID,
      status: "open",
      localOperationId: operations.at(-1).operationId,
    };
    vmInst.context.state.syncConflicts = [conflict];
    return { vmInst, adapter, operations, group: vmInst.context.groupConflictedEntities([conflict], operations)[0] };
  };

  const complete = await seedCoverageScenario("coverage-five-of-five", 5);
  const allowed = await complete.vmInst.context.resolveCanonicalConcurrencyConflict(complete.group, "keep_local");
  assert.equal(allowed.ok, true);
  assert.equal(allowed.replacesConflictIds.length, 5);

  const incomplete = await seedCoverageScenario("coverage-four-of-five", 4);
  const casBefore = incomplete.adapter.calls.filter((call) => call.table === "nimr_apply_sync_entity_v2").length;
  await assert.rejects(
    incomplete.vmInst.context.resolveCanonicalConcurrencyConflict(incomplete.group, "keep_local"),
    /Couverture des conflits serveur incomplète \(4\/5\)/u,
  );
  const casAfter = incomplete.adapter.calls.filter((call) => call.table === "nimr_apply_sync_entity_v2").length;
  assert.equal(casAfter - casBefore, 0);
  assert.equal((await incomplete.vmInst.context.loadDurableOutboxOperations()).length, 5, "No replacement may be created on incomplete coverage");
});

// -------------------------------------------------------------
// 30. Missing durable conflictId can be recovered exactly
// -------------------------------------------------------------
test("30. missing operation conflictId is recovered by workshop_id plus local_operation_id", async () => {
  const vmInst = loadSyncVm("recover-missing-conflict-id");
  const adapter = createGranularSupabaseAdapter({ workshopId: WORKSHOP_ID });
  vmInst.context.getSupabaseClient = () => adapter.client;
  adapter.entities.set(`${WORKSHOP_ID}|case|${CASE_ID}`, {
    workshop_id: WORKSHOP_ID,
    entity_type: "case",
    entity_id: CASE_ID,
    entity_version: 35,
    payload: { id: CASE_ID },
  });
  vmInst.context.state.cases = [makeCase(CASE_ID)];
  const operation = makeConflictedOutboxOp(CASE_ID, 401, 0, { conflictId: "" });
  await vmInst.context.putDurableOutboxOperation(operation);
  adapter.recordServerConflict({
    id: "server-conflict-recovered",
    workshop_id: WORKSHOP_ID,
    local_operation_id: operation.operationId,
    entity_type: "case",
    entity_id: CASE_ID,
    status: "open",
  });
  const conflict = {
    id: "local-recovered-conflict",
    type: "server_entity_conflict",
    workshopId: WORKSHOP_ID,
    entityType: "case",
    entityId: CASE_ID,
    status: "open",
    localOperationId: operation.operationId,
  };
  vmInst.context.state.syncConflicts = [conflict];

  const result = await vmInst.context.resolveCanonicalConcurrencyConflict(conflict, "keep_local");
  assert.deepEqual(Array.from(result.replacesConflictIds), ["server-conflict-recovered"]);
  const recoveryRead = adapter.calls.find((call) => (
    call.table === "sync_entity_conflicts"
    && call.operation === "select"
    && call.filters.local_operation_id === operation.operationId
  ));
  assert.equal(recoveryRead?.filters.workshop_id, WORKSHOP_ID);
});

// -------------------------------------------------------------
// 31. Missing and unrecoverable mapping fails closed
// -------------------------------------------------------------
test("31. missing and unrecoverable conflict mapping remains fail-closed", async () => {
  const vmInst = loadSyncVm("unrecoverable-conflict-id");
  const adapter = createGranularSupabaseAdapter({ workshopId: WORKSHOP_ID });
  vmInst.context.getSupabaseClient = () => adapter.client;
  adapter.entities.set(`${WORKSHOP_ID}|case|${CASE_ID}`, {
    workshop_id: WORKSHOP_ID,
    entity_type: "case",
    entity_id: CASE_ID,
    entity_version: 35,
    payload: { id: CASE_ID },
  });
  vmInst.context.state.cases = [makeCase(CASE_ID)];
  const operation = makeConflictedOutboxOp(CASE_ID, 402, 0, { conflictId: "" });
  await vmInst.context.putDurableOutboxOperation(operation);
  const conflict = {
    id: "local-unrecoverable-conflict",
    type: "server_entity_conflict",
    workshopId: WORKSHOP_ID,
    entityType: "case",
    entityId: CASE_ID,
    status: "open",
    localOperationId: operation.operationId,
  };
  vmInst.context.state.syncConflicts = [conflict];

  await assert.rejects(
    vmInst.context.resolveCanonicalConcurrencyConflict(conflict, "keep_local"),
    /Couverture des conflits serveur incomplète/u,
  );
  const outbox = await vmInst.context.loadDurableOutboxOperations();
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0].syncStatus, "conflicted");
  assert.equal(vmInst.context.state.syncConflicts[0].status, "open");
});

// -------------------------------------------------------------
// 32. Settlement resolves exact members, not every same-entity conflict
// -------------------------------------------------------------
test("32. same-entity unrelated newer local conflict remains open", async () => {
  const vmInst = loadSyncVm("exact-local-conflict-membership");
  const adapter = createGranularSupabaseAdapter({ workshopId: WORKSHOP_ID });
  vmInst.context.getSupabaseClient = () => adapter.client;
  adapter.entities.set(`${WORKSHOP_ID}|case|${CASE_ID}`, {
    workshop_id: WORKSHOP_ID,
    entity_type: "case",
    entity_id: CASE_ID,
    entity_version: 35,
    payload: { id: CASE_ID },
  });
  adapter.recordServerConflict({
    id: "server-conflict-group-a",
    workshop_id: WORKSHOP_ID,
    local_operation_id: "op-group-a",
    entity_type: "case",
    entity_id: CASE_ID,
    status: "open",
  });
  vmInst.context.state.cases = [makeCase(CASE_ID)];
  const operationA = makeConflictedOutboxOp(CASE_ID, 501, 0, {
    operationId: "op-group-a",
    conflictId: "server-conflict-group-a",
  });
  await vmInst.context.putDurableOutboxOperation(operationA);
  const conflictA = {
    id: "local-conflict-group-a",
    type: "server_entity_conflict",
    workshopId: WORKSHOP_ID,
    entityType: "case",
    entityId: CASE_ID,
    field: "status",
    localValue: "local-a",
    remoteValue: "remote-a",
    status: "open",
    localOperationId: operationA.operationId,
    serverConflictId: "server-conflict-group-a",
  };
  vmInst.context.state.syncConflicts = [conflictA];
  const resolution = await vmInst.context.resolveCanonicalConcurrencyConflict(conflictA, "keep_local");

  vmInst.context.state.syncConflicts.push({
    id: "local-conflict-newer-b",
    type: "server_entity_conflict",
    workshopId: WORKSHOP_ID,
    entityType: "case",
    entityId: CASE_ID,
    field: "clientName",
    localValue: "local-b",
    remoteValue: "remote-b",
    status: "open",
    localOperationId: "op-newer-unrelated",
    serverConflictId: "server-conflict-newer-unrelated",
  });

  await vmInst.context.settleAcknowledgedReplacementOperation(
    adapter.client,
    resolution.replacementOperationId,
    { accepted: true, serverVersion: 36 },
  );
  assert.equal(vmInst.context.state.syncConflicts.find((entry) => entry.id === conflictA.id)?.status, "resolved");
  assert.equal(vmInst.context.state.syncConflicts.find((entry) => entry.id === "local-conflict-newer-b")?.status, "open");
});

// -------------------------------------------------------------
// 33. Settling appears in outbox and health pending state
// -------------------------------------------------------------
test("33. settling appears in outbox, health, and UI pending state", async () => {
  const vmInst = loadSyncVm("settling-health-state");
  const adapter = createGranularSupabaseAdapter({ workshopId: WORKSHOP_ID });
  vmInst.context.getSupabaseClient = () => adapter.client;
  await vmInst.context.putDurableOutboxOperation({
    operationId: "op-settling-health",
    workshopId: WORKSHOP_ID,
    entityType: "case",
    entityId: CASE_ID,
    action: "upsert",
    baseVersion: 35,
    syncStatus: "settling",
    casAcknowledged: true,
    payload: { entity: makeCase(CASE_ID) },
  });

  assert.equal(vmInst.context.getPendingOutboxCount(), 1);
  assert.equal(vmInst.context.NIMR_OUTBOX_STATUS.pending, 1);

  const healthValues = new Map();
  vmInst.context.setSyncHealthValue = (key, value, status) => healthValues.set(key, { value, status });
  vmInst.context.isSupabaseConfigured = () => true;
  await vmInst.context.__productionRenderSupabaseSyncHealth();
  assert.equal(healthValues.get("pending")?.value, 1);
  assert.equal(healthValues.get("pending")?.status, "warn");

  const stripValues = new Map();
  vmInst.context.setSyncItem = (target, key, value, status) => stripValues.set(key, { value, status });
  vmInst.context.renderSyncStatusStrip();
  assert.match(String(stripValues.get("pending")?.value), /1 en attente/u);
  assert.equal(stripValues.get("cloud")?.value, "Sync en attente");
});

// -------------------------------------------------------------
// 34. SYNC-001 self-heal preserves settling local intent
// -------------------------------------------------------------
test("34. SYNC-001 self-heal respects settling local intent", async () => {
  const adapter = createGranularSupabaseAdapter({ workshopId: WORKSHOP_ID });
  adapter.send({
    workshopId: WORKSHOP_ID,
    entityType: "case",
    entityId: CASE_ID,
    entityVersion: 1,
    operationId: "op-remote-before-settlement",
    action: "upsert",
    payload: { entity: makeCase(CASE_ID, { clientName: "Remote stale case" }) },
    updatedAt: "2026-09-03T08:00:00.000Z",
  });
  const vmInst = loadSyncVm("self-heal-settling-intent");
  vmInst.context.getSupabaseClient = () => adapter.client;
  vmInst.context.state.cases = [];
  vmInst.context.state.bookings = [];
  vmInst.context.state.auditLog = [];
  const localSettlingCase = makeCase(CASE_ID, { clientName: "Local settling intent" });
  await vmInst.context.putDurableOutboxOperation({
    operationId: "op-local-settling-intent",
    workshopId: WORKSHOP_ID,
    entityType: "case",
    entityId: CASE_ID,
    action: "upsert",
    baseVersion: 1,
    syncStatus: "settling",
    casAcknowledged: true,
    payload: { entity: localSettlingCase },
  });
  const bootstrapKey = vmInst.context.getGranularSyncMetadataKey(WORKSHOP_ID, "bootstrap");
  const caseMetaKey = vmInst.context.getGranularSyncMetadataKey(WORKSHOP_ID, "case");
  await vmInst.context.putSyncMetadata(bootstrapKey, { initialized: true });
  await vmInst.context.putSyncMetadata(caseMetaKey, {
    cursor: { updatedAt: "2026-09-03T08:00:00.000Z", entityId: CASE_ID },
    initialized: true,
  });

  const result = await vmInst.context.pullLatestSupabaseBackup("self-heal-settling-local-intent");
  assert.equal(result.selfHealed, true);
  assert.equal(vmInst.context.state.cases.length, 1);
  assert.equal(vmInst.context.state.cases[0].clientName, "Local settling intent");
  assert.equal((await vmInst.context.loadDurableOutboxOperations())[0].syncStatus, "settling");
});

// -------------------------------------------------------------
// Runner
// -------------------------------------------------------------
let passedCount = 0;
let failedCount = 0;

for (const { name, fn } of tests) {
  try {
    await fn();
    console.log(`PASS: ${name}`);
    passedCount += 1;
  } catch (error) {
    console.error(`FAIL: ${name}`);
    console.error(error);
    failedCount += 1;
  }
}

console.log(`\nSYNC-002 TEST SUITE: ${passedCount}/${tests.length} TESTS PASSED`);
if (failedCount > 0) {
  process.exit(1);
}
