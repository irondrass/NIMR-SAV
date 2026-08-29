import assert from "node:assert/strict";
import fs from "node:fs";

const indexSource = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const appSource = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
const uiPlanningSource = fs.readFileSync(new URL("../js/ui-planning.js", import.meta.url), "utf8");
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

check("A UX-004 release surfaces remain internally consistent", () => {
  const versionMatch = versionSource.match(/window\.APP_VERSION = "(v[0-9.]+)";/u);
  assert.ok(versionMatch, "window.APP_VERSION must be defined");
  const currentVersion = versionMatch[1];
  const assetVersion = currentVersion.replace(/^v/u, "");
  assert.match(versionSource, new RegExp(`window\\.NIMR_BUILD = "${currentVersion}";`, "u"));
  assert.match(versionSource, new RegExp(`window\\.NIMR_CACHE_NAME = "nimr-sav-${currentVersion}";`, "u"));
  assert.match(stateSource, new RegExp(`const APP_VERSION = "${currentVersion}";`, "u"));
  assert.match(appSource, new RegExp(`pdf\\.worker\\.min\\.js\\?v=${assetVersion.replaceAll(".", "\\.")}`, "u"));
  assert.match(swSource, new RegExp(`const CACHE_NAME = "nimr-sav-${currentVersion}";`, "u"));
  assert.match(indexSource, new RegExp(`styles\\.css\\?v=${assetVersion.replaceAll(".", "\\.")}`, "u"));
  assert.match(indexSource, new RegExp(`app\\.js\\?v=${assetVersion.replaceAll(".", "\\.")}`, "u"));
  assert.match(offlineSource, new RegExp(`styles\\.css\\?v=${assetVersion.replaceAll(".", "\\.")}`, "u"));
});

check("B Existing Planning IDs remain intact", () => {
  assert.match(indexSource, /id="planning-day-label"/u);
  assert.match(indexSource, /id="print-day-gantt"/u);
  assert.match(indexSource, /id="print-day-planning"/u);
  assert.match(indexSource, /id="prev-day"/u);
  assert.match(indexSource, /id="today-button"/u);
  assert.match(indexSource, /id="next-day"/u);
  assert.match(indexSource, /id="day-alert"/u);
  assert.match(indexSource, /id="gantt"/u);
  assert.match(indexSource, /id="mobile-planning-list"/u);
  assert.match(indexSource, /id="daily-labor-summary"/u);
});

check("C Direct #planning-date input exists and updates state.planningDate via standard save/render flow", () => {
  assert.match(indexSource, /<input id="planning-date" type="date" aria-label="Date du planning" \/>/u);
  assert.match(appSource, /const dateInput = \$\("#planning-date"\);/u);
  assert.match(appSource, /state\.planningDate = val;/u);
  assert.match(uiPlanningSource, /const dateInput = \$\("#planning-date"\);/u);
  assert.match(uiPlanningSource, /dateInput\.value = state\.planningDate;/u);
});

check("D Print controls remain intact but are grouped inside native planning print disclosure", () => {
  assert.match(indexSource, /<details class="planning-print-details" id="planning-print-details">/u);
  assert.match(indexSource, /<summary class="planning-print-summary">Imprimer<\/summary>/u);
  assert.match(indexSource, /class="planning-print-panel"[\s\S]*id="print-day-gantt"[\s\S]*id="print-day-planning"/u);
});

check("E Planning search, resource filter, badge, and reset controls exist", () => {
  assert.match(indexSource, /id="planning-search"/u);
  assert.match(indexSource, /id="planning-resource-filter"/u);
  assert.match(indexSource, /id="planning-filter-badge"/u);
  assert.match(indexSource, /id="planning-filters-reset"/u);
  assert.match(appSource, /function resetPlanningDisplayFilters\(\)/u);
});

check("F Planning search reuses caseMatchesGlobalSearch and does not duplicate search logic", () => {
  assert.match(uiPlanningSource, /function planningCaseMatchesDisplaySearch\(caseItem, search\)/u);
  assert.match(uiPlanningSource, /caseMatchesGlobalSearch\(caseItem, search\)/u);

  const fnMatch = uiPlanningSource.match(/function planningCaseMatchesDisplaySearch\(caseItem, search\)\s*\{[\s\S]*?\n\}/u);
  assert.ok(fnMatch, "planningCaseMatchesDisplaySearch function block must be found");
  const fnBlock = fnMatch[0];

  assert.doesNotMatch(fnBlock, /caseItem\.clientName/u);
  assert.doesNotMatch(fnBlock, /caseItem\.plate/u);
  assert.doesNotMatch(fnBlock, /caseItem\.vin/u);
  assert.doesNotMatch(fnBlock, /caseItem\.orNavNumber/u);
  assert.doesNotMatch(fnBlock, /caseItem\.phone/u);
  assert.doesNotMatch(fnBlock, /toLowerCase\(\)/u);
  assert.doesNotMatch(fnBlock, /\.includes\(/u);
});

check("G Resource filtering operates on orderPlanningResources for DISPLAY only", () => {
  assert.match(uiPlanningSource, /function getPlanningDisplayFilters/u);
  assert.match(uiPlanningSource, /function filterPlanningDisplayResources/u);
  assert.match(uiPlanningSource, /const allResources = orderPlanningResources\(state\.resources\.filter\(isDisplayPlanningResource\)\);/u);
  assert.match(uiPlanningSource, /const visibleResources = filterPlanningDisplayResources\(allResources, filters\);/u);
});

check("H Task numbering is built from ALL resources rather than filtered resources", () => {
  assert.match(uiPlanningSource, /const taskNumberMap = buildDailyPlanningTaskNumberMap\(date, allResources\);/u);
  assert.doesNotMatch(uiPlanningSource, /buildDailyPlanningTaskNumberMap\(date, visibleResources\)/u);
});

check("I Gantt, mobile planning list and daily labor summary receive/use the same display filter context", () => {
  assert.match(uiPlanningSource, /renderResourceBookings\(resource, date, dayStart, dayEnd, total, dailyColorMap, taskNumberMap, filters\)/u);
  assert.match(uiPlanningSource, /renderDailyLaborSummary\(date, taskNumberMap, filters\)/u);
  assert.match(uiPlanningSource, /renderMobilePlanningList\(date, visibleResources, taskNumberMap, filters\)/u);
});

check("J Schema and persistence contracts remain intact", () => {
  assert.match(stateSource, /const DB_VERSION = 2;/u);
  assert.match(stateSource, /const CURRENT_DATA_SCHEMA_VERSION = 2;/u);
  assert.match(stateSource, /const CANONICAL_TASK_MODEL_VERSION = 1;/u);
  assert.match(schemaSource, /create table if not exists public\.workshops/iu);
});

assert.equal(results.length, 10, "All 10 UX-004 checks must pass");
console.log(`UX-004 planning toolbar & filters gate: ${results.length}/10 PASS`);
