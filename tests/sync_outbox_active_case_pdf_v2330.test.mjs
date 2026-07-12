import assert from "node:assert/strict";
import fs from "node:fs";
import { createNimrVmContext } from "./helpers/nimr_vm_context.mjs";

const { context, localStorage, run } = createNimrVmContext();

localStorage.clear();

const baseOperation = {
  operationId: "operation-first",
  workshopId: "workshop-test",
  entityType: "workshop_state",
  entityId: "workshop-test",
  action: "upsert_snapshot",
  expectedVersion: 7,
  snapshotFingerprint: "snapshot:v1",
  payload: {
    casesCount: 1,
    marker: "first",
    snapshotFingerprint: "snapshot:v1",
  },
  syncStatus: "pending",
  retryCount: 0,
  lastError: "",
};

await context.enqueueDurableOutboxOperation(baseOperation);
const mergedOperation = await context.enqueueDurableOutboxOperation({
  ...baseOperation,
  operationId: "operation-second",
  payload: { casesCount: 2, marker: "latest" },
  description: "payload le plus récent",
});

let operations = await context.loadDurableOutboxOperations();
assert.equal(operations.length, 1, "deux upsert_snapshot équivalents doivent produire une seule opération");
assert.equal(mergedOperation.operationId, "operation-first", "l'opération existante doit être réutilisée");
assert.equal(operations[0].payload.marker, "latest", "le payload le plus récent doit être conservé");
assert.equal(operations[0].retryCount, 0);
assert.equal(operations[0].lastError, "");

await context.updateDurableOutboxOperation(operations[0].operationId, {
  syncStatus: "processing",
  retryCount: 5,
  lastError: "",
});
await context.enqueueDurableOutboxOperation({
  ...baseOperation,
  operationId: "operation-during-active-sync",
  payload: {
    casesCount: 3,
    marker: "during-processing",
    snapshotFingerprint: "snapshot:v1",
  },
  syncStatus: "pending",
  retryCount: 0,
});
operations = await context.loadDurableOutboxOperations();
assert.equal(operations.length, 1, "une synchronisation active ne doit pas créer une seconde opération");
assert.equal(operations[0].syncStatus, "processing", "une opération saine en cours doit rester processing");
assert.equal(operations[0].retryCount, 5, "la réutilisation pendant une synchronisation ne doit pas augmenter retryCount");
assert.equal(operations[0].lastError, "", "une opération saine ne doit pas recevoir une erreur artificielle");

await context.enqueueDurableOutboxOperation({
  ...baseOperation,
  operationId: "operation-newer-state",
  snapshotFingerprint: "snapshot:v2",
  payload: {
    casesCount: 4,
    marker: "newer-state",
    snapshotFingerprint: "snapshot:v2",
  },
  syncStatus: "pending",
  retryCount: 0,
});
operations = await context.loadDurableOutboxOperations();
assert.equal(
  operations.length,
  1,
  "la modification plus récente doit réutiliser la même cible",
);
assert.equal(
  operations[0].syncStatus,
  "pending",
  "une modification plus récente pendant le traitement doit rester pending",
);
assert.equal(operations[0].snapshotFingerprint, "snapshot:v2");
assert.equal(operations[0].retryCount, 0);

await context.acknowledgeEquivalentDurableOutboxOperations(
  baseOperation,
  {
    updatedAt: "2026-07-12T10:00:00.000Z",
    snapshotFingerprint: "snapshot:v1",
  },
);
operations = await context.loadDurableOutboxOperations();
assert.equal(
  operations.length,
  1,
  "l'acquittement de l'ancien snapshot ne doit pas supprimer le nouveau",
);
assert.equal(operations[0].snapshotFingerprint, "snapshot:v2");
assert.equal(operations[0].syncStatus, "pending");

await context.acknowledgeEquivalentDurableOutboxOperations(
  {
    ...baseOperation,
    snapshotFingerprint: "snapshot:v2",
    payload: {
      ...baseOperation.payload,
      snapshotFingerprint: "snapshot:v2",
    },
  },
  {
    updatedAt: "2026-07-12T10:01:00.000Z",
    snapshotFingerprint: "snapshot:v2",
  },
);
operations = await context.loadDurableOutboxOperations();
assert.equal(
  operations.length,
  0,
  "seul le snapshot effectivement confirmé doit être retiré",
);
assert.equal(context.NIMR_OUTBOX_STATUS.pending, 0);
assert.equal(context.NIMR_OUTBOX_STATUS.lastError, "");

await context.putDurableOutboxOperation({
  ...baseOperation,
  operationId: "operation-legacy-failed",
  syncStatus: "failed",
  retryCount: 29,
  lastError: "ancienne erreur RLS",
});
await context.putDurableOutboxOperation({
  ...baseOperation,
  operationId: "operation-legacy-pending",
  syncStatus: "pending",
  retryCount: 0,
  lastError: "",
  payload: { marker: "pending-newer" },
});
await context.consolidateDurableOutboxOperations();
operations = await context.loadDurableOutboxOperations();
assert.equal(operations.length, 1, "les doublons historiques doivent être consolidés");
assert.equal(operations[0].syncStatus, "pending");
assert.equal(operations[0].retryCount, 0, "un doublon pending sain doit neutraliser le retryCount historique");
assert.equal(operations[0].lastError, "");
assert.equal(operations[0].payload.marker, "pending-newer");

const fingerprintResult = JSON.parse(run(`(() => {
  state.cases = [
    { id: "case-a", localRevision: 33 },
    { id: "case-b", localRevision: 10 }
  ];
  state.bookings = [];
  const before = getSyncStateFingerprint(state);
  const maxBefore = Math.max(
    ...state.cases.map((item) => Number(item.localRevision || 0))
  );
  state.cases[1].localRevision = 11;
  const after = getSyncStateFingerprint(state);
  const maxAfter = Math.max(
    ...state.cases.map((item) => Number(item.localRevision || 0))
  );
  return JSON.stringify({
    before,
    after,
    maxBefore,
    maxAfter
  });
})()`));
assert.equal(
  fingerprintResult.maxBefore,
  fingerprintResult.maxAfter,
  "le cas de régression doit conserver la même révision maximale",
);
assert.notEqual(
  fingerprintResult.before,
  fingerprintResult.after,
  "l'empreinte doit détecter la modification du second dossier",
);

const activeCaseResult = JSON.parse(run(`(() => {
  state.cases = [
    normalizeCase({
      id: "cloud-id-new",
      local_id: "local-stable-1",
      orNavNumber: "OR-2026-001",
      vin: "LGJE1234567890001",
      plate: "123 TU 4567"
    }),
    normalizeCase({ id: "fallback-case", orNavNumber: "OR-OTHER" })
  ];
  activeCaseId = "obsolete-local-id";
  const selected = reconcileActiveCaseSelection({
    id: "obsolete-local-id",
    localId: "local-stable-1",
    orNavNumber: "OR-2026-001",
    vin: "LGJE1234567890001",
    plate: "123 TU 4567"
  });
  return JSON.stringify({ selectedId: selected?.id, activeCaseId, localId: selected?.local_id });
})()`));
assert.equal(activeCaseResult.selectedId, "cloud-id-new", "le dossier doit être retrouvé malgré l'identifiant obsolète");
assert.equal(activeCaseResult.activeCaseId, "cloud-id-new");
assert.equal(activeCaseResult.localId, "local-stable-1");

const fallbackResult = JSON.parse(run(`(() => {
  state.cases = [
    normalizeCase({ id: "first-available", orNavNumber: "OR-FIRST" }),
    normalizeCase({ id: "second-available", orNavNumber: "OR-SECOND" })
  ];
  activeCaseId = "missing";
  const selected = reconcileActiveCaseSelection({ id: "missing", localId: "", orNavNumber: "", vin: "", plate: "" });
  return JSON.stringify({ selectedId: selected?.id, activeCaseId });
})()`));
assert.equal(fallbackResult.selectedId, "first-available");
assert.equal(fallbackResult.activeCaseId, "first-available");

const pdfPlanningResult = JSON.parse(run(`(() => {
  const item = normalizeCase({
    id: "pdf-ready",
    source: "pdf_estimate",
    pdfImportStatus: "ready_for_planning",
    pdfValidatedAt: "2026-07-12T08:00:00.000Z",
    claims: [{
      id: "claim-pdf-ready",
      includeInPlanning: true,
      status: "approved",
      estimate: {
        lines: [
          { id: "task-1", phase: "body", operation: "Tâche 1", laborHours: 12 },
          { id: "task-2", phase: "prep", operation: "Tâche 2", laborHours: 11.5 },
          { id: "task-3", phase: "paint", operation: "Tâche 3", laborHours: 12.3 },
          { id: "task-4", phase: "mechanical", operation: "Tâche 4", laborHours: 12 }
        ]
      }
    }]
  });
  state.cases = [item];
  state.bookings = [];
  state.resources = [];
  state.settings.fastLaneEnabled = false;
  activeCaseId = item.id;
  const totalHours = item.claims[0].estimate.lines.reduce((sum, line) => sum + Number(line.laborHours || 0), 0);
  const message = describePlanningAvailabilityFailure(
    item,
    { key: "body", title: "Tâche carrosserie", role: "tolier", equipmentRole: "" },
    Math.round(totalHours * 60),
    [],
    false,
    "Tâche carrosserie",
    { requiredSite: "internal" }
  );
  return JSON.stringify({
    ready: isPdfCaseReadyForPlanning(item),
    selectedId: getActiveCase()?.id,
    taskCount: item.claims[0].estimate.lines.length,
    totalHours,
    message,
    issues: getPlanningBusinessRuleIssues(item)
  });
})()`));
assert.equal(pdfPlanningResult.ready, true, "un PDF ready_for_planning avec pdfValidatedAt valide doit être planifiable");
assert.equal(pdfPlanningResult.selectedId, "pdf-ready", "le bouton doit utiliser le dossier courant retrouvé dans state.cases");
assert.equal(pdfPlanningResult.taskCount, 4);
assert.equal(pdfPlanningResult.totalHours, 47.8);
assert.match(pdfPlanningResult.message, /Aucun technicien compatible disponible/i);
assert.doesNotMatch(pdfPlanningResult.message, /dossier introuvable/i);
assert.ok(
  pdfPlanningResult.issues.every((issue) => !/chef atelier|validation chef/i.test(String(issue))),
  "un PDF réellement validé ne doit plus afficher À valider Chef Atelier",
);

const invalidPdfValidationResult = JSON.parse(run(`(() => {
  const item = normalizeCase({
    id: "pdf-invalid-date",
    source: "pdf_estimate",
    pdfImportStatus: "ready_for_planning",
    pdfValidatedAt: "date-invalide",
    claims: []
  });
  state.cases = [item];
  state.bookings = [];
  return JSON.stringify({
    ready: isPdfCaseReadyForPlanning(item),
    status: getCaseStatus(item),
    normalizedStatus: normalizeWorkshopCaseStatus(
      item.status,
      item
    )
  });
})()`));
assert.equal(invalidPdfValidationResult.ready, false);
assert.equal(
  invalidPdfValidationResult.status,
  "chief_validation",
);
assert.equal(
  invalidPdfValidationResult.normalizedStatus,
  "chief_validation",
);

const fingerprintProjectionResult = JSON.parse(run(`(() => {
  const base = {
    cases: [{ id: "case-fingerprint", localRevision: 7 }],
    bookings: [{ id: "booking-fingerprint", caseId: "case-fingerprint" }],
    syncLog: []
  };
  const before = getSyncStateFingerprint(base);
  const withRuntimeLog = {
    ...base,
    syncLog: [{
      id: "sync-log-runtime",
      at: "2026-07-12T19:00:00.000Z",
      source: "offline_queue",
      reason: "retry"
    }]
  };
  const afterRuntimeLog =
    getSyncStateFingerprint(withRuntimeLog);
  const withBusinessChange = {
    ...base,
    cases: [{
      ...base.cases[0],
      localRevision: 8
    }]
  };
  const afterBusinessChange =
    getSyncStateFingerprint(withBusinessChange);
  return JSON.stringify({
    before,
    afterRuntimeLog,
    afterBusinessChange
  });
})()`));
assert.equal(
  fingerprintProjectionResult.before,
  fingerprintProjectionResult.afterRuntimeLog,
  "syncLog ne doit pas recréer une opération outbox",
);
assert.notEqual(
  fingerprintProjectionResult.before,
  fingerprintProjectionResult.afterBusinessChange,
  "une modification métier doit changer l'empreinte",
);

const supabaseSource = fs.readFileSync(new URL("../js/supabase-sync.js", import.meta.url), "utf8");
const storageSource = fs.readFileSync(new URL("../js/storage.js", import.meta.url), "utf8");
const uiCasesSource = fs.readFileSync(new URL("../js/ui-cases.js", import.meta.url), "utf8");

assert.match(supabaseSource, /if \(autoSupabaseBackupPromise\)[\s\S]*return autoSupabaseBackupPromise;/u,
  "une synchronisation active doit partager la promesse serveur");
assert.match(supabaseSource, /const joiningActiveSync = Boolean\(autoSupabaseBackupPromise\)/u);
assert.match(supabaseSource, /joiningActiveSync[\s\S]*currentRetryCount/u,
  "une synchronisation rejointe ne doit pas augmenter retryCount");
assert.match(supabaseSource, /acknowledgeEquivalentDurableOutboxOperations/u,
  "le succès serveur doit nettoyer toutes les opérations équivalentes");
assert.match(
  supabaseSource,
  /acknowledgement\.snapshotFingerprint[\s\S]*actionSnapshotFingerprint/u,
  "une synchronisation ancienne doit comparer l'empreinte réellement envoyée",
);
assert.match(
  supabaseSource,
  /const snapshotStillCurrent =[\s\S]*currentFingerprint === sentFingerprint/u,
  "le succès cloud doit être comparé à l'état local courant",
);
assert.match(
  supabaseSource,
  /snapshotStillCurrent[\s\S]*clearLocalUserChangeAt/u,
  "le marqueur local ne doit être effacé que pour le snapshot courant",
);
assert.match(
  supabaseSource,
  /!snapshotStillCurrent[\s\S]*enqueueOfflineAction/u,
  "une modification apparue pendant l'envoi doit rester dans l'outbox",
);
assert.match(supabaseSource, /markLocalCasesAsSynced\(payload\.state\)/u,
  "seules les révisions réellement envoyées doivent être marquées synchronisées");
assert.match(
  storageSource,
  /workshopId[\s\S]*entityType[\s\S]*entityId[\s\S]*action[\s\S]*expectedVersion[\s\S]*snapshotFingerprint/u,
  "la clé d'équivalence doit inclure l'empreinte du snapshot",
);
assert.match(
  storageSource,
  /function getSyncStateFingerprint[\s\S]*window\.getSyncStateFingerprint = getSyncStateFingerprint/u,
  "l'empreinte doit être disponible dans le contexte durable chargé par les tests et l'application",
);
assert.match(
  storageSource,
  /function buildSyncFingerprintState[\s\S]*delete snapshot\.syncLog/u,
  "les journaux techniques ne doivent pas modifier l'empreinte métier",
);
assert.match(
  supabaseSource,
  /if \(supabaseLivePullPromise\) return supabaseLivePullPromise;[\s\S]*supabaseLivePullPromise = run/u,
  "les lectures cloud concurrentes doivent partager une seule promesse",
);
assert.match(uiCasesSource, /resolveCaseInCurrentState\(item\)/u,
  "le bouton de planification doit retrouver l'objet courant");
assert.match(uiCasesSource, /getPlanningBusinessRuleIssues\(currentItem\)/u,
  "la validation PDF réellement enregistrée doit être prise en compte");

console.log("SYNC OUTBOX ACTIVE CASE PDF V23.3.0 OK");
