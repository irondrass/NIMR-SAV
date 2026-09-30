import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";

const source = fs.readFileSync("js/ui-reception.js", "utf8");
const html = fs.readFileSync("index.html", "utf8");
const css = fs.readFileSync("styles.css", "utf8");
const els = Object.fromEntries(["reception-today-counters", "reception-cases-count", "reception-case-list"]
  .map(id => [id, { innerHTML: "", textContent: "" }]));
const ctx = vm.createContext({
  console, Date, Set, Map, Math, Number, String, Boolean,
  state: { cases: [] },
  window: {},
  document: { addEventListener() {}, getElementById(id) { return els[id] || null; } },
});
ctx.isSameBusinessDay = (value, now) => Boolean(value) && new Date(value).toDateString() === now.toDateString();
ctx.isRdvCanceled = () => false;
ctx.isRdvLate = () => false;
ctx.isCaseBlocked = () => false;
ctx.isCaseQualityValidated = item => item.flags.qualityApproved === true;
ctx.getCaseOperationalPhase = item => item.flags.delivered ? { key:"delivered", label:"Livré" }
  : item.flags.workCompleted && item.flags.qualityApproved ? { key:"ready", label:"Prêt" }
  : item.flags.workCompleted ? { key:"finalizing", label:"À finaliser" }
  : { key:"in_progress", label:"En intervention" };
ctx.getWorkshopProgressEta = item => item.revisedEstimatedDelivery ? new Date(item.revisedEstimatedDelivery) : null;
ctx.getWorkshopProgressCurrentStep = () => ({label:"Diagnostic"});
ctx.getWorkshopProgressBookings = () => [];
ctx.getWorkshopProgressTaskProgress = () => ({label:"1 / 2 tâches terminées"});
ctx.escapeHtml = value => String(value ?? "").replace(/[&<>"]/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[char]));
ctx.escapeAttr = ctx.escapeHtml;
ctx.formatDateTime = value => new Date(value).toISOString();
vm.runInContext(source, ctx, { filename: "js/ui-reception.js" });
const run = expression => vm.runInContext(expression, ctx);
const NOW = "2026-09-30T09:00:00Z";
function caseWith(extra = {}) {
  return { id: "or-45", clientName: "Client Test", vehicle: "Shine", plate: "123TU456",
    phone: "12345678", createdAt: "2026-09-25T08:00:00Z",
    flags: { received: true, workCompleted: false, qualityApproved: false, delivered: false },
    clientCommitment: { promisedAt: "2026-09-30T08:00:00Z", nextContactAt: "2026-09-30T08:30:00Z", lastContactAt: "" },
    receptionWorkflow: { qualityStatus: "not_started", readyForDeliveryAt: "" },
    partsStatus: "unchecked", ...extra };
}
test("old received cases remain visible until restitution", () => {
  ctx.state.cases = [caseWith()];
  const rows = run("getReceptionTodayRows(new Date('" + NOW + "'))");
  assert.equal(rows.length, 1);
  assert.equal(rows[0]["follow-up"], true);
  assert.equal(rows[0].inform, true);
  assert.equal(rows[0].followup.promiseLate, true);
});
test("invoiced but physically uncollected vehicle stays visible", () => {
  ctx.state.cases = [caseWith({
    flags: { received:true, invoiced:true, workCompleted:true, qualityApproved:true, delivered:false },
    closedAt:"2026-09-29T17:00:00Z",
    receptionWorkflow: {qualityStatus:"validated", readyForDeliveryAt:"2026-09-29T16:00:00Z"},
  })];
  const rows = run("getReceptionTodayRows(new Date('" + NOW + "'))");
  assert.equal(rows.length, 1);
  assert.equal(rows[0]["ready-deliver"], true);
  assert.equal(rows[0]["follow-up"], true);
});
test("QC pending never appears as ready or as a sent notification", () => {
  ctx.state.cases = [caseWith({ flags: {received:true,workCompleted:true,qualityApproved:false,delivered:false} })];
  let s = run("getReceptionFollowupSnapshot(state.cases[0], new Date('" + NOW + "'))");
  assert.equal(s.readyUncollected, false);
  assert.equal(s.qcValidated, false);
  ctx.state.cases = [caseWith({
    flags: {received:true,workCompleted:true,qualityApproved:true,delivered:false},
    receptionWorkflow: { qualityStatus:"validated", readyForDeliveryAt:"2026-09-30T08:10:00Z" },
  })];
  s = run("getReceptionFollowupSnapshot(state.cases[0], new Date('" + NOW + "'))");
  assert.equal(s.readyUncollected, true);
  assert.equal(s.readyContactDue, true);
  assert.match(s.nextAction, /Informer le client/);
  const overview = run("renderReceptionFollowupOverview(state.cases[0], new Date('" + NOW + "'))");
  assert.match(overview, /Prêt, non retiré/);
  assert.match(overview, /aucun envoi n'est présumé/);
});
test("contact after ready is distinct from automated SMS", () => {
  ctx.state.cases[0].clientCommitment.lastContactAt = "2026-09-30T08:20:00Z";
  const s = run("getReceptionFollowupSnapshot(state.cases[0], new Date('" + NOW + "'))");
  assert.equal(s.readyContactConfirmed, true);
  assert.equal(s.readyContactDue, false);
  assert.match(s.nextAction, /Préparer la restitution/);
  ctx.state.cases[0].flags.delivered = true;
  assert.equal(run("getReceptionFollowupSnapshot(state.cases[0], new Date('" + NOW + "')).readyUncollected"), false);
});
test("parts blocking and late estimate come from canonical case", () => {
  ctx.state.cases = [caseWith({
    partsStatus: "waiting_parts",
    revisedEstimatedDelivery: "2026-09-30T11:00:00Z",
  })];
  const s = run("getReceptionFollowupSnapshot(state.cases[0], new Date('" + NOW + "'))");
  assert.equal(s.partsBlocked, true);
  assert.equal(s.promiseRisk, true);
  assert.equal(s.estimatedDelayMinutes, 180);
  const overview = run("renderReceptionFollowupOverview(state.cases[0], new Date('" + NOW + "'))");
  assert.match(overview, /Pièces/);
  assert.match(overview, /\+180 min/);
});
test("cards expose follow-up filters, safe names and next action", () => {
  ctx.state.cases = [caseWith({ clientName: "<script>alert(1)</script>" })];
  run("renderReceptionTodayCockpit('',new Date('" + NOW + "'))");
  assert.match(html, /data-filter="follow-up">Suivi en cours/);
  assert.match(els["reception-today-counters"].innerHTML, /Prêts non retirés/);
  assert.match(els["reception-case-list"].innerHTML, /Action suivante/);
  assert.match(els["reception-case-list"].innerHTML, /&lt;script&gt;/);
  assert.doesNotMatch(els["reception-case-list"].innerHTML, /<script>/);
  assert.match(html, /data-rdv-cockpit="true"/);
  assert.match(css, /@media \(max-width: 480px\)/);
  assert.doesNotMatch(source, /data-tech-action|GOOGLE_DRIVE_CLIENT_SECRET/);
});
