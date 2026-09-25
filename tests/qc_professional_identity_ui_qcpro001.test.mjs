import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const appSource = fs.readFileSync(
  new URL("../app.js", import.meta.url),
  "utf8"
);

const planningUiSource = fs.readFileSync(
  new URL("../js/ui-planning.js", import.meta.url),
  "utf8"
);

const stateSource = fs.readFileSync(
  new URL("../js/state.js", import.meta.url),
  "utf8"
);

test("QC-PRO D3.11.1 — invitation : les rôles liés à une ressource sont explicites", () => {
  assert.match(
    appSource,
    /WORKSHOP_INVITE_RESOURCE_ROLES/u
  );

  assert.match(
    appSource,
    /["']technicien["']/u
  );

  assert.match(
    appSource,
    /["']controle_qualite["']/u
  );

  assert.match(
    appSource,
    /["']chef_atelier["']/u
  );
});

test("QC-PRO D3.11.2 — QC exige une ressource à l'invitation, Chef Atelier peut l'avoir en option", () => {
  assert.match(
    appSource,
    /WORKSHOP_INVITE_REQUIRED_RESOURCE_ROLES/u
  );

  assert.match(
    appSource,
    /WORKSHOP_INVITE_REQUIRED_RESOURCE_ROLES\.has\s*\(\s*inviteRole\?\.value\s*\)/u
  );

  assert.match(
    appSource,
    /WORKSHOP_INVITE_RESOURCE_ROLES\.has\s*\(\s*inviteRole\?\.value\s*\)/u
  );
});

test("QC-PRO D3.11.3 — l'invitation transmet resource_id pour QC et Chef, pas uniquement technicien", () => {
  assert.doesNotMatch(
    appSource,
    /resource_id:\s*inviteRole\?\.value\s*===\s*["']technicien["']/u
  );

  assert.match(
    appSource,
    /resource_id:\s*WORKSHOP_INVITE_RESOURCE_ROLES\.has/iu
  );
});

test("QC-PRO D3.11.4 — les ressources proposées sont filtrées selon le rôle", () => {
  assert.match(
    appSource,
    /resource\.type\s*===\s*["']controle["']/u
  );

  assert.match(
    appSource,
    /controle_qualite/u
  );

  assert.match(
    appSource,
    /chef_atelier/u
  );
});

test("QC-PRO D3.11.5 — Gestion des comptes peut rattacher QC et Chef à une ressource", () => {
  assert.match(
    planningUiSource,
    /WORKSHOP_RESOURCE_LINK_ROLES/u
  );

  assert.match(
    planningUiSource,
    /WORKSHOP_RESOURCE_LINK_ROLES\.has\s*\(\s*canonicalRole\s*\)/u
  );

  assert.doesNotMatch(
    planningUiSource,
    /canRenderOffboardAction\s*&&\s*canonicalRole\s*===\s*["']technicien["']/u
  );
});

test("QC-PRO D3.11.6 — le bouton de rattachement n'est plus techniquement réservé au technicien", () => {
  assert.match(
    planningUiSource,
    /data-link-workshop-resource/u
  );

  assert.doesNotMatch(
    planningUiSource,
    /data-link-technician-resource/u
  );
});

test("QC-PRO D3.11.7 — la confirmation serveur accepte le rôle réel du membre", () => {
  assert.doesNotMatch(
    planningUiSource,
    /result\.member\?\.role\s*!==\s*["']technicien["']/u
  );

  assert.match(
    planningUiSource,
    /result\.member\?\.role\s*!==\s*member\.role/u
  );
});

test("QC-PRO D3.11.8 — QC et Chef utilisent uniquement une ressource controle", () => {
  assert.match(
    planningUiSource,
    /["']controle_qualite["']\s*,\s*["']chef_atelier["']/u
  );

  assert.match(
    planningUiSource,
    /resource\.type\s*===\s*["']controle["']/u
  );
});

test("QC-PRO D3.11.9 — le diagnostic identité considère la ressource obligatoire pour QC", () => {
  assert.match(
    stateSource,
    /RESOURCE_REQUIRED_ACCOUNT_ROLES/u
  );

  assert.match(
    stateSource,
    /["']technicien["']/u
  );

  assert.match(
    stateSource,
    /["']controle_qualite["']/u
  );

  assert.match(
    stateSource,
    /RESOURCE_REQUIRED_ACCOUNT_ROLES\.has\s*\(\s*serverRole\s*\)/u
  );
});

test("QC-PRO D3.11.10 — Chef Atelier sans ressource reste autorisé comme manager", () => {
  assert.doesNotMatch(
    stateSource,
    /RESOURCE_REQUIRED_ACCOUNT_ROLES[\s\S]{0,200}["']chef_atelier["']/u,
    "Chef Atelier ne doit pas être bloqué comme manager s'il n'exécute pas de fallback QC"
  );
});

console.log(
  "QC-PRO-001 D3.11 IDENTITY UI COHERENCE CONTRACT COMPLETE"
);
