/**
 * NIMR-SAV — VN-PART Read-Only Client (003B)
 *
 * Strictly READ-ONLY client for the VN-PART operational dashboard.
 * Queries:
 *   - public.vn_part_donor_state_v1
 *   - public.vn_part_removals
 *
 * ABSOLUTE INVARIANTS:
 *   - No RPC action mutations
 *   - Strictly read-only SELECT queries
 *   - No database mutations
 *   - Scoped strictly by workshop_id = getSupabaseWorkshopId()
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
      return getSupabaseWorkshopId();
    }
    if (typeof window !== "undefined") {
      if (typeof window.getSupabaseWorkshopId === "function") {
        return window.getSupabaseWorkshopId();
      }
      if (window.NIMR_DEFAULT_WORKSHOP_ID) {
        return String(window.NIMR_DEFAULT_WORKSHOP_ID).trim();
      }
    }
    return "00000000-0000-0000-0000-000000000001";
  }

  /**
   * Load VN-PART dashboard data via authenticated SELECT queries.
   *
   * @param {Object} [options]
   * @param {Object} [options.client] - Injected Supabase client (for testing)
   * @param {string} [options.workshopId] - Injected workshop ID
   * @returns {Promise<{ ok: boolean, workshopId?: string, donors?: Array, removals?: Array, code?: string, message?: string }>}
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

    const workshopId = options.workshopId || resolveCurrentWorkshopId();
    if (!workshopId) {
      return {
        ok: false,
        code: "WORKSHOP_REQUIRED",
        message: "Identifiant d'atelier requis pour charger les prélèvements VN.",
      };
    }

    try {
      const [donorsRes, removalsRes] = await Promise.all([
        client
          .from("vn_part_donor_state_v1")
          .select("*")
          .eq("workshop_id", workshopId),
        client
          .from("vn_part_removals")
          .select("*")
          .eq("workshop_id", workshopId)
          .order("created_at", { ascending: false }),
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

      return {
        ok: true,
        workshopId,
        donors: donorsRes.data || [],
        removals: removalsRes.data || [],
      };
    } catch (err) {
      return {
        ok: false,
        code: "FETCH_EXCEPTION",
        message: err?.message || "Échec inattendu lors de la lecture des prélèvements VN.",
      };
    }
  }

  return {
    loadVnPartDashboard,
    resolveCurrentWorkshopId,
    resolveSupabaseClient,
  };
});
