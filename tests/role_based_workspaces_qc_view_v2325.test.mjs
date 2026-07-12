import assert from "node:assert/strict";
import fs from "node:fs";
import { createNimrVmContext } from "./helpers/nimr_vm_context.mjs";

const indexSource = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
assert.doesNotMatch(indexSource, /data-tab=["']qc-workspace["']/u);
assert.doesNotMatch(indexSource, /option value=["']qualite["']/u);
const { context } = createNimrVmContext({ filename: "canonical-workspaces-contract.js" });
assert.equal(context.normalizeUserRole("qualite"), "lecture_seule");
assert.deepEqual(
  Array.from(context.getAllowedTabsForRole("qualite")),
  ["dossiers", "pilotage", "planning"],
  "un ancien rôle qualité doit migrer vers une consultation sans workspace dédié",
);
assert.equal(context.canAccessTab("qc-workspace", { role: "admin" }), false);
console.log("ROLE BASED WORKSPACES WITHOUT QC OK");
