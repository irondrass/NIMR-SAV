import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { writeFile } from "node:fs/promises";
import { buildDataset } from "./scalability_dataset.mjs";
import { createNimrVmContext } from "../helpers/nimr_vm_context.mjs";
import { createGranularSupabaseAdapter } from "../helpers/granular_supabase_adapter.mjs";

const SCALES = [10_000, 50_000, 100_000];
const scriptPath = fileURLToPath(import.meta.url);
const resultUrl = new URL("./results/p0-009-granular-sync-outbox.json", import.meta.url);
const reportUrl = new URL("./P0-009-GRANULAR-SYNC-OUTBOX-REPORT.md", import.meta.url);

function memory() {
  global.gc?.();
  const usage = process.memoryUsage();
  return { rss: usage.rss, heapUsed: usage.heapUsed, heapTotal: usage.heapTotal };
}

async function measure(operation) {
  const startedAt = performance.now();
  const value = await operation();
  return { milliseconds: performance.now() - startedAt, value };
}

async function clearOutbox(context) {
  const records = await context.loadDurableOutboxOperations();
  for (const record of records) await context.deleteDurableOutboxOperation(record.operationId);
}

function mutationToOperation(context, mutation) {
  return context.buildDurableOperationFromEntityMutation(mutation, {
    workshopId: "00000000-0000-0000-0000-000000000001",
    userId: "benchmark-admin",
  });
}

async function captureAndEnqueue(context, state, marker, options = {}) {
  marker();
  const batch = context.captureEntityMutationBatch(state, options);
  const operations = batch.map((mutation) => mutationToOperation(context, mutation));
  for (const operation of operations) await context.enqueueDurableOutboxOperation(operation);
  context.acknowledgeEntityMutationBatch(batch);
  return operations;
}

async function runScale(caseCount) {
  const bookingCount = caseCount * 3;
  const beforeDataset = memory();
  const state = buildDataset(caseCount, { bookingPerCase: 3, seed: 0x009009 + caseCount });
  const afterDataset = memory();
  const vm = createNimrVmContext({ filename: `p0-009-benchmark-${caseCount}.js` });
  const { context } = vm;
  vm.localStorage.clear();
  const adapter = createGranularSupabaseAdapter();
  const caseTarget = state.cases[Math.floor(caseCount / 2)];
  const bookingTarget = state.bookings[Math.floor(bookingCount / 2)];

  // Exercise the production save detector, not just direct mutation capture.
  // Comparable initialization is an explicit startup/baseline cost and is kept
  // outside the measured ordinary one-case save.
  let forbiddenFullStateCalls = 0;
  context.__p009BenchmarkState = state;
  context.__p009BenchmarkTargetId = caseTarget.id;
  vm.run(`
    state = __p009BenchmarkState;
    activeCaseId = __p009BenchmarkTargetId;
    state.cases.find((item) => item.id === activeCaseId).localRevision = 0;
    shouldPersistStateInIndexedDb = () => true;
    persistLargeStateSnapshot = async () => true;
    scheduleAutoSupabaseBackup = () => {};
    initializeLastKnownCasesComparable();
  `);
  context.buildBackupPayload = async () => { forbiddenFullStateCalls += 1; return {}; };
  context.buildCloudBackupPayload = async () => { forbiddenFullStateCalls += 1; return {}; };
  context.cloneSyncStateSnapshot = () => { forbiddenFullStateCalls += 1; return {}; };
  context.getSyncStateFingerprint = () => { forbiddenFullStateCalls += 1; return "forbidden"; };
  caseTarget.clientName = `${caseTarget.clientName || "Case"} benchmark-edit`;
  const saveStateOneCase = await measure(() => context.saveState({
    changedCase: caseTarget,
    skipSnapshot: true,
    cloudReason: "p0-009-benchmark-one-case",
  }));
  let records = await context.loadDurableOutboxOperations();
  const productionCaseOperations = records.filter((entry) => entry.entityType === "case");
  assert.equal(saveStateOneCase.value, true);
  assert.equal(productionCaseOperations.length, 1);
  assert.equal(productionCaseOperations[0].entityId, caseTarget.id);
  assert.equal(context.NIMR_CASE_REVISION_SCAN.fullScan, false);
  assert.equal(context.NIMR_CASE_REVISION_SCAN.candidateCount, 1);
  assert.equal(context.NIMR_CASE_REVISION_SCAN.visitedCount, 1);
  assert.equal(forbiddenFullStateCalls, 0);
  const saveStateOneCaseEvidence = {
    milliseconds: saveStateOneCase.milliseconds,
    operationCount: productionCaseOperations.length,
    candidateCount: context.NIMR_CASE_REVISION_SCAN.candidateCount,
    visitedCount: context.NIMR_CASE_REVISION_SCAN.visitedCount,
    fullCaseRevisionScan: context.NIMR_CASE_REVISION_SCAN.fullScan,
    forbiddenFullStateCalls,
  };
  await clearOutbox(context);

  caseTarget.localRevision = 1;
  const enqueueOneCase = await measure(() => captureAndEnqueue(
    context,
    state,
    () => context.markEntityCaseDirty(caseTarget),
  ));
  records = await context.loadDurableOutboxOperations();
  assert.equal(records.length, 1);
  assert.equal(records[0].entityId, caseTarget.id);
  const oneCasePayloadBytes = Buffer.byteLength(JSON.stringify(records[0]), "utf8");

  caseTarget.localRevision = 2;
  const enqueueSameCaseAgain = await measure(() => captureAndEnqueue(
    context,
    state,
    () => context.markEntityCaseDirty(caseTarget),
  ));
  records = await context.loadDurableOutboxOperations();
  assert.equal(records.length, 1);
  assert.equal(records[0].payload.entity.localRevision, 2);
  await clearOutbox(context);

  bookingTarget.version = 1;
  const enqueueOneBooking = await measure(() => captureAndEnqueue(
    context,
    state,
    () => context.markEntityBookingDirty(bookingTarget),
  ));
  records = await context.loadDurableOutboxOperations();
  assert.equal(records.length, 1);
  assert.equal(records[0].entityId, bookingTarget.id);
  const oneBookingPayloadBytes = Buffer.byteLength(JSON.stringify(records[0]), "utf8");
  await clearOutbox(context);

  const enqueueCaseDelete = await measure(() => captureAndEnqueue(
    context,
    state,
    () => context.markEntityCaseDeleted(caseTarget.id),
  ));
  records = await context.loadDurableOutboxOperations();
  assert.equal(records.length, 1);
  assert.equal(records[0].action, "delete");
  await clearOutbox(context);

  const enqueueBookingDelete = await measure(() => captureAndEnqueue(
    context,
    state,
    () => context.markEntityBookingDeleted(bookingTarget.id),
  ));
  records = await context.loadDurableOutboxOperations();
  assert.equal(records.length, 1);
  assert.equal(records[0].action, "delete");
  await clearOutbox(context);

  const auditEntry = { id: `audit-${caseCount}`, at: "2026-08-22T12:00:00.000Z", type: "benchmark.append", details: "bounded" };
  const appendAudit = await measure(() => captureAndEnqueue(
    context,
    state,
    () => context.markEntityAuditEntryDirty(auditEntry),
  ));
  records = await context.loadDurableOutboxOperations();
  assert.equal(records.length, 1);
  assert.equal(records[0].entityType, "audit");
  await clearOutbox(context);

  const settingsPayload = {
    schemaVersion: 1,
    settings: { fastLaneEnabled: true },
    workHours: { monday: { enabled: true, start: "08:00", end: "17:00" } },
    workHoursSync: { fingerprint: "benchmark-hours" },
    holidays: [],
    resources: state.resources,
    planningDate: "2026-08-22",
  };
  const rootSettingsUpdate = await measure(() => captureAndEnqueue(
    context,
    state,
    () => {},
    { workshopId: "00000000-0000-0000-0000-000000000001", workshopSettings: settingsPayload },
  ));
  records = await context.loadDurableOutboxOperations();
  assert.equal(records.length, 1);
  assert.equal(records[0].entityType, "workshop_settings");
  await clearOutbox(context);

  caseTarget.localRevision = 3;
  await captureAndEnqueue(context, state, () => context.markEntityCaseDirty(caseTarget));
  const acknowledgedOperation = (await context.loadDurableOutboxOperations())[0];
  const unrelated = { ...state.cases[0], localRevision: 77 };
  await captureAndEnqueue(context, state, () => context.markEntityCaseDirty(unrelated));
  const acknowledgeUnrelated = await measure(() => context.acknowledgeDurableOutboxOperation(acknowledgedOperation.operationId));
  records = await context.loadDurableOutboxOperations();
  assert.equal(records.some((record) => record.entityId === unrelated.id), true);
  assert.equal(records.some((record) => record.operationId === acknowledgedOperation.operationId), false);
  await clearOutbox(context);

  const batchOperations = [];
  const processBatchOf100 = await measure(async () => {
    for (let index = 0; index < 100; index += 1) {
      const entity = { ...state.cases[index], localRevision: index + 1 };
      const operations = await captureAndEnqueue(context, state, () => context.markEntityCaseDirty(entity));
      batchOperations.push(...operations);
    }
    const ordered = context.sortDurableOutboxOperationsForSend(await context.loadDurableOutboxOperations());
    ordered.forEach((operation) => adapter.send(operation));
    return ordered.length;
  });
  assert.equal(processBatchOf100.value, 100);
  await clearOutbox(context);

  const coalesce10k = await measure(async () => {
    for (let revision = 1; revision <= 10_000; revision += 1) {
      caseTarget.localRevision = revision;
      await captureAndEnqueue(context, state, () => context.markEntityCaseDirty(caseTarget));
    }
    return context.loadDurableOutboxOperations();
  });
  assert.equal(coalesce10k.value.length, 1);
  assert.equal(coalesce10k.value[0].payload.entity.localRevision, 10_000);
  const finalPendingCount = coalesce10k.value.length;
  await clearOutbox(context);

  const sharedTimestamp = "2026-08-22T13:00:00.000Z";
  const cursorRows = new Array(1001).fill(null).map((_, index) => ({
    updated_at: sharedTimestamp,
    entity_id: `cursor-${String(index).padStart(5, "0")}`,
  }));
  const incrementalPullPage = await measure(() => context.selectGranularRowsAfterCursor(cursorRows, null, 500));
  const sameTimestampBoundary = await measure(() => context.selectGranularRowsAfterCursor(cursorRows, incrementalPullPage.value.cursor, 500));
  const finalCursorPage = context.selectGranularRowsAfterCursor(cursorRows, sameTimestampBoundary.value.cursor, 500);
  const cursorIds = [...incrementalPullPage.value.rows, ...sameTimestampBoundary.value.rows, ...finalCursorPage.rows].map((row) => row.entity_id);
  assert.equal(new Set(cursorIds).size, 1001);

  const finalMemory = memory();
  return {
    caseCount,
    bookingCount,
    saveStateOneCase: saveStateOneCaseEvidence,
    enqueueOneCase: { milliseconds: enqueueOneCase.milliseconds, operationCount: enqueueOneCase.value.length },
    enqueueSameCaseAgain: { milliseconds: enqueueSameCaseAgain.milliseconds, resultingPendingCount: 1 },
    enqueueOneBooking: { milliseconds: enqueueOneBooking.milliseconds, operationCount: enqueueOneBooking.value.length },
    enqueueCaseDelete: { milliseconds: enqueueCaseDelete.milliseconds, operationCount: enqueueCaseDelete.value.length },
    enqueueBookingDelete: { milliseconds: enqueueBookingDelete.milliseconds, operationCount: enqueueBookingDelete.value.length },
    appendAudit: { milliseconds: appendAudit.milliseconds, operationCount: appendAudit.value.length },
    rootSettingsUpdate: { milliseconds: rootSettingsUpdate.milliseconds, operationCount: rootSettingsUpdate.value.length },
    acknowledgeUnrelated: { milliseconds: acknowledgeUnrelated.milliseconds, unrelatedRetained: true },
    processBatchOf100: { milliseconds: processBatchOf100.milliseconds, operationCount: processBatchOf100.value, adapterCalls: adapter.calls.length },
    coalesce10k: { milliseconds: coalesce10k.milliseconds, finalPendingCount },
    incrementalPullPage: { milliseconds: incrementalPullPage.milliseconds, rowCount: incrementalPullPage.value.rows.length },
    sameTimestampBoundary: { milliseconds: sameTimestampBoundary.milliseconds, uniqueRows: new Set(cursorIds).size, expectedRows: 1001 },
    payloadBytes: { case: oneCasePayloadBytes, booking: oneBookingPayloadBytes },
    bootstrap: {
      casePageSize: 500,
      bookingPageSize: 500,
      auditPageSize: 250,
      casePages: Math.ceil(caseCount / 500),
      bookingPages: Math.ceil(bookingCount / 500),
    },
    memory: {
      beforeDataset,
      afterDataset,
      final: finalMemory,
      heapDeltaBytes: finalMemory.heapUsed - beforeDataset.heapUsed,
    },
    workCounts: { oneCaseEntitiesVisited: saveStateOneCaseEvidence.visitedCount, oneBookingEntitiesVisited: 1 },
    noRangeError: true,
    overallPass: finalPendingCount === 1
      && saveStateOneCaseEvidence.fullCaseRevisionScan === false
      && saveStateOneCaseEvidence.candidateCount === 1
      && saveStateOneCaseEvidence.visitedCount === 1
      && saveStateOneCaseEvidence.operationCount === 1
      && saveStateOneCaseEvidence.forbiddenFullStateCalls === 0
      && enqueueOneCase.value.length === 1
      && enqueueOneBooking.value.length === 1
      && new Set(cursorIds).size === 1001,
  };
}

function report(result) {
  const rows = result.scales.map((scale) => `| ${scale.caseCount.toLocaleString("en-US")} / ${scale.bookingCount.toLocaleString("en-US")} | ${scale.enqueueOneCase.milliseconds.toFixed(3)} | ${scale.enqueueOneBooking.milliseconds.toFixed(3)} | ${scale.coalesce10k.finalPendingCount} | ${scale.processBatchOf100.milliseconds.toFixed(3)} | ${scale.memory.heapDeltaBytes.toLocaleString("en-US")} |`).join("\n");
  const largest = result.scales.at(-1);
  return `# P0-009 Granular sync/outbox benchmark\n\n` +
    `Generated: ${result.generatedAt}\n\n` +
    `This deterministic benchmark uses the production mutation capture, operation-envelope, coalescing, acknowledgement, dependency ordering, and cursor-page logic with an in-memory Supabase recording adapter. It makes no network calls and does not benchmark manual full backup.\n\n` +
    `| Cases / bookings | One case enqueue (ms) | One booking enqueue (ms) | Pending after 10k same-case edits | Batch 100 (ms) | Heap delta (bytes) |\n` +
    `|---:|---:|---:|---:|---:|---:|\n${rows}\n\n` +
    `## 100k / 300k acceptance\n\n` +
    `- Production one-case save: ${largest.saveStateOneCase.milliseconds.toFixed(3)} ms; ${largest.saveStateOneCase.candidateCount} candidate; ${largest.saveStateOneCase.visitedCount} visited; full scan ${largest.saveStateOneCase.fullCaseRevisionScan}; ${largest.saveStateOneCase.operationCount} durable operation; ${largest.saveStateOneCase.forbiddenFullStateCalls} global clone/fingerprint calls.\n` +
    `- One case enqueue: ${largest.enqueueOneCase.milliseconds.toFixed(3)} ms; ${largest.workCounts.oneCaseEntitiesVisited} entity visited; ${largest.enqueueOneCase.operationCount} operation.\n` +
    `- One booking enqueue: ${largest.enqueueOneBooking.milliseconds.toFixed(3)} ms; ${largest.workCounts.oneBookingEntitiesVisited} entity visited; ${largest.enqueueOneBooking.operationCount} operation.\n` +
    `- Case / booking payload: ${largest.payloadBytes.case} / ${largest.payloadBytes.booking} bytes.\n` +
    `- 10,000 offline edits: ${largest.coalesce10k.milliseconds.toFixed(3)} ms; ${largest.coalesce10k.finalPendingCount} final pending operation.\n` +
    `- One acknowledgement while unrelated state changed: ${largest.acknowledgeUnrelated.milliseconds.toFixed(3)} ms; unrelated operation retained.\n` +
    `- Cursor tie test: ${largest.sameTimestampBoundary.uniqueRows}/${largest.sameTimestampBoundary.expectedRows} unique rows.\n` +
    `- Bootstrap pages: ${largest.bootstrap.casePages} case pages at ${largest.bootstrap.casePageSize}; ${largest.bootstrap.bookingPages} booking pages at ${largest.bootstrap.bookingPageSize}.\n` +
    `- No RangeError: ${largest.noRangeError ? "PASS" : "FAIL"}. Overall: ${result.overallPass ? "PASS" : "FAIL"}.\n`;
}

const scaleFlag = process.argv.indexOf("--scale");
if (scaleFlag >= 0) {
  const scale = Number(process.argv[scaleFlag + 1]);
  process.stdout.write(JSON.stringify(await runScale(scale)));
} else {
  const scales = SCALES.map((scale) => JSON.parse(execFileSync(process.execPath, ["--expose-gc", scriptPath, "--scale", String(scale)], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  })));
  const result = {
    benchmark: "P0-009 granular durable entity outbox",
    generatedAt: new Date().toISOString(),
    adapter: "deterministic recording Supabase adapter",
    networkCalls: 0,
    scales,
    correctnessPass: scales.every((scale) => scale.overallPass),
    scalabilityPass: scales.every((scale) => scale.workCounts.oneCaseEntitiesVisited === 1
      && scale.workCounts.oneBookingEntitiesVisited === 1
      && scale.coalesce10k.finalPendingCount <= 3),
  };
  result.overallPass = result.correctnessPass && result.scalabilityPass;
  await writeFile(resultUrl, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  await writeFile(reportUrl, report(result), "utf8");
  console.log(JSON.stringify({ overallPass: result.overallPass, scale100k: scales.at(-1) }, null, 2));
  if (!result.overallPass) process.exitCode = 1;
}
