import { describe, expect, it } from 'vitest';
import {
  detectBookingCollision,
  detectResourceCollisions,
  detectBayCollisions,
  validateBookingNoCollision,
  getBlockingCollisionReasons,
} from '../src/domain/collision-engine';
import { getDefaultWorkshopResources } from '../src/domain/resource-manager';

describe('Planning Collision Engine', () => {
  const resources = getDefaultWorkshopResources();

  it('detects simple time overlaps for the same resource', () => {
    const b1 = {
      id: 'b1',
      resourceId: 'tech-tole-1',
      start: new Date('2026-07-01T09:00:00'),
      end: new Date('2026-07-01T11:00:00'),
      caseId: 'case-1',
    };
    const b2 = {
      id: 'b2',
      resourceId: 'tech-tole-1',
      start: new Date('2026-07-01T10:00:00'),
      end: new Date('2026-07-01T12:00:00'),
      caseId: 'case-2',
    };
    const b3 = {
      id: 'b3',
      resourceId: 'tech-tole-1',
      start: new Date('2026-07-01T11:00:00'),
      end: new Date('2026-07-01T13:00:00'),
      caseId: 'case-3',
    };

    expect(detectBookingCollision(b1, b2)).toBe(true);
    expect(detectBookingCollision(b1, b3)).toBe(false); // contiguous is okay
  });

  it('detects technician resource collisions', () => {
    const list = [
      {
        id: 'existing-1',
        resourceId: 'tech-tole-1',
        start: new Date('2026-07-01T09:00:00'),
        end: new Date('2026-07-01T11:00:00'),
        caseId: 'case-ex',
      },
    ];
    const newBooking = {
      id: 'new-1',
      resourceId: 'tech-tole-1',
      start: new Date('2026-07-01T10:00:00'),
      end: new Date('2026-07-01T12:00:00'),
      caseId: 'case-new',
    };

    const conflicts = detectResourceCollisions(newBooking, list, resources);
    expect(conflicts.length).toBe(1);
    expect(conflicts[0].caseId).toBe('case-ex');
  });

  it('detects bay and equipment collisions', () => {
    const list = [
      {
        id: 'existing-bay',
        resourceId: 'bay-prep-1',
        start: new Date('2026-07-01T09:00:00'),
        end: new Date('2026-07-01T11:00:00'),
        caseId: 'case-ex',
      },
    ];
    const newBooking = {
      id: 'new-bay',
      resourceId: 'bay-prep-1',
      start: new Date('2026-07-01T10:00:00'),
      end: new Date('2026-07-01T12:00:00'),
      caseId: 'case-new',
    };

    const bayConflicts = detectBayCollisions(newBooking, list, resources);
    expect(bayConflicts.length).toBe(1);
  });

  it('rejects bookings outside working hours', () => {
    const nightBooking = {
      id: 'night-1',
      resourceId: 'tech-tole-1',
      start: new Date('2026-07-01T01:00:00'),
      end: new Date('2026-07-01T03:00:00'),
      caseId: 'case-night',
    };

    const reasons = getBlockingCollisionReasons(nightBooking, [], resources);
    expect(reasons.length).toBeGreaterThan(0);
    expect(reasons[0]).toContain("horaires d'ouverture");
  });

  it('rejects bookings on leave periods', () => {
    const resourcesWithLeave = [
      {
        id: 'tech-on-leave',
        label: 'Tech On Leave',
        type: 'technicien' as const,
        skills: ['mecanique'],
        active: true,
        workingHours: { start: '08:00', end: '17:00' },
        leaves: [{ start: '2026-07-01', end: '2026-07-10' }],
        capacityMinutesPerDay: 480,
      },
    ];

    const booking = {
      id: 'b-leave',
      resourceId: 'tech-on-leave',
      start: new Date('2026-07-05T09:00:00'),
      end: new Date('2026-07-05T11:00:00'),
      caseId: 'case-leave',
    };

    const reasons = getBlockingCollisionReasons(booking, [], resourcesWithLeave);
    expect(reasons.length).toBeGreaterThan(0);
    expect(reasons[0]).toContain('congé ou absente');
  });

  it('blocks booking for delivered/closed cases', () => {
    const booking = {
      id: 'b-delivered',
      resourceId: 'tech-tole-1',
      start: new Date('2026-07-01T09:00:00'),
      end: new Date('2026-07-01T11:00:00'),
      caseId: 'case-delivered',
    };

    const validDelivered = validateBookingNoCollision(booking, [], resources, 'delivered');
    expect(validDelivered.success).toBe(false);
    expect(validDelivered.errors[0]).toContain('le dossier est déjà livré ou clos');
  });
});
