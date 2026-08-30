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

check("A Release parity and constant integrity", () => {
  const versionMatch = versionSource.match(/window\.APP_VERSION = "(v\d+\.\d+\.\d+)";/u);
  assert.ok(versionMatch, "version.js defines semantic APP_VERSION");
  const currentVersion = versionMatch[1];
  const queryVersion = currentVersion.replace(/^v/u, "");
  const cacheName = `nimr-sav-${currentVersion}`;

  assert.match(versionSource, new RegExp(`window\\.NIMR_BUILD = "${currentVersion}";`, "u"));
  assert.match(versionSource, new RegExp(`window\\.NIMR_CACHE_NAME = "${cacheName}";`, "u"));
  assert.match(stateSource, new RegExp(`const APP_VERSION = "${currentVersion}";`, "u"));
  assert.match(appSource, new RegExp(`pdf\\.worker\\.min\\.js\\?v=${queryVersion}`, "u"));
  assert.match(swSource, new RegExp(`const CACHE_NAME = "${cacheName}";`, "u"));
  assert.match(indexSource, new RegExp(`styles\\.css\\?v=${queryVersion}`, "u"));
  assert.match(indexSource, new RegExp(`app\\.js\\?v=${queryVersion}`, "u"));
  assert.match(offlineSource, new RegExp(`styles\\.css\\?v=${queryVersion}`, "u"));
  assert.match(stateSource, /const CURRENT_DATA_SCHEMA_VERSION = 2;/u);
  assert.match(stateSource, /const CANONICAL_TASK_MODEL_VERSION = 1;/u);
  assert.match(stateSource, /const DB_VERSION = 2;/u);
});

check("B Single global settings tab without global administration tab", () => {
  assert.match(indexSource, /data-tab="atelier"[^>]*>[\s\S]*?Paramètres/u);
  assert.match(indexSource, /<section class="view" id="view-atelier">/u);
  assert.doesNotMatch(indexSource, /data-tab="administration"/u);
  assert.doesNotMatch(indexSource, /id="view-administration"/u);
});

check("C Internal split structure with single parent shell and accessibility semantics", () => {
  assert.match(indexSource, /class="settings-workspace-shell"/u);
  assert.match(indexSource, /class="panel settings-workspace-header"/u);
  assert.match(indexSource, /id="settings-workspace-tab-workshop"/u);
  assert.match(indexSource, /id="settings-workspace-tab-administration"/u);
  assert.match(indexSource, /data-settings-workspace="workshop"/u);
  assert.match(indexSource, /data-settings-workspace="administration"/u);
  assert.match(indexSource, /id="settings-workspace-workshop"[^>]*data-settings-workspace-panel="workshop"[^>]*role="tabpanel"/u);
  assert.match(indexSource, /id="settings-workspace-administration"[^>]*data-settings-workspace-panel="administration"[^>]*role="tabpanel"[^>]*hidden/u);
  assert.match(indexSource, /role="tablist"/u);
  assert.match(indexSource, /role="tab"/u);
  assert.match(indexSource, /aria-controls="settings-workspace-workshop"/u);
  assert.match(indexSource, /aria-controls="settings-workspace-administration"/u);

  // Keyboard navigation & roving tabindex contract
  assert.match(appSource, /workshopTab\.addEventListener\("keydown"/u);
  assert.match(appSource, /adminTab\.addEventListener\("keydown"/u);
  assert.match(appSource, /"ArrowRight"/u);
  assert.match(appSource, /"ArrowLeft"/u);
  assert.match(appSource, /"Home"/u);
  assert.match(appSource, /"End"/u);
  assert.match(appSource, /event\.preventDefault\(\)/u);
  assert.match(appSource, /setSettingsWorkspace\(targetWorkspace\)/u);
  assert.match(appSource, /targetTab\?\.focus\(\)|targetTab\.focus\(\)/u);
  assert.match(appSource, /setAttribute\("tabindex", isWorkshop \? "0" : "-1"\)/u);
  assert.match(appSource, /setAttribute\("tabindex", !isWorkshop \? "0" : "-1"\)/u);
});

check("D Operational workshop settings group placed in workshop workspace", () => {
  const workshopPanelMatch = indexSource.match(/id="settings-workspace-workshop"[\s\S]*?<\/div>\s*<\/div>\s*<div[^>]*id="settings-workspace-administration"/u);
  assert.ok(workshopPanelMatch, "Workshop panel exists before administration panel");
  const workshopHtml = workshopPanelMatch[0];

  assert.match(workshopHtml, /id="resource-form"/u);
  assert.match(workshopHtml, /id="resource-list"/u);
  assert.match(workshopHtml, /id="fastlane-form"/u);
  assert.match(workshopHtml, /id="work-hours-list"/u);
  assert.match(workshopHtml, /id="holiday-form"/u);
  assert.match(workshopHtml, /id="holiday-list"/u);
  assert.match(workshopHtml, /id="resource-leave-form"/u);
  assert.match(workshopHtml, /id="resource-leave-list"/u);
});

check("E Administration group placed in administration workspace with sensitive markers preserved", () => {
  const adminPanelMatch = indexSource.match(/id="settings-workspace-administration"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>\s*<\/section>/u);
  assert.ok(adminPanelMatch, "Administration panel exists");
  const adminHtml = adminPanelMatch[0];

  assert.match(adminHtml, /class="panel users-roles-panel"\s+data-admin-technical-panel/u);
  assert.match(adminHtml, /id="user-form"/u);
  assert.match(adminHtml, /id="users-list"/u);
  assert.match(adminHtml, /id="export-encrypted-backup"/u);
  assert.match(adminHtml, /id="export-backup"/u);
  assert.match(adminHtml, /id="import-backup"/u);
  assert.match(adminHtml, /id="local-pin-form"/u);
  assert.match(adminHtml, /class="panel supabase-panel"\s+data-supabase-status-panel/u);
  assert.match(adminHtml, /id="supabase-config-form"\s+data-supabase-admin-control="configure"/u);
  assert.match(adminHtml, /id="supabase-sync-health"/u);
  assert.match(adminHtml, /id="panel-activity-log"/u);
  assert.match(adminHtml, /id="sync-conflict-panel"/u);
});

check("F Single presentation engine reusing existing business renderers without duplication", () => {
  assert.match(appSource, /let activeSettingsWorkspace = "workshop";/u);
  assert.match(appSource, /function setSettingsWorkspace\(/u);
  assert.match(appSource, /function renderSettingsWorkspaceNavigation\(/u);
  assert.match(appSource, /function bindSettingsWorkspaceNavigation\(/u);
  assert.match(appSource, /renderResources\(\)/u);
  assert.match(appSource, /renderFastLaneSettings\(\)/u);
  assert.match(appSource, /renderWorkHoursSettings\(\)/u);
  assert.match(appSource, /renderHolidays\(\)/u);
  assert.match(appSource, /renderResourceLeaves\(\)/u);
  assert.match(appSource, /renderUsersAndRoles\(\)/u);
  assert.match(appSource, /refreshSupabasePanel\(\)/u);
  assert.match(appSource, /renderActivityLog\(\)/u);
});

check("G Permission policy preserved without new role tabs or fake permissions", () => {
  assert.match(stateSource, /const ROLE_TABS\s*=\s*\{/u);
  assert.doesNotMatch(stateSource, /"administration"/u);
  assert.match(stateSource, /function canAccessTab\(/u);
  assert.match(uiCasesSource, /function renderAdminTechnicalVisibility\(/u);
});

check("H Conflict deep-link handoff opens atelier and activates administration workspace", () => {
  assert.match(appSource, /function navigateToConflictsAndFocus\(\)\s*\{[\s\S]*?setActiveTab\("atelier"\);[\s\S]*?setSettingsWorkspace\("administration"\);/u);
  assert.match(appSource, /document\.getElementById\("panel-activity-log"\)/u);
  assert.match(appSource, /document\.getElementById\("sync-conflict-panel"\)/u);
});

check("I Mobile layout, accessibility and 360px responsiveness", () => {
  assert.match(styleSource, /\.settings-workspace-shell\s*\{/u);
  assert.match(styleSource, /\.settings-workspace-nav\s*\{/u);
  assert.match(styleSource, /\.settings-workspace-tab\s*\{/u);
  assert.match(styleSource, /\.settings-workspace-tab\.active/u);
  assert.match(styleSource, /\.settings-workspace-panel\[hidden\]\s*\{/u);
  assert.match(styleSource, /min-height:\s*44px/u);
});

check("J Schema contracts and data model safety intact", () => {
  assert.match(stateSource, /const CURRENT_DATA_SCHEMA_VERSION = 2;/u);
  assert.match(stateSource, /const CANONICAL_TASK_MODEL_VERSION = 1;/u);
  assert.match(stateSource, /const DB_VERSION = 2;/u);
  assert.match(schemaSource, /create table if not exists public\.repair_orders/u);
});

console.log(`\nUX-006 REGRESSION SUITE: ${results.length}/10 CHECKS PASSED`);
