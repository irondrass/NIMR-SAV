import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const testDirectory = path.dirname(
  fileURLToPath(import.meta.url),
);
const repositoryRoot = path.resolve(
  testDirectory,
  "..",
);
const utilsPath = path.join(
  repositoryRoot,
  "js",
  "utils.js",
);
const source = fs.readFileSync(
  utilsPath,
  "utf8",
);

assert.doesNotMatch(
  source,
  /const key = event\.key\.toLowerCase\(\);/u,
  "Le raccourci ne doit plus supposer event.key défini.",
);
assert.match(
  source,
  /const key = String\(event\?\.key \|\| ""\)\.toLowerCase\(\);/u,
  "Le raccourci doit normaliser défensivement event.key.",
);

const snippetStart = source.indexOf(
  "function startReceptionCaseCreation()",
);
assert.ok(
  snippetStart >= 0,
  "startReceptionCaseCreation doit exister.",
);

const shortcutSource = source.slice(snippetStart);
assert.match(
  shortcutSource,
  /function bindKeyboardShortcuts\(\)/u,
  "bindKeyboardShortcuts doit exister.",
);

const listeners = new Map();
const actions = {
  focusSearch: 0,
  preventDefault: 0,
  activeTabs: [],
  focusedSelectors: [],
};

const context = {
  console,
  document: {
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
  },
  window: {
    setTimeout(callback) {
      callback();
      return 1;
    },
  },
  focusCaseSearch() {
    actions.focusSearch += 1;
  },
  setActiveTab(tab) {
    actions.activeTabs.push(tab);
  },
  canAccessTab() {
    return false;
  },
  renderReceptionWorkspace() {},
  $(selector) {
    return {
      focus() {
        actions.focusedSelectors.push(selector);
      },
    };
  },
};

vm.createContext(context);
vm.runInContext(
  shortcutSource,
  context,
  { filename: "js/utils-shortcuts.js" },
);
vm.runInContext(
  "bindKeyboardShortcuts();",
  context,
);

const keydown = listeners.get("keydown");
assert.equal(
  typeof keydown,
  "function",
  "Le listener keydown doit être enregistré.",
);

assert.doesNotThrow(
  () => keydown({
    ctrlKey: false,
    metaKey: false,
  }),
  "Un événement sans key ne doit jamais planter.",
);
assert.doesNotThrow(
  () => keydown({
    key: null,
    ctrlKey: false,
    metaKey: false,
  }),
  "Une key nulle ne doit jamais planter.",
);
assert.equal(actions.focusSearch, 0);
assert.deepEqual(actions.activeTabs, []);

keydown({
  key: "K",
  ctrlKey: true,
  metaKey: false,
  preventDefault() {
    actions.preventDefault += 1;
  },
});
assert.equal(
  actions.focusSearch,
  1,
  "Ctrl+K doit continuer à cibler la recherche.",
);
assert.equal(actions.preventDefault, 1);

keydown({
  key: "N",
  ctrlKey: false,
  metaKey: true,
  preventDefault() {
    actions.preventDefault += 1;
  },
});
assert.equal(
  actions.preventDefault,
  2,
  "Cmd/Ctrl+N doit rester intercepté.",
);
assert.deepEqual(
  actions.activeTabs,
  ["dossiers"],
  "Sans accès réception, le raccourci doit revenir aux dossiers.",
);
assert.deepEqual(
  actions.focusedSelectors,
  ["#case-form input[name='clientName']"],
);

console.log(
  "KEYBOARD SHORTCUTS DEFENSIVE CONTRACT V23.4.0 C2A OK",
);
