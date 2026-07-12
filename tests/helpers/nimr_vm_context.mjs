import fs from "node:fs";
import vm from "node:vm";
import { performance } from "node:perf_hooks";

const DEFAULT_SCRIPT_FILES = [
  "../../js/state.js",
  "../../js/ui-cases.js",
  "../../js/estimate-import.js",
  "../../js/ui-planning.js",
  "../../js/photos.js",
  "../../js/storage.js",
  "../../js/planning.js",
  "../../js/exports.js",
  "../../js/business-rules-v2187.js",
  "../../js/utils.js",
  "../../app.js",
];

function createElementStub() {
  return {
    value: "",
    checked: false,
    textContent: "",
    innerHTML: "",
    hidden: false,
    disabled: false,
    children: [],
    dataset: {},
    style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute() {},
    removeAttribute() {},
    toggleAttribute() {},
    hasAttribute: () => false,
    addEventListener() {},
    focus() {},
    click() {},
    closest: () => null,
    contains: () => false,
    append() {},
    appendChild() {},
    replaceChildren() {},
    querySelector: () => createElementStub(),
    querySelectorAll: () => [],
  };
}

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial).map(([key, value]) => [key, String(value)]));
  return {
    values,
    getItem(key) { return values.has(String(key)) ? values.get(String(key)) : null; },
    setItem(key, value) { values.set(String(key), String(value)); },
    removeItem(key) { values.delete(String(key)); },
    clear() { values.clear(); },
  };
}

export function createNimrVmContext(options = {}) {
  const scriptFiles = options.scriptFiles || DEFAULT_SCRIPT_FILES;
  const source = scriptFiles
    .map((file) => fs.readFileSync(new URL(file, import.meta.url), "utf8"))
    .join("\n")
    .replace(/initApp\(\);/, "// initApp skipped by VM contract tests")
    .replace(/if \("serviceWorker" in navigator[\s\S]*$/u, "");
  const localStorage = createStorage(options.localStorage);
  const sessionStorage = createStorage(options.sessionStorage);
  const context = {
    console: options.console || console,
    localStorage,
    sessionStorage,
    document: {
      getElementById: () => createElementStub(),
      querySelector: () => createElementStub(),
      querySelectorAll: () => [],
      addEventListener() {},
      createElement: () => createElementStub(),
      body: createElementStub(),
    },
    navigator: {},
    fetch: async () => ({ ok: false }),
    setTimeout,
    clearTimeout,
    Blob,
    URL: { createObjectURL: () => "", revokeObjectURL() {} },
    FormData: class FormData {},
    TextEncoder,
    TextDecoder,
    performance,
    crypto: globalThis.crypto,
    structuredClone: globalThis.structuredClone,
    addEventListener() {},
    confirm: () => true,
    alert() {},
  };
  context.globalThis = context;
  context.window = context;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: options.filename || "nimr-vm-contract.js" });
  return {
    context,
    source,
    localStorage,
    sessionStorage,
    run(expression) { return vm.runInContext(expression, context); },
  };
}
