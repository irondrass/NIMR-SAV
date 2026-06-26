import { WorkshopResource, isResourceOnLeave } from './resource-manager';
import { isSlotInsideWorkingHours } from './workshop-calendar';

export interface PlanningBooking {
  id: string;
  resourceId: string;
  start: Date;
  end: Date;
  caseId: string;
  label?: string;
}

export function detectBookingCollision(b1: PlanningBooking, b2: PlanningBooking): boolean {
  if (b1.resourceId !== b2.resourceId) return false;
  if (b1.id === b2.id) return false; // same booking

  const s1 = new Date(b1.start).getTime();
  const e1 = new Date(b1.end).getTime();
  const s2 = new Date(b2.start).getTime();
  const e2 = new Date(b2.end).getTime();

  return s1 < e2 && e1 > s2;
}

export function detectResourceCollisions(
  newBooking: PlanningBooking,
  existingBookings: PlanningBooking[],
  resources: WorkshopResource[],
): PlanningBooking[] {
  const resource = resources.find((r) => r.id === newBooking.resourceId);
  if (!resource || resource.type !== 'technicien') return [];

  return existingBookings.filter(
    (b) => b.resourceId === newBooking.resourceId && detectBookingCollision(newBooking, b),
  );
}

export function detectBayCollisions(
  newBooking: PlanningBooking,
  existingBookings: PlanningBooking[],
  resources: WorkshopResource[],
): PlanningBooking[] {
  const resource = resources.find((r) => r.id === newBooking.resourceId);
  if (!resource || resource.type !== 'bay') return [];

  return existingBookings.filter(
    (b) => b.resourceId === newBooking.resourceId && detectBookingCollision(newBooking, b),
  );
}

export function detectEquipmentCollisions(
  newBooking: PlanningBooking,
  existingBookings: PlanningBooking[],
  resources: WorkshopResource[],
): PlanningBooking[] {
  const resource = resources.find((r) => r.id === newBooking.resourceId);
  if (!resource || (resource.type !== 'lift' && resource.type !== 'paint_booth')) return [];

  return existingBookings.filter(
    (b) => b.resourceId === newBooking.resourceId && detectBookingCollision(newBooking, b),
  );
}

export function validateBookingNoCollision(
  newBooking: PlanningBooking,
  existingBookings: PlanningBooking[],
  resources: WorkshopResource[],
  caseStatus?: string,
): { success: boolean; errors: string[] } {
  const errors = getBlockingCollisionReasons(newBooking, existingBookings, resources, caseStatus);
  return {
    success: errors.length === 0,
    errors,
  };
}

export function getBlockingCollisionReasons(
  newBooking: PlanningBooking,
  existingBookings: PlanningBooking[],
  resources: WorkshopResource[],
  caseStatus?: string,
): string[] {
  const reasons: string[] = [];

  // 1. Duration check
  const start = new Date(newBooking.start).getTime();
  const end = new Date(newBooking.end).getTime();
  if (isNaN(start) || isNaN(end) || start >= end) {
    reasons.push('La durée du créneau est invalide (date de début après date de fin).');
    return reasons;
  }

  // 2. Case status check
  if (caseStatus === 'delivered' || caseStatus === 'closed') {
    reasons.push('Planification interdite : le dossier est déjà livré ou clos.');
  }

  // 3. Resource existence & active status
  const resource = resources.find((r) => r.id === newBooking.resourceId);
  if (!resource) {
    reasons.push(`Ressource '${newBooking.resourceId}' introuvable.`);
    return reasons;
  }
  if (!resource.active) {
    reasons.push(`La ressource '${resource.label}' est inactive.`);
  }

  // 4. Resource leave check
  // Check both start and end days
  const startDayStr = new Date(newBooking.start).toISOString().split('T')[0];
  const endDayStr = new Date(newBooking.end).toISOString().split('T')[0];
  if (isResourceOnLeave(resource, startDayStr) || isResourceOnLeave(resource, endDayStr)) {
    reasons.push(`La ressource '${resource.label}' est en congé ou absente sur cette période.`);
  }

  // 5. Working hours check
  if (!isSlotInsideWorkingHours(new Date(newBooking.start), new Date(newBooking.end))) {
    reasons.push("Le créneau est en dehors des horaires d'ouverture de l'atelier.");
  }

  // 6. Overlap with existing bookings
  const overlaps = existingBookings.filter(
    (b) => b.resourceId === newBooking.resourceId && detectBookingCollision(newBooking, b),
  );
  if (overlaps.length > 0) {
    for (const collision of overlaps) {
      reasons.push(
        `Collision détectée pour '${resource.label}' avec le dossier ${collision.caseId} sur la période demandée.`,
      );
    }
  }

  return reasons;
}

export interface PlanningConflict {
  bookingId: string;
  caseId: string;
  resourceId: string;
  reason: string;
}

export function summarizePlanningConflicts(
  existingBookings: PlanningBooking[],
  resources: WorkshopResource[],
): PlanningConflict[] {
  const conflicts: PlanningConflict[] = [];

  for (let i = 0; i < existingBookings.length; i++) {
    const b = existingBookings[i];
    const resource = resources.find((r) => r.id === b.resourceId);

    if (!resource) {
      conflicts.push({
        bookingId: b.id,
        caseId: b.caseId,
        resourceId: b.resourceId,
        reason: 'Ressource introuvable',
      });
      continue;
    }

    if (!resource.active) {
      conflicts.push({
        bookingId: b.id,
        caseId: b.caseId,
        resourceId: b.resourceId,
        reason: `Ressource '${resource.label}' inactive`,
      });
    }

    const dayStr = new Date(b.start).toISOString().split('T')[0];
    if (isResourceOnLeave(resource, dayStr)) {
      conflicts.push({
        bookingId: b.id,
        caseId: b.caseId,
        resourceId: b.resourceId,
        reason: `Ressource '${resource.label}' absente le ${dayStr}`,
      });
    }

    // Check overlap with subsequent bookings
    for (let j = i + 1; j < existingBookings.length; j++) {
      const other = existingBookings[j];
      if (detectBookingCollision(b, other)) {
        conflicts.push({
          bookingId: b.id,
          caseId: b.caseId,
          resourceId: b.resourceId,
          reason: `Collision de planification avec le dossier ${other.caseId}`,
        });
      }
    }
  }

  return conflicts;
}
