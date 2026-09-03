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
    localRevision: 69,
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

function makeOutboxOp(caseId, overrides = {}) {
  return {
    operationId: "op-" + Math.random().toString(36).slice(2, 10),
    workshopId: WORKSHOP_ID,
    entityType: "case",
    entityId: caseId,
    action: "upsert",
    baseVersion: 35,
    expectedVersion: 35,
    syncStatus: "pending",
    retryCount: 0,
    payload: {
      entity: makeCase(caseId),
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
// A. Semantic equality
// -------------------------------------------------------------
test("A. Semantic equality: strict JSON-semantic comparison", async () => {
  const vmInst = loadSyncVm("semantic-eq-test");
  const areEqual = vmInst.context.areCanonicalConflictPayloadsEquivalent;

  // 1. same object with different key ordering => equivalent
  assert.equal(
    areEqual({ b: 2, a: 1 }, { a: 1, b: 2 }),
    true,
    "same object with different key ordering must be equivalent"
  );

  // 2. nested object different key ordering => equivalent
  assert.equal(
    areEqual(
      { info: { status: "in_progress", count: 6 }, tags: ["A", "B"] },
      { tags: ["A", "B"], info: { count: 6, status: "in_progress" } }
    ),
    true,
    "nested object with different key ordering must be equivalent"
  );

  // 3. changed primitive => not equivalent
  assert.equal(
    areEqual({ status: "in_progress" }, { status: "planning" }),
    false,
    "changed primitive value must not be equivalent"
  );

  // 4. number vs string => not equivalent
  assert.equal(
    areEqual({ localRevision: 69 }, { localRevision: "69" }),
    false,
    "number vs string must not be equivalent"
  );
  assert.equal(
    areEqual({ active: true }, { active: "true" }),
    false,
    "boolean vs string must not be equivalent"
  );

  // 5. reordered array => not equivalent
  assert.equal(
    areEqual({ history: [1, 2, 3] }, { history: [3, 2, 1] }),
    false,
    "reordered array must not be equivalent"
  );

  // 6. null vs different/missing meaningful value => not equivalent
  assert.equal(
    areEqual({ field: null }, { field: undefined }),
    false,
    "null vs undefined must not be equivalent"
  );
  assert.equal(
    areEqual({ field: null }, {}),
    false,
    "null vs missing property must not be equivalent"
  );
  assert.equal(
    areEqual({ field: null }, { field: 0 }),
    false,
    "null vs 0 must not be equivalent"
  );
  assert.equal(
    areEqual({ field: null }, { field: "" }),
    false,
    "null vs empty string must not be equivalent"
  );
  assert.equal(
    areEqual({ field: null }, { field: false }),
    false,
    "null vs false must not be equivalent"
  );
  assert.equal(
    areEqual({ field: null }, { field: null }),
    true,
    "null vs null must be equivalent"
  );
});

// -------------------------------------------------------------
// B. Ordinary equivalent CAS conflict
// -------------------------------------------------------------
test("B. Ordinary equivalent CAS conflict auto-reconciles without manual conflict card", async () => {
  const vmInst = loadSyncVm("ordinary-eq-test");
  const adapter = createGranularSupabaseAdapter({ workshopId: WORKSHOP_ID });
  vmInst.context.getSupabaseClient = () => adapter.client;

  const targetCase = makeCase(CASE_ID, { status: "in_progress", localRevision: 69 });
  vmInst.context.state.cases = [targetCase];

  // Server is ahead at version 129, but canonical payload is semantically IDENTICAL
  adapter.entities.set(`${WORKSHOP_ID}|case|${CASE_ID}`, {
    workshop_id: WORKSHOP_ID,
    entity_type: "case",
    entity_id: CASE_ID,
    entity_version: 129,
    last_operation_id: "op-prior-server",
    deleted_at: null,
    updated_at: "2026-09-03T12:00:00.000Z",
    payload: structuredClone(targetCase),
  });

  // Outbox operation has stale baseVersion: 35
  const op = makeOutboxOp(CASE_ID, {
    baseVersion: 35,
    expectedVersion: 35,
    payload: { entity: structuredClone(targetCase), projectionLocalId: `OR-${CASE_ID}` },
  });
  await vmInst.context.putDurableOutboxOperation(op);

  // Process operation through processGranularOutboxOperation
  const result = await vmInst.context.processGranularOutboxOperation(
    adapter.client,
    { id: "user-director" },
    op
  );

  assert.equal(result.settled, true, "Operation must settle");
  assert.equal(result.autoReconciled, true, "Must be auto-reconciled");

  // No conflict registered in state.syncConflicts
  const openConflicts = vmInst.context.getOpenSyncConflicts();
  assert.equal(openConflicts.length, 0, "No open local conflict card should be created");

  // Outbox must be empty
  const remainingOutbox = await vmInst.context.loadDurableOutboxOperations();
  assert.equal(remainingOutbox.length, 0, "Outbox operation must be completed and removed");

  // Server conflict row must be resolved as accept_server
  const generatedConflictId = `conflict:${op.operationId}`;
  const serverConflictRow = adapter.serverConflicts.get(generatedConflictId);
  assert.ok(serverConflictRow, "Server conflict row must exist");
  assert.equal(serverConflictRow.status, "resolved");
  assert.equal(serverConflictRow.resolution, "accept_server");
});

// -------------------------------------------------------------
// C. Production-shaped replacement scenario
// -------------------------------------------------------------
test("C. Production-shaped replacement scenario: historical keep_local + new equivalent CAS conflict", async () => {
  const vmInst = loadSyncVm("prod-replacement-test");
  const adapter = createGranularSupabaseAdapter({ workshopId: WORKSHOP_ID });
  vmInst.context.getSupabaseClient = () => adapter.client;

  const targetCase = makeCase(CASE_ID, { status: "in_progress", localRevision: 69 });
  vmInst.context.state.cases = [targetCase];

  // Server is at entity_version 129 with identical payload
  adapter.entities.set(`${WORKSHOP_ID}|case|${CASE_ID}`, {
    workshop_id: WORKSHOP_ID,
    entity_type: "case",
    entity_id: CASE_ID,
    entity_version: 129,
    last_operation_id: "op-prior-canonical",
    deleted_at: null,
    updated_at: "2026-09-03T12:00:00.000Z",
    payload: structuredClone(targetCase),
  });

  // 5 historical conflicted operations from previous revisions
  const historicalRevisions = [55, 79, 102, 129, 152];
  const historicalOpIds = [];
  const historicalConflictIds = [];

  for (const rev of historicalRevisions) {
    const histOpId = `op-hist-${rev}`;
    const histConflictId = `sc-hist-${rev}`;
    historicalOpIds.push(histOpId);
    historicalConflictIds.push(histConflictId);

    adapter.recordServerConflict({
      id: histConflictId,
      workshop_id: WORKSHOP_ID,
      entity_type: "case",
      entity_id: CASE_ID,
      local_operation_id: histOpId,
      status: "open",
    });

    await vmInst.context.putDurableOutboxOperation({
      operationId: histOpId,
      workshopId: WORKSHOP_ID,
      entityType: "case",
      entityId: CASE_ID,
      action: "upsert",
      baseVersion: rev,
      syncStatus: "conflicted",
      conflictId: histConflictId,
      payload: { entity: makeCase(CASE_ID, { localRevision: rev }) },
    });
  }

  // Local conflict representing the group
  const localConflict = {
    id: "conflict-local-case",
    conflictKey: "conflict-local-case",
    type: "server_entity_conflict",
    workshopId: WORKSHOP_ID,
    entityType: "case",
    entityId: CASE_ID,
    status: "open",
    localOperationId: historicalOpIds[0],
    serverConflictId: historicalConflictIds[0],
  };
  vmInst.context.state.syncConflicts = [localConflict];

  // The replacement operation created with stale baseVersion: 35
  const replacementOp = {
    operationId: "op-replacement-1",
    workshopId: WORKSHOP_ID,
    entityType: "case",
    entityId: CASE_ID,
    action: "upsert",
    baseVersion: 35,
    expectedVersion: 35,
    syncStatus: "pending",
    replacesOperationIds: historicalOpIds,
    replacesConflictIds: historicalConflictIds,
    replacesLocalConflictIds: ["conflict-local-case"],
    payload: { entity: structuredClone(targetCase), projectionLocalId: `OR-${CASE_ID}` },
  };
  await vmInst.context.putDurableOutboxOperation(replacementOp);

  // Send the replacement operation
  const result = await vmInst.context.processGranularOutboxOperation(
    adapter.client,
    { id: "user-director" },
    replacementOp
  );

  assert.equal(result.settled, true, "Replacement operation must settle");
  assert.equal(result.autoReconciled, true, "Must auto-reconcile");

  // 1. The new generated conflict for the replacement was resolved as accept_server
  const generatedConflict = adapter.serverConflicts.get(`conflict:${replacementOp.operationId}`);
  assert.ok(generatedConflict, "Generated conflict for replacement must exist");
  assert.equal(generatedConflict.status, "resolved");
  assert.equal(generatedConflict.resolution, "accept_server");

  // 2. All 5 historical conflicts were resolved as keep_local
  for (const histConflictId of historicalConflictIds) {
    const sc = adapter.serverConflicts.get(histConflictId);
    assert.equal(sc?.status, "resolved", `Historical conflict ${histConflictId} must be resolved`);
    assert.equal(sc?.resolution, "keep_local", `Historical conflict ${histConflictId} must be keep_local`);
  }

  // 3. All outbox operations (replacement + 5 historical) are deleted
  const remainingOutbox = await vmInst.context.loadDurableOutboxOperations();
  assert.equal(remainingOutbox.length, 0, "All operations must be atomically settled from outbox");

  // 4. Local conflict is marked resolved
  assert.equal(vmInst.context.state.syncConflicts[0].status, "resolved");
  assert.equal(vmInst.context.getOpenSyncConflicts().length, 0);
});

// -------------------------------------------------------------
// C2. Production race: historical outbox already gone, historical server conflicts already resolved
// -------------------------------------------------------------
test("C2. Production race: historical outbox operations gone, exact replacesConflictIds already resolved on server", async () => {
  const vmInst = loadSyncVm("prod-race-gone-test");
  const adapter = createGranularSupabaseAdapter({ workshopId: WORKSHOP_ID });
  vmInst.context.getSupabaseClient = () => adapter.client;

  const targetCase = makeCase(CASE_ID, { status: "in_progress", localRevision: 69 });
  vmInst.context.state.cases = [targetCase];

  // Server canonical contains identical intended payload at entity_version 129
  adapter.entities.set(`${WORKSHOP_ID}|case|${CASE_ID}`, {
    workshop_id: WORKSHOP_ID,
    entity_type: "case",
    entity_id: CASE_ID,
    entity_version: 129,
    last_operation_id: "op-prior-server",
    deleted_at: null,
    updated_at: "2026-09-03T12:00:00.000Z",
    payload: structuredClone(targetCase),
  });

  // 6 historical server conflicts ALREADY resolved as keep_local on the server
  const historicalRevisions = [55, 79, 102, 129, 152, 170];
  const historicalOpIds = historicalRevisions.map((rev) => `op-hist-${rev}`);
  const historicalConflictIds = historicalRevisions.map((rev) => `sc-hist-${rev}`);

  for (const histConflictId of historicalConflictIds) {
    adapter.recordServerConflict({
      id: histConflictId,
      workshop_id: WORKSHOP_ID,
      entity_type: "case",
      entity_id: CASE_ID,
      status: "resolved",
      resolution: "keep_local",
    });
  }

  // Local conflict representing the group
  const localConflict = {
    id: "conflict-local-case",
    conflictKey: "conflict-local-case",
    type: "server_entity_conflict",
    workshopId: WORKSHOP_ID,
    entityType: "case",
    entityId: CASE_ID,
    status: "open",
    serverConflictId: historicalConflictIds[0],
  };
  vmInst.context.state.syncConflicts = [localConflict];

  // ONLY the replacement operation exists in local outbox (NONE of the 6 historical ops exist!)
  const replacementOp = {
    operationId: "op-replacement-race",
    workshopId: WORKSHOP_ID,
    entityType: "case",
    entityId: CASE_ID,
    action: "upsert",
    baseVersion: 35,
    expectedVersion: 35,
    syncStatus: "pending",
    replacesOperationIds: historicalOpIds,
    replacesConflictIds: historicalConflictIds,
    replacesLocalConflictIds: ["conflict-local-case"],
    payload: { entity: structuredClone(targetCase), projectionLocalId: `OR-${CASE_ID}` },
  };
  await vmInst.context.putDurableOutboxOperation(replacementOp);

  // Monitor calls to nimr_apply_sync_entity_v2
  const initialCasCount = adapter.calls.filter((c) => c.table === "nimr_apply_sync_entity_v2").length;

  // Process the replacement operation
  const result = await vmInst.context.processGranularOutboxOperation(
    adapter.client,
    { id: "user-director" },
    replacementOp
  );

  assert.equal(result.settled, true, "Must settle without error");
  assert.equal(result.autoReconciled, true, "Must auto-reconcile");

  // CAS count must have been exactly 1 (initial send returning conflict), no retry/resend
  const subsequentCas = adapter.calls.filter((c) => c.table === "nimr_apply_sync_entity_v2").length - initialCasCount;
  assert.equal(subsequentCas, 1, "No business CAS resend after settling begins");

  // Generated conflict resolved accept_server
  const generatedConflict = adapter.serverConflicts.get(`conflict:${replacementOp.operationId}`);
  assert.ok(generatedConflict, "Generated conflict for replacement must exist");
  assert.equal(generatedConflict.status, "resolved");
  assert.equal(generatedConflict.resolution, "accept_server");

  // All 6 historical conflicts verified as keep_local
  for (const histConflictId of historicalConflictIds) {
    const sc = adapter.serverConflicts.get(histConflictId);
    assert.equal(sc?.status, "resolved");
    assert.equal(sc?.resolution, "keep_local");
  }

  // Outbox is completely empty
  const remainingOutbox = await vmInst.context.loadDurableOutboxOperations();
  assert.equal(remainingOutbox.length, 0, "Replacement operation must be removed");

  // Local conflict marked resolved
  assert.equal(vmInst.context.state.syncConflicts[0].status, "resolved");
  assert.equal(vmInst.context.getOpenSyncConflicts().length, 0);
});

// -------------------------------------------------------------
// C3. Historical outbox gone but historical server conflicts still open
// -------------------------------------------------------------
test("C3. Historical outbox gone but historical server conflicts still open: resolves keep_local and respects scope isolation", async () => {
  const vmInst = loadSyncVm("prod-race-open-test");
  const adapter = createGranularSupabaseAdapter({ workshopId: WORKSHOP_ID });
  vmInst.context.getSupabaseClient = () => adapter.client;

  const targetCase = makeCase(CASE_ID, { status: "in_progress", localRevision: 69 });
  vmInst.context.state.cases = [targetCase];

  adapter.entities.set(`${WORKSHOP_ID}|case|${CASE_ID}`, {
    workshop_id: WORKSHOP_ID,
    entity_type: "case",
    entity_id: CASE_ID,
    entity_version: 129,
    payload: structuredClone(targetCase),
  });

  // 3 historical conflicts that are OPEN on server
  const historicalConflictIds = ["sc-open-1", "sc-open-2", "sc-open-3"];
  for (const id of historicalConflictIds) {
    adapter.recordServerConflict({
      id,
      workshop_id: WORKSHOP_ID,
      entity_type: "case",
      entity_id: CASE_ID,
      status: "open",
    });
  }

  // An unrelated open conflict on the SAME case
  const unrelatedConflictId = "sc-unrelated-same-case";
  adapter.recordServerConflict({
    id: unrelatedConflictId,
    workshop_id: WORKSHOP_ID,
    entity_type: "case",
    entity_id: CASE_ID,
    status: "open",
  });

  const localConflict = {
    id: "conflict-local-case",
    conflictKey: "conflict-local-case",
    type: "server_entity_conflict",
    workshopId: WORKSHOP_ID,
    entityType: "case",
    entityId: CASE_ID,
    status: "open",
    serverConflictId: historicalConflictIds[0],
  };
  vmInst.context.state.syncConflicts = [localConflict];

  // Replacement outbox operation has replacesConflictIds, but 0 historical ops in outbox
  const replacementOp = {
    operationId: "op-replacement-open-conflicts",
    workshopId: WORKSHOP_ID,
    entityType: "case",
    entityId: CASE_ID,
    action: "upsert",
    baseVersion: 35,
    expectedVersion: 35,
    syncStatus: "pending",
    replacesOperationIds: ["op-ghost-1", "op-ghost-2", "op-ghost-3"],
    replacesConflictIds: historicalConflictIds,
    replacesLocalConflictIds: ["conflict-local-case"],
    payload: { entity: structuredClone(targetCase) },
  };
  await vmInst.context.putDurableOutboxOperation(replacementOp);

  const result = await vmInst.context.processGranularOutboxOperation(
    adapter.client,
    { id: "user-director" },
    replacementOp
  );

  assert.equal(result.settled, true);
  assert.equal(result.autoReconciled, true);

  // Historical conflicts resolved keep_local
  for (const id of historicalConflictIds) {
    assert.equal(adapter.serverConflicts.get(id)?.status, "resolved");
    assert.equal(adapter.serverConflicts.get(id)?.resolution, "keep_local");
  }

  // Unrelated conflict on SAME entity MUST remain OPEN!
  assert.equal(adapter.serverConflicts.get(unrelatedConflictId)?.status, "open", "Unrelated conflict on same case must remain open");

  // Outbox is 0
  const remainingOutbox = await vmInst.context.loadDurableOutboxOperations();
  assert.equal(remainingOutbox.length, 0);
});

// -------------------------------------------------------------
// C4. No safe coverage: fails closed
// -------------------------------------------------------------
test("C4. No safe coverage: historical operations absent and replacesConflictIds missing/invalid fails closed", async () => {
  const vmInst = loadSyncVm("no-safe-coverage-test");
  const adapter = createGranularSupabaseAdapter({ workshopId: WORKSHOP_ID });
  vmInst.context.getSupabaseClient = () => adapter.client;

  const targetCase = makeCase(CASE_ID);
  adapter.entities.set(`${WORKSHOP_ID}|case|${CASE_ID}`, {
    workshop_id: WORKSHOP_ID,
    entity_type: "case",
    entity_id: CASE_ID,
    entity_version: 129,
    payload: structuredClone(targetCase),
  });

  // Replacement has replacesOperationIds, but replacesConflictIds is empty AND ops are gone from outbox
  const replacementOp = {
    operationId: "op-replacement-missing-coverage",
    workshopId: WORKSHOP_ID,
    entityType: "case",
    entityId: CASE_ID,
    action: "upsert",
    baseVersion: 35,
    expectedVersion: 35,
    syncStatus: "pending",
    replacesOperationIds: ["op-missing-1", "op-missing-2"],
    replacesConflictIds: [], // missing!
    replacesLocalConflictIds: ["conflict-local-case"],
    payload: { entity: structuredClone(targetCase) },
  };
  await vmInst.context.putDurableOutboxOperation(replacementOp);

  const outcome = await vmInst.context.processGranularOutboxOperation(
    adapter.client,
    { id: "user-director" },
    replacementOp
  );

  assert.equal(outcome.acknowledged, false, "Must not report acknowledged");
  assert.equal(outcome.settling, true, "Must stay settling");

  const outbox = await vmInst.context.loadDurableOutboxOperations();
  assert.equal(outbox.length, 1, "Operation must remain in outbox");
  assert.equal(outbox[0].syncStatus, "settling", "Must remain in settling status");
  assert.match(outbox[0].lastError, /Couverture des conflits serveur incomplète/, "Must record informative error");
});

// -------------------------------------------------------------
// C5. Duplicated replacesConflictIds fails closed
// -------------------------------------------------------------
test("C5. Duplicated replacesConflictIds fails closed and does not complete or delete outbox", async () => {
  const vmInst = loadSyncVm("dup-conflicts-fail-closed-test");
  const adapter = createGranularSupabaseAdapter({ workshopId: WORKSHOP_ID });
  vmInst.context.getSupabaseClient = () => adapter.client;

  const targetCase = makeCase(CASE_ID);
  adapter.entities.set(`${WORKSHOP_ID}|case|${CASE_ID}`, {
    workshop_id: WORKSHOP_ID,
    entity_type: "case",
    entity_id: CASE_ID,
    entity_version: 129,
    payload: structuredClone(targetCase),
  });

  // Setup: replacesOperationIds = ["op-1", "op-2"], replacesConflictIds = ["sc-A", "sc-A"] (duplicate!)
  // Historical operations absent from outbox
  const replacementOp = {
    operationId: "op-replacement-dup-conflicts",
    workshopId: WORKSHOP_ID,
    entityType: "case",
    entityId: CASE_ID,
    action: "upsert",
    baseVersion: 35,
    expectedVersion: 35,
    syncStatus: "pending",
    replacesOperationIds: ["op-1", "op-2"],
    replacesConflictIds: ["sc-A", "sc-A"], // duplicate!
    replacesLocalConflictIds: ["conflict-local-case"],
    payload: { entity: structuredClone(targetCase) },
  };
  await vmInst.context.putDurableOutboxOperation(replacementOp);

  // Unrelated server conflict on same entity to ensure no broad resolution occurs
  const unrelatedConflictId = "sc-unrelated-dup-test";
  adapter.recordServerConflict({
    id: unrelatedConflictId,
    workshop_id: WORKSHOP_ID,
    entity_type: "case",
    entity_id: CASE_ID,
    status: "open",
  });

  const outcome = await vmInst.context.processGranularOutboxOperation(
    adapter.client,
    { id: "user-director" },
    replacementOp
  );

  assert.equal(outcome.acknowledged, false);
  assert.equal(outcome.settling, true);

  // Operation must remain in settling status in outbox
  const outbox = await vmInst.context.loadDurableOutboxOperations();
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0].syncStatus, "settling");
  assert.match(outbox[0].lastError, /Couverture des conflits serveur incomplète/);

  // Unrelated conflict untouched
  assert.equal(adapter.serverConflicts.get(unrelatedConflictId)?.status, "open");
});

// -------------------------------------------------------------
// C6. Excess / duplicated conflict coverage fails closed
// -------------------------------------------------------------
test("C6. Excess / duplicated conflict coverage fails closed and preserves settling", async () => {
  const vmInst = loadSyncVm("excess-conflicts-fail-closed-test");
  const adapter = createGranularSupabaseAdapter({ workshopId: WORKSHOP_ID });
  vmInst.context.getSupabaseClient = () => adapter.client;

  const targetCase = makeCase(CASE_ID);
  adapter.entities.set(`${WORKSHOP_ID}|case|${CASE_ID}`, {
    workshop_id: WORKSHOP_ID,
    entity_type: "case",
    entity_id: CASE_ID,
    entity_version: 129,
    payload: structuredClone(targetCase),
  });

  // Setup: replacesOperationIds = ["op-1", "op-2"], replacesConflictIds = ["sc-A", "sc-B", "sc-B"]
  // Historical operations absent from outbox
  const replacementOp = {
    operationId: "op-replacement-excess-conflicts",
    workshopId: WORKSHOP_ID,
    entityType: "case",
    entityId: CASE_ID,
    action: "upsert",
    baseVersion: 35,
    expectedVersion: 35,
    syncStatus: "pending",
    replacesOperationIds: ["op-1", "op-2"],
    replacesConflictIds: ["sc-A", "sc-B", "sc-B"], // excess/duplicate!
    replacesLocalConflictIds: ["conflict-local-case"],
    payload: { entity: structuredClone(targetCase) },
  };
  await vmInst.context.putDurableOutboxOperation(replacementOp);

  const outcome = await vmInst.context.processGranularOutboxOperation(
    adapter.client,
    { id: "user-director" },
    replacementOp
  );

  assert.equal(outcome.acknowledged, false);
  assert.equal(outcome.settling, true);

  const outbox = await vmInst.context.loadDurableOutboxOperations();
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0].syncStatus, "settling");
  assert.match(outbox[0].lastError, /Couverture des conflits serveur incomplète/);
});

// -------------------------------------------------------------
// C7. Exact 1:1 coverage ["op-1", "op-2"] / ["sc-A", "sc-B"] succeeds
// -------------------------------------------------------------
test("C7. Exact valid 1:1 coverage without historical outbox records succeeds", async () => {
  const vmInst = loadSyncVm("exact-coverage-success-test");
  const adapter = createGranularSupabaseAdapter({ workshopId: WORKSHOP_ID });
  vmInst.context.getSupabaseClient = () => adapter.client;

  const targetCase = makeCase(CASE_ID);
  adapter.entities.set(`${WORKSHOP_ID}|case|${CASE_ID}`, {
    workshop_id: WORKSHOP_ID,
    entity_type: "case",
    entity_id: CASE_ID,
    entity_version: 129,
    payload: structuredClone(targetCase),
  });

  adapter.recordServerConflict({
    id: "sc-A",
    workshop_id: WORKSHOP_ID,
    entity_type: "case",
    entity_id: CASE_ID,
    status: "open",
  });
  adapter.recordServerConflict({
    id: "sc-B",
    workshop_id: WORKSHOP_ID,
    entity_type: "case",
    entity_id: CASE_ID,
    status: "open",
  });

  const replacementOp = {
    operationId: "op-replacement-exact-valid",
    workshopId: WORKSHOP_ID,
    entityType: "case",
    entityId: CASE_ID,
    action: "upsert",
    baseVersion: 35,
    expectedVersion: 35,
    syncStatus: "pending",
    replacesOperationIds: ["op-1", "op-2"],
    replacesConflictIds: ["sc-A", "sc-B"],
    replacesLocalConflictIds: ["conflict-local-case"],
    payload: { entity: structuredClone(targetCase) },
  };
  await vmInst.context.putDurableOutboxOperation(replacementOp);

  const outcome = await vmInst.context.processGranularOutboxOperation(
    adapter.client,
    { id: "user-director" },
    replacementOp
  );

  assert.equal(outcome.settled, true);
  assert.equal(outcome.autoReconciled, true);
  assert.equal(adapter.serverConflicts.get("sc-A")?.status, "resolved");
  assert.equal(adapter.serverConflicts.get("sc-B")?.status, "resolved");

  const outbox = await vmInst.context.loadDurableOutboxOperations();
  assert.equal(outbox.length, 0);
});

// -------------------------------------------------------------
// D. RPC NULL/no error: must fail closed
// -------------------------------------------------------------
test("D. RPC NULL/no error fails closed, preserves settling evidence, no business CAS resend", async () => {
  const vmInst = loadSyncVm("rpc-null-fail-test");
  const adapter = createGranularSupabaseAdapter({ workshopId: WORKSHOP_ID });
  vmInst.context.getSupabaseClient = () => adapter.client;

  const targetCase = makeCase(CASE_ID);
  adapter.entities.set(`${WORKSHOP_ID}|case|${CASE_ID}`, {
    workshop_id: WORKSHOP_ID,
    entity_type: "case",
    entity_id: CASE_ID,
    entity_version: 129,
    payload: structuredClone(targetCase),
  });

  const op = makeOutboxOp(CASE_ID, {
    operationId: "op-null-test",
    baseVersion: 35,
    payload: { entity: structuredClone(targetCase) },
  });
  await vmInst.context.putDurableOutboxOperation(op);

  // Override rpc to return { data: null, error: null } on conflict resolution
  const origRpc = adapter.client.rpc;
  adapter.client.rpc = async (name, args) => {
    if (name === "nimr_resolve_sync_entity_conflict") {
      return { data: null, error: null };
    }
    return origRpc(name, args);
  };

  const outcome = await vmInst.context.processGranularOutboxOperation(
    adapter.client,
    { id: "user-director" },
    op
  );

  assert.equal(outcome.acknowledged, false, "Must not report acknowledged");
  assert.equal(outcome.settling, true, "Must report settling");

  // Outbox operation is preserved in settling status
  const outbox = await vmInst.context.loadDurableOutboxOperations();
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0].syncStatus, "settling");
  assert.equal(outbox[0].casAcknowledged, true);
  assert.equal(outbox[0].equivalentConflictId, `conflict:${op.operationId}`);
});

// -------------------------------------------------------------
// E. RPC error: fail closed
// -------------------------------------------------------------
test("E. RPC error fails closed with durable settling evidence preserved", async () => {
  const vmInst = loadSyncVm("rpc-error-fail-test");
  const adapter = createGranularSupabaseAdapter({ workshopId: WORKSHOP_ID });
  vmInst.context.getSupabaseClient = () => adapter.client;

  const targetCase = makeCase(CASE_ID);
  adapter.entities.set(`${WORKSHOP_ID}|case|${CASE_ID}`, {
    workshop_id: WORKSHOP_ID,
    entity_type: "case",
    entity_id: CASE_ID,
    entity_version: 129,
    payload: structuredClone(targetCase),
  });

  const op = makeOutboxOp(CASE_ID, {
    operationId: "op-error-test",
    baseVersion: 35,
    payload: { entity: structuredClone(targetCase) },
  });
  await vmInst.context.putDurableOutboxOperation(op);

  // Inject failure when nimr_resolve_sync_entity_conflict is called
  const origRpc = adapter.client.rpc;
  adapter.client.rpc = async (name, args) => {
    if (name === "nimr_resolve_sync_entity_conflict") {
      return { data: null, error: new Error("Network disconnection during settlement") };
    }
    return origRpc(name, args);
  };

  const outcome = await vmInst.context.processGranularOutboxOperation(
    adapter.client,
    { id: "user-director" },
    op
  );

  assert.equal(outcome.acknowledged, false);
  assert.equal(outcome.settling, true);

  const outbox = await vmInst.context.loadDurableOutboxOperations();
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0].syncStatus, "settling");
  assert.match(outbox[0].lastError, /Network disconnection/);
});

// -------------------------------------------------------------
// F. Wrong returned conflict row/id fails closed
// -------------------------------------------------------------
test("F. Wrong returned conflict row/id fails closed", async () => {
  const vmInst = loadSyncVm("wrong-id-test");
  const adapter = createGranularSupabaseAdapter({ workshopId: WORKSHOP_ID });
  vmInst.context.getSupabaseClient = () => adapter.client;

  const targetCase = makeCase(CASE_ID);
  adapter.entities.set(`${WORKSHOP_ID}|case|${CASE_ID}`, {
    workshop_id: WORKSHOP_ID,
    entity_type: "case",
    entity_id: CASE_ID,
    entity_version: 129,
    payload: structuredClone(targetCase),
  });

  const op = makeOutboxOp(CASE_ID, {
    operationId: "op-wrong-id",
    baseVersion: 35,
    payload: { entity: structuredClone(targetCase) },
  });
  await vmInst.context.putDurableOutboxOperation(op);

  const origRpc = adapter.client.rpc;
  adapter.client.rpc = async (name, args) => {
    if (name === "nimr_resolve_sync_entity_conflict") {
      return { data: { id: "wrong-conflict-id", status: "resolved", resolution: "accept_server" }, error: null };
    }
    return origRpc(name, args);
  };

  const outcome = await vmInst.context.processGranularOutboxOperation(
    adapter.client,
    { id: "user-director" },
    op
  );
  assert.equal(outcome.acknowledged, false);
  assert.equal(outcome.settling, true);

  const outbox = await vmInst.context.loadDurableOutboxOperations();
  assert.equal(outbox[0].syncStatus, "settling");
});

// -------------------------------------------------------------
// G. Wrong returned resolution fails closed
// -------------------------------------------------------------
test("G. Wrong returned resolution fails closed", async () => {
  const vmInst = loadSyncVm("wrong-res-test");
  const adapter = createGranularSupabaseAdapter({ workshopId: WORKSHOP_ID });
  vmInst.context.getSupabaseClient = () => adapter.client;

  const targetCase = makeCase(CASE_ID);
  adapter.entities.set(`${WORKSHOP_ID}|case|${CASE_ID}`, {
    workshop_id: WORKSHOP_ID,
    entity_type: "case",
    entity_id: CASE_ID,
    entity_version: 129,
    payload: structuredClone(targetCase),
  });

  const op = makeOutboxOp(CASE_ID, {
    operationId: "op-wrong-res",
    baseVersion: 35,
    payload: { entity: structuredClone(targetCase) },
  });
  await vmInst.context.putDurableOutboxOperation(op);

  const origRpc = adapter.client.rpc;
  adapter.client.rpc = async (name, args) => {
    if (name === "nimr_resolve_sync_entity_conflict") {
      return { data: { id: args.p_conflict_id, status: "resolved", resolution: "wrong_resolution" }, error: null };
    }
    return origRpc(name, args);
  };

  const outcome = await vmInst.context.processGranularOutboxOperation(
    adapter.client,
    { id: "user-director" },
    op
  );
  assert.equal(outcome.acknowledged, false);
  assert.equal(outcome.settling, true);

  const outbox = await vmInst.context.loadDurableOutboxOperations();
  assert.equal(outbox[0].syncStatus, "settling");
});

// -------------------------------------------------------------
// H. Restart recovery: persisted settling drained without entity CAS resend
// -------------------------------------------------------------
test("H. Restart recovery: persisted settling drained by autoBackupToSupabase without entity CAS resend", async () => {
  const vmInst = loadSyncVm("restart-recovery-test");
  const adapter = createGranularSupabaseAdapter({ workshopId: WORKSHOP_ID });
  vmInst.context.getSupabaseClient = () => adapter.client;

  const targetCase = makeCase(CASE_ID);
  adapter.recordServerConflict({
    id: "conflict:persisted-op",
    workshop_id: WORKSHOP_ID,
    entity_type: "case",
    entity_id: CASE_ID,
    local_operation_id: "persisted-op",
    status: "open",
  });

  // Reconstruct state: operation is persisted in settling status after browser reload
  const settlingOp = {
    operationId: "persisted-op",
    workshopId: WORKSHOP_ID,
    entityType: "case",
    entityId: CASE_ID,
    action: "upsert",
    baseVersion: 35,
    expectedVersion: 35,
    syncStatus: "settling",
    casAcknowledged: true,
    equivalentConflictId: "conflict:persisted-op",
    resolvedConflictIds: [],
    payload: { entity: structuredClone(targetCase) },
  };
  await vmInst.context.putDurableOutboxOperation(settlingOp);

  // Monitor calls to nimr_apply_sync_entity_v2 (entity CAS write)
  const casCallsBefore = adapter.calls.filter((c) => c.table === "nimr_apply_sync_entity_v2").length;

  // Run the real normal drain path
  await vmInst.context.autoBackupToSupabase("startup-drain", { force: true, requireAck: true });

  const casCallsAfter = adapter.calls.filter((c) => c.table === "nimr_apply_sync_entity_v2").length;
  assert.equal(casCallsAfter - casCallsBefore, 0, "Restart drain MUST NOT resend entity CAS write");

  // Outbox operation is now completely settled and removed
  const outbox = await vmInst.context.loadDurableOutboxOperations();
  assert.equal(outbox.length, 0, "Persisted settling operation must be settled and deleted");

  // Server conflict is resolved
  const sc = adapter.serverConflicts.get("conflict:persisted-op");
  assert.equal(sc?.status, "resolved");
  assert.equal(sc?.resolution, "accept_server");
});

// -------------------------------------------------------------
// I. Partial settlement: persists progress and does not repeat work
// -------------------------------------------------------------
test("I. Partial settlement persists progress and does not repeat certified RPCs", async () => {
  const vmInst = loadSyncVm("partial-settle-test");
  const adapter = createGranularSupabaseAdapter({ workshopId: WORKSHOP_ID });
  vmInst.context.getSupabaseClient = () => adapter.client;

  const targetCase = makeCase(CASE_ID);
  const histOpId = "op-hist-1";
  const histConflictId = "sc-hist-1";

  adapter.recordServerConflict({
    id: histConflictId,
    workshop_id: WORKSHOP_ID,
    entity_type: "case",
    entity_id: CASE_ID,
    local_operation_id: histOpId,
    status: "open",
  });

  await vmInst.context.putDurableOutboxOperation({
    operationId: histOpId,
    workshopId: WORKSHOP_ID,
    entityType: "case",
    entityId: CASE_ID,
    action: "upsert",
    baseVersion: 55,
    syncStatus: "conflicted",
    conflictId: histConflictId,
    payload: { entity: makeCase(CASE_ID) },
  });

  const equivalentConflictId = "conflict:replacement-partial";
  adapter.recordServerConflict({
    id: equivalentConflictId,
    workshop_id: WORKSHOP_ID,
    entity_type: "case",
    entity_id: CASE_ID,
    local_operation_id: "op-replacement-partial",
    status: "open",
  });

  const replacementOp = {
    operationId: "op-replacement-partial",
    workshopId: WORKSHOP_ID,
    entityType: "case",
    entityId: CASE_ID,
    action: "upsert",
    baseVersion: 35,
    expectedVersion: 35,
    syncStatus: "settling",
    casAcknowledged: true,
    equivalentConflictId,
    replacesOperationIds: [histOpId],
    replacesConflictIds: [histConflictId],
    resolvedConflictIds: [],
    payload: { entity: structuredClone(targetCase) },
  };
  await vmInst.context.putDurableOutboxOperation(replacementOp);

  // First run: equivalent conflict succeeds, but historical conflict fails
  const origRpc = adapter.client.rpc;
  adapter.client.rpc = async (name, args) => {
    if (name === "nimr_resolve_sync_entity_conflict" && args.p_conflict_id === histConflictId) {
      return { data: null, error: new Error("Temporary network timeout") };
    }
    return origRpc(name, args);
  };

  await assert.rejects(async () => {
    await vmInst.context.resumeReplacementSettlementSaga(adapter.client, replacementOp);
  }, /Temporary network timeout/);

  // Check outbox has persisted equivalentConflictId in resolvedConflictIds
  let outbox = await vmInst.context.loadDurableOutboxOperations();
  const retained = outbox.find((o) => o.operationId === replacementOp.operationId);
  assert.ok(retained.resolvedConflictIds.includes(equivalentConflictId), "Must have saved progress");

  // Restore normal RPC
  adapter.client.rpc = origRpc;

  // Track resolution calls for equivalentConflictId during retry
  const rpcCallsBefore = adapter.calls.filter((c) => c.table === "nimr_resolve_sync_entity_conflict" && c.rows?.[0]?.p_conflict_id === equivalentConflictId).length;

  // Retry
  const retryOutcome = await vmInst.context.resumeReplacementSettlementSaga(adapter.client, retained);
  assert.equal(retryOutcome.settled, true);

  const rpcCallsAfter = adapter.calls.filter((c) => c.table === "nimr_resolve_sync_entity_conflict" && c.rows?.[0]?.p_conflict_id === equivalentConflictId).length;
  assert.equal(rpcCallsAfter - rpcCallsBefore, 0, "Already-certified conflict must NOT be resent to RPC");

  outbox = await vmInst.context.loadDurableOutboxOperations();
  assert.equal(outbox.length, 0, "All operations must be settled");
});

// -------------------------------------------------------------
// J. Real divergent conflict: unchanged SYNC-002 path
// -------------------------------------------------------------
test("J. Real divergent conflict follows original SYNC-002 manual resolution path", async () => {
  const vmInst = loadSyncVm("divergent-conflict-test");
  const adapter = createGranularSupabaseAdapter({ workshopId: WORKSHOP_ID });
  vmInst.context.getSupabaseClient = () => adapter.client;

  // Server has status: "planning", revision: 35
  adapter.entities.set(`${WORKSHOP_ID}|case|${CASE_ID}`, {
    workshop_id: WORKSHOP_ID,
    entity_type: "case",
    entity_id: CASE_ID,
    entity_version: 129,
    payload: makeCase(CASE_ID, { status: "planning", localRevision: 35 }),
  });

  // Local payload has status: "in_progress", revision: 69 (DIVERGENT!)
  const localCase = makeCase(CASE_ID, { status: "in_progress", localRevision: 69 });
  vmInst.context.state.cases = [localCase];

  const op = makeOutboxOp(CASE_ID, {
    baseVersion: 35,
    payload: { entity: structuredClone(localCase) },
  });
  await vmInst.context.putDurableOutboxOperation(op);

  const result = await vmInst.context.processGranularOutboxOperation(
    adapter.client,
    { id: "user-director" },
    op
  );

  assert.equal(result.conflicted, true, "Must be classified as genuine conflict");
  assert.equal(result.acknowledged, false);

  // Durable conflicted operation in outbox
  const outbox = await vmInst.context.loadDurableOutboxOperations();
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0].syncStatus, "conflicted");

  // User-visible conflict registered in state.syncConflicts
  const openConflicts = vmInst.context.getOpenSyncConflicts();
  assert.equal(openConflicts.length, 1, "Must create user-visible manual conflict card");
  assert.equal(openConflicts[0].status, "open");
});

// -------------------------------------------------------------
// K. Scope isolation: unrelated conflict / entity untouched
// -------------------------------------------------------------
test("K. Scope isolation: unrelated conflict on same or different entity remains untouched", async () => {
  const vmInst = loadSyncVm("scope-isolation-test");
  const adapter = createGranularSupabaseAdapter({ workshopId: WORKSHOP_ID });
  vmInst.context.getSupabaseClient = () => adapter.client;

  const targetCase = makeCase(CASE_ID);
  adapter.entities.set(`${WORKSHOP_ID}|case|${CASE_ID}`, {
    workshop_id: WORKSHOP_ID,
    entity_type: "case",
    entity_id: CASE_ID,
    entity_version: 129,
    payload: structuredClone(targetCase),
  });

  // Unrelated open conflict for OTHER case
  const OTHER_CASE = "case-other-999";
  const otherConflict = {
    id: "conflict-unrelated",
    type: "server_entity_conflict",
    workshopId: WORKSHOP_ID,
    entityType: "case",
    entityId: OTHER_CASE,
    status: "open",
    serverConflictId: "sc-other-999",
  };
  // Newer unrelated conflict for SAME case
  const sameCaseNewerConflict = {
    id: "conflict-newer-same-case",
    type: "server_entity_conflict",
    workshopId: WORKSHOP_ID,
    entityType: "case",
    entityId: CASE_ID,
    localOperationId: "op-newer-unrelated",
    status: "open",
    serverConflictId: "sc-newer-unrelated",
  };
  vmInst.context.state.syncConflicts = [otherConflict, sameCaseNewerConflict];

  const op = makeOutboxOp(CASE_ID, {
    baseVersion: 35,
    payload: { entity: structuredClone(targetCase) },
  });
  await vmInst.context.putDurableOutboxOperation(op);

  const result = await vmInst.context.processGranularOutboxOperation(
    adapter.client,
    { id: "user-director" },
    op
  );
  assert.equal(result.settled, true);

  // Unrelated conflicts MUST remain OPEN!
  const remainingConflicts = vmInst.context.state.syncConflicts;
  const other = remainingConflicts.find((c) => c.id === "conflict-unrelated");
  const sameCaseNewer = remainingConflicts.find((c) => c.id === "conflict-newer-same-case");
  assert.equal(other?.status, "open", "Unrelated entity conflict must stay open");
  assert.equal(sameCaseNewer?.status, "open", "Newer conflict on same entity must stay open");
});

// -------------------------------------------------------------
// L. No server conflict ID / malformed evidence: fails safe
// -------------------------------------------------------------
test("L. No server conflict ID or malformed evidence falls back to normal conflict path", async () => {
  const vmInst = loadSyncVm("malformed-evidence-test");
  const adapter = createGranularSupabaseAdapter({ workshopId: WORKSHOP_ID });
  vmInst.context.getSupabaseClient = () => adapter.client;

  const targetCase = makeCase(CASE_ID);
  adapter.entities.set(`${WORKSHOP_ID}|case|${CASE_ID}`, {
    workshop_id: WORKSHOP_ID,
    entity_type: "case",
    entity_id: CASE_ID,
    entity_version: 129,
    payload: structuredClone(targetCase),
  });

  const op = makeOutboxOp(CASE_ID, {
    baseVersion: 35,
    payload: { entity: structuredClone(targetCase) },
  });
  await vmInst.context.putDurableOutboxOperation(op);

  // Override applyCasOperation in adapter to return an unproven conflictId ("conflict-local-fake")
  const origRpc = adapter.client.rpc;
  adapter.client.rpc = async (name, args) => {
    if (name === "nimr_apply_sync_entity_v2") {
      const res = await origRpc(name, args);
      if (res.data && res.data.conflict) {
        res.data.conflict_id = "conflict-local-fake"; // not a proven server ID!
      }
      return res;
    }
    return origRpc(name, args);
  };

  const result = await vmInst.context.processGranularOutboxOperation(
    adapter.client,
    { id: "user-director" },
    op
  );

  assert.equal(result.conflicted, true, "Must fall back to normal conflict path");
  const outbox = await vmInst.context.loadDurableOutboxOperations();
  assert.equal(outbox[0].syncStatus, "conflicted");
});

// -------------------------------------------------------------
// Characterization: Local revision 69 -> 70 on clean reload
// -------------------------------------------------------------
test("Characterization: clean hydrate/reload with 0 conflicts & empty outbox does NOT increment localRevision or schedule cloud mutation", async () => {
  const vmInst = loadSyncVm("clean-reload-char-test");

  const initialCase = makeCase(CASE_ID, { localRevision: 69, status: "in_progress" });
  vmInst.context.state.cases = [initialCase];
  vmInst.context.state.syncConflicts = [];

  // Initialize runtime comparable
  vmInst.context.initializeLastKnownCasesComparable();

  // Verify initial state
  assert.equal(vmInst.context.state.cases[0].localRevision, 69);
  const outboxBefore = await vmInst.context.loadDurableOutboxOperations();
  assert.equal(outboxBefore.length, 0);

  // Simulate pure clean reload / startup scan (no user mutations)
  vmInst.context.detectAndIncrementCaseRevisions({ skipCloud: true });

  // localRevision MUST remain 69
  assert.equal(
    vmInst.context.state.cases[0].localRevision,
    69,
    "Pure clean reload without case modification must NOT increment localRevision"
  );

  // Outbox MUST remain empty
  const outboxAfter = await vmInst.context.loadDurableOutboxOperations();
  assert.equal(outboxAfter.length, 0, "Clean reload must NOT schedule any outbox or cloud mutation");
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

console.log(`\nSYNC-002.1 TEST SUITE: ${passedCount}/${tests.length} TESTS PASSED`);
if (failedCount > 0) {
  process.exit(1);
}
