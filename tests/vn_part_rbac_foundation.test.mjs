import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createNimrVmContext } from "./helpers/nimr_vm_context.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const require = createRequire(import.meta.url);

function loadEdgeFactory() {
  const ts = require(path.join(repoRoot, "apps/nimr-sav-react/node_modules/typescript"));
  const edgeSrc = fs.readFileSync(path.join(repoRoot, "supabase/functions/workshop-user-admin/index.ts"), "utf8");
  const transformed = edgeSrc.replace(
    /^import .*createClient.*;$/m,
    'const createClient = () => { throw new Error("Use the fixture client"); };'
  );
  const compiled = ts.transpileModule(transformed, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    reportDiagnostics: true,
  });
  assert.deepEqual(compiled.diagnostics.filter(d => d.category === ts.DiagnosticCategory.Error), []);
  const sandbox = { exports: {}, Request, Response, Headers, URL, console };
  vm.runInNewContext(compiled.outputText, sandbox);
  return sandbox.exports.createWorkshopUserAdminHandler;
}

test("1. Existing 7 canonical roles remain valid", () => {
  const { run } = createNimrVmContext();
  const existingRoles = [
    "admin_technique",
    "directeur",
    "chef_atelier",
    "reception",
    "technicien",
    "controle_qualite",
    "lecture_seule",
  ];

  for (const role of existingRoles) {
    assert.equal(run(`isKnownUserRole(${JSON.stringify(role)})`), true, `${role} must be known`);
    assert.equal(run(`normalizeUserRole(${JSON.stringify(role)})`), role, `${role} must normalize to itself`);
    const user = JSON.parse(run(`JSON.stringify(normalizeUser({ id: "u1", name: "Test", role: ${JSON.stringify(role)} }))`));
    assert.equal(user.role, role);
    assert.equal(user.canonicalRole, role);
    assert.ok(run(`CANONICAL_USER_ROLES[${JSON.stringify(role)}]`), `Display label must exist for ${role}`);
  }
});

test("2. directeur_pieces valid", () => {
  const { run } = createNimrVmContext();
  assert.equal(run(`isKnownUserRole("directeur_pieces")`), true);
  assert.equal(run(`normalizeUserRole("directeur_pieces")`), "directeur_pieces");
  assert.equal(run(`normalizeUserRole("Directeur Pièces")`), "directeur_pieces");
  assert.equal(run(`CANONICAL_USER_ROLES.directeur_pieces`), "Directeur Pièces");
});

test("3. responsable_magasin valid", () => {
  const { run } = createNimrVmContext();
  assert.equal(run(`isKnownUserRole("responsable_magasin")`), true);
  assert.equal(run(`normalizeUserRole("responsable_magasin")`), "responsable_magasin");
  assert.equal(run(`normalizeUserRole("Responsable Magasin")`), "responsable_magasin");
  assert.equal(run(`CANONICAL_USER_ROLES.responsable_magasin`), "Responsable Magasin");
});

test("4. responsable_garantie_support valid", () => {
  const { run } = createNimrVmContext();
  assert.equal(run(`isKnownUserRole("responsable_garantie_support")`), true);
  assert.equal(run(`normalizeUserRole("responsable_garantie_support")`), "responsable_garantie_support");
  assert.equal(run(`normalizeUserRole("Responsable Garantie / Support Technique")`), "responsable_garantie_support");
  assert.equal(run(`CANONICAL_USER_ROLES.responsable_garantie_support`), "Responsable Garantie / Support Technique");
});

test("5. responsable_qualite_parc_vn valid", () => {
  const { run } = createNimrVmContext();
  assert.equal(run(`isKnownUserRole("responsable_qualite_parc_vn")`), true);
  assert.equal(run(`normalizeUserRole("responsable_qualite_parc_vn")`), "responsable_qualite_parc_vn");
  assert.equal(run(`normalizeUserRole("Responsable Qualité / Chef de Parc VN")`), "responsable_qualite_parc_vn");
  const user = JSON.parse(run(`JSON.stringify(normalizeUser({ id: "u-vn", name: "Parc VN", role: "responsable_qualite_parc_vn" }))`));
  assert.equal(user.role, "responsable_qualite_parc_vn");
  assert.equal(user.canonicalRole, "responsable_qualite_parc_vn");
  assert.equal(run(`getCanonicalUserRole(${JSON.stringify(user)})`), "responsable_qualite_parc_vn");
});

test("6. Label is exactly: Responsable Qualité / Chef de Parc VN", () => {
  const { run } = createNimrVmContext();
  assert.equal(run(`CANONICAL_USER_ROLES.responsable_qualite_parc_vn`), "Responsable Qualité / Chef de Parc VN");
  assert.equal(run(`CANONICAL_USER_ROLES.controle_qualite`), "Contrôleur Qualité");
});

test("7. controle_qualite still resolves independently", () => {
  const { run } = createNimrVmContext();
  assert.equal(run(`normalizeUserRole("controle_qualite")`), "controle_qualite");
  assert.equal(run(`normalizeUserRole("Contrôleur Qualité")`), "controle_qualite");
  assert.equal(run(`CANONICAL_USER_ROLES.controle_qualite`), "Contrôleur Qualité");
});

test("8. controle_qualite !== responsable_qualite_parc_vn", () => {
  const { run } = createNimrVmContext();
  const cq = run(`normalizeUserRole("controle_qualite")`);
  const rqvn = run(`normalizeUserRole("responsable_qualite_parc_vn")`);
  assert.notEqual(cq, rqvn, "controle_qualite and responsable_qualite_parc_vn must be distinct canonical roles");
  assert.equal(cq, "controle_qualite");
  assert.equal(rqvn, "responsable_qualite_parc_vn");
});

test("9. qualite legacy alias still resolves to controle_qualite, NOT the new role", () => {
  const { run } = createNimrVmContext();
  assert.equal(run(`normalizeUserRole("qualite")`), "controle_qualite");
  assert.equal(run(`normalizeUserRole("controle qualite")`), "controle_qualite");
  assert.equal(run(`normalizeUserRole("controleur qualite")`), "controle_qualite");
  assert.equal(run(`normalizeUserRole("quality controller")`), "controle_qualite");
});

test("10. chef_parc_vn resolves only to responsable_qualite_parc_vn", () => {
  const { run } = createNimrVmContext();
  assert.equal(run(`normalizeUserRole("chef_parc_vn")`), "responsable_qualite_parc_vn");
  assert.equal(run(`normalizeUserRole("chef_de_parc_vn")`), "responsable_qualite_parc_vn");
  assert.equal(run(`normalizeUserRole("responsable_qualite_vn")`), "responsable_qualite_parc_vn");
});

test("11. All existing aliases remain operational", () => {
  const { run } = createNimrVmContext();
  const aliasMatrix = {
    admin: "admin_technique",
    "admin technique": "admin_technique",
    administrateur: "admin_technique",
    directeur_sav: "directeur",
    "directeur sav": "directeur",
    direction: "directeur",
    "chef atelier": "chef_atelier",
    receptionnaire: "reception",
    technician: "technicien",
    readonly: "lecture_seule",
    "lecture seule": "lecture_seule",
    lecture: "lecture_seule",
  };

  for (const [alias, canonical] of Object.entries(aliasMatrix)) {
    assert.equal(run(`normalizeUserRole(${JSON.stringify(alias)})`), canonical, `Alias ${alias} must resolve to ${canonical}`);
  }
});

test("12. Unknown roles fail safely to lecture_seule", () => {
  const { run } = createNimrVmContext();
  assert.equal(run(`isKnownUserRole("hacker")`), false);
  assert.equal(run(`isKnownUserRole("superadmin")`), false);
  assert.equal(run(`isKnownUserRole("chef_de_parc")`), false, "Generic chef_de_parc without _vn is unknown and fails closed");
  assert.equal(run(`normalizeUserRole("hacker")`), "lecture_seule");
  assert.equal(run(`normalizeUserRole("unknown_role")`), "lecture_seule");
});

test("13. workshop-user-admin accepts the 4 new canonical target roles", async () => {
  const factory = loadEdgeFactory();
  const fourNewRoles = [
    "directeur_pieces",
    "responsable_magasin",
    "responsable_garantie_support",
    "responsable_qualite_parc_vn",
  ];

  for (const targetRole of fourNewRoles) {
    const members = [
      { user_id: "admin-1", workshop_id: "workshop-1", role: "admin_technique", resource_id: null, deleted_at: null },
    ];
    const resources = [];
    let insertedMember = null;

    class Query {
      constructor(table) { this.table = table; this.filters = []; this.patch = null; }
      select() { return this; }
      order() { return this; }
      limit() { return this; }
      eq(k, v) { this.filters.push(r => r[k] === v); return this; }
      is(k, v) { this.filters.push(r => v === null ? r[k] == null : r[k] === v); return this; }
      insert(payload) {
        insertedMember = payload;
        return {
          select() {
            return {
              single: async () => ({ data: { ...payload, id: "new-member-id" }, error: null }),
            };
          },
        };
      }
      then(resolve, reject) { return this.execute(false).then(resolve, reject); }
      maybeSingle() { return this.execute(true); }
      async execute(single) {
        const store = this.table === "workshop_members" ? members : resources;
        const rows = store.filter(r => this.filters.every(f => f(r)));
        return { data: single ? (rows[0] || null) : rows.map(r => ({ ...r })), error: null };
      }
    }

    const adminClient = {
      from: (table) => new Query(table),
      auth: {
        admin: {
          inviteUserByEmail: async (email) => ({ data: { user: { id: "new-user-id", email } }, error: null }),
          deleteUser: async () => ({ error: null }),
        },
      },
    };

    const userClient = {
      auth: {
        getUser: async () => ({ data: { user: { id: "admin-1", email: "admin@example.test" } }, error: null }),
      },
    };

    const handler = factory({
      environment: {
        get: (k) => ({
          SUPABASE_URL: "https://example.supabase.co",
          SUPABASE_PUBLISHABLE_KEY: "public-key",
          SUPABASE_SECRET_KEY: "secret-key",
        }[k]),
      },
      clientFactory: (_url, key) => (key === "public-key" ? userClient : adminClient),
    });

    const req = new Request("https://example.supabase.co/functions/v1/workshop-user-admin", {
      method: "POST",
      headers: {
        Authorization: "Bearer test-jwt",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "invite_member",
        workshop_id: "workshop-1",
        email: `test-${targetRole}@example.test`,
        name: `Name ${targetRole}`,
        role: targetRole,
      }),
    });

    const res = await handler(req);
    const body = await res.json();
    assert.equal(res.status, 201, `Invite ${targetRole} must return 201`);
    assert.equal(body.ok, true, `Invite response ok must be true for ${targetRole}`);
    assert.equal(body.member.role, targetRole);
    assert.equal(insertedMember.role, targetRole);
  }
});

test("14. None of the 4 new roles gain account-management authority", async () => {
  const factory = loadEdgeFactory();
  const { run } = createNimrVmContext();
  const fourNewRoles = [
    "directeur_pieces",
    "responsable_magasin",
    "responsable_garantie_support",
    "responsable_qualite_parc_vn",
  ];

  // A. Check Edge Function rejects invites from callers with new roles
  for (const callerRole of fourNewRoles) {
    const members = [
      { user_id: "caller-1", workshop_id: "workshop-1", role: callerRole, resource_id: null, deleted_at: null },
    ];
    const resources = [];

    class Query {
      constructor(table) { this.table = table; this.filters = []; this.patch = null; }
      select() { return this; }
      order() { return this; }
      limit() { return this; }
      eq(k, v) { this.filters.push(r => r[k] === v); return this; }
      is(k, v) { this.filters.push(r => v === null ? r[k] == null : r[k] === v); return this; }
      then(resolve, reject) { return this.execute(false).then(resolve, reject); }
      maybeSingle() { return this.execute(true); }
      async execute(single) {
        const store = this.table === "workshop_members" ? members : resources;
        const rows = store.filter(r => this.filters.every(f => f(r)));
        return { data: single ? (rows[0] || null) : rows.map(r => ({ ...r })), error: null };
      }
    }

    const adminClient = { from: (t) => new Query(t), auth: { admin: {} } };
    const userClient = {
      auth: {
        getUser: async () => ({ data: { user: { id: "caller-1", email: "caller@example.test" } }, error: null }),
      },
    };

    const handler = factory({
      environment: {
        get: (k) => ({
          SUPABASE_URL: "https://example.supabase.co",
          SUPABASE_PUBLISHABLE_KEY: "public-key",
          SUPABASE_SECRET_KEY: "secret-key",
        }[k]),
      },
      clientFactory: (_url, key) => (key === "public-key" ? userClient : adminClient),
    });

    const req = new Request("https://example.supabase.co/functions/v1/workshop-user-admin", {
      method: "POST",
      headers: {
        Authorization: "Bearer test-jwt",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "invite_member",
        workshop_id: "workshop-1",
        email: "target@example.test",
        name: "Target",
        role: "technicien",
        resource_id: "r1",
      }),
    });

    const res = await handler(req);
    const body = await res.json();
    assert.equal(res.status, 403, `Caller with role ${callerRole} must be rejected with 403`);
    assert.equal(body.code, "FORBIDDEN_WORKSHOP_ADMIN");
  }

  // B. Check client-side account management permissions
  for (const role of fourNewRoles) {
    run(`
      state.users = [
        normalizeUser({ id: "user-${role}", name: "User", role: "${role}", active: true })
      ];
      state.currentUserId = "user-${role}";
    `);
    assert.equal(run('hasPermission("users.manage")'), false, `${role} must NOT have users.manage`);
    assert.equal(run('hasPermission("settings.edit")'), false, `${role} must NOT have settings.edit`);
    assert.equal(run('hasPermission("supabase.configure")'), false, `${role} must NOT have supabase.configure`);
    assert.equal(run('hasPermission("supabase.restore")'), false, `${role} must NOT have supabase.restore`);
    assert.equal(run('hasPermission("case.create")'), false, `${role} must NOT have case.create`);
    assert.equal(run('hasPermission("planning.edit")'), false, `${role} must NOT have planning.edit`);
  }
});

test("15. SEC001 membership resolution accepts all 4", async () => {
  const clientSrc = fs.readFileSync(path.join(repoRoot, "js/supabase-client.js"), "utf8");
  const fourNewRoles = [
    "directeur_pieces",
    "responsable_magasin",
    "responsable_garantie_support",
    "responsable_qualite_parc_vn",
  ];

  for (const role of fourNewRoles) {
    const sandbox = {
      window: {
        NIMR_SUPABASE_CONFIG: { workshopId: "00000000-0000-0000-0000-000000000001" },
      },
      console: { log() {}, warn() {}, error() {} },
      localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
      sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
      navigator: { onLine: true },
      location: { href: "https://app.test/" },
      URL,
      URLSearchParams,
    };
    sandbox.window = sandbox;

    const responseFor = (response) => ({
      from: (table) => {
        assert.equal(table, "workshop_members");
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({ maybeSingle: async () => response }),
            }),
          }),
        };
      },
    });

    const ctx = vm.createContext(sandbox);
    vm.runInContext(clientSrc, ctx);

    ctx.getSupabaseClient = () => responseFor({
      data: {
        workshop_id: "00000000-0000-0000-0000-000000000001",
        user_id: "user-123",
        role,
        resource_id: null,
      },
      error: null,
    });

    const res = await ctx.window.resolveSupabaseWorkshopMembership({ id: "user-123" });
    assert.equal(res.ok, true, `resolveSupabaseWorkshopMembership should succeed for ${role}`);
    assert.equal(res.membership.role, role);
  }
});

test("16. SQL migration contains all 11 roles", () => {
  const sqlPath = path.join(repoRoot, "supabase_vn_part_001_roles.sql");
  assert.ok(fs.existsSync(sqlPath), "supabase_vn_part_001_roles.sql must exist");
  const sql = fs.readFileSync(sqlPath, "utf8");

  assert.match(sql, /UNEXECUTED/);
  assert.match(sql, /public\.nimr_canonical_role/);
  assert.match(sql, /workshop_members_role_canonical_check/);

  const all11Roles = [
    "admin_technique",
    "directeur",
    "chef_atelier",
    "reception",
    "technicien",
    "controle_qualite",
    "lecture_seule",
    "directeur_pieces",
    "responsable_magasin",
    "responsable_garantie_support",
    "responsable_qualite_parc_vn",
  ];

  for (const role of all11Roles) {
    assert.match(sql, new RegExp(`'${role}'`), `SQL migration must contain '${role}'`);
  }
});

test("17. HTML selectors contain both distinct Quality roles", () => {
  const indexPath = path.join(repoRoot, "index.html");
  const html = fs.readFileSync(indexPath, "utf8");

  // Verify both distinct Quality roles appear in invite dropdown
  assert.match(html, /<option value="controle_qualite">Contrôleur Qualité<\/option>/);
  assert.match(html, /<option value="responsable_qualite_parc_vn">Responsable Qualité \/ Chef de Parc VN<\/option>/);
  assert.match(html, /<option value="directeur_pieces">Directeur Pièces<\/option>/);
  assert.match(html, /<option value="responsable_magasin">Responsable Magasin<\/option>/);
  assert.match(html, /<option value="responsable_garantie_support">Responsable Garantie \/ Support Technique<\/option>/);
});

test("18. ASTRA-ID-001 behavior remains unchanged", () => {
  const { run } = createNimrVmContext();
  run(`
    state.users = [
      normalizeUser({ id: "adm", name: "Admin", role: "admin_technique", active: true })
    ];
    state.currentUserId = "adm";
  `);
  assert.equal(run('getCanonicalUserRole(getCurrentUser())'), "admin_technique");
  assert.equal(run('hasPermission("users.manage")'), true);
  assert.equal(run('hasPermission("settings.edit")'), true);
});
