import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import { runMobileCdpTest, technicianFixtureExpression } from "./helpers/mobile_browser_harness.mjs";

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
test("generic post-QC call does not count as explicit vehicle-ready information", () => {
  const c = ctx.state.cases[0];
  c.clientCommitment.lastContactAt = "2026-09-30T08:20:00Z";
  let s = run("getReceptionFollowupSnapshot(state.cases[0], new Date('" + NOW + "'))");
  assert.equal(s.readyContactConfirmed, false);
  assert.equal(s.readyContactDue, true);
  assert.match(s.nextAction, /Informer le client/);
  c.clientCommitment.readyInformedAt = "2026-09-30T08:25:00Z";
  s = run("getReceptionFollowupSnapshot(state.cases[0], new Date('" + NOW + "'))");
  assert.equal(s.readyContactConfirmed, true);
  assert.equal(s.readyContactDue, false);
  assert.match(s.nextAction, /Préparer la restitution/);
  // Rework followed by a new QC approval requires a new explicit ready call.
  c.receptionWorkflow.readyForDeliveryAt = "2026-09-30T08:30:00Z";
  s = run("getReceptionFollowupSnapshot(state.cases[0], new Date('" + NOW + "'))");
  assert.equal(s.readyContactConfirmed, false);
  assert.equal(s.readyContactDue, true);
  c.flags.delivered = true;
  assert.equal(run("getReceptionFollowupSnapshot(state.cases[0], new Date('" + NOW + "')).readyUncollected"), false);
});
test("parts blocking and late estimate come from canonical case", () => {
  ctx.state.cases = [caseWith({
    partsStatus: "waiting_parts",
    revisedEstimatedDelivery: "2026-09-30T11:00:00Z",
  })];
  const s = run("getReceptionFollowupSnapshot(state.cases[0], new Date('" + NOW + "'))");
  assert.equal(s.partsBlocked, true);
  assert.equal(s.promiseLate, true);
  assert.equal(s.promiseRisk, false); // Canonical precedence: missed promise supersedes future risk.
  assert.equal(s.estimatedDelayMinutes, 180);
  const overview = run("renderReceptionFollowupOverview(state.cases[0], new Date('" + NOW + "'))");
  assert.match(overview, /[Pp]ièces/);
  assert.match(overview, /\+180 min/);
});
test("missing canonical readyAt never silently confirms an attempted ready-information call", () => {
  ctx.state.cases = [caseWith({
    flags: {received:true,workCompleted:true,qualityApproved:true,delivered:false},
    receptionWorkflow: {qualityStatus:"validated",readyForDeliveryAt:""},
    clientCommitment: {lastContactAt:"2026-09-30T08:20:00Z",readyInformedAt:"2026-09-30T08:25:00Z"},
  })];
  const s = run("getReceptionFollowupSnapshot(state.cases[0], new Date('" + NOW + "'))");
  assert.equal(s.readyUncollected, true);
  assert.equal(s.readyContactConfirmed, false);
  assert.match(s.nextAction, /Vérifier la trace QC/);
});

test("unknown ETA remains promise risk (canonical operational exception parity)", () => {
  ctx.state.cases = [caseWith({
    clientCommitment: { promisedAt: "2026-09-30T15:00:00Z", nextContactAt: "", lastContactAt: "" },
    revisedEstimatedDelivery: "",
  })];
  const s = run("getReceptionFollowupSnapshot(state.cases[0], new Date('" + NOW + "'))");
  assert.equal(s.eta, null);
  assert.equal(s.promiseLate, false);
  assert.equal(s.promiseRisk, true);
  assert.equal(s.inform, true);
});

test("blockerReason waiting_parts and blocked bookings remain visible with safe HTML", () => {
  ctx.state.cases = [caseWith({ partsStatus: "unchecked", blockerReason: "waiting_parts" })];
  let s = run("getReceptionFollowupSnapshot(state.cases[0], new Date('" + NOW + "'))");
  assert.equal(s.partsBlocked, true);
  assert.match(s.blockerLabel, /pièces/);
  ctx.state.cases[0].blockerReason = "";
  const bookings = [{ title: '<img src=x onerror=alert(1)>', blockedAt: NOW }];
  ctx.getWorkshopProgressBookings = () => bookings;
  ctx.isWorkshopProgressBookingBlocked = b => Boolean(b.blockedAt);
  ctx.getWorkshopProgressBookingLabel = b => b.title;
  s = run("getReceptionFollowupSnapshot(state.cases[0], new Date('" + NOW + "'))");
  assert.equal(s.blocked, true);
  assert.match(s.blockerLabel, /Opération bloquée/);
  run("renderReceptionTodayCockpit('',new Date('" + NOW + "'))");
  assert.match(els["reception-case-list"].innerHTML, /&lt;img/);
  assert.doesNotMatch(els["reception-case-list"].innerHTML, /<img/);
  delete ctx.isWorkshopProgressBookingBlocked;
  delete ctx.getWorkshopProgressBookingLabel;
  ctx.getWorkshopProgressBookings = () => [];
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

test("canonical state only records vehicle-ready customer contact after QC, never from generic calls", () => {
  const actual = vm.createContext({
    console, Date, Math, Object, Array, String, Number, Boolean, Set, Map,
    URL, URLSearchParams, structuredClone,
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    window: { addEventListener() {}, setTimeout, clearTimeout, setInterval() { return 1; }, clearInterval() {} },
    document: {
      addEventListener() {}, getElementById() { return null; }, querySelector() { return null; },
      querySelectorAll() { return []; }, createElement() {
        return { append() {}, appendChild() {}, setAttribute() {}, querySelector() { return null; },
          querySelectorAll() { return []; }, style: {}, dataset: {} };
      }, body: { append() {} },
    }, navigator: {}, setTimeout, clearTimeout,
  });
  for (const file of ["js/utils.js", "js/state.js", "js/planning.js", "js/rdv-integration.js", "js/ui-cases.js", "js/ui-reception.js"]) {
    vm.runInContext(fs.readFileSync(file, "utf8"), actual, { filename: file });
  }
  const value = code => vm.runInContext(code, actual);
  value([
    'guardAction = () => ({ok: true, message: ""});',
    'getCurrentActor = () => ({ userId: "reception-review", userName: "Réception", role: "reception" });',
    'addHistory = () => {};',
    'noteCaseRevisionCandidate = () => {};',
    'state.bookings = [];',
    'var reviewCase = normalizeCase({ id: "ready-info-test",',
    'flags: { received: true, workCompleted: false, qualityApproved: false, delivered: false },',
    'receptionWorkflow: { qualityStatus: "not_started" },',
    'clientCommitment: { lastContactAt: "" },',
    '});',
    'state.cases = [reviewCase];',
    'var deniedEarly = recordClientCommitment(reviewCase, { readyInformedAt: "2026-09-30T08:00:00Z" });'
  ].join("\n"));
  assert.equal(value("deniedEarly.ok"), false);
  assert.equal(value("reviewCase.clientCommitment.readyInformedAt"), null);
  value([
    'reviewCase.flags.workCompleted = true;',
    'reviewCase.flags.qualityApproved = true;',
    'reviewCase.receptionWorkflow.qualityStatus = "validated";',
    'reviewCase.receptionWorkflow.readyForDeliveryAt = "2026-09-30T08:10:00Z";',
    'var actualReady = isCaseReadyForDelivery(reviewCase);'
  ].join("\n"));
  assert.equal(value("actualReady"), true);
  value('reviewCase.receptionWorkflow.readyForDeliveryAt = "";');
  assert.equal(value('recordClientCommitment(reviewCase, { readyInformedAt: new Date().toISOString() }).ok'), false);
  value('reviewCase.receptionWorkflow.readyForDeliveryAt = "2026-09-30T08:10:00Z";');
  assert.equal(value('recordClientCommitment(reviewCase, { lastContactAt: new Date().toISOString(), note:"appel générique" }).ok'), true);
  assert.equal(value("reviewCase.clientCommitment.readyInformedAt"), null);
  assert.equal(value('recordClientCommitment(reviewCase, { readyInformedAt: new Date().toISOString(), note:"disponibilité communiquée" }).ok'), true);
  assert.match(value("reviewCase.clientCommitment.readyInformedAt"), /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(value("reviewCase.clientCommitment.readyInformedAt === reviewCase.clientCommitment.lastContactAt"), true);
});

test("browser: rich follow-up cards, responsive layout and explicit manual ready contact", async () => {
  const { result, errors } = await runMobileCdpTest({
    name: "kha45-followup-review", cdpPort: 9393,
    run: async ({ send, sessionId, navigate, evaluate, setViewport, click, waitFor }) => {
      await send("Network.enable", {}, sessionId);
      await send("Network.setBlockedURLs", { urls: ["https://*.supabase.co/*", "https://bo.nimr.com.tn/*"] }, sessionId);
      await navigate("?kha45-review-local");
      await evaluate(technicianFixtureExpression({ role: "reception", started: false }));
      await evaluate([
        "saveState = async () => true;",
        "notifyUser = () => {};",
        "var now = Date.now();",
        "var receivedAt = new Date(now - 4*86400000).toISOString();",
        "var readyAt = new Date(now - 5*60000).toISOString();",
        "state.cases = [normalizeCase({id:'kha45-browser-ready', clientName:'Client Review', vehicle:'Shine',",
        "  plate:'123TU456', phone:'22000000', createdAt: receivedAt,",
        "  flags:{received:true,workCompleted:true,qualityApproved:true,delivered:false},",
        "  receptionWorkflow:{qualityStatus:'validated',readyForDeliveryAt:readyAt},",
        "  clientCommitment:{promisedAt:new Date(now-10*60000).toISOString(),lastContactAt:readyAt}",
        "})];",
        "state.bookings = []; invalidateUiRuntimeIndexes(); render();",
        "document.querySelector('[data-tab=\"reception-workspace\"]').click(); render();",
      ].join("\n"));
      await waitFor("document.querySelector('#reception-case-list [data-case=\"kha45-browser-ready\"]')?.offsetWidth > 0", "ready vehicle card");
      assert.equal(await evaluate("getReceptionFollowupSnapshot(state.cases[0]).readyContactDue"), true);
      const sizes = [];
      for (const width of [1440, 1024, 768, 390]) {
        await setViewport({ width, height: 1000 });
        const view = await evaluate([
          "({",
          "overflow: document.documentElement.scrollWidth > innerWidth,",
          "card: document.querySelector('#reception-case-list [data-case=\"kha45-browser-ready\"]')?.getBoundingClientRect().width || 0,",
          "ready: document.querySelector('#reception-case-list')?.textContent.includes('Prêt à livrer'),",
          "taskActions: document.querySelectorAll('#reception-case-list [data-tech-action]').length",
          "})"
        ].join("\n"));
        assert.equal(view.overflow, false);
        assert.ok(view.card > 0);
        assert.equal(view.ready, true);
        assert.equal(view.taskActions, 0);
        sizes.push(width);
      }
      await click('#reception-case-list [data-case="kha45-browser-ready"]');
      await waitFor("document.querySelector('#operational-case-dialog')?.open", "operational dialog");
      assert.equal(await evaluate("Boolean(document.querySelector('#operational-case-dialog .reception-followup-overview'))"), true);
      assert.equal(await evaluate("document.querySelectorAll('#operational-case-dialog [data-tech-action]').length"), 0);
      assert.match(await evaluate("document.querySelector('#operational-case-dialog [data-client-followup]').textContent"),
        /Client informé maintenant : véhicule prêt/);
      await evaluate([
        "document.querySelector('#operational-case-dialog [data-client-followup] [name=\"contacted\"]').checked = true;",
        "document.querySelector('#operational-case-dialog [data-client-followup]').requestSubmit();"
      ].join("\n"));
      await waitFor("Boolean(state.cases[0].clientCommitment.readyInformedAt)", "explicit ready contact saved");
      assert.equal(await evaluate("getReceptionFollowupSnapshot(state.cases[0]).readyContactConfirmed"), true);
      return sizes;
    }
  });
  assert.deepEqual(result, [1440, 1024, 768, 390]);
  assert.deepEqual(errors, []);
});
