// ─── ESPACE RÉCEPTION GUIDÉ PAR ÉTAPES — v23.1C ────────────────────────────
// Architecture : colonne gauche (liste) + zone centrale (1 seule étape active)

let activeReceptionFilter = "all";
let isReceptionCreationMode = false;

const RECEPTION_STEP_LABELS = [
  "", // index 0 non utilisé
  "Création du dossier",
  "Demande de planning",
  "Proposition planning",
  "Contact client",
  "Réponse client",
  "Confirmation RDV",
  "Réception véhicule",
  "Envoi atelier",
  "Suivi des travaux",
  "Contrôle qualité",
  "Livraison",
];

function initReceptionWorkspace() {
  const view = document.getElementById("view-reception-workspace");
  if (!view) return;

  // Search input
  const searchInput = document.getElementById("reception-case-search");
  if (searchInput) {
    searchInput.addEventListener("input", () => renderReceptionWorkspace());
  }

  // Filter pills
  const filterContainer = view.querySelector(".reception-filters-row");
  if (filterContainer) {
    filterContainer.addEventListener("click", (e) => {
      const pill = e.target.closest(".filter-pill");
      if (!pill) return;
      filterContainer.querySelectorAll(".filter-pill").forEach((p) => p.classList.remove("active"));
      pill.classList.add("active");
      activeReceptionFilter = pill.dataset.filter || "all";
      renderReceptionWorkspace();
    });
  }

  // Case list click
  const caseList = document.getElementById("reception-case-list");
  if (caseList) {
    caseList.addEventListener("click", (e) => {
      const card = e.target.closest("[data-case]");
      if (!card) return;
      activeCaseId = card.dataset.case;
      isReceptionCreationMode = false;
      activeCaseDetailTab = "resume";
      renderReceptionWorkspace();
      if (typeof renderCases === "function") renderCases();
      if (typeof renderCaseDetail === "function") renderCaseDetail();
    });
  }

  // Bouton "Nouveau dossier" dans la liste
  const newDossierBtn = document.getElementById("reception-new-dossier-btn");
  if (newDossierBtn) {
    newDossierBtn.addEventListener("click", () => {
      isReceptionCreationMode = true;
      activeCaseId = null;
      renderReceptionWorkspace();
    });
  }

  // Délégation d'événements sur le panneau central
  const detailPanel = document.getElementById("reception-detail-panel");
  if (detailPanel) {
    detailPanel.addEventListener("submit", handleReceptionFormSubmit);
    detailPanel.addEventListener("click", handleReceptionClick);
    detailPanel.addEventListener("change", handleReceptionChange);
  }
}

// ─── RENDU PRINCIPAL ─────────────────────────────────────────────────────────

function renderReceptionWorkspace() {
  const view = document.getElementById("view-reception-workspace");
  if (!view || view.hidden) return;

  const searchInput = document.getElementById("reception-case-search");
  const query = String(searchInput?.value || "").trim().toLowerCase();

  const allCases = (state.cases || []).filter((c) => !c.deletedAt);
  const now = new Date();

  const filtered = allCases.filter((item) => {
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
      if (item.flags.delivered || !(item.claims || []).some((claim) => !claim.clientApproved)) return false;
    } else if (activeReceptionFilter === "ready-deliver") {
      if (!item.flags.qualityApproved || item.flags.delivered) return false;
    } else if (activeReceptionFilter === "open-claims") {
      if (item.flags.delivered || !(item.customerClaims || []).some((c) => ["open", "in_progress", "unresolved"].includes(c.status))) return false;
    }

    if (query) {
      return [item.clientName, item.phone, item.vehicle, item.plate, item.vin, item.driverName]
        .some((f) => String(f || "").toLowerCase().includes(query));
    }
    return true;
  });

  filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const countEl = document.getElementById("reception-cases-count");
  if (countEl) countEl.textContent = `${filtered.length} dossier${filtered.length > 1 ? "s" : ""}`;

  const caseListEl = document.getElementById("reception-case-list");
  if (caseListEl) {
    if (filtered.length === 0) {
      caseListEl.innerHTML = `<div class="empty-inline">Aucun dossier trouvé.</div>`;
    } else {
      caseListEl.innerHTML = filtered.map((item) => {
        const active = item.id === activeCaseId ? " active" : "";
        const status = getCaseStatus(item);
        const openClaimsCount = (item.customerClaims || []).filter((c) => ["open", "in_progress", "unresolved"].includes(c.status)).length;
        const claimBadge = openClaimsCount > 0 ? `<span class="tag priority-urgent" style="margin-left:auto;">${openClaimsCount} Récl.</span>` : "";
        const stepNum = getReceptionWorkflowStep(item);
        const stepLabel = RECEPTION_STEP_LABELS[stepNum] || "";
        return `
          <button class="case-card${active}" type="button" data-case="${item.id}">
            <div style="display:flex; justify-content:space-between; align-items:center; width:100%;">
              <strong>${escapeHtml(item.clientName)}</strong>
              ${claimBadge}
            </div>
            <span>${escapeHtml(item.vehicle || "Véhicule non renseigné")} · ${escapeHtml(item.plate || item.vin || "Sans immatriculation")}</span>
            <span class="case-meta">
              <span class="tag">${statusLabels[status] || status}</span>
              <span class="tag" style="background:var(--brand-muted,#e8f4fb);color:var(--brand);">Ét.${stepNum} ${escapeHtml(stepLabel)}</span>
            </span>
          </button>
        `;
      }).join("");
    }
  }

  const activeItem = isReceptionCreationMode ? null : state.cases.find((c) => c.id === activeCaseId);
  renderReceptionDetailPanel(activeItem);
}

// ─── PANNEAU CENTRAL ─────────────────────────────────────────────────────────

function renderReceptionDetailPanel(item) {
  const detailPanel = document.getElementById("reception-detail-panel");
  if (!detailPanel) return;

  if (isReceptionCreationMode || !item) {
    renderStep1_Creation(null, detailPanel);
    return;
  }

  const stepNum = getReceptionWorkflowStep(item);

  detailPanel.innerHTML = `
    <div class="reception-guided-layout">
      ${renderReceptionStepBar(item, stepNum)}
      <div class="reception-step-content" id="reception-step-content">
        ${renderReceptionActiveStep(item, stepNum)}
      </div>
    </div>
  `;
}

function renderReceptionStepBar(item, activeStep) {
  const steps = RECEPTION_STEP_LABELS.slice(1);
  const dots = steps.map((label, i) => {
    const num = i + 1;
    const status = getReceptionStepStatus(item, num);
    const isActive = num === activeStep;
    return `
      <div class="step-item step-${status}" title="Étape ${num} — ${label}" data-step="${num}">
        <div class="step-dot ${isActive ? "step-dot-active" : ""}">
          ${status === "completed" ? "✓" : num}
        </div>
        <div class="step-label">${label}</div>
      </div>
      ${num < 11 ? `<div class="step-connector step-connector-${status === "completed" ? "done" : "pending"}"></div>` : ""}
    `;
  }).join("");

  return `<div class="reception-step-bar">${dots}</div>`;
}

function renderReceptionActiveStep(item, stepNum) {
  switch (stepNum) {
    case 1: return renderStep1_Creation(item);
    case 2: return renderStep2_PlanningRequest(item);
    case 3: return renderStep3_PlanningReceived(item);
    case 4: return renderStep4_ContactClient(item);
    case 5: return renderStep5_ClientResponse(item);
    case 6: return renderStep6_ConfirmRDV(item);
    case 7: return renderStep7_VehicleReceived(item);
    case 8: return renderStep8_SendToWorkshop(item);
    case 9: return renderStep9_TrackVehicle(item);
    case 10: return renderStep10_QualityCheck(item);
    case 11: return renderStep11_Delivery(item);
    default: return renderStep1_Creation(item);
  }
}

// ─── ÉTAPE 1 — CRÉATION DOSSIER ──────────────────────────────────────────────

function renderStep1_Creation(item, container) {
  const isCreate = !item;
  const html = `
    <div class="step-card step-card-active">
      <div class="step-card-header">
        <span class="step-number-badge">1</span>
        <div>
          <h2 class="step-title">${isCreate ? "Créer un nouveau dossier" : "Dossier client"}</h2>
          <p class="step-desc">Enregistrez les informations client, véhicule et les réclamations / demandes initiales.</p>
        </div>
      </div>

      <form id="${isCreate ? "reception-case-create-form" : "reception-case-detail-form"}" class="step-form">
        <div class="step-form-grid">
          <label class="step-field">
            <span>Client *</span>
            <input type="text" name="clientName" value="${escapeAttr(item?.clientName || "")}" placeholder="Nom du client" required />
          </label>
          <label class="step-field">
            <span>Téléphone</span>
            <input type="tel" name="phone" value="${escapeAttr(item?.phone || "")}" placeholder="Numéro de téléphone" />
          </label>
          <label class="step-field">
            <span>Véhicule *</span>
            <input type="text" name="vehicle" value="${escapeAttr(item?.vehicle || "")}" placeholder="Marque et modèle" required />
          </label>
          <label class="step-field">
            <span>Immatriculation</span>
            <input type="text" name="plate" value="${escapeAttr(item?.plate || "")}" placeholder="AA-123-BB" />
          </label>
          <label class="step-field">
            <span>VIN</span>
            <input type="text" name="vin" value="${escapeAttr(item?.vin || "")}" placeholder="Numéro de série" />
          </label>
          <label class="step-field">
            <span>Kilométrage</span>
            <input type="text" name="mileage" value="${escapeAttr(item?.mileage || "")}" placeholder="Kilométrage actuel" />
          </label>
          <label class="step-field">
            <span>Déposant (Nom)</span>
            <input type="text" name="driverName" value="${escapeAttr(item?.driverName || "")}" placeholder="Nom du déposant" />
          </label>
          <label class="step-field">
            <span>Déposant (Tél)</span>
            <input type="text" name="driverPhone" value="${escapeAttr(item?.driverPhone || "")}" placeholder="Tél déposant" />
          </label>
          <label class="step-field">
            <span>Date RDV souhaitée</span>
            <input type="datetime-local" name="appointmentDate" value="${item?.appointment?.start ? item.appointment.start.substring(0, 16) : ""}" />
          </label>
          <label class="step-field">
            <span>Type d'ordre</span>
            <select name="orderType">
              <option value="tolerie" ${item?.claims?.[0]?.type === "tolerie" ? "selected" : ""}>Tôlerie</option>
              <option value="mecanique" ${item?.claims?.[0]?.type === "mecanique" ? "selected" : ""}>Mécanique</option>
              <option value="electrique" ${item?.claims?.[0]?.type === "electrique" ? "selected" : ""}>Électrique</option>
              <option value="peinture" ${item?.claims?.[0]?.type === "peinture" ? "selected" : ""}>Peinture</option>
              <option value="vidange" ${(!item || item?.claims?.[0]?.type === "vidange") ? "selected" : ""}>Vidange</option>
              <option value="auto" ${item?.claims?.[0]?.type === "auto" ? "selected" : ""}>Automatique</option>
            </select>
          </label>
        </div>
        ${isCreate ? `
          <label class="step-field" style="margin-top:12px;">
            <span>Motif de l'intervention *</span>
            <input type="text" name="orderTitle" placeholder="Ex: Vidange moteur + filtres" required />
          </label>
        ` : ""}
        <label class="step-field" style="margin-top:12px;">
          <span>Notes de réception</span>
          <textarea name="arrivalNotes" rows="3" placeholder="État général, observations particulières...">${escapeHtml(item?.arrivalNotes || "")}</textarea>
        </label>
        <button class="step-primary-btn" type="submit">
          ${isCreate ? "Enregistrer le dossier et demander le planning →" : "Enregistrer les modifications"}
        </button>
      </form>

      ${item ? renderCustomerClaimsBlock(item) : ""}
    </div>
  `;

  if (container) {
    container.innerHTML = html;
  }
  return html;
}

// ─── ÉTAPE 2 — DEMANDE PLANNING ──────────────────────────────────────────────

function renderStep2_PlanningRequest(item) {
  const rw = item.receptionWorkflow;
  const cyclesLeft = 3 - (rw.planningCycles || 0);
  const isRevision = Boolean(rw.planningRevisionRequestedAt);
  return `
    <div class="step-card step-card-active">
      <div class="step-card-header">
        <span class="step-number-badge">2</span>
        <div>
          <h2 class="step-title">Demande de planning des travaux</h2>
          <p class="step-desc">${isRevision ? `Révision demandée (cycle ${rw.planningCycles}/3, il reste ${cyclesLeft} cycle${cyclesLeft > 1 ? "s" : ""}).` : "Envoyez une demande de planning au chef d'atelier ou directeur SAV."}</p>
        </div>
      </div>

      <div class="step-info-box">
        <strong>${escapeHtml(item.clientName)}</strong> — ${escapeHtml(item.vehicle || "")} ${escapeHtml(item.plate ? `· ${item.plate}` : "")}<br>
        ${(item.customerClaims || []).length > 0 ? `<span class="tag">${(item.customerClaims || []).length} réclamation(s) client enregistrée(s)</span>` : ""}
        ${(item.claims || []).length > 0 ? `<span class="tag">${(item.claims || []).length} ordre(s) de réparation</span>` : ""}
        ${item.appointment?.start ? `<br><span style="font-size:0.9rem;color:var(--muted);">Date souhaitée : ${formatDateTime(item.appointment.start)}</span>` : ""}
      </div>

      <form id="reception-planning-request-form" class="step-form" data-case-id="${item.id}">
        <label class="step-field">
          <span>Commentaire pour le planning (urgence, contraintes client...)</span>
          <textarea name="planningComment" rows="3" placeholder="Ex: Client disponible uniquement le matin. Travaux urgents.">${escapeHtml(rw.planningComment || "")}</textarea>
        </label>
        <button class="step-primary-btn" type="submit">
          ${isRevision ? "Renvoyer la demande de planning →" : "Envoyer la demande de planning →"}
        </button>
      </form>

      ${cyclesLeft <= 1 ? `<div class="step-warning-box">⚠️ Dernier cycle planning disponible (3/3). Si le client demande encore une autre date, veuillez contacter le chef d'atelier directement.</div>` : ""}
    </div>
  `;
}

// ─── ÉTAPE 3 — PROPOSITION PLANNING ─────────────────────────────────────────

function renderStep3_PlanningReceived(item) {
  const rw = item.receptionWorkflow;
  const proposal = rw.planningProposal;
  return `
    <div class="step-card step-card-active">
      <div class="step-card-header">
        <span class="step-number-badge">3</span>
        <div>
          <h2 class="step-title">Proposition de planning reçue</h2>
          <p class="step-desc">Vérifiez la proposition de l'atelier et acceptez ou demandez une révision.</p>
        </div>
      </div>

      ${proposal ? `
        <div class="step-info-box">
          <div style="display:grid;gap:8px;">
            <div><strong>Date de début proposée :</strong> ${proposal.startDate ? formatDateTime(proposal.startDate) : "Non précisée"}</div>
            <div><strong>Date de livraison estimée :</strong> ${proposal.deliveryDate ? formatDateTime(proposal.deliveryDate) : "Non précisée"}</div>
            ${proposal.workshopNote ? `<div><strong>Remarques atelier :</strong> ${escapeHtml(proposal.workshopNote)}</div>` : ""}
          </div>
        </div>
      ` : `
        <div class="step-info-box step-info-pending">
          <span>⏳ En attente de la proposition planning de l'atelier (cycle ${rw.planningCycles}/3).</span>
        </div>
      `}

      <form id="reception-planning-receive-form" class="step-form" data-case-id="${item.id}">
        <div class="step-form-grid">
          <label class="step-field">
            <span>Date de début proposée</span>
            <input type="datetime-local" name="startDate" value="${proposal?.startDate ? proposal.startDate.substring(0, 16) : ""}" />
          </label>
          <label class="step-field">
            <span>Date de livraison estimée</span>
            <input type="datetime-local" name="deliveryDate" value="${proposal?.deliveryDate ? proposal.deliveryDate.substring(0, 16) : ""}" />
          </label>
        </div>
        <label class="step-field">
          <span>Remarques atelier</span>
          <textarea name="workshopNote" rows="2" placeholder="Capacité, ressources, remarques...">${escapeHtml(proposal?.workshopNote || "")}</textarea>
        </label>
        <div style="display:flex;gap:12px;flex-wrap:wrap;">
          <button class="step-primary-btn" type="submit" name="planningAction" value="accept" style="flex:2;">
            ✓ Accepter la proposition →
          </button>
          <button class="step-secondary-btn" type="submit" name="planningAction" value="revision" style="flex:1;" ${rw.planningCycles >= 3 ? "disabled" : ""}>
            Demander révision ${rw.planningCycles >= 3 ? "(max atteint)" : ""}
          </button>
        </div>
      </form>
    </div>
  `;
}

// ─── ÉTAPE 4 — CONTACT CLIENT ────────────────────────────────────────────────

function renderStep4_ContactClient(item) {
  const rw = item.receptionWorkflow;
  const proposal = rw.planningProposal;
  const history = rw.customerContactHistory || [];
  return `
    <div class="step-card step-card-active">
      <div class="step-card-header">
        <span class="step-number-badge">4</span>
        <div>
          <h2 class="step-title">Contacter le client</h2>
          <p class="step-desc">Informez le client de la date de début et de livraison prévue.</p>
        </div>
      </div>

      <div class="step-info-box">
        <a href="tel:${escapeAttr(item.phone)}" class="step-phone-link" style="font-size:1.3rem;font-weight:700;">📞 ${escapeHtml(item.phone || "Aucun numéro")}</a>
        ${proposal ? `
          <div style="margin-top:10px;font-size:0.9rem;">
            <strong>À communiquer :</strong> Début le ${proposal.startDate ? formatDateTime(proposal.startDate) : "?"}, livraison le ${proposal.deliveryDate ? formatDateTime(proposal.deliveryDate) : "?"}.
          </div>
        ` : ""}
      </div>

      <form id="reception-contact-customer-form" class="step-form" data-case-id="${item.id}">
        <div class="step-form-grid">
          <label class="step-field">
            <span>Résultat du contact</span>
            <select name="contactOutcome">
              <option value="contacted">Client contacté</option>
              <option value="unreachable">Client injoignable</option>
              <option value="pending">Reporter l'appel</option>
            </select>
          </label>
        </div>
        <label class="step-field">
          <span>Note d'appel</span>
          <textarea name="contactNote" rows="2" placeholder="Résumé de l'échange, message laissé..."></textarea>
        </label>
        <button class="step-primary-btn" type="submit">Enregistrer le contact →</button>
      </form>

      ${history.length > 0 ? `
        <div class="step-history">
          <div class="step-history-title">Historique des contacts</div>
          ${history.map((entry) => `
            <div class="step-history-item">
              <span class="tag">${entry.outcome === "unreachable" ? "Injoignable" : entry.outcome === "pending" ? "Reporté" : "Contacté"}</span>
              <span style="font-size:0.85rem;">${new Date(entry.at).toLocaleString("fr-FR")}</span>
              ${entry.note ? `<div style="margin-top:4px;">${escapeHtml(entry.note)}</div>` : ""}
            </div>
          `).join("")}
        </div>
      ` : ""}
    </div>
  `;
}

// ─── ÉTAPE 5 — RÉPONSE CLIENT ────────────────────────────────────────────────

function renderStep5_ClientResponse(item) {
  const rw = item.receptionWorkflow;
  const cyclesLeft = 3 - (rw.planningCycles || 0);
  return `
    <div class="step-card step-card-active">
      <div class="step-card-header">
        <span class="step-number-badge">5</span>
        <div>
          <h2 class="step-title">Réponse du client</h2>
          <p class="step-desc">Enregistrez la décision du client concernant le planning proposé.</p>
        </div>
      </div>

      <form id="reception-customer-decision-form" class="step-form" data-case-id="${item.id}">
        <div style="display:flex;flex-direction:column;gap:12px;">
          <button class="step-option-btn step-option-confirm" type="submit" name="decision" value="confirmed">
            ✓ Le client confirme le rendez-vous
          </button>
          <button class="step-option-btn step-option-warning" type="submit" name="decision" value="new_date" ${cyclesLeft <= 0 ? "disabled" : ""}>
            📅 Le client souhaite une autre date ${cyclesLeft <= 0 ? "(cycles épuisés — contacter chef atelier)" : `(${cyclesLeft} cycle${cyclesLeft > 1 ? "s" : ""} restant${cyclesLeft > 1 ? "s" : ""})`}
          </button>
          <button class="step-option-btn step-option-pending" type="submit" name="decision" value="pending">
            ⏳ En attente de retour client
          </button>
          <button class="step-option-btn step-option-danger" type="submit" name="decision" value="cancelled">
            ✗ Le client annule
          </button>
        </div>
        <label class="step-field" style="margin-top:16px;">
          <span>Nouvelle date souhaitée (si applicable)</span>
          <input type="datetime-local" name="newDate" />
        </label>
        <label class="step-field">
          <span>Note</span>
          <textarea name="decisionNote" rows="2" placeholder="Commentaire sur la décision du client..."></textarea>
        </label>
      </form>

      ${cyclesLeft <= 0 ? `<div class="step-warning-box">⚠️ Nombre maximum de cycles planning atteint (3/3). Pour une nouvelle révision, contactez directement le chef d'atelier.</div>` : ""}
    </div>
  `;
}

// ─── ÉTAPE 6 — CONFIRMATION RDV ──────────────────────────────────────────────

function renderStep6_ConfirmRDV(item) {
  const rw = item.receptionWorkflow;
  const proposal = rw.planningProposal;
  return `
    <div class="step-card step-card-active">
      <div class="step-card-header">
        <span class="step-number-badge">6</span>
        <div>
          <h2 class="step-title">Confirmation du rendez-vous</h2>
          <p class="step-desc">Formalisez le rendez-vous et enregistrez le mode de confirmation.</p>
        </div>
      </div>

      <div class="step-info-box">
        ${proposal ? `
          <div><strong>Début travaux :</strong> ${proposal.startDate ? formatDateTime(proposal.startDate) : "À préciser"}</div>
          <div><strong>Livraison estimée :</strong> ${proposal.deliveryDate ? formatDateTime(proposal.deliveryDate) : "À préciser"}</div>
        ` : "<em>Planification à préciser</em>"}
      </div>

      <form id="reception-confirm-rdv-form" class="step-form" data-case-id="${item.id}">
        <div class="step-form-grid">
          <label class="step-field">
            <span>Canal de confirmation</span>
            <select name="rdvChannel">
              <option value="phone">Téléphone</option>
              <option value="sms">SMS</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="email">Email</option>
              <option value="other">Autre</option>
            </select>
          </label>
          <label class="step-field" style="display:flex;align-items:center;gap:8px;padding-top:22px;">
            <input type="checkbox" name="reminderSent" id="rdv-reminder-sent" style="width:20px;height:20px;" />
            <label for="rdv-reminder-sent">Rappel envoyé au client</label>
          </label>
        </div>
        <label class="step-field">
          <span>Note de confirmation</span>
          <textarea name="rdvNote" rows="2" placeholder="Ex: Rappelé le matin, confirmé par SMS..."></textarea>
        </label>
        <button class="step-primary-btn" type="submit">✓ Confirmer le rendez-vous →</button>
      </form>
    </div>
  `;
}

// ─── ÉTAPE 7 — RÉCEPTION DU VÉHICULE ────────────────────────────────────────

function renderStep7_VehicleReceived(item) {
  const rw = item.receptionWorkflow;
  return `
    <div class="step-card step-card-active">
      <div class="step-card-header">
        <span class="step-number-badge">7</span>
        <div>
          <h2 class="step-title">Réception physique du véhicule</h2>
          <p class="step-desc">Constatez l'arrivée du véhicule et enregistrez son état à l'entrée.</p>
        </div>
      </div>

      <form id="reception-vehicle-received-form" class="step-form" data-case-id="${item.id}">
        <div class="step-form-grid">
          <label class="step-field">
            <span>Kilométrage à l'entrée</span>
            <input type="text" name="mileage" value="${escapeAttr(rw.vehicleMileageEntry || item.mileage || "")}" placeholder="Ex: 45 000 km" />
          </label>
          <label class="step-field">
            <span>Accessoires laissés</span>
            <input type="text" name="accessories" value="${escapeAttr(rw.vehicleAccessories || "")}" placeholder="Ex: Carte grise, spare, câble..." />
          </label>
          <label class="step-field">
            <span>Documents reçus</span>
            <input type="text" name="documents" value="${escapeAttr(rw.vehicleDocuments || "")}" placeholder="Ex: Carnet, facture assurance..." />
          </label>
        </div>
        <label class="step-field">
          <span>État visuel et observations</span>
          <textarea name="conditionNote" rows="3" placeholder="Rayures, bosses, niveau carburant, propreté...">${escapeHtml(rw.vehicleConditionNote || "")}</textarea>
        </label>
        <button class="step-primary-btn" type="submit">✓ Véhicule réceptionné →</button>
      </form>
    </div>
  `;
}

// ─── ÉTAPE 8 — ENVOI ATELIER ─────────────────────────────────────────────────

function renderStep8_SendToWorkshop(item) {
  const rw = item.receptionWorkflow;
  const openClaims = (item.customerClaims || []).filter((c) => ["open", "in_progress"].includes(c.status));
  return `
    <div class="step-card step-card-active">
      <div class="step-card-header">
        <span class="step-number-badge">8</span>
        <div>
          <h2 class="step-title">Envoyer le véhicule à l'atelier</h2>
          <p class="step-desc">Transmettez officiellement le dossier à l'équipe atelier.</p>
        </div>
      </div>

      <div class="step-info-box">
        <div><strong>Client :</strong> ${escapeHtml(item.clientName)}</div>
        <div><strong>Véhicule :</strong> ${escapeHtml(item.vehicle || "—")} ${escapeHtml(item.plate ? `(${item.plate})` : "")}</div>
        <div><strong>Ordres de réparation :</strong> ${(item.claims || []).map((c) => escapeHtml(c.title || c.number)).join(", ") || "Aucun"}</div>
        ${openClaims.length > 0 ? `<div style="margin-top:8px;"><strong>Réclamations client à traiter :</strong><ul style="margin:4px 0 0 16px;">${openClaims.map((c) => `<li>${escapeHtml(c.text || c.title)}</li>`).join("")}</ul></div>` : ""}
        ${rw.vehicleConditionNote ? `<div style="margin-top:8px;"><strong>État à l'entrée :</strong> ${escapeHtml(rw.vehicleConditionNote)}</div>` : ""}
      </div>

      <form id="reception-send-workshop-form" class="step-form" data-case-id="${item.id}">
        <label class="step-field">
          <span>Remarques pour l'atelier</span>
          <textarea name="workshopNote" rows="3" placeholder="Instructions spéciales, priorités, précautions..."></textarea>
        </label>
        <button class="step-primary-btn" type="submit">Envoyer à l'atelier →</button>
      </form>
    </div>
  `;
}

// ─── ÉTAPE 9 — SUIVI DES TRAVAUX ────────────────────────────────────────────

function renderStep9_TrackVehicle(item) {
  const rw = item.receptionWorkflow;
  const f = item.flags;
  const openClaims = (item.customerClaims || []).filter((c) => ["open", "in_progress", "unresolved"].includes(c.status));

  let globalStatus = "En cours";
  let statusClass = "tag-info";
  if (isCaseBlocked(item)) { globalStatus = "Bloqué"; statusClass = "priority-urgent"; }
  else if (f.workCompleted) { globalStatus = "Terminé"; statusClass = "priority-low"; }

  return `
    <div class="step-card step-card-active">
      <div class="step-card-header">
        <span class="step-number-badge">9</span>
        <div>
          <h2 class="step-title">Suivi de l'état du véhicule</h2>
          <p class="step-desc">Vue simplifiée de l'avancement des travaux.</p>
        </div>
      </div>

      <div class="step-info-box">
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
          <span class="tag ${statusClass}" style="font-size:1rem;padding:6px 14px;">${globalStatus}</span>
          ${item.appointment?.delivery ? `<span style="font-size:0.9rem;">Livraison estimée : <strong>${formatDateTime(item.appointment.delivery)}</strong></span>` : ""}
        </div>
        ${isCaseBlocked(item) ? `<div style="margin-top:10px;color:var(--red,#e74c3c);"><strong>Blocage :</strong> ${escapeHtml(getCaseBlockerLabel(item))}</div>` : ""}
        ${openClaims.length > 0 ? `<div style="margin-top:10px;"><strong>Réclamations en attente :</strong> ${openClaims.length}</div>` : ""}
      </div>

      <form id="reception-followup-form" class="step-form" data-case-id="${item.id}">
        <label class="step-field">
          <span>Note de suivi</span>
          <textarea name="followupText" rows="2" placeholder="Mise à jour, appel atelier, info client..."></textarea>
        </label>
        <button class="step-primary-btn" type="submit">Ajouter note de suivi</button>
      </form>

      ${rw.followupNotes && rw.followupNotes.length > 0 ? `
        <div class="step-history" style="margin-top:16px;">
          <div class="step-history-title">Notes de suivi</div>
          ${rw.followupNotes.slice().reverse().map((n) => `
            <div class="step-history-item">
              <span style="font-size:0.8rem;color:var(--muted);">${new Date(n.at).toLocaleString("fr-FR")}</span>
              <div>${escapeHtml(n.text)}</div>
            </div>
          `).join("")}
        </div>
      ` : ""}

      ${f.workCompleted ? `
        <div style="margin-top:16px;padding:12px;background:var(--green-bg,#eaffea);border-radius:var(--radius-sm);border:1px solid var(--green,#27ae60);">
          <strong>✓ Travaux terminés.</strong> Passez à l'étape Contrôle Qualité.
        </div>
      ` : ""}
    </div>
  `;
}

// ─── ÉTAPE 10 — CONTRÔLE QUALITÉ ────────────────────────────────────────────

function renderStep10_QualityCheck(item) {
  const rw = item.receptionWorkflow;
  const f = item.flags;
  const openClaims = (item.customerClaims || []).filter((c) => ["open", "in_progress", "unresolved"].includes(c.status));
  const qsLabels = { not_started: "Non commencé", in_progress: "En cours", validated: "Validé ✓", rejected: "Refusé / Reprise nécessaire" };
  const qsClass = { not_started: "", in_progress: "tag-info", validated: "priority-low", rejected: "priority-urgent" };

  return `
    <div class="step-card step-card-active">
      <div class="step-card-header">
        <span class="step-number-badge">10</span>
        <div>
          <h2 class="step-title">Suivi du contrôle qualité</h2>
          <p class="step-desc">Vérifiez que le véhicule est prêt pour la livraison.</p>
        </div>
      </div>

      <div class="step-info-box">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
          <span>Statut QC :</span>
          <span class="tag ${qsClass[rw.qualityStatus] || ""}" style="font-size:1rem;padding:6px 14px;">${qsLabels[rw.qualityStatus] || rw.qualityStatus}</span>
        </div>
        ${openClaims.length > 0 ? `
          <div style="margin-top:10px;padding:8px;background:rgba(231,76,60,0.08);border-radius:6px;border:1px solid rgba(231,76,60,0.3);">
            <strong>⚠️ ${openClaims.length} réclamation(s) client non résolue(s) :</strong>
            <ul style="margin:6px 0 0 16px;">${openClaims.map((c) => `<li>${escapeHtml(c.text || c.title)} <span class="tag priority-${c.priority}">${c.priority}</span></li>`).join("")}</ul>
          </div>
        ` : `<div style="margin-top:8px;color:var(--green,#27ae60);">✓ Aucune réclamation client en attente.</div>`}
      </div>

      <form id="reception-quality-form" class="step-form" data-case-id="${item.id}">
        <label class="step-field">
          <span>Mettre à jour le statut qualité</span>
          <select name="qualityStatus">
            <option value="not_started" ${rw.qualityStatus === "not_started" ? "selected" : ""}>Non commencé</option>
            <option value="in_progress" ${rw.qualityStatus === "in_progress" ? "selected" : ""}>En cours</option>
            <option value="validated" ${rw.qualityStatus === "validated" ? "selected" : ""}>Validé — prêt pour livraison</option>
            <option value="rejected" ${rw.qualityStatus === "rejected" ? "selected" : ""}>Refusé — reprise nécessaire</option>
          </select>
        </label>
        <label class="step-field">
          <span>Motif (si refus ou reprise)</span>
          <textarea name="qualityReason" rows="2" placeholder="Détails de la non-conformité...">${escapeHtml(rw.qualityReturnReason || "")}</textarea>
        </label>
        <button class="step-primary-btn" type="submit">Mettre à jour le contrôle qualité</button>
      </form>

      ${rw.qualityStatus === "validated" ? `
        <div style="margin-top:16px;padding:12px;background:var(--green-bg,#eaffea);border-radius:var(--radius-sm);border:1px solid var(--green,#27ae60);">
          <strong>✓ Contrôle qualité validé.</strong> Vous pouvez préparer la livraison.
        </div>
      ` : ""}

      ${renderCustomerClaimsBlock(item)}
    </div>
  `;
}

// ─── ÉTAPE 11 — LIVRAISON ────────────────────────────────────────────────────

function renderStep11_Delivery(item) {
  const rw = item.receptionWorkflow;
  const f = item.flags;
  const openClaims = (item.customerClaims || []).filter((c) => ["open", "in_progress", "unresolved"].includes(c.status));
  const hasDeliveryBlock = openClaims.length > 0;
  const isDelivered = f.delivered;

  return `
    <div class="step-card step-card-active">
      <div class="step-card-header">
        <span class="step-number-badge">11</span>
        <div>
          <h2 class="step-title">${isDelivered ? "Véhicule livré ✓" : "Livraison du véhicule"}</h2>
          <p class="step-desc">${isDelivered ? `Livré le ${formatDateTime(rw.deliveredAt)}.` : "Remettez le véhicule au client après vérification complète."}</p>
        </div>
      </div>

      ${hasDeliveryBlock && !isDelivered ? `
        <div class="step-warning-box" style="background:rgba(231,76,60,0.08);border-color:rgba(231,76,60,0.4);">
          <strong>⚠️ Livraison bloquée :</strong> ${openClaims.length} réclamation(s) client non résolue(s). Seul un administrateur ou chef d'atelier peut forcer la livraison.
          <ul style="margin:6px 0 0 16px;">${openClaims.map((c) => `<li>${escapeHtml(c.text || c.title)}</li>`).join("")}</ul>
        </div>
      ` : ""}

      <div class="step-info-box">
        <div><strong>Client :</strong> ${escapeHtml(item.clientName)}</div>
        <div><strong>Véhicule :</strong> ${escapeHtml(item.vehicle || "—")} ${escapeHtml(item.plate ? `(${item.plate})` : "")}</div>
        <div><strong>Réclamations :</strong> ${(item.customerClaims || []).length > 0 ? (item.customerClaims || []).map((c) => `<span class="tag priority-${c.priority}">${escapeHtml(c.text || c.title)} — ${c.status}</span>`).join(" ") : "Aucune"}</div>
        <div style="margin-top:8px;">
          <strong>Fiche imprimée :</strong> ${rw.deliverySheetPrintedAt ? `✓ le ${new Date(rw.deliverySheetPrintedAt).toLocaleString("fr-FR")}` : "Non encore imprimée"}
        </div>
        <div><strong>Fiche signée :</strong> ${rw.deliverySheetSignedByClient ? `✓ (${escapeHtml(rw.deliverySheetClientName || item.clientName)})` : "Non encore signée"}</div>
      </div>

      ${!isDelivered ? `
        <div class="step-form" style="display:flex;flex-direction:column;gap:12px;">
          <button class="step-primary-btn" type="button" id="btn-print-delivery-sheet" data-case-id="${item.id}">
            🖨 Imprimer la fiche de livraison
          </button>

          <form id="reception-mark-signed-form" class="step-form" data-case-id="${item.id}" style="gap:8px;">
            <label style="display:flex;align-items:center;gap:10px;cursor:pointer;">
              <input type="checkbox" name="sheetSigned" id="sheet-signed-check" style="width:22px;height:22px;" ${rw.deliverySheetSignedByClient ? "checked" : ""} />
              <span style="font-size:1rem;font-weight:600;">Fiche de livraison remise et signée par le client</span>
            </label>
            <label class="step-field">
              <span>Nom du signataire</span>
              <input type="text" name="clientSignatureName" value="${escapeAttr(rw.deliverySheetClientName || item.clientName)}" placeholder="Nom du client ou représentant" />
            </label>
            <button class="step-secondary-btn" type="submit" style="width:100%;">Confirmer la signature</button>
          </form>

          <button class="step-primary-btn step-deliver-btn" type="button" id="btn-deliver-vehicle" data-case-id="${item.id}" ${hasDeliveryBlock ? "style='background:var(--red-muted,#e74c3c);'" : ""}>
            ✓ Livrer le véhicule
          </button>
        </div>
      ` : `
        <div style="padding:20px;text-align:center;background:var(--green-bg,#eaffea);border-radius:var(--radius);border:1px solid var(--green,#27ae60);">
          <div style="font-size:3rem;">✓</div>
          <h3>Véhicule livré avec succès</h3>
          <p>Livré le ${formatDateTime(rw.deliveredAt)}</p>
          <button class="step-secondary-btn" type="button" id="btn-print-delivery-sheet" data-case-id="${item.id}" style="margin-top:12px;">
            🖨 Réimprimer la fiche de livraison
          </button>
        </div>
      `}

      ${renderCustomerClaimsBlock(item)}
    </div>
  `;
}

// ─── BLOC RÉCLAMATIONS CLIENT ────────────────────────────────────────────────

function renderCustomerClaimsBlock(item) {
  if (!item) return "";
  const priorityLabels = { low: "Faible", normal: "Normale", high: "Haute", urgent: "Urgente" };
  const statusLabelsMap = { open: "Ouverte", in_progress: "En cours", resolved: "Résolue ✓", unresolved: "Non résolue", explained_to_customer: "Expliquée au client" };
  const typeLabels = { claim: "Réclamation", request: "Demande" };

  return `
    <div class="claims-block" style="margin-top:24px;border-top:1px solid var(--line);padding-top:20px;">
      <h3 style="margin-top:0;">Réclamations et demandes client</h3>

      <form id="reception-add-claim-form" data-case-id="${item.id}" style="margin-bottom:18px;">
        <div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;">
          <label style="flex:0 0 110px;margin:0;">
            <span style="font-size:0.85rem;">Type</span>
            <select name="claimType" style="height:38px;width:100%;padding:4px 8px;">
              <option value="claim">Réclamation</option>
              <option value="request">Demande</option>
            </select>
          </label>
          <label style="flex:1;min-width:180px;margin:0;">
            <span style="font-size:0.85rem;">Description *</span>
            <input type="text" name="claimText" placeholder="Saisir la réclamation ou demande..." required style="width:100%;height:38px;box-sizing:border-box;" />
          </label>
          <label style="flex:0 0 110px;margin:0;">
            <span style="font-size:0.85rem;">Priorité</span>
            <select name="claimPriority" style="height:38px;width:100%;padding:4px 8px;">
              <option value="low">Faible</option>
              <option value="normal" selected>Normale</option>
              <option value="high">Haute</option>
              <option value="urgent">Urgente</option>
            </select>
          </label>
          <button class="primary-button" type="submit" style="height:38px;min-height:38px;padding:0 16px;margin:0;align-self:flex-end;">Ajouter</button>
        </div>
      </form>

      <div id="reception-claims-list">
        ${(item.customerClaims || []).length === 0 ? `<div class="empty-inline">Aucune réclamation ou demande enregistrée.</div>` : (item.customerClaims || []).map((claim) => `
          <div class="claim-card" data-claim-id="${claim.id}">
            <div class="claim-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
              <span class="tag" style="font-size:0.8rem;background:var(--brand-muted,#e8f4fb);color:var(--brand);">${typeLabels[claim.type] || "Réclamation"}</span>
              <span class="tag priority-${claim.priority}">${priorityLabels[claim.priority] || claim.priority}</span>
              <span style="font-size:0.78rem;color:var(--muted);">Le ${new Date(claim.createdAt).toLocaleDateString("fr-FR")}</span>
            </div>
            <div style="margin-top:8px;font-weight:600;font-size:1rem;">${escapeHtml(claim.text || claim.title)}</div>
            ${claim.description ? `<div style="font-size:0.9rem;color:var(--muted);margin-top:4px;">${escapeHtml(claim.description)}</div>` : ""}
            <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;gap:12px;flex-wrap:wrap;border-bottom:1px dashed var(--line);padding-bottom:10px;">
              <label style="display:flex;align-items:center;gap:8px;margin:0;">
                <span style="font-size:0.85rem;font-weight:600;">Statut :</span>
                <select class="claim-status-select" data-claim-id="${claim.id}" data-case-id="${item.id}" style="padding:6px 10px;border-radius:var(--radius-sm);border:1px solid var(--line);font-weight:500;">
                  <option value="open" ${claim.status === "open" ? "selected" : ""}>Ouverte</option>
                  <option value="in_progress" ${claim.status === "in_progress" ? "selected" : ""}>En cours</option>
                  <option value="resolved" ${claim.status === "resolved" ? "selected" : ""}>Résolue</option>
                  <option value="unresolved" ${claim.status === "unresolved" ? "selected" : ""}>Non résolue</option>
                  <option value="explained_to_customer" ${claim.status === "explained_to_customer" ? "selected" : ""}>Expliquée au client</option>
                </select>
              </label>
              <button class="touch-action-btn ghost-button explain-claim-btn" data-claim-id="${claim.id}" data-case-id="${item.id}" type="button" style="height:34px;min-height:34px;padding:0 12px;font-size:0.85rem;border-radius:var(--radius-sm);">
                Expliquer au client
              </button>
            </div>
            <div class="claim-comments" style="margin-top:12px;">
              <div style="font-weight:600;margin-bottom:6px;font-size:0.9rem;">Suivi :</div>
              ${(claim.comments || []).map((comment) => `
                <div style="border-left:2px solid var(--brand);padding-left:8px;margin-bottom:8px;">
                  <div style="font-size:0.9rem;">${escapeHtml(comment.text)}</div>
                  <div style="color:var(--muted);font-size:0.75rem;margin-top:2px;">Par ${escapeHtml(comment.createdBy || "Anonyme")} le ${new Date(comment.createdAt).toLocaleString("fr-FR")}</div>
                </div>
              `).join("")}
              <form class="claim-add-comment-form" data-claim-id="${claim.id}" data-case-id="${item.id}" style="margin-top:8px;display:flex;gap:6px;">
                <input type="text" placeholder="Ajouter un commentaire..." required style="flex:1;padding:6px 10px;border:1px solid var(--line);border-radius:var(--radius-sm);font-size:0.85rem;" />
                <button class="primary-button" type="submit" style="padding:6px 12px;font-size:0.85rem;height:34px;min-height:34px;border-radius:var(--radius-sm);">Répondre</button>
              </form>
            </div>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

// ─── GESTIONNAIRES D'ÉVÉNEMENTS ──────────────────────────────────────────────

async function handleReceptionFormSubmit(e) {
  const form = e.target;

  // Création dossier
  if (form.id === "reception-case-create-form") {
    e.preventDefault();
    await handleCreateCase(form);
    return;
  }

  // Modification dossier (étape 1)
  if (form.id === "reception-case-detail-form") {
    e.preventDefault();
    await handleEditCase(form);
    return;
  }

  // Étape 2 — demande planning
  if (form.id === "reception-planning-request-form") {
    e.preventDefault();
    const caseId = form.dataset.caseId;
    const comment = form.querySelector("[name=planningComment]")?.value || "";
    const result = advanceReceptionWorkflow(caseId, "request_planning", { comment });
    if (result.ok) { saveState({ flushCloud: true, cloudReason: "reception-planning-request" }); notifyUser("Demande de planning envoyée.", "success"); renderReceptionWorkspace(); }
    else notifyUser(result.message, "error");
    return;
  }

  // Étape 3 — réception/acceptation planning
  if (form.id === "reception-planning-receive-form") {
    e.preventDefault();
    const caseId = form.dataset.caseId;
    const action = e.submitter?.value === "revision" ? "request_planning_revision" : "receive_planning";
    const startDate = form.querySelector("[name=startDate]")?.value || "";
    const deliveryDate = form.querySelector("[name=deliveryDate]")?.value || "";
    const workshopNote = form.querySelector("[name=workshopNote]")?.value || "";

    if (action === "receive_planning") {
      const r1 = advanceReceptionWorkflow(caseId, "receive_planning", { startDate, deliveryDate, workshopNote });
      if (!r1.ok) { notifyUser(r1.message, "error"); return; }
      const r2 = advanceReceptionWorkflow(caseId, "accept_planning");
      if (r2.ok) { saveState({ flushCloud: true, cloudReason: "reception-planning-accepted" }); notifyUser("Proposition planning acceptée.", "success"); renderReceptionWorkspace(); }
      else notifyUser(r2.message, "error");
    } else {
      const result = advanceReceptionWorkflow(caseId, "request_planning_revision", {});
      if (result.ok) { saveState({ flushCloud: true, cloudReason: "reception-planning-revision" }); notifyUser("Révision demandée. Retour à l'étape 2.", "info"); renderReceptionWorkspace(); }
      else notifyUser(result.message, "error");
    }
    return;
  }

  // Étape 4 — contact client
  if (form.id === "reception-contact-customer-form") {
    e.preventDefault();
    const caseId = form.dataset.caseId;
    const outcome = form.querySelector("[name=contactOutcome]")?.value || "contacted";
    const note = form.querySelector("[name=contactNote]")?.value || "";
    const result = advanceReceptionWorkflow(caseId, "contact_customer", { outcome, note });
    if (result.ok) { saveState({ flushCloud: true, cloudReason: "reception-contact-customer" }); notifyUser("Contact client enregistré.", "success"); renderReceptionWorkspace(); }
    else notifyUser(result.message, "error");
    return;
  }

  // Étape 5 — décision client
  if (form.id === "reception-customer-decision-form") {
    e.preventDefault();
    const caseId = form.dataset.caseId;
    const decision = e.submitter?.value || "pending";
    const newDate = form.querySelector("[name=newDate]")?.value || "";
    const note = form.querySelector("[name=decisionNote]")?.value || "";
    const result = advanceReceptionWorkflow(caseId, "set_customer_decision", { decision, newDate, note });
    if (result.ok) { saveState({ flushCloud: true, cloudReason: "reception-customer-decision" }); notifyUser(`Décision client enregistrée : ${decision}.`, "success"); renderReceptionWorkspace(); }
    else notifyUser(result.message, "error");
    return;
  }

  // Étape 6 — confirmation RDV
  if (form.id === "reception-confirm-rdv-form") {
    e.preventDefault();
    const caseId = form.dataset.caseId;
    const channel = form.querySelector("[name=rdvChannel]")?.value || "phone";
    const reminderSent = form.querySelector("[name=reminderSent]")?.checked || false;
    const note = form.querySelector("[name=rdvNote]")?.value || "";
    const result = advanceReceptionWorkflow(caseId, "confirm_rdv", { channel, reminderSent, note });
    if (result.ok) { saveState({ flushCloud: true, cloudReason: "reception-confirm-rdv" }); notifyUser("Rendez-vous confirmé.", "success"); renderReceptionWorkspace(); }
    else notifyUser(result.message, "error");
    return;
  }

  // Étape 7 — réception véhicule
  if (form.id === "reception-vehicle-received-form") {
    e.preventDefault();
    const caseId = form.dataset.caseId;
    const mileage = form.querySelector("[name=mileage]")?.value || "";
    const accessories = form.querySelector("[name=accessories]")?.value || "";
    const documents = form.querySelector("[name=documents]")?.value || "";
    const conditionNote = form.querySelector("[name=conditionNote]")?.value || "";
    const result = advanceReceptionWorkflow(caseId, "receive_vehicle", { mileage, accessories, documents, conditionNote });
    if (result.ok) { saveState({ flushCloud: true, cloudReason: "reception-vehicle-received" }); notifyUser("Véhicule réceptionné.", "success"); renderReceptionWorkspace(); if (typeof renderCases === "function") renderCases(); }
    else notifyUser(result.message, "error");
    return;
  }

  // Étape 8 — envoi atelier
  if (form.id === "reception-send-workshop-form") {
    e.preventDefault();
    const caseId = form.dataset.caseId;
    const note = form.querySelector("[name=workshopNote]")?.value || "";
    const result = advanceReceptionWorkflow(caseId, "send_to_workshop", { note });
    if (result.ok) { saveState({ flushCloud: true, cloudReason: "reception-send-workshop" }); notifyUser("Dossier envoyé en atelier.", "success"); renderReceptionWorkspace(); if (typeof renderCases === "function") renderCases(); }
    else notifyUser(result.message, "error");
    return;
  }

  // Étape 9 — note de suivi
  if (form.id === "reception-followup-form") {
    e.preventDefault();
    const caseId = form.dataset.caseId;
    const text = form.querySelector("[name=followupText]")?.value || "";
    const result = advanceReceptionWorkflow(caseId, "add_followup_note", { text });
    if (result.ok) { form.querySelector("[name=followupText]").value = ""; saveState({ flushCloud: true, cloudReason: "reception-followup" }); notifyUser("Note de suivi ajoutée.", "success"); renderReceptionWorkspace(); }
    else notifyUser(result.message, "error");
    return;
  }

  // Étape 10 — statut qualité
  if (form.id === "reception-quality-form") {
    e.preventDefault();
    const caseId = form.dataset.caseId;
    const status = form.querySelector("[name=qualityStatus]")?.value || "not_started";
    const reason = form.querySelector("[name=qualityReason]")?.value || "";
    const result = advanceReceptionWorkflow(caseId, "update_quality_status", { status, reason });
    if (result.ok) { saveState({ flushCloud: true, cloudReason: "reception-quality-update" }); notifyUser("Statut qualité mis à jour.", "success"); renderReceptionWorkspace(); if (typeof renderCases === "function") renderCases(); }
    else notifyUser(result.message, "error");
    return;
  }

  // Étape 11 — marquer fiche signée
  if (form.id === "reception-mark-signed-form") {
    e.preventDefault();
    const caseId = form.dataset.caseId;
    const clientName = form.querySelector("[name=clientSignatureName]")?.value || "";
    const result = advanceReceptionWorkflow(caseId, "mark_sheet_signed", { clientName });
    if (result.ok) { saveState({ flushCloud: true, cloudReason: "reception-sheet-signed" }); notifyUser("Signature enregistrée.", "success"); renderReceptionWorkspace(); }
    else notifyUser(result.message, "error");
    return;
  }

  // Ajout réclamation client
  if (form.id === "reception-add-claim-form") {
    e.preventDefault();
    const caseId = form.dataset.caseId;
    const text = form.querySelector("[name=claimText]")?.value?.trim() || "";
    const priority = form.querySelector("[name=claimPriority]")?.value || "normal";
    const type = form.querySelector("[name=claimType]")?.value || "claim";
    if (!text) return;
    handleAddCustomerClaim(caseId, text, priority, type);
    form.querySelector("[name=claimText]").value = "";
    return;
  }

  // Ajout commentaire sur réclamation
  if (form.classList.contains("claim-add-comment-form")) {
    e.preventDefault();
    const claimId = form.dataset.claimId;
    const caseId = form.dataset.caseId;
    const input = form.querySelector("input");
    const text = String(input?.value || "").trim();
    if (!claimId || !text) return;
    handleAddClaimComment(caseId, claimId, text);
    if (input) input.value = "";
    return;
  }
}

async function handleReceptionClick(e) {
  // Bouton expliquer au client
  const explainBtn = e.target.closest(".explain-claim-btn");
  if (explainBtn) {
    const claimId = explainBtn.dataset.claimId;
    const caseId = explainBtn.dataset.caseId || activeCaseId;
    if (claimId) handleExplainClaim(caseId, claimId);
    return;
  }

  // Bouton imprimer fiche livraison
  const printBtn = e.target.closest("#btn-print-delivery-sheet");
  if (printBtn) {
    const caseId = printBtn.dataset.caseId;
    const item = state.cases.find((c) => c.id === caseId);
    if (item) {
      printDeliverySheet(item);
      advanceReceptionWorkflow(caseId, "mark_delivery_sheet_printed");
      saveState({ flushCloud: true, cloudReason: "delivery-sheet-printed" });
      renderReceptionWorkspace();
    }
    return;
  }

  // Bouton livrer véhicule
  const deliverBtn = e.target.closest("#btn-deliver-vehicle");
  if (deliverBtn) {
    const caseId = deliverBtn.dataset.caseId;
    const item = state.cases.find((c) => c.id === caseId);
    if (item) await handleDeliveryAction(item);
    return;
  }
}

function handleReceptionChange(e) {
  const select = e.target.closest(".claim-status-select");
  if (select) {
    const claimId = select.dataset.claimId;
    const caseId = select.dataset.caseId || activeCaseId;
    const newStatus = select.value;
    if (claimId && newStatus) handleClaimStatusChange(caseId, claimId, newStatus);
  }
}

// ─── CRÉATION / MODIFICATION DOSSIER ────────────────────────────────────────

async function handleCreateCase(form) {
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

  if (!candidate.clientName) { notifyUser("Le nom du client est obligatoire.", "error"); return; }
  if (!candidate.vehicle && !candidate.plate && !candidate.vin) { notifyUser("Renseignez au moins le véhicule, l'immatriculation ou le VIN.", "error"); return; }

  const duplicate = findDuplicateCase(candidate);
  if (duplicate) {
    const isStrict = duplicate.clientName === candidate.clientName && (duplicate.plate === candidate.plate || duplicate.vin === candidate.vin) && !duplicate.flags?.delivered;
    if (isStrict) { notifyUser("Un dossier strictement identique et non livré existe déjà.", "error"); return; }
    const confirmed = await showConfirmModal(`Un dossier similaire existe déjà pour ${duplicate.clientName}. Créer quand même ?`);
    if (!confirmed) { activeCaseId = duplicate.id; isReceptionCreationMode = false; renderReceptionWorkspace(); return; }
  }

  const item = normalizeCase({ ...candidate, id: uid("case"), createdAt: new Date().toISOString(), durations: Object.fromEntries(DURATIONS.map(([k]) => [k, 0])), history: [makeHistoryEntry("case.created", "Dossier créé", new Date().toISOString())] });
  const firstClaim = normalizeRepairClaim({ id: uid("claim"), number: "OT-001", title: orderTitle, type: orderType, status: isClientOnlyRepairClaim({ type: orderType }) ? "client_pending" : "expert_pending", includeInPlanning: true, expertApproved: isClientOnlyRepairClaim({ type: orderType }), clientApproved: false, orNumber: item.orNavNumber || "" }, 0);
  item.claims = [firstClaim];
  addHistory(item, "claim.created", "Premier ordre de réparation créé", getClaimLabel(firstClaim));

  const appDateVal = data.get("appointmentDate");
  if (appDateVal) {
    const dateISO = new Date(appDateVal).toISOString();
    item.appointment = { start: dateISO, end: dateISO, delivery: dateISO, marginMinutes: 0 };
    item.appointmentStatus = "scheduled";
  }

  state.cases.unshift(item);
  activeCaseId = item.id;
  isReceptionCreationMode = false;

  addAuditLog("reception.case_created", "Dossier créé", `Dossier créé depuis l'espace réception pour ${item.clientName}`, { caseId: item.id });
  saveState({ flushCloud: true, cloudReason: "reception-case-create" });
  notifyUser("Dossier créé avec succès.", "success");
  renderReceptionWorkspace();
  if (typeof renderCases === "function") renderCases();
}

async function handleEditCase(form) {
  const item = state.cases.find((c) => c.id === activeCaseId);
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
  if (!candidate.clientName) { notifyUser("Le nom du client est obligatoire.", "error"); return; }
  Object.assign(item, candidate);

  const appDateVal = data.get("appointmentDate");
  if (appDateVal) {
    const dateISO = new Date(appDateVal).toISOString();
    if (!item.appointment) { item.appointment = { start: dateISO, end: dateISO, delivery: dateISO, marginMinutes: 0 }; }
    else { item.appointment.start = dateISO; if (!item.appointment.end) item.appointment.end = dateISO; if (!item.appointment.delivery) item.appointment.delivery = dateISO; }
    item.appointmentStatus = "scheduled";
  } else { item.appointment = null; item.appointmentStatus = "none"; }

  const orderTypeVal = data.get("orderType");
  if (orderTypeVal && item.claims && item.claims.length > 0) {
    item.claims[0].type = orderTypeVal;
    if (isClientOnlyRepairClaim(item.claims[0])) item.claims[0].expertApproved = true;
    item.claims[0].updatedAt = new Date().toISOString();
  }

  addAuditLog("case.edit", "Dossier modifié", "Dossier modifié depuis l'espace réception", { caseId: item.id });
  saveState({ flushCloud: true, cloudReason: "reception-case-edit" });
  notifyUser("Dossier mis à jour.", "success");
  renderReceptionWorkspace();
  if (typeof renderCases === "function") renderCases();
}

// ─── FICHE DE LIVRAISON IMPRIMABLE ───────────────────────────────────────────

function printDeliverySheet(item) {
  const rw = item.receptionWorkflow || {};
  const proposal = rw.planningProposal;
  const priorityLabels = { low: "Faible", normal: "Normale", high: "Haute", urgent: "Urgente" };
  const statusLabelsMap = { open: "Ouverte ⚠️", in_progress: "En cours", resolved: "Résolue ✓", unresolved: "Non résolue ✗", explained_to_customer: "Expliquée au client ✓" };

  const claimsRows = (item.customerClaims || []).map((c) => `
    <tr>
      <td style="padding:6px 8px;border:1px solid #ccc;">${escapeHtml(c.text || c.title)}</td>
      <td style="padding:6px 8px;border:1px solid #ccc;text-align:center;">${priorityLabels[c.priority] || c.priority}</td>
      <td style="padding:6px 8px;border:1px solid #ccc;text-align:center;">${statusLabelsMap[c.status] || c.status}</td>
    </tr>
  `).join("");

  const repairRows = (item.claims || []).map((c) => `
    <tr>
      <td style="padding:6px 8px;border:1px solid #ccc;">${escapeHtml(c.number || "")}</td>
      <td style="padding:6px 8px;border:1px solid #ccc;">${escapeHtml(c.title || "")}</td>
      <td style="padding:6px 8px;border:1px solid #ccc;text-align:center;">${c.type || ""}</td>
    </tr>
  `).join("");

  const checklistObj = item.qualityChecklist || {};
  const qcChecklist = Object.entries(checklistObj).map(([label, checked]) => `
    <tr>
      <td style="padding:6px 8px;border:1px solid #ccc;">${escapeHtml(label)}</td>
      <td style="padding:6px 8px;border:1px solid #ccc;text-align:center;">${checked ? "✓" : "—"}</td>
      <td style="padding:6px 8px;border:1px solid #ccc;">—</td>
    </tr>
  `).join("");

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <title>Fiche de livraison — ${escapeHtml(item.clientName)} — ${escapeHtml(item.plate || item.vin || "")}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; font-size: 12px; color: #222; padding: 20px; }
    h1 { font-size: 20px; text-align: center; margin-bottom: 4px; }
    h2 { font-size: 14px; margin: 16px 0 6px; border-bottom: 1px solid #ccc; padding-bottom: 4px; }
    .header-box { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; gap: 20px; }
    .workshop-name { font-size: 16px; font-weight: bold; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
    th { background: #f0f0f0; padding: 6px 8px; border: 1px solid #ccc; text-align: left; }
    .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 12px; }
    .info-cell { padding: 6px 8px; border: 1px solid #ccc; border-radius: 4px; }
    .info-label { font-size: 10px; color: #666; margin-bottom: 2px; }
    .info-value { font-weight: bold; }
    .signature-section { display: flex; gap: 40px; margin-top: 30px; }
    .signature-box { flex: 1; border: 1px solid #ccc; border-radius: 4px; padding: 12px; min-height: 80px; }
    .signature-box-title { font-size: 11px; color: #666; margin-bottom: 8px; }
    .signature-line { border-top: 1px solid #999; margin-top: 40px; padding-top: 4px; font-size: 10px; color: #888; }
    .footer { margin-top: 20px; font-size: 10px; color: #888; text-align: center; border-top: 1px solid #ccc; padding-top: 8px; }
    @media print { body { padding: 10px; } }
  </style>
</head>
<body>
  <div class="header-box">
    <div>
      <div class="workshop-name">NIMR SAV</div>
      <div style="font-size:11px;color:#666;">Service Après-Vente</div>
    </div>
    <div style="text-align:right;">
      <h1>FICHE DE LIVRAISON</h1>
      <div style="font-size:11px;color:#666;">Date d'impression : ${new Date().toLocaleString("fr-FR")}</div>
    </div>
  </div>

  <h2>Informations client et véhicule</h2>
  <div class="info-grid">
    <div class="info-cell"><div class="info-label">Client</div><div class="info-value">${escapeHtml(item.clientName)}</div></div>
    <div class="info-cell"><div class="info-label">Téléphone</div><div class="info-value">${escapeHtml(item.phone || "—")}</div></div>
    <div class="info-cell"><div class="info-label">Véhicule</div><div class="info-value">${escapeHtml(item.vehicle || "—")}</div></div>
    <div class="info-cell"><div class="info-label">Immatriculation</div><div class="info-value">${escapeHtml(item.plate || "—")}</div></div>
    <div class="info-cell"><div class="info-label">VIN</div><div class="info-value">${escapeHtml(item.vin || "—")}</div></div>
    <div class="info-cell"><div class="info-label">Kilométrage entrée</div><div class="info-value">${escapeHtml(rw.vehicleMileageEntry || item.mileage || "—")}</div></div>
    <div class="info-cell"><div class="info-label">Date d'entrée</div><div class="info-value">${rw.vehicleReceivedAt ? new Date(rw.vehicleReceivedAt).toLocaleDateString("fr-FR") : (item.createdAt ? new Date(item.createdAt).toLocaleDateString("fr-FR") : "—")}</div></div>
    <div class="info-cell"><div class="info-label">Date de livraison</div><div class="info-value">${new Date().toLocaleDateString("fr-FR")}</div></div>
  </div>

  <h2>Travaux réalisés</h2>
  ${repairRows ? `<table><thead><tr><th>N°</th><th>Intitulé</th><th>Type</th></tr></thead><tbody>${repairRows}</tbody></table>` : "<p>Aucun ordre de réparation enregistré.</p>"}

  <h2>Réclamations et demandes client</h2>
  ${claimsRows ? `<table><thead><tr><th>Description</th><th style="width:100px;">Priorité</th><th style="width:160px;">Statut final</th></tr></thead><tbody>${claimsRows}</tbody></table>` : "<p>Aucune réclamation ou demande enregistrée.</p>"}

  ${qcChecklist ? `
    <h2>Contrôle qualité</h2>
    <table><thead><tr><th>Point de contrôle</th><th style="width:80px;">Validé</th><th>Note</th></tr></thead><tbody>${qcChecklist}</tbody></table>
  ` : ""}

  ${item.arrivalNotes || rw.vehicleConditionNote ? `
    <h2>Observations</h2>
    <p>${escapeHtml(rw.vehicleConditionNote || item.arrivalNotes || "")}</p>
  ` : ""}

  <div class="signature-section">
    <div class="signature-box">
      <div class="signature-box-title">Signature du responsable réception</div>
      <div class="signature-line">Nom et signature</div>
    </div>
    <div class="signature-box">
      <div class="signature-box-title">Signature du client (reçu le véhicule en bon état)</div>
      <div style="font-size:11px;margin-bottom:4px;">Nom : ${escapeHtml(item.clientName)}</div>
      <div class="signature-line">Signature</div>
    </div>
  </div>

  <div class="footer">
    NIMR SAV — Fiche de livraison générée le ${new Date().toLocaleString("fr-FR")} — Dossier: ${escapeHtml(item.id)}
  </div>

  <script>window.onload = () => window.print();</script>
</body>
</html>`;

  const win = window.open("", "_blank", "width=900,height=700");
  if (win) {
    win.document.write(html);
    win.document.close();
  }
}

// ─── MUTATIONS RÉCLAMATIONS (conservées de v23.1B) ───────────────────────────

function handleAddCustomerClaim(caseId, text, priority, type) {
  const item = state.cases.find((c) => c.id === caseId);
  if (!item) return;
  const actor = getCurrentActor();
  const claim = normalizeCustomerClaim({
    type: type || "claim",
    title: text,
    text: text,
    priority: priority || "normal",
    status: "open",
    createdBy: actor.userName || actor.userId || "Utilisateur",
  });
  item.customerClaims = Array.isArray(item.customerClaims) ? item.customerClaims : [];
  item.customerClaims.push(claim);
  addAuditLog("customer_claim.created", "Réclamation créée", `Nouvelle ${type === "request" ? "demande" : "réclamation"} ajoutée : "${text}" (priorité: ${priority})`, { caseId: item.id });
  saveState({ flushCloud: true, cloudReason: "claim-created" });
  notifyUser("Réclamation ajoutée.", "success");
  renderReceptionWorkspace();
}

function handleClaimStatusChange(caseId, claimId, newStatus) {
  const item = state.cases.find((c) => c.id === caseId);
  if (!item) return;
  const claim = (item.customerClaims || []).find((c) => c.id === claimId);
  if (!claim) return;
  const oldStatus = claim.status;
  claim.status = newStatus;
  claim.resolvedAt = ["resolved", "explained_to_customer"].includes(newStatus) ? new Date().toISOString() : "";
  const actor = getCurrentActor();
  claim.resolvedBy = ["resolved", "explained_to_customer"].includes(newStatus) ? (actor.userName || actor.userId) : "";
  addAuditLog("customer_claim.status_changed", "Statut réclamation changé", `Réclamation "${claim.text}" passée au statut : ${newStatus} (ancien: ${oldStatus})`, { caseId: item.id });
  saveState({ flushCloud: true, cloudReason: "claim-status-changed" });
  notifyUser("Statut réclamation mis à jour.", "success");
  renderReceptionWorkspace();
}

function handleExplainClaim(caseId, claimId) {
  const item = state.cases.find((c) => c.id === caseId);
  if (!item) return;
  const claim = (item.customerClaims || []).find((c) => c.id === claimId);
  if (!claim) return;
  claim.status = "explained_to_customer";
  claim.resolvedAt = new Date().toISOString();
  const actor = getCurrentActor();
  claim.resolvedBy = actor.userName || actor.userId || "Utilisateur";
  const commentText = "Explication fournie au client.";
  const comment = normalizeClaimComment({ text: commentText, createdBy: actor.userName || actor.userId || "Utilisateur" });
  claim.comments = Array.isArray(claim.comments) ? claim.comments : [];
  claim.comments.push(comment);
  addAuditLog("customer_claim.status_changed", "Statut réclamation changé", `Réclamation "${claim.text}" passée au statut : explained_to_customer`, { caseId: item.id });
  addAuditLog("customer_claim.comment_added", "Commentaire réclamation", `Commentaire ajouté : "${commentText}"`, { caseId: item.id });
  saveState({ flushCloud: true, cloudReason: "claim-explained" });
  notifyUser("Réclamation marquée expliquée au client.", "success");
  renderReceptionWorkspace();
}

function handleAddClaimComment(caseId, claimId, commentText) {
  const item = state.cases.find((c) => c.id === caseId);
  if (!item) return;
  const claim = (item.customerClaims || []).find((c) => c.id === claimId);
  if (!claim) return;
  const actor = getCurrentActor();
  const comment = normalizeClaimComment({ text: commentText, createdBy: actor.userName || actor.userId || "Utilisateur" });
  claim.comments = Array.isArray(claim.comments) ? claim.comments : [];
  claim.comments.push(comment);
  addAuditLog("customer_claim.comment_added", "Commentaire réclamation", `Commentaire ajouté : "${commentText}"`, { caseId: item.id });
  saveState({ flushCloud: true, cloudReason: "claim-comment-added" });
  notifyUser("Commentaire ajouté.", "success");
  renderReceptionWorkspace();
}

// ─── ANCIENS HELPERS — conservés pour compatibilité ui-cases.js ──────────────

function showTextPromptModal(title, htmlMessage, placeholder) {
  return new Promise((resolve) => {
    const overlay = document.getElementById("custom-modal-overlay");
    const titleEl = document.getElementById("custom-modal-title");
    const body = document.getElementById("custom-modal-body");
    const cancelBtn = document.getElementById("custom-modal-cancel");
    const confirmBtn = document.getElementById("custom-modal-confirm");
    if (!overlay || !body || !cancelBtn || !confirmBtn) { resolve(prompt(htmlMessage.replace(/<br>/g, "\n"))); return; }
    const oldTitle = titleEl ? titleEl.innerHTML : "Confirmation";
    if (titleEl) titleEl.innerHTML = title;
    body.innerHTML = `${htmlMessage}<br><br><input type="text" id="custom-prompt-input" style="width:100%;padding:8px;border:1px solid var(--border-color,#cfe0e8);border-radius:8px;box-sizing:border-box;" placeholder="${placeholder || ""}" autocomplete="off" />`;
    overlay.hidden = false;
    const input = document.getElementById("custom-prompt-input");
    if (input) input.focus();
    const cleanup = () => { overlay.hidden = true; if (titleEl) titleEl.innerHTML = oldTitle; cancelBtn.removeEventListener("click", onCancel); confirmBtn.removeEventListener("click", onConfirm); };
    const onCancel = () => { cleanup(); resolve(null); };
    const onConfirm = () => { const val = input ? input.value.trim() : ""; cleanup(); resolve(val); };
    cancelBtn.addEventListener("click", onCancel);
    confirmBtn.addEventListener("click", onConfirm);
  });
}

async function verifyDeliveryClaimsBlock(item) {
  const hasUnresolved = (item.customerClaims || []).some((c) => ["open", "in_progress", "unresolved"].includes(c.status));
  if (!hasUnresolved) return true;
  if (typeof addAuditLog === "function") addAuditLog("reception.delivery_warning", "Avertissement livraison", `Réclamations non résolues pour ${item.plate || item.vin}.`, { caseId: item.id });
  const user = typeof getCurrentUser === "function" ? getCurrentUser() : null;
  const isAuthorized = user && ["admin", "chef_atelier"].includes(user.role);
  if (!isAuthorized) {
    if (typeof showConfirmModal === "function") await showConfirmModal("Livraison bloquée : réclamations client non résolues. Seul un administrateur ou chef d'atelier peut forcer la livraison.");
    else alert("Livraison bloquée : réclamations client non résolues.");
    return false;
  }
  const reason = await showTextPromptModal("Override Livraison", "Le dossier comporte des réclamations non résolues. Saisissez le motif obligatoire :");
  if (!reason) { if (typeof notifyUser === "function") notifyUser("Motif d'override obligatoire. Livraison annulée.", "error"); return false; }
  if (typeof addAuditLog === "function") addAuditLog("reception.delivery_override", "Override livraison", `Livraison autorisée avec motif : ${reason}`, { caseId: item.id });
  if (typeof addHistory === "function") addHistory(item, "reception.delivery_override", "Livraison forcée (Override)", `Motif : ${reason}`);
  return true;
}

async function handleDeliveryAction(item) {
  const isAllowed = await verifyDeliveryClaimsBlock(item);
  if (!isAllowed) return false;
  const guard = guardWorkflowAction("delivered", item, true);
  if (!guard.ok) { notifyUser(guard.message || "Action non autorisée", "error"); return false; }
  const issues = getBusinessRuleIssues(item, "delivered");
  if (issues.length) { notifyUser(issues.join("\n"), "error"); return false; }
  const warnings = getBusinessRuleWarnings(item, "delivered");
  if (warnings.length) { const confirmed = await showConfirmModal(warnings.join("<br>") + "<br><br>Voulez-vous vraiment continuer ?"); if (!confirmed) return false; }
  const result = advanceReceptionWorkflow(item.id, "deliver_vehicle");
  if (result && result.ok) { saveState({ flushCloud: true, cloudReason: "reception-delivery" }); notifyUser("Véhicule marqué comme livré.", "success"); renderReceptionWorkspace(); if (typeof renderCases === "function") renderCases(); return true; }
  else { notifyUser(result?.message || "Erreur lors de la livraison.", "error"); return false; }
}

// ─── EXPORTS ─────────────────────────────────────────────────────────────────

if (typeof window !== "undefined") {
  window.initReceptionWorkspace = initReceptionWorkspace;
  window.renderReceptionWorkspace = renderReceptionWorkspace;
  window.verifyDeliveryClaimsBlock = verifyDeliveryClaimsBlock;
  window.printDeliverySheet = printDeliverySheet;
  window.handleAddCustomerClaim = handleAddCustomerClaim;
  window.handleClaimStatusChange = handleClaimStatusChange;
  window.handleExplainClaim = handleExplainClaim;
  window.handleAddClaimComment = handleAddClaimComment;
}
