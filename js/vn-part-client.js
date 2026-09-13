/**
 * NIMR-SAV — VN-PART Client (003C)
 *
 * Client adapter for the VN-PART operational module:
 *   - Read model: SELECT queries on donor state, removals, and approvals (workshop-scoped)
 *   - Mutation adapter: strictly via authoritative Postgres RPC `nimr_apply_vn_part_action_v1`
 *
 * ABSOLUTE INVARIANTS:
 *   - No direct table mutations (.insert, .update, .delete, .upsert)
 *   - Exactly one mutation RPC allowed: nimr_apply_vn_part_action_v1
 *   - Mutation workshop ID derived strictly from validated membership identity (currentUser.membershipWorkshopId)
 *   - Mutation execution fails closed if application startup, auth session, or membership is unresolved
 *   - options.workshopId is strictly forbidden on the mutation path
 */

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    const exportsObj = factory();
    Object.assign(root, exportsObj);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function resolveSupabaseClient() {
    if (typeof getSupabaseClient === "function") {
      return getSupabaseClient();
    }
    if (typeof window !== "undefined") {
      if (typeof window.getSupabaseClient === "function") {
        return window.getSupabaseClient();
      }
      if (window.nimrSupabaseClient) {
        return window.nimrSupabaseClient;
      }
    }
    return null;
  }

  function resolveCurrentWorkshopId() {
    if (typeof getSupabaseWorkshopId === "function") {
      const workshopId = String(getSupabaseWorkshopId() || "").trim();
      return workshopId || null;
    }

    if (
      typeof window !== "undefined"
      && typeof window.getSupabaseWorkshopId === "function"
    ) {
      const workshopId = String(window.getSupabaseWorkshopId() || "").trim();
      return workshopId || null;
    }

    return null;
  }

  /**
   * Fail-closed mutation identity resolver.
   * Ensures mutations are issued only when:
   *   - __nimrAppReady === true
   *   - __nimrValidatedAuthUserId is present
   *   - getCurrentUser() returns active user matching __nimrValidatedAuthUserId
   *   - authSource === 'supabase_membership'
   *   - membershipValidatedAt and membershipWorkshopId are present
   *   - canAccessTab('vn-part') === true
   *   - getCanonicalUserRole returns valid canonical role
   */
  function resolveVnPartMutationIdentity() {
    const scope = typeof window !== "undefined" ? window : globalThis;

    if (scope.__nimrAppReady !== true) {
      return {
        ok: false,
        code: "IDENTITY_NOT_READY",
        message: "Application en cours d'initialisation.",
      };
    }

    const validatedAuthUserId = String(scope.__nimrValidatedAuthUserId || "").trim();
    if (!validatedAuthUserId) {
      return {
        ok: false,
        code: "IDENTITY_NOT_READY",
        message: "Identifiant d'authentification manquant.",
      };
    }

    if (typeof scope.getCurrentUser !== "function") {
      return {
        ok: false,
        code: "IDENTITY_NOT_READY",
        message: "Gestionnaire de session indisponible.",
      };
    }

    const user = scope.getCurrentUser();

    if (
      !user
      || user.active === false
      || String(user.authUserId || "").trim() !== validatedAuthUserId
      || user.authSource !== "supabase_membership"
      || !String(user.membershipValidatedAt || "").trim()
      || !String(user.membershipWorkshopId || "").trim()
    ) {
      return {
        ok: false,
        code: "IDENTITY_NOT_READY",
        message: "Session atelier non validée ou utilisateur inactif.",
      };
    }

    if (
      typeof scope.canAccessTab !== "function"
      || scope.canAccessTab("vn-part") !== true
    ) {
      return {
        ok: false,
        code: "VN_PART_ACCESS_DENIED",
        message: "Accès au module prélèvements VN non autorisé.",
      };
    }

    if (typeof scope.getCanonicalUserRole !== "function") {
      return {
        ok: false,
        code: "IDENTITY_NOT_READY",
        message: "Fonction de rôle canonique indisponible.",
      };
    }

    const canonicalRole = scope.getCanonicalUserRole(user);
    if (!canonicalRole) {
      return {
        ok: false,
        code: "IDENTITY_NOT_READY",
        message: "Rôle utilisateur non résolu.",
      };
    }

    return {
      ok: true,
      authUserId: validatedAuthUserId,
      workshopId: String(user.membershipWorkshopId).trim(),
      role: canonicalRole,
      user,
    };
  }

  /**
   * Load VN-PART dashboard data via authenticated SELECT queries.
   * Executes exactly 3 workshop-scoped queries:
   *   1. vn_part_donor_state_v1
   *   2. vn_part_removals
   *   3. vn_part_approvals
   *
   * @param {Object} [options]
   * @param {Object} [options.client] - Injected Supabase client (for testing)
   * @param {string} [options.workshopId] - Injected workshop ID (strictly read tests only)
   * @returns {Promise<{ ok: boolean, workshopId?: string, donors?: Array, removals?: Array, approvals?: Array, code?: string, message?: string }>}
   */
  async function loadVnPartDashboard(options = {}) {
    const client = options.client || resolveSupabaseClient();
    if (!client) {
      return {
        ok: false,
        code: "CLIENT_UNAVAILABLE",
        message: "Client Supabase non initialisé ou non disponible.",
      };
    }

    const workshopId =
      options.workshopId !== undefined
        ? String(options.workshopId || "").trim() || null
        : resolveCurrentWorkshopId();
    if (!workshopId) {
      return {
        ok: false,
        code: "WORKSHOP_REQUIRED",
        message: "Identifiant d'atelier requis pour charger les prélèvements VN.",
      };
    }

    try {
      const [donorsRes, removalsRes, approvalsRes] = await Promise.all([
        client
          .from("vn_part_donor_state_v1")
          .select("*")
          .eq("workshop_id", workshopId),
        client
          .from("vn_part_removals")
          .select("*")
          .eq("workshop_id", workshopId)
          .order("created_at", { ascending: false }),
        client
          .from("vn_part_approvals")
          .select("*")
          .eq("workshop_id", workshopId)
          .order("decided_at", { ascending: true }),
      ]);

      if (donorsRes.error) {
        return {
          ok: false,
          code: donorsRes.error.code || "QUERY_ERROR",
          message: donorsRes.error.message || "Erreur lors du chargement de la vue donneurs VN.",
        };
      }

      if (removalsRes.error) {
        return {
          ok: false,
          code: removalsRes.error.code || "QUERY_ERROR",
          message: removalsRes.error.message || "Erreur lors du chargement des prélèvements VN.",
        };
      }

      if (approvalsRes.error) {
        return {
          ok: false,
          code: approvalsRes.error.code || "QUERY_ERROR",
          message: approvalsRes.error.message || "Erreur lors du chargement des approbations VN.",
        };
      }

      return {
        ok: true,
        workshopId,
        donors: donorsRes.data || [],
        removals: removalsRes.data || [],
        approvals: approvalsRes.data || [],
      };
    } catch (err) {
      return {
        ok: false,
        code: "FETCH_EXCEPTION",
        message: err?.message || "Échec inattendu lors de la lecture des prélèvements VN.",
      };
    }
  }

  /**
   * Execute an authoritative VN-PART action via Postgres RPC `nimr_apply_vn_part_action_v1`.
   *
   * @param {string|null} removalId - UUID of the removal (null for CREATE_REQUEST)
   * @param {number|null} expectedVersion - Expected version for CAS check (null for CREATE_REQUEST)
   * @param {string} action - Authoritative action name
   * @param {Object} [payload={}] - Action payload
   * @param {Object} [options={}] - Options (options.client only; options.workshopId is strictly forbidden)
   * @returns {Promise<{ ok: boolean, success: boolean, code?: string, message?: string, version?: number, status?: string, record?: Object, _diagnostic?: string }>}
   */
  async function applyVnPartAction(removalId, expectedVersion, action, payload = {}, options = {}) {
    const client = options.client || resolveSupabaseClient();
    if (!client) {
      return {
        ok: false,
        success: false,
        code: "CLIENT_UNAVAILABLE",
        message: "Client Supabase non initialisé ou non disponible.",
      };
    }

    // Fail-closed identity resolution: workshopId is derived strictly from membershipWorkshopId
    const identityRes = resolveVnPartMutationIdentity();
    if (!identityRes.ok) {
      return {
        ok: false,
        success: false,
        code: identityRes.code,
        message: identityRes.message,
      };
    }

    const identity = identityRes;
    const normalizedAction = String(action || "").trim().toUpperCase();

    try {
      const { data, error } = await client.rpc("nimr_apply_vn_part_action_v1", {
        p_workshop_id: identity.workshopId,
        p_removal_id: removalId || null,
        p_expected_version:
          expectedVersion === null || expectedVersion === undefined
            ? null
            : Number(expectedVersion),
        p_action: normalizedAction,
        p_payload: payload || {},
      });

      if (error) {
        return {
          ok: false,
          success: false,
          code: "RPC_ERROR",
          message: "Échec de communication avec le serveur ou paramètre non valide.",
          _diagnostic: error.message,
        };
      }

      return data;
    } catch (err) {
      return {
        ok: false,
        success: false,
        code: "RPC_EXCEPTION",
        message: "Échec inattendu lors de l'exécution de l'action VN-PART.",
        _diagnostic: err?.message,
      };
    }
  }

  return {
    loadVnPartDashboard,
    resolveCurrentWorkshopId,
    resolveSupabaseClient,
    resolveVnPartMutationIdentity,
    applyVnPartAction,
  };
});
