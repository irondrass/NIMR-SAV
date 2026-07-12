import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

console.log("Démarrage des tests v22.33D : Sécurité locale et RGPD...");

// 1. Lire les sources des fichiers
const utilsJs = fs.readFileSync("./js/utils.js", "utf8");
const stateJs = fs.readFileSync("./js/state.js", "utf8");
const storageJs = fs.readFileSync("./js/storage.js", "utf8");
const clientJs = fs.readFileSync("./js/supabase-client.js", "utf8");
const syncJs = fs.readFileSync("./js/supabase-sync.js", "utf8");
const appJs = fs.readFileSync("./app.js", "utf8");
const htmlSource = fs.readFileSync("./index.html", "utf8");

// 2. Préparer le contexte global mocké
global.window = global;

const store = new Map();
const sessionStore = new Map();

global.localStorage = {
  getItem: (k) => store.get(k) ?? null,
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
  get length() { return store.size; },
  key: (i) => Array.from(store.keys())[i] || null,
  Object: store // for debugging
};

// Object.keys utility bypass for mocks
Object.defineProperty(global.localStorage, "keys", {
  value: () => Array.from(store.keys()),
  writable: true
});

global.sessionStorage = {
  getItem: (k) => sessionStore.get(k) ?? null,
  setItem: (k, v) => sessionStore.set(k, String(v)),
  removeItem: (k) => sessionStore.delete(k),
  clear: () => sessionStore.clear(),
  get length() { return sessionStore.size; }
};

// Override Object.keys to handle global mocks
const originalKeys = Object.keys;
Object.keys = (obj) => {
  if (obj === global.localStorage) return Array.from(store.keys());
  if (obj === global.sessionStorage) return Array.from(sessionStore.keys());
  return originalKeys(obj);
};

global.state = { 
  cases: [], 
  bookings: [], 
  users: [],
  currentUserId: "",
  settings: {},
  auditLog: [],
  resources: []
};

global.uid = (prefix) => `${prefix}-${Math.random().toString(36).substring(2, 6)}`;
global.APP_VERSION = "v22.33";
global.DB_NAME = "nimr-carrosserie-db";

// Mocks UI / Interactions
let lastNotification = null;
let lastQuietNotification = null;
let lastModalMessage = "";
let lastModalResult = true;
let lastPromptValue = "";

global.notifyUser = (msg, type) => {
  lastNotification = { msg, type };
};
global.quietNotify = (msg, type) => {
  lastQuietNotification = { msg, type };
};
global.showConfirmModal = async (msg) => {
  lastModalMessage = msg;
  return lastModalResult;
};
global.showPromptModal = async (msg, expected) => {
  lastModalMessage = msg;
  return lastPromptValue === expected;
};
global.saveState = () => {};
global.render = () => {};
global.downloadJson = () => {};
global.todayKey = () => "2026-06-03";
global.guardSensitiveAction = () => ({ ok: true });

// Mock crypto pour les fonctions de hachage et chiffrement
const mockSubtle = {
  importKey: async () => ({}),
  deriveBits: async () => new Uint8Array(32),
  deriveKey: async () => ({}),
  encrypt: async (algo, key, data) => {
    // Simuler le chiffrement en retournant un Buffer de la taille du plaintext
    return data.buffer;
  },
  decrypt: async (algo, key, data) => {
    return data;
  }
};
Object.defineProperty(global, "crypto", {
  value: {
    subtle: mockSubtle,
    getRandomValues: (arr) => {
      arr.fill(1);
      return arr;
    }
  },
  configurable: true,
  writable: true
});
global.getBrowserCrypto = () => global.crypto;

// Mocks DOM
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
      style: {},
      dataset: {},
      classList: {
        classes: new Set(),
        add(c) { this.classes.add(c); },
        remove(c) { this.classes.delete(c); },
        contains(c) { return this.classes.has(c); }
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
  querySelectorAll: (sel) => [],
  body: {
    innerHTML: ""
  }
};

global.$ = (sel) => getElement(sel);
global.$$ = (sel) => [];
global.escapeHtml = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Évaluer les scripts
vm.runInThisContext(utilsJs);
vm.runInThisContext(stateJs);
vm.runInThisContext(storageJs);
vm.runInThisContext(clientJs);
vm.runInThisContext(syncJs);
const appJsClean = appJs.replace("initApp();", "/* initApp(); */");
vm.runInThisContext(appJsClean);

// Re-override mock functions to prevent script definitions from shadowing mocks
global.notifyUser = (msg, type) => {
  lastNotification = { msg, type };
};
global.quietNotify = (msg, type) => {
  lastQuietNotification = { msg, type };
};
global.showConfirmModal = async (msg) => {
  lastModalMessage = msg;
  return lastModalResult;
};
global.showPromptModal = async (msg, expected) => {
  lastModalMessage = msg;
  return lastPromptValue === expected;
};
// Le test cible les protections RGPD de l'export lui-même. Les scripts chargés
// redéfinissent le garde applicatif ; on le neutralise explicitement dans ce
// contexte isolé afin de ne pas dépendre d'un ancien administrateur implicite.
global.guardSensitiveAction = () => ({ ok: true });

// Mock IndexedDB
let dbDeleted = false;
global.indexedDB = {
  deleteDatabase: (name) => {
    dbDeleted = true;
    const request = {
      onsuccess: null,
      onerror: null,
      onblocked: null
    };
    setTimeout(() => {
      if (typeof request.onsuccess === "function") request.onsuccess();
    }, 0);
    return request;
  }
};

// Mock PWA Caches
let cacheDeleted = false;
global.caches = {
  keys: async () => ["nimr-sav-v22.33-cache"],
  delete: async (key) => {
    cacheDeleted = true;
    return true;
  }
};

// Mock Service Worker
let swUnregistered = false;
global.navigator.serviceWorker = {
  getRegistrations: async () => [
    {
      unregister: async () => {
        swUnregistered = true;
        return true;
      }
    }
  ]
};

// Ré-importer explicitement les fonctions
const {
  exportBackup,
  encryptBackupPayload,
  cleanLocalWorkstation,
  importBackup,
  restoreLocalFromSupabase
} = global;

async function runTests() {
  // Test 1: Le message PIN indique qu'il ne chiffre pas les données
  assert.ok(
    htmlSource.includes("Le PIN protège l’interface locale, mais ne chiffre pas les données locales."),
    "index.html doit contenir la mention d'avertissement PIN ne chiffrant pas"
  );
  console.log("Test 1 OK : Avertissement PIN présent dans index.html");

  // Test 2 & 4: Export JSON classique contient PII et affiche un avertissement fort
  state.cases = [
    { id: "c-1", clientName: "Alice Dupont", phone: "0601020304", vehicle: "Renault Clio", plate: "AB-123-CD", vin: "VF3123456789" }
  ];
  
  lastModalMessage = "";
  lastModalResult = false; // Annuler
  await exportBackup();
  assert.ok(
    lastModalMessage.includes("Attention : Exportation non chiffrée"),
    "L'export JSON non chiffré doit afficher une modale d'avertissement"
  );
  assert.ok(
    lastModalMessage.includes("données personnelles") && lastModalMessage.includes("RGPD"),
    "La modale d'avertissement d'export JSON doit expliciter le risque RGPD"
  );
  console.log("Test 2 & 4 OK : Avertissement fort lors de l'export JSON non chiffré");

  // Test 3: L'export .nimrsecure ne contient pas les données sensibles en clair
  const payload = {
    state: {
      cases: [
        { id: "c-1", clientName: "Alice Dupont", phone: "0601020304", vehicle: "Renault Clio", plate: "AB-123-CD", vin: "VF3123456789" }
      ]
    },
    photos: []
  };

  const encrypted = await encryptBackupPayload(payload, "secret-pwd");
  assert.equal(encrypted.app, "nimr-sav-encrypted-backup", "Le type de sauvegarde chiffrée doit être correct");
  
  // Vérifier qu'aucune PII n'est visible en clair dans le JSON chiffré
  const rawEncryptedString = JSON.stringify(encrypted);
  assert.ok(!rawEncryptedString.includes("Alice Dupont"), "Le nom du client ne doit pas être visible en clair");
  assert.ok(!rawEncryptedString.includes("0601020304"), "Le téléphone du client ne doit pas être visible en clair");
  assert.ok(!rawEncryptedString.includes("VF3123456789"), "Le VIN ne doit pas être visible en clair");
  assert.ok(!rawEncryptedString.includes("AB-123-CD"), "La plaque ne doit pas être visible en clair");
  console.log("Test 3 OK : Export chiffré .nimrsecure masque toutes les PII en clair");

  // Test 5, 6, 7, 8, 9: Nettoyage poste
  store.clear();
  sessionStore.clear();

  // Remplir des données
  store.set("nimr-carrosserie-v1:dossiers", "sensitive info");
  store.set("nimr-sav:supabase-runtime-config:v1", "supabase info");
  sessionStore.set("nimr-carrosserie-v1:local-security-unlocked", "true");

  dbDeleted = false;
  cacheDeleted = false;
  swUnregistered = false;
  lastPromptValue = "NETTOYER";

  // Mock global window to make caches API available to cleanWorkstation
  global.caches = global.caches;
  
  await cleanLocalWorkstation();

  // Vérifier localStorage
  assert.equal(store.get("nimr-carrosserie-v1:dossiers"), undefined, "Le localStorage applicatif doit être vidé");
  assert.equal(store.get("nimr-sav:supabase-runtime-config:v1"), undefined, "La config Supabase locale doit être vidée");
  
  // Vérifier sessionStorage
  assert.equal(sessionStore.get("nimr-carrosserie-v1:local-security-unlocked"), undefined, "Le sessionStorage applicatif doit être vidé");
  
  // Vérifier IndexedDB, caches, service worker
  assert.ok(dbDeleted, "La base de données IndexedDB doit être supprimée");
  assert.ok(cacheDeleted, "Le cache PWA doit être supprimé");
  assert.ok(swUnregistered, "Le Service Worker doit être désenregistré");
  console.log("Test 5, 6, 7, 8, 9 OK : Le nettoyage de poste vide intégralement localStorage, sessionStorage, IndexedDB, caches et service workers");

  // Test 10: Import backup affiche avertissement sécurité
  lastModalMessage = "";
  lastModalResult = false;
  const mockFile = {
    size: 1000,
    name: "backup.json"
  };
  global.readFileAsText = async () => JSON.stringify({
    app: "nimr-carrosserie",
    version: 2,
    state: { cases: [] },
    photos: [],
    metadata: { appVersion: "v22.33", exportedAt: new Date().toISOString() }
  });

  const mockEvent = {
    target: {
      files: [mockFile],
      value: "backup.json"
    }
  };

  await importBackup(mockEvent);
  assert.ok(
    lastModalMessage.includes("Attention :") && lastModalMessage.includes("RGPD"),
    "L'importation de sauvegarde doit afficher un message de mise en garde RGPD"
  );
  console.log("Test 10 OK : Avertissement de sécurité lors de l'import d'une sauvegarde");

  // Test 11: Restauration cloud affiche avertissement sécurité
  // Simuler client Supabase
  global.getSupabaseClient = () => ({});
  global.getSupabaseUser = async () => ({ id: "user-123", email: "user@example.com" });
  global.getSupabaseConfig = () => ({ backupTable: "cloud_backups", backupKey: "nimr" });
  
  lastModalMessage = "";
  lastModalResult = false;
  await restoreLocalFromSupabase();
  assert.ok(
    lastModalMessage.includes("Attention :") && lastModalMessage.includes("écrase"),
    "La restauration cloud Supabase doit afficher un message de mise en garde"
  );
  console.log("Test 11 OK : Avertissement de sécurité lors de la restauration cloud");

  console.log("Tous les tests de sécurité locale et RGPD v22.33D ont réussi !");
}

runTests().catch(err => {
  console.error("Échec des tests v22.33D :", err);
  process.exit(1);
});
