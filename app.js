let quickEstimateCreationDraft = null;

function initApp() {
  try {
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
    if (typeof migratePlanningLogicV28 === "function") migratePlanningLogicV28();
    if (typeof migratePlanningLogicV36 === "function") migratePlanningLogicV36();
    if (typeof initReceptionWorkspace === "function") initReceptionWorkspace();

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
  } catch (error) {
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
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.min.js";
  }
}

function bindMainNavigation() {
  $$(".nav-button").forEach((button) => {
    button.addEventListener("click", () => {
      const tab = button.dataset.tab;
      if (!tab) return;
      setActiveTab(tab);
      if (tab === "reception-workspace") {
        if (typeof renderReceptionWorkspace === "function") renderReceptionWorkspace();
      }
      if (tab === "today") renderTodayWorkshop();
      if (tab === "planning") renderPlanning();
      if (tab === "technician") renderTechnicianDashboard();
      if (tab === "qc-workspace") {
        if (typeof renderQcWorkspace === "function") renderQcWorkspace();
      }
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

function updateMissingFieldsUI(draft) {
  const container = document.getElementById("missing-fields-container");
  const btnCreate = document.getElementById("btn-create-case-from-pdf");
  const previewDiv = document.getElementById("devis-pdf-preview-info");
  const extractedSummary = document.getElementById("devis-pdf-extracted-summary");

  if (!container || !btnCreate) return;

  if (!draft) {
    container.innerHTML = "";
    container.style.display = "none";
    if (previewDiv) previewDiv.style.display = "none";
    btnCreate.disabled = true;
    return;
  }

  const info = draft.parsed.info || {};

  // Show preview
  if (previewDiv && extractedSummary) {
    extractedSummary.innerHTML = `
      <strong>Client :</strong> ${escapeHtml(info.clientName || "-")}<br>
      <strong>Véhicule :</strong> ${escapeHtml(info.vehicle || "-")}<br>
      <strong>N° Devis :</strong> ${escapeHtml(info.estimateNumber || info.orNumber || "-")}<br>
      <strong>Heures MO détectées :</strong> ${formatLocalizedDecimal(draft.parsed.detectedHours)} h
    `;
    previewDiv.style.display = "block";
  }

  let html = "";

  const needsPlateOrVin = !info.plate && !info.vin;
  if (needsPlateOrVin) {
    html += `
      <label style="display: block; margin-top: 10px;">
        Immatriculation ou VIN <span class="required-marker">*</span>
        <input name="plate" placeholder="Ex. 123 TU 4567 ou VIN de 17 caract." required style="width: 100%; margin-top: 4px;" />
      </label>
    `;
  }

  const needsMileage = !info.mileage;
  if (needsMileage) {
    html += `
      <label style="display: block; margin-top: 10px;">
        Kilométrage <span class="required-marker">*</span>
        <input name="mileage" type="text" inputmode="numeric" placeholder="Ex. 120000" required style="width: 100%; margin-top: 4px;" />
      </label>
    `;
  }

  const needsPhone = !info.phone;
  if (needsPhone) {
    html += `
      <label style="display: block; margin-top: 10px;">
        Téléphone client <span class="required-marker">*</span>
        <input name="phone" type="tel" placeholder="Ex. +216 55 111 222" required style="width: 100%; margin-top: 4px;" />
      </label>
    `;
  }

  container.innerHTML = html;
  container.style.display = html ? "block" : "none";
  btnCreate.disabled = false;
}

// Le devis PDF est le point d'entrée obligatoire du dossier atelier.
function bindCaseCreation() {
  const form = $("#case-form");
  if (!form) return;

  const dropZone = document.getElementById("devis-pdf-drop-zone");
  const fileInput = document.getElementById("quick-estimate-file-input");

  const handleEstimateFile = async (file) => {
    quickEstimateCreationDraft = null;
    const previewDiv = document.getElementById("devis-pdf-preview-info");
    const container = document.getElementById("missing-fields-container");
    const btnCreate = document.getElementById("btn-create-case-from-pdf");
    const status = document.getElementById("quick-estimate-import-status");

    if (previewDiv) previewDiv.style.display = "none";
    if (container) {
      container.innerHTML = "";
      container.style.display = "none";
    }
    if (btnCreate) btnCreate.disabled = true;

    if (!file) {
      if (status) status.textContent = "Fichier PDF uniquement";
      return;
    }

    const validationError = validateEstimateImportFile(file);
    if (validationError) {
      if (status) status.textContent = validationError;
      notifyUser(validationError, "error");
      return;
    }

    try {
      if (status) status.textContent = "Lecture du devis en cours...";
      quickEstimateCreationDraft = await buildQuickEstimateCreationDraft(file, form);

      const info = quickEstimateCreationDraft.parsed.info || {};
      const reference = cleanParsedEstimateNumber(info.estimateNumber) || info.orNumber || file.name;
      if (status) {
        status.textContent = `Devis lu : ${reference} - ${formatLocalizedDecimal(quickEstimateCreationDraft.parsed.detectedHours)} h MO détectées.`;
      }

      updateMissingFieldsUI(quickEstimateCreationDraft);
    } catch (error) {
      console.error("Pré-import devis création impossible", error);
      quickEstimateCreationDraft = null;
      if (status) status.textContent = "Import devis impossible.";
      notifyUser(error.message || "Impossible de lire ce devis.", "error");
    }
  };

  if (dropZone && fileInput) {
    dropZone.addEventListener("click", () => fileInput.click());

    dropZone.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropZone.classList.add("dragover");
    });

    dropZone.addEventListener("dragleave", () => {
      dropZone.classList.remove("dragover");
    });

    dropZone.addEventListener("drop", (e) => {
      e.preventDefault();
      dropZone.classList.remove("dragover");
      const file = e.dataTransfer.files?.[0];
      if (file) {
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        fileInput.files = dataTransfer.files;
        handleEstimateFile(file);
      }
    });

    fileInput.addEventListener("change", () => {
      const file = fileInput.files?.[0];
      handleEstimateFile(file);
    });
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const createGuard = guardCaseCreate();
    if (!createGuard.ok) return;

    if (!quickEstimateCreationDraft) {
      notifyUser("Veuillez importer un devis PDF avant de créer le dossier.", "error");
      return;
    }

    const data = new FormData(form);
    const info = quickEstimateCreationDraft.parsed.info || {};

    let plateVal = data.has("plate") ? data.get("plate") : (info.plate || "");
    let vinVal = data.has("vin") ? data.get("vin") : (info.vin || "");

    const normPlateVal = normalizeIdentifierValue(plateVal);
    if (normPlateVal.length === 17) {
      vinVal = normPlateVal;
      plateVal = "";
    }

    let candidate = {
      clientName: info.clientName || "Client devis",
      phone: data.has("phone") ? data.get("phone") : (info.phone || ""),
      vehicle: info.vehicle || "Véhicule à compléter",
      plate: plateVal,
      vin: vinVal,
      mileage: data.has("mileage") ? data.get("mileage") : (info.mileage || ""),
      orNavNumber: info.estimateNumber || info.orNumber || "",
    };

    const validation = validateReceptionCaseCandidate(candidate);
    candidate = validation.normalized;
    if (!validation.ok) {
      renderFormValidationErrors(form, validation, "case-form-errors");
      notifyUser(validation.messages.join("\n"), "error");
      return;
    }
    renderFormValidationErrors(form, validation, "case-form-errors");

    const duplicate = findDuplicateCase(candidate);
    if (duplicate) {
      const isStrictDuplicate = duplicate.clientName === candidate.clientName && (duplicate.plate === candidate.plate || duplicate.vin === candidate.vin) && !duplicate.flags?.delivered;
      if (isStrictDuplicate) {
        notifyUser("Un dossier strictement identique et non livré existe déjà pour ce client et ce véhicule.", "error");
        return;
      } else {
        const confirmed = await showConfirmModal(`Un dossier similaire existe déjà pour ce véhicule ou ce client (${duplicate.clientName}). Vérifiez le dossier existant avant de continuer.<br><br>Créer quand même un nouveau dossier ?`);
        if (!confirmed) {
          activeCaseId = duplicate.id;
          setActiveTab("dossiers");
          render();
          return;
        }
      }
    }

    const item = normalizeCase({
      ...candidate,
      id: uid("case"),
      createdAt: new Date().toISOString(),
      durations: Object.fromEntries(DURATIONS.map(([key]) => [key, 0])),
      history: [makeHistoryEntry("case.created", "Dossier créé", new Date().toISOString())],
    });

    const inferredType = inferOrderTypeFromEstimate(quickEstimateCreationDraft.parsed);
    const orderTitle = inferOrderTitleFromEstimate(quickEstimateCreationDraft.parsed) || getClaimTypeLabel(inferredType);

    const firstClaim = normalizeRepairClaim({
      id: uid("claim"),
      number: "OT-001",
      title: orderTitle,
      type: inferredType,
      status: "approved",
      includeInPlanning: true,
      expertApproved: true,
      clientApproved: true,
      orNumber: item.orNavNumber || "",
    }, 0);
    item.claims = [firstClaim];
    addHistory(item, "claim.created", "Premier ordre de réparation créé", getClaimLabel(firstClaim));

    state.cases.unshift(item);
    activeCaseId = item.id;
    activeCaseDetailTab = "claims";

    const parsed = enrichParsedEstimateInfo(quickEstimateCreationDraft.parsed, quickEstimateCreationDraft.metadata);
    const preview = prepareEstimateImportPreview(parsed, item);
    preview.sourceFile = makeQuickEstimateSourceFile(fileInput.files?.[0]);
    await applyEstimateImportToClaim(item, firstClaim, preview, { silent: true });
    if (parsed.info?.clientName) item.clientName = parsed.info.clientName;
    addHistory(item, "claim.estimate.imported", "Devis importé à la création", `${formatLocalizedDecimal(preview.detectedHours)} h MO détectées.`);

    refreshCaseApprovalFlagsFromClaims(item);
    saveState();
    form.reset();
    quickEstimateCreationDraft = null;
    updateMissingFieldsUI(null);
    render();
    notifyUser("Dossier créé avec devis importé.", "success");
  });

  $("#new-case-shortcut")?.addEventListener("click", () => {
    if (typeof startReceptionCaseCreation === "function") startReceptionCaseCreation();
    else {
      setActiveTab("dossiers");
      form.reset();
      form.elements.clientName.focus();
      renderQuickVinResults();
    }
  });

  $("#open-reception-workspace-from-dossiers")?.addEventListener("click", () => {
    if (typeof startReceptionCaseCreation === "function") startReceptionCaseCreation();
    else setActiveTab("reception-workspace");
  });
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

function normalizeCaseStatusFilter(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw || raw === "all" || raw === "tous") return "all";

  const normalized = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[_\s-]+/g, "_");

  const aliases = {
    imported: "devis_importe",
    devis_importe: "devis_importe",
    estimate_imported: "devis_importe",

    chef_validation: "a_valider_chef_atelier",
    a_valider_chef: "a_valider_chef_atelier",
    pending_chef_validation: "a_valider_chef_atelier",
    a_valider_chef_atelier: "a_valider_chef_atelier",

    atelier_validated: "valide_atelier",
    valide_atelier: "valide_atelier",

    planned: "planifie",
    planifie: "planifie",

    in_progress: "en_cours",
    en_cours: "en_cours",

    paused: "en_pause",
    en_pause: "en_pause",

    blocked: "bloque",
    bloque: "bloque",

    atelier_completed: "termine_atelier",
    termine_atelier: "termine_atelier",

    atelier_closed: "cloture_atelier",
    cloture_atelier: "cloture_atelier",

    archived: "archive",
    archive: "archive",
  };

  const knownStatuses = typeof statusLabels === "object" && statusLabels ? statusLabels : {};
  return aliases[normalized] || (knownStatuses[normalized] ? normalized : "all");
}

if (typeof window !== "undefined") {
  window.normalizeCaseStatusFilter = normalizeCaseStatusFilter;
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

async function buildQuickEstimateCreationDraft(file, form) {
  const extracted = await extractEstimateTextFromFile(file);
  const claimType = form?.elements?.orderType?.value || "assurance";
  const parsedBase = parseEstimateText(extracted.text, {
    fileName: file.name,
    sourceType: extracted.sourceType,
    rows: extracted.rows,
    lines: extracted.lines,
    claimType,
  });
  if (!parsedBase.laborLines.length) {
    notifyUser("Aucune ligne de main-d’œuvre détectée dans le devis PDF. Vous pourrez ajouter des tâches manuellement.", "warning");
  }
  const metadata = inferEstimateCreationMetadata(parsedBase, extracted);
  return {
    signature: getQuickEstimateFileSignature(file),
    parsed: enrichParsedEstimateInfo(parsedBase, metadata),
    metadata,
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
    .replace(/^(DFM|DONGFENG|CHERY|HYUNDAI|KIA|TOYOTA|PEUGEOT|RENAULT|NISSAN|VOLKSWAGEN|MG|HAVAL|FIAT|CITROEN|MITSUBISHI|ISUZU)\s+/i, "")
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
  const normalizeStatusFilter = typeof normalizeCaseStatusFilter === "function"
    ? normalizeCaseStatusFilter
    : (value) => String(value || "all").trim().toLowerCase();
  const search = $("#case-search");
  search?.addEventListener("input", renderCases);

  const status = $("#case-status-filter");
  if (status) {
    status.value = normalizeStatusFilter(state.ui?.caseStatusFilter);
    status.addEventListener("change", () => {
      state.ui.caseStatusFilter = normalizeStatusFilter(status.value);
      status.value = state.ui.caseStatusFilter;
      saveState();
      renderCases();
    });
  }

  const type = $("#case-type-filter");
  if (type) {
    type.value = state.ui?.caseTypeFilter || "all";
    type.addEventListener("change", () => {
      state.ui.caseTypeFilter = type.value;
      saveState();
      renderCases();
    });
  }

  const sort = $("#case-sort");
  if (sort) {
    sort.value = state.ui?.caseSort || "recent";
    sort.addEventListener("change", () => {
      state.ui.caseSort = sort.value;
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
    const permission = guardAction("planning.edit", {}, { notify: false });
    if (!permission.ok) return notifyUser(permission.message, "error");
    const form = event.currentTarget;
    const data = new FormData(form);
    state.resources.push(normalizeResource({
      id: uid("resource"),
      name: normalizeTextInputValue(data.get("name")),
      role: data.get("role"),
      location: normalizeTextInputValue(data.get("location")),
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
    const isSensitive = ["admin", "chef_atelier", "directeur_sav"].includes(role);

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
  const guard = typeof guardSensitiveAction === "function"
    ? guardSensitiveAction
    : () => ({
        ok: false,
        allowed: false,
        message: "Action sensible indisponible : garde de sécurité non chargée.",
        reason: "Action sensible indisponible : garde de sécurité non chargée.",
      });
  [
    ["#export-backup", "export.backup"],
    ["#export-encrypted-backup", "export.backup"],
    ["#import-backup", "import.backup"],
    ["#restore-auto-snapshot", "import.backup"],
    ["#export-safety-snapshot", "export.backup"],
  ].forEach(([selector, permission]) => {
    const target = $(selector);
    if (!target) return;
    const result = guard(permission, {}, { notify: false });
    const allowed = result.ok !== false && result.allowed !== false;
    const message = result.message || result.reason || "";
    target.disabled = !allowed;
    target.title = message;
    target.closest("label")?.classList.toggle("disabled-card", !allowed);
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
  window.addEventListener("load", async () => {
    try {
      const registration = await navigator.serviceWorker.register("sw.js?v=23.2.7-hotfix-startup", { updateViaCache: "none" });
      registration.update?.();
      if (registration.waiting) showUpdateAvailable(registration);
      window.setInterval(() => registration.update?.(), 10 * 60 * 1000);
      setupServiceWorkerUpdates(registration);
    } catch (error) {
      console.warn("Service worker non enregistré", error);
    }
  });
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
            version: "v23.2.7-hotfix-startup",
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
  const login = document.getElementById("user-login-overlay");
  const change = document.getElementById("user-pin-change-overlay");
  return Boolean((login && !login.hidden) || (change && !change.hidden));
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

function getSessionActiveUsers() {
  return (state.users || []).filter(user => user.active !== false);
}

function canUseFirstAccessRecovery() {
  return getSessionActiveUsers().length === 0;
}

function renderFirstAccessRecoveryState(activeUsers = getSessionActiveUsers()) {
  const loginForm = document.getElementById("user-login-form");
  const recoveryForm = document.getElementById("first-access-recovery-form");
  const recoveryStatus = document.getElementById("first-access-recovery-status");
  const recoveryMessage = document.getElementById("first-access-recovery-message");
  const hasActiveUsers = activeUsers.length > 0;

  if (loginForm) loginForm.hidden = !hasActiveUsers;
  if (recoveryForm) recoveryForm.hidden = hasActiveUsers;
  if (recoveryStatus) recoveryStatus.textContent = "";
  if (recoveryMessage) {
    recoveryMessage.textContent = hasActiveUsers
      ? ""
      : "Aucun utilisateur actif trouvé. Créez explicitement un utilisateur local de récupération ou importez une sauvegarde.";
  }
  return !hasActiveUsers;
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

function showUserLoginScreen() {
  const overlay = document.getElementById("user-login-overlay");
  if (overlay) {
    captureUserSessionReturnFocus();
    bindUserSessionOverlayKeyboard(overlay);
    overlay.hidden = false;
    document.querySelector(".app-shell")?.setAttribute("inert", "");
    renderUserLoginScreen();
    focusUserSessionDialog(overlay, canUseFirstAccessRecovery() ? "#first-access-name" : "#user-login-select");
  }
}

function hideUserLoginScreen() {
  const overlay = document.getElementById("user-login-overlay");
  if (overlay) {
    overlay.hidden = true;
    const status = document.getElementById("user-login-status");
    if (status) status.textContent = "";
    const recoveryStatus = document.getElementById("first-access-recovery-status");
    if (recoveryStatus) recoveryStatus.textContent = "";
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
  const login = document.getElementById("user-login-overlay");
  const change = document.getElementById("user-pin-change-overlay");
  const localLock = document.getElementById("local-lock-overlay");
  const anyVisible = (login && !login.hidden) ||
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

  const activeUsers = getSessionActiveUsers();
  const recoveryMode = renderFirstAccessRecoveryState(activeUsers);

  selectEl.innerHTML = activeUsers.map(user => {
    const roleLabel = {
      admin: "Admin technique",
      chef_atelier: "Chef d'atelier",
      directeur_sav: "Directeur SAV",
      reception: "Réception",
      technicien: "Technicien",
      qualite: "Qualité",
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

  if (recoveryMode) {
    updateLoginPinRequirement();
    return;
  }

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
      pinInput.required = true;
      pinInput.placeholder = "PIN requis pour ce compte";
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
function triggerLogout() {
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

async function handleFirstAccessRecoverySubmit(event) {
  event?.preventDefault?.();
  const form = event?.currentTarget || event?.target || document.getElementById("first-access-recovery-form");
  const statusEl = document.getElementById("first-access-recovery-status");
  if (statusEl) statusEl.textContent = "";
  if (!form) return false;

  if (!canUseFirstAccessRecovery()) {
    if (statusEl) statusEl.textContent = "La récupération locale est indisponible car un utilisateur actif existe déjà.";
    renderUserLoginScreen();
    return false;
  }

  const name = normalizeTextInputValue(form.elements.name.value);
  const role = form.elements.role.value;
  const pin = String(form.elements.pin.value || "").trim();
  const pinConfirm = String(form.elements.pinConfirm.value || "").trim();

  if (!name) {
    if (statusEl) statusEl.textContent = "Nom utilisateur obligatoire.";
    form.elements.name.focus();
    return false;
  }
  if (!["admin", "directeur_sav"].includes(role)) {
    if (statusEl) statusEl.textContent = "Rôle de récupération invalide.";
    return false;
  }
  if (pin !== pinConfirm) {
    if (statusEl) statusEl.textContent = "Les deux PIN ne correspondent pas.";
    form.elements.pinConfirm.focus();
    return false;
  }

  const validation = typeof validateLocalPinStrength === "function"
    ? validateLocalPinStrength(pin)
    : { ok: pin.length >= 6, value: pin, message: "PIN trop faible." };
  if (!validation.ok) {
    if (statusEl) statusEl.textContent = validation.message || "PIN trop faible.";
    form.elements.pin.focus();
    return false;
  }

  try {
    const pinData = await createLocalPinCredentials(validation.value);
    const result = createFirstAccessRecoveryUser({ name, role, ...pinData });
    if (!result.ok) {
      if (statusEl) statusEl.textContent = result.message || "Création utilisateur impossible.";
      return false;
    }
    try {
      sessionStorage.setItem("nimr-user-pin-unlocked", result.user.id);
    } catch (error) {
      // Session storage peut être indisponible dans certains navigateurs.
    }
    form.reset();
    completeUserLogin(result.user);
    notifyUser("Utilisateur local créé. Pensez à sauvegarder vos données.", "success");
    return true;
  } catch (error) {
    if (statusEl) statusEl.textContent = error.message || "Création utilisateur impossible.";
    return false;
  }
}

function bindUserSessionActions() {
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

  const firstAccessForm = document.getElementById("first-access-recovery-form");
  firstAccessForm?.addEventListener("submit", handleFirstAccessRecoverySubmit);
  document.getElementById("first-access-import-backup")?.addEventListener("click", () => {
    document.getElementById("first-access-import-input")?.click();
  });
  document.getElementById("first-access-import-input")?.addEventListener("change", (event) => {
    if (typeof importBackup === "function") importBackup(event);
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
window.canUseFirstAccessRecovery = canUseFirstAccessRecovery;
window.handleFirstAccessRecoverySubmit = handleFirstAccessRecoverySubmit;
window.renderCurrentSessionIndicator = renderCurrentSessionIndicator;
window.resetUserSessionIdleTimer = resetUserSessionIdleTimer;
window.bindUserSessionIdleEvents = bindUserSessionIdleEvents;
// --- FIN v22.33C User Selector Startup / Shared Session ---

initApp();
