import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createNimrVmContext } from "./helpers/nimr_vm_context.mjs";
import { createMemoryIndexedDb } from "./helpers/memory_indexeddb.mjs";
import { createGranularSupabaseAdapter } from "./helpers/granular_supabase_adapter.mjs";
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
assert.match(syncSource, /serverVersion:\s*canonical\?\.entity_version\s*\?\?\s*canonical\?\.server_version/);
assert.match(syncSource, /conflictServerVersion:\s*hasExplicitConflictServerVersion/);
assert.match(syncSource, /conflictCanonical,/);
assert.match(syncSource, /fetchCurrentCanonicalForConflict[\s\S]*?from\("sync_entities"\)[\s\S]*?\.eq\("workshop_id", operation\.workshopId\)[\s\S]*?\.eq\("entity_type", operation\.entityType\)[\s\S]*?\.eq\("entity_id", operation\.entityId\)[\s\S]*?\.maybeSingle\(\)/);
assert.match(syncSource, /fetchCurrentCanonicalForConflict[\s\S]*?from\("app_settings"\)[\s\S]*?\.eq\("workshop_id", operation\.workshopId\)[\s\S]*?\.eq\("setting_key", "workshop_settings"\)[\s\S]*?\.maybeSingle\(\)/);
assert.match(syncSource, /retained\?\.syncStatus !== "conflicted"/);
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
assert.match(sqlSource, /'conflict_server_version',\s*existing_conflict\.server_version[\s\S]*?'server_version',\s*current_row\.entity_version/);
assert.match(sqlSource, /'conflict_canonical',[\s\S]*?existing_conflict\.server_payload[\s\S]*?'canonical',\s*case when current_row\.entity_id is null then null else to_jsonb\(current_row\) end/);
assert.match(sqlSource, /nimr_apply_workshop_settings_v2[\s\S]*?'conflict_server_version',conflict_row\.server_version[\s\S]*?'server_version',current_row\.entity_version/);
assert.match(sqlSource, /'base_version',\s*existing_conflict\.base_version[\s\S]*?'local_payload',\s*existing_conflict\.local_payload[\s\S]*?'server_payload',\s*existing_conflict\.server_payload[\s\S]*?'detected_at',\s*existing_conflict\.detected_at/);
assert.equal((sqlSource.match(/'conflict_server_version'/g) || []).length, 6);
assert.equal((sqlSource.match(/'conflict_canonical'/g) || []).length, 6);
assert.match(sqlSource, /select \* into current_row from public\.sync_entities\s+where workshop_id = existing_conflict\.workshop_id\s+and entity_type = existing_conflict\.entity_type\s+and entity_id = existing_conflict\.entity_id/);
assert.match(sqlSource, /select \* into current_row from public\.app_settings\s+where workshop_id = p_workshop_id and setting_key = 'workshop_settings'/);
assert.doesNotMatch(sqlSource, /'server_version',\s*existing_conflict\.server_version/);
assert.doesNotMatch(sqlSource, /'server_version',\s*conflict_row\.server_version/);
assert.doesNotMatch(sqlSource, /service_role|SUPABASE_SERVICE/);

// Conflict resolution authorization is derived from the locked server-side
// conflict row. Settings deliberately exclude technicians even though case
// and booking resolution permits them; non-operational roles stay denied.
const resolveConflictSql = sqlSource.slice(
  sqlSource.indexOf("create or replace function public.nimr_resolve_sync_entity_conflict"),
  sqlSource.indexOf("revoke all on function public.nimr_resolve_sync_entity_conflict"),
);
assert.match(resolveConflictSql, /target_conflict public\.sync_entity_conflicts/);
assert.match(resolveConflictSql, /select \* into target_conflict from public\.sync_entity_conflicts\s+where workshop_id = p_workshop_id and id = p_conflict_id\s+for update/);
assert.doesNotMatch(resolveConflictSql, /p_entity_type/);
assert.match(resolveConflictSql, /if target_conflict\.id is null then\s+return null;\s+end if/);
assert.match(resolveConflictSql, /if target_conflict\.status = 'resolved' then\s+return target_conflict;\s+end if/);
assert.match(resolveConflictSql, /else\s+raise exception 'unsupported conflict entity type'/);
assert.match(resolveConflictSql, /where id = target_conflict\.id and workshop_id = target_conflict\.workshop_id/);
assert.match(resolveConflictSql, /security definer[\s\S]*?set search_path = pg_catalog, public/);
assert.match(sqlSource, /revoke all on table public\.sync_entity_conflicts from anon, authenticated;\s+revoke all on table public\.sync_entity_operation_receipts from anon, authenticated;\s+grant select on table public\.sync_entity_conflicts to authenticated;/);
assert.match(sqlSource, /revoke all on function public\.nimr_resolve_sync_entity_conflict\(uuid, uuid, text\) from public, anon;\s+grant execute on function public\.nimr_resolve_sync_entity_conflict\(uuid, uuid, text\) to authenticated;/);

const settingsAuthorizationSql = resolveConflictSql.match(
  /if target_conflict\.entity_type = 'workshop_settings' then([\s\S]*?)elsif target_conflict\.entity_type in \('case', 'booking'\) then/,
)?.[1] || "";
const caseBookingAuthorizationSql = resolveConflictSql.match(
  /elsif target_conflict\.entity_type in \('case', 'booking'\) then([\s\S]*?)else/,
)?.[1] || "";
const extractAuthorizedRoles = (fragment) => [...fragment.matchAll(/'(admin_technique|directeur|chef_atelier|reception|technicien|controle_qualite|lecture_seule)'/g)]
  .map((match) => match[1]);
const settingsResolutionRoles = extractAuthorizedRoles(settingsAuthorizationSql);
const caseBookingResolutionRoles = extractAuthorizedRoles(caseBookingAuthorizationSql);
assert.deepEqual(settingsResolutionRoles, ["admin_technique", "directeur", "chef_atelier", "reception"]);
assert.deepEqual(caseBookingResolutionRoles, ["admin_technique", "directeur", "chef_atelier", "reception", "technicien"]);
assert.equal(settingsResolutionRoles.includes("technicien"), false);
assert.equal(caseBookingResolutionRoles.includes("technicien"), true, "technicien must resolve case conflicts");
assert.equal(caseBookingResolutionRoles.includes("technicien"), true, "technicien must resolve booking conflicts");
assert.equal(settingsResolutionRoles.includes("reception"), true);
for (const deniedRole of ["controle_qualite", "lecture_seule"]) {
  assert.equal(settingsResolutionRoles.includes(deniedRole), false);
  assert.equal(caseBookingResolutionRoles.includes(deniedRole), false);
}

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
}, { conflictId: "server-conflict-1", serverVersion: 101, canonical: { workshop_id: W, entity_type: "case", entity_id: X, entity_version: 101, last_operation_id: "remote-B-101", payload: makeHarnessCase({ id: X, nextAction: "remote" }) }, conflictServerVersion: 101, conflictCanonical: { workshop_id: W, entity_type: "case", entity_id: X, entity_version: 101, last_operation_id: "remote-B-101", payload: makeHarnessCase({ id: X, nextAction: "remote" }) }, baseVersion: 100, localPayload: atomicConflict.payload, serverPayload: makeHarnessCase({ id: X, nextAction: "remote" }), detectedAt: "2026-08-24T00:00:00.000Z" });
const atomicConflictRecord = (await atomicVm.context.loadDurableOutboxOperations()).find((entry) => entry.operationId === atomicConflict.operationId);
assert.equal(atomicConflictRecord.syncStatus, "conflicted");
assert.equal(atomicConflictRecord.conflictId, "server-conflict-1");
assert.equal(atomicConflictRecord.conflictServerVersion, 101);
assert.equal(atomicConflictRecord.conflictCanonical.entity_version, 101);
assert.equal(atomicConflictRecord.conflictBaseVersion, 100);
assert.equal(atomicConflictRecord.conflictServerPayload.nextAction, "remote");
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
const normalizedConflictReplay = restartVm.context.NIMR_GRANULAR_SYNC_TEST_API.normalizeCanonicalCasOutcome({
  status: "conflict",
  accepted: false,
  idempotent: true,
  conflict: true,
  conflict_id: "conflict-normalized-Y1",
  conflict_server_version: 101,
  conflict_canonical: { entity_version: 101, payload: { nextAction: "V101" } },
  server_version: 102,
  canonical: { entity_version: 102, payload: { nextAction: "V102" } },
});
assert.equal(normalizedConflictReplay.conflictServerVersion, 101);
assert.equal(normalizedConflictReplay.conflictCanonical.entity_version, 101);
assert.equal(normalizedConflictReplay.serverVersion, 102);
assert.equal(normalizedConflictReplay.canonical.entity_version, 102);
const normalizedLegacyConflict = restartVm.context.NIMR_GRANULAR_SYNC_TEST_API.normalizeCanonicalCasOutcome({
  status: "conflict", conflict: true, server_version: 101, canonical: { entity_version: 101 },
});
assert.equal(normalizedLegacyConflict.serverVersion, null);
assert.equal(normalizedLegacyConflict.canonical, null);
assert.equal(normalizedLegacyConflict.conflictServerVersion, 101);
assert.equal(normalizedLegacyConflict.conflictCanonical.entity_version, 101);
await restartVm.context.hydrateObservedGranularEntityMetadata(W);
restartVm.run(`state.cases = [{ id: ${JSON.stringify(X)}, nextAction: "V102", localRevision: 1 }]; state.bookings = [];`);
await restartVm.context.handleRemoteCaseChange({ workshop_id: W, entity_type: "case", entity_id: X, entity_version: 101, last_operation_id: "late-U1-101", payload: makeHarnessCase({ id: X, nextAction: "V101" }) }, "UPDATE");
assert.equal(restartVm.run(`state.cases.find((item) => item.id === ${JSON.stringify(X)}).nextAction`), "V102");
assert.equal(restartVm.context.getObservedGranularServerVersion(W, "case", X), 102);

async function createProductionResolutionFixture({ entityType = "case", localMarker = "A-local", currentMarker = "V102" } = {}) {
  const indexedDb = createMemoryIndexedDb();
  const fixture = createNimrVmContext({ filename: `p0-010-resolution-${entityType}.js` });
  fixture.context.indexedDB = indexedDb;
  vm.runInContext(syncSource, fixture.context, { filename: `supabase-sync-p010-resolution-${entityType}.js` });
  const adapter = createGranularSupabaseAdapter();
  fixture.context.__p010Client = adapter.client;
  fixture.run(`getSupabaseClient = () => window.__p010Client; getSupabaseWorkshopId = () => ${JSON.stringify(W)}; scheduleAutoSupabaseBackup = () => {}; renderSyncStatusStrip = () => {};`);
  let payload;
  let canonical;
  if (entityType === "workshop_settings") {
    payload = fixture.run("buildWorkshopSettingsPayload(state)");
    payload.settings = { ...(payload.settings || {}), concurrencyMarker: localMarker };
    const currentPayload = structuredClone(payload);
    currentPayload.settings.concurrencyMarker = currentMarker;
    canonical = { workshop_id: W, setting_key: "workshop_settings", value: currentPayload, entity_version: 202, last_operation_id: "settings-current-V202", updated_at: "2026-08-24T12:02:00.000Z" };
    adapter.settings.set(W, structuredClone(canonical));
    fixture.context.__p010LocalSettings = payload;
    fixture.run("applyWorkshopSettingsToState(window.__p010LocalSettings)");
  } else {
    payload = { entity: makeHarnessCase({ id: X, nextAction: localMarker }) };
    canonical = { workshop_id: W, entity_type: "case", entity_id: X, payload: makeHarnessCase({ id: X, nextAction: currentMarker }), entity_version: 102, last_operation_id: "case-current-V102", deleted_at: null, updated_at: "2026-08-24T12:02:00.000Z" };
    adapter.entities.set(`${W}|case|${X}`, structuredClone(canonical));
    fixture.context.__p010LocalCase = payload.entity;
    fixture.run("state.cases = [window.__p010LocalCase]; state.bookings = [];");
  }
  const operationId = `production-resolution-${entityType}-${localMarker}`;
  const operation = fixture.context.normalizeDurableOutboxOperation({
    operationId,
    idempotencyKey: `${W}:${operationId}`,
    workshopId: W,
    entityType,
    entityId: entityType === "workshop_settings" ? "workshop_settings" : X,
    action: "upsert",
    baseVersion: entityType === "workshop_settings" ? 200 : 100,
    payload: entityType === "workshop_settings" ? { entity: payload } : payload,
    syncStatus: "conflicted",
    conflictId: `server-${operationId}`,
    serverVersion: entityType === "workshop_settings" ? 201 : 101,
    canonical: entityType === "workshop_settings"
      ? { ...canonical, value: { ...canonical.value, settings: { concurrencyMarker: "historical-V201" } }, entity_version: 201 }
      : { ...canonical, payload: makeHarnessCase({ id: X, nextAction: "historical-V101" }), entity_version: 101 },
  });
  await fixture.context.putDurableOutboxOperation(operation);
  adapter.recordServerConflict({
    id: operation.conflictId,
    workshop_id: W,
    local_operation_id: operationId,
    entity_type: entityType,
    entity_id: operation.entityId,
    status: "open",
  });
  const conflict = {
    id: `local-${operationId}`,
    localOperationId: operationId,
    serverConflictId: `server-${operationId}`,
    canonical: operation.canonical,
    serverVersion: operation.serverVersion,
  };
  return { fixture, adapter, operation, conflict, canonical, payload };
}

const productionAccept = await createProductionResolutionFixture();
const productionAcceptResult = await productionAccept.fixture.context.resolveCanonicalConcurrencyConflict(productionAccept.conflict, "accept_cloud");
assert.equal(productionAcceptResult.serverVersion, 102);
assert.equal(productionAccept.fixture.run(`state.cases.find((item) => item.id === ${JSON.stringify(X)}).nextAction`), "V102");
assert.equal((await productionAccept.fixture.context.loadDurableOutboxOperations()).length, 0);
assert.equal(productionAccept.fixture.context.getObservedGranularServerVersion(W, "case", X), 102);

const productionUiAccept = await createProductionResolutionFixture({ localMarker: "A-through-normalized-UI" });
const productionUiConflictId = productionUiAccept.operation.conflictId;
productionUiAccept.fixture.context.__p010UiConflict = {
  id: productionUiConflictId,
  type: "server_entity_conflict",
  status: "open",
  entityType: "case",
  entityId: X,
  localOperationId: productionUiAccept.operation.operationId,
  serverConflictId: productionUiConflictId,
  localValue: makeHarnessCase({ id: X, nextAction: "A-through-normalized-UI" }),
  remoteValue: makeHarnessCase({ id: X, nextAction: "historical-V101" }),
};
productionUiAccept.fixture.run("state.syncConflicts = [window.__p010UiConflict]");
const productionUiResolution = productionUiAccept.fixture.context.resolveSyncConflict(productionUiConflictId, "accept_cloud");
assert.equal(productionUiResolution.pending, true);
const productionUiCompletion = await productionUiResolution.completion;
assert.equal(productionUiCompletion.serverVersion, 102);
assert.equal(productionUiAccept.fixture.run(`state.cases.find((item) => item.id === ${JSON.stringify(X)}).nextAction`), "V102");
assert.equal((await productionUiAccept.fixture.context.loadDurableOutboxOperations()).length, 0);

const productionKeep = await createProductionResolutionFixture({ localMarker: "A-production-keep" });
const productionKeepResult = await productionKeep.fixture.context.resolveCanonicalConcurrencyConflict(productionKeep.conflict, "keep_local");
const productionKeepOutbox = await productionKeep.fixture.context.loadDurableOutboxOperations();
const productionReplacement = productionKeepOutbox.find((entry) => entry.operationId === productionKeepResult.replacementOperationId);
assert.ok(productionReplacement);
assert.notEqual(productionReplacement.operationId, productionKeep.operation.operationId);
assert.equal(productionReplacement.baseVersion, 102);
assert.equal(productionReplacement.payload.entity.nextAction, "A-production-keep");
const productionKeepAccepted = await productionKeep.fixture.context.NIMR_GRANULAR_SYNC_TEST_API.sendGranularOutboxOperation(productionKeep.adapter.client, {}, productionReplacement);
assert.equal(productionKeepAccepted.accepted, true);
assert.equal(productionKeepAccepted.serverVersion, 103);

const productionRefreshFailure = await createProductionResolutionFixture({ localMarker: "A-refresh-must-not-guess" });
productionRefreshFailure.adapter.injectFailure({ message: "Injected current canonical refresh failure" });
await assert.rejects(
  productionRefreshFailure.fixture.context.resolveCanonicalConcurrencyConflict(productionRefreshFailure.conflict, "accept_cloud"),
  /current canonical refresh failure/,
);
const productionRefreshFailureOutbox = await productionRefreshFailure.fixture.context.loadDurableOutboxOperations();
assert.equal(productionRefreshFailureOutbox[0].syncStatus, "conflicted");
assert.equal(productionRefreshFailure.fixture.run(`state.cases.find((item) => item.id === ${JSON.stringify(X)}).nextAction`), "A-refresh-must-not-guess");

const productionSettingsAccept = await createProductionResolutionFixture({ entityType: "workshop_settings", localMarker: "A-settings-local", currentMarker: "settings-V202" });
const productionSettingsAcceptResult = await productionSettingsAccept.fixture.context.resolveCanonicalConcurrencyConflict(productionSettingsAccept.conflict, "accept_cloud");
assert.equal(productionSettingsAcceptResult.serverVersion, 202);
assert.equal(productionSettingsAccept.fixture.run("state.settings.concurrencyMarker"), "settings-V202");
assert.equal((await productionSettingsAccept.fixture.context.loadDurableOutboxOperations()).length, 0);

const productionSettingsKeep = await createProductionResolutionFixture({ entityType: "workshop_settings", localMarker: "A-settings-keep", currentMarker: "settings-V202" });
const productionSettingsKeepResult = await productionSettingsKeep.fixture.context.resolveCanonicalConcurrencyConflict(productionSettingsKeep.conflict, "keep_local");
const productionSettingsReplacement = (await productionSettingsKeep.fixture.context.loadDurableOutboxOperations())
  .find((entry) => entry.operationId === productionSettingsKeepResult.replacementOperationId);
assert.equal(productionSettingsReplacement.baseVersion, 202);
assert.equal(productionSettingsReplacement.payload.entity.concurrencyMarker, "A-settings-keep");

const productionTerminalDb = createMemoryIndexedDb();
const productionTerminalVm = createNimrVmContext({ filename: "p0-010-production-terminal-conflict.js" });
productionTerminalVm.context.indexedDB = productionTerminalDb;
vm.runInContext(syncSource, productionTerminalVm.context, { filename: "supabase-sync-p010-production-terminal.js" });
const productionTerminalAdapter = createGranularSupabaseAdapter();
productionTerminalAdapter.entities.set(`${W}|case|${X}`, {
  workshop_id: W, entity_type: "case", entity_id: X,
  payload: makeHarnessCase({ id: X, nextAction: "terminal-current-V101" }),
  entity_version: 101, last_operation_id: "terminal-current-V101",
  deleted_at: null, updated_at: "2026-08-24T12:01:00.000Z",
});
productionTerminalVm.context.__p010TerminalClient = productionTerminalAdapter.client;
productionTerminalVm.context.__p010TerminalCase = makeHarnessCase({ id: X, nextAction: "terminal-A-local" });
productionTerminalVm.run(`getSupabaseClient = () => window.__p010TerminalClient; getSupabaseWorkshopId = () => ${JSON.stringify(W)}; state.cases = [window.__p010TerminalCase]; state.bookings = []; saveState = async () => { throw new Error("Injected production post-conflict transition failure"); };`);
const productionTerminalOperation = productionTerminalVm.context.normalizeDurableOutboxOperation({
  operationId: "production-terminal-U1", idempotencyKey: `${W}:production-terminal-U1`,
  workshopId: W, entityType: "case", entityId: X, action: "upsert", baseVersion: 100,
  payload: { entity: productionTerminalVm.context.__p010TerminalCase }, syncStatus: "pending",
});
await productionTerminalVm.context.putDurableOutboxOperation(productionTerminalOperation);
const productionTerminalResults = await productionTerminalVm.context.NIMR_GRANULAR_SYNC_TEST_API.processGranularOutboxBatch(
  productionTerminalAdapter.client,
  {},
  [productionTerminalOperation],
);
assert.match(productionTerminalResults[0].error, /production post-conflict transition failure/);
const productionTerminalRetained = (await productionTerminalVm.context.loadDurableOutboxOperations())
  .find((entry) => entry.operationId === productionTerminalOperation.operationId);
assert.equal(productionTerminalRetained.syncStatus, "conflicted");
assert.equal(productionTerminalRetained.conflictServerVersion, 101);
assert.match(syncSource, /\.filter\(\(entry\) => \["pending", "processing", "settling", "failed"\]\.includes\(entry\.syncStatus\)\)/);

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

// Conflict replay follows the same split as accepted receipt replay: immutable
// conflict evidence remains V101 while current authority is V102.
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
assert.equal(xHistoricalConflictReplay.conflictServerVersion, 101);
assert.equal(xHistoricalConflictReplay.conflictCanonical.entity_version, 101);
assert.equal(xHistoricalConflictReplay.serverVersion, 102);
assert.equal(xHistoricalConflictReplay.canonical.entity_version, 102);
xConflictReplay.A._settle(xConflictOperation, xHistoricalConflictReplay);
assert.equal(xConflictReplay.A.base("case", X), 102);
scenarioX.idempotentConflictReplayObservedVersion = xConflictReplay.A.base("case", X);

// Scenario Y1: a conflict snapshot is historical evidence, never current
// authority. A projection failure leaves A/U1 retryable after the server has
// recorded its V101 conflict. B then advances the entity and its real-identity
// repair_orders projection to V102. Retrying A/U1 must return both versions
// distinctly and must reconcile only from the current V102 canonical row.
const y1 = seed();
const y1U1 = y1.A.editCase(X, { nextAction: "A-local-U1" });
y1.B.editCase(X, { nextAction: "B-current-V101" });
y1.B.sendNext();
y1.harness.server.failNextProjection(new Error("Injected Y1 projection/network failure"));
const y1FirstConflict = y1.A.sendNext();
assert.match(y1FirstConflict.error, /Injected Y1 projection\/network failure/);
assert.equal(y1.A.outbox[0].syncStatus, "failed");
const y1StoredConflict = y1.harness.server.openConflicts(W)[0];
assert.equal(y1StoredConflict.server_version, 101);
assert.equal(y1StoredConflict.server_payload.nextAction, "B-current-V101");
y1.B.editCase(X, { nextAction: "B-current-V102" });
y1.B.sendNext();
assert.equal(y1.harness.server.canonical(W, "case", X).entity_version, 102);
assert.equal(y1.harness.server.projection(W, PROJECTION).canonical_version, 102);
assert.notEqual(X, PROJECTION, "the deterministic projection must exercise the real local identity");
const y1Replay = y1.A.sendNext();
assert.equal(y1Replay.conflict, true);
assert.equal(y1Replay.idempotent, true);
assert.equal(y1Replay.conflictServerVersion, 101);
assert.equal(y1Replay.conflictCanonical.entity_version, 101);
assert.equal(y1Replay.serverVersion, 102);
assert.equal(y1Replay.canonical.entity_version, 102);
assert.equal(y1.harness.server.projection(W, PROJECTION).canonical_version, 102);
assert.equal(y1.harness.server.projection(W, PROJECTION).next_action, "B-current-V102");
assert.equal(y1.A.outbox[0].syncStatus, "conflicted");
const y1EvidenceAfterReplay = y1.harness.server.openConflicts(W)[0];
assert.equal(y1EvidenceAfterReplay.server_version, 101);
assert.equal(y1EvidenceAfterReplay.server_payload.nextAction, "B-current-V101");
const scenarioY1 = {
  pass: true,
  operationId: y1U1.operationId,
  historicalVersion: y1Replay.conflictServerVersion,
  currentVersion: y1Replay.serverVersion,
  projectionVersion: y1.harness.server.projection(W, PROJECTION).canonical_version,
};

// Scenario Y2: ACCEPT SERVER is resolved from a fresh current read. A observes
// V102 without losing its conflicted intent, then explicitly accepts V102—not
// the V101 snapshot retained in the conflict record.
const y2 = seed();
y2.A.editCase(X, { nextAction: "A-conflicted-intent" });
y2.B.editCase(X, { nextAction: "B-history-V101" });
y2.B.sendNext();
y2.A.sendNext();
const y2Conflict = y2.A.syncConflicts[0];
assert.equal(y2Conflict.conflictCanonical.entity_version, 101);
y2.B.editCase(X, { nextAction: "B-current-V102" });
y2.B.sendNext();
y2.harness.server.deliverRealtime("A");
assert.equal(y2.A.base("case", X), 102);
assert.equal(y2.A.case(X).nextAction, "A-conflicted-intent");
y2.A.resolveConflict(y2Conflict.id, "accept_server");
assert.equal(y2.A.case(X).nextAction, "B-current-V102");
assert.equal(y2.A.base("case", X), 102);
assert.equal(y2.A.outbox.length, 0);
assert.equal(y2.harness.server.projection(W, PROJECTION).canonical_version, 102);
const scenarioY2 = { pass: true, acceptedServerVersion: y2.A.base("case", X), staleHistoricalApplied: false };

// Scenario Y3: KEEP LOCAL also refreshes current authority. The replacement
// preserves A's losing payload, receives a new operationId and bases on V102,
// so it is accepted as V103 when no intervening write occurs.
const y3 = seed();
const y3Old = y3.A.editCase(X, { nextAction: "A-preserved-local" });
y3.B.editCase(X, { nextAction: "B-history-V101" });
y3.B.sendNext();
y3.A.sendNext();
const y3Conflict = y3.A.syncConflicts[0];
y3.B.editCase(X, { nextAction: "B-current-V102" });
y3.B.sendNext();
y3.harness.server.deliverRealtime("A");
const y3Resolved = y3.A.resolveConflict(y3Conflict.id, "keep_local");
const y3Replacement = y3.A.outbox.find((entry) => entry.operationId === y3Resolved.replacementOperationId);
assert.ok(y3Replacement);
assert.notEqual(y3Replacement.operationId, y3Old.operationId);
assert.equal(y3Replacement.baseVersion, 102);
assert.equal(y3Replacement.payload.entity.nextAction, "A-preserved-local");
const y3Accepted = y3.A.sendNext();
assert.equal(y3Accepted.accepted, true);
assert.equal(y3Accepted.conflict, false);
assert.equal(y3Accepted.serverVersion, 103);
assert.equal(y3.harness.server.canonical(W, "case", X).payload.nextAction, "A-preserved-local");
const scenarioY3 = { pass: true, replacementBaseVersion: 102, acceptedVersion: 103 };

function settingsConflictAdvanced() {
  const harness = createMultiClientSyncHarness({ baseTimeMs: BASE });
  harness.server.seedEntity({ workshopId: W, entityType: "case", entityId: "settings-sequence-Y", payload: makeHarnessCase({ id: "settings-sequence-Y" }), entityVersion: 200, operationId: "settings-sequence-Y" });
  const A = harness.addClient("settings-Y-A", { workshopId: W });
  const B = harness.addClient("settings-Y-B", { workshopId: W });
  A.editSettings({ resources: ["A-local"] });
  B.editSettings({ resources: ["B-history-V201"] });
  B.sendNext();
  A.sendNext();
  const conflict = A.syncConflicts[0];
  assert.equal(conflict.conflictServerVersion, 201);
  assert.deepEqual(conflict.conflictCanonical.value.resources, ["B-history-V201"]);
  B.editSettings({ resources: ["B-current-V202"] });
  B.sendNext();
  const current = harness.server.settings.get(W);
  A.remember(current, "workshop_settings", "workshop_settings");
  assert.equal(A.base("workshop_settings", "workshop_settings"), 202);
  assert.deepEqual(A.state.settings.resources, ["A-local"]);
  const retainedEvidence = harness.server.openConflicts(W)[0];
  assert.equal(retainedEvidence.server_version, 201);
  assert.deepEqual(retainedEvidence.server_payload.resources, ["B-history-V201"]);
  return { harness, A, B, conflict };
}

const ySettingsAccept = settingsConflictAdvanced();
ySettingsAccept.A.resolveConflict(ySettingsAccept.conflict.id, "accept_server");
assert.deepEqual(ySettingsAccept.A.state.settings.resources, ["B-current-V202"]);
assert.equal(ySettingsAccept.A.base("workshop_settings", "workshop_settings"), 202);
assert.equal(ySettingsAccept.A.outbox.length, 0);

const ySettingsKeep = settingsConflictAdvanced();
const ySettingsResolved = ySettingsKeep.A.resolveConflict(ySettingsKeep.conflict.id, "keep_local");
const ySettingsReplacement = ySettingsKeep.A.outbox.find((entry) => entry.operationId === ySettingsResolved.replacementOperationId);
assert.equal(ySettingsReplacement.baseVersion, 202);
assert.deepEqual(ySettingsReplacement.payload.entity.resources, ["A-local"]);
const ySettingsAccepted = ySettingsKeep.A.sendNext();
assert.equal(ySettingsAccepted.accepted, true);
assert.equal(ySettingsAccepted.serverVersion, 203);
const scenarioYSettings = { pass: true, historicalVersion: 201, currentVersion: 202, acceptServerVersion: 202, keepLocalBaseVersion: 202, keepLocalAcceptedVersion: 203 };

// A post-transition UI/state error cannot turn a durable terminal conflict
// back into a retryable failure.
const yTerminal = seed();
yTerminal.A.editCase(X, { nextAction: "A-terminal-local" });
yTerminal.B.editCase(X, { nextAction: "B-terminal-server" });
yTerminal.B.sendNext();
yTerminal.A.failAfterNextConflictTransition();
const yTerminalResult = yTerminal.A.sendNext();
assert.match(yTerminalResult.error, /post-conflict transition failure/);
assert.equal(yTerminal.A.outbox[0].syncStatus, "conflicted");
assert.equal(yTerminal.A.flushAll().length, 0);
assert.equal(yTerminal.harness.server.applyLog.filter((entry) => entry.operationId === yTerminal.A.outbox[0].operationId).length, 0);
const scenarioYTerminal = { pass: true, finalStatus: "conflicted", automaticRetry: false };

const auditHarness = createMultiClientSyncHarness({ baseTimeMs: BASE }); const auditA = auditHarness.addClient("A", { workshopId: W }); const auditB = auditHarness.addClient("B", { workshopId: W });
auditA.appendAudit({ id: "audit-A" }); auditB.appendAudit({ id: "audit-B" }); auditA.sendNext({ response: "drop" }); auditB.sendNext(); auditA.sendNext(); assert.equal(auditHarness.server.audits.size, 2);

const projectionRetry = seed(); projectionRetry.A.editCase(X, { nextAction: "projection-retry" }); projectionRetry.harness.server.failNextProjection(); projectionRetry.A.sendNext(); assert.equal(projectionRetry.A.outbox[0].syncStatus, "failed"); const projectionRetryResult = projectionRetry.A.sendNext(); assert.equal(projectionRetryResult.idempotent, true); assert.equal(projectionRetry.harness.server.projection(W, PROJECTION).next_action, "projection-retry");

const resolution = seed(); resolution.A.editCase(X, { nextAction: "keep-local" }); resolution.B.editCase(X, { nextAction: "server" }); resolution.B.sendNext(); resolution.A.sendNext(); const oldId = resolution.A.outbox[0].operationId; const resolved = resolution.A.resolveConflict(resolution.A.syncConflicts[0].id, "keep_local"); assert.notEqual(resolved.replacementOperationId, oldId); assert.equal(resolution.A.outbox[0].baseVersion, 101);

const scenarios = { A: scenarioA, B: scenarioB, C: scenarioC, D: scenarioD, E: scenarioE, F: scenarioF, G: scenarioG, H: scenarioH, I: scenarioI, J: scenarioJ, K: scenarioK, L: scenarioL, M: scenarioM, N: scenarioN, O: scenarioO, P: scenarioP, Q: scenarioQ, R: scenarioR, S: scenarioS, T: scenarioT, U: scenarioU, V: scenarioV, W: scenarioW, X: scenarioX, Y1: scenarioY1, Y2: scenarioY2, Y3: scenarioY3, YSettings: scenarioYSettings, YTerminal: scenarioYTerminal };
assert.ok(Object.values(scenarios).every((scenario) => scenario.pass));
console.log(JSON.stringify({ scenarios, audit: "PASS", projectionFailureRetry: "PASS", conflictResolution: "PASS" }, null, 2));
console.log("P0-010 OFFLINE CONCURRENCY MODEL D ACCEPTANCE OK");
