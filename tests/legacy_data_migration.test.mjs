import assert from "node:assert/strict";
import { createNimrVmContext } from "./helpers/nimr_vm_context.mjs";

const { context, localStorage } = createNimrVmContext({ filename: "legacy-data-migration-contract.js" });

const legacy = {
  schemaVersion: 0,
  users: [
    { userId: "legacy-admin", displayName: "Ancien admin", role: "Administrateur technique" },
    { id: "legacy-director", name: "Direction", role: "DIRECTEUR-SAV" },
    { id: "legacy-reader", name: "Qualité historique", role: "qualite" },
  ],
  resources: [
    { id: "legacy-body", name: "Tôlier historique", role: "tolier", active: true },
    { id: "legacy-external", name: "Peinture externe", role: "peintre", external: true, active: true, transferMinutes: 30 },
  ],
  cases: [{
    id: "legacy-case",
    clientName: "Client historique",
    status: "work",
    createdAt: null,
    updatedAt: null,
    plannedRepairStart: "2026-06-01T07:00:00.000Z",
    subcontracts: [{ id: "legacy-sub", providerId: "legacy-external", status: "sent" }],
  }],
  bookings: [{
    id: "legacy-booking",
    caseId: "legacy-case",
    resourceId: "legacy-body",
    key: "body",
    start: "2026-06-01T07:00:00.000Z",
    end: "2026-06-01T09:00:00.000Z",
    startedAt: "2026-06-01T07:05:00.000Z",
  }],
};
const originalJson = JSON.stringify(legacy);
const migrated = context.migrateLegacyState(legacy, { migratedAt: "2026-07-11T10:00:00.000Z" });

assert.equal(migrated.migrated, true);
assert.equal(migrated.fromVersion, 0);
assert.equal(migrated.toVersion, 2);
assert.equal(JSON.stringify(legacy), originalJson, "la migration ne doit jamais modifier la source");
assert.deepEqual(Array.from(migrated.state.users, (user) => user.canonicalRole), ["admin_technique", "directeur", "lecture_seule"]);
assert.deepEqual(Array.from(migrated.state.bookings[0].resourceIds), ["legacy-body"]);
assert.equal(migrated.state.bookings[0].actualStart, "2026-06-01T07:05:00.000Z");
assert.equal(migrated.state.resources[1].site, "external");
assert.equal(migrated.state.cases[0].status, "in_progress");
assert.equal(migrated.state.cases[0].createdAt, null, "une date dossier absente ne doit pas être inventée");
assert.equal(migrated.state.cases[0].updatedAt, null, "une date de modification absente ne doit pas être inventée");

const secondPass = context.migrateLegacyState(migrated.state, { migratedAt: "2026-07-12T10:00:00.000Z" });
assert.equal(secondPass.migrated, false, "la migration doit être idempotente");
assert.equal(JSON.stringify(secondPass.state), JSON.stringify(migrated.state), "une seconde passe ne doit rien réécrire");

const normalized = context.normalizeState(migrated.state, { skipMigration: true });
const normalizedBooking = normalized.bookings.find((booking) => booking.id === "legacy-booking");
const normalizedCase = normalized.cases.find((item) => item.id === "legacy-case");
assert.ok(normalizedBooking, "la réservation historique valide doit survivre");
assert.deepEqual(Array.from(normalizedBooking.resourceIds), ["legacy-body"]);
assert.equal(normalizedBooking.actualStart, "2026-06-01T07:05:00.000Z");
assert.equal(normalizedCase.createdAt, null);
assert.equal(normalizedCase.status, "in_progress");
assert.equal(normalizedCase.subcontracting.assignments[0].providerId, "legacy-external");

localStorage.setItem("nimr-carrosserie-v1", originalJson);
const loaded = context.loadState();
assert.equal(loaded.dataSchemaVersion, 2);
const backup = JSON.parse(localStorage.getItem("nimr-carrosserie-v1:pre-migration:last"));
assert.equal(backup.fromVersion, 0, "une copie pré-migration doit être créée");
assert.equal(backup.state.cases[0].clientName, "Client historique");
assert.equal(backup.state.dataSchemaVersion, undefined, "la copie doit conserver exactement l'ancien schéma");

console.log("LEGACY DATA MIGRATION OK");
