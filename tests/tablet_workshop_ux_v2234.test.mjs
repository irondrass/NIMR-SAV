import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

console.log("Démarrage des tests v22.34 : UX Tablet / Workshop Ergonomics...");

// 1. Lire les sources des fichiers
const utilsJs = fs.readFileSync("./js/utils.js", "utf8");
const stateJs = fs.readFileSync("./js/state.js", "utf8");
const uiCasesJs = fs.readFileSync("./js/ui-cases.js", "utf8");
const stylesCss = fs.readFileSync("./styles.css", "utf8");

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

global.state = {
  cases: [],
  bookings: [],
  users: [],
  currentUserId: "",
  ui: {},
  settings: {},
  resources: [
    { id: "r-tech1", name: "Ressource Tech 1", role: "technicien", active: true }
  ],
  auditLog: []
};

global.uid = (prefix) => `${prefix}-${Math.random().toString(36).substring(2, 6)}`;
global.TECHNICIAN_PAUSE_REASONS = [
  "pause repas",
  "attente pièces",
  "attente accord",
  "attente expert",
  "attente chef atelier",
  "panne outil / ressource",
  "autre"
];

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

// Mock DOM elements
const elements = {};
const getElement = (id) => {
  const cleanId = id.replace(/[.#]/g, "");
  if (!elements[cleanId]) {
    elements[cleanId] = {
      id: cleanId,
      tagName: cleanId.toUpperCase(),
      hidden: true,
      disabled: false,
      value: "",
      checked: false,
      innerHTML: "",
      textContent: "",
      dataset: {},
      style: {},
      children: [],
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
      removeEventListener(event, listener) {
        const list = this.listeners.get(event) || [];
        const index = list.indexOf(listener);
        if (index !== -1) list.splice(index, 1);
      },
      dispatchEvent(event, extra = {}) {
        const list = this.listeners.get(event) || [];
        list.forEach(l => l(Object.assign({ currentTarget: this, target: this, preventDefault() {} }, extra)));
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
      appendChild(child) {
        this.children.push(child);
      },
      replaceChildren(...children) {
        this.children = children;
        this.innerHTML = children.map((child) => child.outerHTML || child.textContent || "").join("");
      },
      removeChild(child) {
        if (this.children) {
          const index = this.children.indexOf(child);
          if (index !== -1) this.children.splice(index, 1);
        }
      },
      querySelector(sel) {
        return getElement(sel);
      },
      querySelectorAll(sel) {
        if (sel === "[data-tech-action]") {
          return [
            getElement("btn-start"),
            getElement("btn-pause"),
            getElement("btn-resume"),
            getElement("btn-complete")
          ];
        }
        return [];
      },
      focus() {},
      select() {}
    };
  }
  return elements[cleanId];
};

global.document = {
  getElementById: (id) => getElement(id),
  querySelector: (sel) => getElement(sel),
  querySelectorAll: (sel) => {
    if (sel === "[data-tech-action]") {
      return [
        getElement("btn-start"),
        getElement("btn-pause"),
        getElement("btn-resume"),
        getElement("btn-complete")
      ];
    }
    return [];
  },
  createElement: (tag) => {
    return {
      tagName: String(tag || "").toUpperCase(),
      className: "",
      textContent: "",
      value: "",
      selected: false,
      disabled: false,
      id: "",
      type: "",
      autocomplete: "",
      style: {},
      dataset: {},
      children: [],
      listeners: new Map(),
      setAttribute: () => {},
      appendChild(child) {
        this.children.push(child);
      },
      replaceChildren(...children) {
        this.children = children;
        this.innerHTML = children.map((child) => child.outerHTML || child.textContent || "").join("");
      },
      addEventListener(event, listener) {
        if (!this.listeners.has(event)) this.listeners.set(event, []);
        this.listeners.get(event).push(listener);
      },
      removeEventListener(event, listener) {
        const list = this.listeners.get(event) || [];
        const index = list.indexOf(listener);
        if (index !== -1) list.splice(index, 1);
      },
      dispatchEvent(event, extra = {}) {
        const list = this.listeners.get(event) || [];
        list.forEach(l => l(Object.assign({ currentTarget: this, target: this, preventDefault() {} }, extra)));
      },
      focus() {},
      select() {},
      classList: {
        add: () => {}
      },
      remove: () => {}
    };
  },
  createTextNode: (text) => ({ nodeType: 3, textContent: String(text || "") })
};

global.escapeHtml = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Évaluer les scripts
vm.runInThisContext(utilsJs);
vm.runInThisContext(stateJs);
vm.runInThisContext(uiCasesJs);

async function runTests() {
  // Test 1: styles tactiles >= 48px présents dans styles.css under media query max-width: 1024px
  assert.ok(stylesCss.includes("@media (max-width: 1024px)"), "styles.css doit inclure la media query 1024px");
  assert.ok(stylesCss.includes("min-height: 48px !important"), "styles.css doit inclure min-height: 48px");

  // Test 2: actions principales >= 56px présents
  assert.ok(stylesCss.includes("min-height: 56px !important"), "styles.css doit inclure min-height: 56px");
  assert.ok(stylesCss.includes('[data-tech-action="start"]'), "styles.css doit cibler l'action start");

  // Test 3: showInputPromptModal existe sur window
  assert.equal(typeof global.showInputPromptModal, "function", "showInputPromptModal doit être défini");

  // Test 4: showInputPromptModal supporte input texte
  {
    const promise = global.showInputPromptModal({
      title: "Test texte",
      message: "Entrez une note :",
      defaultValue: "valeurInitiale"
    });

    const body = getElement("custom-modal-body");
    const inputEl = body.children.find((child) => child.id === "prompt-modal-input");
    assert.equal(inputEl?.tagName, "INPUT", "Le corps du modal doit contenir un input texte");
    assert.equal(inputEl.value, "valeurInitiale", "L'input doit avoir la valeur par défaut");

    // Simuler le fait de renseigner une valeur
    inputEl.value = "NouvelleNote";

    // Cliquer sur confirmer
    const confirmBtn = getElement("custom-modal-confirm");
    confirmBtn.dispatchEvent("click");

    const result = await promise;
    assert.equal(result, "NouvelleNote", "Le modal doit renvoyer la valeur saisie");
  }

  // Test 5: showInputPromptModal supporte select options
  {
    const promise = global.showInputPromptModal({
      title: "Test select",
      message: "Choisissez un motif :",
      defaultValue: "opt2",
      options: [
        ["opt1", "Option 1"],
        ["opt2", "Option 2"]
      ]
    });

    const body = getElement("custom-modal-body");
    const inputEl = body.children.find((child) => child.id === "prompt-modal-input");
    assert.equal(inputEl?.tagName, "SELECT", "Le corps du modal doit contenir un élément select");
    assert.equal(inputEl.children.find((option) => option.value === "opt2")?.selected, true, "L'option defaultValue doit être sélectionnée");

    inputEl.value = "opt1"; // simuler le choix de l'utilisateur

    const confirmBtn = getElement("custom-modal-confirm");
    confirmBtn.dispatchEvent("click");

    const result = await promise;
    assert.equal(result, "opt1", "Le modal doit renvoyer l'option sélectionnée");
  }

  // Test 6: showInputPromptModal retourne null sur annulation
  {
    const promise = global.showInputPromptModal({
      title: "Test annulation",
      message: "Annulez-moi",
      defaultValue: "a"
    });

    const cancelBtn = getElement("custom-modal-cancel");
    cancelBtn.dispatchEvent("click");

    const result = await promise;
    assert.equal(result, null, "Le modal doit renvoyer null si annulé");
  }

  // Test 7: aucun window.prompt ne subsiste dans handleTechnicianTaskAction
  const code = global.handleTechnicianTaskAction.toString();
  assert.ok(!code.includes("window.prompt"), "Aucun window.prompt ne doit subsister dans handleTechnicianTaskAction");

  // Test 8: anti-double-clic présent dans handleTechnicianTaskAction
  {
    // Mocking state and business logic dependencies
    state.bookings = [{ id: "booking-1", caseId: "case-1", status: "planned" }];
    state.cases = [{ id: "case-1", flags: { received: true } }];
    global.startTechnicianTask = () => {
      // Simuler une opération asynchrone un peu lente
      return new Promise((resolve) => setTimeout(() => resolve({ ok: true, message: "Started" }), 50));
    };

    const firstCall = global.handleTechnicianTaskAction("start", "booking-1", "r-tech1");
    const secondCall = global.handleTechnicianTaskAction("start", "booking-1", "r-tech1");

    // the second call should return immediately or not start a new task
    const secondRes = await secondCall;
    assert.equal(secondRes, undefined, "La deuxième action concurrente doit être ignorée");

    await firstCall;
  }

  // Test 9: vue technicien compatible 20+ tâches sans overflow horizontal non prévu
  assert.ok(stylesCss.includes("overflow-x: hidden"), "styles.css doit empêcher le scroll horizontal");

  console.log("Tests v22.34 complétés avec succès !");
}

runTests().catch(err => {
  console.error("Échec des tests :", err);
  process.exit(1);
});
