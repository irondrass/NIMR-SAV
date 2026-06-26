import { WorkshopResource } from './resource-manager';
import { PlanningBooking } from './collision-engine';

export interface GanttItem {
  id: string;
  bookingId: string;
  caseId: string;
  label: string;
  start: Date;
  end: Date;
  color?: string;
  collision?: boolean;
}

export interface GanttRow {
  resourceId: string;
  resourceLabel: string;
  resourceType: string;
  items: GanttItem[];
  loadPercentage: number;
  onLeave: boolean;
}

export function buildGanttRows(
  resources: WorkshopResource[],
  bookings: PlanningBooking[],
  viewDate: Date,
): GanttRow[] {
  const dateStr = viewDate.toISOString().split('T')[0];

  return resources.map((res) => {
    // Filter bookings for this resource on this day
    const resBookings = bookings.filter((b) => {
      if (b.resourceId !== res.id) return false;
      const bDateStr = new Date(b.start).toISOString().split('T')[0];
      return bDateStr === dateStr;
    });

    const items: GanttItem[] = resBookings.map((b) => {
      // Basic check for collisions among resource bookings
      const hasCollision = resBookings.some(
        (other) => other.id !== b.id &&
          new Date(b.start).getTime() < new Date(other.end).getTime() &&
          new Date(b.end).getTime() > new Date(other.start).getTime(),
      );

      return {
        id: `gantt-item-${b.id}`,
        bookingId: b.id,
        caseId: b.caseId,
        label: b.label || `Dossier ${b.caseId}`,
        start: new Date(b.start),
        end: new Date(b.end),
        collision: hasCollision,
      };
    });

    // Calculate load percentage
    const totalBookedMinutes = resBookings.reduce((sum, b) => {
      const diffMs = new Date(b.end).getTime() - new Date(b.start).getTime();
      return sum + Math.round(diffMs / (1000 * 60));
    }, 0);

    const loadPercentage = res.capacityMinutesPerDay > 0
      ? Math.round((totalBookedMinutes / res.capacityMinutesPerDay) * 100)
      : 0;

    // Check if on leave
    const onLeave = res.leaves.some((leave) => {
      const target = new Date(dateStr);
      return target >= new Date(leave.start) && target <= new Date(leave.end);
    });

    return {
      resourceId: res.id,
      resourceLabel: res.label,
      resourceType: res.type,
      items,
      loadPercentage,
      onLeave,
    };
  });
}

export function calculateGanttItemPosition(
  start: Date,
  end: Date,
  workStartHour: number = 8,
  workEndHour: number = 17,
): { left: string; width: string } {
  const totalDayMinutes = (workEndHour - workStartHour) * 60;

  const itemStartMin = start.getHours() * 60 + start.getMinutes() - workStartHour * 60;
  const itemDurationMin = (end.getTime() - start.getTime()) / (1000 * 60);

  const leftVal = (itemStartMin / totalDayMinutes) * 100;
  const widthVal = (itemDurationMin / totalDayMinutes) * 100;

  // Clamp values
  const left = Math.max(0, Math.min(100, leftVal));
  const width = Math.max(2, Math.min(100 - left, widthVal)); // Min 2% width so it's visible

  return {
    left: `${left.toFixed(2)}%`,
    width: `${width.toFixed(2)}%`,
  };
}

export function summarizeGanttLoad(rows: GanttRow[]): {
  averageLoad: number;
  overloadedResources: string[];
} {
  if (rows.length === 0) return { averageLoad: 0, overloadedResources: [] };

  const totalLoad = rows.reduce((sum, r) => sum + r.loadPercentage, 0);
  const overloaded = rows
    .filter((r) => r.loadPercentage > 100)
    .map((r) => r.resourceLabel);

  return {
    averageLoad: Math.round(totalLoad / rows.length),
    overloadedResources: overloaded,
  };
}
