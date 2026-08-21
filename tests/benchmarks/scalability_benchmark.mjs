import fs from "node:fs";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "../..");
const dir = path.join(root, "tests", "benchmarks", "results");
const read = (name) => JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
const cases = [read("p0-006-1k.json"), read("p0-006-10k.json"), read("p0-006-50k.json"), read("p0-006-100k.json")];
const bookingStress = [read("p0-006-100k-bookings.json"), read("p0-006-500k-bookings.json")];
const audit = [read("p0-006-audit-10k.json"), read("p0-006-audit-100k.json"), read("p0-006-audit-1m.json")];
const dashboard = [read("p0-006-1k.json"), read("p0-006-dashboard-10k.json"), read("p0-006-dashboard-50k.json")];
const output = { version: "p0-006-final-validation", measurementStatus: "FINAL CORRECTED MEASUREMENT", seed: "0x006005", cases, bookingStress, audit, dashboard };
fs.writeFileSync(path.join(dir, "p0-006-results.json"), `${JSON.stringify(output, null, 2)}\n`);
const ms = (x) => x?.stats?.median == null ? x?.status ?? "n/a" : `${x.stats.median.toFixed(2)} ms`;
const op = (x) => x?.meanMsPerOperation == null ? "n/a" : `${x.meanMsPerOperation.toFixed(3)} ms/op`;
const digest = (x) => x?.resultDigest ? JSON.stringify(x.resultDigest) : "n/a";
const caseRows = cases.map((e) => `| ${e.scale} | ${e.rawValidation?.cases ?? e.cases ?? "n/a"} | ${e.rawValidation?.bookings ?? e.bookings ?? "n/a"} | ${e.rawValidation?.exact ?? "n/a"} | ${e.normalizedValidation?.cases ?? "n/a"}/${e.normalizedValidation?.bookings ?? "n/a"} | ${ms(e.normalizeState)} | ${ms(e.indexBuild)} | ${e.normalizedJsonStringify?.status ?? "n/a"} |`).join("\n");
const lookupRows = cases.map((e) => ["id", "vin", "plate", "orNavNumber"].map((key) => `| ${e.scale} | ${key} | ${e.lookups?.[key]?.batchRepetitions ?? "n/a"} | ${e.lookups?.[key]?.stats?.median?.toFixed(2) ?? e.lookups?.[key]?.status ?? "n/a"} | ${op(e.lookups?.[key])} |`).join("\n")).join("\n");
const dashboardRows = dashboard.map((e) => `| ${e.scale} | ${e.dashboard?.representative?.status ?? "n/a"} | ${ms(e.dashboard?.representative)} | ${digest(e.dashboard?.representative)} | ${e.dashboard?.broad?.status ?? "n/a"} | ${ms(e.dashboard?.broad)} | ${digest(e.dashboard?.broad)} |`).join("\n");
const report = `# P0-006 — Scalability benchmark report

All values are **FINAL CORRECTED MEASUREMENT** unless explicitly marked **PARTIAL CHECKPOINT** or **ESTIMATE**. Aggregated only from saved individual result files; this aggregation did not rerun workers.

## Case scales

| Scale | Raw cases | Raw bookings | Raw exact | Normalized cases/bookings | normalizeState | index build | normalized stringify |
|---:|---:|---:|---|---|---:|---:|---|
${caseRows}

100k raw counts: cases ${cases[3].rawValidation?.cases ?? cases[3].cases}, bookings ${cases[3].rawValidation?.bookings ?? cases[3].bookings}, unique IDs ${cases[3].rawValidation?.uniqueCaseIds ?? "n/a"}, unique VINs ${cases[3].rawValidation?.uniqueVins ?? "n/a"}. Normalized counts: ${cases[3].normalizedValidation?.cases ?? "n/a"} cases / ${cases[3].normalizedValidation?.bookings ?? "n/a"} bookings. Normalize timing: ${ms(cases[3].normalizeState)}. afterNormalize RSS/heap: ${JSON.stringify(cases[3].memory?.afterNormalize ?? null)}. afterIndex RSS/heap: ${JSON.stringify(cases[3].memory?.afterIndexBuild ?? null)}. Index: ${ms(cases[3].indexBuild)}. Stringify: ${cases[3].normalizedJsonStringify?.status ?? "n/a"} (${cases[3].normalizedJsonStringify?.errorName ?? ""}: ${cases[3].normalizedJsonStringify?.error ?? ""}).

50k and 100k are **PARTIAL CHECKPOINT** results because workers reached timeout. Normalized stringify at 100k is a measured Node/V8 RangeError, not a platform-wide claim.

## Lookups and operations

| Scale | Lookup | Batch repetitions | Batch median ms | Mean ms/op |
|---:|---|---:|---:|---:|
${lookupRows}

100k search: ${ms(cases[3].search)}; sort: ${ms(cases[3].sorting)}; conflict: ${ms(cases[3].conflict)}. These are single-operation medians; interactive classification applies only to mean ms/op.

## Dashboard

| Scale | Today status | Today time | Today digest | Month status | Month time | Month digest |
|---:|---|---:|---|---|---:|---|
${dashboardRows}

The 1k corrected dashboard is measured, not safety-exceeded: today ${ms(cases[0].dashboard?.representative)}, month ${ms(cases[0].dashboard?.broad)}. 10k and 50k used isolated fresh dashboard workers; 50k is **PARTIAL CHECKPOINT/TIMEOUT**.

## Stress and audit

${bookingStress.map((e) => `- ${e.bookingPerCase} bookings/case (${e.bookings} bookings): ${e.status ?? "PASS"}; conflict ${e.conflict?.status ?? "n/a"}; stringify ${e.normalizedJsonStringify?.status ?? "n/a"}.`).join("\n")}

| Audit entries | Status | Generation | Stringify | Parse | JSON bytes | RSS/heap |
|---:|---|---:|---|---|---:|---|
${audit.map((e) => `| ${e.entries} | ${e.status ?? "PASS"} | ${e.generatedMs?.toFixed(2) ?? "n/a"} ms | ${e.stringify?.status ?? "n/a"} | ${e.parse?.status ?? "n/a"} | ${e.jsonBytes ?? "n/a"} | ${JSON.stringify({ rss: e.afterStringify?.rss, heapUsed: e.afterStringify?.heapUsed })} |`).join("\n")}

## Snapshot density and bottlenecks

Measured bytes/case: ${cases.filter((e) => e.normalizedJsonStringify?.bytes).map((e) => `${e.scale}: ${(e.normalizedJsonStringify.bytes / e.cases).toFixed(1)}`).join(", ")}. Estimated 100k snapshot size from latest successful density: **ESTIMATE**, not a successful 100k serialization.

Corrected top five: (1) normalized snapshot serialization at 100k; (2) full-state normalization at 50k; (3) VIN/plate/OR fallback lookups; (4) high-density booking conflict; (5) full-collection search/sort and dashboard traversal at 50k.

Machine-readable source: results/p0-006-results.json.
`;
fs.writeFileSync(path.join(root, "tests", "benchmarks", "P0-006-SCALABILITY-REPORT.md"), report);
console.log(JSON.stringify({ resultPath: "tests/benchmarks/results/p0-006-results.json", reportPath: "tests/benchmarks/P0-006-SCALABILITY-REPORT.md", scales: cases.map((e) => ({ scale: e.scale, status: e.status ?? "PASS" })) }));
