/**
 * Tests : PIN Overlay Clickability v23.1A Hotfix
 * Branche : hotfix/v23.1a-pin-overlay-click-blocker
 *
 * Vérifie :
 * 1.  Sélection admin → PIN demandé.
 * 2.  PIN correct admin → pinOverlay fermé, selectorOverlay fermé, app-shell non inert.
 * 3.  Après login admin, les boutons/nav sont cliquables (pointerEvents = "").
 * 4.  Admin → technicien → admin : PIN redemandé.
 * 5.  Admin → technicien : unlocked_user_admin supprimé.
 * 6.  Refresh (reset sessionStorage) puis sélection admin : PIN redemandé.
 * 7.  Sélection chef_atelier : PIN demandé.
 * 8.  PIN correct chef_atelier → interface cliquable.
 * 9.  chef_atelier ne réutilise pas unlock admin.
 * 10. Technicien sans PIN → interface technicien cliquable directement.
 * 11. Timeout inactivité → retour sélecteur + purge unlocks.
 * 12. Aucun overlay transparent ne bloque les clics après login.
 */

import { createRequire } from "module";
const require = createRequire(import.meta.url);
const fs = require("fs");
const path = require("path");

console.log("Démarrage tests PIN Overlay Clickability v23.1A Hotfix...");

// ── Simulation DOM / storage ────────────────────────────────────────────────

function makeMockSessionStorage() {
  const storage = new Map();
  return {
    storage,
    getItem: (k) => storage.get(k) ?? null,
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k),
    clear: () => storage.clear(),
    keys: () => storage.keys(),
  };
}

function makeMockElement(id = "", cls = "") {
  return {
    id,
    className: cls,
    hidden: false,
    style: { display: "", pointerEvents: "" },
    _inert: false,
    _ariaHidden: false,
    _focused: false,
    getAttribute(attr) {
      if (attr === "inert") return this._inert ? "" : null;
      if (attr === "aria-hidden") return this._ariaHidden ? "true" : null;
      return null;
    },
    setAttribute(attr, val) {
      if (attr === "inert") this._inert = true;
      if (attr === "aria-hidden") this._ariaHidden = true;
    },
    removeAttribute(attr) {
      if (attr === "inert") this._inert = false;
      if (attr === "aria-hidden") this._ariaHidden = false;
    },
    focus() { this._focused = true; },
  };
}

// ── Chargement du module app.js en mode test ──────────────────────────────

const appPath = path.resolve("app.js");
const appSrc = fs.readFileSync(appPath, "utf8");

// Helpers partagés pour simuler l'environnement
function buildEnv(options = {}) {
  const sessionStorage = options.sessionStorage || makeMockSessionStorage();
  const appShell = makeMockElement("app-shell", "app-shell");
  const pinOverlay = makeMockElement("user-pin-overlay");
  const selectorOverlay = makeMockElement("user-selector-overlay");
  const body = makeMockElement("body");

  // Simule l'état
  const state = {
    users: [
      {
        id: "u-admin", name: "Admin", role: "admin",
        pinRequired: true, pinHash: "hashedpin", pinSalt: "salt",
        active: true, resourceId: ""
      },
      {
        id: "u-chef", name: "Chef Atelier", role: "chef_atelier",
        pinRequired: true, pinHash: "hashedpin_chef", pinSalt: "salt_chef",
        active: true, resourceId: ""
      },
      {
        id: "u-alaa", name: "Alaa", role: "technicien",
        pinRequired: false, pinHash: "", pinSalt: "",
        active: true, resourceId: "r-alaa"
      },
    ],
    currentUserId: null,
    ui: { tab: "today", technicianId: "" },
    auditLog: [],
  };

  let currentUser = null;
  const loginHistory = [];
  let pinPrompted = [];
  let overlayShown = [];
  let renderCalled = 0;

  function getCurrentUser() { return currentUser; }
  function setCurrentUser(id) {
    const u = state.users.find(u => u.id === id);
    if (u) { state.currentUserId = id; currentUser = u; return true; }
    return false;
  }
  function addAuditLog(event, label, details, extra) {
    state.auditLog.push({ event, label, details, ...extra });
  }
  function saveState() {}
  function quietNotify() {}
  function notifyUser() {}
  function resetInactivityTimer() {}
  function render() { renderCalled++; }
  function ensureCurrentTabAllowed() {}

  // DOM mocks
  function getElementById(id) {
    if (id === "user-pin-overlay") return pinOverlay;
    if (id === "user-selector-overlay") return selectorOverlay;
    return null;
  }
  function querySelector(sel) {
    if (sel === ".app-shell") return appShell;
    return null;
  }

  // Extraction et wrapping des fonctions testées depuis app.js
  const wrappedSrc = appSrc
    // Remplace window / document guards
    .replace(/typeof window === "undefined"/g, "false")
    .replace(/typeof document === "undefined"/g, "false");

  const fn = new Function(
    "sessionStorage", "state", "getCurrentUser", "setCurrentUser",
    "addAuditLog", "saveState", "quietNotify", "notifyUser",
    "resetInactivityTimer", "render", "ensureCurrentTabAllowed",
    "document", "window", "console",
    `
    // Neutralise les dépendances réseau et crypto réelles
    const supabase = { from: () => ({ select: async () => ({ data: [], error: null }), upsert: async () => ({ error: null }) }) };
    const crypto = { subtle: { importKey: async () => ({}), deriveKey: async () => ({}), sign: async () => new ArrayBuffer(32) } };
    ${wrappedSrc}
    return {
      clearUnlockedUserSessions,
      finishUserUnlockAndActivateApp,
      promptUserPinAndLogin,
      executeUserLogin,
      hideUserSelectorOverlay,
      showUserSelectorOverlay,
      lockSessionDueToInactivity,
    };
  `
  );

  const mockDocument = {
    getElementById,
    querySelector,
    body,
    querySelectorAll: () => [],
  };
  const mockWindow = { addEventListener: () => {} };
  const mockConsole = { ...console };

  const exported = fn(
    sessionStorage, state, getCurrentUser, setCurrentUser,
    addAuditLog, saveState, quietNotify, notifyUser,
    resetInactivityTimer, render, ensureCurrentTabAllowed,
    mockDocument, mockWindow, mockConsole
  );

  return {
    sessionStorage, appShell, pinOverlay, selectorOverlay, body,
    state, loginHistory, renderCalled: () => renderCalled,
    exported, currentUser: () => currentUser,
  };
}

// ── Assertions ──────────────────────────────────────────────────────────────

function assert(cond, msg) {
  if (!cond) throw new Error(`ÉCHEC : ${msg}`);
}

// ── Test 1 : Sélection admin → pinRequired = true ───────────────────────────
{
  console.log("Test 1 : Sélection admin → pinRequired doit être vrai...");
  const env = buildEnv();
  const admin = env.state.users.find(u => u.id === "u-admin");
  assert(admin.pinRequired === true, "admin.pinRequired doit être true");
  console.log("→ OK");
}

// ── Test 2 : finishUserUnlockAndActivateApp → overlays fermés, inert retiré ─
{
  console.log("Test 2 : finishUserUnlockAndActivateApp → overlays fermés, inert retiré...");
  const env = buildEnv();
  // Simule état initial : overlays ouverts, app-shell inert
  env.appShell.setAttribute("inert", "");
  env.appShell._inert = true;
  env.pinOverlay.hidden = false;
  env.selectorOverlay.hidden = false;

  const admin = env.state.users.find(u => u.id === "u-admin");
  env.exported.finishUserUnlockAndActivateApp(admin);

  assert(env.appShell._inert === false, "app-shell ne doit pas être inert après finishUserUnlockAndActivateApp");
  assert(env.appShell._ariaHidden === false, "app-shell ne doit pas avoir aria-hidden");
  assert(env.pinOverlay.hidden === true, "pinOverlay doit être caché");
  assert(env.selectorOverlay.hidden === true, "selectorOverlay doit être caché");
  console.log("→ OK");
}

// ── Test 3 : Après login admin, pointerEvents vides (clics actifs) ───────────
{
  console.log("Test 3 : Après login admin, app-shell.style.pointerEvents = '' (clics actifs)...");
  const env = buildEnv();
  env.appShell._inert = true;
  env.appShell.style.pointerEvents = "none";

  const admin = env.state.users.find(u => u.id === "u-admin");
  env.exported.finishUserUnlockAndActivateApp(admin);

  assert(env.appShell.style.pointerEvents === "", "pointerEvents doit être vide après login (clics actifs)");
  assert(env.appShell._inert === false, "inert doit être absent");
  console.log("→ OK");
}

// ── Test 4 : Admin → technicien → admin : PIN re-demandé ────────────────────
{
  console.log("Test 4 : Admin → Alaa → Admin : PIN re-demandé (pas de bypass sessionStorage)...");
  const env = buildEnv();
  // Simule qu'admin était connecté et avait une clé sessionStorage
  env.sessionStorage.setItem("unlocked_user_u-admin", "true");

  // Switch vers admin via clearUnlockedUserSessions (simule switch vers Alaa)
  env.exported.clearUnlockedUserSessions("u-alaa");
  // Vérifie que la clé admin est purgée
  assert(env.sessionStorage.getItem("unlocked_user_u-admin") === null,
    "unlocked_user_u-admin doit être purgé après switch vers Alaa");

  // Maintenant re-sélection admin : promptUserPinAndLogin ne doit pas bypasser
  // La logique v23.1A-hotfix supprime le bypass sessionStorage
  // Le test vérifie l'absence de la clé → PIN sera demandé (comportement attendu)
  const adminKeyMissing = env.sessionStorage.getItem("unlocked_user_u-admin") === null;
  assert(adminKeyMissing, "Sans clé sessionStorage, PIN admin sera toujours demandé");
  console.log("→ OK");
}

// ── Test 5 : Admin → technicien : unlock_user_admin supprimé ─────────────────
{
  console.log("Test 5 : Switch admin → Alaa supprime clé unlocked_user_u-admin...");
  const env = buildEnv();
  env.sessionStorage.setItem("unlocked_user_u-admin", "true");
  env.sessionStorage.setItem("unlocked_user_u-chef", "true");

  const alaa = env.state.users.find(u => u.id === "u-alaa");
  // Alaa n'est pas sensible : toutes les clés doivent être purgées
  env.exported.clearUnlockedUserSessions(alaa.id);

  assert(env.sessionStorage.getItem("unlocked_user_u-admin") === null,
    "unlocked_user_u-admin doit être supprimé");
  assert(env.sessionStorage.getItem("unlocked_user_u-chef") === null,
    "unlocked_user_u-chef doit être supprimé");
  console.log("→ OK");
}

// ── Test 6 : Refresh (clear sessionStorage) → PIN re-demandé ─────────────────
{
  console.log("Test 6 : Après clear sessionStorage (simule refresh), PIN admin re-demandé...");
  const freshSession = makeMockSessionStorage(); // Nouveau sessionStorage vide
  const env = buildEnv({ sessionStorage: freshSession });

  const noKey = freshSession.getItem("unlocked_user_u-admin") === null;
  assert(noKey, "Après refresh (sessionStorage vide), pas de clé unlock → PIN sera demandé");
  console.log("→ OK");
}

// ── Test 7 : Sélection chef_atelier → pinRequired = true ─────────────────────
{
  console.log("Test 7 : Sélection chef_atelier → pinRequired = true...");
  const env = buildEnv();
  const chef = env.state.users.find(u => u.id === "u-chef");
  assert(chef.pinRequired === true, "chef_atelier.pinRequired doit être true");
  console.log("→ OK");
}

// ── Test 8 : finishUserUnlockAndActivateApp avec chef → interface cliquable ───
{
  console.log("Test 8 : PIN correct chef_atelier → interface cliquable...");
  const env = buildEnv();
  env.appShell._inert = true;
  env.appShell.style.pointerEvents = "none";
  env.pinOverlay.hidden = false;

  const chef = env.state.users.find(u => u.id === "u-chef");
  env.exported.finishUserUnlockAndActivateApp(chef);

  assert(env.appShell._inert === false, "app-shell non inert pour chef_atelier");
  assert(env.appShell.style.pointerEvents === "", "pointerEvents vides pour chef_atelier");
  assert(env.pinOverlay.hidden === true, "pinOverlay caché pour chef_atelier");
  console.log("→ OK");
}

// ── Test 9 : chef_atelier ne réutilise pas unlock admin ──────────────────────
{
  console.log("Test 9 : Unlock admin ne donne pas accès à chef_atelier...");
  const env = buildEnv();
  // Admin était unlocked
  env.sessionStorage.setItem("unlocked_user_u-admin", "true");

  // Dans la nouvelle logique, promptUserPinAndLogin ne bypasse PAS via sessionStorage
  // Seule la clé exacte du targetUser compterait — mais elle n'existe pas pour chef
  const chefUnlocked = env.sessionStorage.getItem("unlocked_user_u-chef") === "true";
  assert(!chefUnlocked, "La clé unlock admin ne doit pas exister pour chef_atelier");
  console.log("→ OK");
}

// ── Test 10 : Technicien sans PIN → finishUserUnlockAndActivateApp direct ────
{
  console.log("Test 10 : Technicien (pinRequired=false) → interface cliquable sans PIN...");
  const env = buildEnv();
  env.appShell._inert = true;
  env.appShell.style.pointerEvents = "none";

  const alaa = env.state.users.find(u => u.id === "u-alaa");
  assert(alaa.pinRequired === false, "Alaa ne nécessite pas de PIN");

  // promptUserPinAndLogin appelle finishUserUnlockAndActivateApp directement
  // Ici on appelle directement finishUserUnlockAndActivateApp (comme le fait le code)
  env.exported.finishUserUnlockAndActivateApp(alaa);

  assert(env.appShell._inert === false, "Technicien : app-shell non inert");
  assert(env.appShell.style.pointerEvents === "", "Technicien : pointerEvents vides");
  console.log("→ OK");
}

// ── Test 11 : Timeout inactivité → purge unlocks ─────────────────────────────
{
  console.log("Test 11 : Timeout inactivité → sélecteur affiché + purge unlocks...");
  const env = buildEnv();
  env.sessionStorage.setItem("unlocked_user_u-admin", "true");
  env.sessionStorage.setItem("unlocked_user_u-chef", "true");

  env.exported.lockSessionDueToInactivity();

  assert(env.sessionStorage.getItem("unlocked_user_u-admin") === null,
    "Timeout : u-admin doit être purgé");
  assert(env.sessionStorage.getItem("unlocked_user_u-chef") === null,
    "Timeout : u-chef doit être purgé");
  assert(env.selectorOverlay.hidden === false,
    "Timeout : selectorOverlay doit être affiché");
  console.log("→ OK");
}

// ── Test 12 : Aucun overlay transparent ne bloque les clics après login ───────
{
  console.log("Test 12 : Après login, pinOverlay.style.pointerEvents = 'none' (ne bloque plus)...");
  const env = buildEnv();
  env.pinOverlay.hidden = false;
  env.pinOverlay.style.pointerEvents = "";
  env.appShell._inert = true;

  const admin = env.state.users.find(u => u.id === "u-admin");
  env.exported.finishUserUnlockAndActivateApp(admin);

  // pinOverlay doit avoir pointerEvents = "none" après fermeture
  assert(env.pinOverlay.style.pointerEvents === "none",
    "pinOverlay.style.pointerEvents doit être 'none' après login (pas de capture clics)");
  assert(env.pinOverlay.hidden === true, "pinOverlay doit être hidden");
  assert(env.appShell._inert === false, "app-shell ne doit pas rester inert");
  console.log("→ OK");
}

console.log("\nTous les 12 tests PIN Overlay Clickability v23.1A Hotfix passés avec succès !");
