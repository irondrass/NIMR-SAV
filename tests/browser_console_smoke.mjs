import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";

const root = resolve(process.cwd());
const defaultPort = Number(process.env.NIMR_BROWSER_TEST_PORT || 8787);
const targetUrl = process.env.NIMR_BROWSER_TEST_URL || `http://127.0.0.1:${defaultPort}/?browser-smoke=23.2.7-hotfix-startup`;
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
  if (process.env.NIMR_BROWSER_TEST_URL) return Promise.resolve(null);
  const server = createServer(async (request, response) => {
    const url = new URL(request.url || "/", `http://127.0.0.1:${defaultPort}`);
    const pathname = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
    const path = resolve(join(root, pathname));
    if (!path.startsWith(root)) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    try {
      const body = await readFile(path);
      response.writeHead(200, { "Content-Type": mime[extname(path)] || "application/octet-stream" });
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
      // Chrome is still starting.
    }
    await wait(250);
  }
  throw new Error("Chrome DevTools Protocol indisponible.");
}

async function main() {
  if (!chromePath) {
    console.log("Browser console smoke skipped: Chrome/Edge introuvable.");
    return;
  }

  const server = await startStaticServer();
  const port = Number(process.env.NIMR_CDP_PORT || 9235);
  const profile = join(tmpdir(), `nimr-browser-smoke-${Date.now()}`);
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
    await send("Page.navigate", { url: targetUrl }, sessionId);
    await wait(9000);

    const manifestCheck = await send("Runtime.evaluate", {
      awaitPromise: true,
      returnByValue: true,
      expression: `fetch('manifest.webmanifest').then((r) => r.json()).then((manifest) => ({
        has192: manifest.icons?.some((icon) => icon.src === 'assets/icon-192.png' && icon.sizes === '192x192' && /maskable/.test(icon.purpose || '')),
        has512: manifest.icons?.some((icon) => icon.src === 'assets/icon-512.png' && icon.sizes === '512x512' && /maskable/.test(icon.purpose || '')),
        hasStandalone: manifest.display === 'standalone',
        startUrl: manifest.start_url,
      }))`,
    }, sessionId);
    const pwaCheck = await send("Runtime.evaluate", {
      awaitPromise: true,
      returnByValue: true,
      expression: `Promise.all([
        navigator.serviceWorker?.getRegistration?.().then(Boolean).catch(() => false),
        caches?.keys?.().then((keys) => keys.some((key) => key.includes('v23.2.7-hotfix-startup'))).catch(() => false),
      ]).then(([hasServiceWorker, hasExpectedCache]) => ({ hasServiceWorker, hasExpectedCache }))`,
    }, sessionId);

    const critical = findings.filter((item) => /ReferenceError|Content Security Policy|violates.*connect-src|bindLocalSecurityControls|initLocalSecurityGate/i.test(item.text));
    const manifest = manifestCheck.result?.value || {};
    const pwa = pwaCheck.result?.value || {};
    console.log(JSON.stringify({ targetUrl, manifest, pwa, critical, findingsCount: findings.length }, null, 2));

    if (critical.length || !manifest.has192 || !manifest.has512 || !manifest.hasStandalone) {
      throw new Error("Browser console/PWA smoke failed.");
    }
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
