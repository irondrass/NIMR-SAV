const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const STORAGE_KEY = "nimr-carrosserie-v1";
const STORAGE_MIRROR_KEY = `${STORAGE_KEY}:mirror`;
const STORAGE_SNAPSHOTS_KEY = `${STORAGE_KEY}:snapshots`;
const STORAGE_META_KEY = `${STORAGE_KEY}:meta`;
const SESSION_EMERGENCY_KEY = `${STORAGE_KEY}:session-emergency`;
const CLOUD_UPDATED_META_KEY = `${STORAGE_KEY}:last-cloud-updated-at`;
const LOCAL_CHANGE_META_KEY = `${STORAGE_KEY}:last-local-change-at`;
const LOCAL_SECURITY_KEY = `${STORAGE_KEY}:local-security`;
const LOCAL_SECURITY_SESSION_KEY = `${STORAGE_KEY}:local-security-unlocked`;
const LOCAL_SECURITY_FAILURE_KEY = `${STORAGE_KEY}:local-security-failures`;
const AUTOSAVE_SNAPSHOT_LIMIT = 8;
const AUTOSAVE_CLOUD_DEBOUNCE_MS = 1500;
const DB_NAME = "nimr-carrosserie-db";
const DB_VERSION = 2;
const PHOTO_STORE = "photos";
const DOCUMENT_STORE = "documents";
const VEHICLE_DATA_URL = "data/vehicles.json";
const STEP_MINUTES = 15;
const FAST_LANE_DEFAULT_HOURS = 4;
const APP_VERSION = "v22.22";
const BACKUP_APP_ID = "nimr-carrosserie";
const BACKUP_FORMAT_VERSION = 2;
const WORKSHOP_NAME = "NIMR SAV";
const MAX_ESTIMATE_IMPORT_SIZE = 10 * 1024 * 1024;
const ESTIMATE_IMPORT_EXTENSIONS = ["pdf", "xlsx", "csv"];
const MAX_PHOTO_SIZE = 8 * 1024 * 1024;
const MAX_BACKUP_IMPORT_SIZE = 50 * 1024 * 1024;
const MAX_PHOTO_EDGE = 1600;
const PHOTO_JPEG_QUALITY = 0.82;
const ALLOWED_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
const LOCAL_SECURITY_MAX_FAILED_ATTEMPTS = 5;
const LOCAL_SECURITY_LOCKOUT_MS = 5 * 60 * 1000;
const LOCAL_SECURITY_IDLE_MS = 15 * 60 * 1000;
const MAX_PLANNING_SEARCH_DAYS = 90;
const MAX_PLANNING_ITERATIONS = 10000;
const RECEPTION_GRACE_HOURS = 2;
const DELIVERY_ALERT_HOURS = 4;
const MAX_STEP_DURATION_HOURS = 80;

const DEFAULT_WORK_HOURS = {
  0: [],
  1: [
    ["08:00", "12:00"],
    ["13:00", "17:00"],
  ],
  2: [
    ["08:00", "12:00"],
    ["13:00", "17:00"],
  ],
  3: [
    ["08:00", "12:00"],
    ["13:00", "17:00"],
  ],
  4: [
    ["08:00", "12:00"],
    ["13:00", "17:00"],
  ],
  5: [
    ["08:00", "12:00"],
    ["13:00", "17:00"],
  ],
  6: [["08:00", "13:00"]],
};

const DEFAULT_DURATIONS = {
  body: 6,
  oilService: 0,
  mechanical: 0,
  electrical: 0,
  prep: 4,
  paint: 3,
  reassembly: 4,
  finish: 2,
  quality: 0.25,
};

const DURATIONS = [
  ["body", "Tôlerie + démontage"],
  ["oilService", "Vidange / entretien rapide"],
  ["mechanical", "Réparation mécanique"],
  ["electrical", "Réparation électrique"],
  ["prep", "Préparation"],
  ["paint", "Peinture + vernis"],
  ["reassembly", "Remontage"],
  ["finish", "Finition + lavage"],
  ["quality", "Contrôle qualité"],
];

const DEFAULT_QUALITY_CHECKS = [
  "Alignement carrosserie",
  "Teinte et vernis",
  "Remontage accessoires",
  "Nettoyage intérieur/extérieur",
  "Essai final et validation client",
];

const PHOTO_CATEGORIES = {
  before: "Avant réparation",
  during: "En cours",
  after: "Après réparation",
  supplement: "Complément avant accord",
};


const CLAIM_STATUS_LABELS = {
  draft: "Brouillon",
  expert_pending: "En attente expert",
  client_pending: "En attente client",
  approved: "Accepté",
  refused: "Refusé",
  planned: "Planifié",
  done: "Terminé",
};

const ACTION_LABELS = {
  claim: "Créer le premier ordre de travail",
  labor: "Saisir la main-d’œuvre",
  expertApproved: "Valider l'accord expert",
  clientApproved: "Valider client / interne",
  appointment: "Fixer le RDV de dépôt",
  received: "Confirmer la réception véhicule",
  workStarted: "Démarrer les travaux",
  workCompleted: "Terminer les travaux",
  qualityApproved: "Valider le contrôle qualité",
  delivered: "Livrer le véhicule",
  invoiced: "Facturer le dossier",
};

const PARTS_STATUS_OPTIONS = [
  ["unchecked", "Non vérifié"],
  ["not_applicable", "Non applicable"],
  ["available", "Disponible"],
  ["partial", "Partiellement disponible"],
  ["ordered", "Commandé"],
  ["waiting_parts", "En attente pièces"],
  ["received", "Reçu"],
  ["blocked_parts", "Bloqué pièces"],
];

const PARTS_STATUS_LABELS = Object.fromEntries(PARTS_STATUS_OPTIONS);
const BLOCKING_PARTS_STATUSES = new Set(["waiting_parts", "blocked_parts"]);
const BLOCKER_REASON_OPTIONS = [
  ["", "Aucun blocage"],
  ["waiting_parts", "Attente pièces"],
  ["waiting_customer", "Attente client"],
  ["waiting_internal_approval", "Attente accord interne"],
  ["waiting_diagnostic", "Attente diagnostic"],
  ["waiting_technician", "Attente disponibilité technicien"],
  ["waiting_lift", "Attente disponibilité pont"],
  ["other", "Autre"],
];
const BLOCKER_REASON_LABELS = Object.fromEntries(BLOCKER_REASON_OPTIONS);

const FLAG_HISTORY_EVENTS = {
  expertApproved: { on: ["expert.approved", "Accord expert validé"] },
  clientApproved: {
    on: ["client.approved", "Validation client/interne enregistrée"],
    off: ["client.revoked", "Validation client/interne retirée"],
  },
  received: { on: ["vehicle.received", "Véhicule reçu à l'atelier"] },
  workStarted: { on: ["work.started", "Travaux démarrés"], off: ["work.paused", "Travaux remis en attente"] },
  workCompleted: { on: ["work.completed", "Travaux terminés"], off: ["work.reopened", "Travaux rouverts"] },
  qualityApproved: {
    on: ["quality.approved", "Contrôle qualité validé"],
    off: ["quality.revoked", "Contrôle qualité annulé"],
  },
  delivered: {
    on: ["vehicle.delivered", "Livraison effectuée"],
    off: ["vehicle.delivery.revoked", "Livraison annulée"],
  },
  invoiced: {
    on: ["case.invoiced", "Dossier facturé et clôturé"],
    off: ["case.invoice.revoked", "Facturation annulée"],
  },
};

const WORKFLOW = [
  ["created", "Fiche dossier"],
  ["photos", "Photos avant réparation"],
  ["expert", "Expert assigné"],
  ["expertApproved", "Accord expert"],
  ["clientApproved", "Validation client/interne"],
  ["appointment", "RDV fixé"],
  ["vehiclePending", "En attente réception"],
  ["received", "Véhicule reçu"],
  ["assigned", "Travaux planifiés"],
  ["workStarted", "Travaux en cours"],
  ["workCompleted", "Travaux terminés"],
  ["qualityApproved", "Contrôle qualité"],
  ["delivered", "Livraison"],
  ["invoiced", "Dossier facturé"],
];

const STEP_TEMPLATES = [
  {
    key: "body",
    title: "Tôlerie + démontage",
    role: "tolier",
    color: "#1d6b75",
  },
  {
    key: "oilService",
    title: "Vidange / entretien rapide",
    role: "mecanicien",
    equipmentRole: "pont_vidange",
    color: "#4c7f54",
  },
  {
    key: "mechanical",
    title: "Réparation mécanique",
    role: "mecanicien",
    equipmentRole: "pont_mecanique",
    color: "#5f6f35",
  },
  {
    key: "prep",
    title: "Préparation avant peinture",
    role: "peintre",
    equipmentRole: "zone_preparation",
    color: "#806045",
  },
  {
    key: "paint",
    title: "Peinture + vernis",
    role: "peintre",
    equipmentRole: "cabine",
    color: "#b54040",
  },
  {
    key: "electrical",
    title: "Réparation électrique",
    role: "electricien",
    color: "#6f4d9a",
  },
  {
    key: "reassembly",
    title: "Remontage",
    role: "tolier",
    color: "#11415f",
  },
  {
    key: "finish",
    title: "Finition + lavage",
    role: "peintre",
    color: "#c96336",
  },
  {
    key: "quality",
    title: "Contrôle qualité",
    role: "controle",
    color: "#1f7a54",
  },
];

const ROLE_LABELS = {
  tolier: "Tôlier",
  mecanicien: "Mécanicien",
  electricien: "Électricien",
  peintre: "Peintre",
  zone_preparation: "Zone de préparation",
  cabine: "Cabine peinture",
  pont_vidange: "Pont vidange",
  pont_mecanique: "Pont grands travaux mécaniques",
  controle: "Contrôle qualité",
};


const SERVICE_TYPE_OPTIONS = [
  ["auto", "Automatique"],
  ["tolerie", "Tôlerie"],
  ["mecanique", "Mécanique"],
  ["electrique", "Électrique"],
  ["peinture", "Peinture"],
];

const SERVICE_TYPE_CONFIG = {
  auto: { label: "Automatique" },
  tolerie: { label: "Tôlerie", role: "tolier", title: "Tôlerie / carrosserie" },
  mecanique: { label: "Mécanique", role: "mecanicien", title: "Réparation mécanique", equipmentRole: "pont_mecanique" },
  electrique: { label: "Électrique", role: "electricien", title: "Réparation électrique", equipmentRole: null },
  peinture: { label: "Peinture", role: "peintre", title: "Peinture / préparation" },
};

const ESTIMATE_PLANNING_KEYS = ["body", "oilService", "mechanical", "electrical", "prep", "paint", "reassembly", "finish"];
const ESTIMATE_ALLOWED_KEYS = [...ESTIMATE_PLANNING_KEYS, "quality"];

const statusLabels = {
  estimate: "Fiche dossier",
  approvals: "Accords",
  appointment: "RDV à fixer",
  appointmentScheduled: "RDV fixé",
  noShow: "Client absent",
  awaitingVehicle: "En attente réception véhicule",
  vehicleReceived: "Véhicule reçu",
  workScheduled: "Travaux planifiés",
  work: "En travaux",
  quality: "Contrôle qualité",
  delivered: "Livré",
  invoiced: "Clôturé & Facturé",
};

const DAY_LABELS = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];
let vehicleRecords = [];
let vehicleDatabaseLoaded = false;

let photoDbPromise = null;
const photoObjectUrls = new Map();
const legacyPhotoPayloads = new Map();

let state = loadState();
let activeTab = "dossiers";
let activeCaseId = state.cases[0]?.id ?? null;
let activeCaseDetailTab = "resume";
let generatedProposals = {};
let estimateImportPreviews = {};
let localSecurityIdleTimer = null;
let localSecurityIdleEventsBound = false;
let localSecurityReturnFocus = null;

function notifyUser(message, variant = "info") {
  const text = Array.isArray(message) ? message.join("\n") : String(message || "");
  if (!text) return;
  const region = $("#toast-region");
  if (!region) {
    console.warn(text);
    return;
  }
  const toast = document.createElement("div");
  toast.className = `toast toast-${variant}`;
  toast.setAttribute("role", variant === "error" ? "alert" : "status");
  toast.textContent = text;
  region.appendChild(toast);
  window.setTimeout(() => {
    toast.classList.add("toast-leaving");
    window.setTimeout(() => toast.remove(), 220);
  }, variant === "error" ? 6500 : 4200);
}

function bytesToBase64(bytes) {
  let binary = "";
  new Uint8Array(bytes || []).forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(String(value || ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function getBrowserCrypto() {
  return globalThis.crypto?.subtle ? globalThis.crypto : null;
}

function readLocalSecurityConfig() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_SECURITY_KEY) || "{}");
  } catch (error) {
    console.warn("Configuration sécurité locale illisible", error);
    return {};
  }
}

function readLocalSecurityFailures() {
  try {
    const value = JSON.parse(localStorage.getItem(LOCAL_SECURITY_FAILURE_KEY) || "{}");
    return {
      attempts: Number(value.attempts || 0),
      lockedUntil: Number(value.lockedUntil || 0),
    };
  } catch (error) {
    return { attempts: 0, lockedUntil: 0 };
  }
}

function writeLocalSecurityFailures(value) {
  try {
    localStorage.setItem(LOCAL_SECURITY_FAILURE_KEY, JSON.stringify(value));
  } catch (error) {
    // Non critique.
  }
}

function clearLocalSecurityFailures() {
  try {
    localStorage.removeItem(LOCAL_SECURITY_FAILURE_KEY);
  } catch (error) {
    // Non critique.
  }
}

function getLocalSecurityLockoutRemainingMs() {
  const failures = readLocalSecurityFailures();
  return Math.max(0, Number(failures.lockedUntil || 0) - Date.now());
}

function recordLocalSecurityFailure() {
  const previous = readLocalSecurityFailures();
  const attempts = Number(previous.attempts || 0) + 1;
  const lockedUntil = attempts >= LOCAL_SECURITY_MAX_FAILED_ATTEMPTS
    ? Date.now() + LOCAL_SECURITY_LOCKOUT_MS
    : 0;
  const next = { attempts, lockedUntil };
  writeLocalSecurityFailures(next);
  return next;
}

function isLocalPinEnabled() {
  const config = readLocalSecurityConfig();
  return Boolean(config.enabled && config.salt && config.hash);
}

function isLocalSessionUnlocked() {
  if (!isLocalPinEnabled()) return true;
  try {
    return sessionStorage.getItem(LOCAL_SECURITY_SESSION_KEY) === "true";
  } catch (error) {
    return false;
  }
}

async function deriveLocalPinHash(pin, saltBase64) {
  const cryptoApi = getBrowserCrypto();
  if (!cryptoApi) throw new Error("Le chiffrement navigateur n'est pas disponible sur ce poste.");
  const material = await cryptoApi.subtle.importKey(
    "raw",
    new TextEncoder().encode(String(pin || "")),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await cryptoApi.subtle.deriveBits(
    { name: "PBKDF2", salt: base64ToBytes(saltBase64), iterations: 120000, hash: "SHA-256" },
    material,
    256,
  );
  return bytesToBase64(bits);
}

async function verifyLocalPin(pin) {
  const config = readLocalSecurityConfig();
  if (!config.enabled || !config.salt || !config.hash) return true;
  const remainingMs = getLocalSecurityLockoutRemainingMs();
  if (remainingMs > 0) {
    throw new Error(`Trop de tentatives. Réessayez dans ${Math.ceil(remainingMs / 60000)} min.`);
  }
  const hash = await deriveLocalPinHash(pin, config.salt);
  const valid = hash === config.hash;
  if (!valid) {
    recordLocalSecurityFailure();
    return false;
  }
  clearLocalSecurityFailures();
  return true;
}

function setLocalSecurityStatus(message, variant = "info") {
  const target = $("#local-security-status");
  if (!target) return;
  target.textContent = message;
  target.className = `muted backup-status ${variant === "error" ? "status-error" : variant === "ok" ? "status-ok" : ""}`;
}

function renderLocalSecurityStatus() {
  if (isLocalPinEnabled()) {
    setLocalSecurityStatus("PIN local actif. Verrouillage automatique après 15 min d'inactivité. Attention : le PIN ne chiffre pas les données locales.", "ok");
  } else {
    setLocalSecurityStatus("Aucun PIN local actif. Activez-le sur les postes partagés.", "warn");
  }
}

async function setLocalPin(pin) {
  const cleanPin = String(pin || "").trim();
  if (cleanPin.length < 4) throw new Error("Le PIN doit contenir au moins 4 caractères.");
  const cryptoApi = getBrowserCrypto();
  if (!cryptoApi) throw new Error("Le chiffrement navigateur n'est pas disponible sur ce poste.");
  const salt = new Uint8Array(16);
  cryptoApi.getRandomValues(salt);
  const saltBase64 = bytesToBase64(salt);
  const hash = await deriveLocalPinHash(cleanPin, saltBase64);
  localStorage.setItem(LOCAL_SECURITY_KEY, JSON.stringify({
    enabled: true,
    salt: saltBase64,
    hash,
    kdf: "PBKDF2-SHA256",
    iterations: 120000,
    updatedAt: new Date().toISOString(),
  }));
  sessionStorage.setItem(LOCAL_SECURITY_SESSION_KEY, "true");
  clearLocalSecurityFailures();
}

function hideLocalLockOverlay() {
  const overlay = $("#local-lock-overlay");
  if (overlay) overlay.hidden = true;
  document.querySelector(".app-shell")?.removeAttribute("inert");
  resetLocalSecurityIdleTimer();
}

function showLocalLockOverlay() {
  const overlay = $("#local-lock-overlay");
  const form = $("#local-lock-form");
  const status = $("#local-lock-status");
  if (!overlay || !form) return;
  window.clearTimeout(localSecurityIdleTimer);
  localSecurityReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  document.querySelector(".app-shell")?.setAttribute("inert", "");
  overlay.hidden = false;
  if (status) status.textContent = "";
  const pinInput = form.elements?.pin;
  if (pinInput) {
    pinInput.value = "";
    window.setTimeout(() => pinInput.focus(), 60);
  }
  if (form.dataset.bound === "true") return;
  form.dataset.bound = "true";
  form.addEventListener("keydown", (event) => trapFocusWithin(form, event));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const ok = await verifyLocalPin(form.elements.pin.value);
      if (!ok) {
        const failures = readLocalSecurityFailures();
        const left = Math.max(0, LOCAL_SECURITY_MAX_FAILED_ATTEMPTS - Number(failures.attempts || 0));
        if (status) status.textContent = left ? `PIN incorrect. ${left} tentative(s) restante(s).` : "Trop de tentatives. Poste verrouillé temporairement.";
        return;
      }
      sessionStorage.setItem(LOCAL_SECURITY_SESSION_KEY, "true");
      hideLocalLockOverlay();
      renderLocalSecurityStatus();
      localSecurityReturnFocus?.focus?.();
    } catch (error) {
      if (status) status.textContent = error.message || "Déverrouillage impossible.";
    }
  });
}

function lockLocalSession() {
  try {
    sessionStorage.removeItem(LOCAL_SECURITY_SESSION_KEY);
  } catch (error) {
    // Non critique.
  }
  if (isLocalPinEnabled()) showLocalLockOverlay();
}

function resetLocalSecurityIdleTimer() {
  window.clearTimeout(localSecurityIdleTimer);
  if (!isLocalPinEnabled() || !isLocalSessionUnlocked()) return;
  localSecurityIdleTimer = window.setTimeout(() => {
    notifyUser("Session verrouillée après inactivité.", "info");
    lockLocalSession();
  }, LOCAL_SECURITY_IDLE_MS);
}

function bindLocalSecurityIdleEvents() {
  if (localSecurityIdleEventsBound) return;
  localSecurityIdleEventsBound = true;
  ["pointerdown", "keydown", "touchstart"].forEach((eventName) => {
    document.addEventListener(eventName, () => resetLocalSecurityIdleTimer(), { passive: true });
  });
  document.addEventListener("visibilitychange", resetLocalSecurityIdleTimer);
}

async function disableLocalPin() {
  if (!isLocalPinEnabled()) {
    setLocalSecurityStatus("Aucun PIN à désactiver.", "warn");
    return;
  }
  const confirmed = await showConfirmModal("Désactiver le PIN local sur ce poste ? Les données locales resteront présentes dans ce navigateur.");
  if (!confirmed) return;
  try {
    localStorage.removeItem(LOCAL_SECURITY_KEY);
    localStorage.removeItem(LOCAL_SECURITY_FAILURE_KEY);
    sessionStorage.removeItem(LOCAL_SECURITY_SESSION_KEY);
    window.clearTimeout(localSecurityIdleTimer);
    hideLocalLockOverlay();
    renderLocalSecurityStatus();
    notifyUser("PIN local désactivé sur ce poste.", "success");
  } catch (error) {
    notifyUser(error.message || "Désactivation PIN impossible.", "error");
  }
}

function initLocalSecurityGate() {
  bindLocalSecurityIdleEvents();
  renderLocalSecurityStatus();
  if (!isLocalSessionUnlocked()) showLocalLockOverlay();
  else resetLocalSecurityIdleTimer();
}

function bindLocalSecurityControls() {
  const form = $("#local-pin-form");
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const pin = form.elements.pin.value;
    const confirmPin = form.elements.confirmPin.value;
    if (pin !== confirmPin) {
      setLocalSecurityStatus("Les deux PIN ne correspondent pas.", "error");
      return;
    }
    try {
      await setLocalPin(pin);
      form.reset();
      renderLocalSecurityStatus();
      notifyUser("PIN local activé sur ce poste.", "success");
    } catch (error) {
      setLocalSecurityStatus(error.message || "Activation PIN impossible.", "error");
      notifyUser(error.message || "Activation PIN impossible.", "error");
    }
  });
  $("#lock-local-session")?.addEventListener("click", () => lockLocalSession());
  $("#disable-local-pin")?.addEventListener("click", disableLocalPin);
  $("#clear-local-workstation")?.addEventListener("click", cleanLocalWorkstation);
  bindLocalSecurityIdleEvents();
  renderLocalSecurityStatus();
}

function deleteIndexedDatabase(name) {
  if (!globalThis.indexedDB) return Promise.resolve();
  return new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

function isApplicationLocalStorageKey(key) {
  const normalized = String(key || "").toLowerCase();
  return key.startsWith(STORAGE_KEY)
    || key.startsWith("nimr-sav:")
    || key.startsWith("nimr-carrosserie")
    || normalized.startsWith("sb-")
    || normalized.includes("supabase")
    || normalized.includes("gotrue");
}

function isApplicationCacheName(key) {
  return String(key || "").startsWith("nimr-")
    || String(key || "").startsWith("nimr-sav-")
    || String(key || "").startsWith("nimr-carrosserie-");
}

async function deleteApplicationIndexedDatabases() {
  const names = new Set([DB_NAME]);
  try {
    if (typeof indexedDB.databases === "function") {
      const databases = await indexedDB.databases();
      databases.forEach((database) => {
        const name = database?.name || "";
        const normalized = name.toLowerCase();
        if (normalized.includes("nimr") || normalized.includes("carrosserie") || normalized.includes("supabase")) {
          names.add(name);
        }
      });
    }
  } catch (error) {
    // L'API indexedDB.databases n'est pas disponible partout.
  }
  await Promise.all([...names].filter(Boolean).map((name) => deleteIndexedDatabase(name)));
}

function showWorkstationCleanedScreen() {
  document.body.innerHTML = `
    <main class="cleaned-workstation" role="main">
      <section class="panel">
        <h1>Poste nettoyé</h1>
        <p>Les données locales, caches, bases IndexedDB, configuration Supabase et service worker de ce navigateur ont été supprimés.</p>
        <p>Fermez cet onglet avant de remettre le poste à un autre utilisateur.</p>
      </section>
    </main>
  `;
}

async function cleanLocalWorkstation() {
  const confirmed = await showPromptModal(
    "Cette action supprime les dossiers locaux, photos/documents IndexedDB, caches PWA, points de restauration, configuration Supabase et session Supabase locale de ce navigateur.<br><br>Les données déjà synchronisées dans Supabase ne sont pas supprimées.<br><br>Tapez NETTOYER pour confirmer.",
    "NETTOYER",
  );
  if (!confirmed) return;
  try {
    if (typeof stopSupabaseLiveSync === "function") stopSupabaseLiveSync();
    if (typeof photoObjectUrls !== "undefined") photoObjectUrls.forEach((url) => URL.revokeObjectURL(url));
    if (typeof photoObjectUrls !== "undefined") photoObjectUrls.clear();
    photoDbPromise = null;
    Object.keys(localStorage).forEach((key) => {
      if (isApplicationLocalStorageKey(key)) localStorage.removeItem(key);
    });
    Object.keys(sessionStorage).forEach((key) => {
      if (isApplicationLocalStorageKey(key)) sessionStorage.removeItem(key);
    });
    await deleteApplicationIndexedDatabases();
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.filter(isApplicationCacheName).map((key) => caches.delete(key)));
    }
    if (navigator.serviceWorker?.getRegistrations) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
    }
    showWorkstationCleanedScreen();
  } catch (error) {
    console.error("Nettoyage poste impossible", error);
    notifyUser(error.message || "Nettoyage du poste impossible.", "error");
  }
}


function uid(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}-${Date.now().toString(36)}`;
}

function createDefaultState() {
  const today = new Date();
  const tomorrow = addDays(today, 1);
  const demoCaseId = uid("case");
  const stateSeed = {
    cases: [
      {
        id: demoCaseId,
        clientName: "Client démonstration",
        phone: "+216 00 000 000",
        vehicle: "Peugeot 208",
        plate: "123 TU 4567",
        color: "Blanc",
        vin: "VF3DEMO2026",
        insurance: "Assurance exemple",
        orNavNumber: "OR-2026-001",
        partsStatus: "unchecked",
        blockerReason: "",
        blockerDetails: "",
        damageNotes: "Aile avant droite, pare-chocs et peinture.",
        expertName: "Expert assigné",
        expertPhone: "+216 00 111 222",
        expertEmail: "expert@example.com",
        expertEstimate: {
          reference: "",
          confirmed: false,
          confirmedAt: "",
          lines: [],
        },
        claims: [],
        createdAt: today.toISOString(),
        history: [makeHistoryEntry("case.created", "Dossier de démonstration créé", today.toISOString())],
        photos: [],
        durations: { ...DEFAULT_DURATIONS },
        flags: {
          expertApproved: false,
          clientApproved: false,
          received: false,
          workStarted: false,
          workCompleted: false,
          qualityApproved: false,
          delivered: false,
        },
        appointmentStatus: "none",
        qualityChecklist: createEmptyQualityChecklist(),
        appointment: null,
      },
    ],
    resources: [
      { id: "tolier-1", name: "Tôlier 1", role: "tolier", location: "Poste tôlerie A", active: true },
      { id: "tolier-2", name: "Tôlier 2", role: "tolier", location: "Poste tôlerie B", active: true, fastLane: true },
      { id: "mecanicien-1", name: "Mécanicien 1", role: "mecanicien", location: "Poste mécanique", active: true },
      { id: "electricien-1", name: "Électricien 1", role: "electricien", location: "Poste électrique", active: true },
      { id: "peintre-1", name: "Peintre 1", role: "peintre", location: "Zone peinture", active: true },
      { id: "peintre-2", name: "Peintre 2", role: "peintre", location: "Préparation", active: true, fastLane: true },
      { id: "zone-preparation-1", name: "Zone de préparation", role: "zone_preparation", location: "Zone préparation 1", active: true },
      { id: "cabine-1", name: "Cabine peinture", role: "cabine", location: "Cabine 1", active: true },
      { id: "controle-1", name: "Chef atelier", role: "controle", location: "Contrôle final", active: true },
      { id: "pont-vidange-1", name: "Pont vidange 1", role: "pont_vidange", location: "Service rapide", active: true },
      { id: "pont-vidange-2", name: "Pont vidange 2", role: "pont_vidange", location: "Service rapide", active: true },
      { id: "pont-vidange-3", name: "Pont vidange 3", role: "pont_vidange", location: "Service rapide", active: true },
      { id: "pont-mecanique-1", name: "Pont mécanique 1", role: "pont_mecanique", location: "Grands travaux", active: true },
      { id: "pont-mecanique-2", name: "Pont mécanique 2", role: "pont_mecanique", location: "Grands travaux", active: true },
      { id: "pont-mecanique-3", name: "Pont mécanique 3", role: "pont_mecanique", location: "Grands travaux", active: true },
    ],
    bookings: [],
    holidays: [
      { date: `${today.getFullYear()}-01-01`, label: "Nouvel an" },
      { date: `${today.getFullYear()}-03-20`, label: "Indépendance" },
      { date: `${today.getFullYear()}-04-09`, label: "Martyrs" },
      { date: `${today.getFullYear()}-05-01`, label: "Travail" },
    ],
    planningDate: todayKey(tomorrow),
    settings: {
      fastLaneEnabled: true,
      fastLaneMaxHours: FAST_LANE_DEFAULT_HOURS,
      planningLogicVersion: 0,
    },
    workHours: cloneWorkHours(DEFAULT_WORK_HOURS),
    ui: {
      caseStatusFilter: "all",
      caseTypeFilter: "all",
      caseSort: "recent",
      technicianId: "",
      technicianDate: todayKey(new Date()),
    },
  };
  return stateSeed;
}

function parseStoredStateCandidate(raw, source) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    const stateCandidate = parsed?.state && Array.isArray(parsed.state.cases) ? parsed.state : parsed;
    if (!stateCandidate || !Array.isArray(stateCandidate.cases)) return null;
    return {
      source,
      state: normalizeState(stateCandidate),
      updatedAt: parsed?.savedAt || parsed?.updatedAt || parsed?.exportedAt || parsed?.state?.updatedAt || "",
      casesCount: stateCandidate.cases.length,
    };
  } catch (error) {
    console.warn(`Sauvegarde locale illisible (${source})`, error);
    return null;
  }
}

function getLocalStateCandidates() {
  const candidates = [];
  candidates.push(parseStoredStateCandidate(localStorage.getItem(STORAGE_KEY), "principal"));
  candidates.push(parseStoredStateCandidate(localStorage.getItem(STORAGE_MIRROR_KEY), "miroir"));
  if (typeof sessionStorage !== "undefined") {
    candidates.push(parseStoredStateCandidate(sessionStorage.getItem(SESSION_EMERGENCY_KEY), "session"));
  }
  try {
    const snapshots = JSON.parse(localStorage.getItem(STORAGE_SNAPSHOTS_KEY) || "[]");
    if (Array.isArray(snapshots)) {
      snapshots.forEach((snapshot, index) => {
        const candidate = parseStoredStateCandidate(JSON.stringify(snapshot), `snapshot ${index + 1}`);
        if (candidate) candidates.push(candidate);
      });
    }
  } catch (error) {
    console.warn("Snapshots locales illisibles", error);
  }
  return candidates.filter(Boolean);
}

function scoreStoredStateCandidate(candidate) {
  const nonDemoCases = (candidate.state?.cases || []).filter((item) => item.clientName !== "Client démonstration").length;
  const bookings = Array.isArray(candidate.state?.bookings) ? candidate.state.bookings.length : 0;
  const resources = Array.isArray(candidate.state?.resources) ? candidate.state.resources.length : 0;
  const timestamp = candidate.updatedAt ? new Date(candidate.updatedAt).getTime() || 0 : 0;
  const richness = nonDemoCases * 1000000 + bookings * 5000 + resources * 100;
  return timestamp > 0 ? timestamp * 1000 + Math.min(richness, 999) : richness;
}

function loadState() {
  const candidates = getLocalStateCandidates();
  if (candidates.length) {
    candidates.sort((left, right) => scoreStoredStateCandidate(right) - scoreStoredStateCandidate(left));
    const chosen = candidates[0];
    if (chosen.source !== "principal") {
      console.warn(`Restauration automatique depuis sauvegarde ${chosen.source}.`);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(chosen.state));
      } catch (error) {
        console.warn("Impossible de réécrire la sauvegarde principale", error);
      }
    }
    return chosen.state;
  }
  return createDefaultState();
}

function normalizeState(raw) {
  raw = raw && typeof raw === "object" ? raw : {};
  const seed = createDefaultState();
  const resources = Array.isArray(raw.resources) ? raw.resources.map(normalizeResource) : seed.resources;
  seed.resources.forEach((defaultResource) => {
    if (!resources.some((resource) => resource.id === defaultResource.id) && !resources.some((resource) => resource.role === defaultResource.role && !["pont_vidange", "pont_mecanique"].includes(defaultResource.role))) {
      resources.push(normalizeResource(defaultResource));
    }
  });
  ensureMinimumEquipmentResources(resources, seed.resources, "pont_vidange", 3);
  ensureMinimumEquipmentResources(resources, seed.resources, "pont_mecanique", 3);
  return {
    cases: Array.isArray(raw.cases) ? raw.cases.map(normalizeCase) : seed.cases,
    resources,
    bookings: normalizeBookings(raw.bookings, resources),
    holidays: Array.isArray(raw.holidays) ? raw.holidays : seed.holidays,
    planningDate: raw.planningDate || todayKey(new Date()),
    settings: {
      ...seed.settings,
      ...(raw.settings || {}),
    },
    workHours: normalizeWorkHours(raw.workHours || seed.workHours),
    ui: normalizeUiPreferences(raw.ui || seed.ui),
  };
}


function ensureMinimumEquipmentResources(resources, defaults, role, minimum) {
  const current = resources.filter((resource) => resource.role === role);
  defaults.filter((resource) => resource.role === role).forEach((defaultResource) => {
    if (current.length >= minimum) return;
    if (!resources.some((resource) => resource.id === defaultResource.id)) {
      const normalized = normalizeResource(defaultResource);
      resources.push(normalized);
      current.push(normalized);
    }
  });
}

function normalizeUiPreferences(ui = {}) {
  const allowedSorts = new Set(["recent", "oldest", "client", "appointment"]);
  const allowedStatuses = new Set(["all", ...Object.keys(statusLabels)]);
  const allowedTypes = new Set(["all", "assurance", "client", "vidange", "mechanical_client", "electrical_client", "garantie"]);
  return {
    caseStatusFilter: allowedStatuses.has(ui.caseStatusFilter) ? ui.caseStatusFilter : "all",
    caseTypeFilter: allowedTypes.has(ui.caseTypeFilter) ? ui.caseTypeFilter : "all",
    caseSort: allowedSorts.has(ui.caseSort) ? ui.caseSort : "recent",
    technicianId: typeof ui.technicianId === "string" ? ui.technicianId : "",
    technicianDate: /^\d{4}-\d{2}-\d{2}$/.test(String(ui.technicianDate || "")) ? ui.technicianDate : todayKey(new Date()),
  };
}


function normalizeStepServiceTypes(value = {}) {
  const normalized = {};
  const allowed = new Set(SERVICE_TYPE_OPTIONS.map(([key]) => key));
  DURATIONS.forEach(([key]) => {
    const raw = value?.[key] || "auto";
    normalized[key] = allowed.has(raw) ? raw : "auto";
  });
  return normalized;
}

function normalizeStepPreferredResources(value = {}) {
  const normalized = {};
  DURATIONS.forEach(([key]) => {
    const raw = value?.[key] || "";
    normalized[key] = typeof raw === "string" ? raw : "";
  });
  return normalized;
}

function normalizePartsStatus(value) {
  const normalized = String(value || "unchecked").trim();
  return PARTS_STATUS_LABELS[normalized] ? normalized : "unchecked";
}

function normalizeBlockerReason(value) {
  const normalized = String(value || "").trim();
  return BLOCKER_REASON_LABELS[normalized] !== undefined ? normalized : "";
}

function isCaseBlocked(item) {
  if (!item) return false;
  const status = normalizePartsStatus(item.partsStatus);
  const reason = normalizeBlockerReason(item.blockerReason);
  return BLOCKING_PARTS_STATUSES.has(status) || Boolean(reason);
}

function getCaseBlockerLabel(item) {
  if (!item) return "";
  const partsLabel = PARTS_STATUS_LABELS[normalizePartsStatus(item.partsStatus)] || "";
  const reasonLabel = BLOCKER_REASON_LABELS[normalizeBlockerReason(item.blockerReason)] || "";
  const details = String(item.blockerDetails || "").trim();
  return [reasonLabel, partsLabel, details].filter(Boolean).join(" · ");
}

function normalizeDurations(durations = {}) {
  const normalized = { ...DEFAULT_DURATIONS };
  DURATIONS.forEach(([key]) => {
    const value = parseLocalizedDecimal(durations[key] ?? normalized[key]);
    normalized[key] = Math.min(MAX_STEP_DURATION_HOURS, Math.max(0, roundHours(value)));
  });
  const productiveTotal = ESTIMATE_PLANNING_KEYS.reduce((sum, key) => sum + Number(normalized[key] || 0), 0);
  normalized.quality = productiveTotal > 0 ? 0.25 : 0;
  return normalized;
}

function normalizeBookings(bookings, resources) {
  const resourceIds = new Set((resources || []).map((resource) => resource.id));
  return Array.isArray(bookings)
    ? bookings.map((booking) => normalizeBooking(booking, resourceIds)).filter(Boolean)
    : [];
}

function normalizeBookingStatus(value, temporary = false) {
  const aliases = {
    in_progress: "started",
    done: "completed",
  };
  const raw = String(value || "").trim();
  const normalized = aliases[raw] || raw;
  return ["planned", "started", "paused", "completed", "temporary"].includes(normalized)
    ? normalized
    : (temporary ? "temporary" : "planned");
}

function normalizeBookingNotes(notes) {
  return Array.isArray(notes)
    ? notes
        .map((note) => ({
          id: note?.id || uid("task-note"),
          at: note?.at || note?.createdAt || new Date().toISOString(),
          by: note?.by || note?.technicianId || "",
          text: String(note?.text || note?.note || "").trim(),
        }))
        .filter((note) => note.text)
    : [];
}

function normalizeBookingWorkSessions(sessions) {
  return Array.isArray(sessions)
    ? sessions
        .map((session) => ({
          startedAt: session?.startedAt || "",
          startedBy: session?.startedBy || "",
          pausedAt: session?.pausedAt || "",
          pausedBy: session?.pausedBy || "",
          resumedAt: session?.resumedAt || "",
          resumedBy: session?.resumedBy || "",
          completedAt: session?.completedAt || "",
          completedBy: session?.completedBy || "",
          pauseReason: session?.pauseReason || "",
        }))
        .filter((session) => session.startedAt || session.pausedAt || session.completedAt)
    : [];
}

function normalizeBooking(booking, resourceIds) {
  if (!booking || typeof booking !== "object") return null;
  const ids = Array.isArray(booking.resourceIds)
    ? booking.resourceIds.filter((id) => !resourceIds.size || resourceIds.has(id))
    : [];
  const segments = Array.isArray(booking.segments)
    ? booking.segments
        .map((segment) => ({
          start: segment?.start || booking.start,
          end: segment?.end || booking.end,
        }))
        .filter((segment) => isValidDateValue(segment.start) && isValidDateValue(segment.end) && new Date(segment.start) < new Date(segment.end))
    : [];
  const type = booking.type || "work";
  const caseId = booking.caseId || (type === "leave" ? "__leave__" : "");
  if (!caseId || !ids.length || !segments.length) return null;
  return {
    id: booking.id || uid(type === "leave" ? "leave" : "booking"),
    caseId,
    type,
    title: booking.title || (type === "leave" ? "Congé / absence" : "Travail atelier"),
    key: booking.key || (type === "leave" ? "leave" : "body"),
    start: booking.start || segments[0].start,
    end: booking.end || segments.at(-1).end,
    delivery: booking.delivery || "",
    resourceIds: ids,
    primaryResourceId: booking.primaryResourceId || ids[0] || null,
    equipmentResourceIds: Array.isArray(booking.equipmentResourceIds)
      ? booking.equipmentResourceIds.filter((id) => ids.includes(id))
      : ids.slice(1),
    segments,
    plannedStart: booking.plannedStart || booking.start || segments[0].start,
    plannedEnd: booking.plannedEnd || booking.end || segments.at(-1).end,
    plannedSegments: Array.isArray(booking.plannedSegments) && booking.plannedSegments.length ? booking.plannedSegments : segments,
    plannedMinutes: Number(booking.plannedMinutes || 0) || segments.reduce((sum, segment) => sum + diffMinutes(new Date(segment.start), new Date(segment.end)), 0),
    status: normalizeBookingStatus(booking.status, booking.temporary),
    actualStart: booking.actualStart || booking.startedAt || "",
    actualEnd: booking.actualEnd || booking.completedAt || "",
    startedAt: booking.startedAt || booking.actualStart || "",
    startedBy: booking.startedBy || "",
    completedAt: booking.completedAt || "",
    completedBy: booking.completedBy || "",
    completedByOverride: booking.completedByOverride || "",
    pausedAt: booking.pausedAt || "",
    pausedBy: booking.pausedBy || "",
    resumedAt: booking.resumedAt || "",
    resumedBy: booking.resumedBy || "",
    pauseReason: booking.pauseReason || "",
    blockedAt: booking.blockedAt || "",
    blockedBy: booking.blockedBy || "",
    blockReason: booking.blockReason || "",
    blockDetails: booking.blockDetails || "",
    notes: normalizeBookingNotes(booking.notes),
    photoIds: Array.isArray(booking.photoIds) ? booking.photoIds.filter(Boolean).map(String) : [],
    workSessions: normalizeBookingWorkSessions(booking.workSessions),
    actualWorkedMinutes: Number(booking.actualWorkedMinutes || 0) || 0,
    remainingMinutes: Number(booking.remainingMinutes || 0) || 0,
    parentBookingId: booking.parentBookingId || "",
    remainingFromPaused: Boolean(booking.remainingFromPaused),
    rescheduledAt: booking.rescheduledAt || "",
    color: booking.color || (type === "leave" ? "#6b7280" : "#11415f"),
    planningMode: booking.planningMode || "standard",
    details: booking.details || "",
    temporary: Boolean(booking.temporary),
  };
}

function isValidDateValue(value) {
  return value && !Number.isNaN(new Date(value).getTime());
}

function normalizeResource(resource) {
  return {
    id: resource.id || uid("resource"),
    name: resource.name || "Ressource",
    role: resource.role || "tolier",
    location: resource.location || "",
    active: resource.active !== false,
    fastLane: Boolean(resource.fastLane),
  };
}

function normalizeCase(item) {
  item = item && typeof item === "object" ? item : {};
  const normalizedPartsStatus = normalizePartsStatus(item.partsStatus);
  const normalizedBlockerReason = normalizeBlockerReason(item.blockerReason);
  const hasLegacyBlocker = BLOCKING_PARTS_STATUSES.has(normalizedPartsStatus) || Boolean(normalizedBlockerReason);
  const blockerSource = ["manual", "task"].includes(item.blockerSource)
    ? item.blockerSource
    : (hasLegacyBlocker ? "manual" : "");
  return {
    id: item.id || uid("case"),
    clientName: item.clientName || "Client",
    phone: item.phone || "",
    ownerName: item.ownerName || item.companyName || item.owner || "",
    driverName: item.driverName || item.depositorName || item.broughtBy || "",
    driverPhone: item.driverPhone || item.depositorPhone || "",
    vehicle: item.vehicle || "",
    plate: item.plate || "",
    color: item.color || "",
    planningColor: isValidVehiclePlanningColor(item.planningColor) ? item.planningColor : "",
    mileage: item.mileage || item.kilometrage || item.kilométrage || "",
    vin: item.vin || "",
    insurance: item.insurance || "",
    orNavNumber: item.orNavNumber || item.claimNumber || "",
    partsStatus: normalizedPartsStatus,
    blockerReason: normalizedBlockerReason,
    blockerDetails: item.blockerDetails || item.blockerNote || "",
    blockerSource,
    blockerSourceBookingIds: Array.isArray(item.blockerSourceBookingIds) ? item.blockerSourceBookingIds.filter(Boolean).map(String) : [],
    damageNotes: item.damageNotes || "",
    arrivalNotes: item.arrivalNotes || item.receptionNotes || "",
    expertName: item.expertName || "",
    expertPhone: item.expertPhone || "",
    expertEmail: item.expertEmail || "",
    expertEstimate: normalizeExpertEstimate(item.expertEstimate),
    createdAt: item.createdAt || new Date().toISOString(),
    history: normalizeHistory(item.history, item.createdAt),
    photos: Array.isArray(item.photos) ? item.photos.map(normalizePhotoMeta) : [],
    durations: normalizeDurations(item.durations),
    stepServiceTypes: normalizeStepServiceTypes(item.stepServiceTypes),
    stepPreferredResources: normalizeStepPreferredResources(item.stepPreferredResources),
    flags: {
      expertApproved: false,
      clientApproved: false,
      received: false,
      workStarted: false,
      workCompleted: false,
      qualityApproved: false,
      delivered: false,
      invoiced: false,
      ...(item.flags || {}),
    },
    appointmentStatus: item.appointmentStatus || (item.appointment ? "scheduled" : "none"),
    qualityChecklist: normalizeQualityChecklist(item.qualityChecklist),
    appointment: item.appointment || null,
    claims: normalizeRepairClaims(item.claims, item),
    supplements: normalizeRepairSupplements(item.supplements),
  };
}

function normalizeRepairClaims(claims = [], item = {}) {
  const source = Array.isArray(claims) ? claims : [];
  const normalized = source
    .map((claim, index) => normalizeRepairClaim(claim, index))
    .filter((claim) => claim && !isEmptyLegacyAutoClaim(claim, item));
  return normalized.map((claim, index) => ({ ...claim, number: claim.number || `OT-${String(index + 1).padStart(3, "0")}` }));
}

function isEmptyLegacyAutoClaim(claim, item = {}) {
  const noEstimate = !claim.estimateNumber && !claim.orNumber && !(claim.estimate?.lines || []).length && !(claim.estimate?.originalLines || []).length;
  const noApprovals = !claim.expertApproved && !claim.clientApproved;
  const defaultTitle = !claim.title || claim.title === "Sinistre principal" || claim.title === "Intervention principale" || claim.title === item.damageNotes || claim.title === item.expertEstimate?.reference;
  return ["SIN-001", "OT-001"].includes(claim.number) && defaultTitle && noEstimate && noApprovals;
}

function hasRepairClaims(item) {
  return normalizeRepairClaims(item?.claims || [], item).length > 0;
}


function isClientOnlyRepairClaim(claim) {
  return ["client", "vidange", "mechanical_client", "electrical_client", "diagnostic", "garantie"].includes(claim?.type);
}

function getClaimTypeLabel(type) {
  const labels = {
    assurance: "Assurance / expert",
    client: "Client direct / intervention SAV",
    vidange: "Service rapide / entretien",
    mechanical_client: "Service mécanique",
    electrical_client: "Service électrique",
    diagnostic: "Diagnostic",
    garantie: "Garantie constructeur",
  };
  return labels[type] || type || "Intervention SAV";
}

function isInsuranceRepairClaim(claim) {
  return !isClientOnlyRepairClaim(claim);
}

function getClientQualityHours(totalProductiveHours) {
  return Number(totalProductiveHours || 0) <= FAST_LANE_DEFAULT_HOURS ? 0.25 : 1;
}

function normalizeRepairClaim(claim, index = 0) {
  claim = claim && typeof claim === "object" ? claim : {};
  const createdAt = claim.createdAt || new Date().toISOString();
  return {
    id: claim.id || uid("claim"),
    number: claim.number || `OT-${String(index + 1).padStart(3, "0")}`,
    title: claim.title || claim.label || `Intervention ${index + 1}`,
    vehicleArea: claim.vehicleArea || claim.area || "",
    type: claim.type || "assurance",
    status: normalizeClaimStatus(claim.status),
    includeInPlanning: claim.includeInPlanning !== false,
    expertApproved: Boolean(claim.expertApproved),
    clientApproved: Boolean(claim.clientApproved),
    estimateNumber: claim.estimateNumber || claim.estimate?.reference || "",
    orNumber: claim.orNumber || "",
    amount: Math.max(0, parseLocalizedDecimal(claim.amount || 0) || 0),
    estimate: normalizeExpertEstimate(claim.estimate),
    createdAt,
    updatedAt: claim.updatedAt || createdAt,
  };
}

function normalizeClaimStatus(status) {
  const allowed = new Set(Object.keys(CLAIM_STATUS_LABELS));
  return allowed.has(status) ? status : "draft";
}

function getClaimLabel(claim) {
  return [claim.number, claim.title, claim.vehicleArea].filter(Boolean).join(" - ");
}

function recomputeCaseDurationsFromClaims(item) {
  const claims = normalizeRepairClaims(item.claims, item);
  const hasClaimLabor = claims.some((claim) => claim.includeInPlanning !== false && getClaimPlanningLaborLines(claim).some((line) => Number(line.laborHours || 0) > 0));
  if (!hasClaimLabor) return false;
  const totals = Object.fromEntries(ESTIMATE_ALLOWED_KEYS.map((key) => [key, 0]));
  const includedClaims = claims.filter((claim) => claim.includeInPlanning !== false);
  includedClaims.forEach((claim) => {
    getClaimPlanningLaborLines(claim).forEach((line) => {
      if (!(line.phase in totals)) return;
      totals[line.phase] = roundHours(Number(totals[line.phase] || 0) + Number(line.laborHours || 0));
    });
  });
  const hasInsuranceClaim = includedClaims.some((claim) => isInsuranceRepairClaim(claim));
  const productiveTotal = ["body", "oilService", "mechanical", "electrical", "prep", "paint", "reassembly"].reduce((sum, key) => sum + Number(totals[key] || 0), 0);
  if (hasInsuranceClaim) {
    totals.finish = roundHours(Number(totals.paint || 0) * 0.5);
    totals.quality = 0.25;
  } else {
    totals.finish = 0;
    totals.quality = productiveTotal > 0 ? 0.25 : 0;
  }
  DURATIONS.forEach(([key]) => {
    item.durations[key] = roundHours(totals[key] || 0);
  });
  item.claims = claims;
  return true;
}

function getClaimPlanningLaborLines(claim) {
  const applied = claim?.estimate?.lines || [];
  if (applied.length) return applied;
  return (claim?.estimate?.originalLines || []).flatMap((line) => {
    if (Array.isArray(line.allocations) && line.allocations.length) {
      return line.allocations.map((allocation) => ({
        id: allocation.id || line.id,
        phase: allocation.phase,
        operation: allocation.operation || line.operation,
        laborHours: allocation.laborHours,
      }));
    }
    const phase = line.phase || line.selectedPhases?.[0] || "body";
    return [{ id: line.id, phase, operation: line.operation || line.rawText || "", laborHours: line.laborHours }];
  });
}

function normalizeRepairSupplements(supplements = []) {
  return Array.isArray(supplements) ? supplements.map(normalizeRepairSupplement).filter(Boolean) : [];
}

function normalizeRepairSupplement(supplement) {
  supplement = supplement && typeof supplement === "object" ? supplement : {};
  const createdAt = supplement.createdAt || new Date().toISOString();
  return {
    id: supplement.id || uid("supplement"),
    number: supplement.number || "",
    title: supplement.title || "Réparation complémentaire",
    reason: supplement.reason || "",
    vehicleArea: supplement.vehicleArea || "",
    status: normalizeSupplementStatus(supplement.status),
    expertApproved: Boolean(supplement.expertApproved),
    clientApproved: Boolean(supplement.clientApproved),
    integrated: Boolean(supplement.integrated),
    integratedAt: supplement.integratedAt || "",
    createdAt,
    updatedAt: supplement.updatedAt || createdAt,
    parts: Array.isArray(supplement.parts) ? supplement.parts.map((part) => ({
      id: part.id || uid("supplement-part"),
      designation: part.designation || part.name || "Pièce complémentaire",
      quantity: Math.max(0, parseLocalizedDecimal(part.quantity ?? 1) || 0),
      notes: part.notes || "",
    })) : [],
    laborLines: Array.isArray(supplement.laborLines) ? supplement.laborLines.map(normalizeRepairSupplementLine).filter(Boolean) : [],
  };
}

function normalizeSupplementStatus(status) {
  const allowed = new Set(["draft", "expert_pending", "client_pending", "approved", "refused", "planned", "done"]);
  return allowed.has(status) ? status : "draft";
}

function normalizeRepairSupplementLine(line) {
  line = line && typeof line === "object" ? line : {};
  const phase = DURATIONS.some(([key]) => key === line.phase) ? line.phase : "body";
  const hours = parseLocalizedDecimal(line.laborHours ?? line.hours ?? 0);
  if (!line.operation && !hours) return null;
  return {
    id: line.id || uid("supplement-line"),
    phase,
    operation: line.operation || getDurationLabel(phase) || "Opération complémentaire",
    laborHours: Math.min(MAX_STEP_DURATION_HOURS, Math.max(0, roundHours(hours))),
  };
}

const SUPPLEMENT_STATUS_LABELS = {
  draft: "Brouillon",
  expert_pending: "En attente expert",
  client_pending: "En attente client",
  approved: "Accepté",
  refused: "Refusé",
  planned: "Intégré au planning",
  done: "Terminé",
};

function normalizeExpertEstimate(estimate) {
  estimate = estimate && typeof estimate === "object" ? estimate : {};
  return {
    reference: estimate.reference || "",
    confirmed: Boolean(estimate.confirmed),
    confirmedAt: estimate.confirmedAt || "",
    lines: Array.isArray(estimate.lines) ? estimate.lines.map(normalizeExpertEstimateLine).filter(Boolean) : [],
    originalLines: Array.isArray(estimate.originalLines) ? estimate.originalLines.map(normalizeExpertEstimateOriginalLine).filter(Boolean) : [],
    parts: Array.isArray(estimate.parts) ? estimate.parts.map(normalizeExpertEstimatePart).filter(Boolean) : [],
    sourceFile: normalizeEstimateSourceFile(estimate.sourceFile),
  };
}

function normalizeExpertEstimatePart(part) {
  part = part && typeof part === "object" ? part : {};
  const designation = String(part.designation || part.name || part.rawText || "").trim();
  if (!designation) return null;
  return {
    id: part.id || uid("estimate-part"),
    designation,
    quantity: Math.max(0, parseLocalizedDecimal(part.quantity ?? 1) || 0),
    unitPrice: Math.max(0, parseLocalizedDecimal(part.unitPrice ?? 0) || 0),
    amount: Math.max(0, parseLocalizedDecimal(part.amount ?? 0) || 0),
    rawText: part.rawText || designation,
  };
}

function normalizeEstimateSourceFile(sourceFile) {
  if (!sourceFile || typeof sourceFile !== "object") return null;
  return {
    id: sourceFile.id || uid("estimate-doc"),
    name: sourceFile.name || "devis-original.pdf",
    type: sourceFile.type || "application/octet-stream",
    size: Number(sourceFile.size || 0),
    category: sourceFile.category || "estimate_original",
    createdAt: sourceFile.createdAt || new Date().toISOString(),
  };
}

function normalizeExpertEstimateLine(line) {
  line = line && typeof line === "object" ? line : {};
  const phase = DURATIONS.some(([key]) => key === line.phase) ? line.phase : "body";
  const laborHours = parseLocalizedDecimal(line.laborHours ?? line.hours ?? line.quantity ?? 0);
  return {
    id: line.id || uid("estimate-line"),
    phase,
    operation: line.operation || "",
    laborHours: roundHours(laborHours),
  };
}

function normalizeExpertEstimateOriginalLine(line) {
  line = line && typeof line === "object" ? line : {};
  const laborHours = parseLocalizedDecimal(line.laborHours ?? line.hours ?? line.quantity ?? 0);
  const allocations = Array.isArray(line.allocations)
    ? line.allocations.map((allocation) => ({
        phase: DURATIONS.some(([key]) => key === allocation.phase) ? allocation.phase : "body",
        operation: allocation.operation || line.operation || "",
        laborHours: roundHours(parseLocalizedDecimal(allocation.laborHours ?? allocation.hours ?? 0)),
      })).filter((allocation) => allocation.laborHours > 0)
    : [];
  const normalizedPieceKind = ["new", "repair"].includes(line.pieceKind) ? line.pieceKind : "";
  const normalizedPaintFaces = ["outside", "two_sides"].includes(line.paintFaces) ? line.paintFaces : "";
  return {
    id: line.id || uid("estimate-original-line"),
    code: line.code || "",
    manual: Boolean(line.manual),
    operation: line.operation || line.text || "",
    laborHours: roundHours(laborHours),
    rawText: line.rawText || line.text || line.operation || "",
    allocations,
    selectedPhases: Array.isArray(line.selectedPhases) ? line.selectedPhases.filter((phase) => DURATIONS.some(([key]) => key === phase)) : undefined,
    pieceKind: normalizedPieceKind,
    paintFaces: normalizedPaintFaces,
    paintGroup: line.paintGroup || "",
  };
}

function normalizeHistory(history, fallbackDate) {
  const normalized = Array.isArray(history)
    ? history
        .map((entry) => ({
          id: entry.id || uid("history"),
          at: entry.at || fallbackDate || new Date().toISOString(),
          type: entry.type || "note",
          label: entry.label || "Action dossier",
          details: entry.details || "",
          user: entry.user || "Atelier",
        }))
        .filter((entry) => entry.label)
    : [];

  if (!normalized.length) {
    normalized.push(makeHistoryEntry("case.created", "Dossier créé", fallbackDate || new Date().toISOString()));
  }

  return normalized.sort((a, b) => new Date(b.at) - new Date(a.at));
}

function makeHistoryEntry(type, label, at = new Date().toISOString(), details = "") {
  return {
    id: uid("history"),
    at,
    type,
    label,
    details,
    user: "Atelier",
  };
}

function addHistory(item, type, label, details = "") {
  if (!item) return;
  item.history = Array.isArray(item.history) ? item.history : normalizeHistory([], item.createdAt);
  item.history.unshift(makeHistoryEntry(type, label, new Date().toISOString(), details));
  item.history = item.history.slice(0, 200);
}

function recordFlagHistory(item, flag, checked) {
  const event = FLAG_HISTORY_EVENTS[flag]?.[checked ? "on" : "off"];
  if (event) addHistory(item, event[0], event[1]);
}

function clearCasePlanning(item, reason = "Planning atelier annulé") {
  const hadPlanning = Boolean(item.appointment) || state.bookings.some((booking) => booking.caseId === item.id);
  state.bookings = state.bookings.filter((booking) => booking.caseId !== item.id);
  item.appointment = null;
  item.flags.received = false;
  item.flags.workStarted = false;
  item.flags.workCompleted = false;
  item.flags.qualityApproved = false;
  item.flags.delivered = false;
  item.appointmentStatus = "none";
  item.qualityChecklist = createEmptyQualityChecklist();
  generatedProposals[item.id] = null;
  if (hadPlanning) addHistory(item, "planning.cleared", reason);
}

function buildAutosaveEnvelope() {
  const savedAt = new Date().toISOString();
  state.updatedAt = savedAt;
  return {
    app: BACKUP_APP_ID,
    appVersion: APP_VERSION,
    formatVersion: BACKUP_FORMAT_VERSION,
    savedAt,
    state,
  };
}

function writeStateSnapshot(envelope) {
  try {
    const snapshots = JSON.parse(localStorage.getItem(STORAGE_SNAPSHOTS_KEY) || "[]");
    const nextSnapshots = Array.isArray(snapshots) ? snapshots : [];
    const previous = nextSnapshots[0];
    const previousCases = JSON.stringify(previous?.state?.cases || []);
    const currentCases = JSON.stringify(envelope.state?.cases || []);
    if (previousCases !== currentCases || nextSnapshots.length === 0) {
      nextSnapshots.unshift(envelope);
      localStorage.setItem(STORAGE_SNAPSHOTS_KEY, JSON.stringify(nextSnapshots.slice(0, AUTOSAVE_SNAPSHOT_LIMIT)));
    }
  } catch (error) {
    console.warn("Impossible d'écrire les snapshots de sécurité", error);
  }
}

function readTimestampMeta(key) {
  try {
    const value = localStorage.getItem(key);
    const time = value ? new Date(value).getTime() : 0;
    return Number.isFinite(time) ? time : 0;
  } catch (error) {
    return 0;
  }
}

function rememberKnownCloudUpdatedAt(value) {
  try {
    const iso = value instanceof Date ? value.toISOString() : new Date(value).toISOString();
    localStorage.setItem(CLOUD_UPDATED_META_KEY, iso);
    return new Date(iso).getTime();
  } catch (error) {
    return 0;
  }
}

function getStoredCloudUpdatedAt() {
  return readTimestampMeta(CLOUD_UPDATED_META_KEY);
}

function rememberLocalUserChangeAt(value) {
  try {
    const iso = value instanceof Date ? value.toISOString() : new Date(value).toISOString();
    localStorage.setItem(LOCAL_CHANGE_META_KEY, iso);
  } catch (error) {
    // Métadonnée de synchro non critique.
  }
}

function getLocalUserChangeAt() {
  return readTimestampMeta(LOCAL_CHANGE_META_KEY);
}

function clearLocalUserChangeAt() {
  try {
    localStorage.removeItem(LOCAL_CHANGE_META_KEY);
  } catch (error) {
    // Métadonnée de synchro non critique.
  }
}

function saveState(options = {}) {
  try {
    const envelope = buildAutosaveEnvelope();
    const stateJson = JSON.stringify(state);
    localStorage.setItem(STORAGE_KEY, stateJson);
    localStorage.setItem(STORAGE_MIRROR_KEY, JSON.stringify(envelope));
    localStorage.setItem(STORAGE_META_KEY, JSON.stringify({ savedAt: envelope.savedAt, appVersion: APP_VERSION, casesCount: state.cases.length }));
    if (typeof sessionStorage !== "undefined") sessionStorage.setItem(SESSION_EMERGENCY_KEY, JSON.stringify(envelope));
    if (!options.skipSnapshot) writeStateSnapshot(envelope);
    if (!options.skipCloud) rememberLocalUserChangeAt(envelope.savedAt);
    if (!options.skipCloud && typeof scheduleAutoSupabaseBackup === "function") {
      scheduleAutoSupabaseBackup(options.cloudReason || "local-save");
    }
    if (!options.skipCloud && options.flushCloud && typeof flushSupabaseBackup === "function") {
      flushSupabaseBackup(options.cloudReason || "local-save-now");
    }
    if (typeof renderSyncStatusStrip === "function") renderSyncStatusStrip();
  } catch (error) {
    console.error("Impossible d'enregistrer les données locales", error);
    notifyUser("Le stockage local est saturé. Exportez une sauvegarde JSON depuis Atelier > Sauvegarde.", "error");
  }
}

function forceEmergencyAutosave() {
  try {
    const envelope = buildAutosaveEnvelope();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    localStorage.setItem(STORAGE_MIRROR_KEY, JSON.stringify(envelope));
    localStorage.setItem(STORAGE_META_KEY, JSON.stringify({ savedAt: envelope.savedAt, appVersion: APP_VERSION, casesCount: state.cases.length }));
    writeStateSnapshot(envelope);
    if (typeof sessionStorage !== "undefined") sessionStorage.setItem(SESSION_EMERGENCY_KEY, JSON.stringify(envelope));
  } catch (error) {
    console.warn("Sauvegarde d'urgence impossible", error);
  }
}

function normalizePhotoMeta(photo) {
  const { dataUrl, ...meta } = photo || {};
  const id = meta.id || uid("photo");
  if (dataUrl) legacyPhotoPayloads.set(id, dataUrl);
  return {
    id,
    name: meta.name || "Photo dossier",
    type: meta.type || "",
    size: Number(meta.size || 0),
    category: normalizePhotoCategory(meta.category),
    createdAt: meta.createdAt || new Date().toISOString(),
  };
}

function normalizePhotoCategory(category) {
  return PHOTO_CATEGORIES[category] ? category : "before";
}

function getPhotoCategoryLabel(category) {
  return PHOTO_CATEGORIES[normalizePhotoCategory(category)];
}

function createEmptyQualityChecklist() {
  return DEFAULT_QUALITY_CHECKS.reduce((checks, label) => {
    checks[label] = false;
    return checks;
  }, {});
}

function normalizeQualityChecklist(checklist = {}) {
  return DEFAULT_QUALITY_CHECKS.reduce((checks, label) => {
    checks[label] = Boolean(checklist[label]);
    return checks;
  }, {});
}

function cloneWorkHours(workHours) {
  return Object.fromEntries(Object.entries(workHours).map(([day, intervals]) => [day, intervals.map((interval) => [...interval])]));
}

function normalizeWorkHours(workHours) {
  const normalized = cloneWorkHours(DEFAULT_WORK_HOURS);
  Object.entries(workHours || {}).forEach(([day, intervals]) => {
    const parsed = Array.isArray(intervals)
      ? intervals
          .filter((interval) => Array.isArray(interval) && interval.length === 2)
          .map(([start, end]) => [String(start), String(end)])
      : [];
    if (Number.isInteger(Number(day)) && Number(day) >= 0 && Number(day) <= 6) {
      normalized[day] = parsed;
    }
  });
  return normalized;
}

function showConfirmModal(htmlMessage) {
  return new Promise((resolve) => {
    const overlay = document.getElementById("custom-modal-overlay");
    const body = document.getElementById("custom-modal-body");
    const cancelBtn = document.getElementById("custom-modal-cancel");
    const confirmBtn = document.getElementById("custom-modal-confirm");
    
    if (!overlay || !body || !cancelBtn || !confirmBtn) {
      resolve(confirm(htmlMessage.replace(/<br>/g, '\n')));
      return;
    }

    body.innerHTML = htmlMessage;
    overlay.hidden = false;

    const cleanup = () => {
      overlay.hidden = true;
      cancelBtn.removeEventListener("click", onCancel);
      confirmBtn.removeEventListener("click", onConfirm);
    };

    const onCancel = () => {
      cleanup();
      resolve(false);
    };

    const onConfirm = () => {
      cleanup();
      resolve(true);
    };

    cancelBtn.addEventListener("click", onCancel);
    confirmBtn.addEventListener("click", onConfirm);
  });
}

function showPromptModal(htmlMessage, expectedText) {
  return new Promise((resolve) => {
    const overlay = document.getElementById("custom-modal-overlay");
    const body = document.getElementById("custom-modal-body");
    const cancelBtn = document.getElementById("custom-modal-cancel");
    const confirmBtn = document.getElementById("custom-modal-confirm");
    
    if (!overlay || !body || !cancelBtn || !confirmBtn) {
      resolve(prompt(htmlMessage.replace(/<br>/g, '\n')) === expectedText);
      return;
    }

    body.innerHTML = `${htmlMessage}<br><br><input type="text" id="prompt-input" style="width: 100%; padding: 8px; border: 1px solid #cfe0e8; border-radius: 8px;" placeholder="${expectedText}" autocomplete="off" />`;
    overlay.hidden = false;
    
    const input = document.getElementById("prompt-input");
    input.focus();

    const cleanup = () => {
      overlay.hidden = true;
      cancelBtn.removeEventListener("click", onCancel);
      confirmBtn.removeEventListener("click", onConfirm);
    };

    const onCancel = () => {
      cleanup();
      resolve(false);
    };

    const onConfirm = () => {
      cleanup();
      resolve(input.value.trim().toUpperCase() === expectedText.toUpperCase());
    };

    cancelBtn.addEventListener("click", onCancel);
    confirmBtn.addEventListener("click", onConfirm);
  });
}
