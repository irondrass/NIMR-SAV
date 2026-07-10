import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";

const root = resolve(process.cwd());
const defaultPort = Number(process.env.NIMR_STARTUP_BROWSER_PORT || 8788);
const origin = process.env.NIMR_STARTUP_BROWSER_ORIGIN || `http://127.0.0.1:${defaultPort}`;
const targetUrl = process.env.NIMR_STARTUP_BROWSER_URL || `${origin}/?startup-browser-console=23.2.7-hotfix-startup`;
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
  if (process.env.NIMR_STARTUP_BROWSER_URL) return Promise.resolve(null);
  const server = createServer(async (request, response) => {
    const url = new URL(request.url || "/", origin);
    const pathname = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
    const path = resolve(join(root, pathname));
    if (!path.startsWith(root)) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    try {
      const body = await readFile(path);
      response.writeHead(200, {
        "Content-Type": mime[extname(path)] || "application/octet-stream",
        "Cache-Control": "no-store",
      });
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
  for (let attempt = 0; attempt < 40; attempt += 1) {
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

function isCriticalConsoleText(text) {
  return /ReferenceError|TypeError|Cannot set properties of null|is not defined|Uncaught/i.test(String(text || ""));
}

async function main() {
  if (!chromePath) {
    throw new Error("Chrome/Edge introuvable: le test navigateur startup ne peut pas garantir zéro erreur console.");
  }

  const server = await startStaticServer();
  const port = Number(process.env.NIMR_STARTUP_CDP_PORT || 9236);
  const profile = join(tmpdir(), `nimr-startup-browser-${Date.now()}`);
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
    const id = nextId++;
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return new Promise((resolveSend, rejectSend) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        rejectSend(new Error(`CDP timeout: ${method}`));
      }, 15000);
      pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolveSend(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          rejectSend(error);
        },
      });
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
      if (message.method === "Log.entryAdded") {
        const entry = params.entry || {};
        if (entry.level === "error" && isCriticalConsoleText(entry.text)) {
          findings.push({ type: "log.error", text: entry.text || "" });
        }
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

    const evaluate = async (expression) => {
      const result = await send("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
      }, sessionId);
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "Runtime.evaluate failed");
      }
      return result.result?.value;
    };

    const navigate = async (url) => {
      await send("Page.navigate", { url }, sessionId);
      for (let attempt = 0; attempt < 80; attempt += 1) {
        const readyState = await evaluate("document.readyState");
        if (readyState === "complete") return;
        await wait(125);
      }
      throw new Error(`Chargement incomplet: ${url}`);
    };

    await navigate(`${origin}/?startup-browser-console-clean=1`);
    await evaluate(`(async () => {
      localStorage.clear();
      sessionStorage.clear();
      if ("serviceWorker" in navigator && navigator.serviceWorker.getRegistrations) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((registration) => registration.unregister()));
      }
      if ("caches" in window && caches.keys) {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => caches.delete(key)));
      }
      return true;
    })()`);

    findings.length = 0;
    await navigate(targetUrl);
    await wait(1500);

    const pageState = await evaluate(`(async () => {
      const requiredHelpers = [
        "normalizeCaseStatusFilter",
        "guardSensitiveAction",
        "isCaseReadonlyArchive",
        "getCaseStatus",
        "normalizePlanningRole",
        "isLegacyPlanningEntry",
        "isAnticipatedPartsPreparation",
        "safeQuerySelector",
        "setHtmlIfExists",
        "setTextIfExists",
        "bindIfExists",
      ];
      const helperTypes = Object.fromEntries(requiredHelpers.map((name) => [name, typeof window[name]]));
      if (typeof setActiveTab === "function") setActiveTab("dossiers");
      if (Array.isArray(state?.cases) && state.cases[0]) activeCaseId = state.cases[0].id;
      if (typeof renderCases === "function") renderCases();
      if (typeof renderCaseDetail === "function") renderCaseDetail();
      await new Promise((resolve) => setTimeout(resolve, 100));
      return {
        helperTypes,
        activeCaseId: typeof activeCaseId !== "undefined" ? activeCaseId : null,
        caseDetailText: document.querySelector("#case-detail")?.textContent?.slice(0, 400) || "",
        caseDetailHasContent: Boolean(document.querySelector("#case-detail")?.children?.length),
        currentBuild: window.NIMR_BUILD || "",
        cacheName: window.NIMR_CACHE_NAME || "",
      };
    })()`);

    for (const [helper, type] of Object.entries(pageState.helperTypes || {})) {
      assert.equal(type, "function", `${helper} doit être disponible dans le vrai navigateur`);
    }
    assert.equal(pageState.caseDetailHasContent, true, "renderCaseDetail doit afficher un contenu sans planter");
    assert.match(pageState.currentBuild, /23\.2\.7-hotfix-startup/, "le navigateur doit charger la version hotfix");
    assert.match(pageState.cacheName, /23\.2\.7-hotfix-startup/, "le cache PWA doit être bumpé");

    const critical = findings.filter((finding) => finding.type === "pageerror" || finding.type === "console.error" || isCriticalConsoleText(finding.text));
    if (critical.length) {
      throw new Error(`Erreurs console au démarrage:\n${critical.map((finding) => `[${finding.type}] ${finding.text}`).join("\n")}`);
    }

    console.log(JSON.stringify({ targetUrl, activeCaseId: pageState.activeCaseId, build: pageState.currentBuild, errors: critical.length }, null, 2));
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
