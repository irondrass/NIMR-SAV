import assert from "node:assert/strict";
import fs from "node:fs";

const planningSource = fs.readFileSync(new URL("../js/planning.js", import.meta.url), "utf8");
const decisionDoc = fs.readFileSync(new URL("../FLUX_PIECES_NEUVES_PLANNING.md", import.meta.url), "utf8");
const readme = fs.readFileSync(new URL("../README.md", import.meta.url), "utf8");
const stateSource = fs.readFileSync(new URL("../js/state.js", import.meta.url), "utf8");
const versionSource = fs.readFileSync(new URL("../js/version.js", import.meta.url), "utf8");

const results = [];

function check(name, callback) {
  callback();
  results.push(name);
  console.log(`PASS ${name}`);
}

function compatibilityFunctionBody() {
  const match = planningSource.match(
    /function schedulePipelineWithAnticipatedNewParts\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/u,
  );
  assert.ok(match, "schedulePipelineWithAnticipatedNewParts must remain present for compatibility");
  return match[1];
}

check("A compatibility function delegates directly to sequential planning", () => {
  const body = compatibilityFunctionBody();
  assert.match(
    body,
    /return scheduleSequentialPipeline\(item,\s*startAfter,\s*bookings\);/u,
  );
});

check("B compatibility function contains no hidden anticipated booking implementation", () => {
  const body = compatibilityFunctionBody();
  assert.doesNotMatch(body, /anticipated-new-part/u);
  assert.doesNotMatch(body, /addOverlay|push\(|stepToBooking|findSlot/u);
});

check("C decision document explicitly marks automatic anticipation disabled", () => {
  assert.match(decisionDoc, /Statut actuel — DÉSACTIVÉ/u);
  assert.match(decisionDoc, /Ne pas réactiver automatiquement/u);
  assert.match(decisionDoc, /l'anticipation automatique reste interdite/u);
});

check("D decision document defines the current no-hidden-task contract", () => {
  assert.match(decisionDoc, /aucune tâche supplémentaire n'est créée automatiquement/u);
  assert.match(decisionDoc, /aucune étape `anticipated-new-part` n'est persistée/u);
  assert.match(decisionDoc, /tâche canonique explicite/u);
});

check("E historical v22 behavior is labelled historical rather than current", () => {
  assert.match(decisionDoc, /v22\.02\/v22\.03/u);
  assert.match(decisionDoc, /historiques/u);
  assert.match(readme, /Contrat planning actuel — P1-008/u);
  assert.match(readme, /mentions v22\.x.+anciens comportements/u);
});

check("F future reactivation requires an explicit dedicated phase", () => {
  assert.match(decisionDoc, /phase dédiée/u);
  assert.match(decisionDoc, /scale gate P1-007/u);
  assert.match(decisionDoc, /sécurité d'acceptation\/CAS/u);
  assert.match(decisionDoc, /immutabilité de l'historique productif/u);
});

check("G P1-008 records its release without pinning future PWA versions", () => {
  assert.match(decisionDoc, /version PWA : inchangée \(`v23\.3\.8`\)/u);
  const appVersion = versionSource.match(/window\.APP_VERSION = "(v\d+\.\d+\.\d+)";/u)?.[1];
  const buildVersion = versionSource.match(/window\.NIMR_BUILD = "(v\d+\.\d+\.\d+)";/u)?.[1];
  const cacheVersion = versionSource.match(/window\.NIMR_CACHE_NAME = "nimr-sav-(v\d+\.\d+\.\d+)";/u)?.[1];
  assert.ok(appVersion, "current APP_VERSION must remain semantic");
  assert.equal(buildVersion, appVersion);
  assert.equal(cacheVersion, appVersion);
});
check("H schema contracts remain unchanged", () => {
  assert.match(stateSource, /const DB_VERSION = 2;/u);
  assert.match(stateSource, /const CURRENT_DATA_SCHEMA_VERSION = 2;/u);
  assert.match(stateSource, /const CANONICAL_TASK_MODEL_VERSION = 1;/u);
});

console.log(`P1-008 anticipated-parts decision gate: ${results.length}/8 PASS`);