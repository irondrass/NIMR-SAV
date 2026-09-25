import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createNimrVmContext } from "./helpers/nimr_vm_context.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const index = read("index.html");
const ui = read("js/ui-cases.js");
const css = read("styles.css");
const version = read("js/version.js");

function sourceSlice(startMarker, endMarker) {
  const start = ui.indexOf(startMarker);
  assert.notEqual(start, -1, startMarker);
  const end = ui.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, endMarker);
  return ui.slice(start, end);
}
const live = sourceSlice("const WORKSHOP_LIVE_ACTIVE_STATUSES", "function getWorkshopProgressValidDate(");
const caseSummary = sourceSlice("function buildWorkshopLiveCaseTaskSummary(", "function buildWorkshopProgressRow(");
const progress = sourceSlice("function renderWorkshopProgressRow(", "function openWorkshopProgressCase(");

test("1 tower and vehicle progress remain inside Today without creating navigation tabs", () => {
  const today = index.indexOf('id="view-today"');
  const dossiers = index.indexOf('id="view-dossiers"', today);
  const tower = index.indexOf('id="workshop-live-technician-board"', today);
  const progressBoard = index.indexOf('id="workshop-progress-board"', today);
  assert.ok(today >= 0, "view-today must exist");
  assert.ok(dossiers > today, "view-dossiers must come after view-today");
  assert.ok(tower > today && tower < dossiers, "workshop-live-technician-board must be inside view-today");
  assert.ok(progressBoard > today && progressBoard < dossiers, "workshop-progress-board must be inside view-today");
  assert.doesNotMatch(index, /data-tab="workshop-live|data-tab="control-tower/u);
});

test("2 live technician model reuses canonical business-task rows", () => {
  assert.match(live, /getTechnicianDashboardResources\(\)/u);
  assert.match(live, /getTechnicianBusinessTaskRows\(technician\?\.id \|\| "", todayKey\(now\)\)/u);
  assert.match(live, /WORKSHOP_LIVE_ACTIVE_STATUSES/u);
});

test("3 exact current/next operation preserves 001F provenance and current terminology", () => {
  assert.match(live, /collectTechnicianExactLaborLines\(row\)/u);
  assert.match(live, /getPlanningOperationTitle\(booking\)/u);
  assert.match(live, /"Maintenant"/u);
  assert.match(live, /Ensuite · prête à démarrer/u);
  assert.match(live, /Ensuite · prévue/u);
});

test("4 live timing exposes actual start elapsed and estimated end", () => {
  assert.match(live, /getTechnicianFieldActualStart\(row\)/u);
  assert.match(live, /getTechnicianFamilyElapsedMilliseconds\(booking\.id, now\)/u);
  assert.match(live, /getTechnicianFieldEstimatedEnd\(row, now\)/u);
  assert.match(live, /Fin estimée/u);
});

test("5 vehicle summary reuses canonical case task families", () => {
  assert.match(caseSummary, /getCaseBusinessTaskRows\(item\)/u);
  assert.match(caseSummary, /currentOperation/u);
  assert.match(caseSummary, /nextOperation/u);
  assert.match(caseSummary, /remaining/u);
});

test("6 vehicle progress exposes current/next operations and estimated availability", () => {
  assert.match(progress, /tower\.currentOperation/u);
  assert.match(progress, /tower\.nextOperation/u);
  assert.match(progress, /Maintenant/u);
  assert.match(progress, /Ensuite/u);
  assert.match(progress, /Disponibilité estimée/u);
  assert.match(progress, /row\.eta/u);
});

test("7 001G is read-only and refreshes only on Today", () => {
  assert.match(live, /activeTab !== "today"/u);
  assert.match(live, /30000/u);
  assert.doesNotMatch(live + caseSummary, /\bsaveState\s*\(/u);
  assert.doesNotMatch(live + caseSummary, /\bscheduleTaskGraph\s*\(/u);
  assert.doesNotMatch(live + caseSummary, /\bapplyDependentBookingReschedule\s*\(/u);
});

test("8 packaged release identity remains atomically synchronized", () => {
  const versionMatch = version.match(/^window\.APP_VERSION = "(v\d+\.\d+\.\d+)";$/mu);
  assert.ok(versionMatch, "window.APP_VERSION must be defined in js/version.js");
  const currentVersion = versionMatch[1];

  assert.match(version, new RegExp(`^window\\.APP_VERSION = "${currentVersion}";$`, "mu"));
  assert.match(version, new RegExp(`^window\\.NIMR_BUILD = "${currentVersion}";$`, "mu"));
  assert.match(version, new RegExp(`^window\\.NIMR_CACHE_NAME = "nimr-sav-${currentVersion}";$`, "mu"));

  const stateSource = read("js/state.js");
  assert.match(stateSource, new RegExp(`const APP_VERSION = "${currentVersion}";`, "u"));

  const swSource = read("sw.js");
  assert.match(swSource, new RegExp(`const CACHE_NAME = "nimr-sav-${currentVersion}";`, "u"));
});

test("9 original WORKSHOP-001G commit is confined to presentation surfaces and leaves authority untouched", () => {
  const commitSha = "b08f8c7542d083a033a5bc666417630614367439";
  const output = execFileSync("git", ["diff-tree", "--no-commit-id", "--name-only", "-r", commitSha], {
    cwd: ROOT,
    encoding: "utf8",
  });
  const modifiedFiles = output.trim().split(/\r?\n/).filter(Boolean).sort();
  const expectedSurfaces = [
    "index.html",
    "js/ui-cases.js",
    "styles.css",
    "tests/workshop_001g_live_control_tower.test.mjs",
  ].sort();
  assert.deepEqual(modifiedFiles, expectedSurfaces, "WORKSHOP-001G commit must touch only presentation surfaces");

  const protectedAuthorities = [
    "js/planning.js",
    "js/business-rules-v2187.js",
    "js/supabase-client.js",
    "js/supabase-config.js",
    "js/supabase-sync.js",
  ];
  for (const authority of protectedAuthorities) {
    assert.ok(!modifiedFiles.includes(authority), `${authority} must not be modified by WORKSHOP-001G commit`);
  }
});

test("10 responsive control-tower styles are dedicated", () => {
  assert.match(css, /WORKSHOP-001G — live workshop control tower/u);
  assert.match(css, /\.workshop-live-technician-grid/u);
  assert.match(css, /@media \(max-width: 820px\)/u);
  assert.match(css, /@media \(max-width: 520px\)/u);
});

test("11 behavior: technician A current/next and technician B available", () => {
  const { context, run } = createNimrVmContext({ filename: "workshop-001g-technicians.js" });
  run('state = normalizeState({ cases: [{ id: "case-a", clientName: "Client A", vehicle: "DFSK E5", plate: "111 TUN 2222", flags: { received: true, workStarted: true }, receptionWorkflow: { vehicleReceivedAt: "2026-09-05T07:30:00.000Z" } }], resources: [{ id: "tech-a", name: "Technicien A", role: "mecanicien", active: true }, { id: "tech-b", name: "Technicien B", role: "electricien", active: true }], bookings: [{ id: "current", businessTaskId: "task-current", taskModelVersion: 1, sourceKind: "manual", sourceOperations: ["Dépose alternateur"], caseId: "case-a", type: "work", status: "started", title: "Mécanique", key: "mechanical", resourceIds: ["tech-a"], primaryResourceId: "tech-a", actualStart: "2026-09-05T08:00:00.000Z", startedAt: "2026-09-05T08:00:00.000Z", start: "2026-09-05T08:00:00.000Z", end: "2026-09-05T10:00:00.000Z", plannedMinutes: 120, segments: [{ start: "2026-09-05T08:00:00.000Z", end: "2026-09-05T10:00:00.000Z" }] }, { id: "next", businessTaskId: "task-next", taskModelVersion: 1, sourceKind: "manual", sourceOperations: ["Contrôle circuit de charge"], caseId: "case-a", type: "work", status: "planned", title: "Contrôle", key: "electrical", resourceIds: ["tech-a"], primaryResourceId: "tech-a", start: "2026-09-05T10:00:00.000Z", end: "2026-09-05T11:00:00.000Z", plannedMinutes: 60, segments: [{ start: "2026-09-05T10:00:00.000Z", end: "2026-09-05T11:00:00.000Z" }] }] }); if (typeof invalidateUiRuntimeIndexes === "function") invalidateUiRuntimeIndexes();');
  const before = run("JSON.stringify(state)");
  const model = context.buildWorkshopLiveControlTowerModel(new Date("2026-09-05T09:00:00.000Z"));
  const a = model.technicians.find((row) => row.technician.id === "tech-a");
  const b = model.technicians.find((row) => row.technician.id === "tech-b");
  assert.equal(a.status, "in_progress");
  assert.equal(a.currentOperation, "Dépose alternateur");
  assert.equal(a.nextOperation, "Contrôle circuit de charge");
  assert.equal(a.timing.actualStart.toISOString(), "2026-09-05T08:00:00.000Z");
  assert.equal(a.timing.estimatedEnd.toISOString(), "2026-09-05T10:00:00.000Z");
  assert.equal(b.status, "available");
  assert.equal(run("JSON.stringify(state)"), before);
});

test("12 behavior: vehicle summary returns canonical counts/current/next", () => {
  const { context, run } = createNimrVmContext({ filename: "workshop-001g-vehicle.js" });
  run('state = normalizeState({ cases: [{ id: "case-b", clientName: "Client B", vehicle: "DongFeng Shine", plate: "333 TUN 4444", flags: { received: true, workStarted: true }, receptionWorkflow: { vehicleReceivedAt: "2026-09-05T07:00:00.000Z" } }], resources: [{ id: "tech", name: "Tech B", role: "electricien", active: true }], bookings: [{ id: "done", businessTaskId: "task-done", taskModelVersion: 1, sourceKind: "manual", sourceOperations: ["Diagnostic initial"], caseId: "case-b", type: "work", status: "completed", resourceIds: ["tech"], primaryResourceId: "tech", start: "2026-09-05T07:00:00.000Z", end: "2026-09-05T08:00:00.000Z", actualStart: "2026-09-05T07:00:00.000Z", actualEnd: "2026-09-05T08:00:00.000Z", segments: [{ start: "2026-09-05T07:00:00.000Z", end: "2026-09-05T08:00:00.000Z" }] }, { id: "active", businessTaskId: "task-active", taskModelVersion: 1, sourceKind: "manual", sourceOperations: ["Remplacement capteur"], caseId: "case-b", type: "work", status: "started", resourceIds: ["tech"], primaryResourceId: "tech", start: "2026-09-05T08:00:00.000Z", end: "2026-09-05T09:30:00.000Z", actualStart: "2026-09-05T08:00:00.000Z", startedAt: "2026-09-05T08:00:00.000Z", plannedMinutes: 90, segments: [{ start: "2026-09-05T08:00:00.000Z", end: "2026-09-05T09:30:00.000Z" }] }, { id: "next", businessTaskId: "task-next", taskModelVersion: 1, sourceKind: "manual", sourceOperations: ["Essai final"], caseId: "case-b", type: "work", status: "planned", resourceIds: ["tech"], primaryResourceId: "tech", start: "2026-09-05T09:30:00.000Z", end: "2026-09-05T10:00:00.000Z", plannedMinutes: 30, segments: [{ start: "2026-09-05T09:30:00.000Z", end: "2026-09-05T10:00:00.000Z" }] }] }); if (typeof invalidateUiRuntimeIndexes === "function") invalidateUiRuntimeIndexes();');
  const item = run("state.cases[0]");
  const step = context.getWorkshopProgressCurrentStep(item, new Date("2026-09-05T08:30:00.000Z"));
  const summary = context.buildWorkshopLiveCaseTaskSummary(item, new Date("2026-09-05T08:30:00.000Z"), step);
  assert.equal(summary.total, 3);
  assert.equal(summary.done, 1);
  assert.equal(summary.active, 1);
  assert.equal(summary.remaining, 2);
  assert.equal(summary.currentOperation, "Remplacement capteur");
  assert.equal(summary.nextOperation, "Essai final");
  assert.equal(summary.currentTechnician, "Tech B");
  assert.equal(summary.nextTechnician, "Tech B");
});

test("13 planned/ready work is next work and is never mislabeled as active", () => {
  const { context, run } = createNimrVmContext({ filename: "workshop-001g-ready-is-next.js" });
  run('state = normalizeState({ cases: [{ id: "case-c", clientName: "Client C", vehicle: "DFSK", plate: "555 TUN 6666", flags: { received: true, workStarted: false }, receptionWorkflow: { vehicleReceivedAt: "2026-09-05T07:00:00.000Z" } }], resources: [{ id: "tech", name: "Tech C", role: "mecanicien", active: true }], bookings: [{ id: "ready", businessTaskId: "task-ready", taskModelVersion: 1, sourceKind: "manual", sourceOperations: ["Vidange moteur"], caseId: "case-c", type: "work", status: "planned", resourceIds: ["tech"], primaryResourceId: "tech", start: "2026-09-05T09:00:00.000Z", end: "2026-09-05T10:00:00.000Z", plannedMinutes: 60, segments: [{ start: "2026-09-05T09:00:00.000Z", end: "2026-09-05T10:00:00.000Z" }] }] }); if (typeof invalidateUiRuntimeIndexes === "function") invalidateUiRuntimeIndexes();');
  const item = run("state.cases[0]");
  const step = context.getWorkshopProgressCurrentStep(item, new Date("2026-09-05T08:30:00.000Z"));
  const summary = context.buildWorkshopLiveCaseTaskSummary(item, new Date("2026-09-05T08:30:00.000Z"), step);
  assert.equal(summary.active, 0);
  assert.equal(summary.current, null);
  assert.equal(summary.currentOperation, "");
  assert.equal(summary.nextOperation, "Vidange moteur");
  assert.equal(summary.nextTechnician, "Tech C");
});

console.log("WORKSHOP-001G LIVE CONTROL TOWER SUITE: 13 CHECKS DECLARED");
