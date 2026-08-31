import assert from "node:assert/strict";
import fs from "node:fs";
import { performance } from "node:perf_hooks";
import { createNimrVmContext } from "./helpers/nimr_vm_context.mjs";

const appSource = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
const indexSource = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const stateSource = fs.readFileSync(new URL("../js/state.js", import.meta.url), "utf8");
const uiCasesSource = fs.readFileSync(new URL("../js/ui-cases.js", import.meta.url), "utf8");
const versionSource = fs.readFileSync(new URL("../js/version.js", import.meta.url), "utf8");
const estimateImportSource = fs.readFileSync(new URL("../js/estimate-import.js", import.meta.url), "utf8");
const offlineSource = fs.readFileSync(new URL("../offline.html", import.meta.url), "utf8");
const styleSource = fs.readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const swSource = fs.readFileSync(new URL("../sw.js", import.meta.url), "utf8");

const results = [];

function check(name, callback) {
  callback();
  results.push(name);
  console.log("PASS " + name);
}

function createDashboardContext(filename) {
  return createNimrVmContext({ filename });
}

check("A Exact v23.3.17 release and cache contract", () => {
  assert.match(versionSource, /^window\.APP_VERSION = "v23\.3\.17";$/mu);
  assert.match(versionSource, /^window\.NIMR_BUILD = "v23\.3\.17";$/mu);
  assert.match(versionSource, /^window\.NIMR_CACHE_NAME = "nimr-sav-v23\.3\.17";$/mu);
  assert.match(stateSource, /^const APP_VERSION = "v23\.3\.17";$/mu);
  assert.match(swSource, /^const CACHE_NAME = "nimr-sav-v23\.3\.17";$/mu);
  assert.match(appSource, /pdf\.worker\.min\.js\?v=23\.3\.17/u);
  assert.match(appSource, /sw\.js\?v=23\.3\.17/u);
  assert.match(indexSource, /styles\.css\?v=23\.3\.17/u);
  assert.match(indexSource, /app\.js\?v=23\.3\.17/u);
  assert.match(offlineSource, /styles\.css\?v=23\.3\.17/u);
  assert.match(estimateImportSource, /pdf\.worker\.min\.js\?v=23\.3\.17/u);
  assert.match(stateSource, /^const CURRENT_DATA_SCHEMA_VERSION = 2;$/mu);
  assert.match(stateSource, /^const CANONICAL_TASK_MODEL_VERSION = 1;$/mu);
  assert.match(stateSource, /^const DB_VERSION = 2;$/mu);
});

check("B Director pilotage hierarchy is present once", () => {
  assert.equal((indexSource.match(/id="pilotage-priority-heading"/gu) || []).length, 1);
  assert.equal((indexSource.match(/id="pilotage-alerts"/gu) || []).length, 1);
  assert.equal((indexSource.match(/id="sav-kpi-grid"/gu) || []).length, 1);
  assert.equal((indexSource.match(/id="sav-dashboard-load-grid"/gu) || []).length, 1);
  assert.equal((indexSource.match(/id="pilotage-today-summary"/gu) || []).length, 1);
  assert.equal((indexSource.match(/id="pilotage-case-funnel"/gu) || []).length, 1);
  assert.equal((indexSource.match(/id="view-pilotage"/gu) || []).length, 1);
});

check("C Dashboard visibility remains permission-driven", () => {
  const { context, run } = createDashboardContext("ux007-permissions.js");
  run(`state = normalizeState({
    users: [
      { id: "director", name: "Direction", role: "directeur", active: true },
      { id: "admin", name: "Admin", role: "admin_technique", active: true },
      { id: "reader", name: "Lecture", role: "lecture_seule", active: true },
      { id: "reception", name: "Réception", role: "reception", active: true }
    ],
    currentUserId: "director",
    cases: [],
    bookings: []
  })`);
  assert.equal(context.hasPermission("dashboard.view"), true);
  assert.equal(context.canAccessTab("pilotage"), true);
  run('state.currentUserId = "admin"');
  assert.equal(context.hasPermission("dashboard.view"), true);
  run('state.currentUserId = "reader"');
  assert.equal(context.hasPermission("dashboard.view"), true);
  run('state.currentUserId = "reception"');
  assert.equal(context.hasPermission("dashboard.view"), false);
  assert.match(uiCasesSource, /hasPermission\("dashboard\.view"\)/u);
});

check("D Canonical delivery, QC and today signals are exact", () => {
  const { context, run } = createDashboardContext("ux007-canonical-signals.js");
  run(`state = normalizeState({
    users: [{ id: "director", name: "Direction", role: "directeur", active: true }],
    currentUserId: "director",
    ui: { savDashboardPeriod: "today", savDashboardTypeFilter: "all", savDashboardStatusFilter: "all" },
    cases: [
      {
        id: "revised-future",
        createdAt: "2026-08-31T06:00:00.000Z",
        initialEstimatedDelivery: "2026-08-30T08:00:00.000Z",
        revisedEstimatedDelivery: "2026-09-02T08:00:00.000Z",
        flags: { received: true, workStarted: true }
      },
      {
        id: "revised-overdue",
        createdAt: "2026-08-31T06:10:00.000Z",
        initialEstimatedDelivery: "2026-09-03T08:00:00.000Z",
        revisedEstimatedDelivery: "2026-08-30T09:00:00.000Z",
        flags: { received: true, workStarted: true }
      },
      {
        id: "no-due-date",
        createdAt: "2026-08-31T06:20:00.000Z",
        flags: { received: true, workStarted: true }
      },
      {
        id: "canonical-qc-rework",
        createdAt: "2026-08-31T06:30:00.000Z",
        flags: { received: true, workStarted: true, workCompleted: true },
        receptionWorkflow: { qualityStatus: "rework", qualityReturnReason: "Retouche canonique" }
      },
      {
        id: "updated-only-start",
        createdAt: "2026-08-20T06:00:00.000Z",
        updatedAt: "2026-08-31T09:00:00.000Z",
        flags: { received: true, workStarted: true }
      },
      {
        id: "updated-only-complete",
        createdAt: "2026-08-20T06:10:00.000Z",
        updatedAt: "2026-08-31T09:10:00.000Z",
        flags: { received: true, workStarted: true, workCompleted: true }
      },
      {
        id: "canonical-start",
        createdAt: "2026-08-20T06:20:00.000Z",
        updatedAt: "2026-08-20T07:00:00.000Z",
        actualRepairStart: "2026-08-31T08:00:00.000Z",
        flags: { received: true, workStarted: true }
      },
      {
        id: "canonical-complete",
        createdAt: "2026-08-20T06:30:00.000Z",
        updatedAt: "2026-08-20T07:10:00.000Z",
        actualRepairEnd: "2026-08-31T08:30:00.000Z",
        flags: { received: true, workStarted: true, workCompleted: true }
      }
    ],
    bookings: []
  })`);
  const snapshot = context.buildDirectorDashboardSnapshot(undefined, new Date("2026-08-31T12:00:00.000Z"));
  const deliveryAlerts = snapshot.priorities.filter((alert) => alert.title === "Date de livraison dépassée");

  assert.equal(snapshot.metrics.overdueCases, 1, "Only the revised overdue deadline is late");
  assert.equal(deliveryAlerts.some((alert) => alert.caseId === "revised-future"), false, "Revised future deadline overrides an old initial deadline");
  assert.equal(deliveryAlerts.some((alert) => alert.caseId === "revised-overdue"), true, "Revised overdue deadline overrides a future initial deadline");
  assert.equal(deliveryAlerts.some((alert) => alert.caseId === "no-due-date"), false, "No deadline cannot create a delivery alert");
  assert.equal(snapshot.metrics.qcReworkCases, 1, "Canonical reception workflow rework is counted");
  assert.equal(snapshot.todaySummary.startingToday, 1, "Only canonical actual start is counted today");
  assert.equal(snapshot.todaySummary.completingToday, 1, "Only canonical actual end is counted today");
  const updatedOnlyStart = run('state.cases.find((item) => item.id === "updated-only-start")');
  const updatedOnlyComplete = run('state.cases.find((item) => item.id === "updated-only-complete")');
  assert.equal(context.getDirectorCaseWorkStartedAt(updatedOnlyStart, []), null, "updatedAt alone is not a start timestamp");
  assert.equal(context.getDirectorCaseWorkCompletedAt(updatedOnlyComplete, []), null, "updatedAt alone is not a completion timestamp");

  const kpisWithOtherBlockers = context.buildSavKpis({
    metrics: { activeCases: 4, waitingPartsCases: 0, blockedCases: 3 },
    range: { shortLabel: "Aujourd'hui" }
  });
  const waitingPartsZero = kpisWithOtherBlockers.find((kpi) => kpi.label === "Attente pièces");
  assert.equal(waitingPartsZero.value, "0", "Non-parts blockers must not increase the waiting-parts KPI");
  assert.equal(waitingPartsZero.level, "success");

  const kpisWithWaitingParts = context.buildSavKpis({
    metrics: { activeCases: 4, waitingPartsCases: 2, blockedCases: 0 },
    range: { shortLabel: "7 jours" }
  });
  const waitingPartsTwo = kpisWithWaitingParts.find((kpi) => kpi.label === "Attente pièces");
  assert.equal(waitingPartsTwo.value, "2");
  assert.equal(waitingPartsTwo.level, "danger");

  for (const shortLabel of ["Aujourd'hui", "7 jours", "30 jours"]) {
    const activeCaseKpi = context.buildSavKpis({
      metrics: { activeCases: 4, waitingPartsCases: 0, blockedCases: 0 },
      range: { shortLabel }
    }).find((kpi) => kpi.label === "Dossiers actifs");
    assert.doesNotMatch(activeCaseKpi.detail, /Aujourd'hui|7 jours|30 jours/u);
    assert.match(activeCaseKpi.detail, /actuellement|en cours/iu);
  }
});

check("E One actual dashboard refresh uses one snapshot and one reference now", () => {
  const { context, run } = createDashboardContext("ux007-single-snapshot.js");
  run(`
    __NativeDate = Date;
    __referenceNowCount = 0;
    Date = class extends __NativeDate {
      constructor(...args) {
        super(...args);
        if (args.length === 0) __referenceNowCount += 1;
      }
    };
    __snapshotBuildCount = 0;
    __snapshot = {
      metrics: {},
      range: { shortLabel: "Aujourd'hui" },
      serviceLoads: [],
      priorities: [],
      todaySummary: {},
      funnel: {}
    };
    __snapshotReferences = [];
    buildSavPerformanceDashboard = (now) => {
      __snapshotBuildCount += 1;
      __receivedNow = now;
      return __snapshot;
    };
    renderSavKpis = (snapshot) => __snapshotReferences.push(snapshot);
    renderSavDashboardLoads = (snapshot) => __snapshotReferences.push(snapshot);
    renderPilotageAlerts = (snapshot) => __snapshotReferences.push(snapshot);
    renderPilotageTodaySummary = (snapshot) => __snapshotReferences.push(snapshot);
    renderPilotageCaseFunnel = (snapshot) => __snapshotReferences.push(snapshot);
    __renderResult = renderDirectorDashboard();
  `);

  assert.equal(context.__snapshotBuildCount, 1);
  assert.equal(context.__referenceNowCount, 1);
  assert.equal(context.__snapshotReferences.length, 5);
  assert.equal(context.__snapshotReferences.every((snapshot) => snapshot === context.__snapshot), true);
  assert.equal(context.__renderResult, context.__snapshot);
  assert.equal(context.__receivedNow instanceof context.__NativeDate, true);
  assert.match(uiCasesSource, /function renderDirectorDashboard\(now = new Date\(\)\)\s*\{\s*const snapshot = buildSavPerformanceDashboard\(now\);[\s\S]*?renderSavKpis\(snapshot\);[\s\S]*?renderSavDashboardLoads\(snapshot\);[\s\S]*?renderPilotageAlerts\(snapshot\);[\s\S]*?renderPilotageTodaySummary\(snapshot\);[\s\S]*?renderPilotageCaseFunnel\(snapshot\);/u);
  const filterHandler = uiCasesSource.match(/control\.addEventListener\("change", \(\) => \{\s*state\.ui\[key\][\s\S]*?renderMetrics\(snapshot\);\s*\}\);/u)?.[0] || "";
  assert.match(filterHandler, /renderDirectorDashboard\(\);/u);
  assert.doesNotMatch(filterHandler, /renderSavKpis\(|renderSavDashboardLoads\(|renderPilotageAlerts\(/u);

  console.log("ONE_DASHBOARD_RENDER_SNAPSHOT_COUNT = 1");
  console.log("ONE_DASHBOARD_RENDER_REFERENCE_NOW_COUNT = 1");
});

check("F Priority ordering is deterministic", () => {
  const { context, run } = createDashboardContext("ux007-priority-order.js");
  run(`state = normalizeState({
    users: [{ id: "director", name: "Direction", role: "directeur", active: true }],
    currentUserId: "director",
    ui: { savDashboardPeriod: "today", savDashboardTypeFilter: "all", savDashboardStatusFilter: "all" },
    cases: [
      {
        id: "medium",
        createdAt: "2026-08-31T06:00:00.000Z",
        flags: { received: true }
      },
      {
        id: "high",
        createdAt: "2026-08-31T06:10:00.000Z",
        partsStatus: "waiting_parts",
        blockerReason: "waiting_parts",
        flags: { received: true, workStarted: true }
      },
      {
        id: "critical",
        createdAt: "2026-08-31T06:20:00.000Z",
        revisedEstimatedDelivery: "2026-08-29T08:00:00.000Z",
        flags: { received: true, workStarted: true }
      }
    ],
    bookings: []
  })`);
  const priorities = context.buildDirectorDashboardSnapshot(undefined, new Date("2026-08-31T12:00:00.000Z")).priorities;
  const rank = { critical: 0, high: 1, medium: 2 };
  for (let index = 1; index < priorities.length; index += 1) {
    assert.ok(rank[priorities[index - 1].severity] <= rank[priorities[index].severity]);
  }
  assert.equal(priorities[0].severity, "critical");
  assert.ok(priorities.some((alert) => alert.severity === "high"));
  assert.ok(priorities.some((alert) => alert.severity === "medium"));
});

check("G False QC, time and planning signals are rejected", () => {
  const { context, run } = createDashboardContext("ux007-false-signals.js");
  run(`state = normalizeState({
    users: [{ id: "director", name: "Direction", role: "directeur", active: true }],
    currentUserId: "director",
    ui: { savDashboardPeriod: "today", savDashboardTypeFilter: "all", savDashboardStatusFilter: "all" },
    resources: [{ id: "tech-1", name: "Technicien", role: "tolier", active: true }],
    cases: [
      {
        id: "qc-not-started",
        createdAt: "2026-08-30T06:00:00.000Z",
        flags: { received: true, workStarted: true },
        receptionWorkflow: { qualityStatus: "not_started" }
      },
      {
        id: "old-received-no-booking",
        createdAt: "2026-08-29T06:00:00.000Z",
        flags: { received: true },
        receptionWorkflow: { vehicleReceivedAt: "2026-08-29T07:00:00.000Z" }
      },
      {
        id: "historical-completed-only",
        createdAt: "2026-08-29T06:10:00.000Z",
        flags: { received: true },
        receptionWorkflow: { vehicleReceivedAt: "2026-08-29T07:10:00.000Z" }
      },
      {
        id: "overdue-canonical-start",
        createdAt: "2026-08-31T06:20:00.000Z",
        flags: { received: true },
        receptionWorkflow: { vehicleReceivedAt: "2026-08-31T07:00:00.000Z" }
      },
      {
        id: "future-canonical-start",
        createdAt: "2026-08-31T06:30:00.000Z",
        flags: { received: true },
        receptionWorkflow: { vehicleReceivedAt: "2026-08-31T07:10:00.000Z" }
      },
      {
        id: "no-delivery-deadline",
        createdAt: "2026-08-20T06:40:00.000Z",
        flags: { received: true, workStarted: true }
      }
    ],
    bookings: [
      {
        id: "old-completed",
        caseId: "historical-completed-only",
        type: "work",
        status: "completed",
        start: "2026-08-20T08:00:00.000Z",
        end: "2026-08-20T10:00:00.000Z",
        actualStart: "2026-08-20T08:00:00.000Z",
        actualEnd: "2026-08-20T10:00:00.000Z",
        resourceIds: ["tech-1"],
        segments: [{ start: "2026-08-20T08:00:00.000Z", end: "2026-08-20T10:00:00.000Z" }]
      },
      {
        id: "overdue-planned",
        caseId: "overdue-canonical-start",
        type: "work",
        status: "planned",
        start: "2026-08-31T08:00:00.000Z",
        end: "2026-08-31T10:00:00.000Z",
        resourceIds: ["tech-1"],
        segments: [{ start: "2026-08-31T08:00:00.000Z", end: "2026-08-31T10:00:00.000Z" }]
      },
      {
        id: "future-planned",
        caseId: "future-canonical-start",
        type: "work",
        status: "planned",
        start: "2026-09-01T08:00:00.000Z",
        end: "2026-09-01T10:00:00.000Z",
        resourceIds: ["tech-1"],
        segments: [{ start: "2026-09-01T08:00:00.000Z", end: "2026-09-01T10:00:00.000Z" }]
      }
    ]
  });
  state.cases.find((item) => item.id === "qc-not-started").flags.qualityReturnReason = "Legacy reason only";`);

  const snapshot = context.buildDirectorDashboardSnapshot(undefined, new Date("2026-08-31T12:00:00.000Z"));
  const findAlert = (caseId, title) => snapshot.priorities.find((alert) => alert.caseId === caseId && alert.title === title);

  assert.equal(snapshot.metrics.qcReworkCases, 0);
  assert.equal(snapshot.priorities.some((alert) => alert.caseId === "qc-not-started" && /qualité rejeté|rework/iu.test(alert.title)), false);
  assert.equal(findAlert("old-received-no-booking", "Véhicule reçu sans planning")?.severity, "medium");
  assert.equal(findAlert("old-received-no-booking", "Démarrage atelier planifié en retard"), undefined, "Age alone must not produce HIGH");
  assert.equal(findAlert("historical-completed-only", "Véhicule reçu sans planning")?.severity, "medium");
  assert.equal(findAlert("overdue-canonical-start", "Démarrage atelier planifié en retard")?.severity, "high");
  assert.equal(findAlert("future-canonical-start", "Véhicule reçu sans planning"), undefined);
  assert.equal(findAlert("future-canonical-start", "Démarrage atelier planifié en retard"), undefined);
  assert.equal(snapshot.priorities.some((alert) => alert.caseId === "no-delivery-deadline" && alert.title === "Date de livraison dépassée"), false);
  assert.doesNotMatch(uiCasesSource, /caseBookings\.length\s*===\s*0/u);
  assert.doesNotMatch(uiCasesSource, /receivedAt[\s\S]{0,160}(?:4\s*\*\s*60|ageHours\s*>=\s*4)/u);
  assert.doesNotMatch(uiCasesSource, /flags\?*\.qualityReturnReason/u);
});

check("H Navigation assertions match real implemented behavior", () => {
  const { context, run } = createDashboardContext("ux007-navigation.js");
  run(`
    __activeTabs = [];
    __caseListRenders = 0;
    __caseDetailRenders = 0;
    __focusCount = 0;
    __scrollCount = 0;
    __caseDetailElement = {
      setAttribute(name, value) { __detailTabIndex = name + ":" + value; },
      scrollIntoView() { __scrollCount += 1; },
      focus() { __focusCount += 1; }
    };
    document.querySelector = (selector) => selector === "#case-detail" ? __caseDetailElement : null;
    setActiveTab = (tab) => __activeTabs.push(tab);
    renderCases = () => { __caseListRenders += 1; };
    renderCaseDetail = () => { __caseDetailRenders += 1; };
    activeCaseId = null;
    __navigationResult = openDirectorDashboardCase("case-focus");
  `);

  assert.equal(context.__navigationResult, true);
  assert.deepEqual(Array.from(context.__activeTabs), ["dossiers"]);
  assert.equal(run("activeCaseId"), "case-focus");
  assert.equal(context.__caseListRenders, 1);
  assert.equal(context.__caseDetailRenders, 1);
  assert.equal(context.__detailTabIndex, "tabindex:-1");
  assert.equal(context.__scrollCount, 1);
  assert.equal(context.__focusCount, 1);
  assert.doesNotMatch(uiCasesSource, /ctaAction:\s*"planning"/u, "No false Planning focus claim");
  assert.match(uiCasesSource, /const caseId = button\.dataset\.navCase;\s*if \(caseId\) openDirectorDashboardCase\(caseId\);/u);

  const kpis = context.buildSavKpis({
    metrics: { waitingPartsCases: 2, qcReworkCases: 1 },
    range: { shortLabel: "Aujourd'hui" }
  });
  const waitingPartsKpi = kpis.find((item) => item.label === "Attente pièces");
  const qcKpi = kpis.find((item) => item.label === "Retouches atelier");
  assert.equal(waitingPartsKpi.navTab, "dossiers");
  assert.equal(qcKpi.navTab, "dossiers");
  assert.doesNotMatch(waitingPartsKpi.detail, /filtr/iu);
  assert.doesNotMatch(qcKpi.detail, /filtr/iu);
});

check("I Dashboard does not mutate state or add business fields", () => {
  const { context, run } = createDashboardContext("ux007-state-safety.js");
  run(`state = normalizeState({
    users: [{ id: "director", name: "Direction", role: "directeur", active: true }],
    currentUserId: "director",
    ui: { savDashboardPeriod: "today", savDashboardTypeFilter: "all", savDashboardStatusFilter: "all" },
    cases: [{
      id: "immutable-case",
      createdAt: "2026-08-31T06:00:00.000Z",
      initialEstimatedDelivery: "2026-09-02T08:00:00.000Z",
      revisedEstimatedDelivery: "2026-09-03T08:00:00.000Z",
      flags: { received: true }
    }],
    bookings: []
  });
  __stateBeforeDashboard = JSON.stringify(state);
  buildDirectorDashboardSnapshot(state, new Date("2026-08-31T12:00:00.000Z"));
  buildSavPerformanceDashboard(new Date("2026-08-31T12:00:00.000Z"));
  __stateAfterDashboard = JSON.stringify(state);`);

  assert.equal(context.__stateAfterDashboard, context.__stateBeforeDashboard);
  assert.doesNotMatch(stateSource, /\bpromisedDeliveryDate\b/u);
  assert.doesNotMatch(stateSource, /\brevisedDeliveryDate\b/u);
  assert.doesNotMatch(uiCasesSource, /\bpromisedDeliveryDate\b/u);
  assert.doesNotMatch(uiCasesSource, /\brevisedDeliveryDate\b/u);
  const completeLoginBody = appSource.match(/function completeUserLogin\(targetUser\)[\s\S]*?let userSessionIdleTimer/u)?.[0] || "";
  assert.doesNotMatch(completeLoginBody, /startupTab|setActiveTab\(/u, "UX-007 must not alter login startup navigation");
});

check("J Aggregate construction remains bounded", () => {
  const { context, run } = createDashboardContext("ux007-bounded-aggregate.js");
  run(`
    __largeCases = Array.from({ length: 500 }, (_, index) => ({
      id: "perf-case-" + index,
      createdAt: "2026-08-31T06:00:00.000Z",
      flags: { received: true, workStarted: index % 3 !== 0 },
      receptionWorkflow: { vehicleReceivedAt: "2026-08-31T07:00:00.000Z" }
    }));
    __largeBookings = Array.from({ length: 1000 }, (_, index) => ({
      id: "perf-booking-" + index,
      caseId: "perf-case-" + (index % 500),
      type: "work",
      status: "planned",
      start: "2026-09-01T08:00:00.000Z",
      end: "2026-09-01T09:00:00.000Z",
      resourceIds: ["perf-resource"],
      segments: [{ start: "2026-09-01T08:00:00.000Z", end: "2026-09-01T09:00:00.000Z" }]
    }));
    state = normalizeState({
      users: [{ id: "director", name: "Direction", role: "directeur", active: true }],
      currentUserId: "director",
      ui: { savDashboardPeriod: "today", savDashboardTypeFilter: "all", savDashboardStatusFilter: "all" },
      resources: [{ id: "perf-resource", name: "Ressource", role: "tolier", active: true }],
      cases: __largeCases,
      bookings: __largeBookings
    });
  `);
  const startedAt = performance.now();
  const snapshot = context.buildDirectorDashboardSnapshot(undefined, new Date("2026-08-31T12:00:00.000Z"));
  const durationMs = performance.now() - startedAt;

  assert.equal(snapshot.metrics.activeCases, 500);
  assert.ok(durationMs < 1000, "Aggregate took " + durationMs.toFixed(1) + "ms");
  assert.match(uiCasesSource, /const bookingsByCaseId = new Map\(\);/u);
  assert.doesNotMatch(uiCasesSource, /activeCases[\s\S]{0,120}\.filter\([\s\S]{0,220}rawBookings\.filter/u);
});

check("K Priority placement, 44px CTA and severity text contract", () => {
  const priorityIndex = indexSource.indexOf('id="pilotage-priority-heading"');
  const kanbanIndex = indexSource.indexOf('id="kanban-board"');
  assert.ok(priorityIndex >= 0 && kanbanIndex >= 0 && priorityIndex < kanbanIndex);
  assert.match(styleSource, /\.priority-card-action \.cta-button\s*\{[\s\S]*?min-height:\s*44px/u);
  assert.match(styleSource, /\.severity-badge/u);
  assert.match(uiCasesSource, /severityLabel:\s*"CRITIQUE"/u);
  assert.match(uiCasesSource, /severityLabel:\s*"ÉLEVÉ"/u);
  assert.match(uiCasesSource, /severityLabel:\s*"MOYEN"/u);
  assert.match(uiCasesSource, /escapeHtml\(alert\.severityLabel \|\| "ALERTE"\)/u);
});

assert.equal(results.length, 11, "UX-007 must contain exactly checks A-K");
console.log("\nUX-007 REGRESSION SUITE: " + results.length + "/11 CHECKS PASSED");
