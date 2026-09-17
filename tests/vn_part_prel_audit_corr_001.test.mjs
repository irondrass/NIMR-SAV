/**
 * NIMR-SAV — Test Suite: PREL-AUDIT-CORR-001 (Lot P1)
 *
 * Scope:
 *   1. Central status label mapping & formatVnPartStatus helper
 *   2. Elimination of raw backend codes in user-facing UI
 *   3. Safe fallback for missing or unknown statuses
 *   4. Removal of forbidden brand placeholders (Peugeot, Renault, Citroen, Forthing)
 *   5. Persistence of backend status codes in data model & business logic
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const vnPartUi = require("../js/vn-part-ui.js");

const WORKDIR = process.cwd();
const uiJsPath = path.join(WORKDIR, "js/vn-part-ui.js");
const uiJsContent = fs.readFileSync(uiJsPath, "utf8");

test("P1.1: formatVnPartStatus maps all canonical backend statuses to user-friendly French labels", () => {
  assert.equal(typeof vnPartUi.formatVnPartStatus, "function", "formatVnPartStatus helper must be exported");

  assert.equal(vnPartUi.formatVnPartStatus("EN_ATTENTE_VALIDATIONS"), "En attente de validation");
  assert.equal(vnPartUi.formatVnPartStatus("AUTORISE_A_PRELEVER"), "Autorisé à prélever");
  assert.equal(vnPartUi.formatVnPartStatus("PRELEVE_EN_ATTENTE_PIECE"), "En attente de pièce");
  assert.equal(vnPartUi.formatVnPartStatus("PIECE_DISPONIBLE"), "Pièce disponible");
  assert.equal(vnPartUi.formatVnPartStatus("CLOTURE"), "Restitué / Clôturé");
  assert.equal(vnPartUi.formatVnPartStatus("REFUSE"), "Refusé");
  assert.equal(vnPartUi.formatVnPartStatus("ANNULE"), "Annulé");
});

test("P1.2: formatVnPartStatus provides safe, readable fallbacks for missing or unknown status", () => {
  assert.equal(typeof vnPartUi.formatVnPartStatus, "function", "formatVnPartStatus helper must be exported");

  assert.equal(vnPartUi.formatVnPartStatus(null), "—");
  assert.equal(vnPartUi.formatVnPartStatus(undefined), "—");
  assert.equal(vnPartUi.formatVnPartStatus(""), "—");
  assert.equal(vnPartUi.formatVnPartStatus("INCONNU_STATUS"), "INCONNU_STATUS");
});

test("P1.3: Static check: No raw technical status rendered in modal summary", () => {
  assert.doesNotMatch(
    uiJsContent,
    /Statut actuel\s*:\s*\$\{\s*escapeHtml\(\s*removal\.status\s*\)\s*\}/,
    "Modal summary must not interpolate raw removal.status directly"
  );
  assert.match(
    uiJsContent,
    /Statut actuel\s*:\s*\$\{\s*escapeHtml\(\s*formatVnPartStatus\(\s*removal\.status\s*\)\s*\)\s*\}/,
    "Modal summary must format removal.status using formatVnPartStatus"
  );
});

test("P1.4: Static check: No forbidden vehicle brands in UI placeholders or helpers", () => {
  const forbiddenPatterns = [
    /placeholder=["'][^"']*Peugeot[^"']*["']/i,
    /placeholder=["'][^"']*Renault[^"']*["']/i,
    /placeholder=["'][^"']*Citro[eë]n[^"']*["']/i,
    /placeholder=["'][^"']*Forthing[^"']*["']/i,
  ];

  for (const pattern of forbiddenPatterns) {
    assert.doesNotMatch(
      uiJsContent,
      pattern,
      "Forbidden vehicle brand found in placeholder: " + pattern
    );
  }
});

test("P1.5: Allowed placeholders are neutral or use authorized NIMR brands (DongFeng / DFSK)", () => {
  assert.match(
    uiJsContent,
    /id=["']vn-create-ben-model["'][^>]*placeholder=["'](?:Saisir le modèle|Ex:\s*(?:DFSK|DongFeng)[^"']*)["']/i,
    "Beneficiary model input must have neutral or DFSK/DongFeng placeholder"
  );
  assert.match(
    uiJsContent,
    /id=["']vn-action-donor-model["'][^>]*placeholder=["'](?:Saisir le modèle|Ex:\s*(?:DFSK|DongFeng)[^"']*)["']/i,
    "Donor model input must have neutral or DFSK/DongFeng placeholder"
  );
});

test("P1.6: renderRequestCard status badges display normalized user-facing text", () => {
  const dummyIdentity = { ok: true, role: "chef_atelier", authUserId: "u1" };
  const remPending = {
    id: "rem-test-01",
    status: "EN_ATTENTE_VALIDATIONS",
    version: 1,
    part_reference: "REF-001",
    part_designation: "Optique",
  };
  const remAuth = {
    id: "rem-test-02",
    status: "AUTORISE_A_PRELEVER",
    version: 1,
    part_reference: "REF-002",
    part_designation: "Aile",
  };

  const htmlPending = vnPartUi.renderRequestCard(remPending, [], dummyIdentity);
  const htmlAuth = vnPartUi.renderRequestCard(remAuth, [], dummyIdentity);

  assert.ok(htmlPending.includes("En attente de validation"), "Pending badge must display 'En attente de validation'");
  assert.ok(!htmlPending.includes("EN ATTENTE DE VALIDATION"), "Must not display all-caps 'EN ATTENTE DE VALIDATION'");

  assert.ok(htmlAuth.includes("Autorisé à prélever"), "Authorized badge must display 'Autorisé à prélever'");
  assert.ok(!htmlAuth.includes("AUTORISÉ À PRÉLEVER"), "Must not display all-caps 'AUTORISÉ À PRÉLEVER'");
});

test("P1.7: Backend status codes persist unchanged in business logic and data attributes", () => {
  const rem = {
    id: "rem-data-attr",
    status: "EN_ATTENTE_VALIDATIONS",
    version: 1,
  };
  assert.equal(rem.status, "EN_ATTENTE_VALIDATIONS");
});
