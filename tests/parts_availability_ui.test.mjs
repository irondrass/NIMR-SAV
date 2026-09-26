import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createNimrVmContext } from "./helpers/nimr_vm_context.mjs";

const context = { console, structuredClone };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(
  fs.readFileSync(new URL("../js/parts-availability.js", import.meta.url), "utf8"),
  context,
);

const uiModuleUrl = new URL("../js/parts-availability-ui.js", import.meta.url);
if (fs.existsSync(uiModuleUrl)) {
  vm.runInContext(fs.readFileSync(uiModuleUrl, "utf8"), context);
}

assert.equal(
  typeof context.collectCasePartsAvailabilityLines,
  "function",
  "le domaine UI Pièces OR doit être disponible",
);

const {
  applyPartsAvailabilityReview,
  buildPartsAvailabilityDraft,
  canManagePartsAvailability,
  collectCasePartsAvailabilityLines,
  deriveEffectivePartsStatus,
  formatPartsAvailabilityValidationErrors,
  getOrCreatePartsAvailabilityDraft,
  renderPartsAvailabilityFormHtml,
  savePartsAvailabilityReview,
} = context;

const reviewedAt = "2026-09-26T12:00:00.000Z";

function caseFixture() {
  return {
    id: "case-001",
    orNavNumber: "OR-2026-001",
    vehicle: "DFM RICH 6",
    plate: "123 TU 4567",
    vin: "LGJF1EE26KT418026",
    partsStatus: "unchecked",
    claims: [{
      id: "claim-001",
      number: "OT-001",
      estimate: {
        parts: [{
          sourcePartId: "estimate-part-001",
          designation: "Pare-chocs avant",
          quantity: 1,
        }],
      },
    }],
    expertEstimate: {
      parts: [{ id: "expert-part-001", designation: "Optique AVG", quantity: 1 }],
    },
    supplements: [{
      id: "supplement-001",
      number: "RC-001",
      parts: [{ id: "supplement-part-001", designation: "Agrafe", quantity: 4, notes: "Référence à confirmer" }],
    }],
  };
}

function lineSelection(sourceLines, unavailableIndexes, decisions = {}) {
  return sourceLines.map((line, index) => ({
    ...line,
    unavailable: unavailableIndexes.includes(index),
    canBeTaken: unavailableIndexes.includes(index) ? decisions[index] ?? null : null,
  }));
}

function validationCodes(error) {
  return (error.validationErrors || []).map((entry) => entry.code);
}

assert.equal(canManagePartsAvailability("responsable_magasin"), true);
assert.equal(canManagePartsAvailability("directeur_pieces"), true);
assert.equal(canManagePartsAvailability("chef_atelier"), false);

{
  const item = caseFixture();
  const snapshot = structuredClone(item);
  const lines = collectCasePartsAvailabilityLines(item);

  assert.deepEqual(item, snapshot, "la projection ne doit jamais muter les devis ou suppléments");
  assert.equal(lines.length, 3);
  assert.equal(lines[0].sourcePartId, "estimate-part-001", "sourcePartId explicite doit être préservé");
  assert.deepEqual(
    JSON.parse(JSON.stringify(lines.map((line) => line.sourceOrigin))),
    ["estimate:claim-001", "expert-estimate:case-001", "supplement:supplement-001"],
  );
  assert.equal(lines[2].note, "Référence à confirmer");
}

{
  const lines = collectCasePartsAvailabilityLines(caseFixture());
  const draft = buildPartsAvailabilityDraft(null, lines);
  const html = renderPartsAvailabilityFormHtml(caseFixture(), lines, draft);

  assert.match(html, /Toutes les pièces sont livrées/u);
  assert.doesNotMatch(html, /Prélèvement possible \?/u, "aucune décision ne doit apparaître pour une pièce disponible");
}

{
  const item = caseFixture();
  const lines = collectCasePartsAvailabilityLines(item);
  const review = applyPartsAvailabilityReview(item, {
    allDelivered: true,
    lines: lineSelection(lines, []),
    reviewedBy: "storekeeper-001",
    reviewedAt,
  });

  assert.equal(review.allDelivered, true);
  assert.equal(item.partsStatus, "available");
  assert.ok(review.lines.every((line) => line.unavailable === false && line.canBeTaken === null));
}

{
  const item = caseFixture();
  const lines = collectCasePartsAvailabilityLines(item);
  const draft = {
    allDelivered: false,
    lines: lineSelection(lines, [1], { 1: true }),
  };
  const html = renderPartsAvailabilityFormHtml(item, lines, draft);

  assert.equal((html.match(/Prélèvement possible \?/gu) || []).length, 1);
  assert.match(html, /value="true"[^>]*checked/u);

  const review = applyPartsAvailabilityReview(item, {
    ...draft,
    reviewedBy: "storekeeper-001",
    reviewedAt,
  });
  assert.equal(review.lines[1].canBeTaken, true);
  assert.equal(item.partsStatus, "partial");
}

{
  const item = caseFixture();
  const lines = collectCasePartsAvailabilityLines(item);
  const review = applyPartsAvailabilityReview(item, {
    allDelivered: false,
    lines: lineSelection(lines, [0], { 0: false }),
    reviewedBy: "storekeeper-001",
    reviewedAt,
  });

  assert.equal(review.lines[0].canBeTaken, false);
  assert.equal(item.partsStatus, "partial");
}

{
  const item = caseFixture();
  const lines = collectCasePartsAvailabilityLines(item);
  assert.throws(
    () => applyPartsAvailabilityReview(item, {
      allDelivered: false,
      lines: lineSelection(lines, [0]),
      reviewedBy: "storekeeper-001",
      reviewedAt,
    }),
    (error) => validationCodes(error).includes("CAN_BE_TAKEN_REQUIRED"),
  );
  assert.throws(
    () => applyPartsAvailabilityReview(item, {
      allDelivered: false,
      lines: lineSelection(lines, []),
      reviewedBy: "storekeeper-001",
      reviewedAt,
    }),
    (error) => validationCodes(error).includes("NO_UNAVAILABLE_PART_SELECTED"),
  );
}

{
  const item = caseFixture();
  const lines = collectCasePartsAvailabilityLines(item);
  applyPartsAvailabilityReview(item, {
    allDelivered: false,
    lines: lineSelection(lines, [0, 1, 2], { 0: true, 1: false, 2: false }),
    reviewedBy: "storekeeper-001",
    reviewedAt,
  });
  assert.equal(item.partsStatus, "waiting_parts");

  const reopened = buildPartsAvailabilityDraft(item.partsAvailabilityReview, lines);
  assert.equal(reopened.allDelivered, false);
  assert.deepEqual(JSON.parse(JSON.stringify(reopened.lines.map((line) => [line.unavailable, line.canBeTaken]))), [
    [true, true],
    [true, false],
    [true, false],
  ]);
}

{
  const item = caseFixture();
  item.id = "case-source-addition";
  const sourceSnapshot = structuredClone(item);
  const initialLines = collectCasePartsAvailabilityLines(item);
  const draft = getOrCreatePartsAvailabilityDraft(item, initialLines);
  draft.allDelivered = true;
  draft.lines[0].unavailable = true;
  draft.lines[0].canBeTaken = false;

  item.supplements[0].parts.push({
    id: "supplement-part-002",
    designation: "Support aile AVG",
    quantity: 1,
  });
  const evolvedSourceSnapshot = structuredClone(item);
  const reconciled = getOrCreatePartsAvailabilityDraft(item, collectCasePartsAvailabilityLines(item));

  assert.equal(reconciled.lines.length, 4);
  assert.equal(reconciled.lines[0].unavailable, true, "la décision indisponible existante doit être préservée");
  assert.equal(reconciled.lines[0].canBeTaken, false, "la décision de prélèvement existante doit être préservée");
  assert.equal(reconciled.lines[3].unavailable, false);
  assert.equal(reconciled.lines[3].canBeTaken, null);
  assert.equal(reconciled.allDelivered, false, "une nouvelle pièce doit invalider l'ancienne confirmation globale");
  assert.deepEqual(item, evolvedSourceSnapshot, "la réconciliation ne doit pas muter les pièces source");
  assert.equal(sourceSnapshot.supplements[0].parts.length, 1, "le snapshot initial doit rester indépendant");
}

{
  const item = caseFixture();
  item.id = "case-quantity-change";
  const initialLines = collectCasePartsAvailabilityLines(item);
  const draft = getOrCreatePartsAvailabilityDraft(item, initialLines);
  draft.allDelivered = true;

  item.claims[0].estimate.parts[0].quantity = 3;
  const evolvedSourceSnapshot = structuredClone(item);
  const reconciled = getOrCreatePartsAvailabilityDraft(item, collectCasePartsAvailabilityLines(item));

  assert.equal(reconciled.lines[0].sourceOrigin, initialLines[0].sourceOrigin);
  assert.equal(reconciled.lines[0].sourcePartId, initialLines[0].sourcePartId);
  assert.equal(reconciled.lines[0].quantity, 3);
  assert.equal(reconciled.allDelivered, false, "un changement de quantité doit exiger une nouvelle confirmation");
  assert.deepEqual(item, evolvedSourceSnapshot, "le changement de quantité ne doit pas être écrit dans la source par le draft");
}

{
  const item = caseFixture();
  const lines = collectCasePartsAvailabilityLines(item);
  let persistedCase = null;
  let vnPartCalls = 0;
  context.createVnPartRequest = () => { vnPartCalls += 1; };
  context.openCreateModal = () => { vnPartCalls += 1; };

  await savePartsAvailabilityReview(item, {
    allDelivered: false,
    lines: lineSelection(lines, [2], { 2: true }),
    reviewedBy: "storekeeper-001",
    reviewedAt,
  }, async (changedCase) => {
    persistedCase = changedCase;
    return true;
  });

  assert.equal(persistedCase, item);
  assert.equal(vnPartCalls, 0, "la sauvegarde Pièces OR ne doit jamais appeler VN-PART");
}

{
  const error = new TypeError("Revue invalide");
  error.validationErrors = [
    { code: "NO_UNAVAILABLE_PART_SELECTED", message: "Au moins une pièce indisponible doit être sélectionnée." },
  ];
  assert.match(formatPartsAvailabilityValidationErrors(error), /Au moins une pièce indisponible/u);
}

assert.equal(deriveEffectivePartsStatus({ partsStatus: "blocked_parts" }), "blocked_parts");

const { context: appContext, run } = createNimrVmContext({ filename: "parts-availability-ui-contract.js" });
vm.runInContext(fs.readFileSync(new URL("../js/parts-availability.js", import.meta.url), "utf8"), appContext);

assert.ok(appContext.getAllowedTabsForRole("responsable_magasin").includes("parts-availability"));
assert.ok(appContext.getAllowedTabsForRole("directeur_pieces").includes("parts-availability"));
assert.equal(appContext.getAllowedTabsForRole("chef_atelier").includes("parts-availability"), false);
assert.equal(appContext.getDefaultTabForRole("responsable_magasin"), "parts-availability");
assert.equal(
  typeof appContext.synchronizePartsAvailabilityStatus,
  "function",
  "une revue valide doit rester l'unique source de partsStatus pendant les sauvegardes",
);

const synchronizedStatus = JSON.parse(run(`JSON.stringify((() => {
  const item = {
    id: "sync-case",
    partsStatus: "blocked_parts",
    partsAvailabilityReview: {
      caseId: "sync-case",
      allDelivered: true,
      reviewedBy: "storekeeper-001",
      reviewedAt: "${reviewedAt}",
      lines: [{ sourcePartId: "p-1", designation: "A", quantity: 1, unavailable: false, canBeTaken: null }]
    }
  };
  return { status: synchronizePartsAvailabilityStatus(item), persistedStatus: item.partsStatus };
})())`));
assert.deepEqual(synchronizedStatus, { status: "available", persistedStatus: "available" });

run(`state = normalizeState({
  cases: [{
    id: "legacy-case",
    clientName: "Ancien dossier",
    partsStatus: "blocked_parts"
  }, {
    id: "reviewed-case",
    clientName: "Dossier revu",
    partsStatus: "blocked_parts",
    partsAvailabilityReview: {
      caseId: "reviewed-case",
      allDelivered: false,
      reviewedBy: "storekeeper-001",
      reviewedAt: "${reviewedAt}",
      lines: [
        { sourcePartId: "p-1", designation: "A", quantity: 1, unavailable: true, canBeTaken: false },
        { sourcePartId: "p-2", designation: "B", quantity: 1, unavailable: false, canBeTaken: null }
      ]
    }
  }],
  bookings: []
})`);

assert.equal(run(`state.cases.find((item) => item.id === "legacy-case").partsStatus`), "blocked_parts");
assert.equal(run(`state.cases.find((item) => item.id === "reviewed-case").partsStatus`), "partial");
assert.equal(run(`state.cases.find((item) => item.id === "reviewed-case").partsAvailabilityReview.lines.length`), 2);

console.log("PRELEVEMENT-AUDIT-001B parts availability UI: PASS");
