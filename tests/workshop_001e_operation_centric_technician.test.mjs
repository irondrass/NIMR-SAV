import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const uiCases = fs.readFileSync(path.join(root, "js/ui-cases.js"), "utf8");
const planning = fs.readFileSync(path.join(root, "js/planning.js"), "utf8");
const state = fs.readFileSync(path.join(root, "js/state.js"), "utf8");
const businessRules = fs.readFileSync(path.join(root, "js/business-rules-v2187.js"), "utf8");
const uiPlanning = fs.readFileSync(path.join(root, "js/ui-planning.js"), "utf8");
const version = fs.readFileSync(path.join(root, "js/version.js"), "utf8");
const sw = fs.readFileSync(path.join(root, "sw.js"), "utf8");
const mobileHarness = fs.readFileSync(path.join(root, "tests/helpers/mobile_browser_harness.mjs"), "utf8");
const mobileFlow = fs.readFileSync(path.join(root, "tests/technician_mobile_field_flow.test.mjs"), "utf8");
const BASE = "32a80f278e5f3810e10275969d48134ccedbf57b";

function unchanged(rel) {
  try {
    execFileSync("git", ["diff", "--quiet", BASE, "--", rel], { cwd: root });
    return true;
  } catch {
    return false;
  }
}

test("1 current technician focus is operation-first", () => {
  assert.match(uiCases, /const operationTitle = getPlanningOperationTitle\(booking\)/u);
  assert.match(uiCases, /<h2>\$\{escapeHtml\(operationTitle\)\}<\/h2>/u);
  assert.match(uiCases, /Opération actuelle/u);
});

test("2 current technician phase stays secondary", () => {
  assert.match(uiCases, /canonicalOperation && phaseLabel !== operationTitle/u);
  assert.match(uiCases, /Phase · \$\{escapeHtml\(phaseLabel\)\}/u);
});

test("3 next technician task is operation-first", () => {
  assert.match(uiCases, /const nextOperationTitle = nextBooking \? getPlanningOperationTitle\(nextBooking\)/u);
  assert.match(uiCases, /Opération suivante/u);
  assert.match(uiCases, /<h3>\$\{escapeHtml\(nextOperationTitle\)\}<\/h3>/u);
});

test("4 next task phase stays secondary", () => {
  assert.match(uiCases, /nextCanonicalOperation && nextPhaseLabel !== nextOperationTitle/u);
});

test("5 rest-of-day card uses operation as primary identity", () => {
  assert.match(uiCases, /function renderTechnicianTaskCard/u);
  assert.match(uiCases, /<strong>\$\{escapeHtml\(operationTitle\)\}<\/strong>/u);
});

test("6 vehicle/client remain secondary technician context", () => {
  assert.match(uiCases, /\$\{escapeHtml\(item\.vehicle \|\| "Véhicule non renseigné"\)\} · \$\{escapeHtml\(item\.plate/u);
});

test("7 card phase metadata is secondary for canonical operations", () => {
  assert.match(uiCases, /<dt>\$\{canonicalOperation \? "Phase" : "Étape"\}<\/dt>/u);
  assert.match(uiCases, /canonicalOperation \? phaseLabel : operationTitle/u);
});

test("8 workshop chief summary uses operation identity", () => {
  assert.match(uiCases, /getPlanningOperationTitle\(row\.displayBooking \|\| row\.booking\)/u);
});

test("9 unassigned technician-view summary uses operation identity", () => {
  assert.match(uiCases, /unassigned\.slice\(0, 5\)\.map\(\(booking\) => escapeHtml\(getPlanningOperationTitle\(booking\)\)\)/u);
});

test("10 001E reuses exactly one 001D operation-title helper", () => {
  assert.equal((uiCases.match(/function getPlanningOperationTitle\s*\(/gu) || []).length, 1);
  assert.equal((uiCases.match(/function getPlanningPhaseLabel\s*\(/gu) || []).length, 1);
});

test("11 legacy_unknown still cannot activate operation-centric display", () => {
  assert.match(uiCases, /sourceKind && sourceKind !== "legacy_unknown"/u);
  assert.match(uiCases, /return phase \|\| rawTitle \|\| "Étape planning"/u);
});

test("12 pause/remainder grouping remains delegated to planning business-task rows", () => {
  assert.match(planning, /function getTechnicianBusinessTaskRows/u);
  assert.match(planning, /getVisibleTechnicianBookingForFamily\(family\)/u);
  assert.match(planning, /actionBookingId:\s*actionBooking\.id/u);
});

test("13 technician actions still target the real action booking", () => {
  assert.match(uiCases, /data-booking-id="\$\{escapeAttr\(row\.actionBookingId \|\| actionBooking\.id\)\}"/u);
});

test("14 technician action contract remains unchanged", () => {
  for (const action of ["start", "pause", "resume", "complete", "block", "note", "photo"]) {
    assert.match(uiCases, new RegExp(`"${action}"`, "u"));
  }
  assert.match(uiCases, /handleTechnicianTaskAction/u);
});

test("15 technician resource isolation remains enforced by current user", () => {
  assert.match(planning, /getCanonicalUserRole\(currentUser\) === "technicien"/u);
  assert.match(planning, /getTechnicianBusinessTaskRows\(currentUser\.resourceId \|\| "__invalid_resource_id__"/u);
});

test("16 001E UI changes do not persist planningTasks", () => {
  const start = uiCases.indexOf("function renderTechnicianFieldFocus");
  const end = uiCases.indexOf("const TECHNICIAN_NOTE_TEMPLATES");
  const block = uiCases.slice(start, end);
  assert.doesNotMatch(block, /planningTasks\s*=|deriveCanonicalPlanningTasks|scheduleTaskGraph/u);
});

test("17 operation and phase text remain escaped", () => {
  assert.match(uiCases, /escapeHtml\(operationTitle\)/u);
  assert.match(uiCases, /escapeHtml\(phaseLabel\)/u);
  assert.match(uiCases, /escapeHtml\(nextOperationTitle\)/u);
  assert.match(uiCases, /escapeHtml\(nextPhaseLabel\)/u);
});

test("18 protected planner/business/UI-planning baselines are unchanged during packaging", () => {
  for (const rel of [
    "js/planning.js",
    "js/business-rules-v2187.js",
    "js/ui-planning.js",
  ]) {
    assert.equal(unchanged(rel), true, rel);
  }
});

test("19 canonical state schema and task model are untouched", () => {
  assert.match(state, /const CURRENT_DATA_SCHEMA_VERSION = 2;/u);
  assert.match(state, /const CANONICAL_TASK_MODEL_VERSION = 1;/u);
  assert.ok(businessRules.length > 0);
});

test("20 packaged release identity is v23.3.28", () => {
  assert.match(version, /^window\.APP_VERSION = "v23\.3\.28";$/mu);
  assert.match(version, /^window\.NIMR_BUILD = "v23\.3\.28";$/mu);
  assert.match(version, /^window\.NIMR_CACHE_NAME = "nimr-sav-v23\.3\.28";$/mu);
  assert.match(sw, /const CACHE_NAME = "nimr-sav-v23\.3\.28";/u);
});

test("21 mobile technician fixture cannot roll the next task into tomorrow", () => {
  assert.match(mobileHarness, /dayStart\.setHours\(0, 0, 0, 0\)/u);
  assert.match(mobileHarness, /dayEnd\.setHours\(23, 59, 0, 0\)/u);
  assert.match(mobileHarness, /latestCurrentStart = dayEnd\.getTime\(\) - 140 \* 60000/u);
  assert.match(mobileHarness, /nextEnd = new Date\(currentStart\.getTime\(\) \+ 134 \* 60000\)/u);
});

test("22 mobile reload fixture uses a validated cached membership identity", () => {
  assert.match(mobileHarness, /authUserId:\s*"auth-mobile-tech"/u);
  assert.match(mobileHarness, /authSource:\s*"supabase_membership"/u);
  assert.match(mobileHarness, /membershipValidatedAt:\s*now\.toISOString\(\)/u);
  assert.match(mobileHarness, /membershipWorkshopId:\s*workshopId/u);
});

test("23 mobile reload exercises official offline identity restoration without disabling transport", () => {
  assert.match(mobileFlow, /Page\.addScriptToEvaluateOnNewDocument/u);
  assert.match(mobileFlow, /Object\.defineProperty\(Navigator\.prototype, "onLine"/u);
  assert.match(mobileFlow, /get:\s*\(\) => false/u);
  assert.doesNotMatch(mobileFlow, /Network\.emulateNetworkConditions/u);
});

console.log("WORKSHOP-001E OPERATION-CENTRIC TECHNICIAN SUITE: 23 CHECKS DECLARED");
