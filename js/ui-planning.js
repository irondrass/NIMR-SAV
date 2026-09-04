function renderPlanning() {
  if (typeof getUiRuntimeIndexes === "function") getUiRuntimeIndexes();
  const date = parseDateKey(state.planningDate);
  $("#planning-day-label").textContent = longDate(date);
  const dateInput = $("#planning-date");
  if (dateInput && dateInput.value !== state.planningDate) {
    dateInput.value = state.planningDate;
  }
  const alert = $("#day-alert");
  const holiday = getHoliday(date);
  const intervals = getDayIntervals(date);
  if (holiday || !intervals.length) {
    alert.hidden = false;
    alert.textContent = holiday ? `Jour férié: ${holiday.label}` : "Jour fermé";
  } else {
    alert.hidden = true;
  }

  const allResources = orderPlanningResources(state.resources.filter(isDisplayPlanningResource));
  syncPlanningResourceFilter(allResources);
  const filters = getPlanningDisplayFilters(allResources);
  const visibleResources = filterPlanningDisplayResources(allResources, filters);
  const taskNumberMap = buildDailyPlanningTaskNumberMap(date, allResources);

  const activeCount = (filters.search ? 1 : 0) + (filters.resourceId !== "all" ? 1 : 0);
  const badge = $("#planning-filter-badge");
  if (badge) {
    if (activeCount > 0) {
      badge.textContent = `${activeCount} actif${activeCount > 1 ? "s" : ""}`;
      badge.hidden = false;
    } else {
      badge.textContent = "";
      badge.hidden = true;
    }
  }

  const dailyColorMap = buildIndexedDailyVehicleColorMap(todayKey(date));
  const gantt = $("#gantt");
  const dayStart = atTime(date, "08:00");
  const dayEnd = atTime(date, "17:00");
  const total = diffMinutes(dayStart, dayEnd);
  gantt.innerHTML = `
    <div class="gantt-grid">
      <div class="gantt-header">
        <div class="gantt-corner">Ressource</div>
        <div class="time-scale">
          ${renderTicks(total)}
          ${renderPauseBands(date, total)}
        </div>
      </div>
      ${visibleResources
        .map(
          (resource) => `
            <div class="gantt-row">
              <div class="resource-label">
                <strong>${escapeHtml(resource.name)}</strong>
                <span>${ROLE_LABELS[resource.role]} · ${escapeHtml(resource.location || "Atelier")}${resource.fastLane ? " · Fast Lane" : ""}</span>
              </div>
              <div class="timeline">
                ${renderTicks(total, false)}
                ${renderPauseBands(date, total)}
                ${renderResourceBookings(resource, date, dayStart, dayEnd, total, dailyColorMap, taskNumberMap, filters)}
              </div>
            </div>
          `,
        )
        .join("")}
    </div>
  `;
  renderDailyLaborSummary(date, taskNumberMap, filters);
  renderMobilePlanningList(date, visibleResources, taskNumberMap, filters);
}

function getPlanningDisplayFilters(resources = []) {
  const searchInput = $("#planning-search");
  const search = (searchInput?.value || "").trim();
  const resourceSelect = $("#planning-resource-filter");
  const selectedResource = resourceSelect?.value || "all";
  const resourceId = selectedResource !== "all" && resources.some((r) => r.id === selectedResource)
    ? selectedResource
    : "all";
  return { search, resourceId };
}

function syncPlanningResourceFilter(resources = []) {
  const select = $("#planning-resource-filter");
  if (!select) return;
  const currentVal = select.value || "all";
  const optionsHtml = [
    '<option value="all">Toutes les ressources</option>',
    ...resources.map((r) => `<option value="${escapeAttr(r.id)}">${escapeHtml(r.name || "Ressource")}</option>`)
  ].join("");
  select.innerHTML = optionsHtml;
  if (currentVal !== "all" && resources.some((r) => r.id === currentVal)) {
    select.value = currentVal;
  } else {
    select.value = "all";
  }
}

function filterPlanningDisplayResources(resources, filters) {
  if (!filters || filters.resourceId === "all") return resources;
  return resources.filter((r) => r.id === filters.resourceId);
}

function planningCaseMatchesDisplaySearch(caseItem, search) {
  if (!search) return true;
  if (!caseItem) return false;
  return typeof caseMatchesGlobalSearch === "function"
    ? caseMatchesGlobalSearch(caseItem, search)
    : false;
}

function planningBookingMatchesDisplayFilters(booking, caseItem, filters) {
  if (!filters) return true;
  const { search, resourceId } = filters;
  if (resourceId !== "all" && !isBookingVisibleForResource(booking, resourceId)) {
    return false;
  }
  if (search) {
    if (booking.type === "leave") return false;
    return planningCaseMatchesDisplaySearch(caseItem, search);
  }
  return true;
}

function buildIndexedDailyVehicleColorMap(dateKey) {
  const map = {};
  const bookings = typeof getIndexedDayBookings === "function" ? getIndexedDayBookings(dateKey) : (state.bookings || []);
  reconcileVehiclePlanningColors(bookings.filter((booking) => booking?.type !== "leave").map((booking) => booking.caseId));
  bookings.forEach((booking) => {
    if (!booking?.caseId || booking.type === "leave") return;
    const item = typeof getIndexedCaseById === "function"
      ? getIndexedCaseById(booking.caseId)
      : state.cases.find((caseItem) => caseItem.id === booking.caseId);
    map[booking.caseId] = getVehiclePlanningColor(item) || booking.color || "#11415f";
  });
  return map;
}

// WORKSHOP-001D: operation-centric display helpers. Read-only; no planner mutation.
function isOperationCentricPlanningDisplayBooking(booking) {
  if (!booking || typeof booking !== "object") return false;
  return Boolean(
    Number(booking.taskModelVersion || 0) > 0
    || booking.sourceKind
    || (Array.isArray(booking.sourceClaimIds) && booking.sourceClaimIds.length)
    || (Array.isArray(booking.sourceLineIds) && booking.sourceLineIds.length)
    || (Array.isArray(booking.sourceOperations) && booking.sourceOperations.length)
  );
}
function getPlanningBookingDisplayIdentity(booking) {
  const phase = getDurationLabel(booking?.key) || String(booking?.key || "").trim() || "Étape atelier";
  const rawTitle = String(booking?.title || "").trim();
  const canonical = isOperationCentricPlanningDisplayBooking(booking);
  const normalizedTitle = canonical && rawTitle ? rawTitle.replace(/^Reprise\s*-\s*/u, "").trim() : rawTitle;
  return { canonical, operation: canonical && normalizedTitle ? normalizedTitle : (phase || rawTitle || "Étape planning"), phase };
}
function getPlanningBusinessDisplayKey(booking) {
  if (typeof getBookingBusinessTaskId === "function") return getBookingBusinessTaskId(booking) || booking?.id || "";
  return String(booking?.businessTaskId || booking?.parentBookingId || booking?.id || "");
}

function getBookingLaborOperations(caseItem, key) {
  const lines = [];
  (caseItem?.claims || []).forEach((claim) => {
    if (claim.includeInPlanning === false) return;
    (claim.estimate?.originalLines || []).forEach((line) => {
      const allocations = Array.isArray(line.allocations) ? line.allocations : [];
      const matching = allocations.filter((allocation) => allocation.phase === key && Number(allocation.laborHours || 0) > 0);
      if (!matching.length) return;
      lines.push(`${line.operation || line.rawText || 'Opération devis'} (${formatLocalizedDecimal(matching.reduce((sum, allocation) => sum + Number(allocation.laborHours || 0), 0))} h)`);
    });
  });
  if (key === 'finish' && Number(caseItem?.durations?.finish || 0) > 0) lines.push(`Finition + lavage (50% peinture : ${formatLocalizedDecimal(caseItem.durations.finish)} h)`);
  if (key === 'quality' && Number(caseItem?.durations?.quality || 0) > 0) lines.push(`Contrôle final importé (${formatLocalizedDecimal(caseItem.durations.quality)} h)`);
  return lines;
}

function renderDailyLaborSummary(date, taskNumberMap, filters = null) {
  const target = document.getElementById('daily-labor-summary');
  if (!target) return;
  const day = todayKey(date);
  const rows = [];
  const seenBusinessTasks = new Set();
  const dayBookings = typeof getIndexedDayBookings === "function" ? getIndexedDayBookings(day) : state.bookings;
  dayBookings.forEach((booking) => {
    if (booking.type === 'leave') return;
    const caseItem = typeof getIndexedCaseById === "function" ? getIndexedCaseById(booking.caseId) : state.cases.find((item) => item.id === booking.caseId);
    if (isCaseOperationallyClosed(caseItem)) return;
    if (filters && !planningBookingMatchesDisplayFilters(booking, caseItem, filters)) return;
    const hasSegmentOnDay = (booking.segments || []).some((segment) => todayKey(new Date(segment.start)) === day || todayKey(new Date(segment.end)) === day);
    if (!caseItem || !hasSegmentOnDay) return;
    const businessKey = `${booking.caseId || ""}::${getPlanningBusinessDisplayKey(booking) || booking.id || ""}`;
    if (seenBusinessTasks.has(businessKey)) return;
    seenBusinessTasks.add(businessKey);
    const ops = getBookingLaborOperations(caseItem, booking.key);
    const identity = getPlanningBookingDisplayIdentity(booking);
    rows.push({ booking, caseItem, ops, identity });
  });
  if (!rows.length) {
    const isFiltered = filters && (filters.search || filters.resourceId !== "all");
    target.innerHTML = isFiltered
      ? '<div class="empty-inline">Aucune main-d’œuvre ne correspond aux filtres.</div>'
      : '<div class="empty-inline">Aucune main-d’œuvre planifiée sur cette journée.</div>';
    return;
  }
  target.innerHTML = `
    <div class="daily-labor-head"><strong>Détail main-d’œuvre du jour</strong><span>Chaque étape affiche les lignes devis incluses, plus rappel pièces/finition/contrôle.</span></div>
    <div class="daily-labor-list">
      ${rows.map(({ booking, caseItem, ops, identity }, index) => `
        <article class="daily-labor-card">
          <strong>${index + 1}. ${escapeHtml(identity.operation)}</strong>
          <small>${escapeHtml(caseItem.clientName || 'Client')} · ${escapeHtml(caseItem.vehicle || '')}${caseItem.plate ? ` · ${escapeHtml(caseItem.plate)}` : ''}${identity.canonical && identity.phase !== identity.operation ? ` · Phase: ${escapeHtml(identity.phase)}` : ''}</small>
          ${ops.length ? `<ul>${ops.map((op) => `<li>${escapeHtml(op)}</li>`).join('')}</ul>` : '<p class="muted">Aucune ligne MO détaillée rattachée à cette opération.</p>'}
        </article>
      `).join('')}
    </div>
  `;
}

function renderMobilePlanningList(date, resources, taskNumberMap, filters = null) {
  const target = $("#mobile-planning-list");
  if (!target) return;
  const day = todayKey(date);
  const dayStart = atTime(date, "08:00");
  const dayEnd = atTime(date, "17:00");
  const rows = [];
  const dayBookings = typeof getIndexedDayBookings === "function" ? getIndexedDayBookings(day) : state.bookings;
  dayBookings.forEach((booking) => {
    if (booking.type === "leave") return;
    const caseItem = typeof getIndexedCaseById === "function" ? getIndexedCaseById(booking.caseId) : state.cases.find((item) => item.id === booking.caseId);
    if (isCaseOperationallyClosed(caseItem)) return;
    if (filters && !planningBookingMatchesDisplayFilters(booking, caseItem, filters)) return;
    const visibleResources = resources.filter((resource) => isBookingVisibleForResource(booking, resource.id));
    const primaryResource = visibleResources.find((resource) => !isEquipmentResource(resource)) || visibleResources[0];
    if (!primaryResource) return;
    (booking.segments || []).forEach((segment) => {
      const start = new Date(segment.start);
      const end = new Date(segment.end);
      if (todayKey(start) !== day && todayKey(end) !== day) return;
      const status = getBookingOperationalStatus(booking);
      const actualEnd = status === "completed" && booking.actualEnd ? new Date(booking.actualEnd) : null;
      if (actualEnd && start >= actualEnd) return;
      const clippedStart = maxDate(start, dayStart);
      const clippedEnd = actualEnd ? minDate(minDate(end, dayEnd), actualEnd) : minDate(end, dayEnd);
      if (clippedEnd <= clippedStart) return;
      rows.push({ booking, segment, caseItem, resource: primaryResource, start: clippedStart, end: clippedEnd, status });
    });
  });

  rows.sort((a, b) => a.start - b.start || a.end - b.end || String(a.resource.name || "").localeCompare(String(b.resource.name || "")));
  if (!rows.length) {
    const isFiltered = filters && (filters.search || filters.resourceId !== "all");
    target.innerHTML = isFiltered
      ? '<div class="empty-inline">Aucune tâche ne correspond aux filtres.</div>'
      : '<div class="empty-inline">Aucune tâche atelier planifiée sur cette journée.</div>';
    return;
  }

  target.innerHTML = `
    <div class="mobile-planning-head">
      <strong>Planning du jour</strong>
      <span>${rows.length} tâche${rows.length > 1 ? "s" : ""}</span>
    </div>
    ${rows
      .map(({ booking, segment, caseItem, resource, start, end, status }) => {
        const taskNumber = taskNumberMap?.get(getPlanningTaskNumberKey(booking, segment)) || "";
        const identity = getPlanningBookingDisplayIdentity(booking);
        const stage = identity.operation;
        const phase = identity.phase;
        const model = shortVehicleModel(caseItem?.vehicle || caseItem?.model || "Véhicule");
        const plate = caseItem?.plate || caseItem?.registration || caseItem?.vin || "";
        const statusLabel = getBookingStatusLabel(booking);
        const blocked = typeof isCaseBlocked === "function" && isCaseBlocked(caseItem);
        const blockedLabel = blocked && typeof getCaseBlockerLabel === "function" ? getCaseBlockerLabel(caseItem) : "";
        return `
          <article class="mobile-planning-card task-status-${escapeAttr(status)} ${blocked ? "is-blocked" : ""}">
            <div class="mobile-planning-time">
              <strong>${escapeHtml(formatTime(start))}</strong>
              <span>${escapeHtml(formatTime(end))}</span>
            </div>
            <div class="mobile-planning-body">
              <div class="mobile-planning-title">
                <strong>${taskNumber ? `#${escapeHtml(String(taskNumber))} · ` : ""}${escapeHtml(stage)}</strong>
                <span>${escapeHtml(model)} · ${escapeHtml(plate || "Sans immatriculation/VIN")}</span>
              </div>
              <div class="mobile-planning-meta">
                <span>${escapeHtml(resource.name || "Ressource")}</span>
                ${identity.canonical && phase !== stage ? `<span>${escapeHtml(phase)}</span>` : ""}
                <span>${escapeHtml(statusLabel || "Planifié")}</span>
              </div>
              ${caseItem?.clientName ? `<p>${escapeHtml(caseItem.clientName)}</p>` : ""}
              ${blocked ? `<span class="risk-pill">${escapeHtml(blockedLabel || "Bloqué")}</span>` : ""}
            </div>
          </article>
        `;
      })
      .join("")}
  `;
}

function renderTicks(total, withLabels = true) {
  const ticks = [];
  for (let hour = 8; hour <= 17; hour += 1) {
    const left = ((hour - 8) * 60 * 100) / total;
    ticks.push(`<div class="tick" style="left:${left}%">${withLabels ? `<span>${String(hour).padStart(2, "0")}:00</span>` : ""}</div>`);
  }
  return ticks.join("");
}

function renderPauseBands(date, total) {
  const dayStart = atTime(date, "08:00");
  const intervals = getDayIntervals(date);
  if (!intervals.length) return `<div class="pause-band" style="left:0;width:100%"></div>`;
  const bands = [];
  let cursor = dayStart;
  const dayEnd = atTime(date, "17:00");
  intervals.forEach((interval) => {
    if (cursor < interval.start) {
      bands.push(renderBand(cursor, interval.start, dayStart, total));
    }
    cursor = interval.end;
  });
  if (cursor < dayEnd) bands.push(renderBand(cursor, dayEnd, dayStart, total));
  return bands.join("");
}

function renderBand(start, end, dayStart, total) {
  const left = Math.max(0, (diffMinutes(dayStart, start) * 100) / total);
  const width = Math.max(0, (diffMinutes(start, end) * 100) / total);
  return `<div class="pause-band" style="left:${left}%;width:${width}%"></div>`;
}

function renderResourceBookings(resource, date, dayStart, dayEnd, total, dailyColorMap = null, taskNumberMap = null, filters = null) {
  const day = todayKey(date);
  const items = [];
  const resourceBookings = typeof getIndexedResourceBookings === "function" ? getIndexedResourceBookings(resource.id) : state.bookings;
  resourceBookings.forEach((booking) => {
    if (!isBookingVisibleForResource(booking, resource.id)) return;
    booking.segments.forEach((segment) => {
      const start = new Date(segment.start);
      const end = new Date(segment.end);
      if (todayKey(start) !== day && todayKey(end) !== day) return;
      const status = booking.type === "leave" ? "" : getBookingOperationalStatus(booking);
      const actualEnd = status === "completed" && booking.actualEnd ? new Date(booking.actualEnd) : null;
      if (actualEnd && start >= actualEnd) return;
      const clippedStart = maxDate(start, dayStart);
      const clippedEnd = actualEnd ? minDate(minDate(end, dayEnd), actualEnd) : minDate(end, dayEnd);
      if (clippedEnd <= clippedStart) return;
      const left = (diffMinutes(dayStart, clippedStart) * 100) / total;
      const width = Math.max(2, (diffMinutes(clippedStart, clippedEnd) * 100) / total);
      const isLeave = booking.type === "leave";
      const caseItem = isLeave ? null : (typeof getIndexedCaseById === "function" ? getIndexedCaseById(booking.caseId) : state.cases.find((item) => item.id === booking.caseId));
      if (!isLeave && isCaseOperationallyClosed(caseItem)) return;
      if (filters && !planningBookingMatchesDisplayFilters(booking, caseItem, filters)) return;
      const model = isLeave ? "Indisponible" : shortVehicleModel(caseItem?.vehicle || caseItem?.model || "Véhicule");
      const plate = isLeave ? "" : (caseItem?.plate || caseItem?.registration || "");
      const vehicleLine = isLeave ? (booking.title || "Congé / absence") : `${model}${plate ? ` · ${plate}` : ""}`;
      const identity = isLeave ? { canonical: false, operation: "Congé / absence", phase: "Congé / absence" } : getPlanningBookingDisplayIdentity(booking);
      const stage = identity.operation;
      const phase = identity.phase;
      const timeLine = `${formatTime(clippedStart)}-${formatTime(clippedEnd)}`;
      const equipmentPrefix = isEquipmentResource(resource) ? `${ROLE_LABELS[resource.role] || "Équipement"} · ` : "";
      const taskNumber = taskNumberMap?.get(getPlanningTaskNumberKey(booking, segment)) || "";
      const shortPhase = phase.replace("Tôlerie + démontage", "Tôlerie").replace("Peinture + vernis", "Peinture").replace("Contrôle qualité", "Contrôle");
      const secondaryLine = isLeave ? stage : `${vehicleLine}${identity.canonical && phase !== stage ? ` · ${phase}` : ""}`;
      const compactSecondaryLine = isLeave ? stage : `${vehicleLine}${identity.canonical && shortPhase !== stage ? ` · ${shortPhase}` : ""}`;
      const laborOps = isLeave ? [] : getBookingLaborOperations(caseItem, booking.key);
      const taskStatus = isLeave ? "" : getBookingStatusLabel(booking);
      const blocked = !isLeave && typeof isCaseBlocked === "function" && isCaseBlocked(caseItem);
      const blockedLabel = blocked && typeof getCaseBlockerLabel === "function" ? getCaseBlockerLabel(caseItem) : "";
      const bookingTitle = `${taskNumber ? `Tâche n°${taskNumber} - ` : ""}${stage} - ${vehicleLine}${identity.canonical && phase !== stage ? ` - Phase: ${phase}` : ""} - ${timeLine}${taskStatus ? ` - ${taskStatus}` : ""}${blocked ? ` - Dossier bloqué${blockedLabel ? `: ${blockedLabel}` : ""}` : ""}${laborOps.length ? `\nMO: ${laborOps.join(' · ')}` : ''}`;
      const maxTextLength = Math.max(stage.length, `${equipmentPrefix}${secondaryLine}`.length);
      const availableChars = Math.max(6, Math.floor(width * 1.35));
      const numberOnly = Boolean(taskNumber) && !isLeave && (width < 14 || maxTextLength > availableChars);
      const compactClass = `${blocked ? " blocked-booking" : ""}${!isLeave ? ` task-status-${escapeAttr(getBookingOperationalStatus(booking))}` : ""}${numberOnly ? " number-only-booking" : width < 8 ? " compact-booking" : ""}`;
      const color = getBookingPlanningColor(booking, dailyColorMap);
      items.push(`
        <div class="booking ${isLeave ? 'leave-booking' : ''}${compactClass}" style="left:${left}%;width:${width}%;background:${color}" title="${escapeAttr(bookingTitle)}" aria-label="${escapeAttr(bookingTitle)}">
          ${taskNumber ? `<span class="booking-number">${escapeHtml(String(taskNumber))}</span>` : ""}
          ${numberOnly ? "" : `<span class="booking-time">${escapeHtml(timeLine)}</span><strong>${escapeHtml(stage)}</strong><span class="booking-stage">${escapeHtml(equipmentPrefix)}${escapeHtml(width < 8 ? compactSecondaryLine : secondaryLine)}</span>`}
        </div>
      `);
    });
  });
  return items.join("");
}


function buildDailyPlanningTaskNumberMap(date, resources) {
  const day = todayKey(date);
  const dayStart = atTime(date, "08:00");
  const dayEnd = atTime(date, "17:00");
  const rows = [];
  const dayBookings = typeof getIndexedDayBookings === "function" ? getIndexedDayBookings(day) : state.bookings;
  dayBookings.forEach((booking) => {
    if (booking.type === "leave") return;
    const caseItem = typeof getIndexedCaseById === "function" ? getIndexedCaseById(booking.caseId) : state.cases.find((item) => item.id === booking.caseId);
    if (isCaseOperationallyClosed(caseItem)) return;
    const primaryResource = resources.find((resource) => isBookingVisibleForResource(booking, resource.id));
    if (!primaryResource) return;
    booking.segments.forEach((segment) => {
      const start = new Date(segment.start);
      const end = new Date(segment.end);
      if (todayKey(start) !== day && todayKey(end) !== day) return;
      const status = getBookingOperationalStatus(booking);
      const actualEnd = status === "completed" && booking.actualEnd ? new Date(booking.actualEnd) : null;
      if (actualEnd && start >= actualEnd) return;
      const clippedStart = maxDate(start, dayStart);
      const clippedEnd = actualEnd ? minDate(minDate(end, dayEnd), actualEnd) : minDate(end, dayEnd);
      if (clippedEnd <= clippedStart) return;
      rows.push({ booking, segment, start: clippedStart, end: clippedEnd, resourceName: primaryResource.name || "" });
    });
  });
  rows.sort((a, b) => a.start - b.start || a.end - b.end || String(a.resourceName).localeCompare(String(b.resourceName)) || String(a.booking.title || "").localeCompare(String(b.booking.title || "")));
  const map = new Map();
  rows.forEach((row, index) => map.set(getPlanningTaskNumberKey(row.booking, row.segment), index + 1));
  return map;
}

function getPlanningTaskNumberKey(booking, segment) {
  return `${booking.id || booking.caseId || "booking"}|${segment?.start || booking.start || ""}|${segment?.end || booking.end || ""}|${booking.key || ""}`;
}

function renderResources() {
  const target = $("#resource-list");
  const canEditPlanning = canRenderAction("resource.manage");
  const deniedTitle = canEditPlanning ? "" : getPermissionDeniedMessage("resource.manage");
  target.innerHTML = state.resources
    .map(
      (resource) => `
        <article class="resource-card">
          <div class="resource-edit-grid">
            <label>
              Nom
              <input data-resource-field="name" data-resource-id="${escapeAttr(resource.id)}" value="${escapeAttr(resource.name)}" ${canEditPlanning ? "" : `disabled title="${escapeAttr(deniedTitle)}"`} />
            </label>
            <label>
              Rôle
              <select data-resource-field="role" data-resource-id="${escapeAttr(resource.id)}" ${canEditPlanning ? "" : `disabled title="${escapeAttr(deniedTitle)}"`}>
                ${Object.entries(ROLE_LABELS)
                  .map(([value, label]) => `<option value="${value}" ${resource.role === value ? "selected" : ""}>${label}</option>`)
                  .join("")}
              </select>
            </label>
            <label>
              Emplacement
              <input data-resource-field="location" data-resource-id="${escapeAttr(resource.id)}" value="${escapeAttr(resource.location || "")}" ${canEditPlanning ? "" : `disabled title="${escapeAttr(deniedTitle)}"`} />
            </label>
            <label>
              Site
              <select data-resource-field="site" data-resource-id="${escapeAttr(resource.id)}" ${canEditPlanning ? "" : `disabled title="${escapeAttr(deniedTitle)}"`}>
                <option value="internal" ${resource.site !== "external" ? "selected" : ""}>Interne atelier</option>
                <option value="external" ${resource.site === "external" ? "selected" : ""}>Sous-traitant externe</option>
              </select>
            </label>
            <label>
              Capacité simultanée
              <input type="number" min="1" step="1" data-resource-field="capacity" data-resource-id="${escapeAttr(resource.id)}" value="${Math.max(1, Number(resource.capacity || 1))}" ${canEditPlanning ? "" : `disabled title="${escapeAttr(deniedTitle)}"`} />
            </label>
            <label>
              Capacité journalière (min)
              <input type="number" min="0" step="15" data-resource-field="dailyCapacityMinutes" data-resource-id="${escapeAttr(resource.id)}" value="${Number(resource.dailyCapacityMinutes || 0) || ""}" placeholder="Selon calendrier" ${canEditPlanning ? "" : `disabled title="${escapeAttr(deniedTitle)}"`} />
            </label>
            ${resource.site === "external" ? `
              <label>Transfert aller (min)<input type="number" min="0" step="15" data-resource-field="transferOutMinutes" data-resource-id="${escapeAttr(resource.id)}" value="${Number(resource.transferOutMinutes || 0)}" ${canEditPlanning ? "" : `disabled title="${escapeAttr(deniedTitle)}"`} /></label>
              <label>Transfert retour (min)<input type="number" min="0" step="15" data-resource-field="transferReturnMinutes" data-resource-id="${escapeAttr(resource.id)}" value="${Number(resource.transferReturnMinutes || 0)}" ${canEditPlanning ? "" : `disabled title="${escapeAttr(deniedTitle)}"`} /></label>
              <label>Délai standard (min)<input type="number" min="0" step="15" data-resource-field="standardLeadTimeMinutes" data-resource-id="${escapeAttr(resource.id)}" value="${Number(resource.standardLeadTimeMinutes || 0)}" ${canEditPlanning ? "" : `disabled title="${escapeAttr(deniedTitle)}"`} /></label>
            ` : ""}
            <span class="case-meta">
              ${resource.fastLane ? `<span class="tag ok">Fast Lane</span>` : ""}
              ${resource.site === "external" ? `<span class="tag">Externe</span>` : ""}
              <span class="tag soft">Capacité ${Math.max(1, Number(resource.capacity || 1))}</span>
              ${resource.active === false ? `<span class="tag warn">Inactive</span>` : ""}
            </span>
          </div>
          <div class="resource-actions">
            <button class="ghost-button" type="button" data-toggle-fastlane="${resource.id}" ${canEditPlanning ? "" : `disabled title="${escapeAttr(deniedTitle)}"`}>
              ${resource.fastLane ? "Standard" : "Fast Lane"}
            </button>
            <button class="ghost-button" type="button" data-toggle-resource="${resource.id}" ${canEditPlanning ? "" : `disabled title="${escapeAttr(deniedTitle)}"`}>
              ${resource.active === false ? "Activer" : "Désactiver"}
            </button>
          </div>
        </article>
      `,
    )
    .join("");
  $$("[data-resource-field]", target).forEach((input) => {
    input.addEventListener("change", () => {
      const permission = guardAction("resource.manage", {}, { notify: false });
      if (!permission.ok) {
        notifyUser(permission.message, "error");
        renderResources();
        return;
      }
      const resource = getResource(input.dataset.resourceId);
      const field = input.dataset.resourceField;
      if (["capacity", "dailyCapacityMinutes", "transferOutMinutes", "transferReturnMinutes", "standardLeadTimeMinutes"].includes(field)) {
        resource[field] = input.value === "" ? null : Number(input.value);
        if (field === "capacity") resource.simultaneousCapacity = Math.max(1, Number(input.value || 1));
      } else {
        resource[field] = input.value;
      }
      if (field === "site") {
        resource.external = input.value === "external";
        resource.kind = resource.external ? "external" : "internal";
      }
      Object.assign(resource, normalizeResource(resource));
      saveState();
      render();
    });
  });
  $$("[data-toggle-resource]", target).forEach((button) => {
    button.addEventListener("click", () => {
      const permission = guardAction("resource.manage", {}, { notify: false });
      if (!permission.ok) return notifyUser(permission.message, "error");
      const resource = getResource(button.dataset.toggleResource);
      resource.active = resource.active === false;
      saveState();
      render();
    });
  });
  $$("[data-toggle-fastlane]", target).forEach((button) => {
    button.addEventListener("click", () => {
      const permission = guardAction("resource.manage", {}, { notify: false });
      if (!permission.ok) return notifyUser(permission.message, "error");
      const resource = getResource(button.dataset.toggleFastlane);
      resource.fastLane = !resource.fastLane;
      saveState();
      render();
    });
  });
}

function renderFastLaneSettings() {
  const form = $("#fastlane-form");
  if (!form) return;
  const canEditPlanning = canRenderAction("planning.edit");
  const deniedTitle = canEditPlanning ? "" : getPermissionDeniedMessage("planning.edit");
  form.elements.fastLaneEnabled.checked = Boolean(state.settings.fastLaneEnabled);
  form.elements.fastLaneMaxHours.value = formatLocalizedDecimal(state.settings.fastLaneMaxHours);
  Array.from(form.elements || []).forEach((control) => {
    if (!control) return;
    control.disabled = !canEditPlanning;
    if (!canEditPlanning) control.title = deniedTitle;
  });
}

function renderWorkHoursSettings() {
  const target = $("#work-hours-list");
  if (!target) return;
  const canEditPlanning = canRenderAction("planning.edit");
  const deniedTitle = canEditPlanning ? "" : getPermissionDeniedMessage("planning.edit");
  target.innerHTML = DAY_LABELS.map(
    (label, day) => `
      <label class="work-hour-row">
        <span>${label}</span>
        <input data-work-day="${day}" value="${formatWorkIntervals(state.workHours[day] || [])}" placeholder="08:00-12:00,13:00-17:00 ou fermé" ${canEditPlanning ? "" : `disabled title="${escapeAttr(deniedTitle)}"`} />
      </label>
    `,
  ).join("");
}

function formatWorkIntervals(intervals) {
  return intervals.map(([start, end]) => `${start}-${end}`).join(",");
}

function parseWorkIntervals(value) {
  const cleaned = String(value || "").trim();
  if (!cleaned || cleaned.toLowerCase() === "fermé" || cleaned.toLowerCase() === "ferme") return [];
  return cleaned.split(",").map((part) => {
    const [start, end] = part.trim().split("-").map((item) => item.trim());
    if (!isValidTime(start) || !isValidTime(end) || atTime(new Date(), start) >= atTime(new Date(), end)) {
      throw new Error("Format horaire invalide. Exemple attendu: 08:00-12:00,13:00-17:00");
    }
    return [start, end];
  });
}

function isValidTime(value) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function renderHolidays() {
  const target = $("#holiday-list");
  const canEditPlanning = canRenderAction("planning.edit");
  const deniedTitle = canEditPlanning ? "" : getPermissionDeniedMessage("planning.edit");
  target.innerHTML = state.holidays
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(
      (holiday) => `
        <article class="holiday-card">
          <div>
            <strong>${formatDate(holiday.date)}</strong>
            <span class="muted">${escapeHtml(holiday.label)}</span>
          </div>
          <button class="ghost-button" type="button" data-remove-holiday="${holiday.date}" ${canEditPlanning ? "" : `disabled title="${escapeAttr(deniedTitle)}"`}>Retirer</button>
        </article>
      `,
    )
    .join("");
  $$("[data-remove-holiday]", target).forEach((button) => {
    button.addEventListener("click", () => {
      const permission = guardAction("planning.edit", {}, { notify: false });
      if (!permission.ok) return notifyUser(permission.message, "error");
      state.holidays = state.holidays.filter((holiday) => holiday.date !== button.dataset.removeHoliday);
      saveState();
      render();
    });
  });
}

function getActiveCase() {
  const selected = typeof resolveCaseInCurrentState === "function"
    ? resolveCaseInCurrentState(activeCaseId)
    : ((typeof getIndexedCaseById === "function" ? getIndexedCaseById(activeCaseId) : state.cases.find((item) => item.id === activeCaseId)) || null);
  if (selected) return selected;
  const fallback = state.cases[0] || null;
  activeCaseId = fallback?.id || null;
  return fallback;
}


function renderResourceLeaves() {
  const form = $("#resource-leave-form");
  const list = $("#resource-leave-list");
  if (!form || !list) return;
  const canEditPlanning = canRenderAction("planning.edit");
  const deniedTitle = canEditPlanning ? "" : getPermissionDeniedMessage("planning.edit");
  const select = form.elements.resourceId;
  Array.from(form.elements || []).forEach((control) => {
    if (!control) return;
    control.disabled = !canEditPlanning;
    if (!canEditPlanning) control.title = deniedTitle;
  });
  const selected = select.value;
  const humans = orderPlanningResources(state.resources.filter(isHumanPlanningResource));
  select.innerHTML = humans.map((resource) => `<option value="${escapeAttr(resource.id)}">${escapeHtml(resource.name)} · ${escapeHtml(ROLE_LABELS[resource.role] || resource.role)}</option>`).join("");
  if (selected && humans.some((resource) => resource.id === selected)) select.value = selected;
  const leaves = state.bookings
    .filter((booking) => booking.type === "leave")
    .slice()
    .sort((a, b) => new Date(a.start) - new Date(b.start));
  list.innerHTML = leaves.length
    ? leaves.map((leave) => {
        const resource = getResource(leave.resourceIds?.[0]);
        return `<article class="holiday-card">
          <div><strong>${escapeHtml(resource?.name || "Ressource")}</strong><span class="muted">${escapeHtml(leave.title || "Congé")} · ${formatDateTime(leave.start)} → ${formatDateTime(leave.end)}</span></div>
          <button class="ghost-button" type="button" data-remove-leave="${escapeAttr(leave.id)}" ${canEditPlanning ? "" : `disabled title="${escapeAttr(deniedTitle)}"`}>Retirer</button>
        </article>`;
      }).join("")
    : `<div class="empty-inline">Aucun congé ou absence planifié.</div>`;
  $$('[data-remove-leave]', list).forEach((button) => {
    button.addEventListener('click', () => {
      const permission = guardAction("planning.edit", {}, { notify: false });
      if (!permission.ok) return notifyUser(permission.message, "error");
      state.bookings = state.bookings.filter((booking) => booking.id !== button.dataset.removeLeave);
      saveState();
      renderPlanning();
      renderResourceLeaves();
      renderMetrics();
    });
  });
}

const WORKSHOP_USER_ADMIN_UI_ROLES = new Set(["admin_technique", "directeur"]);
const WORKSHOP_USER_ADMIN_HUMAN_TYPES = new Set(["controle", "electricien", "mecanicien", "peintre", "tolier"]);
let workshopUserAdminCapabilityState = Object.freeze({
  status: "idle",
  contextKey: "",
  canManageAccounts: false,
  provisioningAvailable: false,
  callerRole: "",
  workshopId: "",
  activeAdminTechnicalCount: 0,
  humanResources: [],
  reason: "Vérification de la capacité serveur requise.",
});

function getWorkshopUserAdminContextKey(snapshot = null) {
  const model = snapshot || (typeof getAccountAccessSnapshot === "function" ? getAccountAccessSnapshot() : null);
  return [
    model?.online === false ? "offline" : "online",
    model?.authIdentity?.id || "",
    model?.serverMembership?.workshop_id || "",
    model?.serverRole || "",
  ].join(":");
}

function setWorkshopUserAdminCapabilityState(next = {}) {
  workshopUserAdminCapabilityState = Object.freeze({
    status: String(next.status || "idle"),
    contextKey: String(next.contextKey || ""),
    canManageAccounts: next.canManageAccounts === true,
    provisioningAvailable: next.provisioningAvailable === true,
    callerRole: String(next.callerRole || ""),
    workshopId: String(next.workshopId || ""),
    activeAdminTechnicalCount: Math.max(0, Number.parseInt(next.activeAdminTechnicalCount, 10) || 0),
    humanResources: Object.freeze((Array.isArray(next.humanResources) ? next.humanResources : []).map((resource) => Object.freeze({ ...resource }))),
    reason: String(next.reason || ""),
  });
  return workshopUserAdminCapabilityState;
}

function getWorkshopUserAdminBaseDecision(snapshot = null) {
  const model = snapshot || (typeof getAccountAccessSnapshot === "function" ? getAccountAccessSnapshot() : null);
  if (!model || model.online === false) return { ok: false, reason: "Hors ligne : invitations et retraits d’accès serveur indisponibles." };
  if (!(typeof hasValidatedOnlineServerAuthority === "function" && hasValidatedOnlineServerAuthority())) {
    return { ok: false, reason: "Une identité Supabase validée est requise." };
  }
  if (model.membershipStatus !== "active" || model.overallStatus !== "active") {
    return { ok: false, reason: "Corrigez le diagnostic d’accès avant de gérer les comptes serveur." };
  }
  if (!WORKSHOP_USER_ADMIN_UI_ROLES.has(model.serverRole)) {
    return { ok: false, reason: "Rôle serveur non autorisé : Admin technique ou Directeur requis." };
  }
  return { ok: true, reason: "" };
}

function getWorkshopUserAdminUiDecision(snapshot = null) {
  const model = snapshot || (typeof getAccountAccessSnapshot === "function" ? getAccountAccessSnapshot() : null);
  const baseDecision = getWorkshopUserAdminBaseDecision(model);
  if (!baseDecision.ok) return { allowed: false, reason: baseDecision.reason };
  const contextKey = getWorkshopUserAdminContextKey(model);
  if (workshopUserAdminCapabilityState.contextKey !== contextKey) {
    return { allowed: false, reason: "Vérification de la capacité serveur en cours." };
  }
  if (["loading", "idle"].includes(workshopUserAdminCapabilityState.status)) {
    return { allowed: false, reason: "Vérification de la capacité serveur en cours." };
  }
  if (workshopUserAdminCapabilityState.status !== "ready"
    || !workshopUserAdminCapabilityState.canManageAccounts
    || !workshopUserAdminCapabilityState.provisioningAvailable) {
    return { allowed: false, reason: workshopUserAdminCapabilityState.reason || "Provisioning serveur indisponible." };
  }
  if (workshopUserAdminCapabilityState.callerRole !== model.serverRole
    || workshopUserAdminCapabilityState.workshopId !== model.serverMembership?.workshop_id) {
    return { allowed: false, reason: "La capacité serveur ne correspond plus à l’identité validée." };
  }
  return { allowed: true, reason: "Gestion sécurisée disponible via Supabase." };
}

async function refreshWorkshopUserAdminCapabilities(options = {}) {
  const snapshot = options.snapshot || (typeof getAccountAccessSnapshot === "function" ? getAccountAccessSnapshot() : null);
  const contextKey = getWorkshopUserAdminContextKey(snapshot);
  const baseDecision = getWorkshopUserAdminBaseDecision(snapshot);
  if (!baseDecision.ok) {
    return setWorkshopUserAdminCapabilityState({ status: "unavailable", contextKey, reason: baseDecision.reason });
  }
  if (!options.force && workshopUserAdminCapabilityState.contextKey === contextKey
    && ["loading", "ready"].includes(workshopUserAdminCapabilityState.status)) {
    return workshopUserAdminCapabilityState;
  }
  setWorkshopUserAdminCapabilityState({ status: "loading", contextKey, reason: "Vérification de la capacité serveur en cours." });
  if (typeof invokeWorkshopUserAdmin !== "function") {
    return setWorkshopUserAdminCapabilityState({ status: "error", contextKey, reason: "Client de provisioning serveur indisponible." });
  }
  const result = await invokeWorkshopUserAdmin("capabilities", {});
  const currentSnapshot = typeof getAccountAccessSnapshot === "function" ? getAccountAccessSnapshot() : snapshot;
  if (getWorkshopUserAdminContextKey(currentSnapshot) !== contextKey) {
    return setWorkshopUserAdminCapabilityState({ status: "idle", contextKey: "", reason: "Identité serveur modifiée ; nouvelle vérification requise." });
  }
  const expectedRole = String(snapshot?.serverRole || "");
  const expectedWorkshopId = String(snapshot?.serverMembership?.workshop_id || "");
  const responseMatchesAuthority = result?.ok === true
    && result.can_manage_accounts === true
    && result.provisioning_available === true
    && String(result.caller_role || "") === expectedRole
    && String(result.workshop_id || "") === expectedWorkshopId
    && Number.isInteger(result.active_admin_technique_count)
    && result.active_admin_technique_count >= 0;
  if (!responseMatchesAuthority) {
    return setWorkshopUserAdminCapabilityState({
      status: "error",
      contextKey,
      reason: result?.message || "Le serveur n’autorise pas la gestion des comptes pour cette identité.",
    });
  }
  const humanResources = (Array.isArray(result.human_resources) ? result.human_resources : [])
    .filter((resource) => resource?.id && WORKSHOP_USER_ADMIN_HUMAN_TYPES.has(String(resource.type || "").trim().toLowerCase()))
    .map((resource) => ({
      id: String(resource.id),
      localId: String(resource.local_id || ""),
      name: String(resource.name || resource.local_id || resource.id),
      type: String(resource.type || "").trim().toLowerCase(),
    }));
  return setWorkshopUserAdminCapabilityState({
    status: "ready",
    contextKey,
    canManageAccounts: true,
    provisioningAvailable: true,
    callerRole: expectedRole,
    workshopId: expectedWorkshopId,
    activeAdminTechnicalCount: result.active_admin_technique_count,
    humanResources,
    reason: "Gestion sécurisée disponible via Supabase.",
  });
}

function renderWorkshopUserAdminProvisioning(snapshot = null) {
  const model = snapshot || (typeof getAccountAccessSnapshot === "function" ? getAccountAccessSnapshot() : null);
  const contextKey = getWorkshopUserAdminContextKey(model);
  const baseDecision = getWorkshopUserAdminBaseDecision(model);
  if (workshopUserAdminCapabilityState.contextKey !== contextKey) {
    setWorkshopUserAdminCapabilityState({ status: "idle", contextKey, reason: baseDecision.reason || "Vérification de la capacité serveur requise." });
  }
  if (baseDecision.ok && workshopUserAdminCapabilityState.status === "idle") {
    Promise.resolve().then(async () => {
      await refreshWorkshopUserAdminCapabilities({ snapshot: model });
      if (document.getElementById("users-list")) renderUsersAndRoles();
    }).catch(() => null);
  }
  const decision = getWorkshopUserAdminUiDecision(model);
  const inviteButton = document.getElementById("invite-workshop-member-btn");
  const note = document.getElementById("account-provisioning-note");
  if (inviteButton) {
    inviteButton.disabled = !decision.allowed;
    inviteButton.title = decision.reason;
    inviteButton.setAttribute("aria-disabled", decision.allowed ? "false" : "true");
  }
  if (note) note.textContent = decision.reason;
  return decision;
}

function populateWorkshopInviteResourceOptions(select) {
  if (!select) return [];
  const resources = Array.from(workshopUserAdminCapabilityState.humanResources || []);
  select.innerHTML = `
    <option value="">Sélectionner une ressource humaine</option>
    ${resources.map((resource) => `<option value="${escapeAttr(resource.id)}">${escapeHtml(resource.name)} · ${escapeHtml(ROLE_LABELS[resource.type] || resource.type)}</option>`).join("")}
  `;
  return resources;
}

if (typeof window !== "undefined") {
  window.getWorkshopUserAdminUiDecision = getWorkshopUserAdminUiDecision;
  window.refreshWorkshopUserAdminCapabilities = refreshWorkshopUserAdminCapabilities;
  window.getWorkshopUserAdminCapabilityState = () => workshopUserAdminCapabilityState;
  window.populateWorkshopInviteResourceOptions = populateWorkshopInviteResourceOptions;
}

function getAccountAccessRoleLabel(role) {
  return CANONICAL_USER_ROLES[role] || USER_ROLES[role] || role || "Non renseigné";
}

function renderAccountAccessFoundation(snapshot = null) {
  const model = snapshot || (typeof getAccountAccessSnapshot === "function" ? getAccountAccessSnapshot() : null);
  const root = document.getElementById("account-access-foundation");
  if (!root || !model) return model;
  const setText = (id, value) => {
    const target = document.getElementById(id);
    if (target) target.textContent = value || "—";
  };
  const sessionLabels = {
    active: "Session Supabase active",
    offline_local: "Hors ligne — identité locale",
    missing: "Aucune session Supabase",
  };
  const membershipLabels = {
    active: "Appartenance atelier validée",
    cached: "Appartenance validée en cache local",
    invalid_role: "Rôle atelier invalide",
    not_authorized: "Non autorisé pour cet atelier",
    unavailable: "Appartenance atelier indisponible",
  };
  const localUser = model.localUser;
  const localResource = model.localResourceId
    ? (state.resources || []).find((candidate) => candidate?.id === model.localResourceId)
    : null;
  setText("account-auth-identity", model.authIdentity?.email || model.authIdentity?.id || "Aucune identité Supabase");
  setText("account-server-role", model.serverRole ? getAccountAccessRoleLabel(model.serverRole) : "Non validé");
  setText("account-server-resource", model.resource?.name || model.serverResourceId || (model.serverRole === "technicien" ? "Ressource requise" : "Non requise"));
  setText("account-session-state", sessionLabels[model.sessionStatus] || model.sessionStatus);
  setText("account-membership-state", membershipLabels[model.membershipStatus] || model.membershipStatus);
  setText("account-local-name", localUser?.name || localUser?.email || "Aucun profil local");
  setText("account-local-role", localUser ? getAccountAccessRoleLabel(model.localRole) : "Non renseigné");
  setText("account-local-resource", localResource?.name || model.localResourceId || "Aucune ressource locale");
  setText("account-local-state", localUser ? (model.localAccountActive ? "Actif" : "Inactif") : "Absent");

  const status = document.getElementById("account-access-overall-status");
  if (status) {
    status.textContent = model.overallLabel;
    status.dataset.status = model.overallStatus;
  }

  const checkState = (condition, attention = false) => condition ? "pass" : (attention ? "attention" : "error");
  const technicianRole = model.serverRole === "technicien";
  const diagnostics = [
    {
      label: "Session Supabase",
      status: model.sessionStatus === "active" ? "pass" : (model.sessionStatus === "offline_local" ? "attention" : "error"),
      detail: sessionLabels[model.sessionStatus] || "Session inconnue",
    },
    {
      label: "Appartenance atelier",
      status: model.membershipStatus === "active" ? "pass" : (model.membershipStatus === "cached" ? "attention" : "error"),
      detail: membershipLabels[model.membershipStatus] || "Appartenance inconnue",
    },
    {
      label: "Parité rôle serveur / local",
      status: model.roleParity === "pass" ? "pass" : (model.roleParity === "warning" ? "attention" : "error"),
      detail: model.roleParity === "pass" ? "Rôles identiques" : (model.roleParity === "warning" ? "Le serveur reste autoritaire" : "Comparaison indisponible"),
    },
    {
      label: "Ressource liée",
      status: technicianRole ? checkState(Boolean(model.serverResourceId)) : "pass",
      detail: technicianRole ? (model.serverResourceId || "Ressource technicien manquante") : "Non requise pour ce rôle",
    },
    {
      label: "Ressource humaine valide",
      status: technicianRole ? checkState(model.technicianResourceStatus === "valid") : "pass",
      detail: technicianRole ? (model.technicianResourceStatus === "valid" ? "Ressource humaine active" : "Liaison technicien à corriger") : "Non requise pour ce rôle",
    },
    {
      label: "Compte local actif",
      status: checkState(model.localAccountActive, !model.online),
      detail: model.localAccountActive ? "Profil miroir actif" : "Profil miroir absent ou inactif",
    },
    {
      label: "Identité synchronisée",
      status: checkState(model.identitySynchronized, !model.online),
      detail: model.identitySynchronized ? "Identités alignées" : "Identité locale différente de la session serveur",
    },
  ];
  const diagnosticRoot = document.getElementById("account-access-diagnostics");
  if (diagnosticRoot) {
    diagnosticRoot.innerHTML = diagnostics.map((diagnostic) => `
      <div class="account-access-check" data-check-status="${escapeAttr(diagnostic.status)}">
        <dt>${escapeHtml(diagnostic.label)}</dt>
        <dd><strong>${diagnostic.status === "pass" ? "PASS" : diagnostic.status === "attention" ? "ATTENTION" : "ERREUR"}</strong><span>${escapeHtml(diagnostic.detail)}</span></dd>
      </div>
    `).join("");
  }
  const issuesRoot = document.getElementById("account-access-issues");
  if (issuesRoot) {
    issuesRoot.hidden = model.issues.length === 0;
    issuesRoot.innerHTML = model.issues.map((issue) => `
      <li data-issue-severity="${escapeAttr(issue.severity)}"><strong>${issue.severity === "error" ? "ERREUR" : "ATTENTION"}</strong> — ${escapeHtml(issue.message)}</li>
    `).join("");
  }
  return model;
}

function renderUsersAndRoles() {
  const form = document.getElementById("user-form");
  const list = document.getElementById("users-list");
  const switcher = document.getElementById("current-user-selector");
  if (!form || !list) return;

  const accountSnapshot = renderAccountAccessFoundation();
  const serverManagementDecision = renderWorkshopUserAdminProvisioning(accountSnapshot);

  const canManageUsers = typeof canRenderAction === "function" ? canRenderAction("users.manage") : false;
  const deniedTitle = canManageUsers ? "" : (typeof getPermissionDeniedMessage === "function" ? getPermissionDeniedMessage("users.manage") : "Action réservée administrateur.");
  const onlineAuthority = typeof hasValidatedOnlineServerAuthority === "function"
    && hasValidatedOnlineServerAuthority();
  const serverManagedReadOnlyTitle = "Profil miroir géré par Supabase — modification locale indisponible en ligne.";

  form.hidden = !canManageUsers;
  list.hidden = !canManageUsers;
  const localProfileManagement = document.getElementById("local-profile-management");
  if (localProfileManagement) localProfileManagement.hidden = !canManageUsers;
  const summary = document.getElementById("roles-permissions-summary");
  if (summary) {
    summary.hidden = !canManageUsers;
    summary.style.display = canManageUsers ? "" : "none";
    // Also hide the header right before it if possible
    const prevEl = summary.previousElementSibling;
    if (prevEl && prevEl.classList.contains("section-heading")) {
      prevEl.hidden = !canManageUsers;
      prevEl.style.display = canManageUsers ? "" : "none";
    }
  }

  Array.from(form.elements || []).forEach((control) => {
    if (control.id === "current-user-selector" || control.name === "userId") return;
    control.disabled = !canManageUsers;
    if (!canManageUsers) control.title = deniedTitle;
  });

  const resourceSelect = form.elements.resourceId;
  if (resourceSelect) {
    const technicians = state.resources.filter((res) => typeof isTechnicianResource === "function" ? isTechnicianResource(res) : res.active !== false);
    const currentSelected = resourceSelect.value;
    resourceSelect.innerHTML = `
      <option value="">Lier à aucune ressource technicien</option>
      ${technicians.map((t) => `<option value="${escapeAttr(t.id)}">${escapeHtml(t.name)} · ${escapeHtml(ROLE_LABELS[t.role] || t.role)}</option>`).join("")}
    `;
    if (currentSelected && technicians.some(t => t.id === currentSelected)) {
      resourceSelect.value = currentSelected;
    }
  }

  const users = Array.isArray(state.users) ? state.users : [];
  const activeUsers = users.filter(u => u.active !== false);
  const duplicates = [];
  activeUsers.forEach((u) => {
    const emailNorm = String(u.email || "").trim().toLowerCase();
    if (emailNorm) {
      const canonicalRole = getCanonicalUserRole(u);
      const count = activeUsers.filter(ou => String(ou.email || "").trim().toLowerCase() === emailNorm && getCanonicalUserRole(ou) === canonicalRole).length;
      if (count > 1 && !duplicates.includes(emailNorm + ":" + canonicalRole)) {
        duplicates.push(emailNorm + ":" + canonicalRole);
      }
    }
  });

  const alertContainer = document.getElementById("users-duplicates-alert");
  if (alertContainer) {
    if (duplicates.length > 0) {
      alertContainer.innerHTML = `
        <div class="alert warn" style="margin-bottom: 12px; padding: 10px; border-radius: 6px; border: 1px solid #f59e0b; background: #fffbeb; color: #b45309; font-size: 0.9rem;">
          <strong>Avertissement :</strong> Des utilisateurs actifs possèdent le même email et le même rôle (Doublon). Veuillez corriger ces doublons.
        </div>
      `;
      alertContainer.hidden = false;
      alertContainer.style.display = "";
    } else {
      alertContainer.innerHTML = "";
      alertContainer.hidden = true;
      alertContainer.style.display = "none";
    }
  }

  list.innerHTML = users.map((user) => {
    const isCurrent = user.id === state.currentUserId;
    const linkedResource = user.resourceId ? state.resources.find(r => r.id === user.resourceId) : null;
    const canonicalRole = getCanonicalUserRole(user);
    const isTechWithoutRes = canonicalRole === "technicien" && !user.resourceId;
    const serverManagedProfile = typeof isServerManagedLocalProfile === "function" && isServerManagedLocalProfile(user);
    const serverManagedReadOnly = onlineAuthority && serverManagedProfile;
    const mutationDisabled = !canManageUsers || serverManagedReadOnly;
    const mutationTitle = serverManagedReadOnly ? serverManagedReadOnlyTitle : deniedTitle;
    const targetAuthUserId = String(user.authUserId || "").trim();
    const isCurrentServerIdentity = Boolean(targetAuthUserId && targetAuthUserId === String(accountSnapshot?.authIdentity?.id || ""));
    const isLastActiveTechnicalAdmin = canonicalRole === "admin_technique"
      && workshopUserAdminCapabilityState.activeAdminTechnicalCount <= 1;
    const canRenderOffboardAction = Boolean(serverManagedProfile && targetAuthUserId && serverManagementDecision.allowed);
    const offboardTitle = isCurrentServerIdentity
      ? "Vous ne pouvez pas retirer votre propre accès atelier."
      : (isLastActiveTechnicalAdmin
        ? "Le dernier administrateur technique actif ne peut pas être retiré."
        : "Révoquer l’appartenance atelier puis supprimer le compte Auth côté serveur.");
    
    const roleLabel = CANONICAL_USER_ROLES[canonicalRole] || USER_ROLES[user.role] || user.role;
    const activeLabel = user.active !== false ? `<span class="tag ok">Actif</span>` : `<span class="tag warn">Inactif</span>`;
    const currentBadge = isCurrent ? `<span class="tag" style="background:#e0f2fe;color:#0369a1;">Utilisateur actuel</span>` : "";
    const supabaseBadge = serverManagedProfile
      ? `<span class="tag soft" title="${escapeAttr(serverManagedReadOnlyTitle)}">Géré par Supabase</span>`
      : "";
    const isDuplicate = user.active !== false && user.email && activeUsers.some(ou => ou.id !== user.id && String(ou.email || "").trim().toLowerCase() === String(user.email || "").trim().toLowerCase() && getCanonicalUserRole(ou) === canonicalRole);
    const duplicateBadge = isDuplicate ? `<span class="tag warn" title="Un autre utilisateur actif a le même email et rôle !">Doublon</span>` : "";
    const warnNoResource = isTechWithoutRes ? `<p class="risk-pill" style="margin-top: 6px; font-size: 0.8rem; font-weight: 700;">Aucune ressource technicien liée à cet utilisateur.</p>` : "";
    
    return `
      <article class="resource-card user-card ${isCurrent ? 'active' : ''}">
        <div class="resource-edit-grid">
          <div>
            <strong>${escapeHtml(user.name)}</strong>
            <span class="muted" style="display: block;">${escapeHtml(user.email || "Pas d'email")}</span>
          </div>
          <div>
            <span class="muted">Rôle : <strong>${escapeHtml(roleLabel)}</strong></span>
            ${user.resourceId ? `<span class="muted" style="display: block;">Ressource : <strong>${escapeHtml(linkedResource?.name || user.resourceId)}</strong></span>` : ""}
          </div>
          <div class="case-meta" style="margin-top: 4px;">
            ${activeLabel}
            ${currentBadge}
            ${supabaseBadge}
            ${duplicateBadge}
          </div>
          ${warnNoResource}
        </div>
        <div class="resource-actions">
          <button class="ghost-button" type="button" data-edit-user="${escapeAttr(user.id)}" ${mutationDisabled ? `disabled title="${escapeAttr(mutationTitle)}"` : ""}>
            Modifier
          </button>
          <button class="ghost-button" type="button" data-toggle-user-status="${escapeAttr(user.id)}" ${mutationDisabled ? `disabled title="${escapeAttr(mutationTitle)}"` : ""}>
            ${user.active === false ? "Activer" : "Désactiver"}
          </button>
          ${canRenderOffboardAction ? `
            <button class="ghost-button danger-button" type="button" data-offboard-user="${escapeAttr(user.id)}" ${(isCurrentServerIdentity || isLastActiveTechnicalAdmin) ? `disabled title="${escapeAttr(offboardTitle)}"` : `title="${escapeAttr(offboardTitle)}"`}>
              Retirer l’accès
            </button>
          ` : ""}
        </div>
      </article>
    `;
  }).join("");

  if (switcher) {
    const currentLocalUser = activeUsers.find((user) => user.id === state.currentUserId) || null;
    const selectorUsers = canManageUsers ? activeUsers : (currentLocalUser ? [currentLocalUser] : []);
    switcher.innerHTML = selectorUsers.map(u => {
      const emailNorm = String(u.email || "").trim().toLowerCase();
      const canonicalRole = getCanonicalUserRole(u);
      const isDup = emailNorm && activeUsers.some(ou => ou.id !== u.id && String(ou.email || "").trim().toLowerCase() === emailNorm && getCanonicalUserRole(ou) === canonicalRole);
      const displayLabel = isDup 
        ? `${u.name} (${CANONICAL_USER_ROLES[canonicalRole] || USER_ROLES[u.role] || u.role}) [Doublon: ${u.id.substring(5)}]`
        : `${u.name} (${CANONICAL_USER_ROLES[canonicalRole] || USER_ROLES[u.role] || u.role})`;
      return `<option value="${escapeAttr(u.id)}" ${u.id === state.currentUserId ? 'selected' : ''}>${escapeHtml(displayLabel)}</option>`;
    }).join("");
    switcher.disabled = onlineAuthority || !canManageUsers;
    switcher.title = onlineAuthority
      ? "La session Supabase reste autoritaire. Déconnectez-vous pour changer de compte."
      : (canManageUsers ? "Sélecteur de compatibilité locale hors ligne" : deniedTitle);
    const selectorNote = document.getElementById("current-user-selector-note");
    if (selectorNote) {
      selectorNote.textContent = onlineAuthority
        ? "Session Supabase active : ce sélecteur local est désactivé et ne peut pas modifier les droits serveur."
        : "Mode LOCAL / HORS LIGNE uniquement. Ce sélecteur ne crée pas de session Supabase et ne modifie pas workshop_members.";
    }
  }

  $$("[data-edit-user]", list).forEach((button) => {
    button.addEventListener("click", () => {
      const user = getUserById(button.dataset.editUser);
      if (!user) return;
      
      form.elements.userId.value = user.id;
      form.elements.name.value = user.name;
      form.elements.role.value = getCanonicalUserRole(user);
      form.elements.email.value = user.email || "";
      form.elements.resourceId.value = user.resourceId || "";
      form.elements.active.checked = user.active !== false;
      if (form.elements.pin) form.elements.pin.value = "";
      
      const submitLabel = document.getElementById("user-submit-label");
      if (submitLabel) submitLabel.textContent = "Enregistrer les modifications";
      
      const cancelBtn = document.getElementById("user-cancel-btn");
      if (cancelBtn) cancelBtn.hidden = false;
      
      form.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  });

  $$("[data-toggle-user-status]", list).forEach((button) => {
    button.addEventListener("click", () => {
      const user = getUserById(button.dataset.toggleUserStatus);
      if (!user) return;
      
      const newActive = user.active === false;
      const result = updateUserLocal(user.id, {
        name: user.name,
        role: user.role,
        email: user.email,
        resourceId: user.resourceId,
        active: newActive
      });
      
      if (!result.ok) {
        notifyUser(result.message, "error");
      } else {
        saveState();
        render();
      }
    });
  });

  $$("[data-offboard-user]", list).forEach((button) => {
    button.addEventListener("click", async () => {
      const user = getUserById(button.dataset.offboardUser);
      const latestSnapshot = typeof getAccountAccessSnapshot === "function" ? getAccountAccessSnapshot() : null;
      const latestDecision = getWorkshopUserAdminUiDecision(latestSnapshot);
      if (!user || !isServerManagedLocalProfile(user) || !String(user.authUserId || "").trim()) return;
      if (!latestDecision.allowed) return notifyUser(latestDecision.reason, "error");
      if (String(user.authUserId) === String(latestSnapshot?.authIdentity?.id || "")) {
        return notifyUser("Vous ne pouvez pas retirer votre propre accès atelier.", "error");
      }
      const latestCapability = workshopUserAdminCapabilityState;
      if (getCanonicalUserRole(user) === "admin_technique" && latestCapability.activeAdminTechnicalCount <= 1) {
        return notifyUser("Le dernier administrateur technique actif ne peut pas être retiré.", "error");
      }
      const roleLabel = getAccountAccessRoleLabel(getCanonicalUserRole(user));
      const confirmed = await showConfirmModal(`Retirer l’accès atelier de <strong>${escapeHtml(user.name || "Collaborateur")}</strong>${user.email ? ` (${escapeHtml(user.email)})` : ""} ?<br><br>Rôle : <strong>${escapeHtml(roleLabel)}</strong><br><br>L’appartenance atelier sera révoquée immédiatement. L’historique sera conservé et le compte Auth sera ensuite supprimé côté serveur.`);
      if (!confirmed) return;
      button.disabled = true;
      const result = await invokeWorkshopUserAdmin("offboard_member", { user_id: String(user.authUserId) });
      if (!result?.ok) {
        button.disabled = false;
        return notifyUser(result?.message || "Retrait de l’accès impossible.", "error");
      }
      if (typeof refreshCurrentSupabaseIdentityMirror === "function") {
        await refreshCurrentSupabaseIdentityMirror("identity-offboarding-refresh");
      }
      await refreshWorkshopUserAdminCapabilities({ force: true });
      render();
      const message = result.code === "AUTH_CLEANUP_PENDING"
        ? "Accès atelier révoqué. Nettoyage du compte Auth encore en attente."
        : "Accès atelier retiré et compte Auth supprimé côté serveur.";
      notifyUser(message, result.code === "AUTH_CLEANUP_PENDING" ? "warn" : "success");
    });
  });
}
