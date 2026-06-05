import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const vehicleJson = fs.readFileSync("data/vehicles.json", "utf8");
const swSource = fs.readFileSync("sw.js", "utf8");
const storageSource = fs.readFileSync("js/storage.js", "utf8");
const stateSource = fs.readFileSync("js/state.js", "utf8");
const versionSource = fs.readFileSync("js/version.js", "utf8");
const supabaseSchema = fs.readFileSync("supabase-schema.sql", "utf8");

console.log("Démarrage tests sécurité données v23.1.5...");

assert.doesNotThrow(() => JSON.parse(vehicleJson), "data/vehicles.json doit rester un JSON valide");
const vehicleRecords = JSON.parse(vehicleJson);
assert.ok(Array.isArray(vehicleRecords), "data/vehicles.json doit contenir un tableau");

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
assert.match(swSource, /nimr-sav-v23\.1\.5-security-data-hotfix/, "Le cache PWA doit forcer la purge v23.1.5");
assert.match(stateSource, /APP_VERSION\s*=\s*"v23\.1\.5"/, "APP_VERSION doit être v23.1.5");
assert.match(versionSource, /NIMR_CACHE_NAME\s*=\s*"nimr-sav-v23\.1\.5-security-data-hotfix"/, "version.js doit annoncer le cache sécurité");
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

console.log("Tests sécurité données v23.1.5 OK");
