import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import net from "node:net";

const root = resolve(process.cwd());
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
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

const wait = (milliseconds) => new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));

function startStaticServer() {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    const relative = decodeURIComponent(url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, ""));
    const filePath = resolve(join(root, relative));
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
  return new Promise((resolveServer) => server.listen(0, "127.0.0.1", () => resolveServer(server)));
}

function reservePort() {
  return new Promise((resolvePort, rejectPort) => {
    const server = net.createServer();
    server.once("error", rejectPort);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolvePort(port));
    });
  });
}

async function waitForCdp(port) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return response.json();
    } catch {
      // Chrome démarre encore.
    }
    await wait(200);
  }
  throw new Error("Chrome DevTools Protocol indisponible");
}

function createCdpClient(socket, findings) {
  let nextId = 1;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const entry = pending.get(message.id);
      pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.error) entry.reject(new Error(message.error.message || "CDP error"));
      else entry.resolve(message.result || {});
      return;
    }
    if (message.method === "Runtime.exceptionThrown") {
      findings.push({
        type: "pageerror",
        text: message.params?.exceptionDetails?.exception?.description || message.params?.exceptionDetails?.text || "Erreur page",
      });
    }
    if (message.method === "Runtime.consoleAPICalled" && message.params?.type === "error") {
      findings.push({
        type: "console.error",
        text: (message.params.args || []).map((argument) => argument.value || argument.description || "").join(" "),
      });
    }
  });

  return (method, params = {}, sessionId) => {
    const id = nextId++;
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return new Promise((resolveRequest, rejectRequest) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        rejectRequest(new Error(`CDP timeout: ${method}`));
      }, 30000);
      pending.set(id, { resolve: resolveRequest, reject: rejectRequest, timer });
    });
  };
}

async function evaluate(send, sessionId, expression) {
  const result = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  }, sessionId);
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "Runtime.evaluate failed");
  }
  return result.result?.value;
}

function browserLargeDatasetScenario() {
  const waitBrowser = (milliseconds) => new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
  const waitUntil = async (predicate, message, attempts = 80) => {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (predicate()) return;
      await waitBrowser(25);
    }
    throw new Error(message);
  };
  const timed = async (operation) => {
    const startedAt = performance.now();
    const value = await operation();
    return { value, milliseconds: Math.round((performance.now() - startedAt) * 10) / 10 };
  };

  return (async () => {
    const generation = await timed(async () => {
      const cases = Array.from({ length: 4000 }, (_, index) => {
        const createdAt = new Date(Date.UTC(2026, 0, 1) + (index % 365) * 86400000).toISOString();
        const bucket = index % 5;
        return {
          id: `large-case-${String(index).padStart(4, "0")}`,
          clientName: `Client ${String(index).padStart(4, "0")}`,
          phone: `+21620${String(index).padStart(6, "0")}`,
          vehicle: `Modèle ${index % 23}`,
          plate: `${1000 + index} TU ${2000 + index}`,
          vin: `VF3LARGE${String(index).padStart(9, "0")}`,
          orNavNumber: `OR-${String(index).padStart(6, "0")}`,
          createdAt,
          updatedAt: createdAt,
          source: bucket === 0 ? "pdf_estimate" : "",
          pdfImportStatus: bucket === 0 ? "chief_validation_pending" : "",
          flags: {
            received: bucket === 2,
            workStarted: bucket === 2,
            workCompleted: bucket === 2,
            qualityApproved: false,
            delivered: false,
            invoiced: bucket === 1,
          },
          durations: { body: 2 },
          claims: [{
            id: `large-claim-${index}`,
            number: `OT-${String(index).padStart(6, "0")}`,
            title: `Réparation carrosserie ${index}`,
            type: index % 2 ? "client" : "assurance",
            status: "approved",
            includeInPlanning: true,
            expertApproved: true,
            clientApproved: true,
            estimate: { lines: [{ id: `large-line-${index}`, phase: "body", operation: "Dressage aile", laborHours: 2 }] },
          }],
          history: [{ type: "case.created", label: "Dossier créé", at: createdAt }],
        };
      });
      const bookings = cases.map((item, index) => {
        const start = new Date(Date.UTC(2026, 0, 1) + (index % 365) * 86400000 + 8 * 3600000);
        const end = new Date(start.getTime() + 2 * 3600000);
        const resourceId = `tolier-large-${(index % 4) + 1}`;
        return {
          id: `large-booking-${index}`,
          caseId: item.id,
          key: "body",
          title: "Tôlerie",
          start: start.toISOString(),
          end: end.toISOString(),
          segments: [{ start: start.toISOString(), end: end.toISOString() }],
          resourceIds: [resourceId],
          primaryResourceId: resourceId,
          status: "planned",
        };
      });
      return { cases, bookings };
    });

    const normalization = await timed(async () => normalizeState({
      cases: generation.value.cases,
      bookings: generation.value.bookings,
      users: [{ id: "large-admin", name: "Admin large dataset", role: "admin", active: true }],
      currentUserId: "large-admin",
      resources: Array.from({ length: 4 }, (_, index) => ({
        id: `tolier-large-${index + 1}`,
        name: `Tôlier large ${index + 1}`,
        role: "tolier",
        active: true,
      })),
    }));
    state = normalization.value;
    // Le 11/07 tombe volontairement sur le bucket des dossiers clôturés dans
    // ce jeu synthétique. Utiliser le 10/07 vérifie le rendu de réservations
    // réellement actives, sans fausser le filtre qui masque les archives.
    state.planningDate = "2026-07-10";
    activeCaseId = "";
    activeTab = "dossiers";
    invalidateUiRuntimeIndexes();

    const initialRender = await timed(async () => render());
    const list = document.getElementById("case-list");
    const pageOneIds = [...list.querySelectorAll("[data-case]")].map((element) => element.dataset.case);
    list.querySelector('[data-case-page="next"]')?.click();
    const pageTwoIds = [...list.querySelectorAll("[data-case]")].map((element) => element.dataset.case);

    const searchInput = document.getElementById("case-search");
    const search = await timed(async () => {
      searchInput.value = "Client 3999";
      searchInput.dispatchEvent(new Event("input", { bubbles: true }));
      await waitBrowser(220);
      renderCases();
      await waitUntil(() => list.dataset.caseListFilteredCount === "1", "Recherche exacte non rendue");
    });
    const searchedIds = [...list.querySelectorAll("[data-case]")].map((element) => element.dataset.case);

    searchInput.value = "";
    searchInput.dispatchEvent(new Event("input", { bubbles: true }));
    await waitBrowser(220);
    renderCases();
    await waitUntil(() => list.dataset.caseListFilteredCount === "4000", "Réinitialisation recherche non rendue");

    const originalSaveState = saveState;
    saveState = () => {};
    const statusSelect = document.getElementById("case-status-filter");
    const statusFilter = await timed(async () => {
      statusSelect.value = "chief_validation";
      statusSelect.dispatchEvent(new Event("change", { bubbles: true }));
      await waitUntil(() => list.dataset.caseListFilteredCount === "800", "Filtre statut PDF non rendu");
    });
    const filteredStatuses = [...list.querySelectorAll("[data-case]")].map((element) => getCaseStatus(getIndexedCaseById(element.dataset.case)));

    statusSelect.value = "all";
    statusSelect.dispatchEvent(new Event("change", { bubbles: true }));
    const sortSelect = document.getElementById("case-sort");
    const sorting = await timed(async () => {
      sortSelect.value = "client";
      sortSelect.dispatchEvent(new Event("change", { bubbles: true }));
      await waitUntil(() => list.querySelector("[data-case]")?.dataset.case === "large-case-0000", "Tri client non rendu");
    });
    saveState = originalSaveState;

    const firstCard = list.querySelector("[data-case]");
    const openedId = firstCard?.dataset.case || "";
    const opening = await timed(async () => {
      firstCard?.click();
      await waitUntil(() => activeCaseId === openedId && document.getElementById("case-detail")?.textContent?.trim(), "Ouverture dossier non rendue");
    });

    const dashboard = await timed(async () => buildSavPerformanceDashboard(new Date("2026-07-10T10:00:00.000Z")));
    activeTab = "planning";
    const planning = await timed(async () => renderPlanning());

    const indexedStorage = await timed(async () => {
      saveState({ skipCloud: true, skipSnapshot: true });
      let record = null;
      for (let attempt = 0; attempt < 80; attempt += 1) {
        record = await loadLargeStateSnapshot();
        if (record?.casesCount === 4000) break;
        await waitBrowser(25);
      }
      const primary = localStorage.getItem("nimr-carrosserie-v1") || "";
      const meta = JSON.parse(localStorage.getItem("nimr-carrosserie-v1:meta") || "null");
      return {
        primaryBytes: new TextEncoder().encode(primary).byteLength,
        marker: JSON.parse(primary || "null"),
        meta,
        snapshotCaseCount: record?.state?.cases?.length || 0,
        mirrorPresent: localStorage.getItem("nimr-carrosserie-v1:mirror") !== null,
      };
    });

    const beforeReplacement = getIndexedCaseById("large-case-0000");
    state.cases[0] = { ...state.cases[0], clientName: "Client index remplacé" };
    invalidateUiRuntimeIndexes();
    const replacementVisible = getIndexedCaseById("large-case-0000")?.clientName === "Client index remplacé"
      && getIndexedCaseById("large-case-0000") !== beforeReplacement;

    return {
      caseCount: state.cases.length,
      bookingCount: state.bookings.length,
      timings: {
        generationMs: generation.milliseconds,
        normalizationMs: normalization.milliseconds,
        initialRenderMs: initialRender.milliseconds,
        searchMs: search.milliseconds,
        statusFilterMs: statusFilter.milliseconds,
        sortMs: sorting.milliseconds,
        openingMs: opening.milliseconds,
        dashboardMs: dashboard.milliseconds,
        planningMs: planning.milliseconds,
        indexedStorageMs: indexedStorage.milliseconds,
      },
      pagination: {
        pageSize: Number(list.dataset.caseListPage ? CASE_LIST_PAGE_SIZE : 0),
        pageOneCount: pageOneIds.length,
        pageTwoCount: pageTwoIds.length,
        duplicates: pageTwoIds.filter((id) => pageOneIds.includes(id)),
      },
      search: { ids: searchedIds },
      statuses: {
        filteredCount: filteredStatuses.length,
        allPdfChiefValidation: filteredStatuses.every((status) => status === "chief_validation"),
        samples: [0, 1, 2, 3, 4].map((index) => getCaseStatus(state.cases[index])),
      },
      dashboard: {
        activeCases: dashboard.value.metrics.activeCases,
        directorAlerts: dashboard.value.metrics.directorAlerts,
      },
      planning: {
        renderedBookings: document.querySelectorAll("#gantt .booking").length,
        mobileRows: document.querySelectorAll("#mobile-planning-list .mobile-planning-card").length,
      },
      indexedStorage: indexedStorage.value,
      dom: {
        caseCards: document.querySelectorAll("#case-list .case-card").length,
        totalElements: document.getElementsByTagName("*").length,
        bodyHtmlChars: document.body.innerHTML.length,
      },
      replacementVisible,
    };
  })();
}

assert.ok(chromePath, "Chrome ou Edge est requis pour le test 4000 dossiers");
const findings = [];
const server = await startStaticServer();
const appPort = server.address().port;
const cdpPort = await reservePort();
const profile = resolve(tmpdir(), `nimr-large-dataset-${process.pid}-${Date.now()}`);
let browser;
let socket;

try {
  browser = spawn(chromePath, [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    `--remote-debugging-port=${cdpPort}`,
    "--remote-debugging-address=127.0.0.1",
    `--user-data-dir=${profile}`,
    "about:blank",
  ], { stdio: "ignore", windowsHide: true });

  const version = await waitForCdp(cdpPort);
  socket = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolveSocket, rejectSocket) => {
    socket.addEventListener("open", resolveSocket, { once: true });
    socket.addEventListener("error", rejectSocket, { once: true });
  });
  const send = createCdpClient(socket, findings);
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  await send("Runtime.enable", {}, sessionId);
  await send("Page.enable", {}, sessionId);
  await send("Performance.enable", {}, sessionId);
  await send("Page.navigate", { url: `http://127.0.0.1:${appPort}/?large-dataset=${Date.now()}` }, sessionId);

  for (let attempt = 0; attempt < 200; attempt += 1) {
    const ready = await evaluate(send, sessionId, "window.__nimrAppReady === true && typeof renderCases === 'function' && typeof normalizeState === 'function' && typeof invalidateUiRuntimeIndexes === 'function'");
    if (ready) break;
    await wait(100);
    if (attempt === 199) throw new Error("Application non initialisée pour le test 4000 dossiers");
  }

  const metrics = await evaluate(send, sessionId, `(${browserLargeDatasetScenario.toString()})()`);
  await send("HeapProfiler.collectGarbage", {}, sessionId).catch(() => null);
  await wait(100);
  const performanceMetrics = await send("Performance.getMetrics", {}, sessionId);
  const metricMap = Object.fromEntries((performanceMetrics.metrics || []).map((metric) => [metric.name, metric.value]));
  metrics.memory = {
    jsHeapUsedBytes: metricMap.JSHeapUsedSize || 0,
    jsHeapTotalBytes: metricMap.JSHeapTotalSize || 0,
  };

  assert.equal(metrics.caseCount, 4000, "les 4000 dossiers doivent être chargés");
  assert.equal(metrics.bookingCount, 4000, "les 4000 réservations doivent être indexées");
  assert.equal(metrics.pagination.pageSize, 50, "la pagination doit être bornée à 50 dossiers");
  assert.equal(metrics.pagination.pageOneCount, 50, "la première page doit contenir 50 dossiers");
  assert.equal(metrics.pagination.pageTwoCount, 50, "la deuxième page doit contenir 50 dossiers");
  assert.deepEqual(metrics.pagination.duplicates, [], "deux pages successives ne doivent partager aucun dossier");
  assert.deepEqual(metrics.search.ids, ["large-case-3999"], "la recherche doit retrouver le dossier exact");
  assert.equal(metrics.statuses.filteredCount, 50, "le filtre doit rendre uniquement la première page de résultats");
  assert.equal(metrics.statuses.allPdfChiefValidation, true, "le filtre statut doit être exact");
  assert.equal(metrics.replacementVisible, true, "l'index caseById doit être explicitement invalidable");
  assert.ok(metrics.planning.renderedBookings > 0, "le planning réel doit rendre les réservations du jour");
  assert.equal(metrics.indexedStorage.marker.largeState, true, "la sauvegarde locale doit utiliser un marqueur compact");
  assert.equal(metrics.indexedStorage.meta.largeState, true, "la métadonnée doit annoncer IndexedDB");
  assert.equal(metrics.indexedStorage.snapshotCaseCount, 4000, "IndexedDB doit restituer les 4000 dossiers");
  assert.equal(metrics.indexedStorage.mirrorPresent, false, "aucune copie géante ne doit rester dans localStorage");
  assert.ok(metrics.indexedStorage.primaryBytes < 1024, "le marqueur localStorage doit rester inférieur à 1 Ko");
  assert.ok(metrics.dom.caseCards <= 50, "le DOM ne doit jamais contenir plus de 50 cartes dossier");
  assert.ok(metrics.dom.totalElements < 20000, `le DOM doit rester borné, reçu ${metrics.dom.totalElements} éléments`);
  assert.ok(metrics.memory.jsHeapUsedBytes < 150 * 1024 * 1024, "le tas JS utilisé doit rester sous 150 Mo");
  assert.ok(metrics.timings.generationMs < 1500, "la génération du jeu 4000 doit rester sous 1,5 s");
  assert.ok(metrics.timings.normalizationMs < 3000, "la normalisation doit rester sous 3 s");
  assert.ok(metrics.timings.initialRenderMs < 1500, "le rendu initial paginé doit rester sous 1,5 s");
  assert.ok(metrics.timings.searchMs < 1000, "la recherche debouncée doit rester sous 1 s");
  assert.ok(metrics.timings.statusFilterMs < 1000, "le filtre statut doit rester sous 1 s");
  assert.ok(metrics.timings.sortMs < 1000, "le tri doit rester sous 1 s");
  assert.ok(metrics.timings.openingMs < 1000, "l'ouverture d'un dossier doit rester sous 1 s");
  assert.ok(metrics.timings.dashboardMs < 1500, "le dashboard doit rester sous 1,5 s");
  assert.ok(metrics.timings.planningMs < 1500, "le planning indexé doit rester sous 1,5 s");
  assert.ok(metrics.timings.indexedStorageMs < 5000, "la persistance IndexedDB doit rester sous 5 s");
  assert.deepEqual(findings, [], "zéro console.error et zéro pageerror attendus");

  console.log("LARGE DATASET 4000 CASES OK");
  console.log(JSON.stringify(metrics, null, 2));
  await send("Target.closeTarget", { targetId }).catch(() => null);
} finally {
  socket?.close?.();
  if (browser && !browser.killed) browser.kill();
  await new Promise((resolveServer) => server.close(resolveServer));
  await wait(100);
  await rm(profile, { recursive: true, force: true }).catch(() => null);
}
