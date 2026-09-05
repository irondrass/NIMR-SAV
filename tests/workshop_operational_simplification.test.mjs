import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createNimrVmContext } from "./helpers/nimr_vm_context.mjs";
import { createGranularSupabaseAdapter } from "./helpers/granular_supabase_adapter.mjs";

const workshopId = "00000000-0000-0000-0000-000000000001";
const roles = ["chef_atelier", "reception", "technicien", "controle_qualite", "lecture_seule"];
for (const role of roles) {
  const { context, run } = createNimrVmContext();
  context.getSupabaseWorkshopId = () => workshopId;
  context.getSupabaseConfig = () => ({ backupTable: "cloud_backups", backupKey: "test" });
  vm.runInContext(fs.readFileSync(new URL("../js/supabase-sync.js", import.meta.url), "utf8"), context);
  const adapter = createGranularSupabaseAdapter();
  if (role === "technicien") {
    const from = adapter.client.from.bind(adapter.client);
    adapter.client.from = (table) => {
      assert.ok(!["clients", "vehicles", "repair_orders"].includes(table), "technician cannot rewrite office projections");
      return from(table);
    };
  }
  context.getSupabaseClient = () => adapter.client;
  context.getSupabaseUser = async () => ({ id: "operator" });
  context.navigator.onLine = true;
  context.renderSyncStatusStrip = () => {};
  run(`state = normalizeState({ users: [{ id: "operator", name: "Operator", role: ${JSON.stringify(role)}, active: true, resourceId: "tech" }], currentUserId: "operator", cases: [], resources: [{ id: "tech", name: "Tech", role: "mecanicien", active: true }] })`);
  assert.equal(context.hasPermission("workshop.sync.read"), true, `${role}: receives shared changes`);
  assert.equal(context.hasPermission("supabase.sync.use"), false, `${role}: no admin sync control`);
  assert.equal(context.hasPermission("supabase.configure"), false, `${role}: no configuration rights`);
  assert.equal(context.shouldAutoBackupToSupabase(), role !== "lecture_seule");
  await context.putDurableOutboxOperation({
    operationId: `operation-${role}`, idempotencyKey: `operation-${role}`,
    workshopId, userId: "operator", entityType: "case", entityId: `case-${role}`,
    action: "upsert", entityVersion: 1, baseVersion: null, syncStatus: "pending", retryCount: 0,
    payload: { entity: { id: `case-${role}`, clientName: "Test", flags: {}, localRevision: 1 } },
    updatedAt: new Date().toISOString(),
  });
  const outcome = await context.autoBackupToSupabase("role-test");
  if (["lecture_seule", "controle_qualite"].includes(role)) {
    assert.equal(outcome.acknowledged, false);
    assert.equal(adapter.entities.size, 0, "read-only and CQ cannot transmit an arbitrary queued case write");
  } else {
    assert.equal(outcome.acknowledged, true, `${role}: automatic write acknowledged`);
    assert.equal(outcome.processed, 1);
    assert.equal(adapter.canonical(workshopId, "case", `case-${role}`).payload.clientName, "Test");
  }
  run('state.users[0].active = false');
  assert.equal(context.shouldAutoBackupToSupabase(), false, "deactivated operators cannot send");
}

{
  const { context, run } = createNimrVmContext();
  vm.runInContext(fs.readFileSync(new URL("../js/supabase-sync.js", import.meta.url), "utf8"), context);
  run('state = normalizeState({ users: [{ id: "cq", role: "controle_qualite", active: true }], currentUserId: "cq" })');
  const calls = [];
  const operation = {
    workshopId, entityId: "quality-case", entityType: "case", action: "upsert", baseVersion: 12, operationId: "qc-review",
    payload: { entity: { clientName: "Must never be sent", receptionWorkflow: {
      qualityStatus: "validated", qualityReviewHistory: [{ status: "validated", reason: "Essai conforme" }],
    } } },
  };
  const client = {
    from() { throw new Error("QC must not write projections"); },
    async rpc(name, args) {
      calls.push({ name, args });
      return { data: { accepted: true, status: "applied", canonical: {
        entity_id: "quality-case", entity_version: 13, payload: { clientName: "Server authority" },
      } } };
    },
  };
  const result = await context.sendGranularOutboxOperation(client, { id: "cq" }, operation);
  assert.equal(result.acknowledged, true);
  assert.equal(result.canonical.payload.clientName, "Server authority");
  assert.equal(calls[0].name, "nimr_apply_quality_review_v2");
  assert.equal(calls[0].args.p_base_version, 12);
  assert.equal(calls[0].args.p_reason, "Essai conforme");
  assert.equal(Object.hasOwn(calls[0].args, "p_payload"), false, "no arbitrary payload reaches the QC API");
  await assert.rejects(context.sendGranularOutboxOperation(client, {}, { ...operation, action: "delete" }), /décision qualité/);
  client.rpc = async () => ({ data: { status: "conflict", conflict: true, accepted: false,
    canonical: { entity_id: "quality-case", entity_version: 14 }, conflict_canonical: { entity_id: "quality-case", entity_version: 14 } } });
  const stale = await context.sendGranularOutboxOperation(client, {}, operation);
  assert.equal(stale.conflict, true);
  assert.equal(stale.acknowledged, false);
  assert.equal(stale.localPayload.clientName, "Must never be sent", "preserve evidence for explicit conflict resolution");
}

const { context, run } = createNimrVmContext();
function reset(overrides = {}) {
  context.fixture = {
    id: "vehicle", plate: "123 TU 4567", clientName: "Client", vehicle: "NIMR",
    flags: { received: true, workStarted: true, workCompleted: true },
    claims: [{ id: "order", number: "OT-001", title: "Alternateur", type: "client", includeInPlanning: true, clientApproved: true, estimate: { lines: [{ phase: "mechanical", operation: "Remplacer alternateur", laborHours: 1 }] } }],
    ...overrides,
  };
  run(`state = normalizeState({
    users: [{ id: "chief", name: "Chef", role: "chef_atelier", active: true }, { id: "front", name: "Réception", role: "reception", active: true }, { id: "quality", name: "CQ", role: "controle_qualite", active: true }, { id: "worker", name: "Tech", role: "technicien", resourceId: "tech", active: true }],
    currentUserId: "chief", cases: [fixture], resources: [{ id: "tech", name: "Tech", role: "mecanicien", active: true }], bookings: []
  })`);
  return run("state.cases[0]");
}

let item = reset({ closedAt: "2026-09-05T08:00:00.000Z", status: "closed" });
assert.equal(context.isWorkshopProgressActiveCase(item), true, "closed is still physically present");
assert.equal(context.applyWorkflowAction(item, "archive").ok, false, "filing cannot hide an undelivered vehicle");
assert.equal(context.getCaseNextAction(item).code, "quality_check");
assert.equal(context.getCaseOperationalPhase(item).key, "finalizing");

item = reset();
assert.equal(context.applyWorkflowAction(item, "close").ok, false);
run('state.currentUserId = "worker"');
assert.equal(context.advanceReceptionWorkflow(item.id, "deliver_vehicle").ok, false, "technician cannot hand over vehicle");
run('state.currentUserId = "quality"');
assert.equal(context.advanceReceptionWorkflow(item.id, "update_quality_status", { status: "validated" }).ok, true);
assert.equal(context.getCaseOperationalPhase(item).key, "ready");
assert.equal(context.isWorkshopProgressActiveCase(item), true, "ready vehicle remains present");
assert.equal(context.advanceReceptionWorkflow(item.id, "deliver_vehicle").ok, false, "CQ rights do not imply handover rights");
run('state.currentUserId = "front"');
assert.equal(context.advanceReceptionWorkflow(item.id, "deliver_vehicle").ok, true);
assert.equal(context.isWorkshopProgressActiveCase(item), false);
assert.equal(context.getCaseOperationalPhase(item).key, "delivered");

item = reset({ flags: { received: true, workStarted: true, workCompleted: false, qualityApproved: true } });
assert.equal(context.advanceReceptionWorkflow(item.id, "deliver_vehicle").ok, false, "stale QC flag cannot bypass unfinished work");
assert.equal(context.advanceReceptionWorkflow(item.id, "update_quality_status", { status: "validated" }).ok, false);
item = reset({ receptionWorkflow: { qualityStatus: "rejected" }, flags: { received: true, workCompleted: true, qualityApproved: true } });
assert.equal(context.isCaseQualityValidated(item), false, "explicit rejection overrides stale boolean");
assert.equal(context.advanceReceptionWorkflow(item.id, "deliver_vehicle").ok, false);

item = reset({ flags: { received: true }, claims: [{ id: "order", type: "client", title: "Alternateur", status: "approved", includeInPlanning: true, estimate: { lines: [{ phase: "mechanical", operation: "Remplacer alternateur", laborHours: 1 }] } }] });
assert.equal(context.getWorkAuthorizationIssues(item).length, 1, "imported approved status is not client consent");
assert.equal(context.getCaseOperationalPhase(item).key, "preparing");
assert.equal(context.getCaseStatus(item), "planning", "received does not mean working");
assert.equal(context.getCaseNextAction(item).code, "authorize_work");
run('state.currentUserId = "worker"');
assert.equal(context.recordWorkAuthorization(item, "order", "OR signé").ok, false);
run('state.currentUserId = "front"');
assert.equal(context.recordWorkAuthorization(item, "order", "").ok, false);
assert.equal(context.recordWorkAuthorization(item, "order", "OR signé 123").ok, true);
assert.equal(context.getWorkAuthorizationIssues(item).length, 0);
assert.equal(context.normalizeRepairClaim(item.claims[0]).authorizationReference, "OR signé 123", "proof survives reload normalization");
assert.ok(item.history.some((entry) => entry.type === "claim.authorization.recorded"));
console.log("Operational simplification: role transport, physical presence, authorization and finalization passed");
