import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

function createElementStub() {
  return {
    value: "",
    textContent: "",
    innerHTML: "",
    hidden: false,
    children: [],
    dataset: {},
    style: {},
    classList: { add() {}, remove() {}, toggle() {} },
    setAttribute() {},
    removeAttribute() {},
    toggleAttribute() {},
    addEventListener() {},
    focus() {},
    closest: () => null,
    contains: () => false,
    append() {},
    appendChild() {},
    replaceChildren() {},
    querySelector: () => createElementStub(),
    querySelectorAll: () => [],
    reset() {},
  };
}

function createVmContext() {
  const scriptFiles = [
    "../js/state.js",
    "../js/utils.js",
    "../js/storage.js",
    "../js/planning.js",
    "../js/ui-planning.js",
  ];

  const appSource = scriptFiles
    .map((file) => fs.readFileSync(new URL(file, import.meta.url), "utf8"))
    .join("\n")
    .replace(/initApp\(\);/, "// initApp skipped")
    .replace(/if \("serviceWorker" in navigator[\s\S]*$/u, "");

  const context = {
    console,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: {
      getElementById: () => createElementStub(),
      querySelector: () => createElementStub(),
      querySelectorAll: () => [],
      addEventListener() {},
      createElement: () => createElementStub(),
    },
    window: {},
    FormData: class FormData {
      constructor(form) {
        this._map = form?.__formData ? new Map(Object.entries(form.__formData)) : new Map();
      }
      get(name) { return this._map.get(name) ?? null; }
    },
    notifyUser: () => {},
    render: () => {},
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  };
  context.window = context;

  vm.createContext(context);
  vm.runInContext(appSource, context);
  context.run = (code) => vm.runInContext(code, context);
  Object.defineProperty(context, "state", {
    get() { return vm.runInContext("state", context); },
    set(v) {
      context.__temp_state__ = v;
      vm.runInContext("state = __temp_state__;", context);
      delete context.__temp_state__;
    },
    configurable: true,
  });
  return context;
}

const c = createVmContext();
const toPlain = (v) => JSON.parse(JSON.stringify(v));

console.log("Running R3 Authoritative Workshop & Resource Schedules Test Suite...");

// --- R3-S1: Global Mon-Thu Union ---
{
  for (let day = 1; day <= 4; day++) {
    const hours = c.DEFAULT_WORK_HOURS[day];
    assert.deepEqual(toPlain(hours), [["07:45", "17:00"]], `Day ${day} must be [["07:45", "17:00"]]`);
  }
  console.log("✔ R3-S1: Global Mon-Thu union schedule is 07:45-17:00");
}

// --- R3-S2: Global Friday Split ---
{
  const fridayHours = c.DEFAULT_WORK_HOURS[5];
  assert.deepEqual(toPlain(fridayHours), [["07:45", "12:30"], ["13:45", "17:00"]], "Friday must be split [07:45-12:30] and [13:45-17:00]");
  console.log("✔ R3-S2: Global Friday split schedule is 07:45-12:30 and 13:45-17:00");
}

// --- R3-S3: Global Saturday ---
{
  const saturdayHours = c.DEFAULT_WORK_HOURS[6];
  assert.deepEqual(toPlain(saturdayHours), [["08:00", "12:00"]], "Saturday must be [['08:00', '12:00']]");
  console.log("✔ R3-S3: Global Saturday schedule is 08:00-12:00");
}

// --- R3-S4: Global Sunday Closed ---
{
  const sundayHours = c.DEFAULT_WORK_HOURS[0];
  assert.deepEqual(toPlain(sundayHours), [], "Sunday must be empty / closed");
  console.log("✔ R3-S4: Global Sunday is CLOSED");
}

// --- R3-S5: Team 1 Exactly 40 h (2400 minutes) ---
{
  const team1Hours = c.RESOURCE_SCHEDULE_PROFILES.team_1.workHours;
  const minutes = c.calculateWeeklyWorkMinutes(team1Hours);
  assert.equal(minutes, 2400, `Team 1 must be exactly 2400 minutes (40 h), got ${minutes}`);
  console.log(`✔ R3-S5: Team 1 has exactly 40 h (${minutes} minutes)`);
}

// --- R3-S6: Team 2 Exactly 40 h (2400 minutes) ---
{
  const team2Hours = c.RESOURCE_SCHEDULE_PROFILES.team_2.workHours;
  const minutes = c.calculateWeeklyWorkMinutes(team2Hours);
  assert.equal(minutes, 2400, `Team 2 must be exactly 2400 minutes (40 h), got ${minutes}`);
  console.log(`✔ R3-S6: Team 2 has exactly 40 h (${minutes} minutes)`);
}

// Setup resources for Team 1 and Team 2 testing
const team1Tech = {
  id: "tech-team-1",
  name: "Technicien Équipe 1",
  role: "tolier",
  active: true,
  calendar: {
    scheduleProfile: "team_1",
    workHours: c.cloneWorkHours(c.RESOURCE_SCHEDULE_PROFILES.team_1.workHours),
  },
};

const team2Tech = {
  id: "tech-team-2",
  name: "Technicien Équipe 2",
  role: "tolier",
  active: true,
  calendar: {
    scheduleProfile: "team_2",
    workHours: c.cloneWorkHours(c.RESOURCE_SCHEDULE_PROFILES.team_2.workHours),
  },
};

// --- R3-S7: Monday Team 1 Boundaries ---
{
  // Monday: 2026-05-18
  const mondayStr = "2026-05-18";

  // 07:45 - 08:30: Team 1 available
  const slotEarly = { start: `${mondayStr}T07:45:00`, end: `${mondayStr}T08:30:00` };
  assert.equal(c.isResourceAvailableForSlot(team1Tech, slotEarly).ok, true, "Team 1 must be available at 07:45 on Monday");

  // 09:44 - 09:45: Team 1 available
  const slotPre945 = { start: `${mondayStr}T09:44:00`, end: `${mondayStr}T09:45:00` };
  assert.equal(c.isResourceAvailableForSlot(team1Tech, slotPre945).ok, true, "Team 1 must be available before 09:45 on Monday");

  // 09:45 - 10:00: Team 1 available
  const slotAt945 = { start: `${mondayStr}T09:45:00`, end: `${mondayStr}T10:00:00` };
  assert.equal(c.isResourceAvailableForSlot(team1Tech, slotAt945).ok, true, "Team 1 must be available at 09:45 on Monday");

  // 14:59 - 15:00: Team 1 available
  const slotPre1500 = { start: `${mondayStr}T14:59:00`, end: `${mondayStr}T15:00:00` };
  assert.equal(c.isResourceAvailableForSlot(team1Tech, slotPre1500).ok, true, "Team 1 must be available at 14:59 on Monday");

  // 15:00 - 15:30: Team 1 ended (unavailable)
  const slotPost1500 = { start: `${mondayStr}T15:00:00`, end: `${mondayStr}T15:30:00` };
  assert.equal(c.isResourceAvailableForSlot(team1Tech, slotPost1500).ok, false, "Team 1 must be UNAVAILABLE at 15:00 on Monday");

  // 16:30 - 17:00: Team 1 unavailable
  const slotLate = { start: `${mondayStr}T16:30:00`, end: `${mondayStr}T17:00:00` };
  assert.equal(c.isResourceAvailableForSlot(team1Tech, slotLate).ok, false, "Team 1 must be UNAVAILABLE at 16:30 on Monday");

  // After 17:00: Team 1 unavailable
  const slotAfterClose = { start: `${mondayStr}T17:00:00`, end: `${mondayStr}T17:30:00` };
  assert.equal(c.isResourceAvailableForSlot(team1Tech, slotAfterClose).ok, false, "Team 1 must be UNAVAILABLE after 17:00 on Monday");

  console.log("✔ R3-S7: Monday Team 1 boundaries verified (07:45 available, 15:00 ended)");
}

// --- R3-S8: Monday Team 2 Boundaries ---
{
  const mondayStr = "2026-05-18";

  // 07:45 - 08:30: Team 2 unavailable (starts at 09:45)
  const slotEarly = { start: `${mondayStr}T07:45:00`, end: `${mondayStr}T08:30:00` };
  assert.equal(c.isResourceAvailableForSlot(team2Tech, slotEarly).ok, false, "Team 2 must be UNAVAILABLE at 07:45 on Monday");

  // 09:44 - 09:45: Team 2 unavailable
  const slotPre945 = { start: `${mondayStr}T09:44:00`, end: `${mondayStr}T09:45:00` };
  assert.equal(c.isResourceAvailableForSlot(team2Tech, slotPre945).ok, false, "Team 2 must be UNAVAILABLE at 09:44 on Monday");

  // 09:45 - 10:00: Team 2 available
  const slotAt945 = { start: `${mondayStr}T09:45:00`, end: `${mondayStr}T10:00:00` };
  assert.equal(c.isResourceAvailableForSlot(team2Tech, slotAt945).ok, true, "Team 2 must be available at 09:45 on Monday");

  // 14:59 - 15:00: Team 2 available
  const slotPre1500 = { start: `${mondayStr}T14:59:00`, end: `${mondayStr}T15:00:00` };
  assert.equal(c.isResourceAvailableForSlot(team2Tech, slotPre1500).ok, true, "Team 2 must be available at 14:59 on Monday");

  // 15:00 - 15:30: Team 2 remains available
  const slotPost1500 = { start: `${mondayStr}T15:00:00`, end: `${mondayStr}T15:30:00` };
  assert.equal(c.isResourceAvailableForSlot(team2Tech, slotPost1500).ok, true, "Team 2 must remain available after 15:00 on Monday");

  // 16:30 - 17:00: Team 2 available
  const slotLate = { start: `${mondayStr}T16:30:00`, end: `${mondayStr}T17:00:00` };
  assert.equal(c.isResourceAvailableForSlot(team2Tech, slotLate).ok, true, "Team 2 must be available at 16:30 on Monday");

  // After 17:00: Team 2 unavailable
  const slotAfterClose = { start: `${mondayStr}T17:00:00`, end: `${mondayStr}T17:30:00` };
  assert.equal(c.isResourceAvailableForSlot(team2Tech, slotAfterClose).ok, false, "Team 2 must be UNAVAILABLE after 17:00 on Monday");

  console.log("✔ R3-S8: Monday Team 2 boundaries verified (09:45 starts, 17:00 ended)");
}

// --- R3-S9: Friday Morning Differences ---
{
  // Friday: 2026-05-22
  const fridayStr = "2026-05-22";

  // 08:00 - 08:30: Team 1 available, Team 2 unavailable (Team 2 starts at 08:45 on Friday)
  const slot8am = { start: `${fridayStr}T08:00:00`, end: `${fridayStr}T08:30:00` };
  assert.equal(c.isResourceAvailableForSlot(team1Tech, slot8am).ok, true, "Team 1 must be available at 08:00 on Friday");
  assert.equal(c.isResourceAvailableForSlot(team2Tech, slot8am).ok, false, "Team 2 must be UNAVAILABLE at 08:00 on Friday");

  // 08:45 - 09:00: Both available
  const slot845am = { start: `${fridayStr}T08:45:00`, end: `${fridayStr}T09:00:00` };
  assert.equal(c.isResourceAvailableForSlot(team1Tech, slot845am).ok, true, "Team 1 must be available at 08:45 on Friday");
  assert.equal(c.isResourceAvailableForSlot(team2Tech, slot845am).ok, true, "Team 2 must be available at 08:45 on Friday");

  console.log("✔ R3-S9: Friday morning differences verified (08:00 Team 1 only, 08:45 both)");
}

// --- R3-S10: Friday Lunch Closure (12:30-13:45) ---
{
  const fridayStr = "2026-05-22";

  // 12:29 - 12:30: Both available
  const slotPreLunch = { start: `${fridayStr}T12:29:00`, end: `${fridayStr}T12:30:00` };
  assert.equal(c.isResourceAvailableForSlot(team1Tech, slotPreLunch).ok, true, "Team 1 must be available before 12:30 on Friday");
  assert.equal(c.isResourceAvailableForSlot(team2Tech, slotPreLunch).ok, true, "Team 2 must be available before 12:30 on Friday");

  // 12:30 - 13:45: Lunch closure for both teams and workshop
  const slotLunch = { start: `${fridayStr}T12:30:00`, end: `${fridayStr}T13:45:00` };
  assert.equal(c.isResourceAvailableForSlot(team1Tech, slotLunch).ok, false, "Team 1 must be UNAVAILABLE during Friday lunch (12:30-13:45)");
  assert.equal(c.isResourceAvailableForSlot(team2Tech, slotLunch).ok, false, "Team 2 must be UNAVAILABLE during Friday lunch (12:30-13:45)");

  // Workshop intervals on Friday
  const workshopIntervals = c.getDayIntervals(new Date(`${fridayStr}T10:00:00`));
  const lunchOverlap = workshopIntervals.some(i => i.start < new Date(`${fridayStr}T13:45:00`) && i.end > new Date(`${fridayStr}T12:30:00`));
  assert.equal(lunchOverlap, false, "Workshop itself must be closed 12:30-13:45 on Friday");

  console.log("✔ R3-S10: Friday lunch closure (12:30-13:45) verified for both teams and workshop");
}

// --- R3-S11: Friday Afternoon Differences ---
{
  const fridayStr = "2026-05-22";

  // 13:45 - 14:00: Both available
  const slotResume = { start: `${fridayStr}T13:45:00`, end: `${fridayStr}T14:00:00` };
  assert.equal(c.isResourceAvailableForSlot(team1Tech, slotResume).ok, true, "Team 1 must be available at 13:45 on Friday");
  assert.equal(c.isResourceAvailableForSlot(team2Tech, slotResume).ok, true, "Team 2 must be available at 13:45 on Friday");

  // 15:59 - 16:00: Both available
  const slotPre1600 = { start: `${fridayStr}T15:59:00`, end: `${fridayStr}T16:00:00` };
  assert.equal(c.isResourceAvailableForSlot(team1Tech, slotPre1600).ok, true, "Team 1 must be available at 15:59 on Friday");
  assert.equal(c.isResourceAvailableForSlot(team2Tech, slotPre1600).ok, true, "Team 2 must be available at 15:59 on Friday");

  // 16:00 - 16:30: Team 1 ended, Team 2 remains available
  const slotAt1600 = { start: `${fridayStr}T16:00:00`, end: `${fridayStr}T16:30:00` };
  assert.equal(c.isResourceAvailableForSlot(team1Tech, slotAt1600).ok, false, "Team 1 must end shift at 16:00 on Friday");
  assert.equal(c.isResourceAvailableForSlot(team2Tech, slotAt1600).ok, true, "Team 2 must remain available at 16:00 on Friday");

  // 16:30 - 17:00: Team 2 available
  const slotPost1630 = { start: `${fridayStr}T16:30:00`, end: `${fridayStr}T17:00:00` };
  assert.equal(c.isResourceAvailableForSlot(team1Tech, slotPost1630).ok, false, "Team 1 must be unavailable at 16:30 on Friday");
  assert.equal(c.isResourceAvailableForSlot(team2Tech, slotPost1630).ok, true, "Team 2 must be available at 16:30 on Friday");

  // After 17:00: Both ended
  const slotAfter1700 = { start: `${fridayStr}T17:00:00`, end: `${fridayStr}T17:30:00` };
  assert.equal(c.isResourceAvailableForSlot(team1Tech, slotAfter1700).ok, false, "Team 1 unavailable after 17:00 on Friday");
  assert.equal(c.isResourceAvailableForSlot(team2Tech, slotAfter1700).ok, false, "Team 2 unavailable after 17:00 on Friday");

  console.log("✔ R3-S11: Friday afternoon differences verified (16:00 Team 1 ends, 17:00 Team 2 ends)");
}

// --- R3-S12: Saturday Resources ---
{
  // Saturday: 2026-05-23
  const saturdayStr = "2026-05-23";

  // 08:00 - 12:00: Both available
  const slotSatOpen = { start: `${saturdayStr}T08:00:00`, end: `${saturdayStr}T12:00:00` };
  assert.equal(c.isResourceAvailableForSlot(team1Tech, slotSatOpen).ok, true, "Team 1 available Saturday 08:00-12:00");
  assert.equal(c.isResourceAvailableForSlot(team2Tech, slotSatOpen).ok, true, "Team 2 available Saturday 08:00-12:00");

  // After 12:00: Neither available
  const slotSatAfter = { start: `${saturdayStr}T12:00:00`, end: `${saturdayStr}T12:30:00` };
  assert.equal(c.isResourceAvailableForSlot(team1Tech, slotSatAfter).ok, false, "Team 1 unavailable Saturday after 12:00");
  assert.equal(c.isResourceAvailableForSlot(team2Tech, slotSatAfter).ok, false, "Team 2 unavailable Saturday after 12:00");

  console.log("✔ R3-S12: Saturday schedule (08:00-12:00 open, after 12:00 closed) verified");
}

// --- R3-S13: Sunday Resources ---
{
  // Sunday: 2026-05-24
  const sundayStr = "2026-05-24";
  const slotSun = { start: `${sundayStr}T10:00:00`, end: `${sundayStr}T11:00:00` };
  assert.equal(c.isResourceAvailableForSlot(team1Tech, slotSun).ok, false, "Team 1 unavailable on Sunday");
  assert.equal(c.isResourceAvailableForSlot(team2Tech, slotSun).ok, false, "Team 2 unavailable on Sunday");
  console.log("✔ R3-S13: Sunday resources closed");
}

// --- R3-S14: Holiday Closure ---
{
  // Set holiday on Monday 2026-05-18
  const holidayDate = "2026-05-18";
  c.state.holidays.push({ date: holidayDate, label: "Fête nationale" });

  const slotHoliday = { start: `${holidayDate}T10:00:00`, end: `${holidayDate}T11:00:00` };
  assert.equal(c.isResourceAvailableForSlot(team1Tech, slotHoliday).ok, false, "Team 1 must be unavailable on holiday");
  assert.equal(c.isResourceAvailableForSlot(team2Tech, slotHoliday).ok, false, "Team 2 must be unavailable on holiday");
  assert.equal(c.getDayIntervals(new Date(holidayDate)).length, 0, "Workshop day intervals must be empty on holiday");

  // Clean up holiday
  c.state.holidays = c.state.holidays.filter(h => h.date !== holidayDate);
  console.log("✔ R3-S14: Holiday closure completely blocks workshop and resources");
}

// --- R3-S15: Leave Overrides Schedule ---
{
  const mondayStr = "2026-05-18";
  const leaveBooking = {
    id: "leave-test-1",
    caseId: "__leave__",
    type: "leave",
    resourceIds: [team1Tech.id],
    start: `${mondayStr}T10:00:00`,
    end: `${mondayStr}T12:00:00`,
    segments: [{ start: `${mondayStr}T10:00:00`, end: `${mondayStr}T12:00:00` }],
    status: "planned",
  };
  c.state.bookings.push(leaveBooking);

  // Slot inside leave
  const slotDuringLeave = { start: `${mondayStr}T10:30:00`, end: `${mondayStr}T11:00:00` };
  const slotOutsideLeave = { start: `${mondayStr}T08:00:00`, end: `${mondayStr}T09:00:00` };

  assert.equal(c.isResourceAvailableForSlot(team1Tech, slotDuringLeave).ok, false, "Team 1 technician must be unavailable during leave");
  assert.equal(c.isResourceAvailableForSlot(team1Tech, slotOutsideLeave).ok, true, "Team 1 technician must remain available outside leave");

  // Clean up
  c.state.bookings = c.state.bookings.filter(b => b.id !== "leave-test-1");
  console.log("✔ R3-S15: Technician leave overrides schedule and blocks availability");
}

// --- R3-S16: Inactive Overrides Schedule ---
{
  const inactiveTech = {
    id: "tech-inactive",
    name: "Technicien Inactif",
    role: "tolier",
    active: false,
    calendar: {
      scheduleProfile: "team_1",
      workHours: c.cloneWorkHours(c.RESOURCE_SCHEDULE_PROFILES.team_1.workHours),
    },
  };

  const slot = { start: "2026-05-18T10:00:00", end: "2026-05-18T11:00:00" };
  const availability = c.isResourceAvailableForSlot(inactiveTech, slot);
  assert.equal(availability.ok, false, "Inactive technician must be unavailable");
  assert.equal(availability.code, "inactive", "Code must be inactive");
  console.log("✔ R3-S16: Inactive technician is unavailable regardless of valid schedule");
}

// --- R3-S17: Legacy Global Default Migration ---
{
  const legacyHours = {
    0: [],
    1: [["08:00", "12:00"], ["13:00", "17:00"]],
    2: [["08:00", "12:00"], ["13:00", "17:00"]],
    3: [["08:00", "12:00"], ["13:00", "17:00"]],
    4: [["08:00", "12:00"], ["13:00", "17:00"]],
    5: [["08:00", "12:00"], ["13:00", "17:00"]],
    6: [["08:00", "13:00"]],
  };

  const migrated = c.migrateLegacyWorkHours(legacyHours);
  assert.deepEqual(toPlain(migrated), toPlain(c.DEFAULT_WORK_HOURS), "Legacy historical work hours must migrate to authoritative DEFAULT_WORK_HOURS");

  // Idempotence test
  const migratedTwice = c.migrateLegacyWorkHours(migrated);
  assert.deepEqual(toPlain(migratedTwice), toPlain(c.DEFAULT_WORK_HOURS), "Migration must be idempotent");

  console.log("✔ R3-S17: Legacy global default migration is correct and idempotent");
}

// --- R3-S18: Custom Global Schedule Preserved ---
{
  const customHours = {
    0: [],
    1: [["06:30", "14:30"]],
    2: [["06:30", "14:30"]],
    3: [["06:30", "14:30"]],
    4: [["06:30", "14:30"]],
    5: [["06:30", "12:00"]],
    6: [],
  };

  const migratedCustom = c.migrateLegacyWorkHours(customHours);
  assert.deepEqual(toPlain(migratedCustom), toPlain(customHours), "Custom work hours must be strictly preserved without modification");
  console.log("✔ R3-S18: Custom global work hours are strictly preserved");
}

// --- R3-S19: Resource Schedule Persistence ---
{
  const testResource = {
    id: "res-persistence-test",
    name: "Tech Persistence",
    role: "peintre",
    active: true,
  };

  // Set Team 1
  c.setResourceScheduleProfile(testResource, "team_1");
  assert.equal(testResource.calendar?.scheduleProfile, "team_1");
  assert.deepEqual(toPlain(testResource.calendar?.workHours), toPlain(c.RESOURCE_SCHEDULE_PROFILES.team_1.workHours));
  assert.equal(c.getResourceScheduleProfile(testResource), "team_1");

  // Normalization preserves it
  const normalized = c.normalizeResource(testResource);
  assert.equal(normalized.calendar?.scheduleProfile, "team_1");
  assert.deepEqual(toPlain(normalized.calendar?.workHours), toPlain(c.RESOURCE_SCHEDULE_PROFILES.team_1.workHours));

  // Set Workshop default
  c.setResourceScheduleProfile(testResource, "workshop");
  assert.equal(testResource.calendar?.scheduleProfile, undefined);
  assert.equal(testResource.calendar?.workHours, undefined);
  assert.equal(c.getResourceScheduleProfile(testResource), "workshop");

  console.log("✔ R3-S19: Resource schedule profile setting, serialization, and normalization verified");
}

// --- R3-S20: Equipment Behavior Unchanged ---
{
  const booth = {
    id: "booth-1",
    name: "Cabine 1",
    role: "cabine",
    active: true,
  };

  // Equipment has no custom workHours, so it uses workshop union
  const mondayStr = "2026-05-18";
  const slotEarly = { start: `${mondayStr}T07:45:00`, end: `${mondayStr}T08:30:00` };
  const slotLate = { start: `${mondayStr}T16:00:00`, end: `${mondayStr}T17:00:00` };
  const slotOver = { start: `${mondayStr}T17:00:00`, end: `${mondayStr}T17:30:00` };

  assert.equal(c.isResourceAvailableForSlot(booth, slotEarly).ok, true, "Equipment open at 07:45 according to workshop envelope");
  assert.equal(c.isResourceAvailableForSlot(booth, slotLate).ok, true, "Equipment open at 16:00 according to workshop envelope");
  assert.equal(c.isResourceAvailableForSlot(booth, slotOver).ok, false, "Equipment closed after 17:00");
  assert.equal(c.getResourceScheduleProfile(booth), "workshop", "Equipment profile is workshop");

  console.log("✔ R3-S20: Equipment resource correctly follows workshop envelope without team restriction");
}

// --- R3-S21: Mathematical Union Assertion (Section 18) ---
{
  // Monday: Team 1 [07:45-15:00] + Team 2 [09:45-17:00] = [07:45-17:00]
  const monT1 = c.RESOURCE_SCHEDULE_PROFILES.team_1.workHours[1][0]; // ["07:45", "15:00"]
  const monT2 = c.RESOURCE_SCHEDULE_PROFILES.team_2.workHours[1][0]; // ["09:45", "17:00"]
  const monUnionStart = monT1[0] < monT2[0] ? monT1[0] : monT2[0];
  const monUnionEnd = monT1[1] > monT2[1] ? monT1[1] : monT2[1];
  assert.equal(monUnionStart, "07:45");
  assert.equal(monUnionEnd, "17:00");
  assert.deepEqual(toPlain(c.DEFAULT_WORK_HOURS[1]), [[monUnionStart, monUnionEnd]]);

  // Friday:
  // Team 1: [07:45-12:30], [13:45-16:00]
  // Team 2: [08:45-12:30], [13:45-17:00]
  // Morning union: [07:45, 12:30]
  // Afternoon union: [13:45, 17:00]
  const friT1 = c.RESOURCE_SCHEDULE_PROFILES.team_1.workHours[5];
  const friT2 = c.RESOURCE_SCHEDULE_PROFILES.team_2.workHours[5];
  const friMorningStart = friT1[0][0] < friT2[0][0] ? friT1[0][0] : friT2[0][0];
  const friMorningEnd = friT1[0][1] > friT2[0][1] ? friT1[0][1] : friT2[0][1];
  const friAfternoonStart = friT1[1][0] < friT2[1][0] ? friT1[1][0] : friT2[1][0];
  const friAfternoonEnd = friT1[1][1] > friT2[1][1] ? friT1[1][1] : friT2[1][1];
  assert.equal(friMorningStart, "07:45");
  assert.equal(friMorningEnd, "12:30");
  assert.equal(friAfternoonStart, "13:45");
  assert.equal(friAfternoonEnd, "17:00");
  assert.deepEqual(toPlain(c.DEFAULT_WORK_HOURS[5]), [[friMorningStart, friMorningEnd], [friAfternoonStart, friAfternoonEnd]]);

  console.log("✔ R3-S21: Workshop envelope mathematically matches union of Team 1 and Team 2");
}

// --- R3-S22: Form Submission in app.js with scheduleProfile (DEF-R3-001 Regression Guard) ---
{
  const appCode = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
  const fnMatch = appCode.match(/function bindWorkshopForms\(\)\s*\{[\s\S]*?\n\}/u);
  assert.ok(fnMatch, "bindWorkshopForms must exist in app.js");
  c.bindWorkHoursInputs = () => {};
  c.updateFastLaneSettings = () => {};
  c.bindSettingsWorkspaceNavigation = () => {};
  c.renderPlanning = () => {};
  c.renderHolidays = () => {};
  c.renderResourceLeaves = () => {};
  c.renderMetrics = () => {};
  c.run(fnMatch[0]);

  let submitListener = null;
  let roleChangeListener = null;

  const roleSelect = {
    value: "tolier",
    addEventListener(evt, listener) {
      if (evt === "change") roleChangeListener = listener;
    },
  };

  const scheduleSelect = {
    value: "workshop",
    disabled: false,
  };

  const scheduleField = {
    hidden: false,
  };

  const formElement = {
    addEventListener(evt, listener) {
      if (evt === "submit") submitListener = listener;
    },
    reset() {},
  };

  c.document.querySelector = (selector) => {
    if (selector === "#resource-form") return formElement;
    if (selector === '#resource-form [name="role"]') return roleSelect;
    if (selector === '#resource-form [name="scheduleProfile"]') return scheduleSelect;
    if (selector === "#resource-form [data-resource-schedule-profile-field]") return scheduleField;
    return null;
  };

  c.bindWorkshopForms();

  assert.ok(typeof submitListener === "function", "submit listener must be attached to #resource-form");
  assert.ok(typeof roleChangeListener === "function", "role change listener must be attached for R3-REV-001");

  // Ensure current user is authorized to manage resources (e.g. chef_atelier)
  const adminUser = c.state.users.find((u) => u.role === "chef_atelier" || u.role === "admin_technique")
    || { id: "test-admin", name: "Admin Test", role: "chef_atelier", active: true };
  if (!c.state.users.includes(adminUser)) c.state.users.push(adminUser);
  c.state.currentUserId = adminUser.id;

  // Test 1: Submit new human technician with Team 1 profile
  const initialCount = c.state.resources.length;
  const formPayloadTeam1 = {
    scheduleProfile: "team_1",
    role: "tolier",
    name: "Nouveau Tôlier Équipe 1",
    site: "internal",
    capacity: "1",
  };
  const eventTeam1 = {
    preventDefault() {},
    currentTarget: { __formData: formPayloadTeam1, reset() {} },
  };

  // Must execute cleanly without ReferenceError: data is not defined (DEF-R3-001)
  submitListener(eventTeam1);

  assert.equal(c.state.resources.length, initialCount + 1, "Resource must be added to state.resources");
  const addedT1 = c.state.resources[c.state.resources.length - 1];
  assert.equal(addedT1.name, "Nouveau Tôlier Équipe 1");
  assert.equal(addedT1.role, "tolier");
  assert.equal(addedT1.scheduleProfile, "team_1");
  assert.equal(c.calculateWeeklyWorkMinutes(addedT1.calendar.workHours), 2400, "Added resource must have 40 h calendar");

  // Test 2: Submit equipment resource with team_1 selected — must NOT receive human team schedule
  const formPayloadEquip = {
    scheduleProfile: "team_1",
    role: "cabine",
    name: "Cabine Test",
    site: "internal",
    capacity: "1",
  };
  const eventEquip = {
    preventDefault() {},
    currentTarget: { __formData: formPayloadEquip, reset() {} },
  };
  submitListener(eventEquip);
  const addedEquip = c.state.resources[c.state.resources.length - 1];
  assert.equal(addedEquip.name, "Cabine Test");
  assert.equal(addedEquip.scheduleProfile, null, "Equipment must not have team scheduleProfile");
  assert.deepEqual(toPlain(addedEquip.calendar), {}, "Equipment calendar must remain empty to follow workshop union");

  console.log("✔ R3-S22: Form submission in app.js handles scheduleProfile and equipment correctly (DEF-R3-001 verified resolved)");

  // --- R3-S23: Human creation role exposes team schedule selector ---
  roleSelect.value = "tolier";
  scheduleSelect.value = "workshop";
  roleChangeListener();

  assert.equal(scheduleField.hidden, false, "Human role must show Horaire / Équipe field");
  assert.equal(scheduleSelect.disabled, false, "Human role schedule selector must be enabled");

  console.log("✔ R3-S23: Human creation role exposes enabled team schedule selector");

  // --- R3-S24: Equipment creation role hides team schedule selector ---
  roleSelect.value = "cabine";
  scheduleSelect.value = "team_1";
  roleChangeListener();

  assert.equal(scheduleField.hidden, true, "Equipment role must hide Horaire / Équipe field");
  assert.equal(scheduleSelect.disabled, true, "Equipment role schedule selector must be disabled");
  assert.equal(scheduleSelect.value, "workshop", "Equipment role must reset schedule selector to workshop");

  console.log("✔ R3-S24: Equipment creation role hides and disables team schedule selector");

  // --- R3-S25: Human -> equipment transition clears selected team ---
  roleSelect.value = "tolier";
  roleChangeListener();

  scheduleSelect.value = "team_1";

  roleSelect.value = "cabine";
  roleChangeListener();

  assert.equal(scheduleField.hidden, true, "Human -> equipment must hide schedule field");
  assert.equal(scheduleSelect.disabled, true, "Human -> equipment must disable schedule selector");
  assert.equal(scheduleSelect.value, "workshop", "Human -> equipment must clear previous team assignment");

  const beforeTransitionSubmit = c.state.resources.length;

  submitListener({
    preventDefault() {},
    currentTarget: {
      __formData: {
        role: "cabine",
        name: "Cabine Transition Test",
        site: "internal",
        capacity: "1",
      },
      reset() {},
    },
  });

  assert.equal(c.state.resources.length, beforeTransitionSubmit + 1);
  const transitionedEquipment = c.state.resources[c.state.resources.length - 1];

  assert.equal(transitionedEquipment.role, "cabine");
  assert.equal(transitionedEquipment.scheduleProfile, null);
  assert.deepEqual(
    toPlain(transitionedEquipment.calendar),
    {},
    "Equipment created after role transition must keep empty calendar"
  );

  console.log("✔ R3-S25: Human -> equipment transition clears team and preserves equipment workshop behavior");

  // --- R3-S26: Equipment -> human transition re-enables explicit selection ---
  roleSelect.value = "cabine";
  roleChangeListener();

  assert.equal(scheduleSelect.disabled, true);

  roleSelect.value = "mecanicien";
  roleChangeListener();

  assert.equal(scheduleField.hidden, false, "Equipment -> human must show schedule field");
  assert.equal(scheduleSelect.disabled, false, "Equipment -> human must enable schedule selector");
  assert.equal(scheduleSelect.value, "workshop", "No team may be auto-selected after equipment -> human");

  scheduleSelect.value = "team_2";
  assert.equal(scheduleSelect.value, "team_2", "Operator must remain able to explicitly select Team 2");

  console.log("✔ R3-S26: Equipment -> human transition restores explicit team selection without automatic assignment");
}

console.log("\nALL 26 TEST SCENARIOS PASSED SUCCESSFULLY!");
