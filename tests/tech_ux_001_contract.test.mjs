import assert from "node:assert/strict";
import fs from "node:fs";

const cases = fs.readFileSync(
  new URL("../js/ui-cases.js", import.meta.url),
  "utf8",
);

const styles = fs.readFileSync(
  new URL("../styles.css", import.meta.url),
  "utf8",
);

let passed = 0;

function check(name, fn) {
  fn();
  passed += 1;
  console.log(`PASS ${name}`);
}

check("A all-done cannot fall back to a completed current row", () => {
  assert.match(
    cases,
    /const doneRows = orderedRows\.filter\(\(row\) => row\.status === "done"\);/u,
  );
  assert.match(
    cases,
    /const actionableRows = orderedRows\.filter\(\(row\) => row\.status !== "done"\);/u,
  );
  assert.match(cases, /const currentRow = actionableRows\[0\] \|\| null;/u);
  assert.match(cases, /const nextRow = actionableRows\[1\] \|\| null;/u);
  assert.match(cases, /const pendingRows = actionableRows\.slice\(2\);/u);
  assert.match(
    cases,
    /const allDone = orderedRows\.length > 0 && actionableRows\.length === 0;/u,
  );
  assert.doesNotMatch(
    cases,
    /orderedRows\.find\(\(row\) => row\.status !== "done"\) \|\| orderedRows\[0\]/u,
  );
});

check("B timer is shown only for in-progress, paused or blocked work", () => {
  assert.match(cases, /function shouldShowTechnicianElapsed\(row\)/u);
  assert.match(
    cases,
    /\["in_progress", "paused", "blocked"\]\.includes\(row\.status\)/u,
  );
  assert.match(
    cases,
    /\$\{shouldShowTechnicianElapsed\(currentRow\) \? `<div><dt>Temps écoulé<\/dt>/u,
  );
});

check("C in-progress uses Opération en cours", () => {
  assert.match(cases, /in_progress: "Opération en cours"/u);
});

check("D paused uses Opération en pause", () => {
  assert.match(cases, /paused: "Opération en pause"/u);
});

check("E blocked uses Opération bloquée", () => {
  assert.match(cases, /blocked: "Opération bloquée"/u);
});

check("F ready uses À démarrer", () => {
  assert.match(cases, /ready: "À démarrer"/u);
});

check("G planned uses Prochaine opération", () => {
  assert.match(cases, /planned: "Prochaine opération"/u);
});

check("H completed work is separated as Terminées aujourd'hui", () => {
  assert.match(cases, /class="technician-done-section"/u);
  assert.match(cases, /Terminées aujourd'hui/u);
  assert.match(
    cases,
    /doneRows\.map\(\(row\) => renderTechnicianTaskCard\(row\)\)\.join\(""\)/u,
  );
  assert.match(styles, /\.technician-done-section/u);
  assert.match(styles, /\.technician-done-section-list/u);
});

check("I all-done remains distinct from no-assignment and hides action dock", () => {
  assert.match(cases, /function renderTechnicianAllDoneMessage\(doneRows\)/u);
  assert.match(cases, /Toutes les opérations du jour sont terminées/u);
  assert.match(cases, /Aucune tâche pour ce technicien\./u);
  assert.match(cases, /actionDock\.innerHTML = currentRow \? renderTechnicianTaskActions\(currentRow\) : "";/u);
  assert.match(cases, /actionDock\.hidden = !actionDock\.innerHTML\.trim\(\);/u);
  assert.match(styles, /\.technician-all-done-message/u);
});

check("J network and pending status remains network-specific", () => {
  assert.match(cases, /function refreshTechnicianNetworkStatus\(\)/u);
  assert.match(cases, /En ligne · aucune action locale en attente/u);
  assert.match(cases, /en attente de confirmation/u);
  assert.match(cases, /en attente locale/u);
});

check("K real cloud conflict stays global and outside technician field UX", () => {
  assert.match(cases, /function renderSyncStatusStrip\(\)/u);
  assert.match(cases, /getOpenSyncConflicts/u);
  assert.match(cases, /Résoudre le conflit de synchronisation/u);

  const techStart = cases.indexOf("function shouldShowTechnicianElapsed");
  const techEnd = cases.indexOf("function renderTechnicianTaskCard", techStart);

  assert.ok(techStart >= 0);
  assert.ok(techEnd > techStart);

  const technicianUx = cases.slice(techStart, techEnd);

  assert.doesNotMatch(
    technicianUx,
    /getOpenSyncConflicts|pushSyncConflict|resolveSyncConflict/u,
  );
});

check("L UX-QUICK action feedback remains intact", () => {
  assert.match(cases, /technician-complete-action/u);
  assert.match(cases, /activeButton\.classList\.add\("is-pending"\)/u);
  assert.match(
    cases,
    /activeButton\.setAttribute\("aria-busy", "true"\)/u,
  );
  assert.match(
    styles,
    /\.technician-field-action-dock \.technician-complete-action/u,
  );
  assert.match(
    styles,
    /button\.is-pending\[aria-busy="true"\]/u,
  );
});

console.log(
  `TECH-UX-001 CONTRACT: ${passed}/12 CHECKS PASSED`,
);
