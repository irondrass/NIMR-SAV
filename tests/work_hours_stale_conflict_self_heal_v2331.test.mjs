import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const modulePath = require.resolve("../js/work-hours-sync.js");
const storageKey = "nimr-carrosserie-v1:work-hours-sync:v1";

class MemoryStorage {
  constructor() {
    this.rows = new Map();
  }

  getItem(key) {
    return this.rows.has(key) ? this.rows.get(key) : null;
  }

  setItem(key, value) {
    this.rows.set(String(key), String(value));
  }

  removeItem(key) {
    this.rows.delete(String(key));
  }

  clear() {
    this.rows.clear();
  }
}

globalThis.localStorage = new MemoryStorage();

function loadApi(meta = null) {
  globalThis.localStorage.clear();

  if (meta) {
    globalThis.localStorage.setItem(
      storageKey,
      JSON.stringify(meta),
    );
  }

  delete require.cache[modulePath];
  return require(modulePath);
}

const base = {
  1: [
    ["08:00", "12:00"],
    ["13:00", "17:00"],
  ],
};

const local = {
  1: [
    ["07:56", "11:54"],
    ["13:12", "16:44"],
  ],
};

const remote = {
  1: [["08:00", "15:00"]],
};

function makeMeta(api, overrides = {}) {
  const baseFingerprint =
    api.getWorkHoursFingerprint(base);
  const localFingerprint =
    api.getWorkHoursFingerprint(local);

  return {
    version: 1,
    pending: true,
    status: "pending_local",
    localFingerprint,
    baseFingerprint,
    acknowledgedFingerprint: baseFingerprint,
    localChangedAt: "2026-07-13T18:14:42.703Z",
    acknowledgedAt: "2026-07-13T17:40:56.338Z",
    lastRemoteFingerprint:
      api.getWorkHoursFingerprint(remote),
    lastRemoteUpdatedAt: "2026-07-13T17:41:00.449Z",
    lastDecision: "local_edit",
    conflictKey: "work-hours:obsolete-local:obsolete-remote",
    updatedAt: "2026-07-13T18:14:42.703Z",
    ...overrides,
  };
}

// 1. Une clé héritée avec status=pending_local n'est pas un conflit actif.
// La lecture des métadonnées doit l'auto-nettoyer.
{
  let api = loadApi();
  const staleMeta = makeMeta(api);
  api = loadApi(staleMeta);

  const healed = api.getWorkHoursSyncMeta();

  assert.equal(healed.pending, true);
  assert.equal(healed.status, "pending_local");
  assert.equal(healed.lastDecision, "local_edit");
  assert.equal(healed.conflictKey, "");
  assert.equal(
    api.hasBlockingWorkHoursConflict(local),
    false,
  );
}

// 2. Une nouvelle édition locale invalide toujours un ancien conflit.
{
  let api = loadApi();
  const activeConflictMeta = makeMeta(api, {
    status: "conflict",
    lastDecision: "preserve_local_conflict",
  });
  api = loadApi(activeConflictMeta);

  const nextLocal = {
    1: [
      ["07:57", "11:53"],
      ["13:13", "16:43"],
    ],
  };

  const updated = api.markWorkHoursLocallyModified(
    nextLocal,
    {
      previousWorkHours: local,
      changedAt: "2026-07-13T18:30:00.000Z",
    },
  );

  assert.equal(updated.pending, true);
  assert.equal(updated.status, "pending_local");
  assert.equal(updated.lastDecision, "local_edit");
  assert.equal(updated.conflictKey, "");
  assert.equal(
    api.hasBlockingWorkHoursConflict(nextLocal),
    false,
  );
}

// 3. Un vrai conflit nouvellement détecté reste bloquant.
{
  let api = loadApi();
  const pendingMeta = makeMeta(api, {
    conflictKey: "",
  });
  api = loadApi(pendingMeta);

  const merge = api.resolveWorkHoursRemoteMerge(
    local,
    remote,
    {
      // Distant réellement plus récent que l'édition locale,
      // et différent de la base.
      remoteUpdatedAt: "2026-07-13T19:00:00.000Z",
    },
  );

  const meta = api.getWorkHoursSyncMeta();

  assert.equal(
    merge.decision,
    "preserve_local_conflict",
  );
  assert.ok(merge.conflict);
  assert.equal(meta.status, "conflict");
  assert.equal(
    meta.lastDecision,
    "preserve_local_conflict",
  );
  assert.ok(meta.conflictKey);
  assert.equal(
    api.hasBlockingWorkHoursConflict(local),
    true,
  );
}

console.log(
  "WORK HOURS STALE CONFLICT SELF HEAL V23.3.1 OK",
);
