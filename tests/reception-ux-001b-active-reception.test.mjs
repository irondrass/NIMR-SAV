import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import { runMobileCdpTest, technicianFixtureExpression } from "./helpers/mobile_browser_harness.mjs";

const source = {
  state: fs.readFileSync("js/state.js", "utf8"),
  cases: fs.readFileSync("js/ui-cases.js", "utf8"),
  reception: fs.readFileSync("js/ui-reception.js", "utf8"),
  photos: fs.readFileSync("js/photos.js", "utf8"),
};

const context = vm.createContext({
  console,
  Date,
  Math,
  Object,
  Array,
  String,
  Number,
  Boolean,
  Set,
  Map,
  URL,
  URLSearchParams,
  structuredClone,
  localStorage: { getItem(){ return null; }, setItem(){}, removeItem(){} },
  sessionStorage: { getItem(){ return null; }, setItem(){}, removeItem(){} },
  window: { addEventListener(){}, setTimeout, clearTimeout, setInterval(){ return 1; }, clearInterval(){} },
  document: {
    addEventListener(){},
    getElementById(){ return null; },
    querySelector(){ return null; },
    querySelectorAll(){ return []; },
    createElement(){ return { append(){}, appendChild(){}, setAttribute(){}, querySelector(){ return null; }, querySelectorAll(){ return []; }, style:{}, dataset:{} }; },
    body: { append(){} },
  },
  navigator: {},
  setTimeout,
  clearTimeout,
});

for (const file of ["js/utils.js", "js/state.js", "js/planning.js", "js/rdv-integration.js", "js/ui-cases.js", "js/ui-reception.js"]) {
  vm.runInContext(fs.readFileSync(file, "utf8"), context, { filename: file });
}
const run = code => vm.runInContext(code, context);

run(`
  guardAction = () => ({ ok:true, message:"" });
  canRenderAction = () => true;
  getCurrentActor = () => ({ userId:"reception-1", userName:"Réception", role:"reception" });
  getCurrentUser = () => ({ id:"reception-1", role:"reception" });
  addAuditLog = () => {};
  addHistory = () => {};
  recordFlagHistory = () => {};
  noteCaseRevisionCandidate = () => {};
  state.cases = [];
  state.bookings = [];
`);

test("receptionWorkflow normalizes the active reception fields without inventing a parallel case identity", () => {
  const normalized = run(`normalizeReceptionWorkflow({
    vehicleFuelLevel:"half",
    vehicleInteriorNote:"Siège arrière taché",
    vehiclePersonalItems:"Sac noir",
    warrantyCampaignStatus:"check",
    warrantyCampaignReference:"DFM-CAMP-01"
  })`);
  assert.equal(normalized.vehicleFuelLevel, "half");
  assert.equal(normalized.vehicleInteriorNote, "Siège arrière taché");
  assert.equal(normalized.vehiclePersonalItems, "Sac noir");
  assert.equal(normalized.warrantyCampaignStatus, "check");
  assert.equal(normalized.warrantyCampaignReference, "DFM-CAMP-01");
  assert.equal(Object.hasOwn(normalized, "clientId"), false);
  assert.equal(Object.hasOwn(normalized, "vehicleId"), false);
});

test("active reception form exposes the KHA-44 fields with one primary validation action", () => {
  const html = run(`renderReceptionActiveForm(normalizeCase({
    id:"case-1", clientName:"Client", vehicle:"Shine", plate:"123TU456", vin:"VIN12345678901234",
    claims:[{id:"claim-1",number:"OT-001",title:"Vidange",type:"client",includeInPlanning:true,clientApproved:false}]
  }))`);
  for (const name of [
    "mileage","fuelLevel","complaintsText","requestedWorksText","damageNotes","interiorNote",
    "personalItems","accessories","documents","conditionNote","warrantyCampaignStatus",
    "warrantyCampaignReference","promisedAt"
  ]) assert.match(html, new RegExp(`name=["']${name}["']`), `missing ${name}`);
  assert.match(html, /data-reception-active-form/);
  assert.match(html, /Valider la réception active/);
  assert.equal((html.match(/class="[^"]*primary-button[^"]*"/g) || []).length, 1);
  assert.doesNotMatch(html, /START|PAUSE|COMPLETE|data-tech-action/i);
});

test("receive_vehicle persists active reception facts, canonical complaints/requests and promise without auto-approving work", () => {
  run(`
    var active = normalizeCase({
      id:"case-active", clientName:"Client", vehicle:"Shine", plate:"123TU456",
      claims:[{id:"claim-active",number:"OT-001",title:"Diagnostic",type:"diagnostic",includeInPlanning:true,clientApproved:false,authorizationReference:""}],
      customerClaims:[]
    });
    state.cases=[active];
    var activeResult = advanceReceptionWorkflow("case-active","receive_vehicle",{
      mileage:"45000", fuelLevel:"half", complaintsText:"Bruit train avant", requestedWorksText:"Contrôler freinage",
      damageNotes:"Rayure aile AVG", interiorNote:"Tapis taché", personalItems:"Lunettes",
      accessories:"Carte grise", documents:"Carnet entretien", conditionNote:"Véhicule poussiéreux",
      warrantyCampaignStatus:"check", warrantyCampaignReference:"DFM-2026-01",
      promisedAt:"2026-09-30T15:00:00.000Z", promiseNote:"Restitution annoncée sous réserve diagnostic"
    });
  `);
  assert.equal(run("activeResult.ok"), true);
  assert.equal(run("active.flags.received"), true);
  assert.equal(run("active.receptionWorkflow.vehicleFuelLevel"), "half");
  assert.equal(run("active.receptionWorkflow.vehicleInteriorNote"), "Tapis taché");
  assert.equal(run("active.receptionWorkflow.vehiclePersonalItems"), "Lunettes");
  assert.equal(run("active.receptionWorkflow.warrantyCampaignStatus"), "check");
  assert.equal(run("active.receptionWorkflow.warrantyCampaignReference"), "DFM-2026-01");
  assert.equal(run("active.damageNotes"), "Rayure aile AVG");
  assert.equal(run("active.mileage"), "45000");
  assert.equal(run("active.customerClaims.filter(c=>c.type==='claim'&&c.text==='Bruit train avant').length"), 1);
  assert.equal(run("active.customerClaims.filter(c=>c.type==='request'&&c.text==='Contrôler freinage').length"), 1);
  assert.equal(run("active.clientCommitment.promisedAt"), "2026-09-30T15:00:00.000Z");
  assert.equal(run("active.claims[0].clientApproved"), false);
  assert.equal(run("active.claims[0].authorizationReference"), "");
});

test("send_to_workshop is fail-closed until canonical work authorization evidence exists", () => {
  run(`var blockedSend = advanceReceptionWorkflow("case-active","send_to_workshop",{});`);
  assert.equal(run("blockedSend.ok"), false);
  assert.equal(run("blockedSend.message"), "Accord client / interne à confirmer : OT-001 - Diagnostic.");
  assert.equal(run(`recordWorkAuthorization(active,"claim-active","Bon signé client").ok`), true);
  assert.equal(run(`advanceReceptionWorkflow("case-active","send_to_workshop",{}).ok`), true);
});

test("vehicle history is derived read-only from existing cases and never creates a vehicle database", () => {
  run(`
    state.cases=[
      active,
      normalizeCase({id:"old-1",vin:active.vin,plate:active.plate,createdAt:"2026-08-01T08:00:00Z",orNavNumber:"OR-OLD"}),
      normalizeCase({id:"other",vin:"OTHER1234567890123",plate:"999TU999",createdAt:"2026-08-02T08:00:00Z"})
    ];
    var historyBefore=state.cases.length;
    var vehicleHistory=getReceptionVehicleHistory(active,3);
  `);
  assert.equal(run("vehicleHistory.length"), 1);
  assert.equal(run("vehicleHistory[0].id"), "old-1");
  assert.equal(run("state.cases.length"), run("historyBefore"));
});

test("KHA-44 adds no parallel media backend and keeps Drive credentials out of browser code", () => {
  const combined = source.state + source.cases + source.reception + source.photos;
  assert.doesNotMatch(combined, /GOOGLE_DRIVE_(?:CLIENT|SECRET|TOKEN)|DRIVE_CLIENT_SECRET|drive\.googleapis\.com/i);
  assert.doesNotMatch(source.reception, /createBucket|storage\.from|saveVideoRecord|openVideoDb/i);
  assert.match(source.photos, /handlePhotos/);
});

test("browser: active reception is responsive and progresses to authorized workshop handoff", async () => {
  const { result, errors } = await runMobileCdpTest({
    name: "kha44-active-reception",
    cdpPort: 9391,
    run: async ({ send, sessionId, navigate, evaluate, setViewport, waitFor, click }) => {
      await send("Network.enable", {}, sessionId);
      await send("Network.setBlockedURLs", { urls: ["https://*.supabase.co/*", "https://bo.nimr.com.tn/*"] }, sessionId);
      await navigate("?kha44-local");
      await evaluate(technicianFixtureExpression({ role: "reception", started: false }));
      await evaluate(`
        saveState = async () => true;
        notifyUser = () => {};
        const now = new Date().toISOString();
        state.cases = [
          normalizeCase({
            id:"kha44-current", clientName:"Client Test", vehicle:"Shine", plate:"123TU456",
            vin:"VIN12345678901234", createdAt:now,
            claims:[{id:"kha44-claim",number:"OT-001",title:"Diagnostic",type:"diagnostic",includeInPlanning:true,clientApproved:false,authorizationReference:""}],
            receptionWorkflow:{rdvConfirmedAt:now}
          }),
          normalizeCase({
            id:"kha44-old", clientName:"Client Test", vehicle:"Shine", plate:"123TU456",
            vin:"VIN12345678901234", createdAt:"2026-08-01T08:00:00Z", orNavNumber:"OR-OLD"
          })
        ];
        state.bookings=[];
        activeCaseId="kha44-current";
        invalidateUiRuntimeIndexes();
        render();
        openOperationalCasePanel("kha44-current");
      `);
      await waitFor(`document.querySelector("#operational-case-dialog")?.open && document.querySelector("[data-reception-active-form]")`, "active reception form");

      const widths = [];
      for (const width of [1440, 1024, 768, 390]) {
        await setViewport({ width, height: 1000 });
        const layout = await evaluate(`({
          width:innerWidth,
          overflow:document.documentElement.scrollWidth > innerWidth,
          formWidth:document.querySelector("[data-reception-active-form]")?.getBoundingClientRect().width || 0,
          primary:document.querySelectorAll("[data-reception-active-form] .primary-button").length,
          tech:document.querySelectorAll("#operational-case-dialog [data-tech-action]").length,
          history:document.querySelector(".active-reception-history summary")?.textContent || ""
        })`);
        assert.equal(layout.width, width);
        assert.equal(layout.overflow, false);
        assert.ok(layout.formWidth > 0);
        assert.equal(layout.primary, 1);
        assert.equal(layout.tech, 0);
        assert.match(layout.history, /\(1\)/);
        widths.push(width);
      }

      await evaluate(`(() => {
        const f=document.querySelector("[data-reception-active-form]");
        f.elements.mileage.value="45000";
        f.elements.fuelLevel.value="half";
        f.elements.complaintsText.value="Bruit train avant";
        f.elements.requestedWorksText.value="Contrôler freinage";
        f.elements.damageNotes.value="Rayure aile AVG";
        f.elements.interiorNote.value="Tapis taché";
        f.elements.personalItems.value="Lunettes";
        f.elements.accessories.value="Carte grise";
        f.elements.documents.value="Carnet entretien";
        f.elements.conditionNote.value="Véhicule poussiéreux";
        f.elements.warrantyCampaignStatus.value="check";
        f.elements.warrantyCampaignReference.value="DFM-2026-01";
        f.elements.promisedAt.value="2026-09-30T15:00";
        f.elements.promiseNote.value="Sous réserve diagnostic";
        f.requestSubmit();
      })()`);
      await waitFor(`state.cases.find(c=>c.id==="kha44-current")?.flags?.received === true`, "active reception persisted");
      assert.deepEqual(await evaluate(`(() => {
        const x=state.cases.find(c=>c.id==="kha44-current");
        return {
          fuel:x.receptionWorkflow.vehicleFuelLevel,
          interior:x.receptionWorkflow.vehicleInteriorNote,
          personal:x.receptionWorkflow.vehiclePersonalItems,
          damage:x.damageNotes,
          clientApproved:x.claims[0].clientApproved,
          sent:Boolean(x.receptionWorkflow.sentToWorkshopAt),
          authorizeButtons:document.querySelectorAll('#operational-case-dialog [data-operational-action="authorize"]').length,
          sendButtons:document.querySelectorAll('#operational-case-dialog [data-operational-action="send-workshop"]').length
        };
      })()`), {
        fuel:"half", interior:"Tapis taché", personal:"Lunettes", damage:"Rayure aile AVG",
        clientApproved:false, sent:false, authorizeButtons:1, sendButtons:0
      });

      await evaluate(`(() => {
        const x=state.cases.find(c=>c.id==="kha44-current");
        recordWorkAuthorization(x,"kha44-claim","Bon signé client");
        const root=document.querySelector("#operational-case-dialog [data-context-decisions]");
        renderOperationalDecisions(root,x);
      })()`);
      assert.equal(await evaluate(`document.querySelectorAll('#operational-case-dialog [data-operational-action="send-workshop"]').length`), 1);
      await click('#operational-case-dialog [data-operational-action="send-workshop"]');
      await waitFor(`Boolean(state.cases.find(c=>c.id==="kha44-current")?.receptionWorkflow?.sentToWorkshopAt)`, "workshop handoff");
      assert.equal(await evaluate(`document.querySelectorAll('#operational-case-dialog [data-tech-action]').length`), 0);
      return widths;
    }
  });
  assert.deepEqual(result, [1440, 1024, 768, 390]);
  assert.deepEqual(errors, []);
});
