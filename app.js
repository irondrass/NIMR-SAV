let quickEstimateCreationDraft = null;

async function initApp() {
  try {
    if (typeof hydrateLargeStateIfAvailable === "function") {
      await hydrateLargeStateIfAvailable();
    }
    if (typeof loadDurableOutboxOperations === "function") {
      await loadDurableOutboxOperations().catch(() => []);
    }
    configurePdfWorker();
    bindMainNavigation();
    bindCaseList();
    bindCaseCreation();
    bindQuickCreateMode();
    populateCaseStatusFilters();
    bindCaseFilters();
    bindPlanningToolbar();
    bindWorkshopForms();
    bindBackupActions();
    if (typeof bindUserSessionActions === "function") bindUserSessionActions();
    if (typeof bindUserSessionIdleEvents === "function") bindUserSessionIdleEvents();
    if (typeof bindLocalSecurityControls === "function") bindLocalSecurityControls();
    bindOfflineStatus();
    bindSyncConflictUsability();
    if (typeof bindSupabaseActions === "function") bindSupabaseActions();
    bindVehicleLookup();
    bindKeyboardShortcuts();
    bindAutoSaveSafety();
    bindMobileResumeSafety();
    if (typeof migratePlanningLogicV28 === "function") migratePlanningLogicV28();
    if (typeof migratePlanningLogicV36 === "function") migratePlanningLogicV36();
    setActiveTab(activeTab || "dossiers");
    render();
    if (typeof initLocalSecurityGate === "function") initLocalSecurityGate();
    if (typeof checkUserSessionStartup === "function") checkUserSessionStartup();
    if (typeof resetUserSessionIdleTimer === "function") resetUserSessionIdleTimer();
    bindWorkHoursInputs();
    loadBundledVehicleDatabase();
    migrateLegacyPhotos();
    if (typeof cleanupOrphanedStorage === "function") {
      cleanupOrphanedStorage().catch(() => null);
    }
    registerServiceWorker();
    window.__nimrAppReady = true;
  } catch (error) {
    window.__nimrAppReady = false;
    console.error("Initialisation impossible", error);
    notifyUser("L'application n'a pas pu démarrer. Ouvrez la console navigateur pour le détail.", "error");
  }
}

function bindQuickCreateMode() {
  const toggle = $("#quick-create-mode");
  const form = $("#case-form");
  if (!toggle || !form) return;
  const applyMode = () => {
    form.classList.toggle("quick-create-enabled", toggle.checked);
    $$("[data-quick-optional]", form).forEach((field) => {
      field.hidden = toggle.checked;
    });
  };
  toggle.addEventListener("change", applyMode);
  applyMode();
}

function bindAutoSaveSafety() {
  window.addEventListener("beforeunload", forceEmergencyAutosave);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") forceEmergencyAutosave();
  });
  window.addEventListener("pagehide", forceEmergencyAutosave);
  window.setInterval(forceEmergencyAutosave, 10000);
}

function bindMobileResumeSafety() {
  const refreshForegroundState = () => {
    if (typeof refreshTechnicianElapsedTimers === "function") refreshTechnicianElapsedTimers();
    if (typeof renderSyncStatusStrip === "function") renderSyncStatusStrip();
  };
  window.addEventListener("focus", refreshForegroundState);
  window.addEventListener("pageshow", refreshForegroundState);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refreshForegroundState();
  });
}

function bindOfflineStatus() {
  const banner = $("#offline-banner");
  if (!banner) return;
  const refresh = () => {
    banner.hidden = navigator.onLine !== false;
    document.body.classList.toggle("is-offline", navigator.onLine === false);
    if (typeof renderSyncStatusStrip === "function") renderSyncStatusStrip();
  };
  window.addEventListener("online", () => {
    refresh();
    quietNotify("Connexion rétablie. La synchronisation Supabase va reprendre.", "success");
    if (typeof pullLatestSupabaseBackup === "function") pullLatestSupabaseBackup("online");
  });
  window.addEventListener("offline", () => {
    refresh();
    quietNotify("Mode hors ligne actif. Les données locales restent consultables.", "offline");
  });
  refresh();
}

function bindSyncConflictUsability() {
  const fallbackBtn = document.getElementById("fallback-resolve-conflict-btn");
  if (fallbackBtn) {
    fallbackBtn.addEventListener("click", () => {
      if (typeof navigateToConflictsAndFocus === "function") {
        navigateToConflictsAndFocus();
      }
    });
  }
}

function configurePdfWorker() {
  if (window.pdfjsLib?.GlobalWorkerOptions) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.min.js?v=23.2.8-full-audit";
  }
}

function bindMainNavigation() {
  $$(".nav-button").forEach((button) => {
    button.addEventListener("click", () => {
      const tab = button.dataset.tab;
      if (!tab) return;
      setActiveTab(tab);
      if (tab === "reception-workspace") focusPdfEstimateImport();
      if (tab === "today") renderTodayWorkshop();
      if (tab === "planning") renderPlanning();
      if (tab === "technician") renderTechnicianDashboard();
      if (tab === "atelier") {
        renderResources();
        renderFastLaneSettings();
        renderWorkHoursSettings();
        renderHolidays();
        renderResourceLeaves();
        bindWorkHoursInputs();
        if (typeof renderUsersAndRoles === "function") renderUsersAndRoles();
        if (typeof refreshSupabasePanel === "function") refreshSupabasePanel();
        if (typeof renderActivityLog === "function") renderActivityLog();
      }
      if (tab === "pilotage") {
        bindSavDashboardFilters();
        renderSavKpis();
        renderSavDashboardLoads();
        renderTodayWorkshop();
        renderPilotageAlerts();
        renderKanban();
      }
    });
  });
}

function bindCaseList() {
  $("#case-list")?.addEventListener("click", (event) => {
    const card = event.target.closest("[data-case]");
    if (!card) return;
    activeCaseId = card.dataset.case;
    activeCaseDetailTab = "infos";
    renderCases();
    renderCaseDetail();
  });

  $("#kanban-board")?.addEventListener("click", (event) => {
    const card = event.target.closest("[data-kanban-case]");
    if (!card) return;
    activeCaseId = card.dataset.kanbanCase;
    activeCaseDetailTab = "infos";
    setActiveTab("dossiers");
    renderCases();
    renderCaseDetail();
  });
}

function bindCaseCreation() {
  const form = $("#case-form");
  if (!form) return;
  const fileInput = $("#quick-estimate-file-input", form);
  const status = $("#quick-estimate-import-status");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const createGuard = guardCaseCreate();
    if (!createGuard.ok) return;
    const submitButton = $("#create-case-from-pdf", form);
    if (submitButton?.dataset.busy === "true") return;
    const estimateFile = fileInput?.files?.[0];
    if (!estimateFile) {
      notifyUser("Importez d’abord un devis PDF.", "error");
      fileInput?.focus();
      return;
    }

    const signature = getQuickEstimateFileSignature(estimateFile);
    if (!quickEstimateCreationDraft || quickEstimateCreationDraft.signature !== signature) {
      notifyUser("Attendez la fin de l’analyse du devis PDF.", "error");
      return;
    }

    const overrides = getPdfEstimateFormOverrides(form);
    const duplicateCandidate = {
      clientName: overrides.clientName,
      plate: overrides.plate,
      vin: overrides.vin,
    };
    const duplicate = (duplicateCandidate.clientName || duplicateCandidate.plate || duplicateCandidate.vin)
      ? findDuplicateCase(duplicateCandidate)
      : null;
    if (duplicate) {
      const confirmed = await showConfirmModal(`Un dossier similaire existe déjà (${escapeHtml(duplicate.clientName || duplicate.plate || duplicate.vin)}).<br><br>Créer quand même un dossier depuis ce devis PDF ?`);
      if (!confirmed) {
        activeCaseId = duplicate.id;
        activeCaseDetailTab = "claims";
        setActiveTab("dossiers");
        render();
        return;
      }
    }

    if (submitButton) {
      submitButton.dataset.busy = "true";
      submitButton.disabled = true;
    }
    try {
      const result = await createCaseFromPdfEstimate(quickEstimateCreationDraft, estimateFile, overrides);
      saveState();
      activeCaseId = result.item.id;
      activeCaseDetailTab = "planning";
      resetPdfEstimateCreation(form);
      setActiveTab("dossiers");
      render();
      notifyUser("Dossier créé depuis le devis PDF. Validez les travaux et préparez le planning.", "success");
    } catch (error) {
      console.warn("Création dossier depuis devis PDF impossible", error?.name || "Error", String(error?.message || "Erreur inconnue").replace(/\s+/g, " ").slice(0, 300));
      if (status) status.textContent = "Création impossible. Corrigez l’aperçu ou réimportez le PDF.";
      notifyUser(error.message || "Impossible de créer le dossier depuis ce devis PDF.", "error");
    } finally {
      if (submitButton) {
        delete submitButton.dataset.busy;
        if (quickEstimateCreationDraft) submitButton.disabled = false;
      }
    }
  });

  fileInput?.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    quickEstimateCreationDraft = null;
    hidePdfEstimateCreationPreview();
    clearPdfEstimateMetadataFields(form);
    if (!file) {
      if (status) status.textContent = "Sélectionnez un PDF texte pour afficher l’aperçu avant création.";
      return;
    }
    if (getFileExtension(file.name) !== "pdf" && file.type !== "application/pdf") {
      const message = "Format non supporté. Importez un devis PDF.";
      if (status) status.textContent = message;
      notifyUser(message, "error");
      return;
    }
    const validationError = validateEstimateImportFile(file);
    if (validationError) {
      if (status) status.textContent = validationError;
      notifyUser(validationError, "error");
      return;
    }
    const requestedSignature = getQuickEstimateFileSignature(file);
    try {
      if (status) status.textContent = "Lecture du devis en cours...";
      const draft = await buildQuickEstimateCreationDraft(file);
      if (getQuickEstimateFileSignature(fileInput.files?.[0]) !== requestedSignature) return;
      quickEstimateCreationDraft = draft;
      renderPdfEstimateCreationPreview(form, quickEstimateCreationDraft, file);
      if (status) status.textContent = "Devis analysé. Vérifiez l’aperçu avant de créer le dossier.";
    } catch (error) {
      if (getQuickEstimateFileSignature(fileInput.files?.[0]) !== requestedSignature) return;
      console.warn("Pré-import devis création impossible", error?.name || "Error", String(error?.message || "Échec extraction PDF.js").replace(/\s+/g, " ").slice(0, 300));
      quickEstimateCreationDraft = null;
      if (status) status.textContent = "Import devis impossible.";
      notifyUser(error.message || "Impossible de lire ce devis.", "error");
    }
  });

  $("#open-pdf-import-from-dossiers")?.addEventListener("click", () => {
    startReceptionCaseCreation();
  });
}

function focusPdfEstimateImport() {
  window.setTimeout(() => $("#quick-estimate-file-input")?.focus(), 40);
}

function startReceptionCaseCreation() {
  resetPdfEstimateCreation();
  setActiveTab("reception-workspace");
  focusPdfEstimateImport();
}

function hidePdfEstimateCreationPreview() {
  const preview = $("#pdf-estimate-creation-preview");
  if (preview) preview.hidden = true;
  const button = $("#create-case-from-pdf");
  if (button) button.disabled = true;
}

function resetPdfEstimateCreation(form = $("#case-form")) {
  quickEstimateCreationDraft = null;
  form?.reset();
  hidePdfEstimateCreationPreview();
  const status = $("#quick-estimate-import-status");
  if (status) status.textContent = "Sélectionnez un PDF texte pour afficher l’aperçu avant création.";
}

function clearPdfEstimateMetadataFields(form) {
  ["clientName", "phone", "vehicle", "plate", "vin", "mileage", "orNavNumber", "estimateNumber"].forEach((name) => {
    if (form?.elements?.[name]) form.elements[name].value = "";
  });
}

function getPdfEstimateFormOverrides(form) {
  const data = new FormData(form);
  return {
    clientName: normalizeTextInputValue(data.get("clientName")),
    phone: normalizeTextInputValue(data.get("phone")),
    vehicle: normalizeTextInputValue(data.get("vehicle")),
    plate: normalizeIdentifierValue(data.get("plate")),
    vin: normalizeIdentifierValue(data.get("vin")),
    mileage: normalizeIdentifierValue(data.get("mileage")),
    orNavNumber: normalizeIdentifierValue(data.get("orNavNumber")),
    estimateNumber: normalizeIdentifierValue(data.get("estimateNumber")),
  };
}

function getPdfTaskRequiredRole(phase) {
  const roles = {
    oilService: "mecanicien",
    mechanical: "mecanicien",
    electrical: "electricien",
    body: "tolier",
    reassembly: "tolier",
    prep: "peintre",
    paint: "peintre",
    finish: "peintre",
    quality: "controle",
    finalCheck: "controle",
  };
  return roles[phase] || "tolier";
}

function getPdfTaskRoleLabel(phase) {
  const role = getPdfTaskRequiredRole(phase);
  return ROLE_LABELS?.[role] || ({ mecanicien: "Mécanicien", electricien: "Électricien", tolier: "Tôlier", peintre: "Peintre", controle: "Chef Atelier / contrôle final" }[role] || role);
}

function getPdfEstimateTaskRows(parsed) {
  const aggregated = new Map();
  (parsed?.distributedLines || []).forEach((line) => {
    const phase = line.phase || "body";
    const isFallbackTask = Number(line.laborHours || 0) <= 0 && line.operation === "Travaux atelier à préciser";
    const task = aggregated.get(phase) || {
      id: `pdf-task-${phase}`,
      phase,
      operation: isFallbackTask ? "Travaux atelier à préciser" : (getDurationLabel(phase) || "Travaux atelier à préciser"),
      laborHours: 0,
      requiredRole: getPdfTaskRequiredRole(phase),
      roleLabel: getPdfTaskRoleLabel(phase),
      sourceLineIds: [],
      sourceOperations: [],
      source: "pdf_estimate",
      status: "ready_for_validation",
    };
    task.laborHours = roundPlanningHours(task.laborHours + Number(line.laborHours || 0));
    if (line.sourceLineId && !task.sourceLineIds.includes(line.sourceLineId)) task.sourceLineIds.push(line.sourceLineId);
    const sourceOperation = line.sourceOperation || line.operation || "";
    if (sourceOperation && !task.sourceOperations.includes(sourceOperation)) task.sourceOperations.push(sourceOperation);
    aggregated.set(phase, task);
  });
  return [...aggregated.values()];
}

function renderPdfEstimateCreationPreview(form, draft, file) {
  const preview = $("#pdf-estimate-creation-preview");
  if (!preview || !draft?.parsed) return;
  applyQuickEstimateCreationDraftToForm(form, draft);
  const info = draft.parsed.info || {};
  const taskRows = getPdfEstimateTaskRows(draft.parsed);
  const setValue = (selector, value) => {
    const target = $(selector);
    if (target) target.textContent = value;
  };
  setValue("#pdf-estimate-file-name", file?.name || draft.parsed.fileName || "devis.pdf");
  setValue("#pdf-estimate-labor-count", String(draft.hasDetailedLabor ? draft.parsed.laborLines.length : 0));
  setValue("#pdf-estimate-total-hours", `${formatLocalizedDecimal(draft.parsed.detectedHours || 0)} h`);
  setValue("#pdf-estimate-task-count", String(taskRows.length));

  const warning = $("#pdf-estimate-import-warning");
  if (warning) {
    warning.hidden = draft.hasDetailedLabor;
    warning.textContent = draft.hasDetailedLabor ? "" : "Aucune main-d’œuvre détaillée détectée dans le devis.";
  }

  const list = $("#pdf-estimate-labor-preview");
  if (list) {
    list.innerHTML = `<div class="pdf-import-task-list">${taskRows.map((task) => `
      <article class="pdf-import-task-row">
        <div><strong>${escapeHtml(task.operation)}</strong><small>Source PDF · Prêt pour validation</small></div>
        <div><span>${escapeHtml(getDurationLabel(task.phase) || task.phase)}</span><strong>${escapeHtml(task.roleLabel)}</strong></div>
        <b>${formatLocalizedDecimal(task.laborHours)} h</b>
      </article>
    `).join("")}</div>`;
  }

  const estimateNumber = cleanParsedEstimateNumber(info.estimateNumber);
  if (form.elements?.estimateNumber && !form.elements.estimateNumber.value) form.elements.estimateNumber.value = estimateNumber || "";
  preview.hidden = false;
  const button = $("#create-case-from-pdf");
  if (button) button.disabled = false;
}

async function createCaseFromPdfEstimate(draft, estimateFile = null, overrides = {}) {
  if (!draft?.parsed) throw new Error("Aucun aperçu PDF valide n’est disponible.");
  const createGuard = guardCaseCreate();
  if (!createGuard.ok) throw new Error(createGuard.message);

  const parsed = enrichParsedEstimateInfo(draft.parsed, draft.metadata);
  const info = parsed.info || {};
  const overrideOrDetected = (field, detectedField = field) => Object.prototype.hasOwnProperty.call(overrides, field)
    ? overrides[field]
    : (info[detectedField] || "");
  const importedAt = new Date().toISOString();
  const orderType = inferOrderTypeFromEstimate(parsed) || "client";
  const estimateNumber = cleanParsedEstimateNumber(overrideOrDetected("estimateNumber", "estimateNumber"));
  const item = normalizeCase({
    id: uid("case"),
    clientName: overrideOrDetected("clientName", "clientName") || "À compléter",
    phone: overrideOrDetected("phone", "phone"),
    vehicle: overrideOrDetected("vehicle", "vehicle") || "À compléter",
    plate: overrideOrDetected("plate", "plate"),
    vin: overrideOrDetected("vin", "vin"),
    mileage: overrideOrDetected("mileage", "mileage"),
    orNavNumber: overrideOrDetected("orNavNumber", "orNumber"),
    source: "pdf_estimate",
    importedAt,
    pdfImportStatus: "chief_validation_pending",
    pdfEstimateFileName: estimateFile?.name || parsed.fileName || "devis.pdf",
    pdfImportWarning: draft.hasDetailedLabor ? "" : "Aucune main-d’œuvre détaillée détectée dans le devis.",
    createdAt: importedAt,
    durations: Object.fromEntries(DURATIONS.map(([key]) => [key, 0])),
    history: [makeHistoryEntry("case.created.pdf", "Dossier créé depuis devis PDF", importedAt, "Import automatique atelier")],
  });

  const firstClaim = normalizeRepairClaim({
    id: uid("claim"),
    number: "OT-001",
    title: draft.hasDetailedLabor ? inferOrderTitleFromEstimate(parsed) : "Travaux atelier à préciser",
    type: orderType,
    status: "approved",
    includeInPlanning: true,
    estimateNumber,
    orNumber: item.orNavNumber || "",
  }, 0);
  item.claims = [firstClaim];

  const importGuard = guardEstimateImport(item, { silent: true });
  if (!importGuard.ok) throw new Error(importGuard.message);
  const preview = prepareEstimateImportPreview(parsed, item);
  if (estimateFile?.slice) preview.sourceFile = makeQuickEstimateSourceFile(estimateFile);
  await applyEstimateImportToClaim(item, firstClaim, preview, { silent: true });

  const appliedClaim = item.claims.find((claim) => claim.id === firstClaim.id) || item.claims[0];
  appliedClaim.status = "approved";
  appliedClaim.estimateNumber = estimateNumber;
  const taskRows = getPdfEstimateTaskRows(parsed);
  appliedClaim.estimate.lines = (appliedClaim.estimate.lines || []).map((line) => ({
    ...line,
    requiredRole: getPdfTaskRequiredRole(line.phase),
    source: "pdf_estimate",
    status: "ready_for_validation",
  }));
  appliedClaim.estimate.originalLines = (appliedClaim.estimate.originalLines || []).map((line) => ({
    ...line,
    requiredRole: getPdfTaskRequiredRole(line.allocations?.[0]?.phase || line.phase || "body"),
    source: "pdf_estimate",
    status: "ready_for_validation",
    allocations: (line.allocations || []).map((allocation) => ({
      ...allocation,
      requiredRole: getPdfTaskRequiredRole(allocation.phase),
      source: "pdf_estimate",
      status: "ready_for_validation",
    })),
  }));
  item.planningTasks = taskRows.map((task, index) => ({
    ...task,
    taskId: task.id,
    title: task.operation,
    durationMinutes: Math.round(Number(task.laborHours || 0) * 60),
    dependencies: index > 0 ? [taskRows[index - 1].id] : [],
    vehicleExclusive: true,
    parallelizable: false,
  }));
  DURATIONS.forEach(([key]) => {
    item.durations[key] = roundPlanningHours(taskRows
      .filter((task) => task.phase === key)
      .reduce((sum, task) => sum + Number(task.laborHours || 0), 0));
  });
  item.pdfImportTaskCount = taskRows.length;
  addHistory(item, "claim.estimate.imported", "Devis PDF importé automatiquement", `${formatLocalizedDecimal(preview.detectedHours)} h MO · ${item.pdfImportTaskCount} tâche(s) prête(s) pour validation.`);

  state.cases.unshift(item);
  let planningPreparation = null;
  if (draft.hasDetailedLabor && hasVehicleIdentity(item)) {
    planningPreparation = generateAppointmentOptions(item);
    generatedProposals[item.id] = planningPreparation;
  }
  return { item, claim: appliedClaim, preview, planningPreparation };
}


function getQuickEstimateFileSignature(file) {
  if (!file) return "";
  return [file.name || "devis", file.size || 0, file.lastModified || 0].join("|");
}

function makeQuickEstimateSourceFile(file) {
  return {
    id: uid("estimate-doc"),
    name: file.name || "devis-original.pdf",
    type: file.type || "application/octet-stream",
    size: file.size || 0,
    category: "claim_estimate_original",
    createdAt: new Date().toISOString(),
    blob: file.slice(0, file.size, file.type || "application/octet-stream"),
  };
}

function populateCaseStatusFilters() {
  const options = typeof getCaseStatusOptions === "function"
    ? getCaseStatusOptions()
    : Object.entries(statusLabels || {}).map(([value, label]) => ({ value, label }));
  ["#case-status-filter", "#sav-dashboard-status-filter"].forEach((selector) => {
    const select = $(selector);
    if (!select || select.dataset.statusOptionsPopulated === "true") return;
    const current = typeof normalizeCaseStatusFilter === "function"
      ? normalizeCaseStatusFilter(select.value || state.ui?.caseStatusFilter || "all")
      : (select.value || "all");
    select.replaceChildren();
    const all = document.createElement("option");
    all.value = "all";
    all.textContent = "Tous les statuts";
    select.appendChild(all);
    options.forEach(({ value, label }) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      select.appendChild(option);
    });
    select.value = current;
    select.dataset.statusOptionsPopulated = "true";
  });
}

async function buildQuickEstimateCreationDraft(file) {
  const extracted = await extractEstimateTextFromFile(file);
  const parsedBase = parseEstimateText(extracted.text, {
    fileName: file.name,
    sourceType: extracted.sourceType,
    rows: extracted.rows,
    lines: extracted.lines,
    claimType: "assurance",
  });
  const hasDetailedLabor = parsedBase.laborLines.length > 0;
  if (!hasDetailedLabor) {
    const fallbackOperation = "Travaux atelier à préciser";
    parsedBase.laborLines.push({
      type: "labor",
      text: fallbackOperation,
      operation: fallbackOperation,
      hours: 0,
      source: "pdf_estimate",
      status: "ready_for_validation",
      distributions: [{
        phase: "body",
        operation: fallbackOperation,
        laborHours: 0,
        requiredRole: "tolier",
        source: "pdf_estimate",
        status: "ready_for_validation",
      }],
    });
    parsedBase.distributedLines.push({
      id: uid("estimate-line"),
      phase: "body",
      operation: fallbackOperation,
      laborHours: 0,
      requiredRole: "tolier",
      source: "pdf_estimate",
      status: "ready_for_validation",
    });
  }
  const metadata = inferEstimateCreationMetadata(parsedBase, extracted);
  return {
    signature: getQuickEstimateFileSignature(file),
    parsed: enrichParsedEstimateInfo(parsedBase, metadata),
    metadata,
    extracted,
    hasDetailedLabor,
    warning: hasDetailedLabor ? "" : "Aucune main-d’œuvre détaillée détectée dans le devis.",
  };
}

function splitRawEstimateMetadataLines(text) {
  return String(text || "")
    .replace(/\u00a0/g, " ")
    .split(/\r?\n/)
    .map((line) => String(line || "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function cleanupEstimateVehicleDescription(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text
    .replace(/\s+\d{1,3}(?:\s?\d{3})?\s*$/i, "")
    .trim();
}

function enrichParsedEstimateInfo(parsed, metadata = {}) {
  const info = { ...(parsed?.info || {}) };
  Object.entries(metadata || {}).forEach(([key, value]) => {
    if (value && !String(info[key] || "").trim()) info[key] = value;
  });
  return { ...parsed, info };
}

function applyQuickEstimateCreationDraftToForm(form, draft) {
  if (!form || !draft?.parsed) return;
  const info = draft.parsed.info || {};
  const setWhenEmpty = (name, value) => {
    const field = form.elements?.[name];
    if (!field || !value || String(field.value || "").trim()) return;
    field.value = value;
    field.dispatchEvent(new Event("input", { bubbles: true }));
  };
  setWhenEmpty("clientName", info.clientName);
  setWhenEmpty("phone", info.phone);
  setWhenEmpty("vehicle", info.vehicle);
  setWhenEmpty("plate", info.plate);
  setWhenEmpty("mileage", info.mileage);
  setWhenEmpty("vin", info.vin);
  setWhenEmpty("orNavNumber", info.orNumber);
  setWhenEmpty("estimateNumber", cleanParsedEstimateNumber(info.estimateNumber));
  const orderTypeField = form.elements?.orderType;
  if (orderTypeField && (!orderTypeField.dataset.userSelected || orderTypeField.value === "assurance")) {
    const inferredType = inferOrderTypeFromEstimate(draft.parsed);
    if (inferredType) {
      orderTypeField.value = inferredType;
      orderTypeField.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }
  setWhenEmpty("orderTitle", inferOrderTitleFromEstimate(draft.parsed));
}

function inferOrderTypeFromEstimate(parsed) {
  const operations = (parsed?.laborLines || []).map((line) => normalizeEstimateOperationText(line.operation || line.text || "")).join(" ");
  if (!operations) return "client";
  if (/\bVIDANGE\b|\bENTRETIEN\b|\bSERVICE\s+RAPIDE\b/.test(operations)) return "vidange";
  if (/\bDIAGNOSTIC\b|\bCONTROLE\b|\bRECHERCHE\s+PANNE\b/.test(operations)) return "diagnostic";
  if (/\bELECTRIQUE\b|\bELECTRICITE\b|\bDIAGNOSTIC\b|\bBATTERIE\b|\bAIRBAG\b|\bFAISCEAU\b|\bCAPTEUR\b|\bALTERNATEUR\b|\bDEMARREUR\b/.test(operations)) return "electrical_client";
  if (/\bMECANIQUE\b|\bMECAN\b|\bFREIN\b|\bSUSPENSION\b|\bEMBRAYAGE\b|\bMOTEUR\b|\bDISTRIBUTION\b|\bBOITE\b/.test(operations)) return "mechanical_client";
  return "client";
}

function inferOrderTitleFromEstimate(parsed) {
  const firstOperation = parsed?.laborLines?.[0]?.operation || "";
  const normalized = normalizeEstimateOperationText(firstOperation);
  if (/\bVIDANGE\b|\bENTRETIEN\b/.test(normalized)) return "Vidange / entretien";
  if (/\bELECTRIQUE\b|\bDIAGNOSTIC\b|\bBATTERIE\b|\bAIRBAG\b/.test(normalized)) return "Réparation électrique";
  if (/\bMECANIQUE\b|\bFREIN\b|\bSUSPENSION\b|\bEMBRAYAGE\b|\bMOTEUR\b/.test(normalized)) return "Réparation mécanique";
  const cleaned = firstOperation.replace(/\s+\d+(?:[,.]\d+)?\s*$/g, "").trim();
  return cleaned || "Ordre de réparation";
}

function inferEstimateCreationMetadata(parsed, extracted = {}) {
  const text = String(extracted.text || "");
  const lines = splitRawEstimateMetadataLines(text);
  const metadata = { ...(parsed?.info || {}) };
  const textOneLine = text.replace(/\s+/g, " ").trim();
  const estimateMatch = textOneLine.match(/\b(DV-[A-Z0-9-]+)\b/i);
  const orMatch = textOneLine.match(/\b(OR-[A-Z0-9-]+)\b/i);
  if (estimateMatch) metadata.estimateNumber = metadata.estimateNumber || estimateMatch[1].toUpperCase();
  if (orMatch) metadata.orNumber = metadata.orNumber || orMatch[1].toUpperCase();

  const plateVinMatch = textOneLine.match(/\b(\d{1,6}\s*TU\s*\d{1,6})\s+([A-HJ-NPR-Z0-9]{17})\b/i);
  if (plateVinMatch) {
    metadata.plate = metadata.plate || plateVinMatch[1].replace(/\s+/g, "").toUpperCase();
    metadata.vin = metadata.vin || plateVinMatch[2].toUpperCase();
  }

  const clientIndex = lines.findIndex((line) => /^CLT[-\s]?\d+/i.test(line));
  if (clientIndex >= 0) {
    metadata.clientNumber = metadata.clientNumber || lines[clientIndex];
    const clientLine = lines.slice(clientIndex + 1, clientIndex + 4).find((line) => !/^(Fax|Tel|N°|No|Devis|Date|Page)\b/i.test(line));
    if (clientLine) metadata.clientName = metadata.clientName || clientLine;
  }
  const telLine = lines.find((line) => /^Tel\b/i.test(line));
  if (telLine) {
    const phone = telLine.replace(/^Tel\s*[:\-]?\s*/i, "").trim();
    if (phone) metadata.phone = metadata.phone || phone;
  }

  const vehicleHeaderIndex = lines.findIndex((line) => /Description\s+mod[èe]le/i.test(line) && /Kilom[èe]trage/i.test(line));
  const brandLineIndex = lines.findIndex((line) => /^(DFM|DONGFENG|CHERY|HYUNDAI|KIA|TOYOTA|PEUGEOT|RENAULT|NISSAN|VOLKSWAGEN|MG|HAVAL|FIAT|CITROEN|MITSUBISHI|ISUZU)\b/i.test(line));
  const vehicleSourceIndex = brandLineIndex >= 0 ? brandLineIndex : vehicleHeaderIndex + 1;
  if (vehicleSourceIndex >= 0 && lines[vehicleSourceIndex]) {
    const vehicleRaw = lines[vehicleSourceIndex];
    const mileageInVehicleLine = vehicleRaw.match(/\b(\d{1,3}(?:\s?\d{3})+)\b\s*$/);
    const withoutMileage = mileageInVehicleLine ? vehicleRaw.slice(0, mileageInVehicleLine.index).trim() : vehicleRaw;
    const cleanedVehicle = cleanupEstimateVehicleDescription(withoutMileage);
    if (cleanedVehicle) metadata.vehicle = metadata.vehicle || cleanedVehicle;
    if (mileageInVehicleLine) metadata.mileage = metadata.mileage || mileageInVehicleLine[1].replace(/\s+/g, "");
    const mileageText = [lines[vehicleSourceIndex], lines[vehicleSourceIndex + 1] || "", lines[vehicleSourceIndex + 2] || ""].join(" ");
    const mileageMatch = mileageText.match(/\b(\d{1,3}(?:\s\d{3})+)\b/);
    if (mileageMatch) metadata.mileage = metadata.mileage || mileageMatch[1].replace(/\s+/g, "");
  }
  return metadata;
}

function bindCaseFilters() {
  populateCaseStatusFilters();
  const search = $("#case-search");
  let searchDebounceTimer = null;
  search?.addEventListener("input", () => {
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      searchDebounceTimer = null;
      if (typeof resetCaseListPagination === "function") resetCaseListPagination();
      renderCases();
    }, 180);
  });

  const status = $("#case-status-filter");
  if (status) {
    status.value = normalizeCaseStatusFilter(state.ui?.caseStatusFilter);
    status.addEventListener("change", () => {
      state.ui.caseStatusFilter = normalizeCaseStatusFilter(status.value);
      status.value = state.ui.caseStatusFilter;
      if (typeof resetCaseListPagination === "function") resetCaseListPagination();
      saveState();
      renderCases();
    });
  }

  const type = $("#case-type-filter");
  if (type) {
    type.value = state.ui?.caseTypeFilter || "all";
    type.addEventListener("change", () => {
      state.ui.caseTypeFilter = type.value;
      if (typeof resetCaseListPagination === "function") resetCaseListPagination();
      saveState();
      renderCases();
    });
  }

  const sort = $("#case-sort");
  if (sort) {
    sort.value = state.ui?.caseSort || "recent";
    sort.addEventListener("change", () => {
      state.ui.caseSort = sort.value;
      if (typeof resetCaseListPagination === "function") resetCaseListPagination();
      saveState();
      renderCases();
    });
  }
}

function bindPlanningToolbar() {
  $("#print-day-gantt")?.addEventListener("click", () => printDailyPlanningGantt(state.planningDate));
  $("#print-day-planning")?.addEventListener("click", () => printDailyPlanning(state.planningDate));
  $("#prev-day")?.addEventListener("click", () => changePlanningDay(-1));
  $("#next-day")?.addEventListener("click", () => changePlanningDay(1));
  $("#today-button")?.addEventListener("click", () => {
    state.planningDate = todayKey(new Date());
    saveState();
    renderPlanning();
    renderMetrics();
  });
}

function changePlanningDay(delta) {
  state.planningDate = todayKey(addDays(parseDateKey(state.planningDate), delta));
  saveState();
  renderPlanning();
  renderMetrics();
}

function bindWorkshopForms() {
  $("#resource-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const permission = guardAction("resource.manage", {}, { notify: false });
    if (!permission.ok) return notifyUser(permission.message, "error");
    const form = event.currentTarget;
    const data = new FormData(form);
    state.resources.push(normalizeResource({
      id: uid("resource"),
      name: normalizeTextInputValue(data.get("name")),
      role: data.get("role"),
      location: normalizeTextInputValue(data.get("location")),
      site: data.get("site") === "external" ? "external" : "internal",
      kind: data.get("site") === "external" ? "external" : "internal",
      external: data.get("site") === "external",
      capacity: Math.max(1, Number(data.get("capacity") || 1) || 1),
      simultaneousCapacity: Math.max(1, Number(data.get("capacity") || 1) || 1),
      dailyCapacityMinutes: Number(data.get("dailyCapacityMinutes") || 0) || null,
      compatibleRoles: String(data.get("compatibleRoles") || "").split(",").map((value) => value.trim()).filter(Boolean),
      transferOutMinutes: Math.max(0, Number(data.get("transferOutMinutes") || 0) || 0),
      transferReturnMinutes: Math.max(0, Number(data.get("transferReturnMinutes") || 0) || 0),
      standardLeadTimeMinutes: Math.max(0, Number(data.get("standardLeadTimeMinutes") || 0) || 0),
      fastLane: Boolean(data.get("fastLane")),
      active: true,
    }));
    saveState();
    form.reset();
    render();
  });

  $("#fastlane-form")?.addEventListener("change", updateFastLaneSettings);
  $("#fastlane-form")?.addEventListener("input", updateFastLaneSettings);

  $("#holiday-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const permission = guardAction("planning.edit", {}, { notify: false });
    if (!permission.ok) return notifyUser(permission.message, "error");
    const form = event.currentTarget;
    const data = new FormData(form);
    const date = data.get("date");
    const label = normalizeTextInputValue(data.get("label"));
    if (!date || !label) return;
    state.holidays = state.holidays.filter((holiday) => holiday.date !== date);
    state.holidays.push({ date, label });
    saveState();
    form.reset();
    renderPlanning();
    renderHolidays();
  });


  $("#resource-leave-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const permission = guardAction("planning.edit", {}, { notify: false });
    if (!permission.ok) return notifyUser(permission.message, "error");
    const form = event.currentTarget;
    const data = new FormData(form);
    const resourceId = data.get("resourceId");
    const start = new Date(data.get("start"));
    const end = new Date(data.get("end"));
    const label = normalizeTextInputValue(data.get("label")) || "Congé / absence";
    if (!resourceId || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      notifyUser("Renseignez une ressource et une période de congé valide.", "error");
      return;
    }
    const conflicts = getResourceLeaveConflicts(resourceId, start, end);
    if (conflicts.length) {
      const details = conflicts
        .slice(0, 3)
        .map((booking) => `${booking.title || getDurationLabel(booking.key) || "Tâche"} · ${formatDateTime(booking.start)}`)
        .join(" / ");
      notifyUser(`Cette absence chevauche ${conflicts.length} tâche(s) atelier. Replanifiez les tâches non démarrées ou mettez en pause la tâche en cours avant d'ajouter l'absence.${details ? ` ${details}` : ""}`, "error");
      return;
    }
    state.bookings.push(normalizeBooking({
      id: uid("leave"),
      type: "leave",
      caseId: "__leave__",
      title: label,
      key: "leave",
      start: start.toISOString(),
      end: end.toISOString(),
      resourceIds: [resourceId],
      primaryResourceId: resourceId,
      segments: [{ start: start.toISOString(), end: end.toISOString() }],
      color: "#6b7280",
    }, new Set(state.resources.map((resource) => resource.id))));
    saveState();
    form.reset();
    renderPlanning();
    renderResourceLeaves();
    renderMetrics();
  });

  $("#user-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const userId = data.get("userId");
    const name = normalizeTextInputValue(data.get("name"));
    const role = data.get("role");
    const email = normalizeTextInputValue(data.get("email"));
    const resourceId = data.get("resourceId") || "";
    const active = form.elements.active.checked;

    // Lire le PIN
    const pin = form.elements.pin ? form.elements.pin.value : "";
    const isSensitive = ["admin_technique", "directeur", "chef_atelier"].includes(normalizeUserRole(role));

    const existingUser = userId ? getUserById(userId) : null;
    let pinData = {};
    if (pin) {
      try {
        pinData = await createLocalPinCredentials(pin);
      } catch (error) {
        return notifyUser(error.message || "PIN de sécurité trop faible.", "error");
      }
    } else if (isSensitive && !existingUser?.pinHash) {
      return notifyUser("Définissez un PIN initial robuste pour ce rôle sensible avant d'enregistrer l'utilisateur.", "error");
    }

    let result;
    if (userId) {
      result = updateUserLocal(userId, { name, role, email, resourceId, active, ...pinData });
    } else {
      result = createUserLocal({ name, role, email, resourceId, active, ...pinData });
    }

    if (!result.ok) {
      return notifyUser(result.message, "error");
    }

    saveState();
    form.reset();
    form.elements.userId.value = "";

    const submitLabel = document.getElementById("user-submit-label");
    if (submitLabel) submitLabel.textContent = "Ajouter l'utilisateur";

    const cancelBtn = document.getElementById("user-cancel-btn");
    if (cancelBtn) cancelBtn.hidden = true;

    render();
    quietNotify(userId ? "Utilisateur mis à jour." : "Utilisateur créé.", "success");
  });

  $("#user-cancel-btn")?.addEventListener("click", () => {
    const form = document.getElementById("user-form");
    if (form) {
      form.reset();
      form.elements.userId.value = "";
      const submitLabel = document.getElementById("user-submit-label");
      if (submitLabel) submitLabel.textContent = "Ajouter l'utilisateur";
      const cancelBtn = document.getElementById("user-cancel-btn");
      if (cancelBtn) cancelBtn.hidden = true;
    }
  });

  $("#current-user-selector")?.addEventListener("change", (event) => {
    const newUserId = event.currentTarget.value;
    if (!newUserId) return;
    const user = getUserById(newUserId);
    if (!user || user.active === false) {
      notifyUser("Utilisateur inactif ou invalide.", "error");
      render();
      return;
    }
    if (setCurrentUser(newUserId)) {
      resetSensitiveUiStateForUserSwitch("sélecteur paramètres");
      addAuditLog("users.current_changed", `Changement d'utilisateur actif : ${user.name}`);
      saveState();
      render();
      quietNotify("Utilisateur actif mis à jour.", "success");
    } else {
      notifyUser("Impossible de basculer d'utilisateur.", "error");
    }
  });

  bindWorkHoursInputs();
}

function getResourceLeaveConflicts(resourceId, start, end) {
  return state.bookings.filter((booking) => {
    if (!booking || booking.type === "leave") return false;
    if (!booking.resourceIds?.includes(resourceId)) return false;
    return (booking.segments || []).some((segment) => {
      const segmentStart = new Date(segment.start);
      const segmentEnd = new Date(segment.end);
      return segmentStart < end && segmentEnd > start;
    });
  });
}

function updateFastLaneSettings() {
  const form = $("#fastlane-form");
  if (!form) return;
  const permission = guardAction("planning.edit", {}, { notify: false });
  if (!permission.ok) return notifyUser(permission.message, "error");
  state.settings.fastLaneEnabled = Boolean(form.elements.fastLaneEnabled.checked);
  state.settings.fastLaneMaxHours = Math.max(0, roundHours(parseLocalizedDecimal(form.elements.fastLaneMaxHours.value || FAST_LANE_DEFAULT_HOURS)));
  saveState();
  renderMetrics();
}

function bindWorkHoursInputs() {
  $$("[data-work-day]").forEach((input) => {
    if (input.dataset.bound === "true") return;
    input.dataset.bound = "true";
    input.addEventListener("change", () => {
      const permission = guardAction("planning.edit", {}, { notify: false });
      if (!permission.ok) {
        notifyUser(permission.message, "error");
        input.value = formatWorkIntervals(state.workHours[input.dataset.workDay] || []);
        return;
      }
      try {
        state.workHours[input.dataset.workDay] = parseWorkIntervals(input.value);
        saveState();
        renderPlanning();
        renderMetrics();
      } catch (error) {
        notifyUser(error.message, "error");
        input.value = formatWorkIntervals(state.workHours[input.dataset.workDay] || []);
      }
    });
  });
}

function bindBackupActions() {
  $("#export-backup")?.addEventListener("click", exportBackup);
  $("#export-encrypted-backup")?.addEventListener("click", exportEncryptedBackup);
  $("#test-encrypted-backup")?.addEventListener("change", testEncryptedBackup);
  $("#import-backup")?.addEventListener("change", importBackup);
  $("#control-autosave")?.addEventListener("click", controlAutosaveHealth);
  $("#export-safety-snapshot")?.addEventListener("click", exportSafetySnapshotNow);
  $("#restore-auto-snapshot")?.addEventListener("click", restoreLatestAutomaticSnapshot);
  applyBackupPermissionState();
  renderAutosaveHealthStatus();
}

function applyBackupPermissionState() {
  [
    ["#export-backup", "export.backup"],
    ["#export-encrypted-backup", "export.backup"],
    ["#import-backup", "import.backup"],
    ["#restore-auto-snapshot", "import.backup"],
    ["#export-safety-snapshot", "export.backup"],
  ].forEach(([selector, permission]) => {
    const target = $(selector);
    if (!target) return;
    const guard = guardSensitiveAction(permission, {}, { notify: false });
    target.disabled = !guard.ok;
    target.title = guard.message;
    target.closest("label")?.classList.toggle("disabled-card", !guard.ok);
  });
}

function bindVehicleLookup() {
  $("#quick-vehicle-file-input")?.addEventListener("change", handleQuickVehicleFile);
  $("#case-form")?.elements?.plate?.addEventListener("input", renderQuickVinResults);
  $("#case-form")?.elements?.vin?.addEventListener("input", renderQuickVinResults);
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type === "APP_UPDATED") {
      forceEmergencyAutosave();
      notifyUser("Nouvelle version prête. Cliquez sur la bannière pour recharger au bon moment.", "success");
    }
  });
  const registerCurrentServiceWorker = async () => {
    try {
      const registration = await navigator.serviceWorker.register("sw.js?v=23.2.8-full-audit", { updateViaCache: "none" });
      const refreshRegistration = async () => {
        try {
          await registration.update?.();
        } catch (error) {
          console.warn("Mise à jour du service worker impossible", error);
        }
      };
      await refreshRegistration();
      if (registration.waiting) showUpdateAvailable(registration);
      window.setInterval(refreshRegistration, 10 * 60 * 1000);
      setupServiceWorkerUpdates(registration);
    } catch (error) {
      console.warn("Service worker non enregistré", error);
    }
  };
  if (document.readyState === "complete") {
    registerCurrentServiceWorker();
  } else {
    window.addEventListener("load", registerCurrentServiceWorker, { once: true });
  }
}

function navigateToConflictsAndFocus() {
  if (typeof setActiveTab === "function") {
    setActiveTab("atelier");
  }
  const logPanel = document.getElementById("panel-activity-log");
  if (logPanel) {
    logPanel.hidden = false;
  }
  const conflictPanel = document.getElementById("sync-conflict-panel");
  if (conflictPanel) {
    conflictPanel.hidden = false;
  }
  if (typeof renderActivityLog === "function") {
    renderActivityLog();
  }
  if (conflictPanel) {
    conflictPanel.scrollIntoView({ behavior: "smooth" });
    const firstBtn = conflictPanel.querySelector("button, [data-sync-conflict-action]");
    if (firstBtn) {
      firstBtn.focus();
    } else {
      conflictPanel.setAttribute("tabindex", "-1");
      conflictPanel.focus();
    }
  }
}
window.navigateToConflictsAndFocus = navigateToConflictsAndFocus;

function renderActivityLog() {
  const panel = $("#panel-activity-log");
  if (!panel) return;

  const openConflictsList = typeof getOpenSyncConflicts === "function" ? getOpenSyncConflicts() : [];
  const openConflictsCount = openConflictsList.length;
  const hasAuditView = hasPermission("audit.view");

  panel.hidden = !hasAuditView && openConflictsCount === 0;

  // Toggle visibility of activity log specific elements based on hasAuditView
  const heading = panel.querySelector(".panel-heading");
  const controls = panel.querySelector(".activity-log-controls");
  const tableContainer = panel.querySelector(".table-container");

  if (heading) heading.style.display = hasAuditView ? "" : "none";
  if (controls) controls.style.display = hasAuditView ? "" : "none";
  if (tableContainer) tableContainer.style.display = hasAuditView ? "" : "none";

  const filterSelect = $("#activity-log-filter");
  const searchInput = $("#activity-log-search");
  const tableBody = $("#activity-log-table-body");
  const exportBtn = $("#activity-log-export");
  const conflictPanel = $("#sync-conflict-panel");

  function computeFilteredActivityRows() {
    const filter = filterSelect.value;
    const search = searchInput.value.toLowerCase();
    const logs = getAggregatedActivityLog(200);

    return logs.filter(log => {
      if (filter !== "all") {
        if (filter === "users" && !["users", "security", "supabase", "settings"].includes(log.category)) return false;
        if (filter === "planning" && !["planning"].includes(log.category)) return false;
        if (filter === "case" && !["case"].includes(log.category)) return false;
        if (filter === "sync" && !["sync"].includes(log.category)) return false;
        if (filter === "errors" && !["error", "warn"].includes(log.level)) return false;
      }
      if (search) {
        const text = `${log.label || ""} ${log.details || ""} ${log.actorName || log.user || ""} ${log.caseNumber || ""}`.toLowerCase();
        if (!text.includes(search)) return false;
      }
      return true;
    });
  }

  function updateTable() {
    const filtered = computeFilteredActivityRows();

    tableBody.innerHTML = filtered.map(log => {
      const time = new Date(log.at).toLocaleString();
      let color = "inherit";
      if (log.level === "error" || log.level === "danger") color = "var(--danger-color, #dc3545)";
      if (log.level === "warn") color = "var(--warning-color, #f59f00)";
      return `
        <tr style="border-bottom: 1px solid var(--border-color);">
          <td style="padding: 8px; color: ${color};">${escapeHtml(time)}</td>
          <td style="padding: 8px;">${escapeHtml(log.category || log.type)}</td>
          <td style="padding: 8px;">${escapeHtml(log.actorName || log.user || "Système")}</td>
          <td style="padding: 8px;">${escapeHtml(log.caseNumber || "-")}</td>
          <td style="padding: 8px;"><strong>${escapeHtml(log.label)}</strong><br/><small class="muted">${escapeHtml(log.details)}</small></td>
        </tr>
      `;
    }).join("") || `<tr><td colspan="5" style="padding:16px; text-align:center;" class="muted">Aucun événement trouvé</td></tr>`;
  }

  function formatConflictValue(value) {
    if (value === null || value === undefined || value === "") return "(vide)";
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  }

  function renderConflictPanel() {
    if (!conflictPanel) return;
    const conflicts = typeof getOpenSyncConflicts === "function" ? getOpenSyncConflicts() : [];
    conflictPanel.hidden = conflicts.length === 0;
    if (!conflicts.length) {
      conflictPanel.innerHTML = "";
      return;
    }
    conflictPanel.innerHTML = `
      <div class="panel-heading compact">
        <div>
          <h2>Conflits de synchronisation à résoudre</h2>
          <p>${conflicts.length} conflit(s) détecté(s). Les données locales restent conservées jusqu'à décision.</p>
        </div>
      </div>
      <div class="sync-conflict-list">
        ${conflicts.map((conflict) => {
          if (conflict.type === "case_conflict") {
            const locDate = conflict.localCase?.updatedAt ? new Date(conflict.localCase.updatedAt).toLocaleString() : "Inconnue";
            const locUser = conflict.localCase?.updatedBy || "Non spécifié";
            const locRev = conflict.localCase?.localRevision ?? 0;
            const rmtDate = conflict.remoteCase?.updatedAt ? new Date(conflict.remoteCase.updatedAt).toLocaleString() : "Inconnue";
            const rmtUser = conflict.remoteCase?.updatedBy || "Non spécifié";
            const rmtRev = conflict.remoteCase?.localRevision ?? 0;

            const showManualDownload = (
              conflict.type === "case_conflict" &&
              (conflict.localCase || conflict.localValue) &&
              (conflict.remoteCase || conflict.remoteValue)
            );
            const hasExportPermission = typeof guardSensitiveAction === "function"
              ? guardSensitiveAction("export.backup", {}, { notify: false }).ok
              : true;

            return `
              <article class="sync-conflict-card case-conflict-card" style="margin-bottom: 15px; padding: 15px; background: var(--bg-card, #ffffff); border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.05); border: 1px solid var(--border-color, #eef2f6);">
                <strong style="display: block; font-size: 1.1em; margin-bottom: 5px;">[Dossier] ${escapeHtml(conflict.caseNumber || conflict.caseId || conflict.entityId || "Dossier inconnu")}</strong>
                <small style="color: var(--text-muted, #718096); display: block; margin-bottom: 10px;">${escapeHtml(conflict.reason || "Modifications concurrentes locales et cloud.")}</small>

                <div class="sync-conflict-meta-compare" style="display: flex; gap: 15px; margin: 10px 0; font-size: 0.9em; flex-wrap: wrap;">
                  <div class="meta-column local-meta" style="flex: 1; min-width: 200px; padding: 8px; background: rgba(76, 175, 80, 0.05); border-left: 3px solid #4caf50; border-radius: 4px; display: flex; flex-direction: column; gap: 2px;">
                    <strong style="color: #4caf50; margin-bottom: 4px;">Version Locale</strong>
                    <span>Date : ${escapeHtml(locDate)}</span>
                    <span>Modifié par : ${escapeHtml(locUser)}</span>
                    <span>Révision : ${escapeHtml(locRev)}</span>
                  </div>
                  <div class="meta-column remote-meta" style="flex: 1; min-width: 200px; padding: 8px; background: rgba(33, 150, 243, 0.05); border-left: 3px solid #2196f3; border-radius: 4px; display: flex; flex-direction: column; gap: 2px;">
                    <strong style="color: #2196f3; margin-bottom: 4px;">Version Cloud</strong>
                    <span>Date : ${escapeHtml(rmtDate)}</span>
                    <span>Modifié par : ${escapeHtml(rmtUser)}</span>
                    <span>Révision : ${escapeHtml(rmtRev)}</span>
                  </div>
                </div>

                ${showManualDownload ? `
                <div class="sync-conflict-safety-download" style="margin-top: 10px; padding: 10px; background: rgba(255,193,7,0.05); border-radius: 4px; font-size: 0.9em; border: 1px dashed var(--border-color, #ccc);">
                  <span class="muted" style="display: block; margin-bottom: 6px;">Une copie de sécurité locale est conservée dans l’application. Vous pouvez la télécharger manuellement si nécessaire.</span>
                  <button type="button" class="tiny-button" data-sync-conflict-download-id="${escapeAttr(conflict.id)}" ${hasExportPermission ? '' : 'disabled title="Export non autorisé" style="opacity:0.5; cursor:not-allowed;"'}>Télécharger copie locale avant remplacement</button>
                </div>
                ` : ''}

                <div class="sync-conflict-actions" style="display: flex; gap: 10px; margin-top: 10px;">
                  <button type="button" class="tiny-button" data-sync-conflict-action="keep_local" data-sync-conflict-id="${escapeAttr(conflict.id)}">Conserver version locale</button>
                  <button type="button" class="tiny-button" data-sync-conflict-action="accept_cloud" data-sync-conflict-id="${escapeAttr(conflict.id)}">Conserver version cloud</button>
                  <button type="button" class="tiny-button ghost" data-sync-conflict-action="defer_manual_merge" data-sync-conflict-id="${escapeAttr(conflict.id)}">Fusion manuelle plus tard</button>
                </div>
              </article>
            `;
          } else {
            return `
              <article class="sync-conflict-card">
                <strong>${escapeHtml(conflict.caseNumber || conflict.caseId || conflict.entityId || "Dossier inconnu")}</strong>
                <span>Champ : ${escapeHtml(conflict.field || "inconnu")}</span>
                <small>${escapeHtml(conflict.reason || "Valeurs locales et cloud différentes.")}</small>
                <div class="sync-conflict-values">
                  <code>Local : ${escapeHtml(formatConflictValue(conflict.localValue))}</code>
                  <code>Cloud : ${escapeHtml(formatConflictValue(conflict.remoteValue))}</code>
                </div>
                <div class="sync-conflict-actions">
                  <button type="button" class="tiny-button" data-sync-conflict-action="keep_local" data-sync-conflict-id="${escapeAttr(conflict.id)}">Garder local</button>
                  <button type="button" class="tiny-button" data-sync-conflict-action="accept_cloud" data-sync-conflict-id="${escapeAttr(conflict.id)}">Accepter cloud</button>
                  <button type="button" class="tiny-button ghost" data-sync-conflict-action="mark_resolved" data-sync-conflict-id="${escapeAttr(conflict.id)}">Marquer résolu</button>
                </div>
              </article>
            `;
          }
        }).join("")}
      </div>
    `;
    conflictPanel.querySelectorAll("[data-sync-conflict-action]").forEach((button) => {
      button.addEventListener("click", () => {
        const result = typeof resolveSyncConflict === "function"
          ? resolveSyncConflict(button.dataset.syncConflictId, button.dataset.syncConflictAction)
          : { ok: false, message: "Résolution indisponible." };
        notifyUser(result.ok ? "Conflit de synchronisation mis à jour." : result.message, result.ok ? "success" : "warn");
        renderConflictPanel();
        updateTable();
        if (typeof renderSyncStatusStrip === "function") renderSyncStatusStrip();
      });
    });

    conflictPanel.querySelectorAll("[data-sync-conflict-download-id]").forEach((button) => {
      button.addEventListener("click", () => {
        if (typeof guardSensitiveAction === "function") {
          const guard = guardSensitiveAction("export.backup");
          if (!guard.ok) {
            notifyUser(guard.message || "Export non autorisé.", "warn");
            return;
          }
        }
        const conflictId = button.dataset.syncConflictDownloadId;
        const targetConflict = conflicts.find((c) => c.id === conflictId);
        const localVal = targetConflict ? (targetConflict.localCase || targetConflict.localValue) : null;
        if (localVal) {
          const payload = {
            version: "v23.2.8-full-audit",
            timestamp: new Date().toISOString(),
            cases: [JSON.parse(JSON.stringify(localVal))],
            source: "manual_conflict_backup"
          };
          if (typeof downloadJson === "function") {
            downloadJson(payload, `nimr-sav-conflit-local-avant-cloud-${localVal.id || "unknown"}-${todayKey(new Date())}.json`);
            if (typeof addAuditLog === "function") {
              addAuditLog("conflict.local_downloaded", {
                caseId: localVal.id,
                conflictId: conflictId,
                timestamp: new Date().toISOString()
              });
            }
            notifyUser("Copie de sécurité locale téléchargée.", "success");
          } else {
            notifyUser("Téléchargement impossible.", "warn");
          }
        } else {
          notifyUser("Impossible de trouver la version locale du dossier.", "warn");
        }
      });
    });
  }

  if (!hasAuditView) {
    if (tableBody) tableBody.innerHTML = "";
    renderConflictPanel();
    return;
  }

  // Bind only once
  if (!panel.dataset.bound) {
    filterSelect.addEventListener("change", updateTable);
    searchInput.addEventListener("input", updateTable);
    exportBtn.addEventListener("click", () => {
      const logs = computeFilteredActivityRows();
      const csv = ["Date;Type;Acteur;Dossier;Label;Details"];
      logs.forEach(log => {
        csv.push([
          new Date(log.at).toLocaleString(),
          log.category || log.type,
          log.actorName || log.user || "Système",
          log.caseNumber || "",
          log.label,
          log.details
        ].map(s => `"${String(s || "").replace(/"/g, '""').replace(/\n/g, ' ')}"`).join(";"));
      });
      const blob = new Blob(["\ufeff" + csv.join("\r\n")], { type: "text/csv;charset=utf-8;" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `nimr_activity_log_${new Date().toISOString().slice(0,10)}.csv`;
      a.click();
    });
    panel.dataset.bound = "true";
  }

  renderConflictPanel();
  updateTable();
}


// --- DEBUT v22.33C User Selector Startup / Shared Session ---
const SENSITIVE_ROLES = ["admin", "chef_atelier", "directeur_sav"];
window.selectedUserIdForStartup = "";
window.pendingSelectorUser = null;

window.selectedUserIdForStartup = "";
window.pendingSelectorUser = null;

let userSessionReturnFocus = null;

function isUserSessionOverlayVisible() {
  const firstAccess = document.getElementById("first-access-overlay");
  const login = document.getElementById("user-login-overlay");
  const change = document.getElementById("user-pin-change-overlay");
  return Boolean((firstAccess && !firstAccess.hidden) || (login && !login.hidden) || (change && !change.hidden));
}

function captureUserSessionReturnFocus() {
  if (userSessionReturnFocus || isUserSessionOverlayVisible()) return;
  const active = document.activeElement;
  if (!active || active === document.body || active.closest?.(".local-lock-overlay")) return;
  if (typeof active.focus === "function") userSessionReturnFocus = active;
}

function restoreUserSessionReturnFocus() {
  if (isUserSessionOverlayVisible()) return;
  const target = userSessionReturnFocus;
  userSessionReturnFocus = null;
  if (target && typeof target.focus === "function") {
    window.setTimeout(() => target.focus(), 60);
  }
}

function focusUserSessionDialog(overlay, preferredSelector) {
  if (!overlay || overlay.hidden) return;
  const preferred = preferredSelector ? overlay.querySelector(preferredSelector) : null;
  const focusable = typeof getFocusableElements === "function" ? getFocusableElements(overlay) : [];
  const target = preferred && !preferred.disabled ? preferred : focusable[0];
  if (target && typeof target.focus === "function") {
    window.setTimeout(() => target.focus(), 60);
  }
}

function handleUserSessionOverlayKeydown(event) {
  const overlay = event.currentTarget;
  const form = overlay?.querySelector?.("form");
  if (!form) return;
  if (event.key === "Escape" && overlay.id === "user-pin-change-overlay") {
    event.preventDefault();
    document.getElementById("user-pin-change-cancel")?.click();
    return;
  }
  if (typeof trapFocusWithin === "function") trapFocusWithin(form, event);
}

function bindUserSessionOverlayKeyboard(overlay) {
  if (!overlay || overlay.dataset.keyboardBound === "true") return;
  overlay.dataset.keyboardBound = "true";
  overlay.addEventListener("keydown", handleUserSessionOverlayKeydown);
}

function checkUserSessionStartup() {
  if (typeof isLocalSessionUnlocked === "function" && !isLocalSessionUnlocked()) {
    // PIN local activé et verrouillé -> priorité au PIN, on attend le déverrouillage
    return;
  }

  // Vérifier si les overlays ne sont pas enfants de .app-shell (contrainte 3)
  const loginOverlay = document.getElementById("user-login-overlay");
  const pinChangeOverlay = document.getElementById("user-pin-change-overlay");
  const appShell = document.querySelector(".app-shell");
  if (appShell && typeof appShell.contains === "function") {
    if (appShell.contains(loginOverlay) || appShell.contains(pinChangeOverlay)) {
      console.error("DOM CONSTRAINT VIOLATION: Overlays must be siblings of .app-shell, not children!");
    }
  }

  const activeUsers = (state.users || []).filter(user => user.active !== false);
  if (typeof isFirstAccessRecoveryRequired === "function" && isFirstAccessRecoveryRequired(state)) {
    showFirstAccessRecovery();
    return;
  }
  const alwaysPrompt = state.settings.alwaysPromptUserStartup !== false &&
                       (state.settings.alwaysPromptUserStartup === true || activeUsers.length > 1);

  const currentUser = getCurrentUser();
  const isCurrentActive = currentUser && activeUsers.some(user => user.id === state.currentUserId);

  if (alwaysPrompt || !isCurrentActive) {
    showUserLoginScreen();
  } else {
    // Si l'utilisateur actif est sensible et n'est pas déverrouillé, on doit demander le PIN
    if (currentUser && SENSITIVE_ROLES.includes(currentUser.role) && sessionStorage.getItem("nimr-user-pin-unlocked") !== currentUser.id) {
      showUserLoginScreen();
    } else {
      hideUserLoginScreen();
      hideUserPinChangeOverlay();
      if (!state.currentUserId && currentUser) {
        state.currentUserId = currentUser.id;
      }
    }
  }
}

function showFirstAccessRecovery() {
  const overlay = document.getElementById("first-access-overlay");
  if (!overlay) return;
  captureUserSessionReturnFocus();
  bindUserSessionOverlayKeyboard(overlay);
  hideUserLoginScreen();
  hideUserPinChangeOverlay();
  overlay.hidden = false;
  document.querySelector(".app-shell")?.setAttribute("inert", "");
  const status = document.getElementById("first-access-status");
  if (status) status.textContent = "";
  focusUserSessionDialog(overlay, "input[name='name']");
}

function hideFirstAccessRecovery() {
  const overlay = document.getElementById("first-access-overlay");
  if (!overlay) return;
  overlay.hidden = true;
  checkOverlaysInertState();
  restoreUserSessionReturnFocus();
}

function showUserLoginScreen() {
  if (typeof isFirstAccessRecoveryRequired === "function" && isFirstAccessRecoveryRequired(state)) {
    showFirstAccessRecovery();
    return;
  }
  const overlay = document.getElementById("user-login-overlay");
  if (overlay) {
    captureUserSessionReturnFocus();
    bindUserSessionOverlayKeyboard(overlay);
    overlay.hidden = false;
    document.querySelector(".app-shell")?.setAttribute("inert", "");
    renderUserLoginScreen();
    focusUserSessionDialog(overlay, "#user-login-select");
  }
}

function hideUserLoginScreen() {
  const overlay = document.getElementById("user-login-overlay");
  if (overlay) {
    overlay.hidden = true;
    const status = document.getElementById("user-login-status");
    if (status) status.textContent = "";
    checkOverlaysInertState();
    restoreUserSessionReturnFocus();
  }
}

function showUserPinChangeOverlay(user, mode = "bootstrap") {
  const overlay = document.getElementById("user-pin-change-overlay");
  const descEl = document.getElementById("user-pin-change-desc");
  if (overlay) {
    captureUserSessionReturnFocus();
    bindUserSessionOverlayKeyboard(overlay);
    if (descEl) {
      if (mode === "creation") {
        descEl.textContent = "Un PIN de sécurité robuste doit être défini avant le premier accès local à l'application.";
      } else {
        descEl.textContent = "Ce compte utilise un ancien PIN de démarrage faible. Définissez un PIN robuste avant de continuer.";
      }
    }
    window.pendingSelectorUser = user;
    overlay.hidden = false;
    document.querySelector(".app-shell")?.setAttribute("inert", "");
    const newPinInput = overlay.querySelector("input[name='newPin']");
    if (newPinInput) {
      newPinInput.value = "";
      const confirmInput = overlay.querySelector("input[name='confirmNewPin']");
      if (confirmInput) confirmInput.value = "";
      focusUserSessionDialog(overlay, "input[name='newPin']");
    }
  }
}

function hideUserPinChangeOverlay() {
  const overlay = document.getElementById("user-pin-change-overlay");
  if (overlay) {
    overlay.hidden = true;
    const status = document.getElementById("user-pin-change-status");
    if (status) status.textContent = "";
    checkOverlaysInertState();
    restoreUserSessionReturnFocus();
  }
}

function checkOverlaysInertState() {
  const firstAccess = document.getElementById("first-access-overlay");
  const login = document.getElementById("user-login-overlay");
  const change = document.getElementById("user-pin-change-overlay");
  const localLock = document.getElementById("local-lock-overlay");
  const anyVisible = (firstAccess && !firstAccess.hidden) ||
                      (login && !login.hidden) ||
                      (change && !change.hidden) ||
                      (localLock && !localLock.hidden);
  if (!anyVisible) {
    document.querySelector(".app-shell")?.removeAttribute("inert");
  } else {
    document.querySelector(".app-shell")?.setAttribute("inert", "");
  }
}

function renderUserLoginScreen() {
  const selectEl = document.getElementById("user-login-select");
  if (!selectEl) return;

  const activeUsers = (state.users || []).filter(user => user.active !== false);

  selectEl.innerHTML = activeUsers.map(user => {
    const roleLabel = {
      admin: "Admin technique",
      chef_atelier: "Chef d'atelier",
      directeur_sav: "Directeur SAV",
      reception: "Réception",
      technicien: "Technicien",
      qualite: "Lecture seule (rôle historique)",
      readonly: "Lecture seule"
    }[user.role] || user.role;

    const emailNorm = String(user.email || "").trim().toLowerCase();
    const isDup = emailNorm && activeUsers.some(ou => ou.id !== user.id && String(ou.email || "").trim().toLowerCase() === emailNorm && ou.role === user.role);
    const shortId = user.id.substring(5);
    const displayLabel = isDup
      ? `${user.name} (${roleLabel}) [Doublon: ${shortId}]`
      : `${user.name} (${roleLabel})`;

    return `<option value="${escapeAttr(user.id)}">${escapeHtml(displayLabel)}</option>`;
  }).join("") || `<option value="">Aucun utilisateur actif trouvé</option>`;

  // Sélectionner par défaut l'utilisateur actuel s'il existe et est actif
  const currentUser = getCurrentUser();
  if (currentUser && activeUsers.some(u => u.id === currentUser.id)) {
    selectEl.value = currentUser.id;
  } else if (activeUsers.length > 0) {
    selectEl.value = activeUsers[0].id;
  }

  updateLoginPinRequirement();
}

function updateLoginPinRequirement() {
  const selectEl = document.getElementById("user-login-select");
  const pinInput = document.getElementById("user-login-pin");
  const pinContainer = document.getElementById("user-login-pin-container");
  const statusEl = document.getElementById("user-login-status");
  if (statusEl) statusEl.textContent = "";

  const userId = selectEl?.value;
  const user = (state.users || []).find(u => u.id === userId);
  if (!user) return;

  const isSensitive = ["admin", "chef_atelier", "directeur_sav"].includes(user.role);
  const hasPin = Boolean(user.pinHash);
  const pinRequired = isSensitive || user.pinRequired || hasPin;

  if (pinInput) {
    if (pinRequired) {
      pinInput.required = hasPin;
      pinInput.placeholder = hasPin
        ? "PIN requis pour ce compte"
        : "Un PIN sera créé à l'étape suivante";
      if (pinContainer) {
        pinContainer.style.opacity = "1";
        pinContainer.style.pointerEvents = "auto";
      }
    } else {
      pinInput.required = false;
      pinInput.placeholder = "PIN non requis (Optionnel)";
      if (pinContainer) {
        pinContainer.style.opacity = "0.7";
      }
    }
  }
}

function resetSensitiveUiStateForUserSwitch(reason = "user-switch") {
  try {
    sessionStorage.removeItem("nimr-user-pin-unlocked");
  } catch (error) {
    // Session storage peut être indisponible dans certains navigateurs.
  }
  generatedProposals = {};
  estimateImportPreviews = {};
  document.querySelectorAll(".custom-modal-overlay").forEach((overlay) => {
    if (overlay.id === "user-login-overlay") return;
    overlay.hidden = true;
    if (!overlay.id) overlay.remove();
  });
  const promptInput = document.getElementById("prompt-input");
  if (promptInput) promptInput.value = "";
  if (typeof addAuditLog === "function") {
    addAuditLog("security.shared_workstation_user_switch", "Changement utilisateur sur poste partagé", `Actions sensibles ouvertes refermées (${reason}).`);
  }
}

function triggerUserChangeScreen() {
  // v23.2.5 — Sécurité : seul Admin technique peut changer de session librement.
  // Tous les autres rôles doivent se déconnecter proprement.
  const guard = typeof guardUserSwitch === "function" ? guardUserSwitch() : { ok: true };
  if (guard.ok) {
    resetSensitiveUiStateForUserSwitch("demande utilisateur");
    showUserLoginScreen();
  } else {
    triggerLogout();
  }
}

// v23.2.5 — Déconnexion propre : efface la session sans afficher l'écran admin
async function triggerLogout() {
  const previousUser = (state.users || []).find(user => user.id === state.currentUserId && user.active !== false);
  const previousActor = previousUser ? {
    userId: previousUser.id,
    userName: previousUser.name || previousUser.email || "Utilisateur",
    userRole: previousUser.role || "readonly",
    resourceId: previousUser.resourceId || ""
  } : null;
  resetSensitiveUiStateForUserSwitch("déconnexion utilisateur");
  state.currentUserId = "";
  window.pendingSelectorUser = null;
  try {
    sessionStorage.removeItem("nimr-user-pin-unlocked");
  } catch (error) {
    // Session storage peut être indisponible dans certains navigateurs.
  }
  if (typeof addAuditLog === "function") {
    addAuditLog("users.session_logged_out", "Déconnexion utilisateur", previousUser ? `Déconnexion de ${previousUser.name}` : "Session locale effacée", { actor: previousActor });
  }
  if (typeof saveState === "function") saveState({ skipCloud: true, skipSnapshot: true });
  if (typeof persistLargeStateSnapshot === "function") {
    await persistLargeStateSnapshot(state, { appVersion: APP_VERSION, reason: "local-user-logout" }).catch((error) => {
      console.warn("Persistance avant déconnexion locale impossible", error?.message || error);
    });
  }
  if (typeof loadDurableOutboxOperations === "function") await loadDurableOutboxOperations().catch(() => []);
  if (typeof renderCurrentSessionIndicator === "function") renderCurrentSessionIndicator();
  showUserLoginScreen();
}

function renderCurrentSessionIndicator() {
  const currentUser = state.currentUserId && typeof getUserById === "function" ? getUserById(state.currentUserId) : null;
  const sidebarUserName = document.getElementById("sidebar-user-name");
  if (sidebarUserName) {
    const roleLabel = currentUser
      ? (currentUser.role === "admin" ? "Admin technique" : currentUser.role)
      : "";
    sidebarUserName.textContent = currentUser ? `${currentUser.name} (${roleLabel})` : "Atelier";
  }

  // v23.2.5 — Le bouton sidebar affiche "Changer" uniquement pour Admin.
  // Pour tous les autres rôles, affiche "Déconnexion".
  const changeBtn = document.getElementById("sidebar-change-user-btn");
  if (changeBtn) {
    const isAdmin = currentUser && currentUser.role === "admin";
    changeBtn.textContent = isAdmin ? "Changer" : "Déconnexion";
    changeBtn.title = isAdmin
      ? "Changer d'utilisateur (Admin technique)"
      : "Se déconnecter pour changer de session";
    changeBtn.setAttribute("aria-label", isAdmin ? "Changer d'utilisateur" : "Se déconnecter");
  }

  const settingsChangeBtn = document.getElementById("change-user-settings-btn");
  if (settingsChangeBtn) {
    const isAdmin = currentUser && currentUser.role === "admin";
    settingsChangeBtn.textContent = isAdmin ? "Changer d'utilisateur" : "Déconnexion";
    settingsChangeBtn.title = isAdmin
      ? "Changer d'utilisateur (Admin technique)"
      : "Se déconnecter proprement avant une nouvelle session";
    settingsChangeBtn.setAttribute("aria-label", isAdmin ? "Changer d'utilisateur" : "Se déconnecter");
  }

  // Mettre à jour l'option checkbox dans les Paramètres
  const alwaysPromptCheckbox = document.getElementById("always-prompt-startup");
  if (alwaysPromptCheckbox) {
    const activeUsers = (state.users || []).filter(user => user.active !== false);
    const isChecked = state.settings.alwaysPromptUserStartup === true ||
                      (state.settings.alwaysPromptUserStartup !== false && activeUsers.length > 1);
    alwaysPromptCheckbox.checked = isChecked;

    const isAdmin = currentUser && currentUser.role === "admin";
    alwaysPromptCheckbox.disabled = !isAdmin;
    const container = alwaysPromptCheckbox.closest(".check-card");
    if (container) {
      container.style.opacity = isAdmin ? "1" : "0.6";
      container.title = isAdmin ? "" : "Action réservée administrateur technique.";
    }
  }
}

function bindUserSessionActions() {
  const firstAccessForm = document.getElementById("first-access-form");
  firstAccessForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const status = document.getElementById("first-access-status");
    if (status) status.textContent = "";
    const name = String(firstAccessForm.elements.name?.value || "").trim();
    const role = String(firstAccessForm.elements.role?.value || "").trim();
    const pin = String(firstAccessForm.elements.pin?.value || "");
    const confirmPin = String(firstAccessForm.elements.confirmPin?.value || "");
    const validation = typeof validateLocalPinStrength === "function"
      ? validateLocalPinStrength(pin)
      : { ok: pin.length >= 6, value: pin, message: "PIN trop faible." };
    if (!name) {
      if (status) status.textContent = "Le nom est obligatoire.";
      return;
    }
    if (!validation.ok) {
      if (status) status.textContent = validation.message || "PIN trop faible.";
      return;
    }
    if (pin !== confirmPin) {
      if (status) status.textContent = "Les deux PIN ne correspondent pas.";
      return;
    }
    try {
      const credentials = await createLocalPinCredentials(validation.value);
      const result = createFirstAccessUserLocal({ name, role, ...credentials });
      if (!result.ok) {
        if (status) status.textContent = result.message;
        return;
      }
      sessionStorage.setItem("nimr-user-pin-unlocked", result.user.id);
      saveState({ skipCloud: true, cloudReason: "first-access" });
      hideFirstAccessRecovery();
      setActiveTab("reception-workspace");
      render();
      resetUserSessionIdleTimer();
      quietNotify(`Bienvenue, ${result.user.name} !`, "success");
    } catch (error) {
      if (status) status.textContent = error?.message || "Création du premier accès impossible.";
    }
  });

  // Option checkbox dans Paramètres
  const alwaysPromptCheckbox = document.getElementById("always-prompt-startup");
  alwaysPromptCheckbox?.addEventListener("change", (event) => {
    const currentUser = getCurrentUser();
    if (!currentUser || currentUser.role !== "admin") {
      notifyUser("Action réservée administrateur technique.", "error");
      renderCurrentSessionIndicator();
      return;
    }
    state.settings.alwaysPromptUserStartup = event.currentTarget.checked;
    saveState();
    quietNotify("Paramètre de session mis à jour.", "success");
  });

  // v23.2.5 — Bouton sidebar : "Changer" pour admin, "Déconnexion" pour les autres rôles.
  // triggerUserChangeScreen() gère lui-même le garde via guardUserSwitch().
  document.getElementById("sidebar-change-user-btn")?.addEventListener("click", () => {
    triggerUserChangeScreen();
  });
  document.getElementById("change-user-settings-btn")?.addEventListener("click", () => {
    triggerUserChangeScreen();
  });

  // Changement de sélection d'utilisateur dans l'écran de login
  document.getElementById("user-login-select")?.addEventListener("change", () => {
    updateLoginPinRequirement();
  });

  // Bouton Toggle afficher/masquer le PIN
  document.getElementById("user-login-pin-toggle")?.addEventListener("click", (event) => {
    event.preventDefault();
    const pinInput = document.getElementById("user-login-pin");
    if (pinInput) {
      if (pinInput.type === "password") {
        pinInput.type = "text";
        event.currentTarget.textContent = "🙈";
      } else {
        pinInput.type = "password";
        event.currentTarget.textContent = "👁️";
      }
    }
  });

  // Annuler le changement du PIN
  document.getElementById("user-pin-change-cancel")?.addEventListener("click", () => {
    window.pendingSelectorUser = null;
    showUserLoginScreen();
    hideUserPinChangeOverlay();
  });

  // Soumission du formulaire unique de login
  const loginForm = document.getElementById("user-login-form");
  loginForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const userId = loginForm.elements.userId.value;
    const pinVal = loginForm.elements.pin.value;

    const statusEl = document.getElementById("user-login-status");
    if (statusEl) statusEl.textContent = "";

    const user = (state.users || []).find(u => u.id === userId);
    if (!user || user.active === false) {
      if (statusEl) statusEl.textContent = "Utilisateur inactif ou invalide. Sélectionnez un compte actif.";
      return;
    }

    sessionStorage.removeItem("nimr-user-pin-unlocked");

    const isSensitive = ["admin", "chef_atelier", "directeur_sav"].includes(user.role);
    const hasPin = Boolean(user.pinHash);
    const pinRequired = isSensitive || user.pinRequired || hasPin;

    // 1. Si PIN requis mais aucun PIN n'est défini -> forcer création
    if (pinRequired && !user.pinHash) {
      showUserPinChangeOverlay(user, "creation");
      hideUserLoginScreen();
      return;
    }

    // 2. Si PIN requis, le vérifier
    if (pinRequired) {
      try {
        const valid = await verifyUserPin(user, pinVal);
        if (!valid) {
          addAuditLog("users.pin_incorrect", `PIN incorrect pour ${user.name}`, `Tentative de connexion échouée (rôle: ${user.role})`);
          if (statusEl) statusEl.textContent = "PIN incorrect. Vérifiez le code du compte sélectionné.";
          loginForm.elements.pin.value = "";
          loginForm.elements.pin.focus();
          return;
        }

        // Ancien PIN de démarrage faible : migration obligatoire vers un PIN robuste.
        if (typeof isLegacyBootstrapPin === "function" && isLegacyBootstrapPin(user)) {
          showUserPinChangeOverlay(user, "bootstrap");
          hideUserLoginScreen();
          return;
        }

        // Sinon, PIN valide -> déverrouillé !
        sessionStorage.setItem("nimr-user-pin-unlocked", user.id);
      } catch (err) {
        if (statusEl) statusEl.textContent = err.message || "Validation du PIN impossible. Réessayez ou contactez l'administrateur.";
        return;
      }
    }

    // Connexion finale
    hideUserLoginScreen();
    completeUserLogin(user);
  });

  // Soumission du formulaire changement PIN
  const pinChangeForm = document.getElementById("user-pin-change-form");
  pinChangeForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const newPin = pinChangeForm.elements.newPin.value;
    const confirmNewPin = pinChangeForm.elements.confirmNewPin.value;
    const user = window.pendingSelectorUser;
    if (!user) return;

    const statusEl = document.getElementById("user-pin-change-status");
    if (statusEl) statusEl.textContent = "";

    const validation = typeof validateLocalPinStrength === "function"
      ? validateLocalPinStrength(newPin)
      : { ok: String(newPin || "").trim().length >= 6, value: String(newPin || "").trim(), message: "PIN trop faible." };
    if (!validation.ok) {
      if (statusEl) statusEl.textContent = validation.message || "PIN trop faible.";
      return;
    }
    if (newPin !== confirmNewPin) {
      if (statusEl) statusEl.textContent = "Les deux PIN ne correspondent pas. Ressaisissez la confirmation.";
      return;
    }

    try {
      const { pinHash, pinSalt } = await createLocalPinCredentials(validation.value);

      const userObj = state.users.find(u => u.id === user.id);
      if (userObj) {
        userObj.pinHash = pinHash;
        userObj.pinSalt = pinSalt;
        userObj.updatedAt = new Date().toISOString();
      }

      addAuditLog("users.pin_security_updated", `PIN de sécurité défini pour ${user.name}`, "Mise à jour obligatoire du PIN local robuste");
      saveState();

      sessionStorage.setItem("nimr-user-pin-unlocked", user.id);
      hideUserPinChangeOverlay();
      completeUserLogin(user);
    } catch (err) {
      if (statusEl) statusEl.textContent = err.message || "Mise à jour du PIN impossible. Réessayez ou contactez l'administrateur.";
    }
  });
}

function completeUserLogin(targetUser) {
  const previousUser = (state.users || []).find(user => user.id === state.currentUserId && user.active !== false);
  const previousActor = previousUser ? {
    userId: previousUser.id,
    userName: previousUser.name || previousUser.email || "Utilisateur",
    userRole: previousUser.role || "readonly",
    resourceId: previousUser.resourceId || ""
  } : null;

  if (setCurrentUser(targetUser.id)) {
    if (!previousUser) {
      addAuditLog("users.session_selected", `Session utilisateur démarrée : ${targetUser.name}`, "Sélection initiale au démarrage", {
        actor: { userId: targetUser.id, userName: targetUser.name, userRole: targetUser.role, resourceId: targetUser.resourceId || "" }
      });
    } else if (previousUser.id !== targetUser.id) {
      addAuditLog("users.current_changed", `Changement d'utilisateur actif : ${previousUser.name} -> ${targetUser.name}`, "Bascule locale effectuée", {
        actor: previousActor
      });
    }

    saveState();
    hideUserLoginScreen();

    // Forcer la redirection et vider le DOM selon les règles d'accessibilité (Contrainte 11 hotfix test)
    ensureCurrentTabAllowed();
    if (targetUser.role === "technicien") {
      const caseDetail = document.getElementById("case-detail");
      const gantt = document.getElementById("gantt");
      if (caseDetail) caseDetail.innerHTML = "";
      if (gantt) gantt.innerHTML = "";
    }

    render();
    resetUserSessionIdleTimer();

    if (targetUser.role === "technicien" && !targetUser.resourceId) {
      notifyUser("Avertissement : Aucun technicien / ressource n'est lié à votre profil. Certaines fonctionnalités seront restreintes.", "warn");
    } else {
      quietNotify(`Bienvenue, ${targetUser.name} !`, "success");
    }
  } else {
    notifyUser("Impossible d'appliquer l'utilisateur. Vérifiez que le compte est actif et autorisé.", "error");
  }
}

let userSessionIdleTimer = null;
function resetUserSessionIdleTimer() {
  window.clearTimeout(userSessionIdleTimer);
  const currentUser = getCurrentUser();
  if (!currentUser || !SENSITIVE_ROLES.includes(currentUser.role)) return;
  userSessionIdleTimer = window.setTimeout(() => {
    sessionStorage.removeItem("nimr-user-pin-unlocked");
    addAuditLog("security.session_timeout", "Session verrouillée pour inactivité", `Déconnexion automatique de ${currentUser.name} après 15 minutes d'inactivité.`);
    state.currentUserId = "";
    saveState();
    checkUserSessionStartup();
  }, 15 * 60 * 1000); // 15 minutes
}

function bindUserSessionIdleEvents() {
  ["pointerdown", "keydown", "touchstart"].forEach((eventName) => {
    document.addEventListener(eventName, () => resetUserSessionIdleTimer(), { passive: true });
  });
  document.addEventListener("visibilitychange", resetUserSessionIdleTimer);
}

window.checkUserSessionStartup = checkUserSessionStartup;
window.renderCurrentSessionIndicator = renderCurrentSessionIndicator;
window.resetUserSessionIdleTimer = resetUserSessionIdleTimer;
window.bindUserSessionIdleEvents = bindUserSessionIdleEvents;
// --- FIN v22.33C User Selector Startup / Shared Session ---

initApp();
