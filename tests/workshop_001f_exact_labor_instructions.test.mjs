import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const ui = read("js/ui-cases.js");
const css = read("styles.css");
const version = read("js/version.js");

function between(startMarker, endMarker) {
  const start = ui.indexOf(startMarker);
  assert.notEqual(start, -1, startMarker + " must exist");
  const end = ui.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, endMarker + " must exist after " + startMarker);
  return ui.slice(start, end);
}

const collector = between(
  "function collectTechnicianExactLaborLines(",
  "function renderTechnicianExactLaborInstruction("
);
const renderer = between(
  "function renderTechnicianExactLaborInstruction(",
  "function buildBusinessTaskDependencyIndex("
);
const fieldFocus = between(
  "function renderTechnicianFieldFocus(",
  "function renderTechnicianDashboard("
);
const dashboard = between(
  "function renderTechnicianDashboard(",
  "function renderTechnicianTaskCard("
);
const taskCard = between(
  "function renderTechnicianTaskCard(",
  "function renderTechnicianTaskActions("
);
const taskActions = between(
  "function renderTechnicianTaskActions(",
  "function renderPermissionAwareButton("
);

console.log("WORKSHOP-001F EXACT LABOR INSTRUCTIONS SUITE");

test("1 exact labor collector resolves canonical sourceLineIds", () => {
  assert.match(collector, /sourceLineIds/);
  assert.match(collector, /estimate\?\.originalLines/);
  assert.match(collector, /wantedLineIds/);
});

test("2 exact collector resolves OR claim provenance", () => {
  assert.match(collector, /sourceClaimIds/);
  assert.match(collector, /claimLabel/);
  assert.match(collector, /claim\?\.number/);
});

test("3 exact collector preserves source operation text and raw source text", () => {
  assert.match(collector, /line\?\.operation/);
  assert.match(collector, /line\?\.rawText/);
  assert.match(collector, /line\?\.code/);
  assert.match(collector, /line\?\.laborHours/);
});

test("4 source-aware fallback uses canonical sourceOperations", () => {
  assert.match(collector, /provenance\.sourceOperations/);
  assert.match(collector, /provenance\.sourceKind/);
});

test("5 legacy bookings never claim exact labor provenance", () => {
  assert.match(collector, /!isOperationCentricBooking\(displayBooking\)/);
  assert.match(renderer, /!isOperationCentricBooking\(booking\)/);
});

test("6 renderer labels exact labor source and technician allocation", () => {
  assert.match(renderer, /Ligne MO exacte/);
  assert.match(renderer, /Lignes MO exactes/);
  assert.match(renderer, /Votre intervention/);
  assert.match(renderer, /Temps affecté/);
  assert.match(renderer, /MO devis/);
});

test("7 technician exact labor text is escaped", () => {
  assert.match(renderer, /escapeHtml\(title/);
  assert.match(renderer, /escapeHtml\(line\.rawText\)/);
  assert.match(renderer, /meta\.map\(\(value\) => escapeHtml\(value\)\)/);
  assert.match(renderer, /escapeHtml\(phaseLabel\)/);
});

test("8 current operation shows exact labor instruction", () => {
  assert.match(fieldFocus, /renderTechnicianExactLaborInstruction\(currentRow\)/);
  assert.match(fieldFocus, /\$\{currentLaborInstruction\}/);
});

test("9 next operation shows exact labor instruction", () => {
  assert.match(fieldFocus, /renderTechnicianExactLaborInstruction\(nextRow, \{ compact: true \}\)/);
  assert.match(fieldFocus, /\$\{nextLaborInstruction\}/);
});

test("10 rest-of-day technician cards show exact labor instruction", () => {
  assert.match(taskCard, /renderTechnicianExactLaborInstruction\(row\)/);
  assert.match(taskCard, /\$\{exactLaborInstruction\}/);
});

test("11 action booking contract remains untouched", () => {
  assert.match(taskActions, /row\.actionBookingId \|\| actionBooking\.id/);
  assert.match(taskActions, /data-tech-action/);
});

test("12 technician resource isolation path remains role-bound", () => {
  assert.match(dashboard, /getCanonicalUserRole\(currentUser\) === "technicien"/);
  assert.match(dashboard, /currentUser\.resourceId/);
});

test("13 exact labor UI has dedicated responsive styles", () => {
  assert.match(css, /WORKSHOP-001F exact labor instructions/);
  assert.match(css, /\.technician-labor-instruction/);
  assert.match(css, /\.technician-labor-source-line/);
  assert.match(css, /@media \(max-width: 768px\)/);
});

test("14 packaged release identity is v23.3.30", () => {
  assert.match(version, /APP_VERSION\s*=\s*"v23\.3\.30"/);
  assert.match(version, /NIMR_BUILD\s*=\s*"v23\.3\.30"/);
});

test("15 no diagnostic duration or complaint workflow is introduced in 001F", () => {
  assert.doesNotMatch(collector + renderer, /DIAG-30|DIAG-60|DIAG-90|customerConcern|diagnosticEnvelope/);
});

test("16 canonical marker without source provenance never inherits every estimate line", () => {
  assert.match(collector, /if \(!wantedLineIds\.size && !sourceOperations\.length\) return \[\];/);
  assert.match(collector, /if \(wantedLineIds\.size\) \{/);
  assert.match(collector, /if \(!wantedLineIds\.has\(lineId\)\) return;/);
});

test("17 fallback exact labor text comes only from sourceOperations", () => {
  assert.match(collector, /return sourceOperations/);
  assert.doesNotMatch(collector, /if \(wantedLineIds\.size && !wantedLineIds\.has\(lineId\)\)/);
});
