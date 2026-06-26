import { describe, expect, it } from 'vitest';
import {
  buildGanttRows,
  calculateGanttItemPosition,
  summarizeGanttLoad,
} from '../src/domain/gantt-planning';
import { getDefaultWorkshopResources } from '../src/domain/resource-manager';

describe('Gantt Planning Layout', () => {
  const resources = getDefaultWorkshopResources();

  it('builds Gantt rows and maps active bookings correctly', () => {
    const viewDate = new Date('2026-07-01');
    const bookings = [
      {
        id: 'booking-1',
        resourceId: 'tech-tole-1',
        start: new Date('2026-07-01T09:00:00'),
        end: new Date('2026-07-01T11:00:00'),
        caseId: 'case-1',
      },
    ];

    const rows = buildGanttRows(resources, bookings, viewDate);
    expect(rows.length).toBe(resources.length);

    const toleRow = rows.find((r) => r.resourceId === 'tech-tole-1');
    expect(toleRow).toBeDefined();
    expect(toleRow?.items.length).toBe(1);
    expect(toleRow?.items[0].caseId).toBe('case-1');
    expect(toleRow?.loadPercentage).toBeGreaterThan(0);
  });

  it('calculates CSS percentage positions accurately', () => {
    const start = new Date('2026-07-01T10:00:00');
    const end = new Date('2026-07-01T11:00:00');
    // Day starts at 08:00 and ends at 17:00 (9 hours = 540 mins)
    // 10:00 is 120 mins after 08:00 (120/540 = 22.22%)
    // 1 hour duration is 60 mins (60/540 = 11.11%)
    const pos = calculateGanttItemPosition(start, end, 8, 17);

    expect(pos.left).toBe('22.22%');
    expect(pos.width).toBe('11.11%');
  });

  it('summarizes load factors and flags overloaded resources', () => {
    const rows = [
      {
        resourceId: 'tech-1',
        resourceLabel: 'Tech 1',
        resourceType: 'technicien',
        items: [],
        loadPercentage: 120, // Overloaded (> 100)
        onLeave: false,
      },
      {
        resourceId: 'tech-2',
        resourceLabel: 'Tech 2',
        resourceType: 'technicien',
        items: [],
        loadPercentage: 80,
        onLeave: false,
      },
    ];

    const summary = summarizeGanttLoad(rows);
    expect(summary.averageLoad).toBe(100);
    expect(summary.overloadedResources).toEqual(['Tech 1']);
  });
});
