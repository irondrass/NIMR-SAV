import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const indexSource = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const stateSource = fs.readFileSync(new URL("../js/state.js", import.meta.url), "utf8");
const uiCasesSource = fs.readFileSync(new URL("../js/ui-cases.js", import.meta.url), "utf8");

const roleTabsMatch = stateSource.match(
  /const ROLE_TABS\s*=\s*\{([\s\S]*?)\r?\n\};/u,
);

assert.ok(roleTabsMatch, "ROLE_TABS block must exist");

const roleTabsSource = roleTabsMatch[1];

function extractRoleTabs(role) {
  const match = roleTabsSource.match(
    new RegExp(`^\\s*${role}:\\s*\\[([^\\]]*)\\]`, "m"),
  );

  assert.ok(match, `ROLE_TABS entry missing for ${role}`);

  return [...match[1].matchAll(/"([^"]+)"/g)].map((entry) => entry[1]);
}

test("C0: Lot C preserves current role navigation matrix", () => {
  assert.deepEqual(
    extractRoleTabs("directeur_sav"),
    ["reception-workspace", "dossiers", "today", "pilotage", "planning", "atelier", "vn-part"],
  );

  assert.deepEqual(
    extractRoleTabs("chef_atelier"),
    ["reception-workspace", "dossiers", "today", "pilotage", "planning", "technician", "atelier", "vn-part"],
  );

  assert.deepEqual(
    extractRoleTabs("readonly"),
    ["dossiers", "pilotage", "planning", "vn-part"],
  );

  assert.equal(extractRoleTabs("chef_atelier").includes("technician"), true);
  assert.equal(extractRoleTabs("directeur_sav").includes("technician"), false);
  assert.equal(extractRoleTabs("readonly").includes("technician"), false);
});

test("C0: Lot C preserves canonical parts-blocking semantics", () => {
  assert.match(
    stateSource,
    /\["unchecked",\s*"Non vérifié"\]/u,
  );

  assert.match(
    stateSource,
    /const BLOCKING_PARTS_STATUSES\s*=\s*new Set\(\["waiting_parts",\s*"blocked_parts"\]\);/u,
  );
});

test("CA-PARTS-002 RED: non-blocked must not imply parts follow-up is OK", () => {
  assert.match(
    uiCasesSource,
    /blocked\s*\?\s*"Bloqué"\s*:\s*"Aucun blocage"/u,
  );

  assert.doesNotMatch(
    uiCasesSource,
    /blocked\s*\?\s*"Bloqué"\s*:\s*"Suivi OK"/u,
  );
});

test("CA-UX-003 RED: workshop guidance must be role-neutral", () => {
  assert.doesNotMatch(
    indexSource,
    /Le suivi opérationnel se fait dans l.onglet Technicien/iu,
  );

  assert.match(
    indexSource,
    /espace Technicien pour les rôles autorisés/iu,
  );
});

test("CA-UX-004 RED: pilotage heading must be role-neutral", () => {
  assert.match(
    indexSource,
    /<h1>Pilotage SAV<\/h1>/u,
  );

  assert.doesNotMatch(
    indexSource,
    /<h1>Dashboard Directeur SAV<\/h1>/u,
  );
});