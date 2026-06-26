import { describe, expect, it } from 'vitest';
import {
  generateAppointmentOptions,
  scoreAppointmentSlot,
  estimateDeliveryDateFromPlan,
  summarizeAppointmentOptions,
} from '../src/domain/appointment-scheduler';
import { getDefaultWorkshopResources } from '../src/domain/resource-manager';

describe('Auto-scheduling Suggestions', () => {
  const resources = getDefaultWorkshopResources();

  it('generates up to 3 options within the 60 days horizon', () => {
    const options = generateAppointmentOptions('mecanique', 120, [], resources, new Date('2026-07-01T08:00:00'));
    expect(options.length).toBe(3);

    // Check fields presence
    const opt = options[0];
    expect(opt.depositDate).toBeInstanceOf(Date);
    expect(opt.workStartDate).toBeInstanceOf(Date);
    expect(opt.workEndDate).toBeInstanceOf(Date);
    expect(opt.deliveryDate).toBeInstanceOf(Date);
    expect(opt.technicianId).toBeTruthy();
    expect(opt.equipmentId).toBeTruthy();
    expect(opt.score).toBeGreaterThan(0);
  });

  it('correctly scores options based on date proximity', () => {
    const horizonStart = new Date('2026-07-01T08:00:00');
    const day1 = new Date('2026-07-02T09:00:00');
    const day10 = new Date('2026-07-11T09:00:00');

    const scoreDay1 = scoreAppointmentSlot(day1, 'tech-meca-1', 'lift-meca-1', horizonStart);
    const scoreDay10 = scoreAppointmentSlot(day10, 'tech-meca-1', 'lift-meca-1', horizonStart);

    expect(scoreDay1).toBeGreaterThan(scoreDay10);
  });

  it('avoids overlaps and respects active resources', () => {
    const start = new Date('2026-07-01T08:00:00');
    // Block tech-meca-1 for the whole day of July 1st
    const existing = [
      {
        id: 'existing-1',
        resourceId: 'tech-meca-1',
        start: new Date('2026-07-01T08:00:00'),
        end: new Date('2026-07-01T17:00:00'),
        caseId: 'case-blocked',
      },
    ];

    const options = generateAppointmentOptions('mecanique', 120, existing, resources, start);
    expect(options.length).toBe(3);

    // Verify first option is not scheduled on July 1st for tech-meca-1
    const firstOpt = options[0];
    if (firstOpt.technicianId === 'tech-meca-1') {
      const workDateStr = firstOpt.workStartDate.toISOString().split('T')[0];
      expect(workDateStr).not.toBe('2026-07-01');
    }
  });

  it('estimates delivery dates including buffers', () => {
    const end = new Date('2026-07-01T10:00:00');
    const delivery = estimateDeliveryDateFromPlan(end);
    expect(delivery.getTime()).toBeGreaterThan(end.getTime());
  });

  it('summarizes suggested options text cleanly', () => {
    const options = generateAppointmentOptions('mecanique', 120, [], resources, new Date('2026-07-01T08:00:00'));
    const summary = summarizeAppointmentOptions(options);
    expect(summary).toContain('Suggestions de créneaux');
    expect(summary).toContain('1.');
    expect(summary).toContain('Livraison prévue');
  });
});
