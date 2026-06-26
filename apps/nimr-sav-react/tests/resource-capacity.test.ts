import { describe, expect, it } from 'vitest';
import {
  getDefaultWorkshopResources,
  validateWorkshopResource,
  getActiveResources,
  getResourcesBySkill,
  isResourceOnLeave,
  getResourceAvailabilityForDate,
  summarizeWorkshopCapacity,
} from '../src/domain/resource-manager';

describe('Resource Capacity Management', () => {
  it('loads default workshop resources and calculates active resources correctly', () => {
    const list = getDefaultWorkshopResources();
    expect(list.length).toBeGreaterThan(0);

    const active = getActiveResources(list);
    expect(active.length).toBe(list.length); // All default are active

    const inactiveTest = [...list, {
      id: 'inactive-1',
      label: 'Inactive Tech',
      type: 'technicien' as const,
      skills: ['peinture'],
      active: false,
      workingHours: { start: '08:00', end: '17:00' },
      leaves: [],
      capacityMinutesPerDay: 480,
    }];
    expect(getActiveResources(inactiveTest).length).toBe(list.length);
  });

  it('filters resources by skill', () => {
    const list = getDefaultWorkshopResources();
    const paintingTechs = getResourcesBySkill(list, 'peinture');
    expect(paintingTechs.every(r => r.skills.includes('peinture'))).toBe(true);
  });

  it('verifies leave periods correctly', () => {
    const resourceWithLeaves = {
      id: 'tech-leave',
      label: 'Tech Leave',
      type: 'technicien' as const,
      skills: ['tole'],
      active: true,
      workingHours: { start: '08:00', end: '17:00' },
      leaves: [{ start: '2026-07-01', end: '2026-07-15' }],
      capacityMinutesPerDay: 480,
    };

    expect(isResourceOnLeave(resourceWithLeaves, '2026-06-30')).toBe(false);
    expect(isResourceOnLeave(resourceWithLeaves, '2026-07-05')).toBe(true);
    expect(isResourceOnLeave(resourceWithLeaves, '2026-07-16')).toBe(false);

    expect(getResourceAvailabilityForDate(resourceWithLeaves, '2026-07-05')).toBe(false);
    expect(getResourceAvailabilityForDate(resourceWithLeaves, '2026-06-30')).toBe(true);
  });

  it('validates resources data schema correctly', () => {
    const valid = validateWorkshopResource(getDefaultWorkshopResources()[0]);
    expect(valid.valid).toBe(true);

    const invalid = validateWorkshopResource({ id: '' });
    expect(invalid.valid).toBe(false);
    expect(invalid.errors.length).toBeGreaterThan(0);
  });

  it('summarizes workshop capacity correctly', () => {
    const list = getDefaultWorkshopResources();
    const summary = summarizeWorkshopCapacity(list);
    expect(summary.totalCount).toBe(list.length);
    expect(summary.activeCount).toBe(list.length);
    expect(summary.totalCapacityMinutes).toBeGreaterThan(0);
  });
});
