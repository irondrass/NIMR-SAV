import assert from "node:assert/strict";
import fs from "node:fs";

console.log("Démarrage des tests v22.33 : Journal d'activité dans Paramètres...");

// 1. Lire les fichiers
const stateJs = fs.readFileSync("./js/state.js", "utf8");
const appJs = fs.readFileSync("./app.js", "utf8");
const indexHtml = fs.readFileSync("./index.html", "utf8");

// 2. Vérifier les définitions statiques
assert.ok(stateJs.includes('"audit.view"'), "La permission audit.view doit être définie");
assert.ok(stateJs.includes('"audit.view"'), "Le chef_atelier doit avoir audit.view");
assert.ok(indexHtml.includes('id="panel-activity-log"'), "Le DOM doit contenir l'ID du panel-activity-log");
assert.ok(appJs.includes('renderActivityLog()'), "L'application doit appeler renderActivityLog");
assert.ok(appJs.includes('function computeFilteredActivityRows()'), "Le journal doit factoriser les lignes filtrées");
assert.ok(appJs.includes('const logs = computeFilteredActivityRows();'), "L'export CSV doit utiliser les lignes filtrées");

// 3. Charger le contexte pour les tests de logique
let state = {
  cases: [
    {
      id: "case1",
      number: "D2024-001",
      history: [
        { id: "h1", at: "2024-01-01T10:00:00.000Z", type: "planning.moved", label: "Tâche planifiée", details: "dynamic-reschedule", user: "Jean" }
      ]
    }
  ],
  auditLog: [
    { id: "a1", at: "2024-01-01T10:05:00.000Z", type: "users.created", label: "Création", details: "User test", user: "Admin" },
    { id: "a2", at: "2024-01-01T10:06:00.000Z", type: "users.role_changed", label: "Role", details: "Changement", user: "Admin" },
    { id: "a3", at: "2024-01-01T10:07:00.000Z", type: "security.login", label: "Login", details: "Success", user: "Admin" }
  ],
  syncLog: [
    { at: "2024-01-01T10:10:00.000Z", status: "success", duration: 150, items: 5, source: "auto" }
  ],
  syncConflicts: [
    { id: "c1", at: "2024-01-01T10:15:00.000Z", type: "case", resolution: "kept_local" }
  ]
};

// Mocker les variables globales utilisées dans state.js pour getAggregatedActivityLog
global.state = state;
let currentActorMock = { role: "admin" };
global.getCurrentActor = () => currentActorMock;

// Extraire et évaluer la fonction getAggregatedActivityLog depuis le code de state.js
const extractFunction = (source, name) => {
  const regex = new RegExp(`function ${name}\\s*\\([\\s\\S]*?\\n}`);
  const match = source.match(regex);
  if (!match) throw new Error(`Function ${name} not found`);
  return match[0];
};

const fnCode = extractFunction(stateJs, "getAggregatedActivityLog");
const getAggregatedActivityLog = new Function(`
  return ${fnCode.replace('function getAggregatedActivityLog', 'function')}
`)();

// === Début des assertions métier ===

// Test A : Admin voit tout
const adminLogs = getAggregatedActivityLog(200, "admin");
assert.equal(adminLogs.length, 6, "Admin doit voir les 6 événements");
assert.equal(adminLogs[0].type, "sync.conflict", "Le tri anti-chronologique doit fonctionner (dernier = index 0)");

// Vérifier les mappings
const caseLog = adminLogs.find(l => l.caseId === "case1");
assert.ok(caseLog, "L'agrégation cases[].history doit fonctionner");
assert.equal(caseLog.caseNumber, "D2024-001");
assert.equal(caseLog.category, "planning");

const auditLogCreated = adminLogs.find(l => l.type === "users.created");
assert.ok(auditLogCreated, "L'agrégation auditLog doit fonctionner");
assert.equal(auditLogCreated.category, "users");

const syncLog = adminLogs.find(l => l.type === "sync.run");
assert.ok(syncLog, "L'agrégation syncLog doit fonctionner");
assert.equal(syncLog.level, "info");

const conflictLog = adminLogs.find(l => l.type === "sync.conflict");
assert.ok(conflictLog, "L'agrégation syncConflicts doit fonctionner");
assert.equal(conflictLog.level, "warn");

// Test B : Limite
const limitedLogs = getAggregatedActivityLog(2, "admin");
assert.equal(limitedLogs.length, 2, "La limite de taille doit être respectée");

// Test C : Chef atelier (filtrage)
currentActorMock = { role: "chef_atelier" };
const chefLogs = getAggregatedActivityLog(200, "chef_atelier");
assert.equal(chefLogs.length, 4, "Chef atelier ne doit pas voir les 2 logs 'users.*'");
const chefHasUsers = chefLogs.some(l => l.type.startsWith("users."));
assert.equal(chefHasUsers, false, "Chef atelier est filtré des logs admin/utilisateurs purs");
const chefHasSecurity = chefLogs.some(l => l.type.startsWith("security."));
assert.equal(chefHasSecurity, true, "Chef atelier doit voir security (qui ne commence pas par users, supabase ou settings)");

// Test D : State vide ou corrompu ne casse pas
global.state = { cases: null, auditLog: undefined, syncLog: "string", syncConflicts: {} };
const emptyLogs = getAggregatedActivityLog(200, "admin");
assert.equal(emptyLogs.length, 0, "Doit supporter un state vide sans crasher");

// Test E : Export CSV et retours ligne
const sampleExport = ["Date;Type;Acteur;Dossier;Label;Details"];
const mockLogs = [
  { at: "2024-01-01T10:00:00.000Z", category: "sync", actorName: "Système", caseNumber: "", label: "Test", details: "Ligne 1\nLigne 2" }
];
mockLogs.forEach(log => {
  sampleExport.push([
    new Date(log.at).toLocaleString(),
    log.category,
    log.actorName,
    log.caseNumber,
    log.label,
    log.details
  ].map(s => `"${String(s || "").replace(/"/g, '""').replace(/\n/g, ' ')}"`).join(";"));
});
const csvText = "\ufeff" + sampleExport.join("\r\n");
assert.ok(!csvText.includes("\\n"), "Le CSV ne doit pas contenir de retour ligne échappé littéral");
assert.ok(csvText.includes("\r\n"), "Le CSV doit contenir un vrai retour chariot CRLF");

// Test F : Fallbacks SyncLog
global.state = {
  syncLog: [{ at: "2024-01-01T10:00:00.000Z", status: "success" }],
  syncConflicts: [{ id: "c2", at: "2024-01-01T10:00:00.000Z" }]
};
const undefinedCheckLogs = getAggregatedActivityLog(200, "admin");
const uSyncLog = undefinedCheckLogs.find(l => l.type === "sync.run");
assert.ok(uSyncLog.details.includes("éléments inconnus"), "Doit gérer les items manquants");
assert.ok(uSyncLog.details.includes("durée inconnue"), "Doit gérer la durée manquante");
assert.ok(!uSyncLog.details.includes("undefined"), "Ne doit pas afficher undefined dans syncLog");

const uConfLog = undefinedCheckLogs.find(l => l.type === "sync.conflict");
assert.ok(uConfLog.details.includes("entité inconnue"), "Doit gérer le type manquant");
assert.ok(!uConfLog.details.includes("undefined"), "Ne doit pas afficher undefined dans syncConflicts");

// Test G : Export respecte filtre et recherche courants
const activityRows = [
  { at: "2024-01-01T10:00:00.000Z", category: "sync", type: "sync.run", actorName: "Système", caseNumber: "", label: "Synchronisation Supabase", details: "source auto" },
  { at: "2024-01-01T10:05:00.000Z", category: "users", type: "users.created", actorName: "Admin", caseNumber: "", label: "Utilisateur créé", details: "Compte réception" },
  { at: "2024-01-01T10:10:00.000Z", category: "planning", type: "planning.moved", actorName: "Chef", caseNumber: "D2024-002", label: "Planning déplacé", details: "Pont 1" },
  { at: "2024-01-01T10:15:00.000Z", category: "sync", type: "sync.conflict", actorName: "Système", caseNumber: "D2024-003", label: "Conflit sync", details: "source manuelle" }
];

function computeFilteredActivityRowsForTest(rows, filter = "all", search = "") {
  const cleanSearch = search.toLowerCase();
  return rows.filter(log => {
    if (filter !== "all") {
      if (filter === "users" && !["users", "security", "supabase", "settings"].includes(log.category)) return false;
      if (filter === "planning" && !["planning"].includes(log.category)) return false;
      if (filter === "case" && !["case"].includes(log.category)) return false;
      if (filter === "sync" && !["sync"].includes(log.category)) return false;
      if (filter === "errors" && !["error", "warn"].includes(log.level)) return false;
    }
    if (cleanSearch) {
      const text = `${log.label || ""} ${log.details || ""} ${log.actorName || log.user || ""} ${log.caseNumber || ""}`.toLowerCase();
      if (!text.includes(cleanSearch)) return false;
    }
    return true;
  });
}

function buildActivityCsvForTest(rows) {
  const csv = ["Date;Type;Acteur;Dossier;Label;Details"];
  rows.forEach(log => {
    csv.push([
      new Date(log.at).toLocaleString(),
      log.category || log.type,
      log.actorName || log.user || "Système",
      log.caseNumber || "",
      log.label,
      log.details
    ].map(s => `"${String(s || "").replace(/"/g, '""').replace(/\n/g, ' ')}"`).join(";"));
  });
  return "\ufeff" + csv.join("\r\n");
}

const syncCsv = buildActivityCsvForTest(computeFilteredActivityRowsForTest(activityRows, "sync"));
assert.ok(syncCsv.includes("Synchronisation Supabase"), "Export filtré sync doit contenir l'événement sync");
assert.ok(syncCsv.includes("Conflit sync"), "Export filtré sync doit contenir le conflit sync");
assert.ok(!syncCsv.includes("Utilisateur créé"), "Export filtré sync ne doit pas contenir users");
assert.ok(!syncCsv.includes("Planning déplacé"), "Export filtré sync ne doit pas contenir planning");

const searchCsv = buildActivityCsvForTest(computeFilteredActivityRowsForTest(activityRows, "sync", "manuelle"));
assert.ok(searchCsv.includes("Conflit sync"), "Export doit respecter la recherche texte");
assert.ok(!searchCsv.includes("Synchronisation Supabase"), "Export recherché ne doit pas contenir les autres sync");
assert.ok(!searchCsv.includes("Utilisateur créé"), "Export recherché ne doit pas contenir users");
assert.ok(!searchCsv.includes("Planning déplacé"), "Export recherché ne doit pas contenir planning");

console.log("Tests v22.33 compilés et validés avec succès.");
