import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";

console.log("Démarrage des tests v23.1A-bis : Real Browser Login Screen PIN (CDP)...");

const root = resolve(process.cwd());
const defaultPort = 8789;
const targetUrl = `http://127.0.0.1:${defaultPort}/?browser-login-test=v23.1a-bis`;
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
      // Chrome starting...
    }
    await wait(250);
  }
  throw new Error("Chrome DevTools Protocol indisponible.");
}

async function main() {
  if (!chromePath) {
    console.log("Real browser login test SKIPPED: Chrome/Edge introuvable.");
    return;
  }

  const server = await startStaticServer();
  const port = 9237;
  const profile = join(tmpdir(), `nimr-browser-login-${Date.now()}`);
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
    
    console.log("Chargement de l'application...");
    await wait(8000);

    // Étape 1 : Reset et setup
    console.log("Étape 1 : Reset et setup...");
    await send("Runtime.evaluate", {
      awaitPromise: true,
      expression: `
        localStorage.clear();
        sessionStorage.clear();
        location.reload();
      `
    }, sessionId);
    for (let i = 0; i < 40; i++) {
      const check = await send("Runtime.evaluate", {
        expression: `!!(document.getElementById("first-access-overlay") && document.getElementById("user-login-overlay") && document.getElementById("user-pin-change-overlay") && document.querySelector(".app-shell"))`
      }, sessionId);
      if (check.result?.value) {
        break;
      }
      await wait(500);
    }

    // Étape 2 : Vérifier contraintes DOM
    console.log("Étape 2 : Vérification contraintes DOM (siblings)...");
    const domCheck = await send("Runtime.evaluate", {
      returnByValue: true,
      expression: `(() => {
        const firstAccessOverlay = document.getElementById("first-access-overlay");
        const loginOverlay = document.getElementById("user-login-overlay");
        const pinChangeOverlay = document.getElementById("user-pin-change-overlay");
        const appShell = document.querySelector(".app-shell");
        if (!firstAccessOverlay || !loginOverlay || !pinChangeOverlay || !appShell) {
          return { ok: false, error: "Éléments requis introuvables dans le DOM" };
        }
        if (appShell.contains(firstAccessOverlay) || appShell.contains(loginOverlay) || appShell.contains(pinChangeOverlay)) {
          return { ok: false, error: "Les overlays sont enfants de .app-shell !" };
        }
        if (firstAccessOverlay.parentNode !== document.body || loginOverlay.parentNode !== document.body || pinChangeOverlay.parentNode !== document.body) {
          return { ok: false, error: "Les overlays ne sont pas enfants directs de body !" };
        }
        return { ok: true };
      })()`
    }, sessionId);
    assert.ok(domCheck.result.value.ok, `Contrainte DOM violée : ${domCheck.result.value.error}`);

    // Étape 3 : Créer explicitement le premier responsable, puis les techniciens
    console.log("Étape 3 : Premier accès explicite puis configuration des techniciens...");
    const firstAccess = await send("Runtime.evaluate", {
      awaitPromise: true,
      returnByValue: true,
      expression: `(async () => {
        const overlay = document.getElementById("first-access-overlay");
        const form = document.getElementById("first-access-form");
        if ((state.users || []).length !== 0) {
          return { ok: false, error: "Un utilisateur caché a été créé avant le premier accès" };
        }
        if (!form || overlay.hidden) {
          return { ok: false, error: "L'écran de premier accès explicite devrait être visible" };
        }
        form.elements.name.value = "Admin premier accès";
        form.elements.role.value = "admin_technique";
        form.elements.pin.value = "739251";
        form.elements.confirmPin.value = "739251";
        form.requestSubmit();
        for (let attempt = 0; attempt < 40; attempt += 1) {
          if (state.users.some(user => user.active !== false) && overlay.hidden) break;
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        const admin = state.users.find(user => user.canonicalRole === "admin_technique");
        if (!admin || state.currentUserId !== admin.id || !overlay.hidden) {
          return { ok: false, error: "La création explicite du premier responsable n'a pas abouti" };
        }
        return { ok: true, role: admin.role, canonicalRole: admin.canonicalRole };
      })()`
    }, sessionId);
    assert.ok(firstAccess.result.value.ok, `Échec premier accès explicite : ${JSON.stringify(firstAccess.result.value)}`);
    assert.equal(firstAccess.result.value.canonicalRole, "admin_technique");

    await send("Runtime.evaluate", {
      expression: `
        state.resources = [
          { id: "res-alaa", name: "Alaa", role: "tolier", active: true },
          { id: "res-karim", name: "Karim", role: "tolier", active: true }
        ];
        createUserLocal({ name: "Alaa", role: "technicien", resourceId: "res-alaa", email: "alaa@nimr.local", active: true });
        createUserLocal({ name: "Karim", role: "technicien", resourceId: "res-karim", email: "karim@nimr.local", active: true });
        
        // Ajouter deux utilisateurs doublons pour tester l'alerte en bypassant createUserLocal pour le second
        createUserLocal({ name: "Dup1", role: "reception", email: "dup@nimr.local", active: true });
        state.users.push({ id: "user-dup2", name: "Dup2", role: "reception", email: "dup@nimr.local", active: true, resourceId: "", authUserId: "", pinHash: "", pinSalt: "" });

        // Tâches
        state.bookings = [
          { id: "booking-alaa", caseId: "case-1", title: "Tâche Alaa", key: "body", resourceIds: ["res-alaa"], start: "2026-06-05T08:00:00", end: "2026-06-05T10:00:00", segments: [{ start: "2026-06-05T08:00:00", end: "2026-06-05T10:00:00" }] },
          { id: "booking-karim", caseId: "case-2", title: "Tâche Karim", key: "body", resourceIds: ["res-karim"], start: "2026-06-05T10:00:00", end: "2026-06-05T12:00:00", segments: [{ start: "2026-06-05T10:00:00", end: "2026-06-05T12:00:00" }] }
        ];
        state.cases = [
          { id: "case-1", clientName: "Client A", vehicle: "Clio", plate: "123-A", bookings: [state.bookings[0]], history: [], flags: { received: true } },
          { id: "case-2", clientName: "Client B", vehicle: "Megane", plate: "456-B", bookings: [state.bookings[1]], history: [], flags: { received: true } }
        ];

        saveState();
        render();
      `
    }, sessionId);
    await wait(500);

    // Étape 4 : Sélectionner le responsable explicite et saisir un PIN incorrect
    console.log("Étape 4 : Sélection admin, test PIN incorrect (et génération d'audit)...");
    const testIncorrectPin = await send("Runtime.evaluate", {
      awaitPromise: true,
      returnByValue: true,
      expression: `(async () => {
        checkUserSessionStartup();
        await new Promise(r => setTimeout(r, 100));

        const select = document.getElementById("user-login-select");
        const adminOption = Array.from(select.options).find(o => o.text.includes("Admin"));
        if (!adminOption) return { ok: false, error: "Option admin introuvable dans le select" };
        select.value = adminOption.value;
        select.dispatchEvent(new Event("change"));

        const pinInput = document.getElementById("user-login-pin");
        const loginForm = document.getElementById("user-login-form");
        const statusEl = document.getElementById("user-login-status");
        const selectedUser = state.users.find(user => user.id === select.value);

        // Tester PIN incorrect
        pinInput.value = "9999";
        loginForm.dispatchEvent(new Event("submit"));
        await new Promise(r => setTimeout(r, 100));

        if (!statusEl.textContent.includes("incorrect")) {
          return {
            ok: false,
            error: "Le PIN incorrect aurait dû afficher un message d'erreur",
            status: statusEl.textContent,
            selectedUser: selectedUser ? { id: selectedUser.id, role: selectedUser.role, hasPin: Boolean(selectedUser.pinHash) } : null
          };
        }

        const hasIncorrectAudit = state.auditLog.some(log => log.type === "users.pin_incorrect");
        if (!hasIncorrectAudit) {
          return { ok: false, error: "L'audit de type users.pin_incorrect est absent" };
        }

        return { ok: true };
      })()`
    }, sessionId);
    assert.ok(testIncorrectPin.result.value.ok, `Échec test PIN incorrect : ${JSON.stringify(testIncorrectPin.result.value)}`);

    // Étape 5 : Saisir le PIN robuste défini au premier accès
    console.log("Étape 5 : Connexion avec le PIN robuste du premier accès...");
    const testExplicitAdminLogin = await send("Runtime.evaluate", {
      awaitPromise: true,
      returnByValue: true,
      expression: `(async () => {
        const pinInput = document.getElementById("user-login-pin");
        const loginForm = document.getElementById("user-login-form");
        pinInput.value = "739251";
        loginForm.dispatchEvent(new Event("submit"));
        await new Promise(r => setTimeout(r, 300));

        const changeOverlay = document.getElementById("user-pin-change-overlay");
        const loginOverlay = document.getElementById("user-login-overlay");
        const appShell = document.querySelector(".app-shell");

        if (!loginOverlay.hidden || !changeOverlay.hidden) {
          return { ok: false, error: "Le PIN robuste devrait ouvrir directement l'application" };
        }
        if (appShell.hasAttribute("inert")) {
          return { ok: false, error: "L'application est restée en mode inert après connexion réussie" };
        }

        // Cliquer réellement sur Dossiers / Planning / Paramètres
        const tabDossiers = document.querySelector(".nav-button[data-tab='dossiers']");
        const tabPlanning = document.querySelector(".nav-button[data-tab='planning']");
        const tabParametres = document.querySelector(".nav-button[data-tab='atelier']");
        if (!tabDossiers || !tabPlanning || !tabParametres) {
          return { ok: false, error: "Boutons de navigation introuvables" };
        }

        tabDossiers.click();
        tabPlanning.click();
        tabParametres.click();

        return { ok: true };
      })()`
    }, sessionId);
    assert.ok(testExplicitAdminLogin.result.value.ok, `Échec connexion responsable explicite / Clics réels : ${testExplicitAdminLogin.result.value.error}`);

    // Étape 7 : Refresh -> Admin doit ressaisir son PIN
    console.log("Étape 7 : Refresh page -> Demande de PIN obligatoire pour admin...");
    await send("Page.navigate", { url: targetUrl }, sessionId);
    await wait(8000);

    const testRefreshAdmin = await send("Runtime.evaluate", {
      awaitPromise: true,
      returnByValue: true,
      expression: `(async () => {
        checkUserSessionStartup();
        await new Promise(r => setTimeout(r, 100));

        const loginOverlay = document.getElementById("user-login-overlay");
        if (loginOverlay.hidden) {
          return { ok: false, error: "L'écran de login devrait être affiché après refresh pour l'admin" };
        }

        // Taper le nouveau PIN robuste
        const select = document.getElementById("user-login-select");
        const adminOption = Array.from(select.options).find(o => o.text.includes("Admin"));
        select.value = adminOption.value;
        select.dispatchEvent(new Event("change"));

        const pinInput = document.getElementById("user-login-pin");
        const loginForm = document.getElementById("user-login-form");
        pinInput.value = "739251";
        loginForm.dispatchEvent(new Event("submit"));
        await new Promise(r => setTimeout(r, 200));

        if (!loginOverlay.hidden) {
          return { ok: false, error: "L'application aurait dû se déverrouiller avec le PIN robuste" };
        }
        return { ok: true };
      })()`
    }, sessionId);
    assert.ok(testRefreshAdmin.result.value.ok, `Échec test refresh admin : ${testRefreshAdmin.result.value.error}`);

    // Étape 8 : Retour login -> Choix technicien (se connecte directement sans PIN)
    console.log("Étape 8 : Choix technicien sans PIN...");
    const testTechnicianConnect = await send("Runtime.evaluate", {
      awaitPromise: true,
      returnByValue: true,
      expression: `(async () => {
        const changeBtn = document.getElementById("sidebar-change-user-btn");
        changeBtn.click();
        await new Promise(r => setTimeout(r, 100));

        const select = document.getElementById("user-login-select");
        const alaaOption = Array.from(select.options).find(o => o.text.includes("Alaa") && o.text.includes("Technicien"));
        if (!alaaOption) return { ok: false, error: "Option technicien Alaa introuvable" };
        select.value = alaaOption.value;
        select.dispatchEvent(new Event("change"));

        const loginForm = document.getElementById("user-login-form");
        loginForm.dispatchEvent(new Event("submit"));
        await new Promise(r => setTimeout(r, 200));

        const loginOverlay = document.getElementById("user-login-overlay");
        if (!loginOverlay.hidden) {
          return { ok: false, error: "Le technicien aurait dû se connecter directement sans PIN" };
        }

        return { ok: true };
      })()`
    }, sessionId);
    assert.ok(testTechnicianConnect.result.value.ok, `Échec connexion technicien : ${testTechnicianConnect.result.value.error}`);

    // Étape 9 : Isolation Alaa / Karim à l'affichage et dans les handlers
    console.log("Étape 9 : Vérification de l'isolation Alaa / Karim...");
    const testTechnicianIsolation = await send("Runtime.evaluate", {
      awaitPromise: true,
      returnByValue: true,
      expression: `(async () => {
        // Alaa connecté, ne doit voir que ses tâches
        const rows = getTechnicianTaskRows("res-alaa", new Date("2026-06-05"));
        if (!rows.some(r => r.id === "booking-alaa")) {
          return { ok: false, error: "Alaa devrait voir sa tâche" };
        }
        if (rows.some(r => r.id === "booking-karim")) {
          return { ok: false, error: "Alaa ne devrait pas voir la tâche de Karim !" };
        }

        // Essayer d'effectuer une action sur la tâche de Karim
        state.auditLog = [];
        const result = startTechnicianTask(state.cases.find(c => c.id === "case-2"), "booking-karim", "res-alaa");
        if (result.ok) {
          return { ok: false, error: "Alaa n'aurait pas dû être autorisé à modifier la tâche de Karim" };
        }

        const hasDeniedAudit = state.auditLog.some(log => log.type === "security.permission_denied");
        if (!hasDeniedAudit) {
          return { ok: false, error: "L'audit de violation de sécurité n'a pas été journalisé" };
        }

        return { ok: true };
      })()`
    }, sessionId);
    assert.ok(testTechnicianIsolation.result.value.ok, `Échec test isolation : ${testTechnicianIsolation.result.value.error}`);

    // Étape 10 : Vérification alertes doublons dans la gestion utilisateur
    console.log("Étape 10 : Vérification alertes doublons de comptes actifs...");
    const testDuplicateAlerts = await send("Runtime.evaluate", {
      awaitPromise: true,
      returnByValue: true,
      expression: `(async () => {
        // Se reconnecter en admin pour avoir accès à la gestion utilisateur
        const changeBtn = document.getElementById("sidebar-change-user-btn");
        changeBtn.click();
        await new Promise(r => setTimeout(r, 100));

        const select = document.getElementById("user-login-select");
        const adminOption = Array.from(select.options).find(o => o.text.includes("Admin"));
        select.value = adminOption.value;
        select.dispatchEvent(new Event("change"));

        const pinInput = document.getElementById("user-login-pin");
        const loginForm = document.getElementById("user-login-form");
        pinInput.value = "739251";
        loginForm.dispatchEvent(new Event("submit"));
        await new Promise(r => setTimeout(r, 200));

        // Rendre les utilisateurs et rôles dans le panneau admin
        renderUsersAndRoles();
        await new Promise(r => setTimeout(r, 100));

        const alertContainer = document.getElementById("users-duplicates-alert");
        if (alertContainer.hidden || !alertContainer.textContent.includes("Avertissement")) {
          return { ok: false, error: "L'alerte doublons n'est pas affichée dans l'interface de gestion" };
        }

        // Essayer de créer un autre doublon de manière illicite via createUserLocal
        const createDuplicateRes = createUserLocal({ name: "Dup3", role: "reception", email: "dup@nimr.local", active: true });
        if (createDuplicateRes.ok) {
          return { ok: false, error: "La création de doublons actifs (même email + rôle) aurait dû être rejetée" };
        }

        return { ok: true };
      })()`
    }, sessionId);
    assert.ok(testDuplicateAlerts.result.value.ok, `Échec tests doublons : ${testDuplicateAlerts.result.value.error}`);

    console.log("TOUS LES TESTS NAVIGATEUR REEL REUSSIS AVEC SUCCES !");
    await send("Target.closeTarget", { targetId }).catch(() => null);
  } finally {
    socket?.close?.();
    chrome.kill();
    server?.close?.();
  }
}

main().catch((error) => {
  console.error("Test en échec :", error);
  process.exit(1);
});
