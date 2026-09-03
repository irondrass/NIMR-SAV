import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createNimrVmContext } from "./helpers/nimr_vm_context.mjs";
import { createMemoryIndexedDb } from "./helpers/memory_indexeddb.mjs";
import { createGranularSupabaseAdapter } from "./helpers/granular_supabase_adapter.mjs";

const WORKSHOP_ID = "00000000-0000-0000-0000-000000000001";
const TARGET_CASE_ID = "case-c96c07eb-9acd-4c20-8af5-bdefc928d54a";

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

function makeProductionTargetCase(overrides = {}) {
  return {
    id: TARGET_CASE_ID,
    clientName: "Client Production",
    vehicle: "Véhicule Carrosserie",
    plate: "123-TN-4567",
    orNavNumber: "OR-2026-0099",
    status: "in_progress",
    localRevision: 69,
    syncRevision: 69,
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

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

// -------------------------------------------------------------
// A. HYDRATION BASELINE INITIALIZED
// -------------------------------------------------------------
test("A. HYDRATION BASELINE INITIALIZED: state contains case, comparable baseline is populated, localRevision remains 69", async () => {
  const sharedIdb = createMemoryIndexedDb();
  const initVm = loadSyncVm("a-init");
  initVm.context.indexedDB = sharedIdb;

  const targetCase = makeProductionTargetCase({ localRevision: 69 });
  await initVm.context.persistLargeStateSnapshot({
    cases: [targetCase],
    bookings: [],
    settings: {},
  });

  // Fresh VM simulating browser reload
  const reloadVm = loadSyncVm("a-reload");
  reloadVm.context.indexedDB = sharedIdb;

  // Hydrate from IndexedDB
  const outcome = await reloadVm.context.hydrateLargeStateIfAvailable();
  assert.equal(outcome.hydrated, true);

  // 1. state contains hydrated case
  assert.equal(reloadVm.run("state.cases.length"), 1);
  assert.equal(reloadVm.run("state.cases[0].id"), TARGET_CASE_ID);

  // 2. localRevision remains 69
  assert.equal(reloadVm.run("state.cases[0].localRevision"), 69);

  // 3. comparable baseline is NOT empty and contains exact hydrated case
  const runtimeScope = reloadVm.context.getComparableRuntimeScope();
  assert.ok(runtimeScope.lastKnownCasesComparable, "Comparable runtime baseline must exist");
  const storedJson = runtimeScope.lastKnownCasesComparable[TARGET_CASE_ID];
  assert.ok(storedJson, "Comparable entry for target case must be populated");
  const expectedJson = reloadVm.context.getComparableCaseJSON(reloadVm.run("state.cases[0]"));
  assert.equal(storedJson, expectedJson, "Comparable entry must match hydrated case comparable JSON");
});

// -------------------------------------------------------------
// B. STARTUP IDENTITY MIRROR
// -------------------------------------------------------------
test("B. STARTUP IDENTITY MIRROR: startup saveState does not increment revision (69 -> 69)", async () => {
  const sharedIdb = createMemoryIndexedDb();
  const initVm = loadSyncVm("b-init");
  initVm.context.indexedDB = sharedIdb;

  const targetCase = makeProductionTargetCase({ localRevision: 69 });
  await initVm.context.persistLargeStateSnapshot({
    cases: [targetCase],
    bookings: [],
    settings: {},
  });

  const reloadVm = loadSyncVm("b-reload");
  reloadVm.context.indexedDB = sharedIdb;

  await reloadVm.context.hydrateLargeStateIfAvailable();
  reloadVm.context.activeCaseId = TARGET_CASE_ID;

  // Simulate startup identity mirror saveState from persistValidatedSupabaseIdentity
  await reloadVm.context.saveState({
    skipCloud: true,
    skipSnapshot: true,
    cloudReason: "validated-membership-mirror",
  });

  assert.equal(
    reloadVm.run("state.cases[0].localRevision"),
    69,
    "localRevision must remain 69 across startup saveState"
  );
});

// -------------------------------------------------------------
// C. CLEAN HYDRATE + IDENTICAL REMOTE CANONICAL
// -------------------------------------------------------------
test("C. CLEAN HYDRATE + IDENTICAL REMOTE CANONICAL: identical local & remote canonical preserves localRevision unchanged", async () => {
  const sharedIdb = createMemoryIndexedDb();
  const adapter = createGranularSupabaseAdapter({ workshopId: WORKSHOP_ID });

  const targetCase = makeProductionTargetCase({ localRevision: 69 });
  adapter.entities.set(`${WORKSHOP_ID}|case|${TARGET_CASE_ID}`, {
    workshop_id: WORKSHOP_ID,
    entity_type: "case",
    entity_id: TARGET_CASE_ID,
    entity_version: 129,
    last_operation_id: "op-server-canonical",
    deleted_at: null,
    updated_at: "2026-09-03T11:00:00.000Z",
    payload: structuredClone(targetCase),
  });

  const initVm = loadSyncVm("c-init");
  initVm.context.indexedDB = sharedIdb;
  await initVm.context.persistLargeStateSnapshot({
    cases: [targetCase],
    bookings: [],
    settings: {},
  });

  const reloadVm = loadSyncVm("c-reload");
  reloadVm.context.indexedDB = sharedIdb;
  reloadVm.context.getSupabaseClient = () => adapter.client;

  await reloadVm.context.hydrateLargeStateIfAvailable();
  reloadVm.context.activeCaseId = TARGET_CASE_ID;

  // Record observed metadata as in normal converged state
  await reloadVm.context.rememberObservedGranularEntityMetadata({
    workshopId: WORKSHOP_ID,
    entityType: "case",
    entityId: TARGET_CASE_ID,
    serverVersion: 129,
    lastOperationId: "op-server-canonical",
    deleted: false,
    updatedAt: "2026-09-03T11:00:00.000Z",
  });

  // Pull remote canonical
  await reloadVm.context.pullLatestSupabaseBackup("session-restore");

  // Local revision must remain 69
  assert.equal(
    reloadVm.run("state.cases[0].localRevision"),
    69,
    "localRevision must remain unchanged after pulling identical remote canonical"
  );
});

// -------------------------------------------------------------
// D. CLEAN RELOAD x5 (PRIMARY REGRESSION)
// -------------------------------------------------------------
test("D. CLEAN RELOAD x5: 5 simulated clean application reloads yield sequence [69, 69, 69, 69, 69, 69]", async () => {
  const sharedIdb = createMemoryIndexedDb();

  const seedVm = loadSyncVm("d-seed");
  seedVm.context.indexedDB = sharedIdb;
  const initialCase = makeProductionTargetCase({ localRevision: 69 });
  await seedVm.context.persistLargeStateSnapshot({
    cases: [initialCase],
    bookings: [],
    settings: {},
  });

  const observedRevisions = [69];

  // Simulate 5 consecutive clean application reloads
  for (let cycle = 1; cycle <= 5; cycle++) {
    const reloadVm = loadSyncVm(`d-cycle-${cycle}`);
    reloadVm.context.indexedDB = sharedIdb;

    // 1. App startup: hydrate from IndexedDB
    await reloadVm.context.hydrateLargeStateIfAvailable();
    reloadVm.context.activeCaseId = TARGET_CASE_ID;

    // 2. App startup: checkUserSessionStartup calls persistValidatedSupabaseIdentity -> saveState
    await reloadVm.context.saveState({
      skipCloud: true,
      skipSnapshot: true,
      cloudReason: "validated-membership-mirror",
    });

    const currentRev = reloadVm.run("state.cases[0].localRevision");
    observedRevisions.push(currentRev);
  }

  // Sequence must remain exactly 69 across all 5 clean reloads
  assert.deepEqual(
    observedRevisions,
    [69, 69, 69, 69, 69, 69],
    "Sequence must be [69, 69, 69, 69, 69, 69] with zero drift"
  );
});

// -------------------------------------------------------------
// E. REAL USER EDIT CONTROL
// -------------------------------------------------------------
test("E. REAL USER EDIT CONTROL: modifying a real business field increments localRevision (69 -> 70)", async () => {
  const sharedIdb = createMemoryIndexedDb();
  const initVm = loadSyncVm("e-init");
  initVm.context.indexedDB = sharedIdb;

  const initialCase = makeProductionTargetCase({ localRevision: 69 });
  await initVm.context.persistLargeStateSnapshot({
    cases: [initialCase],
    bookings: [],
    settings: {},
  });

  const reloadVm = loadSyncVm("e-reload");
  reloadVm.context.indexedDB = sharedIdb;

  await reloadVm.context.hydrateLargeStateIfAvailable();
  reloadVm.context.activeCaseId = TARGET_CASE_ID;

  const targetCase = reloadVm.run("state.cases[0]");
  assert.equal(targetCase.localRevision, 69);

  // User performs real edit on vehicle field
  targetCase.vehicle = "Nouveau Modèle Atelier";

  // Normal business save path
  await reloadVm.context.saveState({ changedCase: targetCase });

  assert.equal(
    reloadVm.run("state.cases[0].localRevision"),
    70,
    "Real business edit must increment localRevision from 69 to 70"
  );
  assert.equal(reloadVm.run("state.cases[0].vehicle"), "Nouveau Modèle Atelier");
});

// -------------------------------------------------------------
// F. SECOND SAVE WITHOUT CHANGE
// -------------------------------------------------------------
test("F. SECOND SAVE WITHOUT CHANGE: after genuine edit reaches 70, second save without change stays at 70 (70 -> 70)", async () => {
  const sharedIdb = createMemoryIndexedDb();
  const initVm = loadSyncVm("f-init");
  initVm.context.indexedDB = sharedIdb;

  const initialCase = makeProductionTargetCase({ localRevision: 69 });
  await initVm.context.persistLargeStateSnapshot({
    cases: [initialCase],
    bookings: [],
    settings: {},
  });

  const reloadVm = loadSyncVm("f-reload");
  reloadVm.context.indexedDB = sharedIdb;

  await reloadVm.context.hydrateLargeStateIfAvailable();
  reloadVm.context.activeCaseId = TARGET_CASE_ID;

  const targetCase = reloadVm.run("state.cases[0]");

  // Real edit: 69 -> 70
  targetCase.clientName = "Client Modifié";
  await reloadVm.context.saveState({ changedCase: targetCase });
  assert.equal(reloadVm.run("state.cases[0].localRevision"), 70);

  // Second save without business change
  await reloadVm.context.saveState();
  assert.equal(
    reloadVm.run("state.cases[0].localRevision"),
    70,
    "Second save without business change must remain at 70"
  );
});

// -------------------------------------------------------------
// G. TECHNICAL-ONLY CHANGE
// -------------------------------------------------------------
test("G. TECHNICAL-ONLY CHANGE: changes to syncRevision, updatedAt, updatedBy, history do not increment localRevision", async () => {
  const sharedIdb = createMemoryIndexedDb();
  const initVm = loadSyncVm("g-init");
  initVm.context.indexedDB = sharedIdb;

  const initialCase = makeProductionTargetCase({ localRevision: 69, syncRevision: 68 });
  await initVm.context.persistLargeStateSnapshot({
    cases: [initialCase],
    bookings: [],
    settings: {},
  });

  const reloadVm = loadSyncVm("g-reload");
  reloadVm.context.indexedDB = sharedIdb;

  await reloadVm.context.hydrateLargeStateIfAvailable();
  reloadVm.context.activeCaseId = TARGET_CASE_ID;

  const targetCase = reloadVm.run("state.cases[0]");

  // Excluded technical metadata changes
  targetCase.syncRevision = 69;
  targetCase.updatedAt = "2026-09-03T18:00:00.000Z";
  targetCase.updatedBy = "Technicien Sync";
  targetCase.history.push({ action: "Sync ACK", date: "2026-09-03T18:00:00.000Z" });

  await reloadVm.context.saveState({ skipCloud: true });

  assert.equal(
    reloadVm.run("state.cases[0].localRevision"),
    69,
    "Technical metadata changes must not increment localRevision"
  );
});

// -------------------------------------------------------------
// H. NO OUTBOX / CLOUD SIDE EFFECT ON CLEAN RELOAD
// -------------------------------------------------------------
test("H. NO OUTBOX / CLOUD SIDE EFFECT ON CLEAN RELOAD: outbox=0, conflicts=0 across 5 reloads", async () => {
  const sharedIdb = createMemoryIndexedDb();
  const seedVm = loadSyncVm("h-seed");
  seedVm.context.indexedDB = sharedIdb;
  const initialCase = makeProductionTargetCase({ localRevision: 69 });
  await seedVm.context.persistLargeStateSnapshot({
    cases: [initialCase],
    bookings: [],
    settings: {},
  });

  for (let cycle = 1; cycle <= 5; cycle++) {
    const reloadVm = loadSyncVm(`h-cycle-${cycle}`);
    reloadVm.context.indexedDB = sharedIdb;

    await reloadVm.context.hydrateLargeStateIfAvailable();
    reloadVm.context.activeCaseId = TARGET_CASE_ID;

    await reloadVm.context.saveState({
      skipCloud: true,
      skipSnapshot: true,
      cloudReason: "validated-membership-mirror",
    });

    const outbox = await reloadVm.context.loadDurableOutboxOperations();
    assert.equal(outbox.length, 0, `Cycle ${cycle}: outbox must remain 0`);

    const conflicts = reloadVm.context.getOpenSyncConflicts();
    assert.equal(conflicts.length, 0, `Cycle ${cycle}: open conflicts must remain 0`);
  }
});

// -------------------------------------------------------------
// I. ACTIVE CASE SELECTION
// -------------------------------------------------------------
test("I. ACTIVE CASE SELECTION: reconcileActiveCaseSelection correctly restores selected case", async () => {
  const sharedIdb = createMemoryIndexedDb();
  const initVm = loadSyncVm("i-init");
  initVm.context.indexedDB = sharedIdb;

  const cases = [
    makeProductionTargetCase({ id: "case-alpha", localRevision: 10 }),
    makeProductionTargetCase({ id: "case-beta", localRevision: 20 }),
  ];
  await initVm.context.persistLargeStateSnapshot({
    cases,
    bookings: [],
    settings: {},
  });

  const reloadVm = loadSyncVm("i-reload");
  reloadVm.context.indexedDB = sharedIdb;
  reloadVm.context.activeCaseId = "case-beta";

  await reloadVm.context.hydrateLargeStateIfAvailable();

  assert.equal(reloadVm.context.activeCaseId, "case-beta", "activeCaseId selection must be preserved");
  assert.equal(reloadVm.run("state.cases[0].localRevision"), 10);
  assert.equal(reloadVm.run("state.cases[1].localRevision"), 20);
});

// -------------------------------------------------------------
// J. MULTI-CASE CONTROL
// -------------------------------------------------------------
test("J. MULTI-CASE CONTROL: 5 hydrated cases have baselines initialized and zero revision drift", async () => {
  const sharedIdb = createMemoryIndexedDb();
  const initVm = loadSyncVm("j-init");
  initVm.context.indexedDB = sharedIdb;

  const fiveCases = [1, 2, 3, 4, 5].map((idx) =>
    makeProductionTargetCase({
      id: `case-multi-${idx}`,
      clientName: `Client ${idx}`,
      localRevision: 50 + idx,
    })
  );

  await initVm.context.persistLargeStateSnapshot({
    cases: fiveCases,
    bookings: [],
    settings: {},
  });

  const reloadVm = loadSyncVm("j-reload");
  reloadVm.context.indexedDB = sharedIdb;

  await reloadVm.context.hydrateLargeStateIfAvailable();
  reloadVm.context.activeCaseId = "case-multi-1";

  // Check all 5 baselines are initialized
  const runtimeScope = reloadVm.context.getComparableRuntimeScope();
  for (let idx = 1; idx <= 5; idx++) {
    const caseId = `case-multi-${idx}`;
    assert.ok(
      runtimeScope.lastKnownCasesComparable[caseId],
      `Comparable baseline for ${caseId} must be initialized`
    );
  }

  // Startup saveState
  await reloadVm.context.saveState({
    skipCloud: true,
    skipSnapshot: true,
    cloudReason: "validated-membership-mirror",
  });

  // Verify none of the 5 cases drifted
  for (let idx = 1; idx <= 5; idx++) {
    const caseItem = reloadVm.run(`state.cases.find(c => c.id === "case-multi-${idx}")`);
    assert.equal(
      caseItem.localRevision,
      50 + idx,
      `Case ${caseItem.id} localRevision must remain ${50 + idx}`
    );
  }

  assert.equal(reloadVm.context.activeCaseId, "case-multi-1");
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

console.log(`\nSYNC-002.2 REGRESSION SUITE: ${passedCount}/${tests.length} TESTS PASSED`);
if (failedCount > 0) {
  process.exit(1);
}
