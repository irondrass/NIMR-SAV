import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createNimrVmContext } from "./helpers/nimr_vm_context.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const normalize = (s) => String(s).replaceAll("\r\n", "\n");

const index = read("index.html");
const stateSource = read("js/state.js");
const appSource = read("app.js");
const css = read("styles.css");
const version = read("js/version.js");

const BASE_PARENT = "b90baea67f17e9d19dd674621713b3425c51731c";
const base = (rel) => execFileSync("git", ["show", `${BASE_PARENT}:${rel}`], { cwd: ROOT, encoding: "utf8", maxBuffer: 40 * 1024 * 1024 });

test("1 directeur_sav lands by default on pilotage", () => {
  const { context, run } = createNimrVmContext();
  assert.equal(run('getDefaultTabForRole("directeur_sav")'), "pilotage");
  assert.equal(run('getDefaultTabForRole("directeur")'), "pilotage");
});

test("2 chef_atelier lands by default on today", () => {
  const { context, run } = createNimrVmContext();
  assert.equal(run('getDefaultTabForRole("chef_atelier")'), "today");
});

test("3 reception lands by default on today", () => {
  const { context, run } = createNimrVmContext();
  assert.equal(run('getDefaultTabForRole("reception")'), "today");
});

test("4 admin lands by default on today", () => {
  const { context, run } = createNimrVmContext();
  assert.equal(run('getDefaultTabForRole("admin")'), "today");
  assert.equal(run('getDefaultTabForRole("admin_technique")'), "today");
});

test("5 technicien lands by default on technician", () => {
  const { context, run } = createNimrVmContext();
  assert.equal(run('getDefaultTabForRole("technicien")'), "technician");
});

test("6 controle_qualite and qualite land on technician; readonly roles land on dossiers", () => {
  const { context, run } = createNimrVmContext();
  assert.equal(run('getDefaultTabForRole("controle_qualite")'), "technician");
  assert.equal(run('getDefaultTabForRole("qualite")'), "technician");
  assert.equal(run('getDefaultTabForRole("readonly")'), "dossiers");
  assert.equal(run('getDefaultTabForRole("lecture_seule")'), "dossiers");
});

test("7 ensureCurrentTabAllowed() redirects unauthorized tab to role default", () => {
  const { context, run } = createNimrVmContext();
  run(`
    state.users = [{ id: "u-rec", name: "Réceptionniste", role: "reception", active: true }];
    state.currentUserId = "u-rec";
    activeTab = "atelier";
    ensureCurrentTabAllowed();
  `);
  assert.equal(run("activeTab"), "today", "reception accessing unauthorized atelier must redirect to today");

  run(`
    state.users = [{ id: "u-tech", name: "Technicien", role: "technicien", active: true }];
    state.currentUserId = "u-tech";
    activeTab = "dossiers";
    ensureCurrentTabAllowed();
  `);
  assert.equal(run("activeTab"), "technician", "technicien accessing unauthorized dossiers must redirect to technician");
});

test("8 direct navigation to permitted tabs is preserved once navigated", () => {
  const { context, run } = createNimrVmContext();
  run(`
    state.users = [{ id: "u-rec", name: "Réceptionniste", role: "reception", active: true }];
    state.currentUserId = "u-rec";
    activeTab = "dossiers";
    ensureCurrentTabAllowed();
  `);
  assert.equal(run("activeTab"), "dossiers", "permitted tab must not be reset during general re-renders");

  run(`
    state.users = [{ id: "u-chef", name: "Chef", role: "chef_atelier", active: true }];
    state.currentUserId = "u-chef";
    activeTab = "planning";
    ensureCurrentTabAllowed();
  `);
  assert.equal(run("activeTab"), "planning", "chef_atelier on planning must stay on planning");
});

test("9 sidebar contains all required tabs in order", () => {
  const navMatch = index.match(/<nav class="sidebar-nav"[^>]*>([\s\S]*?)<\/nav>/u);
  assert.ok(navMatch, "sidebar-nav exists in index.html");
  const navContent = navMatch[1];
  const tabsInOrder = [...navContent.matchAll(/data-tab="([^"]+)"/gu)].map((m) => m[1]);
  assert.deepEqual(tabsInOrder, [
    "reception-workspace",
    "today",
    "dossiers",
    "planning",
    "pilotage",
    "technician",
    "atelier",
  ]);
});

test("10 reception-workspace is styled as action with + Nouveau dossier", () => {
  assert.match(index, /<button class="nav-button nav-button-action" type="button" data-tab="reception-workspace">[\s\S]*?\+\s*Nouveau dossier/u);
  assert.match(css, /\.sidebar-nav \.nav-button-action\s*\{/u);
});

test("11 atelier is styled as secondary utility below divider", () => {
  assert.match(index, /<div class="sidebar-nav-divider" role="separator" aria-orientation="horizontal"><\/div>\s*<button class="nav-button nav-button-utility" type="button" data-tab="atelier">/u);
  assert.match(css, /\.sidebar-nav-divider\s*\{/u);
  assert.match(css, /\.sidebar-nav \.nav-button-utility\s*\{/u);
});

test("12 dashboard-strip is hidden outside pilotage via CSS and initial markup", () => {
  assert.match(index, /<body data-active-tab="today">/u);
  assert.match(css, /body\[data-active-tab\]:not\(\[data-active-tab="pilotage"\]\) \.dashboard-strip\s*\{\s*display: none;/u);
  assert.match(css, /body:not\(\[data-active-tab="pilotage"\]\) \.dashboard-strip\s*\{\s*display: none !important;/u);
});

test("13 technicien sees ONLY technician in primary navigation", () => {
  const { context, run } = createNimrVmContext();
  const allowed = run('JSON.stringify(getAllowedTabsForRole("technicien"))');
  assert.equal(allowed, JSON.stringify(["technician"]));
});

test("14 technicien cannot navigate to or see reception-workspace, planning, dossiers, or atelier", () => {
  const { context, run } = createNimrVmContext();
  run(`
    state.users = [{ id: "u-tech", name: "Technicien", role: "technicien", active: true }];
    state.currentUserId = "u-tech";
  `);
  assert.equal(run('canAccessTab("reception-workspace")'), false);
  assert.equal(run('canAccessTab("planning")'), false);
  assert.equal(run('canAccessTab("dossiers")'), false);
  assert.equal(run('canAccessTab("atelier")'), false);
  assert.equal(run('canAccessTab("pilotage")'), false);
  assert.equal(run('canAccessTab("today")'), false);
  assert.equal(run('canAccessTab("technician")'), true);
});

test("15 role navigation invariants and protected shell boundaries are enforced", () => {
  const { context, run } = createNimrVmContext();
  run(`
    state.users = [{ id: "u-qc", name: "Contrôleur", role: "controle_qualite", active: true }];
    state.currentUserId = "u-qc";
    activeTab = "reception-workspace";
    ensureCurrentTabAllowed();
  `);
  assert.equal(run("activeTab"), "technician", "controle_qualite redirigé vers son espace d'exécution technician");
  assert.equal(run('canAccessTab("technician")'), true, "controle_qualite peut accéder à technician");
  assert.equal(run('canAccessTab("pilotage")'), false, "controle_qualite ne peut pas accéder à pilotage");
  assert.equal(run('canAccessTab("atelier")'), false, "controle_qualite ne peut pas accéder à atelier");
});

test("16 version identity is synchronized across version.js and state.js", () => {
  const appVersionMatch = version.match(/^window\.APP_VERSION = "([^"]+)";$/mu);
  assert.ok(appVersionMatch, "window.APP_VERSION must be defined in version.js");
  const currentAppVersion = appVersionMatch[1];

  const buildMatch = version.match(/^window\.NIMR_BUILD = "([^"]+)";$/mu);
  assert.ok(buildMatch, "window.NIMR_BUILD must be defined in version.js");
  const nimrBuild = buildMatch[1];

  const cacheMatch = version.match(/^window\.NIMR_CACHE_NAME = "([^"]+)";$/mu);
  assert.ok(cacheMatch, "window.NIMR_CACHE_NAME must be defined in version.js");
  const nimrCacheName = cacheMatch[1];

  const stateAppVersionMatch = stateSource.match(/^const APP_VERSION = "([^"]+)";/mu);
  assert.ok(stateAppVersionMatch, "const APP_VERSION must be defined in state.js");
  const stateAppVersion = stateAppVersionMatch[1];

  // Exact comparison preventing unescaped regex dot-wildcard flaws (e.g. v23X3X58 matching v23.3.58)
  assert.equal(nimrBuild, currentAppVersion, "NIMR_BUILD must exactly equal APP_VERSION");
  assert.equal(nimrCacheName, `nimr-sav-${currentAppVersion}`, "NIMR_CACHE_NAME must match nimr-sav-${APP_VERSION}");
  assert.equal(stateAppVersion, currentAppVersion, "APP_VERSION in state.js must exactly equal version.js");
});

console.log("SIMPLIFY-001B ROLE HOME & NAVIGATION SHELL SUITE: 16 CHECKS DECLARED");
