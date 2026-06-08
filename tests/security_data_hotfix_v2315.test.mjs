import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const vehicleJson = fs.readFileSync("data/vehicles.json", "utf8");
const swSource = fs.readFileSync("sw.js", "utf8");
const indexSource = fs.readFileSync("index.html", "utf8");
const appSource = fs.readFileSync("app.js", "utf8");
const storageSource = fs.readFileSync("js/storage.js", "utf8");
const stateSource = fs.readFileSync("js/state.js", "utf8");
const versionSource = fs.readFileSync("js/version.js", "utf8");
const supabaseSchema = fs.readFileSync("supabase-schema.sql", "utf8");
const EXPECTED_APP_VERSION = "v23.2.3";
const EXPECTED_QUERY_VERSION = "23.2.3";
const EXPECTED_CACHE_NAME = "nimr-sav-v23.2.3-offline-sync-conflict-local-data-hardening";

console.log("Démarrage tests sécurité données + version/cache v23.2.3...");

assert.doesNotThrow(() => JSON.parse(vehicleJson), "data/vehicles.json doit rester un JSON valide");
const vehicleRecords = JSON.parse(vehicleJson);
assert.ok(Array.isArray(vehicleRecords), "data/vehicles.json doit contenir un tableau");
assert.deepEqual(vehicleRecords, [], "data/vehicles.json doit rester un tableau public vide");

const hasNonEmptyClientName = vehicleRecords.some((record) => String(record?.clientName || "").trim());
const hasNonEmptyPhone = vehicleRecords.some((record) => String(record?.phone || "").trim());
const hasNonEmptyVin = vehicleRecords.some((record) => String(record?.vin || "").trim());
const hasNonEmptyPlate = vehicleRecords.some((record) => String(record?.plate || "").trim());
assert.equal(hasNonEmptyClientName, false, "Aucun nom client ne doit être livré dans data/vehicles.json");
assert.equal(hasNonEmptyPhone, false, "Aucun téléphone ne doit être livré dans data/vehicles.json");
assert.equal(hasNonEmptyVin, false, "Aucun VIN ne doit être livré dans data/vehicles.json");
assert.equal(hasNonEmptyPlate, false, "Aucune immatriculation ne doit être livrée dans data/vehicles.json");

assert.equal(/\b[A-HJ-NPR-Z0-9]{17}\b/i.test(vehicleJson), false, "Aucun VIN réel ne doit apparaître en clair");
assert.equal(/\b\d{1,4}\s*TU\s*\d{1,3}\b/i.test(vehicleJson), false, "Aucune plaque tunisienne réelle ne doit apparaître en clair");
assert.equal(/\b(?:\+?216)?[\s.-]?\d{2}[\s.-]?\d{3}[\s.-]?\d{3}\b/.test(vehicleJson), false, "Aucun téléphone ne doit apparaître en clair");

assert.equal(swSource.includes("./data/vehicles.json"), false, "sw.js ne doit pas précacher data/vehicles.json");
assert.ok(swSource.includes(`const CACHE_NAME = "${EXPECTED_CACHE_NAME}"`), "sw.js doit exposer le cache PWA v23.2.3");
assert.ok(stateSource.includes(`const APP_VERSION = "${EXPECTED_APP_VERSION}"`), "APP_VERSION doit être v23.2.3 dans state.js");
assert.ok(versionSource.includes(`window.APP_VERSION = "${EXPECTED_APP_VERSION}"`), "version.js doit exposer APP_VERSION v23.2.3");
assert.ok(versionSource.includes(`window.NIMR_BUILD = "${EXPECTED_APP_VERSION}"`), "version.js doit exposer NIMR_BUILD v23.2.3");
assert.ok(versionSource.includes(`window.NIMR_CACHE_NAME = "${EXPECTED_CACHE_NAME}"`), "version.js doit annoncer le cache v23.2.3");
assert.ok(appSource.includes(`serviceWorker.register("sw.js?v=${EXPECTED_QUERY_VERSION}"`), "app.js doit enregistrer sw.js?v=23.2.3");
[...indexSource.matchAll(/\?v=(\d+\.\d+(?:\.\d+)?)/g)].forEach((match) => {
  assert.equal(match[1], EXPECTED_QUERY_VERSION, `référence index.html incohérente: ?v=${match[1]}`);
});
[
  ["index.html", indexSource],
  ["app.js", appSource],
  ["js/state.js", stateSource],
  ["js/version.js", versionSource],
  ["sw.js", swSource],
].forEach(([fileName, source]) => {
  assert.equal(
    /\bv23\.1\.[345]\b|\b23\.1\.[345]\b|nimr-sav-v23\.1\.[345]/.test(source),
    false,
    `${fileName} ne doit plus référencer une version/cache v23.1.3/v23.1.4/v23.1.5`,
  );
});
assert.equal(
  /create policy "repair photos [^"]+ authenticated"[\s\S]*?on storage\.objects[\s\S]*?bucket_id = 'repair-photos'\s*\)/i.test(supabaseSchema),
  false,
  "Les policies repair-photos ne doivent pas recréer un accès global authenticated",
);
assert.match(supabaseSchema, /storage_object_workshop_id/, "Les policies storage doivent extraire le workshop_id depuis le préfixe du chemin");
assert.match(supabaseSchema, /repair photos select workshop member/, "La policy Storage doit être limitée aux membres de l'atelier");

function createElementStub() {
  return {
    value: "",
    textContent: "",
    innerHTML: "",
    hidden: false,
    dataset: {},
    style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute() {},
    removeAttribute() {},
    toggleAttribute() {},
    addEventListener() {},
    append() {},
    appendChild() {},
    replaceChildren() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    closest: () => null,
  };
}

const context = {
  console: { log: () => {}, warn: () => {}, error: console.error },
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  document: {
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    createElement: () => createElementStub(),
  },
  window: { addEventListener: () => {} },
  navigator: {},
  fetch: async () => ({ ok: false, status: 404, text: async () => "" }),
  setTimeout,
  clearTimeout,
  Blob,
  URL: { createObjectURL: () => "", revokeObjectURL: () => {} },
  FormData: class FormData {},
};

vm.createContext(context);
vm.runInContext(
  [fs.readFileSync("js/utils.js", "utf8"), stateSource, storageSource].join("\n"),
  context,
  { filename: "vehicle-loader.js" },
);

async function assertVehicleDatabaseLoadDoesNotCrash(fetchImpl, label) {
  context.fetch = fetchImpl;
  await vm.runInContext("loadBundledVehicleDatabase()", context);
  assert.equal(vm.runInContext("vehicleRecords.length", context), 0, `${label}: aucun enregistrement ne doit être chargé`);
  assert.equal(vm.runInContext("vehicleDatabaseLoaded", context), false, `${label}: la base livrée doit rester non chargée`);
}

await assertVehicleDatabaseLoadDoesNotCrash(
  async () => ({ ok: false, status: 404, text: async () => "" }),
  "Fichier absent",
);
await assertVehicleDatabaseLoadDoesNotCrash(
  async () => ({ ok: true, status: 200, text: async () => "" }),
  "Fichier vide",
);
await assertVehicleDatabaseLoadDoesNotCrash(
  async () => ({ ok: true, status: 200, text: async () => "[]" }),
  "Tableau vide",
);

console.log("Tests sécurité données + version/cache v23.2.3 OK");
