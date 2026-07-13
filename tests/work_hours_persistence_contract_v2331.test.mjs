import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const testDirectory = path.dirname(
  fileURLToPath(import.meta.url),
);
const repositoryRoot = path.resolve(
  testDirectory,
  "..",
);
const require = createRequire(import.meta.url);

const runtimePath = path.join(
  repositoryRoot,
  "js",
  "work-hours-sync.js",
);
const appPath = path.join(repositoryRoot, "app.js");
const syncPath = path.join(
  repositoryRoot,
  "js",
  "supabase-sync.js",
);
const indexPath = path.join(
  repositoryRoot,
  "index.html",
);
const serviceWorkerPath = path.join(
  repositoryRoot,
  "sw.js",
);
const vehiclesPath = path.join(
  repositoryRoot,
  "data",
  "vehicles.json",
);

for (const file of [
  runtimePath,
  appPath,
  syncPath,
  indexPath,
  serviceWorkerPath,
  vehiclesPath,
]) {
  assert.equal(
    fs.existsSync(file),
    true,
    `Fichier requis introuvable : ${file}`,
  );
}

const runtimeSource = fs.readFileSync(runtimePath, "utf8");
const appSource = fs.readFileSync(appPath, "utf8");
const syncSource = fs.readFileSync(syncPath, "utf8");
const indexSource = fs.readFileSync(indexPath, "utf8");
const serviceWorkerSource = fs.readFileSync(
  serviceWorkerPath,
  "utf8",
);

assert.match(
  appSource,
  /const previousWorkHours = cloneWorkHours\(state\.workHours \|\| DEFAULT_WORK_HOURS\);[\s\S]*?markWorkHoursLocallyModified\(state\.workHours,\s*\{[\s\S]*?previousWorkHours,[\s\S]*?changedAt:[\s\S]*?\}\);[\s\S]*?saveState\(\{ cloudReason: "work-hours" \}\);/u,
  "La modification UI doit marquer le calendrier local avant la sauvegarde.",
);
assert.match(
  appSource,
  /hasPendingWorkHoursChange\(state\.workHours\)[\s\S]*?scheduleAutoSupabaseBackup\("work-hours-online-recovery"\)/u,
  "La reconnexion doit relancer l'envoi d'un calendrier local en attente.",
);

assert.match(
  syncSource,
  /workHoursSync:\s*\{[\s\S]*?fingerprint:\s*workHoursFingerprint/u,
  "app_settings doit transporter l'empreinte du calendrier.",
);
assert.match(
  syncSource,
  /resolveWorkHoursRemoteMerge\([\s\S]*?normalizedLocal\.workHours,[\s\S]*?normalizedRemote\.workHours/u,
  "La fusion cloud doit passer par la protection dédiée aux horaires.",
);
assert.match(
  syncSource,
  /workHours:\s*workHoursMerge\.workHours/u,
  "La fusion doit utiliser la décision dédiée aux horaires.",
);
assert.match(
  syncSource,
  /cloudBackupFingerprint:\s*sentWorkHoursFingerprint,[\s\S]*?appSettingsFingerprint:\s*stats\.workHoursFingerprint/u,
  "L'acquittement doit exiger cloud_backups et app_settings.",
);
assert.match(
  syncSource,
  /hasPendingWorkHoursChange\(state\.workHours\)[\s\S]*?scheduleAutoSupabaseBackup\("work-hours-pending-recovery"\)/u,
  "Le démarrage du live sync doit récupérer un calendrier en attente.",
);
assert.doesNotMatch(
  runtimeSource,
  /\.from\s*\(|\.rpc\s*\(|fetch\s*\(/u,
  "Le module de protection ne doit effectuer aucun transport réseau.",
);

const storageIndex = indexSource.indexOf(
  'src="js/storage.js?v=23.3.1"',
);
const runtimeIndex = indexSource.indexOf(
  'src="js/work-hours-sync.js?v=23.3.1"',
);
const supabaseIndex = indexSource.indexOf(
  'src="js/supabase-sync.js?v=23.3.1"',
);
assert.ok(storageIndex >= 0);
assert.ok(runtimeIndex > storageIndex);
assert.ok(supabaseIndex > runtimeIndex);
assert.equal(
  serviceWorkerSource.includes(
    './js/work-hours-sync.js?v=23.3.1',
  ),
  true,
  "Le service worker doit précacher le module.",
);
assert.deepEqual(
  JSON.parse(fs.readFileSync(vehiclesPath, "utf8")),
  [],
  "data/vehicles.json doit rester exactement [].",
);

const storage = new Map();
globalThis.localStorage = {
  getItem(key) {
    return storage.has(key)
      ? storage.get(key)
      : null;
  },
  setItem(key, value) {
    storage.set(key, String(value));
  },
  removeItem(key) {
    storage.delete(key);
  },
};

const api = require(runtimePath);

const baseline = {
  0: [],
  1: [
    ["08:00", "12:00"],
    ["13:00", "17:00"],
  ],
  2: [
    ["08:00", "12:00"],
    ["13:00", "17:00"],
  ],
  3: [
    ["08:00", "12:00"],
    ["13:00", "17:00"],
  ],
  4: [
    ["08:00", "12:00"],
    ["13:00", "17:00"],
  ],
  5: [
    ["08:00", "12:00"],
    ["13:00", "17:00"],
  ],
  6: [["08:00", "13:00"]],
};
const localEdit = {
  ...baseline,
  1: [["08:00", "12:00"]],
};
const changedAt = "2026-07-13T00:00:00.000Z";

const marked = api.markWorkHoursLocallyModified(
  localEdit,
  {
    previousWorkHours: baseline,
    changedAt,
  },
);
assert.equal(marked.pending, true);
assert.equal(
  marked.baseFingerprint,
  api.getWorkHoursFingerprint(baseline),
);
assert.equal(
  marked.localFingerprint,
  api.getWorkHoursFingerprint(localEdit),
);
assert.equal(
  api.hasPendingWorkHoursChange(localEdit),
  true,
);

const staleRemote =
  api.resolveWorkHoursRemoteMerge(
    localEdit,
    baseline,
    {
      // Timestamp volontairement postérieur : une ancienne
      // sauvegarde démarrée avant la saisie peut finir après.
      remoteUpdatedAt:
        "2026-07-13T00:00:02.000Z",
    },
  );
assert.equal(
  staleRemote.decision,
  "preserve_local_remote_is_base",
);
assert.equal(staleRemote.conflict, null);
assert.deepEqual(staleRemote.workHours, localEdit);
assert.equal(
  api.hasPendingWorkHoursChange(localEdit),
  true,
);

const currentFingerprint =
  api.getWorkHoursFingerprint(localEdit);

const incompleteAck =
  api.acknowledgeWorkHoursSync(
    localEdit,
    {
      cloudBackupFingerprint:
        currentFingerprint,
      appSettingsFingerprint: "",
      updatedAt:
        "2026-07-13T00:00:03.000Z",
    },
  );
assert.equal(incompleteAck.acknowledged, false);
assert.equal(
  api.hasPendingWorkHoursChange(localEdit),
  true,
);

const completeAck =
  api.acknowledgeWorkHoursSync(
    localEdit,
    {
      cloudBackupFingerprint:
        currentFingerprint,
      appSettingsFingerprint:
        currentFingerprint,
      updatedAt:
        "2026-07-13T00:00:04.000Z",
    },
  );
assert.equal(completeAck.acknowledged, true);
assert.equal(
  api.hasPendingWorkHoursChange(localEdit),
  false,
);

const remoteClean = {
  ...localEdit,
  6: [["08:00", "12:30"]],
};
const accepted =
  api.resolveWorkHoursRemoteMerge(
    localEdit,
    remoteClean,
    {
      remoteUpdatedAt:
        "2026-07-13T00:01:00.000Z",
    },
  );
assert.equal(
  accepted.decision,
  "accept_remote_clean_local",
);
assert.deepEqual(accepted.workHours, remoteClean);

const localSecondEdit = {
  ...remoteClean,
  2: [
    ["09:00", "12:00"],
    ["13:00", "17:00"],
  ],
};
api.markWorkHoursLocallyModified(
  localSecondEdit,
  {
    previousWorkHours: remoteClean,
    changedAt:
      "2026-07-13T00:02:00.000Z",
  },
);
const divergentRemote = {
  ...remoteClean,
  3: [
    ["07:30", "12:00"],
    ["13:00", "17:00"],
  ],
};
const conflict =
  api.resolveWorkHoursRemoteMerge(
    localSecondEdit,
    divergentRemote,
    {
      remoteUpdatedAt:
        "2026-07-13T00:03:00.000Z",
    },
  );
assert.equal(
  conflict.decision,
  "preserve_local_conflict",
);
assert.ok(conflict.conflict);
assert.equal(conflict.conflict.status, "open");
assert.equal(
  conflict.conflict.type,
  "work_hours_conflict",
);
assert.deepEqual(
  conflict.workHours,
  localSecondEdit,
);

console.log(
  "WORK HOURS PERSISTENCE CONTRACT V23.3.1 OK",
);
