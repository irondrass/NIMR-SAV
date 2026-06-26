export type ResourceType =
  | 'technicien'
  | 'tole'
  | 'peinture'
  | 'preparation'
  | 'mecanique'
  | 'qualite'
  | 'livraison'
  | 'bay'
  | 'lift'
  | 'paint_booth';

export interface WorkingHours {
  start: string; // "HH:MM"
  end: string;   // "HH:MM"
}

export interface LeavePeriod {
  start: string; // "YYYY-MM-DD"
  end: string;   // "YYYY-MM-DD"
}

export interface WorkshopResource {
  id: string;
  label: string;
  type: ResourceType;
  skills: string[];
  active: boolean;
  workingHours: WorkingHours;
  leaves: LeavePeriod[];
  capacityMinutesPerDay: number;
}

export function getDefaultWorkshopResources(): WorkshopResource[] {
  return [
    {
      id: 'tech-tole-1',
      label: 'Technicien Tôlerie A',
      type: 'technicien',
      skills: ['tole', 'preparation'],
      active: true,
      workingHours: { start: '08:00', end: '17:00' },
      leaves: [],
      capacityMinutesPerDay: 480, // 8 hours
    },
    {
      id: 'tech-peint-1',
      label: 'Peintre A',
      type: 'technicien',
      skills: ['peinture', 'preparation'],
      active: true,
      workingHours: { start: '08:00', end: '17:00' },
      leaves: [],
      capacityMinutesPerDay: 480,
    },
    {
      id: 'tech-meca-1',
      label: 'Mécanicien A',
      type: 'technicien',
      skills: ['mecanique'],
      active: true,
      workingHours: { start: '08:00', end: '17:00' },
      leaves: [],
      capacityMinutesPerDay: 480,
    },
    {
      id: 'tech-qualite-1',
      label: 'Contrôleur Qualité A',
      type: 'technicien',
      skills: ['qualite'],
      active: true,
      workingHours: { start: '08:00', end: '17:00' },
      leaves: [],
      capacityMinutesPerDay: 480,
    },
    {
      id: 'bay-prep-1',
      label: 'Aire de Préparation 1',
      type: 'bay',
      skills: ['preparation'],
      active: true,
      workingHours: { start: '08:00', end: '17:00' },
      leaves: [],
      capacityMinutesPerDay: 540, // 9 hours
    },
    {
      id: 'booth-paint-1',
      label: 'Cabine Peinture 1',
      type: 'paint_booth',
      skills: ['peinture'],
      active: true,
      workingHours: { start: '08:00', end: '17:00' },
      leaves: [],
      capacityMinutesPerDay: 540,
    },
    {
      id: 'lift-meca-1',
      label: 'Pont élévateur 1',
      type: 'lift',
      skills: ['mecanique'],
      active: true,
      workingHours: { start: '08:00', end: '17:00' },
      leaves: [],
      capacityMinutesPerDay: 540,
    },
  ];
}

export function validateWorkshopResource(resource: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!resource || typeof resource !== 'object') {
    return { valid: false, errors: ['Resource must be an object'] };
  }

  const res = resource as Partial<WorkshopResource>;

  if (typeof res.id !== 'string' || !res.id.trim()) {
    errors.push('id is required and must be a non-empty string');
  }
  if (typeof res.label !== 'string' || !res.label.trim()) {
    errors.push('label is required and must be a non-empty string');
  }
  const validTypes: ResourceType[] = [
    'technicien',
    'tole',
    'peinture',
    'preparation',
    'mecanique',
    'qualite',
    'livraison',
    'bay',
    'lift',
    'paint_booth',
  ];
  if (!res.type || !validTypes.includes(res.type)) {
    errors.push(`type must be one of: ${validTypes.join(', ')}`);
  }
  if (!Array.isArray(res.skills)) {
    errors.push('skills must be an array of strings');
  }
  if (typeof res.active !== 'boolean') {
    errors.push('active must be a boolean');
  }
  if (
    !res.workingHours ||
    typeof res.workingHours.start !== 'string' ||
    typeof res.workingHours.end !== 'string'
  ) {
    errors.push('workingHours must have start and end times as strings');
  }
  if (!Array.isArray(res.leaves)) {
    errors.push('leaves must be an array');
  } else {
    for (const leave of res.leaves) {
      if (typeof leave.start !== 'string' || typeof leave.end !== 'string') {
        errors.push('Each leave must have start and end dates as strings');
      }
    }
  }
  if (typeof res.capacityMinutesPerDay !== 'number' || res.capacityMinutesPerDay < 0) {
    errors.push('capacityMinutesPerDay must be a positive number');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function getActiveResources(resources: WorkshopResource[]): WorkshopResource[] {
  return resources.filter((r) => r.active);
}

export function getResourcesBySkill(resources: WorkshopResource[], skill: string): WorkshopResource[] {
  return resources.filter((r) => r.skills.includes(skill));
}

export function isResourceOnLeave(resource: WorkshopResource, dateStr: string): boolean {
  // Normalize dateStr to YYYY-MM-DD
  const targetDate = new Date(dateStr.substring(0, 10));
  if (isNaN(targetDate.getTime())) return false;

  for (const leave of resource.leaves) {
    const start = new Date(leave.start);
    const end = new Date(leave.end);
    if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
      if (targetDate >= start && targetDate <= end) {
        return true;
      }
    }
  }
  return false;
}

export function getResourceAvailabilityForDate(resource: WorkshopResource, dateStr: string): boolean {
  if (!resource.active) return false;
  return !isResourceOnLeave(resource, dateStr);
}

export function getResourceCapacitySummary(resource: WorkshopResource): {
  id: string;
  label: string;
  capacityMinutesPerDay: number;
} {
  return {
    id: resource.id,
    label: resource.label,
    capacityMinutesPerDay: resource.capacityMinutesPerDay,
  };
}

export function summarizeWorkshopCapacity(resources: WorkshopResource[]): {
  totalCapacityMinutes: number;
  activeCount: number;
  totalCount: number;
} {
  const active = getActiveResources(resources);
  const totalCapacity = active.reduce((sum, r) => sum + r.capacityMinutesPerDay, 0);
  return {
    totalCapacityMinutes: totalCapacity,
    activeCount: active.length,
    totalCount: resources.length,
  };
}
