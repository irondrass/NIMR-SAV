export interface WorkingTimeRange {
  start: string; // "HH:MM"
  end: string;   // "HH:MM"
}

export interface DaySchedule {
  isOpen: boolean;
  workingHours: WorkingTimeRange[];
}

// Defaults: Monday to Friday open, Saturday morning open (8-12), Sunday closed.
// Default lunch break: 12:00 to 13:00.
export const DEFAULT_WEEK_SCHEDULE: Record<number, DaySchedule> = {
  0: { isOpen: false, workingHours: [] }, // Sunday
  1: {
    isOpen: true,
    workingHours: [
      { start: '08:00', end: '12:00' },
      { start: '13:00', end: '17:00' },
    ],
  }, // Monday
  2: {
    isOpen: true,
    workingHours: [
      { start: '08:00', end: '12:00' },
      { start: '13:00', end: '17:00' },
    ],
  }, // Tuesday
  3: {
    isOpen: true,
    workingHours: [
      { start: '08:00', end: '12:00' },
      { start: '13:00', end: '17:00' },
    ],
  }, // Wednesday
  4: {
    isOpen: true,
    workingHours: [
      { start: '08:00', end: '12:00' },
      { start: '13:00', end: '17:00' },
    ],
  }, // Thursday
  5: {
    isOpen: true,
    workingHours: [
      { start: '08:00', end: '12:00' },
      { start: '13:00', end: '17:00' },
    ],
  }, // Friday
  6: {
    isOpen: true,
    workingHours: [{ start: '08:00', end: '12:00' }],
  }, // Saturday
};

export function getWorkshopWorkingDay(date: Date, customSchedule?: Record<number, DaySchedule>): DaySchedule {
  const day = date.getDay();
  const schedule = customSchedule || DEFAULT_WEEK_SCHEDULE;
  return schedule[day] || { isOpen: false, workingHours: [] };
}

export function isWorkshopOpenDay(date: Date, customSchedule?: Record<number, DaySchedule>): boolean {
  return getWorkshopWorkingDay(date, customSchedule).isOpen;
}

export function getWorkingMinutesForDay(date: Date, customSchedule?: Record<number, DaySchedule>): number {
  const daySched = getWorkshopWorkingDay(date, customSchedule);
  if (!daySched.isOpen) return 0;

  let totalMinutes = 0;
  for (const range of daySched.workingHours) {
    const [startH, startM] = range.start.split(':').map(Number);
    const [endH, endM] = range.end.split(':').map(Number);
    totalMinutes += (endH * 60 + endM) - (startH * 60 + startM);
  }
  return totalMinutes;
}

export function normalizePlanningDate(date: Date): Date {
  const d = new Date(date);
  d.setSeconds(0);
  d.setMilliseconds(0);
  return d;
}

export function isSlotInsideWorkingHours(
  slotStart: Date,
  slotEnd: Date,
  customSchedule?: Record<number, DaySchedule>,
): boolean {
  if (slotStart.toDateString() !== slotEnd.toDateString()) {
    // Slot spans multiple days - invalid for simple slots
    return false;
  }

  const daySched = getWorkshopWorkingDay(slotStart, customSchedule);
  if (!daySched.isOpen) return false;

  const startMinutes = slotStart.getHours() * 60 + slotStart.getMinutes();
  const endMinutes = slotEnd.getHours() * 60 + slotEnd.getMinutes();

  // Find if slot is fully contained in at least one of the working hour ranges
  for (const range of daySched.workingHours) {
    const [rangeStartH, rangeStartM] = range.start.split(':').map(Number);
    const [rangeEndH, rangeEndM] = range.end.split(':').map(Number);
    const rangeStartMin = rangeStartH * 60 + rangeStartM;
    const rangeEndMin = rangeEndH * 60 + rangeEndM;

    if (startMinutes >= rangeStartMin && endMinutes <= rangeEndMin) {
      return true;
    }
  }

  return false;
}

export interface TimeSlot {
  start: Date;
  end: Date;
}

export function splitDayIntoSlots(
  date: Date,
  slotDurationMinutes: number = 30,
  customSchedule?: Record<number, DaySchedule>,
): TimeSlot[] {
  const daySched = getWorkshopWorkingDay(date, customSchedule);
  if (!daySched.isOpen) return [];

  const slots: TimeSlot[] = [];

  for (const range of daySched.workingHours) {
    const [startH, startM] = range.start.split(':').map(Number);
    const [endH, endM] = range.end.split(':').map(Number);

    let currentMin = startH * 60 + startM;
    const endMin = endH * 60 + endM;

    while (currentMin + slotDurationMinutes <= endMin) {
      const slotStart = new Date(date);
      slotStart.setHours(Math.floor(currentMin / 60), currentMin % 60, 0, 0);

      const slotEnd = new Date(date);
      const nextMin = currentMin + slotDurationMinutes;
      slotEnd.setHours(Math.floor(nextMin / 60), nextMin % 60, 0, 0);

      slots.push({ start: slotStart, end: slotEnd });
      currentMin += slotDurationMinutes;
    }
  }

  return slots;
}

export function addWorkingMinutes(
  startDate: Date,
  minutesToAdd: number,
  customSchedule?: Record<number, DaySchedule>,
): Date {
  const current = new Date(startDate);
  let remaining = minutesToAdd;

  const schedule = customSchedule || DEFAULT_WEEK_SCHEDULE;

  while (remaining > 0) {
    const daySched = getWorkshopWorkingDay(current, schedule);
    if (!daySched.isOpen) {
      // Go to start of next day
      current.setDate(current.getDate() + 1);
      current.setHours(8, 0, 0, 0);
      continue;
    }

    const currentMinutes = current.getHours() * 60 + current.getMinutes();
    let advanced = false;

    for (const range of daySched.workingHours) {
      const [startH, startM] = range.start.split(':').map(Number);
      const [endH, endM] = range.end.split(':').map(Number);
      const startMin = startH * 60 + startM;
      const endMin = endH * 60 + endM;

      if (currentMinutes < startMin) {
        // We are before this block, move to start of this block
        current.setHours(startH, startM, 0, 0);
        advanced = true;
        break;
      }

      if (currentMinutes >= startMin && currentMinutes < endMin) {
        // We are inside this block
        const remainingInBlock = endMin - currentMinutes;
        const addNow = Math.min(remaining, remainingInBlock);
        current.setMinutes(current.getMinutes() + addNow);
        remaining -= addNow;
        advanced = true;
        break;
      }
    }

    if (!advanced) {
      // We are past all working hours for today, move to next day
      current.setDate(current.getDate() + 1);
      current.setHours(8, 0, 0, 0);
    }
  }

  return normalizePlanningDate(current);
}

export function getPlanningHorizon(startDate: Date = new Date()): { start: Date; end: Date } {
  const start = normalizePlanningDate(startDate);
  const end = new Date(start);
  end.setDate(end.getDate() + 60); // 60 days horizon
  return { start, end };
}
