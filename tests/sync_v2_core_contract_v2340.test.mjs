import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, "..");
const sourcePath = path.join(
  repositoryRoot,
  "js",
  "sync-v2-core.js",
);

assert.equal(
  fs.existsSync(sourcePath),
  true,
  "Le noyau Sync V2 doit exister.",
);

const source = fs.readFileSync(sourcePath, "utf8");
const context = {
  console,
  JSON,
  Object,
  Array,
  Set,
  Map,
  Math,
  Number,
  String,
  Boolean,
  Date,
};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(source, context, {
  filename: "sync-v2-core.js",
});

const {
  normalizeSyncV2Operation,
  validateSyncV2Operation,
  makeSyncV2PayloadHash,
  canAutoMergeSyncV2Operations,
  mergeSyncV2Operations,
  normalizeSyncV2Acknowledgement,
} = context;

[
  normalizeSyncV2Operation,
  validateSyncV2Operation,
  makeSyncV2PayloadHash,
  canAutoMergeSyncV2Operations,
  mergeSyncV2Operations,
  normalizeSyncV2Acknowledgement,
].forEach((fn) => {
  assert.equal(typeof fn, "function");
});

const base = {
  schemaVersion: 1,
  operationId: "11111111-1111-4111-8111-111111111111",
  workshopId: "00000000-0000-0000-0000-000000000001",
  deviceId: "poste-reception-01",
  userId: "22222222-2222-4222-8222-222222222222",
  entityType: "repair_order",
  entityId: "case-2906",
  domain: "header",
  action: "patch",
  expectedVersion: 12,
  payload: {
    changes: {
      phone: "99706508",
    },
  },
  createdAt: "2026-07-12T20:00:00.000Z",
};

const validation = validateSyncV2Operation(base);
assert.equal(validation.ok, true);
assert.equal(
  validation.operation.idempotencyKey,
  [
    "nimr-sync-v2",
    base.workshopId,
    "header",
    "repair_order",
    "case-2906",
    "patch",
    base.operationId,
  ].join("|"),
);

assert.equal(
  makeSyncV2PayloadHash({
    changes: { phone: "99706508", clientName: "ALABIDI FARID" },
  }),
  makeSyncV2PayloadHash({
    changes: { clientName: "ALABIDI FARID", phone: "99706508" },
  }),
  "Le hash doit être indépendant de l'ordre des clés JSON.",
);

const snapshotValidation = validateSyncV2Operation({
  ...base,
  entityType: "workshop_state",
  action: "upsert_snapshot",
  payload: { state: { cases: [] } },
});
assert.equal(snapshotValidation.ok, false);
assert.equal(
  snapshotValidation.errors.includes("global_snapshot_forbidden"),
  true,
  "Sync V2 doit interdire les snapshots globaux.",
);

const missingVersion = validateSyncV2Operation({
  ...base,
  expectedVersion: null,
});
assert.equal(missingVersion.ok, false);
assert.equal(
  missingVersion.errors.includes("expected_version_required"),
  true,
);

const noteAppend = validateSyncV2Operation({
  ...base,
  operationId: "33333333-3333-4333-8333-333333333333",
  domain: "note",
  action: "append",
  expectedVersion: null,
  payload: {
    text: "Véhicule réceptionné avec accord client.",
  },
});
assert.equal(noteAppend.ok, true);

const disjointPhone = base;
const disjointClient = {
  ...base,
  operationId: "44444444-4444-4444-8444-444444444444",
  payload: {
    changes: {
      clientName: "ALABIDI FARID",
    },
  },
};

assert.equal(
  canAutoMergeSyncV2Operations(disjointPhone, disjointClient),
  true,
  "Deux champs différents du même domaine doivent fusionner.",
);

const merged = mergeSyncV2Operations(
  disjointPhone,
  disjointClient,
);
assert.equal(merged.ok, true);
assert.equal(merged.strategy, "disjoint_patch");
assert.deepEqual(
  JSON.parse(JSON.stringify(merged.operation.payload.changes)),
  {
    clientName: "ALABIDI FARID",
    phone: "99706508",
  },
);

const conflictingPhone = {
  ...base,
  operationId: "55555555-5555-4555-8555-555555555555",
  payload: {
    changes: {
      phone: "22000000",
    },
  },
};

assert.equal(
  canAutoMergeSyncV2Operations(base, conflictingPhone),
  false,
);
assert.deepEqual(
  JSON.parse(JSON.stringify(
    mergeSyncV2Operations(base, conflictingPhone),
  )),
  {
    ok: false,
    conflict: true,
    code: "manual_conflict_required",
  },
);

const differentDomain = {
  ...base,
  operationId: "66666666-6666-4666-8666-666666666666",
  domain: "status",
  payload: {
    changes: {
      status: "planning",
    },
  },
};

assert.equal(
  canAutoMergeSyncV2Operations(base, differentDomain),
  false,
  "Les domaines différents sont exécutés séparément, pas fusionnés en une opération.",
);

const ack = normalizeSyncV2Acknowledgement({
  status: "applied",
  operationId: base.operationId,
  idempotencyKey: validation.operation.idempotencyKey,
  entityType: "repair_order",
  entityId: "case-2906",
  domain: "header",
  serverVersion: 13,
  acknowledgedAt: "2026-07-12T20:01:00.000Z",
});
assert.equal(ack.acknowledged, true);
assert.equal(ack.serverVersion, 13);
assert.equal(ack.status, "applied");

console.log("SYNC V2 CORE CONTRACT V23.4.0 OK");
