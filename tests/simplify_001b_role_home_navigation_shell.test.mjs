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

test("6 controle_qualite, qualite, readonly land on dossiers", () => {
  const { context, run } = createNimrVmContext();
  assert.equal(run('getDefaultTabForRole("controle_qualite")'), "dossiers");
  assert.equal(run('getDefaultTabForRole("qualite")'), "dossiers");
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

test("15 existing business rules, planning engine, and data models remain untouched from parent", () => {
  for (const rel of [
    "js/planning.js",
    "js/business-rules-v2187.js",
    "js/supabase-client.js",
    "js/supabase-config.js",
    "js/supabase-sync.js",
  ]) {
    assert.equal(normalize(read(rel)), normalize(base(rel)), `${rel} must remain identical to baseline`);
  }
});

test("16 version identity remains strictly v23.3.30", () => {
  assert.match(version, /^window\.APP_VERSION = "v23\.3\.30";$/mu);
  assert.match(version, /^window\.NIMR_BUILD = "v23\.3\.30";$/mu);
  assert.match(version, /^window\.NIMR_CACHE_NAME = "nimr-sav-v23\.3\.30";$/mu);
  assert.match(stateSource, /const APP_VERSION = "v23\.3\.30";/u);
});

console.log("SIMPLIFY-001B ROLE HOME & NAVIGATION SHELL SUITE: 16 CHECKS DECLARED");
