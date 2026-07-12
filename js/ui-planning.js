function renderPlanning() {
  if (typeof getUiRuntimeIndexes === "function") getUiRuntimeIndexes({ force: true });
  const date = parseDateKey(state.planningDate);
  $("#planning-day-label").textContent = longDate(date);
  const alert = $("#day-alert");
  const holiday = getHoliday(date);
  const intervals = getDayIntervals(date);
  if (holiday || !intervals.length) {
    alert.hidden = false;
    alert.textContent = holiday ? `Jour férié: ${holiday.label}` : "Jour fermé";
  } else {
    alert.hidden = true;
  }

  const resources = orderPlanningResources(state.resources.filter(isDisplayPlanningResource));
  const dailyColorMap = buildIndexedDailyVehicleColorMap(todayKey(date));
  const taskNumberMap = buildDailyPlanningTaskNumberMap(date, resources);
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
      ${resources
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
                ${renderResourceBookings(resource, date, dayStart, dayEnd, total, dailyColorMap, taskNumberMap)}
              </div>
            </div>
          `,
        )
        .join("")}
    </div>
  `;
  renderDailyLaborSummary(date, taskNumberMap);
  renderMobilePlanningList(date, resources, taskNumberMap);
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

function renderDailyLaborSummary(date, taskNumberMap) {
  const target = document.getElementById('daily-labor-summary');
  if (!target) return;
  const day = todayKey(date);
  const rows = [];
  const dayBookings = typeof getIndexedDayBookings === "function" ? getIndexedDayBookings(day) : state.bookings;
  dayBookings.forEach((booking) => {
    if (booking.type === 'leave') return;
    const caseItem = typeof getIndexedCaseById === "function" ? getIndexedCaseById(booking.caseId) : state.cases.find((item) => item.id === booking.caseId);
    if (isCaseOperationallyClosed(caseItem)) return;
    const hasSegmentOnDay = (booking.segments || []).some((segment) => todayKey(new Date(segment.start)) === day || todayKey(new Date(segment.end)) === day);
    if (!caseItem || !hasSegmentOnDay) return;
    const ops = getBookingLaborOperations(caseItem, booking.key);
    rows.push({ booking, caseItem, ops });
  });
  if (!rows.length) {
    target.innerHTML = '<div class="empty-inline">Aucune main-d’œuvre planifiée sur cette journée.</div>';
    return;
  }
  target.innerHTML = `
    <div class="daily-labor-head"><strong>Détail main-d’œuvre du jour</strong><span>Chaque étape affiche les lignes devis incluses, plus rappel pièces/finition/contrôle.</span></div>
    <div class="daily-labor-list">
      ${rows.map(({ booking, caseItem, ops }, index) => `
        <article class="daily-labor-card">
          <strong>${index + 1}. ${escapeHtml(caseItem.clientName || 'Client')} · ${escapeHtml(getDurationLabel(booking.key) || booking.title || 'Étape')}</strong>
          <small>${escapeHtml(caseItem.vehicle || '')}${caseItem.plate ? ` · ${escapeHtml(caseItem.plate)}` : ''}</small>
          ${ops.length ? `<ul>${ops.map((op) => `<li>${escapeHtml(op)}</li>`).join('')}</ul>` : '<p class="muted">Aucune ligne MO détaillée rattachée à cette étape.</p>'}
        </article>
      `).join('')}
    </div>
  `;
}

function renderMobilePlanningList(date, resources, taskNumberMap) {
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
    target.innerHTML = '<div class="empty-inline">Aucune tâche atelier planifiée sur cette journée.</div>';
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
        const stage = getDurationLabel(booking.key) || booking.title || "Étape planning";
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
                <strong>${taskNumber ? `#${escapeHtml(String(taskNumber))} · ` : ""}${escapeHtml(model)}</strong>
                <span>${escapeHtml(plate || "Sans immatriculation/VIN")}</span>
              </div>
              <div class="mobile-planning-meta">
                <span>${escapeHtml(resource.name || "Ressource")}</span>
                <span>${escapeHtml(stage)}</span>
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

function renderResourceBookings(resource, date, dayStart, dayEnd, total, dailyColorMap = null, taskNumberMap = null) {
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
      const model = isLeave ? "Indisponible" : shortVehicleModel(caseItem?.vehicle || caseItem?.model || "Véhicule");
      const plate = isLeave ? "" : (caseItem?.plate || caseItem?.registration || "");
      const vehicleLine = isLeave ? (booking.title || "Congé / absence") : `${model}${plate ? ` · ${plate}` : ""}`;
      const stage = isLeave ? "Congé / absence" : (getDurationLabel(booking.key) || booking.title || "Étape planning");
      const timeLine = `${formatTime(clippedStart)}-${formatTime(clippedEnd)}`;
      const equipmentPrefix = isEquipmentResource(resource) ? `${ROLE_LABELS[resource.role] || "Équipement"} · ` : "";
      const taskNumber = taskNumberMap?.get(getPlanningTaskNumberKey(booking, segment)) || "";
      const shortStage = stage.replace("Tôlerie + démontage", "Tôlerie").replace("Peinture + vernis", "Peinture").replace("Contrôle qualité", "Contrôle");
      const laborOps = isLeave ? [] : getBookingLaborOperations(caseItem, booking.key);
      const taskStatus = isLeave ? "" : getBookingStatusLabel(booking);
      const blocked = !isLeave && typeof isCaseBlocked === "function" && isCaseBlocked(caseItem);
      const blockedLabel = blocked && typeof getCaseBlockerLabel === "function" ? getCaseBlockerLabel(caseItem) : "";
      const bookingTitle = `${taskNumber ? `Tâche n°${taskNumber} - ` : ""}${vehicleLine} - ${stage} - ${timeLine}${taskStatus ? ` - ${taskStatus}` : ""}${blocked ? ` - Dossier bloqué${blockedLabel ? `: ${blockedLabel}` : ""}` : ""}${laborOps.length ? `\nMO: ${laborOps.join(' · ')}` : ''}`;
      const maxTextLength = Math.max(vehicleLine.length, `${equipmentPrefix}${shortStage}`.length);
      const availableChars = Math.max(6, Math.floor(width * 1.35));
      const numberOnly = Boolean(taskNumber) && !isLeave && (width < 14 || maxTextLength > availableChars);
      const compactClass = `${blocked ? " blocked-booking" : ""}${!isLeave ? ` task-status-${escapeAttr(getBookingOperationalStatus(booking))}` : ""}${numberOnly ? " number-only-booking" : width < 8 ? " compact-booking" : ""}`;
      const color = getBookingPlanningColor(booking, dailyColorMap);
      items.push(`
        <div class="booking ${isLeave ? 'leave-booking' : ''}${compactClass}" style="left:${left}%;width:${width}%;background:${color}" title="${escapeAttr(bookingTitle)}" aria-label="${escapeAttr(bookingTitle)}">
          ${taskNumber ? `<span class="booking-number">${escapeHtml(String(taskNumber))}</span>` : ""}
          ${numberOnly ? "" : `<span class="booking-time">${escapeHtml(timeLine)}</span><strong>${escapeHtml(vehicleLine)}</strong><span class="booking-stage">${escapeHtml(equipmentPrefix)}${escapeHtml(width < 8 ? shortStage : stage)}</span>`}
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
              <input data-resource-field="name" data-resource-id="${resource.id}" value="${escapeAttr(resource.name)}" ${canEditPlanning ? "" : `disabled title="${escapeAttr(deniedTitle)}"`} />
            </label>
            <label>
              Rôle
              <select data-resource-field="role" data-resource-id="${resource.id}" ${canEditPlanning ? "" : `disabled title="${escapeAttr(deniedTitle)}"`}>
                ${Object.entries(ROLE_LABELS)
                  .map(([value, label]) => `<option value="${value}" ${resource.role === value ? "selected" : ""}>${label}</option>`)
                  .join("")}
              </select>
            </label>
            <label>
              Emplacement
              <input data-resource-field="location" data-resource-id="${resource.id}" value="${escapeAttr(resource.location || "")}" ${canEditPlanning ? "" : `disabled title="${escapeAttr(deniedTitle)}"`} />
            </label>
            <label>
              Site
              <select data-resource-field="site" data-resource-id="${resource.id}" ${canEditPlanning ? "" : `disabled title="${escapeAttr(deniedTitle)}"`}>
                <option value="internal" ${resource.site !== "external" ? "selected" : ""}>Interne atelier</option>
                <option value="external" ${resource.site === "external" ? "selected" : ""}>Sous-traitant externe</option>
              </select>
            </label>
            <label>
              Capacité simultanée
              <input type="number" min="1" step="1" data-resource-field="capacity" data-resource-id="${resource.id}" value="${Math.max(1, Number(resource.capacity || 1))}" ${canEditPlanning ? "" : `disabled title="${escapeAttr(deniedTitle)}"`} />
            </label>
            <label>
              Capacité journalière (min)
              <input type="number" min="0" step="15" data-resource-field="dailyCapacityMinutes" data-resource-id="${resource.id}" value="${Number(resource.dailyCapacityMinutes || 0) || ""}" placeholder="Selon calendrier" ${canEditPlanning ? "" : `disabled title="${escapeAttr(deniedTitle)}"`} />
            </label>
            ${resource.site === "external" ? `
              <label>Transfert aller (min)<input type="number" min="0" step="15" data-resource-field="transferOutMinutes" data-resource-id="${resource.id}" value="${Number(resource.transferOutMinutes || 0)}" ${canEditPlanning ? "" : `disabled title="${escapeAttr(deniedTitle)}"`} /></label>
              <label>Transfert retour (min)<input type="number" min="0" step="15" data-resource-field="transferReturnMinutes" data-resource-id="${resource.id}" value="${Number(resource.transferReturnMinutes || 0)}" ${canEditPlanning ? "" : `disabled title="${escapeAttr(deniedTitle)}"`} /></label>
              <label>Délai standard (min)<input type="number" min="0" step="15" data-resource-field="standardLeadTimeMinutes" data-resource-id="${resource.id}" value="${Number(resource.standardLeadTimeMinutes || 0)}" ${canEditPlanning ? "" : `disabled title="${escapeAttr(deniedTitle)}"`} /></label>
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
  return (typeof getIndexedCaseById === "function" ? getIndexedCaseById(activeCaseId) : state.cases.find((item) => item.id === activeCaseId)) || state.cases[0] || null;
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

function renderUsersAndRoles() {
  const form = document.getElementById("user-form");
  const list = document.getElementById("users-list");
  const switcher = document.getElementById("current-user-selector");
  if (!form || !list) return;

  const canManageUsers = typeof canRenderAction === "function" ? canRenderAction("users.manage") : false;
  const deniedTitle = canManageUsers ? "" : (typeof getPermissionDeniedMessage === "function" ? getPermissionDeniedMessage("users.manage") : "Action réservée administrateur.");

  form.hidden = !canManageUsers;
  list.hidden = !canManageUsers;
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

  // Also hide the h1 header of Utilisateurs & rôles if not allowed
  const panel = form.closest(".users-roles-panel");
  if (panel) {
    const heading = panel.querySelector(".panel-heading");
    if (heading) {
      heading.hidden = !canManageUsers;
      heading.style.display = canManageUsers ? "" : "none";
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
      const count = activeUsers.filter(ou => String(ou.email || "").trim().toLowerCase() === emailNorm && ou.role === u.role).length;
      if (count > 1 && !duplicates.includes(emailNorm + ":" + u.role)) {
        duplicates.push(emailNorm + ":" + u.role);
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
    const isTechWithoutRes = user.role === "technicien" && !user.resourceId;
    
    const roleLabel = USER_ROLES[user.role] || user.role;
    const activeLabel = user.active !== false ? `<span class="tag ok">Actif</span>` : `<span class="tag warn">Inactif</span>`;
    const currentBadge = isCurrent ? `<span class="tag" style="background:#e0f2fe;color:#0369a1;">Utilisateur actuel</span>` : "";
    const supabaseBadge = user.authUserId ? `<span class="tag soft" title="Supabase UID: ${escapeAttr(user.authUserId)}">Supabase</span>` : "";
    const isDuplicate = user.active !== false && user.email && activeUsers.some(ou => ou.id !== user.id && String(ou.email || "").trim().toLowerCase() === String(user.email || "").trim().toLowerCase() && ou.role === user.role);
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
          <button class="ghost-button" type="button" data-edit-user="${escapeAttr(user.id)}" ${canManageUsers ? "" : `disabled title="${escapeAttr(deniedTitle)}"`}>
            Modifier
          </button>
          <button class="ghost-button" type="button" data-toggle-user-status="${escapeAttr(user.id)}" ${canManageUsers ? "" : `disabled title="${escapeAttr(deniedTitle)}"`}>
            ${user.active === false ? "Activer" : "Désactiver"}
          </button>
        </div>
      </article>
    `;
  }).join("");

  if (switcher) {
    switcher.innerHTML = activeUsers.map(u => {
      const emailNorm = String(u.email || "").trim().toLowerCase();
      const isDup = emailNorm && activeUsers.some(ou => ou.id !== u.id && String(ou.email || "").trim().toLowerCase() === emailNorm && ou.role === u.role);
      const displayLabel = isDup 
        ? `${u.name} (${USER_ROLES[u.role] || u.role}) [Doublon: ${u.id.substring(5)}]`
        : `${u.name} (${USER_ROLES[u.role] || u.role})`;
      return `<option value="${escapeAttr(u.id)}" ${u.id === state.currentUserId ? 'selected' : ''}>${escapeHtml(displayLabel)}</option>`;
    }).join("");
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
}

