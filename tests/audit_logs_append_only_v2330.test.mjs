
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const syncSource = fs.readFileSync(
  new URL("../js/supabase-sync.js", import.meta.url),
  "utf8",
);

const storage = new Map();
const localStorage = {
  getItem(key) { return storage.has(String(key)) ? storage.get(String(key)) : null; },
  setItem(key, value) { storage.set(String(key), String(value)); },
  removeItem(key) { storage.delete(String(key)); },
};

const context = {
  console,
  localStorage,
  navigator: { onLine: true },
  setTimeout,
  clearTimeout,
  Date,
  Map,
  Set,
  Promise,
  TextEncoder,
  TextDecoder,
  crypto: globalThis.crypto,
};
context.window = context;
context.globalThis = context;
context.getSupabaseWorkshopId = () => "00000000-0000-0000-0000-000000000001";
vm.createContext(context);
vm.runInContext(syncSource, context, { filename: "supabase-sync.js" });

function makeAuditClient({ initial = [], collideOnce = false } = {}) {
  const rows = new Map(initial.map((row) => [row.local_id, { ...row }]));
  const calls = { select: 0, insert: 0, upsert: 0, update: 0, delete: 0 };
  let collisionPending = collideOnce;

  return {
    rows,
    calls,
    from(table) {
      assert.equal(table, "audit_logs");
      return {
        select() {
          calls.select += 1;
          const chain = {
            eq() { return chain; },
            async in(_column, ids) {
              return {
                data: ids
                  .filter((id) => rows.has(id))
                  .map((id) => ({ local_id: id })),
                error: null,
              };
            },
          };
          return chain;
        },
        async insert(batch) {
          calls.insert += 1;
          if (collisionPending) {
            collisionPending = false;
            const first = batch[0];
            rows.set(first.local_id, { ...first });
            return {
              error: {
                code: "23505",
                message: "duplicate key value violates unique constraint",
              },
            };
          }
          for (const row of batch) {
            if (rows.has(row.local_id)) {
              return {
                error: {
                  code: "23505",
                  message: "duplicate key value violates unique constraint",
                },
              };
            }
            rows.set(row.local_id, { ...row });
          }
          return { error: null };
        },
        upsert() {
          calls.upsert += 1;
          return Promise.resolve({ error: null });
        },
        update() {
          calls.update += 1;
          return Promise.resolve({ error: null });
        },
        delete() {
          calls.delete += 1;
          return Promise.resolve({ error: null });
        },
      };
    },
  };
}

const history = [
  { local_id: "audit-1", action: "created" },
  { local_id: "audit-2", action: "validated" },
  { local_id: "audit-2", action: "duplicate-local" },
];

const client = makeAuditClient();
const first = await context.syncAuditLogsAppendOnly(client, history, {
  batchSize: 1,
});
const second = await context.syncAuditLogsAppendOnly(client, history, {
  batchSize: 1,
});

assert.equal(first.total, 2, "les local_id locaux doivent etre dedupliques");
assert.equal(first.inserted, 2);
assert.equal(second.inserted, 0, "la seconde synchronisation ne reinserre rien");
assert.equal(client.rows.size, 2);
assert.equal(client.calls.upsert, 0, "aucun upsert audit_logs");
assert.equal(client.calls.update, 0, "aucun UPDATE audit_logs");
assert.equal(client.calls.delete, 0, "aucun DELETE audit_logs");

const raceClient = makeAuditClient({ collideOnce: true });
const race = await context.syncAuditLogsAppendOnly(raceClient, [
  { local_id: "race-1", action: "one" },
  { local_id: "race-2", action: "two" },
]);
assert.equal(raceClient.rows.size, 2);
assert.equal(
  race.inserted,
  1,
  "la ligne concurrente 23505 est consideree deja synchronisee",
);

assert.doesNotMatch(
  syncSource,
  /from\(["']audit_logs["']\)\.upsert/u,
  "le frontend ne doit jamais upsert audit_logs",
);
assert.doesNotMatch(
  syncSource,
  /from\(["']audit_logs["']\)\.update/u,
  "le frontend ne doit jamais mettre a jour audit_logs",
);
assert.doesNotMatch(
  syncSource,
  /from\(["']audit_logs["']\)\.delete/u,
  "le frontend ne doit jamais supprimer audit_logs",
);

const sqlSources = [
  [
    "supabase-schema.sql",
    fs.readFileSync(new URL("../supabase-schema.sql", import.meta.url), "utf8"),
  ],
  [
    "supabase_nimr_sav_v23_2_8_full_audit.sql",
    fs.readFileSync(
      new URL("../supabase_nimr_sav_v23_2_8_full_audit.sql", import.meta.url),
      "utf8",
    ),
  ],
];

for (const [name, sqlSource] of sqlSources) {
  assert.match(
    sqlSource,
    /revoke\s+all\s+privileges\s+on\s+table\s+public\.audit_logs\s+from\s+authenticated\s*;/iu,
    `${name}: tous les anciens privileges authenticated doivent etre revoques`,
  );
  assert.match(
    sqlSource,
    /revoke\s+all\s+privileges\s+on\s+table\s+public\.audit_logs\s+from\s+anon\s*;/iu,
    `${name}: aucun privilege audit_logs ne doit rester pour anon`,
  );
  assert.match(
    sqlSource,
    /grant\s+select\s*,\s*insert\s+on\s+table\s+public\.audit_logs\s+to\s+authenticated\s*;/iu,
    `${name}: authenticated doit recevoir uniquement SELECT et INSERT`,
  );
  assert.doesNotMatch(
    sqlSource,
    /grant\s+[^;]*(?:update|delete|truncate|trigger|references)[^;]*on\s+table\s+public\.audit_logs\s+to\s+authenticated\s*;/iu,
    `${name}: aucun privilege mutable ou structurel audit_logs ne doit etre accorde`,
  );
}

console.log("AUDIT LOGS APPEND-ONLY V23.3.0 OK");
