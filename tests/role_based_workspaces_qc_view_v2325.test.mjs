import assert from "node:assert/strict";
import fs from "node:fs";
import { createNimrVmContext } from "./helpers/nimr_vm_context.mjs";

const indexSource = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
assert.doesNotMatch(indexSource, /data-tab=["']qc-workspace["']/u);
assert.match(indexSource, /option value=["']controle_qualite["']/u);
const { context } = createNimrVmContext({ filename: "canonical-workspaces-contract.js" });
assert.equal(context.normalizeUserRole("qualite"), "controle_qualite");
assert.deepEqual(
  Array.from(context.getAllowedTabsForRole("qualite")),
  ["dossiers", "pilotage", "planning"],
  "un ancien rôle qualité doit migrer vers le workspace d'inspection qualité",
);
assert.equal(context.canAccessTab("qc-workspace", { role: "admin" }), false);
console.log("ROLE BASED WORKSPACES WITHOUT QC OK");
