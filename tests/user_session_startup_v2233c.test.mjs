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
global.addEventListener = () => {};
global.removeEventListener = () => {};

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
Object.defineProperty(global, "navigator", { value: { onLine: false }, configurable: true, writable: true });
global.getSupabaseUser = async () => null;

global.document = {
  addEventListener: () => {},
  removeEventListener: () => {},
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
global.ensureCurrentTabAllowed = () => {};
global.saveState = () => Promise.resolve(true);
global.signOutSupabaseSession = async () => ({ ok: true });

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

  // Test 1: Aucun utilisateur -> porte cloud obligatoire, même hors ligne.
  const emptyUsers = normalizeUsers([], []);
  assert.deepEqual(emptyUsers, [], "Aucun administrateur bootstrap ne doit être créé");
  state.users = emptyUsers;
  state.currentUserId = "";
  const firstAccessOverlay = getElement("first-access-overlay");
  firstAccessOverlay.hidden = true;
  userLoginOverlay.hidden = true;
  await checkUserSessionStartup();
  assert.equal(firstAccessOverlay.hidden, false, "L'écran de connexion cloud doit être affiché");
  assert.equal(userLoginOverlay.hidden, true, "La sélection utilisateur ne doit pas remplacer la connexion");

  // Configurer explicitement plusieurs identités validées sur le même poste.
  const now = new Date().toISOString();
  const [uAdmin, uTech, uTechNoRes, uInactif] = normalizeUsers([
    { id: "u-admin", name: "Admin Test", role: "admin_technique", active: true, authUserId: "auth-admin", authSource: "supabase_membership", membershipValidatedAt: now, membershipWorkshopId: "00000000-0000-0000-0000-000000000001" },
    { id: "u-tech", name: "Tech Test", role: "technicien", active: true, resourceId: "r-tech1", authUserId: "auth-tech", authSource: "supabase_membership", membershipValidatedAt: now, membershipWorkshopId: "00000000-0000-0000-0000-000000000001" },
    { id: "u-tech-no-res", name: "Tech Sans Ressource", role: "technicien", active: true, resourceId: "", authUserId: "auth-tech-no-res", authSource: "supabase_membership", membershipValidatedAt: now, membershipWorkshopId: "00000000-0000-0000-0000-000000000001" },
    { id: "u-inactif", name: "Inactif Test", role: "reception", active: false, authUserId: "auth-inactif", authSource: "supabase_membership", membershipValidatedAt: now, membershipWorkshopId: "00000000-0000-0000-0000-000000000001" }
  ], state.resources);

  state.users = [uAdmin, uTech, uTechNoRes, uInactif];
  state.currentUserId = "";
  state.settings.alwaysPromptUserStartup = undefined; // Par défaut

  // Test 2: sans identité courante, le cache multi-utilisateur ne permet aucun accès hors ligne.
  localSessionUnlocked = true;
  userLoginOverlay.hidden = true;
  firstAccessOverlay.hidden = true;
  await checkUserSessionStartup();
  assert.equal(firstAccessOverlay.hidden, false, "Une identité courante validée est obligatoire hors ligne");
  assert.equal(userLoginOverlay.hidden, true, "Aucun sélecteur multi-utilisateur ne doit être exposé");
  assert.equal(appShell.attributes.has("inert"), true, "L'application doit être marquée inert");

  // Test 3: seule l'identité courante validée est affichée et la sélection est figée.
  state.currentUserId = "u-tech";
  firstAccessOverlay.hidden = true;
  userLoginOverlay.hidden = true;
  await checkUserSessionStartup();
  global.selectedUserIdForStartup = "";
  renderUserLoginScreen();
  assert.ok(userLoginSelect.innerHTML.includes("Tech Test"), "Tech actif doit être présent");
  assert.ok(!userLoginSelect.innerHTML.includes("Admin Test"), "Une autre identité validée doit rester absente");
  assert.ok(!userLoginSelect.innerHTML.includes("Inactif Test"), "Utilisateur inactif doit être absent");
  assert.equal(userLoginSelect.disabled, true, "La sélection d'identité doit être verrouillée");

  // Test 4: une soumission falsifiée vers une autre identité est rejetée hors ligne.
  userLoginForm.elements.userId.value = "u-admin";
  userLoginForm.elements.pin.value = "";
  userLoginForm.dispatchEvent("submit");
  assert.equal(state.currentUserId, "u-tech", "L'identité courante ne doit pas changer");
  assert.match(getElement("user-login-status").textContent, /ne correspond pas à la session authentifiée/u);

  // Test 5: une identité courante inactive est refusée, sans repli vers un autre cache.
  state.currentUserId = "u-inactif"; // Inactif !
  userLoginOverlay.hidden = true;
  firstAccessOverlay.hidden = true;
  await checkUserSessionStartup();
  assert.equal(firstAccessOverlay.hidden, false, "L'écran cloud doit être forcé si l'identité courante est inactive");
  assert.equal(userLoginOverlay.hidden, true);

  // Test 6: une identité sensible peut déverrouiller uniquement son propre PIN.
  state.users = [uAdmin, uTech];
  uAdmin.pinHash = "mockhash:739251:admin-salt";
  uAdmin.pinSalt = "admin-salt";
  state.currentUserId = "u-admin";
  sessionStorage.removeItem("nimr-user-pin-unlocked");
  userLoginOverlay.hidden = true;
  firstAccessOverlay.hidden = true;
  await checkUserSessionStartup();
  assert.equal(userLoginOverlay.hidden, false, "Le PIN de l'identité sensible courante doit être demandé");
  renderUserLoginScreen();
  assert.ok(userLoginSelect.innerHTML.includes("Admin Test"));
  assert.ok(!userLoginSelect.innerHTML.includes("Tech Test"));
  userLoginForm.elements.userId.value = "u-admin";
  userLoginForm.elements.pin.value = "739251";
  const submitListeners = userLoginForm.listeners.get("submit") || [];
  await Promise.all(submitListeners.map((listener) => listener({ preventDefault: () => {} })));
  assert.equal(sessionStorage.getItem("nimr-user-pin-unlocked"), "u-admin");
  assert.equal(state.currentUserId, "u-admin");

  // Test 7: Déconnexion efface l'identité courante et retourne à la porte cloud.
  firstAccessOverlay.hidden = true;
  await triggerLogout();
  assert.equal(firstAccessOverlay.hidden, false, "Le clic sur Déconnexion doit afficher la connexion cloud d'atelier");
  assert.equal(state.currentUserId, "", "currentUserId doit être vidé");

  // Test 8: le PIN poste local reste prioritaire sur la porte d'identité.
  state.users = [uTech];
  state.currentUserId = "u-tech";
  localSessionUnlocked = false; // Poste verrouillé !
  userLoginOverlay.hidden = true;
  firstAccessOverlay.hidden = true;
  const lockedResult = await checkUserSessionStartup();
  assert.equal(lockedResult.code, "LOCAL_WORKSTATION_LOCKED");
  assert.equal(userLoginOverlay.hidden, true, "Le choix utilisateur ne doit pas s'afficher si le PIN local n'est pas déverrouillé");
  assert.equal(firstAccessOverlay.hidden, true, "La porte cloud ne doit pas devancer le PIN poste");

  // Test 9: après déverrouillage poste, la même identité validée continue.
  localSessionUnlocked = true;
  const unlockedResult = await checkUserSessionStartup();
  assert.equal(unlockedResult.code, "OFFLINE_CURRENT_IDENTITY");
  assert.equal(state.currentUserId, "u-tech");

  // Test 10: Paramètre check-card admin-only conservé.
  state.users = [uAdmin, uTech];
  state.currentUserId = "u-tech"; // Non admin
  renderCurrentSessionIndicator();
  assert.equal(alwaysPromptCheckbox.disabled, true, "L'option de prompt doit être désactivée pour les non-administrateurs");

  state.currentUserId = "u-admin"; // Admin
  renderCurrentSessionIndicator();
  assert.equal(alwaysPromptCheckbox.disabled, false, "L'option de prompt doit être active pour les administrateurs");

  clearTimeout(vm.runInThisContext("userSessionIdleTimer"));
  console.log("Tests v22.33C complétés avec succès !");
}

runTests().catch(err => {
  console.error("Échec des tests :", err);
  process.exit(1);
});
