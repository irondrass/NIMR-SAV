import assert from "node:assert/strict";
import {
  SIMULATED_DEVICE_PROFILES,
  responsiveAuditExpression,
  runMobileCdpTest,
  technicianFixtureExpression,
} from "./helpers/mobile_browser_harness.mjs";

console.log("MOBILE ORIENTATION/KEYBOARD — rotations et clavier réduit simulés, pas des appareils physiques");

const profiles = [
  SIMULATED_DEVICE_PROFILES.find((profile) => profile.name.includes("iPhone SE")),
  SIMULATED_DEVICE_PROFILES.find((profile) => profile.name.includes("iPad Mini")),
];

const { result, errors } = await runMobileCdpTest({
  name: "mobile-orientation-keyboard",
  cdpPort: Number(process.env.NIMR_MOBILE_ORIENTATION_CDP_PORT || 9344),
  run: async ({ applyProfile, navigate, evaluate, waitFor, click, setViewport, wait }) => {
    const summaries = [];
    for (const profile of profiles) {
      await applyProfile(profile, "portrait");
      await navigate(`?mobile-orientation=${encodeURIComponent(profile.name)}`);
      await evaluate(technicianFixtureExpression({ role: "technicien", started: true }));
      const before = await evaluate(`({
        current: document.querySelector("[data-technician-current-task]")?.dataset.currentBookingId || "",
        timer: document.querySelector("[data-technician-elapsed-booking]")?.textContent || "",
      })`);

      const landscape = await applyProfile(profile, "landscape");
      await wait(200);
      const landscapeAudit = await evaluate(responsiveAuditExpression());
      const afterRotation = await evaluate(`({
        current: document.querySelector("[data-technician-current-task]")?.dataset.currentBookingId || "",
        timer: document.querySelector("[data-technician-elapsed-booking]")?.textContent || "",
        orientation: matchMedia("(orientation: landscape)").matches,
      })`);
      assert.equal(afterRotation.current, before.current, `${profile.name}: tâche perdue après rotation`);
      assert.equal(afterRotation.orientation, true, `${profile.name}: paysage non appliqué`);
      assert.equal(landscapeAudit.globalOverflow, false, `${profile.name}: débordement horizontal en paysage`);
      assert.equal(landscapeAudit.dockVisible, true, `${profile.name}: actions masquées en paysage`);
      assert.equal(landscapeAudit.fixedBarsDoNotOverlap, true, `${profile.name}: barre fixe superposée en paysage`);

      await click('#technician-field-action-dock [data-tech-action="note"]');
      await waitFor("!document.querySelector('#custom-modal-overlay').hidden", "modal observation");
      await evaluate(`(() => {
        const select = document.querySelector("#prompt-modal-input");
        select.value = "__custom__";
        select.dispatchEvent(new Event("change", { bubbles: true }));
        document.querySelector("#custom-modal-confirm").click();
      })()`);
      await waitFor("document.querySelector('#prompt-modal-input')?.tagName === 'INPUT'", "champ observation libre");
      await evaluate(`document.querySelector("#prompt-modal-input").focus()`);

      const keyboardHeight = profile.width <= 430 ? 320 : 480;
      await setViewport({
        width: landscape.width,
        height: keyboardHeight,
        scale: profile.scale,
        mobile: true,
        touch: true,
        orientation: "landscapePrimary",
      });
      await wait(350);
      const keyboardAudit = await evaluate(`(() => {
        const modal = document.querySelector(".custom-modal-content");
        const input = document.querySelector("#prompt-modal-input");
        const confirm = document.querySelector("#custom-modal-confirm");
        confirm?.scrollIntoView({ block: "nearest" });
        const modalRect = modal?.getBoundingClientRect();
        const inputRect = input?.getBoundingClientRect();
        const confirmRect = confirm?.getBoundingClientRect();
        const viewportHeight = window.visualViewport?.height || window.innerHeight;
        return {
          activeInput: document.activeElement === input,
          viewportHeight,
          modalScrollable: Boolean(modal && modal.scrollHeight >= modal.clientHeight),
          modalFits: Boolean(modalRect && modalRect.top >= -1 && modalRect.bottom <= viewportHeight + 1),
          inputVisible: Boolean(inputRect && inputRect.top >= -1 && inputRect.bottom <= viewportHeight + 1),
          confirmVisible: Boolean(confirmRect && confirmRect.top >= -1 && confirmRect.bottom <= viewportHeight + 1),
          confirmHeight: confirmRect?.height || 0,
          overflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) > document.documentElement.clientWidth + 2,
        };
      })()`);
      assert.equal(keyboardAudit.activeInput, true, `${profile.name}: le champ clavier doit conserver le focus`);
      assert.equal(keyboardAudit.modalFits, true, `${profile.name}: modal hors écran avec clavier simulé`);
      assert.equal(keyboardAudit.inputVisible, true, `${profile.name}: champ masqué par le clavier simulé`);
      assert.equal(keyboardAudit.confirmVisible, true, `${profile.name}: validation masquée par le clavier simulé`);
      assert.ok(keyboardAudit.confirmHeight >= 44, `${profile.name}: cible validation < 44px (${keyboardAudit.confirmHeight}px)`);
      assert.equal(keyboardAudit.overflow, false, `${profile.name}: débordement horizontal avec clavier simulé`);

      await evaluate(`(() => {
        const input = document.querySelector("#prompt-modal-input");
        input.value = "Observation après rotation";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        document.querySelector("#custom-modal-confirm").click();
      })()`);
      await waitFor("state.bookings.some((booking) => booking.notes?.some((note) => note.text === 'Observation après rotation'))", "observation après rotation enregistrée");
      assert.equal(await evaluate(`document.querySelector("[data-technician-current-task]")?.dataset.currentBookingId`), before.current, `${profile.name}: tâche perdue après clavier`);
      summaries.push({ profile: profile.name, landscape: `${landscape.width}x${landscape.height}`, keyboardHeight, keyboardAudit });
    }
    return summaries;
  },
});

assert.equal(result.length, profiles.length);
assert.deepEqual(errors, [], `console.error/pageerror détecté: ${errors.join(" | ")}`);
console.log("MOBILE ORIENTATION KEYBOARD OK (SIMULATED PROFILES)");
