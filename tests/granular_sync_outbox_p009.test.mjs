import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createNimrVmContext } from "./helpers/nimr_vm_context.mjs";
import { createGranularSupabaseAdapter } from "./helpers/granular_supabase_adapter.mjs";
import { createMemoryIndexedDb } from "./helpers/memory_indexeddb.mjs";

const { context, localStorage, run } = createNimrVmContext();
localStorage.clear();

const requiredApi = [
  "captureEntityMutationBatch",
  "acknowledgeEntityMutationBatch",
  "acknowledgeDurableOutboxOperation",
  "sortDurableOutboxOperationsForSend",
  "selectGranularRowsAfterCursor",
  "buildDurableOperationFromEntityMutation",
];
for (const name of requiredApi) {
  assert.equal(typeof context[name], "function", `P0-009 API absente: ${name}`);
}

const base = {
  workshopId: "workshop-a",
  userId: "user-a",
  syncStatus: "pending",
  retryCount: 0,
};
const caseOperation = (id, revision, marker = revision, action = "upsert") => ({
  ...base,
  operationId: `case-${id}-${revision}-${action}`,
  idempotencyKey: `workshop-a:case:${id}:${revision}:${action}`,
  entityType: "case",
  entityId: id,
  action,
  entityVersion: revision,
  expectedVersion: Math.max(0, revision - 1),
  updatedAt: `2026-08-22T10:00:${String(revision % 60).padStart(2, "0")}.000Z`,
  payload: action === "delete" ? {} : { entity: { id, localRevision: revision, nested: { marker } } },
});
const bookingOperation = (id, revision, action = "upsert") => ({
  ...base,
  operationId: `booking-${id}-${revision}-${action}`,
  idempotencyKey: `workshop-a:booking:${id}:${revision}:${action}`,
  entityType: "booking",
  entityId: id,
  action,
  entityVersion: revision,
  payload: action === "delete" ? {} : {
    entity: {
      id,
      caseId: "case-parent",
      resourceIds: ["resource-a"],
      primaryResourceId: "resource-a",
      start: "2026-08-22T08:00:00.000Z",
      end: "2026-08-22T09:00:00.000Z",
      segments: [{ start: "2026-08-22T08:00:00.000Z", end: "2026-08-22T09:00:00.000Z" }],
      notes: { technician: "stable" },
      photoIds: ["photo-metadata-only"],
      blocked: false,
      temporary: false,
    },
  },
});

// Characterization: durable fallback survives a reload and failures remain pending.
await context.putDurableOutboxOperation({
  ...caseOperation("reload", 1),
  syncStatus: "failed",
  retryCount: 2,
  lastError: "network",
});
let records = await context.loadDurableOutboxOperations();
assert.equal(records.length, 1);
assert.equal(records[0].syncStatus, "failed");
assert.equal(records[0].retryCount, 2);
assert.equal(records[0].lastError, "network");
await context.deleteDurableOutboxOperation(records[0].operationId);
assert.equal((await context.loadDurableOutboxOperations()).length, 0);

// Legacy snapshot records remain readable and retain their documented coalescing.
await context.enqueueDurableOutboxOperation({
  ...base,
  operationId: "legacy-1",
  entityType: "workshop_state",
  entityId: "workshop-a",
  action: "upsert_snapshot",
  snapshotFingerprint: "legacy-v1",
  payload: { snapshotFingerprint: "legacy-v1", marker: "A" },
});
await context.enqueueDurableOutboxOperation({
  ...base,
  operationId: "legacy-2",
  entityType: "workshop_state",
  entityId: "workshop-a",
  action: "upsert_snapshot",
  snapshotFingerprint: "legacy-v2",
  payload: { snapshotFingerprint: "legacy-v2", marker: "B" },
});
records = await context.loadDurableOutboxOperations();
assert.equal(records.length, 1);
assert.equal(records[0].payload.marker, "B");
await context.deleteDurableOutboxOperation(records[0].operationId);

// One case upsert, latest-upsert coalescing, immutable snapshots, and entity isolation.
const mutableCase = caseOperation("one", 1);
await context.enqueueDurableOutboxOperation(mutableCase);
mutableCase.payload.entity.nested.marker = "mutated-after-enqueue";
records = await context.loadDurableOutboxOperations();
assert.equal(records[0].payload.entity.nested.marker, 1, "outbox payload must be immutable");
await context.enqueueDurableOutboxOperation(caseOperation("one", 2));
await context.enqueueDurableOutboxOperation(caseOperation("two", 1));
await context.enqueueDurableOutboxOperation(bookingOperation("one", 1));
await context.enqueueDurableOutboxOperation({ ...caseOperation("one", 3), workshopId: "workshop-b" });
records = await context.loadDurableOutboxOperations();
assert.equal(records.filter((entry) => entry.workshopId === "workshop-a" && entry.entityType === "case" && entry.entityId === "one").length, 1);
assert.equal(records.find((entry) => entry.workshopId === "workshop-a" && entry.entityType === "case" && entry.entityId === "one").entityVersion, 2);
assert.equal(records.length, 4, "IDs, types, and workshops must never cross-coalesce");

// upsert -> delete -> recreated upsert has deterministic final semantics.
await context.enqueueDurableOutboxOperation(caseOperation("transition", 1));
await context.enqueueDurableOutboxOperation(caseOperation("transition", 2, 2, "delete"));
records = await context.loadDurableOutboxOperations();
let transition = records.find((entry) => entry.entityId === "transition");
assert.equal(transition.action, "delete");
assert.deepEqual(transition.payload, {});
await context.enqueueDurableOutboxOperation(caseOperation("transition", 3));
records = await context.loadDurableOutboxOperations();
transition = records.find((entry) => entry.entityId === "transition");
assert.equal(transition.action, "upsert");
assert.equal(transition.entityVersion, 3);
assert.equal(transition.payload.entity.localRevision, 3);

// P0-010 mutable captures no longer manufacture a target server version.
// Until a canonical row is observed, create/update/delete carry an unknown
// base and the server decides whether creation is admissible or conflicts.
const versionedEntity = { id: "captured-transition", localRevision: 7, updatedAt: "2026-08-22T10:00:00.000Z" };
context.markEntityCaseDirty(versionedEntity);
let capturedTransition = context.captureEntityMutationBatch({ cases: [versionedEntity], bookings: [] })
  .find((entry) => entry.entityId === versionedEntity.id);
assert.equal(capturedTransition.entityVersion, null);
assert.equal(capturedTransition.baseVersion, null);
context.markEntityCaseDeleted(versionedEntity.id);
capturedTransition = context.captureEntityMutationBatch({ cases: [], bookings: [] })
  .find((entry) => entry.entityId === versionedEntity.id);
assert.equal(capturedTransition.entityVersion, null);
assert.equal(capturedTransition.baseVersion, null);
context.markEntityCaseDirty({ ...versionedEntity, localRevision: 1 });
capturedTransition = context.captureEntityMutationBatch({ cases: [{ ...versionedEntity, localRevision: 1 }], bookings: [] })
  .find((entry) => entry.entityId === versionedEntity.id);
assert.equal(capturedTransition.entityVersion, null);
assert.equal(capturedTransition.baseVersion, null);
context.acknowledgeEntityMutationBatch([capturedTransition]);

// Booking update/delete follows the same bounded rules.
await context.enqueueDurableOutboxOperation(bookingOperation("booking-update", 1));
await context.enqueueDurableOutboxOperation(bookingOperation("booking-update", 2));
await context.enqueueDurableOutboxOperation(bookingOperation("booking-delete", 1));
await context.enqueueDurableOutboxOperation(bookingOperation("booking-delete", 2, "delete"));
records = await context.loadDurableOutboxOperations();
assert.equal(records.filter((entry) => entry.entityType === "booking" && entry.entityId === "booking-update").length, 1);
assert.equal(records.find((entry) => entry.entityId === "booking-delete").action, "delete");

// Audit is append-only; duplicate operationId is idempotent, distinct events do not coalesce.
const auditBase = {
  ...base,
  entityType: "audit",
  action: "append",
  entityVersion: 1,
};
await context.enqueueDurableOutboxOperation({ ...auditBase, operationId: "audit-op-1", idempotencyKey: "workshop-a:audit:event-1", entityId: "event-1", payload: { entity: { id: "event-1", type: "case.changed" } } });
await context.enqueueDurableOutboxOperation({ ...auditBase, operationId: "audit-op-1", idempotencyKey: "workshop-a:audit:event-1", entityId: "event-1", payload: { entity: { id: "event-1", type: "case.changed" } } });
await context.enqueueDurableOutboxOperation({ ...auditBase, operationId: "audit-op-2", idempotencyKey: "workshop-a:audit:event-2", entityId: "event-2", payload: { entity: { id: "event-2", type: "case.changed" } } });
records = await context.loadDurableOutboxOperations();
assert.equal(records.filter((entry) => entry.entityType === "audit").length, 2);

// Deterministic adapter: retries are idempotent for entity, audit, and delete.
const adapter = createGranularSupabaseAdapter();
const idempotentCase = caseOperation("adapter-case", 4);
adapter.send(idempotentCase);
const onceSnapshot = adapter.snapshot();
adapter.send(idempotentCase);
assert.deepEqual(adapter.snapshot().entities, onceSnapshot.entities);
const idempotentAudit = { ...auditBase, operationId: "audit-idempotent", entityId: "audit-idempotent", payload: { entity: { id: "audit-idempotent", type: "retry" } } };
adapter.send(idempotentAudit);
adapter.send(idempotentAudit);
assert.equal(adapter.audits.size, 1);
const durableDelete = caseOperation("adapter-delete", 8, 8, "delete");
adapter.send(durableDelete);
adapter.send(durableDelete);
adapter.send(caseOperation("adapter-delete", 7));
assert.equal(adapter.entities.get("workshop-a|case|adapter-delete").deleted, true, "stale upsert must not resurrect a newer tombstone");

// The deterministic Supabase client models the production order: canonical
// RPC first, then repair_orders projection reconciliation.
const projectionVm = createNimrVmContext({ filename: "p0-009-canonical-projection.js" });
projectionVm.context.getSupabaseWorkshopId = () => "workshop-a";
vm.runInContext(fs.readFileSync(new URL("../js/supabase-sync.js", import.meta.url), "utf8"), projectionVm.context, { filename: "supabase-sync-projection-p009.js" });
const expectedProjectionLocalId = "case-or:or-90001";
const projectionOperation = (id, version, marker, action = "upsert", operationId = `projection-${id}-${version}-${action}`, baseVersion = null) => ({
  ...caseOperation(id, version, marker, action),
  operationId,
  baseVersion,
  payload: action === "delete" ? { projectionLocalId: expectedProjectionLocalId } : {
    entity: {
      id,
      orNavNumber: "OR-90001",
      localRevision: version,
      nextAction: marker,
      durations: {},
    },
  },
});
const sendProjectionOperation = (adapterInstance, operation) => projectionVm.context.sendGranularOutboxOperation(
  adapterInstance.client,
  { id: "user-a" },
  operation,
);
const projectionAt = (adapterInstance, localId) => adapterInstance.projection("workshop-a", localId);
const projectionCount = (adapterInstance) => adapterInstance.projectionCount("workshop-a");

const identityExample = projectionOperation("application-case-X", 100, "A");
assert.equal(projectionVm.context.caseSyncLocalId(identityExample.payload.entity), expectedProjectionLocalId);
assert.notEqual(identityExample.entityId, expectedProjectionLocalId, "canonical and reporting projection identities must differ in this characterization");

// Accepted active projection must use the existing structured projection ID,
// while all projected values still come from the canonical payload.
const acceptedIdentityAdapter = createGranularSupabaseAdapter();
const acceptedIdentityResult = await sendProjectionOperation(acceptedIdentityAdapter, identityExample);

// Characterize accepted deletion of a correctly keyed historical projection.
// Establish canonical U100, project it through the existing identity rule, then
// accept D200. Deleting by canonical entity_id would orphan the reporting row.
const acceptedDeleteAdapter = createGranularSupabaseAdapter();
const acceptedDeleteUpsert = projectionOperation("accepted-delete-X", 100, "A");
const acceptedDeleteSeed = await projectionVm.context.applyCanonicalSyncEntity(acceptedDeleteAdapter.client, acceptedDeleteUpsert);
await projectionVm.context.syncCaseProjectionToSupabase(acceptedDeleteAdapter.client, acceptedDeleteUpsert.payload.entity);
assert.equal(projectionAt(acceptedDeleteAdapter, expectedProjectionLocalId)?.next_action, "A", "accepted-delete precondition must use the real projection identity");
const acceptedDeleteResult = await sendProjectionOperation(
  acceptedDeleteAdapter,
  projectionOperation("accepted-delete-X", 200, "delete-200", "delete", undefined, acceptedDeleteSeed.server_version),
);

// Stale DELETE after a newer recreation must rebuild/preserve the active
// projection from canonical version 200, never delete it from local intent.
const staleDeleteAdapter = createGranularSupabaseAdapter();
const staleDeleteSeed = await sendProjectionOperation(staleDeleteAdapter, projectionOperation("stale-delete-X", 50, "A"));
const staleDeleteBase = staleDeleteSeed.serverVersion;
const staleDelete100 = projectionOperation("stale-delete-X", 100, "delete-100", "delete", undefined, staleDeleteBase);
await sendProjectionOperation(staleDeleteAdapter, projectionOperation("stale-delete-X", 200, "B", "upsert", undefined, staleDeleteBase));
const staleDeleteResult = await sendProjectionOperation(staleDeleteAdapter, staleDelete100);

// Stale UPSERT after a newer UPSERT must leave both canonical and projection B.
const staleUpsertAdapter = createGranularSupabaseAdapter();
const staleUpsertSeed = await sendProjectionOperation(staleUpsertAdapter, projectionOperation("stale-upsert-X", 50, "seed"));
const staleUpsertBase = staleUpsertSeed.serverVersion;
const acceptedUpsertResult = await sendProjectionOperation(staleUpsertAdapter, projectionOperation("stale-upsert-X", 200, "B", "upsert", undefined, staleUpsertBase));
const staleUpsertResult = await sendProjectionOperation(staleUpsertAdapter, projectionOperation("stale-upsert-X", 100, "A", "upsert", undefined, staleUpsertBase));

// Stale UPSERT after a newer tombstone must not recreate repair_orders.
const tombstoneAdapter = createGranularSupabaseAdapter();
const tombstoneUpsert = projectionOperation("tombstone-X", 100, "A");
const tombstoneSeed = await projectionVm.context.applyCanonicalSyncEntity(tombstoneAdapter.client, tombstoneUpsert);
await projectionVm.context.syncCaseProjectionToSupabase(tombstoneAdapter.client, tombstoneUpsert.payload.entity);
await sendProjectionOperation(tombstoneAdapter, projectionOperation("tombstone-X", 200, "delete-200", "delete", undefined, tombstoneSeed.server_version));
const tombstoneRetryResult = await sendProjectionOperation(tombstoneAdapter, projectionOperation("tombstone-X", 100, "A", "upsert", "tombstone-stale-U100", tombstoneSeed.server_version));

assert.deepEqual(
  {
    acceptedUpsert: {
      projectionCount: projectionCount(acceptedIdentityAdapter),
      projectionMarker: projectionAt(acceptedIdentityAdapter, expectedProjectionLocalId)?.next_action || null,
      projectionUnderCanonicalId: Boolean(projectionAt(acceptedIdentityAdapter, identityExample.entityId)),
    },
    acceptedDelete: {
      canonicalDeleted: Boolean(acceptedDeleteAdapter.canonical("workshop-a", "case", "accepted-delete-X")?.deleted_at),
      canonicalProjectionLocalId: acceptedDeleteAdapter.canonical("workshop-a", "case", "accepted-delete-X")?.payload?.projectionLocalId,
      projectionCount: projectionCount(acceptedDeleteAdapter),
      projectionPresent: Boolean(projectionAt(acceptedDeleteAdapter, expectedProjectionLocalId)),
    },
    staleDelete: {
      canonicalVersion: staleDeleteAdapter.canonical("workshop-a", "case", "stale-delete-X")?.entity_version,
      canonicalDeleted: Boolean(staleDeleteAdapter.canonical("workshop-a", "case", "stale-delete-X")?.deleted_at),
      projectionCount: projectionCount(staleDeleteAdapter),
      projectionMarker: projectionAt(staleDeleteAdapter, expectedProjectionLocalId)?.next_action || null,
      projectionVersion: projectionAt(staleDeleteAdapter, expectedProjectionLocalId)?.planning_version,
      projectionUnderCanonicalId: Boolean(projectionAt(staleDeleteAdapter, "stale-delete-X")),
    },
    staleUpsert: {
      canonicalMarker: staleUpsertAdapter.canonical("workshop-a", "case", "stale-upsert-X")?.payload?.nextAction,
      projectionCount: projectionCount(staleUpsertAdapter),
      projectionMarker: projectionAt(staleUpsertAdapter, expectedProjectionLocalId)?.next_action || null,
      projectionVersion: projectionAt(staleUpsertAdapter, expectedProjectionLocalId)?.planning_version,
      projectionUnderCanonicalId: Boolean(projectionAt(staleUpsertAdapter, "stale-upsert-X")),
    },
    tombstone: {
      canonicalDeleted: Boolean(tombstoneAdapter.canonical("workshop-a", "case", "tombstone-X")?.deleted_at),
      canonicalProjectionLocalId: tombstoneAdapter.canonical("workshop-a", "case", "tombstone-X")?.payload?.projectionLocalId,
      projectionCount: projectionCount(tombstoneAdapter),
      projectionPresent: Boolean(projectionAt(tombstoneAdapter, expectedProjectionLocalId)),
      projectionUnderCanonicalId: Boolean(projectionAt(tombstoneAdapter, "tombstone-X")),
    },
  },
  {
    acceptedUpsert: { projectionCount: 1, projectionMarker: "A", projectionUnderCanonicalId: false },
    acceptedDelete: { canonicalDeleted: true, canonicalProjectionLocalId: expectedProjectionLocalId, projectionCount: 0, projectionPresent: false },
    staleDelete: { canonicalVersion: staleDeleteBase + 1, canonicalDeleted: false, projectionCount: 1, projectionMarker: "B", projectionVersion: 200, projectionUnderCanonicalId: false },
    staleUpsert: { canonicalMarker: "B", projectionCount: 1, projectionMarker: "B", projectionVersion: 200, projectionUnderCanonicalId: false },
    tombstone: { canonicalDeleted: true, canonicalProjectionLocalId: expectedProjectionLocalId, projectionCount: 0, projectionPresent: false, projectionUnderCanonicalId: false },
  },
  "repair_orders must converge from the canonical RPC row under caseSyncLocalId identity without orphans or duplicates",
);
assert.equal(acceptedIdentityResult.accepted, true);
assert.equal(acceptedDeleteResult.accepted, true);
const acceptedDeleteRpc = acceptedDeleteAdapter.calls.find((call) => call.operation === "rpc" && call.operationId === "projection-accepted-delete-X-200-delete");
assert.deepEqual(acceptedDeleteRpc.rows[0].p_payload, { projectionLocalId: expectedProjectionLocalId }, "DELETE RPC must carry only bounded projection identity metadata");
assert.equal(acceptedUpsertResult.accepted, true);
assert.equal(staleDeleteResult.conflict, true);
assert.equal(staleUpsertResult.conflict, true);
assert.equal(tombstoneRetryResult.conflict, true);

// If canonical U200 succeeds but projection fails, the exact same operation
// remains failed and retries projection from the idempotently returned row.
const projectionRetryAdapter = createGranularSupabaseAdapter();
const projectionRetry = projectionOperation("projection-retry-X", 200, "B", "upsert", "projection-retry-U200");
await projectionVm.context.enqueueDurableOutboxOperation(projectionRetry);
projectionRetryAdapter.injectProjectionFailure({ message: "injected repair_orders failure" });
let projectionRetryResult = await projectionVm.context.processGranularOutboxOperation(
  projectionRetryAdapter.client,
  { id: "user-a" },
  projectionRetry,
);
assert.equal(projectionRetryResult.acknowledged, false);
let retainedProjectionRetry = (await projectionVm.context.loadDurableOutboxOperations())
  .find((entry) => entry.operationId === projectionRetry.operationId);
assert.equal(retainedProjectionRetry.syncStatus, "failed");
assert.equal(projectionRetryAdapter.canonical("workshop-a", "case", "projection-retry-X")?.last_operation_id, projectionRetry.operationId);
assert.equal(projectionAt(projectionRetryAdapter, expectedProjectionLocalId), null);
projectionRetryResult = await projectionVm.context.processGranularOutboxOperation(
  projectionRetryAdapter.client,
  { id: "user-a" },
  retainedProjectionRetry,
);
assert.equal(projectionRetryResult.acknowledged, true);
assert.equal(projectionAt(projectionRetryAdapter, expectedProjectionLocalId)?.next_action, "B");
assert.equal(projectionAt(projectionRetryAdapter, "projection-retry-X"), null);
assert.equal(projectionCount(projectionRetryAdapter), 1);
assert.equal((await projectionVm.context.loadDurableOutboxOperations()).some((entry) => entry.operationId === projectionRetry.operationId), false);

// Injected network and RLS failures keep the durable operation recoverable.
const retainedOnFailure = caseOperation("retained-failure", 1);
await context.enqueueDurableOutboxOperation(retainedOnFailure);
for (const injected of [
  { code: "NETWORK", message: "network unavailable" },
  { code: "42501", message: "RLS permission denied" },
]) {
  adapter.injectFailure(injected);
  assert.throws(() => adapter.send(retainedOnFailure), new RegExp(injected.message, "i"));
  await context.updateDurableOutboxOperation(retainedOnFailure.operationId, {
    syncStatus: "failed",
    retryCount: injected.code === "NETWORK" ? 1 : 2,
    lastError: injected.message,
  });
  const retained = (await context.loadDurableOutboxOperations()).find((entry) => entry.operationId === retainedOnFailure.operationId);
  assert.equal(retained.syncStatus, "failed");
  assert.equal(retained.lastError, injected.message);
}

// Operation-specific ack is independent from unrelated changes.
const ackTarget = records.find((entry) => entry.entityType === "case" && entry.entityId === "two");
await context.enqueueDurableOutboxOperation(caseOperation("unrelated", 1));
await context.acknowledgeDurableOutboxOperation(ackTarget.operationId, { updatedAt: "2026-08-22T11:00:00.000Z" });
records = await context.loadDurableOutboxOperations();
assert.equal(records.some((entry) => entry.operationId === ackTarget.operationId), false);
assert.equal(records.some((entry) => entry.entityId === "unrelated"), true);

// 10k edits to one offline case stay bounded.
for (let revision = 1; revision <= 10_000; revision += 1) {
  await context.enqueueDurableOutboxOperation(caseOperation("stress", revision));
}
records = await context.loadDurableOutboxOperations();
const stress = records.filter((entry) => entry.entityType === "case" && entry.entityId === "stress");
assert.equal(stress.length, 1);
assert.equal(stress[0].entityVersion, 10_000);

// Dependency ordering: parent case before booking upsert; booking delete before case delete.
const ordered = context.sortDurableOutboxOperationsForSend([
  bookingOperation("child", 1),
  caseOperation("parent", 1),
  caseOperation("delete-parent", 2, 2, "delete"),
  bookingOperation("delete-child", 2, "delete"),
]);
assert.deepEqual(
  ordered.map((entry) => `${entry.entityType}:${entry.action}`),
  ["case:upsert", "booking:upsert", "booking:delete", "case:delete"],
);

// Compound (updated_at, entity_id) cursor has no equal-timestamp gap.
const timestamp = "2026-08-22T12:00:00.000Z";
const cursorRows = ["a", "b", "c", "d"].map((entityId) => ({ updated_at: timestamp, entity_id: entityId }));
const pageOne = context.selectGranularRowsAfterCursor(cursorRows, null, 2);
const pageTwo = context.selectGranularRowsAfterCursor(cursorRows, pageOne.cursor, 2);
assert.deepEqual([...pageOne.rows, ...pageTwo.rows].map((row) => row.entity_id), ["a", "b", "c", "d"]);

// Instrument the real save path: case, booking, audit, settings and skipCloud.
for (const record of await context.loadDurableOutboxOperations()) await context.deleteDurableOutboxOperation(record.operationId);
let fullPathCalls = 0;
context.buildBackupPayload = async () => { fullPathCalls += 1; return {}; };
context.buildCloudBackupPayload = async () => { fullPathCalls += 1; return {}; };
context.cloneSyncStateSnapshot = () => { fullPathCalls += 1; return {}; };
context.getSyncStateFingerprint = () => { fullPathCalls += 1; return "forbidden"; };
context.buildWorkshopSettingsPayload = (candidate) => ({
  schemaVersion: 1,
  settings: { ...(candidate.settings || {}) },
  workHours: candidate.workHours || {},
  workHoursSync: { fingerprint: "settings-test" },
  holidays: candidate.holidays || [],
  resources: candidate.resources || [],
  planningDate: candidate.planningDate || "2026-08-22",
});
context.scheduleAutoSupabaseBackup = () => {};

// Pre-fix coverage reproduction: the production imported-labor mutator accepts
// any case object, including an inactive case, and can save without history/audit.
run(`
  state.cases = ["A", "B", "C"].map((id) => normalizeCase({
    id,
    clientName: id,
    localRevision: 0,
    claims: id === "B" ? [{
      id: "claim-B",
      title: "Inactive imported labor",
      includeInPlanning: true,
      status: "approved",
      estimate: {
        originalLines: [{
          id: "line-B",
          operation: "Peinture aile avant",
          laborHours: 2,
          selectedPhases: ["paint"],
          allocations: [],
        }],
        lines: [],
      },
    }] : [],
  }));
  state.bookings = [];
  state.auditLog = [];
  activeCaseId = "A";
`);
context.initializeLastKnownCasesComparable();
await context.updateImportedLaborLineAllocation(
  run(`state.cases.find((item) => item.id === "B")`),
  "claim-B",
  "line-B",
  ["body", "paint"],
  { paintGroup: "front" },
);
assert.equal(
  run(`state.cases.find((item) => item.id === "B").localRevision`),
  1,
  "inactive production mutation must increment the changed case revision exactly once",
);
for (const record of await context.loadDurableOutboxOperations()) await context.deleteDurableOutboxOperation(record.operationId);

// Inactive no-history mutation: local IndexedDB durability and cloud intent are
// proved independently with A active and B mutated through the production path.
const durabilityVm = createNimrVmContext({ filename: "p0-009-inactive-indexeddb.js" });
durabilityVm.context.indexedDB = createMemoryIndexedDb();
durabilityVm.run(`
  shouldPersistStateInIndexedDb = () => true;
  scheduleAutoSupabaseBackup = () => {};
  state.cases = ["A", "B", "C"].map((id) => normalizeCase({
    id,
    clientName: id,
    localRevision: 0,
    claims: id === "B" ? [{
      id: "claim-B",
      title: "Inactive imported labor",
      includeInPlanning: true,
      status: "approved",
      estimate: {
        originalLines: [{
          id: "line-B",
          operation: "Peinture aile avant",
          laborHours: 2,
          selectedPhases: ["paint"],
          allocations: [],
        }],
        lines: [],
      },
    }] : [],
  }));
  state.bookings = [];
  state.auditLog = [];
  activeCaseId = "A";
  markEntityStateFullReplacement();
`);
await durabilityVm.context.persistLargeStateSnapshot(durabilityVm.run("state"), { forceFull: true, reason: "p0-009-baseline" });
durabilityVm.context.initializeLastKnownCasesComparable();
const inactiveHistoryBefore = durabilityVm.run(`state.cases.find((item) => item.id === "B").history.length`);
await durabilityVm.context.updateImportedLaborLineAllocation(
  durabilityVm.run(`state.cases.find((item) => item.id === "B")`),
  "claim-B",
  "line-B",
  ["body", "paint"],
  { paintGroup: "front" },
);
assert.equal(durabilityVm.run(`state.cases.find((item) => item.id === "B").localRevision`), 1);
assert.equal(durabilityVm.run(`state.cases.find((item) => item.id === "A").localRevision`), 0);
assert.equal(durabilityVm.run(`state.cases.find((item) => item.id === "C").localRevision`), 0);
assert.equal(
  durabilityVm.run(`state.cases.find((item) => item.id === "B").history.length`),
  inactiveHistoryBefore,
  "the legitimate inactive mutation must not rely on history side effects",
);
const inactivePersistenceStats = durabilityVm.context.getEntityPersistenceStats();
assert.equal(inactivePersistenceStats.caseWrites, 1, "only inactive B is written to P0-008 entity persistence");
const inactiveReload = await durabilityVm.context.loadLargeStateSnapshot();
const reloadedA = inactiveReload.state.cases.find((item) => item.id === "A");
const reloadedB = inactiveReload.state.cases.find((item) => item.id === "B");
const reloadedC = inactiveReload.state.cases.find((item) => item.id === "C");
assert.deepEqual(reloadedB.claims[0].estimate.originalLines[0].selectedPhases, ["body", "paint"]);
assert.equal(reloadedB.localRevision, 1, "inactive B survives an offline IndexedDB reload");
assert.equal(reloadedA.localRevision, 0);
assert.equal(reloadedC.localRevision, 0);
const inactiveOutbox = await durabilityVm.context.loadDurableOutboxOperations();
assert.equal(inactiveOutbox.length, 1);
assert.deepEqual(
  inactiveOutbox.map(({ entityType, entityId, action }) => ({ entityType, entityId, action })),
  [{ entityType: "case", entityId: "B", action: "upsert" }],
);
assert.equal(inactiveOutbox.some((entry) => entry.entityType === "workshop_state" || entry.action === "upsert_snapshot"), false);
assert.equal(durabilityVm.context.NIMR_CASE_REVISION_SCAN.fullScan, false);
assert.equal(durabilityVm.context.NIMR_CASE_REVISION_SCAN.candidateCount, 2, "inactive B plus active A is a bounded constant set");

// A real multi-case planning migration nominates exact changed IDs. Both
// inactive B and C become durable cloud intent while active A stays untouched.
const multiVm = createNimrVmContext({ filename: "p0-009-two-inactive.js" });
multiVm.context.scheduleAutoSupabaseBackup = () => {};
multiVm.run(`
  state.cases = ["A", "B", "C"].map((id) => normalizeCase({ id, clientName: id, localRevision: 0 }));
  state.bookings = [
    { id: "old-B", caseId: "B", resourceIds: [], segments: [], start: "2026-08-24T08:00:00.000Z", end: "2026-08-24T09:00:00.000Z" },
    { id: "old-C", caseId: "C", resourceIds: [], segments: [], start: "2026-08-24T09:00:00.000Z", end: "2026-08-24T10:00:00.000Z" },
  ];
  state.auditLog = [];
  state.settings.planningLogicVersion = 27;
  activeCaseId = "A";
  schedulePipeline = (item, start) => ({
    start: new Date(start).toISOString(),
    end: new Date(new Date(start).getTime() + 3600000).toISOString(),
    delivery: new Date(new Date(start).getTime() + 7200000).toISOString(),
    marginMinutes: 60,
    steps: [],
  });
  proposalToBookings = (item) => [{ id: "new-" + item.id, caseId: item.id, resourceIds: [], segments: [], start: item.appointment?.start || "", end: item.appointment?.end || "" }];
  initializeLastKnownCasesComparable();
`);
await multiVm.context.migratePlanningLogicV28();
assert.equal(multiVm.run(`state.cases.find((item) => item.id === "A").localRevision`), 0);
assert.equal(multiVm.run(`state.cases.find((item) => item.id === "B").localRevision`), 1);
assert.equal(multiVm.run(`state.cases.find((item) => item.id === "C").localRevision`), 1);
const multiCaseOperations = (await multiVm.context.loadDurableOutboxOperations()).filter((entry) => entry.entityType === "case");
assert.equal(multiCaseOperations.map((entry) => entry.entityId).sort().join(","), "B,C");
assert.equal(multiVm.context.NIMR_CASE_REVISION_SCAN.fullScan, false);
assert.equal(multiVm.context.NIMR_CASE_REVISION_SCAN.candidateCount, 3, "exact B/C plus active A is bounded");

// The production backup replacement helper preserves the old comparison
// baseline; the real caller explicitly requests the exceptional full scan.
const bulkVm = createNimrVmContext({ filename: "p0-009-full-backup-import.js" });
bulkVm.context.scheduleAutoSupabaseBackup = () => {};
bulkVm.run(`
  state.cases = ["A", "B", "C"].map((id) => normalizeCase({ id, clientName: id, localRevision: 0 }));
  state.bookings = [];
  state.auditLog = [];
  activeCaseId = "A";
  initializeLastKnownCasesComparable();
  const imported = structuredClone(state);
  imported.cases.find((item) => item.id === "B").clientName = "B imported";
  imported.cases.find((item) => item.id === "C").clientName = "C imported";
  replaceStateFromImportedBackup(imported);
`);
await bulkVm.context.saveState({ fullCaseRevisionScan: true, cloudReason: "backup-import-test", skipSnapshot: true });
const bulkCaseOperations = (await bulkVm.context.loadDurableOutboxOperations()).filter((entry) => entry.entityType === "case");
assert.equal(bulkCaseOperations.map((entry) => entry.entityId).sort().join(","), "B,C");
assert.equal(bulkVm.context.NIMR_CASE_REVISION_SCAN.fullScan, true);
assert.equal(bulkVm.context.NIMR_CASE_REVISION_SCAN.candidateCount, 3);

// With 100 cases, one nominated inactive case causes one entity write and a
// constant two-candidate comparison (the nominated case and active A).
for (const record of await durabilityVm.context.loadDurableOutboxOperations()) {
  await durabilityVm.context.deleteDurableOutboxOperation(record.operationId);
}
durabilityVm.run(`
  state.cases = Array.from({ length: 100 }, (_, index) => normalizeCase({
    id: "bounded-" + index,
    clientName: "Case " + index,
    localRevision: 0,
  }));
  state.bookings = [];
  state.auditLog = [];
  activeCaseId = "bounded-0";
  markEntityStateFullReplacement();
`);
await durabilityVm.context.persistLargeStateSnapshot(durabilityVm.run("state"), { forceFull: true, reason: "p0-009-100-baseline" });
durabilityVm.context.initializeLastKnownCasesComparable();
durabilityVm.run(`state.cases[57].clientName = "Only changed"; noteCaseRevisionCandidate(state.cases[57]);`);
await durabilityVm.context.saveState({ changedCase: durabilityVm.run("state.cases[57]"), skipSnapshot: true });
const boundedStats = durabilityVm.context.getEntityPersistenceStats();
assert.equal(boundedStats.caseWrites, 1);
assert.equal(durabilityVm.context.NIMR_CASE_REVISION_SCAN.candidateCount, 2);
assert.equal(durabilityVm.context.NIMR_CASE_REVISION_SCAN.visitedCount, 2);
assert.equal(durabilityVm.context.NIMR_CASE_REVISION_SCAN.fullScan, false);
const boundedOperations = await durabilityVm.context.loadDurableOutboxOperations();
assert.equal(boundedOperations.filter((entry) => entry.entityType === "case").map((entry) => entry.entityId).join(","), "bounded-57");

run(`state.cases = [{ id: "save-case", clientName: "A", localRevision: 0, updatedAt: "2026-08-22T00:00:00.000Z" }]; state.bookings = []; state.auditLog = []; activeCaseId = "save-case";`);
context.initializeLastKnownCasesComparable();
run(`state.cases[0].clientName = "B"`);
assert.equal(await context.saveState({ skipSnapshot: true }), true);
records = await context.loadDurableOutboxOperations();
assert.equal(records.filter((entry) => entry.entityType === "case").length, 1);
assert.equal(records.some((entry) => entry.entityType === "workshop_state"), false);
assert.equal(context.NIMR_CASE_REVISION_SCAN.candidateCount, 1, "normal one-case save must inspect one case candidate");
assert.equal(context.NIMR_CASE_REVISION_SCAN.fullScan, false);
assert.equal(fullPathCalls, 0);
for (const record of records) await context.deleteDurableOutboxOperation(record.operationId);

run(`state.bookings.push({ id: "save-booking", caseId: "save-case", version: 1, resourceIds: ["r1"], segments: [], nested: { workSessions: [] } }); markEntityBookingDirty(state.bookings[0]);`);
assert.equal(await context.saveState({ skipSnapshot: true }), true);
records = await context.loadDurableOutboxOperations();
assert.equal(records.filter((entry) => entry.entityType === "booking").length, 1);
assert.equal(fullPathCalls, 0);
for (const record of records) await context.deleteDurableOutboxOperation(record.operationId);

run(`state.settings.syncMarker = "settings-only";`);
assert.equal(await context.saveState({ skipSnapshot: true }), true);
records = await context.loadDurableOutboxOperations();
assert.equal(records.filter((entry) => entry.entityType === "workshop_settings").length, 1);
assert.equal(records.filter((entry) => entry.entityType === "case" || entry.entityType === "booking").length, 0);
assert.equal(fullPathCalls, 0);
for (const record of records) await context.deleteDurableOutboxOperation(record.operationId);

const savedAudit = context.addAuditLog("case.saved", "Saved", "bounded", { caseId: "save-case" });
assert.ok(savedAudit.id);
assert.equal(await context.saveState({ skipSnapshot: true }), true);
records = await context.loadDurableOutboxOperations();
assert.equal(records.filter((entry) => entry.entityType === "audit").length, 1);
assert.equal(fullPathCalls, 0);
for (const record of records) await context.deleteDurableOutboxOperation(record.operationId);

run(`state.cases[0].clientName = "remote-only"; markEntityCaseDirty(state.cases[0], { skipCloud: true });`);
await context.saveState({ skipCloud: true, skipSnapshot: true });
assert.equal((await context.loadDurableOutboxOperations()).length, 0);

// Production case deletion keeps immutable case/booking tombstones and is
// durable across an offline local restart without a scan of unrelated cases.
const deleteVm = createNimrVmContext({ filename: "p0-009-production-delete.js" });
deleteVm.run(`
  state.cases = ["delete-A", "delete-B", "delete-C"].map((id) => normalizeCase({
    id,
    clientName: id,
    orNavNumber: "OR-" + id,
    localRevision: 0,
  }));
  state.bookings = [{ id: "delete-booking-B", caseId: "delete-B", resourceIds: [], segments: [] }];
  state.auditLog = [];
  activeCaseId = "delete-B";
  navigator.onLine = false;
  guardSensitiveAction = () => ({ ok: true });
  showConfirmModal = async () => true;
  showPromptModal = async () => true;
  deletePhotoRecord = async () => true;
  deleteDocumentRecord = async () => true;
  cleanupOrphanedStorage = async () => true;
  flushSupabaseBackup = async () => new Promise((resolve) => setTimeout(resolve, 0));
  render = () => {};
  scheduleAutoSupabaseBackup = () => {};
  initializeLastKnownCasesComparable();
`);
await deleteVm.context.deleteActiveCase(deleteVm.run(`state.cases.find((item) => item.id === "delete-B")`));
const deleteOperations = await deleteVm.context.loadDurableOutboxOperations();
const caseDeleteOperation = deleteOperations.find((entry) => entry.entityType === "case" && entry.entityId === "delete-B");
const bookingDeleteOperation = deleteOperations.find((entry) => entry.entityType === "booking" && entry.entityId === "delete-booking-B");
assert.equal(caseDeleteOperation?.action, "delete");
assert.equal(caseDeleteOperation?.payload?.projectionLocalId, "delete-B");
assert.equal(bookingDeleteOperation?.action, "delete");
assert.equal(deleteVm.run(`state.cases.some((item) => item.id === "delete-B")`), false);
assert.equal(JSON.parse(deleteVm.localStorage.getItem(deleteVm.run("STORAGE_KEY"))).cases.some((item) => item.id === "delete-B"), false);
assert.equal(deleteVm.context.NIMR_CASE_REVISION_SCAN.fullScan, false);

// Load the production remote handlers in a fresh VM and prove case/booking/delete do not echo.
const remoteVm = createNimrVmContext({ filename: "p0-009-remote-no-echo.js" });
remoteVm.context.getSupabaseWorkshopId = () => "workshop-a";
remoteVm.context.scheduleAutoSupabaseBackup = () => {};
vm.runInContext(fs.readFileSync(new URL("../js/supabase-sync.js", import.meta.url), "utf8"), remoteVm.context, { filename: "supabase-sync-p009.js" });
vm.runInContext("state.cases = []; state.bookings = []; state.auditLog = [];", remoteVm.context);
remoteVm.context.initializeLastKnownCasesComparable();
await remoteVm.context.handleRemoteCaseChange({ workshop_id: "workshop-a", entity_type: "case", entity_id: "remote-case", entity_version: 4000, payload: { id: "remote-case", localRevision: 2, nested: { preserved: true } } }, "INSERT");
await remoteVm.context.handleRemoteBookingChange({ workshop_id: "workshop-a", entity_type: "booking", entity_id: "remote-booking", entity_version: 2000, payload: { id: "remote-booking", version: 1, caseId: "remote-case", segments: [{ start: "2026-08-22T08:00:00.000Z", end: "2026-08-22T09:00:00.000Z" }] } }, "INSERT");
assert.equal(vm.runInContext("state.cases[0].nested.preserved", remoteVm.context), true);
assert.equal(vm.runInContext("state.cases[0].localRevision", remoteVm.context), 2, "sync envelope version must not mutate case shape");
assert.equal(vm.runInContext("state.bookings[0].segments.length", remoteVm.context), 1);
assert.equal(vm.runInContext("state.bookings[0].version", remoteVm.context), 1, "sync envelope version must not mutate booking shape");
assert.equal((await remoteVm.context.loadDurableOutboxOperations()).length, 0);
vm.runInContext(`activeCaseId = "remote-case"; initializeLastKnownCasesComparable();`, remoteVm.context);
await remoteVm.context.handleRemoteCaseChange({
  workshop_id: "workshop-a",
  local_id: "remote-case",
  order_number: "REMOTE-OR-2",
  status: "planning",
  updated_at: "2026-08-22T13:00:00.000Z",
}, "UPDATE");
assert.equal(vm.runInContext("state.cases[0].localRevision", remoteVm.context), 2, "legacy remote active-case apply must not increment local revision");
assert.equal(remoteVm.context.NIMR_CASE_REVISION_SCAN.fullScan, false);
assert.equal((await remoteVm.context.loadDurableOutboxOperations()).length, 0, "legacy remote apply must not echo");
await remoteVm.context.handleRemoteBookingChange({ workshop_id: "workshop-a", entity_type: "booking", entity_id: "remote-booking", entity_version: 3000, payload: {} }, "DELETE");
assert.equal(vm.runInContext("state.bookings.length", remoteVm.context), 0);
assert.equal((await remoteVm.context.loadDurableOutboxOperations()).length, 0);

// Local persistence failure is a hard boundary before outbox durability.
const localFailureVm = createNimrVmContext({ filename: "p0-009-local-failure.js" });
localFailureVm.run(`
  state.cases = [{ id: "local-failure", clientName: "A", localRevision: 0 }];
  state.bookings = [];
  initializeLastKnownCasesComparable();
  state.cases[0].clientName = "B";
  shouldPersistStateInIndexedDb = () => true;
  persistLargeStateSnapshot = () => Promise.reject(new Error("injected local persistence failure"));
  scheduleAutoSupabaseBackup = () => {};
`);
assert.equal(await localFailureVm.context.saveState({ skipSnapshot: true }), false);
assert.equal((await localFailureVm.context.loadDurableOutboxOperations()).length, 0);

// An outbox write failure is surfaced and never reported as cloud-durable.
const outboxFailureVm = createNimrVmContext({ filename: "p0-009-outbox-failure.js", console: { ...console, warn() {} } });
outboxFailureVm.run(`
  state.cases = [{ id: "outbox-failure", clientName: "A", localRevision: 0 }];
  state.bookings = [];
  activeCaseId = "outbox-failure";
  initializeLastKnownCasesComparable();
  state.cases[0].clientName = "B";
  enqueueDurableOutboxOperation = () => Promise.reject(new Error("injected outbox failure"));
  scheduleAutoSupabaseBackup = () => {};
`);
assert.equal(await outboxFailureVm.context.saveState({ skipSnapshot: true }), false);
assert.equal(outboxFailureVm.context.NIMR_CLOUD_DURABILITY.durable, false);

const stateSource = fs.readFileSync(new URL("../js/state.js", import.meta.url), "utf8");
const syncSource = fs.readFileSync(new URL("../js/supabase-sync.js", import.meta.url), "utf8");
const storageSource = fs.readFileSync(new URL("../js/storage.js", import.meta.url), "utf8");
const migrationSource = fs.readFileSync(new URL("../supabase_p0_009_granular_sync_entities.sql", import.meta.url), "utf8");
const autoBody = syncSource.slice(syncSource.indexOf("async function autoBackupToSupabase"), syncSource.indexOf("async function fetchLatestCloudBackup"));
const pullBody = syncSource.slice(syncSource.indexOf("async function pullLatestSupabaseBackup"), syncSource.indexOf("function startSupabaseLiveSync"));
const saveBody = stateSource.slice(stateSource.indexOf("function saveState"), stateSource.indexOf("function forceEmergencyAutosave"));

for (const [label, body] of [["saveState", saveBody], ["automatic retry", autoBody], ["incremental pull", pullBody]]) {
  assert.doesNotMatch(body, /buildCloudBackupPayload\s*\(|buildBackupPayload\s*\(|cloneSyncStateSnapshot\s*\(|getSyncStateFingerprint\s*\(/u, `${label} must not use a full-state cloud path`);
}
assert.doesNotMatch(saveBody, /entityType:\s*["']workshop_state["']|action:\s*["']upsert_snapshot["']/u);
const backupImportBody = storageSource.slice(storageSource.indexOf("async function importBackup"), storageSource.indexOf("async function handleVehicleFile"));
assert.match(backupImportBody, /replaceStateFromImportedBackup\(importedState\)/u, "the real backup import caller must use the replacement bridge");
assert.match(backupImportBody, /saveState\(\{\s*fullCaseRevisionScan:\s*true/u, "the real backup import caller must explicitly request its exceptional full scan");
assert.match(storageSource, /function replaceStateFromImportedBackup[\s\S]*markEntityStateFullReplacement\(\)/u);
assert.match(syncSource, /sync_entities/u);
assert.match(syncSource, /handleRemoteBookingChange/u);
assert.match(syncSource, /saveState\(\{[\s\S]*skipCloud:\s*true/u);
assert.match(storageSource, /structuredClone|JSON\.parse\(JSON\.stringify/u);
assert.match(migrationSource, /primary key \(workshop_id, entity_type, entity_id\)/iu);
assert.match(migrationSource, /enable row level security/iu);
assert.match(migrationSource, /nimr_is_workshop_member\(workshop_id\)/iu);
assert.match(migrationSource, /revoke all on table public\.sync_entities from anon/iu);
assert.doesNotMatch(migrationSource, /grant[^;]+to anon/iu);
assert.match(migrationSource, /sync_entities_workshop_cursor_idx/iu);
assert.match(migrationSource, /sync_entities_workshop_tombstone_idx/iu);
assert.match(migrationSource, /jsonb_array_elements\(coalesce\(backup\.state -> 'cases'/iu);
assert.match(migrationSource, /jsonb_array_elements\(coalesce\(backup\.state -> 'bookings'/iu);
assert.match(migrationSource, /jsonb_array_elements\(coalesce\(backup\.state -> 'auditLog'/iu);
assert.match(migrationSource, /on conflict \(workshop_id, entity_type, entity_id\) do nothing/iu);
assert.match(migrationSource, /on conflict \(workshop_id, local_id\) do nothing/iu);
assert.match(migrationSource, /insert into public\.app_settings/iu);
assert.match(migrationSource, /on conflict \(workshop_id, setting_key\) do nothing/iu);
assert.match(migrationSource, /existing\.last_operation_id\s*=\s*p_operation_id[\s\S]*?return existing/iu, "same operationId must return the existing canonical row");
assert.match(migrationSource, /existing\.entity_version\s*>\s*greatest\(0, p_entity_version\)[\s\S]*?return existing/iu, "older versions must return the newer canonical row");
assert.match(migrationSource, /existing\.entity_version\s*=\s*greatest\(0, p_entity_version\)[\s\S]*?existing\.deleted_at is not null[\s\S]*?not p_deleted[\s\S]*?return existing/iu, "same-version tombstone must reject a different upsert");
assert.doesNotMatch(migrationSource, /case\s+when p_deleted\s+then '\{\}'::jsonb\s+else/iu, "DELETE must not unconditionally erase tombstone metadata");
assert.match(migrationSource, /when p_deleted and p_entity_type = 'case'[\s\S]*?jsonb_build_object\('projectionLocalId', p_payload ->> 'projectionLocalId'\)/iu, "case tombstone must retain only bounded projectionLocalId metadata");
assert.match(migrationSource, /nimr_has_workshop_role\([\s\S]*?p_workshop_id/iu, "RPC workshop role guard must remain present");

console.log("P0-009 GRANULAR SYNC OUTBOX OK");
