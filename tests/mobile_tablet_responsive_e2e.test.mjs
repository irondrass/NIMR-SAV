import assert from "node:assert/strict";
import {
  SIMULATED_DEVICE_PROFILES,
  responsiveAuditExpression,
  runMobileCdpTest,
  technicianFixtureExpression,
} from "./helpers/mobile_browser_harness.mjs";

console.log("MOBILE/TABLETTE E2E — profils Chromium simulés, pas des appareils physiques");

const { result, errors } = await runMobileCdpTest({
  name: "mobile-tablet-responsive",
  cdpPort: Number(process.env.NIMR_MOBILE_RESPONSIVE_CDP_PORT || 9341),
  run: async ({ applyProfile, navigate, evaluate, wait }) => {
    const profiles = [];
    for (const profile of SIMULATED_DEVICE_PROFILES) {
      await applyProfile(profile);
      await navigate(`?mobile-profile=${encodeURIComponent(profile.name)}`);
      const fixture = await evaluate(technicianFixtureExpression({ role: "admin_technique", started: true }));
      assert.equal(fixture.cases, 2, `${profile.name}: dossiers de test absents`);

      const navigation = await evaluate(`(async () => {
        const visit = async (tab) => {
          document.querySelector('[data-tab="' + tab + '"]')?.click();
          await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 40)));
        };
        await visit("reception-workspace");
        const importVisible = Boolean(document.querySelector("#quick-estimate-file-input")?.getBoundingClientRect().width);
        await visit("dossiers");
        document.querySelector('[data-case="case-mobile-current"]')?.click();
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const dossierVisible = Boolean(document.querySelector("#case-detail")?.textContent?.trim());
        await visit("planning");
        const planningVisible = !document.querySelector("#view-planning")?.hidden;
        await visit("technician");
        return { importVisible, dossierVisible, planningVisible, activeTab };
      })()`);
      await wait(80);
      const audit = await evaluate(responsiveAuditExpression());

      assert.equal(navigation.importVisible, true, `${profile.name}: import PDF inaccessible`);
      assert.equal(navigation.dossierVisible, true, `${profile.name}: dossier inaccessible`);
      assert.equal(navigation.planningVisible, true, `${profile.name}: planning inaccessible`);
      assert.equal(navigation.activeTab, "technician", `${profile.name}: espace technicien inaccessible`);
      assert.equal(audit.globalOverflow, false, `${profile.name}: scroll horizontal global`);
      assert.equal(audit.currentTaskVisible, true, `${profile.name}: tâche prioritaire invisible`);
      assert.equal(audit.nextTaskVisible, true, `${profile.name}: tâche suivante invisible`);
      assert.equal(audit.dockVisible, true, `${profile.name}: actions technicien invisibles`);
      assert.equal(audit.buttonsAccessible, true, `${profile.name}: cible tactile principale < 44x44`);
      assert.equal(audit.fixedBarsDoNotOverlap, true, `${profile.name}: actions masquées par la navigation basse ${JSON.stringify({ dock: audit.dockRect, nav: audit.navRect })}`);
      assert.equal(audit.modalFits, true, `${profile.name}: modal hors écran`);

      const summary = {
        profile: profile.name,
        viewport: `${audit.viewportWidth}x${audit.viewportHeight}`,
        overflow: audit.globalOverflow,
        touchTargets: audit.criticalButtons.length,
        currentNext: `${audit.currentTaskVisible}/${audit.nextTaskVisible}`,
      };
      profiles.push(summary);
      console.log(JSON.stringify(summary));
    }
    return profiles;
  },
});

assert.equal(result.length, SIMULATED_DEVICE_PROFILES.length, "tous les profils simulés doivent être exécutés");
assert.deepEqual(errors, [], `console.error/pageerror détecté: ${errors.join(" | ")}`);
console.log("MOBILE TABLET RESPONSIVE E2E OK (SIMULATED PROFILES)");
