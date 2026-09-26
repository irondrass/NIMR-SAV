import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createNimrVmContext } from "./helpers/nimr_vm_context.mjs";

const BASE_SHA = "1edb626544f927a3dedf488ff3164acbbdf13b8b";
const PARENT_SHA = "1edb626544f927a3dedf488ff3164acbbdf13b8b";
const UX009_SHA = "3f4f7cd302e4676afee38245721d4d92fa7fae79";
const browserSmokeRequested = process.argv.includes("--browser-smoke");
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readProjectFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function readCommitFile(sha, relativePath) {
  return execFileSync("git", ["show", `${sha}:${relativePath.replaceAll("\\", "/")}`], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 30 * 1024 * 1024,
  });
}

function readBaseFile(relativePath) {
  return readCommitFile(BASE_SHA, relativePath);
}

function normalizeEol(value) {
  return String(value).replaceAll("\r\n", "\n");
}

function sourceSlice(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `Missing source marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `Missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

const appSource = readProjectFile("app.js");
const indexSource = readProjectFile("index.html");
const stateSource = readProjectFile("js/state.js");
const uiCasesSource = readProjectFile("js/ui-cases.js");
const versionSource = readProjectFile("js/version.js");
const estimateImportSource = readProjectFile("js/estimate-import.js");
const offlineSource = readProjectFile("offline.html");
const stylesSource = readProjectFile("styles.css");
const swSource = readProjectFile("sw.js");

const passed = [];
const failures = [];

function check(name, callback) {
  try {
    callback();
    passed.push(name);
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.log(`FAIL ${name}: ${String(error.message || error).split(/Input:\s*$/mu)[0].trim()}`);
  }
}

function createUx009Context(filename) {
  return createNimrVmContext({ filename });
}

check("A Release/cache remains atomically synchronized and schema versions stay stable", () => {
  const versionMatch = versionSource.match(/^window\.APP_VERSION = "(v\d+\.\d+\.\d+)";$/mu);
  assert.ok(versionMatch, "Valid semantic release version required in js/version.js");
  const release = versionMatch[1];
  const plainVersion = release.slice(1);

  assert.match(versionSource, new RegExp(`^window\\.NIMR_BUILD = "${release}";$`, "mu"));
  assert.match(versionSource, new RegExp(`^window\\.NIMR_CACHE_NAME = "nimr-sav-${release}";$`, "mu"));
  assert.match(stateSource, new RegExp(`^const APP_VERSION = "${release}";$`, "mu"));
  assert.match(stateSource, /^const DB_VERSION = 2;$/mu);
  assert.match(stateSource, /^const CURRENT_DATA_SCHEMA_VERSION = 2;$/mu);
  assert.match(stateSource, /^const CANONICAL_TASK_MODEL_VERSION = 1;$/mu);
  assert.match(swSource, new RegExp(`^const CACHE_NAME = "nimr-sav-${release}";$`, "mu"));
  assert.match(appSource, new RegExp(`pdf\\.worker\\.min\\.js\\?v=${plainVersion}`, "u"));
  assert.match(appSource, new RegExp(`sw\\.js\\?v=${plainVersion}`, "u"));
  assert.match(estimateImportSource, new RegExp(`pdf\\.worker\\.min\\.js\\?v=${plainVersion}`, "u"));
  assert.match(indexSource, new RegExp(`styles\\.css\\?v=${plainVersion}`, "u"));
  assert.match(indexSource, new RegExp(`app\\.js\\?v=${plainVersion}`, "u"));
  assert.match(offlineSource, new RegExp(`styles\\.css\\?v=${plainVersion}`, "u"));
});

check("B Workshop Progress Board remains inside Today without a dedicated navigation tab", () => {
  const todayStart = indexSource.indexOf('id="view-today"');
  const todayEnd = indexSource.indexOf('id="view-dossiers"', todayStart);
  const progressPosition = indexSource.indexOf('id="workshop-progress-board"');
  assert.ok(todayStart >= 0 && todayEnd > todayStart, "view-today must exist and precede dossiers view");
  assert.ok(progressPosition > todayStart && progressPosition < todayEnd, "workshop-progress-board must be inside view-today");
  assert.equal((indexSource.match(/id="workshop-progress-board"/gu) || []).length, 1);
  assert.equal((indexSource.match(/data-tab="workshop-progress|data-tab="progress/gu) || []).length, 0);
  assert.ok(indexSource.includes('id="workshop-progress-search"'), "Search control must exist");
  assert.ok(indexSource.includes('id="workshop-progress-filter"'), "Filter control must exist");
  assert.ok(indexSource.includes('id="workshop-progress-status"'), "Status element must exist");
  assert.match(indexSource.slice(todayStart, todayEnd), /Véhicules présents à l’atelier|État d’avancement des véhicules atelier/u);
  assert.match(indexSource.slice(todayStart, todayEnd), /Suivi en temps réel des véhicules réceptionnés/u);
});

check("C UX009 introduction preserves role and permission authority while current reception retains Today access", () => {
  const parentState = readCommitFile(PARENT_SHA, "js/state.js");
  const ux009State = readCommitFile(UX009_SHA, "js/state.js");
  for (const [start, end] of [
    ["const DIRECTOR_PERMISSIONS", "const READ_ONLY_PERMISSIONS"],
    ["const ROLE_PERMISSIONS", "const MUTATION_PERMISSIONS"],
    ["const ROLE_TABS", "// Tab par défaut"],
    ["const ROLE_DEFAULT_TABS", "// v23.2.5"],
  ]) {
    assert.equal(
      normalizeEol(sourceSlice(ux009State, start, end)),
      normalizeEol(sourceSlice(parentState, start, end)),
      `Original UX009 commit must not alter ${start}`,
    );
  }
  const currentRoleTabsSlice = sourceSlice(stateSource, "const ROLE_TABS", "// Tab par défaut");
  assert.match(currentRoleTabsSlice, /reception:\s*\[[^\]]*?"today"[^\]]*?\]/u, "reception role must retain access to today in current authority");
});

check("D Physically present vehicles remain on the board until actual delivery", () => {
  const { context, run } = createUx009Context("ux009-active-cases.js");
  run(`state = normalizeState({
    cases: [
      { id: "received", clientName: "Reçu", flags: { received: true }, receptionWorkflow: { vehicleReceivedAt: "2026-08-31T08:00:00.000Z" } },
      { id: "appointment-only", clientName: "RDV seul", appointment: { start: "2026-09-01T08:00:00.000Z" }, flags: { received: false } },
      { id: "delivered", clientName: "Livré", flags: { received: true, delivered: true } },
      { id: "invoiced", clientName: "Facturé", flags: { received: true, invoiced: true } },
      { id: "archived", clientName: "Archivé", archivedAt: "2026-08-30T08:00:00.000Z", flags: { received: true } },
      { id: "deleted", clientName: "Supprimé", deletedAt: "2026-08-30T08:00:00.000Z", flags: { received: true } },
      { id: "closed", clientName: "Clos", closedAt: "2026-08-30T08:00:00.000Z", flags: { received: true } }
    ],
    bookings: [],
    resources: []
  })`);
  const model = context.buildWorkshopProgressBoardModel(new Date("2026-08-31T12:00:00.000Z"), { search: "", filter: "all" });
  assert.equal(model.total, 4);
  const activeRowIds = Array.from(model.rows, (row) => row.item.id).sort();
  assert.deepEqual(activeRowIds, ["archived", "closed", "invoiced", "received"]);
  for (const physicallyPresent of ["received", "invoiced", "archived", "closed"]) {
    const item = run(`state.cases.find((candidate) => candidate.id === ${JSON.stringify(physicallyPresent)})`);
    assert.equal(context.isWorkshopProgressActiveCase(item), true, physicallyPresent);
  }
  for (const excluded of ["appointment-only", "delivered", "deleted"]) {
    const item = run(`state.cases.find((candidate) => candidate.id === ${JSON.stringify(excluded)})`);
    assert.equal(context.isWorkshopProgressActiveCase(item), false, excluded);
  }
});

check("E OR, search and intervention type reuse canonical helpers", () => {
  assert.match(uiCasesSource, /caseMatchesGlobalSearch\(item, search\)/u);
  assert.match(uiCasesSource, /getPrintOrderReference\(item\)/u);
  assert.match(uiCasesSource, /getClaimTypeLabel\(getCasePrimaryType\(item\)\)/u);
  const { context, run } = createUx009Context("ux009-search.js");
  run(`state = normalizeState({
    cases: [{
      id: "search-case",
      clientName: "Société Atlas",
      vehicle: "NIMR Atelier",
      plate: "234 TUN 5678",
      vin: "VINUX009",
      orNavNumber: "OR-UX009",
      flags: { received: true },
      receptionWorkflow: { vehicleReceivedAt: "2026-08-31T08:00:00.000Z" },
      claims: [{ id: "claim-1", type: "electrical_client", includeInPlanning: true }]
    }],
    bookings: [],
    resources: []
  })`);
  const byPlate = context.buildWorkshopProgressBoardModel(new Date("2026-08-31T12:00:00.000Z"), { search: "234tun", filter: "all" });
  const byOrder = context.buildWorkshopProgressBoardModel(new Date("2026-08-31T12:00:00.000Z"), { search: "OR-UX009", filter: "all" });
  assert.equal(byPlate.visible, 1);
  assert.equal(byOrder.visible, 1);
  const item = run("state.cases[0]");
  assert.equal(context.getPrintOrderReference(item), "OR-UX009");
  assert.equal(context.getCasePrimaryType(item), "electrical_client");
});

check("F ETA uses only existing revised/current/initial/appointment values", () => {
  const { context, run } = createUx009Context("ux009-eta.js");
  const before = run(`JSON.stringify({
    revisedEstimatedDelivery: "2026-09-04T08:00:00.000Z",
    deliveryEstimate: { current: "2026-09-03T08:00:00.000Z" },
    initialEstimatedDelivery: "2026-09-02T08:00:00.000Z",
    appointment: { delivery: "2026-09-01T08:00:00.000Z" }
  })`);
  run(`__etaItem = JSON.parse(${JSON.stringify(before)})`);
  assert.equal(context.getWorkshopProgressEta(context.__etaItem).toISOString(), "2026-09-04T08:00:00.000Z");
  run("delete __etaItem.revisedEstimatedDelivery");
  assert.equal(context.getWorkshopProgressEta(context.__etaItem).toISOString(), "2026-09-03T08:00:00.000Z");
  run("delete __etaItem.deliveryEstimate.current");
  assert.equal(context.getWorkshopProgressEta(context.__etaItem).toISOString(), "2026-09-02T08:00:00.000Z");
  run("delete __etaItem.initialEstimatedDelivery");
  assert.equal(context.getWorkshopProgressEta(context.__etaItem).toISOString(), "2026-09-01T08:00:00.000Z");
  assert.doesNotMatch(uiCasesSource, /promisedDeliveryAt/u);
  assert.equal(run("JSON.stringify(__etaItem)"), JSON.stringify({ deliveryEstimate: {}, appointment: { delivery: "2026-09-01T08:00:00.000Z" } }));
});

check("G Current step, progress and responsible person derive from canonical bookings", () => {
  const { context, run } = createUx009Context("ux009-step-responsible.js");
  run(`state = normalizeState({
    cases: [{ id: "step-case", clientName: "Étape", flags: { received: true, workStarted: true }, receptionWorkflow: { vehicleReceivedAt: "2026-08-30T08:00:00.000Z" } }],
    resources: [
      { id: "tech", name: "Amine Technicien", role: "mecanicien", active: true },
      { id: "lift", name: "Pont 2", role: "pont", resourceType: "equipment", active: true }
    ],
    bookings: [
      { id: "done", businessTaskId: "task-done", caseId: "step-case", type: "work", status: "completed", title: "Diagnostic", resourceIds: ["tech", "lift"], actualStart: "2026-08-30T09:00:00.000Z", actualEnd: "2026-08-30T10:00:00.000Z", start: "2026-08-30T09:00:00.000Z", end: "2026-08-30T10:00:00.000Z" },
      { id: "active", businessTaskId: "task-active", caseId: "step-case", type: "work", status: "started", title: "Réparation électrique", resourceIds: ["tech", "lift"], actualStart: "2026-08-31T09:00:00.000Z", start: "2026-08-31T09:00:00.000Z", end: "2026-08-31T12:00:00.000Z" },
      { id: "future", businessTaskId: "task-future", caseId: "step-case", type: "work", status: "planned", title: "Finition", resourceIds: ["lift"], start: "2026-09-01T09:00:00.000Z", end: "2026-09-01T10:00:00.000Z" },
      { id: "leave", caseId: "step-case", type: "leave", status: "planned", title: "Congé", resourceIds: ["tech"] },
      { id: "temporary", caseId: "step-case", type: "work", temporary: true, status: "planned", title: "Simulation", resourceIds: ["tech"] }
    ]
  })`);
  const before = run("JSON.stringify(state)");
  const item = run("state.cases[0]");
  const step = context.getWorkshopProgressCurrentStep(item, new Date("2026-08-31T10:00:00.000Z"));
  const row = context.buildWorkshopProgressRow(item, new Date("2026-08-31T10:00:00.000Z"));
  assert.equal(step.label, "Réparation électrique");
  assert.equal(step.booking.id, "active");
  assert.equal(row.responsible, "Amine Technicien");
  assert.doesNotMatch(row.responsible, /Pont/u);
  assert.deepEqual({ completed: row.progress.completed, total: row.progress.total }, { completed: 1, total: 3 });
  assert.equal(run("JSON.stringify(state)"), before, "dashboard derivation must not mutate state");
});

check("H Parts and blocker display reuses canonical blocker helpers", () => {
  for (const helper of ["isCaseBlocked", "getCaseBlockerLabel", "getCaseBlockedHours", "normalizePartsStatus", "PARTS_STATUS_LABELS"]) {
    assert.match(uiCasesSource, new RegExp(`\\b${helper.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\b`, "u"));
  }
  const { context, run } = createUx009Context("ux009-blocker.js");
  run(`state = normalizeState({
    cases: [{
      id: "blocked-case",
      clientName: "Bloqué",
      partsStatus: "waiting_parts",
      blockerReason: "waiting_parts",
      blockerDetails: "Pare-chocs attendu",
      flags: { received: true },
      receptionWorkflow: { vehicleReceivedAt: "2026-08-20T08:00:00.000Z" },
      history: [{ at: "2026-08-22T08:00:00.000Z", type: "case.blocked", title: "Blocage pièces" }]
    }],
    bookings: [], resources: []
  })`);
  const row = context.buildWorkshopProgressRow(run("state.cases[0]"), new Date("2026-08-31T08:00:00.000Z"));
  assert.equal(row.blocked, true);
  assert.match(row.blockerLabel, /pièce/iu);
  assert.ok(row.blockedHours >= 7 * 24);
  assert.match(row.partsLabel, /attente|pièce/iu);
});

check("I Last operational activity is deterministic and active finish delay takes precedence over stale", () => {
  const { context, run } = createUx009Context("ux009-activity.js");
  run(`state = normalizeState({
    cases: [{
      id: "activity-case",
      clientName: "Activité",
      createdAt: "2026-08-20T06:00:00.000Z",
      updatedAt: "2026-08-31T20:00:00.000Z",
      actualRepairStart: "2026-08-29T08:00:00.000Z",
      flags: { received: true, workStarted: true },
      receptionWorkflow: { vehicleReceivedAt: "2026-08-28T08:00:00.000Z", sentToWorkshopAt: "2026-08-29T07:00:00.000Z" },
      history: [{ at: "2026-08-29T10:00:00.000Z", type: "work.note" }]
    }],
    bookings: [], resources: []
  });
  state.bookings = [{
    id: "activity-booking", caseId: "activity-case", type: "work", status: "started", title: "Tâche",
    start: "2026-08-29T08:00:00.000Z", end: "2026-08-29T12:00:00.000Z",
    notes: [{ at: "2026-08-29T12:00:00.000Z", text: "Contrôle" }],
    workSessions: [{ startedAt: "2026-08-29T08:00:00.000Z", pausedAt: "2026-08-29T11:00:00.000Z" }]
  }];
  invalidateUiRuntimeIndexes();`);
  const item = run("state.cases[0]");
  const activity = context.getWorkshopProgressLastActivityAt(item);
  assert.equal(activity.toISOString(), "2026-08-29T12:00:00.000Z", "updatedAt must remain fallback-only when operational evidence exists");
  const row = context.buildWorkshopProgressRow(item, new Date("2026-08-31T13:00:00.000Z"));
  assert.equal(row.stale, false, "overdue active task finish takes precedence over generic staleness");
  assert.ok(row.exceptions.some((e) => e.code === "task_finish_late"), "active finish delay exception must be detected");
  assert.equal(run("WORKSHOP_PROGRESS_STALE_HOURS"), 24);
  assert.doesNotMatch(stateSource, /WORKSHOP_PROGRESS_STALE_HOURS/u);
});

check("J Filters and deterministic priority sorting follow current canonical operational exceptions", () => {
  const { context, run } = createUx009Context("ux009-filters-sort.js");
  run(`state = normalizeState({
    cases: [
      { id: "late", clientName: "Late", revisedEstimatedDelivery: "2026-08-29T08:00:00.000Z", flags: { received: true, workStarted: true }, receptionWorkflow: { vehicleReceivedAt: "2026-08-31T07:00:00.000Z", sentToWorkshopAt: "2026-08-31T08:00:00.000Z" } },
      { id: "workshop-late", clientName: "Workshop Late", flags: { received: true, workStarted: true }, receptionWorkflow: { vehicleReceivedAt: "2026-08-31T07:10:00.000Z", sentToWorkshopAt: "2026-08-31T08:10:00.000Z" } },
      { id: "blocked", clientName: "Blocked", partsStatus: "waiting_parts", blockerReason: "waiting_parts", flags: { received: true }, receptionWorkflow: { vehicleReceivedAt: "2026-08-20T07:00:00.000Z" }, history: [{ at: "2026-08-21T08:00:00.000Z", type: "case.blocked", title: "Blocage" }] },
      { id: "stale", clientName: "Stale", flags: { received: true }, receptionWorkflow: { vehicleReceivedAt: "2026-08-28T07:00:00.000Z" } },
      { id: "ready", clientName: "Ready", flags: { received: true, workStarted: true, workCompleted: true, qualityApproved: true }, receptionWorkflow: { vehicleReceivedAt: "2026-08-31T06:00:00.000Z", readyForDeliveryAt: "2026-08-31T10:00:00.000Z" } },
      { id: "completed", clientName: "Completed", flags: { received: true, workStarted: true, workCompleted: true }, receptionWorkflow: { vehicleReceivedAt: "2026-08-31T06:10:00.000Z", qualityReviewedAt: "2026-08-31T10:10:00.000Z" } },
      { id: "progress", clientName: "Progress", flags: { received: true, workStarted: true }, receptionWorkflow: { vehicleReceivedAt: "2026-08-31T06:20:00.000Z", sentToWorkshopAt: "2026-08-31T10:20:00.000Z" } },
      { id: "other", clientName: "Other", flags: { received: true }, receptionWorkflow: { vehicleReceivedAt: "2026-08-31T10:30:00.000Z" } }
    ],
    bookings: [{
      id: "workshop-late-booking",
      businessTaskId: "workshop-late-task",
      taskId: "workshop-late-task",
      taskModelVersion: 1,
      sourceKind: "manual",
      caseId: "workshop-late",
      type: "work",
      key: "body",
      title: "Réparation atelier en retard",
      status: "started",
      resourceIds: ["workshop-late-tech"],
      primaryResourceId: "workshop-late-tech",
      start: "2026-08-31T08:00:00.000Z",
      end: "2026-08-31T10:00:00.000Z",
      segments: [{ start: "2026-08-31T08:00:00.000Z", end: "2026-08-31T10:00:00.000Z" }],
      actualStart: "2026-08-31T08:00:00.000Z"
    }],
    resources: [{ id: "workshop-late-tech", name: "Technicien retard atelier", role: "tolier", active: true }]
  })`);
  const now = new Date("2026-08-31T12:00:00.000Z");
  const all = context.buildWorkshopProgressBoardModel(now, { search: "", filter: "all" });
  assert.deepEqual(Array.from(all.rows, (row) => row.priority), [0, 1, 3, 4, 5, 5, 6, 6]);
  assert.deepEqual(
    Array.from(all.rows, (row) => row.item.id),
    ["blocked", "workshop-late", "ready", "completed", "late", "progress", "stale", "other"],
  );
  const workshopLateRow = all.rows.find((row) => row.item.id === "workshop-late");
  assert.equal(workshopLateRow.etaOverdue, false);
  assert.equal(workshopLateRow.existingLate, true);
  assert.equal(workshopLateRow.late, true);
  assert.equal(workshopLateRow.priority, 1);
  assert.match(workshopLateRow.priorityLabel, /Fin de tâche en retard/u);
  assert.deepEqual(Array.from(context.buildWorkshopProgressBoardModel(now, { filter: "late" }).rows, (row) => row.item.id), ["workshop-late"]);
  assert.deepEqual(Array.from(context.buildWorkshopProgressBoardModel(now, { filter: "blocked" }).rows, (row) => row.item.id), ["blocked"]);
  assert.ok(Array.from(context.buildWorkshopProgressBoardModel(now, { filter: "stale" }).rows, (row) => row.item.id).includes("blocked"));
  assert.deepEqual(
    Array.from(context.buildWorkshopProgressBoardModel(now, { filter: "in_progress" }).rows, (row) => row.item.id).sort(),
    ["late", "progress", "workshop-late"],
  );
  assert.deepEqual(Array.from(context.buildWorkshopProgressBoardModel(now, { filter: "completed" }).rows, (row) => row.item.id), ["ready", "completed"]);
  assert.deepEqual(Array.from(context.buildWorkshopProgressBoardModel(now, { filter: "ready" }).rows, (row) => row.item.id), ["ready"]);
});

check("K Native accessible row activation opens the canonical dossier", () => {
  assert.match(indexSource, /<label for="workshop-progress-search">/u);
  assert.match(indexSource, /<label for="workshop-progress-filter">/u);
  assert.match(indexSource, /id="workshop-progress-status" role="status" aria-live="polite"/u);
  assert.doesNotMatch(indexSource, /id="workshop-progress-board"[^>]*aria-live/u);
  assert.match(uiCasesSource, /<button class="workshop-progress-row[^>]*type="button"[^>]*data-workshop-progress-case/u);
  assert.doesNotMatch(uiCasesSource, /<article[^>]*data-workshop-progress-case|role="button"[^>]*data-workshop-progress-case/u);
  assert.match(stylesSource, /\.workshop-progress-row:focus-visible\s*\{[\s\S]*?outline:\s*3px solid #0b63ce/u);
  assert.match(stylesSource, /\.workshop-progress-toolbar input,[\s\S]*?min-height:\s*44px/u);
  const { context, run } = createUx009Context("ux009-open-case.js");
  run(`
    activeCaseId = "";
    activeCaseDetailTab = "claims";
    __openedTab = "";
    __renderCasesCount = 0;
    __renderDetailCount = 0;
    setActiveTab = (tab) => { __openedTab = tab; };
    renderCases = () => { __renderCasesCount += 1; };
    renderCaseDetail = () => { __renderDetailCount += 1; };
    openWorkshopProgressCase("case-ux009");
  `);
  assert.equal(run("activeCaseId"), "case-ux009");
  assert.equal(run("activeCaseDetailTab"), "resume");
  assert.equal(context.__openedTab, "dossiers");
  assert.equal(context.__renderCasesCount, 1);
  assert.equal(context.__renderDetailCount, 1);
});

check("L Original UX009 scope leaves planning, Supabase, SQL and protected authority boundaries untouched", () => {
  const changedInUx009 = execFileSync("git", ["show", "--name-only", "--format=", UX009_SHA], { cwd: repoRoot, encoding: "utf8" })
    .trim().split("\n").map((f) => f.trim()).filter(Boolean);

  const APPROVED_UX009_PATHS = [
    "app.js",
    "index.html",
    "js/estimate-import.js",
    "js/state.js",
    "js/ui-cases.js",
    "js/version.js",
    "offline.html",
    "styles.css",
    "sw.js",
    "tests/sec_server_client_role_parity_sec002.test.mjs",
    "tests/ux_director_dashboard_ux007.test.mjs",
    "tests/ux_visual_accessibility_ux008.test.mjs",
    "tests/ux_workshop_vehicle_progress_ux009.test.mjs",
  ];

  assert.deepEqual(changedInUx009.sort(), APPROVED_UX009_PATHS.sort(), "Original UX009 commit must touch exactly approved 13 paths");

  for (const forbidden of [
    "js/planning.js",
    "js/business-rules-v2187.js",
    "js/supabase-client.js",
    "js/supabase-config.js",
    "js/supabase-sync.js",
    "supabase-schema.sql",
  ]) {
    assert.ok(!changedInUx009.includes(forbidden), `Forbidden file ${forbidden} must not be touched by UX009`);
    assert.equal(
      normalizeEol(readCommitFile(UX009_SHA, forbidden)),
      normalizeEol(readCommitFile(PARENT_SHA, forbidden)),
      `Protected authority file ${forbidden} must be identical between parent and UX009 commit`,
    );
  }

  const parentUiCases = readCommitFile(PARENT_SHA, "js/ui-cases.js");
  const ux009UiCases = readCommitFile(UX009_SHA, "js/ui-cases.js");

  assert.equal(
    normalizeEol(sourceSlice(ux009UiCases, "function buildSavKpis", "function renderSavDashboardLoads")),
    normalizeEol(sourceSlice(parentUiCases, "function buildSavKpis", "function renderSavDashboardLoads")),
    "buildSavKpis must remain identical between parent and UX009",
  );
  assert.equal(
    normalizeEol(sourceSlice(ux009UiCases, "function buildDirectorDashboardSnapshot", "function buildSavPerformanceDashboard")),
    normalizeEol(sourceSlice(parentUiCases, "function buildDirectorDashboardSnapshot", "function buildSavPerformanceDashboard")),
    "buildDirectorDashboardSnapshot must remain identical between parent and UX009",
  );

  const ux009Progress = sourceSlice(ux009UiCases, "const WORKSHOP_PROGRESS_STALE_HOURS", "function getTechnicianDashboardResources");
  assert.doesNotMatch(ux009Progress, /saveState\s*\(/u);
  assert.doesNotMatch(ux009Progress, /state\.[A-Za-z0-9_$.[\]]+\s*=/u);

  const currentSupabaseClient = readProjectFile("js/supabase-client.js");
  const provisioningClient = sourceSlice(currentSupabaseClient, "const WORKSHOP_USER_ADMIN_ACTIONS", "async function authenticateSupabaseUser");
  assert.match(provisioningClient, /client\.functions\.invoke\("workshop-user-admin"/u);
  assert.doesNotMatch(provisioningClient, /auth\.admin|service_role|sb_secret_|SUPABASE_SECRET_KEYS/u);

  const { context, run } = createUx009Context("ux009-bounded.js");
  run(`
    state = normalizeState({
      cases: [
        ...Array.from({ length: 4000 }, (_, index) => ({ id: "closed-" + index, flags: { received: true, delivered: true } })),
        ...Array.from({ length: 3 }, (_, index) => ({ id: "active-" + index, clientName: "Active " + index, flags: { received: true }, receptionWorkflow: { vehicleReceivedAt: "2026-08-31T08:00:00.000Z" } }))
      ], bookings: [], resources: []
    });
    __buildCount = 0;
    __originalBuildWorkshopProgressRow = buildWorkshopProgressRow;
    buildWorkshopProgressRow = (...args) => { __buildCount += 1; return __originalBuildWorkshopProgressRow(...args); };
    __boundedModel = buildWorkshopProgressBoardModel(new Date("2026-08-31T12:00:00.000Z"), { search: "", filter: "all" });
  `);
  assert.equal(context.__boundedModel.total, 3);
  assert.equal(context.__buildCount, 3, "Only active received cases may receive derived-row work");
});

assert.equal(passed.length + failures.length, 12, "UX-009 must contain exactly checks A-L");

if (failures.length) {
  console.error(`\nUX-009 REGRESSION SUITE: ${passed.length}/12 CHECKS PASSED (${failures.length} FAILED)`);
  failures.forEach(({ name, error }) => console.error(`\n${name}\n${error.stack || error.message}`));
  process.exitCode = 1;
} else {
  console.log("\nUX-009 REGRESSION SUITE: 12/12 CHECKS PASSED");
}

async function dispatchKey(send, sessionId, key, code = key) {
  const virtualKeyCode = { Enter: 13 }[key] || 0;
  const params = { key, code, windowsVirtualKeyCode: virtualKeyCode, nativeVirtualKeyCode: virtualKeyCode };
  await send("Input.dispatchKeyEvent", { type: "keyDown", ...params, text: key === "Enter" ? "\r" : "" }, sessionId);
  await send("Input.dispatchKeyEvent", { type: "keyUp", ...params }, sessionId);
}

async function runBrowserSmoke() {
  const { withBrowserPage } = await import("./helpers/cdp_browser_harness.mjs");
  const viewports = [
    { width: 375, height: 812 },
    { width: 430, height: 932 },
    { width: 768, height: 1024 },
    { width: 1366, height: 768 },
    { width: 1920, height: 1080 },
  ];
  return withBrowserPage(repoRoot, async ({ send, sessionId, findings, evaluate, waitFor }) => {
    await send("Emulation.setDeviceMetricsOverride", { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false }, sessionId);
    const fixture = await evaluate(`
      (async () => {
        const waitUntil = async (predicate, message) => {
          for (let attempt = 0; attempt < 100; attempt += 1) {
            if (predicate()) return;
            await new Promise((resolveWait) => setTimeout(resolveWait, 100));
          }
          throw new Error(message);
        };
        await waitUntil(() => typeof state !== "undefined" && Array.isArray(state.users), "state unavailable");
        const form = document.getElementById("first-access-form");
        const overlay = document.getElementById("first-access-overlay");
        if (form && overlay?.hidden === false) {
          const authUser = { id: "ux009-browser-admin", email: "ux009-browser@example.test", user_metadata: { name: "Admin UX-009" } };
          const membership = { workshop_id: "00000000-0000-0000-0000-000000000001", user_id: authUser.id, role: "admin_technique", resource_id: null };
          window.authenticateSupabaseUser = async () => ({ ok: true, user: authUser, membership });
          window.getSupabaseUser = async () => authUser;
          window.resolveSupabaseWorkshopMembership = async () => ({ ok: true, membership });
          window.pullLatestSupabaseBackup = async () => ({ ok: true });
          window.startSupabaseLiveSync = async () => true;
          window.signOutSupabaseSession = async () => ({ ok: true });
          form.elements.email.value = authUser.email;
          form.elements.password.value = "Pass123456";
          form.requestSubmit();
          await waitUntil(() => state.currentUserId && document.getElementById("first-access-overlay")?.hidden !== false, "fixture login failed");
        }
        const user = state.users.find((candidate) => candidate?.id === state.currentUserId);
        if (!user) throw new Error("fixture user unavailable");
        user.role = "reception";
        const received = normalizeCase({
          id: "ux009-browser-received", clientName: "Client reçu UX-009", vehicle: "NIMR Reçu", plate: "UX-009-R",
          orNavNumber: "OR-009", flags: { received: true, workStarted: true },
          receptionWorkflow: { vehicleReceivedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), sentToWorkshopAt: new Date(Date.now() - 60 * 60 * 1000).toISOString() },
          claims: [{ id: "claim-009", type: "client", includeInPlanning: true }], history: [], supplements: []
        });
        const appointmentOnly = normalizeCase({
          id: "ux009-browser-appointment", clientName: "Client RDV seul", vehicle: "NIMR RDV", plate: "UX-009-A",
          appointment: { start: new Date(Date.now() + 86400000).toISOString() }, flags: { received: false }, claims: [], history: [], supplements: []
        });
        const lateTechnician = normalizeResource({ id: "ux009-browser-tech", name: "Technicien UX-009", role: "tolier", active: true });
        const lateStart = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
        const lateEnd = new Date(Date.now() - 30 * 60 * 1000).toISOString();
        const lateBooking = normalizeBooking({
          id: "ux009-browser-late-booking", businessTaskId: "ux009-browser-late-task", taskId: "ux009-browser-late-task",
          taskModelVersion: 1, sourceKind: "manual", caseId: received.id, type: "work", key: "body", title: "Réparation atelier",
          status: "started", resourceIds: [lateTechnician.id], primaryResourceId: lateTechnician.id,
          start: lateStart, end: lateEnd, segments: [{ start: lateStart, end: lateEnd }], actualStart: lateStart
        }, new Set([lateTechnician.id]));
        state.cases.splice(0, state.cases.length, received, appointmentOnly);
        state.resources.splice(0, state.resources.length, lateTechnician);
        state.bookings.splice(0, state.bookings.length, lateBooking);
        if (typeof invalidateUiRuntimeIndexes === "function") invalidateUiRuntimeIndexes();
        setActiveTab("today");
        render();
        const row = buildWorkshopProgressRow(received, new Date());
        const primaryException = typeof getPrimaryOperationalException === "function" ? getPrimaryOperationalException(row.exceptions) : null;
        const priorityLabel = primaryException?.label || row.priorityLabel;
        return {
          role: user.role,
          today: canAccessTab("today"),
          priority: row.priority,
          priorityLabel,
          existingLate: row.existingLate,
          etaOverdue: row.etaOverdue,
          late: row.late,
          exceptionCodes: (row.exceptions || []).map((e) => e.code),
        };
      })()
    `);
    assert.equal(fixture.role, "reception");
    assert.equal(fixture.today, true);
    assert.equal(fixture.priority, 1);
    assert.equal(fixture.existingLate, true);
    assert.equal(fixture.etaOverdue, false);
    assert.equal(fixture.late, true);
    assert.ok(typeof fixture.priorityLabel === "string" && fixture.priorityLabel.trim().length > 0);
    assert.notEqual(fixture.priorityLabel, "RETARD");
    assert.ok(Array.isArray(fixture.exceptionCodes));

    await waitFor(`document.querySelectorAll('[data-workshop-progress-case]').length === 2`);
    const initialCaseIds = await evaluate(`Array.from(document.querySelectorAll('[data-workshop-progress-case]')).map((el) => el.getAttribute('data-workshop-progress-case')).sort()`);
    assert.deepEqual(initialCaseIds, ["ux009-browser-appointment", "ux009-browser-received"]);

    assert.equal(await evaluate(`document.body.textContent.includes("Client reçu UX-009")`), true);
    assert.equal(await evaluate(`document.body.textContent.includes("Client RDV seul")`), true);
    const appointmentText = await evaluate(`document.querySelector('[data-workshop-progress-case="ux009-browser-appointment"]')?.textContent || ""`);
    assert.match(appointmentText, /Client RDV seul/u);
    assert.match(appointmentText, /Attendu/u);

    const getPriorityText = () => evaluate(`(() => {
      const el = document.querySelector('[data-workshop-progress-case="ux009-browser-received"] .workshop-progress-priority')
        || document.querySelector('[data-workshop-progress-case="ux009-browser-received"] .operational-vehicle-decision strong');
      return el?.textContent?.trim() || "";
    })()`);

    assert.equal(await getPriorityText(), fixture.priorityLabel);

    await evaluate(`(() => { const select = document.getElementById("workshop-progress-filter"); select.value = "late"; select.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
    await waitFor(`document.querySelectorAll('[data-workshop-progress-case="ux009-browser-received"]').length === 1`);
    assert.equal(await evaluate(`document.querySelectorAll('[data-workshop-progress-case]').length`), 1);
    assert.equal(await evaluate(`document.getElementById("workshop-progress-filter")?.selectedOptions[0]?.textContent.trim()`), "En retard");
    assert.equal(await getPriorityText(), fixture.priorityLabel);

    await evaluate(`(() => { const input = document.getElementById("workshop-progress-search"); input.value = "aucun-resultat"; input.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
    await waitFor(`document.querySelectorAll('[data-workshop-progress-case]').length === 0`);
    await evaluate(`(() => { const input = document.getElementById("workshop-progress-search"); input.value = "UX009R"; input.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
    await waitFor(`document.querySelectorAll('[data-workshop-progress-case]').length === 1`);
    await evaluate(`(() => { const select = document.getElementById("workshop-progress-filter"); select.value = "in_progress"; select.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
    await waitFor(`document.querySelectorAll('[data-workshop-progress-case]').length === 1`);
    assert.equal(await evaluate(`document.querySelector('[data-workshop-progress-case]')?.getAttribute('data-workshop-progress-case')`), "ux009-browser-received");

    const focusStyle = await evaluate(`(() => { const row = document.querySelector('[data-workshop-progress-case="ux009-browser-received"]'); row.focus(); const style = getComputedStyle(row); return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth }; })()`);
    assert.notEqual(focusStyle.outlineStyle, "none");
    assert.ok(Number.parseFloat(focusStyle.outlineWidth) >= 3);

    await dispatchKey(send, sessionId, "Enter", "Enter");
    await waitFor(`document.getElementById("operational-case-dialog")?.open === true`);
    const dialogState = await evaluate(`(() => {
      const dialog = document.getElementById("operational-case-dialog");
      const openFullBtn = dialog?.querySelector('[data-open-full]');
      return {
        hasOpenFull: !!openFullBtn,
        activeTab: typeof activeTab !== "undefined" ? activeTab : "",
      };
    })()`);
    assert.equal(dialogState.hasOpenFull, true, "#operational-case-dialog [data-open-full] must exist");
    assert.equal(dialogState.activeTab, "today", "activeTab must remain 'today' while cockpit dialog is open");

    await evaluate(`document.querySelector('#operational-case-dialog [data-open-full]')?.click()`);
    await waitFor(`activeCaseId === "ux009-browser-received" && activeTab === "dossiers"`);

    const viewportResults = [];
    for (const viewport of viewports) {
      await send("Emulation.setDeviceMetricsOverride", { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.width <= 768 }, sessionId);
      await evaluate(`setActiveTab("today"); workshopProgressSearch = ""; workshopProgressFilter = "all"; renderTodayWorkshop(); window.dispatchEvent(new Event("resize")); true`);
      await waitFor(`document.querySelectorAll('[data-workshop-progress-case]').length === 2`);
      const dimensions = await evaluate(`(() => {
        const board = document.getElementById("workshop-progress-board").getBoundingClientRect();
        const rows = Array.from(document.querySelectorAll('[data-workshop-progress-case]')).map((row) => {
          const rect = row.getBoundingClientRect();
          return { id: row.getAttribute("data-workshop-progress-case"), left: rect.left, right: rect.right, width: rect.width };
        });
        return {
          innerWidth,
          documentWidth: document.documentElement.scrollWidth,
          bodyWidth: document.body.scrollWidth,
          boardLeft: board.left,
          boardRight: board.right,
          rows,
        };
      })()`);
      assert.ok(dimensions.documentWidth <= dimensions.innerWidth, `${viewport.width}px document overflow`);
      assert.ok(dimensions.bodyWidth <= dimensions.innerWidth, `${viewport.width}px body overflow`);
      assert.ok(dimensions.boardLeft >= 0 && dimensions.boardRight <= dimensions.innerWidth + 1, `${viewport.width}px board overflow`);
      for (const rowDim of dimensions.rows) {
        assert.ok(rowDim.left >= 0 && rowDim.right <= dimensions.innerWidth + 1, `${viewport.width}px row ${rowDim.id} overflow`);
      }
      viewportResults.push({ ...viewport, rowCount: dimensions.rows.length, overflow: false });
    }
    const errors = findings.filter((finding) => String(finding.text || "").trim());
    const authNoise = errors.filter((finding) => /Failed to load resource: the server responded with a status of 401/iu.test(finding.text));
    const ux009Errors = errors.filter((finding) => !authNoise.includes(finding));
    assert.deepEqual(ux009Errors, []);
    return {
      receptionRows: "PASS",
      expectedVehicleVisible: "PASS",
      workshopPriorityMatch: "PASS",
      lateFilter: "PASS",
      search: "PASS",
      inProgressFilter: "PASS",
      focusVisible: "PASS",
      operationalCockpitOpen: "PASS",
      fullDossierOpen: "PASS",
      viewportResults,
      consoleErrorsCausedByUx009: 0,
      ignoredFixtureAuth401: authNoise.length,
    };
  });
}

if (browserSmokeRequested && failures.length === 0) {
  try {
    const result = await runBrowserSmoke();
    console.log("\nUX-009 BROWSER/RESPONSIVE SMOKE: PASS");
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(`\nUX-009 BROWSER/RESPONSIVE SMOKE: FAIL\n${error.stack || error.message}`);
    process.exitCode = 1;
  }
}
