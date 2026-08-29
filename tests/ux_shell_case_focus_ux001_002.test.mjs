import assert from "node:assert/strict";
import fs from "node:fs";

const indexSource = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const appSource = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
const utilsSource = fs.readFileSync(new URL("../js/utils.js", import.meta.url), "utf8");
const styleSource = fs.readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const swSource = fs.readFileSync(new URL("../sw.js", import.meta.url), "utf8");
const offlineSource = fs.readFileSync(new URL("../offline.html", import.meta.url), "utf8");
const versionSource = fs.readFileSync(new URL("../js/version.js", import.meta.url), "utf8");
const stateSource = fs.readFileSync(new URL("../js/state.js", import.meta.url), "utf8");
const p1008Source = fs.readFileSync(new URL("./anticipated_parts_decision_p1008.test.mjs", import.meta.url), "utf8");

const results = [];

function check(name, callback) {
  callback();
  results.push(name);
  console.log(`PASS ${name}`);
}

check("A UX-001/002 release surfaces remain internally consistent", () => {
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

check("B Today is the role-aware operational startup destination", () => {
  assert.match(appSource, /canAccessTab\("today"\)[\s\S]*\? "today"/u);
  assert.match(appSource, /canAccessTab\("technician"\)[\s\S]*\? "technician"/u);
  assert.match(appSource, /setActiveTab\(startupTab\);/u);
  assert.match(indexSource, /class="nav-button active" type="button" data-tab="today" aria-current="page"/u);
  assert.match(indexSource, /class="view active" id="view-today"/u);
  assert.doesNotMatch(indexSource, /class="view active" id="view-reception-workspace"/u);
});

check("C PDF import is presented as the New dossier action instead of a destination", () => {
  assert.match(indexSource, /data-tab="reception-workspace"[\s\S]{0,700}Nouveau dossier/u);
  assert.match(indexSource, /id="pdf-import-title">Nouveau dossier</u);
  assert.match(indexSource, /Déposez le devis PDF, vérifiez les informations détectées puis créez le dossier/u);
});

check("D active tab is exposed only as presentation state", () => {
  assert.match(utilsSource, /activeTab = tab;[\s\S]*document\.body\.dataset\.activeTab = String\(tab \|\| ""\);/u);
});

check("E global KPIs are visible only on Pilotage", () => {
  assert.match(styleSource, /body\[data-active-tab\]:not\(\[data-active-tab="pilotage"\]\) \.dashboard-strip\s*\{\s*display: none;/u);
  assert.match(styleSource, /body\[data-active-tab="pilotage"\] \.dashboard-strip\s*\{\s*display: grid;/u);
});

check("F sync chrome is condensed to the useful operational state", () => {
  assert.match(styleSource, /\.sync-status-strip \.sync-item\s*\{\s*display: none;/u);
  assert.match(styleSource, /\.sync-status-strip \.sync-item:nth-of-type\(2\)\s*\{\s*display: inline-flex;/u);
  assert.match(styleSource, /body\.is-offline \.sync-status-strip \.sync-item:nth-of-type\(3\)/u);
});

check("G case cockpit removes duplicate progress visualizations", () => {
  assert.match(styleSource, /\.case-stage-flow\s*\{\s*display: none;/u);
  assert.match(styleSource, /\.compact-workflow\s*\{\s*display: none;/u);
});

check("H the recommended next action becomes the primary case element", () => {
  assert.match(styleSource, /\.summary-card\.next-action-card\s*\{[\s\S]*grid-column: 1 \/ -1;/u);
  assert.match(styleSource, /\.summary-card\.next-action-card strong\s*\{[\s\S]*color: var\(--brand\)/u);
  assert.match(indexSource, /Prochaine action recommandée/u);
  assert.match(indexSource, /Continuer le dossier/u);
});

check("I user-facing case wording is simplified without removing workflow capabilities", () => {
  assert.match(indexSource, /data-case-tab="claims">Résumé & travaux</u);
  assert.match(indexSource, /data-case-tab="planning">Planning</u);
  assert.match(indexSource, /<h2>Rendez-vous<\/h2>/u);
  assert.match(indexSource, /Terminer les travaux/u);
  assert.match(indexSource, /data-action-flag="workCompleted"/u);
  assert.match(indexSource, /data-action-flag="archive"/u);
});

check("J schema and anticipated-parts contracts remain intact", () => {
  assert.match(stateSource, /const DB_VERSION = 2;/u);
  assert.match(stateSource, /const CURRENT_DATA_SCHEMA_VERSION = 2;/u);
  assert.match(stateSource, /const CANONICAL_TASK_MODEL_VERSION = 1;/u);
  assert.match(p1008Source, /records its release without pinning future PWA versions/u);
  assert.match(p1008Source, /version PWA : inchangée/u);
});

console.log(`UX-001/002 simplified shell & case focus gate: ${results.length}/10 PASS`);