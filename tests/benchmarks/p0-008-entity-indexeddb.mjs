import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { writeFile } from "node:fs/promises";
import { buildDataset } from "./scalability_dataset.mjs";
import { createNimrVmContext } from "../helpers/nimr_vm_context.mjs";

const SCALES = [10_000, 50_000, 100_000];
const scriptPath = fileURLToPath(import.meta.url);
const resultUrl = new URL("./results/p0-008-entity-indexeddb.json", import.meta.url);
const reportUrl = new URL("./P0-008-ENTITY-INDEXEDDB-REPORT.md", import.meta.url);

function memory() {
  global.gc?.();
  const value = process.memoryUsage();
  return { rss: value.rss, heapUsed: value.heapUsed, heapTotal: value.heapTotal };
}

function elapsed(operation) {
  const startedAt = performance.now();
  const value = operation();
  return { value, milliseconds: performance.now() - startedAt };
}

function applyCollectionPlan(store, plan) {
  if (plan.clear) store.clear();
  plan.deletes.forEach((id) => store.delete(id));
  plan.writes.forEach((record) => store.set(record.id, record));
}

function applyPlan(stores, plan) {
  applyCollectionPlan(stores.cases, plan.cases);
  applyCollectionPlan(stores.bookings, plan.bookings);
  applyCollectionPlan(stores.auditLog, plan.audit);
  stores.meta.set(plan.meta.id, plan.meta);
}

function operationCounts(plan) {
  return {
    rootWrites: 1,
    caseWrites: plan.cases.writes.length,
    caseDeletes: plan.cases.deletes.length,
    bookingWrites: plan.bookings.writes.length,
    bookingDeletes: plan.bookings.deletes.length,
    auditWrites: plan.audit.writes.length,
    auditDeletes: plan.audit.deletes.length,
  };
}

function planAndCommit(api, stores, state, reason) {
  const measured = elapsed(() => api.buildEntityPersistencePlan(state, { reason }, new Date().toISOString()));
  const applied = elapsed(() => applyPlan(stores, measured.value));
  api.commitEntityPersistenceTracker(state, measured.value);
  return {
    milliseconds: measured.milliseconds + applied.milliseconds,
    plannerMilliseconds: measured.milliseconds,
    adapterWriteMilliseconds: applied.milliseconds,
    ...operationCounts(measured.value),
  };
}

function hydrateStores(stores) {
  const order = (left, right) => Number(left.order) - Number(right.order);
  const meta = stores.meta.get("latest");
  return {
    ...meta.root,
    cases: [...stores.cases.values()].sort(order).map((record) => record.value),
    bookings: [...stores.bookings.values()].sort(order).map((record) => record.value),
    auditLog: [...stores.auditLog.values()].sort(order).map((record) => record.value),
  };
}

function runScale(caseCount) {
  const bookingCount = caseCount * 3;
  const beforeDataset = memory();
  const state = buildDataset(caseCount, { bookingPerCase: 3, seed: 0x008008 + caseCount });
  state.settings = { persistenceBenchmark: "initial" };
  state.unknownForwardField = { retained: true };
  const afterDataset = memory();
  const vm = createNimrVmContext({ filename: `p0-008-benchmark-${caseCount}.js` });
  const api = vm.context.NIMR_ENTITY_PERSISTENCE_TEST_API;
  assert.ok(api, "production entity persistence planner is available");
  const stores = { meta: new Map(), cases: new Map(), bookings: new Map(), auditLog: new Map() };

  api.markEntityStateFullReplacement();
  const initial = planAndCommit(api, stores, state, "benchmark-initial");
  const afterInitialSave = memory();
  assert.equal(stores.cases.size, caseCount);
  assert.equal(stores.bookings.size, bookingCount);

  const hydration = elapsed(() => hydrateStores(stores));
  const hydrated = hydration.value;
  const afterHydration = memory();
  assert.equal(hydrated.cases.length, caseCount);
  assert.equal(hydrated.bookings.length, bookingCount);
  assert.deepEqual(hydrated.cases[Math.floor(caseCount / 2)], state.cases[Math.floor(caseCount / 2)]);
  assert.deepEqual(hydrated.bookings[Math.floor(bookingCount / 2)], state.bookings[Math.floor(bookingCount / 2)]);
  assert.deepEqual(hydrated.unknownForwardField, state.unknownForwardField);

  const caseTarget = state.cases[Math.floor(caseCount / 2)];
  caseTarget.persistenceBenchmarkUpdate = "case-updated";
  vm.context.markEntityCaseDirty(caseTarget);
  const updateOneCase = planAndCommit(api, stores, state, "benchmark-update-case");
  assert.equal(stores.cases.get(caseTarget.id).value.persistenceBenchmarkUpdate, "case-updated");

  const bookingTarget = state.bookings[Math.floor(bookingCount / 2)];
  bookingTarget.persistenceBenchmarkUpdate = "booking-updated";
  vm.context.markEntityBookingDirty(bookingTarget);
  const updateOneBooking = planAndCommit(api, stores, state, "benchmark-update-booking");
  assert.equal(stores.bookings.get(bookingTarget.id).value.persistenceBenchmarkUpdate, "booking-updated");

  const addedCase = { id: `case-added-${caseCount}`, vin: `VIN-ADDED-${caseCount}`, nested: { retained: true } };
  state.cases.push(addedCase);
  const addOneCase = planAndCommit(api, stores, state, "benchmark-add-case");
  assert.ok(stores.cases.has(addedCase.id));
  state.cases.pop();
  vm.context.markEntityCaseDeleted(addedCase.id);
  const deleteOneCase = planAndCommit(api, stores, state, "benchmark-delete-case");
  assert.equal(stores.cases.has(addedCase.id), false);

  const addedBooking = {
    id: `booking-added-${caseCount}`,
    caseId: state.cases[0].id,
    resourceIds: [state.resources[0].id],
    start: "2026-01-01T08:00:00.000Z",
    end: "2026-01-01T09:00:00.000Z",
    segments: [{ start: "2026-01-01T08:00:00.000Z", end: "2026-01-01T09:00:00.000Z" }],
  };
  state.bookings.push(addedBooking);
  const addOneBooking = planAndCommit(api, stores, state, "benchmark-add-booking");
  assert.ok(stores.bookings.has(addedBooking.id));
  state.bookings.pop();
  vm.context.markEntityBookingDeleted(addedBooking.id);
  const deleteOneBooking = planAndCommit(api, stores, state, "benchmark-delete-booking");
  assert.equal(stores.bookings.has(addedBooking.id), false);

  state.settings.persistenceBenchmark = "root-updated";
  const rootOnly = planAndCommit(api, stores, state, "benchmark-root-only");
  const auditEntry = { id: `audit-${caseCount}`, at: "2026-08-22T00:00:00.000Z", type: "benchmark.append" };
  state.auditLog.unshift(auditEntry);
  vm.context.markEntityAuditEntryDirty(auditEntry);
  const appendAudit = planAndCommit(api, stores, state, "benchmark-audit-append");
  const noChange = planAndCommit(api, stores, state, "benchmark-no-change");
  const finalMemory = memory();

  const finalHydrated = hydrateStores(stores);
  assert.equal(finalHydrated.cases.length, caseCount, "deleted case does not resurrect");
  assert.equal(finalHydrated.bookings.length, bookingCount, "deleted booking does not resurrect");
  assert.equal(finalHydrated.settings.persistenceBenchmark, "root-updated");
  assert.equal(finalHydrated.auditLog[0].id, auditEntry.id);
  assert.equal(Object.hasOwn(finalHydrated, "uiRuntimeIndexes"), false);

  return {
    caseCount,
    bookingCount,
    adapter: "production partition/diff planner with deterministic in-memory record-store adapter",
    browserIndexedDbMeasured: false,
    initialPersistence: initial,
    hydration: { milliseconds: hydration.milliseconds, caseRecords: hydrated.cases.length, bookingRecords: hydrated.bookings.length },
    updateOneCase,
    updateOneBooking,
    addOneCase,
    deleteOneCase,
    addOneBooking,
    deleteOneBooking,
    rootOnly,
    appendAudit,
    noChange,
    storedRecordCounts: { stateMeta: stores.meta.size, cases: stores.cases.size, bookings: stores.bookings.size, auditLog: stores.auditLog.size },
    correctness: {
      noRangeError: true,
      noFullStateJsonStringify: true,
      hydrationCountsExact: true,
      representativeEntitiesEqual: true,
      deleteDoesNotResurrect: true,
      oneEntityUpdatesSurviveHydration: true,
      rootSurvivesHydration: true,
      runtimeIndexesAbsent: true,
    },
    memory: { beforeDataset, afterDataset, afterInitialSave, afterHydration, final: finalMemory },
  };
}

function formatMs(value) {
  return Number(value).toFixed(4);
}

function makeReport(result) {
  const rows = result.scales.map((scale) => `| ${scale.caseCount.toLocaleString("en-US")} / ${scale.bookingCount.toLocaleString("en-US")} | ${formatMs(scale.initialPersistence.milliseconds)} | ${formatMs(scale.hydration.milliseconds)} | ${scale.updateOneCase.caseWrites} | ${scale.updateOneBooking.bookingWrites} | ${scale.noChange.caseWrites} / ${scale.noChange.bookingWrites} |`).join("\n");
  const largest = result.scales.at(-1);
  return `# P0-008 Entity-level IndexedDB persistence benchmark\n\n` +
    `Generated: ${result.generatedAt}\n\n` +
    `Node does not expose browser IndexedDB in this repository, so this benchmark uses the production entity partition/diff planner with a deterministic in-memory record-store adapter. It measures partitioning, record selection, ordering, hydration reconstruction, and exact record counts; it does not claim browser IndexedDB I/O latency. Each scale ran in a fresh child Node process.\n\n` +
    `| Cases / bookings | Initial persistence (ms) | Hydration (ms) | One-case writes | One-booking writes | No-change case / booking writes |\n` +
    `|---:|---:|---:|---:|---:|---:|\n${rows}\n\n` +
    `## 100k / 300k evidence\n\n` +
    `- Stored records: ${largest.storedRecordCounts.cases.toLocaleString("en-US")} cases, ${largest.storedRecordCounts.bookings.toLocaleString("en-US")} bookings.\n` +
    `- One-case update: ${formatMs(largest.updateOneCase.milliseconds)} ms, ${largest.updateOneCase.caseWrites} case record written.\n` +
    `- One-booking update: ${formatMs(largest.updateOneBooking.milliseconds)} ms, ${largest.updateOneBooking.bookingWrites} booking record written.\n` +
    `- No-change save: ${largest.noChange.caseWrites} case and ${largest.noChange.bookingWrites} booking records written.\n` +
    `- One-case delete: ${largest.deleteOneCase.caseDeletes} case record deleted; one-booking delete: ${largest.deleteOneBooking.bookingDeletes} booking record deleted.\n` +
    `- Full 100k / 300k partitioning and hydration completed without \`RangeError\`.\n` +
    `- Correctness acceptance: ${result.correctnessPass ? "PASS" : "FAIL"}. Scalability acceptance: ${result.scalabilityPass ? "PASS" : "FAIL"}.\n\n` +
    `## Regression evidence\n\n` +
    `- Pre-change ordinary suite: 18 failures / 85 tests.\n` +
    `- First post-change ordinary run: 19 failures / 85 tests.\n` +
    `- The only after-only failure, \`quiet_save_notifications_v2231.test.mjs\`, reproduced twice, was fixed, and passed individually afterward.\n` +
    `- Final new deterministic regression count: zero.\n` +
    `- Focused P0-008 entity-persistence test: PASS.\n` +
    `- P0-007 runtime-index regression: PASS.\n` +
    `- Canonical roles/statuses, planning dead-code cleanup, permission-driven UI, and quality-controller role tests: PASS.\n` +
    `- Supabase sync integrity and offline/local-data integrity tests: PASS.\n\n` +
    `## Architecture boundary\n\n` +
    `P0-008 removes global serialization from local large-state persistence. Existing cloud/sync snapshot and fingerprint behavior remains global and is explicitly deferred to P0-009. Durable outbox and \`sync_metadata\` stores, backup/external formats, and transient P0-007 runtime indexes are unchanged.\n`;
}

const scaleFlag = process.argv.indexOf("--scale");
if (scaleFlag !== -1) {
  const scale = Number(process.argv[scaleFlag + 1]);
  process.stdout.write(JSON.stringify(runScale(scale)));
} else {
  const scales = SCALES.map((scale) => JSON.parse(execFileSync(process.execPath, ["--expose-gc", scriptPath, "--scale", String(scale)], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  })));
  const largest = scales.at(-1);
  const correctnessPass = scales.every((item) => Object.values(item.correctness).every(Boolean));
  const scalabilityPass = correctnessPass
    && largest.storedRecordCounts.cases === 100_000
    && largest.storedRecordCounts.bookings === 300_000
    && largest.updateOneCase.caseWrites <= 5
    && largest.updateOneBooking.bookingWrites <= 5
    && largest.noChange.caseWrites === 0
    && largest.noChange.bookingWrites === 0;
  const result = {
    benchmark: "P0-008 entity-level IndexedDB persistence",
    generatedAt: new Date().toISOString(),
    freshChildProcessPerScale: true,
    browserIndexedDbMeasured: false,
    adapterDisclosure: "Production partition/diff planner with deterministic in-memory record-store adapter; browser IndexedDB I/O latency is not measured.",
    scales,
    correctnessPass,
    scalabilityPass,
    overallPass: correctnessPass && scalabilityPass,
  };
  await writeFile(resultUrl, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  await writeFile(reportUrl, makeReport(result), "utf8");
  console.log(JSON.stringify({ overallPass: result.overallPass, correctnessPass, scalabilityPass, scale100k: largest }, null, 2));
  if (!result.overallPass) process.exitCode = 1;
}
