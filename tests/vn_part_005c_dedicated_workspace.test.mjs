import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const WORKDIR = process.cwd();

const stateJsContent = fs.readFileSync(
  path.join(WORKDIR, "js", "state.js"),
  "utf8"
);

function extractObjectBlock(constName) {
  const match = stateJsContent.match(
    new RegExp(`const\\s+${constName}\\s*=\\s*\\{([\\s\\S]*?)\\};`, "u")
  );

  assert.ok(
    match,
    `${constName} definition must exist in js/state.js`
  );

  return match[1];
}

function extractRoleTabs(role) {
  const block = extractObjectBlock("ROLE_TABS");

  const match = block.match(
    new RegExp(
      `(?:^|\\n)\\s*${role}\\s*:\\s*\\[([^\\]]*)\\]`,
      "u"
    )
  );

  assert.ok(
    match,
    `ROLE_TABS entry missing for ${role}`
  );

  return Array.from(
    match[1].matchAll(/["']([^"']+)["']/gu),
    (m) => m[1]
  );
}

function extractDefaultTab(role) {
  const block = extractObjectBlock("ROLE_DEFAULT_TABS");

  const match = block.match(
    new RegExp(
      `(?:^|\\n)\\s*${role}\\s*:\\s*["']([^"']+)["']`,
      "u"
    )
  );

  assert.ok(
    match,
    `ROLE_DEFAULT_TABS entry missing for ${role}`
  );

  return match[1];
}

// ============================================================================
// 1. Directeur Pièces — dedicated workspace
// ============================================================================

test("005C-1: directeur_pieces can access only vn-part", () => {
  assert.deepEqual(
    extractRoleTabs("directeur_pieces"),
    ["vn-part"],
    "RBAC005C_RED_DIRECTEUR_PIECES_NOT_DEDICATED"
  );
});

// ============================================================================
// 2. Responsable Magasin — dedicated workspace
// ============================================================================

test("005C-2: responsable_magasin can access only vn-part", () => {
  assert.deepEqual(
    extractRoleTabs("responsable_magasin"),
    ["vn-part"],
    "RBAC005C_RED_MAGASIN_NOT_DEDICATED"
  );
});

// ============================================================================
// 3. Responsable Qualité / Chef de Parc VN — dedicated workspace
// ============================================================================

test("005C-3: responsable_qualite_parc_vn can access only vn-part", () => {
  assert.deepEqual(
    extractRoleTabs("responsable_qualite_parc_vn"),
    ["vn-part"],
    "RBAC005C_RED_PARC_VN_NOT_DEDICATED"
  );
});

// ============================================================================
// 4. Responsable Garantie & Support remains intentionally broader
// ============================================================================

test("005C-4: responsable_garantie_support keeps its existing broader workspace", () => {
  assert.deepEqual(
    extractRoleTabs("responsable_garantie_support"),
    ["vn-part", "dossiers"],
    "responsable_garantie_support workspace must remain unchanged"
  );
});

// ============================================================================
// 5. Dedicated roles continue to land directly on vn-part
// ============================================================================

test("005C-5: all four VN-PART roles still default to vn-part", () => {
  const roles = [
    "directeur_pieces",
    "responsable_magasin",
    "responsable_garantie_support",
    "responsable_qualite_parc_vn",
  ];

  for (const role of roles) {
    assert.equal(
      extractDefaultTab(role),
      "vn-part",
      `${role} must default to vn-part`
    );
  }
});

// ============================================================================
// 6. Scope contract: only the intended three roles become dedicated
// ============================================================================

test("005C-6: dedicated workspace set is exactly the intended three roles", () => {
  const dedicatedRoles = [
    "directeur_pieces",
    "responsable_magasin",
    "responsable_qualite_parc_vn",
  ];

  for (const role of dedicatedRoles) {
    const tabs = extractRoleTabs(role);

    assert.equal(
      tabs.length,
      1,
      `${role} must expose exactly one application tab`
    );

    assert.equal(
      tabs[0],
      "vn-part",
      `${role} single allowed tab must be vn-part`
    );
  }

  assert.notDeepEqual(
    extractRoleTabs("responsable_garantie_support"),
    ["vn-part"],
    "responsable_garantie_support must NOT become a dedicated-only role"
  );
});