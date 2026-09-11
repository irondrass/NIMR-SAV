import test from "node:test";
import assert from "node:assert/strict";
import { createNimrVmContext } from "./helpers/nimr_vm_context.mjs";
import { createMemoryIndexedDb } from "./helpers/memory_indexeddb.mjs";

const WORKSHOP_ID = "00000000-0000-0000-0000-000000000001";

function createTestHarness(sharedStorage = null, sharedIdb = null) {
  const localStorage = (sharedStorage && sharedStorage.values instanceof Map)
    ? Object.fromEntries(sharedStorage.values.entries())
    : (sharedStorage || undefined);
  const contract = createNimrVmContext({
    localStorage,
    scriptFiles: [
      "../../js/utils.js",
      "../../js/state.js",
      "../../js/storage.js",
      "../../js/supabase-config.js",
      "../../js/supabase-client.js",
      "../../js/supabase-sync.js",
      "../../js/ui-cases.js",
      "../../app.js",
    ],
    console: { ...console, warn() {}, error() {} },
  });
  const ctx = contract.context;
  if (sharedIdb) ctx.indexedDB = sharedIdb;
  ctx.getSupabaseWorkshopId = () => WORKSHOP_ID;
  ctx.isSupabaseConfigured = () => true;
  ctx.guardSensitiveAction = () => ({ ok: true });
  ctx.hasPermission = () => true;
  ctx.navigator.onLine = true;
  ctx.getSupabaseUser = async () => ({ id: "user-test", email: "test@example.com" });
  ctx.render = () => {};
  ctx.setSupabaseStatus = () => {};
  ctx.setSupabaseDetails = () => {};
  ctx.quietNotify = () => {};
  ctx.notifyUser = () => {};
  ctx.renderSupabaseSyncHealth = async () => {};
  ctx.createSyncSafetySnapshot = async () => ({ ok: true });

  contract.run(`
    window.__setAppState = function(s) { state = s; return state; };
    window.__getAppState = function() { return state; };
  `);
  return { contract, ctx, localStorage: contract.localStorage };
}

// --------------------------------------------------------------------------
// 1. Clean reload idempotency after an acknowledged workshop_settings sync
// --------------------------------------------------------------------------
test("1. Clean reload idempotency: unchanged state must not enqueue workshop_settings outbox mutation after reload", async () => {
  const sharedIdb = createMemoryIndexedDb();
  const h1 = createTestHarness(null, sharedIdb);
  const state1 = h1.ctx.__getAppState();
  state1.settings = { companyName: "NIMR", taxRate: 19 };
  state1.holidays = [{ date: "2026-10-15", label: "Fête de l'Évacuation" }];
  state1.resources = [{ id: "tech-1", name: "Technicien 1" }];

  await h1.ctx.saveState({ skipSnapshot: true });
  let outbox1 = await h1.ctx.loadDurableOutboxOperations();
  assert.ok(outbox1.length >= 1, "initial save must generate outbox operation");

  // Acknowledge the batch with its settings fingerprint
  const payload1 = h1.ctx.buildWorkshopSettingsPayload(state1);
  const fp1 = h1.ctx.getWorkshopSettingsPayloadFingerprint(payload1);
  h1.ctx.acknowledgeEntityMutationBatch([], {
    workshopSettings: { settingsFingerprint: fp1 },
  });

  // Flush acknowledged operations
  for (const op of outbox1) await h1.ctx.deleteDurableOutboxOperation(op.operationId);
  outbox1 = await h1.ctx.loadDurableOutboxOperations();
  assert.equal(outbox1.length, 0, "outbox must be empty after flush");

  // Reload application into a fresh VM sharing localStorage & IndexedDB
  const h2 = createTestHarness(h1.localStorage, sharedIdb);
  const state2 = h2.ctx.__getAppState();
  state2.settings = { companyName: "NIMR", taxRate: 19 };
  state2.holidays = [{ date: "2026-10-15", label: "Fête de l'Évacuation" }];
  state2.resources = [{ id: "tech-1", name: "Technicien 1" }];

  // Save state on boot without any user modifications
  await h2.ctx.saveState({ skipSnapshot: true });
  const outbox2 = await h2.ctx.loadDurableOutboxOperations();
  const settingsOps = outbox2.filter((op) => op.entityType === "workshop_settings");

  // DEFECT REPRODUCTION ASSERTION:
  // On clean reload with unchanged settings, 0 workshop_settings mutations should be queued.
  // FAILS on HEAD because durableWorkshopSettingsFingerprint resets to "" on reload.
  assert.equal(settingsOps.length, 0, "clean reload must be idempotent and generate 0 workshop_settings outbox operations");
});

// --------------------------------------------------------------------------
// 2. Durable acknowledged fingerprint restoration across reload
// --------------------------------------------------------------------------
test("2. Durable acknowledged fingerprint: restored baseline prevents false-dirty trigger without cloud sync", async () => {
  const sharedIdb = createMemoryIndexedDb();
  const h1 = createTestHarness(null, sharedIdb);
  const state1 = h1.ctx.__getAppState();
  state1.settings = { companyName: "NIMR Carrosserie", taxRate: 19 };

  await h1.ctx.saveState({ skipSnapshot: true });
  const payload1 = h1.ctx.buildWorkshopSettingsPayload(state1);
  const fp1 = h1.ctx.getWorkshopSettingsPayloadFingerprint(payload1);
  h1.ctx.acknowledgeEntityMutationBatch([], {
    workshopSettings: { settingsFingerprint: fp1 },
  });

  // Reload into VM2
  const h2 = createTestHarness(h1.localStorage, sharedIdb);
  const state2 = h2.ctx.__getAppState();
  state2.settings = { companyName: "NIMR Carrosserie", taxRate: 19 };

  // DEFECT REPRODUCTION ASSERTION:
  // markWorkshopSettingsCloudDirty must return null because the payload matches the acknowledged baseline.
  // FAILS on HEAD because durableWorkshopSettingsFingerprint is not durably restored and starts as "".
  const dirtyDescriptor = h2.ctx.markWorkshopSettingsCloudDirty(h2.ctx.buildWorkshopSettingsPayload(state2));
  assert.equal(dirtyDescriptor, null, "markWorkshopSettingsCloudDirty must return null for unedited restored settings");
});

// --------------------------------------------------------------------------
// 3. Missing-fingerprint safety: do not assume local payload is acknowledged if dirty edit occurs
// --------------------------------------------------------------------------
test("3. Missing-fingerprint safety: genuine edits must trigger dirty detection when metadata is absent or state changes", async () => {
  const h = createTestHarness();
  const state = h.ctx.__getAppState();
  state.settings = { companyName: "NIMR Initial", taxRate: 19 };

  // User genuinely modifies settings
  state.settings.companyName = "NIMR Modified";
  const payload = h.ctx.buildWorkshopSettingsPayload(state);
  const dirtyDescriptor = h.ctx.markWorkshopSettingsCloudDirty(payload);

  // CONTROL ASSERTION:
  // Genuine user modifications must be detected as dirty and return a mutation descriptor.
  assert.ok(dirtyDescriptor, "genuine settings modification must produce a dirty mutation descriptor");
  assert.equal(dirtyDescriptor.entityId, "workshop_settings");
});

// --------------------------------------------------------------------------
// 4. Conflicted outbox item must not provide baseVersion when newer observed server version exists
// --------------------------------------------------------------------------
test("4. Conflicted baseVersion isolation: conflicted outbox operation must not shadow newer observed server version", async () => {
  const sharedIdb = createMemoryIndexedDb();
  const h = createTestHarness(null, sharedIdb);

  // Inject a conflicted outbox operation with stale baseVersion: 10
  await h.ctx.putDurableOutboxOperation({
    operationId: "op-conflicted-stale",
    workshopId: WORKSHOP_ID,
    entityType: "workshop_settings",
    entityId: "workshop_settings",
    syncStatus: "conflicted",
    baseVersion: 10,
    expectedVersion: 10,
    payload: { entity: {} },
  });

  // Set observed server version to 25
  await h.ctx.rememberObservedGranularEntityMetadata({
    workshopId: WORKSHOP_ID,
    entityType: "workshop_settings",
    entityId: "workshop_settings",
    serverVersion: 25,
    lastOperationId: "op-server-25",
  });

  const baseVersion = h.ctx.getMutationBaseVersion(WORKSHOP_ID, "workshop_settings", "workshop_settings");

  // DEFECT REPRODUCTION ASSERTION:
  // getMutationBaseVersion must return the newer observed server version (25), NOT the stale rejected version (10).
  // FAILS on HEAD because DURABLE_OUTBOX_ACTIVE_SYNC_STATUSES matches 'conflicted' and returns 10.
  assert.equal(baseVersion, 25, "getMutationBaseVersion must ignore conflicted operations and return observed server version 25");
});

// --------------------------------------------------------------------------
// 5. Reload with existing conflict must not generate another duplicate operation
// --------------------------------------------------------------------------
test("5. Conflict reload deduplication: reload with an existing conflicted operation must not stack a second operation", async () => {
  const sharedIdb = createMemoryIndexedDb();
  const h1 = createTestHarness(null, sharedIdb);

  const seedPayload = h1.ctx.buildWorkshopSettingsPayload(h1.ctx.__getAppState());
  const seedFp = h1.ctx.getWorkshopSettingsPayloadFingerprint(seedPayload);
  await h1.ctx.putDurableOutboxOperation({
    operationId: "op-conflicted-seed",
    workshopId: WORKSHOP_ID,
    entityType: "workshop_settings",
    entityId: "workshop_settings",
    syncStatus: "conflicted",
    baseVersion: 10,
    expectedVersion: 10,
    snapshotFingerprint: seedFp,
    payload: { entity: seedPayload },
  });

  const outboxBefore = await h1.ctx.loadDurableOutboxOperations();
  assert.equal(outboxBefore.length, 1, "should start with exactly 1 conflicted operation");

  // Reload application into VM2
  const h2 = createTestHarness(h1.localStorage, sharedIdb);
  await h2.ctx.saveState({ skipSnapshot: true });

  const outboxAfter = await h2.ctx.loadDurableOutboxOperations();
  const settingsOps = outboxAfter.filter((op) => op.entityType === "workshop_settings");

  // DEFECT REPRODUCTION ASSERTION:
  // After reload, total workshop_settings operations must remain 1.
  // FAILS on HEAD because saveState() pushes a second operation with syncStatus 'pending'.
  assert.equal(settingsOps.length, 1, "reload with existing conflict must not queue a duplicate pending operation");
});

// --------------------------------------------------------------------------
// 6. Conflict coverage reconciliation determinism
// --------------------------------------------------------------------------
test("6. Conflict coverage determinism: multiple duplicate outbox operations fail coverage check cleanly", async () => {
  const h = createTestHarness();

  // Create 3 duplicate outbox operations for workshop_settings
  const duplicateOps = [
    { operationId: "op-dup-1", conflictId: "cf-1" },
    { operationId: "op-dup-2", conflictId: "cf-1" }, // Duplicate server conflict ID
    { operationId: "op-dup-3", conflictId: "" },     // Missing server conflict ID
  ];

  const mockClient = {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
      }),
    }),
  };

  // CONTROL ASSERTION:
  // establishServerConflictCoverage must reject ambiguous/duplicate operations deterministically.
  await assert.rejects(
    async () => {
      await h.ctx.establishServerConflictCoverage(mockClient, WORKSHOP_ID, duplicateOps);
    },
    /Couverture des conflits serveur incomplète/,
    "duplicate/missing operations must fail coverage check deterministically",
  );
});

// --------------------------------------------------------------------------
// 7. Genuine user edit while conflict exists does not silently overwrite conflicted operation
// --------------------------------------------------------------------------
test("7. Conflict preservation: user edit while conflict exists preserves original conflicted operation audit", async () => {
  const sharedIdb = createMemoryIndexedDb();
  const h = createTestHarness(null, sharedIdb);

  const conflictedOp = {
    operationId: "op-conflict-audit-preserve",
    workshopId: WORKSHOP_ID,
    entityType: "workshop_settings",
    entityId: "workshop_settings",
    syncStatus: "conflicted",
    baseVersion: 10,
    expectedVersion: 10,
    payload: { entity: { companyName: "Original Conflicted Name" } },
  };
  await h.ctx.putDurableOutboxOperation(conflictedOp);

  // User edits settings
  const state = h.ctx.__getAppState();
  state.settings.companyName = "User Fresh Edit";

  const records = await h.ctx.loadDurableOutboxOperations();
  const foundConflicted = records.find((op) => op.operationId === "op-conflict-audit-preserve");

  // CONTROL ASSERTION:
  // The conflicted operation must not be mutated in-place or erased from outbox.
  assert.ok(foundConflicted, "conflicted operation must remain in outbox");
  assert.equal(foundConflicted.syncStatus, "conflicted", "conflicted status must not be silently recycled to pending");
  assert.equal(foundConflicted.payload?.entity?.companyName, "Original Conflicted Name", "original payload must remain intact");
});

// --------------------------------------------------------------------------
// 8. keep_local conflict resolution must preserve complete payload: settings, workHours, holidays, resources
// --------------------------------------------------------------------------
test("8. keep_local payload completeness: conflict resolution must preserve workHours, holidays, and resources", async () => {
  const sharedIdb = createMemoryIndexedDb();
  const h = createTestHarness(null, sharedIdb);
  const state = h.ctx.__getAppState();
  state.settings = { companyName: "NIMR Auto", taxRate: 19 };
  state.holidays = [{ date: "2026-10-15", label: "Fête de l'Évacuation" }];
  state.resources = [{ id: "tech-1", name: "Technicien 1", role: "technicien" }];

  const oldOp = {
    operationId: "op-conflicted-payload-test",
    workshopId: WORKSHOP_ID,
    entityType: "workshop_settings",
    entityId: "workshop_settings",
    syncStatus: "conflicted",
    baseVersion: 10,
    expectedVersion: 10,
    conflictId: "cf-payload-1",
    payload: {
      entity: {
        settings: { companyName: "NIMR Auto", taxRate: 19 },
      },
    },
  };
  await h.ctx.putDurableOutboxOperation(oldOp);

  let replacementQueued = null;
  h.ctx.enqueueReplacementOutboxOperation = async (replacement) => {
    replacementQueued = replacement;
    return replacement;
  };

  const mockClient = {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { id: "cf-payload-1", workshop_id: WORKSHOP_ID, local_operation_id: "op-conflicted-payload-test" },
              error: null,
            }),
          }),
        }),
      }),
    }),
  };
  h.ctx.getSupabaseClient = () => mockClient;
  h.ctx.fetchCurrentCanonicalForConflict = async () => ({
    entity_version: 15,
    last_operation_id: "op-server-15",
    value: { settings: { companyName: "Cloud Name" } },
  });

  await h.ctx.resolveCanonicalConcurrencyConflict(
    {
      id: "cf-payload-1",
      conflictIds: ["cf-payload-1"],
      operationId: "op-conflicted-payload-test",
      entityType: "workshop_settings",
      entityId: "workshop_settings",
    },
    "keep_local",
  );

  assert.ok(replacementQueued, "keep_local must queue a replacement operation");

  // DEFECT REPRODUCTION ASSERTIONS:
  // keep_local must preserve settings, workHours, holidays, and resources.
  // FAILS on HEAD because lines 4558-4562 only assign state.settings to payload.entity,
  // completely dropping workHours, holidays, and resources.
  assert.ok(replacementQueued.payload?.entity?.workHours, "replacement payload must include workHours");
  assert.ok(replacementQueued.payload?.entity?.holidays, "replacement payload must include holidays");
  assert.ok(replacementQueued.payload?.entity?.resources, "replacement payload must include resources");
});

// --------------------------------------------------------------------------
// 9. Genuine edit during unresolved conflict: preserved exactly once, immutable history, proceeds after resolution
// --------------------------------------------------------------------------
test("9. Genuine edit during unresolved conflict: preserved exactly once, immutable history, proceeds after resolution", async () => {
  const sharedIdb = createMemoryIndexedDb();
  const h1 = createTestHarness(null, sharedIdb);
  const state1 = h1.ctx.__getAppState();
  state1.settings = { companyName: "NIMR Base", taxRate: 19 };
  const payload1 = h1.ctx.buildWorkshopSettingsPayload(state1);
  const fp1 = h1.ctx.getWorkshopSettingsPayloadFingerprint(payload1);

  // 1. Existing workshop_settings operation is conflicted
  await h1.ctx.putDurableOutboxOperation({
    operationId: "op-conflicted-original",
    workshopId: WORKSHOP_ID,
    entityType: "workshop_settings",
    entityId: "workshop_settings",
    syncStatus: "conflicted",
    baseVersion: 10,
    expectedVersion: 10,
    snapshotFingerprint: fp1,
    payload: { entity: payload1 },
  });

  // 2. Reload unchanged state
  const h2 = createTestHarness(h1.localStorage, sharedIdb);
  const state2 = h2.ctx.__getAppState();
  state2.settings = { companyName: "NIMR Base", taxRate: 19 };
  await h2.ctx.saveState({ skipSnapshot: true });

  // 3. Assert no duplicate operation is created
  let outbox = await h2.ctx.loadDurableOutboxOperations();
  let settingsOps = outbox.filter((op) => op.entityType === "workshop_settings");
  assert.equal(settingsOps.length, 1, "unchanged state on reload must not create duplicate operation");
  assert.equal(settingsOps[0].operationId, "op-conflicted-original");
  assert.equal(settingsOps[0].syncStatus, "conflicted");

  // 4. User genuinely changes workshop settings while conflict remains unresolved
  state2.settings.companyName = "NIMR Genuinely Modified While Conflicted";

  // 5. Persist/save repeatedly
  await h2.ctx.saveState({ skipSnapshot: true });
  await h2.ctx.saveState({ skipSnapshot: true });
  await h2.ctx.saveState({ skipSnapshot: true });

  // 6. Assert the new edit is durably represented exactly once and the conflicted historical operation remains unchanged
  outbox = await h2.ctx.loadDurableOutboxOperations();
  settingsOps = outbox.filter((op) => op.entityType === "workshop_settings");
  assert.equal(settingsOps.length, 2, "genuine edit must be represented exactly once alongside conflicted op");
  const originalOp = settingsOps.find((op) => op.operationId === "op-conflicted-original");
  const successorOp = settingsOps.find((op) => op.operationId !== "op-conflicted-original");
  assert.ok(originalOp, "original conflicted op must exist");
  assert.equal(originalOp.syncStatus, "conflicted", "original conflicted op must remain conflicted");
  assert.equal(originalOp.payload?.entity?.settings?.companyName, "NIMR Base", "original conflicted op must be immutable");
  assert.ok(successorOp, "successor edit op must exist");
  assert.equal(successorOp.syncStatus, "pending", "successor edit must be pending");
  assert.equal(successorOp.payload?.entity?.settings?.companyName, "NIMR Genuinely Modified While Conflicted");

  // 7. Simulate reload
  const h3 = createTestHarness(h2.localStorage, sharedIdb);
  const state3 = h3.ctx.__getAppState();
  state3.settings = { companyName: "NIMR Genuinely Modified While Conflicted", taxRate: 19 };
  await h3.ctx.saveState({ skipSnapshot: true });

  // 8. Assert the genuine edit is still preserved
  outbox = await h3.ctx.loadDurableOutboxOperations();
  settingsOps = outbox.filter((op) => op.entityType === "workshop_settings");
  assert.equal(settingsOps.length, 2, "reload must preserve both operations without stacking another");
  assert.ok(settingsOps.find((op) => op.operationId === "op-conflicted-original"), "original conflicted op survives reload");
  assert.ok(settingsOps.find((op) => op.operationId === successorOp.operationId), "successor edit survives reload");

  // 9. Resolve the original conflict
  await h3.ctx.rememberObservedGranularEntityMetadata({
    workshopId: WORKSHOP_ID,
    entityType: "workshop_settings",
    entityId: "workshop_settings",
    serverVersion: 30,
    lastOperationId: "op-server-30",
  });
  await h3.ctx.acknowledgeDurableOutboxOperation("op-conflicted-original");

  // 10. Assert the newer edit can proceed using the latest trusted server version and is not lost
  outbox = await h3.ctx.loadDurableOutboxOperations();
  settingsOps = outbox.filter((op) => op.entityType === "workshop_settings");
  assert.equal(settingsOps.length, 1, "conflicted op resolved/cleared; successor edit remains");
  assert.equal(settingsOps[0].operationId, successorOp.operationId, "successor edit remains intact in outbox");
  const currentBaseVersion = h3.ctx.getMutationBaseVersion(WORKSHOP_ID, "workshop_settings", "workshop_settings");
  assert.equal(currentBaseVersion, 30, "newer edit can proceed using the latest trusted server version (30)");
});

// --------------------------------------------------------------------------
// 10. Sendable-status / baseVersion contract: stale failed/conflicted cannot override newer observed server version
// --------------------------------------------------------------------------
test("10. Sendable-status baseVersion contract: stale failed/conflicted operations cannot override newer observed server version", async () => {
  const sharedIdb = createMemoryIndexedDb();
  const h = createTestHarness(null, sharedIdb);

  // Inject a stale failed operation with baseVersion 5
  await h.ctx.putDurableOutboxOperation({
    operationId: "op-failed-stale",
    workshopId: WORKSHOP_ID,
    entityType: "workshop_settings",
    entityId: "workshop_settings",
    syncStatus: "failed",
    baseVersion: 5,
    expectedVersion: 5,
    payload: { entity: {} },
  });

  // Inject a stale conflicted operation with baseVersion 8
  await h.ctx.putDurableOutboxOperation({
    operationId: "op-conflicted-stale",
    workshopId: WORKSHOP_ID,
    entityType: "workshop_settings",
    entityId: "workshop_settings",
    syncStatus: "conflicted",
    baseVersion: 8,
    expectedVersion: 8,
    payload: { entity: {} },
  });

  // Set newer observed server version to 42
  await h.ctx.rememberObservedGranularEntityMetadata({
    workshopId: WORKSHOP_ID,
    entityType: "workshop_settings",
    entityId: "workshop_settings",
    serverVersion: 42,
    lastOperationId: "op-server-42",
  });

  const baseVersion = h.ctx.getMutationBaseVersion(WORKSHOP_ID, "workshop_settings", "workshop_settings");
  assert.equal(baseVersion, 42, "observed server version (42) must override stale failed (5) and conflicted (8) baseVersions");
});

// --------------------------------------------------------------------------
// 11. Acknowledged fingerprint lifecycle negative proof: pre-ack steps do not advance durable fingerprint
// --------------------------------------------------------------------------
test("11. Acknowledged fingerprint lifecycle negative proof: pre-ack steps never advance durable fingerprint", async () => {
  const sharedIdb = createMemoryIndexedDb();
  const h = createTestHarness(null, sharedIdb);
  const state = h.ctx.__getAppState();
  state.settings = { companyName: "NIMR Fingerprint Lifecycle", taxRate: 19 };

  // Helper to read currently persisted fingerprint from storage
  const getPersistedFp = () => h.ctx.readPersistedAcknowledgedWorkshopSettingsFingerprint();

  // Baseline: no fingerprint persisted
  assert.equal(getPersistedFp(), "", "initially no acknowledged fingerprint must be persisted");

  // Step A: saveState() generates a dirty mutation and enqueues outbox operation
  await h.ctx.saveState({ skipSnapshot: true });
  assert.equal(getPersistedFp(), "", "saveState() must NOT advance durable acknowledged fingerprint");

  // Step B: Outbox operation exists in pending status
  const outbox = await h.ctx.loadDurableOutboxOperations();
  const pendingOp = outbox.find((op) => op.entityType === "workshop_settings");
  assert.ok(pendingOp, "pending outbox operation must exist");
  assert.equal(getPersistedFp(), "", "outbox enqueue must NOT advance durable acknowledged fingerprint");

  // Step C: Conflict creation (CAS mismatch)
  await h.ctx.conflictDurableOutboxOperationAtomically(pendingOp.operationId, {
    workshopId: WORKSHOP_ID,
    entityType: "workshop_settings",
    entityId: "workshop_settings",
    serverVersion: 2,
    lastOperationId: "op-remote-2",
  }, {
    conflictId: "cf-test-lifecycle",
    serverVersion: 2,
    baseVersion: 1,
  });
  assert.equal(getPersistedFp(), "", "conflict creation must NOT advance durable acknowledged fingerprint");

  // Step D: Genuine cloud acknowledgement (the ONLY valid advancement path)
  const payload = h.ctx.buildWorkshopSettingsPayload(state);
  const expectedFp = h.ctx.getWorkshopSettingsPayloadFingerprint(payload);
  await h.ctx.completeDurableOutboxOperationAtomically(pendingOp.operationId, {
    workshopId: WORKSHOP_ID,
    entityType: "workshop_settings",
    entityId: "workshop_settings",
    serverVersion: 3,
    lastOperationId: pendingOp.operationId,
  }, {
    status: "accepted",
    accepted: true,
    updatedAt: new Date().toISOString(),
  });
  assert.equal(getPersistedFp(), expectedFp, "durable acknowledged fingerprint must advance ONLY after genuine cloud acknowledgement");
});
