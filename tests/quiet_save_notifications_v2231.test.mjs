import assert from 'node:assert/strict';
import fs from 'node:fs';

const stateJs = fs.readFileSync('js/state.js', 'utf8');
const swJs = fs.readFileSync('sw.js', 'utf8');
const versionJs = fs.readFileSync('js/version.js', 'utf8');
const appJs = fs.readFileSync('app.js', 'utf8');
const uiCasesJs = fs.readFileSync('js/ui-cases.js', 'utf8');
const syncJs = fs.readFileSync('js/supabase-sync.js', 'utf8');

console.log("Démarrage des tests v22.33 : Notifications de sauvegarde silencieuse...");

// Test 1: Versions et Caches
assert.match(stateJs, /APP_VERSION\s*=\s*"v22\.35"/, "state.js n'a pas la bonne version");
assert.match(swJs, /nimr-sav-v22\.35-production-audit-hardening/, "sw.js n'a pas le bon cache");
assert.match(versionJs, /NIMR_BUILD\s*=\s*"v22\.35"/, "version.js n'a pas la bonne version");
assert.match(appJs, /sw\.js\?v=22\.35/, "app.js n'appelle pas le bon sw.js");

// Test 2: saveState normal
assert.match(stateJs, /if \(typeof renderSyncStatusStrip === "function"\) renderSyncStatusStrip\(\);/, "saveState n'appelle pas renderSyncStatusStrip");
assert.match(stateJs, /if \(typeof updateSaveStatusIndicator === "function"\) updateSaveStatusIndicator\("Sauvegardé", "saved"\);/, "saveState n'appelle pas updateSaveStatusIndicator");

const saveStateMatch = stateJs.match(/function saveState\([\s\S]*?catch \(/);
if (saveStateMatch && saveStateMatch[0].includes('notifyUser')) {
  assert.fail("saveState contient encore notifyUser en cas de succès");
}

// Test 3: saveState erreur
const catchBlock = stateJs.match(/catch \(error\) \{[\s\S]*?notifyUser[\s\S]*?\}/);
assert.ok(catchBlock !== null, "Le block catch de saveState doit contenir notifyUser");
assert.ok(catchBlock[0].includes('"error"'), "Le block catch de saveState doit émettre une erreur");

// Test 4: quietNotify
const quietNotifyContent = stateJs.match(/function quietNotify\([\s\S]*?updateSaveStatusIndicator/);
assert.ok(quietNotifyContent !== null, "quietNotify est introuvable");
assert.ok(quietNotifyContent[0].includes('notifyUser(message, variant)'), "quietNotify ne délègue pas à notifyUser pour error/warn");
assert.ok(quietNotifyContent[0].includes('variant === "error" || variant === "warn"'), "quietNotify ne filtre pas bien warn/error");

// Test 5: updateSaveStatusIndicator timeout
const fnMatch = stateJs.match(/function updateSaveStatusIndicator\([\s\S]*?\}\s*\}/);
assert.ok(fnMatch !== null, "updateSaveStatusIndicator est introuvable");
assert.ok(fnMatch[0].includes('setTimeout'), "Pas de timeout pour reset le statut");
assert.ok(fnMatch[0].includes('status-saved'), "Pas de reset CSS status-saved");

// Test 6: Actions technicien/UI utilisent quietNotify
const btnActionMatch = uiCasesJs.match(/function handleBookingTaskAction\([\s\S]*?render/);
assert.ok(btnActionMatch !== null, "handleBookingTaskAction introuvable");
assert.ok(btnActionMatch[0].includes('quietNotify'), "handleBookingTaskAction doit utiliser quietNotify");

// Test 7: Sync et Hors ligne
assert.ok(appJs.includes('quietNotify("Connexion rétablie. La synchronisation Supabase va reprendre.", "success")'), "Connexion rétablie non convertie");
assert.ok(appJs.includes('quietNotify("Mode hors ligne actif. Les données locales restent consultables.", "offline")'), "Mode hors ligne non converti");
assert.ok(syncJs.includes('quietNotify("Mise à jour reçue depuis un autre poste.", "info")'), "Sync entrante sans conflit non convertie");

// Test 8: Utilisateur courant
assert.ok(appJs.includes('quietNotify("Utilisateur actif mis à jour.", "success")'), "Changement utilisateur actif non converti");

// Test 9: Toasts maintenus pour actions sensibles
assert.ok(syncJs.includes('notifyUser("Données et réglages restaurés depuis Supabase.", "success")'), "Restauration cloud doit garder son toast");
assert.ok(syncJs.includes('notifyUser("Conflit de synchronisation détecté — données locales conservées.", "warn")'), "Conflit sync doit garder son toast");

console.log("Tests v22.33 compilés avec succès.");
