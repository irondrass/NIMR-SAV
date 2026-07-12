import assert from "node:assert/strict";
import { createNimrVmContext } from "./helpers/nimr_vm_context.mjs";

const { context, run } = createNimrVmContext({ filename: "sav-dashboard-pdf-first.js" });
run(`state = normalizeState({
  users: [
    { id: "director-dashboard", name: "Directeur", role: "directeur", active: true },
    { id: "reader-dashboard", name: "Lecture", role: "lecture_seule", active: true },
    { id: "front-dashboard", name: "Réception", role: "reception", active: true }
  ],
  currentUserId: "director-dashboard",
  ui: { savDashboardPeriod: "today", savDashboardTypeFilter: "all", savDashboardStatusFilter: "all" },
  cases: [
    { id: "case-active", clientName: "Secret Alpha", plate: "123 TU 456", createdAt: "2026-06-06T08:00:00.000Z", updatedAt: "2026-06-06T09:00:00.000Z", flags: { received: true, workStarted: true }, durations: { body: 1 }, claims: [{ type: "client", includeInPlanning: true, estimate: { lines: [{ phase: "body", laborHours: 1 }] } }] },
    { id: "case-blocked", clientName: "Secret Beta", plate: "987 TU 654", createdAt: "2026-06-06T08:30:00.000Z", updatedAt: "2026-06-06T09:00:00.000Z", partsStatus: "waiting_parts", blockerReason: "waiting_parts", durations: { mechanical: 1 }, claims: [{ type: "client", includeInPlanning: true, estimate: { lines: [{ phase: "mechanical", laborHours: 1 }] } }] },
    { id: "case-completed", clientName: "Secret Gamma", createdAt: "2026-06-06T07:00:00.000Z", updatedAt: "2026-06-06T09:30:00.000Z", flags: { received: true, workStarted: true, workCompleted: true }, durations: { paint: 1 }, claims: [{ type: "client", includeInPlanning: true, estimate: { lines: [{ phase: "paint", laborHours: 1 }] } }] },
    { id: "case-closed", clientName: "Secret Closed", createdAt: "2026-06-06T06:00:00.000Z", closedAt: "2026-06-06T09:45:00.000Z", flags: { received: true, workStarted: true, workCompleted: true, invoiced: true } }
  ],
  bookings: []
})`);
const dashboard = context.buildSavPerformanceDashboard(new Date("2026-06-06T10:00:00.000Z"));
assert.equal(dashboard.metrics.activeCases, 3);
assert.equal(dashboard.metrics.blockedCases, 1);
assert.equal(dashboard.metrics.completedWorkCases, 1);
assert.equal("pendingQualityControls" in dashboard.metrics, false);
assert.equal("deliverableToday" in dashboard.metrics, false);
assert.equal("pendingAgreements" in dashboard.metrics, false);

const labels = Array.from(context.buildSavKpis(new Date("2026-06-06T10:00:00.000Z")), (item) => item.label);
assert.ok(labels.includes("Travaux terminés"));
assert.ok(labels.includes("Actions à traiter"));
assert.equal(labels.some((label) => /qualité|accord|livraison/i.test(label)), false);

const alerts = context.buildPilotageAlerts(new Date("2026-06-06T10:00:00.000Z"), { limit: 20 });
assert.ok(alerts.some((alert) => alert.title === "Dossier bloqué"));
const rendered = JSON.stringify(alerts);
["Secret Alpha", "Secret Beta", "123 TU 456", "987 TU 654"].forEach((secret) => assert.equal(rendered.includes(secret), false));

run('state.currentUserId = "reader-dashboard"');
assert.equal(context.hasPermission("dashboard.view"), true);
run('state.currentUserId = "front-dashboard"');
assert.equal(context.hasPermission("dashboard.view"), false);
console.log("SAV PERFORMANCE DASHBOARD PDF-FIRST OK");
