let quickEstimateCreationDraft = null;

function initApp() {
  try {
    configurePdfWorker();
    bindMainNavigation();
    bindCaseList();
    bindCaseCreation();
    bindQuickCreateMode();
    bindCaseFilters();
    bindPlanningToolbar();
    bindWorkshopForms();
    bindBackupActions();
    if (typeof bindUserSessionActions === "function") bindUserSessionActions();
    if (typeof bindUserSessionIdleEvents === "function") bindUserSessionIdleEvents();
    if (typeof bindLocalSecurityControls === "function") bindLocalSecurityControls();
    bindOfflineStatus();
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
        renderSavKpis();
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

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const createGuard = guardCaseCreate();
    if (!createGuard.ok) return;
    const data = new FormData(form);
    const estimateFile = data.get("estimateFile");
    const hasEstimateFile = estimateFile && estimateFile.name;
    const orderType = data.get("orderType") || "vidange";
    const orderTitle = normalizeTextInputValue(data.get("orderTitle")) || getClaimTypeLabel(orderType);
    const candidate = {
      clientName: normalizeTextInputValue(data.get("clientName")),
      phone: normalizeTextInputValue(data.get("phone")),
      ownerName: normalizeTextInputValue(data.get("ownerName")),
      driverName: normalizeTextInputValue(data.get("driverName")),
      driverPhone: normalizeTextInputValue(data.get("driverPhone")),
      vehicle: normalizeTextInputValue(data.get("vehicle")),
      plate: normalizeIdentifierValue(data.get("plate")),
      color: normalizeTextInputValue(data.get("color")),
      mileage: normalizeIdentifierValue(data.get("mileage")),
      vin: normalizeIdentifierValue(data.get("vin")),
      orNavNumber: normalizeIdentifierValue(data.get("orNavNumber")),
    };
    const visibleVehicleIdentity = candidate.plate.replace(/[^A-Z0-9]/gi, "").toUpperCase();
    if (!candidate.vin && /^[A-HJ-NPR-Z0-9]{17}$/.test(visibleVehicleIdentity)) {
      candidate.vin = visibleVehicleIdentity;
      candidate.plate = "";
    }

    if (!candidate.clientName) {
      notifyUser("Le nom du client est obligatoire pour créer un dossier. Renseignez le propriétaire ou la société.", "error");
      form.elements.clientName?.focus();
      return;
    }
    if (!candidate.vehicle && !candidate.plate && !candidate.vin) {
      notifyUser("Renseignez au moins le véhicule, l'immatriculation ou le VIN avant de créer le dossier.", "error");
      form.elements.vehicle?.focus();
      return;
    }
    if (!candidate.plate && !candidate.vin) {
      notifyUser("Dossier créé sans immatriculation/VIN : complétez l'identité véhicule avant le planning.", "warn");
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
      durations: Object.fromEntries(DURATIONS.map(([key]) => [key, 0])),
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
    
    let pinData = {};
    if (pin) {
      if (pin.length < 4) {
        return notifyUser("Le PIN de sécurité doit contenir au moins 4 chiffres.", "error");
      }
      const bytes = new Uint8Array(16);
      if (globalThis.crypto?.getRandomValues) {
        globalThis.crypto.getRandomValues(bytes);
      } else {
        for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
      }
      const salt = bytesToBase64(bytes);
      const hash = await deriveLocalPinHash(pin, salt);
      pinData = { pinHash: hash, pinSalt: salt };
    } else if (isSensitive && !userId) {
      // Pour les nouveaux utilisateurs sensibles, on attribue le PIN temporaire 0000
      const salt = "bootstrapsalt";
      const hash = await deriveLocalPinHash("0000", salt);
      pinData = { pinHash: hash, pinSalt: salt };
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
  window.addEventListener("load", async () => {
    try {
      const registration = await navigator.serviceWorker.register("sw.js?v=23.1.7", { updateViaCache: "none" });
      registration.update?.();
      if (registration.waiting) showUpdateAvailable(registration);
      window.setInterval(() => registration.update?.(), 10 * 60 * 1000);
      setupServiceWorkerUpdates(registration);
    } catch (error) {
      console.warn("Service worker non enregistré", error);
    }
  });
}

function renderActivityLog() {
  const panel = $("#panel-activity-log");
  if (!panel) return;

  const allowed = hasPermission("audit.view");
  panel.hidden = !allowed;
  if (!allowed) return;

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
        ${conflicts.map((conflict) => `
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
        `).join("")}
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
        descEl.textContent = "Un code PIN de sécurité doit être défini avant le premier accès à l'application.";
      } else {
        descEl.textContent = "Le PIN temporaire `0000` doit être modifié avant le premier accès à l'application.";
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

  const activeUsers = (state.users || []).filter(user => user.active !== false);

  selectEl.innerHTML = activeUsers.map(user => {
    const roleLabel = {
      admin: "Administrateur",
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

function triggerUserChangeScreen() {
  sessionStorage.removeItem("nimr-user-pin-unlocked");
  showUserLoginScreen();
}

function renderCurrentSessionIndicator() {
  const currentUser = getCurrentUser();
  const sidebarUserName = document.getElementById("sidebar-user-name");
  if (sidebarUserName) {
    sidebarUserName.textContent = currentUser ? `${currentUser.name} (${currentUser.role === "admin" ? "Admin" : currentUser.role})` : "Atelier";
  }

  // Mettre à jour l'option checkbox dans les Paramètres
  const alwaysPromptCheckbox = document.getElementById("always-prompt-startup");
  if (alwaysPromptCheckbox) {
    const activeUsers = (state.users || []).filter(user => user.active !== false);
    // Cochée par défaut si non définie et plusieurs utilisateurs, ou si configurée explicitement à vrai
    const isChecked = state.settings.alwaysPromptUserStartup === true || 
                      (state.settings.alwaysPromptUserStartup !== false && activeUsers.length > 1);
    alwaysPromptCheckbox.checked = isChecked;

    // Seul l'admin peut modifier cette option
    const isAdmin = currentUser && currentUser.role === "admin";
    alwaysPromptCheckbox.disabled = !isAdmin;
    const container = alwaysPromptCheckbox.closest(".check-card");
    if (container) {
      container.style.opacity = isAdmin ? "1" : "0.6";
      container.title = isAdmin ? "" : "Action réservée administrateur.";
    }
  }
}

function bindUserSessionActions() {
  // Option checkbox dans Paramètres
  const alwaysPromptCheckbox = document.getElementById("always-prompt-startup");
  alwaysPromptCheckbox?.addEventListener("change", (event) => {
    const currentUser = getCurrentUser();
    if (!currentUser || currentUser.role !== "admin") {
      notifyUser("Action réservée administrateur.", "error");
      renderCurrentSessionIndicator();
      return;
    }
    state.settings.alwaysPromptUserStartup = event.currentTarget.checked;
    saveState();
    quietNotify("Paramètre de session mis à jour.", "success");
  });

  // Boutons pour changer d'utilisateur
  document.getElementById("sidebar-change-user-btn")?.addEventListener("click", () => {
    sessionStorage.removeItem("nimr-user-pin-unlocked");
    triggerUserChangeScreen();
  });
  document.getElementById("change-user-settings-btn")?.addEventListener("click", () => {
    sessionStorage.removeItem("nimr-user-pin-unlocked");
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

        // Si c'est le PIN bootstrap 0000 -> forcer changement
        if (pinVal === "0000" && user.pinHash.startsWith("mockhash:0000:")) {
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

    if (newPin.length < 4) {
      if (statusEl) statusEl.textContent = "Le PIN doit contenir au moins 4 chiffres avant validation.";
      return;
    }
    if (newPin === "0000") {
      if (statusEl) statusEl.textContent = "Le PIN doit être différent de 0000 pour sécuriser l'accès.";
      return;
    }
    if (newPin !== confirmNewPin) {
      if (statusEl) statusEl.textContent = "Les deux PIN ne correspondent pas. Ressaisissez la confirmation.";
      return;
    }

    try {
      const bytes = new Uint8Array(16);
      if (globalThis.crypto?.getRandomValues) {
        globalThis.crypto.getRandomValues(bytes);
      } else {
        for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
      }
      const salt = bytesToBase64(bytes);
      const hash = await deriveLocalPinHash(newPin, salt);

      const userObj = state.users.find(u => u.id === user.id);
      if (userObj) {
        userObj.pinHash = hash;
        userObj.pinSalt = salt;
        userObj.updatedAt = new Date().toISOString();
      }

      addAuditLog("users.pin_bootstrap_changed", `PIN de sécurité défini pour ${user.name}`, "Mise à jour obligatoire du PIN bootstrap");
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

