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
  bookings.push(...getPendingProposalBookings(item.id));
  return schedulePipeline(item, startAfter, bookings);
}

function getPendingProposalBookings(excludedCaseId = "") {
  if (typeof generatedProposals === "undefined" || !generatedProposals) return [];
  const acceptedCaseIds = new Set((state.bookings || []).map((booking) => booking.caseId).filter(Boolean));
  return Object.entries(generatedProposals).flatMap(([caseId, value]) => {
    if (!caseId || caseId === excludedCaseId || acceptedCaseIds.has(caseId)) return [];
    const item = (state.cases || []).find((candidate) => candidate.id === caseId);
    if (!item || (typeof isCaseOperationallyClosed === "function" && isCaseOperationallyClosed(item))) return [];
    const proposal = Array.isArray(value) ? value[0] : (value?.proposal || null);
    if (!proposal?.steps?.length) return [];
    return proposalToBookings(item, proposal, true);
  });
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

function getExplicitPlanningTasks(item) {
  const direct = Array.isArray(item?.planningTasks)
    ? item.planningTasks
    : (Array.isArray(item?.workshopTasks) ? item.workshopTasks : []);
  if (direct.length) {
    const tasks = direct.filter(Boolean);
    return (
      item?.source === "pdf_estimate"
      && typeof normalizePdfPlanningTasksForCase === "function"
    )
      ? normalizePdfPlanningTasksForCase(tasks)
      : tasks;
  }
  const hasExternalStep = Object.values(item?.stepExecutionModes || {}).some((mode) => mode === "external");
  if (hasExternalStep) {
    let previousTaskId = "";
    return STEP_TEMPLATES.flatMap((baseTemplate) => {
      const hours = Number(item?.durations?.[baseTemplate.key] || 0);
      if (hours <= 0) return [];
      const template = getPlanningTemplateForItem(item, baseTemplate);
      const taskId = `case-step-${baseTemplate.key}`;
      const task = {
        id: taskId,
        taskId,
        key: baseTemplate.key,
        title: template.title,
        durationMinutes: Math.max(STEP_MINUTES, Math.round(hours * 60)),
        dependencies: previousTaskId ? [previousTaskId] : [],
        requiredRole: template.role,
        equipmentRole: template.equipmentRole || "",
        serviceMode: item.stepExecutionModes?.[baseTemplate.key] === "external" ? "external" : "internal",
        subcontractorId: item.stepSubcontractorIds?.[baseTemplate.key] || "",
      };
      previousTaskId = taskId;
      return [task];
    });
  }
  const legacyTasks = Array.isArray(item?.tasks) ? item.tasks.filter(Boolean) : [];
  return legacyTasks.some((task) => (
    Array.isArray(task?.dependencies)
    || Array.isArray(task?.dependsOn)
    || task?.parallelizable === true
    || task?.serviceMode === "external"
  )) ? legacyTasks : [];
}

function makePlanningStep(item, template, match, options = {}) {
  const resourceIds = match.resourceIds;
  return {
    key: template.key,
    taskId: options.taskId || template.taskId || template.key,
    title: options.title || template.title,
    start: match.slot.start.toISOString(),
    end: match.slot.end.toISOString(),
    segments: match.slot.segments,
    resourceIds,
    primaryResourceId: match.primary.id,
    equipmentResourceIds: match.equipment ? [match.equipment.id] : [],
    dependencies: Array.isArray(options.dependencies) ? [...options.dependencies] : [],
    parallelizable: options.parallelizable === true,
    vehicleExclusive: options.vehicleExclusive !== false,
    vehicleLocation: options.vehicleLocation || "internal",
    requiredRole: options.requiredRole || template.role || "",
    requiredCategory: options.requiredCategory || "",
    sourceLineIds: Array.isArray(options.sourceLineIds) ? [...options.sourceLineIds] : [],
    sourceOperations: Array.isArray(options.sourceOperations) ? [...options.sourceOperations] : [],
    sourceLaborHours: Number(options.sourceLaborHours || 0),
    color: getVehiclePlanningColor(item),
    planningMode: options.planningMode || "standard",
    details: options.details || "",
  };
}

function describePlanningAvailabilityFailure(item, template, duration, tempBookings, fastJob, title, planningOptions = {}) {
  const label = title || template.title || "la tâche";
  const primaryResources = getAssignableResources(template.role, fastJob, {
    requiredCategory: planningOptions.requiredCategory || "",
    requiredSite: planningOptions.requiredSite || "internal",
  });
  if (!primaryResources.length) {
    return `Aucun technicien compatible disponible pour ${label}.`;
  }
  if (template.equipmentRole) {
    const equipmentResources = getAssignableResources(template.equipmentRole, fastJob, {
      requiredCategory: "",
      requiredSite: planningOptions.requiredSite || "internal",
    });
    if (!equipmentResources.length) {
      return `Aucune zone ou ressource ${template.equipmentRole} disponible pour ${label}.`;
    }
  }
  const finiteCapacities = primaryResources
    .map((resource) => getResourceDailyCapacityMinutes(resource))
    .filter((minutes) => Number.isFinite(minutes));
  if (finiteCapacities.length && finiteCapacities.every((minutes) => minutes < duration)) {
    const bestCapacity = Math.max(...finiteCapacities);
    return `Durée de ${Math.round(duration / 6) / 10} h supérieure à la capacité journalière disponible de ${Math.round(bestCapacity / 6) / 10} h pour ${label}.`;
  }
  const sameCaseBookings = (tempBookings || []).filter((booking) => booking.caseId === item.id && booking.temporary !== true);
  if (sameCaseBookings.length) {
    return `Collision avec un booking existant ou capacité atelier insuffisante pour ${label}.`;
  }
  return `Capacité atelier insuffisante pour ${label} avec les ressources actuellement disponibles.`;
}

function scheduleSingleStep(item, template, cursor, duration, tempBookings, assignment, fastJob, title, details, planningMode = "standard", planningOptions = {}) {
  if (duration <= 0) return null;
  const preferredPrimaryId = getPreferredPrimaryResourceId(template, assignment, item);
  const preferredEquipmentId = getPreferredEquipmentResourceId(template, assignment);
  const rotationKey = `${item.id || "case"}:${template.key}`;
  const match = findBestResourceSlot(
    template,
    cursor,
    duration,
    tempBookings,
    fastJob,
    preferredPrimaryId,
    preferredEquipmentId,
    rotationKey,
    {
      caseId: item.id,
      stepKey: template.key,
      requiredSite: planningOptions.requiredSite || "internal",
      vehicleLocation: planningOptions.vehicleLocation || "internal",
      vehicleExclusive: planningOptions.vehicleExclusive !== false,
      parallelizable: planningOptions.parallelizable === true,
      dependencies: planningOptions.dependencies || [],
      requiredCategory: planningOptions.requiredCategory || "",
    },
  );
  if (!match) {
    throw new Error(describePlanningAvailabilityFailure(
      item,
      template,
      duration,
      tempBookings,
      fastJob,
      title,
      planningOptions,
    ));
  }
  rememberPlanningAssignment(template, assignment, match.primary.id, match.equipment?.id || null);
  const step = makePlanningStep(item, template, match, {
    title: title || template.title,
    details,
    planningMode,
    ...planningOptions,
    requiredRole: planningOptions.requiredRole || template.role,
  });
  tempBookings.push(stepToBooking(item, step, true));
  return step;
}

function schedulePipeline(item, startAfter, bookings) {
  const graphTasks = getExplicitPlanningTasks(item);
  if (graphTasks.length) return scheduleTaskGraph(item, graphTasks, startAfter, bookings);
  return scheduleSequentialPipeline(item, startAfter, bookings);
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
  // Compatibilité de cache uniquement : cette ancienne optimisation est interdite
  // dans le flux PDF-first et ne doit plus produire de réservation.
  return scheduleSequentialPipeline(item, startAfter, bookings);

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
      "Étape héritée désactivée",
      "Cette ancienne optimisation n'est plus utilisée dans le flux atelier.",
      "legacy-disabled"
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
  return { tolierId: null, painterId: null, equipmentByRole: {} };
}

function getPreferredPrimaryResourceId(template, assignment, item = null) {
  const locked = item?.stepAssignmentLocks?.[template.key]?.resourceId || "";
  const manual = locked || item?.stepPreferredResources?.[template.key] || "";
  if (manual && state.resources.some((resource) => resource.id === manual && resource.role === template.role && resource.active !== false)) {
    return manual;
  }
  if (template.key === "reassembly") return assignment.tolierId;
  if (["paint", "finish"].includes(template.key)) return assignment.painterId;
  return null;
}

function getPreferredEquipmentResourceId(template, assignment) {
  return template.equipmentRole ? assignment.equipmentByRole?.[template.equipmentRole] || null : null;
}

function rememberPlanningAssignment(template, assignment, primaryResourceId, equipmentResourceId = null) {
  if (!primaryResourceId) return;
  if (template.key === "body") assignment.tolierId = primaryResourceId;
  if (["prep", "paint"].includes(template.key) && !assignment.painterId) assignment.painterId = primaryResourceId;
  if (template.equipmentRole && equipmentResourceId) assignment.equipmentByRole[template.equipmentRole] = equipmentResourceId;
}

function buildResourceSlotCandidate({
  primary,
  equipment,
  primaryIndex,
  equipmentIndex,
  startAfter,
  duration,
  bookings,
  preferredPrimaryId = null,
  preferredEquipmentId = null,
  rotationKey = "",
  planningOptions = {},
}) {
  const resourceIds = equipment ? [primary.id, equipment.id] : [primary.id];
  const requiredRolesByResource = {
    ...(planningOptions.requiredRolesByResource || {}),
    [primary.id]: planningOptions.primaryRole || primary.role,
    ...(equipment ? { [equipment.id]: planningOptions.equipmentRole || equipment.role } : {}),
  };
  const slot = findEarliestSlot(resourceIds, startAfter, duration, bookings, {
    ...planningOptions,
    requiredRolesByResource,
  });
  if (!slot) return null;
  return {
    slot,
    resourceIds,
    primary,
    equipment,
    primaryIndex,
    equipmentIndex,
    primaryPreferred: Boolean(preferredPrimaryId && primary.id === preferredPrimaryId),
    equipmentPreferred: Boolean(preferredEquipmentId && equipment?.id === preferredEquipmentId),
    conflictCount: 0,
    dailyLoadMinutes: resourceIds.reduce((sum, resourceId) => sum + getResourceDailyLoadMinutes(resourceId, bookings, startAfter), 0),
    loadMinutes: resourceIds.reduce((sum, resourceId) => sum + getResourceLoadMinutes(resourceId, bookings, startAfter), 0),
    activeCaseCount: getResourceActiveCaseCount(resourceIds, bookings, startAfter),
    rotationRank: getStableResourceRotationRank(rotationKey, resourceIds),
    stableResourceKey: resourceIds.slice().sort().join("|"),
  };
}

function findBestResourceSlot(template, startAfter, duration, bookings, fastJob, preferredPrimaryId = null, preferredEquipmentId = null, rotationKey = "", planningOptions = {}) {
  const primaryResources = orderPrimaryResourcesForStep(template.role, fastJob, bookings, startAfter, preferredPrimaryId, planningOptions);
  const equipmentResources = template.equipmentRole
    // La catégorie métier de la tâche qualifie la ressource principale. Elle
    // ne doit pas rendre incompatible l'équipement associé (ex. une cabine
    // n'a pas à porter également la catégorie « peintre »).
    ? getAssignableResources(template.equipmentRole, fastJob, { ...planningOptions, requiredCategory: "" })
    : [null];
  let best = null;
  primaryResources.forEach((primary, primaryIndex) => {
    equipmentResources.forEach((equipment, equipmentIndex) => {
      const candidate = buildResourceSlotCandidate({
        primary,
        equipment,
        primaryIndex,
        equipmentIndex,
        startAfter,
        duration,
        bookings,
        preferredPrimaryId,
        preferredEquipmentId,
        rotationKey,
        planningOptions: {
          ...planningOptions,
          primaryRole: template.role,
          equipmentRole: template.equipmentRole || "",
        },
      });
      if (!candidate) return;
      if (!best || compareSlots(candidate, best) < 0) best = candidate;
    });
  });
  return best;
}

function getResourceAssignmentAlternatives(item, stepKey, startAfter = new Date()) {
  const baseTemplate = STEP_TEMPLATES.find((template) => template.key === stepKey);
  if (!item || !baseTemplate) return [];
  const template = getPlanningTemplateForItem(item, baseTemplate);
  const duration = Math.max(0, Math.round(Number(item.durations?.[template.key] || 0) * 60));
  if (!duration) return [];
  const fastJob = isFastLaneJob(item);
  const bookings = state.bookings.filter((booking) => booking.caseId !== item.id).map(cloneBooking);
  bookings.push(...getPendingProposalBookings(item.id));
  const primaryResources = getAssignableResources(template.role, fastJob);
  const equipmentResources = template.equipmentRole ? getAssignableResources(template.equipmentRole, fastJob) : [null];
  const candidates = primaryResources.map((primary, primaryIndex) => {
    let bestForPrimary = null;
    equipmentResources.forEach((equipment, equipmentIndex) => {
      const candidate = buildResourceSlotCandidate({
        primary,
        equipment,
        primaryIndex,
        equipmentIndex,
        startAfter,
        duration,
        bookings,
        rotationKey: `${item.id || "case"}:${template.key}`,
      });
      if (candidate && (!bestForPrimary || compareSlots(candidate, bestForPrimary) < 0)) bestForPrimary = candidate;
    });
    return bestForPrimary;
  }).filter(Boolean).sort(compareSlots);
  const bestEnd = candidates[0] ? new Date(candidates[0].slot.end) : null;
  return candidates.map((candidate, index) => ({
    resourceId: candidate.primary.id,
    resourceName: candidate.primary.name || candidate.primary.id,
    equipmentResourceIds: candidate.equipment ? [candidate.equipment.id] : [],
    equipmentNames: candidate.equipment ? [candidate.equipment.name || candidate.equipment.id] : [],
    start: candidate.slot.start.toISOString(),
    end: candidate.slot.end.toISOString(),
    dailyLoadMinutes: candidate.dailyLoadMinutes,
    activeCaseCount: candidate.activeCaseCount,
    deliveryImpactMinutes: bestEnd ? Math.max(0, diffMinutes(bestEnd, candidate.slot.end)) : 0,
    recommended: index === 0,
  }));
}

function getAssignableResources(role, fastJob, options = {}) {
  return state.resources
    .filter((resource) => isResourceCompatible(resource, role, options.requiredCategory || "", options.requiredSite || "any"))
    .filter((resource) => !state.settings.fastLaneEnabled || fastJob || !resource.fastLane)
    .sort((a, b) => {
      if (!state.settings.fastLaneEnabled || !fastJob) return 0;
      return Number(Boolean(b.fastLane)) - Number(Boolean(a.fastLane));
    });
}

function orderPrimaryResourcesForStep(role, fastJob, bookings, startAfter, preferredPrimaryId = null, options = {}) {
  const resources = getAssignableResources(role, fastJob, options);
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
  return getResourceLoadMinutesInRange(resourceId, bookings, from, until);
}

function getResourceDailyLoadMinutes(resourceId, bookings, fromDate) {
  const from = startOfDay(fromDate || new Date());
  return getResourceLoadMinutesInRange(resourceId, bookings, from, addDays(from, 1));
}

function getResourceLoadMinutesInRange(resourceId, bookings, from, until) {
  return bookings.reduce((sum, booking) => {
    if (!isPlanningBlockingBooking(booking)) return sum;
    if (!(booking.resourceIds || []).includes(resourceId)) return sum;
    return sum + booking.segments.reduce((segmentSum, segment) => {
      const start = maxDate(new Date(segment.start), from);
      const end = minDate(new Date(segment.end), until);
      return end > start ? segmentSum + diffMinutes(start, end) : segmentSum;
    }, 0);
  }, 0);
}

function getResourceActiveCaseCount(resourceIds, bookings, fromDate) {
  const from = startOfDay(fromDate || new Date());
  const until = addDays(from, 14);
  const caseIds = new Set();
  bookings.forEach((booking) => {
    if (!isPlanningBlockingBooking(booking)) return;
    if (!(booking.resourceIds || []).some((resourceId) => resourceIds.includes(resourceId))) return;
    const overlaps = (booking.segments || []).some((segment) => new Date(segment.start) < until && new Date(segment.end) > from);
    if (overlaps) caseIds.add(booking.caseId || booking.id);
  });
  return caseIds.size;
}

function getStableResourceRotationRank(rotationKey, resourceIds) {
  const text = `${rotationKey || "planning"}:${resourceIds.slice().sort().join("|")}`;
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function isFastLaneJob(item) {
  if (!state.settings.fastLaneEnabled) return false;
  return repairDurationHours(item) <= Number(state.settings.fastLaneMaxHours || FAST_LANE_DEFAULT_HOURS);
}

function repairDurationHours(item) {
  return ["body", "mechanical", "electrical", "prep", "paint", "reassembly", "finish"].reduce((sum, key) => sum + Number(item.durations[key] || 0), 0);
}

function compareSlots(a, b) {
  if (a.primaryPreferred !== b.primaryPreferred) return a.primaryPreferred ? -1 : 1;
  if (a.equipmentPreferred !== b.equipmentPreferred) return a.equipmentPreferred ? -1 : 1;
  const startDiff = new Date(a.slot.start) - new Date(b.slot.start);
  if (startDiff !== 0) return startDiff;
  const endDiff = new Date(a.slot.end) - new Date(b.slot.end);
  if (endDiff !== 0) return endDiff;
  const conflictDiff = (a.conflictCount || 0) - (b.conflictCount || 0);
  if (conflictDiff !== 0) return conflictDiff;
  const dailyLoadDiff = (a.dailyLoadMinutes || 0) - (b.dailyLoadMinutes || 0);
  if (dailyLoadDiff !== 0) return dailyLoadDiff;
  const activeCaseDiff = (a.activeCaseCount || 0) - (b.activeCaseCount || 0);
  if (activeCaseDiff !== 0) return activeCaseDiff;
  const loadDiff = (a.loadMinutes || 0) - (b.loadMinutes || 0);
  if (loadDiff !== 0) return loadDiff;
  const rotationDiff = (a.rotationRank || 0) - (b.rotationRank || 0);
  if (rotationDiff !== 0) return rotationDiff;
  return String(a.stableResourceKey || "").localeCompare(String(b.stableResourceKey || ""));
}

function findEarliestSlot(resourceIds, startAfter, duration, bookings, options = {}) {
  let cursor = nextWorkingTime(startAfter);
  const horizon = addDays(cursor, MAX_PLANNING_SEARCH_DAYS);
  let iterations = 0;
  while (cursor < horizon && iterations < MAX_PLANNING_ITERATIONS) {
    iterations += 1;
    const slot = buildWorkingSlot(cursor, duration);
    const candidate = {
      id: options.bookingId || options.excludedBookingId || "",
      caseId: options.caseId || "",
      key: options.stepKey || "",
      start: slot.start.toISOString(),
      end: slot.end.toISOString(),
      segments: slot.segments,
      resourceIds,
      dependencies: options.dependencies || options.dependsOn || [],
      requiredRolesByResource: options.requiredRolesByResource || {},
      requiredCategoriesByResource: options.requiredCategoriesByResource || {},
      requiredSite: options.requiredSite || "any",
      vehicleLocation: options.vehicleLocation || options.requiredSite || "internal",
      vehicleExclusive: options.vehicleExclusive === true,
      parallelizable: options.parallelizable === true,
      capacityUnits: options.capacityUnits || 1,
      resourceUnits: options.resourceUnits || {},
    };
    const validation = validatePlanningCandidate(candidate, bookings, options);
    if (validation.ok) return slot;
    if (validation.permanent) return null;
    const nextAt = validation.nextAt && validation.nextAt > cursor
      ? validation.nextAt
      : addMinutes(cursor, STEP_MINUTES);
    cursor = nextWorkingTime(nextAt);
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

function findConflict(slot, resourceIds, bookings, options = {}) {
  const validation = validatePlanningCandidate({
    id: options.bookingId || options.excludedBookingId || "",
    caseId: options.caseId || "",
    start: slot?.start,
    end: slot?.end,
    segments: getPlanningSlotSegments(slot),
    resourceIds,
    dependencies: options.dependencies || [],
    requiredRolesByResource: options.requiredRolesByResource || {},
    requiredSite: options.requiredSite || "any",
    vehicleLocation: options.vehicleLocation || options.requiredSite || "internal",
    vehicleExclusive: options.vehicleExclusive === true,
    parallelizable: options.parallelizable === true,
  }, bookings, options);
  if (validation.ok) return null;
  const conflict = validation.conflicts.find((entry) => entry.end) || validation.conflicts[0];
  return conflict ? { ...conflict, end: conflict.end || validation.nextAt?.toISOString?.() || slot?.end } : null;
}

function recalculateProposalForAcceptance(item, proposal) {
  if (!item || !proposal || proposal.error) throw new Error("Proposition planning invalide.");
  const requestedStart = new Date(proposal.start || Date.now());
  return generateSingleProposal(item, Number.isNaN(requestedStart.getTime()) ? new Date() : requestedStart);
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
  let acceptedProposal;
  try {
    acceptedProposal = recalculateProposalForAcceptance(item, proposal);
  } catch (error) {
    generatedProposals[item.id] = null;
    notifyUser(error.message || "Le planning a changé. Recalculez la proposition avant de la valider.", "error");
    renderCaseDetail();
    return;
  }
  const previousSignature = (proposal.steps || []).map((step) => `${step.start}:${(step.resourceIds || []).join(",")}`).join("|");
  const acceptedSignature = (acceptedProposal.steps || []).map((step) => `${step.start}:${(step.resourceIds || []).join(",")}`).join("|");
  state.bookings = state.bookings.filter((booking) => booking.caseId !== item.id);
  state.bookings.push(...proposalToBookings(item, acceptedProposal, false));
  item.appointment = {
    start: acceptedProposal.start,
    end: acceptedProposal.end,
    delivery: acceptedProposal.delivery,
    marginMinutes: acceptedProposal.marginMinutes,
  };
  item.flags.received = false;
  item.flags.workStarted = false;
  item.flags.workCompleted = false;
  item.flags.qualityApproved = false;
  item.flags.delivered = false;
  item.appointmentStatus = "scheduled";
  item.qualityChecklist = createEmptyQualityChecklist();
  addHistory(
    item,
    "appointment.accepted",
    `RDV choisi: ${formatDateTime(acceptedProposal.start)}`,
    `Livraison estimée ${formatDateTime(acceptedProposal.delivery)}${previousSignature !== acceptedSignature ? " · Ressources recalculées selon les disponibilités courantes" : ""}`,
  );
  generatedProposals[item.id] = [];
  state.planningDate = todayKey(new Date(acceptedProposal.start));
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
    taskId: step.taskId || step.key || "",
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
    dependencies: Array.isArray(step.dependencies) ? [...step.dependencies] : [],
    parallelizable: step.parallelizable === true,
    vehicleExclusive: step.vehicleExclusive !== false,
    vehicleLocation: step.vehicleLocation || "internal",
    requiredRole: step.requiredRole || "",
    requiredCategory: step.requiredCategory || "",
    subcontractId: step.subcontractId || "",
    subcontractPhase: step.subcontractPhase || "",
    serviceMode: step.serviceMode || "internal",
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

let planningCaseIndexSource = null;
let planningCaseIndexLength = -1;
let planningCaseIndex = new Map();

function invalidatePlanningRuntimeIndexes() {
  planningCaseIndexSource = null;
  planningCaseIndexLength = -1;
  planningCaseIndex = new Map();
}

function getPlanningCaseIndex() {
  const cases = Array.isArray(state?.cases) ? state.cases : [];
  if (planningCaseIndexSource !== cases || planningCaseIndexLength !== cases.length) {
    planningCaseIndexSource = cases;
    planningCaseIndexLength = cases.length;
    planningCaseIndex = new Map(cases.filter((item) => item?.id).map((item) => [item.id, item]));
  }
  return planningCaseIndex;
}

async function acceptProposalAtomically(item, proposal) {
  const currentItem = typeof resolveCaseInCurrentState === "function"
    ? resolveCaseInCurrentState(item)
    : state.cases.find((candidate) => candidate.id === item?.id);
  if (!currentItem) {
    notifyUser("Le dossier sélectionné n'existe plus après synchronisation. Actualisez la liste.", "error");
    return false;
  }
  if (currentItem.source === "pdf_estimate" && !isPdfCaseReadyForPlanning(currentItem)) {
    notifyUser("Validation Chef Atelier du devis PDF absente ou invalide.", "error");
    return false;
  }
  if (!proposal || proposal.error) return false;
  let serverProposal;
  try {
    serverProposal = recalculateProposalForAcceptance(currentItem, proposal);
    if (typeof reservePlanningProposalAtomically === "function") {
      await reservePlanningProposalAtomically(currentItem, serverProposal);
    }
  } catch (error) {
    generatedProposals[currentItem.id] = null;
    notifyUser(error.message || "Le planning a changé. Recalculez la proposition avant de la valider.", "error");
    renderCaseDetail();
    return false;
  }
  acceptProposal(currentItem, serverProposal);
  return Boolean(currentItem.appointment && state.bookings.some((booking) => booking.caseId === currentItem.id));
}

window.acceptProposalAtomically = acceptProposalAtomically;

function getBookingCase(booking) {
  return booking?.caseId ? getPlanningCaseIndex().get(booking.caseId) || null : null;
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

function getBookingEffectivePlanningMinutes(booking, item = null) {
  const plannedMinutes = Number(getBookingPlannedMinutes(booking, item) || 0) || 0;
  if (plannedMinutes > 0) return Math.max(STEP_MINUTES, Math.round(plannedMinutes));
  const fallbackMinutes = Number(getBookingDurationMinutes(booking) || 0) || 0;
  return Math.max(STEP_MINUTES, Math.round(fallbackMinutes || STEP_MINUTES));
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
  return getCaseWorkBookings(item);
}

const TECHNICIAN_HUMAN_ROLES = new Set(["tolier", "mecanicien", "electricien", "peintre", "controle"]);
const TECHNICIAN_STATUS_LABELS = {
  planned: "Planifiée",
  ready: "Prête à démarrer",
  in_progress: "En cours",
  paused: "En pause",
  blocked: "Bloquée",
  done: "Terminée",
  temporary: "Simulation",
};

const TECHNICIAN_PAUSE_REASONS = [
  "pause repas",
  "attente pièce",
  "attente validation",
  "panne outillage",
  "ressource indisponible",
  "véhicule non disponible",
  "difficulté technique",
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
  return REQUIRED_PREDECESSOR_KEYS[booking.key] || [];
}

function getPreviousRequiredBookings(item, booking) {
  if (!item || !booking) return [];
  const productionBookings = getCaseProductionBookings(item).filter((candidate) => candidate.id !== booking.id);
  const explicitDependencies = Array.isArray(booking.dependencies)
    ? booking.dependencies
    : (Array.isArray(booking.dependsOn) ? booking.dependsOn : []);
  if (explicitDependencies.length) {
    const refs = new Set(explicitDependencies.map((dependency) => typeof dependency === "object" ? (dependency.id || dependency.key || dependency.taskId) : dependency).filter(Boolean).map(String));
    return productionBookings.filter((candidate) => [candidate.id, candidate.key, candidate.taskId, candidate.businessTaskId].filter(Boolean).some((value) => refs.has(String(value))));
  }
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
    return "done";
  }
  if (status === "started") return "in_progress";
  if (status === "paused") return "paused";
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

function isBusinessTaskFamilyCompleted(family = []) {
  const bookings = Array.isArray(family) ? family.filter(Boolean) : [];
  return Boolean(bookings.length && bookings.every((booking) => getBookingOperationalStatus(booking) === "completed"));
}

function getCaseBusinessTaskFamilies(item, options = {}) {
  if (!item) return [];
  const sourceBookings = Array.isArray(options.bookings) ? options.bookings : getCaseWorkBookings(item);
  const grouped = new Map();
  sourceBookings.forEach((booking) => {
    if (!booking || booking.type === "leave" || booking.temporary === true) return;
    const businessTaskId = getBookingBusinessTaskId(booking) || booking.id;
    const key = `${booking.caseId || item.id || ""}::${businessTaskId}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(booking);
  });
  return [...grouped.values()].map((family) => family.sort((a, b) => new Date(a.start) - new Date(b.start)));
}

function getCaseBusinessTaskRows(item, options = {}) {
  return getCaseBusinessTaskFamilies(item, options)
    .map((family) => {
      const visible = getVisibleTechnicianBookingForFamily(family);
      const displayBooking = visible.displayBooking;
      const actionBooking = visible.actionBooking || displayBooking;
      if (!displayBooking || !actionBooking) return null;
      const startDates = family.map((booking) => new Date(booking.start)).filter((date) => !Number.isNaN(date.getTime()));
      const endDates = family.map((booking) => new Date(booking.end)).filter((date) => !Number.isNaN(date.getTime()));
      const completed = isBusinessTaskFamilyCompleted(family);
      const status = completed ? "done" : getTechnicianTaskStatus(item, displayBooking);
      return {
        id: getBookingBusinessTaskId(displayBooking) || displayBooking.id,
        item,
        bookings: family,
        family,
        displayBooking,
        actionBooking,
        actionBookingId: actionBooking.id,
        status,
        statusLabel: getTechnicianStatusLabel(status),
        pauseRemainder: visible.pauseRemainder,
        plannedMinutes: getBookingEffectivePlanningMinutes(displayBooking, item),
        start: startDates.length ? new Date(Math.min(...startDates.map((date) => date.getTime()))).toISOString() : displayBooking.start,
        end: endDates.length ? new Date(Math.max(...endDates.map((date) => date.getTime()))).toISOString() : displayBooking.end,
        resourceIds: [...new Set(family.flatMap((booking) => booking.resourceIds || []))],
      };
    })
    .filter(Boolean)
    .sort((a, b) => new Date(a.start) - new Date(b.start));
}

function getTechnicianTaskRows(technicianId, dateLike = new Date()) {
  const currentUser = typeof getCurrentUser === "function" ? getCurrentUser() : null;
  if (currentUser && currentUser.role === "technicien") {
    return getTechnicianBusinessTaskRows(currentUser.resourceId || "__invalid_resource_id__", dateLike);
  }
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
  const totalMinutes = bookings.reduce((sum, booking) => {
    const productiveMinutes = typeof getBookingEffectivePlanningMinutes === "function"
      ? getBookingEffectivePlanningMinutes(booking, item)
      : getBookingPlannedMinutes(booking, item);
    return sum + Math.max(0, Math.round(Number(productiveMinutes || 0) || 0));
  }, 0);
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
  const user = (state.users || []).find(u => u.resourceId === technicianId) || resolvePermissionUser(technicianId);
  if (user && user.role === "technicien" && booking) {
    if (!(booking.resourceIds || []).includes(user.resourceId)) {
      addAuditLog("security.permission_denied", "Accès non autorisé", `Tentative de démarrage de la tâche d'une autre ressource par le technicien ${user.name}`);
      return { ok: false, message: "Vous n'êtes pas autorisé à modifier cette tâche (isolation ressource).", issues: ["Vous n'êtes pas autorisé à modifier cette tâche."] };
    }
  }
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
  const user = (state.users || []).find(u => u.resourceId === technicianId) || resolvePermissionUser(technicianId);
  if (user && user.role === "technicien" && booking) {
    if (!(booking.resourceIds || []).includes(user.resourceId)) {
      addAuditLog("security.permission_denied", "Accès non autorisé", `Tentative de pause de la tâche d'une autre ressource par le technicien ${user.name}`);
      return { ok: false, message: "Vous n'êtes pas autorisé à modifier cette tâche (isolation ressource)." };
    }
  }
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
  const user = (state.users || []).find(u => u.resourceId === technicianId) || resolvePermissionUser(technicianId);
  if (user && user.role === "technicien" && target) {
    if (!(target.resourceIds || []).includes(user.resourceId)) {
      addAuditLog("security.permission_denied", "Accès non autorisé", `Tentative de reprise de la tâche d'une autre ressource par le technicien ${user.name}`);
      return { ok: false, message: "Vous n'êtes pas autorisé à modifier cette tâche (isolation ressource)." };
    }
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
  if (normalized.includes("accord") || normalized.includes("expert") || normalized.includes("validation")) return { blockerReason: "waiting_internal_approval" };
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
  const user = (state.users || []).find(u => u.resourceId === technicianId) || resolvePermissionUser(technicianId);
  if (user && user.role === "technicien" && booking) {
    if (!(booking.resourceIds || []).includes(user.resourceId)) {
      addAuditLog("security.permission_denied", "Accès non autorisé", `Tentative de blocage de la tâche d'une autre ressource par le technicien ${user.name}`);
      return { ok: false, message: "Vous n'êtes pas autorisé à modifier cette tâche (isolation ressource)." };
    }
  }
  const permission = guardAction("task.block", { booking, technicianId }, { notify: false });
  if (!permission.ok) return { ok: false, message: permission.message };
  let target = booking;
  const status = getBookingOperationalStatus(booking);
  if (status === "started") {
    const pauseResult = pauseTechnicianTask(item, bookingId, technicianId, cleanReason);
    if (!pauseResult.ok) {
      // Une tâche peut être démarrée en avance sur son créneau planifié puis
      // bloquée immédiatement sur le terrain. Dans ce cas aucun segment
      // planifié n'est encore comptabilisable : fermer la session active sans
      // fabriquer de temps travaillé ni de reliquat permet une reprise sûre.
      if (!/Aucune portion réalisée/i.test(pauseResult.message || "")) return pauseResult;
      const blockedAt = new Date().toISOString();
      booking.status = "planned";
      booking.pausedAt = blockedAt;
      booking.pausedBy = technicianId || booking.pausedBy || "";
      booking.actualEnd = blockedAt;
      closeBookingWorkSession(booking, {
        pausedAt: blockedAt,
        pausedBy: booking.pausedBy,
        pauseReason: cleanReason,
      });
      target = booking;
    } else {
      target = pauseResult.remainder || booking;
    }
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
  const user = (state.users || []).find(u => u.resourceId === technicianId) || resolvePermissionUser(technicianId);
  if (user && user.role === "technicien" && booking) {
    if (!(booking.resourceIds || []).includes(user.resourceId)) {
      addAuditLog("security.permission_denied", "Accès non autorisé", `Tentative de déblocage de la tâche d'une autre ressource par le technicien ${user.name}`);
      return { ok: false, message: "Vous n'êtes pas autorisé à modifier cette tâche (isolation ressource)." };
    }
  }
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

function technicianTaskRequiresCompletionPhoto() {
  // Les photos restent proposées comme preuve facultative. Elles ne bloquent jamais
  // la fin d'une tâche tant qu'aucune règle métier future explicite ne l'impose.
  return false;
}

function completeTechnicianTask(item, bookingId, technicianId, options = {}) {
  if (isCaseReadonlyArchive(item)) return { ok: false, message: getArchivedCaseMessage(item) };
  const booking = findCaseBooking(item, bookingId);
  if (!booking) return { ok: false, message: "Tâche introuvable dans le planning." };
  const user = (state.users || []).find(u => u.resourceId === technicianId) || resolvePermissionUser(technicianId);
  if (user && user.role === "technicien" && booking) {
    if (!(booking.resourceIds || []).includes(user.resourceId)) {
      addAuditLog("security.permission_denied", "Accès non autorisé", `Tentative de complétion de la tâche d'une autre ressource par le technicien ${user.name}`);
      return { ok: false, message: "Vous n'êtes pas autorisé à modifier cette tâche (isolation ressource)." };
    }
  }
  const permission = guardAction("task.complete", { booking, technicianId }, { notify: false });
  if (!permission.ok) return { ok: false, message: permission.message };
  if (isBookingTaskBlocked(booking)) return { ok: false, message: "Résolvez le blocage avant de terminer la tâche." };
  if (options.photoId) {
    booking.photoIds = Array.isArray(booking.photoIds) ? booking.photoIds : [];
    if (!booking.photoIds.includes(options.photoId)) booking.photoIds.push(options.photoId);
  }
  const result = completeCaseBookingTaskNow(item, bookingId, new Date(), {
    completedBy: technicianId,
    actorLabel: getTechnicianActorLabel(technicianId),
    note: options.note || "",
  });
  return result;
}

function addTechnicianTaskNote(item, bookingId, technicianId, note) {
  const cleanNote = String(note || "").trim();
  if (!cleanNote) return { ok: false, message: "Note vide." };
  const booking = findCaseBooking(item, bookingId);
  if (!booking) return { ok: false, message: "Tâche introuvable dans le planning." };
  const user = (state.users || []).find(u => u.resourceId === technicianId) || resolvePermissionUser(technicianId);
  if (user && user.role === "technicien" && booking) {
    if (!(booking.resourceIds || []).includes(user.resourceId)) {
      addAuditLog("security.permission_denied", "Accès non autorisé", `Tentative d'ajout de note sur la tâche d'une autre ressource par le technicien ${user.name}`);
      return { ok: false, message: "Vous n'êtes pas autorisé à modifier cette tâche (isolation ressource)." };
    }
  }
  booking.notes = Array.isArray(booking.notes) ? booking.notes : [];
  booking.notes.push({ id: uid("task-note"), at: new Date().toISOString(), by: technicianId || "", text: cleanNote });
  addHistory(item, "planning.task.note", "Note technicien ajoutée", `${booking.title || getDurationLabel(booking.key)} · ${getTechnicianActorLabel(technicianId)}: ${cleanNote}`);
  return { ok: true, message: "Note ajoutée.", booking };
}

function attachTechnicianTaskPhoto(item, bookingId, technicianId, photoId) {
  const booking = findCaseBooking(item, bookingId);
  if (!booking || !photoId) return { ok: false, message: "Photo ou tâche introuvable." };
  const user = (state.users || []).find(u => u.resourceId === technicianId) || resolvePermissionUser(technicianId);
  if (user && user.role === "technicien" && booking) {
    if (!(booking.resourceIds || []).includes(user.resourceId)) {
      addAuditLog("security.permission_denied", "Accès non autorisé", `Tentative d'ajout de photo sur la tâche d'une autre ressource par le technicien ${user.name}`);
      return { ok: false, message: "Vous n'êtes pas autorisé à modifier cette tâche (isolation ressource)." };
    }
  }
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
  const predecessors = getPreviousRequiredBookings(item, booking);
  const earliestDependencyEnd = predecessors.reduce((latest, predecessor) => maxDate(latest, getBookingConstraintEnd(predecessor)), requestedStart);
  if (earliestDependencyEnd > requestedStart) {
    return { ok: false, message: `Cette tâche dépend d'une étape qui se termine le ${formatDateTime(earliestDependencyEnd)}.` };
  }
  const template = getBookingTemplate(booking);
  if (!template) return { ok: false, message: "Étape planning inconnue." };
  const duration = getBookingEffectivePlanningMinutes(booking, item);
  const previousStart = booking.start;
  const tempBookings = state.bookings.filter((candidate) => candidate.id !== booking.id).map(cloneBooking);
  const match = findBestResourceSlot(
    template,
    requestedStart,
    duration,
    tempBookings,
    isFastLaneJob(item),
    booking.primaryResourceId,
    booking.equipmentResourceIds?.[0] || null,
    `${item.id}:${booking.taskId || booking.key}`,
    {
      caseId: item.id,
      bookingId: booking.id,
      stepKey: booking.key,
      dependencies: booking.dependencies || [],
      requiredSite: getBookingRequiredResourceSite(booking),
      vehicleLocation: getBookingVehicleLocation(booking),
      vehicleExclusive: isVehicleExclusiveBooking(booking),
      parallelizable: booking.parallelizable === true,
    },
  );
  if (!match) return { ok: false, message: "Aucun créneau disponible à partir de cette date." };
  booking.initialPlannedStart = booking.initialPlannedStart || booking.plannedStart || booking.start;
  booking.initialPlannedEnd = booking.initialPlannedEnd || booking.plannedEnd || booking.end;
  applySlotToBooking(booking, match, duration);
  booking.rescheduledAt = new Date().toISOString();
  addHistory(
    item,
    "planning.task.rescheduled",
    "Tâche replanifiée",
    `${booking.title || getDurationLabel(booking.key)} déplacée de ${formatDateTime(previousStart)} vers ${formatDateTime(booking.start)}.`
  );
  const cascade = cascadeDependentBookings(item, booking, "Replanification de la tâche précédente");
  refreshCaseAppointmentFromBookings(item, "Tâche replanifiée");
  return { ok: true, message: `Tâche replanifiée selon les disponibilités atelier.${cascade.rescheduled ? ` ${cascade.rescheduled} tâche(s) dépendante(s) décalée(s).` : ""}`, cascade };
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
    rememberPlanningAssignment(template, assignment, match.primary.id, match.equipment?.id || null);
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

function findDependentBookingsAfterCompletion(item, completedBooking) {
  if (!item || !completedBooking) return [];
  return state.bookings
    .filter((b) => (
      b.caseId === item.id &&
      b.id !== completedBooking.id &&
      b.type !== "leave" &&
      b.temporary !== true &&
      getBookingOperationalStatus(b) === "planned" &&
      !isBookingTaskBlocked(b) &&
      b.locked !== true &&
      b.manualLock !== true
    ))
    .sort((a, b) => new Date(a.start) - new Date(b.start));
}

function canAdvanceBooking(item, booking, targetStart) {
  if (!item || !booking) return false;
  const predecessors = getPreviousRequiredBookings(item, booking);
  for (const pred of predecessors) {
    const status = getBookingOperationalStatus(pred);
    if (isBookingTaskBlocked(pred)) return false;
    if (status === "planned") {
      const isCandidate = pred.caseId === item.id &&
                         getBookingOperationalStatus(pred) === "planned" &&
                         !isBookingTaskBlocked(pred) &&
                         pred.locked !== true &&
                         pred.manualLock !== true;
      if (!isCandidate) return false;
    }
    if (new Date(pred.end) > new Date(targetStart)) {
      return false;
    }
  }
  const duration = getBookingEffectivePlanningMinutes(booking, item);
  const slot = buildWorkingSlot(targetStart, duration);
  if (!slot) return false;
  const tempBookings = state.bookings.filter((b) => b.id !== booking.id);
  const conflict = findConflict(slot, booking.resourceIds, tempBookings);
  return !conflict;
}

function findEarliestAvailableSlotForBooking(item, booking, earliestStart) {
  if (!item || !booking) return null;
  const duration = getBookingEffectivePlanningMinutes(booking, item);
  const tempBookings = state.bookings.filter((b) => b.id !== booking.id);
  return findEarliestSlot(booking.resourceIds, earliestStart, duration, tempBookings);
}

function previewDependentBookingReschedule(item, completedBooking) {
  if (!item || !completedBooking) return [];
  if (isCaseReadonlyArchive(item)) return [];
  const isClosed = typeof isCaseOperationallyClosed === "function"
    ? isCaseOperationallyClosed(item)
    : Boolean(item?.flags?.delivered || item?.flags?.invoiced || item?.closedAt);
  if (isClosed) return [];

  const candidates = findDependentBookingsAfterCompletion(item, completedBooking);
  if (!candidates.length) return [];

  let tempBookings = state.bookings.map(cloneBooking);
  const previews = [];

  const completionEnd = new Date(completedBooking.actualEnd || completedBooking.completedAt || new Date());

  candidates.forEach((candidate) => {
    let earliestStart = new Date(completionEnd);
    const predecessors = getPreviousRequiredBookings(item, candidate);
    predecessors.forEach((pred) => {
      const simPred = tempBookings.find((b) => b.id === pred.id);
      if (simPred) {
        const predEnd = new Date(simPred.end);
        if (predEnd > earliestStart) {
          earliestStart = predEnd;
        }
      }
    });

    const originalStart = new Date(candidate.start);
    if (earliestStart >= originalStart) {
      return;
    }

    const duration = getBookingEffectivePlanningMinutes(candidate, item);
    const tempBookingsMinusCandidate = tempBookings.filter((b) => b.id !== candidate.id);
    const slot = findEarliestSlot(candidate.resourceIds, earliestStart, duration, tempBookingsMinusCandidate);

    if (slot) {
      const slotStart = new Date(slot.start);
      if (slotStart < originalStart) {
        previews.push({
          bookingId: candidate.id,
          bookingTitle: candidate.title || getDurationLabel(candidate.key) || "Étape planning",
          oldStart: candidate.start,
          oldEnd: candidate.end,
          newStart: slot.start instanceof Date ? slot.start.toISOString() : slot.start,
          newEnd: slot.end instanceof Date ? slot.end.toISOString() : slot.end,
          segments: clonePlanningSegments(slot.segments),
          plannedMinutes: duration,
          resourceIds: [...(candidate.resourceIds || [])],
          reason: "Optimisation planning : avancement rendu possible par la fin anticipée de l'étape précédente.",
        });

        const simBooking = tempBookings.find((b) => b.id === candidate.id);
        if (simBooking) {
          simBooking.start = slot.start instanceof Date ? slot.start.toISOString() : slot.start;
          simBooking.end = slot.end instanceof Date ? slot.end.toISOString() : slot.end;
          simBooking.segments = clonePlanningSegments(slot.segments);
          simBooking.plannedStart = simBooking.start;
          simBooking.plannedEnd = simBooking.end;
          simBooking.plannedSegments = clonePlanningSegments(slot.segments);
          simBooking.plannedMinutes = duration;
        }
      }
    }
  });

  return previews;
}

function applyDependentBookingReschedule(item, previews, actor) {
  if (!item || !previews || !previews.length) return { ok: false, rescheduled: 0 };
  let count = 0;
  previews.forEach((preview) => {
    const booking = state.bookings.find((b) => b.id === preview.bookingId);
    if (!booking) return;
    if (getBookingOperationalStatus(booking) !== "planned") return;

    const oldStart = booking.start;
    const oldEnd = booking.end;
    const segments = clonePlanningSegments(preview.segments);
    if (!segments.length) return;

    booking.start = preview.newStart;
    booking.end = preview.newEnd;
    booking.segments = segments;
    booking.plannedStart = preview.newStart;
    booking.plannedEnd = preview.newEnd;
    booking.plannedSegments = clonePlanningSegments(segments);
    booking.plannedMinutes = Number(preview.plannedMinutes || 0) || getBookingEffectivePlanningMinutes(booking, item);
    booking.rescheduledAt = new Date().toISOString();

    addHistory(
      item,
      "planning.task.rescheduled",
      "Tâche avancée",
      `${preview.bookingTitle} avancée par ${actor || "Système"} (recalage dynamique). De ${formatDateTime(oldStart)} vers ${formatDateTime(preview.newStart)}. Source: dynamic-reschedule-v22.28.`
    );
    count++;
  });

  if (count > 0) {
    refreshCaseAppointmentFromBookings(item);
    saveState({ flushCloud: true, cloudReason: "reschedule-dependent-tasks" });
  }
  return { ok: true, rescheduled: count };
}

// ---------------------------------------------------------------------------
// Noyau planning terrain : compatibilités, capacités et occupation véhicule.
// Les alias acceptés ici permettent une migration progressive des anciennes
// sauvegardes sans rendre le moteur dépendant d'un libellé d'interface.
// ---------------------------------------------------------------------------

function planningTextKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizePlanningRole(value) {
  const key = planningTextKey(value);
  const aliases = {
    carrosserie: "tolier",
    tolerie: "tolier",
    carrossier: "tolier",
    body: "tolier",
    bodywork: "tolier",
    sous_traitant_carrosserie: "tolier",
    sous_traitant_tolerie: "tolier",
    external_body: "tolier",
    peinture: "peintre",
    paint: "peintre",
    painter: "peintre",
    sous_traitant_peinture: "peintre",
    external_paint: "peintre",
    mecanique: "mecanicien",
    mechanic: "mecanicien",
    diagnostic: "electricien",
    diagnosticien: "electricien",
    electricite: "electricien",
    electricity: "electricien",
    electrician: "electricien",
    cabine_peinture: "cabine",
    paint_booth: "cabine",
    booth: "cabine",
    zone_prep: "zone_preparation",
    preparation_peinture: "zone_preparation",
    zone_carrosserie: "zone_carrosserie",
    poste_tolerie: "zone_carrosserie",
    pont: "pont_mecanique",
    lift: "pont_mecanique",
    controle_final: "controle",
    chef_atelier: "controle",
    transport_sous_traitance: "transport",
    subcontract_transport: "transport",
    technicien_externe: "technicien_externe",
    external_technician: "technicien_externe",
    ressource_externe: "external_provider",
    external_resource: "external_provider",
    subcontractor: "external_provider",
    sous_traitant: "external_provider",
  };
  return aliases[key] || key;
}

function normalizePlanningSite(value, fallback = "internal") {
  const key = planningTextKey(value);
  if (["external", "externe", "outside", "subcontractor", "sous_traitant"].includes(key)) return "external";
  if (["transport", "transit", "transfer", "transfert"].includes(key)) return "transport";
  if (["any", "tous", "all"].includes(key)) return "any";
  if (["internal", "interne", "atelier", "workshop"].includes(key)) return "internal";
  return fallback;
}

function getResourcePlanningSite(resource) {
  if (!resource) return "internal";
  const explicit = resource.site || resource.siteType || resource.locationType || resource.scope;
  if (explicit) return normalizePlanningSite(explicit);
  const kind = planningTextKey(resource.kind || resource.type || resource.category || resource.role);
  if (/external|externe|subcontract|sous_traitant/.test(kind)) return "external";
  if (/transport|transfer|transfert/.test(kind)) return "transport";
  return "internal";
}

function getResourceSimultaneousCapacity(resource) {
  const raw = resource?.simultaneousCapacity
    ?? resource?.capacitySimultaneous
    ?? resource?.capacity
    ?? 1;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function getResourceDailyCapacityMinutes(resource) {
  const explicitMinutes = Number(
    resource?.dailyCapacityMinutes
    ?? resource?.capacityDailyMinutes
    ?? resource?.calendar?.dailyCapacityMinutes
  );
  if (Number.isFinite(explicitMinutes) && explicitMinutes > 0) return explicitMinutes;
  const hours = Number(resource?.dailyCapacityHours ?? resource?.capacityDailyHours);
  return Number.isFinite(hours) && hours > 0 ? Math.round(hours * 60) : Number.POSITIVE_INFINITY;
}

function getResourceCompatibilityValues(resource) {
  const values = [
    resource?.role,
    resource?.category,
    ...(Array.isArray(resource?.compatibleRoles) ? resource.compatibleRoles : []),
    ...(Array.isArray(resource?.compatibleTaskRoles) ? resource.compatibleTaskRoles : []),
    ...(Array.isArray(resource?.specialties) ? resource.specialties : []),
    ...(Array.isArray(resource?.specialites) ? resource.specialites : []),
  ];
  return new Set(values.map(normalizePlanningRole).filter(Boolean));
}

function isResourceCompatible(resource, requiredRole = "", requiredCategory = "", requiredSite = "any") {
  if (!resource || resource.active === false) return false;
  const site = getResourcePlanningSite(resource);
  const expectedSite = normalizePlanningSite(requiredSite, "any");
  if (expectedSite !== "any" && site !== expectedSite) return false;
  const expected = [requiredRole, requiredCategory].map(normalizePlanningRole).filter(Boolean);
  if (!expected.length) return true;
  const available = getResourceCompatibilityValues(resource);
  if (available.has("external_provider")) {
    const specialties = [...available].filter((value) => value !== "external_provider");
    return expected.every((value) => !specialties.length || specialties.includes(value));
  }
  return expected.every((value) => available.has(value));
}

function getResourceCalendarWorkHours(resource) {
  const calendar = resource?.calendar || resource?.availabilityCalendar || {};
  return calendar.workHours || calendar.hours || resource?.workHours || null;
}

function getResourceDayIntervals(resource, dateLike) {
  const date = new Date(dateLike);
  const calendar = resource?.calendar || resource?.availabilityCalendar || {};
  const dateKey = todayKey(date);
  const closedDates = [
    ...(Array.isArray(calendar.closedDates) ? calendar.closedDates : []),
    ...(Array.isArray(resource?.closedDates) ? resource.closedDates : []),
  ].map((entry) => typeof entry === "string" ? entry : entry?.date).filter(Boolean);
  if (closedDates.includes(dateKey)) return [];
  const hours = getResourceCalendarWorkHours(resource);
  if (!hours) return getDayIntervals(date);
  const rows = hours[date.getDay()] || hours[String(date.getDay())] || [];
  return rows
    .filter((row) => Array.isArray(row) && row.length === 2)
    .map(([start, end]) => ({ start: atTime(date, String(start)), end: atTime(date, String(end)) }))
    .filter((row) => row.start < row.end);
}

function getResourceUnavailableRanges(resource) {
  const calendar = resource?.calendar || resource?.availabilityCalendar || {};
  return [
    ...(Array.isArray(calendar.unavailable) ? calendar.unavailable : []),
    ...(Array.isArray(calendar.blackouts) ? calendar.blackouts : []),
    ...(Array.isArray(resource?.unavailable) ? resource.unavailable : []),
    ...(Array.isArray(resource?.blackouts) ? resource.blackouts : []),
  ].map((entry) => ({
    start: new Date(entry?.start || entry?.from || entry?.startAt || ""),
    end: new Date(entry?.end || entry?.to || entry?.endAt || ""),
  })).filter((entry) => entry.start < entry.end);
}

function getPlanningSlotSegments(slot) {
  if (Array.isArray(slot?.segments) && slot.segments.length) return clonePlanningSegments(slot.segments);
  if (slot?.start && slot?.end) return [{ start: new Date(slot.start).toISOString(), end: new Date(slot.end).toISOString() }];
  return [];
}

function planningRangesOverlap(startA, endA, startB, endB) {
  return new Date(startA) < new Date(endB) && new Date(endA) > new Date(startB);
}

function getBookingResourceUnits(booking, resourceId) {
  const mapped = booking?.resourceUnits?.[resourceId] ?? booking?.capacityUnitsByResource?.[resourceId];
  const raw = mapped ?? booking?.capacityUnits ?? 1;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function isResourceAvailableForSlot(resource, slot) {
  const segments = getPlanningSlotSegments(slot);
  if (!segments.length) return { ok: false, code: "invalid_slot", nextAt: null };
  const unavailable = getResourceUnavailableRanges(resource);
  for (const segment of segments) {
    const start = new Date(segment.start);
    const end = new Date(segment.end);
    const intervals = getResourceDayIntervals(resource, start);
    if (!intervals.some((interval) => start >= interval.start && end <= interval.end)) {
      const later = intervals.find((interval) => interval.start > start)?.start || startOfDay(addDays(start, 1));
      return { ok: false, code: "calendar", nextAt: later };
    }
    const blackout = unavailable.find((range) => planningRangesOverlap(start, end, range.start, range.end));
    if (blackout) return { ok: false, code: "calendar", nextAt: blackout.end };
  }
  return { ok: true, code: "", nextAt: null };
}

function getResourceDailyUsageMinutes(resourceId, bookings, dateLike, excludedBookingId = "") {
  const dayStart = startOfDay(dateLike);
  const dayEnd = addDays(dayStart, 1);
  return (bookings || []).reduce((sum, booking) => {
    if (!booking || booking.id === excludedBookingId || !isPlanningBlockingBooking(booking)) return sum;
    if (!(booking.resourceIds || []).includes(resourceId)) return sum;
    const units = getBookingResourceUnits(booking, resourceId);
    return sum + getPlanningSlotSegments(booking).reduce((segmentSum, segment) => {
      const start = maxDate(new Date(segment.start), dayStart);
      const end = minDate(new Date(segment.end), dayEnd);
      return end > start ? segmentSum + diffMinutes(start, end) * units : segmentSum;
    }, 0);
  }, 0);
}

function getMaximumResourceUnitsDuringSegment(resourceId, segment, bookings, candidateUnits = 1, excludedBookingId = "") {
  const segmentStart = new Date(segment.start);
  const segmentEnd = new Date(segment.end);
  const events = [
    { at: segmentStart.getTime(), delta: candidateUnits },
    { at: segmentEnd.getTime(), delta: -candidateUnits },
  ];
  (bookings || []).forEach((booking) => {
    if (!booking || booking.id === excludedBookingId || !isPlanningBlockingBooking(booking)) return;
    if (!(booking.resourceIds || []).includes(resourceId)) return;
    const units = getBookingResourceUnits(booking, resourceId);
    getPlanningSlotSegments(booking).forEach((busy) => {
      if (!planningRangesOverlap(segmentStart, segmentEnd, busy.start, busy.end)) return;
      const start = maxDate(segmentStart, new Date(busy.start));
      const end = minDate(segmentEnd, new Date(busy.end));
      events.push({ at: start.getTime(), delta: units }, { at: end.getTime(), delta: -units });
    });
  });
  events.sort((a, b) => a.at - b.at || a.delta - b.delta);
  let current = 0;
  let maximum = 0;
  events.forEach((event) => {
    current += event.delta;
    maximum = Math.max(maximum, current);
  });
  return maximum;
}

function getBookingVehicleLocation(booking) {
  return normalizePlanningSite(
    booking?.vehicleLocation
    || booking?.vehicleSite
    || booking?.site
    || (booking?.subcontractId ? "external" : "internal")
  );
}

function isVehicleExclusiveBooking(booking) {
  if (booking?.vehicleExclusive === false || booking?.parallelizable === true) return false;
  return booking?.vehicleExclusive === true
    || ["external", "transport"].includes(getBookingVehicleLocation(booking));
}

function findVehicleBookingConflict(candidate, bookings, excludedBookingId = "") {
  if (!candidate?.caseId) return null;
  const candidateLocation = getBookingVehicleLocation(candidate);
  const candidateExclusive = isVehicleExclusiveBooking(candidate);
  for (const booking of bookings || []) {
    if (!booking || booking.id === excludedBookingId || booking.caseId !== candidate.caseId || !isPlanningBlockingBooking(booking)) continue;
    const bookingLocation = getBookingVehicleLocation(booking);
    const locationConflict = candidateLocation !== bookingLocation;
    if (!locationConflict && !candidateExclusive && !isVehicleExclusiveBooking(booking)) continue;
    for (const segment of getPlanningSlotSegments(candidate)) {
      const busy = getPlanningSlotSegments(booking).find((row) => planningRangesOverlap(segment.start, segment.end, row.start, row.end));
      if (busy) {
        return {
          type: "vehicle",
          code: "vehicle_double_booking",
          bookingId: booking.id,
          caseId: candidate.caseId,
          start: busy.start,
          end: busy.end,
          message: "Le véhicule ne peut pas être réservé simultanément à deux emplacements.",
        };
      }
    }
  }
  return null;
}

function resolveDependencyBookings(candidate, bookings) {
  const refs = Array.isArray(candidate?.dependencies)
    ? candidate.dependencies
    : (Array.isArray(candidate?.dependsOn) ? candidate.dependsOn : []);
  if (!refs.length) return [];
  const normalizedRefs = new Set(refs.map((ref) => typeof ref === "object" ? (ref.id || ref.key || ref.taskId) : ref).filter(Boolean).map(String));
  return (bookings || []).filter((booking) => (
    booking?.caseId === candidate.caseId
    && booking?.id !== candidate.id
    && [booking.id, booking.key, booking.businessTaskId, booking.taskId].filter(Boolean).some((value) => normalizedRefs.has(String(value)))
  ));
}

function getBookingConstraintEnd(booking) {
  const status = getBookingOperationalStatus(booking);
  if (status === "completed" && (booking.actualEnd || booking.completedAt)) return new Date(booking.actualEnd || booking.completedAt);
  return new Date(booking.end || booking.plannedEnd || 0);
}

function validatePlanningCandidate(candidate, bookings = state.bookings, options = {}) {
  const issues = [];
  const conflicts = [];
  const slot = { start: candidate?.start, end: candidate?.end, segments: getPlanningSlotSegments(candidate) };
  if (!slot.segments.length) return { ok: false, issues: ["Créneau planning invalide."], conflicts: [{ type: "slot", code: "invalid_slot" }], nextAt: null };
  const resources = Array.isArray(state?.resources) ? state.resources : [];
  const resourceIds = [...new Set((candidate?.resourceIds || []).filter(Boolean))];
  const requiredRoles = candidate?.requiredRolesByResource || options.requiredRolesByResource || {};
  const requiredCategories = candidate?.requiredCategoriesByResource || options.requiredCategoriesByResource || {};
  const requiredSite = candidate?.requiredSite || options.requiredSite || "any";
  let nextAt = null;
  let permanent = false;

  if (!resourceIds.length) {
    issues.push("Aucune ressource affectée.");
    conflicts.push({ type: "resource", code: "missing_resource", message: issues.at(-1) });
    permanent = true;
  }

  resourceIds.forEach((resourceId) => {
    const resource = resources.find((entry) => entry.id === resourceId);
    if (!resource) {
      issues.push(`Ressource introuvable : ${resourceId}.`);
      conflicts.push({ type: "resource", code: "missing_resource", resourceId, message: issues.at(-1) });
      permanent = true;
      return;
    }
    if (resource.active === false) {
      issues.push(`Ressource inactive : ${resource.name || resource.id}.`);
      conflicts.push({ type: "resource", code: "inactive_resource", resourceId, message: issues.at(-1) });
      permanent = true;
      return;
    }
    const expectedRole = requiredRoles[resourceId] || "";
    const expectedCategory = requiredCategories[resourceId] || "";
    if (!isResourceCompatible(resource, expectedRole, expectedCategory, requiredSite)) {
      issues.push(`Ressource incompatible : ${resource.name || resource.id}.`);
      conflicts.push({ type: "resource", code: "incompatible_resource", resourceId, message: issues.at(-1) });
      permanent = true;
      return;
    }
    const availability = isResourceAvailableForSlot(resource, slot);
    if (!availability.ok) {
      issues.push(`Ressource indisponible selon son calendrier : ${resource.name || resource.id}.`);
      conflicts.push({ type: "calendar", code: "resource_calendar", resourceId, end: availability.nextAt?.toISOString?.() || "", message: issues.at(-1) });
      if (availability.nextAt && (!nextAt || availability.nextAt < nextAt)) nextAt = availability.nextAt;
    }
    const candidateUnits = getBookingResourceUnits(candidate, resourceId);
    const capacity = getResourceSimultaneousCapacity(resource);
    slot.segments.forEach((segment) => {
      const maximum = getMaximumResourceUnitsDuringSegment(resourceId, segment, bookings, candidateUnits, candidate.id || options.excludedBookingId || "");
      if (maximum > capacity) {
        const overlapping = (bookings || []).flatMap((booking) => getPlanningSlotSegments(booking).map((busy) => ({ booking, busy })))
          .filter(({ booking, busy }) => booking.id !== candidate.id && (booking.resourceIds || []).includes(resourceId) && planningRangesOverlap(segment.start, segment.end, busy.start, busy.end))
          .sort((a, b) => new Date(a.busy.end) - new Date(b.busy.end))[0];
        issues.push(`Capacité dépassée pour ${resource.name || resource.id}.`);
        conflicts.push({ type: "capacity", code: "simultaneous_capacity", resourceId, bookingId: overlapping?.booking?.id || "", end: overlapping?.busy?.end || segment.end, message: issues.at(-1) });
      }
    });
    const dailyCapacity = getResourceDailyCapacityMinutes(resource);
    const candidateByDay = new Map();
    slot.segments.forEach((segment) => {
      const key = todayKey(segment.start);
      candidateByDay.set(key, (candidateByDay.get(key) || 0) + diffMinutes(segment.start, segment.end) * candidateUnits);
    });
    candidateByDay.forEach((minutes, dateKey) => {
      const used = getResourceDailyUsageMinutes(resourceId, bookings, parseDateKey(dateKey), candidate.id || options.excludedBookingId || "");
      if (used + minutes > dailyCapacity) {
        issues.push(`Capacité journalière dépassée pour ${resource.name || resource.id}.`);
        conflicts.push({ type: "capacity", code: "daily_capacity", resourceId, end: startOfDay(addDays(parseDateKey(dateKey), 1)).toISOString(), message: issues.at(-1) });
      }
    });
  });

  const dependencyBookings = resolveDependencyBookings(candidate, bookings);
  const candidateStart = new Date(slot.segments[0].start);
  dependencyBookings.forEach((dependency) => {
    const dependencyEnd = getBookingConstraintEnd(dependency);
    if (dependencyEnd > candidateStart) {
      issues.push(`La tâche ne peut pas commencer avant la fin de sa dépendance ${dependency.title || dependency.key || dependency.id}.`);
      conflicts.push({ type: "dependency", code: "dependency_not_finished", bookingId: dependency.id, end: dependencyEnd.toISOString(), message: issues.at(-1) });
    }
  });

  const vehicleConflict = findVehicleBookingConflict(candidate, bookings, candidate.id || options.excludedBookingId || "");
  if (vehicleConflict) {
    issues.push(vehicleConflict.message);
    conflicts.push(vehicleConflict);
  }

  conflicts.forEach((conflict) => {
    const end = new Date(conflict.end || "");
    if (!Number.isNaN(end.getTime()) && (!nextAt || end < nextAt)) nextAt = end;
  });
  return { ok: issues.length === 0, issues: [...new Set(issues)], conflicts, nextAt, permanent };
}

function findPlanningConflicts(bookings = state.bookings) {
  const conflicts = [];
  const accepted = [];
  (bookings || [])
    .filter((booking) => booking && booking.type !== "leave" && booking.temporary !== true)
    .slice()
    .sort((a, b) => new Date(a.start) - new Date(b.start) || String(a.id || "").localeCompare(String(b.id || "")))
    .forEach((booking) => {
      const validation = validatePlanningCandidate(booking, accepted);
      validation.conflicts.forEach((conflict) => conflicts.push({ ...conflict, candidateBookingId: booking.id, caseId: booking.caseId }));
      accepted.push(booking);
    });
  return conflicts;
}

function normalizePlanningTask(task, index = 0) {
  const key = task?.key || task?.phase || task?.id || `task-${index + 1}`;
  const baseTemplate = STEP_TEMPLATES.find((template) => template.key === key) || {};
  const durationMinutes = Number(task?.durationMinutes ?? task?.plannedMinutes)
    || Math.round(Number(task?.durationHours ?? task?.laborHours ?? 0) * 60);
  const dependencies = Array.isArray(task?.dependencies)
    ? task.dependencies
    : (Array.isArray(task?.dependsOn) ? task.dependsOn : []);
  const parallelizable = task?.parallelizable === true;
  const serviceMode = planningTextKey(task?.serviceMode || task?.mode || "internal") || "internal";
  return {
    ...task,
    id: String(task?.id || task?.taskId || key || `task-${index + 1}`),
    taskId: String(task?.taskId || task?.id || key || `task-${index + 1}`),
    key,
    title: task?.title || task?.label || task?.operation || baseTemplate.title || getDurationLabel(key) || "Tâche atelier",
    durationMinutes: Math.max(0, Math.round(durationMinutes)),
    dependencies: [...new Set(dependencies.map((entry) => typeof entry === "object" ? (entry.id || entry.key || entry.taskId) : entry).filter(Boolean).map(String))],
    requiredRole: normalizePlanningRole(task?.requiredRole || task?.role || baseTemplate.role || ""),
    requiredCategory: normalizePlanningRole(task?.requiredCategory || task?.category || ""),
    equipmentRole: normalizePlanningRole(task?.equipmentRole || baseTemplate.equipmentRole || ""),
    serviceMode,
    requiredSite: serviceMode === "external" ? "external" : normalizePlanningSite(task?.requiredSite || task?.site || "internal"),
    parallelizable,
    sourceLineIds: Array.isArray(task?.sourceLineIds) ? [...new Set(task.sourceLineIds.filter(Boolean).map(String))] : [],
    sourceOperations: Array.isArray(task?.sourceOperations) ? [...new Set(task.sourceOperations.filter(Boolean).map(String))] : [],
    sourceLaborHours: Number(task?.sourceLaborHours ?? task?.laborHours ?? 0) || 0,
    vehicleExclusive: typeof task?.vehicleExclusive === "boolean" ? task.vehicleExclusive : !parallelizable,
    vehicleLocation: normalizePlanningSite(task?.vehicleLocation || (serviceMode === "external" ? "external" : "internal")),
  };
}

function buildCaseTaskGraph(item, tasks = getExplicitPlanningTasks(item)) {
  const graph = (tasks || []).map(normalizePlanningTask);
  const ids = new Set();
  graph.forEach((task) => {
    if (ids.has(task.id)) throw new Error(`Identifiant de tâche planning dupliqué : ${task.id}.`);
    ids.add(task.id);
  });
  graph.forEach((task) => {
    const missing = task.dependencies.filter((dependency) => !ids.has(dependency) && !graph.some((candidate) => candidate.key === dependency));
    if (missing.length) throw new Error(`Dépendance planning introuvable pour ${task.title} : ${missing.join(", ")}.`);
  });
  return graph;
}

function getPlanningTaskDependencyEnd(task, scheduledTasks, startAfter) {
  return task.dependencies.reduce((latest, dependency) => {
    const match = scheduledTasks.get(dependency)
      || [...scheduledTasks.values()].find((entry) => entry.task.key === dependency);
    return match ? maxDate(latest, new Date(match.end)) : latest;
  }, new Date(startAfter));
}

function buildInternalTaskStep(item, task, startAfter, bookings, assignment = createPlanningAssignmentContext()) {
  const baseTemplate = STEP_TEMPLATES.find((template) => template.key === task.key) || {};
  const template = {
    ...baseTemplate,
    key: task.key,
    taskId: task.taskId,
    title: task.title,
    role: task.requiredRole || baseTemplate.role,
    equipmentRole: task.equipmentRole || undefined,
  };
  if (!template.role) throw new Error(`Métier requis absent pour ${task.title}.`);
  const options = {
    caseId: item.id,
    bookingId: task.bookingId || "",
    stepKey: task.key,
    dependencies: task.dependencies,
    requiredCategory: task.requiredCategory,
    requiredSite: task.requiredSite || "internal",
    vehicleLocation: task.vehicleLocation || "internal",
    vehicleExclusive: task.vehicleExclusive,
    parallelizable: task.parallelizable,
  };
  let match = null;
  const requestedResourceIds = [...new Set((task.resourceIds || []).filter(Boolean))];
  if (requestedResourceIds.length) {
    const requiredRolesByResource = {};
    requiredRolesByResource[requestedResourceIds[0]] = template.role;
    if (template.equipmentRole && requestedResourceIds[1]) requiredRolesByResource[requestedResourceIds[1]] = template.equipmentRole;
    const slot = findEarliestSlot(requestedResourceIds, startAfter, task.durationMinutes, bookings, { ...options, requiredRolesByResource });
    const primary = state.resources.find((resource) => resource.id === requestedResourceIds[0]);
    const equipment = requestedResourceIds[1] ? state.resources.find((resource) => resource.id === requestedResourceIds[1]) : null;
    if (slot && primary) match = { slot, resourceIds: requestedResourceIds, primary, equipment };
  } else {
    match = findBestResourceSlot(
      template,
      startAfter,
      task.durationMinutes,
      bookings,
      isFastLaneJob(item),
      task.preferredResourceId || null,
      task.preferredEquipmentId || null,
      `${item.id}:${task.id}`,
      options,
    );
  }
  if (!match) throw new Error(`Aucune combinaison de ressources compatible pour ${task.title}.`);
  rememberPlanningAssignment(template, assignment, match.primary.id, match.equipment?.id || null);
  return makePlanningStep(item, template, match, {
    taskId: task.taskId,
    title: task.title,
    dependencies: task.dependencies,
    parallelizable: task.parallelizable,
    vehicleExclusive: task.vehicleExclusive,
    vehicleLocation: task.vehicleLocation,
    requiredRole: task.requiredRole,
    requiredCategory: task.requiredCategory,
    sourceLineIds: task.sourceLineIds,
    sourceOperations: task.sourceOperations,
    sourceLaborHours: task.sourceLaborHours,
    planningMode: "task-graph",
    details: task.details || task.observations || "",
  });
}

function scheduleTaskGraph(item, tasks, startAfter, bookings = state.bookings) {
  const graph = buildCaseTaskGraph(item, tasks);
  if (!graph.length) throw new Error("Renseignez au moins une tâche atelier pour calculer un planning.");
  if (graph.some((task) => task.durationMinutes <= 0)) throw new Error("Une durée manque sur une tâche du planning.");
  const pending = new Map(graph.map((task) => [task.id, task]));
  const scheduled = new Map();
  const tempBookings = (bookings || []).map(cloneBooking);
  const steps = [];
  const assignment = createPlanningAssignmentContext();
  let guard = 0;

  while (pending.size && guard < graph.length * graph.length + 10) {
    guard += 1;
    const ready = [...pending.values()].filter((task) => task.dependencies.every((dependency) => (
      scheduled.has(dependency)
      || [...scheduled.values()].some((entry) => entry.task.key === dependency)
    )));
    if (!ready.length) throw new Error("Cycle de dépendances détecté dans les tâches atelier.");
    ready.sort((a, b) => String(a.id).localeCompare(String(b.id)));

    ready.forEach((task) => {
      const earliest = getPlanningTaskDependencyEnd(task, scheduled, startAfter);
      let taskSteps = [];
      if (task.serviceMode === "external") {
        const provider = getExternalProviderCandidates(task).find((resource) => !task.subcontractorId || resource.id === task.subcontractorId);
        if (!provider) throw new Error(`Aucun sous-traitant compatible pour ${task.title}.`);
        const plan = buildSubcontractPlan(item, task, provider, earliest, tempBookings, { temporary: true });
        taskSteps = plan.steps;
      } else {
        taskSteps = [buildInternalTaskStep(item, task, earliest, tempBookings, assignment)];
      }
      taskSteps.forEach((step) => {
        steps.push(step);
        tempBookings.push(stepToBooking(item, step, true));
      });
      const taskEnd = taskSteps.reduce((latest, step) => maxDate(latest, new Date(step.end)), new Date(taskSteps[0].end));
      scheduled.set(task.id, { task, steps: taskSteps, end: taskEnd.toISOString() });
      pending.delete(task.id);
    });
  }

  if (pending.size) throw new Error("Impossible de résoudre le graphe de tâches atelier.");
  steps.sort((a, b) => new Date(a.start) - new Date(b.start) || String(a.taskId).localeCompare(String(b.taskId)));
  const end = steps.reduce((latest, step) => maxDate(latest, new Date(step.end)), new Date(steps[0].end));
  const totalMinutes = graph.reduce((sum, task) => sum + task.durationMinutes, 0);
  const marginMinutes = Math.ceil((totalMinutes * 0.2) / STEP_MINUTES) * STEP_MINUTES;
  return {
    start: steps[0].start,
    end: end.toISOString(),
    delivery: addWorkingMinutes(end, marginMinutes).toISOString(),
    marginMinutes,
    steps,
    taskGraph: true,
  };
}

function getExternalProviderCandidates(task = {}) {
  const requiredRole = normalizePlanningRole(task.requiredRole || task.role || "");
  const requiredCategory = normalizePlanningRole(task.requiredCategory || task.category || "");
  return (state.resources || [])
    .filter((resource) => resource.active !== false && getResourcePlanningSite(resource) === "external")
    .filter((resource) => isResourceCompatible(resource, requiredRole, requiredCategory, "external"))
    .sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)));
}

function getSubcontractTransferMinutes(provider, direction = "out") {
  const raw = direction === "out"
    ? (provider?.outboundTransferMinutes ?? provider?.transferOutMinutes ?? provider?.transferMinutesOut ?? provider?.transferMinutes ?? 0)
    : (provider?.returnTransferMinutes ?? provider?.transferReturnMinutes ?? provider?.transferMinutesReturn ?? provider?.transferMinutes ?? 0);
  const parsed = Number(raw);
  return Math.max(STEP_MINUTES, Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : STEP_MINUTES);
}

function getSubcontractWorkMinutes(task, provider) {
  const taskMinutes = Number(task?.durationMinutes ?? task?.plannedMinutes)
    || Math.round(Number(task?.durationHours ?? task?.laborHours ?? 0) * 60);
  const minimum = Number(provider?.minimumLeadTimeMinutes ?? provider?.minDelayMinutes ?? 0) || 0;
  const standard = Number(provider?.standardLeadTimeMinutes ?? provider?.standardDelayMinutes ?? 0) || 0;
  return Math.max(STEP_MINUTES, Math.round(taskMinutes || 0), Math.round(minimum), Math.round(standard));
}

function findSubcontractTransportResource(provider, options = {}) {
  const preferredId = options.transportResourceId || provider?.transportResourceId || "";
  if (preferredId) {
    const preferred = state.resources.find((resource) => resource.id === preferredId && resource.active !== false);
    if (preferred) return preferred;
  }
  return (state.resources || []).find((resource) => (
    resource.active !== false
    && normalizePlanningRole(resource.role || resource.category || resource.type) === "transport"
  )) || null;
}

function makeSubcontractPlanningStep(item, task, phase, title, slot, resources, dependencies, subcontractId, options = {}) {
  const resourceIds = [...new Set(resources.filter(Boolean).map((resource) => resource.id))];
  return {
    key: phase,
    taskId: `${task.taskId || task.id}:${phase}`,
    title,
    start: slot.start.toISOString(),
    end: slot.end.toISOString(),
    segments: clonePlanningSegments(slot.segments),
    resourceIds,
    primaryResourceId: resourceIds[0] || null,
    equipmentResourceIds: resourceIds.slice(1),
    dependencies: [...dependencies],
    parallelizable: false,
    vehicleExclusive: true,
    vehicleLocation: options.vehicleLocation || "external",
    requiredRole: options.requiredRole || "",
    requiredCategory: task.requiredCategory || "",
    serviceMode: "external",
    subcontractId,
    subcontractPhase: phase,
    planningMode: "subcontract",
    details: options.details || "",
    color: getVehiclePlanningColor(item),
  };
}

function buildSubcontractPlan(item, rawTask, providerOrId, startAfter, bookings = state.bookings, options = {}) {
  const task = rawTask?.durationMinutes !== undefined ? rawTask : normalizePlanningTask(rawTask || {}, 0);
  const provider = typeof providerOrId === "string"
    ? state.resources.find((resource) => resource.id === providerOrId)
    : providerOrId;
  if (!provider) throw new Error("Sous-traitant introuvable.");
  if (provider.active === false) throw new Error("Sous-traitant inactif.");
  if (getResourcePlanningSite(provider) !== "external") throw new Error("La ressource choisie n'est pas déclarée comme externe.");
  if (!isResourceCompatible(provider, task.requiredRole, task.requiredCategory, "external")) {
    throw new Error("Sous-traitant incompatible avec la tâche demandée.");
  }

  const subcontractId = options.subcontractId || `subcontract-${item.id}-${task.taskId || task.id}`;
  const transport = findSubcontractTransportResource(provider, options);
  const transportResources = [transport || provider];
  const outboundMinutes = getSubcontractTransferMinutes(provider, "out");
  const returnMinutes = getSubcontractTransferMinutes(provider, "return");
  const workMinutes = getSubcontractWorkMinutes(task, provider);
  const baseBookings = (bookings || []).map(cloneBooking);
  const outboundRoles = { [transportResources[0].id]: transport ? "transport" : "" };
  const outbound = findEarliestSlot(transportResources.map((resource) => resource.id), startAfter, outboundMinutes, baseBookings, {
    caseId: item.id,
    stepKey: "subcontract_transfer_out",
    dependencies: task.dependencies || [],
    requiredRolesByResource: outboundRoles,
    requiredSite: transport ? getResourcePlanningSite(transport) : "any",
    vehicleLocation: "transport",
    vehicleExclusive: true,
  });
  if (!outbound) throw new Error("Aucun créneau de transfert aller disponible.");
  const outboundStep = makeSubcontractPlanningStep(
    item,
    task,
    "subcontract_transfer_out",
    `Transfert aller · ${provider.name || "Sous-traitant"}`,
    outbound,
    transportResources,
    task.dependencies || [],
    subcontractId,
    { vehicleLocation: "transport", requiredRole: "transport" },
  );
  baseBookings.push(stepToBooking(item, outboundStep, true));

  const additionalIds = [
    ...(Array.isArray(task.externalResourceIds) ? task.externalResourceIds : []),
    ...(Array.isArray(provider.externalResourceIds) ? provider.externalResourceIds : []),
    provider.externalTechnicianId,
    provider.preparationZoneId,
    provider.paintBoothId,
  ].filter(Boolean);
  const externalResources = [provider, ...additionalIds.map((id) => state.resources.find((resource) => resource.id === id)).filter(Boolean)];
  const externalResourceIds = [...new Set(externalResources.map((resource) => resource.id))];
  const workRoles = Object.fromEntries(externalResources.map((resource, index) => [
    resource.id,
    index === 0 ? task.requiredRole : normalizePlanningRole(resource.role || resource.category),
  ]));
  const workSlot = findEarliestSlot(externalResourceIds, new Date(outbound.end), workMinutes, baseBookings, {
    caseId: item.id,
    stepKey: task.key,
    dependencies: [outboundStep.taskId],
    requiredRolesByResource: workRoles,
    requiredCategoriesByResource: { [provider.id]: task.requiredCategory || "" },
    requiredSite: "external",
    vehicleLocation: "external",
    vehicleExclusive: true,
  });
  if (!workSlot) throw new Error("Aucune capacité sous-traitant disponible.");
  const workStep = makeSubcontractPlanningStep(
    item,
    task,
    "subcontract_work",
    `${task.title} · ${provider.name || "Sous-traitant"}`,
    workSlot,
    externalResources,
    [outboundStep.taskId],
    subcontractId,
    { vehicleLocation: "external", requiredRole: task.requiredRole, details: task.details || "" },
  );
  baseBookings.push(stepToBooking(item, workStep, true));

  const returnSlot = findEarliestSlot(transportResources.map((resource) => resource.id), new Date(workSlot.end), returnMinutes, baseBookings, {
    caseId: item.id,
    stepKey: "subcontract_transfer_return",
    dependencies: [workStep.taskId],
    requiredRolesByResource: outboundRoles,
    requiredSite: transport ? getResourcePlanningSite(transport) : "any",
    vehicleLocation: "transport",
    vehicleExclusive: true,
  });
  if (!returnSlot) throw new Error("Aucun créneau de transfert retour disponible.");
  const returnStep = makeSubcontractPlanningStep(
    item,
    task,
    "subcontract_transfer_return",
    `Transfert retour · ${provider.name || "Sous-traitant"}`,
    returnSlot,
    transportResources,
    [workStep.taskId],
    subcontractId,
    { vehicleLocation: "transport", requiredRole: "transport" },
  );

  return {
    subcontractId,
    provider,
    task,
    steps: [outboundStep, workStep, returnStep],
    start: outboundStep.start,
    end: returnStep.end,
    outboundTransferMinutes: outboundMinutes,
    workMinutes,
    returnTransferMinutes: returnMinutes,
  };
}

function ensureCaseSubcontracting(item) {
  if (!item.subcontracting || typeof item.subcontracting !== "object" || Array.isArray(item.subcontracting)) {
    const legacyAssignments = Array.isArray(item.subcontracting)
      ? item.subcontracting
      : (Array.isArray(item.subcontracts) ? item.subcontracts : []);
    item.subcontracting = { enabled: legacyAssignments.length > 0, assignments: legacyAssignments };
  }
  if (!Array.isArray(item.subcontracting.assignments)) item.subcontracting.assignments = [];
  item.subcontracts = item.subcontracting.assignments;
  return item.subcontracting;
}

function reserveSubcontractPlan(item, rawTask, providerOrId, startAfter, options = {}) {
  const permission = typeof guardAction === "function" ? guardAction("planning.edit", { item }, { notify: false }) : { ok: true };
  if (!permission.ok) return { ok: false, message: permission.message };
  try {
    const plan = buildSubcontractPlan(item, rawTask, providerOrId, startAfter, state.bookings, options);
    const bookings = plan.steps.map((step) => stepToBooking(item, step, false));
    state.bookings.push(...bookings);
    const container = ensureCaseSubcontracting(item);
    container.enabled = true;
    const assignment = {
      id: plan.subcontractId,
      taskId: plan.task.taskId || plan.task.id,
      taskKey: plan.task.key,
      taskTitle: plan.task.title,
      providerId: plan.provider.id,
      providerName: plan.provider.name || "Sous-traitant",
      status: "transport_planned",
      plannedDepartureAt: plan.start,
      plannedReturnAt: plan.end,
      actualDepartureAt: "",
      actualReceivedAt: "",
      actualReturnAt: "",
      plannedDurationMinutes: plan.workMinutes,
      actualDurationMinutes: 0,
      outboundTransferMinutes: plan.outboundTransferMinutes,
      returnTransferMinutes: plan.returnTransferMinutes,
      bookingIds: bookings.map((booking) => booking.id),
      history: [],
    };
    container.assignments.push(assignment);
    addSubcontractHistory(item, assignment, "transport_planned", "Sous-traitance planifiée", options.reason || "Choix externe validé.", options.actor);
    recalculateEstimatedDelivery(item, options.reason || "Sous-traitance planifiée", options.actor);
    return { ok: true, plan, assignment, bookings };
  } catch (error) {
    return { ok: false, message: error.message || "Planification sous-traitance impossible." };
  }
}

function chooseTaskServicePlan(item, rawTask, startAfter, options = {}) {
  const task = normalizePlanningTask(rawTask || {}, 0);
  const bookings = options.bookings || state.bookings;
  const choices = [];
  if (task.serviceMode !== "external") {
    try {
      const step = buildInternalTaskStep(item, { ...task, serviceMode: "internal", requiredSite: "internal", vehicleLocation: "internal" }, startAfter, bookings);
      choices.push({ mode: "internal", start: step.start, end: step.end, steps: [step] });
    } catch (error) {
      if (task.serviceMode === "internal") throw error;
    }
  }
  if (task.serviceMode !== "internal" || options.allowExternal === true) {
    getExternalProviderCandidates(task).forEach((provider) => {
      try {
        const plan = buildSubcontractPlan(item, task, provider, startAfter, bookings, { temporary: true });
        choices.push({ mode: "external", providerId: provider.id, start: plan.start, end: plan.end, steps: plan.steps, plan });
      } catch (error) {
        // Une ressource externe sans capacité n'est pas une option valide.
      }
    });
  }
  if (!choices.length) throw new Error(`Aucune option interne ou externe disponible pour ${task.title}.`);
  choices.sort((a, b) => new Date(a.end) - new Date(b.end) || new Date(a.start) - new Date(b.start) || String(a.mode).localeCompare(String(b.mode)));
  return { selected: choices[0], alternatives: choices };
}

const SUBCONTRACT_STATUS_ALIASES = {
  a_programmer: "to_schedule",
  a_envoyer: "to_send",
  transport_planifie: "transport_planned",
  envoye_en_sous_traitance: "sent",
  recu_par_le_sous_traitant: "received",
  en_cours: "in_progress",
  en_preparation: "preparation",
  en_peinture: "paint",
  en_sechage: "drying",
  retour_prevu: "return_planned",
  retourne_a_l_atelier: "returned",
  retard_sous_traitance: "delayed",
  termine: "completed",
  annule: "cancelled",
};

function normalizeSubcontractStatus(value) {
  const key = planningTextKey(value);
  const normalized = SUBCONTRACT_STATUS_ALIASES[key] || key;
  const allowed = new Set(["to_schedule", "to_send", "transport_planned", "sent", "received", "in_progress", "preparation", "paint", "drying", "return_planned", "returned", "delayed", "completed", "cancelled"]);
  return allowed.has(normalized) ? normalized : "to_schedule";
}

function getSubcontractAssignment(item, subcontractId) {
  return ensureCaseSubcontracting(item).assignments.find((entry) => entry.id === subcontractId) || null;
}

function addSubcontractHistory(item, assignment, status, label, details = "", actor = null) {
  const at = new Date().toISOString();
  assignment.history = Array.isArray(assignment.history) ? assignment.history : [];
  assignment.history.unshift({ at, status, label, details, actor: actor?.userName || actor?.name || actor || "Atelier" });
  if (typeof addHistoryWithActor === "function") {
    addHistoryWithActor(item, `subcontract.${status}`, label, `${assignment.providerName || assignment.providerId} · ${details}`.trim(), actor || null);
  } else if (typeof addHistory === "function") {
    addHistory(item, `subcontract.${status}`, label, details);
  }
}

function updateSubcontractStatus(item, subcontractId, status, meta = {}) {
  const assignment = getSubcontractAssignment(item, subcontractId);
  if (!assignment) return { ok: false, message: "Sous-traitance introuvable." };
  const nextStatus = normalizeSubcontractStatus(status);
  const at = new Date(meta.at || new Date());
  if (Number.isNaN(at.getTime())) return { ok: false, message: "Date de sous-traitance invalide." };
  assignment.status = nextStatus;
  if (nextStatus === "sent") assignment.actualDepartureAt = at.toISOString();
  if (nextStatus === "received") assignment.actualReceivedAt = at.toISOString();
  if (["returned", "completed"].includes(nextStatus)) {
    assignment.actualReturnAt = at.toISOString();
    if (assignment.actualDepartureAt) assignment.actualDurationMinutes = diffMinutes(new Date(assignment.actualDepartureAt), at);
  }
  addSubcontractHistory(item, assignment, nextStatus, meta.label || `Sous-traitance : ${nextStatus}`, meta.reason || meta.details || "", meta.actor);
  recalculateEstimatedDelivery(item, meta.reason || `Statut sous-traitance : ${nextStatus}`, meta.actor, { referenceDate: at });
  return { ok: true, assignment };
}

function recordSubcontractDeparture(item, subcontractId, at = new Date(), meta = {}) {
  return updateSubcontractStatus(item, subcontractId, "sent", { ...meta, at, label: "Départ sous-traitance enregistré" });
}

function recordSubcontractReceipt(item, subcontractId, at = new Date(), meta = {}) {
  return updateSubcontractStatus(item, subcontractId, "received", { ...meta, at, label: "Réception par le sous-traitant enregistrée" });
}

function recordSubcontractReturn(item, subcontractId, at = new Date(), meta = {}) {
  return updateSubcontractStatus(item, subcontractId, "returned", { ...meta, at, label: "Retour sous-traitance enregistré" });
}

function getBookingRequiredRolesByResource(booking) {
  const map = {};
  (booking.resourceIds || []).forEach((resourceId, index) => {
    const resource = state.resources.find((entry) => entry.id === resourceId);
    map[resourceId] = index === 0 && booking.requiredRole
      ? booking.requiredRole
      : normalizePlanningRole(resource?.role || resource?.category || "");
  });
  return map;
}

function getBookingRequiredResourceSite(booking) {
  const sites = [...new Set((booking.resourceIds || [])
    .map((resourceId) => state.resources.find((resource) => resource.id === resourceId))
    .filter(Boolean)
    .map((resource) => getResourcePlanningSite(resource))
    .filter(Boolean))];
  return sites.length === 1 ? sites[0] : "any";
}

function getDependentBookings(item, sourceBooking) {
  if (!item || !sourceBooking) return [];
  return getCaseWorkBookings(item).filter((candidate) => (
    candidate.id !== sourceBooking.id
    && getBookingOperationalStatus(candidate) === "planned"
    && getPreviousRequiredBookings(item, candidate).some((dependency) => dependency.id === sourceBooking.id)
  ));
}

function cascadeDependentBookings(item, sourceBooking, reason = "Dépendance replanifiée", actor = null) {
  if (!item || !sourceBooking) return { ok: false, rescheduled: 0, bookings: [] };
  const changed = [];
  const queue = [sourceBooking];
  const visited = new Set();
  while (queue.length) {
    const source = queue.shift();
    if (!source || visited.has(source.id)) continue;
    visited.add(source.id);
    getDependentBookings(item, source).forEach((dependent) => {
      const dependencies = getPreviousRequiredBookings(item, dependent);
      const earliest = dependencies.reduce((latest, dependency) => maxDate(latest, getBookingConstraintEnd(dependency)), new Date(0));
      if (!Number.isFinite(earliest.getTime()) || new Date(dependent.start) >= earliest) return;
      const duration = getBookingEffectivePlanningMinutes(dependent, item);
      const otherBookings = state.bookings.filter((booking) => booking.id !== dependent.id).map(cloneBooking);
      const slot = findEarliestSlot(dependent.resourceIds, earliest, duration, otherBookings, {
        caseId: item.id,
        bookingId: dependent.id,
        stepKey: dependent.key,
        dependencies: dependent.dependencies || [],
        requiredRolesByResource: getBookingRequiredRolesByResource(dependent),
        requiredSite: getBookingRequiredResourceSite(dependent),
        vehicleLocation: getBookingVehicleLocation(dependent),
        vehicleExclusive: isVehicleExclusiveBooking(dependent),
        parallelizable: dependent.parallelizable === true,
      });
      if (!slot) throw new Error(`Impossible de replanifier la tâche dépendante ${dependent.title || dependent.key}.`);
      const previousStart = dependent.start;
      dependent.initialPlannedStart = dependent.initialPlannedStart || dependent.plannedStart || dependent.start;
      dependent.initialPlannedEnd = dependent.initialPlannedEnd || dependent.plannedEnd || dependent.end;
      dependent.start = slot.start.toISOString();
      dependent.end = slot.end.toISOString();
      dependent.segments = clonePlanningSegments(slot.segments);
      dependent.plannedStart = dependent.start;
      dependent.plannedEnd = dependent.end;
      dependent.plannedSegments = clonePlanningSegments(slot.segments);
      dependent.rescheduledAt = new Date().toISOString();
      changed.push(dependent);
      if (typeof addHistoryWithActor === "function") {
        addHistoryWithActor(item, "planning.task.dependency_rescheduled", "Tâche dépendante replanifiée", `${dependent.title || dependent.key} déplacée de ${formatDateTime(previousStart)} vers ${formatDateTime(dependent.start)}. Motif : ${reason}.`, actor || null);
      }
      queue.push(dependent);
    });
  }
  return { ok: true, rescheduled: changed.length, bookings: changed };
}

function updateSubcontractDelay(item, subcontractId, delayMinutes, reason, meta = {}) {
  const assignment = getSubcontractAssignment(item, subcontractId);
  if (!assignment) return { ok: false, message: "Sous-traitance introuvable." };
  const minutes = Math.max(0, Math.round(Number(delayMinutes || 0)));
  const cleanReason = String(reason || "").trim();
  if (!minutes || !cleanReason) return { ok: false, message: "Durée et motif du retard sous-traitant obligatoires." };
  const chain = (assignment.bookingIds || [])
    .map((id) => state.bookings.find((booking) => booking.id === id))
    .filter(Boolean)
    .filter((booking) => getBookingOperationalStatus(booking) !== "completed")
    .sort((a, b) => new Date(a.start) - new Date(b.start));
  if (!chain.length) return { ok: false, message: "Aucune réservation sous-traitant déplaçable." };
  const chainIds = new Set(chain.map((booking) => booking.id));
  const tempBookings = state.bookings.filter((booking) => !chainIds.has(booking.id)).map(cloneBooking);
  let cursor = addMinutes(new Date(chain[0].start), minutes);
  chain.forEach((booking) => {
    const duration = getBookingEffectivePlanningMinutes(booking, item);
    const slot = findEarliestSlot(booking.resourceIds, cursor, duration, tempBookings, {
      caseId: item.id,
      bookingId: booking.id,
      stepKey: booking.key,
      requiredRolesByResource: getBookingRequiredRolesByResource(booking),
      requiredSite: getBookingRequiredResourceSite(booking),
      vehicleLocation: getBookingVehicleLocation(booking),
      vehicleExclusive: true,
    });
    if (!slot) throw new Error(`Impossible de reporter ${booking.title || booking.key}.`);
    booking.initialPlannedStart = booking.initialPlannedStart || booking.plannedStart || booking.start;
    booking.initialPlannedEnd = booking.initialPlannedEnd || booking.plannedEnd || booking.end;
    booking.start = slot.start.toISOString();
    booking.end = slot.end.toISOString();
    booking.segments = clonePlanningSegments(slot.segments);
    booking.plannedStart = booking.start;
    booking.plannedEnd = booking.end;
    booking.plannedSegments = clonePlanningSegments(slot.segments);
    booking.rescheduledAt = new Date().toISOString();
    tempBookings.push(cloneBooking(booking));
    cursor = new Date(booking.end);
  });
  assignment.status = "delayed";
  assignment.delayMinutes = Number(assignment.delayMinutes || 0) + minutes;
  assignment.delayReason = cleanReason;
  assignment.plannedDepartureAt = chain[0].start;
  assignment.plannedReturnAt = chain.at(-1).end;
  addSubcontractHistory(item, assignment, "delayed", "Retard sous-traitance", `${cleanReason} · +${minutes} min`, meta.actor);
  const cascade = cascadeDependentBookings(item, chain.at(-1), `Retard sous-traitant : ${cleanReason}`, meta.actor);
  recalculateEstimatedDelivery(item, `Retard sous-traitant : ${cleanReason}`, meta.actor);
  return { ok: true, assignment, rescheduled: chain.length, cascade };
}

function ensureDeliveryEstimateState(item) {
  const existing = item.deliveryEstimate && typeof item.deliveryEstimate === "object"
    ? item.deliveryEstimate
    : {};
  item.deliveryEstimate = {
    initial: existing.initial || item.initialEstimatedDelivery || "",
    current: existing.current || existing.revised || item.revisedEstimatedDelivery || item.appointment?.delivery || "",
    revised: existing.revised || existing.current || item.revisedEstimatedDelivery || item.appointment?.delivery || "",
    status: existing.status || "to_confirm",
    reasons: Array.isArray(existing.reasons) ? [...existing.reasons] : [],
    reasonCodes: Array.isArray(existing.reasonCodes) ? [...existing.reasonCodes] : [],
    history: Array.isArray(existing.history) ? [...existing.history] : [],
    lastRecalculatedAt: existing.lastRecalculatedAt || "",
    delayMinutes: Number(existing.delayMinutes || 0) || 0,
  };
  return item.deliveryEstimate;
}

function getPredictedBookingEnd(booking, referenceDate = new Date()) {
  const plannedEnd = new Date(booking.end || booking.plannedEnd || 0);
  const actualEndValue = booking.actualEnd || booking.completedAt || "";
  const actualEnd = actualEndValue ? new Date(actualEndValue) : null;
  if (actualEnd && !Number.isNaN(actualEnd.getTime())) return actualEnd;
  const status = getBookingOperationalStatus(booking);
  if (status === "started" && !Number.isNaN(plannedEnd.getTime()) && referenceDate > plannedEnd) {
    const plannedMinutes = getBookingEffectivePlanningMinutes(booking, getBookingCase(booking));
    const workedMinutes = Number(booking.actualWorkedMinutes || 0) || estimateBookingWorkedMinutes(booking, referenceDate);
    const remaining = Math.max(STEP_MINUTES, plannedMinutes - workedMinutes);
    return addWorkingMinutes(referenceDate, remaining);
  }
  return plannedEnd;
}

function getPlanningConflictsForCase(caseId) {
  const conflicts = [];
  (state.bookings || []).filter((booking) => booking.caseId === caseId && booking.type !== "leave" && booking.temporary !== true).forEach((booking) => {
    const others = state.bookings.filter((candidate) => candidate.id !== booking.id);
    const validation = validatePlanningCandidate(booking, others, { dependencyBookings: state.bookings });
    validation.conflicts.forEach((conflict) => conflicts.push({ ...conflict, candidateBookingId: booking.id, caseId }));
  });
  return conflicts;
}

function collectEstimatedDeliveryReasons(item, bookings, referenceDate) {
  const reasons = [];
  const codes = [];
  const add = (code, message) => {
    if (!codes.includes(code)) codes.push(code);
    if (!reasons.includes(message)) reasons.push(message);
  };
  const graphTasks = getExplicitPlanningTasks(item).map(normalizePlanningTask);
  if (!bookings.length) add("dependency_unplanned", "Dépendance non planifiée ou planning absent.");
  if (graphTasks.some((task) => task.durationMinutes <= 0)) add("missing_duration", "Durée manquante.");
  graphTasks.forEach((task) => {
    const taskBookings = bookings.filter((booking) => [booking.taskId, booking.key].includes(task.taskId) || booking.taskId === task.id);
    if (!taskBookings.length) add("task_unplanned", `Tâche non planifiée : ${task.title}.`);
    task.dependencies.forEach((dependency) => {
      const planned = bookings.some((booking) => [booking.id, booking.taskId, booking.key].filter(Boolean).includes(dependency));
      if (!planned) add("dependency_unplanned", `Dépendance non planifiée : ${dependency}.`);
    });
  });
  bookings.forEach((booking) => {
    if (!(booking.resourceIds || []).length) add("technician_unassigned", `Technicien ou ressource non affecté : ${booking.title || booking.key}.`);
    if (isBookingTaskBlocked(booking)) add("blocked_task", `Tâche bloquée : ${booking.title || booking.key}${booking.blockReason ? ` (${booking.blockReason})` : ""}.`);
    (booking.resourceIds || []).forEach((resourceId) => {
      const resource = state.resources.find((entry) => entry.id === resourceId);
      if (!resource || resource.active === false) add("resource_unavailable", `Ressource indisponible : ${resource?.name || resourceId}.`);
    });
    const predictedEnd = getPredictedBookingEnd(booking, referenceDate);
    if (getBookingOperationalStatus(booking) !== "completed" && predictedEnd < referenceDate) add("planning_delay", `Conflit ou retard de planning : ${booking.title || booking.key}.`);
  });
  const caseConflicts = getPlanningConflictsForCase(item.id);
  if (caseConflicts.some((conflict) => ["simultaneous_capacity", "daily_capacity", "vehicle_double_booking"].includes(conflict.code))) {
    add("planning_conflict", "Conflit de planning ou capacité dépassée.");
  }
  const subcontracting = ensureCaseSubcontracting(item);
  subcontracting.assignments.forEach((assignment) => {
    const provider = state.resources.find((resource) => resource.id === assignment.providerId);
    if (!provider || provider.active === false) add("subcontractor_unavailable", `Sous-traitant indisponible : ${assignment.providerName || assignment.providerId}.`);
    if (assignment.status === "delayed") add("subcontractor_delay", `Retard sous-traitant : ${assignment.delayReason || assignment.providerName || "à confirmer"}.`);
  });
  return { reasons, codes };
}

function recalculateEstimatedDelivery(item, reason = "Recalcul automatique du planning", actor = null, options = {}) {
  if (!item) return { ok: false, status: "to_confirm", current: "", reasons: ["Dossier introuvable."] };
  const estimate = ensureDeliveryEstimateState(item);
  const referenceDate = new Date(options.referenceDate || new Date());
  const bookings = (state.bookings || [])
    .filter((booking) => booking.caseId === item.id && booking.type !== "leave" && booking.temporary !== true)
    .slice()
    .sort((a, b) => new Date(a.start) - new Date(b.start));
  const { reasons, codes } = collectEstimatedDeliveryReasons(item, bookings, referenceDate);
  const predictedEnds = bookings.map((booking) => getPredictedBookingEnd(booking, referenceDate)).filter((date) => !Number.isNaN(date.getTime()));
  ensureCaseSubcontracting(item).assignments.forEach((assignment) => {
    const plannedReturn = new Date(assignment.plannedReturnAt || "");
    const actualReturn = new Date(assignment.actualReturnAt || "");
    if (!Number.isNaN(plannedReturn.getTime())) predictedEnds.push(plannedReturn);
    if (!Number.isNaN(actualReturn.getTime())) predictedEnds.push(actualReturn);
  });
  const latestEnd = predictedEnds.length ? new Date(Math.max(...predictedEnds.map((date) => date.getTime()))) : null;
  const marginMinutes = Math.max(0, Number(item.appointment?.marginMinutes || 0) || 0);
  let current = "";
  if (latestEnd) {
    try {
      current = (marginMinutes ? addWorkingMinutes(latestEnd, marginMinutes) : latestEnd).toISOString();
    } catch (error) {
      current = addMinutes(latestEnd, marginMinutes).toISOString();
    }
  }
  const status = current && !reasons.length ? "confirmed" : "to_confirm";
  const previous = estimate.current || "";
  const previousStatus = estimate.status || "to_confirm";
  const changed = previous !== current || previousStatus !== status || JSON.stringify(estimate.reasonCodes || []) !== JSON.stringify(codes);
  const now = new Date().toISOString();
  if (!estimate.initial && current) estimate.initial = current;
  estimate.current = current;
  estimate.revised = current;
  estimate.status = status;
  estimate.reasons = reasons;
  estimate.reasonCodes = codes;
  estimate.lastRecalculatedAt = now;
  estimate.delayMinutes = estimate.initial && current
    ? Math.max(0, diffMinutes(new Date(estimate.initial), new Date(current)))
    : 0;
  item.initialEstimatedDelivery = estimate.initial || "";
  item.revisedEstimatedDelivery = current;
  item.plannedRepairStart = bookings[0]?.plannedStart || bookings[0]?.start || item.appointment?.start || "";
  item.actualRepairStart = bookings.map((booking) => booking.actualStart || booking.startedAt).filter(Boolean).sort()[0] || item.actualRepairStart || "";
  item.totalPlannedMinutes = bookings.reduce((sum, booking) => sum + getBookingPlannedMinutes(booking, item), 0);
  item.totalActualMinutes = bookings.reduce((sum, booking) => sum + Math.max(0, Number(booking.actualWorkedMinutes || 0) || 0), 0);
  item.estimatedDelayMinutes = estimate.delayMinutes;
  if (item.appointment) item.appointment.delivery = current || item.appointment.delivery || "";

  if (changed) {
    const actorName = actor?.userName || actor?.name || actor || "Système";
    estimate.history.unshift({
      at: now,
      previous,
      current,
      status,
      reason: String(reason || "Recalcul automatique"),
      reasons: [...reasons],
      actor: actorName,
    });
    estimate.history = estimate.history.slice(0, 200);
    if (typeof addHistoryWithActor === "function") {
      const label = previous ? "Livraison estimée révisée" : "Livraison estimée initiale";
      const details = current
        ? `${previous ? `${formatDateTime(previous)} → ` : ""}${formatDateTime(current)} · Motif : ${reason}.${reasons.length ? ` Causes : ${reasons.join(" ")}` : ""}`
        : `Livraison estimée à confirmer · Motif : ${reason}. Causes : ${reasons.join(" ") || "planning incomplet"}.`;
      addHistoryWithActor(item, previous ? "delivery.estimate.revised" : "delivery.estimate.initial", label, details, actor || null);
    }
  }
  return { ok: Boolean(current), initial: estimate.initial, current, revised: current, status, reasons, reasonCodes: codes, delayMinutes: estimate.delayMinutes, changed };
}
