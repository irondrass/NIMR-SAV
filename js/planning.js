function generateAppointmentOptions(item) {
  try {
    const proposal = generateSingleProposal(item, new Date());
    return {
      proposal,
      availableDates: buildAvailableAppointmentDates(item, new Date(), 60, 14),
    };
  } catch (error) {
    return { error: error.message || "Impossible de calculer un rendez-vous." };
  }
}

function generateSingleProposal(item, startAfter) {
  const bookings = state.bookings.filter((booking) => booking.caseId !== item.id).map(cloneBooking);
  return schedulePipeline(item, startAfter, bookings);
}

function buildAvailableAppointmentDates(item, fromDate, horizonDays = 60, limit = 14) {
  const available = [];
  let day = startOfDay(fromDate);
  for (let index = 0; index < horizonDays && available.length < limit; index += 1) {
    const intervals = getDayIntervals(day);
    if (intervals.length) {
      const dayStart = todayKey(day) === todayKey(new Date()) ? maxDate(new Date(), intervals[0].start) : intervals[0].start;
      try {
        const proposal = generateSingleProposal(item, dayStart);
        if (todayKey(proposal.start) === todayKey(day)) {
          available.push({
            date: todayKey(day),
            proposal,
          });
        }
      } catch (error) {
        // Date ignored: no complete atelier pipeline can start on this day.
      }
    }
    day = startOfDay(addDays(day, 1));
  }
  return available;
}

function getPlanningTemplateForItem(item, baseTemplate) {
  const selectedType = item?.stepServiceTypes?.[baseTemplate.key] || "auto";
  if (!selectedType || selectedType === "auto" || !SERVICE_TYPE_CONFIG[selectedType]) {
    return baseTemplate;
  }
  const config = SERVICE_TYPE_CONFIG[selectedType];
  const template = { ...baseTemplate };
  template.role = config.role || baseTemplate.role;
  template.title = config.title || baseTemplate.title;
  if (Object.prototype.hasOwnProperty.call(config, "equipmentRole")) {
    template.equipmentRole = config.equipmentRole || undefined;
  } else if (selectedType === "peinture") {
    if (baseTemplate.key === "prep") template.equipmentRole = "zone_preparation";
    else if (baseTemplate.key === "paint") template.equipmentRole = "cabine";
    else template.equipmentRole = undefined;
  } else if (selectedType === "mecanique" && baseTemplate.key === "oilService") {
    template.equipmentRole = "pont_vidange";
  }
  return template;
}

function getAnticipatedNewPartPlanningSplit(item) {
  const split = { prep: 0, paint: 0, rows: [] };
  (item?.claims || []).forEach((claim) => {
    if (claim?.includeInPlanning === false) return;
    const sourceLines = Array.isArray(claim?.estimate?.originalLines) ? claim.estimate.originalLines : [];
    sourceLines.forEach((line) => {
      const pieceKind = line?.pieceKind || (typeof inferPieceKind === "function" ? inferPieceKind(line?.operation || line?.rawText || "") : "");
      if (pieceKind !== "new") return;
      const allocations = Array.isArray(line?.allocations) ? line.allocations : [];
      const prep = allocations.reduce((sum, allocation) => allocation.phase === "prep" ? sum + Number(allocation.laborHours || 0) : sum, 0);
      const paint = allocations.reduce((sum, allocation) => allocation.phase === "paint" ? sum + Number(allocation.laborHours || 0) : sum, 0);
      if (prep <= 0 && paint <= 0) return;
      split.prep += prep;
      split.paint += paint;
      split.rows.push({ claimLabel: [claim.number, claim.title].filter(Boolean).join(" - ") || "Ordre de réparation", operation: line.operation || line.rawText || "Pièce neuve à remplacer", prep, paint });
    });
  });
  split.prep = Math.min(roundHours(split.prep), Number(item?.durations?.prep || 0));
  split.paint = Math.min(roundHours(split.paint), Number(item?.durations?.paint || 0));
  return split;
}

function hasAnticipatedNewPartPlanning(item) {
  const split = getAnticipatedNewPartPlanningSplit(item);
  return split.prep > 0;
}

function makePlanningStep(item, template, match, options = {}) {
  const resourceIds = match.resourceIds;
  return { key: template.key, title: options.title || template.title, start: match.slot.start.toISOString(), end: match.slot.end.toISOString(), segments: match.slot.segments, resourceIds, primaryResourceId: match.primary.id, equipmentResourceIds: match.equipment ? [match.equipment.id] : [], color: getVehiclePlanningColor(item), planningMode: options.planningMode || "standard", details: options.details || "" };
}

function scheduleSingleStep(item, template, cursor, duration, tempBookings, assignment, fastJob, title, details, planningMode = "standard") {
  if (duration <= 0) return null;
  const preferredPrimaryId = getPreferredPrimaryResourceId(template, assignment, item);
  const match = findBestResourceSlot(template, cursor, duration, tempBookings, fastJob, preferredPrimaryId);
  if (!match) throw new Error(`Aucune disponibilité pour ${title || template.title}.`);
  rememberPrimaryAssignment(template, assignment, match.primary.id);
  const step = makePlanningStep(item, template, match, { title: title || template.title, details, planningMode });
  tempBookings.push(stepToBooking(item, step, true));
  return step;
}

function schedulePipeline(item, startAfter, bookings) {
  const split = getAnticipatedNewPartPlanningSplit(item);
  if (split.prep <= 0 && split.paint <= 0) return scheduleSequentialPipeline(item, startAfter, bookings);
  return schedulePipelineWithAnticipatedNewParts(item, startAfter, bookings, split);
}

function scheduleSequentialPipeline(item, startAfter, bookings) {
  const steps = [];
  let cursor = nextWorkingTime(startAfter);
  let totalMinutes = 0;
  const tempBookings = [...bookings];
  const fastJob = isFastLaneJob(item);
  const assignment = createPlanningAssignmentContext();
  STEP_TEMPLATES.forEach((baseTemplate) => {
    const template = getPlanningTemplateForItem(item, baseTemplate);
    const hours = Number(item.durations[template.key] || 0);
    if (hours <= 0) return;
    const duration = Math.max(15, Math.round(hours * 60));
    totalMinutes += duration;
    const step = scheduleSingleStep(item, template, cursor, duration, tempBookings, assignment, fastJob);
    if (!step) return;
    steps.push(step);
    cursor = new Date(step.end);
  });
  if (!steps.length) throw new Error("Renseignez au moins une durée atelier pour calculer un RDV.");
  const marginMinutes = Math.ceil((totalMinutes * 0.2) / STEP_MINUTES) * STEP_MINUTES;
  const delivery = addWorkingMinutes(new Date(steps.at(-1).end), marginMinutes);
  return { start: steps[0].start, end: steps.at(-1).end, delivery: delivery.toISOString(), marginMinutes, steps, anticipatedNewParts: null };
}

function schedulePipelineWithAnticipatedNewParts(item, startAfter, bookings, split) {
  // Anticipation uniquement sur la préparation des pièces neuves à remplacer.
  // La peinture reste dans le flux peinture normal pour grouper pièce neuve + pièce réparée.
  // Si aucun peintre ou aucune zone de préparation n'est libre au démarrage du véhicule,
  // on conserve le flux normal complet afin de ne pas créer une fausse optimisation.
  if (split.prep <= 0) return scheduleSequentialPipeline(item, startAfter, bookings);

  const steps = [];
  const tempBookings = [...bookings];
  const fastJob = isFastLaneJob(item);
  const vehicleAssignment = createPlanningAssignmentContext();
  const paintAssignment = createPlanningAssignmentContext();
  const templateByKey = Object.fromEntries(STEP_TEMPLATES.map((template) => [template.key, template]));
  const startCursor = nextWorkingTime(startAfter);
  let vehicleCursor = startCursor;
  let totalMinutes = 0;
  let bodyStep = null;
  let anticipatedPrepStep = null;

  const bodyTemplate = templateByKey.body ? getPlanningTemplateForItem(item, templateByKey.body) : null;
  const bodyHours = bodyTemplate ? Number(item.durations?.[bodyTemplate.key] || 0) : 0;

  if (bodyTemplate && bodyHours > 0) {
    const duration = Math.max(15, Math.round(bodyHours * 60));
    totalMinutes += duration;
    bodyStep = scheduleSingleStep(item, bodyTemplate, vehicleCursor, duration, tempBookings, vehicleAssignment, fastJob);
    steps.push(bodyStep);
    vehicleCursor = new Date(bodyStep.end);
  }

  if (!bodyStep) return scheduleSequentialPipeline(item, startAfter, bookings);

  const prepTemplate = templateByKey.prep ? getPlanningTemplateForItem(item, templateByKey.prep) : null;
  if (!prepTemplate) return scheduleSequentialPipeline(item, startAfter, bookings);

  const prepDuration = Math.max(15, Math.round(split.prep * 60));
  const trialBookings = [...tempBookings];
  try {
    const trialStep = scheduleSingleStep(
      item,
      prepTemplate,
      startCursor,
      prepDuration,
      trialBookings,
      paintAssignment,
      fastJob,
      "Préparation anticipée pièces neuves",
      "Pièces neuves/remplacées préparées en parallèle de la tôlerie. La peinture reste groupée avec les autres éléments.",
      "anticipated-new-part"
    );
    const startsAtVehicleStart = Math.abs(new Date(trialStep.start).getTime() - startCursor.getTime()) < 1000;
    const capacityBusyDuringBodyStart = findConflict(
      { segments: [{ start: bodyStep.start, end: bodyStep.end }] },
      trialStep.resourceIds,
      bookings
    );
    if (!startsAtVehicleStart || capacityBusyDuringBodyStart) return scheduleSequentialPipeline(item, startAfter, bookings);
    anticipatedPrepStep = trialStep;
    tempBookings.splice(0, tempBookings.length, ...trialBookings);
    steps.push(anticipatedPrepStep);
    totalMinutes += prepDuration;
  } catch (error) {
    return scheduleSequentialPipeline(item, startAfter, bookings);
  }

  STEP_TEMPLATES.forEach((baseTemplate) => {
    if (baseTemplate.key === "body") return;
    const template = getPlanningTemplateForItem(item, baseTemplate);
    let hours = Number(item.durations?.[template.key] || 0);
    if (template.key === "prep") hours = Math.max(0, hours - split.prep);
    // Ne jamais soustraire split.paint : aucune peinture anticipée n'est créée.
    if (hours <= 0) return;
    const duration = Math.max(15, Math.round(hours * 60));
    totalMinutes += duration;
    const step = scheduleSingleStep(item, template, vehicleCursor, duration, tempBookings, vehicleAssignment, fastJob);
    steps.push(step);
    vehicleCursor = new Date(step.end);
  });

  if (!steps.length) throw new Error("Renseignez au moins une durée atelier pour calculer un RDV.");
  steps.sort((a, b) => new Date(a.start) - new Date(b.start) || String(a.title).localeCompare(String(b.title)));
  const endDate = steps.reduce((latest, step) => maxDate(latest, new Date(step.end)), new Date(steps[0].end));
  const marginMinutes = Math.ceil((totalMinutes * 0.2) / STEP_MINUTES) * STEP_MINUTES;
  const delivery = addWorkingMinutes(endDate, marginMinutes);
  return {
    start: steps[0].start,
    end: endDate.toISOString(),
    delivery: delivery.toISOString(),
    marginMinutes,
    steps,
    anticipatedNewParts: {
      prepHours: roundHours(split.prep),
      paintHours: 0,
      originalPrepHours: split.prep,
      originalPaintHours: split.paint,
      lines: split.rows,
      partsReadyAt: anticipatedPrepStep?.end || null,
      mode: "prep-only-if-capacity",
    },
  };
}

function createPlanningAssignmentContext() {
  return { tolierId: null, painterId: null };
}

function getPreferredPrimaryResourceId(template, assignment, item = null) {
  const manual = item?.stepPreferredResources?.[template.key] || "";
  if (manual && state.resources.some((resource) => resource.id === manual && resource.role === template.role && resource.active !== false)) {
    return manual;
  }
  if (template.key === "reassembly") return assignment.tolierId;
  if (["paint", "finish"].includes(template.key)) return assignment.painterId;
  return null;
}

function rememberPrimaryAssignment(template, assignment, primaryResourceId) {
  if (!primaryResourceId) return;
  if (template.key === "body") assignment.tolierId = primaryResourceId;
  if (template.key === "prep") assignment.painterId = primaryResourceId;
}

function findBestResourceSlot(template, startAfter, duration, bookings, fastJob, preferredPrimaryId = null) {
  const primaryResources = orderPrimaryResourcesForStep(template.role, fastJob, bookings, startAfter, preferredPrimaryId);
  const equipmentResources = template.equipmentRole
    ? getAssignableResources(template.equipmentRole, fastJob)
    : [null];
  let best = null;
  primaryResources.forEach((primary, primaryIndex) => {
    equipmentResources.forEach((equipment, equipmentIndex) => {
      const resourceIds = equipment ? [primary.id, equipment.id] : [primary.id];
      const slot = findEarliestSlot(resourceIds, startAfter, duration, bookings);
      if (!slot) return;
      const candidate = {
        slot,
        resourceIds,
        primary,
        equipment,
        primaryIndex,
        equipmentIndex,
        preferred: preferredPrimaryId && primary.id === preferredPrimaryId,
        loadMinutes: getResourceLoadMinutes(primary.id, bookings, startAfter),
      };
      if (!best || compareSlots(candidate, best) < 0) best = candidate;
    });
  });
  return best;
}

function getAssignableResources(role, fastJob) {
  return state.resources
    .filter((resource) => resource.role === role && resource.active !== false)
    .filter((resource) => !state.settings.fastLaneEnabled || fastJob || !resource.fastLane)
    .sort((a, b) => {
      if (!state.settings.fastLaneEnabled || !fastJob) return 0;
      return Number(Boolean(b.fastLane)) - Number(Boolean(a.fastLane));
    });
}

function orderPrimaryResourcesForStep(role, fastJob, bookings, startAfter, preferredPrimaryId = null) {
  const resources = getAssignableResources(role, fastJob);
  if (preferredPrimaryId) {
    const preferred = resources.find((resource) => resource.id === preferredPrimaryId);
    if (preferred) {
      return [preferred, ...resources.filter((resource) => resource.id !== preferredPrimaryId)];
    }
  }
  if (["tolier", "peintre"].includes(role)) {
    return [...resources].sort((a, b) => {
      const loadDiff = getResourceLoadMinutes(a.id, bookings, startAfter) - getResourceLoadMinutes(b.id, bookings, startAfter);
      if (loadDiff !== 0) return loadDiff;
      return String(a.name || a.id).localeCompare(String(b.name || b.id));
    });
  }
  return resources;
}

function getResourceLoadMinutes(resourceId, bookings, fromDate) {
  const from = startOfDay(fromDate || new Date());
  const until = addDays(from, 14);
  return bookings.reduce((sum, booking) => {
    if (!isPlanningBlockingBooking(booking)) return sum;
    if (!isPrimaryResourceBooking(booking, resourceId)) return sum;
    return sum + booking.segments.reduce((segmentSum, segment) => {
      const start = maxDate(new Date(segment.start), from);
      const end = minDate(new Date(segment.end), until);
      return end > start ? segmentSum + diffMinutes(start, end) : segmentSum;
    }, 0);
  }, 0);
}

function isFastLaneJob(item) {
  if (!state.settings.fastLaneEnabled) return false;
  return repairDurationHours(item) <= Number(state.settings.fastLaneMaxHours || FAST_LANE_DEFAULT_HOURS);
}

function repairDurationHours(item) {
  return ["body", "mechanical", "electrical", "prep", "paint", "reassembly", "finish"].reduce((sum, key) => sum + Number(item.durations[key] || 0), 0);
}

function compareSlots(a, b) {
  if (a.preferred !== b.preferred) return a.preferred ? -1 : 1;
  const startDiff = new Date(a.slot.start) - new Date(b.slot.start);
  if (startDiff !== 0) return startDiff;
  const endDiff = new Date(a.slot.end) - new Date(b.slot.end);
  if (endDiff !== 0) return endDiff;
  const loadDiff = (a.loadMinutes || 0) - (b.loadMinutes || 0);
  if (loadDiff !== 0) return loadDiff;
  if (a.primaryIndex !== b.primaryIndex) return a.primaryIndex - b.primaryIndex;
  return a.equipmentIndex - b.equipmentIndex;
}

function findEarliestSlot(resourceIds, startAfter, duration, bookings) {
  let cursor = nextWorkingTime(startAfter);
  const horizon = addDays(cursor, MAX_PLANNING_SEARCH_DAYS);
  let iterations = 0;
  while (cursor < horizon && iterations < MAX_PLANNING_ITERATIONS) {
    iterations += 1;
    const slot = buildWorkingSlot(cursor, duration);
    const conflict = findConflict(slot, resourceIds, bookings);
    if (!conflict) return slot;
    cursor = nextWorkingTime(addMinutes(new Date(conflict.end), STEP_MINUTES));
  }
  console.warn("Aucun créneau disponible dans l'horizon de recherche.");
  return null;
}

function buildWorkingSlot(startAfter, duration) {
  let cursor = nextWorkingTime(startAfter);
  const start = new Date(cursor);
  let remaining = duration;
  const segments = [];
  const horizon = addDays(cursor, MAX_PLANNING_SEARCH_DAYS);
  let iterations = 0;

  while (remaining > 0 && cursor < horizon && iterations < MAX_PLANNING_ITERATIONS) {
    iterations += 1;
    const intervals = getDayIntervals(cursor);
    let progressed = false;
    for (const interval of intervals) {
      if (cursor >= interval.end) continue;
      const segmentStart = maxDate(cursor, interval.start);
      if (segmentStart >= interval.end) continue;
      const available = diffMinutes(segmentStart, interval.end);
      const taken = Math.min(available, remaining);
      const segmentEnd = addMinutes(segmentStart, taken);
      segments.push({ start: segmentStart.toISOString(), end: segmentEnd.toISOString() });
      remaining -= taken;
      cursor = segmentEnd;
      progressed = true;
      if (remaining <= 0) {
        return { start, end: segmentEnd, segments };
      }
    }
    if (!progressed || remaining > 0) {
      cursor = nextWorkingTime(startOfDay(addDays(cursor, 1)));
    }
  }

  throw new Error("Aucun créneau disponible dans l'horizon de recherche.");
}

function findConflict(slot, resourceIds, bookings) {
  let conflict = null;
  bookings.forEach((booking) => {
    if (!isPlanningBlockingBooking(booking)) return;
    if (!booking.resourceIds.some((id) => resourceIds.includes(id))) return;
    booking.segments.forEach((busy) => {
      const busyStart = new Date(busy.start);
      const busyEnd = new Date(busy.end);
      slot.segments.forEach((segment) => {
        const start = new Date(segment.start);
        const end = new Date(segment.end);
        if (start < busyEnd && end > busyStart) {
          if (!conflict || busyEnd < new Date(conflict.end)) {
            conflict = { end: busy.end };
          }
        }
      });
    });
  });
  return conflict;
}

function acceptProposal(item, proposal) {
  if (!proposal || proposal.error) return;
  if (isCaseReadonlyArchive(item)) {
    notifyUser(getArchivedCaseMessage(item), "error");
    return;
  }
  const issues = getBusinessRuleIssues(item, "appointment");
  if (issues.length) {
    notifyUser(issues.join("\n"));
    return;
  }
  state.bookings = state.bookings.filter((booking) => booking.caseId !== item.id);
  state.bookings.push(...proposalToBookings(item, proposal, false));
  item.appointment = {
    start: proposal.start,
    end: proposal.end,
    delivery: proposal.delivery,
    marginMinutes: proposal.marginMinutes,
  };
  item.flags.received = false;
  item.flags.workStarted = false;
  item.flags.workCompleted = false;
  item.flags.qualityApproved = false;
  item.flags.delivered = false;
  item.appointmentStatus = "scheduled";
  item.qualityChecklist = createEmptyQualityChecklist();
  addHistory(item, "appointment.accepted", `RDV choisi: ${formatDateTime(proposal.start)}`, `Livraison estimée ${formatDateTime(proposal.delivery)}`);
  generatedProposals[item.id] = [];
  state.planningDate = todayKey(new Date(proposal.start));
  saveState({ flushCloud: true, cloudReason: "appointment-accepted" });
  activeTab = "planning";
  setActiveTab("planning");
  render();
}

function proposalToBookings(item, proposal, temporary) {
  return proposal.steps.map((step) => stepToBooking(item, step, temporary));
}

function stepToBooking(item, step, temporary) {
  const resourceIds = Array.isArray(step.resourceIds) ? step.resourceIds : [];
  const segments = Array.isArray(step.segments) ? step.segments : [];
  const plannedMinutes = sumBookingSegmentsMinutes(segments);
  return {
    id: temporary ? uid("tmp") : uid("booking"),
    caseId: item.id,
    title: step.title,
    key: step.key,
    start: step.start,
    end: step.end,
    delivery: step.delivery,
    resourceIds,
    primaryResourceId: resourceIds[0] || null,
    equipmentResourceIds: resourceIds.slice(1),
    segments,
    plannedStart: step.start,
    plannedEnd: step.end,
    plannedSegments: clonePlanningSegments(segments),
    plannedMinutes,
    status: temporary ? "temporary" : "planned",
    color: step.color,
    planningMode: step.planningMode || "standard",
    details: step.details || "",
    temporary,
  };
}

function clonePlanningSegments(segments = []) {
  return Array.isArray(segments) ? segments.map((segment) => ({ start: segment.start, end: segment.end })) : [];
}

function sumBookingSegmentsMinutes(segments = []) {
  return clonePlanningSegments(segments).reduce((sum, segment) => {
    const start = new Date(segment.start);
    const end = new Date(segment.end);
    return end > start ? sum + diffMinutes(start, end) : sum;
  }, 0);
}

function getBookingOperationalStatus(booking) {
  if (booking?.temporary) return "temporary";
  const aliases = { in_progress: "started", done: "completed" };
  const status = aliases[booking?.status] || booking?.status || "planned";
  return ["planned", "started", "paused", "completed", "temporary"].includes(status) ? status : "planned";
}

function isPlanningBlockingBooking(booking) {
  return !isBookingLinkedToClosedCase(booking) && getBookingOperationalStatus(booking) !== "completed";
}

function getBookingStatusLabel(booking) {
  const labels = {
    planned: "Planifiée",
    started: "En cours",
    paused: "En pause",
    completed: "Terminée",
    temporary: "Simulation",
  };
  return labels[getBookingOperationalStatus(booking)] || labels.planned;
}

function getBookingDurationMinutes(booking) {
  return Math.max(0, sumBookingSegmentsMinutes(booking?.segments || []));
}

function getBookingCase(booking) {
  return booking?.caseId ? state.cases.find((item) => item.id === booking.caseId) || null : null;
}

function isBookingLinkedToClosedCase(booking) {
  const item = getBookingCase(booking);
  return typeof isCaseOperationallyClosed === "function" ? isCaseOperationallyClosed(item) : Boolean(item?.flags?.delivered || item?.flags?.invoiced || item?.closedAt);
}

function getBookingBusinessDurationMinutes(booking, item = null) {
  const caseItem = item || getBookingCase(booking);
  const caseDurationHours = Number(caseItem?.durations?.[booking?.key] || 0) || 0;
  if (caseDurationHours > 0) return Math.round(caseDurationHours * 60);
  const defaultHours = Number(DEFAULT_DURATIONS?.[booking?.key] || 0) || 0;
  return defaultHours > 0 ? Math.round(defaultHours * 60) : 0;
}

function isDurationLikelyCalendarAmplitude(candidateMinutes, businessMinutes) {
  if (!candidateMinutes || !businessMinutes) return false;
  return candidateMinutes > Math.max(businessMinutes * 1.5, businessMinutes + 60);
}

function getBookingPlannedMinutes(booking, item = null) {
  const businessMinutes = getBookingBusinessDurationMinutes(booking, item);
  const explicit = Number(booking?.plannedMinutes || 0) || 0;
  if (explicit > 0 && !isDurationLikelyCalendarAmplitude(explicit, businessMinutes)) return Math.round(explicit);
  const plannedSegments = clonePlanningSegments(booking?.plannedSegments?.length ? booking.plannedSegments : []);
  const plannedSegmentMinutes = sumBookingSegmentsMinutes(plannedSegments);
  if (plannedSegmentMinutes > 0 && !isDurationLikelyCalendarAmplitude(plannedSegmentMinutes, businessMinutes)) {
    return Math.max(0, Math.round(plannedSegmentMinutes));
  }
  if (businessMinutes > 0) return businessMinutes;
  const fallbackSegments = clonePlanningSegments(booking?.segments || []);
  return Math.max(0, Math.round(sumBookingSegmentsMinutes(fallbackSegments)));
}

function countBookingSegmentMinutesBetween(segments = [], rangeStart, rangeEnd) {
  const startBoundary = new Date(rangeStart);
  const endBoundary = new Date(rangeEnd);
  if (!(startBoundary < endBoundary)) return 0;
  return clonePlanningSegments(segments).reduce((sum, segment) => {
    const start = maxDate(new Date(segment.start), startBoundary);
    const end = minDate(new Date(segment.end), endBoundary);
    return end > start ? sum + diffMinutes(start, end) : sum;
  }, 0);
}

function getBookingProductiveSegments(booking) {
  return clonePlanningSegments(booking?.plannedSegments?.length ? booking.plannedSegments : booking?.segments || []);
}

function getBookingTemplate(booking) {
  const baseTemplate = STEP_TEMPLATES.find((template) => template.key === booking?.key);
  if (!baseTemplate) return null;
  const item = state.cases.find((caseItem) => caseItem.id === booking.caseId);
  return getPlanningTemplateForItem(item, baseTemplate);
}

function findCaseBooking(item, bookingId) {
  return state.bookings.find((booking) => booking.id === bookingId && booking.caseId === item?.id && booking.type !== "leave");
}

function getCaseWorkBookings(item) {
  return state.bookings
    .filter((booking) => booking.caseId === item?.id && booking.temporary !== true && booking.type !== "leave")
    .sort((a, b) => new Date(a.start) - new Date(b.start));
}

function getCaseProductionBookings(item) {
  return getCaseWorkBookings(item).filter((booking) => booking.key !== "quality");
}

const TECHNICIAN_HUMAN_ROLES = new Set(["tolier", "mecanicien", "electricien", "peintre", "controle"]);
const TECHNICIAN_STATUS_LABELS = {
  planned: "Planifiée",
  ready: "Prête à démarrer",
  in_progress: "En cours",
  paused: "En pause",
  blocked: "Bloquée",
  done: "Terminée",
  quality_pending: "Contrôle qualité à faire",
  temporary: "Simulation",
};

const TECHNICIAN_PAUSE_REASONS = [
  "pause repas",
  "attente pièces",
  "attente accord",
  "attente expert",
  "attente chef atelier",
  "panne outil / ressource",
  "autre",
];

function isTechnicianResource(resource) {
  return Boolean(resource && resource.active !== false && TECHNICIAN_HUMAN_ROLES.has(resource.role));
}

function getBookingHumanResourceIds(booking) {
  return (booking?.resourceIds || []).filter((resourceId) => isTechnicianResource(getResource(resourceId)));
}

function getBookingPrimaryTechnicianId(booking) {
  const primary = getResource(booking?.primaryResourceId);
  if (isTechnicianResource(primary)) return primary.id;
  return getBookingHumanResourceIds(booking)[0] || "";
}

function getTechnicianStatusLabel(status) {
  return TECHNICIAN_STATUS_LABELS[status] || TECHNICIAN_STATUS_LABELS.planned;
}

function isBookingTaskBlocked(booking) {
  return Boolean(booking?.blockReason || booking?.blockedAt);
}

function normalizeTechnicianDateRange(dateLike = new Date()) {
  const base = dateLike instanceof Date ? new Date(dateLike) : parseDateKey(dateLike) || new Date(dateLike);
  const start = Number.isNaN(base.getTime()) ? new Date() : base;
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

function bookingIntersectsRange(booking, rangeStart, rangeEnd) {
  return (booking?.segments || []).some((segment) => {
    const start = new Date(segment.start);
    const end = new Date(segment.end);
    return start < rangeEnd && end > rangeStart;
  });
}

function rangesOverlap(startA, endA, startB, endB) {
  return startA < endB && endA > startB;
}

function getActiveTechnicianBookings(technicianId) {
  if (!technicianId) return [];
  return state.bookings.filter((booking) => (
    booking.type !== "leave"
    && booking.temporary !== true
    && (booking.resourceIds || []).includes(technicianId)
    && getBookingOperationalStatus(booking) === "started"
  ));
}

function getTechnicianLeaveConflicts(technicianId, rangeStart = new Date(), rangeEnd = null) {
  const start = rangeStart instanceof Date ? rangeStart : new Date(rangeStart);
  const end = rangeEnd ? (rangeEnd instanceof Date ? rangeEnd : new Date(rangeEnd)) : addMinutes(start, 1);
  if (!technicianId || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return [];
  return state.bookings.filter((booking) => (
    booking.type === "leave"
    && (booking.resourceIds || []).includes(technicianId)
    && (booking.segments || []).some((segment) => rangesOverlap(start, end, new Date(segment.start), new Date(segment.end)))
  ));
}

function getTechnicianLeaveCheckRange(booking, reference = new Date()) {
  const status = getBookingOperationalStatus(booking);
  const now = reference instanceof Date ? reference : new Date(reference);
  let start = status === "started" ? now : new Date(booking?.start || booking?.plannedStart || now);
  let end = new Date(booking?.end || booking?.plannedEnd || "");
  if (Number.isNaN(start.getTime())) start = now;
  if (Number.isNaN(end.getTime()) || end <= start) {
    const minutes = Math.max(
      STEP_MINUTES,
      Number(booking?.remainingMinutes || 0)
        || Number(booking?.plannedMinutes || 0)
        || getBookingDurationMinutes(booking)
        || STEP_MINUTES
    );
    end = addMinutes(start, minutes);
  }
  return { start, end };
}

const REQUIRED_PREDECESSOR_KEYS = {
  prep: ["body"],
  paint: ["prep"],
  reassembly: ["paint"],
  finish: ["reassembly"],
  quality: ["body", "oilService", "mechanical", "electrical", "prep", "paint", "reassembly", "finish"],
};

function getRequiredPredecessorKeys(booking) {
  if (!booking) return [];
  if (booking.remainingFromPaused) return [];
  if (booking.planningMode === "anticipated-new-part") return [];
  return REQUIRED_PREDECESSOR_KEYS[booking.key] || [];
}

function getPreviousRequiredBookings(item, booking) {
  if (!item || !booking) return [];
  const productionBookings = getCaseProductionBookings(item).filter((candidate) => candidate.id !== booking.id);
  const requiredKeys = getRequiredPredecessorKeys(booking);
  if (!requiredKeys.length) return [];
  return productionBookings.filter((candidate) => {
    if (candidate.remainingFromPaused && candidate.parentBookingId === booking.id) return false;
    if (booking.remainingFromPaused && candidate.id === booking.parentBookingId) return false;
    return requiredKeys.includes(candidate.key);
  });
}

function hasUnfinishedPreviousRequiredBooking(item, booking) {
  return getPreviousRequiredBookings(item, booking).some((candidate) => getBookingOperationalStatus(candidate) !== "completed");
}

function getTechnicianTaskStatus(item, booking) {
  if (!booking) return "planned";
  if (booking.temporary) return "temporary";
  if (isBookingTaskBlocked(booking)) return "blocked";
  const status = getBookingOperationalStatus(booking);
  if (status === "completed") {
    const family = getBookingFamily(booking);
    const unfinished = family.filter((b) => getBookingOperationalStatus(b) !== "completed");
    if (unfinished.length > 0) {
      const visible = getVisibleTechnicianBookingForFamily(family);
      if (visible.displayBooking && visible.displayBooking.id !== booking.id) {
        return getTechnicianTaskStatus(item, visible.displayBooking);
      }
    }
    return booking.key === "quality" && !item?.flags?.qualityApproved ? "quality_pending" : "done";
  }
  if (status === "started") return "in_progress";
  if (status === "paused") return "paused";
  if (booking.key === "quality" && item?.flags?.workCompleted && !item?.flags?.qualityApproved) return "quality_pending";
  if (status === "planned" && item?.flags?.received && !hasUnfinishedPreviousRequiredBooking(item, booking)) return "ready";
  return "planned";
}

function getBookingBusinessTaskId(booking) {
  return String(booking?.businessTaskId || booking?.parentBookingId || booking?.id || "");
}

function getBookingFamily(booking) {
  if (!booking) return [];
  const businessTaskId = getBookingBusinessTaskId(booking);
  if (!businessTaskId) return [booking];
  return state.bookings
    .filter((candidate) => (
      candidate
      && candidate.caseId === booking.caseId
      && candidate.type !== "leave"
      && candidate.temporary !== true
      && getBookingBusinessTaskId(candidate) === businessTaskId
    ))
    .sort((a, b) => new Date(a.start) - new Date(b.start));
}

function getVisibleTechnicianBookingForFamily(family = []) {
  const bookings = family.filter(Boolean).sort((a, b) => new Date(a.start) - new Date(b.start));
  const started = bookings.find((booking) => getBookingOperationalStatus(booking) === "started");
  if (started) return { displayBooking: started, actionBooking: started, pauseRemainder: false };
  const blocked = bookings.find((booking) => isBookingTaskBlocked(booking));
  if (blocked) return { displayBooking: blocked, actionBooking: blocked, pauseRemainder: Boolean(blocked.remainingFromPaused) };
  const paused = [...bookings].reverse().find((booking) => getBookingOperationalStatus(booking) === "paused");
  if (paused) {
    const remainder = findRemainderBookingForPausedTask(paused.id);
    return { displayBooking: paused, actionBooking: remainder || paused, pauseRemainder: Boolean(remainder) };
  }
  const planned = bookings.find((booking) => getBookingOperationalStatus(booking) === "planned");
  if (planned) return { displayBooking: planned, actionBooking: planned, pauseRemainder: Boolean(planned.remainingFromPaused) };
  const completed = bookings.filter((booking) => getBookingOperationalStatus(booking) === "completed").at(-1);
  return { displayBooking: completed || bookings[0] || null, actionBooking: completed || bookings[0] || null, pauseRemainder: false };
}

function bookingFamilyIntersectsRange(family, rangeStart, rangeEnd) {
  return family.some((booking) => bookingIntersectsRange(booking, rangeStart, rangeEnd));
}

function getTechnicianFamilyHumanIds(family) {
  return [...new Set(family.flatMap((booking) => getBookingHumanResourceIds(booking)))];
}

function getTechnicianFamilyLatestNote(family) {
  return family
    .flatMap((booking) => Array.isArray(booking.notes) ? booking.notes : [])
    .sort((a, b) => new Date(a.at || 0) - new Date(b.at || 0))
    .at(-1) || null;
}

function getTechnicianBusinessTaskRows(technicianId, dateLike = new Date()) {
  const { start, end } = normalizeTechnicianDateRange(dateLike);
  const familyMap = new Map();
  state.bookings.forEach((booking) => {
    if (!booking || booking.type === "leave" || booking.temporary === true) return;
    if (isBookingLinkedToClosedCase(booking)) return;
    const businessTaskId = getBookingBusinessTaskId(booking);
    const familyKey = `${booking.caseId || ""}::${businessTaskId || booking.id}`;
    if (!familyMap.has(familyKey)) familyMap.set(familyKey, []);
    familyMap.get(familyKey).push(booking);
  });

  return [...familyMap.values()]
    .map((family) => {
      const item = state.cases.find((caseItem) => caseItem.id === family[0]?.caseId);
      const humanIds = getTechnicianFamilyHumanIds(family);
      if (!item || !humanIds.length) return null;
      if (technicianId && !humanIds.includes(technicianId)) return null;
      const visible = getVisibleTechnicianBookingForFamily(family);
      const displayBooking = visible.displayBooking;
      const actionBooking = visible.actionBooking || displayBooking;
      if (!displayBooking || !actionBooking) return null;
      const status = getTechnicianTaskStatus(item, displayBooking);
      const visibleOnDate = bookingFamilyIntersectsRange(family, start, end)
        || family.some((booking) => ["started", "paused"].includes(getBookingOperationalStatus(booking)))
        || family.some((booking) => getTechnicianTaskStatus(item, booking) === "blocked");
      if (!visibleOnDate) return null;
      const technicianIdForRow = technicianId && humanIds.includes(technicianId)
        ? technicianId
        : getBookingPrimaryTechnicianId(actionBooking) || getBookingPrimaryTechnicianId(displayBooking) || humanIds[0] || "";
      const technician = getResource(technicianIdForRow) || null;
      const endDates = family.map((booking) => new Date(booking.end)).filter((date) => !Number.isNaN(date.getTime()));
      const lastEnd = endDates.length ? new Date(Math.max(...endDates.map((date) => date.getTime()))) : new Date(displayBooking.end);
      const late = status !== "done" && status !== "paused" && status !== "blocked" && lastEnd < new Date();
      const latestNote = getTechnicianFamilyLatestNote(family);
      return {
        id: getBookingBusinessTaskId(displayBooking) || displayBooking.id,
        item,
        booking: displayBooking,
        displayBooking,
        actionBooking,
        actionBookingId: actionBooking.id,
        family,
        technician,
        technicianId: technicianIdForRow,
        status,
        statusLabel: getTechnicianStatusLabel(status),
        plannedMinutes: getBookingPlannedMinutes(displayBooking, item) || getBookingDurationMinutes(displayBooking),
        remainingMinutes: Math.max(...family.map((booking) => Number(booking.remainingMinutes || 0) || 0), 0),
        workedMinutes: family.reduce((sum, booking) => sum + (Number(booking.actualWorkedMinutes || 0) || 0), 0),
        late,
        latestNote: latestNote?.text || "",
        pauseRemainder: visible.pauseRemainder,
      };
    })
    .filter(Boolean)
    .sort((a, b) => new Date(a.displayBooking.start) - new Date(b.displayBooking.start));
}

function getTechnicianTaskRows(technicianId, dateLike = new Date()) {
  return getTechnicianBusinessTaskRows(technicianId, dateLike);
}

function getTechnicianTaskStartIssues(item, booking, technicianId, options = {}) {
  const issues = [];
  if (!item) issues.push("Dossier introuvable.");
  if (!booking) issues.push("Tâche introuvable.");
  if (issues.length) return issues;
  const status = getBookingOperationalStatus(booking);
  if (status === "completed") issues.push("Cette tâche est déjà terminée.");
  if (status === "paused") issues.push("Cette tâche est en pause. Reprenez le reliquat planifié.");
  if (status === "started") issues.push("Cette tâche est déjà en cours.");
  if (isBookingTaskBlocked(booking) && !options.overrideBlock) issues.push("Résoudre le blocage de la tâche avant de démarrer.");
  if (!item.flags?.received) issues.push("Le véhicule doit être réceptionné avant démarrage.");
  if (typeof getBusinessRuleIssues === "function") {
    getBusinessRuleIssues(item, "workStarted")
      .filter((issue) => !/Aucune affectation/i.test(issue))
      .forEach((issue) => issues.push(issue));
  }
  const resource = getResource(technicianId);
  if (!isTechnicianResource(resource)) issues.push("Sélectionnez un technicien actif affectable.");
  if (!(booking.resourceIds || []).includes(technicianId)) issues.push("Cette tâche n'est pas affectée à ce technicien.");
  if (!options.allowConcurrent && getActiveTechnicianBookings(technicianId).some((active) => active.id !== booking.id)) {
    issues.push("Ce technicien a déjà une tâche en cours.");
  }
  if (!options.overridePrecedence && hasUnfinishedPreviousRequiredBooking(item, booking)) {
    issues.push("La tâche précédente obligatoire n'est pas terminée.");
  }
  if (!options.overrideLeave) {
    const { start, end } = getTechnicianLeaveCheckRange(booking);
    if (getTechnicianLeaveConflicts(technicianId, start, end).length) {
      issues.push("Ce technicien est marqué indisponible pendant le créneau de cette tâche.");
    }
  }
  return [...new Set(issues)];
}

function canStartTechnicianTask(item, booking, technicianId, options = {}) {
  const issues = getTechnicianTaskStartIssues(item, booking, technicianId, options);
  return { ok: issues.length === 0, issues, message: issues[0] || "" };
}

function ensureBookingWorkSessions(booking) {
  if (!Array.isArray(booking.workSessions)) booking.workSessions = [];
  return booking.workSessions;
}

function openBookingWorkSession(booking, startedAt, technicianId) {
  const sessions = ensureBookingWorkSessions(booking);
  const last = sessions.at(-1);
  if (last && !last.completedAt && !last.pausedAt) return;
  sessions.push({ startedAt, startedBy: technicianId || "", pausedAt: "", pausedBy: "", completedAt: "", completedBy: "", pauseReason: "" });
}

function closeBookingWorkSession(booking, fields = {}) {
  const sessions = ensureBookingWorkSessions(booking);
  let session = sessions.at(-1);
  if (!session || session.completedAt || session.pausedAt) {
    session = { startedAt: booking.startedAt || booking.actualStart || booking.start || "", startedBy: booking.startedBy || "", pausedAt: "", pausedBy: "", completedAt: "", completedBy: "", pauseReason: "" };
    sessions.push(session);
  }
  Object.assign(session, fields);
}

function estimateBookingWorkedMinutes(booking, fallbackEnd = new Date()) {
  const plannedMinutes = getBookingPlannedMinutes(booking);
  const productiveSegments = getBookingProductiveSegments(booking);
  const sessions = ensureBookingWorkSessions(booking);
  const fromSessions = sessions.reduce((sum, session) => {
    const start = new Date(session.startedAt);
    const end = new Date(session.completedAt || session.pausedAt || fallbackEnd);
    if (!(start < end)) return sum;
    const productive = countBookingSegmentMinutesBetween(productiveSegments, start, end);
    return sum + (productive > 0 ? productive : diffMinutes(start, end));
  }, 0);
  if (fromSessions > 0) return plannedMinutes > 0 ? Math.min(Math.round(fromSessions), plannedMinutes) : Math.round(fromSessions);
  const start = new Date(booking.startedAt || booking.actualStart || booking.start);
  const end = fallbackEnd instanceof Date ? fallbackEnd : new Date(fallbackEnd);
  if (!(start < end)) return 0;
  const productive = countBookingSegmentMinutesBetween(productiveSegments, start, end);
  const minutes = productive > 0 ? productive : diffMinutes(start, end);
  return plannedMinutes > 0 ? Math.min(Math.round(minutes), plannedMinutes) : Math.round(minutes);
}

function truncateSegmentsAt(segments, cutoffDate) {
  const cutoff = new Date(cutoffDate);
  return clonePlanningSegments(segments)
    .map((segment) => {
      const start = new Date(segment.start);
      const end = new Date(segment.end);
      if (end <= cutoff) return segment;
      if (start < cutoff && cutoff < end) return { start: segment.start, end: cutoff.toISOString() };
      return null;
    })
    .filter(Boolean);
}

function countWorkedMinutesUntil(segments, cutoffDate) {
  const cutoff = new Date(cutoffDate);
  return clonePlanningSegments(segments).reduce((sum, segment) => {
    const start = new Date(segment.start);
    const end = new Date(segment.end);
    if (cutoff <= start) return sum;
    const effectiveEnd = minDate(end, cutoff);
    return effectiveEnd > start ? sum + diffMinutes(start, effectiveEnd) : sum;
  }, 0);
}

function applySegmentsToBooking(booking, segments) {
  const cleanSegments = clonePlanningSegments(segments).filter((segment) => new Date(segment.start) < new Date(segment.end));
  if (!cleanSegments.length) return false;
  booking.segments = cleanSegments;
  booking.start = cleanSegments[0].start;
  booking.end = cleanSegments.at(-1).end;
  return true;
}

function completeBookingReservationAt(booking, completedAt, options = {}) {
  const now = new Date(completedAt || new Date());
  const originalSegments = clonePlanningSegments(booking.segments);
  const plannedSegments = clonePlanningSegments(booking.plannedSegments?.length ? booking.plannedSegments : originalSegments);
  const plannedStart = booking.plannedStart || booking.start;
  const plannedEnd = booking.plannedEnd || booking.end;
  const plannedMinutes = Number(booking.plannedMinutes || 0) || sumBookingSegmentsMinutes(plannedSegments);
  const completionDate = minDate(now, new Date(booking.end || now));
  let keptSegments = truncateSegmentsAt(originalSegments, completionDate);
  const actualStart = booking.actualStart || booking.startedAt || "";
  const actualStartDate = actualStart ? new Date(actualStart) : null;
  if (!keptSegments.length && actualStartDate && !Number.isNaN(actualStartDate.getTime()) && actualStartDate <= now) {
    const elapsedMinutes = Math.max(1, diffMinutes(actualStartDate, now));
    const cappedMinutes = Math.max(1, Math.min(plannedMinutes || STEP_MINUTES, elapsedMinutes));
    const safeEnd = new Date(actualStartDate.getTime() + cappedMinutes * 60000);
    keptSegments = [{ start: actualStartDate.toISOString(), end: safeEnd.toISOString() }];
  }
  const keptMinutes = sumBookingSegmentsMinutes(keptSegments);
  const removed = !keptSegments.length && options.removeIfEmpty !== false;

  booking.status = "completed";
  booking.actualStart = booking.actualStart || booking.startedAt || keptSegments[0]?.start || plannedStart || now.toISOString();
  booking.actualEnd = now.toISOString();
  booking.completedAt = now.toISOString();
  booking.plannedStart = plannedStart;
  booking.plannedEnd = plannedEnd;
  booking.plannedSegments = plannedSegments;
  booking.plannedMinutes = plannedMinutes;
  booking.remainingMinutes = 0;
  booking.pauseReason = "";

  if (keptSegments.length) {
    applySegmentsToBooking(booking, keptSegments);
  } else if (options.removeIfEmpty !== false) {
    state.bookings = state.bookings.filter((candidate) => candidate.id !== booking.id);
  }

  return {
    removed,
    plannedMinutes,
    keptMinutes,
    freedMinutes: Math.max(0, plannedMinutes - keptMinutes),
    plannedEnd,
  };
}

function applySlotToBooking(booking, match, durationMinutes) {
  const segments = clonePlanningSegments(match.slot.segments);
  booking.start = match.slot.start.toISOString();
  booking.end = match.slot.end.toISOString();
  booking.segments = segments;
  booking.resourceIds = match.resourceIds;
  booking.primaryResourceId = match.primary?.id || match.resourceIds[0] || null;
  booking.equipmentResourceIds = match.equipment ? [match.equipment.id] : match.resourceIds.slice(1);
  booking.plannedStart = booking.start;
  booking.plannedEnd = booking.end;
  booking.plannedSegments = clonePlanningSegments(segments);
  booking.plannedMinutes = durationMinutes || sumBookingSegmentsMinutes(segments);
}

function refreshCaseAppointmentFromBookings(item) {
  const bookings = getCaseWorkBookings(item);
  if (!bookings.length) return;
  const start = bookings.reduce((earliest, booking) => minDate(earliest, new Date(booking.start)), new Date(bookings[0].start));
  const end = bookings.reduce((latest, booking) => maxDate(latest, new Date(booking.end)), new Date(bookings[0].end));
  const totalMinutes = bookings.reduce((sum, booking) => sum + getBookingDurationMinutes(booking), 0);
  const marginMinutes = Number(item.appointment?.marginMinutes || 0) || Math.ceil((totalMinutes * 0.2) / STEP_MINUTES) * STEP_MINUTES;
  item.appointment = {
    ...(item.appointment || {}),
    start: start.toISOString(),
    end: end.toISOString(),
    delivery: addWorkingMinutes(end, marginMinutes).toISOString(),
    marginMinutes,
  };
}

function startCaseBookingTask(item, bookingId, meta = {}) {
  if (isCaseReadonlyArchive(item)) return { ok: false, message: getArchivedCaseMessage(item) };
  const booking = findCaseBooking(item, bookingId);
  if (!booking) return { ok: false, message: "Tâche introuvable dans le planning." };
  const status = getBookingOperationalStatus(booking);
  if (status === "completed") return { ok: false, message: "Cette tâche est déjà terminée." };
  if (status === "paused") return { ok: false, message: "Cette tâche est en pause. Reprenez le reliquat planifié." };
  if (status === "started") return { ok: false, message: "Cette tâche est déjà en cours." };
  const now = new Date().toISOString();
  booking.status = "started";
  booking.actualStart = now;
  booking.startedAt = now;
  booking.startedBy = meta.startedBy || booking.startedBy || "";
  if (meta.resumed || booking.remainingFromPaused) {
    booking.resumedAt = now;
    booking.resumedBy = meta.startedBy || booking.resumedBy || "";
  }
  openBookingWorkSession(booking, now, meta.startedBy || "");
  const wasStarted = Boolean(item.flags.workStarted);
  item.flags.workStarted = true;
  item.flags.workCompleted = false;
  if (!wasStarted) recordFlagHistory(item, "workStarted", true);
  const actor = meta.actorLabel ? ` par ${meta.actorLabel}` : "";
  const label = meta.resumed || booking.remainingFromPaused ? "Tâche reprise" : "Tâche démarrée";
  const type = meta.resumed || booking.remainingFromPaused ? "planning.task.resumed" : "planning.task.started";
  addHistory(item, type, label, `${booking.title || getDurationLabel(booking.key)} ${label.toLowerCase()}${actor} à ${formatDateTime(now)}.`);
  refreshCaseAppointmentFromBookings(item);
  return { ok: true, message: meta.resumed || booking.remainingFromPaused ? "Tâche reprise." : "Tâche démarrée.", booking };
}

function completeCaseBookingTaskNow(item, bookingId, completedAt = new Date(), meta = {}) {
  if (isCaseReadonlyArchive(item)) return { ok: false, message: getArchivedCaseMessage(item) };
  const booking = findCaseBooking(item, bookingId);
  if (!booking) return { ok: false, message: "Tâche introuvable dans le planning." };
  const status = getBookingOperationalStatus(booking);
  if (status === "completed") return { ok: false, message: "Cette tâche est déjà terminée." };
  if (status === "paused") return { ok: false, message: "Cette tâche est en pause. Terminez plutôt le reliquat planifié." };
  const now = new Date(completedAt);
  const start = new Date(booking.start);
  if (now < start && status !== "started") {
    return { ok: false, message: "Cette tâche n'a pas encore démarré. Utilisez Replanifier si le créneau doit changer." };
  }
  const title = booking.title || getDurationLabel(booking.key);
  if (meta.note) {
    booking.notes = Array.isArray(booking.notes) ? booking.notes : [];
    booking.notes.push({ id: uid("task-note"), at: now.toISOString(), by: meta.completedBy || "", text: String(meta.note).trim() });
  }
  booking.completedBy = meta.completedBy || booking.completedBy || "";
  booking.actualWorkedMinutes = estimateBookingWorkedMinutes(booking, now);
  closeBookingWorkSession(booking, { completedAt: now.toISOString(), completedBy: meta.completedBy || "", pauseReason: "" });
  const { freedMinutes, removed } = completeBookingReservationAt(booking, now);
  if (booking.remainingFromPaused && booking.parentBookingId) completePausedBookingAncestors(item, booking, now, meta.completedBy || "");
  addHistory(
    item,
    "planning.task.completed",
    "Tâche terminée",
    `${title} terminée${meta.actorLabel ? ` par ${meta.actorLabel}` : ""} à ${formatDateTime(now)}. Durée réelle: ${formatLocalizedDecimal((booking.actualWorkedMinutes || 0) / 60)} h${freedMinutes > 0 ? `. ${formatLocalizedDecimal(freedMinutes / 60)} h libérée(s) dans le planning.` : "."}${removed ? " Réservation future supprimée." : ""}`
  );
  const productionBookings = getCaseProductionBookings(item);
  if (!productionBookings.length || productionBookings.every((caseBooking) => getBookingOperationalStatus(caseBooking) === "completed")) {
    const wasCompleted = Boolean(item.flags.workCompleted);
    item.flags.workCompleted = true;
    if (!wasCompleted) recordFlagHistory(item, "workCompleted", true);
  }
  refreshCaseAppointmentFromBookings(item);
  return { ok: true, message: freedMinutes > 0 ? "Tâche terminée. Le temps restant est libéré dans le planning." : "Tâche terminée.", booking };
}

function completeCaseWorkBookingsNow(item, completedAt = new Date(), meta = {}) {
  if (isCaseReadonlyArchive(item)) return { completed: 0, freedMinutes: 0, removed: 0, ok: false, message: getArchivedCaseMessage(item) };
  const now = new Date(completedAt);
  const bookings = getCaseProductionBookings(item).filter((booking) => getBookingOperationalStatus(booking) !== "completed");
  if (!bookings.length) return { completed: 0, freedMinutes: 0, removed: 0 };
  let freedMinutes = 0;
  let removed = 0;
  bookings.forEach((booking) => {
    const title = booking.title || getDurationLabel(booking.key);
    booking.completedBy = meta.completedBy || booking.completedBy || "";
    booking.completedByOverride = meta.completedByOverride || booking.completedByOverride || "";
    booking.actualWorkedMinutes = estimateBookingWorkedMinutes(booking, now);
    closeBookingWorkSession(booking, { completedAt: now.toISOString(), completedBy: booking.completedBy || booking.completedByOverride || "", pauseReason: "" });
    const result = completeBookingReservationAt(booking, now, { removeIfEmpty: meta.keepEmptyBookings === true ? false : undefined });
    freedMinutes += result.freedMinutes;
    if (result.removed) removed += 1;
    addHistory(
      item,
      "planning.task.completed",
      "Tâche terminée",
      `${title} clôturée avec le dossier${meta.actorLabel ? ` par ${meta.actorLabel}` : ""} à ${formatDateTime(now)}${result.freedMinutes > 0 ? `. ${formatLocalizedDecimal(result.freedMinutes / 60)} h libérée(s).` : "."}${meta.overrideReason ? ` Motif override: ${meta.overrideReason}.` : ""}`
    );
  });
  item.flags.workCompleted = true;
  recordFlagHistory(item, "workCompleted", true);
  refreshCaseAppointmentFromBookings(item);
  return { completed: bookings.length, freedMinutes, removed };
}

function pauseCaseBookingTask(item, bookingId, reason, meta = {}) {
  if (isCaseReadonlyArchive(item)) return { ok: false, message: getArchivedCaseMessage(item) };
  const booking = findCaseBooking(item, bookingId);
  if (!booking) return { ok: false, message: "Tâche introuvable dans le planning." };
  const status = getBookingOperationalStatus(booking);
  if (status !== "started") return { ok: false, message: "Démarrez la tâche avant de la mettre en pause." };
  const cleanReason = String(reason || "").trim();
  if (!cleanReason) return { ok: false, message: "Indiquez une cause de pause pour reporter le reliquat." };
  const now = new Date();
  const originalSegments = clonePlanningSegments(booking.segments);
  const plannedMinutes = booking.plannedMinutes || sumBookingSegmentsMinutes(originalSegments);
  const workedMinutes = Math.min(plannedMinutes, countWorkedMinutesUntil(originalSegments, now));
  const remainingMinutes = Math.max(0, plannedMinutes - workedMinutes);
  if (workedMinutes <= 0) return { ok: false, message: "Aucune portion réalisée à conserver. Utilisez Replanifier pour déplacer toute la tâche." };

  const clippedSegments = truncateSegmentsAt(originalSegments, now);
  if (!applySegmentsToBooking(booking, clippedSegments)) {
    return { ok: false, message: "Impossible de découper cette tâche au moment demandé." };
  }

  booking.status = "paused";
  booking.pausedAt = now.toISOString();
  booking.pausedBy = meta.pausedBy || meta.technicianId || booking.pausedBy || "";
  booking.actualEnd = now.toISOString();
  booking.pauseReason = cleanReason;
  booking.plannedMinutes = plannedMinutes;
  booking.remainingMinutes = remainingMinutes;
  booking.actualWorkedMinutes = Math.max(Number(booking.actualWorkedMinutes || 0) || 0, Math.round(workedMinutes));
  closeBookingWorkSession(booking, { pausedAt: now.toISOString(), pausedBy: booking.pausedBy || "", pauseReason: cleanReason });

  const remainder = createPausedBookingRemainder(item, booking, remainingMinutes, cleanReason, now);
  item.flags.workStarted = true;
  item.flags.workCompleted = false;
  addHistory(
    item,
    "planning.task.paused",
    "Tâche mise en pause",
    `${booking.title || getDurationLabel(booking.key)} suspendue${meta.actorLabel ? ` par ${meta.actorLabel}` : ""}: ${cleanReason}. Temps travaillé: ${formatLocalizedDecimal(workedMinutes / 60)} h. Reliquat replanifié le ${formatDateTime(remainder.start)}.`
  );
  refreshCaseAppointmentFromBookings(item);
  return { ok: true, message: "Tâche mise en pause et reliquat replanifié.", booking, remainder };
}

function createPausedBookingRemainder(item, sourceBooking, remainingMinutes, reason, startAfter) {
  const template = getBookingTemplate(sourceBooking);
  if (!template) throw new Error("Étape planning inconnue pour replanifier le reliquat.");
  const duration = Math.max(STEP_MINUTES, Math.round(remainingMinutes));
  const businessTaskId = getBookingBusinessTaskId(sourceBooking) || sourceBooking.id;
  sourceBooking.businessTaskId = businessTaskId;
  const tempBookings = state.bookings.filter((booking) => booking.id !== sourceBooking.id).map(cloneBooking);
  const match = findBestResourceSlot(template, startAfter, duration, tempBookings, isFastLaneJob(item), sourceBooking.primaryResourceId);
  if (!match) throw new Error("Aucun créneau disponible pour reporter le reliquat.");
  const title = `Reprise - ${sourceBooking.title || getDurationLabel(sourceBooking.key) || "Tâche atelier"}`;
  const step = makePlanningStep(item, template, match, {
    title,
    details: `Reliquat après pause: ${reason}`,
    planningMode: sourceBooking.planningMode || "standard",
  });
  const booking = stepToBooking(item, step, false);
  booking.parentBookingId = sourceBooking.id;
  booking.businessTaskId = businessTaskId;
  booking.remainingFromPaused = true;
  booking.pauseReason = reason;
  booking.plannedMinutes = duration;
  sourceBooking.supersededBy = booking.id;
  state.bookings.push(booking);
  return booking;
}

function completePausedBookingAncestors(item, booking, completedAt, completedBy = "") {
  const completedIso = completedAt instanceof Date ? completedAt.toISOString() : new Date(completedAt).toISOString();
  const visited = new Set();
  let parentId = booking?.parentBookingId || "";
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = findCaseBooking(item, parentId);
    if (!parent) break;
    if (getBookingOperationalStatus(parent) === "paused") {
      parent.status = "completed";
      parent.completedAt = completedIso;
      parent.completedBy = completedBy || parent.completedBy || "";
    }
    parentId = parent.parentBookingId || "";
  }
}

function getTechnicianActorLabel(technicianId) {
  return getResource(technicianId)?.name || technicianId || "Technicien";
}

function startTechnicianTask(item, bookingId, technicianId, options = {}) {
  if (isCaseReadonlyArchive(item)) return { ok: false, message: getArchivedCaseMessage(item) };
  const booking = findCaseBooking(item, bookingId);
  const permission = guardAction("task.start", { booking, technicianId }, { notify: false });
  if (!permission.ok) return { ok: false, message: permission.message, issues: [permission.message] };
  const validation = canStartTechnicianTask(item, booking, technicianId, options);
  if (!validation.ok) return { ok: false, message: validation.issues.join("\n"), issues: validation.issues };
  if (options.clearBlock) clearTechnicianTaskBlock(item, bookingId, technicianId, { silent: true });
  return startCaseBookingTask(item, bookingId, {
    startedBy: technicianId,
    actorLabel: getTechnicianActorLabel(technicianId),
    resumed: Boolean(options.resumed || booking?.remainingFromPaused),
  });
}

function pauseTechnicianTask(item, bookingId, technicianId, reason) {
  if (isCaseReadonlyArchive(item)) return { ok: false, message: getArchivedCaseMessage(item) };
  const cleanReason = String(reason || "").trim();
  if (!cleanReason) return { ok: false, message: "Motif de pause obligatoire." };
  const booking = findCaseBooking(item, bookingId);
  const permission = guardAction("task.pause", { booking, technicianId }, { notify: false });
  if (!permission.ok) return { ok: false, message: permission.message };
  return pauseCaseBookingTask(item, bookingId, cleanReason, {
    pausedBy: technicianId,
    actorLabel: getTechnicianActorLabel(technicianId),
  });
}

function findRemainderBookingForPausedTask(bookingId) {
  return state.bookings
    .filter((booking) => booking.parentBookingId === bookingId && getBookingOperationalStatus(booking) !== "completed")
    .sort((a, b) => new Date(a.start) - new Date(b.start))[0] || null;
}

function resumeTechnicianTask(item, bookingId, technicianId, options = {}) {
  if (isCaseReadonlyArchive(item)) return { ok: false, message: getArchivedCaseMessage(item) };
  const booking = findCaseBooking(item, bookingId);
  if (!booking) return { ok: false, message: "Tâche introuvable dans le planning." };
  let target = booking;
  if (getBookingOperationalStatus(booking) === "paused") {
    target = findRemainderBookingForPausedTask(booking.id);
    if (!target) return { ok: false, message: "Aucun reliquat planifié à reprendre pour cette tâche." };
  }
  const permission = guardAction("task.resume", { booking: target, technicianId }, { notify: false });
  if (!permission.ok) return { ok: false, message: permission.message };
  if (isBookingTaskBlocked(target)) clearTechnicianTaskBlock(item, target.id, technicianId, { silent: true });
  target.resumedAt = new Date().toISOString();
  target.resumedBy = technicianId || target.resumedBy || "";
  return startTechnicianTask(item, target.id, technicianId, {
    ...options,
    resumed: true,
    overrideBlock: true,
    clearBlock: true,
  });
}

function mapTechnicianBlockReason(reason) {
  const normalized = String(reason || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (normalized.includes("piece")) return { blockerReason: "waiting_parts", partsStatus: "waiting_parts" };
  if (normalized.includes("client")) return { blockerReason: "waiting_customer" };
  if (normalized.includes("accord") || normalized.includes("expert")) return { blockerReason: "waiting_internal_approval" };
  if (normalized.includes("diagnostic")) return { blockerReason: "waiting_diagnostic" };
  if (normalized.includes("pont")) return { blockerReason: "waiting_lift" };
  if (normalized.includes("technicien") || normalized.includes("chef")) return { blockerReason: "waiting_technician" };
  return { blockerReason: "other" };
}

function applyCaseBlockerFromTask(item, booking, reason, details) {
  if (!item) return;
  const mapped = mapTechnicianBlockReason(reason);
  item.blockerSourceBookingIds = Array.isArray(item.blockerSourceBookingIds) ? item.blockerSourceBookingIds : [];
  if (booking?.id && !item.blockerSourceBookingIds.includes(booking.id)) item.blockerSourceBookingIds.push(booking.id);
  if (item.blockerSource === "manual" && isCaseBlocked(item)) return;
  item.blockerSource = "task";
  item.blockerReason = item.blockerReason || mapped.blockerReason || "other";
  if (mapped.partsStatus && !BLOCKING_PARTS_STATUSES.has(normalizePartsStatus(item.partsStatus))) item.partsStatus = mapped.partsStatus;
  item.blockerDetails = [item.blockerDetails, details || reason].filter(Boolean).join(item.blockerDetails ? " · " : "");
}

function blockTechnicianTask(item, bookingId, technicianId, reason, details = "") {
  if (isCaseReadonlyArchive(item)) return { ok: false, message: getArchivedCaseMessage(item) };
  const cleanReason = String(reason || "").trim();
  if (!cleanReason) return { ok: false, message: "Motif de blocage obligatoire." };
  const booking = findCaseBooking(item, bookingId);
  if (!booking) return { ok: false, message: "Tâche introuvable dans le planning." };
  const permission = guardAction("task.block", { booking, technicianId }, { notify: false });
  if (!permission.ok) return { ok: false, message: permission.message };
  let target = booking;
  const status = getBookingOperationalStatus(booking);
  if (status === "started") {
    const pauseResult = pauseTechnicianTask(item, bookingId, technicianId, cleanReason);
    if (!pauseResult.ok) return pauseResult;
    target = pauseResult.remainder || booking;
  } else if (status === "paused") {
    target = findRemainderBookingForPausedTask(booking.id) || booking;
  }
  target.blockedAt = new Date().toISOString();
  target.blockedBy = technicianId || "";
  target.blockReason = cleanReason;
  target.blockDetails = String(details || "").trim();
  applyCaseBlockerFromTask(item, target, cleanReason, target.blockDetails);
  addHistory(
    item,
    "planning.task.blocked",
    "Tâche bloquée",
    `${target.title || getDurationLabel(target.key)} bloquée par ${getTechnicianActorLabel(technicianId)}: ${cleanReason}${target.blockDetails ? ` · ${target.blockDetails}` : ""}.`
  );
  return { ok: true, message: "Tâche marquée comme bloquée.", booking: target };
}

function clearTechnicianTaskBlock(item, bookingId, technicianId, options = {}) {
  if (isCaseReadonlyArchive(item)) return { ok: false, message: getArchivedCaseMessage(item) };
  const booking = findCaseBooking(item, bookingId);
  if (!booking) return { ok: false, message: "Tâche introuvable dans le planning." };
  const hadBlock = isBookingTaskBlocked(booking);
  booking.blockedAt = "";
  booking.blockedBy = "";
  booking.blockReason = "";
  booking.blockDetails = "";
  item.blockerSourceBookingIds = Array.isArray(item.blockerSourceBookingIds)
    ? item.blockerSourceBookingIds.filter((id) => id !== booking.id)
    : [];
  const caseHasOtherBlockedTasks = getCaseWorkBookings(item).some((candidate) => candidate.id !== booking.id && isBookingTaskBlocked(candidate));
  if (!caseHasOtherBlockedTasks && item.blockerSource === "task") {
    item.blockerReason = "";
    item.blockerDetails = "";
    item.blockerSource = "";
    item.blockerSourceBookingIds = [];
    if (normalizePartsStatus(item.partsStatus) === "waiting_parts" || normalizePartsStatus(item.partsStatus) === "blocked_parts") item.partsStatus = "unchecked";
  }
  if (hadBlock && !options.silent) {
    addHistory(item, "planning.task.unblocked", "Blocage tâche retiré", `${booking.title || getDurationLabel(booking.key)} débloquée par ${getTechnicianActorLabel(technicianId)}.`);
  }
  return { ok: true, message: "Blocage retiré.", booking };
}

function technicianTaskRequiresCompletionPhoto(item, booking) {
  const hasInsurance = typeof getWorkflowClaims === "function" && getWorkflowClaims(item).some((claim) => !isClientOnlyRepairClaim(claim));
  return Boolean(hasInsurance && ["body", "paint", "finish", "quality"].includes(booking?.key));
}

function completeTechnicianTask(item, bookingId, technicianId, options = {}) {
  if (isCaseReadonlyArchive(item)) return { ok: false, message: getArchivedCaseMessage(item) };
  const booking = findCaseBooking(item, bookingId);
  if (!booking) return { ok: false, message: "Tâche introuvable dans le planning." };
  const permission = guardAction("task.complete", { booking, technicianId }, { notify: false });
  if (!permission.ok) return { ok: false, message: permission.message };
  if (isBookingTaskBlocked(booking)) return { ok: false, message: "Résolvez le blocage avant de terminer la tâche." };
  if (technicianTaskRequiresCompletionPhoto(item, booking) && !options.skipPhotoCheck && !booking.photoIds?.length && !options.photoId) {
    return { ok: false, message: "Ajoutez une photo après intervention avant de terminer cette tâche." };
  }
  if (options.photoId) {
    booking.photoIds = Array.isArray(booking.photoIds) ? booking.photoIds : [];
    if (!booking.photoIds.includes(options.photoId)) booking.photoIds.push(options.photoId);
  }
  const result = completeCaseBookingTaskNow(item, bookingId, new Date(), {
    completedBy: technicianId,
    actorLabel: getTechnicianActorLabel(technicianId),
    note: options.note || "",
  });
  if (result.ok && item.flags.workCompleted && !item.flags.qualityApproved) {
    addHistory(item, "quality.pending", "Contrôle qualité à faire", "Toutes les tâches atelier sont terminées. Le dossier attend le contrôle qualité.");
  }
  return result;
}

function addTechnicianTaskNote(item, bookingId, technicianId, note) {
  const cleanNote = String(note || "").trim();
  if (!cleanNote) return { ok: false, message: "Note vide." };
  const booking = findCaseBooking(item, bookingId);
  if (!booking) return { ok: false, message: "Tâche introuvable dans le planning." };
  booking.notes = Array.isArray(booking.notes) ? booking.notes : [];
  booking.notes.push({ id: uid("task-note"), at: new Date().toISOString(), by: technicianId || "", text: cleanNote });
  addHistory(item, "planning.task.note", "Note technicien ajoutée", `${booking.title || getDurationLabel(booking.key)} · ${getTechnicianActorLabel(technicianId)}: ${cleanNote}`);
  return { ok: true, message: "Note ajoutée.", booking };
}

function attachTechnicianTaskPhoto(item, bookingId, technicianId, photoId) {
  const booking = findCaseBooking(item, bookingId);
  if (!booking || !photoId) return { ok: false, message: "Photo ou tâche introuvable." };
  booking.photoIds = Array.isArray(booking.photoIds) ? booking.photoIds : [];
  if (!booking.photoIds.includes(photoId)) booking.photoIds.push(photoId);
  addHistory(item, "planning.task.photo", "Photo tâche ajoutée", `${booking.title || getDurationLabel(booking.key)} · photo ajoutée par ${getTechnicianActorLabel(technicianId)}.`);
  return { ok: true, message: "Photo rattachée à la tâche.", booking };
}

function rescheduleCaseBooking(item, bookingId, startAfter) {
  const booking = findCaseBooking(item, bookingId);
  if (!booking) return { ok: false, message: "Tâche introuvable dans le planning." };
  const permission = guardAction("planning.edit", { booking }, { notify: false });
  if (!permission.ok) return { ok: false, message: permission.message };
  const status = getBookingOperationalStatus(booking);
  if (status !== "planned") return { ok: false, message: "Seules les tâches non démarrées peuvent être déplacées." };
  const requestedStart = new Date(startAfter);
  if (Number.isNaN(requestedStart.getTime())) return { ok: false, message: "Date de replanification invalide." };
  const template = getBookingTemplate(booking);
  if (!template) return { ok: false, message: "Étape planning inconnue." };
  const duration = Math.max(STEP_MINUTES, booking.plannedMinutes || getBookingDurationMinutes(booking));
  const previousStart = booking.start;
  const tempBookings = state.bookings.filter((candidate) => candidate.id !== booking.id).map(cloneBooking);
  const match = findBestResourceSlot(template, requestedStart, duration, tempBookings, isFastLaneJob(item), booking.primaryResourceId);
  if (!match) return { ok: false, message: "Aucun créneau disponible à partir de cette date." };
  applySlotToBooking(booking, match, duration);
  booking.rescheduledAt = new Date().toISOString();
  addHistory(
    item,
    "planning.task.rescheduled",
    "Tâche replanifiée",
    `${booking.title || getDurationLabel(booking.key)} déplacée de ${formatDateTime(previousStart)} vers ${formatDateTime(booking.start)}.`
  );
  refreshCaseAppointmentFromBookings(item);
  return { ok: true, message: "Tâche replanifiée selon les disponibilités atelier." };
}



function migratePlanningLogicV28() {
  const currentVersion = Number(state.settings?.planningLogicVersion || 0);
  if (currentVersion >= 28) return;
  const plannedCaseIds = [...new Set(state.bookings.map((booking) => booking.caseId).filter(Boolean))];
  if (!plannedCaseIds.length) {
    state.settings.planningLogicVersion = 28;
    saveState();
    return;
  }
  const originalBookings = [...state.bookings];
  const earliestByCase = new Map();
  originalBookings.forEach((booking) => {
    if (!booking.caseId || !booking.start) return;
    const start = new Date(booking.start);
    const previous = earliestByCase.get(booking.caseId);
    if (!previous || start < previous) earliestByCase.set(booking.caseId, start);
  });
  const plannedCases = state.cases
    .filter((item) => plannedCaseIds.includes(item.id))
    .sort((a, b) => {
      const aStart = earliestByCase.get(a.id) || new Date(a.appointment?.start || a.createdAt || 0);
      const bStart = earliestByCase.get(b.id) || new Date(b.appointment?.start || b.createdAt || 0);
      const diff = aStart - bStart;
      if (diff !== 0) return diff;
      return String(a.id).localeCompare(String(b.id));
    });
  const newBookings = originalBookings.filter((booking) => !plannedCaseIds.includes(booking.caseId));
  let changed = false;
  try {
    plannedCases.forEach((item) => {
      const startAfter = earliestByCase.get(item.id) || new Date(item.appointment?.start || new Date());
      const proposal = schedulePipeline(item, startAfter, newBookings.map(cloneBooking));
      const caseBookings = proposalToBookings(item, proposal, false);
      newBookings.push(...caseBookings);
      item.appointment = {
        start: proposal.start,
        end: proposal.end,
        delivery: proposal.delivery,
        marginMinutes: proposal.marginMinutes,
      };
      item.appointmentStatus = "scheduled";
      addHistory(
        item,
        "planning.migrated_v28",
        "Planning recalculé avec continuité technicien et équipements visibles",
        "Le même tôlier conserve démontage/remontage et le même peintre conserve préparation/peinture/finition quand il est disponible.",
      );
    });
    state.bookings = newBookings;
    changed = true;
  } catch (error) {
    console.warn("Migration planning v21.28 impossible, conservation du planning existant", error);
    state.bookings = originalBookings;
  }
  state.settings.planningLogicVersion = 28;
  saveState();
  if (changed) {
    notifyUser("Planning recalculé : continuité technicien corrigée et zones/cabines visibles.", "success");
  }
}


function getNextSchedulableStepIndex(item, fromIndex) {
  for (let index = fromIndex; index < STEP_TEMPLATES.length; index += 1) {
    const template = STEP_TEMPLATES[index];
    const hours = Number(item.durations?.[template.key] || 0);
    if (hours > 0) return index;
  }
  return -1;
}

function schedulePlannedCasesInterleaved(plannedCases, earliestByCase, baseBookings) {
  const tempBookings = [...baseBookings];
  const proposalsByCase = new Map();
  const assignmentsByCase = new Map();
  const queues = plannedCases.map((item, order) => {
    const firstIndex = getNextSchedulableStepIndex(item, 0);
    return {
      item,
      order,
      stepIndex: firstIndex,
      readyAt: nextWorkingTime(earliestByCase.get(item.id) || new Date(item.appointment?.start || item.createdAt || new Date())),
    };
  }).filter((job) => job.stepIndex >= 0);

  queues.forEach((job) => {
    proposalsByCase.set(job.item.id, { steps: [], marginMinutes: 0 });
    assignmentsByCase.set(job.item.id, createPlanningAssignmentContext());
  });

  while (queues.length) {
    queues.sort((a, b) => {
      const readyDiff = new Date(a.readyAt) - new Date(b.readyAt);
      if (readyDiff !== 0) return readyDiff;
      const startDiff = (earliestByCase.get(a.item.id) || 0) - (earliestByCase.get(b.item.id) || 0);
      if (startDiff !== 0) return startDiff;
      return a.order - b.order;
    });
    const job = queues.shift();
    const baseTemplate = STEP_TEMPLATES[job.stepIndex];
    const template = getPlanningTemplateForItem(job.item, baseTemplate);
    const hours = Number(job.item.durations?.[template.key] || 0);
    const duration = Math.max(15, Math.round(hours * 60));
    const assignment = assignmentsByCase.get(job.item.id) || createPlanningAssignmentContext();
    const preferredPrimaryId = getPreferredPrimaryResourceId(template, assignment, job.item);
    const match = findBestResourceSlot(template, job.readyAt, duration, tempBookings, isFastLaneJob(job.item), preferredPrimaryId);
    if (!match) throw new Error(`Aucune disponibilité pour ${template.title}.`);
    rememberPrimaryAssignment(template, assignment, match.primary.id);
    assignmentsByCase.set(job.item.id, assignment);
    const step = {
      key: template.key,
      title: template.title,
      start: match.slot.start.toISOString(),
      end: match.slot.end.toISOString(),
      segments: match.slot.segments,
      resourceIds: match.resourceIds,
      primaryResourceId: match.primary.id,
      equipmentResourceIds: match.equipment ? [match.equipment.id] : [],
      color: getVehiclePlanningColor(job.item),
    };
    proposalsByCase.get(job.item.id).steps.push(step);
    tempBookings.push(stepToBooking(job.item, step, true));
    const nextIndex = getNextSchedulableStepIndex(job.item, job.stepIndex + 1);
    if (nextIndex >= 0) {
      queues.push({ ...job, stepIndex: nextIndex, readyAt: new Date(step.end) });
    }
  }

  for (const [caseId, proposal] of proposalsByCase.entries()) {
    proposal.steps.sort((a, b) => new Date(a.start) - new Date(b.start));
    const totalMinutes = proposal.steps.reduce((sum, step) => sum + diffMinutes(new Date(step.start), new Date(step.end)), 0);
    const marginMinutes = Math.ceil((totalMinutes * 0.2) / STEP_MINUTES) * STEP_MINUTES;
    proposal.start = proposal.steps[0]?.start || null;
    proposal.end = proposal.steps.at(-1)?.end || null;
    proposal.delivery = proposal.end ? addWorkingMinutes(new Date(proposal.end), marginMinutes).toISOString() : null;
    proposal.marginMinutes = marginMinutes;
  }
  return proposalsByCase;
}

function migratePlanningLogicV36() {
  const currentVersion = Number(state.settings?.planningLogicVersion || 0);
  if (currentVersion >= 36) return;
  const plannedCaseIds = [...new Set(state.bookings.map((booking) => booking.caseId).filter(Boolean))];
  if (!plannedCaseIds.length) {
    state.settings.planningLogicVersion = 36;
    saveState();
    return;
  }
  const originalBookings = [...state.bookings];
  const earliestByCase = new Map();
  originalBookings.forEach((booking) => {
    if (!booking.caseId || !booking.start) return;
    const start = new Date(booking.start);
    const previous = earliestByCase.get(booking.caseId);
    if (!previous || start < previous) earliestByCase.set(booking.caseId, start);
  });
  const plannedCases = state.cases
    .filter((item) => plannedCaseIds.includes(item.id))
    .sort((a, b) => {
      const aStart = earliestByCase.get(a.id) || new Date(a.appointment?.start || a.createdAt || 0);
      const bStart = earliestByCase.get(b.id) || new Date(b.appointment?.start || b.createdAt || 0);
      return aStart - bStart || String(a.id).localeCompare(String(b.id));
    });
  const baseBookings = originalBookings.filter((booking) => !plannedCaseIds.includes(booking.caseId));
  try {
    const proposalsByCase = schedulePlannedCasesInterleaved(plannedCases, earliestByCase, baseBookings.map(cloneBooking));
    const newBookings = [...baseBookings];
    plannedCases.forEach((item) => {
      const proposal = proposalsByCase.get(item.id);
      if (!proposal || !proposal.steps.length) return;
      newBookings.push(...proposalToBookings(item, proposal, false));
      item.appointment = {
        start: proposal.start,
        end: proposal.end,
        delivery: proposal.delivery,
        marginMinutes: proposal.marginMinutes,
      };
      item.appointmentStatus = "scheduled";
      addHistory(
        item,
        "planning.migrated_v36",
        "Planning recalculé en file atelier globale",
        "La cabine et les zones sont attribuées par ordre réel de disponibilité des véhicules, avec continuité tôlier/peintre.",
      );
    });
    state.bookings = newBookings;
    state.settings.planningLogicVersion = 36;
    saveState();
    notifyUser("Planning recalculé : priorité au véhicule prêt le plus tôt, continuité technicien et équipements visibles.", "success");
  } catch (error) {
    console.warn("Migration planning v21.36 impossible, conservation du planning existant", error);
    state.bookings = originalBookings;
    state.settings.planningLogicVersion = 36;
    saveState();
  }
}
