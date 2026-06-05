import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

console.log("Démarrage des tests v23.1A-bis : Technician Resource Isolation...");

// 1. Lire les sources des fichiers indispensables
const utilsJs = fs.readFileSync("./js/utils.js", "utf8");
const stateJs = fs.readFileSync("./js/state.js", "utf8");
const planningJs = fs.readFileSync("./js/planning.js", "utf8");

// 2. Préparer le contexte global mocké
global.window = global;

const mockStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
  clear: () => {}
};
global.localStorage = mockStorage;
global.sessionStorage = mockStorage;

global.uid = (prefix) => `${prefix}-${Math.random().toString(36).substring(2, 6)}`;
global.bytesToBase64 = (bytes) => {
  return Buffer.from(bytes).toString("base64");
};

// Mock helper functions
global.notifyUser = (msg, type) => {
  console.log(`[Notification] ${type}: ${msg}`);
};
global.quietNotify = (msg, type) => {};
global.saveState = () => {};
global.render = () => {};

// Mocks requis par planning.js
global.isCaseReadonlyArchive = (item) => false;
global.getArchivedCaseMessage = (item) => "Archive readonly";
global.isCaseBlocked = (item) => false;
global.getCaseBlockerLabel = (item) => "";
global.isCaseOperationallyClosed = (item) => false;
global.getBookingOperationalStatus = (booking) => {
  return booking.status || "planned";
};
global.getBookingStatusLabel = (booking) => "Planifié";
global.getDurationLabel = (key) => "Étape";
global.isBookingVisibleForResource = (booking, resId) => {
  return (booking.resourceIds || []).includes(resId);
};
global.isEquipmentResource = (resource) => false;
global.getBookingPlanningColor = () => "#ffffff";
global.todayKey = (date) => "2026-06-05";
global.atTime = (date, time) => new Date(`2026-06-05T${time}:00`);
global.diffMinutes = (a, b) => Math.round((b - a) / 60000);
global.maxDate = (a, b) => (a > b ? a : b);
global.minDate = (a, b) => (a < b ? a : b);
global.formatTime = (date) => "08:00";
global.formatDate = (date) => "2026-06-05";
global.formatDateTime = (date) => "2026-06-05 08:00";
global.shortVehicleModel = (v) => v;
global.uid = (prefix) => `${prefix}-${Math.floor(Math.random()*1000)}`;
global.normalizePartsStatus = (s) => s || "unchecked";
global.isBookingTaskBlocked = (booking) => Boolean(booking.blockedAt);
global.isTechnicianResource = (res) => ["tolier", "peintre", "mecanicien", "electricien", "controle"].includes(res?.role);
global.canStartTechnicianTask = () => ({ ok: true, issues: [] });
global.startCaseBookingTask = (item, bookingId, options) => {
  const booking = item.bookings.find(b => b.id === bookingId);
  booking.status = "started";
  return { ok: true, booking };
};
global.pauseCaseBookingTask = (item, bookingId, reason, options) => {
  const booking = item.bookings.find(b => b.id === bookingId);
  booking.status = "paused";
  return { ok: true, booking };
};
global.completeCaseBookingTaskNow = (item, bookingId, date, options) => {
  const booking = item.bookings.find(b => b.id === bookingId);
  booking.status = "completed";
  return { ok: true, booking };
};

// Évaluer les scripts
vm.runInThisContext(utilsJs);
vm.runInThisContext(stateJs);
vm.runInThisContext("global.state = state;"); // Synchronize global.state!
vm.runInThisContext(planningJs);

// Mocks additionnels après évaluation
global.addAuditLog = window.addAuditLog;
global.addHistory = window.addHistory;

async function runTests() {
  console.log("Configuration des utilisateurs Alaa & Karim...");
  
  // Remplacer les ressources par les nôtres
  state.resources = [
    { id: "res-alaa", name: "Alaa", role: "tolier", active: true },
    { id: "res-karim", name: "Karim", role: "tolier", active: true }
  ];

  const userAlaa = {
    id: "user-alaa",
    name: "Alaa",
    role: "technicien",
    email: "alaa@nimr.local",
    resourceId: "res-alaa",
    active: true
  };
  const userKarim = {
    id: "user-karim",
    name: "Karim",
    role: "technicien",
    email: "karim@nimr.local",
    resourceId: "res-karim",
    active: true
  };
  
  state.users = [userAlaa, userKarim];
  
  // Tâches factices
  const bookingAlaa = {
    id: "booking-alaa",
    caseId: "case-1",
    title: "Tôle Alaa",
    key: "body",
    start: "2026-06-05T08:00:00",
    end: "2026-06-05T10:00:00",
    resourceIds: ["res-alaa"],
    segments: [{ start: "2026-06-05T08:00:00", end: "2026-06-05T10:00:00" }]
  };
  const bookingKarim = {
    id: "booking-karim",
    caseId: "case-2",
    title: "Peinture Karim",
    key: "paint",
    start: "2026-06-05T10:00:00",
    end: "2026-06-05T12:00:00",
    resourceIds: ["res-karim"],
    segments: [{ start: "2026-06-05T10:00:00", end: "2026-06-05T12:00:00" }]
  };
  
  state.bookings = [bookingAlaa, bookingKarim];
  
  const case1 = {
    id: "case-1",
    clientName: "Client Alaa",
    vehicle: "Clio",
    plate: "123-A",
    bookings: [bookingAlaa],
    history: [],
    flags: { received: true }
  };
  const case2 = {
    id: "case-2",
    clientName: "Client Karim",
    vehicle: "Megane",
    plate: "456-B",
    bookings: [bookingKarim],
    history: [],
    flags: { received: true }
  };
  
  state.cases = [case1, case2];

  // -------------------------------------------------------------
  // Test A: Filtrage à l'affichage par resourceId
  // -------------------------------------------------------------
  console.log("Test A: Filtrage à l'affichage par resourceId...");
  
  // Connecter Alaa
  state.currentUserId = "user-alaa";
  const tasksForAlaa = getTechnicianTaskRows("res-karim", new Date("2026-06-05"));
  assert.ok(tasksForAlaa.some(t => t.id === "booking-alaa"), "Alaa doit voir sa tâche");
  assert.ok(!tasksForAlaa.some(t => t.id === "booking-karim"), "Alaa ne doit pas voir la tâche de Karim");

  // Connecter Karim
  state.currentUserId = "user-karim";
  const tasksForKarim = getTechnicianTaskRows("res-alaa", new Date("2026-06-05"));
  assert.ok(tasksForKarim.some(t => t.id === "booking-karim"), "Karim doit voir sa tâche");
  assert.ok(!tasksForKarim.some(t => t.id === "booking-alaa"), "Karim ne doit pas voir la tâche d'Alaa");

  // -------------------------------------------------------------
  // Test B: Gardes dans tous les handlers techniciens (Alaa agit sur Karim)
  // -------------------------------------------------------------
  console.log("Test B: Gardes dans tous les handlers techniciens...");
  
  // Reconnecter Alaa
  state.currentUserId = "user-alaa";
  state.auditLog = []; // clear audit

  const checkBlocked = (res, actionName) => {
    assert.equal(res.ok, false, `Action '${actionName}' aurait dû être refusée pour la ressource de Karim`);
    assert.ok(
      state.auditLog.some(log => log.type === "security.permission_denied"),
      `Un log d'audit security.permission_denied aurait dû être généré pour '${actionName}'`
    );
    // Vider le log d'audit pour la prochaine vérification
    state.auditLog = [];
  };

  // 1. start
  console.log(" - Démarrage...");
  let res = startTechnicianTask(case2, "booking-karim", "res-alaa");
  checkBlocked(res, "start");

  // 2. pause
  console.log(" - Pause...");
  res = pauseTechnicianTask(case2, "booking-karim", "res-alaa", "Attente pièce");
  checkBlocked(res, "pause");

  // 3. resume
  console.log(" - Reprise...");
  res = resumeTechnicianTask(case2, "booking-karim", "res-alaa");
  checkBlocked(res, "resume");

  // 4. block
  console.log(" - Blocage...");
  res = blockTechnicianTask(case2, "booking-karim", "res-alaa", "Attente d'accord");
  checkBlocked(res, "block");

  // 5. clearBlock
  console.log(" - Déblocage...");
  res = clearTechnicianTaskBlock(case2, "booking-karim", "res-alaa");
  checkBlocked(res, "clearBlock");

  // 6. complete
  console.log(" - Finition / complétion...");
  res = completeTechnicianTask(case2, "booking-karim", "res-alaa");
  checkBlocked(res, "complete");

  // 7. addNote
  console.log(" - Note...");
  res = addTechnicianTaskNote(case2, "booking-karim", "res-alaa", "Essai de note illicite");
  checkBlocked(res, "addNote");

  // 8. attachPhoto
  console.log(" - Photo...");
  res = attachTechnicianTaskPhoto(case2, "booking-karim", "res-alaa", "photo-123");
  checkBlocked(res, "attachPhoto");

  // -------------------------------------------------------------
  // Test C: Les actions autorisées sur ses propres tâches fonctionnent
  // -------------------------------------------------------------
  console.log("Test C: Autorisation sur ses propres tâches...");
  
  // Alaa sur Task Alaa
  res = startTechnicianTask(case1, "booking-alaa", "res-alaa");
  assert.equal(res.ok, true, "Alaa doit pouvoir démarrer sa propre tâche");
  
  res = addTechnicianTaskNote(case1, "booking-alaa", "res-alaa", "Ma note légitime");
  assert.equal(res.ok, true, "Alaa doit pouvoir ajouter une note sur sa propre tâche");

  console.log("TOUS LES TESTS D'ISOLATION TECHNICIEN REUSSIS !");
}

runTests().catch(err => {
  console.error("Test en échec :", err);
  process.exit(1);
});
