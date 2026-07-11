import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pdfArgument = process.argv[2] || process.env.NIMR_FIELD_PDF || "";
const MAX_PDF_SIZE = 10 * 1024 * 1024;
const CDP_TIMEOUT_MS = 15_000;

const chromePath = process.env.CHROME_PATH || [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((candidate) => existsSync(candidate));

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

function emptySummary() {
  return {
    pdfRead: false,
    textExtracted: false,
    laborLineCount: 0,
    totalDurationHours: 0,
    tasksGenerated: 0,
    chiefValidationPossible: false,
    planningPossible: false,
  };
}

function wait(milliseconds) {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
}

function closeServer(server) {
  if (!server) return Promise.resolve();
  return new Promise((resolveClose) => server.close(() => resolveClose()));
}

function isInsideRoot(candidate) {
  return candidate === root || candidate.startsWith(`${root}${sep}`);
}

function startStaticServer(pdfBytes) {
  const server = createServer(async (request, response) => {
    const requestUrl = new URL(request.url || "/", "http://127.0.0.1");
    const pathname = decodeURIComponent(requestUrl.pathname);

    if (pathname === "/__field_pdf__") {
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Length": pdfBytes.byteLength,
        "Content-Type": "application/pdf",
      });
      response.end(pdfBytes);
      return;
    }

    const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const filePath = resolve(join(root, relativePath));
    if (!isInsideRoot(filePath)) {
      response.writeHead(403).end("Forbidden");
      return;
    }

    try {
      const body = await readFile(filePath);
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Type": mimeTypes[extname(filePath).toLowerCase()] || "application/octet-stream",
      });
      response.end(body);
    } catch {
      response.writeHead(404).end("Not found");
    }
  });

  return new Promise((resolveServer, rejectServer) => {
    server.once("error", rejectServer);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", rejectServer);
      resolveServer(server);
    });
  });
}

async function reserveLocalPort() {
  const server = createServer();
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await closeServer(server);
  if (!port) throw new Error("Impossible de réserver le port du navigateur de test.");
  return port;
}

async function waitForCdp(port) {
  const endpoint = `http://127.0.0.1:${port}/json/version`;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(endpoint);
      if (response.ok) return response.json();
    } catch {
      // Chrome/Edge est encore en cours de démarrage.
    }
    await wait(250);
  }
  throw new Error("Chrome/Edge n'a pas exposé le protocole de test dans le délai prévu.");
}

function connectCdp(webSocketDebuggerUrl) {
  return new Promise((resolveSocket, rejectSocket) => {
    const socket = new WebSocket(webSocketDebuggerUrl);
    socket.addEventListener("open", () => resolveSocket(socket), { once: true });
    socket.addEventListener("error", () => rejectSocket(new Error("Connexion au navigateur de test impossible.")), { once: true });
  });
}

function createCdpClient(socket) {
  const pending = new Map();
  let nextId = 1;

  socket.addEventListener("message", (event) => {
    let message;
    try {
      message = JSON.parse(String(event.data));
    } catch {
      return;
    }
    if (!message.id || !pending.has(message.id)) return;
    const request = pending.get(message.id);
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(new Error(message.error.message || "Erreur navigateur inconnue."));
    else request.resolve(message.result || {});
  });

  socket.addEventListener("close", () => {
    pending.forEach((request) => {
      clearTimeout(request.timer);
      request.reject(new Error("Le navigateur de test a fermé la connexion."));
    });
    pending.clear();
  });

  return (method, params = {}, sessionId) => {
    const id = nextId;
    nextId += 1;
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return new Promise((resolveRequest, rejectRequest) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        rejectRequest(new Error(`Délai navigateur dépassé (${method}).`));
      }, CDP_TIMEOUT_MS);
      pending.set(id, { reject: rejectRequest, resolve: resolveRequest, timer });
    });
  };
}

function browserFieldPdfImport(fileName) {
  const metrics = {
    pdfRead: true,
    textExtracted: false,
    laborLineCount: 0,
    totalDurationHours: 0,
    tasksGenerated: 0,
    chiefValidationPossible: false,
    planningPossible: false,
  };
  let stage = "initialisation";

  const serializeError = (error) => ({
    name: String(error?.name || "Error"),
    message: String(error?.message || "Erreur inconnue."),
    stack: String(error?.stack || "")
      .split(/\r?\n/)
      .slice(0, 5)
      .join("\n"),
  });

  return (async () => {
    try {
      stage = "lecture";
      const response = await fetch("/__field_pdf__", { cache: "no-store" });
      if (!response.ok) throw new Error(`Lecture HTTP du PDF impossible (${response.status}).`);
      const blob = await response.blob();
      const file = new File([blob], fileName, { type: "application/pdf" });

      stage = "pdfjs";
      let pdfJsAttempted = false;
      let pdfJsTextUsable = false;
      const originalPdfJsExtractor = extractPdfTextWithPdfJs;
      extractPdfTextWithPdfJs = async (buffer) => {
        pdfJsAttempted = true;
        const text = await originalPdfJsExtractor(buffer);
        pdfJsTextUsable = isUsableEstimatePdfText(text);
        return text;
      };

      let draft;
      try {
        draft = await buildQuickEstimateCreationDraft(file);
      } finally {
        extractPdfTextWithPdfJs = originalPdfJsExtractor;
      }

      if (!pdfJsAttempted || !pdfJsTextUsable) {
        const error = new Error("Échec extraction PDF.js");
        error.name = "PdfJsExtractionError";
        throw error;
      }
      const extracted = draft.extracted;
      metrics.textExtracted = Boolean(String(extracted?.text || "").trim());

      stage = "analyse";
      const parsed = draft.parsed;
      metrics.laborLineCount = draft.hasDetailedLabor ? parsed.laborLines.length : 0;
      metrics.totalDurationHours = Number(parsed.detectedHours || 0);

      state = normalizeState({
        users: [{ id: "chief-field-pdf", name: "Chef Atelier terrain", role: "chef_atelier", active: true }],
        currentUserId: "chief-field-pdf",
        bookings: [],
        cases: [],
      });
      const created = await createCaseFromPdfEstimate(draft, file, { plate: parsed.info?.plate || "3527TU259" });
      const item = created.item;

      stage = "validation-chef-atelier";
      metrics.chiefValidationPossible = Boolean(
        item.pdfImportStatus === "chief_validation_pending"
        && guardAction("planning.edit", { item }, { notify: false }).ok
      );
      if (!metrics.chiefValidationPossible) {
        throw new Error("Le rôle Chef Atelier ne peut pas valider l'import du devis.");
      }

      stage = "planning";
      const proposal = created.planningPreparation?.proposal || generateSingleProposal(item, new Date());
      metrics.tasksGenerated = Array.isArray(proposal?.steps) ? proposal.steps.length : 0;
      metrics.planningPossible = metrics.tasksGenerated > 0;

      stage = "validation";
      const failures = [];
      if (extracted.sourceType !== "pdf") failures.push("le fichier n'a pas été traité comme PDF");
      if (!metrics.textExtracted) failures.push("aucun texte n'a été extrait");
      if (metrics.laborLineCount <= 0) failures.push("aucune ligne de main-d'œuvre détectée");
      if (metrics.totalDurationHours <= 0) failures.push("aucune durée atelier détectée");
      if (!metrics.tasksGenerated) failures.push("aucune tâche de planning générée");
      if (!metrics.planningPossible) failures.push("planning impossible");
      if (item.source !== "pdf_estimate") failures.push("la source du dossier n'est pas pdf_estimate");
      if (!item.importedAt) failures.push("la date d'import PDF est absente");
      if (getCaseStatus(item) !== "pdfChiefValidation") failures.push("le statut Chef Atelier n'est pas prêt");
      if (getCaseNextAction(item).code !== "validate_pdf_work") failures.push("la prochaine action Chef Atelier est absente");
      if (failures.length) throw new Error(failures.join("; "));

      return { ok: true, metrics };
    } catch (error) {
      return { ok: false, stage, metrics, error: serializeError(error) };
    }
  })();
}

async function evaluate(send, sessionId, expression) {
  const response = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  }, sessionId);
  if (response.exceptionDetails) {
    const description = response.exceptionDetails.exception?.description || response.exceptionDetails.text || "Erreur navigateur.";
    throw new Error(String(description).split(/\r?\n/)[0]);
  }
  return response.result?.value;
}

async function waitForApplication(send, sessionId) {
  const readinessExpression = `Boolean(
    window.pdfjsLib?.getDocument
    && typeof extractEstimateTextFromFile === "function"
    && typeof extractPdfTextWithPdfJs === "function"
    && typeof parseEstimateText === "function"
    && typeof buildQuickEstimateCreationDraft === "function"
    && typeof createCaseFromPdfEstimate === "function"
    && typeof generateSingleProposal === "function"
  )`;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await evaluate(send, sessionId, readinessExpression)) return;
    await wait(250);
  }
  throw new Error("L'application et PDF.js ne se sont pas initialisés dans le navigateur de test.");
}

async function runInBrowser(pdfBytes, fileName) {
  const server = await startStaticServer(pdfBytes);
  const address = server.address();
  const appPort = typeof address === "object" && address ? address.port : 0;
  const cdpPort = Number(process.env.NIMR_CDP_PORT || await reserveLocalPort());
  const profile = resolve(tmpdir(), `nimr-field-pdf-${process.pid}-${Date.now()}`);
  let browser;
  let socket;
  let send;
  let sessionId;
  let targetId;

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
    socket = await connectCdp(version.webSocketDebuggerUrl);
    send = createCdpClient(socket);

    ({ targetId } = await send("Target.createTarget", { url: "about:blank" }));
    ({ sessionId } = await send("Target.attachToTarget", { targetId, flatten: true }));
    await send("Runtime.enable", {}, sessionId);
    await send("Page.enable", {}, sessionId);
    await send("Page.navigate", {
      url: `http://127.0.0.1:${appPort}/?field-pdf-import=${Date.now()}`,
    }, sessionId);
    await waitForApplication(send, sessionId);

    const expression = `(${browserFieldPdfImport.toString()})(${JSON.stringify(fileName)})`;
    return await evaluate(send, sessionId, expression);
  } finally {
    if (send && targetId) await send("Target.closeTarget", { targetId }).catch(() => null);
    socket?.close?.();
    if (browser && !browser.killed) browser.kill();
    await closeServer(server);
    await wait(150);
    await rm(profile, { recursive: true, force: true }).catch(() => null);
  }
}

function oneLine(value, maximumLength = 500) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > maximumLength ? `${text.slice(0, maximumLength - 1)}…` : text;
}

function shortStack(stack) {
  return String(stack || "")
    .split(/\r?\n/)
    .slice(1)
    .map((line) => oneLine(line, 240))
    .filter(Boolean)
    .slice(0, 3);
}

function displayNumber(value) {
  const number = Number(value || 0);
  return Number.isInteger(number) ? String(number) : number.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function printSummary(summary) {
  console.log(`PDF lu : ${summary.pdfRead ? "oui" : "non"}`);
  console.log(`texte extrait : ${summary.textExtracted ? "oui" : "non"}`);
  console.log(`nombre de lignes MO : ${summary.laborLineCount}`);
  console.log(`durée totale : ${displayNumber(summary.totalDurationHours)} h`);
  console.log(`tâches générées : ${summary.tasksGenerated}`);
  console.log(`validation Chef Atelier possible : ${summary.chiefValidationPossible ? "oui" : "non"}`);
  console.log(`planning possible : ${summary.planningPossible ? "oui" : "non"}`);
}

function failureReason(error) {
  if (error?.stage === "pdfjs") return "Échec extraction PDF.js";
  if (error?.stage === "lecture") return `Lecture PDF impossible : ${oneLine(error.message)}`;
  return oneLine(error?.message || "Erreur inconnue.");
}

function printFailure(summary, error) {
  printSummary(summary);
  console.log("FIELD PDF IMPORT FAIL");
  console.log(`reason: ${failureReason(error)}`);
  console.log(`error: ${oneLine(error?.name || "Error", 120)}`);
  console.log(`message: ${oneLine(error?.message || "Erreur inconnue.")}`);
  const frames = shortStack(error?.stack);
  if (frames.length) {
    console.log("stack:");
    frames.forEach((frame) => console.log(`  ${frame}`));
  } else {
    console.log("stack: indisponible");
  }
}

async function main() {
  const summary = emptySummary();
  try {
    if (!pdfArgument) {
      const error = new Error("Usage: node tests\\field_pdf_import.test.mjs <chemin-du-pdf-reel>");
      error.stage = "arguments";
      throw error;
    }
    if (!chromePath) {
      const error = new Error("Chrome/Edge introuvable. Définissez CHROME_PATH pour exécuter le test navigateur.");
      error.stage = "navigateur";
      throw error;
    }

    const pdfPath = resolve(pdfArgument);
    let pdfBytes;
    try {
      pdfBytes = await readFile(pdfPath);
    } catch (cause) {
      const error = new Error(cause?.message || "Le PDF n'a pas pu être lu.");
      error.name = cause?.name || "PdfReadError";
      error.stack = cause?.stack || error.stack;
      error.stage = "lecture";
      throw error;
    }
    summary.pdfRead = true;
    if (pdfBytes.byteLength > MAX_PDF_SIZE) {
      const error = new Error("Fichier trop volumineux. Taille maximale : 10 Mo.");
      error.stage = "lecture";
      throw error;
    }

    const result = await runInBrowser(pdfBytes, basename(pdfPath));
    Object.assign(summary, result?.metrics || {});
    if (!result?.ok) {
      const error = new Error(result?.error?.message || "Échec du test navigateur.");
      error.name = result?.error?.name || "FieldPdfImportError";
      error.stack = result?.error?.stack || error.stack;
      error.stage = result?.stage || "navigateur";
      throw error;
    }

    printSummary(summary);
    console.log("FIELD PDF IMPORT OK");
  } catch (error) {
    printFailure(summary, error);
    process.exitCode = 1;
  }
}

await main();
