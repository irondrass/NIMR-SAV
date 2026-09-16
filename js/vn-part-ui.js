/**
 * NIMR-SAV — VN-PART Dashboard UI (003C)
 *
 * Ephemeral user interface for the VN-PART dashboard:
 *   - Read presentation: KPIs, dynamic grouping, multi-field search, 5 operational filters
 *   - Authoritative mutation workflows: 10 actions via Postgres RPC
 *   - Approval lookup & multi-approver progress strip (3 mandatory approvers)
 *   - Optimistic concurrency & CAS conflict handling
 *
 * ABSOLUTE INVARIANTS:
 *   - Strictly ephemeral in-memory state only (not serialized to localStorage/IndexedDB/backups)
 *   - No direct table mutations (.insert, .update, .delete, .upsert)
 *   - Exactly one mutation RPC allowed: nimr_apply_vn_part_action_v1
 *   - Mutation workshop ID derived strictly from validated membership identity
 *   - Output escaping via escapeHtml() or textContent at rendering sinks
 *   - No pre-storage HTML entity conversion
 *   - Generic beneficiary VIN length validation: NONE
 */

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      typeof require === "function" ? require("./vn-part-client.js") : null
    );
  } else {
    const client = {
      loadVnPartDashboard: root.loadVnPartDashboard,
      applyVnPartAction: root.applyVnPartAction,
      resolveVnPartMutationIdentity: root.resolveVnPartMutationIdentity,
    };
    const exportsObj = factory(client);
    Object.assign(root, exportsObj);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (clientModule) {
  "use strict";

  // Ephemeral in-memory UI state (never persisted to durable store)
  const vnPartEphemeralState = {
    donors: [],
    donorCommitments: [],
    removals: [],
    approvals: [],
    loading: false,
    error: null,
    conflictMessage: null,
    activeFilter: "all-open", // 'all-open' | 'ready' | 'overdue' | 'waiting' | 'history'
    activeRequestFilter: "all", // 'all' | 'pending' | 'authorized' | 'history'
    activeEtaFilter: "all", // 'all' | 'missing' | 'overdue' | 'followup'
    searchQuery: "",
    lastLoadedAt: null,
    mutationInProgress: false,
  };

  /**
   * Escape HTML to prevent XSS injection at rendering sinks.
   */
  function escapeHtml(str) {
    if (str === null || str === undefined) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  /**
   * Format ISO date or date string to French locale format.
   */
  function formatDateFr(dateVal) {
    if (!dateVal) return "—";
    try {
      const d = new Date(dateVal);
      if (isNaN(d.getTime())) return String(dateVal);
      return d.toLocaleDateString("fr-FR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });
    } catch {
      return String(dateVal);
    }
  }

  /**
   * Format ISO timestamp to French locale format with hours.
   */
  function formatDateTimeFr(dateVal) {
    if (!dateVal) return "—";
    try {
      const d = new Date(dateVal);
      if (isNaN(d.getTime())) return String(dateVal);
      return d.toLocaleDateString("fr-FR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return String(dateVal);
    }
  }

  /**
   * Canonical donor VIN normalization helper.
   * Compares strings using trimmed uppercase.
   * Empty or whitespace-only returns empty string.
   */
  function normalizeDonorVin(vin) {
    if (vin === null || vin === undefined) return "";
    return String(vin).trim().toUpperCase();
  }

  /**
   * Validate a donor VIN against the authoritative VN-PART VIN17 contract.
   * Donor VINs must contain exactly 17 characters and exclude I, O and Q.
   */
  function validateDonorVin(vin) {
    const normalizedVin = normalizeDonorVin(vin);
    const isValid = /^[A-HJ-NPR-Z0-9]{17}$/.test(normalizedVin);

    if (!isValid) {
      return {
        ok: false,
        normalizedVin,
        code: "INVALID_DONOR_VIN",
        message:
          "Le VIN donneur doit contenir exactement 17 caractères valides (A-H, J-N, P, R-Z et 0-9).",
      };
    }

    return {
      ok: true,
      normalizedVin,
      code: null,
      message: "",
    };
  }

  /**
   * Return today's local calendar date as YYYY-MM-DD.
   * Calendar calculations are then performed in UTC to avoid DST/timezone drift.
   */
  function getLocalTodayIso() {
    const now = new Date();
    const year = String(now.getFullYear()).padStart(4, "0");
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  /**
   * Strictly parse an ISO calendar date (YYYY-MM-DD).
   * Returns null for impossible calendar dates.
   */
  function parseEtaDateOnly(value) {
    const raw = String(value || "").trim();
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
    if (!match) return null;

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const utcMs = Date.UTC(year, month - 1, day);
    const date = new Date(utcMs);

    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day
    ) {
      return null;
    }

    return {
      iso: raw,
      utcMs,
    };
  }

  /**
   * Classify one VN-PART removal for operational ETA follow-up.
   *
   * Cadence:
   *   D0, D+1, D+3, D+5, D+7...
   *
   * Resolved/terminal records are automatically excluded.
   */
  function classifyEtaTracking(removal, todayIso = null) {
    const base = {
      trackable: false,
      category: null,
      daysFromEta: null,
      needsFollowUpToday: false,
      etaDate: null,
    };

    if (!removal || typeof removal !== "object") {
      return base;
    }

    const status = String(removal.status || "").trim();

    if (
      status !== "PRELEVE_EN_ATTENTE_PIECE" ||
      removal.replacement_available_at ||
      removal.restored_at
    ) {
      return base;
    }

    const rawEta = String(removal.expected_replacement_date || "").trim();

    // While the request is still awaiting validations, absence of ETA
    // is not yet considered an operational anomaly: Direction Pièces
    // may simply not have validated its position yet.
    if (status === "EN_ATTENTE_VALIDATIONS" && !rawEta) {
      return base;
    }

    const today =
      parseEtaDateOnly(todayIso) ||
      parseEtaDateOnly(getLocalTodayIso());

    const eta = parseEtaDateOnly(rawEta);

    if (!eta) {
      return {
        ...base,
        trackable: true,
        category: "MISSING_ETA",
      };
    }

    const daysFromEta = Math.round(
      (today.utcMs - eta.utcMs) / 86400000
    );

    let category = "UPCOMING";

    if (daysFromEta === 0) {
      category = "DUE_TODAY";
    } else if (daysFromEta > 0) {
      category = "OVERDUE";
    }

    const needsFollowUpToday =
      daysFromEta === 0 ||
      daysFromEta === 1 ||
      (daysFromEta >= 3 && daysFromEta % 2 === 1);

    return {
      trackable: true,
      category,
      daysFromEta,
      needsFollowUpToday,
      etaDate: eta.iso,
    };
  }

  /**
   * Compute global operational ETA counters from removal rows.
   */
  function computeEtaTrackingSummary(removals = [], todayIso = null) {
    const rows = (removals || [])
      .map((removal) => ({
        removal,
        ...classifyEtaTracking(removal, todayIso),
      }))
      .filter((row) => row.trackable);

    return {
      trackableCount: rows.length,
      etaMissingCount: rows.filter(
        (row) => row.category === "MISSING_ETA"
      ).length,
      etaDueTodayCount: rows.filter(
        (row) => row.category === "DUE_TODAY"
      ).length,
      etaOverdueCount: rows.filter(
        (row) => row.category === "OVERDUE"
      ).length,
      followUpTodayCount: rows.filter(
        (row) => row.needsFollowUpToday
      ).length,
    };
  }

  /**
   * Return the operational ETA queue for the requested filter.
   */
  function filterEtaTrackingRows(
    removals = [],
    filter = "all",
    todayIso = null,
    search = ""
  ) {
    const term = String(search || "").trim().toLowerCase();

    let rows = (removals || [])
      .map((removal) => ({
        removal,
        ...classifyEtaTracking(removal, todayIso),
      }))
      .filter((row) => row.trackable);

    if (filter === "missing") {
      rows = rows.filter(
        (row) => row.category === "MISSING_ETA"
      );
    } else if (filter === "overdue") {
      rows = rows.filter(
        (row) => row.category === "OVERDUE"
      );
    } else if (filter === "followup") {
      rows = rows.filter(
        (row) => row.needsFollowUpToday
      );
    }

    if (term) {
      rows = rows.filter((row) => {
        const removal = row.removal || {};

        const searchable = [
          removal.donor_vin,
          removal.donor_model,
          removal.beneficiary_vin,
          removal.beneficiary_model,
          removal.beneficiary_or,
          removal.part_reference,
          removal.part_designation,
        ]
          .map((value) => String(value || "").toLowerCase())
          .join(" ");

        return searchable.includes(term);
      });
    }

    return rows;
  }
  /**
   * Format part identity prioritizing reference over designation.
   * Primary: "REF. <part_reference> — <part_designation>"
   * Fallback: "RÉF. NON RENSEIGNÉE — <part_designation>"
   */
  function formatPartIdentity(partReference, partDesignation) {
    const ref = String(partReference || "").trim();
    const desig = String(partDesignation || "").trim() || "Pièce non spécifiée";
    if (ref) {
      return "RÉF. " + ref + " — " + desig;
    }
    return "RÉF. NON RENSEIGNÉE — " + desig;
  }

  /**
   * Render HTML markup for part identity prioritizing reference.
   */
  function renderPartIdentityHtml(partReference, partDesignation) {
    const ref = String(partReference || "").trim();
    const desig = String(partDesignation || "").trim() || "Pièce non spécifiée";
    if (ref) {
      return '<span class="vn-part-identity"><code class="vn-part-ref-tag vn-part-part-ref">RÉF. ' + escapeHtml(ref) + '</code> <span class="vn-part-desig vn-part-desig-text">— ' + escapeHtml(desig) + '</span></span>';
    }
    return '<span class="vn-part-identity"><span class="vn-part-ref-missing">RÉF. NON RENSEIGNÉE</span> <span class="vn-part-desig vn-part-desig-text">— ' + escapeHtml(desig) + '</span></span>';
  }

  /**
   * Pure deterministic helper computing donor commitment summary.
   *
   * @param {Array} removals - Workshop removal records
   * @param {string} donorVin - Target donor VIN (raw or normalized)
   * @param {Object} [options={}]
   * @param {string} [options.workshopId] - Optional workshop ID scope
   * @param {string} [options.excludeRemovalId] - Exclude current removal ID
   * @param {string} [options.currentRemovalEta] - Projected ETA for current removal (what-if)
   * @returns {Object} Summary metrics and commitment records
   */
  function computeDonorCommitmentSummary(removals = [], donorVin = "", options = {}) {
    const normTarget = normalizeDonorVin(donorVin);
    if (!normTarget) {
      return {
        normalizedVin: "",
        openCommitmentCount: 0,
        plannedRemovalCount: 0,
        physicalOpenRemovalCount: 0,
        waitingReplacementCount: 0,
        physicalWaitingReplacementCount: 0,
        physicalReplacementAvailableCount: 0,
        etaMissingCount: 0,
        nextExpectedReplacementDate: null,
        estimatedFullRestorationDate: null,
        canBeRestoredToday: false,
        donorModel: null,
        donorLocation: null,
        commitments: [],
        projectedFullRestorationDate: null,
        currentRemovalHasEta: Boolean(options.newExpectedDate || options.currentRemovalEta),
        hasCollision: false,
        collisionCount: 0,
        donorVin: "",
        donorModel: null,
        plannedCount: 0,
        physicalCount: 0,
        nextEta: null,
        fullRestorationEta: null,
        isFullEtaDefinitive: false,
        can_be_restored_today: false,
        projectedFullEta: null,
        projectedTotalCount: 0,
      };
    }

    const workshopId = options.workshopId ? String(options.workshopId).trim() : null;
    const excludeId = options.excludeRemovalId ? String(options.excludeRemovalId).trim() : null;

    // Filter matching commitments
    const matching = removals.filter((r) => {
      if (normalizeDonorVin(r.donor_vin) !== normTarget) return false;
      if (workshopId && String(r.workshop_id || "").trim() !== workshopId) return false;
      if (excludeId && String(r.id || "").trim() === excludeId) return false;
      // Exclude terminal statuses and fully restored pieces
      if (["REFUSE", "ANNULE", "CLOTURE"].includes(r.status)) return false;
      if (r.restored_at !== null && r.restored_at !== undefined) return false;
      return true;
    });

    const openCommitmentCount = matching.length;
    const plannedRemovals = matching.filter((r) => !r.removed_at);
    const plannedRemovalCount = plannedRemovals.length;
    const physicalOpenRemovals = matching.filter((r) => Boolean(r.removed_at));
    const physicalOpenRemovalCount = physicalOpenRemovals.length;

    // Waiting for replacement arrival across open commitments
    const waitingReplacement = matching.filter((r) => !r.replacement_available_at);
    const waitingReplacementCount = waitingReplacement.length;

    // Physical waiting vs available
    const physicalWaitingReplacementCount = physicalOpenRemovals.filter(
      (r) => !r.replacement_available_at
    ).length;
    const physicalReplacementAvailableCount = physicalOpenRemovals.filter(
      (r) => Boolean(r.replacement_available_at)
    ).length;

    // Missing ETA count among open commitments still needing replacement
    const etaMissing = waitingReplacement.filter(
      (r) => !r.expected_replacement_date
    );
    const etaMissingCount = etaMissing.length;

    // Valid ETA dates for commitments still needing replacement
    const etaDates = waitingReplacement
      .map((r) => r.expected_replacement_date)
      .filter((d) => Boolean(d) && !isNaN(new Date(d).getTime()))
      .sort();

    const nextExpectedReplacementDate = etaDates.length > 0 ? etaDates[0] : null;
    const estimatedFullRestorationDate = etaDates.length > 0 ? etaDates[etaDates.length - 1] : null;

    // Section 11: can_be_restored_today is STRICTLY PHYSICAL
    // physical_open_removal_count > 0 AND physical_waiting_replacement_count = 0
    const canBeRestoredToday =
      physicalOpenRemovalCount > 0 && physicalWaitingReplacementCount === 0;

    // Most recent donor_model and donor_location from matching
    const sortedByTime = [...matching].sort((a, b) => {
      const ta = new Date(a.updated_at || a.created_at || 0).getTime();
      const tb = new Date(b.updated_at || b.created_at || 0).getTime();
      return tb - ta;
    });
    const donorModel = sortedByTime.find((r) => r.donor_model)?.donor_model || null;
    const donorLocation = sortedByTime.find((r) => r.donor_location)?.donor_location || null;

    // What-if projection
    let projectedFullRestorationDate = estimatedFullRestorationDate;
    const currentEta = (options.newExpectedDate || options.currentRemovalEta)
      ? String(options.newExpectedDate || options.currentRemovalEta).trim()
      : null;
    if (currentEta && !isNaN(new Date(currentEta).getTime())) {
      const allDates = [...etaDates, currentEta].sort();
      projectedFullRestorationDate = allDates[allDates.length - 1];
    }

    return {
      normalizedVin: normTarget,
      openCommitmentCount,
      plannedRemovalCount,
      physicalOpenRemovalCount,
      waitingReplacementCount,
      physicalWaitingReplacementCount,
      physicalReplacementAvailableCount,
      etaMissingCount,
      nextExpectedReplacementDate,
      estimatedFullRestorationDate,
      canBeRestoredToday,
      donorModel,
      donorLocation,
      commitments: matching,
      projectedFullRestorationDate,
      currentRemovalHasEta: Boolean(currentEta),
      // Aliases for convenience & test parity
      hasCollision: openCommitmentCount > 0,
      collisionCount: openCommitmentCount,
      donorVin: normTarget,
      plannedCount: plannedRemovalCount,
      physicalCount: physicalOpenRemovalCount,
      nextEta: nextExpectedReplacementDate,
      fullRestorationEta: estimatedFullRestorationDate,
      isFullEtaDefinitive: openCommitmentCount > 0 && etaMissingCount === 0,
      can_be_restored_today: canBeRestoredToday,
      projectedFullEta: projectedFullRestorationDate,
      projectedTotalCount: openCommitmentCount + (currentEta ? 1 : 0),
    };
  }

  /**
   * Exact KPI derivations:
   * 1. VN restant à restituer: Count of donor rows where active_removals_remaining > 0
   * 2. Pièces non restituées: SUM(quantity) from removals where removed_at IS NOT NULL and restored_at IS NULL
   * 3. VN prêts à restituer: Count of donor rows where can_be_restored_today = true
   * 4. VN en retard: Count of donor rows where overdue_count > 0
   */
  function computeVnPartKpis(donors = [], removals = []) {
    const activeDonors = donors.filter(
      (d) => Number(d.active_removals_remaining || 0) > 0
    );
    const remainingDonorsCount = activeDonors.length;

    const unreturnedPartsQuantity = removals
      .filter((r) => r.removed_at !== null && r.removed_at !== undefined && (r.restored_at === null || r.restored_at === undefined))
      .reduce((sum, r) => sum + (Number(r.quantity) || 1), 0);

    const readyDonorsCount = donors.filter(
      (d) => Boolean(d.can_be_restored_today)
    ).length;

    const overdueDonorsCount = donors.filter(
      (d) => Number(d.overdue_count || 0) > 0
    ).length;

    return {
      remainingDonorsCount,
      unreturnedPartsQuantity,
      readyDonorsCount,
      overdueDonorsCount,
    };
  }

  /**
   * Filter and search donors and their removals.
   */
  function filterVnPartDonors(donors = [], removals = [], filter = "all-open", search = "") {
    const term = String(search || "").trim().toLowerCase();

    // Map removals by donor VIN for search/hierarchy
    const removalsByVin = new Map();
    for (const r of removals) {
      const vin = String(r.donor_vin || "").trim();
      if (!vin) continue;
      if (!removalsByVin.has(vin)) removalsByVin.set(vin, []);
      removalsByVin.get(vin).push(r);
    }

    return donors.filter((donor) => {
      // 1. Filter by category
      if (filter === "all-open") {
        if (Number(donor.active_removals_remaining || 0) <= 0) return false;
      } else if (filter === "ready") {
        if (!donor.can_be_restored_today) return false;
      } else if (filter === "overdue") {
        if (Number(donor.overdue_count || 0) <= 0) return false;
      } else if (filter === "waiting") {
        if (Number(donor.waiting_replacement_count || 0) <= 0) return false;
      } else if (filter === "history") {
        if (!donor.is_fully_restored) return false;
      }

      // 2. Search query (case-insensitive, trimmed)
      if (term) {
        const donorModel = String(donor.donor_model || "").toLowerCase();
        const donorVin = String(donor.donor_vin || "").toLowerCase();
        const donorLoc = String(donor.donor_location || "").toLowerCase();

        let matchesSearch =
          donorModel.includes(term) ||
          donorVin.includes(term) ||
          donorLoc.includes(term);

        if (!matchesSearch) {
          const donorRemovals = removalsByVin.get(String(donor.donor_vin || "").trim()) || [];
          for (const rem of donorRemovals) {
            const benModel = String(rem.beneficiary_model || "").toLowerCase();
            const benVin = String(rem.beneficiary_vin || "").toLowerCase();
            const benOr = String(rem.beneficiary_or || "").toLowerCase();
            const partRef = String(rem.part_reference || "").toLowerCase();
            const partDes = String(rem.part_designation || "").toLowerCase();

            if (
              benModel.includes(term) ||
              benVin.includes(term) ||
              benOr.includes(term) ||
              partRef.includes(term) ||
              partDes.includes(term)
            ) {
              matchesSearch = true;
              break;
            }
          }
        }
        if (!matchesSearch) return false;
      }

      return true;
    });
  }

  /**
   * Filter and search pre-removal workflow requests (Section A).
   * Requests remain in Section A until physical removal (CONFIRM_REMOVAL).
   */
  function filterVnPartRequests(removals = [], filter = "all", search = "") {
    const term = String(search || "").trim().toLowerCase();

    return (removals || []).filter((rem) => {
      // 1. Duplication rule: once physically removed, it belongs exclusively to Section B
      if (rem.removed_at) return false;

      // 2. Filter by status category
      if (filter === "pending" || filter === "to-validate") {
        if (rem.status !== "EN_ATTENTE_VALIDATIONS") return false;
      } else if (filter === "authorized") {
        if (rem.status !== "AUTORISE_A_PRELEVER") return false;
      } else if (filter === "history") {
        if (!["REFUSE", "ANNULE", "CLOTURE"].includes(rem.status)) return false;
      } else if (filter === "all" || filter === "all-open" || !filter) {
        // Active pre-removal workflow requests: terminal statuses are strictly excluded
        if (["REFUSE", "ANNULE", "CLOTURE"].includes(rem.status)) return false;
      }

      // 3. Search query across removal fields
      if (term) {
        const benModel = String(rem.beneficiary_model || "").toLowerCase();
        const benVin = String(rem.beneficiary_vin || "").toLowerCase();
        const benOr = String(rem.beneficiary_or || "").toLowerCase();
        const partRef = String(rem.part_reference || "").toLowerCase();
        const partDes = String(rem.part_designation || "").toLowerCase();
        const donorModel = String(rem.donor_model || "").toLowerCase();
        const donorVin = String(rem.donor_vin || "").toLowerCase();
        const reason = String(rem.reason || "").toLowerCase();

        const matchesSearch =
          benModel.includes(term) ||
          benVin.includes(term) ||
          benOr.includes(term) ||
          partRef.includes(term) ||
          partDes.includes(term) ||
          donorModel.includes(term) ||
          donorVin.includes(term) ||
          reason.includes(term);

        if (!matchesSearch) return false;
      }

      return true;
    });
  }

  /**
   * Group filtered donors dynamically by Model -> Donor VIN -> Removals.
   */
  function groupVnPartByModelAndVin(donors = [], removals = []) {
    const removalsByVin = new Map();
    for (const r of removals) {
      const vin = String(r.donor_vin || "").trim();
      if (!vin) continue;
      if (!removalsByVin.has(vin)) removalsByVin.set(vin, []);
      removalsByVin.get(vin).push(r);
    }

    const groups = new Map();

    for (const donor of donors) {
      const vin = String(donor.donor_vin || "").trim();
      if (!vin) continue;
      const model = String(donor.donor_model || "Modèle non spécifié").trim();
      if (!groups.has(model)) {
        groups.set(model, []);
      }
      const donorRemovals = removalsByVin.get(vin) || [];
      groups.get(model).push({
        donor,
        removals: donorRemovals,
      });
    }

    const sortedModelNames = Array.from(groups.keys()).sort((a, b) =>
      a.localeCompare(b, "fr", { sensitivity: "base" })
    );

    const sortedGroups = sortedModelNames.map((model) => {
      const items = groups.get(model);
      items.sort((a, b) => {
        const aOverdue = Number(a.donor.overdue_count || 0) > 0 ? 1 : 0;
        const bOverdue = Number(b.donor.overdue_count || 0) > 0 ? 1 : 0;
        if (bOverdue !== aOverdue) return bOverdue - aOverdue;

        const aActive = Number(a.donor.active_removals_remaining || 0);
        const bActive = Number(b.donor.active_removals_remaining || 0);
        if (bActive !== aActive) return bActive - aActive;

        const aDate = a.donor.oldest_opened_at ? new Date(a.donor.oldest_opened_at).getTime() : 0;
        const bDate = b.donor.oldest_opened_at ? new Date(b.donor.oldest_opened_at).getTime() : 0;
        if (aDate && bDate && aDate !== bDate) return aDate - bDate;

        return String(a.donor.donor_vin || "").localeCompare(String(b.donor.donor_vin || ""));
      });
      return {
        model,
        items,
      };
    });

    return sortedGroups;
  }

  /**
   * Deterministic approval indexing: Map keyed by `${removal_id}:${approval_role}`.
   */
  function buildApprovalLookup(approvals = []) {
    const lookup = new Map();
    for (const a of approvals) {
      if (a && a.removal_id && a.approval_role) {
        lookup.set(`${a.removal_id}:${a.approval_role}`, a);
      }
    }
    return lookup;
  }

  /**
   * Resolve current active identity safely using the client module or global resolver.
   */
  function getCurrentIdentity() {
    if (clientModule && typeof clientModule.resolveVnPartMutationIdentity === "function") {
      return clientModule.resolveVnPartMutationIdentity();
    }
    if (typeof resolveVnPartMutationIdentity === "function") {
      return resolveVnPartMutationIdentity();
    }
    if (typeof window !== "undefined" && typeof window.resolveVnPartMutationIdentity === "function") {
      return window.resolveVnPartMutationIdentity();
    }
    return { ok: false, code: "IDENTITY_NOT_READY" };
  }

  /**
   * Helper to determine available UI mutation actions for a given removal row and identity.
   * NOTE: This controls UI visibility only. The server remains final authority.
   */
  function getAvailableVnPartActions(removal, approvals = [], identity = null) {
    if (!removal || !removal.id) return [];
    if (!identity || !identity.ok) return [];

    const role = identity.role;
    const authUserId = identity.authUserId;
    const isCreator = Boolean(
      removal.created_by &&
      authUserId &&
      String(removal.created_by).trim() === String(authUserId).trim()
    );
    const status = removal.status;
    const approvalLookup = buildApprovalLookup(approvals);
    const hasDecided = approvalLookup.has(`${removal.id}:${role}`);

    const actions = [];

    // APPROVE
    if (
      status === "EN_ATTENTE_VALIDATIONS" &&
      ["directeur", "directeur_pieces", "responsable_qualite_parc_vn"].includes(role) &&
      !isCreator &&
      !hasDecided
    ) {
      actions.push("APPROVE");
    }

    // REFUSE
    if (
      status === "EN_ATTENTE_VALIDATIONS" &&
      ["directeur", "directeur_pieces", "responsable_qualite_parc_vn"].includes(role) &&
      !hasDecided
    ) {
      actions.push("REFUSE");
    }

    // CANCEL
    if (
      ["EN_ATTENTE_VALIDATIONS", "AUTORISE_A_PRELEVER"].includes(status) &&
      (isCreator || role === "directeur")
    ) {
      actions.push("CANCEL");
    }

    // REVISE_ETA
    if (
      !["CLOTURE", "ANNULE", "REFUSE"].includes(status) &&
      role === "directeur_pieces"
    ) {
      actions.push("REVISE_ETA");
    }

    // REVISE_DONOR
    if (
      ["EN_ATTENTE_VALIDATIONS", "AUTORISE_A_PRELEVER"].includes(status) &&
      role === "responsable_qualite_parc_vn"
    ) {
      actions.push("REVISE_DONOR");
    }

    // CONFIRM_REMOVAL
    if (
      status === "AUTORISE_A_PRELEVER" &&
      role === "chef_atelier"
    ) {
      actions.push("CONFIRM_REMOVAL");
    }

    // STORE_ACK (UI Rule: only offered when store_ack_at is null)
    if (
      ["AUTORISE_A_PRELEVER", "PRELEVE_EN_ATTENTE_PIECE"].includes(status) &&
      role === "responsable_magasin" &&
      (removal.store_ack_at === null || removal.store_ack_at === undefined)
    ) {
      actions.push("STORE_ACK");
    }

    // MARK_REPLACEMENT_AVAILABLE
    if (
      status === "PRELEVE_EN_ATTENTE_PIECE" &&
      ["responsable_magasin", "directeur_pieces"].includes(role)
    ) {
      actions.push("MARK_REPLACEMENT_AVAILABLE");
    }

    // CONFIRM_RESTITUTION
    if (
      status === "PIECE_DISPONIBLE" &&
      role === "chef_atelier"
    ) {
      actions.push("CONFIRM_RESTITUTION");
    }

    return actions;
  }

  /**
   * Render the 3-position approval progress strip for a removal.
   */
  function renderApprovalStrip(removal, approvalLookup) {
    const lookup = (approvalLookup && typeof approvalLookup.get === "function")
      ? approvalLookup
      : (Array.isArray(approvalLookup) ? buildApprovalLookup(approvalLookup) : new Map());
    const roles = [
      { roleKey: "directeur", label: "Directeur SAV" },
      { roleKey: "directeur_pieces", label: "Direction Pièces (ETA)" },
      { roleKey: "responsable_qualite_parc_vn", label: "Chef de Parc VN (Donneur)" },
    ];

    let approvedCount = 0;
    for (const r of roles) {
      const a = lookup.get(`${removal.id}:${r.roleKey}`);
      if (a && a.decision === "APPROVED") approvedCount++;
    }

    let pillsHtml = "";
    for (const r of roles) {
      const a = lookup.get(`${removal.id}:${r.roleKey}`);
      let statusClass = "status-pending";
      let statusText = "En attente";

      if (a) {
        if (a.decision === "APPROVED") {
          statusClass = "status-approved";
          if (r.roleKey === "directeur_pieces" && removal.expected_replacement_date) {
            statusText = `Validé (ETA: ${formatDateFr(removal.expected_replacement_date)})`;
          } else if (r.roleKey === "responsable_qualite_parc_vn" && removal.donor_vin) {
            statusText = `Validé (${escapeHtml(removal.donor_vin)})`;
          } else {
            statusText = `Validé le ${formatDateFr(a.decided_at)}`;
          }
        } else if (a.decision === "REFUSED") {
          statusClass = "status-refused";
          statusText = `Refusé (${escapeHtml(a.reason || "Motif non spécifié")})`;
        }
      }

      pillsHtml += `
        <div class="vn-part-approval-pill ${statusClass}">
          <span class="pill-role">${escapeHtml(r.label)}:</span>
          <span class="pill-status">${statusText}</span>
        </div>
      `;
    }

    return `
      <div class="vn-part-approvals-strip" aria-label="État des validations">
        <div class="vn-part-approvals-heading">
          <span class="vn-part-approvals-title">Validations requises (${approvedCount}/3)</span>
        </div>
        <div class="vn-part-approvals-list">
          ${pillsHtml}
        </div>
      </div>
    `;
  }

  /**
   * Action button labels dictionary.
   */
  const ACTION_LABELS = {
    APPROVE: "Valider",
    REFUSE: "Refuser",
    CANCEL: "Annuler la demande",
    REVISE_ETA: "Réviser date (ETA)",
    REVISE_DONOR: "Modifier véhicule donneur",
    CONFIRM_REMOVAL: "Confirmer prélèvement",
    STORE_ACK: "Prise en compte magasin",
    MARK_REPLACEMENT_AVAILABLE: "Déclarer pièce disponible",
    CONFIRM_RESTITUTION: "Confirmer restitution VN",
  };

  /**
   * Render contextual mutation action buttons for a removal card.
   */
  function renderRemovalActionButtons(removal, availableActions, isLocked) {
    if (!availableActions || !availableActions.length) return "";

    let buttonsHtml = "";
    for (const action of availableActions) {
      const label = ACTION_LABELS[action] || action;
      let btnClass = "secondary-button vn-part-action-btn";
      if (action === "APPROVE" || action === "CONFIRM_REMOVAL" || action === "CONFIRM_RESTITUTION" || action === "MARK_REPLACEMENT_AVAILABLE") {
        btnClass = "primary-button vn-part-action-btn";
      } else if (action === "REFUSE" || action === "CANCEL") {
        btnClass = "ghost-button vn-part-action-btn text-danger";
      }

      buttonsHtml += `
        <button
          type="button"
          class="${btnClass}"
          data-action="${escapeHtml(action)}"
          data-removal-id="${escapeHtml(removal.id)}"
          data-version="${removal.version}"
          ${isLocked ? "disabled" : ""}
        >
          ${escapeHtml(label)}
        </button>
      `;
    }

    return `
      <div class="vn-part-card-actions">
        ${buttonsHtml}
      </div>
    `;
  }

  /**
   * Render the operational ETA tracking section.
   * Uses existing VN-PART card/filter styles to keep this slice scoped.
   */
  function renderEtaTrackingSection(
    removals,
    identity,
    activeFilter = "all",
    todayIso = null,
    search = ""
  ) {
    const summary = computeEtaTrackingSummary(removals, todayIso);
    const rows = filterEtaTrackingRows(
      removals,
      activeFilter,
      todayIso,
      search
    );

    const filterButton = (filter, label, count) => `
      <button
        type="button"
        class="vn-part-req-filter-btn vn-part-eta-filter-btn ${activeFilter === filter ? "active" : ""}"
        data-eta-filter="${filter}"
        aria-pressed="${activeFilter === filter}"
      >${label} (${count})</button>
    `;

    let html = `
      <section
        id="vn-part-eta-section"
        class="vn-part-section vn-part-eta-section"
        aria-labelledby="vn-part-eta-heading"
      >
        <div class="vn-part-section-header">
          <div class="vn-part-section-title-wrap">
            <h2 id="vn-part-eta-heading" class="vn-part-section-title">
              ÉCHÉANCES PIÈCES
              <span class="vn-part-section-count">(${summary.trackableCount})</span>
            </h2>
            <p class="vn-part-section-sub">
              ETA manquante: ${summary.etaMissingCount}
              • ETA aujourd'hui: ${summary.etaDueTodayCount}
              • ETA dépassée: ${summary.etaOverdueCount}
              • À relancer aujourd'hui: ${summary.followUpTodayCount}
            </p>
          </div>

          <div
            class="vn-part-req-filters"
            role="group"
            aria-label="Filtrer les échéances pièces"
          >
            ${filterButton("all", "Toutes", summary.trackableCount)}
            ${filterButton("missing", "ETA manquante", summary.etaMissingCount)}
            ${filterButton("overdue", "ETA dépassée", summary.etaOverdueCount)}
            ${filterButton("followup", "À relancer aujourd'hui", summary.followUpTodayCount)}
          </div>
        </div>
    `;

    if (!rows.length) {
      html += `
        <div class="vn-part-section-empty">
          <p>Aucune échéance pièce ne correspond aux critères sélectionnés.</p>
        </div>
      `;
    } else {
      html += `<div class="vn-part-requests-list">`;

      for (const row of rows) {
        const rem = row.removal;

        let etaBadge = "";
        let etaValue = "Non renseignée";

        if (row.category === "MISSING_ETA") {
          etaBadge =
            `<span class="vn-part-badge badge-waiting">🟠 ETA MANQUANTE</span>`;
        } else if (row.category === "DUE_TODAY") {
          etaBadge =
            `<span class="vn-part-badge badge-overdue">🔴 ÉCHÉANCE AUJOURD'HUI</span>`;
          etaValue = formatDateFr(rem.expected_replacement_date);
        } else if (row.category === "OVERDUE") {
          etaBadge =
            `<span class="vn-part-badge badge-overdue">🔴 ETA DÉPASSÉE D+${Number(row.daysFromEta)}</span>`;
          etaValue = formatDateFr(rem.expected_replacement_date);
        } else {
          etaBadge =
            `<span class="vn-part-badge badge-neutral">🔵 ETA À VENIR</span>`;
          etaValue = formatDateFr(rem.expected_replacement_date);
        }

        const followUpBadge = row.needsFollowUpToday
          ? `<span class="vn-part-badge badge-waiting">📞 À relancer aujourd'hui</span>`
          : "";

        const availableActions = getAvailableVnPartActions(
          rem,
          vnPartEphemeralState.approvals,
          identity
        ).filter((action) =>
          ["REVISE_ETA", "MARK_REPLACEMENT_AVAILABLE"].includes(action)
        );

        const actionsHtml = renderRemovalActionButtons(
          rem,
          availableActions,
          vnPartEphemeralState.mutationInProgress
        );

        html += `
          <article
            class="vn-part-request-card vn-part-eta-card"
            data-id="${escapeHtml(rem.id)}"
            data-version="${Number(rem.version) || 0}"
          >
            <header class="vn-part-request-card-header">
              <div class="vn-part-request-card-title">
                <h3 class="vn-part-request-part-title">
                  ${renderPartIdentityHtml(rem.part_reference, rem.part_designation)}
                </h3>
              </div>

              <div class="vn-part-request-card-badges">
                ${etaBadge}
                ${followUpBadge}
              </div>
            </header>

            <div class="vn-part-request-details-grid">
              <div class="vn-part-detail-cell">
                <span class="cell-label">ETA actuelle:</span>
                <strong class="cell-val">${escapeHtml(etaValue)}</strong>
              </div>

              <div class="vn-part-detail-cell">
                <span class="cell-label">Véhicule donneur:</span>
                <span class="cell-val">
                  ${escapeHtml(rem.donor_model || "—")}
                  ${rem.donor_vin ? ` (${escapeHtml(rem.donor_vin)})` : ""}
                </span>
              </div>

              <div class="vn-part-detail-cell">
                <span class="cell-label">Véhicule bénéficiaire:</span>
                <span class="cell-val">
                  ${escapeHtml(rem.beneficiary_model || "—")}
                  ${rem.beneficiary_vin ? ` (${escapeHtml(rem.beneficiary_vin)})` : ""}
                </span>
              </div>

              ${rem.beneficiary_or ? `
                <div class="vn-part-detail-cell">
                  <span class="cell-label">N° OR:</span>
                  <span class="cell-val">${escapeHtml(rem.beneficiary_or)}</span>
                </div>
              ` : ""}
            </div>

            ${actionsHtml}
          </article>
        `;
      }

      html += `</div>`;
    }

    html += `</section>`;

    return html;
  }
  /**
   * Render an individual pre-removal request card for Section A.
   */
  function renderRequestCard(rem, approvalLookup, identity) {
    let statusBadge = "";
    if (rem.status === "EN_ATTENTE_VALIDATIONS") {
      statusBadge = `<span class="vn-part-badge badge-waiting">🟠 EN ATTENTE DE VALIDATION</span>`;
    } else if (rem.status === "AUTORISE_A_PRELEVER") {
      statusBadge = `<span class="vn-part-badge badge-ready">🔵 AUTORISÉ À PRÉLEVER</span>`;
    } else if (rem.status === "REFUSE") {
      statusBadge = `<span class="vn-part-badge badge-overdue">🔴 REFUSÉ</span>`;
    } else if (rem.status === "ANNULE") {
      statusBadge = `<span class="vn-part-badge badge-neutral">⚪ ANNULÉ</span>`;
    } else {
      statusBadge = `<span class="vn-part-badge badge-neutral">${escapeHtml(rem.status)}</span>`;
    }

    let urgencyBadge = "";
    if (rem.urgency && rem.urgency !== "NORMAL") {
      urgencyBadge = `<span class="vn-part-badge badge-overdue" title="Urgence">${escapeHtml(rem.urgency)}</span>`;
    }

    const approvalStripHtml = renderApprovalStrip(rem, approvalLookup);
    const availableActions = getAvailableVnPartActions(rem, vnPartEphemeralState.approvals, identity);
    const actionsHtml = renderRemovalActionButtons(rem, availableActions, vnPartEphemeralState.mutationInProgress);

    return `
      <article class="vn-part-request-card" data-id="${escapeHtml(rem.id)}" data-version="${rem.version}">
        <header class="vn-part-request-card-header">
          <div class="vn-part-request-card-title">
            <h3 class="vn-part-request-part-title">${renderPartIdentityHtml(rem.part_reference, rem.part_designation)}</h3>
            <span class="vn-part-qty">Qté: ${Number(rem.quantity) || 1}</span>
          </div>
          <div class="vn-part-request-card-badges">
            ${urgencyBadge}
            ${statusBadge}
          </div>
        </header>

        <div class="vn-part-request-details-grid">
          <div class="vn-part-detail-cell">
            <span class="cell-label">Véhicule bénéficiaire:</span>
            <span class="cell-val">${escapeHtml(rem.beneficiary_model || "—")}${rem.beneficiary_vin ? ` (${escapeHtml(rem.beneficiary_vin)})` : ""}</span>
          </div>
          ${rem.beneficiary_or ? `
            <div class="vn-part-detail-cell">
              <span class="cell-label">N° Ordre de Réparation:</span>
              <span class="cell-val">${escapeHtml(rem.beneficiary_or)}</span>
            </div>
          ` : ""}
          ${rem.reason ? `
            <div class="vn-part-detail-cell">
              <span class="cell-label">Motif / Justification:</span>
              <span class="cell-val">${escapeHtml(rem.reason)}</span>
            </div>
          ` : ""}
          ${rem.comments ? `
            <div class="vn-part-detail-cell">
              <span class="cell-label">Remarques / Précisions:</span>
              <span class="cell-val">${escapeHtml(rem.comments)}</span>
            </div>
          ` : ""}
          ${rem.created_at ? `
            <div class="vn-part-detail-cell">
              <span class="cell-label">Date de création:</span>
              <span class="cell-val">${escapeHtml(formatDateTimeFr(rem.created_at))}</span>
            </div>
          ` : ""}
          ${rem.donor_vin ? `
            <div class="vn-part-detail-cell">
              <span class="cell-label">Véhicule donneur:</span>
              <span class="cell-val">${escapeHtml(rem.donor_model || "")} (${escapeHtml(rem.donor_vin)})${rem.donor_location ? ` — ${escapeHtml(rem.donor_location)}` : ""}</span>
            </div>
          ` : `
            <div class="vn-part-detail-cell">
              <span class="cell-label">Véhicule donneur:</span>
              <span class="cell-val text-muted">Non assigné (à désigner par Chef de Parc VN)</span>
            </div>
          `}
          ${rem.expected_replacement_date ? `
            <div class="vn-part-detail-cell">
              <span class="cell-label">Date estimée (ETA):</span>
              <span class="cell-val">${escapeHtml(formatDateFr(rem.expected_replacement_date))}</span>
            </div>
          ` : ""}
          ${rem.removed_at ? `
            <div class="vn-part-detail-cell">
              <span class="cell-label">Date prélèvement:</span>
              <span class="cell-val">${escapeHtml(formatDateTimeFr(rem.removed_at))}</span>
            </div>
          ` : ""}
          ${rem.replacement_available_at ? `
            <div class="vn-part-detail-cell">
              <span class="cell-label">Pièce reçue le:</span>
              <span class="cell-val">${escapeHtml(formatDateTimeFr(rem.replacement_available_at))}</span>
            </div>
          ` : ""}
          ${rem.restored_at ? `
            <div class="vn-part-detail-cell">
              <span class="cell-label">Restitué au VN le:</span>
              <span class="cell-val">${escapeHtml(formatDateTimeFr(rem.restored_at))}</span>
            </div>
          ` : ""}
        </div>

        ${approvalStripHtml}
        ${actionsHtml}
      </article>
    `;
  }

  /**
   * Ensure that navigation button, view section, and mutation modals are mounted in DOM.
   */
  function ensureVnPartDomMounted() {
    if (typeof document === "undefined") return;

    // 1. Mount Navigation Button if not already present
    let navBtn = document.querySelector('.nav-button[data-tab="vn-part"]');
    if (!navBtn) {
      const sidebarNav = document.querySelector(".sidebar-nav");
      if (sidebarNav) {
        navBtn = document.createElement("button");
        navBtn.className = "nav-button";
        navBtn.type = "button";
        navBtn.dataset.tab = "vn-part";
        navBtn.innerHTML = `
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.5 2.8C2.1 10.8 2 11 2 11.2V16c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/></svg>
          Prélèvements VN
        `;
        const divider = sidebarNav.querySelector(".sidebar-nav-divider");
        if (divider) {
          sidebarNav.insertBefore(navBtn, divider);
        } else {
          sidebarNav.appendChild(navBtn);
        }
        navBtn.addEventListener("click", () => {
          if (typeof window.setActiveTab === "function") {
            window.setActiveTab("vn-part");
          }
          refreshVnPartDashboard();
        });
      }
    }

    // 2. Mount View Section if not already present
    let viewSection = document.getElementById("view-vn-part");
    if (!viewSection) {
      const mainContent = document.getElementById("main-content");
      if (mainContent) {
        viewSection = document.createElement("section");
        viewSection.className = "view";
        viewSection.id = "view-vn-part";
        viewSection.hidden = true;
        viewSection.innerHTML = `
          <div class="vn-part-shell">
            <header class="vn-part-header">
              <div class="vn-part-header-main">
                <div>
                  <h1 class="vn-part-title">VN RESTANT À RESTITUER</h1>
                  <p class="vn-part-subtitle">Suivi opérationnel des pièces prélevées sur véhicules neufs</p>
                </div>
                <div class="vn-part-header-actions">
                  <button type="button" class="primary-button" id="vn-part-new-request-btn" style="display:none;">
                    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    Nouveau Prélèvement VN
                  </button>
                  <button type="button" class="ghost-button" id="vn-part-refresh-btn" title="Actualiser les données">
                    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
                    Actualiser
                  </button>
                </div>
              </div>

              <!-- Conflict notification banner if version mismatch occurs -->
              <div id="vn-part-conflict-banner" class="vn-part-conflict-banner" role="alert" style="display:none;">
                <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                <div class="vn-part-conflict-text">
                  <strong>Conflit de version détecté</strong>
                  <p id="vn-part-conflict-message">Ce dossier a été mis à jour par un autre utilisateur. Les données ont été actualisées. Veuillez vérifier les nouvelles informations avant de recommencer.</p>
                </div>
                <button type="button" class="ghost-button" id="vn-part-conflict-dismiss">Fermer</button>
              </div>

              <!-- 4 KPI Cards -->
              <div class="vn-part-kpi-grid" aria-label="Indicateurs clés prélèvements VN">
                <article class="vn-part-kpi-card" id="card-kpi-remaining">
                  <div class="vn-part-kpi-label">VN restant à restituer</div>
                  <div class="vn-part-kpi-val" id="vn-part-kpi-remaining">0</div>
                  <div class="vn-part-kpi-sub">Véhicules donneurs incomplets</div>
                </article>
                <article class="vn-part-kpi-card" id="card-kpi-unreturned">
                  <div class="vn-part-kpi-label">Pièces non restituées</div>
                  <div class="vn-part-kpi-val" id="vn-part-kpi-unreturned">0</div>
                  <div class="vn-part-kpi-sub">Total pièces physiques prélevées</div>
                </article>
                <article class="vn-part-kpi-card is-ready-card" id="card-kpi-ready">
                  <div class="vn-part-kpi-label">VN prêts à restituer</div>
                  <div class="vn-part-kpi-val text-success" id="vn-part-kpi-ready">0</div>
                  <div class="vn-part-kpi-sub">Pièces reçues disponibles</div>
                </article>
                <article class="vn-part-kpi-card is-overdue-card" id="card-kpi-overdue">
                  <div class="vn-part-kpi-label">VN en retard</div>
                  <div class="vn-part-kpi-val text-danger" id="vn-part-kpi-overdue">0</div>
                  <div class="vn-part-kpi-sub">Dépassement date estimée</div>
                </article>
              </div>

              <!-- Toolbar: Search & 5 Filters -->
              <div class="vn-part-toolbar">
                <div class="vn-part-search-wrap">
                  <svg viewBox="0 0 24 24" class="vn-part-search-icon" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                  <input
                    type="search"
                    id="vn-part-search-input"
                    class="vn-part-search-input"
                    placeholder="Rechercher par modèle, VIN, OR, réf ou désignation..."
                    aria-label="Rechercher un dossier VN"
                  />
                </div>
                <div class="vn-part-filters" role="group" aria-label="Filtrer les véhicules donneurs">
                  <button type="button" class="vn-part-filter-btn active" data-filter="all-open" aria-pressed="true">Tous ouverts</button>
                  <button type="button" class="vn-part-filter-btn" data-filter="ready" aria-pressed="false">Prêts à restituer</button>
                  <button type="button" class="vn-part-filter-btn" data-filter="overdue" aria-pressed="false">En retard</button>
                  <button type="button" class="vn-part-filter-btn" data-filter="waiting" aria-pressed="false">En attente pièce</button>
                  <button type="button" class="vn-part-filter-btn" data-filter="history" aria-pressed="false">Historique</button>
                </div>
              </div>
            </header>

            <!-- Main dynamic content container -->
            <div id="vn-part-content" class="vn-part-content" aria-live="polite">
              <div class="vn-part-loading" role="status">
                <div class="vn-part-spinner" aria-hidden="true"></div>
                <p>Chargement des prélèvements VN...</p>
              </div>
            </div>

            <!-- Modals Container -->
            <div id="vn-part-modals-host" class="vn-part-modals-host"></div>
          </div>
        `;
        mainContent.appendChild(viewSection);
      }
    }
  }

  /**
   * Synchronize the primary navigation button visibility and create request button.
   */
  function syncVnPartNavVisibility() {
    if (typeof document === "undefined") return;
    ensureVnPartDomMounted();
    const btn = document.querySelector('.nav-button[data-tab="vn-part"]');
    if (!btn) return;
    const isAllowed = typeof canAccessTab === "function" ? canAccessTab("vn-part") : false;
    btn.hidden = !isAllowed;
    btn.style.display = isAllowed ? "" : "none";

    const createBtn = document.getElementById("vn-part-new-request-btn");
    if (createBtn) {
      const identity = getCurrentIdentity();
      const canCreate = identity.ok && ["chef_atelier", "responsable_garantie_support"].includes(identity.role);
      createBtn.style.display = canCreate ? "" : "none";
    }
  }

  /**
   * Load dashboard data from client and update UI.
   */
  async function refreshVnPartDashboard() {
    if (typeof document === "undefined") return;
    const canAccessFn =
      typeof canAccessTab === "function"
        ? canAccessTab
        : typeof window !== "undefined" && typeof window.canAccessTab === "function"
        ? window.canAccessTab
        : null;
    if (canAccessFn && !canAccessFn("vn-part")) return;
    if (vnPartEphemeralState.loading) return;
    ensureVnPartDomMounted();
    const container = document.getElementById("vn-part-content");
    if (!container) return;

    vnPartEphemeralState.loading = true;
    vnPartEphemeralState.error = null;
    renderVnPartView();

    const clientFn =
      (clientModule && clientModule.loadVnPartDashboard) ||
      (typeof loadVnPartDashboard === "function" ? loadVnPartDashboard : null) ||
      (typeof window !== "undefined" ? window.loadVnPartDashboard : null);

    if (!clientFn) {
      vnPartEphemeralState.loading = false;
      vnPartEphemeralState.error = {
        code: "CLIENT_MISSING",
        message: "Module client VN-PART introuvable.",
      };
      renderVnPartView();
      return;
    }

    const result = await clientFn();
    vnPartEphemeralState.loading = false;
    if (!result.ok) {
      vnPartEphemeralState.error = {
        code: result.code || "UNKNOWN_ERROR",
        message: result.message || "Erreur de chargement des données VN-PART.",
      };
    } else {
      vnPartEphemeralState.donors = result.donors || [];
      vnPartEphemeralState.donorCommitments = result.donorCommitments || [];
      vnPartEphemeralState.removals = result.removals || [];
      vnPartEphemeralState.approvals = result.approvals || [];
      vnPartEphemeralState.lastLoadedAt = new Date().toISOString();
    }

    renderVnPartView();
  }

  /**
   * Render the entire VN-PART view into the DOM.
   */
  function renderVnPartView() {
    if (typeof document === "undefined") return;
    ensureVnPartDomMounted();

    // 1. Update KPI numbers in header strip
    const kpis = computeVnPartKpis(
      vnPartEphemeralState.donors,
      vnPartEphemeralState.removals
    );
    const kpiRemaining = document.getElementById("vn-part-kpi-remaining");
    const kpiUnreturned = document.getElementById("vn-part-kpi-unreturned");
    const kpiReady = document.getElementById("vn-part-kpi-ready");
    const kpiOverdue = document.getElementById("vn-part-kpi-overdue");

    if (kpiRemaining) kpiRemaining.textContent = String(kpis.remainingDonorsCount);
    if (kpiUnreturned) kpiUnreturned.textContent = String(kpis.unreturnedPartsQuantity);
    if (kpiReady) kpiReady.textContent = String(kpis.readyDonorsCount);
    if (kpiOverdue) kpiOverdue.textContent = String(kpis.overdueDonorsCount);

    // 2. Synchronize Create Request button visibility
    const identity = getCurrentIdentity();
    const createBtn = document.getElementById("vn-part-new-request-btn");
    if (createBtn) {
      const canCreate = identity.ok && ["chef_atelier", "responsable_garantie_support"].includes(identity.role);
      createBtn.style.display = canCreate ? "" : "none";
    }

    // 3. Conflict banner
    const conflictBanner = document.getElementById("vn-part-conflict-banner");
    const conflictMsgEl = document.getElementById("vn-part-conflict-message");
    if (conflictBanner && conflictMsgEl) {
      if (vnPartEphemeralState.conflictMessage) {
        conflictMsgEl.textContent = vnPartEphemeralState.conflictMessage;
        conflictBanner.style.display = "flex";
      } else {
        conflictBanner.style.display = "none";
      }
    }

    // 4. Main content container
    const container = document.getElementById("vn-part-content");
    if (!container) return;

    if (vnPartEphemeralState.loading) {
      container.innerHTML = `
        <div class="vn-part-loading" role="status" aria-live="polite">
          <div class="vn-part-spinner" aria-hidden="true"></div>
          <p>Chargement des prélèvements VN...</p>
        </div>
      `;
      return;
    }

    if (vnPartEphemeralState.error) {
      container.innerHTML = `
        <div class="vn-part-error" role="alert">
          <svg viewBox="0 0 24 24" class="vn-part-error-icon" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <div class="vn-part-error-body">
            <strong>Erreur de lecture serveur</strong>
            <p>${escapeHtml(vnPartEphemeralState.error.message)}</p>
            <small>Code: ${escapeHtml(vnPartEphemeralState.error.code)}</small>
          </div>
          <button type="button" class="secondary-button" id="vn-part-retry-btn">Réessayer</button>
        </div>
      `;
      document.getElementById("vn-part-retry-btn")?.addEventListener("click", () => {
        refreshVnPartDashboard();
      });
      return;
    }

    const workflowRequests = filterVnPartRequests(
      vnPartEphemeralState.removals,
      vnPartEphemeralState.activeRequestFilter,
      vnPartEphemeralState.searchQuery
    );

    const filteredDonors = filterVnPartDonors(
      vnPartEphemeralState.donors,
      vnPartEphemeralState.removals,
      vnPartEphemeralState.activeFilter,
      vnPartEphemeralState.searchQuery
    );

    const etaTodayIso = getLocalTodayIso();
    const etaAllRows = filterEtaTrackingRows(
      vnPartEphemeralState.removals,
      "all",
      etaTodayIso,
      vnPartEphemeralState.searchQuery
    );

    if (
      !workflowRequests.length &&
      !filteredDonors.length &&
      !etaAllRows.length
    ) {
      const isSearchOrFilter =
        vnPartEphemeralState.searchQuery ||
        vnPartEphemeralState.activeFilter !== "all-open" ||
        vnPartEphemeralState.activeRequestFilter !== "all";
      const emptyMsg = isSearchOrFilter
        ? "Aucun prélèvement VN ne correspond aux critères sélectionnés."
        : "Aucun prélèvement VN en cours ou à restituer pour cet atelier.";

      container.innerHTML = `
        <div class="vn-part-empty" role="status">
          <svg viewBox="0 0 24 24" class="vn-part-empty-icon" aria-hidden="true"><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.5 2.8C2.1 10.8 2 11 2 11.2V16c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/></svg>
          <h3>Aucun dossier</h3>
          <p>${escapeHtml(emptyMsg)}</p>
        </div>
      `;
      return;
    }

    const approvalLookup = buildApprovalLookup(vnPartEphemeralState.approvals);

    let html = "";

    // ------------------------------------------------------------------------
    // ETA TRACKING — ÉCHÉANCES PIÈCES
    // ------------------------------------------------------------------------
    html += renderEtaTrackingSection(
      vnPartEphemeralState.removals,
      identity,
      vnPartEphemeralState.activeEtaFilter,
      etaTodayIso,
      vnPartEphemeralState.searchQuery
    );

    // ------------------------------------------------------------------------
    // SECTION A — DEMANDES DE PRÉLÈVEMENT EN COURS
    // ------------------------------------------------------------------------
    const preRemovalRequests = vnPartEphemeralState.removals.filter((r) => !r.removed_at);
    const countAll = preRemovalRequests.filter((r) =>
      ["EN_ATTENTE_VALIDATIONS", "AUTORISE_A_PRELEVER"].includes(r.status)
    ).length;
    const countPending = preRemovalRequests.filter(
      (r) => r.status === "EN_ATTENTE_VALIDATIONS"
    ).length;
    const countAuth = preRemovalRequests.filter(
      (r) => r.status === "AUTORISE_A_PRELEVER"
    ).length;
    const activeReqFilter = vnPartEphemeralState.activeRequestFilter || "all";

    html += `
      <section class="vn-part-section vn-part-requests-section" aria-labelledby="vn-part-requests-heading">
        <div class="vn-part-section-header">
          <div class="vn-part-section-title-wrap">
            <h2 id="vn-part-requests-heading" class="vn-part-section-title">
              DEMANDES DE PRÉLÈVEMENT EN COURS
              <span class="vn-part-section-count" id="vn-part-requests-count">(${workflowRequests.length})</span>
            </h2>
            <p class="vn-part-section-sub">Demandes en attente de validation ou autorisées à prélever</p>
          </div>
          <div class="vn-part-req-filters" role="group" aria-label="Filtrer les demandes">
            <button type="button" class="vn-part-req-filter-btn ${activeReqFilter === "all" ? "active" : ""}" data-req-filter="all" aria-pressed="${activeReqFilter === "all"}">Toutes (${countAll})</button>
            <button type="button" class="vn-part-req-filter-btn ${activeReqFilter === "pending" ? "active" : ""}" data-req-filter="pending" aria-pressed="${activeReqFilter === "pending"}">À valider (${countPending})</button>
            <button type="button" class="vn-part-req-filter-btn ${activeReqFilter === "authorized" ? "active" : ""}" data-req-filter="authorized" aria-pressed="${activeReqFilter === "authorized"}">Autorisées (${countAuth})</button>
          </div>
        </div>
    `;

    if (!workflowRequests.length) {
      html += `
        <div class="vn-part-section-empty" id="vn-part-requests-empty">
          <p>Aucune demande de prélèvement en cours pour ces critères.</p>
        </div>
      `;
    } else {
      html += `<div class="vn-part-requests-list">`;
      for (const req of workflowRequests) {
        html += renderRequestCard(req, approvalLookup, identity);
      }
      html += `</div>`;
    }

    html += `</section>`;

    // ------------------------------------------------------------------------
    // SECTION B — VN RESTANT À RESTITUER
    // ------------------------------------------------------------------------
    html += `
      <section class="vn-part-section vn-part-donors-section" aria-labelledby="vn-part-donors-heading">
        <div class="vn-part-section-header">
          <div class="vn-part-section-title-wrap">
            <h2 id="vn-part-donors-heading" class="vn-part-section-title">
              VN RESTANT À RESTITUER
              <span class="vn-part-section-count" id="vn-part-donors-count">(${filteredDonors.length} véhicule(s))</span>
            </h2>
            <p class="vn-part-section-sub">Véhicules neufs donneurs ayant des pièces physiquement prélevées à restituer</p>
          </div>
        </div>
    `;

    if (!filteredDonors.length) {
      html += `
        <div class="vn-part-section-empty" id="vn-part-donors-empty">
          <p>Aucun véhicule donneur incomplet à restituer pour cet atelier.</p>
        </div>
      `;
    } else {
      const groups = groupVnPartByModelAndVin(
        filteredDonors,
        vnPartEphemeralState.removals
      );

      for (const group of groups) {
        html += `
          <section class="vn-part-model-group" aria-labelledby="vn-model-${escapeHtml(group.model)}">
            <div class="vn-part-model-header">
              <h2 id="vn-model-${escapeHtml(group.model)}">${escapeHtml(group.model)}</h2>
              <span class="vn-part-model-count">${group.items.length} véhicule(s)</span>
            </div>
            <div class="vn-part-donor-list">
        `;

        for (const item of group.items) {
          const donor = item.donor;
          const donorRemovals = item.removals.filter((r) => Boolean(r.removed_at));
          const isOverdue = Number(donor.overdue_count || 0) > 0;
          const isReady = Boolean(donor.can_be_restored_today);
          const isFullyRestored = Boolean(donor.is_fully_restored);

          const donorSummary = computeDonorCommitmentSummary(
            vnPartEphemeralState.removals,
            donor.donor_vin,
            { workshopId: donor.workshop_id }
          );

          html += `
            <article class="vn-part-donor-card ${isOverdue ? "is-overdue" : ""} ${isReady ? "is-ready" : ""}" data-vin="${escapeHtml(donor.donor_vin)}">
              <header class="vn-part-donor-header">
                <div class="vn-part-donor-identity">
                  <div class="vn-part-donor-vin-line">
                    <span class="vn-part-donor-vin">${escapeHtml(donor.donor_vin)}</span>
                    ${donor.donor_location ? `<span class="vn-part-location-badge"><svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg> ${escapeHtml(donor.donor_location)}</span>` : ""}
                  </div>
                  <div class="vn-part-donor-sub">${escapeHtml(donor.donor_model)}</div>
                </div>
                <div class="vn-part-donor-badges">
                  ${isOverdue ? `<span class="vn-part-badge badge-overdue">🔴 EN RETARD (${escapeHtml(donor.overdue_count)})</span>` : ""}
                  ${isReady ? `<span class="vn-part-badge badge-ready">🟢 PRÊT À RESTITUER</span>` : ""}
                  ${isFullyRestored ? `<span class="vn-part-badge badge-restored">✅ ÉTAT D’ORIGINE VN-PART RESTITUÉ</span>` : ""}
                </div>
              </header>

              <div class="vn-part-donor-metrics">
                <div class="vn-part-metric-chip">
                  <span>Prélèvements actifs:</span>
                  <strong>${Number(donor.active_removals_remaining || 0)}</strong>
                </div>
                <div class="vn-part-metric-chip">
                  <span>En attente pièce:</span>
                  <strong>${Number(donor.waiting_replacement_count || 0)}</strong>
                </div>
                <div class="vn-part-metric-chip">
                  <span>Prêts à restituer:</span>
                  <strong>${Number(donor.available_to_restore_count || 0)}</strong>
                </div>
                ${donor.oldest_opened_at ? `
                  <div class="vn-part-metric-chip">
                    <span>Plus ancien retrait:</span>
                    <strong>${escapeHtml(formatDateTimeFr(donor.oldest_opened_at))}</strong>
                  </div>
                ` : ""}
                ${donor.expected_replacement_date ? `
                  <div class="vn-part-metric-chip ${isOverdue ? "text-danger" : ""}">
                    <span>Date estimée (ETA):</span>
                    <strong>${escapeHtml(formatDateFr(donor.expected_replacement_date))}</strong>
                  </div>
                ` : ""}
                <div class="vn-part-metric-chip ${donorSummary.etaMissingCount > 0 ? "is-warning" : (isOverdue ? "text-danger" : "")}">
                  <span>Restitution complète projetée:</span>
                  <strong>${donorSummary.etaMissingCount > 0 ? `À CONFIRMER (${donorSummary.etaMissingCount} manquante${donorSummary.etaMissingCount > 1 ? "s" : ""})` : (donorSummary.estimatedFullRestorationDate ? escapeHtml(formatDateFr(donorSummary.estimatedFullRestorationDate)) : "—")}</strong>
                </div>
              </div>

              ${donorSummary.plannedRemovalCount > 0 ? `
                <div class="vn-part-planning-notice" role="note">
                  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
                  <span>⚠️ <strong>${donorSummary.plannedRemovalCount} prochain(s) prélèvement(s)</strong> déjà planifié(s) sur ce véhicule donneur.</span>
                </div>
              ` : ""}

              ${isFullyRestored ? `
                <div class="vn-part-restored-banner" role="status">
                  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                  <span>TOUS LES PRÉLÈVEMENTS VN-PART ONT ÉTÉ RESTITUÉS — AUCUN PRÉLÈVEMENT OUVERT</span>
                </div>
              ` : ""}

              <div class="vn-part-removals-wrap">
                <details class="vn-part-removals-disclosure" ${Number(donor.active_removals_remaining || 0) > 0 ? "open" : ""}>
                  <summary class="vn-part-removals-summary">
                    Détail des pièces (${donorRemovals.length})
                  </summary>
                  <div class="vn-part-removals-list">
          `;

          if (!donorRemovals.length) {
            html += `<p class="vn-part-no-removals">Aucun détail de prélèvement disponible.</p>`;
          } else {
            for (const rem of donorRemovals) {
              let badgeHtml = "";
              if (rem.restored_at) {
                badgeHtml = `<span class="vn-part-badge badge-restored">✅ RESTITUÉ / CLÔTURÉ</span>`;
              } else if (rem.replacement_available_at) {
                badgeHtml = `<span class="vn-part-badge badge-available">🟢 PIÈCE DISPONIBLE</span>`;
              } else if (rem.removed_at) {
                badgeHtml = `<span class="vn-part-badge badge-waiting">🟠 EN ATTENTE PIÈCE</span>`;
              } else {
                badgeHtml = `<span class="vn-part-badge badge-neutral">${escapeHtml(rem.status)}</span>`;
              }

              const approvalStripHtml = renderApprovalStrip(rem, approvalLookup);
              const availableActions = getAvailableVnPartActions(rem, vnPartEphemeralState.approvals, identity);
              const actionsHtml = renderRemovalActionButtons(rem, availableActions, vnPartEphemeralState.mutationInProgress);

              html += `
                <div class="vn-part-removal-item" data-id="${escapeHtml(rem.id)}" data-version="${rem.version}">
                  <div class="vn-part-removal-top">
                    <div class="vn-part-removal-title">
                      <strong>${renderPartIdentityHtml(rem.part_reference, rem.part_designation)}</strong>
                      <span class="vn-part-qty">Qté: ${Number(rem.quantity) || 1}</span>
                    </div>
                    <div class="vn-part-removal-status">
                      ${badgeHtml}
                    </div>
                  </div>

                  <div class="vn-part-removal-details-grid">
                    <div class="vn-part-detail-cell">
                      <span class="cell-label">Véhicule bénéficiaire:</span>
                      <span class="cell-val">${escapeHtml(rem.beneficiary_model || "—")}${rem.beneficiary_vin ? ` (${escapeHtml(rem.beneficiary_vin)})` : ""}</span>
                    </div>
                    ${rem.beneficiary_or ? `
                      <div class="vn-part-detail-cell">
                        <span class="cell-label">N° Ordre de Réparation:</span>
                        <span class="cell-val">${escapeHtml(rem.beneficiary_or)}</span>
                      </div>
                    ` : ""}
                    ${rem.removed_at ? `
                      <div class="vn-part-detail-cell">
                        <span class="cell-label">Date prélèvement:</span>
                        <span class="cell-val">${escapeHtml(formatDateTimeFr(rem.removed_at))}</span>
                      </div>
                    ` : ""}
                    ${rem.expected_replacement_date ? `
                      <div class="vn-part-detail-cell">
                        <span class="cell-label">Date estimée (ETA):</span>
                        <span class="cell-val">${escapeHtml(formatDateFr(rem.expected_replacement_date))}</span>
                      </div>
                    ` : ""}
                    ${rem.replacement_available_at ? `
                      <div class="vn-part-detail-cell">
                        <span class="cell-label">Pièce reçue le:</span>
                        <span class="cell-val">${escapeHtml(formatDateTimeFr(rem.replacement_available_at))}</span>
                      </div>
                    ` : ""}
                    ${rem.store_ack_at ? `
                      <div class="vn-part-detail-cell">
                        <span class="cell-label">Prise en compte magasin:</span>
                        <span class="cell-val">${escapeHtml(formatDateTimeFr(rem.store_ack_at))}</span>
                      </div>
                    ` : ""}
                    ${rem.restored_at ? `
                      <div class="vn-part-detail-cell">
                        <span class="cell-label">Restitué au VN le:</span>
                        <span class="cell-val">${escapeHtml(formatDateTimeFr(rem.restored_at))}</span>
                      </div>
                    ` : ""}
                  </div>

                  ${approvalStripHtml}
                  ${actionsHtml}
                </div>
              `;
            }
          }

          html += `
                  </div>
                </details>
              </div>
            </article>
          `;
        }

        html += `
            </div>
          </section>
        `;
      }
    }

    html += `</section>`;

    container.innerHTML = html;
  }

  /**
   * Open the "Nouveau Prélèvement VN" creation modal.
   */
  function openCreateModal() {
    const host = document.getElementById("vn-part-modals-host");
    if (!host) return;

    host.innerHTML = `
      <div class="vn-part-modal-backdrop" id="vn-part-create-backdrop" role="dialog" aria-modal="true" aria-labelledby="vn-part-create-title">
        <div class="vn-part-modal-dialog">
          <header class="vn-part-modal-header">
            <h2 id="vn-part-create-title">Nouveau Prélèvement sur Véhicule Neuf</h2>
            <button type="button" class="vn-part-modal-close" id="vn-part-create-close" aria-label="Fermer">✕</button>
          </header>
          <form id="vn-part-create-form" class="vn-part-form">
            <div id="vn-part-create-error" class="vn-part-form-error" style="display:none;" role="alert"></div>

            <div class="vn-part-form-row">
              <label for="vn-create-ben-model">Modèle bénéficiaire <span class="required">*</span></label>
              <input type="text" id="vn-create-ben-model" name="beneficiary_model" required placeholder="Ex: Peugeot Partner">
            </div>

            <div class="vn-part-form-row">
              <label for="vn-create-ben-vin">N° Châssis / VIN bénéficiaire (optionnel)</label>
              <input type="text" id="vn-create-ben-vin" name="beneficiary_vin" placeholder="Numéro VIN (optionnel)">
            </div>

            <div class="vn-part-form-row">
              <label for="vn-create-ben-or">N° Ordre de Réparation (OR)</label>
              <input type="text" id="vn-create-ben-or" name="beneficiary_or" placeholder="Ex: OR-2026-0012">
            </div>

            <div class="vn-part-form-row">
              <label for="vn-create-part-desig">Désignation de la pièce <span class="required">*</span></label>
              <input type="text" id="vn-create-part-desig" name="part_designation" required placeholder="Ex: Calculateur d'injection">
            </div>

            <div class="vn-part-form-row">
              <label for="vn-create-part-ref">Référence pièce (optionnel)</label>
              <input type="text" id="vn-create-part-ref" name="part_reference" placeholder="Ex: 1611234580">
            </div>

            <div class="vn-part-form-row vn-part-form-row-half">
              <div>
                <label for="vn-create-qty">Quantité <span class="required">*</span></label>
                <input type="number" id="vn-create-qty" name="quantity" min="1" value="1" required>
              </div>
              <div>
                <label for="vn-create-urgency">Urgence</label>
                <select id="vn-create-urgency" name="urgency">
                  <option value="Normale">Normale</option>
                  <option value="Urgente">Urgente</option>
                  <option value="Véhicule immobilisé">Véhicule immobilisé</option>
                </select>
              </div>
            </div>

            <div class="vn-part-form-row">
              <label for="vn-create-reason">Motif de la demande <span class="required">*</span></label>
              <textarea id="vn-create-reason" name="reason" rows="3" required placeholder="Indiquez le motif précis justifiant le prélèvement..."></textarea>
            </div>

            <div class="vn-part-form-row">
              <label for="vn-create-comments">Commentaires additionnels</label>
              <textarea id="vn-create-comments" name="comments" rows="2" placeholder="Précisions éventuelles..."></textarea>
            </div>

            <footer class="vn-part-modal-footer">
              <button type="button" class="ghost-button" id="vn-part-create-cancel">Annuler</button>
              <button type="submit" class="primary-button" id="vn-part-create-submit">Transmettre la demande</button>
            </footer>
          </form>
        </div>
      </div>
    `;

    document.getElementById("vn-part-create-close")?.addEventListener("click", closeModals);
    document.getElementById("vn-part-create-cancel")?.addEventListener("click", closeModals);
    document.getElementById("vn-part-create-form")?.addEventListener("submit", handleCreateFormSubmit);
    document.getElementById("vn-create-ben-model")?.focus();
  }

  /**
   * Validate CREATE_REQUEST payload before transmission.
   * Enforces mandatory fields: beneficiary_model, part_designation, reason, quantity (integer >= 1).
   * Explicit invariant: NO donor fields (donor_model, donor_vin, etc.) are required or validated.
   */
  function validateCreateRequestPayload(payload) {
    if (!payload || typeof payload !== "object") {
      return { ok: false, field: "payload", message: "Données de la demande manquantes." };
    }
    const benModel = String(payload.beneficiary_model || "").trim();
    if (!benModel) {
      return { ok: false, field: "beneficiary_model", message: "Le modèle du véhicule bénéficiaire est obligatoire." };
    }
    const partDesig = String(payload.part_designation || "").trim();
    if (!partDesig) {
      return { ok: false, field: "part_designation", message: "La désignation de la pièce est obligatoire." };
    }
    const reason = String(payload.reason || "").trim();
    if (!reason) {
      return { ok: false, field: "reason", message: "Le motif du prélèvement est obligatoire." };
    }
    const qty = payload.quantity;
    const qtyNum = typeof qty === "number" ? qty : parseInt(qty, 10);
    if (!Number.isInteger(qtyNum) || qtyNum < 1) {
      return { ok: false, field: "quantity", message: "La quantité doit être un nombre entier supérieur ou égal à 1." };
    }
    return { ok: true };
  }

  /**
   * Handle submission of the Create Request form.
   */
  async function handleCreateFormSubmit(e) {
    e.preventDefault();
    if (vnPartEphemeralState.mutationInProgress) return;

    const form = e.target;
    const errorEl = document.getElementById("vn-part-create-error");
    const submitBtn = document.getElementById("vn-part-create-submit");

    const benModel = form.beneficiary_model?.value?.trim() || "";
    const partDesig = form.part_designation?.value?.trim() || "";
    const reason = form.reason?.value?.trim() || "";
    const qtyNum = parseInt(form.quantity?.value, 10);

    const payload = {
      beneficiary_model: benModel,
      part_designation: partDesig,
      reason: reason,
      quantity: qtyNum,
      beneficiary_vin: form.beneficiary_vin?.value?.trim() || undefined,
      beneficiary_or: form.beneficiary_or?.value?.trim() || undefined,
      part_reference: form.part_reference?.value?.trim() || undefined,
      urgency: form.urgency?.value?.trim() || undefined,
      comments: form.comments?.value?.trim() || undefined,
    };

    const valRes = validateCreateRequestPayload(payload);
    if (!valRes.ok) {
      showModalError(errorEl, valRes.message);
      return;
    }

    vnPartEphemeralState.mutationInProgress = true;
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Transmission en cours...";
    }

    const applyFn =
      (clientModule && clientModule.applyVnPartAction) ||
      (typeof applyVnPartAction === "function" ? applyVnPartAction : null) ||
      (typeof window !== "undefined" ? window.applyVnPartAction : null);

    if (!applyFn) {
      showModalError(errorEl, "Module d'action introuvable.");
      vnPartEphemeralState.mutationInProgress = false;
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = "Transmettre la demande";
      }
      return;
    }

    const res = await applyFn(null, null, "CREATE_REQUEST", payload);
    vnPartEphemeralState.mutationInProgress = false;

    if (!res.ok) {
      showModalError(errorEl, res.message || "Erreur lors de la création de la demande.");
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = "Transmettre la demande";
      }
      return;
    }

    closeModals();

    // Determine authoritative identifier (prefer res.removal_id, fallback to res.record?.id)
    const createdId = res.removal_id || res.record?.id;

    await refreshVnPartDashboard();

    // Step 14: If dashboard refresh failed after successful commit
    if (vnPartEphemeralState.error) {
      vnPartEphemeralState.conflictMessage =
        "Demande enregistrée, mais la liste n'a pas pu être actualisée. Actualisez l'écran avant toute nouvelle saisie.";
      renderVnPartView();
      return;
    }

    // Step 13: If createdId is absent, fail closed for consistency verification without guessing
    if (!createdId) {
      vnPartEphemeralState.conflictMessage =
        "Demande acceptée par le serveur, mais l'identifiant de la nouvelle demande n'a pas pu être déterminé avec certitude. Veuillez actualiser la page.";
      renderVnPartView();
      return;
    }

    // Step 12: Locate exact created id in refreshed removals
    const found = vnPartEphemeralState.removals.some(
      (r) => String(r.id) === String(createdId)
    );
    if (!found) {
      vnPartEphemeralState.conflictMessage =
        "Attention : La demande a été enregistrée avec succès mais n'apparaît pas encore dans l'actualisation du tableau de bord. Veuillez rafraîchir à nouveau.";
    } else {
      vnPartEphemeralState.conflictMessage = null;
    }

    renderVnPartView();
  }

  /**
   * Open dynamic contextual modal for an action on a removal item.
   */
  function openActionModal(removalId, action) {
    const removal = vnPartEphemeralState.removals.find((r) => r.id === removalId);
    if (!removal) return;

    const host = document.getElementById("vn-part-modals-host");
    if (!host) return;

    const identity = getCurrentIdentity();
    const role = identity.role;
    const title = ACTION_LABELS[action] || action;

    let fieldsHtml = "";

    if (action === "REFUSE" || action === "CANCEL") {
      fieldsHtml = `
        <div class="vn-part-form-row">
          <label for="vn-action-reason">Motif obligatoire <span class="required">*</span></label>
          <textarea id="vn-action-reason" name="reason" rows="3" required placeholder="Précisez la raison de cette décision..."></textarea>
        </div>
      `;
    } else if (action === "APPROVE") {
      if (role === "directeur_pieces") {
        fieldsHtml = `
          <div class="vn-part-form-row">
            <label for="vn-action-eta">Date d'arrivée prévue de la pièce (ETA) <span class="required">*</span></label>
            <input type="date" id="vn-action-eta" name="expected_replacement_date" required>
          </div>
          <div class="vn-part-form-row">
            <label for="vn-action-reason">Commentaire / Remarque (optionnel)</label>
            <textarea id="vn-action-reason" name="reason" rows="2" placeholder="Précisions sur la commande..."></textarea>
          </div>
        `;
      } else if (role === "responsable_qualite_parc_vn") {
        fieldsHtml = `
          <div class="vn-part-form-row">
            <label for="vn-action-donor-model">Modèle véhicule donneur <span class="required">*</span></label>
            <input type="text" id="vn-action-donor-model" name="donor_model" required placeholder="Ex: Peugeot 208">
          </div>
          <div class="vn-part-form-row">
            <label for="vn-action-donor-vin">N° Châssis / VIN véhicule donneur <span class="required">*</span></label>
            <input type="text" id="vn-action-donor-vin" name="donor_vin" required minlength="17" maxlength="17" pattern="[A-HJ-NPR-Z0-9]{17}" autocapitalize="characters" spellcheck="false" placeholder="VIN complet à 17 caractères">
              <div id="vn-action-donor-preview" class="vn-part-donor-preview" aria-live="polite" style="display:none;"></div>
          </div>
          <div class="vn-part-form-row">
            <label for="vn-action-donor-loc">Emplacement du véhicule donneur (optionnel)</label>
            <input type="text" id="vn-action-donor-loc" name="donor_location" placeholder="Ex: Parc VN - Rangée 4">
          </div>
          <div class="vn-part-form-row">
            <label for="vn-action-reason">Commentaire / Remarque (optionnel)</label>
            <textarea id="vn-action-reason" name="reason" rows="2" placeholder="Précisions état donneur..."></textarea>
          </div>
        `;
      } else {
        fieldsHtml = `
          <div class="vn-part-form-row">
            <label for="vn-action-reason">Remarque de validation (optionnel)</label>
            <textarea id="vn-action-reason" name="reason" rows="2" placeholder="Remarque Directeur SAV..."></textarea>
          </div>
        `;
      }
    } else if (action === "REVISE_ETA") {
      fieldsHtml = `
        <div class="vn-part-form-row">
          <label for="vn-action-eta">Nouvelle date d'arrivée prévue (ETA) <span class="required">*</span></label>
          <input type="date" id="vn-action-eta" name="expected_replacement_date" required value="${escapeHtml(removal.expected_replacement_date || "")}">
        </div>
        <div class="vn-part-form-row">
          <label for="vn-action-reason">Motif de la révision (optionnel)</label>
          <textarea id="vn-action-reason" name="reason" rows="2" placeholder="Motif du décalage..."></textarea>
        </div>
      `;
    } else if (action === "REVISE_DONOR") {
      fieldsHtml = `
        <div class="vn-part-form-row">
          <label for="vn-action-donor-model">Modèle véhicule donneur <span class="required">*</span></label>
          <input type="text" id="vn-action-donor-model" name="donor_model" required value="${escapeHtml(removal.donor_model || "")}">
        </div>
        <div class="vn-part-form-row">
          <label for="vn-action-donor-vin">N° Châssis / VIN véhicule donneur <span class="required">*</span></label>
          <input type="text" id="vn-action-donor-vin" name="donor_vin" required minlength="17" maxlength="17" pattern="[A-HJ-NPR-Z0-9]{17}" autocapitalize="characters" spellcheck="false" value="${escapeHtml(removal.donor_vin || "")}">
          <div id="vn-action-donor-preview" class="vn-part-donor-preview" aria-live="polite" style="display:none;"></div>
        </div>
        <div class="vn-part-form-row">
          <label for="vn-action-donor-loc">Emplacement du véhicule donneur (optionnel)</label>
          <input type="text" id="vn-action-donor-loc" name="donor_location" value="${escapeHtml(removal.donor_location || "")}">
        </div>
        <div class="vn-part-form-row">
          <label for="vn-action-reason">Motif de la modification (optionnel)</label>
          <textarea id="vn-action-reason" name="reason" rows="2" placeholder="Motif du changement..."></textarea>
        </div>
      `;
    } else {
      // Actions: CONFIRM_REMOVAL, STORE_ACK, MARK_REPLACEMENT_AVAILABLE, CONFIRM_RESTITUTION
      let confirmationPrompt = "Confirmez-vous cette action opérationnelle sur le dossier ?";
      const partDisplay = formatPartIdentity(removal.part_reference, removal.part_designation);
      if (action === "CONFIRM_REMOVAL") {
        confirmationPrompt = `Confirmez-vous que la pièce "${escapeHtml(partDisplay)}" a été physiquement démontée du véhicule donneur ${escapeHtml(removal.donor_vin || "")} ?`;
      } else if (action === "STORE_ACK") {
        confirmationPrompt = `Confirmez-vous la prise en compte magasin pour la commande de réapprovisionnement de la pièce "${escapeHtml(partDisplay)}" ?`;
      } else if (action === "MARK_REPLACEMENT_AVAILABLE") {
        confirmationPrompt = `Confirmez-vous que la pièce neuve de remplacement "${escapeHtml(partDisplay)}" a été reçue et est disponible pour restitution ?`;
      } else if (action === "CONFIRM_RESTITUTION") {
        confirmationPrompt = `Confirmez-vous que la pièce neuve a été physiquement remontée sur le véhicule donneur ${escapeHtml(removal.donor_vin || "")} et le dossier clôturé ?`;
      }

      fieldsHtml = `
        <p class="vn-part-action-prompt">${confirmationPrompt}</p>
        <div class="vn-part-form-row">
          <label for="vn-action-reason">Commentaire / Remarque (optionnel)</label>
          <textarea id="vn-action-reason" name="reason" rows="2" placeholder="Remarque..."></textarea>
        </div>
      `;
    }

    host.innerHTML = `
      <div class="vn-part-modal-backdrop" id="vn-part-action-backdrop" role="dialog" aria-modal="true" aria-labelledby="vn-part-action-title">
        <div class="vn-part-modal-dialog">
          <header class="vn-part-modal-header">
            <h2 id="vn-part-action-title">${escapeHtml(title)}</h2>
            <button type="button" class="vn-part-modal-close" id="vn-part-action-close" aria-label="Fermer">✕</button>
          </header>
          <form id="vn-part-action-form" class="vn-part-form" data-removal-id="${escapeHtml(removal.id)}" data-action="${escapeHtml(action)}" data-version="${removal.version}">
            <div class="vn-part-modal-summary">
              <strong>${renderPartIdentityHtml(removal.part_reference, removal.part_designation)}</strong>
              <span>Bénéficiaire : ${escapeHtml(removal.beneficiary_model || "—")}</span>
              <span>Statut actuel : ${escapeHtml(removal.status)}</span>
            </div>

            <div id="vn-part-action-error" class="vn-part-form-error" style="display:none;" role="alert"></div>

            ${fieldsHtml}

            <footer class="vn-part-modal-footer">
              <button type="button" class="ghost-button" id="vn-part-action-cancel">Annuler</button>
              <button type="submit" class="primary-button" id="vn-part-action-submit">Confirmer l'action</button>
            </footer>
          </form>
        </div>
      </div>
    `;

    document.getElementById("vn-part-action-close")?.addEventListener("click", closeModals);
    document.getElementById("vn-part-action-cancel")?.addEventListener("click", closeModals);

    document.getElementById("vn-part-action-form")?.addEventListener("submit", handleActionFormSubmit);

    // Live preview for donor VIN collisions & restoration ETA
    const donorVinInput = document.getElementById("vn-action-donor-vin");
    const previewContainer = document.getElementById("vn-action-donor-preview");

    function updateDonorVinPreview() {
      if (!donorVinInput || !previewContainer) return;
      const validation = validateDonorVin(donorVinInput.value);
      const normVin = validation.normalizedVin;

      if (donorVinInput.value !== normVin) {
        donorVinInput.value = normVin;
      }

      if (!normVin || !validation.ok) {
        previewContainer.innerHTML = "";
        previewContainer.style.display = "none";
        return;
      }

      const summary = computeDonorCommitmentSummary(
        vnPartEphemeralState.removals,
        normVin,
        {
          workshopId: identity.workshopId,
          excludeRemovalId: removal.id,
          currentRemovalEta: removal.expected_replacement_date,
        }
      );

      previewContainer.style.display = "block";

      if (summary.openCommitmentCount === 0) {
        previewContainer.innerHTML = `
          <div class="vn-part-donor-clean-alert">
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>
            <span>✓ Aucun autre prélèvement en cours sur ce véhicule donneur</span>
          </div>
        `;
        return;
      }

      previewContainer.innerHTML = `
        <div class="vn-part-donor-warning-alert" role="alert">
          <div class="vn-part-donor-warning-header">
            <div class="vn-part-donor-warning-title">
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              <strong>⚠️ VIN DONNEUR DÉJÀ ENGAGÉ</strong>
            </div>
            <span class="vn-part-donor-warning-count">${summary.openCommitmentCount} prélèvement(s) ouvert(s)</span>
          </div>

          <div class="vn-part-donor-warning-stats">
            <span>• ${summary.physicalOpenRemovalCount} pièce(s) déjà prélevée(s)</span>
            <span>• ${summary.plannedRemovalCount} prélèvement(s) planifié(s)</span>
          </div>

          <div class="vn-part-donor-warning-dates">
            ${summary.nextExpectedReplacementDate ? `
              <div class="vn-part-warning-date-row">
                <span class="date-lbl">Prochaine ETA :</span>
                <strong class="date-val">${escapeHtml(formatDateFr(summary.nextExpectedReplacementDate))}</strong>
              </div>
            ` : ""}
            <div class="vn-part-warning-date-row">
              <span class="date-lbl">Restitution complète actuellement estimée :</span>
              <strong class="date-val">${summary.etaMissingCount > 0 ? `À CONFIRMER — ${summary.etaMissingCount} ETA manquante(s)` : (summary.estimatedFullRestorationDate ? escapeHtml(formatDateFr(summary.estimatedFullRestorationDate)) : "—")}</strong>
            </div>
            ${summary.etaMissingCount > 0 && summary.estimatedFullRestorationDate ? `
              <div class="vn-part-warning-subdate">
                (Dernière ETA connue : ${escapeHtml(formatDateFr(summary.estimatedFullRestorationDate))} — sous réserve des ETA manquantes)
              </div>
            ` : ""}
          </div>

          <div class="vn-part-donor-whatif">
            ${removal.expected_replacement_date ? `
              <div class="vn-part-whatif-row">
                <span class="whatif-lbl">Nouvelle restitution complète estimée après cette affectation :</span>
                <strong class="whatif-val">${escapeHtml(formatDateFr(summary.projectedFullRestorationDate))}</strong>
              </div>
            ` : `
              <div class="vn-part-whatif-row text-muted">
                <span class="whatif-lbl">Nouvelle date finale après affectation :</span>
                <span class="whatif-val">À CONFIRMER — ETA de cette pièce non encore renseignée</span>
              </div>
            `}
          </div>

          <details class="vn-part-donor-commitments-disclosure">
            <summary>Voir les autres pièces engagées sur ce donneur (${summary.commitments.length})</summary>
            <div class="vn-part-donor-commitments-list">
              ${summary.commitments.map((c) => `
                <div class="vn-part-donor-commitment-row">
                  <div class="vn-part-commitment-main">
                    <strong>${renderPartIdentityHtml(c.part_reference, c.part_designation)}</strong>
                    <span class="vn-part-commitment-meta">Bénéficiaire : ${escapeHtml(c.beneficiary_model || "—")}${c.beneficiary_vin ? ` (${escapeHtml(c.beneficiary_vin)})` : ""}${c.beneficiary_or ? ` • OR: ${escapeHtml(c.beneficiary_or)}` : ""}</span>
                  </div>
                  <div class="vn-part-commitment-side">
                    <span class="vn-part-badge badge-${c.removed_at ? (c.replacement_available_at ? 'available' : 'waiting') : 'neutral'}">${c.removed_at ? (c.replacement_available_at ? 'DISPONIBLE' : 'PRÉLEVÉ') : 'PLANIFIÉ'}</span>
                    <span class="vn-part-commitment-eta">${c.expected_replacement_date ? `ETA: ${escapeHtml(formatDateFr(c.expected_replacement_date))}` : 'ETA: non renseignée'}</span>
                  </div>
                </div>
              `).join("")}
            </div>
          </details>
        </div>
      `;
    }

    if (donorVinInput && previewContainer) {
      donorVinInput.addEventListener("input", updateDonorVinPreview);
      donorVinInput.addEventListener("change", updateDonorVinPreview);
      if (donorVinInput.value) {
        updateDonorVinPreview();
      }
    }

    // Auto-focus first input
    const firstInput = document.querySelector("#vn-part-action-form input, #vn-part-action-form textarea");
    firstInput?.focus();
  }

  /**
   * Show error inside modal.
   */
  function showModalError(el, msg) {
    if (!el) return;
    el.textContent = msg;
    el.style.display = "block";
  }

  /**
   * Close all active modals.
   */
  function closeModals() {
    const host = document.getElementById("vn-part-modals-host");
    if (host) host.innerHTML = "";
  }

  /**
   * Handle submission of the Action form.
   */
  async function handleActionFormSubmit(e) {
    e.preventDefault();
    if (vnPartEphemeralState.mutationInProgress) return;

    const form = e.target;
    const removalId = form.dataset.removalId;
    const action = form.dataset.action;
    const expectedVersion = parseInt(form.dataset.version, 10);
    const errorEl = document.getElementById("vn-part-action-error");
    const submitBtn = document.getElementById("vn-part-action-submit");

    const removal = vnPartEphemeralState.removals.find((r) => r.id === removalId);
    if (!removal) {
      showModalError(errorEl, "Dossier introuvable.");
      return;
    }

    const payload = {};

    // 1. Validate reason if required
    const reasonVal = form.reason?.value?.trim();
    if (action === "REFUSE" || action === "CANCEL") {
      if (!reasonVal) {
        showModalError(errorEl, "Le motif est obligatoire pour cette action.");
        return;
      }
      payload.reason = reasonVal;
    } else if (reasonVal) {
      payload.reason = reasonVal;
    }

    // 2. Validate ETA if required
    if (action === "REVISE_ETA" || (action === "APPROVE" && form.expected_replacement_date)) {
      const etaVal = form.expected_replacement_date?.value?.trim();
      if (!etaVal) {
        showModalError(errorEl, "La date d'arrivée prévue de la pièce est obligatoire.");
        return;
      }
      // Check valid ISO date format YYYY-MM-DD
      if (!/^\d{4}-\d{2}-\d{2}$/.test(etaVal) || isNaN(new Date(etaVal).getTime())) {
        showModalError(errorEl, "Format de date invalide (attendu : AAAA-MM-JJ).");
        return;
      }
      payload.expected_replacement_date = etaVal;
    }

    // 3. Validate Donor data if required
    if (action === "REVISE_DONOR" || (action === "APPROVE" && form.donor_model)) {
      const modelVal = form.donor_model?.value?.trim();
      const rawVinVal = form.donor_vin?.value ?? "";
      const vinValidation = validateDonorVin(rawVinVal);
      const vinVal = vinValidation.normalizedVin;
      const locVal = form.donor_location?.value?.trim();

      if (!modelVal) {
        showModalError(errorEl, "Le modèle du véhicule donneur est obligatoire.");
        return;
      }

      if (!String(rawVinVal).trim()) {
        showModalError(errorEl, "Le numéro de châssis / VIN du donneur est obligatoire.");
        return;
      }

      if (!vinValidation.ok) {
        showModalError(errorEl, vinValidation.message);
        return;
      }

      if (
        removal.beneficiary_vin &&
        normalizeDonorVin(removal.beneficiary_vin) === vinVal
      ) {
        showModalError(errorEl, "Le véhicule donneur ne peut pas être identique au véhicule bénéficiaire.");
        return;
      }

      payload.donor_model = modelVal;
      payload.donor_vin = vinVal;
      if (locVal) payload.donor_location = locVal;
    }

    vnPartEphemeralState.mutationInProgress = true;
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Traitement en cours...";
    }

    const applyFn =
      (clientModule && clientModule.applyVnPartAction) ||
      (typeof applyVnPartAction === "function" ? applyVnPartAction : null) ||
      (typeof window !== "undefined" ? window.applyVnPartAction : null);

    if (!applyFn) {
      showModalError(errorEl, "Module d'action introuvable.");
      vnPartEphemeralState.mutationInProgress = false;
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = "Confirmer l'action";
      }
      return;
    }

    const res = await applyFn(removalId, expectedVersion, action, payload);
    vnPartEphemeralState.mutationInProgress = false;

    // Concurrency conflict handling
    if (!res.ok && res.code === "VERSION_CONFLICT") {
      closeModals();
      vnPartEphemeralState.conflictMessage = "Ce dossier a été mis à jour par un autre utilisateur. Les données ont été actualisées. Veuillez vérifier les nouvelles informations avant de recommencer.";
      await refreshVnPartDashboard();
      return;
    }

    if (!res.ok) {
      showModalError(errorEl, res.message || "Erreur lors de l'exécution de l'action.");
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = "Confirmer l'action";
      }
      return;
    }

    closeModals();
    vnPartEphemeralState.conflictMessage = null;
    await refreshVnPartDashboard();
  }

  /**
   * Bind event listeners for the VN-PART dashboard.
   */
  function bindVnPartUiEvents() {
    if (typeof document === "undefined") return;
    ensureVnPartDomMounted();

    // Search input
    const searchInput = document.getElementById("vn-part-search-input");
    searchInput?.addEventListener("input", (e) => {
      vnPartEphemeralState.searchQuery = e.target.value;
      renderVnPartView();
    });

    // Refresh button
    const refreshBtn = document.getElementById("vn-part-refresh-btn");
    refreshBtn?.addEventListener("click", () => {
      refreshVnPartDashboard();
    });

    // Create Request button
    const createBtn = document.getElementById("vn-part-new-request-btn");
    createBtn?.addEventListener("click", () => {
      openCreateModal();
    });

    // Conflict banner dismiss button
    const conflictDismissBtn = document.getElementById("vn-part-conflict-dismiss");
    conflictDismissBtn?.addEventListener("click", () => {
      vnPartEphemeralState.conflictMessage = null;
      const conflictBanner = document.getElementById("vn-part-conflict-banner");
      if (conflictBanner) conflictBanner.style.display = "none";
    });

    // Filter buttons
    const filterButtons = document.querySelectorAll(".vn-part-filter-btn");
    filterButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const filter = btn.dataset.filter || "all-open";
        vnPartEphemeralState.activeFilter = filter;
        filterButtons.forEach((b) => {
          const isActive = b.dataset.filter === filter;
          b.classList.toggle("active", isActive);
          b.setAttribute("aria-pressed", String(isActive));
        });
        renderVnPartView();
      });
    });

    // Global click listener for contextual action buttons and request filter buttons
    document.addEventListener("click", (e) => {
      const etaBtn = e.target?.closest?.(".vn-part-eta-filter-btn");
      if (etaBtn) {
        const filter = etaBtn.dataset.etaFilter || "all";
        vnPartEphemeralState.activeEtaFilter = filter;
        renderVnPartView();
        return;
      }

      const reqBtn = e.target?.closest?.(".vn-part-req-filter-btn");
      if (reqBtn) {
        const filter = reqBtn.dataset.reqFilter || "all";
        vnPartEphemeralState.activeRequestFilter = filter;
        renderVnPartView();
        return;
      }

      const btn = e.target?.closest?.(".vn-part-action-btn");
      if (btn) {
        const action = btn.dataset.action;
        const removalId = btn.dataset.removalId;
        if (action && removalId) {
          openActionModal(removalId, action);
        }
      }
    });

    // Global navigation tab hooks
    if (typeof window !== "undefined") {
      const originalSetActiveTab = window.setActiveTab;
      if (typeof originalSetActiveTab === "function" && !originalSetActiveTab._vnPartWrapped) {
        const wrapped = function (tab, ...rest) {
          const res = originalSetActiveTab.call(this, tab, ...rest);
          if (tab === "vn-part") {
            refreshVnPartDashboard();
          }
          return res;
        };
        wrapped._vnPartWrapped = true;
        window.setActiveTab = wrapped;
      }

      const originalRenderNav = window.renderPrimaryNavigationVisibility;
      if (typeof originalRenderNav === "function" && !originalRenderNav._vnPartWrapped) {
        const wrappedNav = function (...args) {
          const res = originalRenderNav.apply(this, args);
          syncVnPartNavVisibility();
          return res;
        };
        wrappedNav._vnPartWrapped = true;
        window.renderPrimaryNavigationVisibility = wrappedNav;
      }
    }

    document.addEventListener("click", (e) => {
      const btn = e.target?.closest?.('.nav-button[data-tab="vn-part"]');
      if (btn) {
        refreshVnPartDashboard();
      }
    });

    // Escape key closes modals
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        closeModals();
      }
    });

    syncVnPartNavVisibility();
  }

  // Initialize upon DOM readiness
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => {
        bindVnPartUiEvents();
        syncVnPartNavVisibility();
      });
    } else {
      bindVnPartUiEvents();
      syncVnPartNavVisibility();
    }
  }

  return {
    vnPartEphemeralState,
    computeVnPartKpis,
    filterVnPartDonors,
    groupVnPartByModelAndVin,
    buildApprovalLookup,
    getAvailableVnPartActions,
    ensureVnPartDomMounted,
    syncVnPartNavVisibility,
    refreshVnPartDashboard,
    renderVnPartView,
    filterVnPartRequests,
    renderRequestCard,
    bindVnPartUiEvents,
    openCreateModal,
    openActionModal,
    closeModals,
    validateCreateRequestPayload,
    renderApprovalStrip,
    normalizeDonorVin,
    validateDonorVin,
    classifyEtaTracking,
    computeEtaTrackingSummary,
    filterEtaTrackingRows,
    formatPartIdentity,
    renderPartIdentityHtml,
    computeDonorCommitmentSummary,
  };
});
