import assert from "node:assert/strict";
import test from "node:test";
import { createNimrVmContext } from "./helpers/nimr_vm_context.mjs";

const TEAM_1_WORK_HOURS = {
  0: [],
  1: [["07:45", "15:00"]],
  2: [["07:45", "15:00"]],
  3: [["07:45", "15:00"]],
  4: [["07:45", "15:00"]],
  5: [["07:45", "12:30"], ["13:45", "16:00"]],
  6: [["08:00", "12:00"]],
};

const TEAM_2_WORK_HOURS = {
  0: [],
  1: [["09:45", "17:00"]],
  2: [["09:45", "17:00"]],
  3: [["09:45", "17:00"]],
  4: [["09:45", "17:00"]],
  5: [["08:45", "12:30"], ["13:45", "17:00"]],
  6: [["08:00", "12:00"]],
};

const WORKSHOP_UNION_HOURS = {
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

function createR1bFixture(options = {}) {
  const vm = createNimrVmContext();
  const team1Resource = {
    id: "tech-team1",
    name: "Technicien Equipe 1",
    role: "mecanicien",
    active: true,
    calendar: { workHours: options.team1Hours || TEAM_1_WORK_HOURS },
  };
  const team2Resource = {
    id: "tech-team2",
    name: "Technicien Equipe 2",
    role: "tolier",
    active: true,
    calendar: { workHours: options.team2Hours || TEAM_2_WORK_HOURS },
  };
  const genericResource = {
    id: "tech-generic",
    name: "Technicien Standard",
    role: "mecanicien",
    active: true,
  };

  vm.run(`
    state = normalizeState({
      users: [
        { id: "chief", name: "Chef", role: "chef_atelier", active: true },
        { id: "front", name: "Conseiller", role: "reception", active: true }
      ],
      currentUserId: "chief",
      workHours: ${JSON.stringify(options.workshopHours || WORKSHOP_UNION_HOURS)},
      holidays: ${JSON.stringify(options.holidays || [])},
      resources: ${JSON.stringify(options.resources || [team1Resource, team2Resource, genericResource])},
      cases: [
        normalizeCase({
          id: "car-1",
          plate: "111TU222",
          vehicle: "Véhicule test",
          createdAt: "${options.receivedAt || "2026-09-07T07:45:00"}",
          flags: { received: true },
          receptionWorkflow: { vehicleReceivedAt: "${options.receivedAt || "2026-09-07T07:45:00"}" },
          claims: [{
            id: "claim-1",
            type: "mechanical_client",
            title: "Réparation mécanique",
            includeInPlanning: true,
            clientApproved: true,
          }],
        })
      ],
      bookings: []
    });
    invalidateUiRuntimeIndexes();
  `);

  const setBookings = (bookings) => {
    vm.context.__tempBookings = bookings;
    vm.run(`state.bookings = __tempBookings; invalidateUiRuntimeIndexes(); delete __tempBookings;`);
  };

  return {
    vm,
    c: vm.context,
    run: vm.run.bind(vm),
    item: vm.run("state.cases[0]"),
    setBookings,
  };
}

test("Section 17: Team 1 schedule sums to exactly 40 hours/week", () => {
  const { c } = createR1bFixture();
  let totalMinutes = 0;
  for (let day = 0; day <= 6; day++) {
    const intervals = TEAM_1_WORK_HOURS[day] || [];
    intervals.forEach(([start, end]) => {
      totalMinutes += c.diffMinutes(c.atTime(D("2026-09-07T00:00:00"), start), c.atTime(D("2026-09-07T00:00:00"), end));
    });
  }
  assert.equal(totalMinutes, 40 * 60, "Team 1 must total exactly 40h (2400 minutes)");
});

test("Section 17: Team 2 schedule sums to exactly 40 hours/week", () => {
  const { c } = createR1bFixture();
  let totalMinutes = 0;
  for (let day = 0; day <= 6; day++) {
    const intervals = TEAM_2_WORK_HOURS[day] || [];
    intervals.forEach(([start, end]) => {
      totalMinutes += c.diffMinutes(c.atTime(D("2026-09-07T00:00:00"), start), c.atTime(D("2026-09-07T00:00:00"), end));
    });
  }
  assert.equal(totalMinutes, 40 * 60, "Team 2 must total exactly 40h (2400 minutes)");
});

test("Helper: addResourceWorkingMinutes respects Friday common closure", () => {
  const { c, run } = createR1bFixture();
  const tech = run("state.resources.find(r => r.id === 'tech-team1')");
  const finish = D("2026-09-11T12:30:00");
  const result = c.addResourceWorkingMinutes(tech, finish, 30);
  assert.equal(result.getTime(), D("2026-09-11T14:15:00").getTime());
});

test("Helper: addResourceWorkingMinutes handles Team 1 cross-shift to next working day", () => {
  const { c, run } = createR1bFixture();
  const tech = run("state.resources.find(r => r.id === 'tech-team1')");
  const finish = D("2026-09-07T15:00:00");
  const result = c.addResourceWorkingMinutes(tech, finish, 30);
  assert.equal(result.getTime(), D("2026-09-08T08:15:00").getTime());
});

test("Helper: getWorkshopOpenElapsedHours correctly computes workshop union hours", () => {
  const { c } = createR1bFixture();
  const monFull = c.getWorkshopOpenElapsedHours(D("2026-09-07T07:45:00"), D("2026-09-07T17:00:00"));
  assert.equal(monFull, 9.25);

  const friLunch = c.getWorkshopOpenElapsedHours(D("2026-09-11T12:30:00"), D("2026-09-11T13:45:00"));
  assert.equal(friLunch, 0);

  const weekend = c.getWorkshopOpenElapsedHours(D("2026-09-12T12:00:00"), D("2026-09-14T07:45:00"));
  assert.equal(weekend, 0);
});

test("S1: Task planned 08:00, not started at 08:20 -> NO ALERT", () => {
  const { c, item, setBookings } = createR1bFixture();
  setBookings([{
    id: "b1",
    caseId: item.id,
    type: "work",
    title: "Mécanique",
    status: "planned",
    start: "2026-09-07T08:00:00",
    end: "2026-09-07T10:00:00",
    segments: [{ start: "2026-09-07T08:00:00", end: "2026-09-07T10:00:00" }],
    resourceIds: ["tech-generic"],
  }]);

  const exceptions = c.getOperationalExceptions(item, D("2026-09-07T08:20:00"));
  assert.equal(exceptions.some((e) => e.code === "task_start_late"), false);
  assert.equal(exceptions.some((e) => e.code === "task_finish_late"), false);
});

test("S2: Task planned 08:00, not started at 08:31 -> DÉMARRAGE EN RETARD", () => {
  const { c, item, setBookings } = createR1bFixture();
  setBookings([{
    id: "b1",
    caseId: item.id,
    type: "work",
    title: "Mécanique",
    status: "planned",
    start: "2026-09-07T08:00:00",
    end: "2026-09-07T10:00:00",
    segments: [{ start: "2026-09-07T08:00:00", end: "2026-09-07T10:00:00" }],
    resourceIds: ["tech-generic"],
  }]);

  // At 08:30:00 (exact threshold) -> no alert
  const atThreshold = c.getOperationalExceptions(item, D("2026-09-07T08:30:00"));
  assert.equal(atThreshold.some((e) => e.code === "task_start_late"), false, "Exact boundary must not fire yet");

  // At 08:31:00 (after threshold) -> DÉMARRAGE EN RETARD
  const exceptions = c.getOperationalExceptions(item, D("2026-09-07T08:31:00"));
  const startLate = exceptions.find((e) => e.code === "task_start_late");
  assert.ok(startLate, "DÉMARRAGE EN RETARD must fire");
  assert.match(startLate.label, /Démarrage en retard : Mécanique/);
  assert.equal(startLate.severity, "warn");
  assert.equal(startLate.owner, "Chef Atelier");
});

test("S3: Task 08:00-12:00 running at 11:50 -> NO ALERT", () => {
  const { c, item, setBookings } = createR1bFixture();
  setBookings([{
    id: "b1",
    caseId: item.id,
    type: "work",
    title: "Peinture",
    status: "started",
    actualStart: "2026-09-07T08:00:00",
    start: "2026-09-07T08:00:00",
    end: "2026-09-07T12:00:00",
    segments: [{ start: "2026-09-07T08:00:00", end: "2026-09-07T12:00:00" }],
    resourceIds: ["tech-generic"],
  }]);

  const exceptions = c.getOperationalExceptions(item, D("2026-09-07T11:50:00"));
  assert.equal(exceptions.some((e) => e.code === "task_finish_late"), false);
  assert.equal(exceptions.some((e) => e.code === "task_start_late"), false);
  assert.equal(exceptions.some((e) => e.code === "stale"), false);
});

test("S4: Task 08:00-12:00 unfinished at 12:31 -> FIN DE TÂCHE EN RETARD", () => {
  const { c, item, setBookings } = createR1bFixture();
  setBookings([{
    id: "b1",
    caseId: item.id,
    type: "work",
    title: "Peinture",
    status: "started",
    actualStart: "2026-09-07T08:00:00",
    start: "2026-09-07T08:00:00",
    end: "2026-09-07T12:00:00",
    segments: [{ start: "2026-09-07T08:00:00", end: "2026-09-07T12:00:00" }],
    resourceIds: ["tech-generic"],
  }]);

  // At 12:30:00 (exact threshold) -> no alert
  const atThreshold = c.getOperationalExceptions(item, D("2026-09-07T12:30:00"));
  assert.equal(atThreshold.some((e) => e.code === "task_finish_late"), false, "Exact boundary must not fire yet");

  // At 12:31:00 (after threshold) -> FIN DE TÂCHE EN RETARD
  const exceptions = c.getOperationalExceptions(item, D("2026-09-07T12:31:00"));
  const finishLate = exceptions.find((e) => e.code === "task_finish_late");
  assert.ok(finishLate, "FIN DE TÂCHE EN RETARD must fire");
  assert.match(finishLate.label, /Fin de tâche en retard : Peinture/);
});

test("S5: Long Tôlerie task 07:45-15:00 running normally at 14:30 -> NO ALERT", () => {
  const { c, item, setBookings } = createR1bFixture();
  setBookings([{
    id: "b1",
    caseId: item.id,
    type: "work",
    title: "Tôlerie lourde",
    status: "started",
    actualStart: "2026-09-07T07:45:00",
    start: "2026-09-07T07:45:00",
    end: "2026-09-07T15:00:00",
    segments: [{ start: "2026-09-07T07:45:00", end: "2026-09-07T15:00:00" }],
    resourceIds: ["tech-team1"],
  }]);

  const exceptions = c.getOperationalExceptions(item, D("2026-09-07T14:30:00"));
  assert.equal(exceptions.some((e) => e.code === "task_finish_late"), false);
  assert.equal(exceptions.some((e) => e.code === "stale"), false, "Legitimate long task must NOT trigger stale");
});

test("S6: Friday finish 12:30 evaluated across closure and tolerance window -> NO ALERT until threshold", () => {
  const { c, item, setBookings } = createR1bFixture();
  setBookings([{
    id: "b1",
    caseId: item.id,
    type: "work",
    title: "Préparation",
    status: "started",
    actualStart: "2026-09-11T09:00:00",
    start: "2026-09-11T09:00:00",
    end: "2026-09-11T12:30:00",
    segments: [{ start: "2026-09-11T09:00:00", end: "2026-09-11T12:30:00" }],
    resourceIds: ["tech-team1"],
  }]);

  // Evaluated at planned finish 12:30 -> NO alert
  assert.equal(c.getOperationalExceptions(item, D("2026-09-11T12:30:00")).some((e) => e.code === "task_finish_late"), false);
  // Evaluated during closure at 13:00 -> NO alert
  assert.equal(c.getOperationalExceptions(item, D("2026-09-11T13:00:00")).some((e) => e.code === "task_finish_late"), false);
  // Evaluated 1 minute before resumption at 13:44 -> NO alert
  assert.equal(c.getOperationalExceptions(item, D("2026-09-11T13:44:00")).some((e) => e.code === "task_finish_late"), false);
  // Evaluated at resumption 13:45 -> NO alert
  assert.equal(c.getOperationalExceptions(item, D("2026-09-11T13:45:00")).some((e) => e.code === "task_finish_late"), false);
  // Evaluated at 14:14 -> NO alert (29 working minutes elapsed)
  assert.equal(c.getOperationalExceptions(item, D("2026-09-11T14:14:00")).some((e) => e.code === "task_finish_late"), false);
  // Evaluated at exact 14:15:00 threshold -> NO alert (strict boundary: 30 working minutes)
  assert.equal(c.getOperationalExceptions(item, D("2026-09-11T14:15:00")).some((e) => e.code === "task_finish_late"), false);
});

test("S7: Friday finish 12:30 evaluated at 14:16 -> FIN DE TÂCHE EN RETARD", () => {
  const { c, item, setBookings } = createR1bFixture();
  setBookings([{
    id: "b1",
    caseId: item.id,
    type: "work",
    title: "Préparation",
    status: "started",
    actualStart: "2026-09-11T09:00:00",
    start: "2026-09-11T09:00:00",
    end: "2026-09-11T12:30:00",
    segments: [{ start: "2026-09-11T09:00:00", end: "2026-09-11T12:30:00" }],
    resourceIds: ["tech-team1"],
  }]);

  // At 14:16:00 -> past 14:15 threshold -> FIN DE TÂCHE EN RETARD
  const pastThreshold = c.getOperationalExceptions(item, D("2026-09-11T14:16:00"));
  const finishLate = pastThreshold.find((e) => e.code === "task_finish_late");
  assert.ok(finishLate, "Alert must fire after 30 working minutes");
  assert.match(finishLate.label, /Fin de tâche en retard : Préparation/);
});

test("S7-bis: Friday late-start tolerance across common closure (12:20 planned start -> 14:05 threshold)", () => {
  const { c, item, setBookings } = createR1bFixture();
  setBookings([{
    id: "b-start-fri",
    caseId: item.id,
    type: "work",
    title: "Mécanique vendredi",
    status: "planned",
    start: "2026-09-11T12:20:00",
    end: "2026-09-11T15:00:00",
    segments: [{ start: "2026-09-11T12:20:00", end: "2026-09-11T15:00:00" }],
    resourceIds: ["tech-team1"],
  }]);

  // 12:25 (5 working minutes) -> NO alert
  assert.equal(c.getOperationalExceptions(item, D("2026-09-11T12:25:00")).some((e) => e.code === "task_start_late"), false);
  // 12:30 (10 working minutes, start of closure) -> NO alert
  assert.equal(c.getOperationalExceptions(item, D("2026-09-11T12:30:00")).some((e) => e.code === "task_start_late"), false);
  // 13:00 (during closure) -> NO alert
  assert.equal(c.getOperationalExceptions(item, D("2026-09-11T13:00:00")).some((e) => e.code === "task_start_late"), false);
  // 13:44 (during closure) -> NO alert
  assert.equal(c.getOperationalExceptions(item, D("2026-09-11T13:44:00")).some((e) => e.code === "task_start_late"), false);
  // 13:45 (resumption, 10 working minutes elapsed) -> NO alert
  assert.equal(c.getOperationalExceptions(item, D("2026-09-11T13:45:00")).some((e) => e.code === "task_start_late"), false);
  // 14:04 (29 working minutes elapsed) -> NO alert
  assert.equal(c.getOperationalExceptions(item, D("2026-09-11T14:04:00")).some((e) => e.code === "task_start_late"), false);
  // 14:05 (exact 30 working minutes threshold) -> NO alert
  assert.equal(c.getOperationalExceptions(item, D("2026-09-11T14:05:00")).some((e) => e.code === "task_start_late"), false);
  // 14:06 (31 working minutes elapsed) -> DÉMARRAGE EN RETARD
  const pastThreshold = c.getOperationalExceptions(item, D("2026-09-11T14:06:00"));
  const startLate = pastThreshold.find((e) => e.code === "task_start_late");
  assert.ok(startLate, "DÉMARRAGE EN RETARD must fire after 30 working minutes");
  assert.match(startLate.label, /Démarrage en retard : Mécanique vendredi/);
});

test("S8-fri: Team 1 Friday 16:00 finish -> Saturday 08:30 threshold", () => {
  const { c, item, run, setBookings } = createR1bFixture();
  const techTeam1 = run("state.resources.find(r => r.id === 'tech-team1')");

  // Verify helper directly: 16:00 + 30 working minutes -> Saturday 08:30
  const helperResult = c.addResourceWorkingMinutes(techTeam1, D("2026-09-11T16:00:00"), 30);
  assert.equal(helperResult.getTime(), D("2026-09-12T08:30:00").getTime(), "Team 1 tolerance must resume Saturday at 08:00");

  setBookings([{
    id: "b-fri-team1",
    caseId: item.id,
    type: "work",
    title: "Tôlerie vendredi",
    status: "started",
    actualStart: "2026-09-11T14:00:00",
    start: "2026-09-11T14:00:00",
    end: "2026-09-11T16:00:00",
    segments: [{ start: "2026-09-11T14:00:00", end: "2026-09-11T16:00:00" }],
    resourceIds: ["tech-team1"],
  }]);

  // Friday 16:30 -> Team 1 shift ended at 16:00, Team 2 still working (16:00-17:00). Team 2 hours must NOT consume Team 1 tolerance.
  assert.equal(c.getOperationalExceptions(item, D("2026-09-11T16:30:00")).some((e) => e.code === "task_finish_late"), false);
  // Friday 17:00 -> Workshop closes
  assert.equal(c.getOperationalExceptions(item, D("2026-09-11T17:00:00")).some((e) => e.code === "task_finish_late"), false);
  // Saturday 08:15 -> 15 working minutes of Team 1
  assert.equal(c.getOperationalExceptions(item, D("2026-09-12T08:15:00")).some((e) => e.code === "task_finish_late"), false);
  // Saturday 08:30 -> exact 30 working minutes of Team 1
  assert.equal(c.getOperationalExceptions(item, D("2026-09-12T08:30:00")).some((e) => e.code === "task_finish_late"), false);
  // Saturday 08:31 -> past 30 working minutes
  const sat0831 = c.getOperationalExceptions(item, D("2026-09-12T08:31:00"));
  const finishLate = sat0831.find((e) => e.code === "task_finish_late");
  assert.ok(finishLate, "Fires Saturday after Team 1's 30 working minutes");
  assert.match(finishLate.label, /Fin de tâche en retard : Tôlerie vendredi/);
});

test("S8: Team 1 Monday finish 15:00 -> No alert Mon 15:30; fires Tue 08:16", () => {
  const { c, item, setBookings } = createR1bFixture();
  setBookings([{
    id: "b1",
    caseId: item.id,
    type: "work",
    title: "Tôlerie",
    status: "started",
    actualStart: "2026-09-07T08:00:00",
    start: "2026-09-07T08:00:00",
    end: "2026-09-07T15:00:00",
    segments: [{ start: "2026-09-07T08:00:00", end: "2026-09-07T15:00:00" }],
    resourceIds: ["tech-team1"],
  }]);

  // Monday 15:30 -> Team 1 shift ended at 15:00, Team 2 still working
  const mon1530 = c.getOperationalExceptions(item, D("2026-09-07T15:30:00"));
  assert.equal(mon1530.some((e) => e.code === "task_finish_late"), false, "Team 2 working hours must NOT consume Team 1 tolerance");

  // Tuesday 08:15 -> exactly 30 working minutes of Team 1
  const tue0815 = c.getOperationalExceptions(item, D("2026-09-08T08:15:00"));
  assert.equal(tue0815.some((e) => e.code === "task_finish_late"), false, "Exact boundary on Tuesday morning");

  // Tuesday 08:16 -> exceeds 30 working minutes of Team 1
  const tue0816 = c.getOperationalExceptions(item, D("2026-09-08T08:16:00"));
  assert.ok(tue0816.some((e) => e.code === "task_finish_late"), "Fires Tuesday after Team 1's 30 working minutes");
});

test("S9: No usable planning + 24 workshop-open hours without activity -> SANS ÉVOLUTION ATELIER", () => {
  // Vehicle received Monday 2026-09-07 at 07:45.
  // Mon: 07:45-17:00 = 9h15m (9.25h)
  // Tue: 07:45-17:00 = 9h15m (cumulative 18.5h)
  // Wed: 07:45-13:15 = 5h30m (cumulative 24.0h reached at Wed 13:15)
  const { c, item, setBookings } = createR1bFixture({ receivedAt: "2026-09-07T07:45:00" });
  setBookings([]);

  // Wednesday at 13:14 -> 23.98 open hours
  const before24 = c.getOperationalExceptions(item, D("2026-09-09T13:14:00"));
  assert.equal(before24.some((e) => e.code === "stale"), false, "Under 24 open hours -> no stale alert");

  // Wednesday at 13:15 -> exactly 24.0 open hours
  const at24 = c.getOperationalExceptions(item, D("2026-09-09T13:15:00"));
  assert.ok(at24.some((e) => e.code === "stale"), "24 open hours reached -> SANS ÉVOLUTION ATELIER");
});

test("S10: Finish late + stale eligible -> finish-late only, generic stale suppressed", () => {
  const { c, item, setBookings } = createR1bFixture();
  setBookings([{
    id: "b1",
    caseId: item.id,
    type: "work",
    title: "Châssis",
    status: "started",
    actualStart: "2026-09-07T08:00:00",
    start: "2026-09-07T08:00:00",
    end: "2026-09-07T12:00:00",
    segments: [{ start: "2026-09-07T08:00:00", end: "2026-09-07T12:00:00" }],
    resourceIds: ["tech-generic"],
  }]);

  const exceptions = c.getOperationalExceptions(item, D("2026-09-10T10:00:00"));
  assert.ok(exceptions.some((e) => e.code === "task_finish_late"), "Specific finish late must be emitted");
  assert.equal(exceptions.some((e) => e.code === "stale"), false, "Duplicate generic stale must be suppressed");
});

test("S11: Holiday inside tolerance period -> holiday minutes excluded", () => {
  const { c, item, setBookings } = createR1bFixture({
    holidays: [{ date: "2026-09-08", name: "Jour férié" }],
  });
  setBookings([{
    id: "b1",
    caseId: item.id,
    type: "work",
    title: "Finition",
    status: "started",
    actualStart: "2026-09-07T08:00:00",
    start: "2026-09-07T08:00:00",
    end: "2026-09-07T15:00:00",
    segments: [{ start: "2026-09-07T08:00:00", end: "2026-09-07T15:00:00" }],
    resourceIds: ["tech-team1"],
  }]);

  // On Tuesday (holiday) -> no alert
  const onHoliday = c.getOperationalExceptions(item, D("2026-09-08T10:00:00"));
  assert.equal(onHoliday.some((e) => e.code === "task_finish_late"), false);

  // Wednesday 08:14 -> under 30 working min
  const wed0814 = c.getOperationalExceptions(item, D("2026-09-09T08:14:00"));
  assert.equal(wed0814.some((e) => e.code === "task_finish_late"), false);

  // Wednesday 08:16 -> over 30 working min
  const wed0816 = c.getOperationalExceptions(item, D("2026-09-09T08:16:00"));
  assert.ok(wed0816.some((e) => e.code === "task_finish_late"), "Fires Wednesday after holiday");
});

test("S12: Approved resource leave triggers absence exception, not misleading task delay", () => {
  const { c, item, setBookings } = createR1bFixture();
  setBookings([
    {
      id: "leave-1",
      caseId: "__leave__",
      type: "leave",
      start: "2026-09-07T08:00:00",
      end: "2026-09-07T17:00:00",
      resourceIds: ["tech-team1"],
    },
    {
      id: "b1",
      caseId: item.id,
      type: "work",
      title: "Diagnostic",
      status: "planned",
      start: "2026-09-07T09:00:00",
      end: "2026-09-07T11:00:00",
      segments: [{ start: "2026-09-07T09:00:00", end: "2026-09-07T11:00:00" }],
      resourceIds: ["tech-team1"],
    }
  ]);

  const exceptions = c.getOperationalExceptions(item, D("2026-09-07T10:00:00"));
  assert.ok(exceptions.some((e) => e.code === "absence"), "Technicien absent must fire");
});

test("S13: Task completed before planned end -> NO ALERT", () => {
  const { c, item, setBookings } = createR1bFixture();
  setBookings([{
    id: "b1",
    caseId: item.id,
    type: "work",
    title: "Vidange",
    status: "completed",
    actualStart: "2026-09-07T08:00:00",
    actualEnd: "2026-09-07T09:30:00",
    completedAt: "2026-09-07T09:30:00",
    start: "2026-09-07T08:00:00",
    end: "2026-09-07T11:00:00",
    segments: [{ start: "2026-09-07T08:00:00", end: "2026-09-07T11:00:00" }],
    resourceIds: ["tech-generic"],
  }]);

  const exceptions = c.getOperationalExceptions(item, D("2026-09-07T12:00:00"));
  assert.equal(exceptions.some((e) => e.code === "task_finish_late"), false);
  assert.equal(exceptions.some((e) => e.code === "task_start_late"), false);
});

test("S14: Cancelled booking does not generate delay alerts", () => {
  const { c, item, setBookings } = createR1bFixture();
  setBookings([{
    id: "b1",
    caseId: item.id,
    type: "work",
    title: "Ancienne tâche",
    status: "cancelled",
    cancelledAt: "2026-09-07T07:00:00",
    start: "2026-09-07T08:00:00",
    end: "2026-09-07T10:00:00",
    segments: [{ start: "2026-09-07T08:00:00", end: "2026-09-07T10:00:00" }],
    resourceIds: ["tech-generic"],
  }]);

  const exceptions = c.getOperationalExceptions(item, D("2026-09-07T11:00:00"));
  assert.equal(exceptions.some((e) => e.code === "task_finish_late"), false);
  assert.equal(exceptions.some((e) => e.code === "task_start_late"), false);
});
