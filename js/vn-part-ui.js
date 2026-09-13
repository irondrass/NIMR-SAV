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
    removals: [],
    approvals: [],
    loading: false,
    error: null,
    conflictMessage: null,
    activeFilter: "all-open", // 'all-open' | 'ready' | 'overdue' | 'waiting' | 'history'
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
    const roles = [
      { roleKey: "directeur", label: "Direction" },
      { roleKey: "directeur_pieces", label: "Direction Pièces (ETA)" },
      { roleKey: "responsable_qualite_parc_vn", label: "Chef de Parc VN (Donneur)" },
    ];

    let approvedCount = 0;
    for (const r of roles) {
      const a = approvalLookup.get(`${removal.id}:${r.roleKey}`);
      if (a && a.decision === "APPROVED") approvedCount++;
    }

    let pillsHtml = "";
    for (const r of roles) {
      const a = approvalLookup.get(`${removal.id}:${r.roleKey}`);
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

    const filteredDonors = filterVnPartDonors(
      vnPartEphemeralState.donors,
      vnPartEphemeralState.removals,
      vnPartEphemeralState.activeFilter,
      vnPartEphemeralState.searchQuery
    );

    if (!filteredDonors.length) {
      const isSearchOrFilter =
        vnPartEphemeralState.searchQuery ||
        vnPartEphemeralState.activeFilter !== "all-open";
      const emptyMsg = isSearchOrFilter
        ? "Aucun prélèvement VN ne correspond aux critères sélectionnés."
        : "Aucun prélèvement VN à restituer pour cet atelier.";

      container.innerHTML = `
        <div class="vn-part-empty" role="status">
          <svg viewBox="0 0 24 24" class="vn-part-empty-icon" aria-hidden="true"><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.5 2.8C2.1 10.8 2 11 2 11.2V16c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/></svg>
          <h3>Aucun dossier</h3>
          <p>${escapeHtml(emptyMsg)}</p>
        </div>
      `;
      return;
    }

    const groups = groupVnPartByModelAndVin(
      filteredDonors,
      vnPartEphemeralState.removals
    );

    const approvalLookup = buildApprovalLookup(vnPartEphemeralState.approvals);

    let html = "";

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
        const donorRemovals = item.removals;
        const isOverdue = Number(donor.overdue_count || 0) > 0;
        const isReady = Boolean(donor.can_be_restored_today);
        const isFullyRestored = Boolean(donor.is_fully_restored);

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
            </div>

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
                    <strong>${escapeHtml(rem.part_designation)}</strong>
                    ${rem.part_reference ? `<code class="vn-part-part-ref">${escapeHtml(rem.part_reference)}</code>` : ""}
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
    await refreshVnPartDashboard();
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
            <input type="text" id="vn-action-donor-vin" name="donor_vin" required placeholder="Numéro VIN donneur">
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
            <textarea id="vn-action-reason" name="reason" rows="2" placeholder="Remarque direction..."></textarea>
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
          <input type="text" id="vn-action-donor-vin" name="donor_vin" required value="${escapeHtml(removal.donor_vin || "")}">
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
      if (action === "CONFIRM_REMOVAL") {
        confirmationPrompt = `Confirmez-vous que la pièce "${escapeHtml(removal.part_designation)}" a été physiquement démontée du véhicule donneur ${escapeHtml(removal.donor_vin || "")} ?`;
      } else if (action === "STORE_ACK") {
        confirmationPrompt = `Confirmez-vous la prise en compte magasin pour la commande de réapprovisionnement de la pièce "${escapeHtml(removal.part_designation)}" ?`;
      } else if (action === "MARK_REPLACEMENT_AVAILABLE") {
        confirmationPrompt = `Confirmez-vous que la pièce neuve de remplacement "${escapeHtml(removal.part_designation)}" a été reçue et est disponible pour restitution ?`;
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
              <strong>${escapeHtml(removal.part_designation)}</strong>
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
      const vinVal = form.donor_vin?.value?.trim();
      const locVal = form.donor_location?.value?.trim();

      if (!modelVal) {
        showModalError(errorEl, "Le modèle du véhicule donneur est obligatoire.");
        return;
      }
      if (!vinVal) {
        showModalError(errorEl, "Le numéro de châssis / VIN du donneur est obligatoire.");
        return;
      }

      if (removal.beneficiary_vin && removal.beneficiary_vin.trim().toUpperCase() === vinVal.toUpperCase()) {
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

    // Global click listener for contextual action buttons
    document.addEventListener("click", (e) => {
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
    bindVnPartUiEvents,
    openCreateModal,
    openActionModal,
    closeModals,
    validateCreateRequestPayload,
    renderApprovalStrip,
  };
});
