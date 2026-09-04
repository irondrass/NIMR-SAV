import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const css = read("styles.css");
const state = read("js/state.js");
const sw = read("sw.js");
const d1 = read("tests/identity_database_authority_hardening_identity001d1.test.mjs");

const passed = [];
const failed = [];
async function check(name, fn) {
  try {
    await fn();
    passed.push(name);
    console.log(`PASS ${name}`);
  } catch (error) {
    failed.push(name);
    console.error(`FAIL ${name}: ${error.message}`);
  }
}

await check("A0 CSS has no literal shell newline artifacts and sidebar scroll is valid", () => {
  assert.doesNotMatch(css, /`n/u);

  const marker = css.lastIndexOf("UX-010");
  const ux = css.slice(marker);

  assert.match(
    ux,
    /\.sidebar\s*\{[\s\S]*?overflow-x:\s*hidden;[\s\S]*?overflow-y:\s*auto;/u
  );
});

await check("A UX-010 visual-system marker is present", () => {
  assert.match(css, /UX-010 — 2026 visual system and overlap hardening/u);
});

await check("B quiet success/info notifications use the fixed toast region instead of the sidebar save badge", () => {
  const start = state.indexOf("function quietNotify(message");
  assert.notEqual(start, -1);
  const end = state.indexOf("\n}\n", start);
  const body = state.slice(start, end + 3);
  assert.match(body, /notifyUser\(message, variant\)/u);
  assert.doesNotMatch(body, /updateSaveStatusIndicator/u);
});

await check("C save status badge is constrained inside the sidebar brand", () => {
  assert.match(css, /\.brand\s*>\s*\*\s*\{[\s\S]*?min-width:\s*0/u);
  assert.match(css, /\.save-status-indicator\s*\{[\s\S]*?grid-column:\s*1\s*\/\s*-1/u);
  assert.match(css, /\.save-status-indicator\s*\{[\s\S]*?max-width:\s*100%/u);
  assert.match(css, /\.save-status-indicator\s*\{[\s\S]*?text-overflow:\s*ellipsis/u);
});

await check("D long user identity text is constrained and ellipsized", () => {
  assert.match(css, /#sidebar-user-name\s*\{[\s\S]*?overflow:\s*hidden/u);
  assert.match(css, /#sidebar-user-name\s*\{[\s\S]*?text-overflow:\s*ellipsis/u);
  assert.match(css, /#sidebar-user-name\s*\{[\s\S]*?white-space:\s*nowrap/u);
});

await check("E dashboard uses a fluid auto-fit grid instead of a rigid six-column layout", () => {
  const marker = css.lastIndexOf("UX-010 — 2026 visual system and overlap hardening");
  const ux = css.slice(marker);
  assert.match(ux, /\.dashboard-strip\s*\{[\s\S]*?repeat\(auto-fit,\s*minmax\(160px,\s*1fr\)\)/u);
});

await check("F status strip and toast content can wrap without overlapping neighboring UI", () => {
  const marker = css.lastIndexOf("UX-010 — 2026 visual system and overlap hardening");
  const ux = css.slice(marker);
  assert.match(ux, /\.sync-item[\s\S]*?overflow-wrap:\s*anywhere/u);
  assert.match(ux, /\.toast[\s\S]*?overflow-wrap:\s*anywhere/u);
  assert.match(ux, /\.sync-cloud-action\s*\{[\s\S]*?white-space:\s*normal/u);
});

await check("G toast layer is fixed and independent from application layout", () => {
  const marker = css.lastIndexOf("UX-010 — 2026 visual system and overlap hardening");
  const ux = css.slice(marker);
  assert.match(ux, /\.toast-region\s*\{[\s\S]*?position:\s*fixed/u);
  assert.match(ux, /\.toast-region\s*\{[\s\S]*?z-index:\s*1200/u);
});

await check("H global controls gain visible focus treatment and modern sizing", () => {
  const marker = css.lastIndexOf("UX-010 — 2026 visual system and overlap hardening");
  const ux = css.slice(marker);
  assert.match(ux, /:focus-visible\s*\{[\s\S]*?outline:/u);
  assert.match(ux, /input,\s*textarea,\s*select\s*\{[\s\S]*?border-radius:\s*12px/u);
});

await check("I responsive hardening covers tablet and small mobile layouts", () => {
  const marker = css.lastIndexOf("UX-010 — 2026 visual system and overlap hardening");
  const ux = css.slice(marker);
  assert.match(ux, /@media \(max-width:\s*900px\)/u);
  assert.match(ux, /@media \(max-width:\s*760px\)/u);
  assert.match(ux, /@media \(max-width:\s*600px\)/u);
  assert.match(ux, /@media \(prefers-reduced-motion:\s*reduce\)/u);
});

await check("J service worker is source-refreshed without changing the v23.3.29 cache contract", () => {
  assert.match(sw, /UX-010 source refresh/u);
  assert.match(sw, /const CACHE_NAME = "nimr-sav-v23\.3\.29"/u);
  assert.match(read("js/version.js"), /^window\.APP_VERSION = "v23\.3\.29";$/mu);
});

await check("K UX-010 does not introduce auth, SQL, service-role, or permission authority changes", () => {
  const marker = css.lastIndexOf("UX-010 — 2026 visual system and overlap hardening");
  const ux = css.slice(marker);
  assert.doesNotMatch(ux, /supabase|workshop_members|service[_-]?role|auth\.admin/iu);
  const quietStart = state.indexOf("function quietNotify(message");
  const quietEnd = state.indexOf("\n}\n", quietStart);
  const quiet = state.slice(quietStart, quietEnd + 3);
  assert.doesNotMatch(quiet, /supabase|workshop_members|service[_-]?role|auth\.admin/iu);
});

await check("M panel does not inherit overflow-wrap anywhere so dashboard card text stays readable", () => {
  const marker = css.lastIndexOf("UX-010");
  const ux = css.slice(marker);

  assert.match(
    ux,
    /\.panel\s*\{[\s\S]*?overflow-wrap:\s*break-word/u,
  );

  const panelBlocks = [...ux.matchAll(/\.panel\s*\{([^}]*)\}/gu)];
  for (const m of panelBlocks) {
    assert.doesNotMatch(m[1], /overflow-wrap:\s*anywhere/u);
  }
});

await check("N planning hour tick labels are protected from character-level wrapping", () => {
  const marker = css.lastIndexOf("UX-010");
  const ux = css.slice(marker);

  assert.match(
    ux,
    /\.tick\s+span\s*\{[\s\S]*?white-space:\s*nowrap/u,
  );
});

await check("O mobile menu button uses absolute header positioning and removes fixed viewport overlay", () => {
  const marker = css.lastIndexOf("UX-010");
  const nextTicket = css.indexOf("/* WORKSHOP-001F exact labor instructions */", marker);
  const ux = css.slice(marker, nextTicket === -1 ? undefined : nextTicket);

  assert.match(
    ux,
    /\.mobile-menu-btn\s*\{[\s\S]*?position:\s*absolute;/u,
  );
  assert.doesNotMatch(
    ux,
    /\.mobile-menu-btn\s*\{[\s\S]*?position:\s*fixed;/u,
  );
  assert.match(
    ux,
    /\.mobile-menu-btn\s*\{[\s\S]*?right:\s*max\(/u,
  );
  assert.match(
    ux,
    /\.mobile-menu-btn\s*\{[\s\S]*?left:\s*auto/u,
  );
  assert.match(
    ux,
    /\.sidebar\s+\.brand\s*\{[\s\S]*?padding:\s*0\s+calc\(88px/u,
  );
});

await check("P dashboard priority cards provide dedicated wide content column alongside action button", () => {
  const marker = css.lastIndexOf("UX-010");
  const ux = css.slice(marker);

  assert.match(
    ux,
    /\.pilotage-priority-card\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto/u,
  );
  assert.match(
    ux,
    /\.priority-card-header\s*\{[\s\S]*?display:\s*flex/u,
  );
});

await check("L changed paths are limited to the approved UX-010 surfaces", () => {
  assert.match(d1, /tests\/ux_visual_system_2026_ux010\.test\.mjs/u);
  const status = execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" });
  const paths = status
    .split(/\r?\n/u)
    .filter((line) => line.length >= 4)
    .map((line) => line.slice(3).trim())
    .map((line) => line.includes(" -> ") ? line.split(" -> ").pop() : line);
  const allowed = new Set([
    "styles.css",
    "index.html",
    "offline.html",
    "js/state.js",
    "js/storage.js",
    "js/supabase-sync.js",
    "js/ui-cases.js",
    "js/utils.js",
    "js/version.js",
    "js/estimate-import.js",
    "js/exports.js",
    "js/ui-planning.js",
    "app.js",
    "sw.js",
    "js/business-rules-v2187.js",
    "tests/workshop_operation_centric_domain_workshop001a.test.mjs",
    "tests/workshop_001d_operation_centric_cockpit.test.mjs",
    "tests/workshop_001e_operation_centric_technician.test.mjs",
    "tests/workshop_001f_exact_labor_instructions.test.mjs",
    "tests/identity_database_authority_hardening_identity001d1.test.mjs",
    "tests/identity_invited_user_password_onboarding_identity001d2e.test.mjs",
    "tests/identity_password_recovery_otp_identity001d2f.test.mjs",
    "tests/perf_fast_pwa_startup_perf001.test.mjs",
    "tests/ux_visual_system_2026_ux010.test.mjs",
    "tests/sync_granular_bootstrap_self_heal_sync001.test.mjs",
    "tests/sync_conflict_reconcile_and_collapse_sync002.test.mjs",
    "tests/sync_equivalent_cas_auto_reconcile_sync0021.test.mjs",
    "tests/sync_clean_reload_localrevision_drift_sync0022.test.mjs",
    "tests/pwa_deploy_asset_version_consistency_cache001.test.mjs",
    "tests/security_xss_accessibility_secux001.test.mjs",
    "tests/pwa_cache_version_contract.test.mjs",
    "tests/offline_concurrency_chaos_p010.test.mjs",
    "tests/helpers/granular_supabase_adapter.mjs",
    ".gitattributes",
    "tests/helpers/release-fingerprint.mjs",
    "tests/release_fingerprint_portability.test.mjs",
  ]);
  for (const changedPath of paths) {
    assert.ok(allowed.has(changedPath), `unexpected UX-010 changed path: ${changedPath}`);
  }
});

if (failed.length) {
  console.error(`\nUX-010 REGRESSION SUITE: ${passed.length}/${passed.length + failed.length} CHECKS PASSED`);
  process.exitCode = 1;
} else {
  console.log(`\nUX-010 REGRESSION SUITE: ${passed.length}/${passed.length} CHECKS PASSED`);
}
