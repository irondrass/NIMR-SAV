import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(
  new URL("../js/supabase-sync.js", import.meta.url),
  "utf8",
);

assert.doesNotMatch(
  source,
  /localStorage\.setItem\(\s*"nimr-sav-restore-safety-snapshot:last",\s*JSON\.stringify\(safetyPayload\)\s*\)/,
);
assert.match(
  source,
  /runIndexedDbTransaction\(\s*"sync_metadata",\s*"readwrite"/,
);
assert.match(
  source,
  /await createRequiredRestoreSafetySnapshot\([\s\S]*type: "restore_global"/,
);
assert.match(
  source,
  /await createRequiredRestoreSafetySnapshot\([\s\S]*type: "cloud_merge_replace"/,
);
assert.match(
  source,
  /addEventListener\("click", async \(\) => \{[\s\S]*await loadRestoreSafetySnapshot\(\)/,
);

const constantsStart = source.indexOf(
  "const RESTORE_SAFETY_SNAPSHOT_LOCAL_KEY",
);
const helpersEnd = source.indexOf(
  "async function confirmRemoteBackupConflict",
  constantsStart,
);
assert.ok(constantsStart >= 0 && helpersEnd > constantsStart);

const helperSource = source
  .slice(constantsStart, helpersEnd)
  .trim();
assert.match(
  helperSource,
  /^const RESTORE_SAFETY_SNAPSHOT_LOCAL_KEY/,
);
assert.match(
  helperSource,
  /async function saveRestoreSafetySnapshot/,
);
assert.match(
  helperSource,
  /async function loadRestoreSafetySnapshot/,
);
assert.match(
  helperSource,
  /async function createRequiredRestoreSafetySnapshot/,
);
assert.equal(
  (
    source.match(
      /addAuditLog\s*\(\s*"conflict\.safety_snapshot\.created"/g,
    ) || []
  ).length,
  1,
  "la trace created doit être centralisée après succès du stockage",
);
assert.match(
  source,
  /const safetySnapshotGate = await createRequiredRestoreSafetySnapshot\([\s\S]*if \(!safetySnapshotGate\.allowed\) return;[\s\S]*state = normalizeState\(data\.state\)/,
  "la restauration manuelle doit s'arrêter avant de remplacer state",
);
assert.match(
  source,
  /async function confirmRemoteBackupConflict[\s\S]*return safetySnapshotGate\.allowed;/,
  "le conflit entrant doit être refusé si le snapshot de sécurité échoue",
);
assert.match(
  source,
  /const canApply = await confirmRemoteBackupConflict\(data, reason\);\s*if \(!canApply\) return false;/,
  "l'état distant ne doit pas être appliqué sans autorisation de sécurité",
);
assert.doesNotMatch(
  source,
  /Restauration poursuivie sans snapshot local persistant/,
);

const idbRecords = new Map();
const localValues = new Map();
const localStorage = {
  getItem(key) {
    return localValues.has(String(key))
      ? localValues.get(String(key))
      : null;
  },
  removeItem(key) {
    localValues.delete(String(key));
  },
  setItem(key, value) {
    const text = String(value);
    if (text.length > 1000) {
      const error = new Error("Quota exceeded");
      error.name = "QuotaExceededError";
      throw error;
    }
    localValues.set(String(key), text);
  },
};

async function runIndexedDbTransaction(storeName, mode, operation) {
  assert.equal(storeName, "sync_metadata");
  const store = {
    put(record) {
      idbRecords.set(record.key, structuredClone(record));
      return { result: record.key };
    },
    get(key) {
      return { result: structuredClone(idbRecords.get(key)) };
    },
  };
  const request = operation(store);
  return request?.result;
}

const auditEntries = [];
const statusEntries = [];
const detailEntries = [];
const notificationEntries = [];

const context = {
  console,
  localStorage,
  runIndexedDbTransaction,
  structuredClone,
  Date,
  addAuditLog(...args) {
    auditEntries.push(args);
  },
  setSupabaseStatus(...args) {
    statusEntries.push(args);
  },
  setSupabaseDetails(...args) {
    detailEntries.push(args);
  },
  notifyUser(...args) {
    notificationEntries.push(args);
  },
};
vm.createContext(context);
vm.runInContext(helperSource, context);

const payload = {
  state: {
    cases: [{ id: "case-large", notes: "x".repeat(10000) }],
  },
  photos: [],
};

const saved = await vm.runInContext(
  `saveRestoreSafetySnapshot(${JSON.stringify(payload)}, { reason: "test" })`,
  context,
);
assert.equal(saved.saved, true);
assert.equal(saved.storage, "indexeddb");

const pointer = JSON.parse(
  localStorage.getItem("nimr-sav-restore-safety-snapshot:last"),
);
assert.equal(pointer.storage, "indexeddb");
assert.ok(
  localStorage.getItem("nimr-sav-restore-safety-snapshot:last").length < 1000,
);

const loaded = await vm.runInContext(
  "loadRestoreSafetySnapshot()",
  context,
);
assert.equal(loaded.state.cases[0].id, "case-large");
assert.equal(loaded.state.cases[0].notes.length, 10000);

context.runIndexedDbTransaction = async () => {
  throw new Error("IndexedDB unavailable");
};
const unsaved = await vm.runInContext(
  `saveRestoreSafetySnapshot(${JSON.stringify(payload)}, { reason: "fallback" })`,
  context,
);
assert.equal(unsaved.saved, false);
assert.equal(unsaved.quotaExceeded, true);

auditEntries.length = 0;
const failedGate = await vm.runInContext(
  `createRequiredRestoreSafetySnapshot(${
    JSON.stringify(payload)
  }, { type: "restore_global" })`,
  context,
);
assert.equal(failedGate.allowed, false);
assert.equal(
  auditEntries.some(
    ([eventName]) =>
      eventName === "conflict.safety_snapshot.created",
  ),
  false,
  "aucune fausse trace created ne doit être produite",
);

let guardedState = { marker: "local" };
const remoteState = { marker: "remote" };
if (failedGate.allowed) guardedState = remoteState;
assert.deepEqual(
  guardedState,
  { marker: "local" },
  "l'état local doit rester intact quand le snapshot échoue",
);

context.runIndexedDbTransaction = runIndexedDbTransaction;
auditEntries.length = 0;
const successfulGate = await vm.runInContext(
  `createRequiredRestoreSafetySnapshot(${
    JSON.stringify(payload)
  }, { type: "restore_global" })`,
  context,
);
assert.equal(successfulGate.allowed, true);
assert.equal(
  auditEntries.filter(
    ([eventName]) =>
      eventName === "conflict.safety_snapshot.created",
  ).length,
  1,
  "la trace created doit être ajoutée une seule fois après succès",
);
const createdAuditEntry = auditEntries.find(
  ([eventName]) =>
    eventName === "conflict.safety_snapshot.created",
);
assert.equal(
  typeof createdAuditEntry?.[1],
  "string",
  "le libellé d'audit ne doit jamais être un objet",
);
assert.match(
  createdAuditEntry[1],
  /Copie de sécurité/i,
);
assert.equal(
  typeof createdAuditEntry?.[2],
  "string",
);
assert.match(
  createdAuditEntry[2],
  /storage=indexeddb/i,
);

console.log(
  "RESTORE SAFETY SNAPSHOT INDEXEDDB V23.3.0 OK",
);
