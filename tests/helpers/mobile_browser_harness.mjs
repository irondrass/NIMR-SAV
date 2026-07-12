import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";

export const SIMULATED_DEVICE_PROFILES = Object.freeze([
  { name: "iPhone SE (simulé)", width: 375, height: 667, scale: 2, mobile: true, touch: true, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1" },
  { name: "iPhone 13/14 (simulé)", width: 390, height: 844, scale: 3, mobile: true, touch: true, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1" },
  { name: "iPhone Pro Max (simulé)", width: 430, height: 932, scale: 3, mobile: true, touch: true, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1" },
  { name: "Android 360x800 (simulé)", width: 360, height: 800, scale: 3, mobile: true, touch: true, userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36" },
  { name: "Android 412x915 (simulé)", width: 412, height: 915, scale: 2.625, mobile: true, touch: true, userAgent: "Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36" },
  { name: "iPad Mini (simulé)", width: 768, height: 1024, scale: 2, mobile: true, touch: true, userAgent: "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1" },
  { name: "iPad 10e génération (simulé)", width: 820, height: 1180, scale: 2, mobile: true, touch: true, userAgent: "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1" },
  { name: "Tablette Android 800x1280 (simulé)", width: 800, height: 1280, scale: 2, mobile: true, touch: true, userAgent: "Mozilla/5.0 (Linux; Android 14; Tab) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36" },
  { name: "Portable 1366x768 (simulé)", width: 1366, height: 768, scale: 1, mobile: false, touch: false, userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36" },
]);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".pdf": "application/pdf",
};

export function wait(milliseconds) {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
}

function findChromium() {
  return process.env.CHROME_PATH || [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ].find((candidate) => existsSync(candidate));
}

async function startStaticServer(root) {
  const server = createServer(async (request, response) => {
    const requestUrl = new URL(request.url || "/", "http://127.0.0.1");
    const pathname = decodeURIComponent(requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname);
    const relativePath = pathname.replace(/^\/+/, "");
    const filePath = resolve(join(root, relativePath));
    if (!filePath.toLowerCase().startsWith(root.toLowerCase())) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    try {
      const body = await readFile(filePath);
      response.writeHead(200, {
        "Content-Type": MIME[extname(filePath).toLowerCase()] || "application/octet-stream",
        "Cache-Control": "no-store",
      });
      response.end(body);
    } catch (error) {
      response.writeHead(404).end("Not found");
    }
  });
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  return { server, baseUrl: `http://127.0.0.1:${address.port}/` };
}

async function waitForCdp(port) {
  const endpoint = `http://127.0.0.1:${port}/json/version`;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(endpoint);
      if (response.ok) return response.json();
    } catch (error) {
      // Le navigateur démarre encore.
    }
    await wait(250);
  }
  throw new Error("Chrome DevTools Protocol indisponible pour le test mobile simulé.");
}

export async function runMobileCdpTest({ name, cdpPort, run }) {
  const chromePath = findChromium();
  if (!chromePath) throw new Error("Chrome/Edge requis pour les profils mobiles simulés.");
  const root = resolve(process.cwd());
  const { server, baseUrl } = await startStaticServer(root);
  const profilePath = join(tmpdir(), `nimr-${name.replace(/[^a-z0-9]+/gi, "-")}-${Date.now()}`);
  const chrome = spawn(chromePath, [
    "--headless=new",
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${profilePath}`,
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "about:blank",
  ], { stdio: "ignore" });

  let socket;
  let targetId;
  const pending = new Map();
  const errors = [];
  const warnings = [];
  let nextId = 0;

  const send = (method, params = {}, sessionId) => {
    const id = ++nextId;
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return new Promise((resolveSend, rejectSend) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        rejectSend(new Error(`CDP timeout: ${method}`));
      }, 15000);
      pending.set(id, { resolveSend, rejectSend, timer });
    });
  };

  try {
    const version = await waitForCdp(cdpPort);
    socket = new WebSocket(version.webSocketDebuggerUrl);
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id && pending.has(message.id)) {
        const entry = pending.get(message.id);
        pending.delete(message.id);
        clearTimeout(entry.timer);
        if (message.error) entry.rejectSend(new Error(message.error.message));
        else entry.resolveSend(message.result || {});
        return;
      }
      const params = message.params || {};
      if (message.method === "Runtime.exceptionThrown") {
        errors.push(params.exceptionDetails?.exception?.description || params.exceptionDetails?.text || "pageerror");
      } else if (message.method === "Runtime.consoleAPICalled") {
        const text = (params.args || []).map((arg) => arg.value ?? arg.description ?? "").join(" ");
        if (params.type === "error") errors.push(text);
        if (params.type === "warning") warnings.push(text);
      } else if (message.method === "Log.entryAdded") {
        const entry = params.entry || {};
        if (entry.level === "error") errors.push(entry.text || "Log error");
        if (entry.level === "warning") warnings.push(entry.text || "Log warning");
      }
    });
    await new Promise((resolveOpen, rejectOpen) => {
      socket.addEventListener("open", resolveOpen, { once: true });
      socket.addEventListener("error", rejectOpen, { once: true });
    });
    ({ targetId } = await send("Target.createTarget", { url: "about:blank" }));
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    await Promise.all([
      send("Runtime.enable", {}, sessionId),
      send("Page.enable", {}, sessionId),
      send("Log.enable", {}, sessionId),
      send("Network.enable", {}, sessionId),
      send("DOM.enable", {}, sessionId),
    ]);

    const evaluate = async (expression, options = {}) => {
      const result = await send("Runtime.evaluate", {
        expression,
        awaitPromise: options.awaitPromise !== false,
        returnByValue: options.returnByValue !== false,
        userGesture: options.userGesture !== false,
      }, sessionId);
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "Évaluation navigateur impossible");
      }
      return result.result?.value;
    };

    const applyProfile = async (profile, orientation = "portrait") => {
      const landscape = orientation === "landscape";
      const width = landscape ? profile.height : profile.width;
      const height = landscape ? profile.width : profile.height;
      await send("Emulation.setDeviceMetricsOverride", {
        width,
        height,
        deviceScaleFactor: profile.scale,
        mobile: profile.mobile,
        screenWidth: width,
        screenHeight: height,
        screenOrientation: { type: landscape ? "landscapePrimary" : "portraitPrimary", angle: landscape ? 90 : 0 },
      }, sessionId);
      await send("Emulation.setTouchEmulationEnabled", { enabled: profile.touch, ...(profile.touch ? { maxTouchPoints: 5 } : {}) }, sessionId);
      await send("Emulation.setUserAgentOverride", { userAgent: profile.userAgent, platform: profile.mobile ? "mobile" : "Windows" }, sessionId);
      return { width, height };
    };

    const setViewport = async ({ width, height, scale = 2, mobile = true, touch = true, orientation = "portraitPrimary" }) => {
      await send("Emulation.setDeviceMetricsOverride", {
        width,
        height,
        deviceScaleFactor: scale,
        mobile,
        screenWidth: width,
        screenHeight: height,
        screenOrientation: { type: orientation, angle: orientation.startsWith("landscape") ? 90 : 0 },
      }, sessionId);
      await send("Emulation.setTouchEmulationEnabled", { enabled: touch, ...(touch ? { maxTouchPoints: 5 } : {}) }, sessionId);
    };

    const setOffline = async (offline) => {
      await send("Network.emulateNetworkConditions", {
        offline,
        latency: offline ? 0 : 80,
        downloadThroughput: offline ? 0 : 2_000_000,
        uploadThroughput: offline ? 0 : 750_000,
        connectionType: offline ? "none" : "cellular4g",
      }, sessionId);
    };

    const waitFor = async (predicateExpression, label, attempts = 80) => {
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        if (await evaluate(`Boolean(${predicateExpression})`)) return;
        await wait(100);
      }
      throw new Error(`Timeout: ${label}`);
    };

    const navigate = async (path = "") => {
      await send("Page.navigate", { url: `${baseUrl}${path}` }, sessionId);
      await waitFor("window.__nimrAppReady === true", "application mobile prête", 120);
    };

    const click = async (selector) => evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) throw new Error(${JSON.stringify(`Élément absent: ${selector}`)});
      element.click();
      return true;
    })()`);

    const context = { baseUrl, send, sessionId, evaluate, applyProfile, setViewport, setOffline, waitFor, navigate, click, wait, errors, warnings };
    const result = await run(context);
    return { result, errors, warnings };
  } finally {
    try {
      if (socket && targetId) await send("Target.closeTarget", { targetId });
    } catch (error) {
      // Fermeture au mieux.
    }
    socket?.close?.();
    chrome.kill();
    await new Promise((resolveClose) => server.close(resolveClose));
  }
}

export function technicianFixtureExpression({ role = "technicien", started = true } = {}) {
  return `(async () => {
    const now = new Date();
    const today = typeof todayKey === "function" ? todayKey(now) : now.toISOString().slice(0, 10);
    const currentStart = new Date(now.getTime() - 4 * 60000);
    const currentEnd = new Date(now.getTime() + 56 * 60000);
    const nextStart = new Date(now.getTime() + 70 * 60000);
    const nextEnd = new Date(now.getTime() + 130 * 60000);
    const userRole = ${JSON.stringify(role)};
    const user = { id: "user-mobile-tech", name: "Technicien Mobile", role: userRole, active: true, resourceId: "tech-mobile", pinHash: "", pinSalt: "", createdAt: now.toISOString(), updatedAt: now.toISOString() };
    const resources = [
      { id: "tech-mobile", name: "Technicien Mobile", role: "mecanicien", active: true, capacity: 1 },
      { id: "pont-mobile", name: "Pont mécanique mobile", role: "pont_mecanique", resourceType: "equipment", active: true, capacity: 1 },
      { id: "zone-mobile", name: "Zone mécanique mobile", role: "zone_mecanique", resourceType: "zone", active: true, capacity: 1 },
    ];
    const makeCase = (id, plate, vehicle, workStarted) => ({
      id, clientName: "Client Terrain", vehicle, plate, vin: "", orNavNumber: id.toUpperCase(), estimateNumber: "DEV-MOBILE",
      createdAt: new Date(now.getTime() - 86400000).toISOString(), updatedAt: now.toISOString(),
      flags: { received: true, workStarted, workCompleted: false },
      durations: { body: 0, oilService: 0, mechanical: 1, electrical: 0, prep: 0, paint: 0, finish: 0, reassembly: 0, quality: 0 },
      claims: [{
        id: "claim-" + id,
        number: "OT-" + id.toUpperCase(),
        title: "Réparation mécanique mobile",
        type: "mechanical_client",
        status: "planned",
        includeInPlanning: true,
        clientApproved: true,
        createdAt: new Date(now.getTime() - 86400000).toISOString(),
        updatedAt: now.toISOString(),
      }],
      photos: [], history: [], blockers: [],
    });
    const currentCase = makeCase("case-mobile-current", "3527 TU 259", "NIMR BOX", ${started ? "true" : "false"});
    const nextCase = makeCase("case-mobile-next", "4120 TU 300", "NIMR SUV", false);
    const makeBooking = (id, caseId, start, end, status, businessTaskId) => ({
      id, caseId, key: "mechanical", title: "Réparation mécanique", businessTaskId, type: "work", status,
      start: start.toISOString(), end: end.toISOString(), plannedStart: start.toISOString(), plannedEnd: end.toISOString(),
      plannedMinutes: 60, remainingMinutes: status === "completed" ? 0 : 60,
      segments: [{ start: start.toISOString(), end: end.toISOString() }],
      plannedSegments: [{ start: start.toISOString(), end: end.toISOString() }],
      resourceIds: ["tech-mobile", "pont-mobile", "zone-mobile"], primaryResourceId: "tech-mobile", equipmentResourceIds: ["pont-mobile", "zone-mobile"],
      requiredRole: "mecanicien", equipmentRole: "pont_mecanique", notes: [], photoIds: [],
      actualStart: status === "started" ? start.toISOString() : "", startedAt: status === "started" ? start.toISOString() : "", startedBy: status === "started" ? "tech-mobile" : "",
      workSessions: status === "started" ? [{ startedAt: start.toISOString(), startedBy: "tech-mobile", pausedAt: "", completedAt: "", pauseReason: "" }] : [],
    });
    const bookings = [
      makeBooking("booking-mobile-current", currentCase.id, currentStart, currentEnd, ${started ? '"started"' : '"planned"'}, "task-mobile-current"),
      makeBooking("booking-mobile-next", nextCase.id, nextStart, nextEnd, "planned", "task-mobile-next"),
    ];
    state = normalizeState({
      ...state,
      users: [user], currentUserId: user.id, resources, cases: [currentCase, nextCase], bookings,
      ui: { ...(state.ui || {}), technicianId: "tech-mobile", technicianDate: today },
    });
    invalidateUiRuntimeIndexes?.();
    sessionStorage.setItem("nimr-user-pin-unlocked", user.id);
    document.querySelectorAll(".local-lock-overlay").forEach((overlay) => { overlay.hidden = true; });
    document.querySelector(".app-shell")?.removeAttribute("inert");
    activeTab = "technician";
    render();
    setActiveTab("technician");
    renderTechnicianDashboard();
    saveState({ skipCloud: true, skipSnapshot: true });
    return { cases: state.cases.length, bookings: state.bookings.length, role: getCurrentUser()?.role, current: document.querySelector("[data-technician-current-task]")?.dataset.currentBookingId || "" };
  })()`;
}

export function responsiveAuditExpression() {
  return `(() => {
    const html = document.documentElement;
    const body = document.body;
    const visible = (element) => {
      if (!element) return false;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight;
    const globalOverflow = Math.max(html.scrollWidth, body.scrollWidth) > viewportWidth + 2;
    const criticalButtons = [...document.querySelectorAll("#technician-field-action-dock button, .pdf-import-primary-button, .pdf-create-case-button")]
      .filter(visible)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return { text: element.textContent.trim(), width: rect.width, height: rect.height };
      });
    const modal = document.querySelector(".custom-modal-content:not([hidden]), .local-lock-dialog:not([hidden])");
    const modalRect = modal?.getBoundingClientRect();
    const dock = document.querySelector("#technician-field-action-dock:not([hidden])");
    const nav = document.querySelector(".sidebar");
    const dockRect = dock?.getBoundingClientRect();
    const navRect = nav?.getBoundingClientRect();
    return {
      viewportWidth,
      viewportHeight,
      globalOverflow,
      currentTaskVisible: visible(document.querySelector("[data-technician-current-task]")),
      nextTaskVisible: visible(document.querySelector("[data-technician-next-task]")),
      dockVisible: visible(dock),
      criticalButtons,
      buttonsAccessible: criticalButtons.every((button) => button.width >= 44 && button.height >= 44),
      fixedBarsDoNotOverlap: !dockRect || !navRect || dockRect.bottom <= navRect.top + 1 || getComputedStyle(nav).position !== "fixed",
      dockRect: dockRect ? { top: dockRect.top, bottom: dockRect.bottom } : null,
      navRect: navRect ? { top: navRect.top, bottom: navRect.bottom } : null,
      modalFits: !modalRect || (modalRect.top >= -1 && modalRect.bottom <= viewportHeight + 1 && modalRect.left >= -1 && modalRect.right <= viewportWidth + 1),
    };
  })()`;
}
