import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";

const root = resolve(process.cwd());
const serverPort = Number(process.env.NIMR_STARTUP_TEST_PORT || 8791);
const cdpPort = Number(process.env.NIMR_STARTUP_CDP_PORT || 9241);
const baseUrl = process.env.NIMR_STARTUP_TEST_URL || `http://127.0.0.1:${serverPort}/`;
const chromePath = process.env.CHROME_PATH || [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((candidate) => existsSync(candidate));

const expectedCleanupError = /Inspected target navigated or closed/i;
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

function wait(ms) {
  return new Promise((resolveWait) => setTimeout(resolveWait, ms));
}

function startStaticServer() {
  if (process.env.NIMR_STARTUP_TEST_URL) return Promise.resolve(null);
  const server = createServer(async (request, response) => {
    const url = new URL(request.url || "/", `http://127.0.0.1:${serverPort}`);
    const pathname = decodeURIComponent(url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, ""));
    const filePath = resolve(join(root, pathname));
    if (!filePath.startsWith(root)) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    try {
      const body = await readFile(filePath);
      response.writeHead(200, { "Content-Type": mime[extname(filePath)] || "application/octet-stream" });
      response.end(body);
    } catch {
      response.writeHead(404).end("Not found");
    }
  });
  return new Promise((resolveServer) => server.listen(serverPort, "127.0.0.1", () => resolveServer(server)));
}

async function waitForCdp() {
  const endpoint = `http://127.0.0.1:${cdpPort}/json/version`;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(endpoint);
      if (response.ok) return response.json();
    } catch {
      // Chrome is still starting.
    }
    await wait(250);
  }
  throw new Error("Chrome DevTools Protocol indisponible.");
}

function createCdpClient(socket, findings, isCleanupStarted) {
  const pending = new Map();
  let nextId = 1;

  const onMessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const entry = pending.get(message.id);
      pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.error) {
        const error = new Error(message.error.message || "CDP error");
        if (isCleanupStarted() && expectedCleanupError.test(error.message)) entry.resolve({});
        else entry.reject(error);
      } else {
        entry.resolve(message.result || {});
      }
      return;
    }

    if (isCleanupStarted()) return;
    const params = message.params || {};
    if (message.method === "Log.entryAdded") {
      const log = params.entry || {};
      if (log.level === "error") findings.push({ type: "console.error", text: log.text || "" });
    }
    if (message.method === "Runtime.exceptionThrown") {
      findings.push({
        type: "pageerror",
        text: params.exceptionDetails?.exception?.description || params.exceptionDetails?.text || "",
      });
    }
    if (message.method === "Runtime.consoleAPICalled" && params.type === "error") {
      const text = (params.args || []).map((arg) => arg.value || arg.description || "").join(" ");
      findings.push({ type: "console.error", text });
    }
  };

  socket.addEventListener("message", onMessage);

  const send = (method, params = {}, sessionId) => {
    const id = nextId++;
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return new Promise((resolveSend, rejectSend) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        rejectSend(new Error(`CDP timeout: ${method}`));
      }, 12000);
      pending.set(id, { resolve: resolveSend, reject: rejectSend, timer });
    });
  };

  const detach = () => {
    socket.removeEventListener("message", onMessage);
    pending.forEach((entry) => {
      clearTimeout(entry.timer);
      entry.resolve({});
    });
    pending.clear();
  };

  return { send, detach };
}

async function navigateAndWait(send, sessionId, url) {
  await send("Page.navigate", { url }, sessionId);
  await wait(2500);
}

async function evaluate(send, sessionId, expression) {
  const result = await send("Runtime.evaluate", {
    awaitPromise: true,
    returnByValue: true,
    expression,
  }, sessionId);
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "Runtime.evaluate failed");
  }
  return result.result?.value;
}

async function exerciseApplication(send, sessionId, label) {
  return evaluate(send, sessionId, `
    (async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
      if (typeof getCaseStatus !== "function") throw new Error("getCaseStatus is not defined");
      if (typeof normalizeCaseStatusFilter !== "function") throw new Error("normalizeCaseStatusFilter is not defined");
      if (typeof guardSensitiveAction !== "function") throw new Error("guardSensitiveAction is not defined");
      if (typeof renderCaseDetail !== "function") throw new Error("renderCaseDetail is not defined");
      if (typeof setActiveTab === "function") setActiveTab("dossiers");
      if (typeof renderCases === "function") renderCases();
      const firstCase = document.querySelector("[data-case]");
      if (firstCase) firstCase.click();
      renderCaseDetail();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const caseStatus = typeof state !== "undefined" && state.cases?.[0] ? getCaseStatus(state.cases[0]) : "unknown";
      const visibleText = document.body.innerText || "";
      const removedVisible = [
        "Contrôle Qualité",
        "Contrôle qualité, livraison",
        "Livraison & Clôture",
        "Accord expert",
        "Validation client/interne",
        "Dossier Facturé",
        "PV DE RESTITUTION",
        "Paiement",
        "Montant",
        " PU "
      ].filter((text) => visibleText.includes(text));
      const qcButton = document.querySelector('[data-tab="qc-workspace"]');
      const livraisonTab = document.querySelector('[data-case-tab="livraison"]');
      if (removedVisible.length) throw new Error("Legacy UI visible: " + removedVisible.join(", "));
      if (qcButton && qcButton.offsetParent !== null) throw new Error("QC workspace tab is visible");
      if (livraisonTab && livraisonTab.offsetParent !== null) throw new Error("Legacy livraison case tab is visible");
      return {
        label: ${JSON.stringify(label)},
        caseStatus,
        activeView: document.querySelector(".view:not([hidden])")?.id || "",
        visibleLength: visibleText.length
      };
    })()
  `);
}

async function clearBrowserData(send, sessionId) {
  await evaluate(send, sessionId, `
    (async () => {
      localStorage.clear();
      sessionStorage.clear();
      if (window.caches?.keys) {
        await Promise.all((await caches.keys()).map((key) => caches.delete(key)));
      }
      if (navigator.serviceWorker?.getRegistrations) {
        await Promise.all((await navigator.serviceWorker.getRegistrations()).map((registration) => registration.unregister()));
      }
      return true;
    })()
  `);
}

async function main() {
  if (!chromePath) {
    console.log("startup_browser_console skipped: Chrome/Edge introuvable.");
    return;
  }

  const server = await startStaticServer();
  const profile = join(tmpdir(), `nimr-startup-browser-console-${Date.now()}`);
  const chrome = spawn(chromePath, [
    "--headless=new",
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${profile}`,
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "about:blank",
  ], { stdio: "ignore" });

  const findings = [];
  let cleanupStarted = false;
  let socket;
  let client;

  try {
    const version = await waitForCdp();
    socket = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((resolveOpen, rejectOpen) => {
      socket.addEventListener("open", resolveOpen, { once: true });
      socket.addEventListener("error", rejectOpen, { once: true });
    });
    client = createCdpClient(socket, findings, () => cleanupStarted);
    const { send } = client;
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    await send("Log.enable", {}, sessionId);
    await send("Runtime.enable", {}, sessionId);
    await send("Page.enable", {}, sessionId);

    await navigateAndWait(send, sessionId, `${baseUrl}?startup-cleanup=1`);
    await clearBrowserData(send, sessionId);

    await navigateAndWait(send, sessionId, `${baseUrl}?startup-empty=${Date.now()}`);
    const emptyRun = await exerciseApplication(send, sessionId, "empty-storage");

    await evaluate(send, sessionId, `
      (() => {
        if (typeof saveState === "function") saveState();
        localStorage.setItem("nimr-startup-existing-storage", "true");
        return true;
      })()
    `);

    await navigateAndWait(send, sessionId, `${baseUrl}?startup-existing=${Date.now()}`);
    const existingRun = await exerciseApplication(send, sessionId, "existing-storage");

    const realErrors = findings.filter((finding) => String(finding.text || "").trim());
    const forbidden = realErrors.filter((finding) => /ReferenceError|TypeError|Cannot set properties of null|is not defined|./i.test(finding.text));
    if (forbidden.length) {
      throw new Error(`Startup browser console errors: ${JSON.stringify(forbidden, null, 2)}`);
    }

    console.log(`OK / errors: 0`);
    console.log(JSON.stringify({ emptyRun, existingRun }, null, 2));
  } finally {
    cleanupStarted = true;
    client?.detach();
    try { socket?.close?.(); } catch (error) {
      if (!expectedCleanupError.test(String(error?.message || error))) throw error;
    }
    chrome.kill();
    server?.close?.();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
