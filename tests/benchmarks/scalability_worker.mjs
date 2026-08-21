import { performance } from "node:perf_hooks";
import fs from "node:fs";
import { createNimrVmContext } from "../helpers/nimr_vm_context.mjs";
import { buildDataset, DATASET_STATUS_RATIOS } from "./scalability_dataset.mjs";

const scale = Number(process.argv[2] || 1000);
const mode = process.argv[3] || "cases";
const bookingPerCase = Number(process.argv[4] || 3);
const repeats = scale <= 10000 ? 5 : (scale >= 100000 ? 1 : 3);
const lookupRepetitions = scale <= 10000 ? 1000 : 100;
const TIMEOUT_MS = 60000;
const checkpointPath = process.env.P0_BENCH_CHECKPOINT || "";
let checkpointData = { mode, scale, bookingPerCase };
function checkpoint(fields) { if (!checkpointPath) return; checkpointData = { ...checkpointData, ...fields }; try { fs.writeFileSync(checkpointPath, JSON.stringify(checkpointData)); } catch {} }
const now = () => performance.now();
const median = (values) => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)] ?? 0; };
const stats = (values) => ({ median: median(values), min: Math.min(...values), max: Math.max(...values), runs: values });
const memory = () => { const value = process.memoryUsage(); return { rss: value.rss, heapTotal: value.heapTotal, heapUsed: value.heapUsed, external: value.external }; };
const collect = () => { if (typeof global.gc === "function") global.gc(); return memory(); };
function timed(label, fn, count = repeats) {
  const warm = safeCall(fn);
  if (!warm.ok) return { label, status: "ERROR", errorName: warm.error.name, error: warm.error.message };
  const values = [];
  for (let index = 0; index < count; index += 1) {
    const start = now();
    const result = safeCall(fn);
    const elapsed = now() - start;
    if (!result.ok) return { label, status: elapsed > TIMEOUT_MS ? "TIMEOUT" : "ERROR", errorName: result.error.name, error: result.error.message, completedRuns: values.length, stats: values.length ? stats(values) : undefined };
    values.push(elapsed);
    if (elapsed > TIMEOUT_MS) return { label, status: "TIMEOUT", stats: stats(values), completedRuns: values.length };
  }
  return { label, status: "PASS", stats: stats(values) };
}
function safeCall(fn) { try { return { ok: true, value: fn() }; } catch (error) { return { ok: false, error }; } }
function skipped(label, reason) { return { label, status: "SKIPPED_DEPENDENCY", dependency: reason }; }
function lookupMetric(vm, expression, identities) {
  const requestedOperations = lookupRepetitions;
  const actualOperations = requestedOperations;
  const metric = timed("lookup", () => {
    for (let index = 0; index < actualOperations; index += 1) {
      vm.context.__benchmarkIdentity = identities[index % identities.length];
      vm.run(expression);
    }
  }, Math.min(repeats, 3));
  if (metric.stats) metric.meanMsPerOperation = metric.stats.median / actualOperations;
  metric.requestedOperations = requestedOperations;
  metric.actualOperations = actualOperations;
  return metric;
}

if (mode === "audit") {
  collect();
  const before = memory();
  const generationStart = now();
  const auditLog = Array.from({ length: scale }, (_, index) => ({ id: `audit-${index}`, at: "2025-06-01T09:00:00.000Z", type: "benchmark.event", label: "Benchmark audit entry", details: `Entry ${index}`, user: "Benchmark" }));
  const generatedMs = now() - generationStart;
  const afterGeneration = collect();
  const stringify = timed("audit_stringify", () => JSON.stringify(auditLog), 3);
  let json = "";
  const stringOnce = safeCall(() => JSON.stringify(auditLog));
  if (stringOnce.ok) json = stringOnce.value;
  const parse = json ? timed("audit_parse", () => JSON.parse(json), 3) : skipped("audit_parse", "audit_stringify");
  console.log(JSON.stringify({ mode, entries: scale, generatedMs, stringify, parse, jsonBytes: json ? Buffer.byteLength(json) : null, before, afterGeneration, afterStringify: collect() }));
  process.exit(0);
}

collect();
const before = memory();
const generationStart = now();
let raw = buildDataset(scale, { bookingPerCase, seed: 0x006005 });
const generationMs = now() - generationStart;
const afterRaw = collect();
const rawValidation = {
  cases: raw.cases.length,
  bookings: raw.bookings.length,
  uniqueCaseIds: new Set(raw.cases.map((item) => item.id)).size,
  uniqueVins: new Set(raw.cases.map((item) => item.vin)).size,
  exact: raw.cases.length === scale && raw.bookings.length === scale * bookingPerCase && new Set(raw.cases.map((item) => item.id)).size === scale && new Set(raw.cases.map((item) => item.vin)).size === scale,
};
checkpoint({ cases: rawValidation.cases, bookings: rawValidation.bookings, rawValidation, memory: { before, afterRaw } });
const rawJson = timed("raw_json_stringify", () => JSON.stringify(raw), repeats);
let rawJsonText = "";
const rawOnce = safeCall(() => JSON.stringify(raw));
if (rawOnce.ok) rawJsonText = rawOnce.value;
const rawJsonBytes = rawJsonText ? Buffer.byteLength(rawJsonText) : null;
rawJsonText = "";
checkpoint({ rawJsonStringify: { ...rawJson, bytes: rawJsonBytes }, memory: { before, afterRaw } });
const vm = createNimrVmContext({ filename: `p0-006-scale-${scale}.js` });
vm.context.__benchmarkPayload = raw;
let normalized;
const normalizeState = timed("normalizeState", () => { normalized = vm.run("state = normalizeState(__benchmarkPayload)"); return normalized; }, repeats);
const afterNormalize = collect();
const normalizedValidation = normalized ? {
  cases: normalized.cases.length,
  bookings: normalized.bookings.length,
  exact: normalized.cases.length === scale && normalized.bookings.length === scale * bookingPerCase,
} : null;
checkpoint({ normalizeState, normalizedValidation, memory: { before, afterRaw, afterNormalize } });
if (mode === "dashboard") {
  const dashboardMetric = (period, nowValue) => {
    const expression = `state.ui.savDashboardPeriod = '${period}'; savPerformanceDashboardCache = null; buildSavPerformanceDashboard(new Date('${nowValue}'))`;
    const metric = timed(`dashboard_${period}`, () => vm.run(expression), Math.min(repeats, 3));
    const digest = safeCall(() => vm.run("({ filtered: state.cases.length, filteredCases: savPerformanceDashboardCache?.value?.cases?.filteredCases?.length || 0, periodCases: savPerformanceDashboardCache?.value?.cases?.periodCases?.length || 0, activeCases: savPerformanceDashboardCache?.value?.metrics?.activeCases || 0, createdCases: savPerformanceDashboardCache?.value?.metrics?.createdCases || 0, scheduledAppointments: savPerformanceDashboardCache?.value?.metrics?.scheduledAppointments || 0 })"));
    return { ...metric, resultDigest: digest.ok ? digest.value : { status: "ERROR", error: digest.error.message } };
  };
  const dashboard = { productionPath: "buildSavPerformanceDashboard -> getSavDashboardRange -> getSavDashboardCases", representative: dashboardMetric("today", "2025-06-15T12:00:00.000Z"), broad: dashboardMetric("month", "2025-06-15T12:00:00.000Z") };
  checkpoint({ dashboard, memory: { before, afterRaw, afterNormalize } });
  console.log(JSON.stringify({ mode, scale, bookingPerCase, cases: rawValidation.cases, bookings: rawValidation.bookings, normalizedValidation, dashboard, memory: { before, afterRaw, afterNormalize } }));
  process.exit(0);
}
vm.context.__benchmarkPayload = null;
raw = null;
let normalizedJson = "";
const normalizedJsonStringify = normalized
  ? timed("normalized_json_stringify", () => { normalizedJson = vm.run("JSON.stringify(state)"); return normalizedJson.length; }, repeats)
  : skipped("normalized_json_stringify", "normalizeState");
const afterStringify = collect();
if (!normalizedJson && normalizedJsonStringify.status === "PASS") normalizedJsonStringify.status = "ERROR";
checkpoint({ normalizedJsonStringify: { ...normalizedJsonStringify, bytes: normalizedJson ? Buffer.byteLength(normalizedJson) : null }, memory: { before, afterRaw, afterNormalize, afterStringify } });
const jsonParse = normalizedJson ? timed("json_parse", () => JSON.parse(normalizedJson), Math.min(repeats, 3)) : skipped("json_parse", "normalizedJsonStringify");
const normalizeParsed = normalizedJson ? timed("normalize_after_parse", () => { vm.context.__benchmarkParsed = JSON.parse(normalizedJson); return vm.run("normalizeState(__benchmarkParsed, { skipMigration: true })"); }, Math.min(repeats, 3)) : skipped("normalize_after_parse", "normalizedJsonStringify");
checkpoint({ jsonParse, normalizeParsed, memory: { before, afterRaw, afterNormalize, afterStringify } });

const indexBuild = normalized ? timed("runtime_index_build", () => vm.run("getUiRuntimeIndexes({ force: true }); getPlanningCaseIndex();"), Math.min(repeats, 3)) : skipped("runtime_index_build", "normalizeState");
const afterIndexBuild = collect();
checkpoint({ memory: { before, afterRaw, afterNormalize, afterIndexBuild }, indexBuild });
const identities = [0, Math.floor(scale / 2), Math.max(0, scale - 1)].map((index) => ({ id: `case-${String(index).padStart(7, "0")}`, vin: `VINBENCH${String(index).padStart(9, "0")}`, plate: `BENCH-${String(index).padStart(6, "0")}`, orNavNumber: `OR-BENCH-${String(index).padStart(7, "0")}` }));
const lookups = normalized ? {
  id: lookupMetric(vm, "getIndexedCaseById(__benchmarkIdentity.id)", identities),
  vin: lookupMetric(vm, "findCaseBySelectionIdentity({ vin: __benchmarkIdentity.vin })", identities),
  plate: lookupMetric(vm, "findCaseBySelectionIdentity({ plate: __benchmarkIdentity.plate })", identities),
  orNavNumber: lookupMetric(vm, "findCaseBySelectionIdentity({ orNavNumber: __benchmarkIdentity.orNavNumber })", identities),
} : { id: skipped("lookup", "normalizeState"), vin: skipped("lookup", "normalizeState"), plate: skipped("lookup", "normalizeState"), orNavNumber: skipped("lookup", "normalizeState") };
checkpoint({ lookupId: lookups.id });
checkpoint({ lookupVin: lookups.vin });
checkpoint({ lookupPlate: lookups.plate });
checkpoint({ lookupOr: lookups.orNavNumber });
const search = normalized ? timed("search", () => vm.run("state.cases.filter((item) => caseMatchesGlobalSearch(item, 'VINBENCH000'))"), Math.min(repeats, 3)) : skipped("search", "normalizeState");
checkpoint({ search });
const statusFilter = normalized ? timed("status_filter", () => vm.run("state.cases.filter((item) => getCaseStatus(item) === 'in_progress')"), Math.min(repeats, 3)) : skipped("status_filter", "normalizeState");
checkpoint({ statusFilter });
const sorting = normalized ? timed("sort", () => vm.run("state.cases.slice().sort(compareCasesForList)"), Math.min(repeats, 3)) : skipped("sort", "normalizeState");
checkpoint({ sorting });
const bookingLookup = normalized ? timed("booking_lookup", () => vm.run("getIndexedCaseBookings('case-0000000')"), Math.min(repeats, 3)) : skipped("booking_lookup", "normalizeState");
checkpoint({ bookingLookup });
const conflict = normalized ? timed("conflict", () => vm.run("findConflict({ start: '2025-06-02T09:00:00.000Z', end: '2025-06-02T10:00:00.000Z' }, ['mecanicien-1'], state.bookings)"), Math.min(repeats, 3)) : skipped("conflict", "normalizeState");
checkpoint({ conflict });
const planningPrep = normalized ? timed("planning_preparation", () => vm.run("getActiveTechnicianBookings('mecanicien-1')"), Math.min(repeats, 3)) : skipped("planning_preparation", "normalizeState");
checkpoint({ planningPrep });
function dashboardMetric(period, nowValue) {
  if (!normalized) return skipped(`dashboard_${period}`, "normalizeState");
  const expression = `state.ui.savDashboardPeriod = '${period}'; savPerformanceDashboardCache = null; buildSavPerformanceDashboard(new Date('${nowValue}'))`;
  const metric = timed(`dashboard_${period}`, () => vm.run(expression), Math.min(repeats, 3));
  const digest = safeCall(() => vm.run("({ filtered: state.cases.length, filteredCases: savPerformanceDashboardCache?.value?.cases?.filteredCases?.length || 0, periodCases: savPerformanceDashboardCache?.value?.cases?.periodCases?.length || 0, activeCases: savPerformanceDashboardCache?.value?.metrics?.activeCases || 0, createdCases: savPerformanceDashboardCache?.value?.metrics?.createdCases || 0, scheduledAppointments: savPerformanceDashboardCache?.value?.metrics?.scheduledAppointments || 0 })"));
  return { ...metric, resultDigest: digest.ok ? digest.value : { status: "ERROR", error: digest.error.message } };
}
const dashboard = { productionPath: "buildSavPerformanceDashboard -> getSavDashboardRange -> getSavDashboardCases", representative: dashboardMetric("today", "2025-06-15T12:00:00.000Z"), broad: dashboardMetric("month", "2025-06-15T12:00:00.000Z") };
checkpoint({ dashboard });
const lookupValidation = normalized ? { id: Boolean(vm.run("getIndexedCaseById('case-0000000')")), vin: Boolean(vm.run("findCaseBySelectionIdentity({ vin: 'VINBENCH000000000' })")) } : null;
const result = { mode, scale, bookingPerCase, cases: rawValidation.cases, bookings: rawValidation.bookings, resources: 4, repeats, lookupRepetitions, statusRatios: DATASET_STATUS_RATIOS, generationMs, rawValidation, rawJsonStringify: { ...rawJson, bytes: rawJsonBytes }, normalizeState, normalizedValidation, normalizedJsonStringify: { ...normalizedJsonStringify, bytes: normalizedJson ? Buffer.byteLength(normalizedJson) : null }, jsonParse, normalizeParsed, indexBuild, lookups, search, statusFilter, sorting, dashboard, bookingLookup, conflict, planningPrep, memory: { before, afterRaw, afterNormalize, afterStringify, afterIndexBuild }, validation: { raw: rawValidation.exact, normalized: normalizedValidation?.exact ?? false, lookupId: lookupValidation?.id ?? false, lookupVin: lookupValidation?.vin ?? false } };
checkpoint(result);
console.log(JSON.stringify(result));
