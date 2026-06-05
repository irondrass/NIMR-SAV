let activeReceptionFilter = "all";
let isReceptionCreationMode = false;

function initReceptionWorkspace() {
  const view = document.getElementById("view-reception-workspace");
  if (!view) return;

  // Search input events
  const searchInput = document.getElementById("reception-case-search");
  if (searchInput) {
    searchInput.addEventListener("input", () => {
      renderReceptionWorkspace();
    });
  }

  // Filter pills events
  const filterContainer = view.querySelector(".reception-filters-row");
  if (filterContainer) {
    filterContainer.addEventListener("click", (e) => {
      const pill = e.target.closest(".filter-pill");
      if (!pill) return;
      
      filterContainer.querySelectorAll(".filter-pill").forEach(p => p.classList.remove("active"));
      pill.classList.add("active");
      
      activeReceptionFilter = pill.dataset.filter || "all";
      renderReceptionWorkspace();
    });
  }

  // Case list click events
  const caseList = document.getElementById("reception-case-list");
  if (caseList) {
    caseList.addEventListener("click", (e) => {
      const card = e.target.closest("[data-case]");
      if (!card) return;
      
      activeCaseId = card.dataset.case;
      isReceptionCreationMode = false;
      
      // Update other views if necessary
      activeCaseDetailTab = "resume";
      
      renderReceptionWorkspace();
      
      // If renderCases and renderCaseDetail exist (from ui-cases.js), refresh them to stay in sync
      if (typeof renderCases === "function") renderCases();
      if (typeof renderCaseDetail === "function") renderCaseDetail();
    });
  }

  // Recommended action button
  const recommendedBtn = document.getElementById("reception-recommended-action-btn");
  if (recommendedBtn) {
    recommendedBtn.addEventListener("click", async () => {
      const item = state.cases.find(c => c.id === activeCaseId);
      await executeRecommendedAction(item);
    });
  }

  // Event Delegation for Detail Panel
  const detailPanel = document.getElementById("reception-detail-panel");
  if (detailPanel) {
    // 1. Edit / Detail Form Submission
    detailPanel.addEventListener("submit", async (e) => {
      const form = e.target;
      if (form.id === "reception-case-detail-form") {
        e.preventDefault();
        const item = state.cases.find(c => c.id === activeCaseId);
        if (!item) return;

        const data = new FormData(form);
        const candidate = {
          clientName: String(data.get("clientName") || "").trim(),
          phone: String(data.get("phone") || "").trim(),
          vehicle: String(data.get("vehicle") || "").trim(),
          plate: normalizeIdentifierValue(data.get("plate")),
          vin: normalizeIdentifierValue(data.get("vin")),
          mileage: normalizeIdentifierValue(data.get("mileage")),
          driverName: String(data.get("driverName") || "").trim(),
          driverPhone: String(data.get("driverPhone") || "").trim(),
          arrivalNotes: String(data.get("arrivalNotes") || "").trim(),
        };

        if (!candidate.clientName) {
          notifyUser("Le nom du client est obligatoire.", "error");
          return;
        }
        if (!candidate.vehicle && !candidate.plate && !candidate.vin) {
          notifyUser("Renseignez au moins le véhicule, l'immatriculation ou le VIN.", "error");
          return;
        }

        // Apply edits
        Object.assign(item, candidate);

        // Appointment Date Update
        const appDateVal = data.get("appointmentDate");
        if (appDateVal) {
          const dateISO = new Date(appDateVal).toISOString();
          if (!item.appointment) {
            item.appointment = {
              start: dateISO,
              end: dateISO,
              delivery: dateISO,
              marginMinutes: 0
            };
          } else {
            item.appointment.start = dateISO;
            if (!item.appointment.end) item.appointment.end = dateISO;
            if (!item.appointment.delivery) item.appointment.delivery = dateISO;
          }
          item.appointmentStatus = "scheduled";
        } else {
          item.appointment = null;
          item.appointmentStatus = "none";
        }

        // Order Type Update (Claim 0 type)
        const orderTypeVal = data.get("orderType");
        if (orderTypeVal && item.claims && item.claims.length > 0) {
          item.claims[0].type = orderTypeVal;
          if (isClientOnlyRepairClaim(item.claims[0])) {
            item.claims[0].expertApproved = true;
          }
          item.claims[0].updatedAt = new Date().toISOString();
        }

        addAuditLog("case.edit", "Dossier modifié", "Dossier modifié depuis l'espace réception", { caseId: item.id });
        saveState({ flushCloud: true, cloudReason: "reception-case-edit" });
        notifyUser("Dossier mis à jour.", "success");
        renderReceptionWorkspace();
        if (typeof renderCases === "function") renderCases();
      }

      // 2. Create Form Submission
      if (form.id === "reception-case-create-form") {
        e.preventDefault();
        const data = new FormData(form);
        const orderType = data.get("orderType") || "vidange";
        const orderTitle = String(data.get("orderTitle") || "").trim() || getClaimTypeLabel(orderType);
        
        const candidate = {
          clientName: String(data.get("clientName") || "").trim(),
          phone: String(data.get("phone") || "").trim(),
          vehicle: String(data.get("vehicle") || "").trim() || "Véhicule à compléter",
          plate: normalizeIdentifierValue(data.get("plate")),
          vin: normalizeIdentifierValue(data.get("vin")),
          mileage: normalizeIdentifierValue(data.get("mileage")),
          driverName: String(data.get("driverName") || "").trim(),
          driverPhone: String(data.get("driverPhone") || "").trim(),
          arrivalNotes: String(data.get("arrivalNotes") || "").trim(),
        };

        if (!candidate.clientName) {
          notifyUser("Le nom du client est obligatoire.", "error");
          return;
        }
        if (!candidate.vehicle && !candidate.plate && !candidate.vin) {
          notifyUser("Renseignez au moins le véhicule, l'immatriculation ou le VIN.", "error");
          return;
        }

        const duplicate = findDuplicateCase(candidate);
        if (duplicate) {
          const isStrict = duplicate.clientName === candidate.clientName && (duplicate.plate === candidate.plate || duplicate.vin === candidate.vin) && !duplicate.flags?.delivered;
          if (isStrict) {
            notifyUser("Un dossier strictement identique et non livré existe déjà.", "error");
            return;
          } else {
            const confirmed = await showConfirmModal(`Un dossier similaire existe déjà pour ce véhicule ou ce client (${duplicate.clientName}). Créer quand même un nouveau dossier ?`);
            if (!confirmed) {
              activeCaseId = duplicate.id;
              isReceptionCreationMode = false;
              renderReceptionWorkspace();
              return;
            }
          }
        }

        const item = normalizeCase({
          ...candidate,
          id: uid("case"),
          createdAt: new Date().toISOString(),
          durations: Object.fromEntries(DURATIONS.map(([k]) => [k, 0])),
          history: [makeHistoryEntry("case.created", "Dossier créé", new Date().toISOString())],
        });

        // Initialize First Claim
        const firstClaim = normalizeRepairClaim({
          id: uid("claim"),
          number: "OT-001",
          title: orderTitle,
          type: orderType,
          status: isClientOnlyRepairClaim({ type: orderType }) ? "client_pending" : "expert_pending",
          includeInPlanning: true,
          expertApproved: isClientOnlyRepairClaim({ type: orderType }),
          clientApproved: false,
          orNumber: item.orNavNumber || "",
        }, 0);
        item.claims = [firstClaim];
        addHistory(item, "claim.created", "Premier ordre de réparation créé", getClaimLabel(firstClaim));

        // Appointment Date Update
        const appDateVal = data.get("appointmentDate");
        if (appDateVal) {
          const dateISO = new Date(appDateVal).toISOString();
          item.appointment = {
            start: dateISO,
            end: dateISO,
            delivery: dateISO,
            marginMinutes: 0
          };
          item.appointmentStatus = "scheduled";
        }

        state.cases.unshift(item);
        activeCaseId = item.id;
        isReceptionCreationMode = false;

        addAuditLog("case.create", "Dossier créé", `Dossier créé depuis l'espace réception pour ${item.clientName}`, { caseId: item.id });
        saveState({ flushCloud: true, cloudReason: "reception-case-create" });
        notifyUser("Dossier créé avec succès.", "success");
        renderReceptionWorkspace();
        if (typeof renderCases === "function") renderCases();
      }

      // 3. Add Customer Claim Form Submission
      if (form.id === "reception-add-claim-form") {
        e.preventDefault();
        const data = new FormData(form);
        const text = String(data.get("claimText") || "").trim();
        const priority = data.get("claimPriority") || "normal";
        if (!text) return;

        handleAddCustomerClaim(activeCaseId, text, priority);
      }

      // 4. Add Comment Form Submission
      if (form.classList.contains("claim-add-comment-form")) {
        e.preventDefault();
        const claimId = form.dataset.claimId;
        const input = form.querySelector("input");
        const text = String(input?.value || "").trim();
        if (!claimId || !text) return;

        handleAddClaimComment(activeCaseId, claimId, text);
      }
    });

    // Handle clicks inside Detail Panel
    detailPanel.addEventListener("click", async (e) => {
      // Explain claim button
      const explainBtn = e.target.closest(".explain-claim-btn");
      if (explainBtn) {
        const claimId = explainBtn.dataset.claimId;
        if (claimId) handleExplainClaim(activeCaseId, claimId);
        return;
      }

      // Quick actions click triggers
      const quickArrive = e.target.closest("#reception-quick-arrive-btn");
      if (quickArrive) {
        const item = state.cases.find(c => c.id === activeCaseId);
        if (item) await markVehicleArrived(item);
        return;
      }

      const quickAddClaim = e.target.closest("#reception-quick-add-claim-btn");
      if (quickAddClaim) {
        const input = detailPanel.querySelector('input[name="claimText"]');
        if (input) {
          input.focus();
          input.scrollIntoView({ behavior: "smooth" });
        }
        return;
      }
    });

    // Handle claim status change selector
    detailPanel.addEventListener("change", (e) => {
      const select = e.target.closest(".claim-status-select");
      if (select) {
        const claimId = select.dataset.claimId;
        const newStatus = select.value;
        if (claimId && newStatus) {
          handleClaimStatusChange(activeCaseId, claimId, newStatus);
        }
      }
    });
  }
}

function renderReceptionWorkspace() {
  const view = document.getElementById("view-reception-workspace");
  if (!view || view.hidden) return;

  const searchInput = document.getElementById("reception-case-search");
  const query = String(searchInput?.value || "").trim().toLowerCase();

  // Filter cases
  const allCases = (state.cases || []).filter(c => !c.deletedAt);
  const now = new Date();
  
  const filtered = allCases.filter(item => {
    // Apply filter pills
    if (activeReceptionFilter === "new") {
      if (item.flags.received || item.appointment) return false;
    } else if (activeReceptionFilter === "today") {
      if (!item.appointment) return false;
      const start = item.appointment.start;
      const delivery = item.appointment.delivery;
      if (!isSameBusinessDay(start, now) && !isSameBusinessDay(delivery, now)) return false;
    } else if (activeReceptionFilter === "expected") {
      if (item.flags.received || !item.appointment || !isSameBusinessDay(item.appointment.start, now)) return false;
    } else if (activeReceptionFilter === "arrived") {
      if (!item.flags.received || item.flags.delivered) return false;
    } else if (activeReceptionFilter === "pending-approval") {
      if (item.flags.delivered || !(item.claims || []).some(claim => !claim.clientApproved)) return false;
    } else if (activeReceptionFilter === "ready-deliver") {
      if (!item.flags.qualityApproved || item.flags.delivered) return false;
    } else if (activeReceptionFilter === "open-claims") {
      if (item.flags.delivered || !(item.customerClaims || []).some(c => ["open", "in_progress", "unresolved"].includes(c.status))) return false;
    }

    // Apply Search Query
    if (query) {
      const matchClient = String(item.clientName || "").toLowerCase().includes(query);
      const matchPhone = String(item.phone || "").toLowerCase().includes(query);
      const matchVehicle = String(item.vehicle || "").toLowerCase().includes(query);
      const matchPlate = String(item.plate || "").toLowerCase().includes(query);
      const matchVin = String(item.vin || "").toLowerCase().includes(query);
      const matchDriver = String(item.driverName || "").toLowerCase().includes(query);
      return matchClient || matchPhone || matchVehicle || matchPlate || matchVin || matchDriver;
    }

    return true;
  });

  // Sort filtered cases (most recent first)
  filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  // Update cases count
  const countEl = document.getElementById("reception-cases-count");
  if (countEl) {
    countEl.textContent = `${filtered.length} dossier${filtered.length > 1 ? "s" : ""}`;
  }

  // Render Case List sidebar
  const caseListEl = document.getElementById("reception-case-list");
  if (caseListEl) {
    if (filtered.length === 0) {
      caseListEl.innerHTML = `<div class="empty-inline">Aucun dossier trouvé.</div>`;
    } else {
      caseListEl.innerHTML = filtered.map(item => {
        const active = item.id === activeCaseId ? " active" : "";
        const status = getCaseStatus(item);
        
        // Count open customer claims
        const openClaimsCount = (item.customerClaims || []).filter(c => ["open", "in_progress", "unresolved"].includes(c.status)).length;
        const claimBadge = openClaimsCount > 0 ? `<span class="tag priority-urgent" style="margin-left:auto;">${openClaimsCount} Récl.</span>` : "";

        return `
          <button class="case-card${active}" type="button" data-case="${item.id}">
            <div style="display:flex; justify-content:space-between; align-items:center; width:100%;">
              <strong>${escapeHtml(item.clientName)}</strong>
              ${claimBadge}
            </div>
            <span>${escapeHtml(item.vehicle || "Véhicule non renseigné")} · ${escapeHtml(item.plate || item.vin || "Sans immatriculation")}</span>
            <span class="case-meta">
              <span class="tag">${statusLabels[status] || status}</span>
              ${item.appointment ? `<span>${formatDateTime(item.appointment.start)}</span>` : "<span>RDV non planifié</span>"}
            </span>
          </button>
        `;
      }).join("");
    }
  }

  // Render detail panel & banner
  const activeItem = state.cases.find(c => c.id === activeCaseId);
  renderReceptionBanner(activeItem);
  renderReceptionDetailPanel(activeItem);
}

function renderReceptionBanner(item) {
  const titleEl = document.getElementById("reception-recommended-action-title");
  const btn = document.getElementById("reception-recommended-action-btn");
  if (!titleEl || !btn) return;

  const rec = getReceptionRecommendedAction(item);
  titleEl.textContent = rec.title;
  btn.textContent = rec.action;
  
  if (rec.disabled) {
    btn.setAttribute("disabled", "true");
    btn.style.opacity = "0.5";
    btn.style.cursor = "not-allowed";
  } else {
    btn.removeAttribute("disabled");
    btn.style.opacity = "1";
    btn.style.cursor = "pointer";
  }
}

function getReceptionRecommendedAction(item) {
  if (!item) {
    return {
      title: "Créer un nouveau dossier client.",
      action: "Créer dossier",
      disabled: false
    };
  }

  if (isCaseReadonlyArchive(item)) {
    return {
      title: "Ce dossier est archivé et clôturé en lecture seule.",
      action: "Dossier archivé",
      disabled: true
    };
  }

  if (item.flags.delivered) {
    return {
      title: "Le véhicule a déjà été livré au client.",
      action: "Dossier livré",
      disabled: true
    };
  }

  // 1. Vehicle is expected (not arrived yet)
  if (!item.flags.received) {
    return {
      title: "Le véhicule est attendu pour son rendez-vous.",
      action: "Marquer véhicule arrivé",
      disabled: false
    };
  }

  // 2. Client approval missing
  if (!item.flags.clientApproved) {
    return {
      title: "La validation client / interne est requise pour démarrer.",
      action: "Validation client",
      disabled: false
    };
  }

  // 3. Ready to send to workshop
  if (!item.flags.workStarted) {
    return {
      title: "Le dossier est prêt à être envoyé en atelier.",
      action: "Envoyer en atelier",
      disabled: false
    };
  }

  // 4. Unresolved customer claims block
  const unresolvedClaims = (item.customerClaims || []).filter(c => ["open", "in_progress", "unresolved"].includes(c.status));
  if (unresolvedClaims.length > 0 && item.flags.qualityApproved) {
    return {
      title: `Il reste ${unresolvedClaims.length} réclamation(s) client à traiter avant livraison.`,
      action: "Livrer véhicule",
      disabled: false
    };
  }

  // 5. Ready to deliver
  if (item.flags.qualityApproved && !item.flags.delivered) {
    return {
      title: "Le véhicule est prêt à être restitué au client.",
      action: "Livrer véhicule",
      disabled: false
    };
  }

  // 6. Work is in progress in workshop
  if (item.flags.workStarted && !item.flags.workCompleted) {
    return {
      title: "Les travaux sont en cours en atelier.",
      action: "Ajouter réclamation",
      disabled: false
    };
  }

  // Default
  return {
    title: "Suivi du dossier en cours.",
    action: "Gérer le dossier",
    disabled: true
  };
}

function renderReceptionCreationForm() {
  const detailPanel = document.getElementById("reception-detail-panel");
  if (!detailPanel) return;

  detailPanel.innerHTML = `
    <form class="reception-essential-form" id="reception-case-create-form" style="padding: 20px;">
      <h2>Créer un nouveau dossier</h2>
      <br>
      <div class="form-grid">
        <label>
          <span>Client *</span>
          <input type="text" name="clientName" placeholder="Nom du client" required />
        </label>
        <label>
          <span>Téléphone</span>
          <input type="tel" name="phone" placeholder="Numéro de téléphone" />
        </label>
        <label>
          <span>Véhicule *</span>
          <input type="text" name="vehicle" placeholder="Modèle du véhicule" required />
        </label>
        <label>
          <span>Immatriculation</span>
          <input type="text" name="plate" placeholder="Immatriculation" />
        </label>
        <label>
          <span>VIN</span>
          <input type="text" name="vin" placeholder="Numéro de série VIN" />
        </label>
        <label>
          <span>Kilométrage</span>
          <input type="text" name="mileage" placeholder="Kilométrage" />
        </label>
        <label>
          <span>Déposant (Nom)</span>
          <input type="text" name="driverName" placeholder="Nom du déposant" />
        </label>
        <label>
          <span>Déposant (Tél)</span>
          <input type="text" name="driverPhone" placeholder="Tél du déposant" />
        </label>
        <label>
          <span>Date / Heure RDV</span>
          <input type="datetime-local" name="appointmentDate" />
        </label>
        <label>
          <span>Type d'ordre</span>
          <select name="orderType">
            <option value="tolerie">Tôlerie</option>
            <option value="mecanique">Mécanique</option>
            <option value="electrique">Électrique</option>
            <option value="peinture">Peinture</option>
            <option value="vidange" selected>Vidange</option>
            <option value="auto">Automatique</option>
          </select>
        </label>
      </div>
      <label style="display: block; margin-top: 12px;">
        <span>Motif d'entrée *</span>
        <input type="text" name="orderTitle" placeholder="Motif de l'ordre de réparation..." required style="width: 100%; box-sizing: border-box; height: 38px;" />
      </label>
      <label style="display: block; margin-top: 12px;">
        <span>Notes de réception</span>
        <textarea name="arrivalNotes" rows="3" placeholder="Notes particulières lors de la dépose..." style="width: 100%; box-sizing: border-box;"></textarea>
      </label>
      <button class="primary-button touch-action-btn" type="submit" style="margin-top: 18px; width: 100%;">Créer le dossier</button>
    </form>
  `;
}

function renderReceptionDetailPanel(item) {
  const detailPanel = document.getElementById("reception-detail-panel");
  if (!detailPanel) return;

  if (isReceptionCreationMode || !item) {
    renderReceptionCreationForm();
    return;
  }

  const status = getCaseStatus(item);

  // Unresolved customer claims block warning if ready to deliver
  const unresolved = (item.customerClaims || []).filter(c => ["open", "in_progress", "unresolved"].includes(c.status));
  const overrideWarningHtml = (unresolved.length > 0 && item.flags.qualityApproved) ? `
    <div class="override-warning-box">
      <strong>Attention :</strong> Ce dossier comporte ${unresolved.length} réclamation(s) client non résolue(s). 
      La livraison est bloquée sauf si elle est forcée par un chef d'atelier ou un administrateur.
    </div>
  ` : "";

  detailPanel.innerHTML = `
    <div style="padding: 20px;">
      ${overrideWarningHtml}

      <div class="reception-detail-header" style="margin-bottom: 20px;">
        <div class="reception-detail-title-row" style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:12px;">
          <div>
            <h2 style="margin:0; font-size: 1.6rem; font-weight:700;">${escapeHtml(item.clientName)}</h2>
            <p class="reception-detail-subtitle" style="margin:4px 0 0; color:var(--muted); font-size:1.05rem;">
              ${escapeHtml(item.vehicle || "Modèle inconnu")} · ${escapeHtml(item.plate || item.vin || "Sans immatriculation")}
            </p>
          </div>
          <div class="reception-status-badge-container">
            <span class="tag" style="padding: 6px 12px; font-size: 0.9rem; font-weight:600;">${statusLabels[status] || status}</span>
          </div>
        </div>
      </div>

      <div class="reception-quick-actions-grid">
        ${!item.flags.received ? `
          <button class="touch-action-btn primary-button" id="reception-quick-arrive-btn" type="button">
            Véhicule arrivé
          </button>
        ` : `
          <button class="touch-action-btn ghost-button" disabled type="button" style="border-color:var(--brand); color:var(--brand);">
            ✓ Véhicule arrivé
          </button>
        `}
        
        <button class="touch-action-btn primary-button" id="reception-quick-add-claim-btn" type="button">
          Ajouter réclamation
        </button>
        
        <a class="touch-action-btn secondary-button" href="tel:${escapeAttr(item.phone)}" id="reception-quick-call-btn" style="text-decoration: none; color: inherit;">
          Appeler client (${escapeHtml(item.phone || "aucun numéro")})
        </a>
      </div>

      <!-- Essential Fields Form -->
      <form class="reception-essential-form" id="reception-case-detail-form" style="margin-top:20px; border-top: 1px solid var(--line); padding-top:20px;">
        <h3 style="margin-top:0; margin-bottom:12px;">Champs essentiels</h3>
        <div class="form-grid">
          <label>
            <span>Client *</span>
            <input type="text" name="clientName" value="${escapeAttr(item.clientName)}" required />
          </label>
          <label>
            <span>Téléphone</span>
            <input type="tel" name="phone" value="${escapeAttr(item.phone)}" />
          </label>
          <label>
            <span>Véhicule *</span>
            <input type="text" name="vehicle" value="${escapeAttr(item.vehicle)}" required />
          </label>
          <label>
            <span>Immatriculation</span>
            <input type="text" name="plate" value="${escapeAttr(item.plate)}" />
          </label>
          <label>
            <span>VIN</span>
            <input type="text" name="vin" value="${escapeAttr(item.vin)}" />
          </label>
          <label>
            <span>Kilométrage</span>
            <input type="text" name="mileage" value="${escapeAttr(item.mileage)}" />
          </label>
          <label>
            <span>Déposant (Nom)</span>
            <input type="text" name="driverName" value="${escapeAttr(item.driverName)}" />
          </label>
          <label>
            <span>Déposant (Tél)</span>
            <input type="text" name="driverPhone" value="${escapeAttr(item.driverPhone)}" />
          </label>
          <label>
            <span>Date / Heure RDV</span>
            <input type="datetime-local" name="appointmentDate" value="${item.appointment?.start ? item.appointment.start.substring(0, 16) : ""}" />
          </label>
          <label>
            <span>Type d'ordre</span>
            <select name="orderType">
              <option value="tolerie" ${item.claims?.[0]?.type === "tolerie" ? "selected" : ""}>Tôlerie</option>
              <option value="mecanique" ${item.claims?.[0]?.type === "mecanique" ? "selected" : ""}>Mécanique</option>
              <option value="electrique" ${item.claims?.[0]?.type === "electrique" ? "selected" : ""}>Électrique</option>
              <option value="peinture" ${item.claims?.[0]?.type === "peinture" ? "selected" : ""}>Peinture</option>
              <option value="vidange" ${item.claims?.[0]?.type === "vidange" ? "selected" : ""}>Vidange</option>
              <option value="auto" ${item.claims?.[0]?.type === "auto" ? "selected" : ""}>Automatique</option>
            </select>
          </label>
        </div>
        <label style="display: block; margin-top: 12px;">
          <span>Notes de réception / état général</span>
          <textarea name="arrivalNotes" rows="3" style="width:100%; box-sizing:border-box;">${escapeHtml(item.arrivalNotes)}</textarea>
        </label>
        <button class="primary-button touch-action-btn" type="submit" style="margin-top: 14px; width:100%;">Enregistrer les informations</button>
      </form>

      <!-- Customer Claims block -->
      <div class="claims-block">
        <h3 style="margin-top:0;">Réclamations client à suivre</h3>
        
        <!-- Form to add claim -->
        <form id="reception-add-claim-form" style="margin-bottom: 18px;">
          <div style="display: flex; gap: 8px; align-items: flex-end; flex-wrap:wrap;">
            <label style="flex: 1; min-width: 200px; margin:0;">
              <span>Nouvelle réclamation / signalement</span>
              <input type="text" name="claimText" placeholder="Saisir la réclamation..." required style="width: 100%; box-sizing: border-box; height: 38px;" />
            </label>
            <label style="width: 120px; margin:0;">
              <span>Priorité</span>
              <select name="claimPriority" style="width: 100%; height: 38px; padding: 4px 8px;">
                <option value="low">Faible</option>
                <option value="normal" selected>Normale</option>
                <option value="high">Haute</option>
                <option value="urgent">Urgente</option>
              </select>
            </label>
            <button class="primary-button touch-action-btn" type="submit" style="height: 38px; min-height: 38px; padding: 0 16px; margin:0;">Ajouter</button>
          </div>
        </form>

        <!-- List of claims -->
        <div class="claims-list" id="reception-claims-list">
          ${(item.customerClaims || []).length === 0 ? `
            <div class="empty-inline">Aucune réclamation enregistrée pour ce dossier.</div>
          ` : item.customerClaims.map(claim => {
            const priorityLabels = { low: "Faible", normal: "Normale", high: "Haute", urgent: "Urgente" };
            return `
              <div class="claim-card" data-claim-id="${claim.id}">
                <div class="claim-header" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
                  <span class="tag priority-${claim.priority}">${priorityLabels[claim.priority]}</span>
                  <span class="claim-meta-info" style="font-size: 0.8rem; color: var(--muted);">
                    Créé le ${new Date(claim.createdAt).toLocaleDateString()} par ${escapeHtml(claim.createdBy || "Anonyme")}
                  </span>
                </div>
                
                <div class="claim-text" style="margin-top:10px; margin-bottom:10px; font-weight:600; font-size:1.05rem;">${escapeHtml(claim.text)}</div>
                
                <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 10px; gap: 12px; flex-wrap: wrap; border-bottom: 1px dashed var(--line); padding-bottom:10px;">
                  <label style="display: flex; align-items: center; gap: 8px; margin: 0;">
                    <span style="font-size: 0.85rem; font-weight: 600;">Statut :</span>
                    <select class="claim-status-select" data-claim-id="${claim.id}" style="padding: 6px 10px; border-radius: var(--radius-sm); border: 1px solid var(--line); font-weight:500;">
                      <option value="open" ${claim.status === "open" ? "selected" : ""}>Ouverte</option>
                      <option value="in_progress" ${claim.status === "in_progress" ? "selected" : ""}>En cours</option>
                      <option value="resolved" ${claim.status === "resolved" ? "selected" : ""}>Résolue</option>
                      <option value="unresolved" ${claim.status === "unresolved" ? "selected" : ""}>Non résolue</option>
                      <option value="explained_to_customer" ${claim.status === "explained_to_customer" ? "selected" : ""}>Expliquée au client</option>
                    </select>
                  </label>
                  
                  <button class="touch-action-btn ghost-button explain-claim-btn" data-claim-id="${claim.id}" type="button" style="height: 34px; min-height: 34px; padding: 0 12px; font-size: 0.85rem; border-radius: var(--radius-sm);">
                    Expliquer au client
                  </button>
                </div>
                
                <!-- Comments timeline -->
                <div class="claim-comments" style="margin-top: 12px;">
                  <div style="font-weight: 600; margin-bottom: 6px; font-size:0.9rem;">Suivi de la réclamation :</div>
                  <div class="claim-comments-timeline">
                    ${(claim.comments || []).map(comment => `
                      <div class="claim-comment-item" style="border-left: 2px solid var(--brand); padding-left: 8px; margin-bottom: 8px;">
                        <div style="font-size:0.9rem;">${escapeHtml(comment.text)}</div>
                        <div class="claim-comment-meta" style="color:var(--muted); font-size:0.75rem; margin-top:2px;">
                          Par ${escapeHtml(comment.createdBy || "Anonyme")} le ${new Date(comment.createdAt).toLocaleString()}
                        </div>
                      </div>
                    `).join("")}
                  </div>
                  
                  <!-- Form to add comment -->
                  <form class="claim-add-comment-form" data-claim-id="${claim.id}" style="margin-top: 10px; display: flex; gap: 6px;">
                    <input type="text" placeholder="Ajouter un commentaire..." required style="flex: 1; padding: 6px 10px; border: 1px solid var(--line); border-radius: var(--radius-sm); font-size: 0.85rem;" />
                    <button class="primary-button" type="submit" style="padding: 6px 12px; font-size: 0.85rem; height:34px; min-height:34px; border-radius: var(--radius-sm);">Répondre</button>
                  </form>
                </div>
              </div>
            `;
          }).join("")}
        </div>
      </div>
    </div>
  `;
}

// Global actions execution helper
async function executeRecommendedAction(item) {
  if (!item) {
    isReceptionCreationMode = true;
    renderReceptionWorkspace();
    return;
  }
  const rec = getReceptionRecommendedAction(item);
  if (rec.action === "Marquer véhicule arrivé") {
    await markVehicleArrived(item);
  } else if (rec.action === "Validation client") {
    await approveClientAction(item);
  } else if (rec.action === "Envoyer en atelier") {
    await startWorkAction(item);
  } else if (rec.action === "Livrer véhicule") {
    await handleDeliveryAction(item);
  } else if (rec.action === "Ajouter réclamation") {
    const detailPanel = document.getElementById("reception-detail-panel");
    const input = detailPanel?.querySelector('input[name="claimText"]');
    if (input) {
      input.focus();
      input.scrollIntoView({ behavior: "smooth" });
    }
  }
}

// Arrive vehicle logic
async function markVehicleArrived(item) {
  const guard = guardWorkflowAction("received", item, true);
  if (!guard.ok) {
    notifyUser(guard.message || "Action non autorisée", "error");
    return;
  }
  const issues = getBusinessRuleIssues(item, "received");
  if (issues.length) {
    notifyUser(issues.join("\n"), "error");
    return;
  }
  const warnings = getBusinessRuleWarnings(item, "received");
  if (warnings.length) {
    const confirmed = await showConfirmModal(warnings.join("<br>") + "<br><br>Voulez-vous vraiment continuer ?");
    if (!confirmed) return;
  }
  
  item.flags.received = true;
  recordFlagHistory(item, "received", true);
  saveState({ flushCloud: true, cloudReason: "vehicle-received" });
  notifyUser("Véhicule marqué arrivé.", "success");
  render();
}

// Client Approval logic
async function approveClientAction(item) {
  const guard = guardWorkflowAction("clientApproved", item, true);
  if (!guard.ok) {
    notifyUser(guard.message || "Action non autorisée", "error");
    return;
  }
  const issues = getBusinessRuleIssues(item, "clientApproved");
  if (issues.length) {
    notifyUser(issues.join("\n"), "error");
    return;
  }
  
  const result = applyWorkflowAction(item, "clientApproved");
  if (result && result.ok) {
    saveState({ flushCloud: true, cloudReason: "client-approved" });
    notifyUser("Validation client enregistrée.", "success");
    render();
  } else {
    notifyUser(result?.message || "Erreur lors de la validation client.", "error");
  }
}

// Start work logic
async function startWorkAction(item) {
  const guard = guardWorkflowAction("workStarted", item, true);
  if (!guard.ok) {
    notifyUser(guard.message || "Action non autorisée", "error");
    return;
  }
  const issues = getBusinessRuleIssues(item, "workStarted");
  if (issues.length) {
    notifyUser(issues.join("\n"), "error");
    return;
  }
  
  const result = applyWorkflowAction(item, "workStarted");
  if (result && result.ok) {
    saveState({ flushCloud: true, cloudReason: "work-started" });
    notifyUser("Travaux démarrés en atelier.", "success");
    render();
  } else {
    notifyUser(result?.message || "Erreur lors du démarrage des travaux.", "error");
  }
}

// Unified custom text input prompt dialog using overlay
function showTextPromptModal(title, htmlMessage, placeholder = "") {
  return new Promise((resolve) => {
    const overlay = document.getElementById("custom-modal-overlay");
    const titleEl = document.getElementById("custom-modal-title");
    const body = document.getElementById("custom-modal-body");
    const cancelBtn = document.getElementById("custom-modal-cancel");
    const confirmBtn = document.getElementById("custom-modal-confirm");
    
    if (!overlay || !body || !cancelBtn || !confirmBtn) {
      resolve(prompt(htmlMessage.replace(/<br>/g, '\n')));
      return;
    }

    const oldTitle = titleEl ? titleEl.innerHTML : "Confirmation";
    if (titleEl) titleEl.innerHTML = title;

    body.innerHTML = `${htmlMessage}<br><br><input type="text" id="custom-prompt-input" style="width: 100%; padding: 8px; border: 1px solid var(--border-color, #cfe0e8); border-radius: 8px; box-sizing: border-box;" placeholder="${placeholder}" autocomplete="off" />`;
    overlay.hidden = false;
    
    const input = document.getElementById("custom-prompt-input");
    if (input) input.focus();

    const cleanup = () => {
      overlay.hidden = true;
      if (titleEl) titleEl.innerHTML = oldTitle;
      cancelBtn.removeEventListener("click", onCancel);
      confirmBtn.removeEventListener("click", onConfirm);
    };

    const onCancel = () => {
      cleanup();
      resolve(null);
    };

    const onConfirm = () => {
      const val = input ? input.value.trim() : "";
      cleanup();
      resolve(val);
    };

    cancelBtn.addEventListener("click", onCancel);
    confirmBtn.addEventListener("click", onConfirm);
  });
}

// Verify delivery claims blocks
async function verifyDeliveryClaimsBlock(item) {
  const hasUnresolved = (item.customerClaims || []).some(c => ["open", "in_progress", "unresolved"].includes(c.status));
  if (!hasUnresolved) return true;

  if (typeof addAuditLog === "function") {
    addAuditLog("reception.delivery_warning", "Avertissement livraison", `Avertissement affiché pour le dossier ${item.plate || item.vin} : réclamations non résolues.`, { caseId: item.id });
  }

  const user = typeof getCurrentUser === "function" ? getCurrentUser() : null;
  const isAuthorized = user && ["admin", "chef_atelier"].includes(user.role);
  if (!isAuthorized) {
    if (typeof showConfirmModal === "function") {
      await showConfirmModal("Livraison bloquée : le dossier comporte des réclamations client non résolues. Seul un administrateur ou chef d'atelier peut forcer la livraison.");
    } else {
      alert("Livraison bloquée : le dossier comporte des réclamations client non résolues. Seul un administrateur ou chef d'atelier peut forcer la livraison.");
    }
    return false;
  }

  const reason = await showTextPromptModal("Override Livraison", "Le dossier comporte des réclamations client non résolues. Saisissez le motif obligatoire de l'override pour autoriser la livraison :");
  if (!reason) {
    if (typeof notifyUser === "function") {
      notifyUser("Motif d'override obligatoire. Livraison annulée.", "error");
    }
    return false;
  }

  if (typeof addAuditLog === "function") {
    addAuditLog("reception.delivery_override", "Override livraison", `Livraison autorisée par override avec motif : ${reason}`, { caseId: item.id });
  }
  if (typeof addHistory === "function") {
    addHistory(item, "reception.delivery_override", "Livraison forcée (Override)", `Livraison autorisée malgré des réclamations ouvertes. Motif : ${reason}`);
  }
  return true;
}

// Delivery gate handler
async function handleDeliveryAction(item) {
  const isAllowed = await verifyDeliveryClaimsBlock(item);
  if (!isAllowed) return false;

  const guard = guardWorkflowAction("delivered", item, true);
  if (!guard.ok) {
    notifyUser(guard.message || "Action non autorisée", "error");
    return false;
  }
  
  const issues = getBusinessRuleIssues(item, "delivered");
  if (issues.length) {
    notifyUser(issues.join("\n"), "error");
    return false;
  }
  
  const warnings = getBusinessRuleWarnings(item, "delivered");
  if (warnings.length) {
    const confirmed = await showConfirmModal(warnings.join("<br>") + "<br><br>Voulez-vous vraiment continuer ?");
    if (!confirmed) return false;
  }

  const result = applyWorkflowAction(item, "delivered");
  if (result && result.ok) {
    saveState({ flushCloud: true, cloudReason: "reception-delivery" });
    notifyUser("Véhicule marqué comme livré.", "success");
    render();
    return true;
  } else {
    notifyUser(result?.message || "Erreur lors de la livraison.", "error");
    return false;
  }
}

// Claim mutations
function handleAddCustomerClaim(caseId, text, priority) {
  const item = state.cases.find(c => c.id === caseId);
  if (!item) return;

  const actor = getCurrentActor();
  const claim = normalizeCustomerClaim({
    text: text,
    priority: priority,
    status: "open",
    createdBy: actor.userName || actor.userId || "Utilisateur"
  });

  item.customerClaims = Array.isArray(item.customerClaims) ? item.customerClaims : [];
  item.customerClaims.push(claim);

  addAuditLog("customer_claim.created", "Réclamation créée", `Nouvelle réclamation ajoutée : "${text}" (priorité: ${priority})`, { caseId: item.id });
  saveState({ flushCloud: true, cloudReason: "claim-created" });
  notifyUser("Réclamation ajoutée.", "success");
  renderReceptionWorkspace();
}

function handleClaimStatusChange(caseId, claimId, newStatus) {
  const item = state.cases.find(c => c.id === caseId);
  if (!item) return;
  const claim = (item.customerClaims || []).find(c => c.id === claimId);
  if (!claim) return;

  const oldStatus = claim.status;
  claim.status = newStatus;
  claim.resolvedAt = ["resolved", "explained_to_customer"].includes(newStatus) ? new Date().toISOString() : "";
  const actor = getCurrentActor();
  claim.resolvedBy = ["resolved", "explained_to_customer"].includes(newStatus) ? (actor.userName || actor.userId) : "";

  addAuditLog("customer_claim.status_changed", "Statut réclamation changé", `Réclamation "${claim.text}" passée au statut : ${newStatus} (ancien: ${oldStatus})`, { caseId: item.id });
  addAuditLog("customer_claim.updated", "Réclamation modifiée", `Mise à jour du statut à "${newStatus}"`, { caseId: item.id });
  saveState({ flushCloud: true, cloudReason: "claim-status-changed" });
  notifyUser("Statut réclamation mis à jour.", "success");
  renderReceptionWorkspace();
}

function handleExplainClaim(caseId, claimId) {
  const item = state.cases.find(c => c.id === caseId);
  if (!item) return;
  const claim = (item.customerClaims || []).find(c => c.id === claimId);
  if (!claim) return;

  claim.status = "explained_to_customer";
  claim.resolvedAt = new Date().toISOString();
  const actor = getCurrentActor();
  claim.resolvedBy = actor.userName || actor.userId || "Utilisateur";

  const commentText = "Explication fournie au client.";
  const comment = normalizeClaimComment({
    text: commentText,
    createdBy: actor.userName || actor.userId || "Utilisateur"
  });
  claim.comments = Array.isArray(claim.comments) ? claim.comments : [];
  claim.comments.push(comment);

  addAuditLog("customer_claim.status_changed", "Statut réclamation changé", `Réclamation "${claim.text}" passée au statut : explained_to_customer`, { caseId: item.id });
  addAuditLog("customer_claim.comment_added", "Commentaire réclamation", `Commentaire ajouté sur la réclamation : "${commentText}"`, { caseId: item.id });
  addAuditLog("customer_claim.updated", "Réclamation modifiée", `Marquée comme expliquée au client`, { caseId: item.id });
  saveState({ flushCloud: true, cloudReason: "claim-explained" });
  notifyUser("Réclamation marquée expliquée au client.", "success");
  renderReceptionWorkspace();
}

function handleAddClaimComment(caseId, claimId, commentText) {
  const item = state.cases.find(c => c.id === caseId);
  if (!item) return;
  const claim = (item.customerClaims || []).find(c => c.id === claimId);
  if (!claim) return;

  const actor = getCurrentActor();
  const comment = normalizeClaimComment({
    text: commentText,
    createdBy: actor.userName || actor.userId || "Utilisateur"
  });

  claim.comments = Array.isArray(claim.comments) ? claim.comments : [];
  claim.comments.push(comment);

  addAuditLog("customer_claim.comment_added", "Commentaire réclamation", `Commentaire ajouté sur la réclamation : "${commentText}"`, { caseId: item.id });
  addAuditLog("customer_claim.updated", "Réclamation modifiée", "Commentaire ajouté", { caseId: item.id });
  saveState({ flushCloud: true, cloudReason: "claim-comment-added" });
  notifyUser("Commentaire ajouté.", "success");
  renderReceptionWorkspace();
}

if (typeof window !== "undefined") {
  window.initReceptionWorkspace = initReceptionWorkspace;
  window.renderReceptionWorkspace = renderReceptionWorkspace;
  window.verifyDeliveryClaimsBlock = verifyDeliveryClaimsBlock;
}
