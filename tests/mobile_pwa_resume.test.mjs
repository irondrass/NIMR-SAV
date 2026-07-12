import assert from "node:assert/strict";
import {
  SIMULATED_DEVICE_PROFILES,
  runMobileCdpTest,
  technicianFixtureExpression,
} from "./helpers/mobile_browser_harness.mjs";

console.log("MOBILE PWA RESUME — cycle arrière-plan/relaunch Chromium simulé, pas une PWA installée sur appareil physique");

const android = SIMULATED_DEVICE_PROFILES.find((profile) => profile.name.includes("Android 360"));

const { result, errors } = await runMobileCdpTest({
  name: "mobile-pwa-resume",
  cdpPort: Number(process.env.NIMR_MOBILE_PWA_RESUME_CDP_PORT || 9345),
  run: async ({ applyProfile, navigate, evaluate, waitFor, send, sessionId, wait }) => {
    await applyProfile(android);
    await navigate("?mobile-pwa-resume=1");
    await evaluate(technicianFixtureExpression({ role: "technicien", started: true }));
    await evaluate(`(() => {
      const item = state.cases.find((candidate) => candidate.id === "case-mobile-current");
      const result = addTechnicianTaskNote(item, "booking-mobile-current", "tech-mobile", "État PWA avant arrière-plan");
      if (!result.ok) throw new Error(result.message);
      saveState({ skipCloud: true, skipSnapshot: true });
      return persistLargeStateSnapshot(state, { appVersion: APP_VERSION, reason: "mobile-pwa-before-background" });
    })()`);
    await evaluate(`navigator.serviceWorker.ready.then(() => true)`);
    await evaluate(`window.__nimrAppReady = false`);
    await send("Page.reload", { ignoreCache: false }, sessionId);
    await waitFor("window.__nimrAppReady === true", "PWA prête après contrôle service worker", 120);
    await waitFor("Boolean(navigator.serviceWorker.controller)", "service worker contrôleur", 120);
    await waitFor("Boolean(document.querySelector('[data-technician-current-task]'))", "tâche active après activation PWA", 120);

    const beforeBackground = await evaluate(`(async () => ({
      current: document.querySelector("[data-technician-current-task]")?.dataset.currentBookingId || "",
      timer: document.querySelector("[data-technician-elapsed-booking]")?.textContent || "",
      elapsedMs: getTechnicianFamilyElapsedMilliseconds("booking-mobile-current"),
      now: Date.now(),
      visibility: document.visibilityState,
      activeTab,
      sessions: state.bookings.find((booking) => booking.id === "booking-mobile-current")?.workSessions?.length || 0,
      notePresent: state.bookings.some((booking) => booking.notes?.some((note) => /État PWA/.test(note.text))),
      controlled: Boolean(navigator.serviceWorker.controller),
      cacheName: window.NIMR_CACHE_NAME,
      cacheNames: await caches.keys(),
    }))()`);
    assert.equal(beforeBackground.current, "booking-mobile-current");
    assert.equal(beforeBackground.notePresent, true);
    assert.equal(beforeBackground.controlled, true);
    assert.ok(beforeBackground.cacheNames.includes(beforeBackground.cacheName), "cache PWA courant absent");

    await send("Page.setWebLifecycleState", { state: "frozen" }, sessionId);
    await wait(1300);
    await send("Page.setWebLifecycleState", { state: "active" }, sessionId);
    await send("Page.bringToFront", {}, sessionId);
    await evaluate(`window.dispatchEvent(new Event("focus"))`);
    await wait(150);
    const afterBackground = await evaluate(`({
      current: document.querySelector("[data-technician-current-task]")?.dataset.currentBookingId || "",
      timer: document.querySelector("[data-technician-elapsed-booking]")?.textContent || "",
      elapsedMs: getTechnicianFamilyElapsedMilliseconds("booking-mobile-current"),
      now: Date.now(),
      visibility: document.visibilityState,
      activeTab,
      sessions: state.bookings.find((booking) => booking.id === "booking-mobile-current")?.workSessions?.length || 0,
      notePresent: state.bookings.some((booking) => booking.notes?.some((note) => /État PWA/.test(note.text))),
    })`);
    assert.equal(afterBackground.current, beforeBackground.current, "tâche perdue après arrière-plan");
    assert.equal(afterBackground.notePresent, true, "note perdue après arrière-plan");
    assert.ok(afterBackground.elapsedMs > beforeBackground.elapsedMs, `le temps calculé doit progresser en arrière-plan: ${JSON.stringify({ beforeBackground, afterBackground })}`);
    assert.notEqual(afterBackground.timer, beforeBackground.timer, `le timer affiché doit refléter le temps passé en arrière-plan: ${JSON.stringify({ beforeBackground, afterBackground })}`);
    assert.equal(afterBackground.sessions, beforeBackground.sessions, "la reprise ne doit pas ouvrir une seconde session de temps");

    await evaluate(`persistLargeStateSnapshot(state, { appVersion: APP_VERSION, reason: "mobile-pwa-before-relaunch" })`);
    await send("Page.navigate", { url: "about:blank" }, sessionId);
    await wait(250);
    await navigate("?mobile-pwa-relaunch=1");
    await waitFor("Boolean(document.querySelector('[data-technician-current-task]'))", "tâche active après relance PWA", 120);
    const afterRelaunch = await evaluate(`({
      current: document.querySelector("[data-technician-current-task]")?.dataset.currentBookingId || "",
      timer: document.querySelector("[data-technician-elapsed-booking]")?.textContent || "",
      sessions: state.bookings.find((booking) => booking.id === "booking-mobile-current")?.workSessions?.length || 0,
      notePresent: state.bookings.some((booking) => booking.notes?.some((note) => /État PWA/.test(note.text))),
      userId: getCurrentUser()?.id || "",
      controlled: Boolean(navigator.serviceWorker.controller),
    })`);
    assert.equal(afterRelaunch.current, beforeBackground.current, "tâche perdue après relance PWA simulée");
    assert.equal(afterRelaunch.notePresent, true, "modification perdue après relance PWA simulée");
    assert.equal(afterRelaunch.userId, "user-mobile-tech", "session locale perdue après relance");
    assert.equal(afterRelaunch.controlled, true, "service worker non actif après relance");
    assert.equal(afterRelaunch.sessions, beforeBackground.sessions, "session temps dupliquée après relance");
    assert.notEqual(afterRelaunch.timer, "00:00:00", "timer réinitialisé après relance");
    return { beforeBackground, afterBackground, afterRelaunch };
  },
});

assert.equal(result.afterRelaunch.current, "booking-mobile-current");
assert.deepEqual(errors, [], `console.error/pageerror détecté: ${errors.join(" | ")}`);
console.log("MOBILE PWA RESUME OK (SIMULATED PROFILE)");
