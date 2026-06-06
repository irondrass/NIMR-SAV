import assert from "node:assert/strict";
import fs from "node:fs";

const indexSource = fs.readFileSync("index.html", "utf8");
const appSource = fs.readFileSync("app.js", "utf8");
const stateSource = fs.readFileSync("js/state.js", "utf8");
const uiCasesSource = fs.readFileSync("js/ui-cases.js", "utf8");
const uiReceptionSource = fs.readFileSync("js/ui-reception.js", "utf8");
const stylesSource = fs.readFileSync("styles.css", "utf8");

console.log("Demarrage tests v23.1.7 UX/accessibility/security hardening...");

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function assertNoExecutablePayload(rendered, label) {
  assert.equal(/<script\b/i.test(rendered), false, `${label}: script tag actif`);
  assert.equal(/<img\b/i.test(rendered), false, `${label}: balise img active`);
  assert.equal(/<[^>]+\son\w+=/i.test(rendered), false, `${label}: attribut evenement actif`);
  assert.equal(/<[^>]+\b(?:href|src)=["']?javascript:/i.test(rendered), false, `${label}: URL javascript active`);
}

const payload = `<img src=x onerror=alert("xss")><script>alert(1)</script><a href="javascript:alert(2)">x</a>`;
const xssSamples = [
  ["champ client", `<strong>${escapeHtml(payload)}</strong>`],
  ["notes", `<p>${escapeHtml(payload)}</p>`],
  ["reclamations", `<li>${escapeHtml(payload)}</li>`],
  ["journal", `<small>${escapeHtml(payload)}</small>`],
];
xssSamples.forEach(([label, rendered]) => assertNoExecutablePayload(rendered, label));

[
  ["client reception", uiReceptionSource, "${escapeHtml(item.clientName)}"],
  ["notes reception", uiReceptionSource, "${escapeHtml(n.text)}"],
  ["reclamations reception", uiReceptionSource, "${escapeHtml(claim.text || claim.title)}"],
  ["commentaires reclamations", uiReceptionSource, "${escapeHtml(comment.text)}"],
  ["journal dossier label", uiCasesSource, "${escapeHtml(entry.label)}"],
  ["journal dossier details", uiCasesSource, "${escapeHtml(entry.details)}"],
  ["journal audit label", appSource, "${escapeHtml(log.label)}"],
  ["journal audit details", appSource, "${escapeHtml(log.details)}"],
].forEach(([label, source, expected]) => {
  assert.ok(source.includes(expected), `${label}: rendu attendu avec escapeHtml`);
});

assert.equal(
  /body\.innerHTML\s*=\s*`<div>\$\{message\}/.test(stateSource),
  false,
  "showInputPromptModal ne doit plus injecter message en innerHTML",
);
assert.ok(stateSource.includes("appendSafeModalMessage(messageWrap, message)"), "showInputPromptModal doit passer par le helper de message sur");
assert.ok(stateSource.includes("document.createElement(\"select\")"), "showInputPromptModal doit construire les select via DOM API");
assert.ok(stateSource.includes("document.createElement(\"input\")"), "showInputPromptModal doit construire les input via DOM API");

assert.ok(stylesSource.includes(":focus-visible"), "styles.css doit definir un focus-visible global");
assert.ok(stylesSource.includes("outline: 3px solid #f59e0b"), "focus-visible doit etre fortement visible");
assert.ok(stylesSource.includes(".local-lock-dialog:focus-within"), "les dialogues login/PIN doivent recevoir un focus visuel");

const sidebarNav = indexSource.match(/<nav class="sidebar-nav"[\s\S]*?<\/nav>/)?.[0] || "";
const sidebarSvgs = [...sidebarNav.matchAll(/<svg\b[^>]*>/g)].map((match) => match[0]);
assert.ok(sidebarSvgs.length >= 7, "la navigation principale doit contenir les SVG attendus");
sidebarSvgs.forEach((svg) => assert.ok(svg.includes('aria-hidden="true"'), `SVG decoratif sans aria-hidden: ${svg}`));

assert.ok(indexSource.includes("Réception guidée"), "libelle Reception guidee attendu");
assert.ok(indexSource.includes("Dossier complet"), "libelle Dossier complet attendu");
assert.ok(indexSource.includes("Le PIN protège l’interface locale, mais ne chiffre pas les données locales."), "avertissement PIN attendu");
assert.ok(stateSource.includes("Le PIN protège l’interface locale, mais ne chiffre pas les données locales."), "statut PIN local attendu");

assert.ok(appSource.includes("focusUserSessionDialog(overlay, \"#user-login-select\")"), "login: focus initial sur select attendu");
assert.ok(appSource.includes("focusUserSessionDialog(overlay, \"input[name='newPin']\")"), "PIN: focus initial sur nouveau PIN attendu");
assert.ok(appSource.includes("trapFocusWithin(form, event)"), "login/PIN: tab order doit etre piege dans le dialogue");
assert.ok(appSource.includes('event.key === "Escape" && overlay.id === "user-pin-change-overlay"'), "PIN: Escape doit fermer si applicable");
assert.ok(appSource.includes("restoreUserSessionReturnFocus()"), "login/PIN: retour focus attendu");

assert.ok(appSource.includes("Utilisateur inactif ou invalide. Sélectionnez un compte actif."), "message login utilisateur invalide attendu");
assert.ok(appSource.includes("PIN incorrect. Vérifiez le code du compte sélectionné."), "message PIN incorrect attendu");
assert.ok(appSource.includes("Le nom du client est obligatoire pour créer un dossier. Renseignez le propriétaire ou la société."), "message donnees invalides client attendu");
assert.ok(appSource.includes("Renseignez au moins le véhicule, l'immatriculation ou le VIN avant de créer le dossier."), "message donnees invalides vehicule attendu");
assert.ok(stateSource.includes("Configuration Supabase réservée administrateur. Connectez-vous avec un administrateur technique."), "message permission Supabase attendu");

console.log("Tests v23.1.7 UX/accessibility/security hardening OK");
