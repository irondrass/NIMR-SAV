import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createNimrVmContext } from "./helpers/nimr_vm_context.mjs";

const syncSource = fs.readFileSync(
  new URL("../js/supabase-sync.js", import.meta.url),
  "utf8",
);

const BUSINESS_ROLES = Object.freeze([
  "chef_atelier",
  "reception",
  "technicien",
  "controle_qualite",
]);

function functionBody(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);

  assert.notEqual(start, -1, `Missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `Missing source marker: ${endMarker}`);

  return source.slice(start, end);
}

// Contract 1:
// Automatic business transport must use the business transport permission,
// never the technical Supabase administration permission.
const shouldAutoBackupBody = functionBody(
  syncSource,
  "function shouldAutoBackupToSupabase()",
  "function scheduleAutoSupabaseBackup",
);

assert.match(
  shouldAutoBackupBody,
  /hasPermission\("workshop\.sync\.write"\)/u,
  "automatic business transport must require workshop.sync.write",
);

assert.doesNotMatch(
  shouldAutoBackupBody,
  /supabase\.sync\.use/u,
  "automatic business transport must not require supabase.sync.use",
);

const processOfflineQueueBody = functionBody(
  syncSource,
  "async function processOfflineQueue()",
  "function logSyncSuccess(action)",
);

assert.match(
  processOfflineQueueBody,
  /guardSensitiveAction\("workshop\.sync\.write"/u,
  "durable outbox drain must require workshop.sync.write",
);

assert.doesNotMatch(
  processOfflineQueueBody,
  /supabase\.sync\.use/u,
  "durable outbox drain must not require supabase.sync.use",
);

// Contract 2:
// Technical/manual Supabase diagnostics may remain restricted.
const connectionTestBody = functionBody(
  syncSource,
  "async function testSupabaseConnection()",
  "async function buildCloudBackupPayload()",
);

assert.match(
  connectionTestBody,
  /guardSensitiveAction\("supabase\.sync\.use"\)/u,
  "manual Supabase connection diagnostics remain technical",
);

// Contract 3:
// For every operational role, exercise the REAL role permission resolver,
// then run the REAL active durable outbox drain through a deterministic
// server acknowledgement.
for (const role of BUSINESS_ROLES) {
  const contract = createNimrVmContext({
    filename: `sync-role-transport-${role}.js`,
    console: {
      ...console,
      warn() {},
      error() {},
    },
  });

  vm.runInContext(
    syncSource,
    contract.context,
    { filename: `sync-role-transport-${role}-supabase-sync.js` },
  );

  contract.run(`
    state.users = [{
      id: "user-${role}",
      name: "Test ${role}",
      role: "${role}",
      canonicalRole: "${role}",
      active: true,
      resourceId: ${role === "technicien" ? '"tech-resource-1"' : '""'}
    }];
    state.currentUserId = "user-${role}";
  `);

  assert.equal(
    contract.run(`hasPermission("workshop.sync.write")`),
    true,
    `${role} must own workshop.sync.write`,
  );

  assert.equal(
    contract.run(`hasPermission("supabase.sync.use")`),
    false,
    `${role} must not need the technical supabase.sync.use permission`,
  );

  contract.context.navigator.onLine = true;
  contract.context.getSupabaseClient = () => ({ deterministic: true });
  contract.context.getSupabaseUser = async () => ({
    id: `auth-${role}`,
    email: `${role}@example.test`,
  });

  contract.context.renderSyncStatusStrip = () => {};
  contract.context.renderSupabaseSyncHealth = () => {};

  const pendingOperation = {
    operationId: `op-${role}-001`,
    workshopId: "00000000-0000-0000-0000-000000000001",
    entityType: "case",
    entityId: `case-${role}`,
    action: "upsert",
    syncStatus: "pending",
    payload: {
      entity: {
        id: `case-${role}`,
      },
    },
  };

  contract.context.loadDurableOutboxOperations = async () => [
    structuredClone(pendingOperation),
  ];

  const serverCalls = [];

  contract.context.processGranularOutboxBatch = async (
    client,
    user,
    operations,
  ) => {
    serverCalls.push({
      client,
      user,
      operations: structuredClone(operations),
    });

    return operations.map((operation) => ({
      operationId: operation.operationId,
      acknowledged: true,
    }));
  };

  assert.equal(
    contract.context.shouldAutoBackupToSupabase(),
    true,
    `${role}: automatic transport must be eligible`,
  );

  const result = await contract.context.processOfflineQueue();

  assert.equal(
    result.acknowledged,
    true,
    `${role}: server acknowledgement must reach the active transport path`,
  );

  assert.equal(
    result.processed,
    1,
    `${role}: exactly one durable operation must be processed`,
  );

  assert.equal(
    result.failed,
    0,
    `${role}: no deterministic server acknowledgement may fail`,
  );

  assert.equal(
    serverCalls.length,
    1,
    `${role}: canonical server adapter must be invoked exactly once`,
  );

  assert.equal(
    serverCalls[0].operations.length,
    1,
    `${role}: exactly one durable envelope must reach the server adapter`,
  );

  assert.equal(
    serverCalls[0].operations[0].operationId,
    pendingOperation.operationId,
    `${role}: immutable operation identity must be preserved`,
  );
}

console.log(
  "SYNC-ROLE-TRANSPORT-001 OK - chef/reception/technicien/CQ transport + ACK",
);
