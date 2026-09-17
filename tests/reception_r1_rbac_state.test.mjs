import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const scriptFiles = [
  "js/utils.js",
  "js/state.js",
  "js/ui-cases.js",
  "js/estimate-import.js",
  "js/ui-planning.js",
  "js/photos.js",
  "js/storage.js",
  "js/planning.js",
  "js/exports.js",
  "js/supabase-client.js",
  "app.js",
  "js/business-rules-v2187.js",
];

const source = scriptFiles
  .map((file) => fs.readFileSync(file, "utf8"))
  .join("\n")
  .replace(/initApp\(\);/, "// initApp skipped by permissions tests")
  .replace(/if \("serviceWorker" in navigator[\s\S]*$/u, "");

function stubElement(tagName = "div") {
  const children = [];
  const classNames = new Set();
  const attributes = {};
  const listeners = {};
  const el = {
    tagName: tagName.toUpperCase(),
    value: "",
    textContent: "",
    innerHTML: "",
    hidden: false,
    disabled: false,
    title: "",
    dataset: {},
    style: {},
    attributes,
    parentNode: { insertBefore() {} },
    nextSibling: null,
    classList: {
      add: (...cls) => cls.forEach((c) => classNames.add(c)),
      remove: (...cls) => cls.forEach((c) => classNames.delete(c)),
      toggle: (c, force) => {
        if (force === undefined) {
          if (classNames.has(c)) classNames.delete(c);
          else classNames.add(c);
        } else if (force) classNames.add(c);
        else classNames.delete(c);
      },
      contains: (c) => classNames.has(c),
    },
    setAttribute(k, v) { attributes[k] = String(v); },
    getAttribute(k) { return attributes[k] ?? null; },
    removeAttribute(k) { delete attributes[k]; },
    hasAttribute(k) { return k in attributes; },
    remove() {},
    toggleAttribute(k, force) {
      if (force === undefined) {
        if (k in attributes) delete attributes[k];
        else attributes[k] = "";
      } else if (force) attributes[k] = "";
      else delete attributes[k];
    },
    addEventListener(evt, fn) {
      listeners[evt] = listeners[evt] || [];
      listeners[evt].push(fn);
    },
    dispatch(evt, data) {
      (listeners[evt] || []).forEach((fn) => fn(data));
    },
    append(...els) { children.push(...els); },
    appendChild(child) { children.push(child); return child; },
    prepend(...els) { children.unshift(...els); },
    replaceChildren(...els) { children.length = 0; children.push(...els); },
    querySelector: () => stubElement(),
    querySelectorAll: () => [],
    closest: () => null,
  };
  return el;
}

const context = {
  console,
  localStorage: { getItem: () => null, setItem() {}, removeItem() {}, key: () => null, length: 0 },
  sessionStorage: { getItem: () => null, setItem() {}, removeItem() {}, key: () => null, length: 0 },
  document: {
    querySelector: () => stubElement(),
    querySelectorAll: () => [],
    getElementById: () => stubElement(),
    addEventListener() {},
    createElement: (tag) => stubElement(tag),
    body: stubElement("body"),
  },
  window: {
    addEventListener() {},
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval: () => {},
    NIMR_SUPABASE_RUNTIME_CONFIG_KEY: "nimr-supabase-runtime-config",
    NIMR_DEFAULT_WORKSHOP_ID: "00000000-0000-0000-0000-000000000001",
  },
  navigator: { onLine: true },
  fetch: async () => ({ ok: false }),
  setTimeout,
  clearTimeout,
  setInterval: () => 0,
  clearInterval: () => {},
  Blob,
  URL: { createObjectURL: () => "", revokeObjectURL() {} },
  FileReader: class {},
  crypto: { randomUUID: () => `id-${Math.random().toString(16).slice(2)}` },
};
context.window = { ...context.window, ...context };

vm.createContext(context);
vm.runInContext(source, context);
const app = (code) => vm.runInContext(code, context);

function setupScenario(role = "reception") {
  app(`
    state = normalizeState({
      users: [
        { id: "u-admin", name: "Admin technique", role: "admin_technique", active: true },
        { id: "u-chef", name: "Chef atelier", role: "chef_atelier", active: true },
        { id: "u-directeur", name: "Directeur SAV", role: "directeur", active: true },
        { id: "u-reception", name: "Agent Réception", role: "reception", active: true },
        { id: "u-tech-1", name: "Technicien DF", role: "technicien", resourceId: "res-tech-1", active: true },
        { id: "u-readonly", name: "Lecture seule", role: "lecture_seule", active: true }
      ],
      currentUserId: "u-${role}",
      resources: [
        { id: "res-tech-1", name: "Nabil M.", role: "mecanicien", active: true },
        { id: "res-tech-2", name: "Karim T.", role: "tolier", active: true }
      ],
      cases: [{
        id: "case-dongfeng-01",
        clientName: "Société Maghreb Transport",
        vehicle: "DongFeng Rich 6",
        plate: "220 TU 8899",
        vin: "LDF12345678901234",
        phone: "+216 71 000 111",
        flags: {
          expertApproved: true,
          clientApproved: true,
          received: true,
          workStarted: false,
          workCompleted: false,
          invoiced: false,
          delivered: false
        },
        appointment: {
          start: "2026-09-20T08:00:00.000Z",
          delivery: "2026-09-21T17:00:00.000Z",
          end: "2026-09-20T12:00:00.000Z"
        },
        durations: { mechanical: 2, body: 3 },
        claims: [{
          id: "claim-01",
          type: "client",
          number: "OR-2026-DF01",
          includeInPlanning: true,
          clientApproved: true,
          expertApproved: true,
          estimate: {
            lines: [
              { phase: "mechanical", operation: "Révision mécanique", laborHours: 2 },
              { phase: "body", operation: "Redressage aile", laborHours: 3 }
            ]
          }
        }],
        history: [],
        notes: { reception: "Véhicule propre", technique: "", qualite: "", direction: "" },
        receptionWorkflow: {
          rdvConfirmedAt: "2026-09-18T10:00:00.000Z",
          vehicleReceivedAt: "2026-09-20T08:00:00.000Z"
        }
      }],
      bookings: [
        {
          id: "b-df-01",
          caseId: "case-dongfeng-01",
          resourceIds: ["res-tech-1"],
          key: "mechanical",
          title: "Révision mécanique",
          status: "planned",
          segments: [{ start: "2026-09-20T08:00:00.000Z", end: "2026-09-20T10:00:00.000Z" }]
        },
        {
          id: "b-df-02",
          caseId: "case-dongfeng-01",
          resourceIds: ["res-tech-2"],
          key: "body",
          title: "Redressage aile",
          status: "started",
          actualStart: "2026-09-20T10:00:00.000Z",
          segments: [{ start: "2026-09-20T10:00:00.000Z", end: "2026-09-20T13:00:00.000Z" }]
        }
      ],
      auditLog: []
    });
  `);
}

console.log("--- TEST SUITE: RECEPTION-R1-001 (RBAC Hardening + Role Boundary + State Consistency) ---");

// -----------------------------------------------------------------------------
// Test 1: START technical task not enabled/rendered for reception
// -----------------------------------------------------------------------------
{
  setupScenario("reception");
  const plannedBookingHtml = app(`renderBookingTaskActions(state.bookings[0])`);
  assert.equal(
    plannedBookingHtml.includes('data-booking-action="start"'),
    false,
    "Test 1 FAIL: Le bouton Démarrer (data-booking-action=start) ne doit pas être rendu pour le rôle réception"
  );
  const awareStartBtn = app(`renderPermissionAwareButton("task.start", "Démarrer", "start", "", "primary-button", state.bookings[0])`);
  assert.equal(
    awareStartBtn.includes("data-tech-action=\"start\""),
    false,
    "Test 1 FAIL: renderPermissionAwareButton(task.start) ne doit pas rendre de bouton cliquable ou désactivé pour réception"
  );
  console.log("✓ Test 1: START technical task not rendered for reception");
}

// -----------------------------------------------------------------------------
// Test 2: PAUSE technical task not enabled/rendered for reception
// -----------------------------------------------------------------------------
{
  setupScenario("reception");
  const startedBookingHtml = app(`renderBookingTaskActions(state.bookings[1])`);
  assert.equal(
    startedBookingHtml.includes('data-booking-action="pause"'),
    false,
    "Test 2 FAIL: Le bouton Pause ne doit pas être rendu pour le rôle réception"
  );
  const awarePauseBtn = app(`renderPermissionAwareButton("task.pause", "Pause", "pause", "", "ghost-button", state.bookings[1])`);
  assert.equal(
    awarePauseBtn.includes("data-tech-action=\"pause\""),
    false,
    "Test 2 FAIL: renderPermissionAwareButton(task.pause) ne doit pas rendre de bouton pour réception"
  );
  console.log("✓ Test 2: PAUSE technical task not rendered for reception");
}

// -----------------------------------------------------------------------------
// Test 3: FINISH technical task not enabled/rendered for reception
// -----------------------------------------------------------------------------
{
  setupScenario("reception");
  const startedBookingHtml = app(`renderBookingTaskActions(state.bookings[1])`);
  assert.equal(
    startedBookingHtml.includes('data-booking-action="complete"'),
    false,
    "Test 3 FAIL: Le bouton Terminer ne doit pas être rendu pour le rôle réception"
  );
  const awareCompleteBtn = app(`renderPermissionAwareButton("task.complete", "Terminer", "complete", "", "primary-button", state.bookings[1])`);
  assert.equal(
    awareCompleteBtn.includes("data-tech-action=\"complete\""),
    false,
    "Test 3 FAIL: renderPermissionAwareButton(task.complete) ne doit pas rendre de bouton pour réception"
  );
  console.log("✓ Test 3: FINISH technical task not rendered for reception");
}

// -----------------------------------------------------------------------------
// Test 4: REPLAN technical task not enabled/rendered for reception
// -----------------------------------------------------------------------------
{
  setupScenario("reception");
  const plannedBookingHtml = app(`renderBookingTaskActions(state.bookings[0])`);
  assert.equal(
    plannedBookingHtml.includes('data-booking-action="reschedule"'),
    false,
    "Test 4 FAIL: Le bouton Replanifier ne doit pas être rendu pour le rôle réception"
  );
  console.log("✓ Test 4: REPLAN technical task not rendered for reception");
}

// -----------------------------------------------------------------------------
// Test 5: Assign/change technician not enabled/rendered for reception
// -----------------------------------------------------------------------------
{
  setupScenario("reception");
  app(`
    testRoot = document.createElement("div");
    testRoot.grid = document.createElement("div");
    testRoot.querySelector = function(sel) {
      if (sel === "[data-field='durations']") return this.grid;
      return document.createElement("div");
    };
    renderDurations(testRoot, state.cases[0]);
  `);
  const durationHtml = app(`testRoot.grid.innerHTML`);
  assert.equal(
    durationHtml.includes("<select data-preferred-technician"),
    false,
    "Test 5 FAIL: Le sélecteur d'affectation technicien ne doit pas être rendu de façon interactive pour réception"
  );
  console.log("✓ Test 5: Assign/change technician not rendered for reception");
}

// -----------------------------------------------------------------------------
// Test 6: Direct client invocation fails closed for reception even if UI bypassed
// -----------------------------------------------------------------------------
{
  setupScenario("reception");
  assert.equal(app(`hasPermission("task.start")`), false, "reception n'a pas task.start");
  assert.equal(app(`hasPermission("task.pause")`), false, "reception n'a pas task.pause");
  assert.equal(app(`hasPermission("task.complete")`), false, "reception n'a pas task.complete");
  assert.equal(app(`hasPermission("planning.edit")`), false, "reception n'a pas planning.edit");
  assert.equal(app(`hasPermission("task.override")`), false, "reception n'a pas task.override");

  const startAttempt = app(`startTechnicianTask(state.cases[0], "b-df-01", "res-tech-1")`);
  assert.equal(startAttempt.ok, false, "Test 6 FAIL: startTechnicianTask doit échouer pour réception");

  const pauseAttempt = app(`pauseTechnicianTask(state.cases[0], "b-df-02", "res-tech-2", "Pause test")`);
  assert.equal(pauseAttempt.ok, false, "Test 6 FAIL: pauseTechnicianTask doit échouer pour réception");

  const completeAttempt = app(`completeTechnicianTask(state.cases[0], "b-df-02", "res-tech-2")`);
  assert.equal(completeAttempt.ok, false, "Test 6 FAIL: completeTechnicianTask doit échouer pour réception");

  const rescheduleAttempt = app(`rescheduleCaseBooking(state.cases[0], "b-df-01", "2026-09-20T14:00:00.000Z")`);
  assert.equal(rescheduleAttempt.ok, false, "Test 6 FAIL: rescheduleCaseBooking doit échouer pour réception");

  const workflowStartAttempt = app(`applyWorkflowAction(state.cases[0], "workStarted")`);
  assert.equal(workflowStartAttempt.ok, false, "Test 6 FAIL: applyWorkflowAction(workStarted) doit échouer pour réception");

  const workflowCompleteAttempt = app(`applyWorkflowAction(state.cases[0], "workCompleted")`);
  assert.equal(workflowCompleteAttempt.ok, false, "Test 6 FAIL: applyWorkflowAction(workCompleted) doit échouer pour réception");

  console.log("✓ Test 6: Direct client invocation fails closed for reception");
}

// -----------------------------------------------------------------------------
// Test 7: Existing workshop roles (chef_atelier, technicien) retain full rights
// -----------------------------------------------------------------------------
{
  setupScenario("chef");
  assert.equal(app(`hasPermission("planning.edit")`), true, "chef atelier a planning.edit");
  assert.equal(app(`hasPermission("task.override")`), true, "chef atelier a task.override");
  const chefBookingHtml = app(`renderBookingTaskActions(state.bookings[0])`);
  assert.equal(chefBookingHtml.includes('data-booking-action="reschedule"'), true, "chef atelier voit Replanifier");
  assert.equal(chefBookingHtml.includes('data-booking-action="start"'), true, "chef atelier voit Démarrer");
  app(`
    chefRoot = document.createElement("div");
    chefRoot.grid = document.createElement("div");
    chefRoot.querySelector = function(sel) {
      if (sel === "[data-field='durations']") return this.grid;
      return document.createElement("div");
    };
    renderDurations(chefRoot, state.cases[0]);
  `);
  const chefDurationHtml = app(`chefRoot.grid.innerHTML`);
  assert.equal(chefDurationHtml.includes("<select data-preferred-technician"), true, "chef atelier a le sélecteur technicien");

  setupScenario("tech-1");
  assert.equal(app(`hasPermission("task.start")`), true, "technicien a task.start");
  assert.equal(app(`hasPermission("task.pause")`), true, "technicien a task.pause");
  assert.equal(app(`hasPermission("task.complete")`), true, "technicien a task.complete");
  console.log("✓ Test 7: Existing workshop roles retain full rights");
}

// -----------------------------------------------------------------------------
// Test 8: Reception legitimate actions remain accessible
// -----------------------------------------------------------------------------
{
  setupScenario("reception");
  assert.equal(app(`guardCaseCreate().ok`), true, "reception peut créer dossier");
  assert.equal(app(`guardEstimateImport(state.cases[0]).ok`), true, "reception peut importer devis");
  assert.equal(app(`guardAppointmentSchedule(state.cases[0]).ok`), true, "reception peut planifier RDV");
  assert.equal(app(`guardVehicleReceive(state.cases[0]).ok`), true, "reception peut réceptionner véhicule");
  assert.equal(app(`guardDeliveryComplete(state.cases[0]).ok`), true, "reception peut livrer véhicule");
  assert.equal(app(`hasPermission("customer_claim.manage")`), true, "reception peut gérer réclamations");

  const followupResult = app(`recordClientCommitment(state.cases[0], { note: "Client prévenu disponibilité pièces DongFeng" })`);
  assert.equal(followupResult.ok, true, "reception peut enregistrer suivi client");

  const noteResult = app(`updateCaseNote("case-dongfeng-01", "reception", "Note accueil client")`);
  assert.equal(noteResult.ok, true, "reception peut enregistrer note réception");

  console.log("✓ Test 8: Reception legitimate actions remain accessible");
}

// -----------------------------------------------------------------------------
// Test 9: Confirmed reception does not show "Confirmer réception véhicule" as actionable primary button
// -----------------------------------------------------------------------------
{
  setupScenario("reception");
  assert.equal(app(`state.cases[0].flags.received`), true);
  const nextAction = app(`getCaseNextAction(state.cases[0])`);
  assert.notEqual(
    nextAction.code,
    "receive_vehicle",
    "Test 9 FAIL: Un dossier déjà reçu ne doit pas avoir 'receive_vehicle' comme prochaine action"
  );
  assert.notEqual(
    nextAction.label,
    "Confirmer la réception véhicule",
    "Test 9 FAIL: Un dossier déjà reçu ne doit pas afficher 'Confirmer la réception véhicule'"
  );

  const nextWorkflow = app(`getNextWorkflowAction(state.cases[0])`);
  assert.notEqual(
    nextWorkflow,
    "received",
    "Test 9 FAIL: getNextWorkflowAction ne doit pas retourner 'received' si déjà reçu"
  );
  console.log("✓ Test 9: Confirmed reception does not show Confirmer réception véhicule as actionable");
}

// -----------------------------------------------------------------------------
// Test 10: Confirmed reception displays "Données véhicule à compléter" without reverting confirmation state
// -----------------------------------------------------------------------------
{
  setupScenario("reception");
  app(`
    state.cases[0].flags.received = true;
    state.cases[0].plate = "";
    state.cases[0].vin = "";
    state.cases[0].vehicle = "Véhicule à compléter";
  `);
  const nextActionIncomplete = app(`getCaseNextAction(state.cases[0])`);
  assert.equal(
    app(`state.cases[0].flags.received`),
    true,
    "Test 10 FAIL: Le statut reçu physique doit rester true même si les données véhicule sont incomplètes"
  );
  assert.equal(
    nextActionIncomplete.code,
    "complete_vehicle_identity",
    "Test 10 FAIL: L'action doit cibler la complétion des données véhicule"
  );
  assert.equal(
    nextActionIncomplete.label,
    "Données véhicule à compléter",
    "Test 10 FAIL: Le libellé doit afficher 'Données véhicule à compléter'"
  );
  console.log("✓ Test 10: Confirmed reception displays Données véhicule à compléter without reverting confirmation");
}

// -----------------------------------------------------------------------------
// Test 11: No new mileage/photo/promise hard-stops introduced
// -----------------------------------------------------------------------------
{
  setupScenario("reception");
  app(`
    const freshCase = {
      id: "case-dfsk-02",
      clientName: "DFSK Client",
      vehicle: "DFSK Glory 580",
      plate: "123 TU 4567",
      vin: "DFSK9988776655443",
      mileage: "",
      photos: [],
      clientCommitment: {},
      flags: { received: false, clientApproved: true },
      claims: [{ id: "c-01", type: "client", laborEstimate: 1 }]
    };
    state.cases.push(freshCase);
  `);
  const receiveGuard = app(`guardVehicleReceive(state.cases.find(c => c.id === "case-dfsk-02"))`);
  assert.equal(receiveGuard.ok, true, "Test 11 FAIL: guardVehicleReceive ne doit pas introduire de hard-stop");
  const advanceReceive = app(`advanceReceptionWorkflow("case-dfsk-02", "receive_vehicle", {})`);
  assert.equal(advanceReceive.ok, true, "Test 11 FAIL: advanceReceptionWorkflow(receive_vehicle) ne doit pas bloquer sur km/photos");
  assert.equal(app(`state.cases.find(c => c.id === "case-dfsk-02").flags.received`), true, "flags.received doit être positionné");
  console.log("✓ Test 11: No new mileage/photo/promise hard-stops introduced");
}

// -----------------------------------------------------------------------------
// Test 12: Offline/draft behavior intact
// -----------------------------------------------------------------------------
{
  setupScenario("reception");
  app(`
    const offlineItem = state.cases[0];
    offlineItem.notes = offlineItem.notes || {};
    offlineItem.notes.reception = "Note mode hors-ligne";
  `);
  const offlineGuard = app(`guardCaseEdit(state.cases[0])`);
  assert.equal(offlineGuard.ok, true, "Test 12 FAIL: guardCaseEdit doit être permis pour réception hors-ligne");
  console.log("✓ Test 12: Offline/draft behavior intact");
}

console.log("\nALL RECEPTION-R1-001 TESTS COMPLETED.");

