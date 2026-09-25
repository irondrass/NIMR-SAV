import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const uiCases = fs.readFileSync(path.join(root, "js/ui-cases.js"), "utf8");
const uiPlanning = fs.readFileSync(path.join(root, "js/ui-planning.js"), "utf8");
const version = fs.readFileSync(path.join(root, "js/version.js"), "utf8");
const state = fs.readFileSync(path.join(root, "js/state.js"), "utf8");
const planning = fs.readFileSync(path.join(root, "js/planning.js"), "utf8");
const businessRules = fs.readFileSync(path.join(root, "js/business-rules-v2187.js"), "utf8");
test("1 canonical operation title is primary in case cockpit", () => { assert.match(uiCases, /title:\s*getPlanningOperationTitle\(primaryBooking \|\| displayBooking\)/u); assert.match(uiCases, /operation-primary/u); });
test("2 phase remains secondary metadata", () => assert.match(uiCases, /operation-phase/u));
test("3 canonical provenance fields are consumed", () => { for (const key of ["sourceClaimIds","sourceLineIds","sourceOperations","sourceLaborHours","sourceKind","taskModelVersion"]) assert.match(uiCases, new RegExp(key)); });
test("4 nonexistent claim ids are not invented", () => assert.match(uiCases, /\.map\(\(id\) => claimMap\.get\(id\)\)\s*\.filter\(Boolean\)/u));
test("5 provenance output is escaped", () => assert.match(uiCases, /chunks\.map\(\(chunk\) => escapeHtml\(chunk\)\)/u));
test("6 business task families drive cockpit rows", () => assert.match(uiCases, /getCaseBusinessTaskRows\(item, \{ bookings \}\)/u));
test("7 action targets real booking id", () => assert.match(uiCases, /id:\s*actionBooking\?\.id/u));
test("8 no duplicate business grouping implementation", () => assert.doesNotMatch(uiCases, /function\s+getCaseBusinessTaskRows\s*\(/u));
test("9 completed family maps completed", () => assert.match(uiCases, /completed \? "completed" : getBookingOperationalStatus/u));
test("10 paused family exposes reprise", () => assert.match(uiCases, /En pause · Reprise planifiée/u));
test("11 dependency context is visible", () => assert.match(uiCases, /getBusinessTaskDependencyLabel/u));
test("12 dependency helper is read-only", () => { const b=uiCases.slice(uiCases.indexOf("function getBusinessTaskDependencyLabel"),uiCases.indexOf("function getValidatedAppointmentRows")); assert.doesNotMatch(b,/\bstate\s*=|saveState\(/u); });
test("13 legacy fallback remains phase-first", () => assert.match(uiCases, /return phase \|\| rawTitle \|\| "Étape planning"/u));
test("13b legacy_unknown never activates operation-centric display", () => {
  assert.match(uiCases, /sourceKind && sourceKind !== "legacy_unknown"/u);
  assert.match(uiPlanning, /sourceKind && sourceKind !== "legacy_unknown"/u);
});
test("14 Gantt uses operation-first identity", () => { assert.match(uiPlanning,/const stage = identity\.operation/u); assert.match(uiPlanning,/<strong>\$\{escapeHtml\(stage\)\}<\/strong>/u); });
test("15 legacy Gantt keeps safe fallback", () => assert.match(uiPlanning,/operation: canonical && normalizedTitle \? normalizedTitle : \(phase \|\| rawTitle \|\| "Étape planning"\)/u));
test("16 mobile planning uses operation title", () => assert.match(uiPlanning,/mobile-planning-title[\s\S]*escapeHtml\(stage\)/u));
test("17 daily labor deduplicates business task", () => { assert.match(uiPlanning,/seenBusinessTasks/u); assert.match(uiPlanning,/getPlanningBusinessDisplayKey/u); });
test("18 daily labor names actual operation", () => {
  assert.match(uiPlanning, /rows\.map\(\(\{\s*booking,\s*caseItem,\s*ops,\s*identity,\s*taskNumber\s*\}\)\s*=>/u);
  assert.match(uiPlanning, /\$\{taskNumber \? `\$\{escapeHtml\(String\(taskNumber\)\)\}\. ` : ""\}\$\{escapeHtml\(identity\.operation\)\}/u);
});
test("19 cockpit does not persist planningTasks", () => { const b=uiCases.slice(uiCases.indexOf("// WORKSHOP-001D"),uiCases.indexOf("function formatBookingDateRange")); assert.doesNotMatch(b,/planningTasks\s*=|saveState\(/u); });
test("20 no scheduling/DAG duplicated in UI", () => { const a=uiCases.slice(uiCases.indexOf("// WORKSHOP-001D"),uiCases.indexOf("function formatBookingDateRange")); const b=uiPlanning.slice(uiPlanning.indexOf("// WORKSHOP-001D"),uiPlanning.indexOf("function getBookingLaborOperations")); assert.doesNotMatch(a+b,/scheduleTaskGraph|findEarliestSlot|deriveCanonicalPlanningTasks|dependencies\.push/u); });
test("21 hostile text uses escaping paths", () => { assert.match(uiCases,/escapeHtml\(row\.title\)/u); assert.match(uiPlanning,/escapeHtml\(stage\)/u); assert.match(uiPlanning,/escapeAttr\(bookingTitle\)/u); });
test("22 deterministic ordering remains", () => assert.match(uiCases,/\.sort\(\(a, b\) => new Date\(a\.start\) - new Date\(b\.start\)\)/u));
test("23 planner and business-rule operation-centric invariants remain authoritative", () => {
  const caseRowsStart = planning.indexOf("function getCaseBusinessTaskRows(");
  const caseRowsEnd = planning.indexOf("function getTechnicianTaskRows(", caseRowsStart);
  assert.ok(caseRowsStart >= 0 && caseRowsEnd > caseRowsStart, "getCaseBusinessTaskRows source block is available");
  const caseRows = planning.slice(caseRowsStart, caseRowsEnd);

  assert.match(caseRows, /actionBookingId:\s*actionBooking\.id/u);
  assert.match(caseRows, /displayBooking,\s*\n\s*actionBooking,/u);
  assert.match(caseRows, /pauseRemainder:\s*visible\.pauseRemainder/u);
  assert.match(caseRows, /plannedMinutes:\s*getBookingEffectivePlanningMinutes\(displayBooking,\s*item\)/u);
  assert.match(caseRows, /\.sort\(\(a,\s*b\)\s*=>\s*new Date\(a\.start\)\s*-\s*new Date\(b\.start\)\)/u);

  const canonicalStart = businessRules.indexOf("function deriveCanonicalPlanningTasks(");
  assert.ok(canonicalStart >= 0, "deriveCanonicalPlanningTasks source block is available");

  const canonicalTail = businessRules.slice(canonicalStart);
  const nextCanonicalFunction = canonicalTail.slice(1).search(/\n  function\s+[A-Za-z_$][\w$]*\s*\(/u);
  const canonicalTasks = nextCanonicalFunction >= 0
    ? canonicalTail.slice(0, nextCanonicalFunction + 1)
    : canonicalTail;

  assert.match(canonicalTasks, /sourceKind:\s*['"]estimate_provenance['"]/u);
  assert.match(canonicalTasks, /dependencies:\s*\[\]/u);

  const taskModelVersions = [
    ...canonicalTasks.matchAll(/taskModelVersion:\s*(\d+)/gu),
  ].map((match) => Number(match[1]));

  assert.ok(taskModelVersions.length > 0, "canonical tasks declare taskModelVersion");
  assert.ok(
    taskModelVersions.every((versionNumber) => versionNumber === 1),
    "every canonical planning task path uses taskModelVersion 1",
  );

  const operationCentricStart = uiCases.indexOf("function isOperationCentricBooking(");
  const operationCentricEnd = uiCases.indexOf("function getPlanningOperationTitle(", operationCentricStart);
  assert.ok(
    operationCentricStart >= 0 && operationCentricEnd > operationCentricStart,
    "isOperationCentricBooking source block is available",
  );
  const operationCentric = uiCases.slice(operationCentricStart, operationCentricEnd);

  assert.match(operationCentric, /Number\(booking\.taskModelVersion \|\| 0\) > 0/u);
  assert.match(operationCentric, /sourceKind && sourceKind !== "legacy_unknown"/u);
});
test("24 release identity stays consistent with version.js and state.js", () => {
  const versionMatch = version.match(/^window\.APP_VERSION = "(v\d+\.\d+\.\d+)";/mu);
  assert.ok(versionMatch, "version.js defines semantic APP_VERSION");
  const currentVersion = versionMatch[1];
  const cacheName = `nimr-sav-${currentVersion}`;
  assert.match(version, new RegExp(`^window\\.NIMR_BUILD = "${currentVersion.replaceAll(".", "\\.")}";$`, "mu"));
  assert.match(version, new RegExp(`^window\\.NIMR_CACHE_NAME = "${cacheName.replaceAll(".", "\\.")}";$`, "mu"));
  assert.match(state, new RegExp(`^const APP_VERSION = "${currentVersion.replaceAll(".", "\\.")}";$`, "mu"));
});
console.log("WORKSHOP-001D COCKPIT SUITE: 25 CHECKS DECLARED");
