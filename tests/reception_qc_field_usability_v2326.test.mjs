import assert from "node:assert/strict";
import fs from "node:fs";
import { createNimrVmContext } from "./helpers/nimr_vm_context.mjs";

const indexSource = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
assert.doesNotMatch(indexSource, /qc-workspace|Contrôle Qualité|En attente de QC/iu);
assert.doesNotMatch(indexSource, /data-case-panel=["']livraison["']/iu);

const { context } = createNimrVmContext({ filename: "qc-removal-contract.js" });
const item = context.normalizeCase({
  id: "legacy-qc-flags",
  flags: { workStarted: true, workCompleted: false, qualityApproved: true, delivered: true },
  receptionWorkflow: { qualityStatus: "validated" },
});
assert.equal(context.getCaseStatus(item), "in_progress", "les anciens flags QC/livraison ne doivent plus déterminer le statut actif");
assert.equal(context.getNextWorkflowAction(item), "claim", "un dossier sans travaux PDF/MO doit revenir au flux atelier utile");
console.log("QC FIELD REMOVAL OK");
