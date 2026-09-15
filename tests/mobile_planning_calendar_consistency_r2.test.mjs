import assert from "node:assert/strict";
import test from "node:test";
import { createNimrVmContext } from "./helpers/nimr_vm_context.mjs";

const TEST_WORKSHOP_HOURS = {
  0: [],
  1: [["07:45", "17:00"]],
  2: [["07:45", "17:00"]],
  3: [["07:45", "17:00"]],
  4: [["07:45", "17:00"]],
  5: [["07:45", "12:30"], ["13:45", "17:00"]],
  6: [["08:00", "12:00"]],
};

function D(str) {
  return new Date(str);
}

function createR2Fixture(options = {}) {
  const vm = createNimrVmContext();
  const tech = {
    id: "tech-1",
    name: "Mohamed Ali",
    role: "mecanicien",
    active: true,
  };

  vm.run(`
    state = normalizeState({
      users: [
        { id: "chief", name: "Chef Atelier", role: "chef_atelier", active: true }
      ],
      currentUserId: "chief",
      workHours: ${JSON.stringify(options.workHours || TEST_WORKSHOP_HOURS)},
      holidays: ${JSON.stringify(options.holidays || [])},
      resources: ${JSON.stringify(options.resources || [tech])},
      cases: [
        normalizeCase({
          id: "case-1",
          plate: "123TU456",
          vehicle: "Toyota Hilux",
          createdAt: "2026-09-07T07:45:00",
          flags: { received: true },
          receptionWorkflow: { vehicleReceivedAt: "2026-09-07T07:45:00" },
          claims: [{
            id: "claim-1",
            type: "mechanical_client",
            title: "Révision générale",
            includeInPlanning: true,
            clientApproved: true,
          }],
        })
      ],
      bookings: []
    });

    document.body = document.createElement("div");
    const mobileTarget = document.createElement("div");
    mobileTarget.id = "mobile-planning-list";
    const ganttTarget = document.createElement("div");
    ganttTarget.id = "planning-gantt";
    const ganttInner = document.createElement("div");
    ganttInner.id = "gantt";

    document.querySelector = (sel) => {
      if (sel === "#mobile-planning-list") return mobileTarget;
      if (sel === "#planning-gantt") return ganttTarget;
      if (sel === "#gantt") return ganttInner;
      return document.createElement("div");
    };

    invalidateUiRuntimeIndexes();
  `);

  const setBookings = (bookings) => {
    vm.context.__tempBookings = bookings;
    vm.run(`state.bookings = __tempBookings; invalidateUiRuntimeIndexes(); delete __tempBookings; `);
  };

  return {
    vm,
    c: vm.context,
    run: (code) => vm.run(code),
    setBookings,
    getTarget: () => vm.run(`document.querySelector("#mobile-planning-list")`),
  };
}

test("R2-S1: Early booking beginning at 07:45 on Monday is included in mobile planning without 08:00 clipping", () => {
  const { c, run, setBookings, getTarget } = createR2Fixture();
  const monday = D("2026-09-07T00:00:00");

  setBookings([{
    id: "b-early",
    caseId: "case-1",
    type: "work",
    title: "Vidange matinale",
    status: "planned",
    start: "2026-09-07T07:45:00",
    end: "2026-09-07T08:30:00",
    segments: [{ start: "2026-09-07T07:45:00", end: "2026-09-07T08:30:00" }],
    resourceIds: ["tech-1"],
  }]);

  const resources = run("state.resources");
  const taskNumberMap = c.buildDailyPlanningTaskNumberMap(monday, resources);
  c.renderMobilePlanningList(monday, resources, taskNumberMap);

  const target = getTarget();
  assert.match(target.innerHTML, /123TU456/, "Early booking case must appear in mobile planning");
  assert.match(target.innerHTML, /07:45/, "Booking start time must display 07:45, not clipped to 08:00");
  assert.match(target.innerHTML, /1 tâche/, "Mobile header must count 1 task");
});

test("R2-S2: Daily planning task number map includes operations starting between 07:45-07:59", () => {
  const { c, run, setBookings } = createR2Fixture();
  const monday = D("2026-09-07T00:00:00");

  setBookings([
    {
      id: "b-sub8",
      caseId: "case-1",
      type: "work",
      title: "Diagnostic express",
      status: "planned",
      start: "2026-09-07T07:45:00",
      end: "2026-09-07T08:00:00",
      segments: [{ start: "2026-09-07T07:45:00", end: "2026-09-07T08:00:00" }],
      resourceIds: ["tech-1"],
    },
    {
      id: "b-after8",
      caseId: "case-1",
      type: "work",
      title: "Changement filtres",
      status: "planned",
      start: "2026-09-07T08:15:00",
      end: "2026-09-07T09:00:00",
      segments: [{ start: "2026-09-07T08:15:00", end: "2026-09-07T09:00:00" }],
      resourceIds: ["tech-1"],
    }
  ]);

  const resources = run("state.resources");
  const map = c.buildDailyPlanningTaskNumberMap(monday, resources);

  const key1 = c.getPlanningTaskNumberKey({ id: "b-sub8" }, { start: "2026-09-07T07:45:00", end: "2026-09-07T08:00:00" });
  const key2 = c.getPlanningTaskNumberKey({ id: "b-after8" }, { start: "2026-09-07T08:15:00", end: "2026-09-07T09:00:00" });

  assert.equal(map.has(key1), true, "Task 07:45-08:00 must be present in task number map");
  assert.equal(map.get(key1), 1, "Early task must be numbered #1");
  assert.equal(map.get(key2), 2, "Second task must be numbered #2");
});

test("R2-S3: Mobile planning dynamically follows custom configuration changes", () => {
  const customHours = {
    0: [],
    1: [["06:30", "15:00"]],
    2: [["06:30", "15:00"]],
    3: [["06:30", "15:00"]],
    4: [["06:30", "15:00"]],
    5: [["06:30", "15:00"]],
    6: [],
  };
  const { c, run, setBookings, getTarget } = createR2Fixture({ workHours: customHours });
  const monday = D("2026-09-07T00:00:00");

  setBookings([{
    id: "b-custom",
    caseId: "case-1",
    type: "work",
    title: "Poste avancé",
    status: "planned",
    start: "2026-09-07T06:30:00",
    end: "2026-09-07T07:30:00",
    segments: [{ start: "2026-09-07T06:30:00", end: "2026-09-07T07:30:00" }],
    resourceIds: ["tech-1"],
  }]);

  const bounds = c.getGanttDayBounds(monday);
  assert.equal(c.formatTime(bounds.dayStart), "06:30", "Gantt dayStart must reflect 06:30");
  assert.equal(c.formatTime(bounds.dayEnd), "15:00", "Gantt dayEnd must reflect 15:00");

  const resources = run("state.resources");
  const taskNumberMap = c.buildDailyPlanningTaskNumberMap(monday, resources);
  c.renderMobilePlanningList(monday, resources, taskNumberMap);

  const target = getTarget();
  assert.match(target.innerHTML, /123TU456/, "Task starting at 06:30 must be displayed");
  assert.match(target.innerHTML, /06:30/, "Mobile display must show 06:30");
});

test("R2-S4: Friday split-shift produces correct outer bounds (07:45-17:00)", () => {
  const { c, run, setBookings, getTarget } = createR2Fixture();
  const friday = D("2026-09-11T00:00:00");

  const bounds = c.getGanttDayBounds(friday);
  assert.equal(c.formatTime(bounds.dayStart), "07:45", "Friday outer start must be 07:45");
  assert.equal(c.formatTime(bounds.dayEnd), "17:00", "Friday outer end must be 17:00");

  setBookings([
    {
      id: "b-fri-morning",
      caseId: "case-1",
      type: "work",
      title: "Matin vendredi",
      status: "planned",
      start: "2026-09-11T07:45:00",
      end: "2026-09-11T09:00:00",
      segments: [{ start: "2026-09-11T07:45:00", end: "2026-09-11T09:00:00" }],
      resourceIds: ["tech-1"],
    },
    {
      id: "b-fri-afternoon",
      caseId: "case-1",
      type: "work",
      title: "Après-midi vendredi",
      status: "planned",
      start: "2026-09-11T14:00:00",
      end: "2026-09-11T16:30:00",
      segments: [{ start: "2026-09-11T14:00:00", end: "2026-09-11T16:30:00" }],
      resourceIds: ["tech-1"],
    }
  ]);

  const resources = run("state.resources");
  const taskNumberMap = c.buildDailyPlanningTaskNumberMap(friday, resources);
  c.renderMobilePlanningList(friday, resources, taskNumberMap);

  const target = getTarget();
  assert.match(target.innerHTML, /07:45/);
  assert.match(target.innerHTML, /14:00/);
  assert.match(target.innerHTML, /2 tâches/);
});

test("R2-S5: Saturday shorter opening bounds (08:00-12:00) are correctly respected", () => {
  const { c, run, setBookings, getTarget } = createR2Fixture();
  const saturday = D("2026-09-12T00:00:00");

  const bounds = c.getGanttDayBounds(saturday);
  assert.equal(c.formatTime(bounds.dayStart), "08:00", "Saturday outer start must be 08:00");
  assert.equal(c.formatTime(bounds.dayEnd), "12:00", "Saturday outer end must be 12:00");

  setBookings([{
    id: "b-sat",
    caseId: "case-1",
    type: "work",
    title: "Permanence samedi",
    status: "planned",
    start: "2026-09-12T08:00:00",
    end: "2026-09-12T12:00:00",
    segments: [{ start: "2026-09-12T08:00:00", end: "2026-09-12T12:00:00" }],
    resourceIds: ["tech-1"],
  }]);

  const resources = run("state.resources");
  const taskNumberMap = c.buildDailyPlanningTaskNumberMap(saturday, resources);
  c.renderMobilePlanningList(saturday, resources, taskNumberMap);

  const target = getTarget();
  assert.match(target.innerHTML, /08:00/);
  assert.match(target.innerHTML, /1 tâche/);
});

test("R2-S6: Closed Sunday behaves safely without fabricating 08:00-17:00 tasks or crashing", () => {
  const { c, run, setBookings, getTarget } = createR2Fixture();
  const sunday = D("2026-09-13T00:00:00");

  const intervals = c.getDayIntervals(sunday);
  assert.equal(intervals.length, 0, "Sunday must have 0 working intervals");

  setBookings([]);
  const resources = run("state.resources");
  const taskNumberMap = c.buildDailyPlanningTaskNumberMap(sunday, resources);
  assert.equal(taskNumberMap.size, 0, "Task number map must be empty on closed Sunday");

  c.renderMobilePlanningList(sunday, resources, taskNumberMap);
  const target = getTarget();
  assert.match(target.innerHTML, /Aucune tâche atelier planifiée sur cette journée/, "Must render safe empty message");
});

test("R2-S7: Existing desktop getGanttDayBounds behavior remains completely unchanged", () => {
  const { c } = createR2Fixture();

  // Monday
  const mondayBounds = c.getGanttDayBounds(D("2026-09-07T00:00:00"));
  assert.equal(c.formatTime(mondayBounds.dayStart), "07:45");
  assert.equal(c.formatTime(mondayBounds.dayEnd), "17:00");

  // Friday
  const fridayBounds = c.getGanttDayBounds(D("2026-09-11T00:00:00"));
  assert.equal(c.formatTime(fridayBounds.dayStart), "07:45");
  assert.equal(c.formatTime(fridayBounds.dayEnd), "17:00");

  // Saturday
  const saturdayBounds = c.getGanttDayBounds(D("2026-09-12T00:00:00"));
  assert.equal(c.formatTime(saturdayBounds.dayStart), "08:00");
  assert.equal(c.formatTime(saturdayBounds.dayEnd), "12:00");

  // Sunday fallback
  const sundayBounds = c.getGanttDayBounds(D("2026-09-13T00:00:00"));
  assert.equal(c.formatTime(sundayBounds.dayStart), "08:00");
  assert.equal(c.formatTime(sundayBounds.dayEnd), "17:00");
});
