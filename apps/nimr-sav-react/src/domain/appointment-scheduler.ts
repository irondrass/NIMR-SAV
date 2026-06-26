import { WorkshopResource, getActiveResources, getResourcesBySkill } from './resource-manager';
import { PlanningBooking, getBlockingCollisionReasons } from './collision-engine';
import {
  isWorkshopOpenDay,
  addWorkingMinutes,
  getPlanningHorizon,
  splitDayIntoSlots,
} from './workshop-calendar';

export interface AppointmentOption {
  depositDate: Date;
  workStartDate: Date;
  workEndDate: Date;
  deliveryDate: Date;
  technicianId: string;
  equipmentId: string;
  score: number;
  reasons: string[];
  conflictsAvoided: number;
}

export function estimateDeliveryDateFromPlan(endDate: Date): Date {
  // Let's add 60 minutes of quality control and paperwork to estimate delivery
  return addWorkingMinutes(endDate, 60);
}

export function scoreAppointmentSlot(
  start: Date,
  techId: string,
  _equipId: string,
  horizonStart: Date,
): number {
  const diffDays = (start.getTime() - horizonStart.getTime()) / (1000 * 60 * 60 * 24);
  // Base score 100, subtract 2 points per day of delay to favor earlier appointments
  let score = 100 - Math.round(diffDays * 2);

  // Bonus for technician assignment
  if (techId.includes('1')) score += 5; // Preference for Primary Tech

  return Math.max(1, Math.min(100, score));
}

export function generateAppointmentOptions(
  typeIntervention: string,
  durationMinutes: number,
  existingBookings: PlanningBooking[],
  resources: WorkshopResource[],
  startDate: Date = new Date(),
): AppointmentOption[] {
  const activeResources = getActiveResources(resources);
  const horizon = getPlanningHorizon(startDate);

  // 1. Find potential technicians
  let requiredSkill = 'mecanique';
  if (typeIntervention === 'peinture') requiredSkill = 'peinture';
  else if (typeIntervention === 'tole') requiredSkill = 'tole';
  else if (typeIntervention === 'preparation') requiredSkill = 'preparation';

  const qualifiedTechs = getResourcesBySkill(activeResources, requiredSkill).filter(
    (r) => r.type === 'technicien',
  );

  // 2. Find potential equipment/bays
  let qualifiedEquip = activeResources.filter(
    (r) => r.type === 'bay' || r.type === 'lift' || r.type === 'paint_booth',
  );
  if (typeIntervention === 'peinture') {
    qualifiedEquip = qualifiedEquip.filter((r) => r.type === 'paint_booth');
  } else if (typeIntervention === 'mecanique') {
    qualifiedEquip = qualifiedEquip.filter((r) => r.type === 'lift' || r.type === 'bay');
  } else {
    qualifiedEquip = qualifiedEquip.filter((r) => r.type === 'bay');
  }

  if (qualifiedTechs.length === 0 || qualifiedEquip.length === 0) {
    return [];
  }

  const options: AppointmentOption[] = [];
  let dayOffset = 0;
  let conflictsChecked = 0;

  // Search day by day
  while (options.length < 3 && dayOffset < 60) {
    const currentDay = new Date(horizon.start);
    currentDay.setDate(currentDay.getDate() + dayOffset);

    if (isWorkshopOpenDay(currentDay)) {
      // Split day into 30-min start time candidates
      const timeSlots = splitDayIntoSlots(currentDay, 30);

      for (const slot of timeSlots) {
        if (options.length >= 3) break;

        const workStart = slot.start;
        const workEnd = addWorkingMinutes(workStart, durationMinutes);

        // Try pairing each qualified technician with each qualified equipment
        for (const tech of qualifiedTechs) {
          if (options.length >= 3) break;

          for (const equip of qualifiedEquip) {
            if (options.length >= 3) break;

            const techBooking: PlanningBooking = {
              id: 'temp-tech',
              resourceId: tech.id,
              start: workStart,
              end: workEnd,
              caseId: 'temp',
            };
            const equipBooking: PlanningBooking = {
              id: 'temp-equip',
              resourceId: equip.id,
              start: workStart,
              end: workEnd,
              caseId: 'temp',
            };

            const techReasons = getBlockingCollisionReasons(techBooking, existingBookings, resources);
            const equipReasons = getBlockingCollisionReasons(equipBooking, existingBookings, resources);

            conflictsChecked += techReasons.length + equipReasons.length;

            if (techReasons.length === 0 && equipReasons.length === 0) {
              const depositDate = new Date(workStart);
              // Deposit date is 10 mins before work starts
              depositDate.setMinutes(depositDate.getMinutes() - 10);

              const deliveryDate = estimateDeliveryDateFromPlan(workEnd);
              const score = scoreAppointmentSlot(workStart, tech.id, equip.id, horizon.start);

              options.push({
                depositDate,
                workStartDate: workStart,
                workEndDate: workEnd,
                deliveryDate,
                technicianId: tech.id,
                equipmentId: equip.id,
                score,
                reasons: [
                  `Ressources '${tech.label}' et '${equip.label}' disponibles.`,
                  `Créneau optimal de ${durationMinutes} minutes sans interruption.`,
                ],
                conflictsAvoided: conflictsChecked,
              });
            }
          }
        }
      }
    }
    dayOffset++;
  }

  return options.sort((a, b) => b.score - a.score);
}

export function findBestResourceSlot(
  resourceId: string,
  durationMinutes: number,
  existingBookings: PlanningBooking[],
  resources: WorkshopResource[],
  startDate: Date = new Date(),
): { start: Date; end: Date } | null {
  const resource = resources.find((r) => r.id === resourceId);
  if (!resource || !resource.active) return null;

  const horizon = getPlanningHorizon(startDate);
  let dayOffset = 0;

  while (dayOffset < 60) {
    const currentDay = new Date(horizon.start);
    currentDay.setDate(currentDay.getDate() + dayOffset);

    if (isWorkshopOpenDay(currentDay)) {
      const slots = splitDayIntoSlots(currentDay, 30);
      for (const slot of slots) {
        const workStart = slot.start;
        const workEnd = addWorkingMinutes(workStart, durationMinutes);

        const booking: PlanningBooking = {
          id: 'temp-best',
          resourceId,
          start: workStart,
          end: workEnd,
          caseId: 'temp',
        };

        const reasons = getBlockingCollisionReasons(booking, existingBookings, resources);
        if (reasons.length === 0) {
          return { start: workStart, end: workEnd };
        }
      }
    }
    dayOffset++;
  }

  return null;
}

export function reserveWorkshopSlot(
  option: AppointmentOption,
  caseId: string,
): PlanningBooking[] {
  return [
    {
      id: `booking-${caseId}-tech-${Date.now()}`,
      resourceId: option.technicianId,
      start: option.workStartDate,
      end: option.workEndDate,
      caseId,
      label: `Tâche technicien - Dossier ${caseId}`,
    },
    {
      id: `booking-${caseId}-equip-${Date.now()}`,
      resourceId: option.equipmentId,
      start: option.workStartDate,
      end: option.workEndDate,
      caseId,
      label: `Poste de travail - Dossier ${caseId}`,
    },
  ];
}

export function summarizeAppointmentOptions(options: AppointmentOption[]): string {
  if (options.length === 0) {
    return "Aucune suggestion de créneau disponible sur l'horizon de 60 jours.";
  }

  let summary = `Suggestions de créneaux automatiques (${options.length} propositions trouvées) :\n`;
  options.forEach((opt, index) => {
    const dateStr = opt.workStartDate.toLocaleDateString('fr-FR');
    const startStr = opt.workStartDate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    const endStr = opt.workEndDate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    const deliveryStr = opt.deliveryDate.toLocaleString('fr-FR', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });

    summary += `${index + 1}. Le ${dateStr} de ${startStr} à ${endStr} (Score: ${opt.score}/100) — Livraison prévue : ${deliveryStr}.\n`;
  });

  return summary;
}
