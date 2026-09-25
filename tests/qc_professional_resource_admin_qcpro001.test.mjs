import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const appSource = fs.readFileSync(
  new URL("../app.js", import.meta.url),
  "utf8"
);

const uiSource = fs.readFileSync(
  new URL("../js/ui-planning.js", import.meta.url),
  "utf8"
);

const edgeSource = fs.readFileSync(
  new URL(
    "../supabase/functions/workshop-user-admin/index.ts",
    import.meta.url
  ),
  "utf8"
);

test("QC-PRO D3b.1 — invitation connaît les rôles liés à une ressource", () => {
  assert.match(
    appSource,
    /(?:WORKSHOP_INVITE_RESOURCE_ROLES|RESOURCE_LINKED_INVITE_ROLES)/u
  );

  assert.match(
    appSource,
    /(?:WORKSHOP_INVITE_REQUIRED_RESOURCE_ROLES|RESOURCE_REQUIRED_INVITE_ROLES)/u
  );

  for (const role of [
    "technicien",
    "controle_qualite",
    "chef_atelier",
  ]) {
    assert.match(
      appSource,
      new RegExp(`["']${role}["']`, "u")
    );
  }
});

test("QC-PRO D3b.2 — QC exige une ressource, Chef Atelier peut en avoir une en fallback", () => {
  assert.match(
    appSource,
    /(?:WORKSHOP_INVITE_REQUIRED_RESOURCE_ROLES|RESOURCE_REQUIRED_INVITE_ROLES)[^;]*technicien/isu
  );

  assert.match(
    appSource,
    /(?:WORKSHOP_INVITE_REQUIRED_RESOURCE_ROLES|RESOURCE_REQUIRED_INVITE_ROLES)[^;]*controle_qualite/isu
  );

  assert.match(
    appSource,
    /(?:WORKSHOP_INVITE_RESOURCE_ROLES|RESOURCE_LINKED_INVITE_ROLES)\.has\s*\(\s*inviteRole\?\.value\s*\)/u
  );

  assert.match(
    appSource,
    /(?:WORKSHOP_INVITE_REQUIRED_RESOURCE_ROLES|RESOURCE_REQUIRED_INVITE_ROLES)\.has\s*\(\s*inviteRole\?\.value\s*\)/u
  );
});

test("QC-PRO D3b.3 — l'invitation envoie resource_id pour QC et Chef liés", () => {
  assert.match(
    appSource,
    /resource_id:\s*(?:WORKSHOP_INVITE_RESOURCE_ROLES|RESOURCE_LINKED_INVITE_ROLES)\.has\s*\(\s*inviteRole\?\.value\s*\)/u
  );

  assert.doesNotMatch(
    appSource,
    /resource_id:\s*inviteRole\?\.value\s*===\s*["']technicien["']/u
  );
});

test("QC-PRO D3b.4 — la liste des comptes permet la liaison technicien / QC / Chef", () => {
  assert.match(
    uiSource,
    /RESOURCE_LINKED_ACCOUNT_ROLES/u
  );

  assert.match(
    uiSource,
    /RESOURCE_REQUIRED_ACCOUNT_ROLES/u
  );

  assert.match(
    uiSource,
    /RESOURCE_LINKED_ACCOUNT_ROLES\.has\s*\(\s*canonicalRole\s*\)/u
  );

  assert.doesNotMatch(
    uiSource,
    /canLinkResource\s*=\s*[^;]*canonicalRole\s*===\s*["']technicien["']/u
  );
});

test("QC-PRO D3b.5 — le handler de liaison n'est plus verrouillé sur technicien", () => {
  assert.match(
    uiSource,
    /RESOURCE_LINKED_ACCOUNT_ROLES\.has\s*\(\s*getCanonicalUserRole\s*\(\s*user\s*\)\s*\)/u
  );

  assert.doesNotMatch(
    uiSource,
    /getCanonicalUserRole\s*\(\s*user\s*\)\s*!==\s*["']technicien["']/u
  );

  assert.doesNotMatch(
    uiSource,
    /member\.role\s*!==\s*["']technicien["']/u
  );
});

test("QC-PRO D3b.6 — QC et Chef Atelier ne peuvent choisir qu'une ressource controle", () => {
  assert.match(
    uiSource,
    /controle_qualite/u
  );

  assert.match(
    uiSource,
    /chef_atelier/u
  );

  assert.match(
    uiSource,
    /resource\.type\s*===\s*["']controle["']/u
  );
});

test("QC-PRO D3b.7 — diagnostic compte : ressource requise pour technicien et QC seulement", () => {
  assert.match(
    uiSource,
    /RESOURCE_REQUIRED_ACCOUNT_ROLES\.has\s*\(\s*model\.serverRole\s*\)/u
  );

  assert.match(
    uiSource,
    /RESOURCE_REQUIRED_ACCOUNT_ROLES[^;]*technicien/isu
  );

  assert.match(
    uiSource,
    /RESOURCE_REQUIRED_ACCOUNT_ROLES[^;]*controle_qualite/isu
  );
});

test("QC-PRO D3b.8 — compatibilité historique technicien conservée côté Edge", () => {
  assert.match(
    edgeSource,
    /role\s*===\s*["']technicien["'][\s\S]{0,500}TECHNICIAN_RESOURCE_REQUIRED/u,
    "l'ancien code d'erreur technicien doit rester compatible"
  );

  assert.match(
    edgeSource,
    /RESOURCE_REQUIRED_WORKSHOP_ROLES/u
  );

  assert.match(
    edgeSource,
    /controle_qualite/u
  );

  assert.match(
    edgeSource,
    /if\s*\(\s*!RESOURCE_LINKED_WORKSHOP_ROLES\.has\s*\(\s*role\s*\)\s*\)[\s\S]{0,150}resourceId:\s*null/u
  );
});

console.log(
  "QC-PRO-001 D3b RESOURCE ADMIN CONTRACT COMPLETE"
);
