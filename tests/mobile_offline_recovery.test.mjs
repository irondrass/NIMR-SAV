import assert from "node:assert/strict";
import {
  SIMULATED_DEVICE_PROFILES,
  runMobileCdpTest,
  technicianFixtureExpression,
} from "./helpers/mobile_browser_harness.mjs";

console.log("MOBILE OFFLINE RECOVERY — profil Android Chromium simulé, sans appareil physique ni serveur Supabase réel");

const android = SIMULATED_DEVICE_PROFILES.find((profile) => profile.name.includes("Android 412"));

const { result, errors } = await runMobileCdpTest({
  name: "mobile-offline-recovery",
  cdpPort: Number(process.env.NIMR_MOBILE_OFFLINE_CDP_PORT || 9343),
  run: async ({ applyProfile, navigate, evaluate, waitFor, click, setOffline, send, sessionId, wait }) => {
    await applyProfile(android);
    await navigate("?mobile-offline-recovery=1");
    await evaluate(technicianFixtureExpression({ role: "technicien", started: true }));
    await evaluate(`persistLargeStateSnapshot(state, { appVersion: APP_VERSION, reason: "mobile-offline-fixture" })`);

    await evaluate(`navigator.serviceWorker.ready.then(() => true)`);
    await evaluate(`window.__nimrAppReady = false`);
    await send("Page.reload", { ignoreCache: false }, sessionId);
    await waitFor("window.__nimrAppReady === true", "application contrôlée par le service worker", 120);
    await waitFor("Boolean(navigator.serviceWorker.controller)", "contrôle PWA actif", 120);
    await waitFor("Boolean(document.querySelector('[data-technician-current-task]'))", "tâche technicien restaurée", 80);

    await setOffline(true);
    await waitFor("navigator.onLine === false", "passage hors ligne", 80);
    await waitFor("!document.querySelector('#offline-banner').hidden", "bannière hors ligne", 80);

    await click('#technician-field-action-dock [data-tech-action="note"]');
    await waitFor("!document.querySelector('#custom-modal-overlay').hidden", "modèles d'observation hors ligne");
    await evaluate(`(() => {
      const input = document.querySelector("#prompt-modal-input");
      input.value = "Essai et vérification fonctionnelle effectués.";
      input.dispatchEvent(new Event("change", { bubbles: true }));
      document.querySelector("#custom-modal-confirm").click();
    })()`);
    await waitFor("state.bookings.some((booking) => booking.notes?.some((note) => /Essai/.test(note.text)))", "observation locale conservée");
    await waitFor("Number(window.NIMR_OUTBOX_STATUS?.pending || 0) > 0", "opération IndexedDB en attente", 120);
    await evaluate(`persistLargeStateSnapshot(state, { appVersion: APP_VERSION, reason: "mobile-offline-action" })`);

    const beforeReload = await evaluate(`(async () => {
      const operations = await loadDurableOutboxOperations();
      return {
        operationIds: operations.map((entry) => entry.operationId),
        idempotencyKeys: operations.map((entry) => entry.idempotencyKey),
        pending: operations.filter((entry) => entry.syncStatus === "pending").length,
        banner: document.querySelector("#offline-banner")?.innerText || "",
        sync: document.querySelector("[data-technician-sync-state]")?.innerText || "",
      };
    })()`);
    assert.ok(beforeReload.pending > 0, "l'action hors ligne doit rester en attente durable");
    assert.equal(new Set(beforeReload.operationIds).size, beforeReload.operationIds.length, "operationId dupliqué avant reload");
    assert.equal(new Set(beforeReload.idempotencyKeys).size, beforeReload.idempotencyKeys.length, "idempotencyKey dupliquée avant reload");
    assert.match(beforeReload.banner, /hors ligne/i);
    assert.match(beforeReload.sync, /hors ligne/i);

    await evaluate(`window.__nimrAppReady = false`);
    await send("Page.reload", { ignoreCache: false }, sessionId);
    await waitFor("window.__nimrAppReady === true", "reprise PWA hors ligne", 120);
    await waitFor("typeof state !== 'undefined' && state.bookings.some((booking) => booking.notes?.some((note) => /Essai/.test(note.text)))", "observation restaurée hors ligne", 120);
    await waitFor("Number(window.NIMR_OUTBOX_STATUS?.pending || 0) > 0", "outbox restaurée hors ligne", 120);

    const afterOfflineReload = await evaluate(`(async () => {
      const operations = await loadDurableOutboxOperations();
      return {
        current: document.querySelector("[data-technician-current-task]")?.dataset.currentBookingId || "",
        notePresent: state.bookings.some((booking) => booking.notes?.some((note) => /Essai/.test(note.text))),
        operationIds: operations.map((entry) => entry.operationId),
        idempotencyKeys: operations.map((entry) => entry.idempotencyKey),
        pending: operations.filter((entry) => entry.syncStatus === "pending").length,
      };
    })()`);
    assert.equal(afterOfflineReload.current, "booking-mobile-current", "la tâche active doit survivre au reload hors ligne");
    assert.equal(afterOfflineReload.notePresent, true, "l'observation hors ligne est perdue");
    assert.deepEqual(afterOfflineReload.operationIds, beforeReload.operationIds, "operationId modifié pendant le reload");
    assert.deepEqual(afterOfflineReload.idempotencyKeys, beforeReload.idempotencyKeys, "idempotencyKey modifiée pendant le reload");

    await setOffline(false);
    await waitFor("navigator.onLine !== false", "retour réseau", 80);
    await waitFor("document.querySelector('[data-technician-sync-state]')?.textContent.includes('En ligne')", "état technicien reconnecté", 80);
    await wait(400);

    const afterReconnect = await evaluate(`(async () => {
      const operations = await loadDurableOutboxOperations();
      return {
        operationIds: operations.map((entry) => entry.operationId),
        pending: operations.filter((entry) => ["pending", "failed", "processing"].includes(entry.syncStatus)).length,
        configured: isSupabaseConfigured(),
        sync: document.querySelector("[data-technician-sync-state]")?.innerText || "",
        bannerHidden: document.querySelector("#offline-banner")?.hidden,
      };
    })()`);
    assert.equal(afterReconnect.configured, false, "ce test local ne doit pas prétendre utiliser Supabase réel");
    assert.deepEqual(afterReconnect.operationIds, beforeReload.operationIds, "l'outbox ne doit ni perdre ni dupliquer l'action sans accusé serveur");
    assert.ok(afterReconnect.pending > 0, "sans serveur configuré l'action ne doit pas être marquée synchronisée");
    assert.doesNotMatch(afterReconnect.sync, /Synchronisé/i, "synchronisation annoncée sans confirmation serveur");
    assert.equal(afterReconnect.bannerHidden, true, "la bannière hors ligne doit disparaître après reconnexion");
    return { beforeReload, afterOfflineReload, afterReconnect };
  },
});

assert.ok(result.afterReconnect.pending > 0);
assert.deepEqual(errors, [], `console.error/pageerror détecté: ${errors.join(" | ")}`);
console.log("MOBILE OFFLINE RECOVERY OK (SIMULATED PROFILE; OUTBOX KEPT WITHOUT REAL SERVER ACK)");
