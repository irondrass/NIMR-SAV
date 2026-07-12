import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve, sep } from "node:path";
import { spawn } from "node:child_process";

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

export function findBrowserExecutable() {
  return process.env.CHROME_PATH || [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ].find((candidate) => existsSync(candidate));
}

function closeServer(server) {
  return new Promise((resolveClose) => server.close(() => resolveClose()));
}

async function reservePort() {
  const server = createServer();
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await closeServer(server);
  return port;
}

async function startStaticServer(root) {
  const absoluteRoot = resolve(root);
  const server = createServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    const relative = decodeURIComponent(url.pathname) === "/" ? "index.html" : decodeURIComponent(url.pathname).replace(/^\/+/, "");
    const filePath = resolve(join(absoluteRoot, relative));
    if (filePath !== absoluteRoot && !filePath.startsWith(`${absoluteRoot}${sep}`)) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    try {
      const body = await readFile(filePath);
      response.writeHead(200, { "Cache-Control": "no-store", "Content-Type": MIME_TYPES[extname(filePath).toLowerCase()] || "application/octet-stream" });
      response.end(body);
    } catch {
      response.writeHead(404).end("Not found");
    }
  });
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  return server;
}

async function waitForDebugger(port) {
  const endpoint = `http://127.0.0.1:${port}/json/version`;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(endpoint);
      if (response.ok) return response.json();
    } catch {
      // Le navigateur démarre encore.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 200));
  }
  throw new Error("Le navigateur n'a pas exposé CDP dans le délai prévu.");
}

function connectSocket(url) {
  return new Promise((resolveSocket, rejectSocket) => {
    const socket = new WebSocket(url);
    socket.addEventListener("open", () => resolveSocket(socket), { once: true });
    socket.addEventListener("error", () => rejectSocket(new Error("Connexion CDP impossible.")), { once: true });
  });
}

function createClient(socket) {
  const pending = new Map();
  const listeners = new Set();
  let nextId = 1;
  socket.addEventListener("message", (event) => {
    let message;
    try { message = JSON.parse(String(event.data)); } catch { return; }
    if (!message.id) {
      listeners.forEach((listener) => listener(message));
      return;
    }
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.error) entry.reject(new Error(message.error.message || "Erreur CDP."));
    else entry.resolve(message.result || {});
  });
  const send = (method, params = {}, sessionId) => new Promise((resolveRequest, rejectRequest) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      rejectRequest(new Error(`Délai CDP dépassé (${method}).`));
    }, 15_000);
    pending.set(id, { resolve: resolveRequest, reject: rejectRequest, timer });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  send.onEvent = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  return send;
}

export async function evaluate(send, sessionId, expression) {
  const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, sessionId);
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "Erreur navigateur.");
  }
  return result.result?.value;
}

export async function waitForExpression(send, sessionId, expression, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(send, sessionId, expression)) return true;
    await new Promise((resolveWait) => setTimeout(resolveWait, 200));
  }
  throw new Error(`Condition navigateur non satisfaite : ${expression}`);
}

export async function withBrowserPage(root, task, options = {}) {
  const browserPath = findBrowserExecutable();
  if (!browserPath) throw new Error("Chrome/Edge introuvable. Définissez CHROME_PATH.");
  const server = await startStaticServer(root);
  const address = server.address();
  const appPort = typeof address === "object" && address ? address.port : 0;
  const cdpPort = await reservePort();
  const profile = resolve(tmpdir(), `nimr-cdp-${process.pid}-${Date.now()}`);
  const browser = spawn(browserPath, [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    `--remote-debugging-port=${cdpPort}`,
    "--remote-debugging-address=127.0.0.1",
    `--user-data-dir=${profile}`,
    "about:blank",
  ], { stdio: "ignore", windowsHide: true });
  let socket;
  let send;
  let targetId;
  const findings = [];
  try {
    const version = await waitForDebugger(cdpPort);
    socket = await connectSocket(version.webSocketDebuggerUrl);
    send = createClient(socket);
    ({ targetId } = await send("Target.createTarget", { url: "about:blank" }));
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    send.onEvent((message) => {
      if (message.sessionId !== sessionId) return;
      if (message.method === "Runtime.exceptionThrown") findings.push({ type: "pageerror", text: message.params?.exceptionDetails?.exception?.description || message.params?.exceptionDetails?.text || "Erreur page" });
      if (message.method === "Runtime.consoleAPICalled" && message.params?.type === "error") findings.push({ type: "console.error", text: (message.params.args || []).map((arg) => arg.value || arg.description || "").join(" ") });
      if (message.method === "Log.entryAdded" && message.params?.entry?.level === "error") findings.push({ type: "console.error", text: message.params.entry.text || "" });
    });
    await send("Runtime.enable", {}, sessionId);
    await send("Log.enable", {}, sessionId);
    await send("Page.enable", {}, sessionId);
    const url = `http://127.0.0.1:${appPort}/${options.path || ""}`;
    await send("Page.navigate", { url }, sessionId);
    await waitForExpression(send, sessionId, "window.__nimrAppReady === true", options.startupTimeoutMs || 25_000);
    return await task({ send, sessionId, targetId, url, findings, evaluate: (expression) => evaluate(send, sessionId, expression), waitFor: (expression, timeout) => waitForExpression(send, sessionId, expression, timeout) });
  } finally {
    if (send && targetId) await send("Target.closeTarget", { targetId }).catch(() => null);
    socket?.close?.();
    if (!browser.killed) browser.kill();
    await closeServer(server);
    await rm(profile, { recursive: true, force: true }).catch(() => null);
  }
}
