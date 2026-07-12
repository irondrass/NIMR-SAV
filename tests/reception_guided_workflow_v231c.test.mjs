import assert from "node:assert/strict";
import fs from "node:fs";

const indexSource = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
assert.match(indexSource, /Import devis PDF atelier/u);
assert.match(indexSource, /Importer un devis PDF/u);
[
  "Réception guidée",
  "Créer un nouveau dossier",
  "Saisie des informations du nouveau dossier",
  "Motifs fréquents",
  "Réclamations client",
  "Demandes client",
  "Client démonstration",
].forEach((text) => assert.equal(indexSource.includes(text), false, `élément historique encore visible : ${text}`));
console.log("RECEPTION GUIDED WORKFLOW REMOVAL OK");
