import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const scriptFiles = [
  "../js/state.js",
  "../js/ui-cases.js",
  "../js/estimate-import.js",
  "../js/ui-planning.js",
  "../js/photos.js",
  "../js/storage.js",
  "../js/planning.js",
  "../js/exports.js",
  "../js/utils.js",
  "../app.js",
];

const appSource = scriptFiles
  .map((file) => fs.readFileSync(new URL(file, import.meta.url), "utf8"))
  .join("\n")
  .replace(/initApp\(\);/, "// initApp skipped by simplified workflow tests")
  .replace(/if \("serviceWorker" in navigator[\s\S]*$/u, "");

function createElementStub() {
  return {
    value: "",
    textContent: "",
    innerHTML: "",
    hidden: false,
    dataset: {},
    style: {},
    classList: { add() {}, remove() {}, toggle() {} },
    setAttribute() {},
    removeAttribute() {},
    toggleAttribute() {},
    addEventListener() {},
    append() {},
    appendChild() {},
    replaceChildren() {},
    querySelector: () => createElementStub(),
    querySelectorAll: () => [],
  };
}

const context = {
  console,
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  document: {
    getElementById: () => createElementStub(),
    querySelector: () => createElementStub(),
    querySelectorAll: () => [],
    addEventListener: () => {},
    createElement: () => createElementStub(),
  },
  window: { addEventListener: () => {} },
  navigator: {},
  fetch: async () => ({ ok: false }),
  setTimeout,
  clearTimeout,
  Blob,
  URL: { createObjectURL: () => "", revokeObjectURL: () => {} },
  FormData: class FormData {},
};

context.globalThis = context;
context.window = Object.assign(context.window, context);
vm.createContext(context);
vm.runInContext(appSource, context);
const run = (source) => vm.runInContext(source, context);

assert.equal(typeof context.getCaseStatus, "function", "getCaseStatus doit être exposé dans le contexte de test");

run(`
state = normalizeState({
  resources: [
    { id: "tech-atelier", name: "Technicien atelier", role: "mecanicien", active: true }
  ],
  cases: [{
    id: "case-simplified-archive",
    clientName: "Flux simplifié archive",
    plate: "123 TU 4567",
    appointment: {
      start: "2026-06-02T08:00:00.000Z",
      end: "2026-06-02T09:00:00.000Z"
    },
    flags: {
      received: true,
      workStarted: true,
      workCompleted: true
    },
    claims: [{
      id: "claim-simplified-archive",
      type: "client",
      includeInPlanning: true,
      estimate: {
        lines: [{ phase: "mechanical", operation: "Réparation atelier", laborHours: 1 }]
      }
    }]
  }],
  bookings: [{
    id: "booking-simplified-archive",
    caseId: "case-simplified-archive",
    key: "mechanical",
    resourceIds: ["tech-atelier"],
    status: "completed",
    completedAt: "2026-06-02T09:00:00.000Z",
    segments: [{
      start: "2026-06-02T08:00:00.000Z",
      end: "2026-06-02T09:00:00.000Z"
    }]
  }]
});
`, context);

assert.equal(
  run("getNextWorkflowAction(state.cases[0])"),
  "invoiced",
  "après fin atelier, le flux simplifié doit demander la clôture atelier",
);
assert.equal(
  run('getBusinessRuleIssues(state.cases[0], "invoiced").length'),
  0,
  "la clôture atelier ne doit pas être bloquée par une étape livraison/qualité masquée",
);

const result = run('applyWorkflowAction(state.cases[0], "invoiced")');
assert.equal(result.ok, true, "archive succeeds after atelier closure");
assert.equal(run("getCaseStatus(state.cases[0])"), "invoiced", "le statut réel doit être clôturé atelier");
assert.equal(run("isCaseReadonlyArchive(state.cases[0])"), true, "le dossier clôturé atelier doit être readonly");
assert.equal(run("getCaseNextAction(state.cases[0]).code"), "done", "un dossier clôturé atelier ne doit plus proposer d’action opérationnelle");

console.log("Simplified workflow NIMR SAV OK");
