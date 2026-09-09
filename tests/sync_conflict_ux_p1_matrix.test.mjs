import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createNimrVmContext } from "./helpers/nimr_vm_context.mjs";
import { createGranularSupabaseAdapter } from "./helpers/granular_supabase_adapter.mjs";

const WORKSHOP_ID = "00000000-0000-0000-0000-000000000001";
const CASE_A_ID = "case-aaaa-0000-0000-000000000001";
const CASE_B_ID = "case-bbbb-0000-0000-000000000002";

function createDomStub() {
  const elements = new Map();

  function getOrCreate(selector) {
    if (!elements.has(selector)) {
      const isFallbackBtn = selector === "#fallback-resolve-conflict-btn";
      const el = {
        selector,
        tagName: (selector.startsWith("#") ? "DIV" : (selector.startsWith(".") ? "DIV" : selector)).toUpperCase(),
        value: "",
        textContent: isFallbackBtn ? "Résoudre le conflit" : "",
        innerHTML: "",
        hidden: false,
        disabled: false,
        title: "",
        dataset: {},
        style: {},
        attributes: new Map(),
        listeners: {},
        children: [],
        setAttribute(k, v) { this.attributes.set(k, String(v)); this[k] = v; },
        getAttribute(k) { return this.attributes.has(k) ? this.attributes.get(k) : (this[k] !== undefined ? String(this[k]) : null); },
        hasAttribute(k) { return this.attributes.has(k) || this[k] !== undefined; },
        removeAttribute(k) { this.attributes.delete(k); delete this[k]; },
        classList: {
          classes: new Set(),
          add(c) { this.classes.add(c); },
          remove(c) { this.classes.delete(c); },
          toggle(c, force) { if (force !== undefined) { force ? this.classes.add(c) : this.classes.delete(c); } else { this.classes.has(c) ? this.classes.delete(c) : this.classes.add(c); } },
          contains(c) { return this.classes.has(c); },
        },
        querySelector(sel) {
          if (this._querySelectorOverride) return this._querySelectorOverride(sel);
          return getOrCreate(sel);
        },
        querySelectorAll(sel) {
          if (this._querySelectorAllOverride) return this._querySelectorAllOverride(sel);
          return [];
        },
        closest() { return null; },
        addEventListener(evt, fn) {
          this.listeners[evt] = this.listeners[evt] || [];
          this.listeners[evt].push(fn);
        },
        click() {
          if (this.listeners.click) this.listeners.click.forEach((fn) => fn({ preventDefault() {} }));
          if (this.onclick) this.onclick({ preventDefault() {} });
        },
        focus() {
          this.focused = true;
          domState.activeElement = this;
        },
        scrollIntoView() { this.scrolledIntoView = true; },
      };
      elements.set(selector, el);
    }
    return elements.get(selector);
  }

  const domState = {
    activeElement: null,
    elements,
    getOrCreate,
  };

  return domState;
}

function createP1Harness(options = {}) {
  const dom = createDomStub();
  const scriptFiles = [
    "../../js/utils.js",
    "../../js/state.js",
    "../../js/storage.js",
    "../../js/supabase-config.js",
    "../../js/supabase-client.js",
    "../../js/supabase-sync.js",
    "../../js/ui-cases.js",
    "../../app.js",
  ];

  const contract = createNimrVmContext({
    scriptFiles,
    console: { ...console, warn() {}, error() {} },
  });

  const ctx = contract.context;

  // Provide direct hook into lexical state variable
  contract.run(`
    window.__setAppState = function(s) {
      state = s;
      return state;
    };
    window.__getAppState = function() {
      return state;
    };
    Object.defineProperty(window, "activeTab", {
      get: () => activeTab,
      set: (v) => { activeTab = v; },
      configurable: true,
      enumerable: true
    });
    Object.defineProperty(window, "activeSettingsWorkspace", {
      get: () => activeSettingsWorkspace,
      set: (v) => { activeSettingsWorkspace = v; },
      configurable: true,
      enumerable: true
    });
  `);

  ctx.document.querySelector = (sel) => dom.getOrCreate(sel);
  ctx.document.getElementById = (id) => dom.getOrCreate("#" + id);
  ctx.document.querySelectorAll = (sel) => [];

  // Mock global getters/functions expected in UI
  ctx.getSupabaseWorkshopId = () => WORKSHOP_ID;
  ctx.isSupabaseConfigured = () => true;
  ctx.getActiveCase = () => null;
  ctx.renderPlanning = () => {};
  ctx.renderTechnicianDashboard = () => {};
  ctx.renderTodayWorkshop = () => {};
  ctx.renderResources = () => {};
  ctx.renderHolidays = () => {};
  ctx.renderResourceLeaves = () => {};
  ctx.renderFastLaneSettings = () => {};
  ctx.renderWorkHoursSettings = () => {};
  ctx.migrateLegacyPhotos = () => {};
  ctx.refreshSupabasePanel = () => {};
  ctx.renderUsersAndRoles = () => {};
  ctx.bindWorkHoursInputs = () => {};
  ctx.quietNotify = () => {};
  ctx.notifications = [];
  ctx.notifyUser = (msg, level) => {
    ctx.notifications.push({ msg, level });
  };

  // Initialize basic state in lexical variable
  ctx.setAppState = (s) => ctx.__setAppState(s);
  ctx.getAppState = () => ctx.__getAppState();

  const initialState = ctx.normalizeState({
    cases: [
      {
        id: CASE_A_ID,
        caseNumber: "CASE-A",
        status: "in_progress",
        localRevision: 5,
        syncRevision: 5,
        updatedAt: new Date().toISOString(),
        updatedBy: "Chef",
        history: [],
      },
      {
        id: CASE_B_ID,
        caseNumber: "CASE-B",
        status: "in_progress",
        localRevision: 2,
        syncRevision: 2,
        updatedAt: new Date().toISOString(),
        updatedBy: "Chef",
        history: [],
      },
    ],
    resources: [],
    bookings: [],
    users: [
      { id: "u-admin", name: "Admin", role: "admin_technique", active: true },
      { id: "u-director", name: "Directeur", role: "directeur", active: true },
      { id: "u-chef", name: "Chef Atelier", role: "chef_atelier", active: true },
      { id: "u-reception", name: "Réception", role: "reception", active: true },
      { id: "u-tech", name: "Technicien", role: "technicien", active: true },
    ],
    currentUserId: "u-chef",
    syncConflicts: [],
  });
  ctx.setAppState(initialState);

  return { ctx, dom, contract };
}

// -------------------------------------------------------------
// SCENARIO A: ACTIVE CONFLICT CONTROL (EXPECT PASS)
// -------------------------------------------------------------
test("Scenario A: Active conflict control renders indicator and permits resolution for management role", async () => {
  const { ctx, dom } = createP1Harness();
  ctx.getAppState().syncConflicts = [
    {
      id: "conflict-1",
      conflictKey: "conflict-1",
      type: "case_conflict",
      caseId: CASE_A_ID,
      caseNumber: "CASE-A",
      status: "open",
      localCase: { id: CASE_A_ID, status: "in_progress" },
      remoteCase: { id: CASE_A_ID, status: "planning" },
    },
  ];

  ctx.renderSyncStatusStrip();

  const cloudEl = dom.getOrCreate("[data-sync-cloud]");
  const fallbackBtn = dom.getOrCreate("#fallback-resolve-conflict-btn");

  assert.ok(cloudEl.textContent.includes("1 conflit"), "Cloud badge must reflect active conflict");
  assert.equal(cloudEl.getAttribute("tabindex"), "0", "Cloud element must be focusable");
  assert.equal(fallbackBtn.hidden, false, "Fallback resolution button must be visible");

  // Authorized role navigation
  ctx.navigateToConflictsAndFocus();
  assert.equal(ctx.activeTab, "atelier", "Active tab must switch to atelier");
  assert.equal(ctx.activeSettingsWorkspace, "administration", "Settings workspace must switch to administration");
  assert.equal(dom.getOrCreate("#sync-conflict-panel").hidden, false, "Sync conflict panel must be visible");
});

// -------------------------------------------------------------
// SCENARIO B: GROUPED COUNT & ACTIONABILITY VALIDATION (P1b)
// -------------------------------------------------------------
test("Scenario B: Grouped count vs raw actionability validation (P1b)", async () => {
  const { ctx, dom } = createP1Harness();

  // B1: Prove grouping dependency is present
  assert.equal(
    typeof ctx.groupConflictedEntities,
    "function",
    "P1 harness must expose production groupConflictedEntities"
  );

  // Outbox contains 3 historical conflicted operations for the SAME case
  const outboxOps = [
    { operationId: "op-1", workshopId: WORKSHOP_ID, entityType: "case", entityId: CASE_A_ID, syncStatus: "conflicted", payload: { localRevision: 10 } },
    { operationId: "op-2", workshopId: WORKSHOP_ID, entityType: "case", entityId: CASE_A_ID, syncStatus: "conflicted", payload: { localRevision: 11 } },
    { operationId: "op-3", workshopId: WORKSHOP_ID, entityType: "case", entityId: CASE_A_ID, syncStatus: "conflicted", payload: { localRevision: 12 } },
  ];

  // Prove direct production grouping result
  const directGrouped = ctx.groupConflictedEntities([], outboxOps);
  assert.equal(
    directGrouped.length,
    1,
    "Three conflicted operations for one entity must group to one entity"
  );

  // B2: Re-run display count with production mirror key
  ctx.localStorage.setItem("nimr-sav-outbox-mirror:v2", JSON.stringify(outboxOps));
  ctx.getAppState().syncConflicts = [];

  ctx.renderSyncStatusStrip();

  const cloudEl = dom.getOrCreate("[data-sync-cloud]");
  const fallbackBtn = dom.getOrCreate("#fallback-resolve-conflict-btn");

  // Cloud badge text must contain "1 conflit détecté" and must NOT contain "3 conflits"
  assert.ok(
    cloudEl.textContent.includes("1 conflit détecté"),
    "Cloud badge text must contain '1 conflit détecté'"
  );
  assert.equal(
    cloudEl.textContent.includes("3 conflits"),
    false,
    "Cloud badge text MUST NOT contain '3 conflits détectés'"
  );

  // B3: Test actual raw vs grouped divergence
  const rawSum = ctx.getOpenSyncConflicts().length + outboxOps.length; // 0 + 3 = 3
  const totalConflicts = directGrouped.length; // 1

  assert.equal(rawSum, 3, "Precondition: raw sum of outbox conflicts is 3");
  assert.equal(totalConflicts, 1, "Precondition: grouped count is 1");

  // Numerical magnitude diverges (1 grouped entity vs 3 raw operations)
  assert.notEqual(
    totalConflicts,
    rawSum,
    "Numerical divergence exists between grouped entity count (1) and raw operation count (3)"
  );

  // Boolean actionability divergence evaluation:
  // In all reachable production states, any non-zero conflicted outbox operations produce >= 1 group.
  // Therefore (totalConflicts > 0) === (rawSum > 0) is identically true for boolean decisions.
  const booleanGrouped = totalConflicts > 0;
  const booleanRaw = rawSum > 0;
  assert.equal(
    booleanGrouped,
    booleanRaw,
    "No boolean reachability divergence: (totalConflicts > 0) matches (rawSum > 0)"
  );
});

// -------------------------------------------------------------
// SCENARIO C: OUTBOX-ONLY CONFLICT PANEL VISIBILITY (EXPECT FAIL)
// -------------------------------------------------------------
test("Scenario C: Outbox-only conflict remains visible in activity log panel even when user lacks audit.view", async () => {
  const { ctx, dom } = createP1Harness();

  // Outbox contains a conflicted entity, state.syncConflicts is empty
  const outboxOps = [
    { operationId: "op-1", workshopId: WORKSHOP_ID, entityType: "case", entityId: CASE_A_ID, syncStatus: "conflicted", payload: { localRevision: 10 } },
  ];
  ctx.localStorage.setItem("nimr-sav-outbox-mirror:v2", JSON.stringify(outboxOps));
  ctx.localStorage.setItem("nimr-sav-durable-outbox-mirror:v1", JSON.stringify(outboxOps));
  ctx.getAppState().syncConflicts = [];

  // User lacks audit.view permission
  ctx.hasPermission = (perm) => perm !== "audit.view";

  const panelActivityLog = dom.getOrCreate("#panel-activity-log");
  const syncConflictPanel = dom.getOrCreate("#sync-conflict-panel");

  panelActivityLog.hidden = true;
  syncConflictPanel.hidden = true;

  // Run renderActivityLog (which in turn calls renderConflictPanel)
  ctx.renderActivityLog();

  // CONTRACT: The conflict panel and its parent container must NOT be hidden,
  // because an outbox conflict exists to be resolved.
  // CURRENT DEFECT: app.js:1549 checks `openConflictsCount === 0` using only getOpenSyncConflicts(),
  // ignoring durable outbox, so panelActivityLog.hidden is set to true!
  assert.equal(
    panelActivityLog.hidden,
    false,
    "Panel activity log must NOT be hidden when outbox conflicts exist, even if user lacks audit.view"
  );
  assert.equal(
    syncConflictPanel.hidden,
    false,
    "Sync conflict panel must be visible when outbox conflict exists"
  );
});

// -------------------------------------------------------------
// SCENARIO D: NON-MANAGEMENT ROLE GUIDANCE (EXPECT FAIL)
// -------------------------------------------------------------
test("Scenario D: Non-management roles receive contextual guidance and are not prompted with unusable 'Résoudre' action", async () => {
  const { ctx, dom } = createP1Harness();

  ctx.getAppState().currentUserId = "u-reception"; // Non-management role
  ctx.getAppState().syncConflicts = [
    {
      id: "conflict-1",
      type: "case_conflict",
      caseId: CASE_A_ID,
      status: "open",
    },
  ];

  ctx.renderSyncStatusStrip();

  const fallbackBtn = dom.getOrCreate("#fallback-resolve-conflict-btn");

  assert.equal(ctx.canAccessTab("atelier"), false, "Precondition: reception role cannot access atelier");

  // CONTRACT: For non-management roles who cannot resolve conflicts:
  // The button must NOT be visible and advertise "Résoudre le conflit" (which they cannot execute).
  // CURRENT DEFECT: Button is unhidden (hidden === false) and text is unconditionally "Résoudre le conflit"
  const showsActionableResolve = !fallbackBtn.hidden && fallbackBtn.textContent.includes("Résoudre");
  assert.equal(
    showsActionableResolve,
    false,
    "Fallback button must NOT prompt non-management user to 'Résoudre' when they lack authorization"
  );
});

// -------------------------------------------------------------
// SCENARIO E: AUTHORIZED NAVIGATION (EXPECT PASS)
// -------------------------------------------------------------
test("Scenario E: Authorized management roles navigate to administration conflict panel", async () => {
  const roles = ["admin_technique", "directeur", "chef_atelier"];

  for (const role of roles) {
    const { ctx, dom } = createP1Harness();
    const user = ctx.getAppState().users.find((u) => u.role === role);
    ctx.getAppState().currentUserId = user.id;

    ctx.getAppState().syncConflicts = [
      {
        id: "conflict-1",
        type: "case_conflict",
        caseId: CASE_A_ID,
        status: "open",
      },
    ];

    ctx.navigateToConflictsAndFocus();

    assert.equal(ctx.activeTab, "atelier", `Role ${role} must navigate to atelier tab`);
    assert.equal(ctx.activeSettingsWorkspace, "administration", `Role ${role} must switch to administration workspace`);
    assert.equal(dom.getOrCreate("#sync-conflict-panel").hidden, false, `Conflict panel must be visible for role ${role}`);
  }
});

// -------------------------------------------------------------
// SCENARIO F: FOCUS TARGET (EXPECT FAIL)
// -------------------------------------------------------------
test("Scenario F: Focus target lands on first resolution action and not on safety download button", async () => {
  const { ctx, dom } = createP1Harness();

  const conflictPanel = dom.getOrCreate("#sync-conflict-panel");

  // Mock children matching real renderConflictPanel output where download button precedes resolution buttons:
  const downloadBtn = {
    tagName: "BUTTON",
    textContent: "Télécharger copie locale",
    hasAttribute: (k) => k === "data-sync-conflict-download-id",
    getAttribute: (k) => k === "data-sync-conflict-download-id" ? "conf-1" : null,
    focus() { dom.activeElement = this; },
  };

  const keepLocalBtn = {
    tagName: "BUTTON",
    textContent: "Conserver version locale",
    hasAttribute: (k) => k === "data-sync-conflict-action" || k === "data-sync-conflict-id",
    getAttribute: (k) => k === "data-sync-conflict-action" ? "keep_local" : "conf-1",
    focus() { dom.activeElement = this; },
  };

  conflictPanel._querySelectorOverride = (sel) => {
    if (sel.includes("[data-sync-conflict-action]")) {
      return keepLocalBtn;
    }
    if (sel.includes("button")) {
      return downloadBtn;
    }
    return dom.getOrCreate(sel);
  };

  ctx.navigateToConflictsAndFocus();

  // CONTRACT: Focus must land on the resolution action [data-sync-conflict-action]
  // CURRENT DEFECT: Focus lands on the download button because selector matches any `button` first!
  assert.ok(
    dom.activeElement && dom.activeElement.hasAttribute("data-sync-conflict-action"),
    "Focus must land on resolution action button [data-sync-conflict-action], not download button"
  );
});

// -------------------------------------------------------------
// SCENARIO G: RESOLVED STATE CONFLICT (EXPECT PASS)
// -------------------------------------------------------------
test("Scenario G: Resolved state conflict is excluded from active conflicts and global badge", async () => {
  const { ctx, dom } = createP1Harness();

  ctx.getAppState().syncConflicts = [
    {
      id: "conflict-resolved-1",
      type: "case_conflict",
      caseId: CASE_A_ID,
      status: "resolved",
      resolution: "accepted_cloud",
      decision: "accepted_cloud",
    },
  ];

  assert.equal(ctx.getOpenSyncConflicts().length, 0, "Resolved conflict must be excluded from getOpenSyncConflicts()");

  ctx.renderSyncStatusStrip();

  const cloudEl = dom.getOrCreate("[data-sync-cloud]");
  const fallbackBtn = dom.getOrCreate("#fallback-resolve-conflict-btn");

  assert.equal(cloudEl.textContent.includes("conflit"), false, "Global cloud badge must NOT show conflicts");
  assert.equal(fallbackBtn.hidden, true, "Fallback button must be hidden");
});

// -------------------------------------------------------------
// SCENARIO H: SERVER RECONCILED + CONFLICTED OUTBOX (P2 FIX & HARDENING)
// -------------------------------------------------------------
test("Scenario H: Reconciling server-resolved conflict clears/settles matching conflicted outbox operations", async (t) => {
  const { ctx } = createP1Harness();
  const adapter = createGranularSupabaseAdapter({ workshopId: WORKSHOP_ID });

  // H1: Server resolved + exact local_operation_id + conflicted op => stale op settled/removed
  await t.test("H1: exact matching local_operation_id settles conflicted op", async () => {
    const conflictedOp = {
      operationId: "op-conflicted-100",
      workshopId: WORKSHOP_ID,
      entityType: "case",
      entityId: CASE_A_ID,
      syncStatus: "conflicted",
      conflictId: "server-conf-999",
      baseVersion: 10,
    };
    await ctx.putDurableOutboxOperation(conflictedOp);

    ctx.getAppState().syncConflicts = [
      {
        id: "server-conf-999",
        type: "server_entity_conflict",
        workshopId: WORKSHOP_ID,
        entityType: "case",
        entityId: CASE_A_ID,
        status: "open",
        serverConflictId: "server-conf-999",
        localOperationId: "op-conflicted-100",
      },
    ];

    adapter.recordServerConflict({
      id: "server-conf-999",
      workshop_id: WORKSHOP_ID,
      entity_type: "case",
      entity_id: CASE_A_ID,
      local_operation_id: "op-conflicted-100",
      status: "resolved",
      resolution: "accept_server",
      resolved_at: new Date().toISOString(),
    });

    const res = await ctx.reconcileServerResolvedConflicts(adapter.client, WORKSHOP_ID);
    assert.equal(res.reconciled, 1, "Must reconcile 1 server conflict");
    assert.equal(ctx.getAppState().syncConflicts[0].status, "resolved", "Local conflict must be marked resolved");

    const outboxAfter = await ctx.loadDurableOutboxOperations();
    const stillConflicted = outboxAfter.filter((op) => op.operationId === "op-conflicted-100" && ["conflicted", "conflict"].includes(op.syncStatus));
    assert.equal(stillConflicted.length, 0, "Conflicted outbox operation must be settled/cleared upon server reconciliation");
  });

  // H2: Server resolved + same entity + different operationId => unrelated operation preserved
  await t.test("H2: unrelated operation for same entity preserved", async () => {
    const unrelatedOp = {
      operationId: "op-unrelated-200",
      workshopId: WORKSHOP_ID,
      entityType: "case",
      entityId: CASE_A_ID,
      syncStatus: "conflicted",
      conflictId: "server-conf-other",
      baseVersion: 11,
    };
    await ctx.putDurableOutboxOperation(unrelatedOp);

    ctx.getAppState().syncConflicts = [
      {
        id: "server-conf-resolved-2",
        type: "server_entity_conflict",
        workshopId: WORKSHOP_ID,
        entityType: "case",
        entityId: CASE_A_ID,
        status: "open",
        serverConflictId: "server-conf-resolved-2",
        localOperationId: "op-different-target",
      },
    ];

    adapter.recordServerConflict({
      id: "server-conf-resolved-2",
      workshop_id: WORKSHOP_ID,
      entity_type: "case",
      entity_id: CASE_A_ID,
      local_operation_id: "op-different-target",
      status: "resolved",
      resolution: "accept_server",
      resolved_at: new Date().toISOString(),
    });

    await ctx.reconcileServerResolvedConflicts(adapter.client, WORKSHOP_ID);
    const outboxAfter = await ctx.loadDurableOutboxOperations();
    const preserved = outboxAfter.find((op) => op.operationId === "op-unrelated-200");
    assert.ok(preserved, "Unrelated operation for same entity must be preserved");
    assert.equal(preserved.syncStatus, "conflicted", "Unrelated op must remain conflicted");
  });

  // H3: Server resolved + exact operationId but pending status => operation preserved
  await t.test("H3: exact operationId with pending status is preserved", async () => {
    const pendingOp = {
      operationId: "op-pending-300",
      workshopId: WORKSHOP_ID,
      entityType: "case",
      entityId: CASE_A_ID,
      syncStatus: "pending",
      baseVersion: 12,
    };
    await ctx.putDurableOutboxOperation(pendingOp);

    ctx.getAppState().syncConflicts = [
      {
        id: "server-conf-resolved-3",
        type: "server_entity_conflict",
        workshopId: WORKSHOP_ID,
        entityType: "case",
        entityId: CASE_A_ID,
        status: "open",
        serverConflictId: "server-conf-resolved-3",
        localOperationId: "op-pending-300",
      },
    ];

    adapter.recordServerConflict({
      id: "server-conf-resolved-3",
      workshop_id: WORKSHOP_ID,
      entity_type: "case",
      entity_id: CASE_A_ID,
      local_operation_id: "op-pending-300",
      status: "resolved",
      resolution: "accept_server",
      resolved_at: new Date().toISOString(),
    });

    await ctx.reconcileServerResolvedConflicts(adapter.client, WORKSHOP_ID);
    const outboxAfter = await ctx.loadDurableOutboxOperations();
    const preserved = outboxAfter.find((op) => op.operationId === "op-pending-300");
    assert.ok(preserved, "Pending operation must not be settled/deleted");
    assert.equal(preserved.syncStatus, "pending", "Pending status must be preserved");
  });

  // H4: Historical entity-only reconciliation with no proven operation ID => state reconciles, outbox not broadly removed
  await t.test("H4: entity-only fallback reconciles state but does not delete outbox", async () => {
    const candidateOp = {
      operationId: "op-unproven-400",
      workshopId: WORKSHOP_ID,
      entityType: "case",
      entityId: CASE_A_ID,
      syncStatus: "conflicted",
      baseVersion: 13,
    };
    await ctx.putDurableOutboxOperation(candidateOp);

    ctx.getAppState().syncConflicts = [
      {
        id: "damaged-conflict-4",
        type: "server_entity_conflict",
        workshopId: WORKSHOP_ID,
        entityType: "case",
        entityId: CASE_A_ID,
        status: "open",
      },
    ];

    adapter.recordServerConflict({
      id: "server-conf-4",
      workshop_id: WORKSHOP_ID,
      entity_type: "case",
      entity_id: CASE_A_ID,
      status: "resolved",
      resolution: "accept_server",
      resolved_at: new Date().toISOString(),
    });

    const res = await ctx.reconcileServerResolvedConflicts(adapter.client, WORKSHOP_ID);
    assert.equal(res.reconciled, 1, "Entity-only fallback reconciles state conflict");
    assert.equal(ctx.getAppState().syncConflicts[0].status, "resolved");

    const outboxAfter = await ctx.loadDurableOutboxOperations();
    const preserved = outboxAfter.find((op) => op.operationId === "op-unproven-400");
    assert.ok(preserved, "Outbox operation must NOT be broadly removed by entity-only fallback");
    assert.equal(preserved.syncStatus, "conflicted");
  });

  // H5: Exact operation ID but workshop/entity mismatch => preserve operation
  await t.test("H5: exact operation ID but workshop/entity mismatch preserves outbox", async () => {
    const mismatchOp = {
      operationId: "op-mismatch-500",
      workshopId: "other-workshop-999",
      entityType: "case",
      entityId: CASE_A_ID,
      syncStatus: "conflicted",
      baseVersion: 14,
    };
    await ctx.putDurableOutboxOperation(mismatchOp);

    ctx.getAppState().syncConflicts = [
      {
        id: "server-conf-mismatch-5",
        type: "server_entity_conflict",
        workshopId: WORKSHOP_ID,
        entityType: "case",
        entityId: CASE_A_ID,
        status: "open",
        serverConflictId: "server-conf-mismatch-5",
        localOperationId: "op-mismatch-500",
      },
    ];

    adapter.recordServerConflict({
      id: "server-conf-mismatch-5",
      workshop_id: WORKSHOP_ID,
      entity_type: "case",
      entity_id: CASE_A_ID,
      local_operation_id: "op-mismatch-500",
      status: "resolved",
      resolution: "accept_server",
      resolved_at: new Date().toISOString(),
    });

    await ctx.reconcileServerResolvedConflicts(adapter.client, WORKSHOP_ID);
    const outboxAfter = await ctx.loadDurableOutboxOperations();
    const preserved = outboxAfter.find((op) => op.operationId === "op-mismatch-500");
    assert.ok(preserved, "Mismatched operation must NOT be settled");
    assert.equal(preserved.syncStatus, "conflicted", "Mismatched operation remains conflicted");
  });

  // H6: Settlement failure => must not falsely present clean complete reconciliation
  await t.test("H6: settlement failure surfaces error", async () => {
    const failingOp = {
      operationId: "op-failing-600",
      workshopId: WORKSHOP_ID,
      entityType: "case",
      entityId: CASE_A_ID,
      syncStatus: "conflicted",
      baseVersion: 15,
    };
    await ctx.putDurableOutboxOperation(failingOp);

    ctx.getAppState().syncConflicts = [
      {
        id: "server-conf-600",
        type: "server_entity_conflict",
        workshopId: WORKSHOP_ID,
        entityType: "case",
        entityId: CASE_A_ID,
        status: "open",
        serverConflictId: "server-conf-600",
        localOperationId: "op-failing-600",
      },
    ];

    adapter.recordServerConflict({
      id: "server-conf-600",
      workshop_id: WORKSHOP_ID,
      entity_type: "case",
      entity_id: CASE_A_ID,
      local_operation_id: "op-failing-600",
      status: "resolved",
      resolution: "accept_server",
      resolved_at: new Date().toISOString(),
    });

    const origAck = ctx.acknowledgeDurableOutboxOperation;
    ctx.acknowledgeDurableOutboxOperation = async () => {
      throw new Error("DB settlement disk write failure");
    };
    try {
      const res = await ctx.reconcileServerResolvedConflicts(adapter.client, WORKSHOP_ID);
      assert.ok(res.error || res.settlementError, "Settlement error must be surfaced");
    } finally {
      ctx.acknowledgeDurableOutboxOperation = origAck;
    }
  });
});

// -------------------------------------------------------------
// SCENARIO I: KEEP_LOCAL PENDING RESOLUTION SEMANTICS
// -------------------------------------------------------------
test("Scenario I: In-flight keep_local pending resolution does not display actionable 'Résoudre' warning", async () => {
  const { ctx, dom } = createP1Harness();

  // In-flight keep_local resolution awaiting acknowledgment
  ctx.getAppState().syncConflicts = [
    {
      id: "conflict-pending-1",
      type: "server_entity_conflict",
      caseId: CASE_A_ID,
      status: "open",
      pendingResolution: true,
      resolutionStage: "awaiting_ack",
      decision: "kept_local",
    },
  ];

  ctx.renderSyncStatusStrip();

  const cloudEl = dom.getOrCreate("[data-sync-cloud]");

  // CONTRACT: A conflict where the user has already chosen 'keep_local' and which is in-flight awaiting ack
  // must NOT tell the user "— 1 conflit détecté — Résoudre" (which implies user action is needed).
  assert.equal(
    cloudEl.textContent.includes("Résoudre"),
    false,
    "Global cloud indicator must NOT prompt user to 'Résoudre' when conflict resolution is already in-flight"
  );
  assert.ok(
    cloudEl.textContent.includes("résolution en attente"),
    "Global cloud indicator must inform user that resolution is pending"
  );
});

// -------------------------------------------------------------
// SCENARIO J: AFFECTED DOSSIER MUTATION GUARD (EXPECT PASS)
// -------------------------------------------------------------
test("Scenario J: Sensitive mutations on conflicted case remain blocked", async () => {
  const { ctx } = createP1Harness();

  ctx.getAppState().syncConflicts = [
    {
      id: "conf-a",
      type: "case_conflict",
      caseId: CASE_A_ID,
      status: "open",
    },
  ];

  const sensitivePermissions = [
    "planning.edit",
    "task.start",
    "task.complete",
    "quality.validate",
    "delivery.complete",
    "case.edit",
  ];

  for (const perm of sensitivePermissions) {
    const guard = ctx.guardAction(perm, { caseId: CASE_A_ID, booking: { id: "b-1", caseId: CASE_A_ID } }, { notify: false });
    assert.equal(guard.ok, false, `Action '${perm}' on conflicted case ${CASE_A_ID} must be blocked`);
    assert.ok(guard.message.includes("conflit"), `Guard message for '${perm}' must mention conflict`);
  }
});

// -------------------------------------------------------------
// SCENARIO K: UNRELATED DOSSIER ISOLATION (EXPECT PASS)
// -------------------------------------------------------------
test("Scenario K: Sensitive mutations on unrelated unconflicted case are NOT blocked", async () => {
  const { ctx } = createP1Harness();

  // Conflict is on CASE_A_ID only
  ctx.getAppState().syncConflicts = [
    {
      id: "conf-a",
      type: "case_conflict",
      caseId: CASE_A_ID,
      status: "open",
    },
  ];

  const sensitivePermissions = [
    "planning.edit",
    "task.start",
    "task.complete",
    "quality.validate",
    "delivery.complete",
    "case.edit",
  ];

  for (const perm of sensitivePermissions) {
    const guard = ctx.guardAction(perm, { caseId: CASE_B_ID, booking: { id: "b-2", caseId: CASE_B_ID } }, { notify: false });
    assert.equal(guard.ok, true, `Action '${perm}' on unconflicted case ${CASE_B_ID} must be allowed`);
  }
});

// -------------------------------------------------------------
// SCENARIO L: OUTBOX SETTLEMENT CONTROL
// -------------------------------------------------------------
test("Scenario L: Conflicted outbox group settlement clears active conflict state", async () => {
  const { ctx, dom } = createP1Harness();
  const adapter = createGranularSupabaseAdapter({ workshopId: WORKSHOP_ID });
  ctx.getSupabaseClient = () => adapter.client;

  ctx.createSyncSafetySnapshot = async () => ({ ok: true });
  ctx.navigator.onLine = true;
  const op = {
    operationId: "op-settle-1",
    workshopId: WORKSHOP_ID,
    entityType: "case",
    entityId: CASE_A_ID,
    action: "upsert",
    syncStatus: "conflicted",
    conflictId: "server-conf-settle-1",
    baseVersion: 10,
    expectedVersion: 10,
    payload: {
      entity: {
        id: CASE_A_ID,
        clientName: "Client A",
        localRevision: 10,
        history: [],
      },
    },
  };
  await ctx.putDurableOutboxOperation(op);

  ctx.getAppState().syncConflicts = [
    {
      id: "conf-settle-1",
      conflictKey: "conf-settle-1",
      type: "server_entity_conflict",
      workshopId: WORKSHOP_ID,
      entityType: "case",
      entityId: CASE_A_ID,
      status: "open",
      localOperationId: op.operationId,
      serverConflictId: "server-conf-settle-1",
    },
  ];

  adapter.recordServerConflict({
    id: "server-conf-settle-1",
    status: "open",
    workshop_id: WORKSHOP_ID,
    local_operation_id: op.operationId,
  });

  // Resolve keep_local
  const res = ctx.resolveSyncConflict("conf-settle-1", "keep_local");
  assert.equal(res.ok, true);
  await res.completion;

  // Find replacement operation
  const outbox = await ctx.loadDurableOutboxOperations();
  const replacement = outbox.find((o) => o.operationId !== op.operationId);
  assert.ok(replacement, "Replacement operation must be enqueued");

  // Settle replacement operation
  await ctx.settleAcknowledgedReplacementOperation(adapter.client, replacement.operationId, { accepted: true, serverVersion: 11 });

  // After settlement, state conflict must be resolved
  assert.equal(ctx.getAppState().syncConflicts[0].status, "resolved", "Conflict must be resolved after settlement");

  ctx.renderSyncStatusStrip();
  const cloudEl = dom.getOrCreate("[data-sync-cloud]");
  assert.equal(cloudEl.textContent.includes("conflit"), false, "No active conflicts after valid settlement");
});

// -------------------------------------------------------------
// SCENARIO M: RELOAD / REHYDRATION CONTROL
// -------------------------------------------------------------
test("Scenario M: Reload with resolved state conflict and acknowledged outbox resurrects no active conflict", async () => {
  const { ctx, dom } = createP1Harness();

  // Persisted state has resolved conflict
  const rawState = {
    cases: [{ id: CASE_A_ID, status: "in_progress", localRevision: 10, syncRevision: 10 }],
    syncConflicts: [
      {
        id: "conf-old",
        type: "case_conflict",
        caseId: CASE_A_ID,
        status: "resolved",
        resolution: "accepted_cloud",
      },
    ],
  };

  const rehydrated = ctx.normalizeState(rawState);
  ctx.setAppState(rehydrated);

  // Persisted outbox has acknowledged op
  ctx.localStorage.setItem(
    "nimr-sav-durable-outbox-mirror:v1",
    JSON.stringify([
      { operationId: "op-ack", workshopId: WORKSHOP_ID, entityType: "case", entityId: CASE_A_ID, syncStatus: "acknowledged" },
    ])
  );

  assert.equal(ctx.getOpenSyncConflicts().length, 0, "No open conflicts in rehydrated state");

  ctx.renderSyncStatusStrip();
  const cloudEl = dom.getOrCreate("[data-sync-cloud]");
  assert.equal(cloudEl.textContent.includes("conflit"), false, "No active conflicts after rehydration");
});
