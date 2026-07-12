import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

console.log("Démarrage des tests v22.33C : User Session Startup...");

// 1. Lire les sources des fichiers
const utilsJs = fs.readFileSync("./js/utils.js", "utf8");
const stateJs = fs.readFileSync("./js/state.js", "utf8");
const appJs = fs.readFileSync("./app.js", "utf8");

// 2. Préparer le contexte global mocké
global.window = global;

const storageMap = new Map();
const mockStorage = {
  getItem: (key) => storageMap.has(key) ? storageMap.get(key) : null,
  setItem: (key, val) => storageMap.set(key, String(val)),
  removeItem: (key) => storageMap.delete(key),
  clear: () => storageMap.clear()
};
global.localStorage = mockStorage;
global.sessionStorage = mockStorage;

global.state = { 
  cases: [], 
  bookings: [], 
  users: [],
  currentUserId: "",
  settings: {
    alwaysPromptUserStartup: undefined
  },
  resources: [
    { id: "r-tech1", name: "Ressource Tech 1", role: "technicien", active: true }
  ],
  auditLog: []
};

global.uid = (prefix) => `${prefix}-${Math.random().toString(36).substring(2, 6)}`;
global.USER_ROLES = {
  admin_technique: "Admin technique",
  directeur: "Directeur SAV",
  chef_atelier: "Chef d'atelier",
  reception: "Réception",
  technicien: "Technicien",
  lecture_seule: "Lecture seule"
};

// Mocks UI / Interactions
let lastNotification = null;
let lastQuietNotification = null;
let renderCount = 0;

global.notifyUser = (msg, type) => {
  lastNotification = { msg, type };
};
global.quietNotify = (msg, type) => {
  lastQuietNotification = { msg, type };
};
global.render = () => {
  renderCount += 1;
};
global.saveState = () => {};

// Mock document.querySelector & getElementById
const elements = {};
const getElement = (id) => {
  const cleanId = id.replace(/[.#]/g, "");
  if (!elements[cleanId]) {
    elements[cleanId] = {
      id: cleanId,
      hidden: true,
      disabled: false,
      value: "",
      checked: false,
      innerHTML: "",
      textContent: "",
      dataset: {},
      style: {},
      classList: {
        classes: new Set(),
        add(cls) { this.classes.add(cls); },
        remove(cls) { this.classes.delete(cls); },
        contains(cls) { return this.classes.has(cls); }
      },
      attributes: new Map(),
      listeners: new Map(),
      addEventListener(event, listener) {
        if (!this.listeners.has(event)) this.listeners.set(event, []);
        this.listeners.get(event).push(listener);
      },
      dispatchEvent(event) {
        const list = this.listeners.get(event) || [];
        list.forEach(l => l({ currentTarget: this, target: this, preventDefault: () => {} }));
      },
      setAttribute(name, value) {
        this.attributes.set(name, value);
      },
      removeAttribute(name) {
        this.attributes.delete(name);
      },
      closest(sel) { 
        return this; 
      },
      querySelector(sel) {
        return getElement(sel);
      },
      querySelectorAll(sel) {
        return [];
      }
    };
  }
  return elements[cleanId];
};

global.document = {
  getElementById: (id) => getElement(id),
  querySelector: (sel) => getElement(sel),
  querySelectorAll: (sel) => {
    // Si on demande les cartes, simuler les cartes du DOM
    if (sel.includes("user-selector-card")) {
      const activeUsers = state.users.filter(u => u.active !== false);
      return activeUsers.map(u => {
        const el = getElement(`card-${u.id}`);
        el.dataset = { userId: u.id };
        return el;
      });
    }
    return [];
  },
  createElement: (tag) => {
    return {
      className: "",
      textContent: "",
      setAttribute: () => {},
      appendChild: () => {},
      classList: {
        add: () => {}
      },
      remove: () => {}
    };
  }
};

global.escapeHtml = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Mock local lock security gate
let localSessionUnlocked = true;
global.isLocalSessionUnlocked = () => localSessionUnlocked;
global.resetLocalSecurityIdleTimer = () => {};

// Évaluer les scripts dans le contexte global
vm.runInThisContext(utilsJs);
vm.runInThisContext(stateJs);
vm.runInThisContext("global.state = state;");

// Pour app.js, on retire l'appel direct initApp(); à la fin pour contrôler manuellement l'initialisation
const appJsClean = appJs.replace("initApp();", "/* initApp(); */");
vm.runInThisContext(appJsClean);

// Re-override mock functions that might have been defined in scripts
global.notifyUser = (msg, type) => {
  lastNotification = { msg, type };
};
global.quietNotify = (msg, type) => {
  lastQuietNotification = { msg, type };
};
global.isLocalSessionUnlocked = () => localSessionUnlocked;

// Ré-importer explicitement les fonctions de test
const {
  checkUserSessionStartup,
  renderCurrentSessionIndicator,
  setCurrentUser,
  getCurrentUser,
  getCurrentActor,
  normalizeUsers,
  getUserById,
  addAuditLog,
  hideLocalLockOverlay
} = global;

// Récupérer les bindings du test
const sidebarChangeBtn = getElement("sidebar-change-user-btn");
const changeUserSettingsBtn = getElement("change-user-settings-btn");
const alwaysPromptCheckbox = getElement("always-prompt-startup");
const userLoginOverlay = getElement("user-login-overlay");
const userLoginForm = getElement("user-login-form");
userLoginForm.elements = {
  userId: { value: "" },
  pin: { value: "" }
};
const userLoginSelect = getElement("user-login-select");
const appShell = getElement("app-shell");

async function runTests() {
  console.log("Initialisation des actions de session...");
  global.bindUserSessionActions();

  // Test 1: Aucun utilisateur -> aucun compte caché et premier accès explicite
  const emptyUsers = normalizeUsers([], []);
  assert.deepEqual(emptyUsers, [], "Aucun administrateur bootstrap ne doit être créé");
  assert.equal(isFirstAccessRecoveryRequired({ users: emptyUsers }), true, "Le premier accès explicite doit être requis");
  state.users = emptyUsers;
  state.currentUserId = "";
  const firstAccessOverlay = getElement("first-access-overlay");
  firstAccessOverlay.hidden = true;
  userLoginOverlay.hidden = true;
  checkUserSessionStartup();
  assert.equal(firstAccessOverlay.hidden, false, "L'écran de premier accès explicite doit être affiché");
  assert.equal(userLoginOverlay.hidden, true, "La sélection utilisateur ne doit pas remplacer le premier accès");

  // Configurer explicitement 3 utilisateurs avec les rôles canoniques
  const [uAdmin, uTech, uTechNoRes, uInactif] = normalizeUsers([
    { id: "u-admin", name: "Admin Test", role: "admin_technique", active: true },
    { id: "u-tech", name: "Tech Test", role: "technicien", active: true, resourceId: "r-tech1" },
    { id: "u-tech-no-res", name: "Tech Sans Ressource", role: "technicien", active: true, resourceId: "" },
    { id: "u-inactif", name: "Inactif Test", role: "reception", active: false }
  ], state.resources);

  state.users = [uAdmin, uTech, uTechNoRes, uInactif];
  state.currentUserId = "";
  state.settings.alwaysPromptUserStartup = undefined; // Par défaut

  // Test 2: Plusieurs utilisateurs actifs -> écran choix affiché au démarrage
  localSessionUnlocked = true;
  userLoginOverlay.hidden = true;
  checkUserSessionStartup();
  assert.equal(userLoginOverlay.hidden, false, "L'overlay de sélection utilisateur doit être affiché au démarrage");
  assert.equal(appShell.attributes.has("inert"), true, "L'application doit être marquée inert");

  // Test 3: Utilisateur inactif absent de la liste
  global.selectedUserIdForStartup = "";
  renderUserLoginScreen();
  assert.ok(userLoginSelect.innerHTML.includes("Admin Test"), "Admin actif doit être présent");
  assert.ok(userLoginSelect.innerHTML.includes("Tech Test"), "Tech actif doit être présent");
  assert.ok(!userLoginSelect.innerHTML.includes("Inactif Test"), "Utilisateur inactif doit être absent");

  // Test 4: Choisir tech -> permissions technicien appliquées + warning si pas de ressource
  // A. Technicien avec ressource
  global.selectedUserIdForStartup = "u-tech";
  userLoginForm.elements.userId.value = global.selectedUserIdForStartup;
  userLoginForm.dispatchEvent("submit");
  assert.equal(state.currentUserId, "u-tech", "currentUserId doit passer à u-tech");
  assert.equal(getCurrentUser().id, "u-tech", "getCurrentUser doit retourner u-tech");
  assert.equal(getCurrentUser().role, "technicien");

  // B. Technicien sans ressource
  lastNotification = null;
  global.selectedUserIdForStartup = "u-tech-no-res";
  userLoginForm.elements.userId.value = global.selectedUserIdForStartup;
  userLoginForm.dispatchEvent("submit");
  assert.equal(state.currentUserId, "u-tech-no-res");
  assert.equal(lastNotification.type, "warn", "Un avertissement doit s'afficher si le technicien n'a pas de ressource liée");
  assert.ok(lastNotification.msg.includes("Aucun technicien / ressource"));

  // Test 5: currentUserId inactif -> écran choix forcé
  state.currentUserId = "u-inactif"; // Inactif !
  userLoginOverlay.hidden = true;
  checkUserSessionStartup();
  assert.equal(userLoginOverlay.hidden, false, "L'écran doit être forcé si l'utilisateur courant est inactif");

  // Test 6: Un seul utilisateur actif -> comportement conforme à l'option
  const singleReception = normalizeUsers([
    { id: "u-single-reception", name: "Réception unique", role: "reception", active: true }
  ], state.resources)[0];
  state.users = [singleReception];
  
  // A. Toujours demander = false
  state.settings.alwaysPromptUserStartup = false;
  state.currentUserId = "u-single-reception";
  userLoginOverlay.hidden = true;
  checkUserSessionStartup();
  assert.equal(userLoginOverlay.hidden, true, "L'écran de sélection doit être ignoré si un seul actif et alwaysPrompt est faux");

  // B. Toujours demander = true
  state.settings.alwaysPromptUserStartup = true;
  userLoginOverlay.hidden = true;
  checkUserSessionStartup();
  assert.equal(userLoginOverlay.hidden, false, "L'écran de sélection doit s'afficher si alwaysPrompt est vrai, même pour un seul utilisateur");

  // Test 7: Bouton "Changer utilisateur" revient à l'écran choix
  userLoginOverlay.hidden = true;
  sidebarChangeBtn.dispatchEvent("click");
  assert.equal(userLoginOverlay.hidden, false, "Le clic sur Changer d'utilisateur doit afficher la sélection");

  // Test 8: Audit users.session_selected / users.current_changed
  state.users = [uAdmin, uTech];
  state.currentUserId = ""; // Initial
  state.auditLog = [];
  
  // A. Première sélection (démarrage)
  global.selectedUserIdForStartup = "u-tech";
  userLoginForm.elements.userId.value = global.selectedUserIdForStartup;
  userLoginForm.dispatchEvent("submit");
  let logSelected = state.auditLog.find(l => l.type === "users.session_selected");
  assert.ok(logSelected, "L'audit doit loguer users.session_selected au premier choix de session");
  
  // B. Changement d'utilisateur
  const uReception = normalizeUsers([
    { id: "u-reception", name: "Reception Test", role: "reception", active: true }
  ], state.resources)[0];
  state.users.push(uReception);
  global.selectedUserIdForStartup = "u-reception";
  userLoginForm.elements.userId.value = global.selectedUserIdForStartup;
  userLoginForm.dispatchEvent("submit");
  let logChanged = state.auditLog.find(l => l.type === "users.current_changed");
  assert.ok(logChanged, "L'audit doit loguer users.current_changed lors du changement d'utilisateur");
  assert.equal(logChanged.userId, "u-tech", "L'acteur de l'audit doit être l'utilisateur précédent");

  // Test 9: PIN local activé -> prioritaire
  localSessionUnlocked = false; // Poste verrouillé !
  userLoginOverlay.hidden = true;
  checkUserSessionStartup();
  assert.equal(userLoginOverlay.hidden, true, "Le choix utilisateur ne doit pas s'afficher si le PIN local n'est pas déverrouillé");
  
  // Déverrouillage PIN local
  localSessionUnlocked = true;
  hideLocalLockOverlay();
  assert.equal(userLoginOverlay.hidden, false, "Le choix utilisateur doit apparaître automatiquement après déverrouillage du PIN local");

  // Test 10: Paramètre check-card admin-only
  state.currentUserId = "u-tech"; // Non admin
  renderCurrentSessionIndicator();
  assert.equal(alwaysPromptCheckbox.disabled, true, "L'option de prompt doit être désactivée pour les non-administrateurs");

  state.currentUserId = "u-admin"; // Admin
  renderCurrentSessionIndicator();
  assert.equal(alwaysPromptCheckbox.disabled, false, "L'option de prompt doit être active pour les administrateurs");

  console.log("Tests v22.33C complétés avec succès !");
}

runTests().catch(err => {
  console.error("Échec des tests :", err);
  process.exit(1);
});
