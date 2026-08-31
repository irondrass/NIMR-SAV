import { createClient } from "npm:@supabase/supabase-js@2.111.0";

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Response | Promise<Response>): void;
};

type JsonRecord = Record<string, unknown>;
type SupabaseClientLike = ReturnType<typeof createClient>;

const FUNCTION_ACTIONS = new Set(["capabilities", "invite_member", "offboard_member"]);
const CANONICAL_WORKSHOP_ROLES = new Set([
  "admin_technique",
  "directeur",
  "chef_atelier",
  "reception",
  "technicien",
  "controle_qualite",
  "lecture_seule",
]);
const WORKSHOP_ADMIN_ROLES = new Set(["admin_technique", "directeur"]);
const HUMAN_RESOURCE_TYPES = new Set(["controle", "electricien", "mecanicien", "peintre", "tolier"]);
const CALLER_ROLE_ALIASES: Record<string, string> = Object.freeze({
  admin: "admin_technique",
  administrateur: "admin_technique",
  directeur_sav: "directeur",
  chef: "chef_atelier",
  controleur_qualite: "controle_qualite",
  readonly: "lecture_seule",
});

const CORS_HEADERS = Object.freeze({
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
});

function response(body: JsonRecord, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: CORS_HEADERS });
}

function failure(code: string, message: string, status = 400, details: JsonRecord = {}): Response {
  return response({ ok: false, code, message, ...details }, status);
}

function cleanToken(value: unknown): string {
  return String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function canonicalizeCallerRole(value: unknown): string {
  const token = cleanToken(value);
  return CALLER_ROLE_ALIASES[token] || token;
}

function normalizeTargetRole(value: unknown): string {
  const token = cleanToken(value);
  return CANONICAL_WORKSHOP_ROLES.has(token) ? token : "";
}

function normalizeEmail(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function isValidEmail(value: string): boolean {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value);
}

function isValidMemberName(value: string): boolean {
  return value.length >= 2
    && value.length <= 160
    && !/[\u0000-\u001F\u007F]/u.test(value);
}

function readNamedKey(environment: { get(name: string): string | undefined }, dictionaryName: string, singleName: string): string {
  const dictionary = String(environment.get(dictionaryName) || "").trim();
  if (dictionary) {
    try {
      const parsed = JSON.parse(dictionary) as Record<string, unknown>;
      const preferred = String(parsed.default || "").trim();
      if (preferred) return preferred;
      const first = Object.values(parsed).find((value) => String(value || "").trim());
      if (first) return String(first).trim();
    } catch {
      return "";
    }
  }
  return String(environment.get(singleName) || "").trim();
}

function isExistingAuthUserError(error: unknown): boolean {
  const record = (error && typeof error === "object") ? error as Record<string, unknown> : {};
  const code = cleanToken(record.code);
  const message = String(record.message || error || "");
  return ["email_exists", "user_already_exists", "email_address_exists"].includes(code)
    || /already (?:been )?registered|already exists|email.*exists/iu.test(message);
}

async function parseRequestBody(request: Request): Promise<JsonRecord | null> {
  try {
    const value = await request.json();
    return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
  } catch {
    return null;
  }
}

async function resolveCallerAuthority(
  adminClient: SupabaseClientLike,
  callerId: string,
  requestedWorkshopId: string,
): Promise<{ ok: true; membership: JsonRecord; role: string; workshopId: string } | { ok: false; response: Response }> {
  const { data, error } = await adminClient
    .from("workshop_members")
    .select("workshop_id, user_id, role, resource_id, deleted_at")
    .eq("user_id", callerId)
    .is("deleted_at", null);

  if (error) {
    return { ok: false, response: failure("CALLER_MEMBERSHIP_LOOKUP_FAILED", "Impossible de vérifier l’appartenance atelier.", 500) };
  }

  const activeMemberships = Array.isArray(data) ? data : [];
  if (requestedWorkshopId) {
    const scopedMembership = activeMemberships.find((membership) => String(membership.workshop_id || "") === requestedWorkshopId);
    if (!scopedMembership) {
      return { ok: false, response: failure("WORKSHOP_SCOPE_MISMATCH", "L’atelier demandé ne correspond pas à l’appartenance active du demandeur.", 403) };
    }
    const role = canonicalizeCallerRole(scopedMembership.role);
    if (!WORKSHOP_ADMIN_ROLES.has(role)) {
      return { ok: false, response: failure("FORBIDDEN_WORKSHOP_ADMIN", "Administration des comptes atelier non autorisée.", 403) };
    }
    return { ok: true, membership: scopedMembership, role, workshopId: requestedWorkshopId };
  }

  const manageableMemberships = activeMemberships.filter((membership) => WORKSHOP_ADMIN_ROLES.has(canonicalizeCallerRole(membership.role)));
  if (manageableMemberships.length !== 1) {
    if (manageableMemberships.length > 1) {
      return { ok: false, response: failure("WORKSHOP_SCOPE_MISMATCH", "Un atelier explicite est requis pour cette opération.", 403) };
    }
    return { ok: false, response: failure("FORBIDDEN_WORKSHOP_ADMIN", "Administration des comptes atelier non autorisée.", 403) };
  }
  const membership = manageableMemberships[0];
  return {
    ok: true,
    membership,
    role: canonicalizeCallerRole(membership.role),
    workshopId: String(membership.workshop_id || ""),
  };
}

async function listHumanResources(adminClient: SupabaseClientLike, workshopId: string): Promise<JsonRecord[]> {
  const { data, error } = await adminClient
    .from("planning_resources")
    .select("id, workshop_id, local_id, name, type, active, deleted_at")
    .eq("workshop_id", workshopId)
    .eq("active", true)
    .is("deleted_at", null)
    .order("name", { ascending: true });
  if (error) throw error;
  return (Array.isArray(data) ? data : [])
    .filter((resource) => HUMAN_RESOURCE_TYPES.has(cleanToken(resource.type)))
    .map((resource) => ({
      id: resource.id,
      local_id: resource.local_id || null,
      name: resource.name || resource.local_id || resource.id,
      type: cleanToken(resource.type),
    }));
}

async function countActiveTechnicalAdmins(adminClient: SupabaseClientLike, workshopId: string): Promise<number> {
  const { data, error } = await adminClient
    .from("workshop_members")
    .select("role")
    .eq("workshop_id", workshopId)
    .is("deleted_at", null);
  if (error) throw error;
  return (Array.isArray(data) ? data : [])
    .filter((membership) => canonicalizeCallerRole(membership.role) === "admin_technique").length;
}

async function validateTechnicianResource(
  adminClient: SupabaseClientLike,
  workshopId: string,
  role: string,
  requestedResourceId: unknown,
): Promise<{ ok: true; resourceId: string | null } | { ok: false; response: Response }> {
  if (role !== "technicien") return { ok: true, resourceId: null };
  const resourceId = String(requestedResourceId || "").trim();
  if (!resourceId) {
    return { ok: false, response: failure("TECHNICIAN_RESOURCE_REQUIRED", "Une ressource humaine est obligatoire pour un technicien.") };
  }

  const { data: resource, error: resourceError } = await adminClient
    .from("planning_resources")
    .select("id, workshop_id, type, active, deleted_at")
    .eq("id", resourceId)
    .eq("workshop_id", workshopId)
    .is("deleted_at", null)
    .maybeSingle();
  if (resourceError) {
    return { ok: false, response: failure("RESOURCE_NOT_FOUND", "Ressource technicien introuvable.") };
  }
  if (!resource) {
    return { ok: false, response: failure("RESOURCE_NOT_FOUND", "Ressource technicien introuvable.") };
  }
  if (resource.active !== true) {
    return { ok: false, response: failure("RESOURCE_INACTIVE", "La ressource technicien est inactive.") };
  }
  if (!HUMAN_RESOURCE_TYPES.has(cleanToken(resource.type))) {
    return { ok: false, response: failure("RESOURCE_NOT_HUMAN", "La ressource technicien doit être une personne, pas un équipement.") };
  }

  const { data: linkedMembers, error: linkedError } = await adminClient
    .from("workshop_members")
    .select("user_id")
    .eq("workshop_id", workshopId)
    .eq("resource_id", resourceId)
    .is("deleted_at", null)
    .limit(1);
  if (linkedError) {
    return { ok: false, response: failure("RESOURCE_LINK_CHECK_FAILED", "Impossible de vérifier la disponibilité de la ressource.", 500) };
  }
  if (Array.isArray(linkedMembers) && linkedMembers.length > 0) {
    return { ok: false, response: failure("RESOURCE_ALREADY_LINKED", "Cette ressource est déjà liée à un membre actif de l’atelier.") };
  }
  return { ok: true, resourceId };
}

async function handleCapabilities(adminClient: SupabaseClientLike, authority: { role: string; workshopId: string }): Promise<Response> {
  try {
    const [humanResources, activeAdminTechnicalCount] = await Promise.all([
      listHumanResources(adminClient, authority.workshopId),
      countActiveTechnicalAdmins(adminClient, authority.workshopId),
    ]);
    return response({
      ok: true,
      can_manage_accounts: true,
      caller_role: authority.role,
      workshop_id: authority.workshopId,
      provisioning_available: true,
      active_admin_technique_count: activeAdminTechnicalCount,
      human_resources: humanResources,
    });
  } catch {
    return failure("RESOURCE_LIST_FAILED", "Impossible de charger les ressources technicien.", 500);
  }
}

async function handleInviteMember(
  adminClient: SupabaseClientLike,
  authority: { workshopId: string },
  callerId: string,
  payload: JsonRecord,
): Promise<Response> {
  const email = normalizeEmail(payload.email);
  const name = String(payload.name || "").trim();
  const role = normalizeTargetRole(payload.role);
  if (!isValidMemberName(name)) return failure("INVALID_MEMBER_NAME", "Le nom complet est invalide.");
  if (!isValidEmail(email)) return failure("INVALID_MEMBER_EMAIL", "L’adresse email est invalide.");
  if (!role) return failure("INVALID_WORKSHOP_ROLE", "Le rôle atelier demandé n’est pas autorisé.");

  const resourceValidation = await validateTechnicianResource(adminClient, authority.workshopId, role, payload.resource_id);
  if (!resourceValidation.ok) return resourceValidation.response;

  const { data: inviteData, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
    data: { display_name: name },
  });
  if (inviteError || !inviteData?.user?.id) {
    if (isExistingAuthUserError(inviteError)) {
      return failure("AUTH_USER_ALREADY_EXISTS", "Un compte Supabase existe déjà pour cette adresse. Aucun rattachement automatique n’a été effectué.", 409);
    }
    return failure("AUTH_INVITE_FAILED", "L’invitation Supabase n’a pas pu être créée.", 502);
  }

  const invitedUserId = String(inviteData.user.id);
  const membershipRow = {
    workshop_id: authority.workshopId,
    user_id: invitedUserId,
    role,
    resource_id: resourceValidation.resourceId,
    created_by: callerId,
    updated_by: callerId,
    deleted_at: null,
    sync_source: "identity_provisioning",
  };
  const { data: membership, error: membershipError } = await adminClient
    .from("workshop_members")
    .insert(membershipRow)
    .select("workshop_id, user_id, role, resource_id, created_at")
    .single();

  if (membershipError || !membership) {
    const { error: compensationError } = await adminClient.auth.admin.deleteUser(invitedUserId);
    return failure(
      "MEMBERSHIP_CREATE_FAILED",
      "L’appartenance atelier n’a pas pu être créée ; l’invitation nouvellement créée a fait l’objet d’une compensation.",
      500,
      { compensation_succeeded: !compensationError },
    );
  }

  return response({
    ok: true,
    action: "invite_member",
    member: {
      user_id: membership.user_id,
      role: membership.role,
      resource_id: membership.resource_id || null,
      workshop_id: membership.workshop_id,
    },
  }, 201);
}

async function handleOffboardMember(
  adminClient: SupabaseClientLike,
  authority: { workshopId: string },
  callerId: string,
  payload: JsonRecord,
): Promise<Response> {
  const targetUserId = String(payload.user_id || "").trim();
  if (!targetUserId) return failure("TARGET_MEMBER_NOT_FOUND", "Membre atelier introuvable.", 404);
  if (targetUserId === callerId) return failure("SELF_OFFBOARD_FORBIDDEN", "Vous ne pouvez pas retirer votre propre accès atelier.", 409);

  const { data: targetRows, error: targetError } = await adminClient
    .from("workshop_members")
    .select("workshop_id, user_id, role, resource_id, deleted_at")
    .eq("user_id", targetUserId)
    .is("deleted_at", null);
  if (targetError) return failure("TARGET_MEMBER_LOOKUP_FAILED", "Impossible de vérifier le membre cible.", 500);
  const activeTargets = Array.isArray(targetRows) ? targetRows : [];
  const target = activeTargets.find((membership) => String(membership.workshop_id || "") === authority.workshopId);
  if (!target) {
    if (activeTargets.length > 0) {
      return failure("WORKSHOP_SCOPE_MISMATCH", "Le membre cible n’appartient pas à l’atelier autorisé.", 403);
    }
    return failure("TARGET_MEMBER_NOT_FOUND", "Membre atelier actif introuvable.", 404);
  }

  if (canonicalizeCallerRole(target.role) === "admin_technique") {
    const { data: activeMembers, error: adminCountError } = await adminClient
      .from("workshop_members")
      .select("user_id, role")
      .eq("workshop_id", authority.workshopId)
      .is("deleted_at", null);
    if (adminCountError) return failure("ADMIN_CONTINUITY_CHECK_FAILED", "Impossible de vérifier la continuité administrative.", 500);
    const activeAdminCount = (Array.isArray(activeMembers) ? activeMembers : [])
      .filter((membership) => canonicalizeCallerRole(membership.role) === "admin_technique").length;
    if (activeAdminCount <= 1) {
      return failure("LAST_ADMIN_FORBIDDEN", "Le dernier administrateur technique actif ne peut pas être retiré.", 409);
    }
  }

  const revokedAt = new Date().toISOString();
  const { data: revokedMembership, error: revokeError } = await adminClient
    .from("workshop_members")
    .update({
      deleted_at: revokedAt,
      updated_at: revokedAt,
      updated_by: callerId,
      sync_source: "identity_offboarding",
    })
    .eq("workshop_id", authority.workshopId)
    .eq("user_id", targetUserId)
    .is("deleted_at", null)
    .select("workshop_id, user_id, role, resource_id, deleted_at")
    .maybeSingle();
  if (revokeError || !revokedMembership) {
    return failure("MEMBERSHIP_REVOKE_FAILED", "La révocation de l’appartenance atelier a échoué.", 500);
  }

  // Preserve the historical workshop_members row: the current schema keeps a
  // foreign key to auth.users, so hard deletion could cascade into membership
  // history. Supabase soft deletion invalidates the account while retaining the
  // referenced Auth row needed by the audit trail.
  const { error: authCleanupError } = await adminClient.auth.admin.deleteUser(targetUserId, true);
  if (authCleanupError) {
    return response({
      ok: true,
      action: "offboard_member",
      code: "AUTH_CLEANUP_PENDING",
      warning: "AUTH_CLEANUP_PENDING",
      membership_revoked: true,
      auth_cleanup: false,
      revoked_at: revokedAt,
    });
  }
  return response({
    ok: true,
    action: "offboard_member",
    membership_revoked: true,
    auth_cleanup: true,
    revoked_at: revokedAt,
  });
}

export function createWorkshopUserAdminHandler(overrides: {
  environment?: { get(name: string): string | undefined };
  clientFactory?: typeof createClient;
} = {}) {
  const environment = overrides.environment || Deno.env;
  const clientFactory = overrides.clientFactory || createClient;

  return async function workshopUserAdmin(request: Request): Promise<Response> {
    if (request.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
    if (request.method !== "POST") return failure("METHOD_NOT_ALLOWED", "Méthode non autorisée.", 405);

    const authorization = String(request.headers.get("Authorization") || "").trim();
    const jwt = authorization.match(/^Bearer\s+(.+)$/iu)?.[1]?.trim() || "";
    if (!jwt) return failure("UNAUTHENTICATED", "Jeton utilisateur Supabase requis.", 401);

    const payload = await parseRequestBody(request);
    if (!payload) return failure("INVALID_REQUEST", "Corps JSON invalide.");
    const action = cleanToken(payload.action);
    if (!FUNCTION_ACTIONS.has(action)) return failure("INVALID_ACTION", "Action non autorisée.");

    const supabaseUrl = String(environment.get("SUPABASE_URL") || "").trim();
    const publishableKey = readNamedKey(environment, "SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_PUBLISHABLE_KEY");
    const secretKey = readNamedKey(environment, "SUPABASE_SECRET_KEYS", "SUPABASE_SECRET_KEY");
    if (!supabaseUrl || !publishableKey || !secretKey) {
      return failure("SERVER_CONFIGURATION_ERROR", "Configuration serveur de provisioning indisponible.", 503);
    }

    const userClient = clientFactory(supabaseUrl, publishableKey, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: authData, error: authError } = await userClient.auth.getUser(jwt);
    const caller = authData?.user;
    if (authError || !caller?.id) return failure("UNAUTHENTICATED", "Identité Supabase invalide ou expirée.", 401);

    const adminClient = clientFactory(supabaseUrl, secretKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const requestedWorkshopId = String(payload.workshop_id || "").trim();
    const authority = await resolveCallerAuthority(adminClient, String(caller.id), requestedWorkshopId);
    if (!authority.ok) return authority.response;

    if (action === "capabilities") return handleCapabilities(adminClient, authority);
    if (action === "invite_member") return handleInviteMember(adminClient, authority, String(caller.id), payload);
    return handleOffboardMember(adminClient, authority, String(caller.id), payload);
  };
}

if (typeof Deno !== "undefined" && typeof Deno.serve === "function") {
  Deno.serve(createWorkshopUserAdminHandler());
}
