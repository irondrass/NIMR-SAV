import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";

const root = resolve(process.cwd());
const defaultPort = Number(process.env.NIMR_MOBILE_TEST_PORT || 8788);
const baseUrl = process.env.NIMR_MOBILE_TEST_URL || `http://127.0.0.1:${defaultPort}/`;
const viewports = [
  { width: 320, height: 740 },
  { width: 375, height: 812 },
  { width: 390, height: 844 },
  { width: 414, height: 896 },
  { width: 768, height: 1024 },
];
const chromePath = process.env.CHROME_PATH || [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((candidate) => existsSync(candidate));

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

function startStaticServer() {
  if (process.env.NIMR_MOBILE_TEST_URL) return Promise.resolve(null);
  const server = createServer(async (request, response) => {
    const url = new URL(request.url || "/", `http://127.0.0.1:${defaultPort}`);
    const pathname = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
    const filePath = resolve(join(root, pathname));
    if (!filePath.startsWith(root)) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    try {
      const body = await readFile(filePath);
      response.writeHead(200, { "Content-Type": mime[extname(filePath)] || "application/octet-stream" });
      response.end(body);
    } catch (error) {
      response.writeHead(404).end("Not found");
    }
  });
  return new Promise((resolveServer) => server.listen(defaultPort, "127.0.0.1", () => resolveServer(server)));
}

function wait(ms) {
  return new Promise((resolveWait) => setTimeout(resolveWait, ms));
}

async function waitForCdp(port) {
  const endpoint = `http://127.0.0.1:${port}/json/version`;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(endpoint);
      if (response.ok) return response.json();
    } catch (error) {
      // Browser is still starting.
    }
    await wait(250);
  }
  throw new Error("Chrome DevTools Protocol indisponible.");
}

async function main() {
  if (!chromePath) {
    console.log("Mobile responsive smoke skipped: Chrome/Edge introuvable.");
    return;
  }

  const server = await startStaticServer();
  const port = Number(process.env.NIMR_MOBILE_CDP_PORT || 9236);
  const profile = join(tmpdir(), `nimr-mobile-smoke-${Date.now()}`);
  const chrome = spawn(chromePath, [
    "--headless=new",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "about:blank",
  ], { stdio: "ignore" });

  const pending = new Map();
  const findings = [];
  let nextId = 1;
  let socket;
  const send = (method, params = {}, sessionId) => {
    const id = nextId += 1;
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return new Promise((resolveSend, rejectSend) => {
      pending.set(id, { resolve: resolveSend, reject: rejectSend });
      setTimeout(() => rejectSend(new Error(`CDP timeout: ${method}`)), 10000);
    });
  };

  try {
    const version = await waitForCdp(port);
    socket = new WebSocket(version.webSocketDebuggerUrl);
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id && pending.has(message.id)) {
        const { resolve: resolveSend, reject: rejectSend } = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) rejectSend(new Error(message.error.message));
        else resolveSend(message.result || {});
        return;
      }
      const params = message.params || {};
      if (message.method === "Log.entryAdded") {
        const entry = params.entry || {};
        if (["error", "warning"].includes(entry.level)) findings.push({ type: "log", level: entry.level, text: entry.text || "" });
      }
      if (message.method === "Runtime.exceptionThrown") {
        findings.push({ type: "exception", level: "error", text: params.exceptionDetails?.exception?.description || params.exceptionDetails?.text || "" });
      }
      if (message.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(params.type)) {
        const text = (params.args || []).map((arg) => arg.value || arg.description || "").join(" ");
        findings.push({ type: "console", level: params.type, text });
      }
    });
    await new Promise((resolveOpen, rejectOpen) => {
      socket.addEventListener("open", resolveOpen, { once: true });
      socket.addEventListener("error", rejectOpen, { once: true });
    });

    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    await send("Log.enable", {}, sessionId);
    await send("Runtime.enable", {}, sessionId);
    await send("Page.enable", {}, sessionId);

    const results = [];
    for (const viewport of viewports) {
      await send("Emulation.setDeviceMetricsOverride", {
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: 1,
        mobile: viewport.width <= 520,
      }, sessionId);
      await send("Page.navigate", { url: `${baseUrl}?mobile-smoke=22.27-${viewport.width}x${viewport.height}` }, sessionId);
      await wait(2800);
      const evaluation = await send("Runtime.evaluate", {
        awaitPromise: true,
        returnByValue: true,
        expression: `(${String(async function runResponsiveChecks(viewport) {
          const waitFrame = () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 40)));
          const rectFor = (selector) => document.querySelector(selector)?.getBoundingClientRect?.();
          const isVisible = (selector) => {
            const rect = rectFor(selector);
            const style = document.querySelector(selector) ? getComputedStyle(document.querySelector(selector)) : null;
            return Boolean(rect && rect.width > 0 && rect.height > 0 && style?.display !== "none" && style?.visibility !== "hidden");
          };
          const clickTab = async (tab) => {
            document.querySelector('[data-tab="' + tab + '"]')?.click();
            await waitFrame();
          };

          await waitFrame();
          const html = document.documentElement;
          const body = document.body;
          const sidebar = document.querySelector(".sidebar");
          const sidebarRect = sidebar?.getBoundingClientRect?.();
          const sidebarStyle = sidebar ? getComputedStyle(sidebar) : null;
          const navBottomLimit = sidebarStyle?.position === "fixed" ? sidebarRect.top : window.innerHeight;

          const createButton = document.querySelector("#case-form button[type='submit']");
          createButton?.scrollIntoView({ block: "end" });
          await waitFrame();
          const createRect = createButton?.getBoundingClientRect?.();
          const createButtonVisible = Boolean(createRect && createRect.top >= -2 && createRect.bottom <= navBottomLimit + 2);

          await clickTab("today");
          const todayVisible = isVisible("#view-today") && isVisible(".today-panel");
          await clickTab("technician");
          const technicianVisible = isVisible("#view-technician") && isVisible("#technician-task-list");
          const probe = document.createElement("div");
          probe.className = "technician-task-actions";
          probe.innerHTML = '<button class="primary-button tiny-button" type="button">Démarrer</button><button class="ghost-button tiny-button" type="button">Pause</button>';
          document.body.appendChild(probe);
          const actionHeights = [...probe.querySelectorAll("button")].map((button) => button.getBoundingClientRect().height);
          probe.remove();
          await clickTab("planning");
          const planningVisible = isVisible("#view-planning");
          const mobilePlanningListVisible = viewport.width <= 520 ? isVisible("#mobile-planning-list") : true;
          const ganttHiddenOnPhone = viewport.width <= 520 ? getComputedStyle(document.querySelector("#gantt")).display === "none" : true;

          const lockOverlay = document.querySelector("#local-lock-overlay");
          let pinDialogFits = true;
          if (lockOverlay) {
            const wasHidden = lockOverlay.hidden;
            lockOverlay.hidden = false;
            await waitFrame();
            const dialogRect = lockOverlay.querySelector(".local-lock-dialog")?.getBoundingClientRect?.();
            pinDialogFits = Boolean(dialogRect && dialogRect.width <= window.innerWidth + 1 && dialogRect.height <= window.innerHeight + 1 && dialogRect.left >= -1 && dialogRect.right <= window.innerWidth + 1);
            lockOverlay.hidden = wasHidden;
          }
          const overflowCandidates = [...document.querySelectorAll("body *")]
            .map((element) => {
              const rect = element.getBoundingClientRect();
              return { tag: element.tagName, className: String(element.className || ""), id: element.id || "", left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width) };
            })
            .filter((entry) => entry.right > window.innerWidth + 2 || entry.left < -2)
            .slice(0, 6);

          return {
            viewport,
            innerWidth: window.innerWidth,
            scrollWidth: Math.max(html.scrollWidth, body.scrollWidth),
            overflowCandidates,
            navigationVisible: isVisible(".sidebar-nav"),
            noHorizontalOverflow: html.scrollWidth <= window.innerWidth + 2 && body.scrollWidth <= window.innerWidth + 2,
            createButtonVisible,
            todayVisible,
            technicianVisible,
            technicianActionsMin44: actionHeights.length > 0 && actionHeights.every((height) => height >= 44),
            planningVisible,
            mobilePlanningListVisible,
            ganttHiddenOnPhone,
            pinDialogFits,
          };
        })})(${JSON.stringify(viewport)})`,
      }, sessionId);
      const result = evaluation.result?.value;
      results.push(result);
      assert.equal(result.navigationVisible, true, `navigation invisible en ${viewport.width}x${viewport.height}`);
      assert.equal(result.noHorizontalOverflow, true, `overflow horizontal global en ${viewport.width}x${viewport.height}: ${JSON.stringify({ innerWidth: result.innerWidth, scrollWidth: result.scrollWidth, overflowCandidates: result.overflowCandidates })}`);
      assert.equal(result.createButtonVisible, true, `bouton créer dossier coupé en ${viewport.width}x${viewport.height}`);
      assert.equal(result.todayVisible, true, `vue Aujourd'hui non lisible en ${viewport.width}x${viewport.height}`);
      assert.equal(result.technicianVisible, true, `vue Technicien inaccessible en ${viewport.width}x${viewport.height}`);
      assert.equal(result.technicianActionsMin44, true, `actions Technicien < 44px en ${viewport.width}x${viewport.height}`);
      assert.equal(result.planningVisible, true, `planning inaccessible en ${viewport.width}x${viewport.height}`);
      assert.equal(result.mobilePlanningListVisible, true, `liste planning mobile absente en ${viewport.width}x${viewport.height}`);
      assert.equal(result.ganttHiddenOnPhone, true, `Gantt forcé sur smartphone en ${viewport.width}x${viewport.height}`);
      assert.equal(result.pinDialogFits, true, `modal PIN coupée en ${viewport.width}x${viewport.height}`);
    }

    const critical = findings.filter((item) => /ReferenceError|TypeError|SyntaxError|Content Security Policy|violates.*connect-src|bindLocalSecurityControls|initLocalSecurityGate/i.test(item.text));
    console.log(JSON.stringify({ results, critical, findingsCount: findings.length }, null, 2));
    assert.equal(critical.length, 0, "erreur console critique pendant le smoke responsive mobile");
    await send("Target.closeTarget", { targetId }).catch(() => null);
  } finally {
    socket?.close?.();
    chrome.kill();
    server?.close?.();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
