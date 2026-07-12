import assert from "node:assert/strict";
import fs from "node:fs";

const syncSource = fs.readFileSync("js/supabase-sync.js", "utf8");
const planningSource = fs.readFileSync("js/planning.js", "utf8");
const sqlPath = "supabase_nimr_sav_v23_2_8_full_audit.sql";
assert.ok(fs.existsSync(sqlPath), `${sqlPath} doit accompagner le build full-audit`);
const sqlSource = fs.readFileSync(sqlPath, "utf8");

assert.match(syncSource, /rpc\("nimr_reserve_planning_atomic"/u);
assert.match(syncSource, /p_expected_version/u);
assert.match(syncSource, /p_idempotency_key/u);
assert.doesNotMatch(syncSource, /upsertAndMap\(client, "planning_slots"/u, "aucune écriture planning REST ne doit contourner le RPC atomique");
assert.match(syncSource, /table: "planning_slots", filter: `workshop_id=eq\.\$\{workshopId\}`/u);
assert.match(syncSource, /table: "planning_resources", filter: `workshop_id=eq\.\$\{workshopId\}`/u);
assert.doesNotMatch(syncSource, /table: "(?:bookings|resources)"/u, "Realtime doit écouter les vraies tables de la migration");
assert.match(planningSource, /async function acceptProposalAtomically/u);
assert.match(sqlSource, /nimr_reserve_planning_atomic/iu);
assert.match(sqlSource, /idempotency/iu);
assert.match(sqlSource, /exclude|tstzrange|overlap/iu);

// Contrat navigateur -> RPC : les identifiants locaux sont traduits en UUID
// Supabase et les segments discontinus deviennent des créneaux distincts.
const atomicSourceStart = syncSource.indexOf("async function resolveAtomicPlanningResourceIds");
const atomicSourceEnd = syncSource.indexOf("async function renderSupabaseSyncHealth", atomicSourceStart);
assert.ok(atomicSourceStart >= 0 && atomicSourceEnd > atomicSourceStart, "les fonctions de réservation atomique doivent être testables");
const atomicFactory = new Function(
  "isSupabaseConfigured",
  "navigator",
  "getSupabaseClient",
  "getSupabaseUser",
  "getSupabaseWorkshopId",
  "makeSupabaseConflictHash",
  "caseSyncLocalId",
  `${syncSource.slice(atomicSourceStart, atomicSourceEnd)}\nreturn { reservePlanningProposalAtomically };`,
);
const workshopId = "10000000-0000-4000-8000-000000000001";
const technicianUuid = "20000000-0000-4000-8000-000000000001";
const zoneUuid = "20000000-0000-4000-8000-000000000002";
let rpcCall = null;
const mockClient = {
  from(table) {
    if (table === "planning_resources") {
      return {
        select(columns) {
          assert.equal(columns, "id,local_id");
          return {
            async eq(field, value) {
              assert.equal(field, "workshop_id");
              assert.equal(value, workshopId);
              return {
                data: [
                  { id: technicianUuid, local_id: "tolier-1" },
                  { id: zoneUuid, local_id: "zone-preparation-1" },
                ],
                error: null,
              };
            },
          };
        },
      };
    }
    assert.equal(table, "repair_orders");
    return {
      select(columns) {
        assert.equal(columns, "planning_version");
        const filters = [];
        return {
          eq(field, value) {
            filters.push([field, value]);
            return this;
          },
          async maybeSingle() {
            assert.deepEqual(filters, [
              ["workshop_id", workshopId],
              ["local_id", "case-local-1"],
            ]);
            return {
              data: { planning_version: 6 },
              error: null,
            };
          },
        };
      },
    };
  },
  async rpc(name, payload) {
    rpcCall = { name, payload };
    return { data: { ok: true, acknowledged: true, planningVersion: 7 }, error: null };
  },
};
const { reservePlanningProposalAtomically } = atomicFactory(
  () => true,
  { onLine: true },
  () => mockClient,
  async () => ({ id: "user-1" }),
  () => workshopId,
  () => "proposal-hash",
  (item) => item.id,
);
const localCase = { id: "case-local-1", localRevision: 3, syncRevision: 99, serverPlanningVersion: 6 };
await reservePlanningProposalAtomically(localCase, {
  start: "2026-07-13T08:00:00Z",
  steps: [{
    key: "body",
    taskId: "task-body",
    title: "Carrosserie",
    resourceIds: ["tolier-1", "zone-preparation-1"],
    equipmentResourceIds: ["zone-preparation-1"],
    segments: [
      { start: "2026-07-13T08:00:00Z", end: "2026-07-13T09:00:00Z" },
      { start: "2026-07-13T10:00:00Z", end: "2026-07-13T10:30:00Z" },
    ],
  }],
});
assert.equal(rpcCall?.name, "nimr_reserve_planning_atomic");
assert.equal(rpcCall.payload.p_workshop_id, workshopId);
assert.equal(rpcCall.payload.p_case_id, "case-local-1", "le SQL résout le local_id du dossier dans l'atelier");
assert.equal(rpcCall.payload.p_expected_version, 6, "la version planning serveur ne doit pas être confondue avec syncRevision");
assert.equal(rpcCall.payload.p_bookings.length, 2, "chaque segment de travail doit réserver son propre intervalle");
assert.deepEqual(rpcCall.payload.p_bookings[0].resourceIds, [technicianUuid, zoneUuid]);
assert.deepEqual(rpcCall.payload.p_bookings[0].equipmentResourceIds, [zoneUuid]);
assert.equal(rpcCall.payload.p_bookings[0].startAt, "2026-07-13T08:00:00Z");
assert.equal(rpcCall.payload.p_bookings[0].endAt, "2026-07-13T09:00:00Z");
assert.equal("resource_ids" in rpcCall.payload.p_bookings[0], false, "le payload doit respecter les clés lues par le RPC");
assert.equal(localCase.serverPlanningVersion, 7, "l'ACK planningVersion doit devenir la prochaine expectedVersion");

class AtomicWorkshopSimulation {
  constructor() {
    this.bookings = [];
    this.versions = new Map();
    this.acknowledgements = new Map();
    this.tail = Promise.resolve();
  }

  reserve(request) {
    const work = this.tail.then(async () => {
      await new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * 4)));
      if (this.acknowledgements.has(request.idempotencyKey)) return this.acknowledgements.get(request.idempotencyKey);
      const version = this.versions.get(request.caseId) || 0;
      if (version !== request.expectedVersion) return { ok: false, conflict: "version", version };
      const overlap = this.bookings.some((booking) => (
        booking.resourceIds.some((resourceId) => request.resourceIds.includes(resourceId))
        && booking.start < request.end
        && request.start < booking.end
      ));
      if (overlap) return { ok: false, conflict: "resource_overlap", version };
      const acknowledgement = { ok: true, operationId: request.operationId, version: version + 1 };
      this.bookings.push({ ...request });
      this.versions.set(request.caseId, version + 1);
      this.acknowledgements.set(request.idempotencyKey, acknowledgement);
      return acknowledgement;
    });
    this.tail = work.catch(() => null);
    return work;
  }
}

const sharedServer = new AtomicWorkshopSimulation();
const collisionRequests = Array.from({ length: 20 }, (_, index) => ({
  operationId: `collision-operation-${index + 1}`,
  idempotencyKey: `collision-key-${index + 1}`,
  caseId: `collision-case-${index + 1}`,
  expectedVersion: 0,
  resourceIds: ["tolier-1", "zone-preparation-1"],
  start: Date.parse("2026-07-13T08:00:00Z"),
  end: Date.parse("2026-07-13T10:00:00Z"),
}));
const collisionResults = await Promise.all(collisionRequests.map((request) => sharedServer.reserve(request)));
assert.equal(collisionResults.filter((result) => result.ok).length, 1, "un seul des 20 postes doit réserver le créneau commun");
assert.equal(collisionResults.filter((result) => result.conflict === "resource_overlap").length, 19);
assert.equal(sharedServer.bookings.length, 1, "aucune double réservation ne doit être créée");

const winningIndex = collisionResults.findIndex((result) => result.ok);
const repeatedAck = await sharedServer.reserve(collisionRequests[winningIndex]);
assert.deepEqual(repeatedAck, collisionResults[winningIndex], "le rejeu de la même clé doit être idempotent");
assert.equal(sharedServer.bookings.length, 1, "le rejeu idempotent ne doit pas dupliquer la réservation");

const independentServer = new AtomicWorkshopSimulation();
const independentResults = await Promise.all(Array.from({ length: 20 }, (_, index) => independentServer.reserve({
  operationId: `independent-operation-${index + 1}`,
  idempotencyKey: `independent-key-${index + 1}`,
  caseId: `independent-case-${index + 1}`,
  expectedVersion: 0,
  resourceIds: [`resource-${index + 1}`],
  start: Date.parse("2026-07-13T08:00:00Z"),
  end: Date.parse("2026-07-13T09:00:00Z"),
})));
assert.equal(independentResults.filter((result) => result.ok).length, 20, "20 sessions sans conflit doivent toutes converger");
assert.equal(independentServer.bookings.length, 20);

console.log("MULTIUSER 20 CONCURRENT USERS OK (SIMULATION LOCALE — PAS UN TEST SUPABASE RÉEL)");
