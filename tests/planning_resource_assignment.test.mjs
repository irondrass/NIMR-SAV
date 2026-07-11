import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { performance } from "node:perf_hooks";

const scriptFiles = [
  "../js/state.js",
  "../js/ui-cases.js",
  "../js/estimate-import.js",
  "../js/ui-planning.js",
  "../js/photos.js",
  "../js/storage.js",
  "../js/planning.js",
  "../js/exports.js",
  "../js/utils.js",
  "../app.js",
];

const appSource = scriptFiles
  .map((file) => fs.readFileSync(new URL(file, import.meta.url), "utf8"))
  .join("\n")
  .replace(/initApp\(\);/, "// initApp skipped by planning resource assignment tests")
  .replace(/if \("serviceWorker" in navigator[\s\S]*$/u, "");

function createElementStub() {
  return {
    value: "",
    textContent: "",
    innerHTML: "",
    hidden: false,
    children: [],
    dataset: {},
    style: {},
    classList: { add() {}, remove() {}, toggle() {} },
    setAttribute() {},
    removeAttribute() {},
    toggleAttribute() {},
    addEventListener() {},
    focus() {},
    closest: () => null,
    contains: () => false,
    append() {},
    appendChild() {},
    replaceChildren() {},
    querySelector: () => createElementStub(),
    querySelectorAll: () => [],
  };
}

const context = {
  console,
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  document: {
    getElementById: () => createElementStub(),
    querySelector: () => createElementStub(),
    querySelectorAll: () => [],
    addEventListener() {},
    createElement: () => createElementStub(),
  },
  navigator: {},
  fetch: async () => ({ ok: false }),
  setTimeout,
  clearTimeout,
  Blob,
  URL: { createObjectURL: () => "", revokeObjectURL() {} },
  FormData: class FormData {},
  addEventListener() {},
};
context.globalThis = context;
context.window = context;
vm.createContext(context);
vm.runInContext(appSource, context, { filename: "planning-resource-assignment-app.js" });

assert.ok(appSource.includes("Ressource recommandée"), "l'UI doit afficher la ressource recommandée");
assert.ok(appSource.includes("Ressources alternatives"), "l'UI doit afficher les ressources alternatives");
assert.ok(appSource.includes("impact livraison estimé"), "l'UI doit afficher l'impact estimé de chaque alternative");

const run = (source) => vm.runInContext(source, context);
const mondayStart = new Date("2026-05-18T08:00:00+01:00");
const calendar = {
  0: "",
  1: "08:00-12:00,13:00-17:00",
  2: "08:00-12:00,13:00-17:00",
  3: "08:00-12:00,13:00-17:00",
  4: "08:00-12:00,13:00-17:00",
  5: "08:00-12:00,13:00-17:00",
  6: "",
};

function booking(id, caseId, resourceIds, start, end, key = "body") {
  return {
    id,
    caseId,
    key,
    title: id,
    start,
    end,
    primaryResourceId: resourceIds[0],
    equipmentResourceIds: resourceIds.slice(1),
    resourceIds,
    segments: [{ start, end }],
    status: "planned",
  };
}

function resetState(resources, bookings = [], cases = []) {
  run(`state = normalizeState(${JSON.stringify({
    settings: { calendar, fastLaneEnabled: false },
    resources,
    bookings,
    cases,
  })}); generatedProposals = {};`);
}

function addPendingCase(item, proposal) {
  run(`state.cases.push(${JSON.stringify(item)}); generatedProposals[${JSON.stringify(item.id)}] = ${JSON.stringify({ proposal, availableDates: [] })};`);
}

function getStep(proposal, key) {
  return proposal.steps.find((step) => step.key === key);
}

function assertNoResourceOverlap(proposals, message) {
  const byResource = new Map();
  proposals.forEach((proposal, proposalIndex) => {
    proposal.steps.forEach((step) => {
      (step.resourceIds || []).forEach((resourceId) => {
        const rows = byResource.get(resourceId) || [];
        (step.segments || []).forEach((segment) => rows.push({
          start: new Date(segment.start),
          end: new Date(segment.end),
          proposalIndex,
          key: step.key,
        }));
        byResource.set(resourceId, rows);
      });
    });
  });
  byResource.forEach((rows, resourceId) => {
    rows.sort((left, right) => left.start - right.start);
    for (let index = 1; index < rows.length; index += 1) {
      assert.ok(
        rows[index - 1].end <= rows[index].start,
        `${message}: chevauchement sur ${resourceId} entre ${rows[index - 1].key} et ${rows[index].key}`,
      );
    }
  });
}

const tolierResources = [
  { id: "tolier-1", name: "Tôlier 1", role: "tolier", active: true },
  { id: "tolier-2", name: "Tôlier 2", role: "tolier", active: true },
];

// 1 — Tôlier 1 complet, Tôlier 2 libre.
resetState(tolierResources, [
  booking("tolier-1-matin", "case-old-1", ["tolier-1"], "2026-05-18T08:00:00+01:00", "2026-05-18T12:00:00+01:00"),
  booking("tolier-1-apres-midi", "case-old-2", ["tolier-1"], "2026-05-18T13:00:00+01:00", "2026-05-18T17:00:00+01:00"),
]);
const freeTolierProposal = context.generateSingleProposal({ id: "pdf-tolier-free", source: "pdf_estimate", durations: { body: 2 } }, mondayStart);
assert.equal(getStep(freeTolierProposal, "body").primaryResourceId, "tolier-2", "Tôlier 2 doit être choisi quand Tôlier 1 est complet");

// 2 — Quatre imports PDF provisoires doivent se répartir avant même validation définitive.
resetState(tolierResources);
const fourPdfProposals = [];
const fourPdfAssignments = [];
for (let index = 1; index <= 4; index += 1) {
  const item = { id: `pdf-body-${index}`, source: "pdf_estimate", durations: { body: 3 } };
  run(`state.cases.push(${JSON.stringify(item)});`);
  const proposal = context.generateSingleProposal(item, mondayStart);
  run(`generatedProposals[${JSON.stringify(item.id)}] = ${JSON.stringify({ proposal, availableDates: [] })};`);
  fourPdfProposals.push(proposal);
  fourPdfAssignments.push(getStep(proposal, "body").primaryResourceId);
}
assert.ok(new Set(fourPdfAssignments).size > 1, "quatre PDF ne doivent pas être affectés au même Tôlier 1");
assertNoResourceOverlap(fourPdfProposals, "quatre imports PDF");

// 3 — Peintre 1 occupé, Peintre 2 libre.
resetState([
  { id: "peintre-1", name: "Peintre 1", role: "peintre", active: true },
  { id: "peintre-2", name: "Peintre 2", role: "peintre", active: true },
  { id: "zone-1", name: "Zone 1", role: "zone_preparation", active: true },
  { id: "cabine-1", name: "Cabine 1", role: "cabine", active: true },
], [booking("peintre-1-journee", "case-paint-old", ["peintre-1"], "2026-05-18T08:00:00+01:00", "2026-05-18T17:00:00+01:00", "prep")]);
const painterProposal = context.generateSingleProposal({ id: "pdf-painter", durations: { prep: 1, paint: 1 } }, mondayStart);
assert.equal(getStep(painterProposal, "prep").primaryResourceId, "peintre-2", "Peintre 2 doit être choisi quand Peintre 1 est occupé");
assert.equal(getStep(painterProposal, "paint").primaryResourceId, "peintre-2", "le même peintre doit conserver le cycle peinture");

resetState([
  { id: "peintre-cycle-1", name: "Peintre cycle 1", role: "peintre", active: true },
  { id: "peintre-cycle-2", name: "Peintre cycle 2", role: "peintre", active: true },
  { id: "cabine-cycle", name: "Cabine cycle", role: "cabine", active: true },
]);
const paintWithoutPrepProposal = context.generateSingleProposal({ id: "pdf-paint-without-prep", durations: { paint: 1, finish: 1 } }, mondayStart);
assert.equal(getStep(paintWithoutPrepProposal, "finish").primaryResourceId, getStep(paintWithoutPrepProposal, "paint").primaryResourceId, "paint → finish doit conserver le même peintre même sans étape préparation");

// 4 — Zone 1 occupée, Zone 2 libre.
resetState([
  { id: "peintre-zone", name: "Peintre", role: "peintre", active: true },
  { id: "zone-1", name: "Zone 1", role: "zone_preparation", active: true },
  { id: "zone-2", name: "Zone 2", role: "zone_preparation", active: true },
], [booking("zone-1-journee", "case-zone-old", ["zone-1"], "2026-05-18T08:00:00+01:00", "2026-05-18T17:00:00+01:00", "prep")]);
const zoneProposal = context.generateSingleProposal({ id: "pdf-zone", durations: { prep: 1 } }, mondayStart);
assert.equal(getStep(zoneProposal, "prep").equipmentResourceIds.join(","), "zone-2", "Zone de préparation 2 doit être choisie quand Zone 1 est occupée");

// 5 — Premier créneau commun technicien + zone.
resetState([
  { id: "peintre-1", name: "Peintre 1", role: "peintre", active: true },
  { id: "peintre-2", name: "Peintre 2", role: "peintre", active: true },
  { id: "zone-1", name: "Zone 1", role: "zone_preparation", active: true },
  { id: "zone-2", name: "Zone 2", role: "zone_preparation", active: true },
], [
  booking("p1-avant-9h", "case-p1", ["peintre-1"], "2026-05-18T08:00:00+01:00", "2026-05-18T09:00:00+01:00", "prep"),
  booking("z1-avant-13h", "case-z1", ["zone-1"], "2026-05-18T08:00:00+01:00", "2026-05-18T13:00:00+01:00", "prep"),
  booking("z2-avant-8h30", "case-z2", ["zone-2"], "2026-05-18T08:00:00+01:00", "2026-05-18T08:30:00+01:00", "prep"),
]);
const commonSlotItem = { id: "pdf-common-slot", durations: { prep: 1 } };
const commonSlotProposal = context.generateSingleProposal(commonSlotItem, mondayStart);
const commonPrep = getStep(commonSlotProposal, "prep");
assert.equal(commonPrep.primaryResourceId, "peintre-2", "le meilleur couple doit utiliser Peintre 2");
assert.equal(commonPrep.equipmentResourceIds.join(","), "zone-2", "le meilleur couple doit utiliser Zone 2");
assert.equal(new Date(commonPrep.start).toISOString(), new Date("2026-05-18T08:30:00+01:00").toISOString(), "le couple doit démarrer au premier créneau commun, sans marge artificielle");
const commonAlternatives = context.getResourceAssignmentAlternatives(commonSlotItem, "prep", mondayStart);
assert.equal(commonAlternatives[0].resourceId, "peintre-2", "l'UI doit recommander le meilleur technicien");
assert.equal(commonAlternatives[0].equipmentResourceIds.join(","), "zone-2", "l'UI doit recommander le meilleur équipement commun");
assert.ok(commonAlternatives.some((alternative) => alternative.resourceId === "peintre-1"), "l'UI doit exposer les ressources alternatives");
assert.ok(commonAlternatives.every((alternative) => Number.isFinite(alternative.dailyLoadMinutes) && Number.isFinite(alternative.deliveryImpactMinutes)), "chaque alternative doit exposer charge et impact livraison estimé");

// 6 — Même début possible : charge journalière la plus faible.
resetState(tolierResources, [
  booking("t1-charge", "case-t1-load", ["tolier-1"], "2026-05-18T13:00:00+01:00", "2026-05-18T17:00:00+01:00"),
  booking("t2-charge", "case-t2-load", ["tolier-2"], "2026-05-18T16:00:00+01:00", "2026-05-18T17:00:00+01:00"),
]);
const lowerLoadProposal = context.generateSingleProposal({ id: "pdf-lower-load", durations: { body: 1 } }, mondayStart);
assert.equal(getStep(lowerLoadProposal, "body").primaryResourceId, "tolier-2", "à départ égal, la ressource la moins chargée doit être choisie");

// 7 — Continuité sur la pause déjeuner.
resetState(tolierResources, [
  booking("t1-full-day", "case-t1-full", ["tolier-1"], "2026-05-18T08:00:00+01:00", "2026-05-18T17:00:00+01:00"),
]);
const lunchProposal = context.generateSingleProposal({ id: "pdf-lunch", durations: { body: 6 } }, mondayStart);
const lunchBody = getStep(lunchProposal, "body");
assert.equal(lunchBody.primaryResourceId, "tolier-2", "le lot doit démarrer chez Tôlier 2");
assert.equal(lunchBody.segments.length, 2, "le lot doit être coupé par la pause déjeuner");
assert.ok(lunchBody.segments[0].end <= lunchBody.segments[1].start, "les segments avant/après déjeuner ne doivent pas se chevaucher");

// 8 — Un second dossier relance une recherche globale.
resetState(tolierResources, [
  booking("t1-matin", "case-t1-matin", ["tolier-1"], "2026-05-18T08:00:00+01:00", "2026-05-18T10:00:00+01:00"),
]);
const firstItem = { id: "pdf-first-global-search", source: "pdf_estimate", durations: { body: 2 } };
run(`state.cases.push(${JSON.stringify(firstItem)});`);
const firstProposal = context.generateSingleProposal(firstItem, mondayStart);
assert.equal(getStep(firstProposal, "body").primaryResourceId, "tolier-2", "le premier dossier doit utiliser Tôlier 2");
run(`state.bookings = []; generatedProposals[${JSON.stringify(firstItem.id)}] = ${JSON.stringify({ proposal: firstProposal, availableDates: [] })};`);
const secondItem = { id: "pdf-second-global-search", source: "pdf_estimate", durations: { body: 2 } };
run(`state.cases.push(${JSON.stringify(secondItem)});`);
const secondProposal = context.generateSingleProposal(secondItem, mondayStart);
assert.equal(getStep(secondProposal, "body").primaryResourceId, "tolier-1", "le second dossier doit refaire la comparaison et utiliser Tôlier 1 devenu libre");

// 9 — Une affectation manuelle reste verrouillée malgré un début automatique plus tardif.
resetState(tolierResources, [
  booking("t2-manual-busy", "case-t2-manual", ["tolier-2"], "2026-05-18T08:00:00+01:00", "2026-05-18T10:00:00+01:00"),
]);
const manualProposal = context.generateSingleProposal({
  id: "pdf-manual-lock",
  durations: { body: 1 },
  stepPreferredResources: { body: "tolier-2" },
  stepAssignmentLocks: { body: { resourceId: "tolier-2", lockedAt: "2026-05-18T07:00:00.000Z", lockedBy: "Chef Atelier", reason: "Continuité souhaitée" } },
}, mondayStart);
assert.equal(getStep(manualProposal, "body").primaryResourceId, "tolier-2", "l'affectation manuelle ne doit pas être remplacée automatiquement");
assert.ok(new Date(getStep(manualProposal, "body").start) >= new Date("2026-05-18T10:00:00+01:00"), "le verrou manuel doit être respecté même si Tôlier 1 commence plus tôt");
const normalizedManualLock = context.normalizeCase({
  id: "pdf-manual-lock-roundtrip",
  stepAssignmentLocks: { body: { resourceId: "tolier-2", lockedAt: "2026-05-18T07:00:00.000Z", lockedBy: "Chef Atelier", reason: "Continuité souhaitée" } },
}).stepAssignmentLocks.body;
assert.equal(normalizedManualLock.resourceId, "tolier-2", "le verrou manuel doit survivre à la normalisation/sauvegarde");
assert.equal(normalizedManualLock.reason, "Continuité souhaitée", "le motif de verrouillage doit rester auditable");

// Acceptation atomique : une proposition obsolète est recalculée contre les réservations courantes.
resetState(tolierResources);
const staleItem = { id: "pdf-stale-a", durations: { body: 2 } };
const currentItem = { id: "pdf-stale-b", durations: { body: 2 } };
run(`state.cases.push(${JSON.stringify(staleItem)}, ${JSON.stringify(currentItem)});`);
const staleProposal = context.generateSingleProposal(staleItem, mondayStart);
const acceptedBookings = context.proposalToBookings(staleItem, staleProposal, false);
run(`state.bookings = ${JSON.stringify(acceptedBookings)};`);
const refreshedProposal = context.recalculateProposalForAcceptance(currentItem, staleProposal);
assertNoResourceOverlap([staleProposal, refreshedProposal], "acceptation atomique");

const validCaseSeed = (id) => ({
  id,
  clientName: `Client ${id}`,
  plate: id === "case-accept-a" ? "111 TU 1111" : "222 TU 2222",
  durations: { body: 2 },
  claims: [{
    id: `claim-${id}`,
    type: "client",
    status: "approved",
    includeInPlanning: true,
    expertApproved: true,
    clientApproved: true,
    estimate: { lines: [{ phase: "body", operation: "Réparation", laborHours: 2 }] },
  }],
});
resetState(tolierResources, [], [validCaseSeed("case-accept-a"), validCaseSeed("case-accept-b")]);
const acceptedCaseA = run(`state.cases.find((item) => item.id === "case-accept-a")`);
const acceptedCaseB = run(`state.cases.find((item) => item.id === "case-accept-b")`);
const cachedProposal = context.generateSingleProposal(acceptedCaseA, mondayStart);
run(`state.bookings = proposalToBookings(state.cases.find((item) => item.id === "case-accept-a"), ${JSON.stringify(cachedProposal)}, false);`);
context.acceptProposal(acceptedCaseB, cachedProposal);
const acceptedCaseBState = JSON.parse(run(`JSON.stringify({
  appointment: state.cases.find((item) => item.id === "case-accept-b").appointment,
  bookings: state.bookings.filter((booking) => booking.caseId === "case-accept-b")
})`));
assert.ok(acceptedCaseBState.appointment?.start, "acceptProposal doit enregistrer le rendez-vous recalculé");
assert.ok(acceptedCaseBState.bookings.length > 0, "acceptProposal doit enregistrer les réservations recalculées");
const acceptedCaseBProposal = { steps: acceptedCaseBState.bookings.map((bookingRow) => ({ ...bookingRow, segments: bookingRow.segments, resourceIds: bookingRow.resourceIds })) };
assertNoResourceOverlap([cachedProposal, acceptedCaseBProposal], "mutation finale acceptProposal");

// 10 — 4 000 dossiers : performance, exploitation des ressources et zéro double réservation.
const largeCases = Array.from({ length: 4000 }, (_, index) => ({
  id: `archive-${index}`,
  clientName: `Dossier ${index}`,
  flags: { invoiced: true },
}));
const performanceResources = Array.from({ length: 4 }, (_, index) => ({
  id: `tolier-perf-${index + 1}`,
  name: `Tôlier performance ${index + 1}`,
  role: "tolier",
  active: true,
}));
resetState(performanceResources, [], largeCases);
const performanceProposals = [];
const performanceAssignments = [];
const startedAt = performance.now();
for (let index = 0; index < 24; index += 1) {
  const item = { id: `pdf-perf-${index}`, source: "pdf_estimate", durations: { body: 2 } };
  run(`state.cases.push(${JSON.stringify(item)});`);
  const proposal = context.generateSingleProposal(item, mondayStart);
  run(`generatedProposals[${JSON.stringify(item.id)}] = ${JSON.stringify({ proposal, availableDates: [] })};`);
  performanceProposals.push(proposal);
  performanceAssignments.push(getStep(proposal, "body").primaryResourceId);
}
const elapsedMs = Math.round((performance.now() - startedAt) * 10) / 10;
assert.ok(elapsedMs < 5000, `la sélection avec 4000 dossiers doit rester sous 5 s, reçu ${elapsedMs} ms`);
assert.equal(new Set(performanceAssignments).size, performanceResources.length, "toutes les ressources compatibles doivent être réellement exploitées");
assert.ok(performanceAssignments.some((resourceId) => resourceId !== "tolier-perf-1"), "la ressource numéro 1 ne doit pas recevoir systématiquement tous les dossiers");
assertNoResourceOverlap(performanceProposals, "performance 4000 dossiers");
const realPathItem = { id: "pdf-perf-real-path", source: "pdf_estimate", durations: { body: 2 } };
run(`state.cases.push(${JSON.stringify(realPathItem)});`);
const realPathStartedAt = performance.now();
const realPathOptions = context.generateAppointmentOptions(realPathItem);
const realPathElapsedMs = Math.round((performance.now() - realPathStartedAt) * 10) / 10;
assert.ok(realPathOptions.proposal?.steps?.length, "le chemin réel generateAppointmentOptions doit produire une proposition");
assert.ok(realPathElapsedMs < 5000, `generateAppointmentOptions avec 4000 dossiers doit rester sous 5 s, reçu ${realPathElapsedMs} ms`);
assertNoResourceOverlap([...performanceProposals, realPathOptions.proposal], "chemin réel performance 4000 dossiers");

console.log("Planning resource assignment OK");
console.log(JSON.stringify({
  freeTolier: getStep(freeTolierProposal, "body").primaryResourceId,
  fourPdfAssignments,
  painter: getStep(painterProposal, "prep").primaryResourceId,
  preparationZone: getStep(zoneProposal, "prep").equipmentResourceIds[0],
  commonPair: {
    technician: commonPrep.primaryResourceId,
    equipment: commonPrep.equipmentResourceIds[0],
    start: commonPrep.start,
  },
  lowerLoadWinner: getStep(lowerLoadProposal, "body").primaryResourceId,
  lunchSegments: lunchBody.segments,
  secondCaseWinner: getStep(secondProposal, "body").primaryResourceId,
  manualLock: getStep(manualProposal, "body").primaryResourceId,
  performance4000: {
    caseCount: 4000,
    proposals: performanceProposals.length,
    resourcesUsed: [...new Set(performanceAssignments)],
    elapsedMs,
    realPathElapsedMs,
    doubleBookings: 0,
  },
}, null, 2));
