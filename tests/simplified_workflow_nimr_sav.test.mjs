import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const indexSource = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");

[
  "Import devis PDF",
  "Importer un devis PDF",
  "Créer dossier depuis devis PDF",
].forEach((text) => {
  assert.ok(indexSource.includes(text), `l'accueil PDF-first doit afficher « ${text} »`);
});

[
  "Réception guidée",
  "Créer un nouveau dossier",
  "Motifs fréquents",
  "Réclamations client",
  "Demandes client",
  "Client démonstration",
].forEach((text) => {
  assert.equal(indexSource.includes(text), false, `l'ancien accueil ne doit plus afficher « ${text} »`);
});

const scriptFiles = [
  "../js/state.js",
  "../js/ui-cases.js",
  "../js/estimate-import.js",
  "../js/ui-planning.js",
  "../js/photos.js",
  "../js/storage.js",
  "../js/planning.js",
  "../js/exports.js",
  "../js/business-rules-v2187.js",
  "../js/utils.js",
  "../app.js",
];

const appSource = scriptFiles
  .map((file) => fs.readFileSync(new URL(file, import.meta.url), "utf8"))
  .join("\n")
  .replace(/initApp\(\);/, "// initApp skipped by simplified workflow tests")
  .replace(/if \("serviceWorker" in navigator[\s\S]*$/u, "");

function createElementStub() {
  return {
    value: "",
    textContent: "",
    innerHTML: "",
    hidden: false,
    dataset: {},
    style: {},
    classList: { add() {}, remove() {}, toggle() {} },
    setAttribute() {},
    removeAttribute() {},
    toggleAttribute() {},
    addEventListener() {},
    append() {},
    appendChild() {},
    replaceChildren() {},
    querySelector: () => createElementStub(),
    querySelectorAll: () => [],
  };
}

const context = {
  console,
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  document: {
    getElementById: () => createElementStub(),
    querySelector: () => createElementStub(),
    querySelectorAll: () => [],
    addEventListener: () => {},
    createElement: () => createElementStub(),
  },
  window: {},
  navigator: {},
  fetch: async () => ({ ok: false }),
  setTimeout,
  clearTimeout,
  Blob,
  URL: { createObjectURL: () => "", revokeObjectURL: () => {} },
  FormData: class FormData {},
};

context.globalThis = context;
context.addEventListener = () => {};
context.window = context;
vm.createContext(context);
vm.runInContext(appSource, context);
const run = (source) => vm.runInContext(source, context);

assert.equal(typeof context.getCaseStatus, "function", "getCaseStatus doit être exposé dans le contexte de test");
assert.equal(run("createDefaultState().cases.length"), 0, "le seed initial ne doit créer aucun dossier de démonstration");
assert.ok(appSource.includes('statuses: ["chief_validation"]'), "le Kanban doit afficher les dossiers en attente de validation Chef");

const normalizedPdfCase = JSON.parse(run(`JSON.stringify(normalizeCase({
  id: "case-pdf-round-trip",
  clientName: "Client PDF",
  source: "pdf_estimate",
  importedAt: "2026-07-10T08:30:00.000Z",
  pdfImportStatus: "chief_validation_pending",
  pdfValidatedAt: "2026-07-10T09:00:00.000Z",
  pdfValidatedBy: "chef-pdf",
  pdfEstimateFileName: "devis-terrain.pdf",
  pdfImportWarning: "Aucune main-d'œuvre détaillée détectée dans le devis.",
  pdfImportTaskCount: 1,
  claims: [{
    id: "claim-pdf-round-trip",
    title: "Diagnostic électrique",
    type: "client",
    status: "approved",
    includeInPlanning: true,
    estimate: {
      lines: [{
        phase: "electrical",
        operation: "Diagnostic électrique",
        laborHours: 1.5,
        requiredRole: "electricien",
        source: "pdf_estimate",
        status: "ready_for_validation"
      }],
      originalLines: [{
        operation: "Diagnostic électrique",
        laborHours: 1.5,
        source: "pdf_estimate",
        status: "ready_for_validation",
        allocations: [{
          phase: "electrical",
          operation: "Diagnostic électrique",
          laborHours: 1.5,
          requiredRole: "electricien",
          source: "pdf_estimate",
          status: "ready_for_validation"
        }]
      }]
    }
  }]
}))`));

assert.equal(normalizedPdfCase.source, "pdf_estimate", "la source PDF doit survivre à normalizeCase");
assert.equal(normalizedPdfCase.importedAt, "2026-07-10T08:30:00.000Z", "la date d'import PDF doit survivre à normalizeCase");
assert.equal(normalizedPdfCase.pdfImportStatus, "chief_validation_pending", "le statut de validation PDF doit survivre à normalizeCase");
assert.equal(normalizedPdfCase.pdfValidatedAt, "2026-07-10T09:00:00.000Z", "la date de validation Chef Atelier doit survivre à normalizeCase");
assert.equal(normalizedPdfCase.pdfValidatedBy, "chef-pdf", "l'auteur de validation Chef Atelier doit survivre à normalizeCase");
assert.equal(normalizedPdfCase.pdfEstimateFileName, "devis-terrain.pdf", "le nom du devis doit survivre à normalizeCase");
assert.equal(normalizedPdfCase.pdfImportWarning, "Aucune main-d'œuvre détaillée détectée dans le devis.", "l'alerte d'import doit survivre à normalizeCase");
assert.equal(normalizedPdfCase.pdfImportTaskCount, 1, "le nombre de tâches PDF doit survivre à normalizeCase");
assert.deepEqual(
  {
    requiredRole: normalizedPdfCase.claims[0].estimate.lines[0].requiredRole,
    source: normalizedPdfCase.claims[0].estimate.lines[0].source,
    status: normalizedPdfCase.claims[0].estimate.lines[0].status,
  },
  { requiredRole: "electricien", source: "pdf_estimate", status: "ready_for_validation" },
  "les métadonnées de tâche PDF doivent survivre au round-trip de normalisation",
);

run(`
state = normalizeState({
  cases: [{
    id: "case-pdf-chief-validation",
    clientName: "Client à compléter",
    source: "pdf_estimate",
    importedAt: "2026-07-10T08:30:00.000Z",
    pdfImportStatus: "chief_validation_pending",
    claims: [{
      id: "claim-pdf-chief-validation",
      title: "Travaux PDF",
      type: "client",
      status: "approved",
      includeInPlanning: true,
      estimate: {
        lines: [{ phase: "mechanical", operation: "Entretien", laborHours: 1 }]
      }
    }]
  }],
  bookings: []
});
`);

assert.equal(run("getCaseStatus(state.cases[0])"), "chief_validation", "un dossier PDF importé doit attendre la validation Chef Atelier");
assert.equal(run("statusLabels[getCaseStatus(state.cases[0])]"), "À valider Chef Atelier", "le statut PDF doit avoir le libellé métier attendu");
assert.equal(run("getCaseNextAction(state.cases[0]).code"), "validate_pdf_work", "l'action suivante doit être la validation des travaux PDF");
assert.equal(
  run("getCaseNextAction(state.cases[0]).label"),
  "Valider les travaux et préparer le planning",
  "l'action recommandée doit préparer explicitement le planning",
);

assert.equal(typeof context.getPdfTaskRequiredRole, "function", "le mapping des rôles PDF doit être exposé");
[
  ["body", "tolier"],
  ["oilService", "mecanicien"],
  ["mechanical", "mecanicien"],
  ["electrical", "electricien"],
  ["paint", "peintre"],
  ["quality", "controle"],
].forEach(([phase, expectedRole]) => {
  assert.equal(run(`getPdfTaskRequiredRole(${JSON.stringify(phase)})`), expectedRole, `la phase ${phase} doit cibler le rôle ${expectedRole}`);
});

const fallbackDraft = await run(`(async () => {
  const originalExtractor = extractEstimateTextFromFile;
  try {
    extractEstimateTextFromFile = async () => ({
      sourceType: "pdf",
      text: "DEVIS TEST SANS DETAIL DE MAIN D OEUVRE",
      rows: [],
      lines: ["DEVIS TEST SANS DETAIL DE MAIN D OEUVRE"]
    });
    const draft = await buildQuickEstimateCreationDraft({
      name: "devis-sans-mo.pdf",
      size: 64,
      lastModified: 1
    }, null);
    return JSON.parse(JSON.stringify({
      hasDetailedLabor: draft.hasDetailedLabor,
      laborLines: draft.parsed.laborLines,
      tasks: getPdfEstimateTaskRows(draft.parsed)
    }));
  } finally {
    extractEstimateTextFromFile = originalExtractor;
  }
})()`);

assert.equal(fallbackDraft.hasDetailedLabor, false, "un devis sans MO doit être identifié sans bloquer la création");
assert.equal(fallbackDraft.laborLines.length, 1, "un devis sans MO doit produire une ligne fallback unique");
assert.equal(fallbackDraft.laborLines[0].operation, "Travaux atelier à préciser", "le libellé fallback métier doit être explicite");
assert.equal(fallbackDraft.tasks.length, 1, "la ligne fallback doit devenir une tâche visible");
assert.deepEqual(
  {
    operation: fallbackDraft.tasks[0].operation,
    requiredRole: fallbackDraft.tasks[0].requiredRole,
    source: fallbackDraft.tasks[0].source,
    status: fallbackDraft.tasks[0].status,
  },
  {
    operation: "Travaux atelier à préciser",
    requiredRole: "tolier",
    source: "pdf_estimate",
    status: "ready_for_validation",
  },
  "la tâche fallback doit rester traçable et prête pour validation",
);

const fallbackPlanningRows = JSON.parse(run(`JSON.stringify(getImportedLaborReviewRows(normalizeCase({
  id: "case-pdf-fallback-planning",
  source: "pdf_estimate",
  pdfImportWarning: "Aucune main-d'œuvre détaillée détectée dans le devis.",
  claims: [{
    number: "OT-001",
    title: "Travaux PDF",
    estimate: {
      originalLines: [{
        operation: "Travaux atelier à préciser",
        laborHours: 0,
        requiredRole: "tolier",
        source: "pdf_estimate",
        status: "ready_for_validation",
        allocations: [{
          phase: "body",
          operation: "Travaux atelier à préciser",
          laborHours: 0,
          requiredRole: "tolier",
          source: "pdf_estimate",
          status: "ready_for_validation"
        }]
      }]
    }
  }]
})))`));
assert.equal(fallbackPlanningRows.length, 1, "la tâche fallback à 0 h doit rester visible dans la préparation Planning");
assert.equal(fallbackPlanningRows[0].operation, "Travaux atelier à préciser", "le Planning doit afficher le libellé fallback exact");
assert.equal(fallbackPlanningRows[0].allocations.length, 1, "la catégorie du fallback doit survivre à la normalisation");

const cleanedFallbackResult = JSON.parse(run(`(() => {
  const item = normalizeCase({
    id: "case-pdf-fallback-cleaner",
    source: "pdf_estimate",
    claims: [{
      id: "claim-pdf-fallback-cleaner",
      title: "Travaux PDF",
      estimate: {
        lines: [{
          phase: "body",
          operation: "Travaux atelier à préciser",
          laborHours: 0,
          requiredRole: "tolier",
          source: "pdf_estimate",
          status: "ready_for_validation"
        }],
        originalLines: [{
          operation: "Travaux atelier à préciser",
          laborHours: 0,
          requiredRole: "tolier",
          source: "pdf_estimate",
          status: "ready_for_validation",
          allocations: [{
            phase: "body",
            operation: "Travaux atelier à préciser",
            laborHours: 0,
            requiredRole: "tolier",
            source: "pdf_estimate",
            status: "ready_for_validation"
          }]
        }]
      }
    }]
  });
  window.cleanClaimEstimateForPlanning(item.claims[0]);
  recomputeCaseDurationsFromClaims(item);
  const rows = getImportedLaborReviewRows(item);
  return JSON.stringify({
    originalOperation: item.claims[0].estimate.originalLines[0]?.operation || "",
    appliedOperations: item.claims[0].estimate.lines.map((line) => line.operation),
    appliedHours: item.claims[0].estimate.lines.map((line) => line.laborHours),
    appliedMetadata: item.claims[0].estimate.lines.map((line) => ({ requiredRole: line.requiredRole, source: line.source, status: line.status })),
    originalAllocations: item.claims[0].estimate.originalLines[0]?.allocations || [],
    qualityHours: item.durations.quality,
    rowCount: rows.length,
    rowOperation: rows[0]?.operation || ""
  });
})()`));
assert.equal(cleanedFallbackResult.originalOperation, "Travaux atelier à préciser", "le cleaner planning ne doit pas supprimer le fallback");
assert.deepEqual(cleanedFallbackResult.appliedOperations, ["Travaux atelier à préciser"], "le cleaner ne doit pas remplacer le fallback par un contrôle qualité artificiel");
assert.deepEqual(cleanedFallbackResult.appliedHours, [0], "le cleaner doit conserver la durée fallback à 0 h");
assert.deepEqual(cleanedFallbackResult.appliedMetadata, [{ requiredRole: "tolier", source: "pdf_estimate", status: "ready_for_validation" }], "le fallback appliqué doit conserver rôle, source et statut");
assert.equal(cleanedFallbackResult.originalAllocations.length, 1, "le cleaner doit conserver l'allocation body du fallback à 0 h");
assert.deepEqual(
  {
    phase: cleanedFallbackResult.originalAllocations[0].phase,
    requiredRole: cleanedFallbackResult.originalAllocations[0].requiredRole,
    source: cleanedFallbackResult.originalAllocations[0].source,
    status: cleanedFallbackResult.originalAllocations[0].status,
  },
  { phase: "body", requiredRole: "tolier", source: "pdf_estimate", status: "ready_for_validation" },
  "l'allocation fallback nettoyée doit rester traçable",
);
assert.equal(cleanedFallbackResult.qualityHours, 0, "le fallback ne doit pas créer un contrôle qualité artificiel");
assert.equal(cleanedFallbackResult.rowCount, 1, "le fallback doit rester visible après le cleaner legacy");
assert.equal(cleanedFallbackResult.rowOperation, "Travaux atelier à préciser", "le fallback nettoyé doit garder son libellé exact");

const cleanedPdfMetadata = JSON.parse(run(`(() => {
  const item = normalizeCase({
    id: "case-pdf-metadata-cleaner",
    source: "pdf_estimate",
    claims: [{
      id: "claim-pdf-metadata-cleaner",
      title: "Cycle peinture PDF",
      estimate: {
        originalLines: [{
          operation: "PREPARATION ET PEINTURE AILE",
          laborHours: 3,
          source: "pdf_estimate",
          status: "ready_for_validation",
          allocations: [
            { phase: "prep", operation: "PREPARATION AILE", laborHours: 2, requiredRole: "peintre", source: "pdf_estimate", status: "ready_for_validation" },
            { phase: "paint", operation: "PEINTURE AILE", laborHours: 1, requiredRole: "peintre", source: "pdf_estimate", status: "ready_for_validation" }
          ]
        }]
      }
    }]
  });
  window.cleanClaimEstimateForPlanning(item.claims[0]);
  return JSON.stringify({
    originalAllocations: item.claims[0].estimate.originalLines[0].allocations,
    appliedLines: item.claims[0].estimate.lines.map((line) => ({
      phase: line.phase,
      requiredRole: line.requiredRole,
      source: line.source,
      status: line.status
    }))
  });
})()`));
assert.ok(cleanedPdfMetadata.originalAllocations.length >= 2, "le cleaner doit conserver les allocations du cycle peinture");
assert.ok(cleanedPdfMetadata.originalAllocations.every((line) => line.requiredRole === "peintre" && line.source === "pdf_estimate" && line.status === "ready_for_validation"), "les allocations nettoyées doivent conserver leurs métadonnées PDF");
assert.deepEqual(cleanedPdfMetadata.appliedLines.map((line) => line.phase).sort(), ["paint", "prep"], "le cleaner doit conserver uniquement les tâches réellement décrites dans le devis");
assert.ok(cleanedPdfMetadata.appliedLines.every((line) => line.requiredRole && line.source === "pdf_estimate" && line.status === "ready_for_validation"), "toutes les tâches appliquées doivent conserver rôle, source et statut");

const revalidationResult = JSON.parse(run(`(() => {
  const item = normalizeCase({
    id: "case-pdf-revalidation",
    source: "pdf_estimate",
    pdfImportStatus: "ready_for_planning",
    pdfValidatedAt: "2026-07-10T09:00:00.000Z",
    pdfValidatedBy: "Chef Atelier",
    plate: "123 TU 4567",
    claims: [{
      id: "claim-pdf-revalidation",
      title: "Travaux validés",
      status: "approved",
      includeInPlanning: true,
      estimate: {
        lines: [{ phase: "mechanical", operation: "Entretien modifié", laborHours: 2, status: "validated" }],
        originalLines: [{
          operation: "Entretien modifié",
          laborHours: 2,
          status: "validated",
          allocations: [{ phase: "mechanical", operation: "Entretien modifié", laborHours: 2, status: "validated" }]
        }]
      }
    }]
  });
  state.cases = [item];
  state.bookings = [];
  generatedProposals[item.id] = { proposal: { steps: [{ key: "mechanical" }] } };
  const invalidated = invalidatePdfChiefValidationAfterLaborChange(item, "Test modification MO");
  return JSON.stringify({
    invalidated,
    pdfImportStatus: item.pdfImportStatus,
    pdfValidatedAt: item.pdfValidatedAt,
    pdfValidatedBy: item.pdfValidatedBy,
    generatedProposal: generatedProposals[item.id],
    lineStatus: item.claims[0].estimate.lines[0].status,
    allocationStatus: item.claims[0].estimate.originalLines[0].allocations[0].status,
    appointmentIssues: getBusinessRuleIssues(item, "appointment")
  });
})()`));
assert.equal(revalidationResult.invalidated, true, "une modification MO après validation doit invalider la validation Chef");
assert.equal(revalidationResult.pdfImportStatus, "chief_validation_pending", "le dossier modifié doit revenir à À valider Chef Atelier");
assert.equal(revalidationResult.pdfValidatedAt, "", "la date de validation précédente doit être effacée");
assert.equal(revalidationResult.pdfValidatedBy, "", "l'auteur de validation précédent doit être effacé");
assert.equal(revalidationResult.generatedProposal, null, "la proposition calculée avant modification doit être invalidée");
assert.equal(revalidationResult.lineStatus, "ready_for_validation", "la ligne modifiée doit revenir prête pour validation");
assert.equal(revalidationResult.allocationStatus, "ready_for_validation", "l'allocation modifiée doit revenir prête pour validation");
assert.ok(
  revalidationResult.appointmentIssues.some((issue) => issue.includes("Chef Atelier")),
  "le planning doit rester bloqué jusqu'à la nouvelle validation Chef",
);

const allocationRevalidationResult = JSON.parse(run(`(() => {
  const item = normalizeCase({
    id: "case-pdf-allocation-revalidation",
    source: "pdf_estimate",
    pdfImportStatus: "ready_for_planning",
    pdfValidatedAt: "2026-07-10T09:00:00.000Z",
    pdfValidatedBy: "Chef Atelier",
    claims: [{
      id: "claim-pdf-allocation-revalidation",
      title: "Travaux validés",
      status: "approved",
      includeInPlanning: true,
      estimate: {
        originalLines: [{
          id: "line-pdf-allocation-revalidation",
          operation: "Entretien",
          laborHours: 2,
          selectedPhases: ["mechanical"],
          source: "pdf_estimate",
          status: "validated",
          allocations: [{ phase: "mechanical", operation: "Entretien", laborHours: 2, status: "validated" }]
        }]
      }
    }]
  });
  state.cases = [item];
  state.bookings = [];
  generatedProposals[item.id] = { proposal: { steps: [{ key: "mechanical" }] } };
  window.recalculateImportedLaborForCase(item);
  return JSON.stringify({
    pdfImportStatus: item.pdfImportStatus,
    generatedProposal: generatedProposals[item.id],
    lineStatus: item.claims[0].estimate.originalLines[0].status
  });
})()`));
assert.equal(allocationRevalidationResult.pdfImportStatus, "chief_validation_pending", "une nouvelle répartition MO doit invalider la validation Chef");
assert.equal(allocationRevalidationResult.generatedProposal, null, "une nouvelle répartition MO doit invalider la proposition planning");
assert.equal(allocationRevalidationResult.lineStatus, "ready_for_validation", "une ligne répartie doit revenir prête pour validation");

run(`
state = normalizeState({
  users: [{ id: "chef-simplified", name: "Chef atelier", role: "chef_atelier", active: true }],
  currentUserId: "chef-simplified",
  resources: [
    { id: "tech-atelier", name: "Technicien atelier", role: "mecanicien", active: true }
  ],
  cases: [{
    id: "case-simplified-archive",
    clientName: "Flux simplifié archive",
    plate: "123 TU 4567",
    appointment: {
      start: "2026-06-02T08:00:00.000Z",
      end: "2026-06-02T09:00:00.000Z"
    },
    flags: {
      received: true,
      workStarted: true,
      workCompleted: true
    },
    claims: [{
      id: "claim-simplified-archive",
      type: "client",
      includeInPlanning: true,
      estimate: {
        lines: [{ phase: "mechanical", operation: "Réparation atelier", laborHours: 1 }]
      }
    }]
  }],
  bookings: [{
    id: "booking-simplified-archive",
    caseId: "case-simplified-archive",
    key: "mechanical",
    resourceIds: ["tech-atelier"],
    status: "completed",
    completedAt: "2026-06-02T09:00:00.000Z",
    segments: [{
      start: "2026-06-02T08:00:00.000Z",
      end: "2026-06-02T09:00:00.000Z"
    }]
  }]
});
`, context);

assert.equal(
  run("getNextWorkflowAction(state.cases[0])"),
  "close",
  "après fin atelier, le flux simplifié doit demander la clôture atelier",
);
assert.equal(
  run('getBusinessRuleIssues(state.cases[0], "close").length'),
  0,
  "la clôture atelier ne doit pas être bloquée par une étape livraison/qualité masquée",
);

const closeResult = run('applyWorkflowAction(state.cases[0], "close")');
assert.equal(closeResult.ok, true, "la clôture atelier doit réussir");
assert.equal(run("getCaseStatus(state.cases[0])"), "closed", "le statut réel doit être clôturé atelier");
assert.equal(run("isCaseReadonlyArchive(state.cases[0])"), false, "la clôture ne doit pas se confondre avec l’archive");
assert.equal(run("getNextWorkflowAction(state.cases[0])"), "archive", "l’archive doit être proposée après la clôture");
assert.equal(run("getCaseNextAction(state.cases[0]).code"), "archive_case", "la prochaine action visible doit être l’archivage");

const archiveResult = run('applyWorkflowAction(state.cases[0], "archive")');
assert.equal(archiveResult.ok, true, "l’archive doit réussir après la clôture");
assert.equal(run("getCaseStatus(state.cases[0])"), "archived", "le statut final doit être archivé");
assert.equal(run("isCaseReadonlyArchive(state.cases[0])"), true, "le dossier archivé doit être readonly");
assert.equal(run("getCaseNextAction(state.cases[0]).code"), "done", "un dossier archivé ne doit plus proposer d’action opérationnelle");

console.log("Simplified workflow NIMR SAV OK");
