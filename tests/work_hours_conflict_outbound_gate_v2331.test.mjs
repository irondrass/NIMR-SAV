import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(
  new URL("..", import.meta.url),
);
const runtimePath = path.join(
  root,
  "js",
  "work-hours-sync.js",
);
const supabasePath = path.join(
  root,
  "js",
  "supabase-sync.js",
);
const runtimeSource = fs.readFileSync(
  runtimePath,
  "utf8",
);
const supabaseSource = fs.readFileSync(
  supabasePath,
  "utf8",
);

const storage = new Map();
const context = {
  module: { exports: {} },
  exports: {},
  console,
  Date,
  JSON,
  Math,
  setTimeout,
  clearTimeout,
  crypto: {
    randomUUID: () =>
      "00000000-0000-4000-8000-000000000001",
  },
  localStorage: {
    getItem: (key) =>
      storage.get(String(key)) ?? null,
    setItem: (key, value) =>
      storage.set(String(key), String(value)),
    removeItem: (key) =>
      storage.delete(String(key)),
  },
};
context.globalThis = context;
context.window = context;

vm.runInNewContext(runtimeSource, context, {
  filename: runtimePath,
});

const api = context.module.exports;

assert.equal(
  typeof api.hasBlockingWorkHoursConflict,
  "function",
);

const base = {
  1: [
    ["08:00", "12:00"],
    ["13:00", "17:00"],
  ],
};
const local = {
  1: [
    ["07:30", "15:30"],
  ],
};
const remote = {
  1: [
    ["09:00", "18:00"],
  ],
};

api.markWorkHoursLocallyModified(local, {
  previousWorkHours: base,
  changedAt: "2026-07-13T06:00:00.000Z",
});

const merge = api.resolveWorkHoursRemoteMerge(
  local,
  remote,
  {
    remoteUpdatedAt:
      "2026-07-13T07:00:00.000Z",
  },
);

assert.equal(
  merge.decision,
  "preserve_local_conflict",
);
assert.equal(
  merge.conflict?.type,
  "work_hours_conflict",
);
assert.equal(
  api.hasBlockingWorkHoursConflict(local),
  true,
);
assert.equal(
  api.hasBlockingWorkHoursConflict(remote),
  false,
);

function functionBlock(
  source,
  startText,
  endText,
) {
  const start = source.indexOf(startText);
  assert.ok(start >= 0, `${startText} absent`);
  const end = source.indexOf(
    endText,
    start + startText.length,
  );
  assert.ok(end > start, `${endText} absent`);
  return source.slice(start, end);
}

const manual = functionBlock(
  supabaseSource,
  "async function saveLocalToSupabase()",
  "function getWorkHoursOutboundBlock(",
);
assert.ok(
  manual.indexOf("getWorkHoursOutboundBlock()")
    < manual.indexOf("showConfirmModal("),
);

const schedule = functionBlock(
  supabaseSource,
  "function scheduleAutoSupabaseBackup(",
  "async function flushSupabaseBackup(",
);
assert.ok(
  schedule.includes(
    "getWorkHoursOutboundBlock()",
  ),
);

const automatic = functionBlock(
  supabaseSource,
  "async function autoBackupToSupabase(",
  "async function fetchLatestCloudBackup(",
);

const firstGate = automatic.indexOf(
  "getWorkHoursOutboundBlock(options)",
);
const payload = automatic.indexOf(
  "buildCloudBackupPayload()",
);
const write = automatic.indexOf(
  "upsertCloudBackupRow(",
);
const finalGate = automatic.lastIndexOf(
  "getWorkHoursOutboundBlock(options)",
  write,
);

assert.ok(firstGate >= 0 && firstGate < payload);
assert.ok(finalGate > payload && finalGate < write);

assert.ok(
  supabaseSource.includes(
    'reason: "work-hours-conflict"',
  ),
);
assert.ok(
  supabaseSource.includes(
    "hasBlockingWorkHoursConflict(",
  ),
);
assert.ok(
  supabaseSource.includes(
    "work-hours-pending-recovery",
  ),
);

console.log(
  "WORK HOURS CONFLICT OUTBOUND GATE "
    + "V23.3.1 OK",
);
