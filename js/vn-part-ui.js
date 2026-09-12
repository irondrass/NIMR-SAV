/**
 * NIMR-SAV — VN-PART Read-Only Dashboard UI (003B)
 *
 * Ephemeral, strictly READ-ONLY user interface for the VN-PART dashboard.
 *
 * ABSOLUTE INVARIANTS:
 *   - Strictly read-only presentation layer
 *   - No mutation calls or buttons
 *   - No price, cost, supplier, stock quantity, bin location, or invoice fields
 *   - Ephemeral in-memory state only (not serialized to localStorage/IndexedDB/backups)
 */

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      typeof require === "function" ? require("./vn-part-client.js") : null
    );
  } else {
    const exportsObj = factory(root.loadVnPartDashboard ? { loadVnPartDashboard: root.loadVnPartDashboard } : null);
    Object.assign(root, exportsObj);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (clientModule) {
  "use strict";

  // Ephemeral in-memory UI state (never persisted to durable store)
  const vnPartEphemeralState = {
    donors: [],
    removals: [],
    loading: false,
    error: null,
    activeFilter: "all-open", // 'all-open' | 'ready' | 'overdue' | 'waiting' | 'history'
    searchQuery: "",
    lastLoadedAt: null,
  };

  /**
   * Escape HTML to prevent XSS injection.
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
   * Dynamic models (no hardcoded model names).
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

    // Sort models ascending
    const sortedModelNames = Array.from(groups.keys()).sort((a, b) =>
      a.localeCompare(b, "fr", { sensitivity: "base" })
    );

    const sortedGroups = sortedModelNames.map((model) => {
      const items = groups.get(model);
      // Sort donors: overdue first, then active first, then oldest opened at, then VIN ascending
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
   * Ensure that both the navigation button and view section for VN-PART
   * are mounted in the DOM.
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
                  <button type="button" class="ghost-button" id="vn-part-refresh-btn" title="Actualiser les données">
                    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
                    Actualiser
                  </button>
                </div>
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
          </div>
        `;
        mainContent.appendChild(viewSection);
      }
    }
  }

  /**
   * Synchronize the primary navigation button visibility for the 'vn-part' tab.
   * Allowed roles:
   *   admin_technique, directeur, chef_atelier, lecture_seule,
   *   directeur_pieces, responsable_magasin, responsable_garantie_support, responsable_qualite_parc_vn
   * Excluded roles:
   *   reception, technicien, controle_qualite
   */
  function syncVnPartNavVisibility() {
    if (typeof document === "undefined") return;
    ensureVnPartDomMounted();
    const btn = document.querySelector('.nav-button[data-tab="vn-part"]');
    if (!btn) return;
    const isAllowed = typeof canAccessTab === "function" ? canAccessTab("vn-part") : false;
    btn.hidden = !isAllowed;
    btn.style.display = isAllowed ? "" : "none";
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

    // 2. Main content container
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

    // Filter & group donors
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
            // Determine physical display badge
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

            html += `
              <div class="vn-part-removal-item" data-id="${escapeHtml(rem.id)}">
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
                  ${rem.restored_at ? `
                    <div class="vn-part-detail-cell">
                      <span class="cell-label">Restitué au VN le:</span>
                      <span class="cell-val">${escapeHtml(formatDateTimeFr(rem.restored_at))}</span>
                    </div>
                  ` : ""}
                </div>
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

    // Clean hook into setActiveTab to automatically refresh when switching to vn-part
    if (typeof window !== "undefined") {
      const originalSetActiveTab = window.setActiveTab;
      if (typeof originalSetActiveTab === "function" && !originalSetActiveTab._vnPartWrapped) {
        const wrapped = function (tab) {
          const res = originalSetActiveTab.apply(this, arguments);
          if (tab === "vn-part") {
            refreshVnPartDashboard();
          }
          return res;
        };
        wrapped._vnPartWrapped = true;
        window.setActiveTab = wrapped;
      }

      // Clean hook into renderPrimaryNavigationVisibility to synchronize vn-part nav button
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

    // Direct click listener on the nav button as extra resilience
    document.addEventListener("click", (e) => {
      const btn = e.target?.closest?.('.nav-button[data-tab="vn-part"]');
      if (btn) {
        refreshVnPartDashboard();
      }
    });

    // Initial sync of nav visibility
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
    ensureVnPartDomMounted,
    refreshVnPartDashboard,
    renderVnPartView,
    syncVnPartNavVisibility,
    bindVnPartUiEvents,
    formatDateFr,
    formatDateTimeFr,
  };
});
