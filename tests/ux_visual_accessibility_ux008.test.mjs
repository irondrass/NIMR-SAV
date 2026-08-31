import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE_SHA = "9f27a39199a6c5b716f9648dffd2f184993262de";
const sourceRef = String(process.argv.find((argument) => argument.startsWith("--source-ref="))?.slice("--source-ref=".length) || process.env.UX008_SOURCE_REF || "").trim();
const browserSmokeRequested = process.argv.includes("--browser-smoke");
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readProjectFile(relativePath) {
  const normalized = relativePath.replaceAll("\\", "/");
  if (sourceRef) {
    return execFileSync("git", ["show", `${sourceRef}:${normalized}`], {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
    });
  }
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function readBaseFile(relativePath) {
  return execFileSync("git", ["show", `${BASE_SHA}:${relativePath.replaceAll("\\", "/")}`], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
}

function sourceSlice(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `Missing source marker: ${startMarker}`);
  assert.ok(end > start, `Missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

function normalizeEol(source) {
  return String(source).replaceAll("\r\n", "\n");
}

function hexToRgb(hex) {
  const value = hex.replace("#", "");
  return [0, 2, 4].map((index) => Number.parseInt(value.slice(index, index + 2), 16));
}

function relativeLuminance(hex) {
  const channels = hexToRgb(hex).map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(foreground, background) {
  const first = relativeLuminance(foreground);
  const second = relativeLuminance(background);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

function cssToken(source, name) {
  const match = source.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, "iu"));
  assert.ok(match, `Missing CSS token --${name}`);
  return match[1];
}

const appSource = readProjectFile("app.js");
const indexSource = readProjectFile("index.html");
const stateSource = readProjectFile("js/state.js");
const utilsSource = readProjectFile("js/utils.js");
const uiCasesSource = readProjectFile("js/ui-cases.js");
const uiReceptionSource = readProjectFile("js/ui-reception.js");
const versionSource = readProjectFile("js/version.js");
const estimateImportSource = readProjectFile("js/estimate-import.js");
const offlineSource = readProjectFile("offline.html");
const styleSource = readProjectFile("styles.css");
const swSource = readProjectFile("sw.js");

const results = [];
const failures = [];

function check(name, callback) {
  try {
    callback();
    results.push(name);
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push({ name, error });
    const conciseMessage = String(error.message || error).split(/Input:\s*$/mu)[0].trim();
    console.log(`FAIL ${name}: ${conciseMessage}`);
  }
}

check("A Release and schema remain exact", () => {
  assert.match(versionSource, /^window\.APP_VERSION = "v23\.3\.18";$/mu);
  assert.match(versionSource, /^window\.NIMR_BUILD = "v23\.3\.18";$/mu);
  assert.match(versionSource, /^window\.NIMR_CACHE_NAME = "nimr-sav-v23\.3\.18";$/mu);
  assert.match(stateSource, /^const APP_VERSION = "v23\.3\.18";$/mu);
  assert.match(stateSource, /^const DB_VERSION = 2;$/mu);
  assert.match(stateSource, /^const CURRENT_DATA_SCHEMA_VERSION = 2;$/mu);
  assert.match(stateSource, /^const CANONICAL_TASK_MODEL_VERSION = 1;$/mu);
  assert.match(swSource, /^const CACHE_NAME = "nimr-sav-v23\.3\.18";$/mu);
  assert.match(appSource, /pdf\.worker\.min\.js\?v=23\.3\.18/u);
  assert.match(appSource, /sw\.js\?v=23\.3\.18/u);
  assert.match(indexSource, /styles\.css\?v=23\.3\.18/u);
  assert.match(indexSource, /app\.js\?v=23\.3\.18/u);
  assert.match(offlineSource, /styles\.css\?v=23\.3\.18/u);
  assert.match(estimateImportSource, /pdf\.worker\.min\.js\?v=23\.3\.18/u);
  assert.doesNotMatch([appSource, indexSource, stateSource, versionSource, swSource].join("\n"), /23\.3\.16/u);
});

check("B Global focus-visible contract is explicit", () => {
  assert.match(styleSource, /button:focus-visible,[\s\S]*?a:focus-visible,[\s\S]*?input:focus-visible,[\s\S]*?textarea:focus-visible,[\s\S]*?select:focus-visible,[\s\S]*?\[tabindex\]:focus-visible/u);
  for (const selector of [".nav-button", ".case-card", ".today-card", ".sav-kpi-card", ".funnel-step-btn", ".settings-workspace-tab", ".case-subtab", ".technician-task-title"]) {
    assert.match(styleSource, new RegExp(`${selector.replaceAll(".", "\\.")}:focus-visible`, "u"));
  }
  assert.match(styleSource, /outline:\s*3px solid #0b63ce/u);
  assert.doesNotMatch(styleSource, /\*:focus\s*\{[^}]*outline:\s*(?:none|0)/u);
});

check("C Reduced motion removes non-essential movement", () => {
  const start = styleSource.lastIndexOf("@media (prefers-reduced-motion: reduce)");
  const end = styleSource.indexOf("@media (forced-colors: active)", start);
  assert.ok(start >= 0 && end > start);
  const contract = styleSource.slice(start, end);
  assert.match(contract, /animation:\s*none\s*!important/u);
  assert.match(contract, /transition:\s*none\s*!important/u);
  assert.match(contract, /transform:\s*none\s*!important/u);
  assert.match(contract, /scroll-behavior:\s*auto\s*!important/u);
});

check("D Semantic normal-text contrast meets WCAG AA", () => {
  const semanticTokens = ["accent-text", "ok-text", "warn-text"];
  for (const token of semanticTokens) {
    assert.ok(contrastRatio(cssToken(styleSource, token), "#ffffff") >= 4.5, `${token} must reach 4.5:1 on white`);
  }
  assert.match(styleSource, /\.eyebrow\s*\{[^}]*color:\s*var\(--accent-text\)/u);
  assert.match(styleSource, /\.sync-item b\[data-state="ok"\][\s\S]*?color:\s*var\(--ok-text\)/u);
  assert.match(styleSource, /\.sync-item b\[data-state="warn"\][\s\S]*?color:\s*var\(--warn-text\)/u);
  assert.doesNotMatch(styleSource, /^\s*color:\s*(?:var\(--(?:accent|ok|warn)\)|#(?:d97706|059669|f59e0b))\s*;/imu);
  assert.ok(contrastRatio("#991b1b", "#fee2e2") >= 4.5);
  assert.ok(contrastRatio("#9a3412", "#ffedd5") >= 4.5);
  assert.ok(contrastRatio("#1e40af", "#dbeafe") >= 4.5);
  assert.ok(contrastRatio("#075985", "#e0f2fe") >= 4.5);
  assert.ok(contrastRatio("#166534", "#dcfce7") >= 4.5);
});

check("E Actionable touch targets retain a 44px baseline", () => {
  assert.match(styleSource, /\.mobile-menu-btn\s*\{[\s\S]*?min-width:\s*44px;[\s\S]*?min-height:\s*44px;/u);
  assert.match(styleSource, /\.sidebar-change-user-button\s*\{[\s\S]*?min-width:\s*44px;[\s\S]*?min-height:\s*44px;/u);
  assert.match(styleSource, /\.sync-cloud-action\s*\{[\s\S]*?min-width:\s*44px;[\s\S]*?min-height:\s*44px;/u);
  assert.match(styleSource, /\.conflict-action-button\s*\{[\s\S]*?min-height:\s*44px;/u);
  assert.match(styleSource, /\.case-subtab\s*\{[\s\S]*?min-height:\s*44px;/u);
  const passiveBadges = sourceSlice(styleSource, ".severity-badge,", ".priority-card-action");
  assert.doesNotMatch(passiveBadges, /min-height:\s*44px/u);
});

check("F Shared custom modal has dialog and focus management", () => {
  assert.match(indexSource, /class="custom-modal-content"[^>]*role="dialog"[^>]*aria-modal="true"[^>]*aria-labelledby="custom-modal-title"[^>]*aria-describedby="custom-modal-body"/u);
  assert.match(stateSource, /function openAccessibleCustomModal\(/u);
  assert.match(stateSource, /function closeAccessibleCustomModal\(/u);
  assert.match(stateSource, /customModalReturnFocus\s*=\s*activeElement/u);
  assert.match(stateSource, /returnTarget\.isConnected\s*!==\s*false/u);
  assert.match(stateSource, /trapFocusWithin\(dialog, event\)/u);
  assert.match(stateSource, /event\.key === "Escape"[\s\S]*?onCancel\(\)/u);
  assert.match(stateSource, /appShell\?\.setAttribute\?\.\("inert", ""\)/u);
  assert.match(stateSource, /openAccessibleCustomModal\(\{ initialFocus: cancelBtn, onCancel \}\)/u);
  assert.match(uiReceptionSource, /openAccessibleCustomModal\(\{ initialFocus: input, onCancel \}\)/u);
});

check("G Mobile navigation exposes and synchronizes ARIA state", () => {
  assert.match(indexSource, /id="mobile-menu-toggle"[^>]*aria-label="Ouvrir la navigation principale"[^>]*aria-expanded="false"[^>]*aria-controls="primary-sidebar"/u);
  assert.match(indexSource, /<aside class="sidebar" id="primary-sidebar">/u);
  assert.doesNotMatch(indexSource, /id="mobile-menu-toggle"[^>]*style=/u);
  assert.match(appSource, /toggleBtn\.setAttribute\("aria-expanded", expanded \? "true" : "false"\)/u);
  assert.match(appSource, /event\.key !== "Escape"/u);
  assert.match(appSource, /setMenuState\(false, \{ restoreFocus: true \}\)/u);
  assert.match(appSource, /sidebar\.toggleAttribute\("inert", !expanded\)/u);
  assert.match(styleSource, /\.mobile-menu-btn\s*\{[\s\S]*?min-height:\s*44px/u);
});

check("H Navigation and skip-link semantics remain synchronized", () => {
  assert.equal((indexSource.match(/<a class="skip-link" href="#main-content">/gu) || []).length, 1);
  assert.equal((indexSource.match(/<main id="main-content" tabindex="-1">/gu) || []).length, 1);
  assert.match(styleSource, /\.skip-link\s*\{[\s\S]*?z-index:\s*2000/u);
  assert.match(styleSource, /\.skip-link:focus,[\s\S]*?transform:\s*translateY\(0\)/u);
  assert.match(utilsSource, /if \(active\) button\.setAttribute\("aria-current", "page"\);\s*else button\.removeAttribute\("aria-current"\);/u);
});

check("I Critical status meaning is not color-only", () => {
  assert.match(uiCasesSource, /severityLabel:\s*"CRITIQUE"/u);
  assert.match(uiCasesSource, /severityLabel:\s*"ÉLEVÉ"/u);
  assert.match(uiCasesSource, /severityLabel:\s*"MOYEN"/u);
  assert.match(uiCasesSource, /escapeHtml\(alert\.severityLabel \|\| "ALERTE"\)/u);
  assert.match(uiCasesSource, /escapeHtml\(row\.statusLabel\)/u);
  assert.match(uiCasesSource, /<small class="task-status-pill">/u);
  assert.match(styleSource, /\.form-error-summary:not\(\[hidden\]\)::before\s*\{[\s\S]*?content:\s*"Erreur : "/u);
});

check("J Protected behavior and UX-007 metrics remain unchanged", () => {
  for (const protectedFile of ["js/planning.js", "js/supabase-client.js", "js/supabase-sync.js", "js/supabase-config.js"]) {
    assert.equal(normalizeEol(readProjectFile(protectedFile)), normalizeEol(readBaseFile(protectedFile)), `${protectedFile} must remain content-identical to base`);
  }
  const baseState = readBaseFile("js/state.js");
  assert.equal(
    normalizeEol(sourceSlice(stateSource, "const DIRECTOR_PERMISSIONS", "const MUTATION_PERMISSIONS")),
    normalizeEol(sourceSlice(baseState, "const DIRECTOR_PERMISSIONS", "const MUTATION_PERMISSIONS")),
  );
  assert.equal(
    normalizeEol(sourceSlice(stateSource, "const ROLE_TABS", "const ROLE_DEFAULT_TABS")),
    normalizeEol(sourceSlice(baseState, "const ROLE_TABS", "const ROLE_DEFAULT_TABS")),
  );
  const baseUiCases = readBaseFile("js/ui-cases.js");
  assert.equal(
    normalizeEol(sourceSlice(uiCasesSource, "function buildSavKpis", "function renderSavDashboardLoads")),
    normalizeEol(sourceSlice(baseUiCases, "function buildSavKpis", "function renderSavDashboardLoads")),
  );
  assert.equal(
    normalizeEol(sourceSlice(uiCasesSource, "function buildDirectorDashboardSnapshot", "function buildSavPerformanceDashboard")),
    normalizeEol(sourceSlice(baseUiCases, "function buildDirectorDashboardSnapshot", "function buildSavPerformanceDashboard")),
  );
  const baseApp = readBaseFile("app.js");
  assert.equal(
    normalizeEol(sourceSlice(appSource, "function completeUserLogin", "let userSessionIdleTimer")),
    normalizeEol(sourceSlice(baseApp, "function completeUserLogin", "let userSessionIdleTimer")),
  );
});

check("K Responsive accessibility presentation contract is bounded", () => {
  assert.match(styleSource, /@media \(max-width:\s*768px\)[\s\S]*?\.sidebar\.active/u);
  assert.match(styleSource, /max-width:\s*calc\(100vw - 24px\)/u);
  assert.match(styleSource, /max-height:\s*calc\(100dvh - 24px\)/u);
  assert.match(styleSource, /@media \(forced-colors:\s*active\)/u);
  assert.match(styleSource, /@media print[\s\S]*?\.mobile-menu-btn/u);
  assert.match(uiCasesSource, /<button type="button" class="sav-kpi-card/u);
  assert.doesNotMatch(indexSource, /id="pilotage-alerts"[^>]*aria-live/u);
  assert.match(indexSource, /id="pilotage-priority-status"[^>]*role="status"[^>]*aria-live="polite"/u);
});

assert.equal(results.length + failures.length, 11, "UX-008 must contain exactly checks A-K");

if (failures.length) {
  console.error(`\nUX-008 REGRESSION SUITE: ${results.length}/11 CHECKS PASSED (${failures.length} FAILED)`);
  process.exitCode = 1;
} else {
  console.log("\nUX-008 REGRESSION SUITE: 11/11 CHECKS PASSED");
}

async function dispatchKey(send, sessionId, key, { code = key, shift = false } = {}) {
  const modifiers = shift ? 8 : 0;
  const virtualKeyCode = { Tab: 9, Enter: 13, Escape: 27, " ": 32 }[key] || 0;
  const keyParams = {
    key,
    code,
    modifiers,
    windowsVirtualKeyCode: virtualKeyCode,
    nativeVirtualKeyCode: virtualKeyCode,
  };
  const text = key === "Enter" ? "\r" : (key === " " ? " " : "");
  await send("Input.dispatchKeyEvent", {
    type: "keyDown",
    ...keyParams,
    ...(text ? { text, unmodifiedText: text } : {}),
  }, sessionId);
  await send("Input.dispatchKeyEvent", { type: "keyUp", ...keyParams }, sessionId);
}

async function runBrowserAccessibilitySmoke() {
  const { withBrowserPage } = await import("./helpers/cdp_browser_harness.mjs");
  const viewports = [
    { width: 375, height: 812 },
    { width: 430, height: 932 },
    { width: 768, height: 1024 },
    { width: 1366, height: 768 },
    { width: 1920, height: 1080 },
  ];

  return withBrowserPage(repoRoot, async ({ send, sessionId, findings, evaluate, waitFor }) => {
    await send("Emulation.setDeviceMetricsOverride", {
      width: 1366,
      height: 768,
      deviceScaleFactor: 1,
      mobile: false,
    }, sessionId);

    const fixture = await evaluate(`
      (async () => {
        const waitUntil = async (predicate, message) => {
          for (let attempt = 0; attempt < 80; attempt += 1) {
            if (predicate()) return;
            await new Promise((resolveWait) => setTimeout(resolveWait, 100));
          }
          throw new Error(message);
        };
        await waitUntil(() => typeof state !== "undefined" && Array.isArray(state.users), "state unavailable");
        const form = document.getElementById("first-access-form");
        const overlay = document.getElementById("first-access-overlay");
        if (form && overlay?.hidden === false) {
          const authUser = {
            id: "ux008-browser-admin",
            email: "ux008-browser@example.test",
            user_metadata: { name: "Admin UX-008" },
          };
          const membership = {
            workshop_id: "00000000-0000-0000-0000-000000000001",
            user_id: authUser.id,
            role: "admin_technique",
            resource_id: null,
          };
          window.authenticateSupabaseUser = async () => ({ ok: true, user: authUser, membership });
          window.getSupabaseUser = async () => authUser;
          window.resolveSupabaseWorkshopMembership = async () => ({ ok: true, membership });
          window.pullLatestSupabaseBackup = async () => ({ ok: true });
          window.startSupabaseLiveSync = async () => true;
          window.signOutSupabaseSession = async () => ({ ok: true });
          form.elements.email.value = authUser.email;
          form.elements.password.value = "Pass123456";
          form.requestSubmit();
          await waitUntil(
            () => state.currentUserId && document.getElementById("first-access-overlay")?.hidden !== false,
            "fixture login failed",
          );
        }
        const currentUser = state.users.find((user) => user?.id === state.currentUserId);
        if (!currentUser) throw new Error("authenticated fixture user unavailable");
        const fixtureCase = typeof normalizeCase === "function" ? normalizeCase({
          id: "ux008-browser-case",
          clientName: "Client accessibilité",
          vehicle: "NIMR UX-008",
          plate: "UX-008",
          flags: { received: true, workStarted: false, workCompleted: false, delivered: false },
          history: [],
          claims: [],
          supplements: [],
        }) : {
          id: "ux008-browser-case",
          clientName: "Client accessibilité",
          vehicle: "NIMR UX-008",
          plate: "UX-008",
          flags: { received: true },
          history: [],
          claims: [],
          supplements: [],
        };
        state.cases.splice(0, state.cases.length, fixtureCase);
        activeCaseId = fixtureCase.id;
        if (typeof render === "function") render();
        return { role: currentUser.role, caseId: fixtureCase.id };
      })()
    `);
    assert.equal(fixture.role, "admin_technique");
    assert.equal(fixture.caseId, "ux008-browser-case");

    await evaluate(`document.body.tabIndex = -1; document.body.focus(); location.hash = ""; true`);
    await dispatchKey(send, sessionId, "Tab", { code: "Tab" });
    assert.equal(await evaluate(`document.activeElement?.classList.contains("skip-link") === true`), true, "Tab must reach the skip link first");
    await evaluate(`document.body.removeAttribute("tabindex"); true`);
    await dispatchKey(send, sessionId, "Enter", { code: "Enter" });
    await waitFor(`document.activeElement?.id === "main-content" || location.hash === "#main-content"`);

    await evaluate(`document.querySelector('.nav-button[data-tab="dossiers"]')?.focus(); true`);
    const navBeforeKeyboard = await evaluate(`(() => {
      const button = document.querySelector('.nav-button[data-tab="dossiers"]');
      return {
        active: document.activeElement === button,
        disabled: button?.disabled,
        hidden: button?.hidden,
        appInert: document.querySelector('.app-shell')?.hasAttribute('inert'),
        current: button?.getAttribute('aria-current'),
      };
    })()`);
    assert.deepEqual(navBeforeKeyboard, { active: true, disabled: false, hidden: false, appInert: false, current: null });
    await dispatchKey(send, sessionId, "Enter", { code: "Enter" });
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    const navAfterKeyboard = await evaluate(`document.querySelector('.nav-button[data-tab="dossiers"]')?.getAttribute("aria-current")`);
    assert.equal(navAfterKeyboard, "page", `keyboard navigation did not activate Dossiers (${JSON.stringify(navBeforeKeyboard)})`);
    assert.equal(await evaluate(`document.querySelectorAll('.nav-button[aria-current="page"]').length`), 1);
    await evaluate(`document.querySelector('#case-list .case-card[data-case="ux008-browser-case"]')?.focus(); true`);
    await dispatchKey(send, sessionId, "Enter", { code: "Enter" });
    await waitFor(`activeCaseId === "ux008-browser-case"`);
    assert.equal(await evaluate(`document.getElementById('case-detail')?.textContent.includes('Client accessibilité') === true`), true);

    const focusStyle = await evaluate(`(() => {
      const element = document.querySelector('.nav-button[data-tab="dossiers"]');
      element.focus();
      const style = getComputedStyle(element);
      return { width: style.outlineWidth, style: style.outlineStyle, color: style.outlineColor };
    })()`);
    assert.notEqual(focusStyle.style, "none");
    assert.ok(Number.parseFloat(focusStyle.width) >= 3);

    await evaluate(`(() => {
      const trigger = document.querySelector('.nav-button[data-tab="dossiers"]');
      trigger.focus();
      window.__ux008ModalResult = null;
      showConfirmModal("Confirmer l’action accessible ?").then((value) => { window.__ux008ModalResult = value; });
      return true;
    })()`);
    await waitFor(`document.getElementById("custom-modal-overlay")?.hidden === false`);
    const dialogOpen = await evaluate(`(() => {
      const dialog = document.querySelector('#custom-modal-overlay [role="dialog"]');
      return {
        modal: dialog?.getAttribute("aria-modal"),
        labelledby: dialog?.getAttribute("aria-labelledby"),
        describedby: dialog?.getAttribute("aria-describedby"),
        initial: document.activeElement?.id,
        backgroundInert: document.querySelector('.app-shell')?.hasAttribute('inert'),
      };
    })()`);
    assert.deepEqual(dialogOpen, {
      modal: "true",
      labelledby: "custom-modal-title",
      describedby: "custom-modal-body",
      initial: "custom-modal-cancel",
      backgroundInert: true,
    });
    await dispatchKey(send, sessionId, "Tab", { code: "Tab" });
    assert.equal(await evaluate(`document.querySelector('#custom-modal-overlay [role="dialog"]')?.contains(document.activeElement)`), true);
    await dispatchKey(send, sessionId, "Tab", { code: "Tab", shift: true });
    assert.equal(await evaluate(`document.querySelector('#custom-modal-overlay [role="dialog"]')?.contains(document.activeElement)`), true);
    await dispatchKey(send, sessionId, "Escape", { code: "Escape" });
    await waitFor(`document.getElementById("custom-modal-overlay")?.hidden === true
      && window.__ux008ModalResult === false
      && document.activeElement?.matches('.nav-button[data-tab="dossiers"]') === true`);
    assert.equal(await evaluate(`document.activeElement?.matches('.nav-button[data-tab="dossiers"]') === true`), true, "modal must restore trigger focus");

    await evaluate(`setActiveTab("pilotage"); bindSavDashboardFilters(); renderDirectorDashboard(); true`);
    await waitFor(`document.querySelectorAll('.sav-kpi-card').length > 0`);
    const kpiTarget = await evaluate(`document.querySelector('.sav-kpi-card')?.dataset.navTab || ""`);
    await evaluate(`document.querySelector('.sav-kpi-card')?.focus(); true`);
    await dispatchKey(send, sessionId, "Enter", { code: "Enter" });
    await waitFor(`document.querySelector('.nav-button[aria-current="page"]')?.dataset.tab === ${JSON.stringify(kpiTarget)}`);

    const viewportResults = [];
    for (const viewport of viewports) {
      await send("Emulation.setDeviceMetricsOverride", {
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: 1,
        mobile: viewport.width <= 768,
      }, sessionId);
      await evaluate(`window.dispatchEvent(new Event("resize")); true`);
      await new Promise((resolveWait) => setTimeout(resolveWait, 100));
      const dimensions = await evaluate(`(() => ({
        innerWidth,
        innerHeight,
        scrollWidth: document.documentElement.scrollWidth,
        bodyScrollWidth: document.body.scrollWidth,
        modalMaxWidth: getComputedStyle(document.querySelector('.custom-modal-content')).maxWidth,
      }))()`);
      assert.ok(dimensions.scrollWidth <= dimensions.innerWidth, `${viewport.width}px document overflow`);
      assert.ok(dimensions.bodyScrollWidth <= dimensions.innerWidth, `${viewport.width}px body overflow`);
      viewportResults.push({ ...viewport, overflow: false });
    }

    await send("Emulation.setDeviceMetricsOverride", {
      width: 375,
      height: 812,
      deviceScaleFactor: 1,
      mobile: true,
    }, sessionId);
    await evaluate(`window.dispatchEvent(new Event("resize")); true`);
    await waitFor(`getComputedStyle(document.getElementById("mobile-menu-toggle")).display !== "none"`);
    await evaluate(`document.getElementById("mobile-menu-toggle").focus(); true`);
    await dispatchKey(send, sessionId, "Enter", { code: "Enter" });
    await waitFor(`document.getElementById("mobile-menu-toggle")?.getAttribute("aria-expanded") === "true"`);
    assert.equal(await evaluate(`document.getElementById("primary-sidebar")?.hasAttribute("inert")`), false);
    await dispatchKey(send, sessionId, "Escape", { code: "Escape" });
    await waitFor(`document.getElementById("mobile-menu-toggle")?.getAttribute("aria-expanded") === "false"`);
    assert.equal(await evaluate(`document.activeElement?.id`), "mobile-menu-toggle");

    await evaluate(`showConfirmModal("Fenêtre mobile accessible"); true`);
    await waitFor(`document.getElementById("custom-modal-overlay")?.hidden === false`);
    const modalBounds = await evaluate(`(() => {
      const rect = document.querySelector('.custom-modal-content').getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height };
    })()`);
    assert.ok(modalBounds.left >= 0 && modalBounds.right <= 375);
    assert.ok(modalBounds.top >= 0 && modalBounds.bottom <= 812);
    await dispatchKey(send, sessionId, "Escape", { code: "Escape" });

    await send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "reduce" }],
    }, sessionId);
    const reducedMotion = await evaluate(`(() => {
      const element = document.querySelector('.nav-button');
      const style = getComputedStyle(element);
      return {
        matches: matchMedia('(prefers-reduced-motion: reduce)').matches,
        transitionDuration: style.transitionDuration,
        animationName: style.animationName,
      };
    })()`);
    assert.equal(reducedMotion.matches, true);
    assert.equal(reducedMotion.transitionDuration, "0s");
    assert.equal(reducedMotion.animationName, "none");

    const consoleErrors = findings.filter((finding) => String(finding.text || "").trim());
    const fixtureAuthNoise = consoleErrors.filter((finding) => /Failed to load resource: the server responded with a status of 401/iu.test(finding.text));
    const ux008ConsoleErrors = consoleErrors.filter((finding) => !fixtureAuthNoise.includes(finding));
    assert.deepEqual(ux008ConsoleErrors, []);
    return {
      keyboard: "PASS",
      skipLink: "PASS",
      dossier: "PASS",
      modalFocusTrap: "PASS",
      modalFocusRestoration: "PASS",
      dashboardKpi: "PASS",
      mobileMenu: "PASS",
      reducedMotion: "PASS",
      focusIndicator: focusStyle,
      viewportResults,
      consoleErrorsCausedByUx008: 0,
      ignoredFixtureAuth401: fixtureAuthNoise.length,
    };
  });
}

if (browserSmokeRequested && !sourceRef && failures.length === 0) {
  try {
    const browserResult = await runBrowserAccessibilitySmoke();
    console.log("\nUX-008 BROWSER ACCESSIBILITY: PASS");
    console.log(JSON.stringify(browserResult, null, 2));
  } catch (error) {
    console.error(`\nUX-008 BROWSER ACCESSIBILITY: FAIL\n${error.stack || error.message}`);
    process.exitCode = 1;
  }
}
