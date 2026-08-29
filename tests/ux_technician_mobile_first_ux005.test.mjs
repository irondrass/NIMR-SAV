import assert from "node:assert/strict";
import fs from "node:fs";

const indexSource = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const appSource = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
const uiCasesSource = fs.readFileSync(new URL("../js/ui-cases.js", import.meta.url), "utf8");
const styleSource = fs.readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const swSource = fs.readFileSync(new URL("../sw.js", import.meta.url), "utf8");
const offlineSource = fs.readFileSync(new URL("../offline.html", import.meta.url), "utf8");
const versionSource = fs.readFileSync(new URL("../js/version.js", import.meta.url), "utf8");
const stateSource = fs.readFileSync(new URL("../js/state.js", import.meta.url), "utf8");
const schemaSource = fs.readFileSync(new URL("../supabase-schema.sql", import.meta.url), "utf8");

const results = [];

function check(name, callback) {
  callback();
  results.push(name);
  console.log(`PASS ${name}`);
}

check("A Release surfaces consistently identify v23.3.12", () => {
  assert.match(versionSource, /window\.APP_VERSION = "v23\.3\.12";/u);
  assert.match(versionSource, /window\.NIMR_BUILD = "v23\.3\.12";/u);
  assert.match(versionSource, /window\.NIMR_CACHE_NAME = "nimr-sav-v23\.3\.12";/u);
  assert.match(stateSource, /const APP_VERSION = "v23\.3\.12";/u);
  assert.match(appSource, /pdf\.worker\.min\.js\?v=23\.3\.12/u);
  assert.match(swSource, /const CACHE_NAME = "nimr-sav-v23\.3\.12";/u);
  assert.match(indexSource, /styles\.css\?v=23\.3\.12/u);
  assert.match(indexSource, /app\.js\?v=23\.3\.12/u);
  assert.match(offlineSource, /styles\.css\?v=23\.3\.12/u);
});

check("B Existing technician structural contracts remain intact", () => {
  assert.match(indexSource, /id="view-technician"/u);
  assert.match(indexSource, /id="technician-select"/u);
  assert.match(indexSource, /id="technician-date"/u);
  assert.match(indexSource, /id="technician-task-list"/u);
  assert.match(indexSource, /id="technician-manager-board"/u);
  assert.match(indexSource, /id="technician-field-action-dock"/u);
  assert.match(indexSource, /id="technician-field-focus"/u);
});

check("C Current and next task architecture in fieldFocus before rest of day", () => {
  assert.match(uiCasesSource, /const currentRow = orderedRows\.find/u);
  assert.match(uiCasesSource, /const nextRow = orderedRows\.find/u);
  assert.match(uiCasesSource, /const remainingRows = orderedRows\.filter\(/u);
  assert.match(uiCasesSource, /row !== currentRow && row !== nextRow/u);
  assert.match(uiCasesSource, /fieldFocus\.innerHTML = renderTechnicianFieldFocus\(currentRow/u);
  assert.match(uiCasesSource, /data-technician-current-task/u);
  assert.match(uiCasesSource, /data-technician-next-task/u);
  assert.match(uiCasesSource, /data-technician-elapsed-booking=/u);
  assert.match(uiCasesSource, /data-current-booking-id=/u);
  assert.match(uiCasesSource, /data-technician-sync-state/u);
});

check("D Rest of day progressively disclosed in native details and does not duplicate current or next", () => {
  assert.doesNotMatch(uiCasesSource, /orderedRows\.map\(\s*\(row\)\s*=>\s*renderTechnicianTaskCard/u);
  assert.match(uiCasesSource, /<details class="technician-rest-of-day">/u);
  assert.match(uiCasesSource, /<summary>/u);
  assert.match(uiCasesSource, /Autres tâches du jour/u);
  assert.match(uiCasesSource, /remainingRows\.map\(\s*\(row\)\s*=>\s*renderTechnicianTaskCard\(row\)\)/u);
});

check("E Existing action contract remains intact with [data-tech-action]", () => {
  assert.match(uiCasesSource, /renderPermissionAwareButton\([^)]*"resume"/u);
  assert.match(uiCasesSource, /renderPermissionAwareButton\([^)]*"pause"/u);
  assert.match(uiCasesSource, /renderPermissionAwareButton\([^)]*"complete"/u);
  assert.match(uiCasesSource, /renderPermissionAwareButton\([^)]*"block"/u);
  assert.match(uiCasesSource, /renderPermissionAwareButton\([^)]*"note"/u);
  assert.match(uiCasesSource, /renderPermissionAwareButton\([^)]*"photo"/u);
  assert.match(uiCasesSource, /data-tech-action="print-block"/u);
  assert.match(uiCasesSource, /handleTechnicianTaskAction/u);
});

check("F Technician mobile dock remains fixed, safe-area aware and touch-accessible", () => {
  assert.match(styleSource, /\.technician-field-action-dock/u);
  assert.match(styleSource, /position:\s*fixed/u);
  assert.match(styleSource, /var\(--safe-bottom\)/u);
  assert.match(styleSource, /min-height:\s*(?:44|52|56)px/u);
});

check("G Single elapsed timer source contract", () => {
  assert.match(uiCasesSource, /function refreshTechnicianElapsedTimers\(/u);
  assert.match(uiCasesSource, /formatTechnicianElapsedTime\(/u);
  assert.match(uiCasesSource, /getTechnicianFamilyElapsedMilliseconds\(/u);
});

check("H Manager panel contract remains intact and role-isolated", () => {
  assert.match(indexSource, /class="panel technician-manager-panel"/u);
  assert.match(uiCasesSource, /managerPanel\.hidden\s*=\s*getCanonicalUserRole\(currentUser\)\s*===\s*"technicien"/u);
  assert.match(uiCasesSource, /renderWorkshopChiefSummary/u);
});

check("I Mobile-first layout and 360px responsiveness with full NOW NEXT REST CSS hierarchy", () => {
  assert.match(styleSource, /\.technician-current-task/u);
  assert.match(styleSource, /\.technician-next-task/u);
  assert.match(styleSource, /\.technician-rest-of-day/u);
  assert.match(styleSource, /\.technician-rest-of-day summary/u);
  assert.match(styleSource, /\.technician-rest-of-day-list/u);
  assert.match(styleSource, /\.technician-field-grid/u);
  assert.match(styleSource, /\.technician-live-timer/u);
  assert.match(styleSource, /font-variant-numeric:\s*tabular-nums/u);
});

check("J Business and schema safety preserved", () => {
  assert.match(stateSource, /const CURRENT_DATA_SCHEMA_VERSION = 2;/u);
  assert.match(stateSource, /const CANONICAL_TASK_MODEL_VERSION = 1;/u);
  assert.match(schemaSource, /create table if not exists public\.repair_orders/u);
});

console.log(`\nUX-005 REGRESSION SUITE: ${results.length}/10 CHECKS PASSED`);
