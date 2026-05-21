let quickEstimateCreationDraft = null;

function initApp() {
  try {
    configurePdfWorker();
    bindMainNavigation();
    bindCaseList();
    bindCaseCreation();
    bindCaseFilters();
    bindPlanningToolbar();
    bindWorkshopForms();
    bindBackupActions();
    if (typeof bindSupabaseActions === "function") bindSupabaseActions();
    bindVehicleLookup();
    bindKeyboardShortcuts();
    bindAutoSaveSafety();
    if (typeof migratePlanningLogicV28 === "function") migratePlanningLogicV28();
    if (typeof migratePlanningLogicV36 === "function") migratePlanningLogicV36();

    setActiveTab(activeTab || "dossiers");
    render();
    bindWorkHoursInputs();
    loadBundledVehicleDatabase();
    migrateLegacyPhotos();
    registerServiceWorker();
  } catch (error) {
    console.error("Initialisation impossible", error);
    notifyUser("L'application n'a pas pu démarrer. Ouvrez la console navigateur pour le détail.", "error");
  }
}

function bindAutoSaveSafety() {
  window.addEventListener("beforeunload", forceEmergencyAutosave);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") forceEmergencyAutosave();
  });
  window.addEventListener("pagehide", forceEmergencyAutosave);
  window.setInterval(forceEmergencyAutosave, 10000);
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
      if (tab === "planning") renderPlanning();
      if (tab === "atelier") {
        renderResources();
        renderFastLaneSettings();
        renderWorkHoursSettings();
        renderHolidays();
        renderResourceLeaves();
        bindWorkHoursInputs();
        if (typeof refreshSupabasePanel === "function") refreshSupabasePanel();
      }
      if (tab === "pilotage") {
        renderSavKpis();
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

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const estimateFile = data.get("estimateFile");
    const hasEstimateFile = estimateFile && estimateFile.name;
    const orderType = data.get("orderType") || "assurance";
    const orderTitle = normalizeTextInputValue(data.get("orderTitle")) || getClaimTypeLabel(orderType);
    const candidate = {
      clientName: normalizeTextInputValue(data.get("clientName")),
      phone: normalizeTextInputValue(data.get("phone")),
      vehicle: normalizeTextInputValue(data.get("vehicle")),
      plate: normalizeIdentifierValue(data.get("plate")),
      color: normalizeTextInputValue(data.get("color")),
      mileage: normalizeIdentifierValue(data.get("mileage")),
      vin: normalizeIdentifierValue(data.get("vin")),
      orNavNumber: normalizeIdentifierValue(data.get("orNavNumber")),
    };

    if (!candidate.clientName) {
      notifyUser("Le nom du client est obligatoire pour créer un dossier.", "error");
      form.elements.clientName?.focus();
      return;
    }
    if (!candidate.vehicle && !candidate.plate && !candidate.vin) {
      notifyUser("Renseignez au moins le véhicule, l'immatriculation ou le VIN.", "error");
      form.elements.vehicle?.focus();
      return;
    }
    if (!candidate.plate && !candidate.vin) {
      notifyUser("Dossier créé sans identité véhicule complète : complétez l'immatriculation ou le VIN avant de calculer le planning.", "warn");
    }
    if (!candidate.vehicle) {
      candidate.vehicle = "Véhicule à compléter";
    }
    if (!candidate.plate && !candidate.vin && hasEstimateFile) {
      notifyUser("Le devis a été importé, mais aucun VIN ou immatriculation n'a été détecté.", "warn");
    }
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
      clientName: candidate.clientName || "Client devis",
      id: uid("case"),
      createdAt: new Date().toISOString(),
      history: [makeHistoryEntry("case.created", "Dossier créé", new Date().toISOString())],
    });

    const firstClaim = normalizeRepairClaim({
      id: uid("claim"),
      number: "OT-001",
      title: orderTitle,
      type: orderType,
      status: isClientOnlyRepairClaim({ type: orderType }) ? "client_pending" : "expert_pending",
      includeInPlanning: true,
      expertApproved: isClientOnlyRepairClaim({ type: orderType }),
      clientApproved: false,
      orNumber: item.orNavNumber || "",
    }, 0);
    item.claims = [firstClaim];
    addHistory(item, "claim.created", "Premier ordre de réparation créé", getClaimLabel(firstClaim));

    state.cases.unshift(item);
    activeCaseId = item.id;
    activeCaseDetailTab = "infos";

    if (hasEstimateFile) {
      const quickStatus = $("#quick-estimate-import-status");
      const validationError = validateEstimateImportFile(estimateFile);
      if (validationError) {
        notifyUser(validationError, "error");
      } else {
        try {
          if (quickStatus) quickStatus.textContent = "Analyse du devis...";
          const draft = quickEstimateCreationDraft?.signature === getQuickEstimateFileSignature(estimateFile)
            ? quickEstimateCreationDraft
            : await buildQuickEstimateCreationDraft(estimateFile, form);
          const parsed = enrichParsedEstimateInfo(draft.parsed, draft.metadata);
          const preview = prepareEstimateImportPreview(parsed, item);
          preview.sourceFile = makeQuickEstimateSourceFile(estimateFile);
          await applyEstimateImportToClaim(item, firstClaim, preview, { silent: true });
          if (!candidate.clientName && parsed.info?.clientName) item.clientName = parsed.info.clientName;
          addHistory(item, "claim.estimate.imported", "Devis importé à la création", `${formatLocalizedDecimal(preview.detectedHours)} h MO détectées.`);
          if (quickStatus) quickStatus.textContent = "Devis importé dans le premier OR.";
        } catch (error) {
          console.error("Import devis à la création impossible", error);
          if (quickStatus) quickStatus.textContent = "Import devis impossible.";
          notifyUser(error.message || "Dossier créé, mais import devis impossible.", "error");
        }
      }
    }

    refreshCaseApprovalFlagsFromClaims(item);
    saveState();
    form.reset();
    render();
    notifyUser(hasEstimateFile ? "Dossier créé avec devis importé." : "Dossier créé avec premier ordre de réparation.", "success");
  });


  form.elements?.orderType?.addEventListener("change", () => {
    form.elements.orderType.dataset.userSelected = "true";
  });

  const quickEstimateInput = $("#quick-estimate-file-input", form);
  quickEstimateInput?.addEventListener("change", async () => {
    const file = quickEstimateInput.files?.[0];
    const status = $("#quick-estimate-import-status");
    quickEstimateCreationDraft = null;
    if (!file) {
      if (status) status.textContent = "Optionnel : le devis remplit client, véhicule, OR et main-d'œuvre.";
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
      applyQuickEstimateCreationDraftToForm(form, quickEstimateCreationDraft);
      if (status) {
        const info = quickEstimateCreationDraft.parsed.info || {};
        const reference = cleanParsedEstimateNumber(info.estimateNumber) || info.orNumber || file.name;
        status.textContent = `Devis lu : ${reference} - ${formatLocalizedDecimal(quickEstimateCreationDraft.parsed.detectedHours)} h MO détectées. Cliquez sur Créer dossier pour valider.`;
      }
    } catch (error) {
      console.error("Pré-import devis création impossible", error);
      quickEstimateCreationDraft = null;
      if (status) status.textContent = "Import devis impossible.";
      notifyUser(error.message || "Impossible de lire ce devis.", "error");
    }
  });

  $("#new-case-shortcut")?.addEventListener("click", () => {
    setActiveTab("dossiers");
    form.reset();
    form.elements.clientName.focus();
    renderQuickVinResults();
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
    throw new Error("Aucune ligne de main-d'œuvre détectée dans le devis importé.");
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
  const search = $("#case-search");
  search?.addEventListener("input", renderCases);

  const status = $("#case-status-filter");
  if (status) {
    status.value = state.ui?.caseStatusFilter || "all";
    status.addEventListener("change", () => {
      state.ui.caseStatusFilter = status.value;
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

  bindWorkHoursInputs();
}

function updateFastLaneSettings() {
  const form = $("#fastlane-form");
  if (!form) return;
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
  $("#import-backup")?.addEventListener("change", importBackup);
  $("#control-autosave")?.addEventListener("click", controlAutosaveHealth);
  $("#export-safety-snapshot")?.addEventListener("click", exportSafetySnapshotNow);
  $("#restore-auto-snapshot")?.addEventListener("click", restoreLatestAutomaticSnapshot);
  renderAutosaveHealthStatus();
}

function bindVehicleLookup() {
  $("#quick-vehicle-file-input")?.addEventListener("change", handleQuickVehicleFile);
  $("#case-form")?.elements?.vin?.addEventListener("input", renderQuickVinResults);
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  let reloadingForUpdate = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloadingForUpdate) return;
    reloadingForUpdate = true;
    forceEmergencyAutosave();
    window.location.reload();
  });
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type === "APP_UPDATED") {
      forceEmergencyAutosave();
      notifyUser("Nouvelle version installée. Rechargement automatique...", "success");
      setTimeout(() => window.location.reload(), 350);
    }
  });
  window.addEventListener("load", async () => {
    try {
      const registration = await navigator.serviceWorker.register("sw.js?v=22.08", { updateViaCache: "none" });
      registration.update?.();
      if (registration.waiting) registration.waiting.postMessage({ type: "SKIP_WAITING" });
      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        if (!worker) return;
        worker.addEventListener("statechange", () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller) {
            forceEmergencyAutosave();
            worker.postMessage({ type: "SKIP_WAITING" });
          }
        });
      });
      window.setInterval(() => registration.update?.(), 10 * 60 * 1000);
      setupServiceWorkerUpdates(registration);
    } catch (error) {
      console.warn("Service worker non enregistré", error);
    }
  });
}

initApp();

