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
  admin: "Administrateur",
  chef_atelier: "Chef d'atelier",
  reception: "Réception",
  technicien: "Technicien",
  qualite: "Qualité",
  readonly: "Lecture seule"
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
        list.forEach(l => l({ currentTarget: this, target: this }));
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
const userSubmitBtn = getElement("user-selector-submit");
const userSelectorList = getElement("user-selector-list");
const userSelectorOverlay = getElement("user-selector-overlay");
const appShell = getElement("app-shell");

async function runTests() {
  console.log("Initialisation des actions de session...");
  global.bindUserSessionActions();

  // Test 1: Aucun utilisateur -> bootstrap admin conservé
  const bootstrapRes = normalizeUsers([], []);
  assert.ok(bootstrapRes.length >= 1, "Il doit y avoir au moins un utilisateur bootstrap");
  assert.equal(bootstrapRes[0].role, "admin", "Le bootstrap doit être un admin");
  assert.equal(bootstrapRes[0].active, true, "Le bootstrap admin doit être actif");

  // Configurer 3 utilisateurs (2 actifs, 1 inactif)
  const uAdmin = { id: "u-admin", name: "Admin Test", role: "admin", active: true };
  const uTech = { id: "u-tech", name: "Tech Test", role: "technicien", active: true, resourceId: "r-tech1" };
  const uTechNoRes = { id: "u-tech-no-res", name: "Tech Sans Ressource", role: "technicien", active: true, resourceId: "" };
  const uInactif = { id: "u-inactif", name: "Inactif Test", role: "reception", active: false };

  state.users = [uAdmin, uTech, uTechNoRes, uInactif];
  state.currentUserId = "";
  state.settings.alwaysPromptUserStartup = undefined; // Par défaut

  // Test 2: Plusieurs utilisateurs actifs -> écran choix affiché au démarrage
  localSessionUnlocked = true;
  userSelectorOverlay.hidden = true;
  checkUserSessionStartup();
  assert.equal(userSelectorOverlay.hidden, false, "L'overlay de sélection utilisateur doit être affiché au démarrage");
  assert.equal(appShell.attributes.has("inert"), true, "L'application doit être marquée inert");

  // Test 3: Utilisateur inactif absent de la liste
  global.selectedUserIdForStartup = "";
  renderUserSelectorScreen();
  assert.ok(userSelectorList.innerHTML.includes("Admin Test"), "Admin actif doit être présent");
  assert.ok(userSelectorList.innerHTML.includes("Tech Test"), "Tech actif doit être présent");
  assert.ok(!userSelectorList.innerHTML.includes("Inactif Test"), "Utilisateur inactif doit être absent");

  // Test 4: Choisir tech -> permissions technicien appliquées + warning si pas de ressource
  // A. Technicien avec ressource
  global.selectedUserIdForStartup = "u-tech";
  userSubmitBtn.dispatchEvent("click");
  assert.equal(state.currentUserId, "u-tech", "currentUserId doit passer à u-tech");
  assert.equal(getCurrentUser().id, "u-tech", "getCurrentUser doit retourner u-tech");
  assert.equal(getCurrentUser().role, "technicien");

  // B. Technicien sans ressource
  lastNotification = null;
  global.selectedUserIdForStartup = "u-tech-no-res";
  userSubmitBtn.dispatchEvent("click");
  assert.equal(state.currentUserId, "u-tech-no-res");
  assert.equal(lastNotification.type, "warn", "Un avertissement doit s'afficher si le technicien n'a pas de ressource liée");
  assert.ok(lastNotification.msg.includes("Aucun technicien / ressource"));

  // Test 5: currentUserId inactif -> écran choix forcé
  state.currentUserId = "u-inactif"; // Inactif !
  userSelectorOverlay.hidden = true;
  checkUserSessionStartup();
  assert.equal(userSelectorOverlay.hidden, false, "L'écran doit être forcé si l'utilisateur courant est inactif");

  // Test 6: Un seul utilisateur actif -> comportement conforme à l'option
  const singleAdmin = { id: "u-single-admin", name: "Admin Unique", role: "reception", active: true };
  state.users = [singleAdmin];
  
  // A. Toujours demander = false
  state.settings.alwaysPromptUserStartup = false;
  state.currentUserId = "u-single-admin";
  userSelectorOverlay.hidden = true;
  checkUserSessionStartup();
  assert.equal(userSelectorOverlay.hidden, true, "L'écran de sélection doit être ignoré si un seul actif et alwaysPrompt est faux");

  // B. Toujours demander = true
  state.settings.alwaysPromptUserStartup = true;
  userSelectorOverlay.hidden = true;
  checkUserSessionStartup();
  assert.equal(userSelectorOverlay.hidden, false, "L'écran de sélection doit s'afficher si alwaysPrompt est vrai, même pour un seul utilisateur");

  // Test 7: Bouton "Changer utilisateur" revient à l'écran choix
  userSelectorOverlay.hidden = true;
  sidebarChangeBtn.dispatchEvent("click");
  assert.equal(userSelectorOverlay.hidden, false, "Le clic sur Changer d'utilisateur doit afficher la sélection");

  // Test 8: Audit users.session_selected / users.current_changed
  state.users = [uAdmin, uTech];
  state.currentUserId = ""; // Initial
  state.auditLog = [];
  
  // A. Première sélection (démarrage)
  global.selectedUserIdForStartup = "u-tech";
  userSubmitBtn.dispatchEvent("click");
  let logSelected = state.auditLog.find(l => l.type === "users.session_selected");
  assert.ok(logSelected, "L'audit doit loguer users.session_selected au premier choix de session");
  
  // B. Changement d'utilisateur
  const uReception = { id: "u-reception", name: "Reception Test", role: "reception", active: true };
  state.users.push(uReception);
  global.selectedUserIdForStartup = "u-reception";
  userSubmitBtn.dispatchEvent("click");
  let logChanged = state.auditLog.find(l => l.type === "users.current_changed");
  assert.ok(logChanged, "L'audit doit loguer users.current_changed lors du changement d'utilisateur");
  assert.equal(logChanged.userId, "u-tech", "L'acteur de l'audit doit être l'utilisateur précédent");

  // Test 9: PIN local activé -> prioritaire
  localSessionUnlocked = false; // Poste verrouillé !
  userSelectorOverlay.hidden = true;
  checkUserSessionStartup();
  assert.equal(userSelectorOverlay.hidden, true, "Le choix utilisateur ne doit pas s'afficher si le PIN local n'est pas déverrouillé");
  
  // Déverrouillage PIN local
  localSessionUnlocked = true;
  hideLocalLockOverlay();
  assert.equal(userSelectorOverlay.hidden, false, "Le choix utilisateur doit apparaître automatiquement après déverrouillage du PIN local");

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
