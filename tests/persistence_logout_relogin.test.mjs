import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { withBrowserPage } from "./helpers/cdp_browser_harness.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));

await withBrowserPage(root, async ({ send, sessionId, url, findings, evaluate, waitFor }) => {
  const beforeLogout = await evaluate(`(async () => {
    const now = new Date().toISOString();
    state = normalizeState({
      ...state,
      cases: [{
        id: "case-persistence-v2328",
        clientName: "Client persistance",
        vehicle: "Véhicule test",
        plate: "PERSIST-001",
        createdAt: now,
        updatedAt: now,
        claims: [],
      }],
      users: [{ id: "persist-user", name: "Chef persistance", role: "chef_atelier", active: true, createdAt: now, updatedAt: now }],
      currentUserId: "persist-user",
    });
    saveState({ skipCloud: true });
    await persistLargeStateSnapshot(state, { appVersion: APP_VERSION, reason: "persistence-test-before-logout" });
    await enqueueDurableOutboxOperation({
      operationId: "operation-persistence-v2328",
      idempotencyKey: "workshop-test:operation-persistence-v2328",
      entityType: "repair_order",
      entityId: "case-persistence-v2328",
      action: "upsert",
      payload: { plate: "PERSIST-001", mutation: "offline" },
      workshopId: "workshop-test",
      userId: "persist-user",
      expectedVersion: 4,
      retryCount: 0,
      lastError: "",
      createdAt: now,
      syncStatus: "pending",
    });
    await triggerLogout();
    const record = await loadLargeStateSnapshot();
    const outbox = await loadDurableOutboxOperations();
    const mirror = JSON.parse(localStorage.getItem(DURABLE_OUTBOX_MIRROR_KEY) || "[]");
    return {
      currentUserId: state.currentUserId,
      memoryCases: state.cases.length,
      cachedCases: record?.state?.cases?.length || 0,
      marker: JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"),
      outbox,
      mirror,
    };
  })()`);

  assert.equal(beforeLogout.currentUserId, "", "la déconnexion locale doit fermer uniquement la session utilisateur");
  assert.equal(beforeLogout.memoryCases, 1, "la déconnexion ne doit pas effacer le dossier en mémoire");
  assert.equal(beforeLogout.cachedCases, 1, "le dossier doit être confirmé dans IndexedDB avant déconnexion");
  assert.equal(beforeLogout.marker.largeState, true, "localStorage doit rester un marqueur compact lorsque IndexedDB est primaire");
  assert.equal(Object.hasOwn(beforeLogout.marker, "cases"), false, "le cache métier complet ne doit pas rester dans localStorage");
  assert.deepEqual(beforeLogout.outbox.map((entry) => ({
    operationId: entry.operationId,
    idempotencyKey: entry.idempotencyKey,
    entityType: entry.entityType,
    entityId: entry.entityId,
    action: entry.action,
    payload: entry.payload,
    workshopId: entry.workshopId,
    userId: entry.userId,
    expectedVersion: entry.expectedVersion,
    retryCount: entry.retryCount,
    lastError: entry.lastError,
    syncStatus: entry.syncStatus,
  })), [{
    operationId: "operation-persistence-v2328",
    idempotencyKey: "workshop-test:operation-persistence-v2328",
    entityType: "repair_order",
    entityId: "case-persistence-v2328",
    action: "upsert",
    payload: { plate: "PERSIST-001", mutation: "offline" },
    workshopId: "workshop-test",
    userId: "persist-user",
    expectedVersion: 4,
    retryCount: 0,
    lastError: "",
    syncStatus: "pending",
  }], "l'outbox IndexedDB doit conserver le contrat complet avant logout");
  assert.equal(Object.hasOwn(beforeLogout.mirror[0] || {}, "payload"), false, "le miroir localStorage de l'outbox doit rester compact");

  await evaluate("window.__nimrAppReady = false");
  await send("Page.navigate", { url: `${url}?after-logout=${Date.now()}` }, sessionId);
  await waitFor("window.__nimrAppReady === true", 25_000);
  const afterLogoutReload = await evaluate(`({
    cases: state.cases.map((item) => ({ id: item.id, plate: item.plate })),
    currentUserId: state.currentUserId,
    indexedDbPrimary: Boolean(window.NIMR_INDEXED_DB_STATUS?.primary),
  })`);
  assert.deepEqual(afterLogoutReload.cases, [{ id: "case-persistence-v2328", plate: "PERSIST-001" }]);
  assert.equal(afterLogoutReload.currentUserId, "");
  assert.equal(afterLogoutReload.indexedDbPrimary, true);
  const outboxAfterLogoutReload = await evaluate(`loadDurableOutboxOperations().then((records) => records.map((entry) => ({
    operationId: entry.operationId,
    syncStatus: entry.syncStatus,
    payload: entry.payload,
  })))`);
  assert.deepEqual(outboxAfterLogoutReload, [{
    operationId: "operation-persistence-v2328",
    syncStatus: "pending",
    payload: { plate: "PERSIST-001", mutation: "offline" },
  }], "logout/reload ne doit ni perdre ni acquitter artificiellement l'opération hors ligne");

  await evaluate(`(async () => {
    state.currentUserId = "persist-user";
    saveState({ skipCloud: true });
    await persistLargeStateSnapshot(state, { appVersion: APP_VERSION, reason: "persistence-test-relogin" });
    return true;
  })()`);
  await evaluate("window.__nimrAppReady = false");
  await send("Page.navigate", { url: `${url}?after-relogin=${Date.now()}` }, sessionId);
  await waitFor("window.__nimrAppReady === true", 25_000);
  const afterRelogin = await evaluate(`({
    currentUserId: state.currentUserId,
    caseId: state.cases[0]?.id || "",
    caseCount: state.cases.length,
  })`);
  assert.deepEqual(afterRelogin, { currentUserId: "persist-user", caseId: "case-persistence-v2328", caseCount: 1 });
  assert.deepEqual(findings, [], `zéro console.error/pageerror attendu : ${JSON.stringify(findings)}`);
});

console.log("PERSISTENCE LOGOUT RELogin OK");
