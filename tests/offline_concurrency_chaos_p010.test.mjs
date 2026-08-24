import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createNimrVmContext } from "./helpers/nimr_vm_context.mjs";
import { createMemoryIndexedDb } from "./helpers/memory_indexeddb.mjs";
import {
  caseSyncLocalIdForHarness,
  createMultiClientSyncHarness,
  makeHarnessBooking,
  makeHarnessCase,
} from "./helpers/multi_client_sync_harness.mjs";

const BASE = 1_700_000_000_000;
const W = "workshop-1";
const X = "application-case-X";
const Y = "booking-Y";
const PROJECTION = "case-or:or-90001";
const INITIAL = 100;

const storageSource = fs.readFileSync(new URL("../js/storage.js", import.meta.url), "utf8");
const syncSource = fs.readFileSync(new URL("../js/supabase-sync.js", import.meta.url), "utf8");
const sqlSource = fs.readFileSync(new URL("../supabase_p0_010_offline_concurrency.sql", import.meta.url), "utf8");

// Production/static contract: clients echo observed bases, the server assigns
// versions, old CAS-less clients fail closed, and conflict/security contracts
// remain explicit in the deployable migration.
assert.match(storageSource, /getObservedGranularServerVersion/);
assert.match(storageSource, /makeOutboxIdentifier\("operation"\)/);
assert.match(storageSource, /baseVersion:\s*isGranularCoalescibleOperation\(candidate\)\s*\?\s*keeper\.baseVersion/);
assert.match(storageSource, /\[DURABLE_OUTBOX_STORE, SYNC_METADATA_STORE\][\s\S]*?"readwrite"/);
assert.match(storageSource, /syncStatus:\s*"conflicted"/);
assert.match(syncSource, /nimr_apply_sync_entity_v2/);
assert.match(syncSource, /p_base_version:\s*operation\.baseVersion/);
assert.doesNotMatch(syncSource.slice(syncSource.indexOf("async function applyCanonicalSyncEntity"), syncSource.indexOf("async function deleteCaseProjectionFromSupabase")), /p_entity_version/);
assert.match(syncSource, /completeDurableOutboxOperationAtomically/);
assert.match(syncSource, /conflictDurableOutboxOperationAtomically/);
assert.match(syncSource, /findActiveDurableOutboxOperationForEntity/);
assert.match(syncSource, /acceptedVersion:\s*value\?\.accepted_version\s*\?\?\s*value\?\.acceptedVersion/);
assert.match(syncSource, /serverVersion:\s*canonical\?\.entity_version\s*\?\?\s*canonical\?\.server_version\s*\?\?\s*value\?\.server_version/);
assert.match(sqlSource, /create sequence if not exists public\.nimr_sync_entity_version_seq/);
assert.match(sqlSource, /max\(entity_version\)[\s\S]*?\+ 1/);
assert.match(sqlSource, /client upgrade required: CAS baseVersion required/);
assert.match(sqlSource, /create or replace function public\.nimr_apply_sync_entity_v2[\s\S]*?p_base_version bigint/);
assert.match(sqlSource, /for update/);
assert.match(sqlSource, /current_row\.entity_version <> p_base_version/);
assert.match(sqlSource, /nextval\('public\.nimr_sync_entity_version_seq'/);
assert.match(sqlSource, /sync_entity_conflicts_workshop_operation_unique[\s\S]*?unique \(workshop_id, local_operation_id\)/);
assert.match(sqlSource, /alter table public\.sync_entity_conflicts enable row level security/);
assert.match(sqlSource, /revoke all on table public\.sync_entity_conflicts from anon/);
assert.match(sqlSource, /nimr_is_workshop_member\(workshop_id\)/);
assert.match(sqlSource, /sync_entities_active_booking_parent_idx[\s\S]*?payload ->> 'caseId'/);
assert.match(sqlSource, /p_entity_type = 'case' and p_deleted[\s\S]*?:cascade-booking:/);
assert.match(sqlSource, /nimr_apply_workshop_settings_v2/);
assert.match(sqlSource, /'accepted_version',\s*accepted_receipt\.accepted_version[\s\S]*?'server_version',\s*current_row\.entity_version/);
assert.match(sqlSource, /'accepted_version',receipt\.accepted_version,[\s\S]*?'server_version',current_row\.entity_version/);
assert.doesNotMatch(sqlSource, /'server_version',\s*accepted_receipt\.accepted_version/);
assert.doesNotMatch(sqlSource, /'server_version',\s*receipt\.accepted_version/);
assert.doesNotMatch(sqlSource, /service_role|SUPABASE_SERVICE/);

// Exercise the real storage implementation, not only the model harness: the
// outbox acknowledgement and observed version are one IndexedDB transaction.
const atomicIndexedDb = createMemoryIndexedDb();
const atomicVm = createNimrVmContext({ filename: "p0-010-atomic-storage.js" });
atomicVm.context.indexedDB = atomicIndexedDb;
const atomicOperation = atomicVm.context.normalizeDurableOutboxOperation({
  operationId: "atomic-U101", idempotencyKey: "W:atomic-U101", workshopId: W,
  entityType: "case", entityId: X, action: "upsert", baseVersion: INITIAL,
  payload: { entity: makeHarnessCase({ id: X, nextAction: "atomic" }) }, syncStatus: "pending",
});
const normalizedLegacyMutable = atomicVm.context.normalizeDurableOutboxOperation({
  operationId: "legacy-p009", workshopId: W, entityType: "case", entityId: X,
  action: "upsert", entityVersion: 1_700_000_000_000_001,
  expectedVersion: 7, payload: { entity: makeHarnessCase({ id: X }) },
});
assert.equal(normalizedLegacyMutable.baseVersion, null, "legacy localRevision-domain expectedVersion must not become a server CAS token");
await atomicVm.context.putDurableOutboxOperation(atomicOperation);
const observed101 = { workshopId: W, entityType: "case", entityId: X, serverVersion: 101, lastOperationId: atomicOperation.operationId, deleted: false };
atomicIndexedDb.failNextWriteTransaction();
await assert.rejects(
  atomicVm.context.completeDurableOutboxOperationAtomically(atomicOperation.operationId, observed101),
  /Injected transaction failure/,
);
assert.equal((await atomicVm.context.loadDurableOutboxOperations()).some((entry) => entry.operationId === atomicOperation.operationId), true);
assert.equal(await atomicVm.context.loadSyncMetadata(atomicVm.context.getObservedGranularMetadataKey(W, "case", X)), undefined);
await atomicVm.context.completeDurableOutboxOperationAtomically(atomicOperation.operationId, observed101);
assert.equal((await atomicVm.context.loadDurableOutboxOperations()).some((entry) => entry.operationId === atomicOperation.operationId), false);
assert.equal((await atomicVm.context.loadSyncMetadata(atomicVm.context.getObservedGranularMetadataKey(W, "case", X))).serverVersion, 101);

const atomicConflict = atomicVm.context.normalizeDurableOutboxOperation({
  ...atomicOperation, operationId: "atomic-conflict-U100", idempotencyKey: "W:atomic-conflict-U100",
});
await atomicVm.context.putDurableOutboxOperation(atomicConflict);
await atomicVm.context.conflictDurableOutboxOperationAtomically(atomicConflict.operationId, {
  ...observed101, lastOperationId: "remote-B-101",
}, { conflictId: "server-conflict-1", serverVersion: 101, canonical: { workshop_id: W, entity_type: "case", entity_id: X, entity_version: 101, last_operation_id: "remote-B-101", payload: makeHarnessCase({ id: X, nextAction: "remote" }) } });
const atomicConflictRecord = (await atomicVm.context.loadDurableOutboxOperations()).find((entry) => entry.operationId === atomicConflict.operationId);
assert.equal(atomicConflictRecord.syncStatus, "conflicted");
assert.equal(atomicConflictRecord.conflictId, "server-conflict-1");
await atomicVm.context.rememberObservedGranularEntityMetadata({ ...observed101, serverVersion: 102, lastOperationId: "remote-C-102" });
const monotonicLowerWrite = await atomicVm.context.rememberObservedGranularEntityMetadata({
  ...observed101,
  serverVersion: 101,
  lastOperationId: "late-U1-101",
  deleted: true,
});
assert.equal(monotonicLowerWrite.serverVersion, 102);
assert.equal(monotonicLowerWrite.lastOperationId, "remote-C-102");
assert.equal(monotonicLowerWrite.deleted, false);
const persistedAfterLowerWrite = await atomicVm.context.loadSyncMetadata(
  atomicVm.context.getObservedGranularMetadataKey(W, "case", X),
);
assert.equal(persistedAfterLowerWrite.serverVersion, 102);
assert.equal(persistedAfterLowerWrite.lastOperationId, "remote-C-102");
assert.equal(persistedAfterLowerWrite.deleted, false);

// A late retry settles only its own operation and cannot regress metadata or
// consume later U2/U3 operations. The metadata/outbox changes remain atomic.
const lateEntityId = "late-receipt-case-X";
const lateObserved102 = {
  workshopId: W,
  entityType: "case",
  entityId: lateEntityId,
  serverVersion: 102,
  lastOperationId: "late-U2-102",
  deleted: false,
};
await atomicVm.context.rememberObservedGranularEntityMetadata(lateObserved102);
const lateOperations = ["U1", "U2", "U3"].map((label, index) => atomicVm.context.normalizeDurableOutboxOperation({
  operationId: `late-${label}`,
  idempotencyKey: `W:late-${label}`,
  workshopId: W,
  entityType: "case",
  entityId: lateEntityId,
  action: "upsert",
  baseVersion: 99 + index,
  payload: { entity: makeHarnessCase({ id: lateEntityId, nextAction: label }) },
  syncStatus: index === 0 ? "failed" : "pending",
}));
for (const operation of lateOperations) await atomicVm.context.putDurableOutboxOperation(operation);
const lateObserved101 = { ...lateObserved102, serverVersion: 101, lastOperationId: "late-U1-101", deleted: true };
atomicIndexedDb.failNextWriteTransaction();
await assert.rejects(
  atomicVm.context.completeDurableOutboxOperationAtomically("late-U1", lateObserved101),
  /Injected transaction failure/,
);
let lateRecords = await atomicVm.context.loadDurableOutboxOperations();
assert.deepEqual(lateRecords.filter((entry) => entry.entityId === lateEntityId).map((entry) => entry.operationId).sort(), ["late-U1", "late-U2", "late-U3"]);
assert.equal((await atomicVm.context.loadSyncMetadata(atomicVm.context.getObservedGranularMetadataKey(W, "case", lateEntityId))).serverVersion, 102);
await atomicVm.context.completeDurableOutboxOperationAtomically("late-U1", lateObserved101);
lateRecords = await atomicVm.context.loadDurableOutboxOperations();
assert.deepEqual(lateRecords.filter((entry) => entry.entityId === lateEntityId).map((entry) => entry.operationId).sort(), ["late-U2", "late-U3"]);
const latePersisted = await atomicVm.context.loadSyncMetadata(atomicVm.context.getObservedGranularMetadataKey(W, "case", lateEntityId));
assert.equal(latePersisted.serverVersion, 102);
assert.equal(latePersisted.lastOperationId, "late-U2-102");
assert.equal(latePersisted.deleted, false);
const postConflictLocalEdit = makeHarnessCase({ id: X, nextAction: "post-conflict-local", localRevision: 2 });
atomicVm.context.markEntityCaseDirty(postConflictLocalEdit);
const postConflictCapture = atomicVm.context.captureEntityMutationBatch({ cases: [postConflictLocalEdit], bookings: [] }, { workshopId: W })
  .find((entry) => entry.entityId === X);
assert.equal(postConflictCapture.baseVersion, INITIAL, "new local edits cannot skip an unresolved operation's original base");

// Persisted observed metadata seeds the real realtime guard after a VM restart.
const restartVm = createNimrVmContext({ filename: "p0-010-restart-guard.js" });
restartVm.context.indexedDB = atomicIndexedDb;
restartVm.context.getSupabaseWorkshopId = () => W;
restartVm.context.scheduleAutoSupabaseBackup = () => {};
vm.runInContext(syncSource, restartVm.context, { filename: "supabase-sync-p010-restart.js" });
const normalizedLateReceipt = restartVm.context.NIMR_GRANULAR_SYNC_TEST_API.normalizeCanonicalCasOutcome({
  status: "idempotent",
  accepted: true,
  idempotent: true,
  conflict: false,
  accepted_version: 101,
  server_version: 101,
  canonical: { entity_version: 102 },
});
assert.equal(normalizedLateReceipt.acceptedVersion, 101);
assert.equal(normalizedLateReceipt.serverVersion, 102);
await restartVm.context.hydrateObservedGranularEntityMetadata(W);
restartVm.run(`state.cases = [{ id: ${JSON.stringify(X)}, nextAction: "V102", localRevision: 1 }]; state.bookings = [];`);
await restartVm.context.handleRemoteCaseChange({ workshop_id: W, entity_type: "case", entity_id: X, entity_version: 101, last_operation_id: "late-U1-101", payload: makeHarnessCase({ id: X, nextAction: "V101" }) }, "UPDATE");
assert.equal(restartVm.run(`state.cases.find((item) => item.id === ${JSON.stringify(X)}).nextAction`), "V102");
assert.equal(restartVm.context.getObservedGranularServerVersion(W, "case", X), 102);

function seed({ booking = false, workshopId = W } = {}) {
  const harness = createMultiClientSyncHarness({ baseTimeMs: BASE });
  harness.server.seedEntity({ workshopId, entityType: "case", entityId: X,
    payload: makeHarnessCase({ id: X }), entityVersion: INITIAL, operationId: "seed-X" });
  if (booking) harness.server.seedEntity({ workshopId, entityType: "booking", entityId: Y,
    payload: makeHarnessBooking({ id: Y, caseId: X }), entityVersion: INITIAL, operationId: "seed-Y" });
  const A = harness.addClient("A", { workshopId }).bootstrap();
  const B = harness.addClient("B", { workshopId }).bootstrap();
  harness.server.clearRealtime("A"); harness.server.clearRealtime("B");
  return { harness, A, B };
}

function simultaneous(order) {
  const { harness, A, B } = seed();
  A.setClock(BASE + 1_000); B.setClock(BASE + 1_000);
  const opA = A.editCase(X, { nextAction: "A" });
  const opB = B.editCase(X, { nextAction: "B" });
  for (const name of order) ({ A, B })[name].sendNext();
  return { canonical: harness.server.canonical(W, "case", X), A, B, opA, opB };
}

const aAB = simultaneous(["A", "B"]);
const aBA = simultaneous(["B", "A"]);
assert.notEqual(aAB.opA.operationId, aAB.opB.operationId);
assert.equal(aAB.canonical.payload.nextAction, "A");
assert.equal(aAB.B.outbox[0].syncStatus, "conflicted");
assert.equal(aAB.B.case(X).nextAction, "B");
assert.equal(aAB.B.syncConflicts.length, 1);
assert.equal(aBA.canonical.payload.nextAction, "B");
assert.equal(aBA.A.outbox[0].syncStatus, "conflicted");
const scenarioA = { pass: true, rule: "one accepted; loser durable and explicit", uniqueSameMs: true };

function offlineDivergence(offset) {
  const { harness, A, B } = seed();
  A.offline().setClock(BASE + offset).editCase(X, { nextAction: "A-offline" });
  B.setClock(BASE + 100).editCase(X, { nextAction: "B-online" }); B.sendNext();
  A.onlineNow(); const result = A.sendNext();
  return { marker: harness.server.canonical(W, "case", X).payload.nextAction, result, local: A.case(X).nextAction, conflict: A.syncConflicts.length };
}
const bOffsets = [0, 5 * 60_000, 60 * 60_000, -5 * 60_000, -60 * 60_000].map(offlineDivergence);
assert.ok(bOffsets.every((value) => value.marker === "B-online" && value.result.conflicted && value.local === "A-offline" && value.conflict === 1));
const scenarioB = { pass: true, offsets: bOffsets.map((value) => value.marker), clockAuthority: false };

const c = seed();
c.A.offline().editCase(X, { nextAction: "X1" });
c.A.editCase(X, { nextAction: "X2" });
c.A.editCase(X, { nextAction: "X3" });
assert.equal(c.A.outbox.length, 1); assert.equal(c.A.outbox[0].baseVersion, INITIAL);
c.B.editCase(X, { nextAction: "XB" }); c.B.sendNext(); c.A.onlineNow(); c.A.sendNext();
assert.equal(c.A.outbox[0].syncStatus, "conflicted");
assert.equal(c.A.outbox[0].payload.entity.nextAction, "X3");
const scenarioC = { pass: true, pending: 1, preserved: "X3", baseVersion: INITIAL };

function deleteUpdate(first) {
  const { harness, A, B } = seed(); A.deleteCase(X); B.editCase(X, { nextAction: "B-update" });
  ({ A, B })[first].sendNext(); ({ A, B })[first === "A" ? "B" : "A"].sendNext();
  return { canonical: harness.server.canonical(W, "case", X), AConflict: A.syncConflicts.length, BConflict: B.syncConflicts.length };
}
const dDeleteFirst = deleteUpdate("A"); const dUpdateFirst = deleteUpdate("B");
assert.equal(Boolean(dDeleteFirst.canonical.deleted_at), true); assert.equal(dDeleteFirst.BConflict, 1);
assert.equal(dUpdateFirst.canonical.payload.nextAction, "B-update"); assert.equal(dUpdateFirst.AConflict, 1);
const scenarioD = { pass: true, deleteFirst: "delete + update conflict", updateFirst: "update + delete conflict" };

const e = seed();
e.B.editCase(X, { nextAction: "stale-pre-delete" });
e.A.deleteCase(X); e.A.sendNext(); e.A.recreateCase(X, { orNavNumber: "OR-90001", nextAction: "recreated" }); e.A.sendNext();
const eResult = e.B.sendNext();
assert.equal(e.harness.server.canonical(W, "case", X).payload.nextAction, "recreated"); assert.equal(eResult.conflicted, true);
const scenarioE = { pass: true, staleWriterBlocked: true };

const f = seed(); f.A.editCase(X, { nextAction: "retry" }); const fId = f.A.outbox[0].operationId;
f.A.sendNext({ response: "drop" }); assert.equal(f.A.outbox[0].syncStatus, "failed");
const fRetry = f.A.sendNext(); assert.equal(fRetry.idempotent, true); assert.equal(f.A.outbox.length, 0); assert.equal(f.harness.server.projectionCount(W), 1);
const scenarioF = { pass: true, operationId: fId, idempotent: true };

function realtimeAck(beforeAck) {
  const value = seed(); value.A.editCase(X, { nextAction: "own" }); const id = value.A.outbox[0].operationId;
  if (beforeAck) { value.A.sendNext({ response: "delay" }); value.harness.server.deliverRealtime("A"); assert.equal(value.A.outbox[0].syncStatus, "processing"); value.harness.server.release("response", "A", id); }
  else { value.A.sendNext(); value.harness.server.deliverRealtime("A"); }
  return { local: value.A.case(X), outbox: value.A.outboxSummary() };
}
const g = realtimeAck(true); const h = realtimeAck(false); assert.deepEqual(g, h);
const scenarioG = { pass: true }; const scenarioH = { pass: true };

const iHarness = createMultiClientSyncHarness({ baseTimeMs: BASE }); let iB = iHarness.addClient("B", { workshopId: W });
const i10 = iHarness.server.forceCanonical({ workshopId: W, entityType: "case", entityId: X, payload: makeHarnessCase({ id: X, nextAction: "V10" }), entityVersion: 10, operationId: "V10" });
iHarness.server.forceCanonical({ workshopId: W, entityType: "case", entityId: X, payload: makeHarnessCase({ id: X, nextAction: "V11" }), entityVersion: 11, operationId: "V11" });
iHarness.server.forceCanonical({ workshopId: W, entityType: "case", entityId: X, payload: makeHarnessCase({ id: X, nextAction: "V12" }), entityVersion: 12, operationId: "V12" });
iHarness.server.deliverRealtime("B", { order: [2, 0, 1] }); assert.equal(iB.case(X).nextAction, "V12");
iB = iHarness.restartClient("B"); iHarness.server.injectRealtime("B", i10); iHarness.server.deliverRealtime("B"); assert.equal(iB.case(X).nextAction, "V12");
const scenarioI = { pass: true, warm: "V12", restart: "V12" };

const j = seed(); j.harness.server.forceCanonical({ workshopId: W, entityType: "case", entityId: X, payload: makeHarnessCase({ id: X, nextAction: "V101" }), entityVersion: 101, operationId: "remote" });
j.harness.server.clearRealtime("B"); j.B.poll(); assert.equal(j.B.case(X).nextAction, "V101");
const scenarioJ = { pass: true, transport: "compound cursor" };

assert.deepEqual(bOffsets.map((value) => value.marker), Array(5).fill("B-online"));
const scenarioK = { pass: true, offsets: [0, 5, 60, -5, -60], outcomeIndependent: true };

const l = seed(); l.A.offline().editCase(X, { nextAction: "persisted-local" }); let restarted = l.harness.restartClient("A");
l.B.editCase(X, { nextAction: "remote" }); l.B.sendNext(); restarted.onlineNow(); restarted.sendNext();
assert.equal(restarted.outbox[0].syncStatus, "conflicted"); assert.equal(restarted.base("case", X), 101); assert.equal(restarted.case(X).nextAction, "persisted-local");
const scenarioL = { pass: true, outbox: 1, observed: 101, conflict: 1 };

function bookingRace(caseFirst) {
  const value = seed({ booking: true }); value.A.editBooking(Y, { status: "started" }); value.B.deleteCase(X);
  if (caseFirst) { value.B.sendNext(); value.A.sendNext(); } else { value.A.sendNext(); value.B.sendNext(); }
  const parent = value.harness.server.canonical(W, "case", X); const booking = value.harness.server.canonical(W, "booking", Y);
  return { orphan: Boolean(parent.deleted_at && !booking.deleted_at), booking, conflicts: value.A.syncConflicts.length };
}
const m1 = bookingRace(true); const m2 = bookingRace(false); assert.equal(m1.orphan, false); assert.equal(m2.orphan, false); assert.ok(m1.conflicts >= 1);
const scenarioM = { pass: true, bothLockOrders: true, childVersionsIndependent: m2.booking.entity_version > INITIAL };

const nHarness = createMultiClientSyncHarness({ baseTimeMs: BASE });
for (const workshopId of ["W1", "W2"]) nHarness.server.seedEntity({ workshopId, entityType: "case", entityId: X, payload: makeHarnessCase({ id: X, nextAction: workshopId }), entityVersion: INITIAL, operationId: `seed-${workshopId}` });
const nA = nHarness.addClient("A", { workshopId: "W1" }).bootstrap(); const nB = nHarness.addClient("B", { workshopId: "W2" }).bootstrap();
nA.editCase(X, { nextAction: "W1-A" }); nB.editCase(X, { nextAction: "W2-B" }); nA.sendNext(); nB.sendNext();
assert.equal(nHarness.server.canonical("W1", "case", X).payload.nextAction, "W1-A"); assert.equal(nHarness.server.canonical("W2", "case", X).payload.nextAction, "W2-B");
const scenarioN = { pass: true };

const o = seed(); o.A.editCase(X, { nextAction: "A" }); o.B.editCase(X, { nextAction: "B" }); o.A.sendNext(); o.B.sendNext();
assert.equal(caseSyncLocalIdForHarness(makeHarnessCase({ id: X })), PROJECTION); assert.equal(o.harness.server.projection(W, PROJECTION).next_action, "A"); assert.equal(o.harness.server.projection(W, X), null); assert.equal(o.harness.server.projectionCount(W), 1);
const scenarioO = { pass: true, canonicalId: X, projectionId: PROJECTION, projectionFromCanonical: true };

const p = seed(); assert.throws(() => p.harness.server.legacyApply(), /client upgrade required/); const scenarioP = { pass: true };

const q = seed(); q.A.editCase(X, { nextAction: "U1" }); const q1 = q.A.outbox[0].operationId; q.A.sendNext({ response: "drop" }); q.A.editCase(X, { nextAction: "U2" });
assert.equal(q.A.outbox.length, 2); const q2 = q.A.outbox.find((op) => op.operationId !== q1).operationId; assert.notEqual(q1, q2); q.A.sendNext(); assert.ok(q.A.outbox.some((op) => op.operationId === q2));
const scenarioQ = { pass: true, U1: q1, U2: q2 };

const r = seed(); r.A.editCase(X, { nextAction: "atomic" }); r.A.failNextAtomicSettlement = true; r.A.sendNext();
assert.equal(r.A.outbox[0].syncStatus, "failed"); assert.equal(r.A.base("case", X), INITIAL); r.A.sendNext(); assert.equal(r.A.outbox.length, 0); assert.equal(r.A.base("case", X), 101);
const scenarioR = { pass: true, noPartialState: true };

const s = seed(); s.A.editCase(X, { nextAction: "local" }); s.B.editCase(X, { nextAction: "remote" }); s.B.sendNext(); s.A.sendNext(); let sRestart = s.harness.restartClient("A");
assert.equal(sRestart.outbox[0].syncStatus, "conflicted"); assert.equal(sRestart.syncConflicts[0].id, sRestart.outbox[0].conflictId); assert.equal(sRestart.flushAll().length, 0);
const scenarioS = { pass: true };

const t = seed(); t.A.editCase(X, { nextAction: "local-pending" }); t.B.editCase(X, { nextAction: "remote-V101" }); t.B.sendNext(); t.harness.server.deliverRealtime("A");
assert.equal(t.A.case(X).nextAction, "local-pending"); assert.equal(t.A.base("case", X), 101); assert.equal(t.A.outbox[0].baseVersion, INITIAL); t.A.sendNext(); assert.equal(t.A.outbox[0].syncStatus, "conflicted");
const scenarioT = { pass: true, localIntentPreserved: true };

const scenarioU = { pass: !m1.orphan && !m2.orphan, bothOrderings: true };

const vHarness = createMultiClientSyncHarness({ baseTimeMs: BASE }); const vA = vHarness.addClient("A", { workshopId: W }); const vB = vHarness.addClient("B", { workshopId: W });
vA.editSettings({ resources: ["A"], holidays: ["A"] }); vB.editSettings({ resources: ["B"], holidays: ["B"] }); vA.sendNext(); const vResult = vB.sendNext();
assert.equal(vResult.conflicted, true); assert.deepEqual(vHarness.server.settings.get(W).value.resources, ["A"]); assert.deepEqual(vB.state.settings.resources, ["B"]);
const scenarioV = { pass: true };

const wHarness = createMultiClientSyncHarness({ baseTimeMs: BASE }); wHarness.server.seedEntity({ workshopId: W, entityType: "case", entityId: X, payload: makeHarnessCase({ id: X, nextAction: "server" }), entityVersion: INITIAL, operationId: "seed" });
const wClient = wHarness.addClient("offline-upgrade", { workshopId: W }); wClient.editCase(X, { nextAction: "unknown-base-local" }); const wResult = wClient.sendNext();
assert.equal(wResult.conflicted, true); assert.equal(wHarness.server.canonical(W, "case", X).payload.nextAction, "server");
const scenarioW = { pass: true };

// Scenario X: an accepted-operation receipt proves that U1 was accepted at
// V101, but a late retry must describe the current V102 canonical row. The
// historical accepted version and the current server version are distinct.
const x = seed();
const xU1 = x.A.editCase(X, { nextAction: "U1" });
x.A.sendNext({ response: "drop" });
const xV101 = x.harness.server.canonical(W, "case", X);
assert.equal(xV101.entity_version, 101);
x.harness.server.deliverRealtime("B");
const xU2 = x.B.editCase(X, { nextAction: "U2" });
const xU2Result = x.B.sendNext();
assert.equal(xU2Result.serverVersion, 102);
const xRetry = x.A.sendNext();
assert.equal(xRetry.accepted, true);
assert.equal(xRetry.idempotent, true);
assert.equal(xRetry.acceptedVersion, 101);
assert.equal(xRetry.serverVersion, 102);
assert.equal(xRetry.canonical.entity_version, 102);
assert.equal(x.A.base("case", X), 102);
const xU3 = x.A.editCase(X, { nextAction: "U3" });
assert.equal(xU3.baseVersion, 102);
let xRestart = x.harness.restartClient("A");
x.harness.server.injectRealtime("A", xV101);
x.harness.server.deliverRealtime("A");
assert.equal(xRestart.base("case", X), 102);
assert.equal(xRestart.case(X).nextAction, "U3");

const xSettingsHarness = createMultiClientSyncHarness({ baseTimeMs: BASE });
xSettingsHarness.server.seedEntity({
  workshopId: W,
  entityType: "case",
  entityId: "settings-sequence-seed",
  payload: makeHarnessCase({ id: "settings-sequence-seed" }),
  entityVersion: 200,
  operationId: "settings-sequence-seed",
});
const xSettingsA = xSettingsHarness.addClient("settings-A", { workshopId: W });
const xSettingsS1 = xSettingsA.editSettings({ resources: ["S1"] });
xSettingsA.sendNext({ response: "drop" });
assert.equal(xSettingsHarness.server.settings.get(W).entity_version, 201);
const xSettingsB = xSettingsHarness.addClient("settings-B", { workshopId: W }).bootstrap();
const xSettingsS2 = xSettingsB.editSettings({ resources: ["S2"] });
const xSettingsS2Result = xSettingsB.sendNext();
assert.equal(xSettingsS2Result.serverVersion, 202);
const xSettingsRetry = xSettingsA.sendNext();
assert.equal(xSettingsRetry.accepted, true);
assert.equal(xSettingsRetry.idempotent, true);
assert.equal(xSettingsRetry.acceptedVersion, 201);
assert.equal(xSettingsRetry.serverVersion, 202);
assert.equal(xSettingsRetry.canonical.entity_version, 202);
assert.equal(xSettingsA.base("workshop_settings", "workshop_settings"), 202);
const xSettingsS3 = xSettingsA.editSettings({ resources: ["S3"] });
assert.equal(xSettingsS3.baseVersion, 202);
const scenarioX = {
  pass: true,
  entity: {
    U1: xU1.operationId,
    U2: xU2.operationId,
    acceptedVersion: xRetry.acceptedVersion,
    serverVersion: xRetry.serverVersion,
    nextBaseVersion: xU3.baseVersion,
  },
  settings: {
    S1: xSettingsS1.operationId,
    S2: xSettingsS2.operationId,
    acceptedVersion: xSettingsRetry.acceptedVersion,
    serverVersion: xSettingsRetry.serverVersion,
    nextBaseVersion: xSettingsS3.baseVersion,
  },
  restartDelayedV101Ignored: true,
};

// A conflict receipt intentionally retains its historical conflict snapshot.
// Even if such a duplicate/late response is settled after V102 was observed,
// the monotonic client metadata guard must retain V102.
const xConflictReplay = seed();
const xConflictOperation = xConflictReplay.A.editCase(X, { nextAction: "conflicting-U1" });
xConflictReplay.B.editCase(X, { nextAction: "remote-V101" });
xConflictReplay.B.sendNext();
xConflictReplay.A.sendNext();
assert.equal(xConflictReplay.A.outbox[0].syncStatus, "conflicted");
xConflictReplay.B.editCase(X, { nextAction: "remote-V102" });
xConflictReplay.B.sendNext();
xConflictReplay.harness.server.deliverRealtime("A");
assert.equal(xConflictReplay.A.base("case", X), 102);
const xHistoricalConflictReplay = xConflictReplay.harness.server.applyEntity(xConflictOperation);
assert.equal(xHistoricalConflictReplay.idempotent, true);
assert.equal(xHistoricalConflictReplay.canonical.entity_version, 101);
xConflictReplay.A._settle(xConflictOperation, xHistoricalConflictReplay);
assert.equal(xConflictReplay.A.base("case", X), 102);
scenarioX.idempotentConflictReplayObservedVersion = xConflictReplay.A.base("case", X);

const auditHarness = createMultiClientSyncHarness({ baseTimeMs: BASE }); const auditA = auditHarness.addClient("A", { workshopId: W }); const auditB = auditHarness.addClient("B", { workshopId: W });
auditA.appendAudit({ id: "audit-A" }); auditB.appendAudit({ id: "audit-B" }); auditA.sendNext({ response: "drop" }); auditB.sendNext(); auditA.sendNext(); assert.equal(auditHarness.server.audits.size, 2);

const projectionRetry = seed(); projectionRetry.A.editCase(X, { nextAction: "projection-retry" }); projectionRetry.harness.server.failNextProjection(); projectionRetry.A.sendNext(); assert.equal(projectionRetry.A.outbox[0].syncStatus, "failed"); const projectionRetryResult = projectionRetry.A.sendNext(); assert.equal(projectionRetryResult.idempotent, true); assert.equal(projectionRetry.harness.server.projection(W, PROJECTION).next_action, "projection-retry");

const resolution = seed(); resolution.A.editCase(X, { nextAction: "keep-local" }); resolution.B.editCase(X, { nextAction: "server" }); resolution.B.sendNext(); resolution.A.sendNext(); const oldId = resolution.A.outbox[0].operationId; const resolved = resolution.A.resolveConflict(resolution.A.syncConflicts[0].id, "keep_local"); assert.notEqual(resolved.replacementOperationId, oldId); assert.equal(resolution.A.outbox[0].baseVersion, 101);

const scenarios = { A: scenarioA, B: scenarioB, C: scenarioC, D: scenarioD, E: scenarioE, F: scenarioF, G: scenarioG, H: scenarioH, I: scenarioI, J: scenarioJ, K: scenarioK, L: scenarioL, M: scenarioM, N: scenarioN, O: scenarioO, P: scenarioP, Q: scenarioQ, R: scenarioR, S: scenarioS, T: scenarioT, U: scenarioU, V: scenarioV, W: scenarioW, X: scenarioX };
assert.ok(Object.values(scenarios).every((scenario) => scenario.pass));
console.log(JSON.stringify({ scenarios, audit: "PASS", projectionFailureRetry: "PASS", conflictResolution: "PASS" }, null, 2));
console.log("P0-010 OFFLINE CONCURRENCY MODEL D ACCEPTANCE OK");
