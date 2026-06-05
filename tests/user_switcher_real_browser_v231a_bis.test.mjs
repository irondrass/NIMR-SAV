import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";

console.log("Démarrage des tests v23.1A-bis : Real Browser User Switcher (CDP)...");

const root = resolve(process.cwd());
const defaultPort = Number(process.env.NIMR_BROWSER_TEST_PORT || 8788);
const targetUrl = process.env.NIMR_BROWSER_TEST_URL || `http://127.0.0.1:${defaultPort}/?browser-switcher-test=v23.1a-bis`;
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
      // Chrome starting...
    }
    await wait(250);
  }
  throw new Error("Chrome DevTools Protocol indisponible.");
}

async function main() {
  if (!chromePath) {
    console.log("Real browser user switcher test SKIPPED: Chrome/Edge introuvable.");
    return;
  }

  const server = await startStaticServer();
  const port = Number(process.env.NIMR_CDP_PORT || 9236);
  const profile = join(tmpdir(), `nimr-browser-switcher-${Date.now()}`);
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

    // Étape 1 : Réinitialiser localStorage / sessionStorage pour un état propre
    console.log("Étape 1 : Reset et setup...");
    await send("Runtime.evaluate", {
      awaitPromise: true,
      expression: `
        localStorage.clear();
        sessionStorage.clear();
        location.reload();
      `
    }, sessionId);
    await wait(6000);

    // Étape 2 : Vérification contrainte DOM (sibling)
    console.log("Étape 2 : Vérification contraintes DOM (siblings)...");
    const domCheck = await send("Runtime.evaluate", {
      returnByValue: true,
      expression: `(() => {
        const selectorOverlay = document.getElementById("user-selector-overlay");
        const pinOverlay = document.getElementById("user-pin-overlay");
        const pinChangeOverlay = document.getElementById("user-pin-change-overlay");
        const appShell = document.querySelector(".app-shell");
        if (!selectorOverlay || !pinOverlay || !pinChangeOverlay || !appShell) {
          return { ok: false, error: "DOM éléments manquants" };
        }
        if (appShell.contains(selectorOverlay) || appShell.contains(pinOverlay) || appShell.contains(pinChangeOverlay)) {
          return { ok: false, error: "Les overlays sont des enfants de .app-shell !" };
        }
        if (selectorOverlay.parentNode !== document.body || pinOverlay.parentNode !== document.body || pinChangeOverlay.parentNode !== document.body) {
          return { ok: false, error: "Les overlays ne sont pas des enfants directs de body !" };
        }
        return { ok: true };
      })()`
    }, sessionId);

    assert.ok(domCheck.result.value.ok, `Contrainte DOM violée : ${domCheck.result.value.error}`);

    // Créer une ressource et un technicien programmation
    console.log("Étape 3 : Création d'un utilisateur technicien pour le test...");
    await send("Runtime.evaluate", {
      expression: `
        state.resources.push({ id: "res-test-tech", name: "Alaa Tech", role: "tolier", active: true });
        createUserLocal({ name: "Alaa Tech", role: "technicien", resourceId: "res-test-tech", active: true });
        saveState();
        render();
      `
    }, sessionId);
    await wait(500);

    // Étape 4 : Sélectionner l'admin bootstrap et valider le PIN 0000
    console.log("Étape 4 : Sélection admin et PIN bootstrap 0000...");
    const adminSelect = await send("Runtime.evaluate", {
      awaitPromise: true,
      returnByValue: true,
      expression: `(async () => {
        // Forcer le rendu du sélecteur
        checkUserSessionStartup();
        await new Promise(r => setTimeout(r, 100));
        const cards = Array.from(document.querySelectorAll(".user-selector-card"));
        const adminCard = cards.find(c => c.textContent.includes("Administrateur") || c.textContent.includes("Admin"));
        if (!adminCard) return { ok: false, error: "Carte admin introuvable" };
        adminCard.click();
        const submitBtn = document.getElementById("user-selector-submit");
        submitBtn.click();
        await new Promise(r => setTimeout(r, 100));
        
        const selectorOverlay = document.getElementById("user-selector-overlay");
        const pinOverlay = document.getElementById("user-pin-overlay");
        if (!selectorOverlay.hidden) return { ok: false, error: "Le sélecteur devrait être caché" };
        if (pinOverlay.hidden) return { ok: false, error: "L'overlay PIN devrait être visible" };
        
        return { ok: true };
      })()`
    }, sessionId);

    assert.ok(adminSelect.result.value.ok, `Échec sélection admin : ${adminSelect.result.value.error}`);

    // Étape 5 : Entrer 0000 -> changement de PIN obligatoire
    console.log("Étape 5 : Saisie 0000 et écran changement PIN...");
    const pinBootstrapSubmit = await send("Runtime.evaluate", {
      awaitPromise: true,
      returnByValue: true,
      expression: `(async () => {
        const pinOverlay = document.getElementById("user-pin-overlay");
        const pinInput = pinOverlay.querySelector("input[name='pin']");
        pinInput.value = "0000";
        const pinForm = document.getElementById("user-pin-form");
        pinForm.dispatchEvent(new Event("submit"));
        await new Promise(r => setTimeout(r, 100));
        
        const pinChangeOverlay = document.getElementById("user-pin-change-overlay");
        if (!pinOverlay.hidden) return { ok: false, error: "L'overlay PIN devrait être caché" };
        if (pinChangeOverlay.hidden) return { ok: false, error: "L'overlay changement PIN devrait être visible" };
        
        return { ok: true };
      })()`
    }, sessionId);

    assert.ok(pinBootstrapSubmit.result.value.ok, `Échec transition changement PIN : ${pinBootstrapSubmit.result.value.error}`);

    // Étape 6 : Changer le PIN en 1234
    console.log("Étape 6 : Enregistrement du nouveau PIN (1234)...");
    const pinChange = await send("Runtime.evaluate", {
      awaitPromise: true,
      returnByValue: true,
      expression: `(async () => {
        const changeOverlay = document.getElementById("user-pin-change-overlay");
        const newPinInput = changeOverlay.querySelector("input[name='newPin']");
        const confirmInput = changeOverlay.querySelector("input[name='confirmNewPin']");
        newPinInput.value = "1234";
        confirmInput.value = "1234";
        
        const changeForm = document.getElementById("user-pin-change-form");
        changeForm.dispatchEvent(new Event("submit"));
        await new Promise(r => setTimeout(r, 200));
        
        // Tout doit être caché, shell non-inert
        const selectorOverlay = document.getElementById("user-selector-overlay");
        const pinOverlay = document.getElementById("user-pin-overlay");
        const appShell = document.querySelector(".app-shell");
        
        if (!selectorOverlay.hidden || !pinOverlay.hidden || !changeOverlay.hidden) {
          return { ok: false, error: "Les overlays n'ont pas été cachés après modification du PIN" };
        }
        if (appShell.hasAttribute("inert")) {
          return { ok: false, error: "L'app-shell est resté inert après déverrouillage" };
        }
        
        // Clic sur navigation pour valider l'activité de l'UI
        const dossiersBtn = document.querySelector(".nav-button[data-tab='dossiers']");
        const planningBtn = document.querySelector(".nav-button[data-tab='planning']");
        if (!dossiersBtn || !planningBtn) return { ok: false, error: "Boutons de navigation introuvables" };
        dossiersBtn.click();
        planningBtn.click();
        
        return { ok: true };
      })()`
    }, sessionId);

    assert.ok(pinChange.result.value.ok, `Échec changement PIN final : ${pinChange.result.value.error}`);

    // Étape 7 : Retour sélecteur + bascule technicien (sans PIN)
    console.log("Étape 7 : Bascule technicien (sans PIN)...");
    const switchTech = await send("Runtime.evaluate", {
      awaitPromise: true,
      returnByValue: true,
      expression: `(async () => {
        const changeBtn = document.getElementById("sidebar-change-user-btn");
        if (!changeBtn) return { ok: false, error: "Bouton changement utilisateur absent" };
        changeBtn.click();
        await new Promise(r => setTimeout(r, 100));
        
        if (sessionStorage.getItem("nimr-user-pin-unlocked")) {
          return { ok: false, error: "sessionStorage nimr-user-pin-unlocked n'a pas été purgé au retour sélecteur" };
        }
        
        const cards = Array.from(document.querySelectorAll(".user-selector-card"));
        const techCard = cards.find(c => c.textContent.includes("Alaa Tech"));
        if (!techCard) return { ok: false, error: "Carte technicien introuvable" };
        techCard.click();
        
        const submitBtn = document.getElementById("user-selector-submit");
        submitBtn.click();
        await new Promise(r => setTimeout(r, 150));
        
        // Doit s'être connecté sans PIN
        const selectorOverlay = document.getElementById("user-selector-overlay");
        const pinOverlay = document.getElementById("user-pin-overlay");
        if (!selectorOverlay.hidden || !pinOverlay.hidden) {
          return { ok: false, error: "Le technicien aurait dû se connecter directement sans PIN" };
        }
        
        return { ok: true };
      })()`
    }, sessionId);

    assert.ok(switchTech.result.value.ok, `Échec bascule technicien : ${switchTech.result.value.error}`);

    // Étape 8 : Retour sélecteur + admin (le PIN 1234 doit être demandé, 0000 refusé)
    console.log("Étape 8 : Retour admin, 0000 refusé et 1234 accepté...");
    const pinVerificationFinal = await send("Runtime.evaluate", {
      awaitPromise: true,
      returnByValue: true,
      expression: `(async () => {
        const changeBtn = document.getElementById("sidebar-change-user-btn");
        changeBtn.click();
        await new Promise(r => setTimeout(r, 100));
        
        const cards = Array.from(document.querySelectorAll(".user-selector-card"));
        const adminCard = cards.find(c => c.textContent.includes("Administrateur") || c.textContent.includes("Admin"));
        adminCard.click();
        
        const submitBtn = document.getElementById("user-selector-submit");
        submitBtn.click();
        await new Promise(r => setTimeout(r, 100));
        
        const pinOverlay = document.getElementById("user-pin-overlay");
        const pinInput = pinOverlay.querySelector("input[name='pin']");
        const pinForm = document.getElementById("user-pin-form");
        const statusEl = document.getElementById("user-pin-status");
        
        // Tester 0000
        pinInput.value = "0000";
        pinForm.dispatchEvent(new Event("submit"));
        await new Promise(r => setTimeout(r, 100));
        
        if (!statusEl.textContent.includes("incorrect")) {
          return { ok: false, error: "Le PIN bootstrap 0000 ne devrait plus fonctionner !" };
        }
        
        // Tester 1234
        pinInput.value = "1234";
        pinForm.dispatchEvent(new Event("submit"));
        await new Promise(r => setTimeout(r, 200));
        
        const selectorOverlay = document.getElementById("user-selector-overlay");
        if (!selectorOverlay.hidden || !pinOverlay.hidden) {
          return { ok: false, error: "Le nouveau PIN 1234 n'a pas déverrouillé l'application" };
        }
        
        return { ok: true };
      })()`
    }, sessionId);

    assert.ok(pinVerificationFinal.result.value.ok, `Échec vérification PIN final : ${pinVerificationFinal.result.value.error}`);

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
