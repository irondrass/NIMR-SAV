import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";

const pdfPath = process.argv[2] || process.env.NIMR_FIELD_PDF;
if (!pdfPath) {
  throw new Error("Usage: node tests\\field_pdf_import.test.mjs <chemin-du-pdf-reel>");
}

const scriptFiles = [
  "vendor/pdf.min.js",
  "js/state.js",
  "js/estimate-import.js",
  "js/ui-cases.js",
  "js/ui-planning.js",
  "js/photos.js",
  "js/storage.js",
  "js/planning.js",
  "js/exports.js",
  "js/utils.js",
  "app.js",
];

const root = process.cwd();
const appSource = (await Promise.all(scriptFiles.map((file) => fs.readFile(path.join(root, file), "utf8"))))
  .join("\n")
  .replace(/initApp\(\);/, "// initApp skipped by field PDF import test")
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
    currentScript: null,
    getElementById: () => createElementStub(),
    querySelector: () => createElementStub(),
    querySelectorAll: () => [],
    addEventListener: () => {},
    createElement: () => createElementStub(),
  },
  window: { addEventListener: () => {} },
  navigator: {},
  location: { href: "http://127.0.0.1/field-pdf-import" },
  fetch: async () => ({ ok: false }),
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  Blob,
  URL: { createObjectURL: () => "", revokeObjectURL: () => {} },
  FormData: class FormData {},
  TextDecoder,
  TextEncoder,
  atob,
  btoa,
};

context.globalThis = context;
context.window = Object.assign(context.window, context);
vm.createContext(context);
vm.runInContext(appSource, context);
vm.runInContext(`
  window.pdfjsLib = window.pdfjsLib || globalThis.pdfjsLib || (typeof pdfjsLib !== "undefined" ? pdfjsLib : null);
`, context);

const bytes = await fs.readFile(pdfPath);
const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
context.__fieldPdfFile = {
  name: path.basename(pdfPath),
  type: "application/pdf",
  size: bytes.byteLength,
  arrayBuffer: async () => arrayBuffer.slice(0),
};

const result = await vm.runInContext(`(async () => {
  state = normalizeState({
    resources: [
      { id: "tolier-field", name: "Tôlier terrain", role: "tolier", active: true },
      { id: "peintre-field", name: "Peintre terrain", role: "peintre", active: true },
      { id: "cabine-field", name: "Cabine terrain", role: "cabine", active: true },
      { id: "zone-field", name: "Zone préparation terrain", role: "zone_preparation", active: true }
    ],
    cases: [{
      id: "case-field-pdf",
      clientName: "Client terrain PDF",
      plate: "3527TU259",
      claims: [{ id: "claim-field-pdf", type: "assurance", includeInPlanning: true }]
    }]
  });
  const item = state.cases[0];
  const extracted = await extractEstimateTextFromFile(__fieldPdfFile);
  const parsed = parseEstimateText(extracted.text, {
    sourceType: extracted.sourceType,
    rows: extracted.rows,
    lines: extracted.lines
  });
  const preview = prepareEstimateImportPreview(parsed, item);
  return {
    fileName: __fieldPdfFile.name,
    sourceType: extracted.sourceType,
    textLength: extracted.text.length,
    lineCount: extracted.lines.length,
    estimateNumber: parsed.info?.estimateNumber || "",
    clientName: parsed.info?.clientName || "",
    plate: parsed.info?.plate || "",
    detectedHours: parsed.detectedHours,
    allocations: parsed.allocations,
    durations: preview.durations,
    laborLines: parsed.laborLines.map((line) => ({
      phase: line.phase,
      operation: line.operation,
      laborHours: line.laborHours
    })),
    parts: parsed.parts.map((part) => ({
      designation: part.designation,
      quantity: part.quantity
    })),
    nextActionAfterImport: (() => {
      item.claims[0].estimate = {
        reference: parsed.info?.estimateNumber || "",
        lines: preview.lines,
        originalLines: preview.originalLines,
        parts: preview.parts
      };
      item.durations = { ...item.durations, ...preview.durations };
      return getNextWorkflowAction(item);
    })()
  };
})()`, context);

assert.equal(result.sourceType, "pdf", "le fichier terrain doit être traité comme PDF");
assert.ok(result.textLength > 0, "le PDF réel doit fournir du texte extractible");
assert.ok(result.laborLines.length > 0, "le PDF réel doit produire au moins une ligne de main-d'œuvre");
assert.ok(result.detectedHours > 0, "le PDF réel doit produire des heures atelier");
assert.ok(Object.values(result.durations).some((value) => Number(value || 0) > 0), "le PDF réel doit alimenter les durées de planning");
assert.equal(result.nextActionAfterImport, "appointment", "après import terrain, le flux simplifié doit pouvoir aller au RDV");

console.log(JSON.stringify(result, null, 2));
