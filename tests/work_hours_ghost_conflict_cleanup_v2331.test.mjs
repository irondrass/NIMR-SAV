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

function buildMeta({
  api,
  localWorkHours,
  baseWorkHours,
  conflictKey = "work-hours:stale-ghost",
  localChangedAt = "2026-07-13T18:14:42.703Z",
}) {
  return {
    version: 1,
    pending: true,
    status: "conflict",
    localFingerprint:
      api.getWorkHoursFingerprint(localWorkHours),
    baseFingerprint:
      api.getWorkHoursFingerprint(baseWorkHours),
    acknowledgedFingerprint:
      api.getWorkHoursFingerprint(baseWorkHours),
    localChangedAt,
    acknowledgedAt: "2026-07-13T17:40:56.338Z",
    lastRemoteFingerprint: "",
    lastRemoteUpdatedAt: "",
    lastDecision: "preserve_local_conflict",
    conflictKey,
    updatedAt: localChangedAt,
  };
}

const local = {
  1: [
    ["07:56", "11:54"],
    ["13:12", "16:44"],
  ],
};

const remote = {
  1: [["08:00", "15:00"]],
};

const base = {
  1: [["08:00", "12:00"], ["13:00", "17:00"]],
};

{
  let api = loadApi();
  const meta = buildMeta({
    api,
    localWorkHours: local,
    baseWorkHours: base,
  });

  api = loadApi(meta);

  const result = api.resolveWorkHoursRemoteMerge(
    local,
    remote,
    {
      remoteUpdatedAt: "2026-07-13T17:41:00.449Z",
    },
  );

  const nextMeta = api.getWorkHoursSyncMeta();

  assert.equal(
    result.decision,
    "preserve_local_remote_older",
  );
  assert.equal(result.conflict, null);
  assert.equal(nextMeta.pending, true);
  assert.equal(nextMeta.conflictKey, "");
  assert.equal(
    api.hasBlockingWorkHoursConflict(local),
    false,
  );
}

{
  let api = loadApi();
  const meta = buildMeta({
    api,
    localWorkHours: local,
    baseWorkHours: remote,
    localChangedAt: "2026-07-13T17:30:00.000Z",
  });

  api = loadApi(meta);

  const result = api.resolveWorkHoursRemoteMerge(
    local,
    remote,
    {
      remoteUpdatedAt: "2026-07-13T18:00:00.000Z",
    },
  );

  const nextMeta = api.getWorkHoursSyncMeta();

  assert.equal(
    result.decision,
    "preserve_local_remote_is_base",
  );
  assert.equal(result.conflict, null);
  assert.equal(nextMeta.pending, true);
  assert.equal(nextMeta.conflictKey, "");
  assert.equal(
    api.hasBlockingWorkHoursConflict(local),
    false,
  );
}

{
  let api = loadApi();
  const meta = buildMeta({
    api,
    localWorkHours: local,
    baseWorkHours: base,
  });

  api = loadApi(meta);

  const result = api.resolveWorkHoursRemoteMerge(
    local,
    local,
    {
      remoteUpdatedAt: "2026-07-13T18:20:00.000Z",
    },
  );

  const nextMeta = api.getWorkHoursSyncMeta();

  assert.equal(result.decision, "values_match");
  assert.equal(result.conflict, null);
  assert.equal(nextMeta.conflictKey, "");
  assert.equal(
    api.hasBlockingWorkHoursConflict(local),
    false,
  );
}

console.log(
  "WORK HOURS GHOST CONFLICT CLEANUP V23.3.1 OK",
);
