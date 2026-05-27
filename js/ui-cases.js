function render() {
  renderSyncStatusStrip();
  renderMetrics();
  renderSavKpis();
  renderTodayWorkshop();
  renderCases();
  renderCaseDetail();
  renderPilotageAlerts();
  renderKanban();
  renderPlanning();
  renderTechnicianDashboard();
  renderResources();
  renderHolidays();
  renderResourceLeaves();
  renderFastLaneSettings();
  renderWorkHoursSettings();
}

function renderMetrics() {
  const active = state.cases.filter((item) => !item.flags.delivered).length;
  const waiting = state.cases.filter((item) => getNextWorkflowAction(item) && getBusinessRuleIssues(item, getNextWorkflowAction(item)).length).length;
  const deliveries = state.cases.filter((item) => item.appointment && !item.flags.delivered).length;
  $("#metric-active").textContent = active;
  $("#metric-waiting").textContent = waiting;
  $("#metric-deliveries").textContent = deliveries;
  const today = new Date();
  const loadMetrics = [
    ["#metric-load-body-human", categoryHumanDayLoad(today, "body")],
    ["#metric-load-body-equipment", categoryEquipmentDayLoad(today, "body")],
    ["#metric-load-fast-human", categoryHumanDayLoad(today, "fast")],
    ["#metric-load-fast-equipment", categoryEquipmentDayLoad(today, "fast")],
    ["#metric-load-heavy-human", categoryHumanDayLoad(today, "heavy")],
    ["#metric-load-heavy-equipment", categoryEquipmentDayLoad(today, "heavy")],
  ];
  loadMetrics.forEach(([selector, value]) => {
    const metric = $(selector);
    if (metric) metric.textContent = `${Math.round(value * 100)}%`;
  });
  const humanMetric = $("#metric-load-human");
  const equipmentMetric = $("#metric-load-equipment");
  if (humanMetric) humanMetric.textContent = `${Math.round(humanDayLoad(today) * 100)}%`;
  if (equipmentMetric) equipmentMetric.textContent = `${Math.round(equipmentDayLoad(today) * 100)}%`;
  const legacyMetric = $("#metric-load");
  if (legacyMetric) legacyMetric.textContent = `${Math.round(dayLoad(today) * 100)}%`;
}

function renderSavKpis() {
  const target = $("#sav-kpi-grid");
  if (!target) return;
  target.innerHTML = buildSavKpis()
    .map((kpi) => `
      <article class="sav-kpi-card ${kpi.level || "neutral"}">
        <span>${escapeHtml(kpi.label)}</span>
        <strong>${escapeHtml(kpi.value)}</strong>
        <small>${escapeHtml(kpi.detail)}</small>
      </article>
    `)
    .join("");
}

function buildSavKpis(now = new Date()) {
  const activeCases = state.cases.filter((item) => !item.flags.delivered);
  const today = todayKey(now);
  const appointmentsToday = activeCases.filter((item) => item.appointment?.start && todayKey(item.appointment.start) === today).length;
  const lateReceptions = activeCases.filter((item) => {
    if (!item.appointment?.start || item.flags.received) return false;
    return diffMinutes(new Date(item.appointment.start), now) > RECEPTION_GRACE_HOURS * 60;
  }).length;
  const workshopVehicles = activeCases.filter((item) => item.flags.received && !item.flags.delivered).length;
  const workInProgress = activeCases.filter((item) => item.flags.workStarted && !item.flags.workCompleted).length;
  const qualityQueue = activeCases.filter((item) => item.flags.workCompleted && !item.flags.qualityApproved).length;
  const deliveryRiskCases = activeCases.filter((item) => {
    if (!item.appointment?.delivery || item.flags.delivered || item.flags.qualityApproved) return false;
    return diffMinutes(now, new Date(item.appointment.delivery)) <= DELIVERY_ALERT_HOURS * 60;
  });
  const overdueDeliveries = deliveryRiskCases.filter((item) => new Date(item.appointment.delivery) < now).length;
  const agreementReady = activeCases.filter((item) => item.flags.expertApproved && item.flags.clientApproved).length;
  const agreementRate = activeCases.length ? Math.round((agreementReady / activeCases.length) * 100) : 100;
  const scheduledCases = activeCases.filter((item) => item.appointment?.start && item.appointment?.delivery);
  const averageLeadHours = scheduledCases.length
    ? scheduledCases.reduce((sum, item) => sum + diffMinutes(item.appointment.start, item.appointment.delivery) / 60, 0) / scheduledCases.length
    : 0;

  return [
    {
      label: "RDV aujourd'hui",
      value: String(appointmentsToday),
      detail: "Dépôts planifiés",
      level: appointmentsToday ? "info" : "neutral",
    },
    {
      label: "Réceptions en retard",
      value: String(lateReceptions),
      detail: `Tolérance ${formatLocalizedDecimal(RECEPTION_GRACE_HOURS)} h`,
      level: lateReceptions ? "danger" : "success",
    },
    {
      label: "Véhicules atelier",
      value: String(workshopVehicles),
      detail: "Reçus non livrés",
      level: workshopVehicles ? "info" : "neutral",
    },
    {
      label: "Travaux en cours",
      value: String(workInProgress),
      detail: "Démarrés non clôturés",
      level: workInProgress ? "info" : "neutral",
    },
    {
      label: "Qualité à traiter",
      value: String(qualityQueue),
      detail: "Travaux terminés",
      level: qualityQueue ? "warn" : "success",
    },
    {
      label: "Livraisons à risque",
      value: String(deliveryRiskCases.length),
      detail: overdueDeliveries ? `${overdueDeliveries} dépassée(s)` : `Dans ${DELIVERY_ALERT_HOURS} h`,
      level: overdueDeliveries ? "danger" : deliveryRiskCases.length ? "warn" : "success",
    },
    {
      label: "Accords complets",
      value: `${agreementRate}%`,
      detail: `${agreementReady}/${activeCases.length} dossiers actifs`,
      level: agreementRate >= 80 ? "success" : agreementRate >= 50 ? "warn" : "danger",
    },
    {
      label: "Délai moyen estimé",
      value: `${formatLocalizedDecimal(averageLeadHours)} h`,
      detail: "RDV dépôt → livraison",
      level: averageLeadHours > 48 ? "warn" : "neutral",
    },
  ];
}


function getCasePrimaryType(item) {
  const claims = normalizeRepairClaims(item?.claims || [], item);
  if (!claims.length) return "assurance";
  const included = claims.filter((claim) => claim.includeInPlanning !== false);
  const source = included.length ? included : claims;
  const priority = ["assurance", "client", "vidange", "mechanical_client", "electrical_client", "garantie"];
  return priority.find((type) => source.some((claim) => (claim.type || "assurance") === type)) || source[0]?.type || "assurance";
}

function caseMatchesTypeFilter(item, filter) {
  if (!filter || filter === "all") return true;
  const claims = normalizeRepairClaims(item?.claims || [], item);
  if (!claims.length) return filter === "assurance";
  return claims.some((claim) => (claim.type || "assurance") === filter);
}

function getCaseTypeSummary(item) {
  const claims = normalizeRepairClaims(item?.claims || [], item);
  if (!claims.length) return getClaimTypeLabel("assurance");
  const types = [...new Set(claims.map((claim) => claim.type || "assurance"))];
  return types.map(getClaimTypeLabel).join(" + ");
}

function getCaseBookings(item) {
  return state.bookings.filter((booking) => booking.caseId === item?.id && booking.type !== "leave");
}

function hasCaseBookings(item) {
  return getCaseBookings(item).length > 0;
}

function hasKnownLabor(item) {
  const workflowClaims = getWorkflowClaims(item);
  if (workflowClaims.some((claim) => claimHasLaborEstimate(claim))) return true;
  return ESTIMATE_PLANNING_KEYS.some((key) => Number(item?.durations?.[key] || 0) > 0);
}

function caseHasCompletedValidations(item) {
  const workflowClaims = getWorkflowClaims(item);
  if (!workflowClaims.length) return false;
  return workflowClaims.every((claim) => claim.clientApproved && (isClientOnlyRepairClaim(claim) || claim.expertApproved));
}

function getDeliveryDueState(item, now = new Date()) {
  const delivery = item?.appointment?.delivery ? new Date(item.appointment.delivery) : null;
  if (!delivery || Number.isNaN(delivery.getTime())) return "none";
  if (delivery <= now) return "due";
  return delivery.getTime() - now.getTime() <= 4 * 60 * 60 * 1000 ? "soon" : "later";
}

function getCaseNextAction(item) {
  if (!item) {
    return { code: "done", label: "Terminé", priority: "normal", reason: "Aucun dossier actif." };
  }
  if (isCaseBlocked(item)) {
    return {
      code: "resolve_blocker",
      label: "Résoudre le blocage",
      priority: "blocked",
      reason: getCaseBlockerLabel(item) || "Le dossier est marqué comme bloqué.",
    };
  }
  const workflowClaims = getWorkflowClaims(item);
  if (!hasVehicleIdentity(item)) {
    return {
      code: "complete_vehicle_identity",
      label: "Compléter l'identité véhicule",
      priority: "attention",
      reason: "Ajoutez une immatriculation ou un VIN avant de poursuivre.",
    };
  }
  if (!workflowClaims.length || workflowClaims.some((claim) => !claimHasLaborEstimate(claim)) || !hasKnownLabor(item)) {
    return {
      code: "add_labor",
      label: "Ajouter la main-d'œuvre",
      priority: "attention",
      reason: "Le dossier doit contenir des heures de main-d'œuvre pour réserver l'atelier.",
    };
  }
  if (appointmentNeedsReschedule(item)) {
    return {
      code: "schedule_appointment",
      label: "Fixer le RDV client",
      priority: "urgent",
      reason: "Le RDV doit être reporté.",
    };
  }
  if (!item.appointment && !hasCaseBookings(item)) {
    return {
      code: "schedule_work",
      label: "Planifier les travaux",
      priority: "attention",
      reason: "La main-d'œuvre est connue mais aucun RDV ou créneau atelier n'est planifié.",
    };
  }
  if (!caseHasCompletedValidations(item)) {
    return {
      code: "validate_customer_or_internal",
      label: "Valider client / interne",
      priority: "attention",
      reason: "Les accords nécessaires ne sont pas encore complets.",
    };
  }
  if (!item.flags.received) {
    const start = item.appointment?.start ? new Date(item.appointment.start) : null;
    const due = start && !Number.isNaN(start.getTime()) && start <= new Date();
    return {
      code: "receive_vehicle",
      label: "Réceptionner le véhicule",
      priority: due ? "urgent" : "normal",
      reason: due ? "Le RDV de réception est arrivé ou dépassé." : "Le véhicule n'est pas encore physiquement reçu.",
    };
  }
  if (!hasCaseBookings(item)) {
    return {
      code: "schedule_work",
      label: "Planifier les travaux",
      priority: "attention",
      reason: "La main-d'œuvre est connue mais aucun créneau n'est planifié.",
    };
  }
  const bookings = getCaseBookings(item);
  const pausedOrRemainder = bookings.some((booking) => ["paused", "late_paused"].includes(getBookingOperationalStatus(booking)) || Number(booking.remainingMinutes || 0) > 0);
  if (pausedOrRemainder) {
    return {
      code: "resume_or_replan_work",
      label: "Reprendre ou reporter la tâche",
      priority: "urgent",
      reason: "Une tâche est en pause ou possède un reliquat à replanifier.",
    };
  }
  if (!item.flags.workStarted) {
    return {
      code: "start_work",
      label: "Démarrer les travaux",
      priority: "normal",
      reason: "Le véhicule est reçu et les créneaux atelier sont prêts.",
    };
  }
  if (!item.flags.workCompleted) {
    return {
      code: "finish_work",
      label: "Terminer les travaux",
      priority: "normal",
      reason: "Les travaux sont en cours.",
    };
  }
  if (!item.flags.qualityApproved) {
    return {
      code: "quality_check",
      label: "Contrôle qualité",
      priority: "attention",
      reason: "Les travaux sont terminés, le contrôle qualité reste à valider.",
    };
  }
  if (!item.flags.delivered) {
    const deliveryState = getDeliveryDueState(item);
    return deliveryState === "due" || deliveryState === "soon"
      ? { code: "deliver_vehicle", label: "Livrer le véhicule", priority: deliveryState === "due" ? "urgent" : "attention", reason: "Le véhicule est prêt pour la livraison." }
      : { code: "prepare_delivery", label: "Préparer livraison", priority: "normal", reason: "Le véhicule est contrôlé et attend la livraison." };
  }
  return { code: "done", label: "Terminé", priority: "normal", reason: "Le dossier est livré." };
}

function getCaseNextActionTab(actionCode) {
  const mapping = {
    complete_vehicle_identity: "claims",
    add_labor: "claims",
    schedule_appointment: "planning",
    receive_vehicle: "atelier",
    validate_customer_or_internal: "claims",
    schedule_work: "planning",
    start_work: "atelier",
    resume_or_replan_work: "atelier",
    finish_work: "atelier",
    quality_check: "livraison",
    prepare_delivery: "livraison",
    deliver_vehicle: "livraison",
    resolve_blocker: "claims",
    done: "livraison",
  };
  return mapping[actionCode] || "claims";
}

function renderSyncStatusStrip() {
  const target = $("#sync-status-strip");
  if (!target) return;
  const fallbackHealth = { principal: true, mirror: true, snapshots: 0, lastSavedAt: "", errors: [] };
  const health = typeof getAutosaveHealth === "function" ? getAutosaveHealth() : fallbackHealth;
  const localOk = Boolean(health.principal && health.mirror && !health.errors?.length);
  const cloudOk = safeLocalStorageGet(`${STORAGE_KEY}:last-cloud-autosave`);
  const cloudError = safeLocalStorageGet(`${STORAGE_KEY}:last-cloud-autosave-error`);
  const localChangeAt = typeof getLocalUserChangeAt === "function" ? getLocalUserChangeAt() : 0;
  const cloudAt = cloudOk ? new Date(cloudOk).getTime() || 0 : 0;
  const pending = localChangeAt && (!cloudAt || localChangeAt > cloudAt) ? 1 : 0;
  const configured = typeof isSupabaseConfigured === "function" ? isSupabaseConfigured() : false;
  const online = typeof navigator === "undefined" ? true : navigator.onLine !== false;
  const cloudLabel = !configured
    ? "Non configuré"
    : cloudError
      ? "Erreur"
      : pending
        ? "En attente"
        : cloudOk
          ? "Synchronisé"
          : "Prêt";
  setSyncItem(target, "local", localOk ? "OK" : "À vérifier", localOk ? "ok" : "warn");
  setSyncItem(target, "cloud", cloudLabel, !configured ? "muted" : cloudError ? "error" : pending ? "warn" : "ok");
  setSyncItem(target, "connection", online ? "En ligne" : "Hors ligne", online ? "ok" : "warn");
  setSyncItem(target, "last-save", formatSyncDate(health.lastSavedAt || safeReadStorageMeta()?.savedAt || ""));
  setSyncItem(target, "pending", String(pending), pending ? "warn" : "ok");
}

function setSyncItem(root, key, value, stateName = "") {
  const target = root.querySelector(`[data-sync-${key}]`);
  if (!target) return;
  target.textContent = value;
  target.dataset.state = stateName;
}

function safeLocalStorageGet(key) {
  try {
    return localStorage.getItem(key) || "";
  } catch (error) {
    return "";
  }
}

function safeReadStorageMeta() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_META_KEY) || "null");
  } catch (error) {
    return null;
  }
}

function formatSyncDate(value) {
  if (!value) return "Jamais";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
}

const TODAY_GROUP_CONFIG = [
  { key: "expected", label: "RDV attendus" },
  { key: "receivedUnplanned", label: "Véhicules reçus non planifiés" },
  { key: "toStart", label: "Travaux à démarrer" },
  { key: "inProgress", label: "Travaux en cours" },
  { key: "late", label: "Travaux en retard" },
  { key: "quality", label: "Contrôle qualité à faire" },
  { key: "deliveries", label: "Livraisons prévues" },
  { key: "blocked", label: "Dossiers bloqués" },
];

function renderTodayWorkshop(now = new Date()) {
  const board = $("#today-workshop-board");
  if (!board) return;
  const groups = buildTodayWorkshopGroups(now);
  const total = new Set(Object.values(groups).flat().map((entry) => entry.item.id)).size;
  const pill = $("#today-count-pill");
  if (pill) pill.textContent = `${total} dossier${total > 1 ? "s" : ""}`;
  board.innerHTML = TODAY_GROUP_CONFIG.map((group) => renderTodayGroup(group, groups[group.key] || [])).join("");
  $$("[data-today-case]", board).forEach((button) => {
    button.addEventListener("click", () => {
      activeCaseId = button.dataset.todayCase;
      activeCaseDetailTab = getCaseNextActionTab(button.dataset.todayAction);
      setActiveTab("dossiers");
      renderCases();
      renderCaseDetail();
    });
  });
}

function getTechnicianDashboardResources() {
  return state.resources
    .filter((resource) => typeof isTechnicianResource === "function" ? isTechnicianResource(resource) : resource.active !== false)
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "fr", { sensitivity: "base" }));
}

function renderTechnicianDashboard() {
  const view = $("#view-technician");
  if (!view) return;
  const select = $("#technician-select", view);
  const dateInput = $("#technician-date", view);
  const list = $("#technician-task-list", view);
  const manager = $("#technician-manager-board", view);
  if (!select || !dateInput || !list || !manager) return;

  const currentUser = typeof getCurrentUser === "function" ? getCurrentUser() : null;
  const allTechnicians = getTechnicianDashboardResources();
  const technicians = currentUser?.role === "technicien"
    ? allTechnicians.filter((resource) => resource.id === currentUser.resourceId)
    : allTechnicians;
  if (!state.ui.technicianDate) state.ui.technicianDate = todayKey(new Date());
  if (!state.ui.technicianId || !technicians.some((resource) => resource.id === state.ui.technicianId)) {
    state.ui.technicianId = currentUser?.role === "technicien" ? (currentUser.resourceId || "") : (technicians[0]?.id || "");
  }

  select.innerHTML = technicians.length
    ? technicians.map((resource) => `<option value="${escapeAttr(resource.id)}">${escapeHtml(resource.name)} · ${escapeHtml(ROLE_LABELS[resource.role] || resource.role)}</option>`).join("")
    : `<option value="">${currentUser?.role === "technicien" ? "Aucune ressource liée" : "Aucun technicien actif"}</option>`;
  select.value = state.ui.technicianId || "";
  dateInput.value = state.ui.technicianDate || todayKey(new Date());

  const selectedTechnicianId = currentUser?.role === "technicien" ? (currentUser.resourceId || "__no_resource__") : select.value;
  const rows = typeof getTechnicianTaskRows === "function" && selectedTechnicianId !== "__no_resource__"
    ? getTechnicianTaskRows(selectedTechnicianId, dateInput.value)
    : [];
  list.innerHTML = rows.length
    ? rows.map(renderTechnicianTaskCard).join("")
    : `<div class="empty-state compact-empty"><strong>Aucune tâche pour ce technicien.</strong><span>${currentUser?.role === "technicien" && !currentUser.resourceId ? "Aucune ressource technicien n'est liée à votre utilisateur." : "Les tâches apparaissent ici dès qu'elles sont planifiées et affectées."}</span></div>`;

  manager.innerHTML = currentUser?.role === "technicien" ? "" : renderWorkshopChiefSummary(dateInput.value);

  if (select.dataset.bound !== "true") {
    select.dataset.bound = "true";
    select.addEventListener("change", () => {
      state.ui.technicianId = select.value;
      saveState();
      renderTechnicianDashboard();
    });
  }
  if (dateInput.dataset.bound !== "true") {
    dateInput.dataset.bound = "true";
    dateInput.addEventListener("change", () => {
      state.ui.technicianDate = dateInput.value || todayKey(new Date());
      saveState();
      renderTechnicianDashboard();
    });
  }
  const todayButton = $("#technician-today", view);
  if (todayButton && todayButton.dataset.bound !== "true") {
    todayButton.dataset.bound = "true";
    todayButton.addEventListener("click", () => {
      state.ui.technicianDate = todayKey(new Date());
      saveState();
      renderTechnicianDashboard();
    });
  }
  const printButton = $("#technician-print-day", view);
  if (printButton && printButton.dataset.bound !== "true") {
    printButton.dataset.bound = "true";
    printButton.addEventListener("click", () => printDailyPlanning(state.ui.technicianDate || todayKey(new Date())));
  }

  $$("[data-tech-action]", view).forEach((button) => {
    button.addEventListener("click", () => handleTechnicianTaskAction(button.dataset.techAction, button.dataset.bookingId, button.dataset.technicianId || select.value));
  });
  $$("[data-tech-open-case]", view).forEach((button) => {
    button.addEventListener("click", () => {
      activeCaseId = button.dataset.techOpenCase;
      activeCaseDetailTab = "atelier";
      setActiveTab("dossiers");
      renderCases();
      renderCaseDetail();
    });
  });
}

function renderTechnicianTaskCard(row) {
  const item = row.item;
  const booking = row.booking;
  const start = new Date(booking.start);
  const end = new Date(booking.end);
  const techName = row.technician?.name || "Technicien";
  const resources = (booking.resourceIds || [])
    .map((id) => getResource(id))
    .filter(Boolean)
    .map((resource) => resource.name)
    .join(", ");
  const orderRef = getPrintOrderReference(item);
  const note = row.latestNote ? `<p class="technician-note">Note : ${escapeHtml(row.latestNote)}</p>` : "";
  return `
    <article class="technician-task-card task-status-${escapeAttr(row.status)} ${row.late ? "is-late" : ""}">
      <div class="technician-task-main">
        <button type="button" class="technician-task-title" data-tech-open-case="${escapeAttr(item.id)}">
          <strong>${escapeHtml(item.vehicle || "Véhicule non renseigné")}</strong>
          <span>${escapeHtml(item.plate || item.vin || "Sans immatriculation")} · ${escapeHtml(item.clientName || "Client")}</span>
        </button>
        <div class="technician-task-tags">
          <span class="tag">${escapeHtml(row.statusLabel)}</span>
          ${row.late ? '<span class="tag danger">Retard</span>' : ''}
          ${booking.remainingFromPaused ? '<span class="tag warn">Reliquat</span>' : ''}
          ${booking.blockReason ? `<span class="tag danger">${escapeHtml(booking.blockReason)}</span>` : ''}
        </div>
      </div>
      <dl class="technician-task-meta">
        <div><dt>Dossier</dt><dd>${escapeHtml(orderRef)}</dd></div>
        <div><dt>Étape</dt><dd>${escapeHtml(getDurationLabel(booking.key) || booking.title || "-")}</dd></div>
        <div><dt>Prévu</dt><dd>${formatTime(start)} → ${formatTime(end)}</dd></div>
        <div><dt>Durée</dt><dd>${formatLocalizedDecimal(row.plannedMinutes / 60)} h</dd></div>
        <div><dt>Technicien</dt><dd>${escapeHtml(techName)}</dd></div>
        <div><dt>Ressources</dt><dd>${escapeHtml(resources || "-")}</dd></div>
      </dl>
      ${booking.pauseReason ? `<p class="technician-note">Pause : ${escapeHtml(booking.pauseReason)}</p>` : ""}
      ${booking.blockDetails ? `<p class="technician-note danger-text">Blocage : ${escapeHtml(booking.blockDetails)}</p>` : ""}
      ${note}
      <div class="technician-task-actions">
        ${renderTechnicianTaskActions(row)}
      </div>
    </article>
  `;
}

function renderTechnicianTaskActions(row) {
  const base = `data-booking-id="${escapeAttr(row.booking.id)}" data-technician-id="${escapeAttr(row.technicianId || "")}"`;
  const print = renderPermissionAwareButton("print.task", "Imprimer fiche", "print", base, "ghost-button tiny-button", row.booking);
  if (row.status === "done") return print;
  if (row.status === "blocked") {
    return `
      ${renderPermissionAwareButton("task.resume", "Reprendre", "resume", base, "primary-button tiny-button", row.booking)}
      ${renderPermissionAwareButton("task.start", "Ajouter note", "note", base, "ghost-button tiny-button", row.booking)}
      <button class="ghost-button tiny-button" type="button" data-tech-action="print-block" ${base}>Fiche blocage</button>
      ${print}
    `;
  }
  if (row.status === "in_progress") {
    return `
      ${renderPermissionAwareButton("task.pause", "Pause", "pause", base, "ghost-button tiny-button", row.booking)}
      ${renderPermissionAwareButton("task.complete", "Terminer", "complete", base, "primary-button tiny-button", row.booking)}
      ${renderPermissionAwareButton("task.block", "Signaler blocage", "block", base, "ghost-button tiny-button", row.booking)}
      ${renderPermissionAwareButton("task.start", "Ajouter note", "note", base, "ghost-button tiny-button", row.booking)}
      ${renderPermissionAwareButton("task.start", "Ajouter photo", "photo", base, "ghost-button tiny-button", row.booking)}
      ${print}
    `;
  }
  if (row.status === "paused") {
    return `
      ${renderPermissionAwareButton("task.resume", "Reprendre", "resume", base, "primary-button tiny-button", row.booking)}
      ${renderPermissionAwareButton("task.block", "Signaler blocage", "block", base, "ghost-button tiny-button", row.booking)}
      <button class="ghost-button tiny-button" type="button" data-tech-action="print-block" ${base}>Fiche pause</button>
      ${print}
    `;
  }
  return `
    ${renderPermissionAwareButton("task.start", "Démarrer", "start", base, "primary-button tiny-button", row.booking)}
    ${renderPermissionAwareButton("task.block", "Signaler blocage", "block", base, "ghost-button tiny-button", row.booking)}
    ${renderPermissionAwareButton("task.start", "Ajouter note", "note", base, "ghost-button tiny-button", row.booking)}
    ${print}
  `;
}

function renderPermissionAwareButton(permission, label, action, dataset, className, booking) {
  const allowed = canRenderAction(permission, { booking });
  const title = allowed ? "" : getPermissionDeniedMessage(permission, { booking });
  return `<button class="${className}" type="button" data-tech-action="${escapeAttr(action)}" ${dataset} ${allowed ? "" : `disabled title="${escapeAttr(title)}" aria-label="${escapeAttr(`${label} indisponible : ${title}`)}"`}>${escapeHtml(label)}</button>`;
}

function renderWorkshopChiefSummary(dateKey) {
  const rows = typeof getTechnicianTaskRows === "function" ? getTechnicianTaskRows("", dateKey) : [];
  const byStatus = (status) => rows.filter((row) => row.status === status);
  const activeTechnicianIds = new Set(rows.filter((row) => row.status === "in_progress").map((row) => row.technicianId).filter(Boolean));
  const idleTechnicians = getTechnicianDashboardResources().filter((resource) => !activeTechnicianIds.has(resource.id));
  const unassigned = state.bookings.filter((booking) => (
    booking.type !== "leave"
    && booking.temporary !== true
    && !getBookingHumanResourceIds(booking).length
  ));
  const cards = [
    ["Tâches en cours", byStatus("in_progress")],
    ["Tâches en pause", byStatus("paused")],
    ["Tâches bloquées", byStatus("blocked")],
    ["Terminées aujourd'hui", byStatus("done")],
    ["Tâches en retard", rows.filter((row) => row.late)],
  ];
  return `
    <div class="chief-summary-grid">
      ${cards.map(([label, items]) => `
        <article class="chief-summary-card">
          <strong>${items.length}</strong>
          <span>${escapeHtml(label)}</span>
          <small>${items.slice(0, 3).map((row) => escapeHtml(`${row.item.clientName || "-"} · ${row.booking.title || getDurationLabel(row.booking.key) || "Tâche"}`)).join("<br>") || "Aucun"}</small>
        </article>
      `).join("")}
      <article class="chief-summary-card">
        <strong>${idleTechnicians.length}</strong>
        <span>Techniciens sans tâche active</span>
        <small>${idleTechnicians.slice(0, 5).map((resource) => escapeHtml(resource.name)).join("<br>") || "Aucun"}</small>
      </article>
      <article class="chief-summary-card">
        <strong>${unassigned.length}</strong>
        <span>Tâches sans technicien</span>
        <small>${unassigned.slice(0, 5).map((booking) => escapeHtml(booking.title || getDurationLabel(booking.key) || "Tâche")).join("<br>") || "Aucune"}</small>
      </article>
    </div>
  `;
}

async function handleTechnicianTaskAction(action, bookingId, technicianId) {
  const booking = state.bookings.find((candidate) => candidate.id === bookingId);
  const item = state.cases.find((caseItem) => caseItem.id === booking?.caseId);
  if (!item || !booking) {
    notifyUser("Tâche introuvable.", "error");
    return;
  }
  let result = null;
  if (action === "start") {
    result = startTechnicianTask(item, bookingId, technicianId);
  } else if (action === "pause") {
    const reason = window.prompt(`Motif de pause obligatoire :\n${TECHNICIAN_PAUSE_REASONS.join(" / ")}`, booking.pauseReason || "attente pièces");
    if (reason === null) return;
    result = pauseTechnicianTask(item, bookingId, technicianId, reason);
  } else if (action === "resume") {
    result = resumeTechnicianTask(item, bookingId, technicianId, { allowConcurrent: false });
  } else if (action === "block") {
    const reason = window.prompt("Motif de blocage : attente pièces, attente accord, attente chef atelier, panne outil / ressource, autre", booking.blockReason || "attente pièces");
    if (reason === null) return;
    const details = window.prompt("Commentaire blocage (optionnel)", booking.blockDetails || "");
    if (details === null) return;
    result = blockTechnicianTask(item, bookingId, technicianId, reason, details);
  } else if (action === "note") {
    const note = window.prompt("Note technicien à ajouter à cette tâche :");
    if (note === null) return;
    result = addTechnicianTaskNote(item, bookingId, technicianId, note);
  } else if (action === "photo") {
    await addTechnicianTaskPhotoFromInput(item, bookingId, technicianId);
    return;
  } else if (action === "complete") {
    const confirmed = await showConfirmModal("Terminer cette tâche maintenant ? Le temps restant sera libéré dans le planning si la tâche finit en avance.");
    if (!confirmed) return;
    const note = window.prompt("Note de fin de tâche (optionnel)", "");
    if (note === null) return;
    result = completeTechnicianTask(item, bookingId, technicianId, { note, skipPhotoCheck: false });
    if (!result.ok && /photo/i.test(result.message || "")) {
      notifyUser(result.message, "error");
      return;
    }
  } else if (action === "print") {
    printTechnicianTaskSheet(item, bookingId, technicianId);
    return;
  } else if (action === "print-block") {
    printPauseBlockSheet(item, bookingId, technicianId);
    return;
  }
  if (!result?.ok) {
    notifyUser(result?.message || "Action impossible.", "error");
    return;
  }
  saveState({ flushCloud: true, cloudReason: `technician-${action}` });
  notifyUser(result.message || "Action enregistrée.", "success");
  render();
}

async function addTechnicianTaskPhotoFromInput(item, bookingId, technicianId) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ALLOWED_PHOTO_TYPES.join(",");
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const prepared = await preparePhotoForStorage(file);
      const photo = {
        id: uid("photo"),
        name: prepared.name,
        type: prepared.blob.type || file.type || "image/jpeg",
        size: prepared.blob.size,
        category: "during",
        createdAt: new Date().toISOString(),
      };
      await savePhotoRecord(item.id, photo, prepared.blob);
      item.photos.push(photo);
      const result = attachTechnicianTaskPhoto(item, bookingId, technicianId, photo.id);
      saveState({ flushCloud: true, cloudReason: "technician-photo" });
      notifyUser(result.message || "Photo ajoutée à la tâche.", "success");
      render();
    } catch (error) {
      notifyUser(error.message || "Photo impossible à ajouter.", "error");
    }
  }, { once: true });
  input.click();
}

function buildTodayWorkshopGroups(now = new Date()) {
  const groups = Object.fromEntries(TODAY_GROUP_CONFIG.map((group) => [group.key, []]));
  state.cases
    .filter((item) => !item.flags?.delivered)
    .forEach((item) => {
      const action = getCaseNextAction(item);
      const entries = getTodayCaseEntries(item, action, now);
      entries.forEach((entry) => groups[entry.group].push({ item, action, risk: entry.risk, timeLabel: entry.timeLabel }));
    });
  Object.values(groups).forEach((items) => {
    items.sort((a, b) => sortTodayEntries(a, b));
  });
  return groups;
}

function getTodayCaseEntries(item, action, now = new Date()) {
  const entries = [];
  const start = item.appointment?.start ? new Date(item.appointment.start) : null;
  const delivery = item.appointment?.delivery ? new Date(item.appointment.delivery) : null;
  const bookings = getCaseBookings(item);
  const hasBookings = bookings.length > 0;
  const workingNow = item.flags.workStarted && !item.flags.workCompleted;
  if (isCaseBlocked(item)) entries.push({ group: "blocked", risk: "blocked", timeLabel: getCaseBlockerLabel(item) || "Blocage" });
  if (start && isSameBusinessDay(start, now) && !item.flags.received && item.appointmentStatus !== "no_show") {
    entries.push({ group: "expected", risk: start <= now ? "urgent" : "normal", timeLabel: formatTime(start) });
  }
  if (item.flags.received && !hasBookings && !item.flags.workCompleted) {
    entries.push({ group: "receivedUnplanned", risk: "attention", timeLabel: "À planifier" });
  }
  if (item.flags.received && hasBookings && !item.flags.workStarted) {
    entries.push({ group: "toStart", risk: "normal", timeLabel: getNextBookingTimeLabel(bookings, now) });
  }
  if (workingNow) {
    entries.push({ group: "inProgress", risk: "normal", timeLabel: "En cours" });
  }
  if (isCaseLate(item, now)) {
    entries.push({ group: "late", risk: "urgent", timeLabel: "Retard" });
  }
  if (item.flags.workCompleted && !item.flags.qualityApproved) {
    entries.push({ group: "quality", risk: "attention", timeLabel: "À contrôler" });
  }
  if (delivery && isSameBusinessDay(delivery, now) && item.flags.qualityApproved && !item.flags.delivered) {
    entries.push({ group: "deliveries", risk: delivery <= now ? "urgent" : "normal", timeLabel: formatTime(delivery) });
  }
  if (!entries.length && action.priority !== "normal") {
    entries.push({ group: action.code === "resolve_blocker" ? "blocked" : "late", risk: action.priority, timeLabel: action.label });
  }
  return dedupeTodayEntries(entries);
}

function dedupeTodayEntries(entries) {
  const seen = new Set();
  return entries.filter((entry) => {
    if (seen.has(entry.group)) return false;
    seen.add(entry.group);
    return true;
  });
}

function sortTodayEntries(a, b) {
  const priority = { blocked: 0, urgent: 1, attention: 2, normal: 3 };
  return (priority[a.risk] ?? 4) - (priority[b.risk] ?? 4)
    || String(a.item.clientName || "").localeCompare(String(b.item.clientName || ""), "fr", { sensitivity: "base" });
}

function renderTodayGroup(group, entries) {
  return `
    <section class="today-group">
      <div class="today-group-head">
        <h2>${escapeHtml(group.label)}</h2>
        <span>${entries.length}</span>
      </div>
      <div class="today-cards">
        ${entries.length ? entries.map((entry) => renderTodayCard(entry)).join("") : `<div class="empty-inline">Aucun dossier.</div>`}
      </div>
    </section>
  `;
}

function renderTodayCard({ item, action, risk, timeLabel }) {
  const status = statusLabels[getCaseStatus(item)] || "Statut";
  const identity = item.plate || item.vin || "Sans immatriculation";
  return `
    <button class="today-card risk-${escapeAttr(risk)}" type="button" data-today-case="${escapeAttr(item.id)}" data-today-action="${escapeAttr(action.code)}">
      <span class="today-card-top"><strong>${escapeHtml(item.clientName || "Client")}</strong><b>${escapeHtml(timeLabel || "")}</b></span>
      <span>${escapeHtml(shortVehicleModel(item.vehicle || "Véhicule"))} · ${escapeHtml(identity)}</span>
      <span class="today-card-meta">
        <i>${escapeHtml(getCaseTypeSummary(item))}</i>
        <i>${escapeHtml(status)}</i>
      </span>
      <span class="today-next-action">Prochaine action : ${escapeHtml(action.label)}</span>
      <span class="risk-pill">${escapeHtml(getRiskLabel(risk))}</span>
    </button>
  `;
}

function getRiskLabel(risk) {
  return { normal: "Normal", attention: "Attention", urgent: "Urgent", blocked: "Bloqué" }[risk] || "Normal";
}

function isSameBusinessDay(value, now = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  return !Number.isNaN(date.getTime()) && todayKey(date) === todayKey(now);
}

function isCaseLate(item, now = new Date()) {
  if (isCaseBlocked(item)) return false;
  const delivery = item.appointment?.delivery ? new Date(item.appointment.delivery) : null;
  if (delivery && !Number.isNaN(delivery.getTime()) && delivery < now && !item.flags.delivered) return true;
  return getCaseBookings(item).some((booking) => {
    if (["completed"].includes(getBookingOperationalStatus(booking))) return false;
    const end = booking.end ? new Date(booking.end) : null;
    return end && !Number.isNaN(end.getTime()) && end < now && !item.flags.workCompleted;
  });
}

function getNextBookingTimeLabel(bookings, now = new Date()) {
  const upcoming = bookings
    .map((booking) => new Date(booking.start))
    .filter((date) => !Number.isNaN(date.getTime()) && date >= startOfDay(now))
    .sort((a, b) => a - b)[0];
  return upcoming ? formatDateTime(upcoming) : "À démarrer";
}

function renderCases() {
  const list = $("#case-list");
  const search = $("#case-search").value.trim().toLowerCase();
  const statusFilter = state.ui?.caseStatusFilter || "all";
  const typeFilter = state.ui?.caseTypeFilter || "all";
  const cases = state.cases
    .filter((item) => {
      const typeSummary = getCaseTypeSummary(item);
      const haystack = `${item.clientName} ${item.ownerName} ${item.driverName} ${item.driverPhone} ${item.vehicle} ${item.plate} ${item.phone} ${item.vin} ${item.color} ${item.orNavNumber} ${typeSummary}`.toLowerCase();
      const matchesText = haystack.includes(search);
      const matchesStatus = statusFilter === "all" || getCaseStatus(item) === statusFilter;
      const matchesType = caseMatchesTypeFilter(item, typeFilter);
      return matchesText && matchesStatus && matchesType;
    })
    .sort(compareCasesForList);
  const suffix = state.cases.length > 1 ? "s" : "";
  $("#case-count").textContent = cases.length === state.cases.length
    ? `${state.cases.length} dossier${suffix}`
    : `${cases.length}/${state.cases.length} dossier${suffix}`;
  list.innerHTML = cases.length
    ? cases
        .map((item) => {
          const active = item.id === activeCaseId ? " active" : "";
          const status = getCaseStatus(item);
          const nextAction = getCaseNextAction(item);
          return `
            <button class="case-card${active}${isCaseBlocked(item) ? " blocked-case" : ""}" type="button" data-case="${item.id}">
              <strong>${escapeHtml(item.clientName)}</strong>
              <span>${escapeHtml(item.vehicle || "Véhicule non renseigné")} · ${escapeHtml(item.plate || item.vin || "Sans immatriculation")}</span>
              <span class="case-meta">
                <span class="tag">${statusLabels[status]}</span>
                <span class="tag next-action-tag priority-${escapeAttr(nextAction.priority)}">${escapeHtml(nextAction.label)}</span>
                <span class="tag soft">${escapeHtml(getClaimTypeLabel(getCasePrimaryType(item)))}</span>
                ${item.appointment ? `<span>${formatDateTime(item.appointment.start)}</span>` : "<span>RDV non planifié</span>"}
              </span>
            </button>
          `;
        })
        .join("")
    : `<div class="empty-inline">Aucun dossier trouvé.</div>`;
}

function compareCasesForList(a, b) {
  const sort = state.ui?.caseSort || "recent";
  if (sort === "oldest") return new Date(a.createdAt) - new Date(b.createdAt);
  if (sort === "client") return String(a.clientName || "").localeCompare(String(b.clientName || ""), "fr", { sensitivity: "base" });
  if (sort === "appointment") {
    const aTime = a.appointment?.start ? new Date(a.appointment.start).getTime() : Number.MAX_SAFE_INTEGER;
    const bTime = b.appointment?.start ? new Date(b.appointment.start).getTime() : Number.MAX_SAFE_INTEGER;
    return aTime - bTime || new Date(b.createdAt) - new Date(a.createdAt);
  }
  return new Date(b.createdAt) - new Date(a.createdAt);
}


function renderPilotageAlerts() {
  const target = $("#pilotage-alerts");
  if (!target) return;
  const alerts = buildPilotageAlerts();
  target.innerHTML = alerts.length
    ? alerts.map((alert) => `
        <button class="pilotage-alert ${alert.level}" type="button" data-alert-case="${alert.caseId}">
          <strong>${escapeHtml(alert.title)}</strong>
          <span>${escapeHtml(alert.details)}</span>
        </button>
      `).join("")
    : `<div class="empty-inline">Aucune alerte opérationnelle.</div>`;
  $$('[data-alert-case]', target).forEach((button) => {
    button.addEventListener('click', () => {
      activeCaseId = button.dataset.alertCase;
      activeTab = 'dossiers';
      setActiveTab('dossiers');
      renderCaseDetail();
    });
  });
}

function buildPilotageAlerts(now = new Date()) {
  return state.cases
    .filter((item) => !item.flags.delivered)
    .flatMap((item) => caseOperationalAlerts(item, now))
    .sort((a, b) => a.priority - b.priority || new Date(a.when || 0) - new Date(b.when || 0))
    .slice(0, 8);
}

function caseOperationalAlerts(item, now = new Date()) {
  const alerts = [];
  const label = `${item.clientName || 'Client'} · ${item.plate || item.vin || item.vehicle || 'véhicule'}`;
  if (isCaseBlocked(item)) {
    alerts.push({
      caseId: item.id,
      level: 'danger',
      priority: 0,
      title: 'Dossier bloqué',
      details: `${label} · ${getCaseBlockerLabel(item) || 'blocage à résoudre'}`,
      when: item.updatedAt || item.createdAt,
    });
  }
  if (item.appointment?.start && !item.flags.received) {
    const start = new Date(item.appointment.start);
    const ageMinutes = diffMinutes(start, now);
    if (ageMinutes > RECEPTION_GRACE_HOURS * 60) {
      alerts.push({
        caseId: item.id,
        level: 'danger',
        priority: 1,
        title: 'Réception en retard',
        details: `${label} · RDV prévu ${formatDateTime(start)}`,
        when: item.appointment.start,
      });
    }
  }
  if (item.appointment?.delivery && !item.flags.delivered) {
    const delivery = new Date(item.appointment.delivery);
    const minutesToDelivery = diffMinutes(now, delivery);
    if (minutesToDelivery <= DELIVERY_ALERT_HOURS * 60 && !item.flags.qualityApproved) {
      alerts.push({
        caseId: item.id,
        level: minutesToDelivery < 0 ? 'danger' : 'warn',
        priority: minutesToDelivery < 0 ? 2 : 3,
        title: minutesToDelivery < 0 ? 'Livraison dépassée' : 'Livraison proche',
        details: `${label} · livraison estimée ${formatDateTime(delivery)}`,
        when: item.appointment.delivery,
      });
    }
  }
  if (item.flags.received && !item.flags.workStarted && !state.bookings.some((booking) => booking.caseId === item.id)) {
    alerts.push({
      caseId: item.id,
      level: 'warn',
      priority: 4,
      title: 'Véhicule reçu sans planning',
      details: label,
      when: item.createdAt,
    });
  }
  if (item.flags.workCompleted && !item.flags.qualityApproved && isQualityChecklistComplete(item)) {
    alerts.push({
      caseId: item.id,
      level: 'info',
      priority: 5,
      title: 'Contrôle qualité prêt',
      details: label,
      when: item.createdAt,
    });
  }
  return alerts;
}



function renderClaims(root, item) {
  const target = $(`[data-field='claims']`, root);
  if (!target) return;
  item.claims = normalizeRepairClaims(item.claims, item);
  const planningTotal = ESTIMATE_ALLOWED_KEYS.reduce((sum, key) => sum + Number(item.durations?.[key] || 0), 0);
  const includedClaims = item.claims.filter((claim) => claim.includeInPlanning !== false).length;
  const missingLaborCount = item.claims.filter((claim) => claim.includeInPlanning !== false && !claimHasLaborEstimate(claim)).length;
  target.innerHTML = `
    <div class="claim-summary-card ${missingLaborCount ? 'needs-attention' : ''}">
      <strong>Planning global véhicule</strong>
      <span>${formatLocalizedDecimal(planningTotal)} h planifiées sur ${includedClaims} intervention(s) incluse(s).</span>
      ${missingLaborCount ? `<span class="tag warn">${missingLaborCount} ordre${missingLaborCount > 1 ? 's' : ''} sans main-d’œuvre</span>` : `<span class="tag ok">Main-d’œuvre renseignée</span>`}
    </div>
    ${item.claims.length ? item.claims.map((claim, index) => renderClaimCard(claim, index)).join("") : `<div class="empty-inline"><strong>Aucune intervention créée.</strong><br>Créez un ordre de travail SAV, puis importez un devis ou saisissez sa main-d’œuvre.</div>`}
  `;

  $$('[data-claim-import]', target).forEach((input) => {
    input.addEventListener('change', (event) => handleClaimEstimateImportFile(event, item, input.dataset.claimImport, root));
  });
  $$('[data-claim-field]', target).forEach((input) => {
    input.addEventListener('change', () => {
      const claim = item.claims.find((candidate) => candidate.id === input.dataset.claimId);
      if (!claim) return;
      const field = input.dataset.claimField;
      const previousValue = claim[field];
      const nextValue = field === 'includeInPlanning' || field === 'expertApproved' || field === 'clientApproved'
        ? input.checked
        : input.value;
      const issues = validateClaimFieldChange(item, claim, field, nextValue);
      if (issues.length) {
        notifyUser(issues.join("\n"), "error");
        input.type === 'checkbox' ? input.checked = Boolean(previousValue) : input.value = previousValue || '';
        return;
      }

      claim[field] = nextValue;
      if (field === 'expertApproved' && !nextValue) claim.clientApproved = false;
      synchronizeClaimStatus(claim, field);
      claim.updatedAt = new Date().toISOString();

      const changesPlanningInput = shouldClearPlanningAfterClaimFieldChange(field, nextValue);
      if (field === 'includeInPlanning') recomputeCaseDurationsFromClaims(item);
      if (changesPlanningInput) clearPlanningIfNeeded(item, 'Planning annulé après modification des ordres de réparation ou accords. Recalculez un RDV.');

      refreshCaseApprovalFlagsFromClaims(item);
      addHistory(item, 'claim.updated', 'Ordre de réparation modifié', getClaimLabel(claim));
      saveState();
      renderCaseDetail();
    });
  });
  $$('[data-claim-delete]', target).forEach((button) => {
    button.addEventListener('click', () => deleteClaim(item, button.dataset.claimDelete));
  });
  $$('[data-claim-labor-form]', target).forEach((form) => {
    form.addEventListener('submit', (event) => handleClaimLaborSubmit(event, item));
  });
  $$('[data-remove-claim-labor-line]', target).forEach((button) => {
    button.addEventListener('click', () => removeClaimLaborLine(item, button.dataset.claimId, button.dataset.removeClaimLaborLine));
  });
}


function shouldClearPlanningAfterClaimFieldChange(field, nextValue) {
  return ['includeInPlanning', 'status'].includes(field)
    || ((field === 'expertApproved' || field === 'clientApproved') && !nextValue);
}


function validateClaimFieldChange(item, claim, field, nextValue) {
  const issues = [];
  const clientOnly = isClientOnlyRepairClaim(claim);
  if (field === 'expertApproved' && nextValue && !clientOnly) {
    if (!hasBeforeRepairPhoto(item)) issues.push('Ajouter au moins une photo Avant réparation avant de valider l’accord expert de l’ordre assurance.');
    if (!claimHasLaborEstimate(claim)) issues.push('Importer ou saisir de la main-d’œuvre avant de valider l’accord expert de l’ordre assurance.');
  }
  if (field === 'clientApproved' && nextValue) {
    if (!clientOnly && !claim.expertApproved) issues.push('Valider l’accord expert de l’ordre assurance avant l’accord client.');
    if (!clientOnly && claim.type !== 'client' && !String(item.insurance || '').trim()) issues.push('Renseigner la compagnie d’assurance avant l’accord client.');
    if (!claimHasLaborEstimate(claim)) issues.push('Importer ou saisir la main-d’œuvre de l’ordre avant l’accord client/interne.');
  }
  if (field === 'status' && ['approved', 'planned', 'done'].includes(nextValue)) {
    if (!clientOnly && !claim.expertApproved) issues.push('Le statut Accepté/Planifié/Terminé exige l’accord expert pour les ordres assurance.');
    if (!claim.clientApproved) issues.push('Le statut Accepté/Planifié/Terminé exige une validation client/interne.');
    if (!claimHasLaborEstimate(claim)) issues.push('Le statut Accepté/Planifié/Terminé exige de la main-d’œuvre.');
  }
  return issues;
}

function synchronizeClaimStatus(claim, changedField = '') {
  if (claim.status === 'refused') return;
  if (isClientOnlyRepairClaim(claim)) {
    claim.expertApproved = true;
    claim.status = claim.clientApproved ? 'approved' : 'client_pending';
    return;
  }
  if (claim.clientApproved && claim.expertApproved) {
    if (claim.status === 'draft' || claim.status === 'expert_pending' || claim.status === 'client_pending') claim.status = 'approved';
    return;
  }
  if (claim.expertApproved && !claim.clientApproved) {
    claim.status = 'client_pending';
    return;
  }
  if (!claim.expertApproved && (claim.status === 'approved' || claim.status === 'planned' || claim.status === 'done' || changedField === 'expertApproved')) {
    claim.status = 'expert_pending';
  }
}

function clearPlanningIfNeeded(item, reason) {
  const hasPlanning = Boolean(item?.appointment) || state.bookings.some((booking) => booking.caseId === item?.id);
  if (!hasPlanning) return;
  clearCasePlanning(item, reason);
  notifyUser('Le planning a été annulé car une donnée utilisée pour le calcul a changé.', 'info');
}

function getWorkflowClaims(item) {
  const claims = normalizeRepairClaims(item?.claims || [], item || {});
  const included = claims.filter((claim) => claim.includeInPlanning !== false && claim.status !== 'refused');
  return included.length ? included : claims.filter((claim) => claim.status !== 'refused');
}

function hasBeforeRepairPhoto(item) {
  return (item?.photos || []).some((photo) => normalizePhotoCategory(photo.category) === 'before');
}

function hasAfterRepairPhoto(item) {
  return (item?.photos || []).some((photo) => normalizePhotoCategory(photo.category) === 'after');
}

function claimHasLaborEstimate(claim) {
  const lines = typeof getClaimPlanningLaborLines === "function" ? getClaimPlanningLaborLines(claim) : (claim?.estimate?.lines || []);
  return lines.some((line) => Number(line.laborHours || 0) > 0);
}

function refreshCaseApprovalFlagsFromClaims(item) {
  const claims = getWorkflowClaims(item).filter((claim) => claim.includeInPlanning !== false || claimHasLaborEstimate(claim));
  if (!claims.length) {
    item.flags.expertApproved = false;
    item.flags.clientApproved = false;
    return;
  }
  item.flags.expertApproved = claims.every((claim) => isClientOnlyRepairClaim(claim) || Boolean(claim.expertApproved));
  item.flags.clientApproved = claims.every((claim) => Boolean(claim.clientApproved));
}

function renderClaimCard(claim, index) {
  if (typeof cleanClaimEstimateForPlanning === 'function') cleanClaimEstimateForPlanning(claim);
  const estimateLines = claim.estimate?.lines || [];
  const originalLines = claim.estimate?.originalLines || [];
  const partsLines = claim.estimate?.parts || [];
  const totalSourceLines = originalLines.length ? originalLines : estimateLines;
  const total = totalSourceLines.reduce((sum, line) => sum + Number(line.laborHours || 0), 0);
  const laborDetailsOpen = totalSourceLines.length === 0 || total <= 0 || totalSourceLines.some((line) => line.manual);
  const defaultPhase = getDefaultClaimLaborPhase(claim.type);
  const clientApprovalLabel = isClientOnlyRepairClaim(claim) ? "Validation client/interne" : "Accord client";
  const lineRows = totalSourceLines.length ? totalSourceLines.map((line) => `
    <li>
      <strong>${escapeHtml(line.operation || line.rawText || 'Ligne main-d’œuvre')}</strong>
      <span>${formatLocalizedDecimal(line.laborHours || 0)} h</span>
      ${line.id ? `<button class="icon-button claim-line-action" type="button" title="Supprimer cette ligne MO" aria-label="Supprimer cette ligne MO" data-claim-id="${escapeAttr(claim.id)}" data-remove-claim-labor-line="${escapeAttr(line.id)}">×</button>` : ''}
    </li>
  `).join('') : `<li class="muted">Aucune main-d’œuvre saisie ou importée pour cet ordre.</li>`;
  const partRows = partsLines.length ? partsLines.slice(0, 20).map((part) => `
    <li><strong>${escapeHtml(part.designation || 'Article devis')}</strong><span>Qté ${formatLocalizedDecimal(part.quantity || 0)}${part.amount ? ` · ${formatLocalizedDecimal(part.amount)}` : ''}</span></li>
  `).join('') : `<li class="muted">Aucune pièce/article importé.</li>`;
  return `
    <article class="claim-card">
      <div class="claim-card-head">
        <div>
          <strong>${escapeHtml(claim.number || `OT-${index + 1}`)} · ${escapeHtml(claim.title || 'Ordre')}</strong>
          <span>${escapeHtml(claim.vehicleArea || 'Zone non précisée')} · ${escapeHtml(getClaimTypeLabel(claim.type))} · ${escapeHtml(CLAIM_STATUS_LABELS[claim.status] || claim.status)}</span>
        </div>
        <label class="file-button compact-file-button">
          <input type="file" data-claim-import="${escapeHtml(claim.id)}" accept=".pdf,.xlsx,.csv,text/csv,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" />
          ${isClientOnlyRepairClaim(claim) ? "Importer devis client" : "Importer devis assurance"}
        </label>
      </div>
      <div class="form-grid compact-claim-grid">
        <label>Libellé<input data-claim-id="${escapeHtml(claim.id)}" data-claim-field="title" value="${escapeHtml(claim.title || '')}" /></label>
        <label>Zone<input data-claim-id="${escapeHtml(claim.id)}" data-claim-field="vehicleArea" value="${escapeHtml(claim.vehicleArea || '')}" /></label>
        <label>N° devis<input data-claim-id="${escapeHtml(claim.id)}" data-claim-field="estimateNumber" value="${escapeHtml(claim.estimateNumber || '')}" /></label>
        <label>N° OR<input data-claim-id="${escapeHtml(claim.id)}" data-claim-field="orNumber" value="${escapeHtml(claim.orNumber || '')}" /></label>
        <label>Statut<select data-claim-id="${escapeHtml(claim.id)}" data-claim-field="status">
          ${Object.entries(CLAIM_STATUS_LABELS).map(([value, label]) => `<option value="${value}" ${claim.status === value ? 'selected' : ''}>${label}</option>`).join('')}
        </select></label>
      </div>
      <div class="approval-row">
        ${isClientOnlyRepairClaim(claim) ? `<span class="tag ok">Expert non requis</span>` : `<label class="check-card"><input type="checkbox" data-claim-id="${escapeHtml(claim.id)}" data-claim-field="expertApproved" ${claim.expertApproved ? 'checked' : ''}/><span>Accord expert</span></label>`}
        <label class="check-card"><input type="checkbox" data-claim-id="${escapeHtml(claim.id)}" data-claim-field="clientApproved" ${claim.clientApproved ? 'checked' : ''}/><span>${clientApprovalLabel}</span></label>
        <label class="check-card"><input type="checkbox" data-claim-id="${escapeHtml(claim.id)}" data-claim-field="includeInPlanning" ${claim.includeInPlanning !== false ? 'checked' : ''}/><span>Inclure planning</span></label>
        <span class="tag ${total > 0 ? 'ok' : 'warn'}">${formatLocalizedDecimal(total)} h MO</span>
        <button class="ghost-button danger-button" type="button" data-claim-delete="${escapeHtml(claim.id)}">Supprimer</button>
      </div>
      <details class="claim-lines manual-labor-entry" data-manual-labor-entry ${laborDetailsOpen ? 'open' : ''}>
        <summary>Ajouter / modifier la main-d'œuvre de l'ordre (${totalSourceLines.length})</summary>
        <ul>${lineRows}</ul>
        ${laborDetailsOpen ? `<p class="muted">Saisissez ici les heures manuelles quand il n’y a pas de devis importé.</p>` : ''}
        <form class="claim-labor-form" data-claim-labor-form data-claim-id="${escapeAttr(claim.id)}">
          <label>Étape
            <select name="phase">
              ${DURATIONS.filter(([key]) => key !== 'quality').map(([key, label]) => `<option value="${key}" ${key === defaultPhase ? 'selected' : ''}>${label}</option>`).join('')}
            </select>
          </label>
          <label class="wide">Opération
            <input name="operation" placeholder="Ex. Diagnostic freinage, vidange, remplacement serrure..." />
          </label>
          <label>Heures
            <input name="laborHours" type="text" inputmode="decimal" placeholder="Ex. 1,5" />
          </label>
          <button type="submit" class="primary-button">Ajouter MO</button>
        </form>
      </details>
      <details class="claim-lines" ${partsLines.length ? '' : ''}>
        <summary>Pièces / articles du devis (${partsLines.length})</summary>
        <ul>${partRows}</ul>
      </details>
    </article>
  `;
}

function getDefaultClaimLaborPhase(type) {
  if (type === "vidange") return "oilService";
  if (type === "mechanical_client" || type === "diagnostic") return "mechanical";
  if (type === "electrical_client") return "electrical";
  return "body";
}

function getManualLaborCodeForPhase(phase) {
  return ["oilService", "mechanical", "electrical"].includes(phase) ? "MO-MEC" : "MO-TOL";
}

function buildManualClaimLaborLine({ phase, operation, laborHours }) {
  const safePhase = DURATIONS.some(([key]) => key === phase) ? phase : "body";
  const parsedHours = parseLocalizedDecimal(laborHours);
  const hours = Math.min(MAX_STEP_DURATION_HOURS, Math.max(0, roundHours(parsedHours)));
  const label = operation || getDurationLabel(safePhase) || "Main-d'œuvre";
  return {
    id: uid("estimate-original-line"),
    code: getManualLaborCodeForPhase(safePhase),
    manual: true,
    operation: label,
    rawText: `${label} ${formatLocalizedDecimal(hours)} h`,
    laborHours: hours,
    selectedPhases: [safePhase],
    allocations: [{ phase: safePhase, operation: label, laborHours: hours }],
  };
}

function refreshClaimEstimateFromManualLines(claim) {
  claim.estimate = normalizeExpertEstimate(claim.estimate);
  if (typeof syncClaimEstimateLinesFromOriginal === "function") {
    syncClaimEstimateLinesFromOriginal(claim);
  } else {
    claim.estimate.lines = (claim.estimate.originalLines || []).flatMap((line) => {
      const allocations = line.allocations?.length ? line.allocations : [{ phase: line.selectedPhases?.[0] || "body", operation: line.operation, laborHours: line.laborHours }];
      return allocations.map((allocation) => normalizeExpertEstimateLine({
        phase: allocation.phase,
        operation: allocation.operation || line.operation,
        laborHours: allocation.laborHours,
      })).filter(Boolean);
    });
  }
}

function handleClaimLaborSubmit(event, item) {
  event.preventDefault();
  const form = event.currentTarget;
  const claim = item.claims.find((candidate) => candidate.id === form.dataset.claimId);
  if (!claim) return;
  const data = new FormData(form);
  const phase = data.get("phase") || getDefaultClaimLaborPhase(claim.type);
  const operation = normalizeTextInputValue(data.get("operation"));
  const laborHours = parseLocalizedDecimal(data.get("laborHours"));
  if (!operation) {
    notifyUser("Renseignez l'opération main-d'œuvre.", "error");
    form.elements.operation?.focus();
    return;
  }
  if (!laborHours || laborHours <= 0) {
    notifyUser("Renseignez une quantité d'heures valide.", "error");
    form.elements.laborHours?.focus();
    return;
  }

  claim.estimate = normalizeExpertEstimate(claim.estimate);
  claim.estimate.originalLines.push(buildManualClaimLaborLine({ phase, operation, laborHours }));
  claim.estimate.confirmed = false;
  claim.estimate.confirmedAt = "";
  claim.updatedAt = new Date().toISOString();
  refreshClaimEstimateFromManualLines(claim);
  recomputeCaseDurationsFromClaims(item);
  clearPlanningIfNeeded(item, "Planning annulé après ajout manuel de main-d'œuvre. Recalculez un RDV.");
  refreshCaseApprovalFlagsFromClaims(item);
  addHistory(item, "claim.labor.added", "Main-d'œuvre ajoutée à l'ordre", `${getClaimLabel(claim)} - ${operation}: ${formatLocalizedDecimal(laborHours)} h`);
  saveState();
  renderCaseDetail();
}

async function removeClaimLaborLine(item, claimId, lineId) {
  const claim = item.claims.find((candidate) => candidate.id === claimId);
  if (!claim?.estimate) return;
  const sourceLine = [...(claim.estimate.originalLines || []), ...(claim.estimate.lines || [])].find((line) => line.id === lineId);
  const confirmed = await showConfirmModal(`Supprimer la ligne main-d'œuvre ${escapeHtml(sourceLine?.operation || "")} ?`);
  if (!confirmed) return;
  claim.estimate.originalLines = (claim.estimate.originalLines || []).filter((line) => line.id !== lineId);
  claim.estimate.lines = (claim.estimate.lines || []).filter((line) => line.id !== lineId);
  claim.estimate.confirmed = false;
  claim.estimate.confirmedAt = "";
  claim.updatedAt = new Date().toISOString();
  if (claim.estimate.originalLines.length) refreshClaimEstimateFromManualLines(claim);
  recomputeCaseDurationsFromClaims(item);
  clearPlanningIfNeeded(item, "Planning annulé après suppression de main-d'œuvre. Recalculez un RDV.");
  refreshCaseApprovalFlagsFromClaims(item);
  addHistory(item, "claim.labor.removed", "Main-d'œuvre supprimée de l'ordre", getClaimLabel(claim));
  saveState();
  renderCaseDetail();
}

function handleClaimSubmit(event, item) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const rawClaims = Array.isArray(item.claims) ? item.claims : [];
  const reusableClaim = rawClaims.find((claim) => isReusableEmptyClaim(claim, item));
  const title = normalizeTextInputValue(data.get('title'));
  if (!title) {
    notifyUser('Renseignez le libellé de l’ordre de réparation.', 'error');
    return;
  }
  const baseIndex = reusableClaim
    ? Math.max(0, rawClaims.indexOf(reusableClaim))
    : normalizeRepairClaims(rawClaims, item).length;
  const payload = {
    id: reusableClaim?.id || uid('claim'),
    number: reusableClaim?.number || `OT-${String(baseIndex + 1).padStart(3, '0')}`,
    title,
    vehicleArea: normalizeTextInputValue(data.get('vehicleArea')),
    type: data.get('type') || 'vidange',
    status: data.get('status') || 'draft',
    estimateNumber: normalizeTextInputValue(data.get('estimateNumber')),
    orNumber: normalizeTextInputValue(data.get('orNumber')),
    expertApproved: isClientOnlyRepairClaim({ type: data.get('type') }) || data.get('expertApproved') === 'on',
    clientApproved: data.get('clientApproved') === 'on',
    includeInPlanning: data.get('includeInPlanning') === 'on',
    estimate: reusableClaim?.estimate || normalizeExpertEstimate(null),
    createdAt: reusableClaim?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  if (reusableClaim) {
    Object.assign(reusableClaim, payload);
  } else {
    rawClaims.push(payload);
  }
  item.claims = normalizeAndRenumberClaims(rawClaims, item);
  item.claims.forEach((claim) => synchronizeClaimStatus(claim));
  refreshCaseApprovalFlagsFromClaims(item);
  const savedClaim = item.claims.find((candidate) => candidate.id === payload.id) || payload;
  addHistory(item, reusableClaim ? 'claim.reused' : 'claim.created', reusableClaim ? 'Premier ordre de réparation renseigné' : 'Ordre de réparation ajouté', getClaimLabel(savedClaim));
  saveState();
  form.reset();
  renderCaseDetail();
}

function normalizeAndRenumberClaims(claims, item) {
  const normalized = normalizeRepairClaims(claims, item);
  return normalized.map((claim, index) => ({
    ...claim,
    number: `OT-${String(index + 1).padStart(3, '0')}`,
    updatedAt: claim.updatedAt || new Date().toISOString(),
  }));
}

function isReusableEmptyClaim(claim, item = {}) {
  if (!claim || typeof claim !== 'object') return false;
  const noEstimate = !claim.estimateNumber
    && !claim.orNumber
    && !(claim.estimate?.lines || []).length
    && !(claim.estimate?.originalLines || []).length;
  const noApprovals = !claim.expertApproved && !claim.clientApproved;
  const noMeaningfulAmount = !Number(claim.amount || 0);
  const title = String(claim.title || claim.label || '').trim();
  const defaultTitles = new Set([
    '',
    'Sinistre principal',
    'Sinistre 1',
    'Intervention 1',
    item.damageNotes || '',
    item.expertEstimate?.reference || '',
  ]);
  const looksDefault = defaultTitles.has(title) || /^sinistre\s*principal$/i.test(title);
  return noEstimate && noApprovals && noMeaningfulAmount && looksDefault;
}

async function deleteClaim(item, claimId) {
  item.claims = normalizeRepairClaims(item.claims, item);
  const claim = item.claims.find((candidate) => candidate.id === claimId);
  if (!claim) return;
  const confirmed = await showConfirmModal(`Supprimer ${claim.number || claim.title} ?`);
  if (!confirmed) return;
  item.claims = item.claims.filter((candidate) => candidate.id !== claimId);
  recomputeCaseDurationsFromClaims(item);
  addHistory(item, 'claim.deleted', 'Ordre de réparation supprimé', getClaimLabel(claim));
  saveState();
  renderCaseDetail();
}

function populateSupplementClaimSelect(root, item) {
  const select = $('[data-supplement-claim-select]', root);
  if (!select) return;
  const current = select.value;
  const claims = normalizeRepairClaims(item.claims || [], item);
  select.innerHTML = `<option value="">Non rattaché</option>` + claims.map((claim) => `<option value="${escapeAttr(claim.id)}">${escapeHtml(claim.number || '')} · ${escapeHtml(claim.title || 'Ordre')}</option>`).join('');
  if (current && claims.some((claim) => claim.id === current)) select.value = current;
}

function renderSupplements(root, item) {
  const target = $(`[data-field='supplements']`, root);
  if (!target) return;
  populateSupplementClaimSelect(root, item);
  item.supplements = normalizeRepairSupplements(item.supplements);
  target.innerHTML = item.supplements.length
    ? item.supplements.map((supplement) => {
        const laborTotal = roundHours((supplement.laborLines || []).reduce((sum, line) => sum + Number(line.laborHours || 0), 0));
        const partRows = supplement.parts.length
          ? supplement.parts.map((part) => `<li>${escapeHtml(part.designation)}${part.quantity ? ` × ${formatLocalizedDecimal(part.quantity)}` : ''}</li>`).join('')
          : '<li>Aucune pièce renseignée.</li>';
        const laborRows = supplement.laborLines.length
          ? supplement.laborLines.map((line) => `<li><strong>${escapeHtml(getDurationLabel(line.phase))}</strong> · ${escapeHtml(line.operation)} · ${formatLocalizedDecimal(line.laborHours)} h</li>`).join('')
          : '<li>Aucune main-d’œuvre renseignée.</li>';
        return `
          <article class="supplement-card" data-supplement-id="${supplement.id}">
            <div class="supplement-head">
              <div>
                <strong>${escapeHtml(supplement.number || supplement.title)}</strong>
                <span>${escapeHtml(SUPPLEMENT_STATUS_LABELS[supplement.status] || supplement.status)} · ${formatDate(supplement.createdAt)} · ${formatLocalizedDecimal(laborTotal)} h MO</span>
              </div>
              <div class="case-actions">
                <button class="ghost-button" type="button" data-supplement-print="${supplement.id}">Imprimer</button>
                <button class="ghost-button" type="button" data-supplement-integrate="${supplement.id}" ${supplement.integrated ? 'disabled' : ''}>Intégrer durées</button>
                <button class="ghost-button danger-button" type="button" data-supplement-delete="${supplement.id}">Supprimer</button>
              </div>
            </div>
            <p>${escapeHtml(supplement.reason || 'Aucun motif renseigné.')}</p>
            <p class="muted">Ordre lié : ${escapeHtml(getSupplementClaimLabel(item, supplement))} · Zone : ${escapeHtml(supplement.vehicleArea || '-')} · Expert : ${supplement.expertApproved ? 'OK' : 'en attente'} · Client : ${supplement.clientApproved ? 'OK' : 'en attente'}${supplement.integratedAt ? ` · intégré le ${formatDateTime(supplement.integratedAt)}` : ''}</p>
            <div class="supplement-columns">
              <div><h3>Pièces complémentaires</h3><ul>${partRows}</ul></div>
              <div><h3>Main-d’œuvre complémentaire</h3><ul>${laborRows}</ul></div>
            </div>
            <label>Statut
              <select data-supplement-status="${supplement.id}">
                ${Object.entries(SUPPLEMENT_STATUS_LABELS).map(([value, label]) => `<option value="${value}" ${supplement.status === value ? 'selected' : ''}>${label}</option>`).join('')}
              </select>
            </label>
          </article>
        `;
      }).join('')
    : `<div class="empty-inline">Aucune réparation complémentaire. Ajoutez un complément quand un dommage est découvert pendant les travaux.</div>`;

  $$('[data-supplement-status]', target).forEach((select) => {
    select.addEventListener('change', () => {
      const supplement = item.supplements.find((candidate) => candidate.id === select.dataset.supplementStatus);
      if (!supplement) return;
      supplement.status = normalizeSupplementStatus(select.value);
      supplement.updatedAt = new Date().toISOString();
      addHistory(item, 'supplement.status', 'Statut complément modifié', `${supplement.number || supplement.title}: ${SUPPLEMENT_STATUS_LABELS[supplement.status]}`);
      saveState();
      renderCaseDetail();
    });
  });
  $$('[data-supplement-integrate]', target).forEach((button) => {
    button.addEventListener('click', () => integrateSupplementDurations(item, button.dataset.supplementIntegrate));
  });
  $$('[data-supplement-print]', target).forEach((button) => {
    button.addEventListener('click', () => printSupplementWorkOrders(item, button.dataset.supplementPrint));
  });
  $$('[data-supplement-delete]', target).forEach((button) => {
    button.addEventListener('click', () => deleteSupplement(item, button.dataset.supplementDelete));
  });
}

async function handleSupplementSubmit(event, item) {
  event.preventDefault();
  const form = event.currentTarget;

  if (!item.flags.received) {
    notifyUser("Impossible d'ajouter un complément : le véhicule n'est pas encore réceptionné.", "error");
    return;
  }
  const warnings = getBusinessRuleWarnings(item, "supplement");
  if (warnings.length) {
    const confirmed = await showConfirmModal(warnings.join("<br>") + "<br><br>Voulez-vous vraiment continuer ?");
    if (!confirmed) return;
  }

  const data = new FormData(form);
  const laborHours = parseLocalizedDecimal(data.get('laborHours'));
  const operation = normalizeTextInputValue(data.get('operation'));
  const parts = String(data.get('parts') || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => parseSupplementPartLine(line));
  const nextNumber = `RC-${String((item.supplements || []).length + 1).padStart(3, '0')}`;
  const supplement = normalizeRepairSupplement({
    id: uid('supplement'),
    number: nextNumber,
    title: normalizeTextInputValue(data.get('title')) || nextNumber,
    reason: normalizeTextInputValue(data.get('reason')),
    vehicleArea: normalizeTextInputValue(data.get('vehicleArea')),
    status: data.get('status') || 'draft',
    expertApproved: isClientOnlyRepairClaim({ type: data.get('type') }) || data.get('expertApproved') === 'on',
    clientApproved: data.get('clientApproved') === 'on',
    claimId: data.get('claimId') || '',
    parts,
    laborLines: operation || laborHours ? [{ operation, phase: data.get('phase') || 'body', laborHours }] : [],
  });
  if (!supplement.reason) {
    notifyUser('Renseignez le motif du complément.', 'error');
    return;
  }
  item.supplements = normalizeRepairSupplements(item.supplements);
  item.supplements.push(supplement);
  addHistory(item, 'supplement.created', 'Réparation complémentaire ajoutée', `${supplement.number} - ${supplement.title}`);
  saveState();
  form.reset();
  renderCaseDetail();
}

function parseSupplementPartLine(line) {
  const quantityMatch = line.match(/(?:\bx\s*|×\s*)(\d+(?:[,.]\d+)?)\s*$/i);
  const quantity = quantityMatch ? parseLocalizedDecimal(quantityMatch[1]) : 1;
  const designation = quantityMatch ? line.slice(0, quantityMatch.index).trim() : line;
  return { id: uid('supplement-part'), designation: designation || line, quantity: quantity || 1, notes: '' };
}

function getSupplementClaimLabel(item, supplement) {
  const claim = (item.claims || []).find((candidate) => candidate.id === supplement.claimId);
  return claim ? `${claim.number || ''} ${claim.title || ''}`.trim() : 'Non rattaché';
}

async function integrateSupplementDurations(item, supplementId) {
  const supplement = (item.supplements || []).find((candidate) => candidate.id === supplementId);
  if (!supplement) return;
  if (supplement.integrated) {
    notifyUser('Ce complément est déjà intégré aux durées atelier.', 'warn');
    return;
  }
  let confirmed = true;
  if (!supplement.expertApproved && !supplement.clientApproved) {
    confirmed = await showConfirmModal('Ce complément n’a pas encore d’accord expert/client. Intégrer quand même les durées au planning ?');
  }
  if (!confirmed) return;
  let total = 0;
  (supplement.laborLines || []).forEach((line) => {
    if (!DURATIONS.some(([key]) => key === line.phase)) return;
    item.durations[line.phase] = roundHours(Number(item.durations[line.phase] || 0) + Number(line.laborHours || 0));
    total += Number(line.laborHours || 0);
  });
  supplement.integrated = true;
  supplement.integratedAt = new Date().toISOString();
  supplement.status = supplement.status === 'done' ? 'done' : 'planned';
  supplement.updatedAt = supplement.integratedAt;
  addHistory(item, 'supplement.integrated', 'Complément intégré au planning', `${supplement.number || supplement.title}: +${formatLocalizedDecimal(total)} h`);
  saveState();
  generatedProposals[item.id] = null;
  render();
  notifyUser('Durées complémentaires intégrées. Recalculez le RDV/planning si nécessaire.', 'success');
}

async function deleteSupplement(item, supplementId) {
  const supplement = (item.supplements || []).find((candidate) => candidate.id === supplementId);
  if (!supplement) return;
  const confirmed = await showConfirmModal(`Supprimer le complément ${supplement.number || supplement.title} ?`);
  if (!confirmed) return;
  item.supplements = item.supplements.filter((candidate) => candidate.id !== supplementId);
  addHistory(item, 'supplement.deleted', 'Réparation complémentaire supprimée', supplement.number || supplement.title);
  saveState();
  renderCaseDetail();
}

function renderKanban() {
  const board = $("#kanban-board");
  if (!board) return;
  const columns = [
    { key: "reception", label: "Réception", statuses: ["estimate", "awaitingVehicle", "vehicleReceived"] },
    { key: "approvals", label: "Accords", statuses: ["approvals"] },
    { key: "appointment", label: "RDV", statuses: ["appointment", "appointmentScheduled", "workScheduled", "noShow"] },
    { key: "work", label: "En travaux", statuses: ["work"] },
    { key: "quality", label: "Qualité", statuses: ["quality"] },
    { key: "delivered", label: "Livré", statuses: ["delivered"] },
  ];
  board.innerHTML = columns
    .map((column) => {
      const cases = state.cases.filter((item) => column.statuses.includes(getCaseStatus(item)));
      return `
        <section class="kanban-column">
          <div class="kanban-column-head">
            <h2>${column.label}</h2>
            <span>${cases.length}</span>
          </div>
          <div class="kanban-cards">
            ${
              cases.length
                ? cases
                    .map(
                      (item) => {
                        const nextAction = getCaseNextAction(item);
                        return `
                        <button class="kanban-card ${isCaseBlocked(item) ? "blocked-case" : ""}" type="button" data-kanban-case="${item.id}">
                          <strong>${escapeHtml(item.clientName)}</strong>
                          <span>${escapeHtml(shortVehicleModel(item.vehicle || "Véhicule"))} · ${escapeHtml(item.plate || item.vin || "Sans immat.")}</span>
                          <span>${escapeHtml(statusLabels[getCaseStatus(item)] || "Statut")}${item.appointment ? ` · ${formatDateTime(item.appointment.start)}` : ""}</span>
                          <span>Prochaine action : ${escapeHtml(nextAction.label)}</span>
                        </button>
                      `;
                      },
                    )
                    .join("")
                : `<div class="empty-inline">Aucun dossier</div>`
            }
          </div>
        </section>
      `;
    })
    .join("");
}

function renderCaseDetail() {
  const detail = $("#case-detail");
  const item = getActiveCase();
  if (!item) {
    detail.innerHTML = `
      <div class="empty-state">
        <div>
          <strong>Aucun dossier sélectionné</strong>
          <span>Créez ou choisissez un dossier pour commencer.</span>
        </div>
      </div>
    `;
    return;
  }

  const template = $("#case-detail-template");
  detail.replaceChildren(template.content.cloneNode(true));
  updateVehicleImportStatus(vehicleRecords.length ? `${vehicleRecords.length} véhicules chargés` : "Importez la base véhicules pour chercher par VIN");
  setupCaseDetailTabs(detail, item);
  updateCaseHeader(detail, item);
  $("[data-field='status']", detail).textContent = statusLabels[getCaseStatus(item)];
  $("[data-field='created']", detail).textContent = `Créé le ${formatDate(item.createdAt)}`;
  $("[data-field='expert-state']", detail).innerHTML = item.expertName
    ? `<span class="tag ok">Expert renseigné</span>`
    : `<span class="tag warn">À compléter</span>`;

  $$("[data-input]", detail).forEach((input) => {
    const field = input.dataset.input;
    input.value = item[field] || "";
    input.addEventListener("input", () => {
      item[field] = input.value;
      saveState();
      renderMetrics();
      renderCases();
      renderWorkflow(detail, item);
      renderCaseStageFlow(detail, item);
      renderCaseBlockerControls(detail, item);
      renderValidationAlert(detail, item);
      renderCaseSummary(detail, item);
      refreshCaseActionAvailability(detail, item);
      updateCaseHeader(detail, item);
      renderVehicleIdentityCard(detail, item);
    });
  });

  $$("[data-toggle]", detail).forEach((input) => {
    const field = input.dataset.toggle;
    input.checked = Boolean(item.flags[field]);
    input.addEventListener("change", async () => {
      const checked = input.checked;
      if (checked) {
        const issues = getBusinessRuleIssues(item, field);
        if (issues.length) {
          input.checked = false;
          notifyUser(issues.join("\n"));
          return;
        }
        const warnings = getBusinessRuleWarnings(item, field);
        if (warnings.length) {
          input.checked = false;
          const confirmed = await showConfirmModal(warnings.join("<br>") + "<br><br>Voulez-vous vraiment continuer ?");
          if (!confirmed) {
            return;
          }
          input.checked = true;
        }
      }

      if (field === "clientApproved" && !checked && (item.appointment || state.bookings.some((booking) => booking.caseId === item.id))) {
        input.checked = true;
        const confirmed = await showConfirmModal("Retirer la validation client/interne supprimera le RDV et les affectations atelier de ce dossier.");
        if (!confirmed) {
          return;
        }
        input.checked = false;
      }

      const wasDelivered = Boolean(item.flags.delivered);
      if (field === "clientApproved") {
        if (checked) {
          applyWorkflowAction(item, "clientApproved");
        } else {
          const workflowClaimIds = new Set(getWorkflowClaims(item).map((claim) => claim.id));
          (item.claims || []).forEach((claim) => {
            if (!workflowClaimIds.has(claim.id)) return;
            claim.clientApproved = false;
            claim.updatedAt = new Date().toISOString();
            synchronizeClaimStatus(claim, "clientApproved");
          });
          refreshCaseApprovalFlagsFromClaims(item);
          clearCasePlanning(item, "Planning annulé après retrait de la validation client/interne");
          recordFlagHistory(item, "clientApproved", false);
        }
        saveState();
        render();
        return;
      }
      item.flags[field] = checked;
      if (field === "qualityApproved" && !checked) {
        item.flags.delivered = false;
        if (wasDelivered) recordFlagHistory(item, "delivered", false);
      }
      if (field === "workCompleted" && !checked) {
        item.flags.qualityApproved = false;
        item.flags.delivered = false;
        if (wasDelivered) recordFlagHistory(item, "delivered", false);
      }
      recordFlagHistory(item, field, checked);
      saveState();
      render();
    });
  });

  renderWorkflow(detail, item);
  renderCaseStageFlow(detail, item);
  renderCaseBlockerControls(detail, item);
  renderValidationAlert(detail, item);
  renderVehicleIdentityCard(detail, item);
  renderPhotos(detail, item);
  renderDurations(detail, item);
  renderExpertEstimate(detail, item);
  renderEstimateImportPreview(detail, item);
  renderClaims(detail, item);
  renderSupplements(detail, item);
  renderProposals(detail, item);
  renderQualityChecklist(detail, item);
  renderAssignments(detail, item);
  renderDossierExport(detail, item);
  renderHistory(detail, item);
  renderCaseSummary(detail, item);

  $("#photo-input", detail).addEventListener("change", (event) => handlePhotos(event, item, $("#photo-category", detail)?.value));
  $("#claim-form", detail)?.addEventListener("submit", (event) => handleClaimSubmit(event, item));
  $("#supplement-form", detail)?.addEventListener("submit", (event) => handleSupplementSubmit(event, item));
  $("#print-supplement-orders", detail)?.addEventListener("click", () => printSupplementWorkOrders(item));
  $$("[data-open-case-tab]", detail).forEach((button) => {
    button.addEventListener("click", () => {
      $(`[data-case-tab='${button.dataset.openCaseTab}']`, detail)?.click();
    });
  });
  const proposalButton = $("#generate-proposals", detail);
  proposalButton.addEventListener("click", () => {
    const issues = getBusinessRuleIssues(item, "appointment");
    if (issues.length) {
      notifyUser(issues.join("\n"));
      return;
    }
    generatedProposals[item.id] = generateAppointmentOptions(item);
    renderCaseDetail();
  });
  $$("[data-action-flag]", detail).forEach((button) => {
    const flag = button.dataset.actionFlag;
    button.addEventListener("click", async () => {
      const issues = getBusinessRuleIssues(item, flag);
      if (issues.length) {
        notifyUser(issues.join("\n"));
        return;
      }
      const warnings = getBusinessRuleWarnings(item, flag);
      if (warnings.length) {
        const confirmed = await showConfirmModal(warnings.join("<br>") + "<br><br>Voulez-vous vraiment continuer ?");
        if (!confirmed) return;
      }
      if (flag === "workCompleted") {
        const result = await completeCaseWorkWithChiefOverride(item);
        if (!result?.ok) {
          notifyUser(result?.message || "Clôture globale impossible.", result?.cancelled ? "info" : "error");
          return;
        }
        recordReleasedCapacityIfNeeded(item, result.freedMinutes);
        notifyUser(result.message || "Travaux terminés.", "success");
        saveState({ flushCloud: true, cloudReason: `workflow-${flag}` });
        render();
        return;
      }
      applyWorkflowAction(item, flag);
      saveState({ flushCloud: true, cloudReason: `workflow-${flag}` });
      render();
    });
  });
  $("#print-repair-order", detail).addEventListener("click", () => printRepairOrder(item));
  $("#print-technician-work-orders", detail)?.addEventListener("click", () => printTechnicianWorkOrders(item));
  $("#export-case-folder", detail)?.addEventListener("click", () => exportCaseFolder(item));
  $("#export-client-folder", detail)?.addEventListener("click", () => exportClientFolder(item));
  $("#delete-case", detail)?.addEventListener("click", () => deleteActiveCase(item));
  $("#mark-no-show", detail)?.addEventListener("click", () => markAppointmentNoShow(item));
  $("#reschedule-appointment", detail)?.addEventListener("click", () => rescheduleAppointment(item));
  refreshCaseActionAvailability(detail, item);
  applyProductionLock(detail, item);
}


function setupCaseDetailTabs(root, item) {
  const allowedTabs = $$(`[data-case-tab]`, root).map((button) => button.dataset.caseTab);
  if (!allowedTabs.includes(activeCaseDetailTab)) activeCaseDetailTab = "claims";

  const activateTab = (tab) => {
    activeCaseDetailTab = tab;
    $$(`[data-case-tab]`, root).forEach((button) => {
      const active = button.dataset.caseTab === tab;
      button.classList.toggle("active", active);
      button.setAttribute("aria-current", active ? "page" : "false");
    });
    $$(`[data-case-panel]`, root).forEach((panel) => {
      const active = panel.dataset.casePanel === tab;
      panel.hidden = !active;
      panel.classList.toggle("active", active);
    });
  };

  $$(`[data-case-tab]`, root).forEach((button) => {
    button.addEventListener("click", () => activateTab(button.dataset.caseTab));
  });

  $(`[data-next-action-tab]`, root)?.addEventListener("click", () => {
    const action = getNextWorkflowAction(item);
    const nextAction = getCaseNextAction(item);
    const targetTab = nextAction?.code ? getCaseNextActionTab(nextAction.code) : (action ? getTabForAction(action) : "planning");
    activateTab(targetTab);
    // Scroll vers l'élément d'action correspondant (même si l'onglet était déjà actif)
    if (action) {
      const targetEl =
        root.querySelector(`[data-action-flag="${action}"]`) ||
        root.querySelector(`[data-toggle="${action}"]`) ||
        (action === "labor" ? root.querySelector("[data-manual-labor-entry]") : null) ||
        (action === "claim" ? root.querySelector("#claim-form") : null) ||
        (action === "appointment" ? root.querySelector("#generate-proposals") : null);
      if (action === "labor" && targetEl?.tagName === "DETAILS") targetEl.open = true;
      if (targetEl) {
        setTimeout(() => {
          targetEl.scrollIntoView({ behavior: "smooth", block: "center" });
          targetEl.classList.add("highlight-pulse");
          setTimeout(() => targetEl.classList.remove("highlight-pulse"), 1800);
        }, 80);
      }
    }
  });

  activateTab(activeCaseDetailTab);
}

function getTabForAction(action) {
  if (action === "claim") return "claims";
  if (action === "labor") return "claims";
  if (action === "expertApproved" || action === "clientApproved") return "claims";
  if (action === "appointment") return "planning";
  if (action === "received" || action === "workStarted" || action === "workCompleted") return "atelier";
  if (action === "qualityApproved" || action === "delivered" || action === "invoiced") return "livraison";
  return "claims";
}

function recordReleasedCapacityIfNeeded(item, freedMinutes) {
  if (Number(freedMinutes || 0) <= 0) return;
  addHistory(
    item,
    "planning.capacity.released",
    "Capacité atelier libérée",
    `${formatLocalizedDecimal(Number(freedMinutes || 0) / 60)} h libérée(s) car les travaux sont terminés avant la fin planifiée.`
  );
}

function applyWorkflowAction(item, action) {
  const workflowClaimIds = new Set(getWorkflowClaims(item).map((claim) => claim.id));
  const claims = Array.isArray(item.claims) ? item.claims : [];
  const now = new Date().toISOString();

  if (action === "expertApproved") {
    claims.forEach((claim) => {
      if (workflowClaimIds.has(claim.id) && !isClientOnlyRepairClaim(claim)) {
        claim.expertApproved = true;
        claim.updatedAt = now;
        synchronizeClaimStatus(claim, "expertApproved");
      }
    });
    refreshCaseApprovalFlagsFromClaims(item);
    recordFlagHistory(item, "expertApproved", item.flags.expertApproved);
    return;
  }

  if (action === "clientApproved") {
    claims.forEach((claim) => {
      if (!workflowClaimIds.has(claim.id)) return;
      claim.clientApproved = true;
      claim.updatedAt = now;
      synchronizeClaimStatus(claim, "clientApproved");
    });
    refreshCaseApprovalFlagsFromClaims(item);
    recordFlagHistory(item, "clientApproved", item.flags.clientApproved);
    return;
  }

  if (action === "workCompleted") {
    const technicianBookings = getCaseIncompleteTechnicianBookings(item);
    if (technicianBookings.length) {
      addHistory(
        item,
        "planning.work.completed.blocked",
        "Clôture globale refusée",
        `${technicianBookings.length} tâche(s) affectée(s) doivent être terminées depuis la vue Technicien ou par override chef atelier.`
      );
      return {
        ok: false,
        message: "Terminez les tâches affectées depuis la vue Technicien, ou utilisez un override chef atelier avec motif.",
      };
    }
    const result = completeCaseWorkBookingsNow(item, new Date(now));
    item.flags.workCompleted = true;
    if (!result.completed) recordFlagHistory(item, action, true);
    recordReleasedCapacityIfNeeded(item, result.freedMinutes);
    return { ok: true, ...result };
  }

  item.flags[action] = true;
  if (action === "workStarted") item.flags.workCompleted = false;
  recordFlagHistory(item, action, true);
}


function renderCaseSummary(root, item) {
  const action = getNextWorkflowAction(item);
  const nextAction = getCaseNextAction(item);
  const issues = action ? getBusinessRuleIssues(item, action) : [];
  const assignments = state.bookings.filter((booking) => booking.caseId === item.id);
  const nextTitle = nextAction.label || (action ? ACTION_LABELS[action] || "Continuer" : "Dossier terminé");
  const nextDescription = isCaseBlocked(item)
    ? nextAction.reason
    : action
      ? action === "claim"
        ? "Ajoutez au moins un ordre de travail SAV avant de planifier."
        : action === "labor"
          ? "L’ordre existe déjà. Ajoutez une ligne de main-d’œuvre manuelle ou importez un devis."
          : issues.length
            ? `Avant de continuer : ${issues[0]}`
            : nextAction.reason || "Tout est prêt pour cette étape."
      : nextAction.reason || "Toutes les étapes principales sont validées.";

  setText(root, "summary-next-action", nextTitle);
  setText(root, "summary-next-description", nextDescription);
  setText(root, "summary-client", item.clientName || "Client non renseigné");
  setText(root, "summary-phone", [
    item.phone || "Téléphone client non renseigné",
    item.driverName ? `Déposant: ${item.driverName}` : "",
  ].filter(Boolean).join(" · "));
  setText(root, "summary-vehicle", item.vehicle || "Véhicule non renseigné");
  setText(root, "summary-vehicle-extra", `${item.plate || "Sans immatriculation"} · ${item.vin || "VIN non renseigné"}`);
  setText(root, "summary-planning", item.appointment ? formatDateTime(item.appointment.start) : "RDV non planifié");
  setText(root, "summary-delivery", item.appointment ? `Livraison estimée : ${formatDateTime(item.appointment.delivery)}` : "Calculez un RDV pour obtenir la livraison estimée.");

  const workflowClaims = getWorkflowClaims(item);
  const primaryClaim = workflowClaims[0] || item.claims?.[0] || null;
  const orderType = primaryClaim ? getClaimTypeLabel(primaryClaim.type) : "Type non défini";
  const orderNumbers = [
    primaryClaim?.number,
    primaryClaim?.orNumber || item.orNavNumber,
    cleanParsedEstimateNumber(primaryClaim?.estimateNumber || primaryClaim?.estimate?.reference || item.expertEstimate?.reference),
  ].filter(Boolean).join(" · ");
  setText(root, "summary-order-type", orderType);
  setText(root, "summary-order-extra", orderNumbers || "N° OR / N° devis non renseigné");

  setText(root, "summary-photos", `${item.photos.length} photo${item.photos.length > 1 ? "s" : ""}`);
  const hasInsuranceClaim = workflowClaims.some((claim) => !isClientOnlyRepairClaim(claim));
  setText(root, "summary-expert", hasInsuranceClaim ? (item.flags.expertApproved ? "Accord expert validé" : "Accord expert à traiter") : "Expert non requis");
  setText(root, "summary-quality", item.flags.qualityApproved ? "Qualité validée" : `${assignments.length} affectation${assignments.length > 1 ? "s" : ""}`);

  const nextButton = $(`[data-next-action-tab]`, root);
  if (nextButton) {
    nextButton.textContent = nextAction.code === "done"
      ? "Voir historique"
      : action === "claim"
      ? "Ajouter un ordre"
      : action === "labor"
        ? "Ajouter la main-d’œuvre"
        : nextAction.label || "Continuer le dossier";
    nextButton.dataset.nextActionCode = nextAction.code;
  }
}

function setText(root, field, value) {
  const target = $(`[data-field='${field}']`, root);
  if (target) target.textContent = value;
}

function renderVehicleIdentityCard(root, item) {
  const target = $("[data-field='vehicle-identity']", root);
  if (!target) return;
  const fields = [
    ["Client", item.clientName],
    ["Téléphone client", item.phone],
    ["Propriétaire / société", item.ownerName],
    ["Personne déposante", item.driverName],
    ["Téléphone déposant", item.driverPhone],
    ["Véhicule", item.vehicle],
    ["Immatriculation", item.plate],
    ["VIN", item.vin],
    ["Couleur", item.color],
    ["Kilométrage", item.mileage ? `${item.mileage} km` : ""],
    ["Assurance", item.insurance],
    ["Réf. OR", item.orNavNumber],
  ];
  target.innerHTML = `
    <div class="vehicle-identity-head">
      <div>
        <strong>Véhicule du dossier</strong>
        <p class="muted">Ce véhicule est déjà associé au dossier.</p>
      </div>
      <span class="tag ${item.flags.received ? "ok" : "warn"}">${item.flags.received ? "Réception confirmée" : "En attente réception"}</span>
    </div>
    <dl class="identity-grid">
      ${fields
        .map(
          ([label, value]) => `
            <div>
              <dt>${escapeHtml(label)}</dt>
              <dd>${escapeHtml(value || "-")}</dd>
            </div>
          `,
        )
        .join("")}
    </dl>
  `;
  setText(root, "arrival-notes", item.arrivalNotes || item.damageNotes || "Aucune observation réception renseignée.");
}

function updateCaseHeader(root, item) {
  $("[data-field='title']", root).textContent = item.clientName;
  $("[data-field='subtitle']", root).textContent = `${item.vehicle || "Véhicule non renseigné"} · ${item.plate || item.vin || "Sans immatriculation"} · ${item.phone || "Téléphone client non renseigné"}${item.driverName ? ` · Déposant: ${item.driverName}` : ""}`;
}

function getWorkflowStepsForCase(item) {
  const workflowClaims = getWorkflowClaims(item);
  const hasInsurance = workflowClaims.some((claim) => !isClientOnlyRepairClaim(claim));
  if (!workflowClaims.length || hasInsurance) return WORKFLOW;
  return [
    ["created", "Fiche dossier"],
    ["clientApproved", "Validation client/interne"],
    ["appointment", "RDV fixé"],
    ["vehiclePending", "En attente réception"],
    ["received", "Véhicule reçu"],
    ["assigned", "Travaux planifiés"],
    ["workStarted", "Travaux en cours"],
    ["workCompleted", "Travaux terminés"],
    ["qualityApproved", "Contrôle qualité"],
    ["delivered", "Livraison"],
    ["invoiced", "Dossier facturé"],
  ];
}

function renderWorkflow(root, item) {
  const workflow = $("[data-field='workflow']", root);
  if (!workflow) return;
  const values = getWorkflowValues(item);
  const steps = getWorkflowStepsForCase(item);
  workflow.innerHTML = steps.map(([key, label], index) => {
    const done = values[key];
    return `
      <div class="workflow-step ${done ? "done" : ""}">
        <span class="dot">${done ? "✓" : index + 1}</span>
        <span>${label}</span>
      </div>
    `;
  }).join("");
}

const CASE_STAGE_FLOW = [
  ["opened", "Ouvert"],
  ["appointment", "RDV"],
  ["received", "Véhicule reçu"],
  ["labor", "Main-d'œuvre"],
  ["validation", "Validation"],
  ["planned", "Planifié"],
  ["work", "En travaux"],
  ["quality", "Qualité"],
  ["readyDelivery", "Prêt livraison"],
  ["delivered", "Livré"],
];

function getCaseStageFlow(item) {
  const values = getWorkflowValues(item);
  const nextAction = getCaseNextAction(item);
  const hasValidation = getWorkflowClaims(item).length > 0;
  const hasLabor = hasKnownLabor(item);
  const hasPlanning = hasCaseBookings(item);
  const done = {
    opened: true,
    appointment: Boolean(item.appointment),
    received: Boolean(item.flags.received),
    labor: hasLabor,
    validation: hasValidation ? caseHasCompletedValidations(item) : false,
    planned: hasPlanning,
    work: Boolean(item.flags.workCompleted),
    quality: Boolean(item.flags.qualityApproved),
    readyDelivery: Boolean(item.flags.qualityApproved),
    delivered: Boolean(item.flags.delivered),
  };
  const currentByAction = {
    complete_vehicle_identity: "opened",
    add_labor: "labor",
    schedule_appointment: "appointment",
    receive_vehicle: "received",
    validate_customer_or_internal: "validation",
    schedule_work: "planned",
    start_work: "work",
    resume_or_replan_work: "work",
    finish_work: "work",
    quality_check: "quality",
    prepare_delivery: "readyDelivery",
    deliver_vehicle: "delivered",
    resolve_blocker: hasPlanning || values.workStarted ? "work" : hasLabor ? "validation" : "labor",
    done: "delivered",
  };
  const currentKey = currentByAction[nextAction.code] || "opened";
  return CASE_STAGE_FLOW.map(([key, label]) => {
    let stateName = done[key] ? "done" : key === currentKey ? "current" : "todo";
    if (key === "validation" && !hasValidation) stateName = "na";
    if (nextAction.code === "resolve_blocker" && key === currentKey) stateName = "blocked";
    if (key === "work" && item.flags.workStarted && !item.flags.workCompleted && stateName !== "blocked") stateName = "current";
    if (key === "readyDelivery" && item.flags.qualityApproved && !item.flags.delivered) stateName = "current";
    return { key, label, state: stateName };
  });
}

function renderCaseStageFlow(root, item) {
  const target = $("[data-field='case-stage-flow']", root);
  if (!target) return;
  target.innerHTML = getCaseStageFlow(item)
    .map((step, index) => `
      <div class="stage-step stage-${escapeAttr(step.state)}">
        <span class="stage-dot">${stageStateSymbol(step.state, index)}</span>
        <span>${escapeHtml(step.label)}</span>
      </div>
    `)
    .join("");
}

function stageStateSymbol(stateName, index) {
  if (stateName === "done") return "✓";
  if (stateName === "blocked") return "!";
  if (stateName === "na") return "–";
  return String(index + 1);
}

function renderCaseBlockerControls(root, item) {
  const target = $("[data-field='case-blocker-controls']", root);
  if (!target) return;
  const blocked = isCaseBlocked(item);
  target.innerHTML = `
    <div class="blocker-head">
      <strong>Pièces / blocage</strong>
      <span class="tag ${blocked ? "warn" : "ok"}">${blocked ? "Bloqué" : "Suivi OK"}</span>
    </div>
    <div class="blocker-grid">
      <label>Statut pièces
        <select data-case-parts-status>
          ${PARTS_STATUS_OPTIONS.map(([value, label]) => `<option value="${escapeAttr(value)}" ${item.partsStatus === value ? "selected" : ""}>${escapeHtml(label)}</option>`).join("")}
        </select>
      </label>
      <label>Motif de blocage
        <select data-case-blocker-reason>
          ${BLOCKER_REASON_OPTIONS.map(([value, label]) => `<option value="${escapeAttr(value)}" ${item.blockerReason === value ? "selected" : ""}>${escapeHtml(label)}</option>`).join("")}
        </select>
      </label>
      <label class="wide">Détail
        <input data-case-blocker-details value="${escapeAttr(item.blockerDetails || "")}" placeholder="Précision libre si nécessaire" />
      </label>
      <button class="ghost-button" type="button" data-clear-case-blocker ${blocked ? "" : "disabled"}>Retirer blocage</button>
    </div>
  `;
  const updateBlocker = (sourceLabel) => {
    const previousBlocked = isCaseBlocked(item);
    item.partsStatus = normalizePartsStatus(target.querySelector("[data-case-parts-status]")?.value);
    item.blockerReason = normalizeBlockerReason(target.querySelector("[data-case-blocker-reason]")?.value);
    item.blockerDetails = normalizeTextInputValue(target.querySelector("[data-case-blocker-details]")?.value);
    const nextBlocked = isCaseBlocked(item);
    item.blockerSource = nextBlocked ? "manual" : "";
    item.blockerSourceBookingIds = [];
    addHistory(
      item,
      "case.blocker.updated",
      nextBlocked ? "Dossier marqué bloqué" : previousBlocked ? "Blocage retiré" : "Statut pièces mis à jour",
      `${sourceLabel}: ${getCaseBlockerLabel(item) || PARTS_STATUS_LABELS[item.partsStatus] || "Aucun blocage"}`,
    );
    saveState({ flushCloud: true, cloudReason: "case-blocker" });
    render();
  };
  target.querySelector("[data-case-parts-status]")?.addEventListener("change", () => updateBlocker("Statut pièces"));
  target.querySelector("[data-case-blocker-reason]")?.addEventListener("change", () => updateBlocker("Motif"));
  target.querySelector("[data-case-blocker-details]")?.addEventListener("change", () => updateBlocker("Détail"));
  target.querySelector("[data-clear-case-blocker]")?.addEventListener("click", () => {
    item.partsStatus = "unchecked";
    item.blockerReason = "";
    item.blockerDetails = "";
    item.blockerSource = "";
    item.blockerSourceBookingIds = [];
    addHistory(item, "case.blocker.cleared", "Blocage retiré", "Le dossier est de nouveau exploitable.");
    saveState({ flushCloud: true, cloudReason: "case-blocker-cleared" });
    render();
  });
}

function renderValidationAlert(root, item) {
  const target = $(`[data-field='validation-alert']`, root);
  if (!target) return;
  const action = getNextWorkflowAction(item);
  const issues = action ? getBusinessRuleIssues(item, action) : [];
  if (!issues.length) {
    target.hidden = true;
    target.innerHTML = "";
    return;
  }
  target.hidden = false;
  target.innerHTML = `
    <strong>À compléter avant : ${escapeHtml(ACTION_LABELS[action] || "prochaine étape")}</strong>
    <ul>${issues.map((issue) => `<li>${escapeHtml(issue)}</li>`).join("")}</ul>
  `;
}

function refreshCaseActionAvailability(root, item) {
  renderValidationAlert(root, item);

  const proposalButton = $("#generate-proposals", root);
  if (proposalButton) {
    const issues = getBusinessRuleIssues(item, "appointment");
    proposalButton.disabled = issues.length > 0;
    proposalButton.title = issues.join("\n");
  }

  $$("[data-action-flag]", root).forEach((button) => {
    const flag = button.dataset.actionFlag;
    const issues = item.flags[flag] ? [] : getBusinessRuleIssues(item, flag);
    button.disabled = Boolean(item.flags[flag]) || issues.length > 0;
    button.classList.toggle("validated", Boolean(item.flags[flag]));
    button.title = issues.join("\n");
  });

  $$("[data-toggle]", root).forEach((input) => {
    const field = input.dataset.toggle;
    const issues = input.checked ? [] : getBusinessRuleIssues(item, field);
    input.disabled = !input.checked && issues.length > 0;
    input.title = issues.join("\n");
    input.closest(".check-card")?.classList.toggle("disabled-card", input.disabled);
  });
}


function isProductionLocked(item) {
  return Boolean(item?.flags?.workStarted || item?.flags?.workCompleted || item?.flags?.qualityApproved || item?.flags?.delivered);
}

function applyProductionLock(root, item) {
  if (!isProductionLocked(item)) return;

  const isInvoiced = Boolean(item?.flags?.invoiced);
  const lockedPanels = isInvoiced 
    ? ["claims", "photos", "planning", "atelier", "livraison"] 
    : ["claims", "planning"];

  lockedPanels.forEach((panelName) => {
    const panel = root.querySelector(`[data-case-panel='${panelName}']`);
    if (!panel) return;
    panel.classList.add("production-locked-panel");
    disablePanelControls(panel);
    prependLockNotice(panel, isInvoiced ? "Dossier facturé et clôturé : cette section est figée en lecture seule." : "Dossier en travaux : les données de base sont figées. Utilisez les actions de tâche du planning pour démarrer, terminer, mettre en pause ou reporter un reliquat.");
  });

  const planningPanel = root.querySelector(`[data-case-panel='planning']`);
  if (planningPanel) {
    planningPanel.classList.add("production-locked-panel");
    disablePanelControls(planningPanel);
    prependLockNotice(planningPanel, "Travaux en cours : les durées et le rendez-vous global restent figés. Les boutons de chaque tâche servent au pilotage réel : démarrage, pause, fin anticipée ou replanification avant démarrage.");
    const appointmentSection = root.querySelector("#generate-proposals")?.closest(".detail-section");
    if (appointmentSection) {
      appointmentSection.classList.add("locked-appointment-section");
      const proposals = appointmentSection.querySelector("[data-field='proposals']");
      if (proposals) {
        proposals.innerHTML = `<div class="empty-inline"><strong>Rendez-vous global figé.</strong><br>Le véhicule est déjà en travaux. Pilotez les écarts depuis les actions des tâches réservées.</div>`;
      }
    }
  }

  root.querySelectorAll("[data-case-tab]").forEach((button) => {
    if (["claims", "planning"].includes(button.dataset.caseTab)) {
      button.classList.add("locked-tab");
      button.title = button.dataset.caseTab === "planning" ? "Planning global figé, actions de tâche disponibles." : "Section figée car les travaux sont en cours.";
    }
  });
}

function prependLockNotice(panel, message) {
  if (panel.querySelector(".production-lock-notice")) return;
  const notice = document.createElement("div");
  notice.className = "production-lock-notice";
  notice.textContent = message;
  panel.prepend(notice);
}

function disablePanelControls(panel) {
  panel.querySelectorAll("input, select, textarea, button").forEach((control) => {
    if (control.closest(".case-subnav")) return;
    if (control.hasAttribute("data-allow-production-action")) return;
    control.disabled = true;
    control.setAttribute("aria-disabled", "true");
  });
}

function renderHistory(root, item) {
  const target = $(`[data-field='history']`, root);
  if (!target) return;
  item.history = normalizeHistory(item.history, item.createdAt);
  const count = $(`[data-field='history-count']`, root);
  if (count) count.textContent = `${item.history.length} action${item.history.length > 1 ? "s" : ""}`;
  target.innerHTML = item.history.length
    ? item.history
        .map(
          (entry) => `
            <article class="history-card">
              <span>${formatDateTime(entry.at)}</span>
              <strong>${escapeHtml(entry.label)}</strong>
              ${entry.details ? `<p class="muted">${escapeHtml(entry.details)}</p>` : ""}
            </article>
          `,
        )
        .join("")
    : `<div class="empty-inline">Aucun historique.</div>`;
}

function getNextWorkflowAction(item) {
  if (!hasRepairClaims(item)) return "claim";
  const claimsToCheck = getWorkflowClaims(item);
  if (!claimsToCheck.length) return "claim";
  if (claimsToCheck.some((claim) => !claimHasLaborEstimate(claim))) return "labor";
  if (claimsToCheck.some((claim) => !isClientOnlyRepairClaim(claim) && !claim.expertApproved)) return "expertApproved";
  if (!item.appointment || appointmentNeedsReschedule(item)) return "appointment";
  if (claimsToCheck.some((claim) => !claim.clientApproved)) return "clientApproved";
  if (!item.flags.received) return "received";
  if (!item.flags.workStarted) return "workStarted";
  if (!item.flags.workCompleted) return "workCompleted";
  if (!item.flags.qualityApproved) return "qualityApproved";
  if (!item.flags.delivered) return "delivered";
  if (!item.flags.invoiced) return "invoiced";
  return null;
}

function appointmentNeedsReschedule(item) {
  return ["no_show", "reschedule_pending"].includes(item?.appointmentStatus);
}

function getBusinessRuleIssues(item, action) {
  if (!item) return ["Aucun dossier sélectionné."];
  const issues = [];
  const hasAssignments = state.bookings.some((booking) => booking.caseId === item.id);
  const workflowClaims = getWorkflowClaims(item);

  if (isCaseBlocked(item) && !["claim", "labor", "expertApproved", "clientApproved"].includes(action)) {
    issues.push(`Résoudre le blocage avant de continuer : ${getCaseBlockerLabel(item) || "dossier bloqué"}.`);
    return issues;
  }

  if (action !== "claim" && !workflowClaims.length) {
    issues.push("Créer au moins un ordre de réparation actif avant de continuer.");
  }

  if (action === "expertApproved") {
    const expertClaims = workflowClaims.filter((claim) => !isClientOnlyRepairClaim(claim));
    if (expertClaims.some((claim) => !claimHasLaborEstimate(claim))) issues.push("Importer ou saisir la main-d’œuvre sur chaque ordre assurance inclus.");
    if (expertClaims.length && !hasBeforeRepairPhoto(item)) issues.push("Ajouter au moins une photo Avant réparation.");
  }


  if (action === "clientApproved") {
    if (workflowClaims.some((claim) => !isClientOnlyRepairClaim(claim) && !claim.expertApproved)) issues.push("Valider d'abord l'accord expert sur les ordres assurance inclus.");
    if (workflowClaims.some((claim) => !isClientOnlyRepairClaim(claim) && claim.type !== 'client' && !String(item.insurance || '').trim())) issues.push("Renseigner la compagnie d’assurance avant l’accord client.");
    if (workflowClaims.some((claim) => !claimHasLaborEstimate(claim))) issues.push("Importer ou saisir la main-d’œuvre avant l’accord client/interne.");
  }

  if (action === "appointment") {
    if (workflowClaims.some((claim) => !claimHasLaborEstimate(claim))) issues.push("Importer ou saisir la main-d’œuvre sur chaque ordre inclus.");
    if (!hasVehicleIdentity(item)) issues.push("Renseigner une immatriculation ou un VIN.");
    if (totalDurationHours(item) <= 0) issues.push("Renseigner au moins une durée atelier.");
    const missingRoles = missingSchedulingRoles(item);
    if (missingRoles.length) issues.push(`Activer au moins une ressource pour : ${missingRoles.join(", ")}.`);
  }

  if (action === "received") {
    if (appointmentNeedsReschedule(item)) issues.push("Reporter le RDV avant réception.");
  }

  if (action === "workStarted") {
    if (!item.flags.received) issues.push("Confirmer la réception physique du véhicule avant de démarrer les travaux.");
    if (workflowClaims.some((claim) => !claim.clientApproved)) issues.push("Enregistrer la validation client/interne avant de démarrer les travaux.");
    if (!hasAssignments) issues.push("Aucune affectation atelier n'est planifiée pour ce dossier.");
  }

  if (action === "workCompleted") {
    if (!item.flags.workStarted) issues.push("Démarrer les travaux avant de les terminer.");
    if (!hasAssignments) issues.push("Aucune affectation atelier n'est planifiée pour ce dossier.");
  }

  if (action === "qualityApproved") {
    if (!item.flags.received) issues.push("Confirmer la réception du véhicule avant le contrôle qualité.");
    if (!item.flags.workStarted) issues.push("Démarrer les travaux avant le contrôle qualité.");
    if (!item.flags.workCompleted) issues.push("Marquer les travaux terminés avant le contrôle qualité.");
    if (!hasAssignments) issues.push("Aucune affectation atelier n'est planifiée pour ce dossier.");
    if (!isQualityChecklistComplete(item)) issues.push("Compléter toute la checklist qualité.");
  }

  if (action === "delivered") {
    if (!item.appointment) issues.push("Choisir un RDV avant livraison.");
    if (!item.flags.received) issues.push("Confirmer la réception physique du véhicule avant livraison.");
    if (!item.flags.workStarted) issues.push("Démarrer les travaux avant livraison.");
    if (!item.flags.workCompleted) issues.push("Marquer les travaux terminés avant livraison.");
    if (!hasAssignments) issues.push("Aucune affectation atelier n'est planifiée pour ce dossier.");
    if (!item.flags.qualityApproved) issues.push("Valider le contrôle qualité avant livraison.");
    if (workflowClaims.some((claim) => !isClientOnlyRepairClaim(claim)) && !hasAfterRepairPhoto(item)) issues.push("Ajouter au moins une photo Après réparation avant livraison assurance.");
  }

  if (action === "invoiced") {
    if (!item.flags.delivered) issues.push("Livrer le véhicule avant de facturer le dossier.");
  }

  return issues;
}

function getBusinessRuleWarnings(item, action) {
  if (!item) return [];
  const warnings = [];
  const workflowClaims = getWorkflowClaims(item);

  if (action === "appointment") {
    if (workflowClaims.some((claim) => !isClientOnlyRepairClaim(claim) && !claim.expertApproved)) warnings.push("Accord expert manquant : ce RDV sera prévisionnel.");
    if (workflowClaims.some((claim) => !claim.clientApproved)) warnings.push("Validation client/interne manquante : ce RDV sera prévisionnel.");
  }

  if (action === "received") {
    if (!item.appointment) warnings.push("Ce véhicule est réceptionné sans rendez-vous planifié. Confirmez-vous cette réception exceptionnelle ?");
  }

  if (action === "supplement") {
    if (item.flags.received && !item.flags.workStarted) warnings.push("Le véhicule est réceptionné mais les travaux ne sont pas démarrés. Confirmer l'ajout du complément ?");
  }

  return warnings;
}

function hasVehicleIdentity(item) {
  return Boolean(String(item.plate || "").trim() || String(item.vin || "").trim());
}

function missingSchedulingRoles(item) {
  const templates = item
    ? STEP_TEMPLATES.filter((template) => Number(item.durations?.[template.key] || 0) > 0)
    : STEP_TEMPLATES;
  const roles = [...new Set(templates.flatMap((template) => [template.role, template.equipmentRole].filter(Boolean)))];
  return roles
    .filter((role) => !state.resources.some((resource) => resource.role === role && resource.active !== false))
    .map((role) => ROLE_LABELS[role] || role);
}

function renderPhotos(root, item) {
  const photos = $("[data-field='photos']", root);
  photos.innerHTML = item.photos.length
    ? item.photos
        .map(
          (photo, index) => `
            <figure class="photo-tile" data-open-photo="${index}" title="Cliquer pour agrandir la photo">
              <img data-photo-img="${escapeAttr(photo.id)}" alt="${escapeHtml(photo.name)}" />
              <figcaption>${escapeHtml(getPhotoCategoryLabel(photo.category))}</figcaption>
              <button type="button" title="Supprimer la photo" aria-label="Supprimer la photo" data-remove-photo="${index}">×</button>
            </figure>
          `,
        )
        .join("")
    : `<div class="empty-inline">Aucune photo ajoutée.</div>`;
  $$("[data-open-photo]", photos).forEach((tile) => {
    tile.addEventListener("click", (event) => {
      if (event.target.closest("button")) return;
      openPhotoPreview(item, Number(tile.dataset.openPhoto));
    });
  });
  $$("[data-remove-photo]", photos).forEach((button) => {
    button.addEventListener("click", async () => {
      const [removed] = item.photos.splice(Number(button.dataset.removePhoto), 1);
      if (removed?.id) {
        await deletePhotoRecord(removed.id);
        revokePhotoUrl(removed.id);
      }
      if (removed) addHistory(item, "photo.removed", `Photo supprimée: ${removed.name || "Photo"}`);
      saveState();
      renderCaseDetail();
    });
  });
  hydratePhotoImages(photos, item);
}

async function openPhotoPreview(item, index) {
  const photo = item.photos?.[index];
  if (!photo?.id) return;
  let record = null;
  try {
    record = await getPhotoRecord(photo.id);
  } catch (error) {
    console.error("Prévisualisation photo impossible", error);
  }
  if (!record?.blob) {
    notifyUser("Photo indisponible dans le stockage local.", "error");
    return;
  }
  const url = URL.createObjectURL(record.blob);
  const modal = document.createElement("div");
  modal.className = "photo-preview-modal";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.innerHTML = `
    <div class="photo-preview-dialog">
      <div class="photo-preview-header">
        <span>${escapeHtml(getPhotoCategoryLabel(photo.category))} · ${escapeHtml(photo.name || "Photo")}</span>
        <button type="button" aria-label="Fermer la photo" data-close-photo-preview>×</button>
      </div>
      <img src="${url}" alt="${escapeAttr(photo.name || "Photo dossier")}" />
    </div>
  `;
  const close = () => {
    URL.revokeObjectURL(url);
    modal.remove();
    document.removeEventListener("keydown", onKeyDown);
  };
  const onKeyDown = (event) => {
    if (event.key === "Escape") close();
  };
  modal.addEventListener("click", (event) => {
    if (event.target === modal || event.target.closest("[data-close-photo-preview]")) close();
  });
  document.addEventListener("keydown", onKeyDown);
  document.body.appendChild(modal);
}

function getAssignedResourceNamesForStep(item, key) {
  const humanRoles = new Set(["tolier", "mecanicien", "electricien", "peintre", "controle"]);
  const names = [];
  state.bookings
    .filter((booking) => booking.caseId === item.id && booking.key === key)
    .forEach((booking) => {
      (booking.resourceIds || []).forEach((resourceId) => {
        const resource = state.resources.find((candidate) => candidate.id === resourceId);
        if (!resource || !humanRoles.has(resource.role)) return;
        if (!names.includes(resource.name)) names.push(resource.name);
      });
    });
  return names.length ? names.join(", ") : "Non planifié";
}

function getStepServiceTypeValue(item, key) {
  item.stepServiceTypes = normalizeStepServiceTypes(item.stepServiceTypes);
  return item.stepServiceTypes[key] || "auto";
}


function getSelectableTechniciansForStep(key, item) {
  const baseTemplate = getBaseStepTemplate(key);
  if (!baseTemplate) return [];
  const template = getPlanningTemplateForItem(item, baseTemplate);
  return state.resources
    .filter((resource) => resource.active !== false && resource.role === template.role && !isEquipmentResource(resource))
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
}

function getPreferredTechnicianForStep(item, key) {
  item.stepPreferredResources = normalizeStepPreferredResources(item.stepPreferredResources);
  const selected = item.stepPreferredResources[key] || '';
  const options = getSelectableTechniciansForStep(key, item);
  return options.some((resource) => resource.id === selected) ? selected : '';
}

function getBaseStepTemplate(key) {
  return STEP_TEMPLATES.find((template) => template.key === key) || null;
}

function getServiceResourceHelp(type) {
  const config = SERVICE_TYPE_CONFIG[type] || SERVICE_TYPE_CONFIG.auto;
  if (!config || type === "auto") return "Selon l’étape";
  const roleLabel = ROLE_LABELS[config.role] || config.label;
  const equipmentLabel = config.equipmentRole ? ` + ${ROLE_LABELS[config.equipmentRole] || config.equipmentRole}` : "";
  return `${roleLabel}${equipmentLabel}`;
}

function getAutoServiceHelp(key) {
  const template = getBaseStepTemplate(key);
  if (!template) return "Métier automatique";
  const roleLabel = ROLE_LABELS[template.role] || template.role || "Ressource";
  const equipmentLabel = template.equipmentRole ? ` + ${ROLE_LABELS[template.equipmentRole] || template.equipmentRole}` : "";
  return `${roleLabel}${equipmentLabel}`;
}

function getEffectiveServiceHelp(item, key) {
  const currentType = getStepServiceTypeValue(item, key);
  return currentType === "auto" ? getAutoServiceHelp(key) : getServiceResourceHelp(currentType);
}

function getStepPlanningHint(key) {
  const hints = {
    body: "Travaux tôlerie/carrosserie avant peinture : démontage, dressage, tôlerie.",
    oilService: "Service rapide : mécanicien + pont vidange.",
    mechanical: "Réparation mécanique : mécanicien + pont mécanique. Modifiable vers électrique si besoin.",
    electrical: "Diagnostic / électricité : électricien, faisceau, airbags, batterie, haute tension.",
    prep: "Préparation avant peinture : peintre + zone de préparation.",
    paint: "Peinture et vernis : peintre + cabine peinture.",
    reassembly: "Remontage après peinture : tôlier par défaut, modifiable selon l’opération.",
    finish: "Finition/lavage : uniquement quand le flux SAV l’exige.",
    quality: "Contrôle final : chef atelier / contrôle qualité.",
  };
  return hints[key] || "Étape atelier";
}


function getImportedLaborReviewRows(item) {
  const rows = [];
  (item.claims || []).forEach((claim) => {
    const claimLabel = `${claim.number || ''} ${claim.title || 'Ordre'}`.trim();
    const sourceLines = (claim.estimate?.originalLines || []).length ? claim.estimate.originalLines : (claim.estimate?.lines || []);
    sourceLines.forEach((line) => {
      const allocations = Array.isArray(line.allocations) && line.allocations.length
        ? line.allocations
        : (line.phase ? [{ phase: line.phase, operation: line.operation || line.rawText || '', laborHours: line.laborHours || 0 }] : []);
      const nonZeroAllocations = allocations
        .map((allocation) => ({
          phase: allocation.phase,
          laborHours: Number(allocation.laborHours || 0),
        }))
        .filter((allocation) => allocation.phase && allocation.laborHours > 0);
      const laborHours = Number(line.laborHours || nonZeroAllocations.reduce((sum, allocation) => sum + allocation.laborHours, 0) || 0);
      if (!laborHours && !nonZeroAllocations.length) return;
      rows.push({
        claimLabel,
        operation: line.operation || line.rawText || 'Opération devis',
        laborHours,
        allocations: nonZeroAllocations,
      });
    });
  });
  return rows;
}

function buildImportedLaborAllocationSummary(row) {
  if (!row.allocations.length) return '<span class="labor-allocation-empty">Aucune étape affectée</span>';
  return row.allocations.map((allocation) => `
    <span class="labor-allocation-pill">
      ${escapeHtml(getDurationLabel(allocation.phase) || allocation.phase)}
      <strong>${formatLocalizedDecimal(allocation.laborHours)} h</strong>
    </span>
  `).join('');
}


function getValidatedAppointmentRows(item) {
  return state.bookings
    .filter((booking) => booking.caseId === item.id && booking.temporary !== true)
    .slice()
    .sort((a, b) => new Date(a.start) - new Date(b.start))
    .map((booking) => {
      const humanResources = booking.resourceIds
        .map((id) => getResource(id))
        .filter((resource) => resource && !isEquipmentResource(resource));
      const equipmentResources = booking.resourceIds
        .map((id) => getResource(id))
        .filter((resource) => resource && isEquipmentResource(resource));
      return {
        id: booking.id,
        key: booking.key,
        title: booking.planningMode === "anticipated-new-part" ? (booking.title || "Préparation anticipée pièces neuves") : (getDurationLabel(booking.key) || booking.title || "Étape planning"),
        planningMode: booking.planningMode || "standard",
        details: booking.details || "",
        start: booking.start,
        end: booking.end,
        status: getBookingOperationalStatus(booking),
        statusLabel: getBookingStatusLabel(booking),
        pauseReason: booking.pauseReason || "",
        remainingFromPaused: Boolean(booking.remainingFromPaused),
        actualStart: booking.actualStart || booking.startedAt || "",
        actualEnd: booking.actualEnd || booking.completedAt || "",
        human: humanResources.map((resource) => resource.name).filter(Boolean).join(", ") || "Non affecté",
        equipment: equipmentResources.map((resource) => resource.name).filter(Boolean).join(", "),
        minutes: Math.max(0, diffMinutes(new Date(booking.start), new Date(booking.end))),
      };
    });
}

function renderValidatedAppointmentPlan(root, item) {
  const durationGrid = $(`[data-field='durations']`, root);
  if (!durationGrid) return;
  let panel = $(`[data-field='validated-appointment-plan']`, root);
  if (!panel) {
    panel = document.createElement('div');
    panel.className = 'validated-appointment-plan';
    panel.dataset.field = 'validated-appointment-plan';
    durationGrid.parentNode.insertBefore(panel, durationGrid.nextSibling);
  }
  const rows = getValidatedAppointmentRows(item);
  if (!item.appointment || !rows.length) {
    panel.innerHTML = `
      <div class="validated-plan-head muted-plan">
        <div>
          <h3>Planning du rendez-vous validé</h3>
          <p>Aucun rendez-vous validé. Calculez puis choisissez un RDV pour afficher ici le planning réservé.</p>
        </div>
      </div>
    `;
    return;
  }
  const totalMinutes = rows.reduce((sum, row) => sum + row.minutes, 0);
  panel.innerHTML = `
    <div class="validated-plan-head">
      <div>
        <h3>Planning du rendez-vous validé</h3>
        <p>Créneaux réellement réservés dans l’atelier pour ce dossier.</p>
      </div>
      <div class="validated-plan-summary">
        <strong>RDV ${formatDateTime(item.appointment.start)}</strong>
        <span>Livraison estimée ${formatDateTime(item.appointment.delivery)}</span>
      </div>
    </div>
      <div class="validated-plan-table">
        <div class="validated-plan-row header">
          <span>Étape</span>
          <span>Date</span>
          <span>Horaire</span>
          <span>Technicien</span>
          <span>Matériel</span>
          <span>Durée</span>
          <span>Action</span>
        </div>
        ${rows.map((row) => {
          const start = new Date(row.start);
          const end = new Date(row.end);
          return `
          <div class="validated-plan-row ${row.planningMode === "anticipated-new-part" ? "anticipated-new-part-row" : ""} task-status-${escapeAttr(row.status)}">
            <strong>
              ${escapeHtml(row.title)}
              ${row.planningMode === "anticipated-new-part" ? '<small class="anticipated-new-part-badge">Pièce neuve préparée en parallèle</small>' : ''}
              ${row.remainingFromPaused ? '<small class="task-remainder-badge">Reliquat</small>' : ''}
              <small class="task-status-pill">${escapeHtml(row.statusLabel)}</small>
              ${row.details ? `<em>${escapeHtml(row.details)}</em>` : ''}
              ${row.pauseReason ? `<em>Cause pause: ${escapeHtml(row.pauseReason)}</em>` : ''}
            </strong>
            <span>${formatDate(row.start)}</span>
            <span>${formatTime(start)} → ${formatTime(end)}</span>
            <span>${escapeHtml(row.human)}</span>
            <span>${escapeHtml(row.equipment || '-')}</span>
            <b>${formatLocalizedDecimal(row.minutes / 60)} h</b>
            <span class="validated-plan-actions">${renderBookingTaskActions(row)}</span>
          </div>
        `;
        }).join('')}
      </div>
    <div class="validated-plan-footer">
      <span>Total réservé : <strong>${formatLocalizedDecimal(totalMinutes / 60)} h</strong></span>
      <span>Marge atelier : <strong>${formatLocalizedDecimal((item.appointment.marginMinutes || 0) / 60)} h</strong></span>
    </div>
  `;
  $$("[data-booking-action]", panel).forEach((button) => {
    button.addEventListener("click", () => handleBookingTaskAction(item, button.dataset.bookingAction, button.dataset.bookingId));
  });
}

function renderBookingTaskActionButton(row, permission, action, label, className) {
  const allowed = canRenderAction(permission, { booking: row });
  const title = allowed ? "" : getPermissionDeniedMessage(permission, { booking: row });
  return `<button type="button" class="${className}" data-allow-production-action data-booking-action="${escapeAttr(action)}" data-booking-id="${escapeAttr(row.id)}" ${allowed ? "" : `disabled title="${escapeAttr(title)}" aria-label="${escapeAttr(`${label} indisponible : ${title}`)}"`}>${escapeHtml(label)}</button>`;
}

function renderBookingTaskActions(row) {
  if (row.status === "completed") return '<span class="muted">Clôturée</span>';
  if (row.status === "paused") return '<span class="muted">Reliquat planifié</span>';
  if (row.status === "started") {
    return `
      ${renderBookingTaskActionButton(row, "task.pause", "pause", "Pause", "ghost-button tiny-button")}
      ${renderBookingTaskActionButton(row, "task.complete", "complete", "Terminer", "primary-button tiny-button")}
    `;
  }
  return `
    ${renderBookingTaskActionButton(row, "planning.edit", "reschedule", "Replanifier", "ghost-button tiny-button")}
    ${renderBookingTaskActionButton(row, "task.start", "start", "Démarrer", "primary-button tiny-button")}
  `;
}

function formatDateTimeLocalInputValue(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const BOOKING_ACTION_OVERRIDE_LABELS = {
  start: "Démarrage tâche",
  pause: "Pause tâche",
  complete: "Fin tâche",
};

function getCaseIncompleteTechnicianBookings(item) {
  return getCaseProductionBookings(item)
    .filter((booking) => getBookingOperationalStatus(booking) !== "completed")
    .filter((booking) => getBookingHumanResourceIds(booking).length > 0);
}

async function completeCaseWorkWithChiefOverride(item, options = {}) {
  const technicianBookings = getCaseIncompleteTechnicianBookings(item);
  if (!technicianBookings.length) {
    const result = completeCaseWorkBookingsNow(item, new Date(), {
      completedByOverride: options.completedByOverride || "",
      actorLabel: options.actorLabel || "",
      overrideReason: options.overrideReason || "",
    });
    return { ok: true, message: "Travaux terminés.", ...result };
  }
  if (options.allowOverride === false) {
    return {
      ok: false,
      message: "Terminez les tâches affectées depuis la vue Technicien, ou utilisez un override chef atelier avec motif.",
    };
  }
  const overrideGuard = guardAction("task.override", { booking: technicianBookings[0] }, { notify: false });
  if (!overrideGuard.ok) return { ok: false, message: overrideGuard.message };
  const confirmed = options.overrideConfirmed === true
    ? true
    : await showConfirmModal(
      `<strong>Clôture globale des travaux.</strong><br>${technicianBookings.length} tâche(s) affectée(s) à un technicien ne sont pas terminées individuellement.<br><br>Utiliser un override chef atelier ?`
    );
  if (!confirmed) return { ok: false, cancelled: true, message: "Clôture globale annulée." };
  const reasonFromOptions = String(options.overrideReason || "").trim();
  const promptFn = typeof window.prompt === "function" ? window.prompt.bind(window) : null;
  const reason = reasonFromOptions || (promptFn ? String(promptFn("Motif obligatoire de l'override chef atelier :") || "").trim() : "");
  if (!reason) return { ok: false, message: "Motif override chef atelier obligatoire." };
  const result = completeCaseWorkBookingsNow(item, new Date(), {
    completedByOverride: options.completedByOverride || "chef-atelier",
    actorLabel: "Override chef atelier",
    overrideReason: reason,
    keepEmptyBookings: true,
  });
  addHistory(
    item,
    "planning.work.completed.override",
    "Travaux clôturés par override chef atelier",
    `${technicianBookings.length} tâche(s) affectée(s) clôturée(s) globalement. Motif: ${reason}.`
  );
  return { ok: true, message: "Travaux clôturés avec override chef atelier.", ...result };
}

function getBookingTaskById(item, bookingId) {
  return state.bookings.find((candidate) => candidate.id === bookingId && candidate.caseId === item?.id) || null;
}

function resolveBookingActionTechnicianId(booking, action, options = {}) {
  if (options.technicianId) return options.technicianId;
  if (!booking) return "";
  if (action === "complete") return booking.completedBy || booking.startedBy || booking.resumedBy || getBookingPrimaryTechnicianId(booking);
  if (action === "pause") return booking.startedBy || booking.resumedBy || getBookingPrimaryTechnicianId(booking);
  return getBookingPrimaryTechnicianId(booking);
}

function getBookingActionRequiresTechnicianMessage(action) {
  const label = BOOKING_ACTION_OVERRIDE_LABELS[action] || "Action tâche";
  return `${label} à effectuer depuis la vue Technicien, sauf override chef atelier : aucun technicien humain valide n'est identifié pour cette tâche.`;
}

function recordWorkshopChiefOverride(item, booking, action, reason) {
  const label = BOOKING_ACTION_OVERRIDE_LABELS[action] || "Action tâche";
  addHistory(
    item,
    "planning.task.override",
    "Override chef atelier",
    `${label} appliqué sur ${booking?.title || getDurationLabel(booking?.key) || "tâche atelier"} (${booking?.id || "booking inconnu"}). Motif: ${reason}.`
  );
}

function runWorkshopChiefOverride(item, booking, action, reason, options = {}) {
  const cleanReason = String(reason || "").trim();
  if (!cleanReason) return { ok: false, message: "Motif override chef atelier obligatoire." };
  const overrideGuard = guardAction("task.override", { booking }, { notify: false });
  if (!overrideGuard.ok) return { ok: false, message: overrideGuard.message };
  const actor = getCurrentActor();
  const actorId = actor.resourceId || actor.userId || options.technicianId || resolveBookingActionTechnicianId(booking, action, options) || "chef-atelier";
  const actorLabel = "Override chef atelier";
  let result = null;
  if (action === "start") {
    result = startCaseBookingTask(item, booking.id, { startedBy: actorId, actorLabel });
  } else if (action === "pause") {
    result = pauseCaseBookingTask(item, booking.id, options.pauseReason || reason, { pausedBy: actorId, actorLabel });
  } else if (action === "complete") {
    result = completeCaseBookingTaskNow(item, booking.id, new Date(), { completedBy: actorId, actorLabel, note: options.note || "" });
  }
  if (result?.ok) recordWorkshopChiefOverride(item, booking, action, cleanReason);
  return result || { ok: false, message: "Override chef atelier impossible pour cette action." };
}

async function requestWorkshopChiefOverride(item, booking, action, failedResult, options = {}) {
  if (options.allowOverride === false) return failedResult;
  const overrideGuard = guardAction("task.override", { booking }, { notify: false });
  if (!overrideGuard.ok) return { ok: false, message: overrideGuard.message };
  const reasonFromOptions = String(options.overrideReason || "").trim();
  let confirmed = options.overrideConfirmed === true;
  if (!confirmed) {
    confirmed = await showConfirmModal(
      `<strong>Action bloquée par les règles technicien.</strong><br>${escapeHtml(failedResult?.message || "Action impossible.")}<br><br>Utiliser un override chef atelier ?`
    );
  }
  if (!confirmed) return { ok: false, cancelled: true, message: "Action annulée." };
  const promptFn = typeof window.prompt === "function" ? window.prompt.bind(window) : null;
  const reason = reasonFromOptions || (promptFn ? String(promptFn("Motif obligatoire de l'override chef atelier :") || "").trim() : "");
  if (!reason) return { ok: false, message: "Motif override chef atelier obligatoire." };
  return runWorkshopChiefOverride(item, booking, action, reason, options);
}

async function runSecuredBookingTaskAction(item, action, bookingId, options = {}) {
  const booking = getBookingTaskById(item, bookingId);
  if (!booking) return { ok: false, message: "Tâche introuvable dans le planning." };
  const technicianId = resolveBookingActionTechnicianId(booking, action, options);
  if (!technicianId) {
    return requestWorkshopChiefOverride(
      item,
      booking,
      action,
      { ok: false, message: getBookingActionRequiresTechnicianMessage(action) },
      options
    );
  }

  let result = null;
  if (action === "start") {
    result = startTechnicianTask(item, bookingId, technicianId);
  } else if (action === "pause") {
    result = pauseTechnicianTask(item, bookingId, technicianId, options.pauseReason);
  } else if (action === "complete") {
    result = completeTechnicianTask(item, bookingId, technicianId, { note: options.note || "", skipPhotoCheck: false });
  }
  if (!result) return { ok: false, message: "Action tâche inconnue." };
  if (!result.ok) return requestWorkshopChiefOverride(item, booking, action, result, options);
  return result;
}

async function handleBookingTaskAction(item, action, bookingId, options = {}) {
  try {
    let result = null;
    if (action === "start") {
      result = await runSecuredBookingTaskAction(item, action, bookingId, options);
    } else if (action === "complete") {
      if (!options.skipConfirmation) {
        const confirmed = await showConfirmModal("Terminer cette tâche maintenant et libérer le temps restant dans le planning ?");
        if (!confirmed) return { ok: false, cancelled: true, message: "Action annulée." };
      }
      const note = options.note !== undefined ? options.note : "";
      result = await runSecuredBookingTaskAction(item, action, bookingId, { ...options, note });
    } else if (action === "pause") {
      const reason = options.pauseReason !== undefined ? options.pauseReason : window.prompt("Cause de pause / report du reliquat :");
      if (reason === null) return;
      result = await runSecuredBookingTaskAction(item, action, bookingId, { ...options, pauseReason: reason });
    } else if (action === "reschedule") {
      const booking = state.bookings.find((candidate) => candidate.id === bookingId && candidate.caseId === item.id);
      const defaultValue = formatDateTimeLocalInputValue(booking?.start || new Date());
      const requested = window.prompt("Nouvelle date et heure souhaitées (format AAAA-MM-JJTHH:MM). L'application prendra le premier créneau disponible à partir de cette date.", defaultValue);
      if (requested === null) return;
      result = rescheduleCaseBooking(item, bookingId, requested);
    }
    if (!result) return;
    if (!options.silent) notifyUser(result.message, result.ok ? "success" : "info");
    if (result.ok) {
      if (options.persist !== false) saveState({ flushCloud: true, cloudReason: `booking-${action}` });
      if (!options.skipRender) render();
    }
    return result;
  } catch (error) {
    notifyUser(error.message || "Action planning impossible.", "error");
    return { ok: false, message: error.message || "Action planning impossible." };
  }
}

function renderImportedLaborReview(root, item) {
  const durationGrid = $("[data-field='durations']", root);
  if (!durationGrid) return;
  let panel = $("[data-field='imported-labor-review']", root);
  if (!panel) {
    panel = document.createElement('div');
    panel.className = 'imported-labor-review';
    panel.dataset.field = 'imported-labor-review';
    durationGrid.parentNode.insertBefore(panel, durationGrid);
  }
  const rows = getImportedLaborReviewRows(item);
  if (!rows.length) {
    panel.innerHTML = `
      <div class="imported-labor-head">
        <div>
          <h3>Main-d’œuvre importée du devis</h3>
          <p>Aucune ligne MO importée. Importez le devis dans Ordres & devis ou saisissez les durées manuellement.</p>
        </div>
      </div>
    `;
    return;
  }
  const total = rows.reduce((sum, row) => sum + Number(row.laborHours || 0), 0);
  panel.innerHTML = `
    <div class="imported-labor-head">
      <div>
        <h3>Main-d’œuvre importée du devis</h3>
        <p>Contrôle rapide pour ne rien oublier avant de calculer le planning. Rappel pièces : vérifiez chaque ligne avant RDV, car une pièce neuve/remplacée peut nécessiter peinture deux côtés, alors qu'une pièce réparée/dressée reste généralement extérieur seulement.</p>
      </div>
      <strong>${formatLocalizedDecimal(total)} h MO devis</strong>
    </div>
    <div class="imported-labor-list">
      ${rows.map((row, index) => `
        <article class="imported-labor-row">
          <div class="imported-labor-main">
            <span class="labor-row-index">${index + 1}</span>
            <div>
              <strong>${escapeHtml(row.operation)}</strong>
              <small>${escapeHtml(row.claimLabel || 'Ordre')}</small>
            </div>
            <b>${formatLocalizedDecimal(row.laborHours)} h</b>
          </div>
          <div class="labor-allocation-summary">${buildImportedLaborAllocationSummary(row)}</div>
        </article>
      `).join('')}
    </div>
  `;
}

function renderDurations(root, item) {
  renderImportedLaborReview(root, item);
  renderValidatedAppointmentPlan(root, item);
  const durationGrid = $("[data-field='durations']", root);
  item.stepServiceTypes = normalizeStepServiceTypes(item.stepServiceTypes);
  item.stepPreferredResources = normalizeStepPreferredResources(item.stepPreferredResources);
  const canEditPlanning = canRenderAction("planning.edit");
  const planningEditTitle = canEditPlanning ? "" : getPermissionDeniedMessage("planning.edit");
  const activeCount = DURATIONS.filter(([key]) => Number(item.durations[key] ?? DEFAULT_DURATIONS[key]) > 0).length;
  durationGrid.innerHTML = `
    <div class="duration-edit-guide">
      <div>
        <strong>Étapes à modifier</strong>
        <p>Les cartes encadrées sont les étapes actives du devis. Modifiez le service seulement si l’opération doit être confiée à un autre métier.</p>
      </div>
      <span>${activeCount} étape${activeCount > 1 ? "s" : ""} active${activeCount > 1 ? "s" : ""}</span>
    </div>
    ${DURATIONS.map(([key, label], index) => {
    const value = Number(item.durations[key] ?? DEFAULT_DURATIONS[key]);
    const assignedNames = getAssignedResourceNamesForStep(item, key);
    const currentType = getStepServiceTypeValue(item, key);
    const canChangeType = !["quality", "oilService"].includes(key);
    const effectiveHelp = getEffectiveServiceHelp(item, key);
    const autoHelp = getAutoServiceHelp(key);
    const technicianOptions = getSelectableTechniciansForStep(key, item);
    const preferredTechnicianId = getPreferredTechnicianForStep(item, key);
    const isActive = value > 0;
    const activeClass = isActive ? "has-duration" : "is-empty";
    const statusLabel = isActive ? "Étape active" : "Non utilisé";
    const technicianControl = !isActive
      ? ""
      : technicianOptions.length
        ? `<label class="technician-override-field"><span>Technicien à réserver</span><small>${canEditPlanning ? "Choisissez avant de calculer le RDV. Vérifiez aussi l'état des pièces ci-dessus : neuve/remplacée ou réparée." : planningEditTitle}</small><select data-preferred-technician="${key}" ${canEditPlanning ? "" : `disabled title="${escapeAttr(planningEditTitle)}"`}><option value="">Auto - meilleur disponible</option>${technicianOptions.map((resource) => `<option value="${resource.id}" ${resource.id === preferredTechnicianId ? "selected" : ""}>${escapeHtml(resource.name)}${resource.location ? ` - ${escapeHtml(resource.location)}` : ""}</option>`).join("")}</select></label>`
        : `<div class="service-inactive-note">Aucun technicien actif disponible pour ce métier.</div>`;
    const serviceControl = !isActive
      ? `<div class="service-inactive-note">Ajoutez un temps atelier pour activer cette étape.</div>`
      : canChangeType
        ? `<label class="service-override-field"><span>Service à réserver dans le planning</span><small>${canEditPlanning ? "Gardez Auto sauf si cette opération doit changer de métier." : planningEditTitle}</small><select data-service-type="${key}" ${canEditPlanning ? "" : `disabled title="${escapeAttr(planningEditTitle)}"`}>${SERVICE_TYPE_OPTIONS.map(([type, text]) => {
            const helper = type === "auto" ? `Auto recommandé - ${autoHelp}` : `${text} - ${getServiceResourceHelp(type)}`;
            return `<option value="${type}" ${type === currentType ? "selected" : ""}>${helper}</option>`;
          }).join("")}</select></label>`
        : `<div class="service-locked-note">Service fixe : <strong>${effectiveHelp}</strong></div>`;
    return `
      <article class="duration-assignment-card ${activeClass}">
        <div class="duration-card-head">
          <span class="step-index">${index + 1}</span>
          <div>
            <div class="duration-title-row">
              <strong class="duration-assignment-title">${label}</strong>
              <span class="duration-status-badge">${statusLabel}</span>
            </div>
            <span class="duration-hint">${getStepPlanningHint(key)}</span>
          </div>
        </div>
        <div class="duration-card-body">
          <label class="duration-hours-field"><span>${isActive ? "Temps réservé dans cette étape" : "Temps atelier"}</span><input type="text" inputmode="decimal" data-duration="${key}" value="${formatLocalizedDecimal(value)}" placeholder="Ex. 1,5" /></label>
          <div class="duration-meta-grid">
            <span class="meta-pill primary-meta">Métier planning<br><strong>${effectiveHelp}</strong></span>
            <span class="meta-pill">Technicien<br><strong>${assignedNames}</strong></span>
          </div>
          ${technicianControl}
          ${serviceControl}
        </div>
      </article>
    `;
  }).join("")}
  `;
  $("[data-field='total-duration']", root).textContent = `${sumDurations(item)} h`;
  $$("[data-duration]", durationGrid).forEach((input) => {
    input.dataset.previousDuration = String(item.durations[input.dataset.duration] || 0);
    input.addEventListener("input", () => {
      const parsed = parseLocalizedDecimal(input.value);
      item.durations[input.dataset.duration] = parsed || 0;
      generatedProposals[item.id] = null;
      saveState();
      $("[data-field='total-duration']", root).textContent = `${sumDurations(item)} h`;
      refreshCaseActionAvailability(root, item);
    });
    input.addEventListener("blur", () => {
      const previous = Number(input.dataset.previousDuration || 0);
      const current = Number(item.durations[input.dataset.duration] || 0);
      input.value = formatLocalizedDecimal(current);
      if (previous !== current) {
        clearPlanningIfNeeded(item, 'Planning annulé après modification des durées atelier. Recalculez un RDV.');
        saveState();
        renderCases();
        renderPlanning();
        renderMetrics();
      }
      input.dataset.previousDuration = String(current);
    });
  });
  $$('[data-preferred-technician]', durationGrid).forEach((select) => {
    select.dataset.previousPreferredTechnician = getPreferredTechnicianForStep(item, select.dataset.preferredTechnician);
    select.addEventListener('change', () => {
      const permission = guardAction("planning.edit", {}, { notify: false });
      if (!permission.ok) {
        notifyUser(permission.message, "error");
        select.value = select.dataset.previousPreferredTechnician || "";
        return;
      }
      const key = select.dataset.preferredTechnician;
      const previous = select.dataset.previousPreferredTechnician || '';
      const next = select.value || '';
      if (previous === next) return;
      item.stepPreferredResources = normalizeStepPreferredResources(item.stepPreferredResources);
      item.stepPreferredResources[key] = next;
      generatedProposals[item.id] = null;
      clearPlanningIfNeeded(item, 'Planning annulé après changement de technicien. Recalculez un RDV.');
      saveState();
      renderCases();
      renderPlanning();
      renderMetrics();
    });
  });
  $$("[data-service-type]", durationGrid).forEach((select) => {
    select.dataset.previousServiceType = getStepServiceTypeValue(item, select.dataset.serviceType);
    select.addEventListener("change", () => {
      const permission = guardAction("planning.edit", {}, { notify: false });
      if (!permission.ok) {
        notifyUser(permission.message, "error");
        select.value = select.dataset.previousServiceType || "auto";
        return;
      }
      const key = select.dataset.serviceType;
      const previous = select.dataset.previousServiceType || "auto";
      const next = select.value || "auto";
      if (previous === next) return;
      item.stepServiceTypes = normalizeStepServiceTypes(item.stepServiceTypes);
      item.stepServiceTypes[key] = next;
      generatedProposals[item.id] = null;
      clearPlanningIfNeeded(item, 'Planning annulé après modification du type de service. Recalculez un RDV.');
      saveState();
      renderCases();
      renderPlanning();
      renderMetrics();
    });
  });
}

function renderExpertEstimate(root, item) {
  const target = $("[data-field='expert-estimate']", root);
  if (!target) return;
  item.expertEstimate = normalizeExpertEstimate(item.expertEstimate);
  const estimate = item.expertEstimate;
  const total = expertEstimateTotalHours(item);
  const totalTarget = $("[data-field='expert-estimate-total']", root);
  if (totalTarget) {
    totalTarget.innerHTML = total > 0
      ? `Total MO: <strong>${formatLocalizedDecimal(total)} h</strong>`
      : "Aucune MO saisie";
  }
  const phaseOptions = DURATIONS.map(
    ([key, label]) => `<option value="${key}">${escapeHtml(label)}</option>`,
  ).join("");
  const rows = estimate.lines.length
    ? estimate.lines
        .map(
          (line) => `
            <article class="estimate-line-card">
              <div>
                <strong>${escapeHtml(getDurationLabel(line.phase))}</strong>
                <span>${escapeHtml(line.operation || "Opération sans libellé")}</span>
              </div>
              <span class="tag">${formatLocalizedDecimal(line.laborHours)} h MO</span>
              <button class="icon-button" type="button" title="Supprimer la ligne MO" aria-label="Supprimer la ligne MO" data-remove-estimate-line="${escapeAttr(line.id)}">×</button>
            </article>
          `,
        )
        .join("")
    : `<div class="empty-inline">Ajoutez les lignes MO du devis expert confirmé.</div>`;

  target.innerHTML = `
    <div class="expert-estimate-head">
      <label>
        Référence devis expert
        <input type="text" data-estimate-reference value="${escapeAttr(estimate.reference)}" placeholder="Ex. DEV-EXPERT-2026-001" />
      </label>
      <div class="expert-estimate-status">
        <span class="tag ${estimate.confirmed ? "ok" : "warn"}">
          ${estimate.confirmed ? `Confirmé le ${formatDate(estimate.confirmedAt || new Date())}` : "En attente confirmation"}
        </span>
        <button class="primary-button" type="button" data-confirm-expert-estimate ${total <= 0 ? "disabled" : ""}>
          Confirmer devis expert
        </button>
      </div>
    </div>
    <form class="expert-estimate-form" data-estimate-line-form>
      <label>
        Étape planning
        <select data-estimate-phase>${phaseOptions}</select>
      </label>
      <label>
        Opération
        <input type="text" data-estimate-operation placeholder="Ex. Remplacer aile avant droite" />
      </label>
      <label>
        Quantité MO
        <input type="text" inputmode="decimal" data-estimate-hours placeholder="Ex. 1,5" />
      </label>
      <button class="ghost-button" type="submit">Ajouter ligne MO</button>
    </form>
    <div class="expert-estimate-lines">${rows}</div>
    <div class="expert-estimate-footer">
      <span>Les quantités confirmées alimentent les durées de réservation atelier.</span>
      <button class="primary-button" type="button" data-apply-expert-estimate ${total <= 0 ? "disabled" : ""}>
        Utiliser pour le planning
      </button>
    </div>
  `;

  $("[data-estimate-reference]", target).addEventListener("input", (event) => {
    estimate.reference = event.target.value;
    saveState();
  });

  $("[data-estimate-line-form]", target).addEventListener("submit", (event) => {
    event.preventDefault();
    const phase = $("[data-estimate-phase]", target).value;
    const operation = $("[data-estimate-operation]", target).value.trim();
    const laborHours = parseLocalizedDecimal($("[data-estimate-hours]", target).value);
    if (laborHours <= 0) {
      notifyUser("Saisissez une quantité de main d'œuvre supérieure à 0.");
      return;
    }
    estimate.lines.push(normalizeExpertEstimateLine({ phase, operation, laborHours }));
    estimate.confirmed = false;
    estimate.confirmedAt = "";
    generatedProposals[item.id] = null;
    addHistory(item, "expert.estimate.line_added", "Ligne MO devis expert ajoutée", `${getDurationLabel(phase)}: ${formatLocalizedDecimal(laborHours)} h`);
    saveState();
    renderCaseDetail();
  });

  $$("[data-remove-estimate-line]", target).forEach((button) => {
    button.addEventListener("click", () => {
      const line = estimate.lines.find((itemLine) => itemLine.id === button.dataset.removeEstimateLine);
      estimate.lines = estimate.lines.filter((itemLine) => itemLine.id !== button.dataset.removeEstimateLine);
      estimate.confirmed = false;
      estimate.confirmedAt = "";
      generatedProposals[item.id] = null;
      if (line) addHistory(item, "expert.estimate.line_removed", "Ligne MO devis expert supprimée", line.operation || getDurationLabel(line.phase));
      saveState();
      renderCaseDetail();
    });
  });

  $("[data-confirm-expert-estimate]", target).addEventListener("click", () => {
    if (total <= 0) return;
    estimate.confirmed = true;
    estimate.confirmedAt = new Date().toISOString();
    addHistory(item, "expert.estimate.confirmed", "Devis de réparation expert confirmé", `Total MO: ${formatLocalizedDecimal(total)} h`);
    saveState();
    renderCaseDetail();
  });

  $("[data-apply-expert-estimate]", target).addEventListener("click", () => {
    applyExpertEstimateToDurations(item);
    saveState();
    renderCaseDetail();
  });
}

function renderEstimateImportPreview(root, item) {
  const target = $("[data-field='estimate-import-preview']", root);
  const status = $("[data-field='estimate-import-status']", root);
  if (!target) return;
  const preview = estimateImportPreviews[item.id];
  if (!preview) {
    target.innerHTML = "";
    if (status) status.textContent = "Aucun devis importé.";
    return;
  }

  preview.durations = normalizeEstimatePreviewDurations(preview.durations, item);
  const infoRows = [
    ["Client", preview.info.clientName],
    ["Téléphone", preview.info.phone],
    ["N° client", preview.info.clientNumber],
    ["N° devis", preview.info.estimateNumber],
    ["N° OR", preview.info.orNumber],
    ["Date devis", preview.info.estimateDate],
    ["Réceptionnaire", preview.info.receptionist],
    ["Véhicule", preview.info.vehicle],
    ["Kilométrage", preview.info.mileage],
    ["Immatriculation", preview.info.plate],
    ["VIN", preview.info.vin],
    ["Première immatriculation", preview.info.firstRegistration],
  ].filter(([, value]) => value);
  const detectedRows = preview.laborLines.slice(0, 30);
  const ignoredRows = preview.ignoredLines.slice(0, 20);
  const totalWithQuality = ESTIMATE_ALLOWED_KEYS.reduce((sum, key) => sum + Number(preview.durations[key] || 0), 0);

  if (status) {
    status.textContent = `Devis analysé. Vérifiez la répartition avant application.`;
  }
  target.innerHTML = `
    <div class="estimate-import-summary">
      <span class="tag ok">Devis importé avec succès</span>
      <span>Main-d'œuvre détectée : <strong>${formatLocalizedDecimal(preview.detectedHours)} h</strong></span>
      <span>Lignes ignorées : <strong>${preview.ignoredLines.length}</strong></span>
    </div>
    ${
      infoRows.length
        ? `<dl class="estimate-info-grid">
            ${infoRows.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}
          </dl>`
        : `<p class="muted">Aucune information générale détectée automatiquement.</p>`
    }
    <div class="estimate-import-grid">
      <section>
        <h3>Répartition proposée</h3>
        <div class="duration-grid compact-duration-grid">
          ${ESTIMATE_ALLOWED_KEYS.map(
            (key) => `
              <label>
                ${escapeHtml(getDurationLabel(key))}
                <input type="text" inputmode="decimal" data-estimate-import-duration="${key}" value="${formatLocalizedDecimal(preview.durations[key] || 0)}" />
              </label>
            `,
          ).join("")}
        </div>
        <p class="muted">Total atelier proposé : <strong data-field="estimate-import-total">${formatLocalizedDecimal(totalWithQuality)} h</strong></p>
      </section>
      <section>
        <h3>Lignes main-d'œuvre détectées</h3>
        <div class="estimate-import-lines">
          ${
            detectedRows.length
              ? detectedRows
                  .map(
                    (line) => `
                      <article>
                        <strong>${escapeHtml(line.operation)}</strong>
                        <span>${formatLocalizedDecimal(line.hours)} h détectée${line.distributions.length > 1 ? " · répartie" : ""}</span>
                      </article>
                    `,
                  )
                  .join("")
              : `<div class="empty-inline">Aucune ligne de main-d'œuvre détectée.</div>`
          }
        </div>
      </section>
    </div>
    <details class="ignored-lines">
      <summary>Lignes ignorées (${preview.ignoredLines.length})</summary>
      <div class="estimate-import-lines">
        ${
          ignoredRows.length
            ? ignoredRows.map((line) => `<article><strong>${escapeHtml(line.reason)}</strong><span>${escapeHtml(line.text)}</span></article>`).join("")
            : `<p class="muted">Aucune ligne ignorée significative.</p>`
        }
      </div>
    </details>
    <div class="estimate-import-actions">
      <button class="primary-button" type="button" data-apply-estimate-import>Appliquer aux durées</button>
      <button class="ghost-button" type="button" data-cancel-estimate-import>Annuler</button>
    </div>
  `;

  $$("[data-estimate-import-duration]", target).forEach((input) => {
    input.addEventListener("input", () => {
      const key = input.dataset.estimateImportDuration;
      preview.durations[key] = roundPlanningHours(parseEstimateNumber(input.value));
      const totalTarget = $("[data-field='estimate-import-total']", target);
      if (totalTarget) {
        const total = ESTIMATE_ALLOWED_KEYS.reduce((sum, phase) => sum + Number(preview.durations[phase] || 0), 0);
        totalTarget.textContent = `${formatLocalizedDecimal(total)} h`;
      }
    });
    input.addEventListener("blur", () => {
      input.value = formatLocalizedDecimal(preview.durations[input.dataset.estimateImportDuration] || 0);
    });
  });

  $("[data-apply-estimate-import]", target).addEventListener("click", () => applyEstimateImportToCase(item, preview));
  $("[data-cancel-estimate-import]", target).addEventListener("click", () => {
    delete estimateImportPreviews[item.id];
    renderEstimateImportPreview(root, item);
  });
}

function renderProposals(root, item) {
  const target = $("[data-field='proposals']", root);
  const appointmentOptions = normalizeAppointmentOptions(generatedProposals[item.id]);
  if (!appointmentOptions) {
    target.innerHTML = `<div class="empty-inline">Cliquez sur Calculer RDV pour obtenir le premier créneau disponible.</div>`;
    return;
  }
  if (appointmentOptions.error) {
    target.innerHTML = `<div class="empty-inline">${escapeHtml(appointmentOptions.error)}</div>`;
    return;
  }
  const proposal = appointmentOptions.proposal;
  const availableDates = appointmentOptions.availableDates || [];
  target.innerHTML = `
    <article class="proposal-card main-proposal">
      <div>
        <span class="tag ok">Premier RDV disponible</span>
        <strong>RDV ${formatDateTime(proposal.start)}</strong>
        <p class="muted">Livraison estimée ${formatDateTime(proposal.delivery)}</p>
      </div>
      <ol>
        ${proposal.steps.map((step) => `<li>${step.title}: ${formatDateTime(step.start)} → ${formatDateTime(step.end)}</li>`).join("")}
      </ol>
      <button class="primary-button" type="button" data-accept-main-proposal>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>
        Choisir ce RDV
      </button>
    </article>
    <section class="appointment-dates">
      <div class="section-heading compact-heading">
        <h2>Dates disponibles</h2>
        <span>${availableDates.length} date${availableDates.length > 1 ? "s" : ""}</span>
      </div>
      <div class="appointment-date-list">
        ${
          availableDates.length
            ? availableDates
                .map(
                  (option, index) => `
                    <button class="appointment-date-card" type="button" data-accept-date-proposal="${index}">
                      <strong>${longDate(option.date)}</strong>
                      <span>Début ${formatTime(option.proposal.start)} · Livraison ${formatDateTime(option.proposal.delivery)}</span>
                    </button>
                  `,
                )
                .join("")
            : `<div class="empty-inline">Aucune date disponible dans l'horizon affiché.</div>`
        }
      </div>
    </section>
  `;

  $("[data-accept-main-proposal]", target).addEventListener("click", () => {
    acceptProposal(item, proposal);
  });
  $$("[data-accept-date-proposal]", target).forEach((button) => {
    button.addEventListener("click", () => {
      acceptProposal(item, availableDates[Number(button.dataset.acceptDateProposal)].proposal);
    });
  });
}

function normalizeAppointmentOptions(value) {
  if (!value) return null;
  if (Array.isArray(value)) {
    return value[0] ? { proposal: value[0], availableDates: [] } : null;
  }
  return value;
}

function renderAssignments(root, item) {
  const target = $("[data-field='assignments']", root);
  const delivery = $("[data-field='delivery-estimate']", root);
  if (appointmentNeedsReschedule(item)) {
    delivery.textContent = item.appointmentStatus === "no_show" ? "RDV manqué : report nécessaire" : "Report RDV en attente";
  } else {
    delivery.textContent = item.appointment ? `Livraison estimée: ${formatDateTime(item.appointment.delivery)}` : "Livraison non planifiée";
  }
  const assignments = state.bookings.filter((booking) => booking.caseId === item.id);
  if (!assignments.length) {
    target.innerHTML = appointmentNeedsReschedule(item)
      ? `<div class="empty-inline">RDV à reporter. Utilisez Calculer RDV puis choisissez une nouvelle date disponible.</div>`
      : `<div class="empty-inline">Aucun travail affecté.</div>`;
    return;
  }
  target.innerHTML = assignments
    .map((booking) => {
      const resources = booking.resourceIds.map((id) => getResource(id)?.name).filter(Boolean).join(", ");
      return `
        <article class="assignment-card">
          <div>
            <strong>${escapeHtml(booking.title)}</strong>
            <p class="muted">${escapeHtml(resources)}</p>
          </div>
          <span>${formatDateTime(booking.start)}</span>
          <span>${formatDateTime(booking.end)}</span>
        </article>
      `;
    })
    .join("");
}

function renderQualityChecklist(root, item) {
  const target = $("[data-field='quality-checklist']", root);
  target.innerHTML = `
    <div class="section-heading compact-heading">
      <h2>Checklist qualité</h2>
      <span>${qualityChecklistCount(item)}/${DEFAULT_QUALITY_CHECKS.length}</span>
    </div>
    <div class="quality-grid">
      ${DEFAULT_QUALITY_CHECKS.map(
        (label) => `
          <label class="check-card">
            <input type="checkbox" data-quality-check="${escapeAttr(label)}" ${item.qualityChecklist[label] ? "checked" : ""} />
            <span>${escapeHtml(label)}</span>
          </label>
        `,
      ).join("")}
    </div>
  `;
  $$("[data-quality-check]", target).forEach((input) => {
    input.addEventListener("change", () => {
      item.qualityChecklist[input.dataset.qualityCheck] = input.checked;
      if (!isQualityChecklistComplete(item)) {
        item.flags.qualityApproved = false;
        item.flags.delivered = false;
      }
      saveState();
      render();
    });
  });
}

function qualityChecklistCount(item) {
  return DEFAULT_QUALITY_CHECKS.filter((label) => item.qualityChecklist[label]).length;
}
