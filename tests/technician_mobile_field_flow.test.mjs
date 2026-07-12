import assert from "node:assert/strict";
import {
  SIMULATED_DEVICE_PROFILES,
  runMobileCdpTest,
  technicianFixtureExpression,
} from "./helpers/mobile_browser_harness.mjs";

console.log("TECHNICIAN MOBILE FIELD FLOW — profil Android Chromium simulé");

const android = SIMULATED_DEVICE_PROFILES.find((profile) => profile.name.includes("Android 360"));

const { result, errors } = await runMobileCdpTest({
  name: "technician-mobile-field-flow",
  cdpPort: Number(process.env.NIMR_TECHNICIAN_MOBILE_CDP_PORT || 9342),
  run: async ({ applyProfile, navigate, evaluate, waitFor, click, send, sessionId, wait }) => {
    await applyProfile(android);
    await navigate("?technician-mobile-field-flow=1");
    const fixture = await evaluate(technicianFixtureExpression({ role: "technicien", started: true }));
    assert.equal(fixture.current, "booking-mobile-current", "la tâche actuelle doit être prioritaire");

    const initial = await evaluate(`(() => ({
      current: document.querySelector("[data-technician-current-task]")?.dataset.currentBookingId,
      next: Boolean(document.querySelector("[data-technician-next-task]")),
      timer: document.querySelector("[data-technician-elapsed-booking]")?.textContent,
      dockPosition: getComputedStyle(document.querySelector("#technician-field-action-dock")).position,
      managerHidden: document.querySelector(".technician-manager-panel")?.hidden,
      actionHeights: [...document.querySelectorAll("#technician-field-action-dock button")].map((button) => button.getBoundingClientRect().height),
    }))()`);
    assert.equal(initial.current, "booking-mobile-current");
    assert.equal(initial.next, true, "la prochaine tâche doit être visible");
    assert.equal(initial.dockPosition, "fixed", "les actions terrain doivent rester fixes sur téléphone");
    assert.equal(initial.managerHidden, true, "le panneau Chef Atelier ne doit pas polluer l'espace technicien");
    assert.equal(initial.actionHeights.every((height) => height >= 44), true, "actions tactiles trop petites");

    await wait(1250);
    const timerAfterWait = await evaluate(`document.querySelector("[data-technician-elapsed-booking]")?.textContent`);
    assert.notEqual(timerAfterWait, initial.timer, "le chronomètre doit progresser");

    await evaluate(`forceEmergencyAutosave()`);
    await send("Page.reload", { ignoreCache: false }, sessionId);
    await waitFor("window.__nimrAppReady === true", "reprise technicien après reload", 120);
    await waitFor("Boolean(document.querySelector('[data-technician-current-task]'))", "tâche actuelle restaurée", 80);
    const afterReload = await evaluate(`(() => ({
      booking: document.querySelector("[data-technician-current-task]")?.dataset.currentBookingId,
      timer: document.querySelector("[data-technician-elapsed-booking]")?.textContent,
    }))()`);
    assert.equal(afterReload.booking, "booking-mobile-current", "la tâche courante doit survivre au rechargement");
    assert.notEqual(afterReload.timer, "00:00:00", "le timer ne doit pas être réinitialisé");

    await click('#technician-field-action-dock [data-tech-action="pause"]');
    await waitFor("!document.querySelector('#custom-modal-overlay').hidden", "modal pause");
    await evaluate(`(() => { const input = document.querySelector("#prompt-modal-input"); input.value = "pause repas"; input.dispatchEvent(new Event("change", { bubbles: true })); document.querySelector("#custom-modal-confirm").click(); })()`);
    await waitFor("document.querySelector('#technician-field-action-dock [data-tech-action=\"resume\"]')", "action reprendre après pause");
    assert.equal(await evaluate(`state.bookings.some((booking) => booking.status === "paused")`), true, "pause non persistée");

    await click('#technician-field-action-dock [data-tech-action="resume"]');
    await waitFor("document.querySelector('#technician-field-action-dock [data-tech-action=\"complete\"]')", "tâche reprise");

    await click('#technician-field-action-dock [data-tech-action="note"]');
    await waitFor("!document.querySelector('#custom-modal-overlay').hidden", "modal modèle observation");
    await evaluate(`(() => { const input = document.querySelector("#prompt-modal-input"); input.value = "Essai et vérification fonctionnelle effectués."; input.dispatchEvent(new Event("change", { bubbles: true })); document.querySelector("#custom-modal-confirm").click(); })()`);
    await waitFor("state.bookings.some((booking) => booking.notes?.some((note) => /Essai/.test(note.text)))", "observation modèle enregistrée");

    await click('#technician-field-action-dock [data-tech-action="block"]');
    await waitFor("!document.querySelector('#custom-modal-overlay').hidden", "modal motif blocage");
    await evaluate(`(() => { const input = document.querySelector("#prompt-modal-input"); input.value = "difficulté technique"; input.dispatchEvent(new Event("change", { bubbles: true })); document.querySelector("#custom-modal-confirm").click(); })()`);
    await waitFor("!document.querySelector('#custom-modal-overlay').hidden && document.querySelector('#prompt-modal-input')?.tagName === 'INPUT'", "modal détail blocage");
    await evaluate(`(() => { const input = document.querySelector("#prompt-modal-input"); input.value = "Diagnostic complémentaire requis"; input.dispatchEvent(new Event("input", { bubbles: true })); document.querySelector("#custom-modal-confirm").click(); })()`);
    await waitFor("document.querySelector('#technician-field-action-dock [data-tech-action=\"resume\"]')", "tâche bloquée");
    assert.equal(await evaluate(`state.bookings.some((booking) => booking.blockReason === "difficulté technique")`), true, "motif rapide non enregistré");

    await click('#technician-field-action-dock [data-tech-action="resume"]');
    await waitFor("document.querySelector('#technician-field-action-dock [data-tech-action=\"complete\"]')", "reprise après blocage");
    await click('#technician-field-action-dock [data-tech-action="complete"]');
    await waitFor("!document.querySelector('#custom-modal-overlay').hidden", "confirmation fin");
    await click("#custom-modal-confirm");
    await waitFor("!document.querySelector('#custom-modal-overlay').hidden && document.querySelector('#prompt-modal-input')", "note fin facultative");
    await click("#custom-modal-confirm");
    await waitFor("state.bookings.filter((booking) => booking.businessTaskId === 'task-mobile-current').every((booking) => getBookingOperationalStatus(booking) === 'completed')", "fin sans photo");

    const finalState = await evaluate(`(() => ({
      completed: state.bookings.filter((booking) => booking.businessTaskId === "task-mobile-current").every((booking) => getBookingOperationalStatus(booking) === "completed"),
      photos: state.bookings.filter((booking) => booking.businessTaskId === "task-mobile-current").flatMap((booking) => booking.photoIds || []).length,
      currentNow: document.querySelector("[data-technician-current-task]")?.dataset.currentBookingId,
      notePresent: state.bookings.some((booking) => booking.notes?.some((note) => /Essai/.test(note.text))),
    }))()`);
    assert.equal(finalState.completed, true);
    assert.equal(finalState.photos, 0, "la photo doit rester facultative");
    assert.equal(finalState.notePresent, true);
    assert.equal(finalState.currentNow, "booking-mobile-next", "la tâche suivante doit devenir prioritaire");
    return { initial, afterReload, finalState };
  },
});

assert.equal(result.finalState.completed, true);
assert.deepEqual(errors, [], `console.error/pageerror détecté: ${errors.join(" | ")}`);
console.log("TECHNICIAN MOBILE FIELD FLOW OK (SIMULATED PROFILE)");
