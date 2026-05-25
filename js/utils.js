function cloneBooking(booking) {
  return {
    ...booking,
    resourceIds: [...booking.resourceIds],
    segments: booking.segments.map((segment) => ({ ...segment })),
  };
}

function dayLoad(date) {
  return dayLoadForResources(date, (resource) => resource.active !== false);
}

function humanDayLoad(date) {
  return dayLoadForResources(date, isHumanPlanningResource);
}

function equipmentDayLoad(date) {
  return dayLoadForResources(date, (resource) => resource.active !== false && isEquipmentResource(resource));
}

const LOAD_CATEGORIES = {
  body: {
    humanRoles: ["tolier", "peintre", "controle"],
    equipmentRoles: ["zone_preparation", "cabine"],
    bookingKeys: ["body", "prep", "paint", "reassembly", "finish", "quality"],
  },
  fast: {
    humanRoles: ["mecanicien"],
    equipmentRoles: ["pont_vidange"],
    bookingKeys: ["oilService"],
  },
  heavy: {
    humanRoles: ["mecanicien", "electricien"],
    equipmentRoles: ["pont_mecanique"],
    bookingKeys: ["mechanical", "electrical"],
  },
};

function categoryHumanDayLoad(date, categoryKey) {
  const category = LOAD_CATEGORIES[categoryKey];
  if (!category) return 0;
  return dayLoadForCategory(
    date,
    (resource) => resource.active !== false && category.humanRoles.includes(resource.role),
    (booking) => booking.type === "leave" || category.bookingKeys.includes(booking.key)
  );
}

function categoryEquipmentDayLoad(date, categoryKey) {
  const category = LOAD_CATEGORIES[categoryKey];
  if (!category) return 0;
  return dayLoadForCategory(
    date,
    (resource) => resource.active !== false && category.equipmentRoles.includes(resource.role),
    (booking) => category.bookingKeys.includes(booking.key)
  );
}

function dayLoadForResources(date, predicate) {
  const resources = state.resources.filter((resource) => predicate(resource));
  if (!resources.length) return 0;

  const resourceIds = new Set(resources.map((resource) => resource.id));
  const intervals = getDayIntervals(date);
  const capacity = intervals.reduce((sum, interval) => sum + diffMinutes(interval.start, interval.end), 0) * resources.length;
  if (!capacity) return 0;

  let busy = 0;
  state.bookings.forEach((booking) => {
    const usedResourceIds = (booking.resourceIds || []).filter((resourceId) => resourceIds.has(resourceId));
    if (!usedResourceIds.length) return;

    booking.segments.forEach((segment) => {
      const start = new Date(segment.start);
      const end = new Date(segment.end);
      const minutes = overlapWithIntervalsMinutes(start, end, intervals);
      busy += minutes * usedResourceIds.length;
    });
  });

  return Math.min(1, busy / capacity);
}

function dayLoadForCategory(date, resourcePredicate, bookingPredicate) {
  const resources = state.resources.filter((resource) => resourcePredicate(resource));
  if (!resources.length) return 0;

  const resourceIds = new Set(resources.map((resource) => resource.id));
  const intervals = getDayIntervals(date);
  const capacity = intervals.reduce((sum, interval) => sum + diffMinutes(interval.start, interval.end), 0) * resources.length;
  if (!capacity) return 0;

  let busy = 0;
  state.bookings.forEach((booking) => {
    if (!bookingPredicate(booking)) return;
    const usedResourceIds = (booking.resourceIds || []).filter((resourceId) => resourceIds.has(resourceId));
    if (!usedResourceIds.length) return;

    booking.segments.forEach((segment) => {
      const start = new Date(segment.start);
      const end = new Date(segment.end);
      const minutes = overlapWithIntervalsMinutes(start, end, intervals);
      busy += minutes * usedResourceIds.length;
    });
  });

  return Math.min(1, busy / capacity);
}

function overlapWithIntervalsMinutes(start, end, intervals) {
  return intervals.reduce((sum, interval) => {
    const overlapStart = new Date(Math.max(start.getTime(), interval.start.getTime()));
    const overlapEnd = new Date(Math.min(end.getTime(), interval.end.getTime()));
    if (overlapEnd <= overlapStart) return sum;
    return sum + diffMinutes(overlapStart, overlapEnd);
  }, 0);
}

function totalDurationHours(item) {
  return DURATIONS.reduce((sum, [key]) => sum + Number(item.durations[key] || 0), 0);
}

function expertEstimateTotalHours(item) {
  return (item.expertEstimate?.lines || []).reduce((sum, line) => sum + Number(line.laborHours || 0), 0);
}

function expertEstimateTotalsByPhase(item) {
  const totals = Object.fromEntries(DURATIONS.map(([key]) => [key, 0]));
  (item.expertEstimate?.lines || []).forEach((line) => {
    if (line.phase in totals) totals[line.phase] += Number(line.laborHours || 0);
  });
  return Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, roundHours(value)]));
}

function expertEstimateMatchesDurations(item) {
  if (!item.expertEstimate?.confirmed || expertEstimateTotalHours(item) <= 0) return true;
  const totals = expertEstimateTotalsByPhase(item);
  return ESTIMATE_PLANNING_KEYS.every((key) => Math.abs(Number(item.durations[key] || 0) - Number(totals[key] || 0)) < 0.01);
}

function applyExpertEstimateToDurations(item) {
  const totals = expertEstimateTotalsByPhase(item);
  ESTIMATE_PLANNING_KEYS.forEach((key) => {
    item.durations[key] = totals[key] || 0;
  });
  if (Number(totals.quality || 0) > 0) item.durations.quality = totals.quality;
  generatedProposals[item.id] = null;
  addHistory(item, "expert.estimate.applied", "Quantités MO expert appliquées au planning", `Total MO: ${formatLocalizedDecimal(expertEstimateTotalHours(item))} h`);
}

function shortVehicleModel(vehicleText) {
  const original = String(vehicleText || "Véhicule");
  const text = original.toUpperCase().replace(/\s+/g, " ").trim();
  const compactText = text.replace(/[^A-Z0-9]/g, "");

  // Les devis NAV peuvent écrire le pickup comme RICH6, RICH 6, PICKUP DFM RICH6 4X4, etc.
  // En planning, on doit afficher seulement le modèle commercial lisible.
  if (/\bRICH\s*6\b/i.test(text) || compactText.includes("RICH6")) return "RICH 6";

  const knownModels = [
    "SHINE MAX HEV",
    "DFSK E5 PHEV",
    "SHINE DCT",
    "SHINE MT",
    "GLORY 580",
    "GLORY 500",
    "GLORY IX5",
    "T5 EVO",
    "S50",
    "SX3",
    "AX4",
    "BOX",
  ];
  const match = knownModels.find((model) => text.includes(model));
  if (match) return match;
  return original.replace(/^(DFM|DFSK|DONGFENG)\s+/i, "").trim() || "Véhicule";
}

function isEquipmentResource(resource) {
  return ["zone_preparation", "cabine", "pont_vidange", "pont_mecanique"].includes(resource?.role);
}

function isDisplayPlanningResource(resource) {
  return resource?.active !== false;
}

function isHumanPlanningResource(resource) {
  return resource?.active !== false && !isEquipmentResource(resource);
}


function getPlanningResourceOrder(resource) {
  const humanOrder = { tolier: 10, peintre: 20, mecanicien: 30, electricien: 40, controle: 50 };
  const equipmentOrder = { pont_vidange: 105, pont_mecanique: 106, zone_preparation: 110, cabine: 120 };
  if (isEquipmentResource(resource)) return equipmentOrder[resource?.role] || 199;
  return humanOrder[resource?.role] || 90;
}

function orderPlanningResources(resources) {
  return [...(resources || [])].sort((a, b) => {
    const orderDiff = getPlanningResourceOrder(a) - getPlanningResourceOrder(b);
    if (orderDiff !== 0) return orderDiff;
    return String(a?.name || a?.id || '').localeCompare(String(b?.name || b?.id || ''));
  });
}

function isBookingVisibleForResource(booking, resourceId) {
  return Boolean(booking?.resourceIds?.includes(resourceId));
}

function getPrimaryResourceId(booking) {
  return booking?.primaryResourceId || booking?.resourceIds?.[0] || null;
}

function isPrimaryResourceBooking(booking, resourceId) {
  return Boolean(booking?.resourceIds?.includes(resourceId) && getPrimaryResourceId(booking) === resourceId);
}

function sumDurations(item) {
  return formatLocalizedDecimal(totalDurationHours(item));
}

function parseLocalizedDecimal(value) {
  const normalized = String(value ?? "")
    .trim()
    .replace(/\s/g, "")
    .replace(",", ".");
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatLocalizedDecimal(value) {
  return Number(value || 0)
    .toFixed(2)
    .replace(/\.00$/, "")
    .replace(/(\.\d)0$/, "$1")
    .replace(".", ",");
}

function roundHours(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function getDurationLabel(key) {
  return DURATIONS.find(([durationKey]) => durationKey === key)?.[1] || key;
}

function addWorkingMinutes(date, minutes) {
  const slot = buildWorkingSlot(date, minutes);
  return slot.end;
}

function nextWorkingTime(date) {
  let cursor = roundUp(new Date(date), STEP_MINUTES);
  const horizon = addDays(cursor, 365);
  while (cursor < horizon) {
    const intervals = getDayIntervals(cursor);
    for (const interval of intervals) {
      if (cursor <= interval.end) {
        if (cursor < interval.start) return new Date(interval.start);
        if (cursor < interval.end) return new Date(cursor);
      }
    }
    cursor = startOfDay(addDays(cursor, 1));
  }
  throw new Error("Aucun horaire de travail trouvé.");
}

function getDayIntervals(dateLike) {
  const date = new Date(dateLike);
  if (getHoliday(date)) return [];
  return (state.workHours?.[date.getDay()] || []).map(([start, end]) => ({
    start: atTime(date, start),
    end: atTime(date, end),
  }));
}

function getHoliday(dateLike) {
  const key = todayKey(dateLike);
  return state.holidays.find((holiday) => holiday.date === key) || null;
}

function getResource(id) {
  return state.resources.find((resource) => resource.id === id);
}

function addDays(dateLike, days) {
  const date = new Date(dateLike);
  date.setDate(date.getDate() + days);
  return date;
}

function addMinutes(dateLike, minutes) {
  const date = new Date(dateLike);
  date.setMinutes(date.getMinutes() + minutes, 0, 0);
  return date;
}

function diffMinutes(start, end) {
  return Math.max(0, Math.round((new Date(end) - new Date(start)) / 60000));
}

function startOfDay(dateLike) {
  const date = new Date(dateLike);
  date.setHours(0, 0, 0, 0);
  return date;
}

function atTime(dateLike, time) {
  const [hours, minutes] = time.split(":").map(Number);
  const date = startOfDay(dateLike);
  date.setHours(hours, minutes, 0, 0);
  return date;
}

function roundUp(dateLike, step) {
  const date = new Date(dateLike);
  const minutes = date.getMinutes();
  const rounded = Math.ceil(minutes / step) * step;
  date.setMinutes(rounded, 0, 0);
  return date;
}

function maxDate(a, b) {
  return new Date(Math.max(new Date(a), new Date(b)));
}

function minDate(a, b) {
  return new Date(Math.min(new Date(a), new Date(b)));
}

function parseDateKey(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function todayKey(dateLike) {
  const date = new Date(dateLike);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDate(value) {
  return new Intl.DateTimeFormat("fr-TN", { dateStyle: "medium" }).format(new Date(value));
}

function longDate(value) {
  const date = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? parseDateKey(value) : new Date(value);
  return new Intl.DateTimeFormat("fr-TN", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(date);
}

function formatTime(value) {
  return new Intl.DateTimeFormat("fr-TN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}

function formatDateTime(value) {
  return `${formatDate(value)} ${formatTime(value)}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("\n", " ");
}

function getFocusableElements(container) {
  if (!container) return [];
  return $$(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    container,
  ).filter((element) => !element.hidden && element.offsetParent !== null);
}

function trapFocusWithin(container, event) {
  if (event.key !== "Tab") return;
  const focusable = getFocusableElements(container);
  if (!focusable.length) {
    event.preventDefault();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function showUpdateAvailable(registration) {
  const region = $("#toast-region");
  if (!region) return;
  const existing = region.querySelector(".update-toast");
  if (existing) return;
  const toast = document.createElement("div");
  toast.className = "toast toast-info update-toast";
  toast.setAttribute("role", "status");
  const text = document.createElement("span");
  text.textContent = "Nouvelle version disponible. Rechargez quand la saisie en cours est terminée.";
  const version = document.createElement("small");
  version.textContent = window.NIMR_BUILD ? `Version actuelle : ${window.NIMR_BUILD}` : "Version prête";
  const later = document.createElement("button");
  later.type = "button";
  later.className = "ghost-button";
  later.textContent = "Plus tard";
  later.addEventListener("click", () => toast.remove());
  const button = document.createElement("button");
  button.type = "button";
  button.className = "primary-button";
  button.textContent = "Enregistrer et recharger";
  button.addEventListener("click", async () => {
    await Promise.resolve(forceEmergencyAutosave());
    button.disabled = true;
    button.textContent = "Rechargement...";
    if (registration?.waiting) {
      registration.waiting.postMessage({ type: "SKIP_WAITING" });
    } else {
      window.location.reload();
    }
  });
  const actions = document.createElement("div");
  actions.className = "update-toast-actions";
  actions.append(later, button);
  toast.append(text, version, actions);
  region.appendChild(toast);
}

function setupServiceWorkerUpdates(registration) {
  if (!registration) return;
  registration.addEventListener("updatefound", () => {
    const worker = registration.installing;
    if (!worker) return;
    worker.addEventListener("statechange", () => {
      if (worker.state === "installed" && navigator.serviceWorker.controller) {
        showUpdateAvailable(registration);
      }
    });
  });
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!window.__nimrReloadingForUpdate) {
      window.__nimrReloadingForUpdate = true;
      forceEmergencyAutosave();
      window.location.reload();
    }
  });
}

function setActiveTab(tab) {
  activeTab = tab;
  $$(".nav-button").forEach((button) => {
    const active = button.dataset.tab === tab;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  $$(".view").forEach((view) => {
    const active = view.id === `view-${tab}`;
    view.classList.toggle("active", active);
    view.toggleAttribute("hidden", !active);
  });
}

function normalizeTextInputValue(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function normalizeIdentifierValue(value) {
  return normalizeTextInputValue(value).toUpperCase();
}

function findDuplicateCase(candidate) {
  const vin = normalizeIdentifierValue(candidate.vin);
  const plate = normalizeIdentifierValue(candidate.plate);
  return state.cases.find((item) => {
    const sameVin = vin && normalizeIdentifierValue(item.vin) === vin;
    const samePlate = plate && normalizeIdentifierValue(item.plate) === plate;
    return sameVin || samePlate;
  }) || null;
}

function focusCaseSearch() {
  setActiveTab("dossiers");
  const input = $("#case-search");
  input?.focus();
  input?.select();
}

function bindKeyboardShortcuts() {
  document.addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && key === "k") {
      event.preventDefault();
      focusCaseSearch();
    }
    if ((event.ctrlKey || event.metaKey) && key === "n") {
      event.preventDefault();
      setActiveTab("dossiers");
      $("#case-form input[name='clientName']")?.focus();
    }
  });
}



const VEHICLE_PLANNING_COLORS = [
  // Palette Gantt ultra contrastée.
  // Les couleurs proches (deux rouges/oranges/verts côte à côte) ont été retirées.
  // Objectif atelier : identifier une voiture en moins d'une seconde sur toute la journée.
  "#0057B8", // bleu franc
  "#D00000", // rouge franc
  "#00843D", // vert franc
  "#7B2CBF", // violet franc
  "#FF6B00", // orange vif
  "#0096C7", // cyan
  "#C2185B", // rose foncé
  "#6D4C41", // brun distinct
  "#003049", // bleu nuit
  "#8A8F00", // olive
  "#E10098", // fuchsia
  "#00796B", // sarcelle
  "#B00020", // bordeaux
  "#3F51B5", // indigo
  "#546E7A", // bleu gris
  "#A15C00", // ambre brun
];

const MIN_PLANNING_COLOR_DISTANCE = 135;

function parsePlanningHexColor(color) {
  const match = String(color || "").trim().match(/^#([0-9a-f]{6})$/i);
  if (!match) return null;
  const value = match[1];
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

function getPlanningColorDistance(leftColor, rightColor) {
  const left = parsePlanningHexColor(leftColor);
  const right = parsePlanningHexColor(rightColor);
  if (!left || !right) return 0;
  const redMean = (left.r + right.r) / 2;
  const red = left.r - right.r;
  const green = left.g - right.g;
  const blue = left.b - right.b;
  // Distance perceptuelle simple : elle penalise fortement les teintes proches vues dans le Gantt.
  return Math.sqrt((2 + redMean / 256) * red * red + 4 * green * green + (2 + (255 - redMean) / 256) * blue * blue);
}

function isPlanningColorTooClose(color, usedColors = new Set(), minDistance = MIN_PLANNING_COLOR_DISTANCE) {
  for (const usedColor of usedColors) {
    if (getPlanningColorDistance(color, usedColor) < minDistance) return true;
  }
  return false;
}

function hashPlanningColorSeed(seed) {
  const normalized = String(seed || "vehicule").trim().toUpperCase();
  let hash = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    hash = ((hash << 5) - hash + normalized.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

function isValidVehiclePlanningColor(color) {
  return VEHICLE_PLANNING_COLORS.includes(String(color || "").trim());
}

function isCaseStillInWorkshopFlow(item) {
  return Boolean(item && item.flags?.delivered !== true);
}

function getVehiclePlanningColorSeed(item) {
  return item?.vin || item?.plate || item?.registration || item?.id || item?.vehicle || item?.model || "vehicule";
}

function pickAvailableVehiclePlanningColor(item, usedColors = new Set()) {
  const seed = getVehiclePlanningColorSeed(item);
  const startIndex = hashPlanningColorSeed(seed) % VEHICLE_PLANNING_COLORS.length;
  const orderedColors = VEHICLE_PLANNING_COLORS.map((color, index) => ({
    color,
    index,
    seedDistance: (index - startIndex + VEHICLE_PLANNING_COLORS.length) % VEHICLE_PLANNING_COLORS.length,
  }));

  const candidates = orderedColors
    .filter(({ color }) => !usedColors.has(color))
    .map((candidate) => ({
      ...candidate,
      minDistance: usedColors.size
        ? Math.min(...[...usedColors].map((usedColor) => getPlanningColorDistance(candidate.color, usedColor)))
        : Number.POSITIVE_INFINITY,
    }))
    .sort((left, right) => {
      // Priorité à la couleur la plus éloignée des couleurs déjà visibles aujourd'hui.
      const distanceDiff = right.minDistance - left.minDistance;
      if (Math.abs(distanceDiff) > 0.001) return distanceDiff;
      return left.seedDistance - right.seedDistance;
    });

  const distantCandidate = candidates.find((candidate) => candidate.minDistance >= MIN_PLANNING_COLOR_DISTANCE);
  return (distantCandidate || candidates[0] || orderedColors[startIndex]).color;
}

function getActivePlanningColorCaseIds() {
  const ids = new Set();
  (state.bookings || []).forEach((booking) => {
    if (booking?.caseId && booking.type !== "leave") ids.add(booking.caseId);
  });
  (state.cases || []).forEach((item) => {
    if (item?.appointment && isCaseStillInWorkshopFlow(item)) ids.add(item.id);
  });
  return [...ids];
}

function reconcileVehiclePlanningColors() {
  const activeIds = getActivePlanningColorCaseIds();
  const activeItems = activeIds
    .map((caseId) => state.cases.find((item) => item.id === caseId))
    .filter(Boolean)
    .sort((left, right) => {
      const leftStart = left.appointment?.start ? new Date(left.appointment.start).getTime() : 0;
      const rightStart = right.appointment?.start ? new Date(right.appointment.start).getTime() : 0;
      return leftStart - rightStart || String(left.id).localeCompare(String(right.id));
    });
  const usedColors = new Set();
  activeItems.forEach((item) => {
    const currentColor = item.planningColor;
    if (
      isValidVehiclePlanningColor(currentColor)
      && !usedColors.has(currentColor)
      && !isPlanningColorTooClose(currentColor, usedColors)
    ) {
      usedColors.add(currentColor);
      return;
    }
    item.planningColor = pickAvailableVehiclePlanningColor(item, usedColors);
    usedColors.add(item.planningColor);
  });
}

function getVehiclePlanningColor(item) {
  if (!item) return VEHICLE_PLANNING_COLORS[0];
  if (isValidVehiclePlanningColor(item.planningColor)) return item.planningColor;
  item.planningColor = pickAvailableVehiclePlanningColor(item);
  return item.planningColor;
}

function getBookingPlanningColor(booking, colorMap = null) {
  if (booking?.type === "leave") return booking.color || "#6b7280";
  if (typeof getBookingOperationalStatus === "function" && getBookingOperationalStatus(booking) === "completed") return "#64748b";
  const item = state.cases.find((caseItem) => caseItem.id === booking?.caseId);
  if (item) return getVehiclePlanningColor(item);
  if (colorMap && booking?.caseId && colorMap[booking.caseId]) return colorMap[booking.caseId];
  return booking?.color || "#11415f";
}

function bookingTouchesDay(booking, dateKey) {
  return Boolean(booking?.segments?.some((segment) => {
    const start = new Date(segment.start);
    const end = new Date(segment.end);
    return todayKey(start) === dateKey || todayKey(end) === dateKey;
  }));
}

function buildDailyVehicleColorMap(dateKey) {
  reconcileVehiclePlanningColors();
  const map = {};
  (state.bookings || []).forEach((booking) => {
    if (!booking?.caseId || booking.type === "leave" || !bookingTouchesDay(booking, dateKey)) return;
    const item = state.cases.find((caseItem) => caseItem.id === booking.caseId);
    map[booking.caseId] = getVehiclePlanningColor(item) || booking.color || "#11415f";
  });
  return map;
}
