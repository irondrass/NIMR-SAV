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
  saveState();
  activeTab = "planning";
  setActiveTab("planning");
  render();
}

function proposalToBookings(item, proposal, temporary) {
  return proposal.steps.map((step) => stepToBooking(item, step, temporary));
}

function stepToBooking(item, step, temporary) {
  const resourceIds = Array.isArray(step.resourceIds) ? step.resourceIds : [];
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
    segments: step.segments,
    color: step.color,
    planningMode: step.planningMode || "standard",
    details: step.details || "",
    temporary,
  };
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
    const preferredPrimaryId = getPreferredPrimaryResourceId(template, assignment, item);
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
