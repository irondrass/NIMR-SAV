import assert from "node:assert/strict";
import fs from "node:fs";
import { createNimrVmContext } from "./helpers/nimr_vm_context.mjs";

const indexSource = fs.readFileSync(
  new URL("../index.html", import.meta.url),
  "utf8"
);

assert.doesNotMatch(
  indexSource,
  /data-tab=["']qc-workspace["']/u
);

assert.match(
  indexSource,
  /option value=["']controle_qualite["']/u
);

const { context } = createNimrVmContext({
  filename: "canonical-workspaces-contract.js",
});

assert.equal(
  context.normalizeUserRole("qualite"),
  "controle_qualite"
);

const legacyQualityTabs = Array.from(
  context.getAllowedTabsForRole("qualite")
);

assert.deepEqual(
  legacyQualityTabs,
  ["today", "dossiers", "technician"],
  "un ancien rôle qualité doit migrer vers le workspace qualité avec exécution QC"
);

const canonicalQualityTabs = Array.from(
  context.getAllowedTabsForRole("controle_qualite")
);

assert.deepEqual(
  canonicalQualityTabs,
  ["today", "dossiers", "technician"],
  "le rôle Contrôleur Qualité doit disposer du workspace d'exécution QC"
);

assert.equal(
  context.getDefaultTabForRole("qualite"),
  "technician",
  "un ancien rôle qualité doit arriver sur son workspace d'exécution QC"
);

assert.equal(
  context.getDefaultTabForRole("controle_qualite"),
  "technician",
  "le Contrôleur Qualité doit arriver directement sur son workspace d'exécution QC"
);

assert.equal(
  canonicalQualityTabs.includes("technician"),
  true,
  "le Contrôleur Qualité doit accéder au workspace technician"
);

assert.equal(
  canonicalQualityTabs.includes("planning"),
  false,
  "le Contrôleur Qualité ne doit pas obtenir l'administration générale du planning"
);

assert.equal(
  canonicalQualityTabs.includes("atelier"),
  false,
  "le Contrôleur Qualité ne doit pas obtenir le workspace d'administration atelier"
);

assert.equal(
  Array.from(context.getAllowedTabsForRole("admin")).includes("qc-workspace"),
  false,
  "aucun ancien workspace qc-workspace séparé ne doit être réintroduit"
);

console.log("ROLE BASED WORKSPACES QC-PRO OK");
