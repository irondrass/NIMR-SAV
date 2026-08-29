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

check("A UX-003 release surfaces remain internally consistent", () => {
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

check("B Search remains primary and keeps #case-search with accessible attributes and placeholder", () => {
  assert.match(indexSource, /<input id="case-search" type="search" placeholder="Client, immat\., VIN, OR, téléphone…" aria-label="Rechercher un dossier"/u);
  assert.match(styleSource, /\.case-search-primary #case-search/u);
});

check("C Existing status, type, sort and case action IDs remain intact", () => {
  assert.match(indexSource, /id="case-search"/u);
  assert.match(indexSource, /id="case-status-filter"/u);
  assert.match(indexSource, /id="case-type-filter"/u);
  assert.match(indexSource, /id="case-sort"/u);
  assert.match(indexSource, /id="case-list"/u);
  assert.match(indexSource, /id="case-count"/u);
  assert.match(indexSource, /id="open-pdf-import-from-dossiers"/u);
});

check("D Type and sort are grouped inside secondary filter details disclosure", () => {
  assert.match(indexSource, /<details class="case-filter-details" id="case-filter-details">/u);
  assert.match(indexSource, /<summary class="case-filter-summary">[\s\S]*<span>Filtres et tri<\/span>[\s\S]*<span class="case-filter-badge" id="case-filter-badge" hidden><\/span>/u);
  assert.match(indexSource, /class="case-filter-panel"[\s\S]*id="case-type-filter"[\s\S]*id="case-sort"/u);
});

check("E Reset-filter control exists and resets UI filter state cleanly", () => {
  assert.match(indexSource, /id="case-filters-reset">Réinitialiser les filtres<\/button>/u);
  assert.match(appSource, /function resetDossierFilters\(\)/u);
  assert.match(appSource, /state\.ui\.caseStatusFilter = "all"/u);
  assert.match(appSource, /state\.ui\.caseTypeFilter = "all"/u);
  assert.match(appSource, /state\.ui\.caseSort = "recent"/u);
});

check("F renderCases retains canonical matching and sorting functions", () => {
  assert.match(uiCasesSource, /const matchesText = caseMatchesGlobalSearch\(item, search\);/u);
  assert.match(uiCasesSource, /const matchesStatus = statusFilter === "all" \|\| getCaseStatus\(item\) === statusFilter;/u);
  assert.match(uiCasesSource, /const matchesType = caseMatchesTypeFilter\(item, typeFilter\);/u);
  assert.match(uiCasesSource, /cases\.sort\(compareCasesForList\);/u);
});

check("G CASE_LIST_PAGE_SIZE remains 50", () => {
  assert.match(uiCasesSource, /const CASE_LIST_PAGE_SIZE = 50;/u);
});

check("H Case cards preserve data-case, status, primary type, next-action tag, and vehicle identity", () => {
  assert.match(uiCasesSource, /data-case="\$\{item\.id\}"/u);
  assert.match(uiCasesSource, /class="case-card-head"/u);
  assert.match(uiCasesSource, /class="case-card-client"/u);
  assert.match(uiCasesSource, /class="tag case-status-tag"/u);
  assert.match(uiCasesSource, /class="case-card-vehicle"/u);
  assert.match(uiCasesSource, /class="case-card-identifiers"/u);
  assert.match(uiCasesSource, /class="tag soft"/u);
  assert.match(uiCasesSource, /class="tag next-action-tag case-card-next-action priority-\$\{escapeAttr\(nextAction\.priority\)\}"/u);
});

check("I Case cards surface workshop/order reference via canonical getPrintOrderReference without fake OR or internalNumber fallback", () => {
  const renderCasesMatch = uiCasesSource.match(/function renderCases\(\)[\s\S]*?function getCaseListPaginationState/u);
  assert.ok(renderCasesMatch, "renderCases block must exist");
  const renderCasesBlock = renderCasesMatch[0];
  assert.match(renderCasesBlock, /typeof getPrintOrderReference === "function"\s*\?\s*getPrintOrderReference\(item\)/u);
  assert.match(renderCasesBlock, /const hasOrderRef = Boolean\(\s*orderRef\s*&&\s*orderRef !== "-"\s*&&\s*orderRef !== item\.id\s*\);/u);
  assert.doesNotMatch(renderCasesBlock, /item\.internalNumber/u);
  assert.match(renderCasesBlock, /hasOrderRef \? `<span class="case-card-or">OR \$\{escapeHtml\(orderRef\)\}<\/span>` : ""/u);
});

check("J Schema and persistence contracts remain unchanged", () => {
  assert.match(stateSource, /const DB_VERSION = 2;/u);
  assert.match(stateSource, /const CURRENT_DATA_SCHEMA_VERSION = 2;/u);
  assert.match(stateSource, /const CANONICAL_TASK_MODEL_VERSION = 1;/u);
  assert.match(schemaSource, /create table if not exists public\.workshops/iu);
});

assert.equal(results.length, 10, "All 10 UX-003 checks must pass");
console.log(`UX-003 case search & filters gate: ${results.length}/10 PASS`);
