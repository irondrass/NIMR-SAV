import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { createNimrVmContext } from "../helpers/nimr_vm_context.mjs";
import { buildDataset } from "./scalability_dataset.mjs";

const BASELINES = {
  idMsPerOperation: 0.012788235,
  vinMsPerOperation: 50.399495098,
  plateMsPerOperation: 54.044767647,
  orMsPerOperation: 67.688954902,
  conflictMs: 1612.7232,
  indexBuildMs: 1183.0827,
};
const SCALES = [10000, 50000, 100000];
const BOOKING_PER_CASE = 3;
const LOOKUP_OPERATIONS = 10000;
const COLLECTION_OPERATIONS = 10000;
const WARM_INDEX_OPERATIONS = 10000;
const CONFLICT_OPERATIONS = 20;

function memory() {
  const value = process.memoryUsage();
  return { rss: value.rss, heapUsed: value.heapUsed, heapTotal: value.heapTotal };
}

function collectMemory() {
  if (typeof global.gc === "function") global.gc();
  return memory();
}

function measureOperations(label, operations, fn, warmupOperations = Math.min(100, operations)) {
  for (let index = 0; index < warmupOperations; index += 1) fn(index);
  const startedAt = performance.now();
  for (let index = 0; index < operations; index += 1) fn(index);
  const totalMs = performance.now() - startedAt;
  return { label, operations, warmupOperations, totalMs, msPerOperation: totalMs / operations };
}

function measureOnce(label, fn) {
  const startedAt = performance.now();
  fn();
  return { label, operations: 1, totalMs: performance.now() - startedAt };
}

function runWorker(scale) {
  collectMemory();
  let raw = buildDataset(scale, { bookingPerCase: BOOKING_PER_CASE, seed: 0x006005 });
  const vm = createNimrVmContext({ filename: `p0-007-runtime-indexes-${scale}.js` });
  vm.context.__p007Payload = raw;
  const normalize = measureOnce("normalizeState", () => vm.run("state = normalizeState(__p007Payload)"));
  vm.context.__p007Payload = null;
  raw = null;
  const afterNormalize = collectMemory();

  vm.run("invalidateUiRuntimeIndexes()");
  const coldIndexBuild = measureOnce("coldRuntimeIndexBuild", () => vm.run("getUiRuntimeIndexes()"));
  const afterColdIndex = collectMemory();
  const coldStats = vm.run("getUiRuntimeIndexStats()");

  const warmIndexAccess = measureOperations(
    "warmGetUiRuntimeIndexes",
    WARM_INDEX_OPERATIONS,
    () => vm.run("getUiRuntimeIndexes()"),
  );

  const identityIndexes = [0, Math.floor(scale / 2), scale - 1];
  const identities = identityIndexes.map((index) => ({
    id: `case-${String(index).padStart(7, "0")}`,
    vin: `VINBENCH${String(index).padStart(9, "0")}`,
    plate: `BENCH-${String(index).padStart(6, "0")}`,
    orNavNumber: `OR-BENCH-${String(index).padStart(7, "0")}`,
  }));
  const lookup = (field, expression) => measureOperations(
    `${field}Lookup`,
    LOOKUP_OPERATIONS,
    (index) => {
      vm.context.__p007Identity = identities[index % identities.length];
      vm.run(expression);
    },
  );
  const lookups = {
    id: lookup("id", "getIndexedCaseById(__p007Identity.id)"),
    vin: lookup("vin", "findCaseBySelectionIdentity({ vin: __p007Identity.vin })"),
    plate: lookup("plate", "findCaseBySelectionIdentity({ plate: __p007Identity.plate })"),
    orNavNumber: lookup("or", "findCaseBySelectionIdentity({ orNavNumber: __p007Identity.orNavNumber })"),
  };

  const bookingByCase = measureOperations(
    "getIndexedCaseBookings",
    COLLECTION_OPERATIONS,
    () => vm.run("getIndexedCaseBookings('case-0000000')"),
  );
  const bookingByResource = measureOperations(
    "getIndexedResourceBookings",
    COLLECTION_OPERATIONS,
    () => vm.run("getIndexedResourceBookings('mecanicien-1')"),
  );
  const bookingByDay = measureOperations(
    "getIndexedDayBookings",
    COLLECTION_OPERATIONS,
    () => vm.run("getIndexedDayBookings('2025-06-02')"),
  );

  const conflictExpression = "findConflict({ start: '2025-06-02T09:00:00.000Z', end: '2025-06-02T10:00:00.000Z' }, ['mecanicien-1'], state.bookings)";
  const conflict = measureOperations(
    "findConflict",
    CONFLICT_OPERATIONS,
    () => vm.run(conflictExpression),
    1,
  );
  const conflictCandidates = vm.run("getPlanningConflictCandidateStats()");
  const afterWarmReads = collectMemory();

  const beforeRebuildStats = vm.run("getUiRuntimeIndexStats()");
  vm.run("invalidateUiRuntimeIndexes()");
  const rebuildAfterInvalidation = measureOnce("rebuildAfterExplicitInvalidation", () => vm.run("getUiRuntimeIndexes()"));
  const afterRebuildStats = vm.run("getUiRuntimeIndexStats()");
  const warmAfterRebuild = measureOperations(
    "warmAccessAfterRebuild",
    WARM_INDEX_OPERATIONS,
    () => vm.run("getUiRuntimeIndexes()"),
  );
  const afterRebuild = collectMemory();

  const validation = {
    id: Boolean(vm.run("getIndexedCaseById('case-0000000')")),
    vin: Boolean(vm.run("findCaseBySelectionIdentity({ vin: 'VINBENCH000000000' })")),
    cases: vm.run("state.cases.length"),
    bookings: vm.run("state.bookings.length"),
    warmDidNotRebuild: beforeRebuildStats.buildCount === coldStats.buildCount,
    invalidationRebuiltExactlyOnce: afterRebuildStats.buildCount === beforeRebuildStats.buildCount + 1,
  };

  return {
    scale,
    cases: scale,
    bookings: scale * BOOKING_PER_CASE,
    bookingPerCase: BOOKING_PER_CASE,
    operationCounts: {
      normalize: 1,
      coldIndexBuild: 1,
      warmIndexAccess: WARM_INDEX_OPERATIONS,
      eachIdentityLookup: LOOKUP_OPERATIONS,
      eachCollectionLookup: COLLECTION_OPERATIONS,
      conflict: CONFLICT_OPERATIONS,
      rebuildAfterInvalidation: 1,
      warmAfterRebuild: WARM_INDEX_OPERATIONS,
    },
    normalize,
    coldIndexBuild,
    warmIndexAccess,
    lookups,
    bookingByCase,
    bookingByResource,
    bookingByDay,
    conflict,
    conflictCandidates,
    rebuildAfterInvalidation,
    warmAfterRebuild,
    indexStats: { cold: coldStats, beforeRebuild: beforeRebuildStats, afterRebuild: afterRebuildStats },
    memory: {
      afterNormalize,
      afterColdIndex,
      afterWarmReads,
      afterRebuild,
      indexDelta: {
        rss: afterColdIndex.rss - afterNormalize.rss,
        heapUsed: afterColdIndex.heapUsed - afterNormalize.heapUsed,
        heapTotal: afterColdIndex.heapTotal - afterNormalize.heapTotal,
      },
    },
    validation,
  };
}

function ratio(baseline, current) {
  return baseline / current;
}

function mib(bytes) {
  return (bytes / 1024 / 1024).toFixed(2);
}

function buildReport(results) {
  const largest = results.find((entry) => entry.scale === 100000);
  const ratios = {
    id: ratio(BASELINES.idMsPerOperation, largest.lookups.id.msPerOperation),
    vin: ratio(BASELINES.vinMsPerOperation, largest.lookups.vin.msPerOperation),
    plate: ratio(BASELINES.plateMsPerOperation, largest.lookups.plate.msPerOperation),
    orNavNumber: ratio(BASELINES.orMsPerOperation, largest.lookups.orNavNumber.msPerOperation),
    conflict: ratio(BASELINES.conflictMs, largest.conflict.msPerOperation),
  };
  const acceptance = {
    vin: largest.lookups.vin.msPerOperation < 1 && ratios.vin >= 25,
    plate: largest.lookups.plate.msPerOperation < 1 && ratios.plate >= 25,
    orNavNumber: largest.lookups.orNavNumber.msPerOperation < 1 && ratios.orNavNumber >= 25,
    id: largest.lookups.id.msPerOperation < 0.2,
    bookingByCase: largest.bookingByCase.msPerOperation < 1,
    conflict: ratios.conflict >= 8 && largest.conflict.msPerOperation < 200,
    warmAccessNoRebuild: largest.validation.warmDidNotRebuild && largest.validation.invalidationRebuiltExactlyOnce,
  };
  const lines = [
    "# P0-007 Runtime Indexes Benchmark",
    "",
    "Targeted benchmark only. It uses the deterministic P0-006 scalability dataset, does not stringify global state, and runs each scale in a fresh Node process with `--expose-gc`.",
    "",
    "## Exact operation counts",
    "",
    `- Identity lookups: ${LOOKUP_OPERATIONS} per identity type and scale.`,
    `- Case/resource/day collection lookups: ${COLLECTION_OPERATIONS} per helper and scale.`,
    `- Warm index access: ${WARM_INDEX_OPERATIONS} before and ${WARM_INDEX_OPERATIONS} after explicit invalidation/rebuild.`,
    `- Conflict checks: ${CONFLICT_OPERATIONS} per scale.`,
    "- Normalize, cold build, and explicit invalidation rebuild: exactly once per scale.",
    "",
    "## Results",
    "",
    "| Cases / bookings | normalizeState ms | cold index ms | warm index ms/op | ID ms/op | VIN ms/op | plate ms/op | OR ms/op | case bookings ms/op | conflict ms/op | candidates |",
    "|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ...results.map((entry) => `| ${entry.cases.toLocaleString("en-US")} / ${entry.bookings.toLocaleString("en-US")} | ${entry.normalize.totalMs.toFixed(3)} | ${entry.coldIndexBuild.totalMs.toFixed(3)} | ${entry.warmIndexAccess.msPerOperation.toFixed(6)} | ${entry.lookups.id.msPerOperation.toFixed(6)} | ${entry.lookups.vin.msPerOperation.toFixed(6)} | ${entry.lookups.plate.msPerOperation.toFixed(6)} | ${entry.lookups.orNavNumber.msPerOperation.toFixed(6)} | ${entry.bookingByCase.msPerOperation.toFixed(6)} | ${entry.conflict.msPerOperation.toFixed(3)} | ${entry.conflictCandidates.candidateCount}/${entry.conflictCandidates.sourceCount} |`),
    "",
    "## 100k comparison with P0-006",
    "",
    `- ID: ${largest.lookups.id.msPerOperation.toFixed(6)} ms/op (${ratios.id.toFixed(1)}x versus ${BASELINES.idMsPerOperation} ms/op).`,
    `- VIN: ${largest.lookups.vin.msPerOperation.toFixed(6)} ms/op (${ratios.vin.toFixed(1)}x versus ${BASELINES.vinMsPerOperation} ms/op).`,
    `- Plate: ${largest.lookups.plate.msPerOperation.toFixed(6)} ms/op (${ratios.plate.toFixed(1)}x versus ${BASELINES.plateMsPerOperation} ms/op).`,
    `- OR: ${largest.lookups.orNavNumber.msPerOperation.toFixed(6)} ms/op (${ratios.orNavNumber.toFixed(1)}x versus ${BASELINES.orMsPerOperation} ms/op).`,
    `- Conflict: ${largest.conflict.msPerOperation.toFixed(3)} ms (${ratios.conflict.toFixed(1)}x versus ${BASELINES.conflictMs} ms); candidate set ${largest.conflictCandidates.candidateCount}/${largest.conflictCandidates.sourceCount}.`,
    `- Cold index build: ${largest.coldIndexBuild.totalMs.toFixed(3)} ms versus ${BASELINES.indexBuildMs} ms. The added identity and resource/day maps make this cost explicit.`,
    "",
    "## Memory at 100k / 300k bookings",
    "",
    `- After normalize: RSS ${mib(largest.memory.afterNormalize.rss)} MiB; heapUsed ${mib(largest.memory.afterNormalize.heapUsed)} MiB; heapTotal ${mib(largest.memory.afterNormalize.heapTotal)} MiB.`,
    `- After cold index: RSS ${mib(largest.memory.afterColdIndex.rss)} MiB; heapUsed ${mib(largest.memory.afterColdIndex.heapUsed)} MiB; heapTotal ${mib(largest.memory.afterColdIndex.heapTotal)} MiB.`,
    `- Index delta: RSS ${mib(largest.memory.indexDelta.rss)} MiB; heapUsed ${mib(largest.memory.indexDelta.heapUsed)} MiB; heapTotal ${mib(largest.memory.indexDelta.heapTotal)} MiB.`,
    `- After warm reads: RSS ${mib(largest.memory.afterWarmReads.rss)} MiB; heapUsed ${mib(largest.memory.afterWarmReads.heapUsed)} MiB; heapTotal ${mib(largest.memory.afterWarmReads.heapTotal)} MiB.`,
    `- After explicit invalidation/rebuild: RSS ${mib(largest.memory.afterRebuild.rss)} MiB; heapUsed ${mib(largest.memory.afterRebuild.heapUsed)} MiB; heapTotal ${mib(largest.memory.afterRebuild.heapTotal)} MiB.`,
    "",
    "These are Node process measurements, not browser memory-limit claims.",
    "",
    "## Acceptance",
    "",
    ...Object.entries(acceptance).map(([key, passed]) => `- ${key}: ${passed ? "PASS" : "FAIL"}`),
    "",
    `Overall: ${Object.values(acceptance).every(Boolean) ? "PASS" : "FAIL"}`,
    "",
  ];
  return { markdown: lines.join("\n"), ratios, acceptance };
}

const workerIndex = process.argv.indexOf("--worker");
if (workerIndex >= 0) {
  const scale = Number(process.argv[workerIndex + 1]);
  process.stdout.write(JSON.stringify(runWorker(scale)));
} else {
  const currentFile = fileURLToPath(import.meta.url);
  const results = SCALES.map((scale) => JSON.parse(execFileSync(
    process.execPath,
    ["--expose-gc", currentFile, "--worker", String(scale)],
    { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 },
  )));
  const report = buildReport(results);
  const payload = {
    ticket: "P0-007",
    generatedAt: new Date().toISOString(),
    baselines: BASELINES,
    operationCounts: {
      identityLookupPerTypePerScale: LOOKUP_OPERATIONS,
      collectionLookupPerHelperPerScale: COLLECTION_OPERATIONS,
      warmIndexAccessPerPhasePerScale: WARM_INDEX_OPERATIONS,
      conflictPerScale: CONFLICT_OPERATIONS,
    },
    results,
    ratios100k: report.ratios,
    acceptance100k: report.acceptance,
    overallPass: Object.values(report.acceptance).every(Boolean),
  };
  const benchmarkDir = path.dirname(currentFile);
  const resultsPath = path.join(benchmarkDir, "results", "p0-007-runtime-indexes.json");
  const reportPath = path.join(benchmarkDir, "P0-007-RUNTIME-INDEXES-REPORT.md");
  fs.mkdirSync(path.dirname(resultsPath), { recursive: true });
  fs.writeFileSync(resultsPath, `${JSON.stringify(payload, null, 2)}\n`);
  fs.writeFileSync(reportPath, report.markdown);
  process.stdout.write(`${JSON.stringify({ resultsPath, reportPath, overallPass: payload.overallPass, acceptance: payload.acceptance100k })}\n`);
}
