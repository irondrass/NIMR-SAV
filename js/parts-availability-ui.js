(function initPartsAvailabilityUi(globalScope) {
  "use strict";

  const PARTS_AVAILABILITY_ROLES = new Set(["responsable_magasin", "directeur_pieces"]);
  const PARTS_AVAILABILITY_STATUS_LABELS = {
    unchecked: "Non vérifié",
    available: "Disponible",
    partial: "Disponibilité partielle",
    waiting_parts: "En attente de pièces",
    blocked_parts: "Bloqué par pièces",
  };
  const partsAvailabilityDrafts = new Map();
  let activePartsAvailabilityCaseId = "";
  let partsAvailabilityEventsBound = false;

  function escapePartsAvailabilityHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function canManagePartsAvailability(role) {
    return PARTS_AVAILABILITY_ROLES.has(String(role || "").trim());
  }

  function getPartsAvailabilityStatusClass(status) {
    const normalized = String(status || "unchecked").trim().toLowerCase();
    return `status-${["available", "partial", "waiting_parts", "blocked_parts"].includes(normalized) ? normalized : "unchecked"}`;
  }

  function getPartsAvailabilityLineKey(line) {
    return `${String(line?.sourceOrigin || "")}::${String(line?.sourcePartId || "")}`;
  }

  function collectCasePartsAvailabilityLines(item) {
    const sourceLines = [];
    const caseId = String(item?.id || "case");
    const append = (parts, sourceOrigin, sourceLabel) => {
      if (!Array.isArray(parts)) return;
      parts.forEach((part, index) => {
        const sourcePart = part && typeof part === "object" ? part : {};
        sourceLines.push({
          ...sourcePart,
          sourcePartId: String(sourcePart.sourcePartId || sourcePart.id || `${sourceOrigin}:part-${index + 1}`).trim(),
          sourceOrigin,
          sourceLabel,
          note: String(sourcePart.note || sourcePart.notes || "").trim(),
        });
      });
    };

    append(item?.estimate?.parts, `estimate:${caseId}`, "Devis dossier");
    (Array.isArray(item?.claims) ? item.claims : []).forEach((claim, index) => {
      const claimId = String(claim?.id || `claim-${index + 1}`);
      append(claim?.estimate?.parts, `estimate:${claimId}`, `Devis ${claim?.number || claimId}`);
    });
    append(item?.expertEstimate?.parts, `expert-estimate:${caseId}`, "Devis expert");
    (Array.isArray(item?.supplements) ? item.supplements : []).forEach((supplement, index) => {
      const supplementId = String(supplement?.id || `supplement-${index + 1}`);
      append(supplement?.parts, `supplement:${supplementId}`, `Complément ${supplement?.number || supplementId}`);
    });

    return projectPartsAvailabilityLines(sourceLines);
  }

  function buildPartsAvailabilityDraft(review, sourceLines) {
    const validReview = review && validatePartsAvailabilityReview(review).valid ? review : null;
    const savedByKey = new Map(
      (validReview?.lines || []).map((line) => [getPartsAvailabilityLineKey(line), line]),
    );
    return {
      allDelivered: validReview?.allDelivered === true,
      lines: sourceLines.map((line) => {
        const saved = savedByKey.get(getPartsAvailabilityLineKey(line));
        return {
          ...line,
          unavailable: saved?.unavailable === true,
          canBeTaken: saved?.unavailable === true && typeof saved.canBeTaken === "boolean"
            ? saved.canBeTaken
            : null,
          ...(saved?.unavailableReason ? { unavailableReason: saved.unavailableReason } : {}),
          ...(saved?.note ? { note: saved.note } : {}),
        };
      }),
    };
  }

  function applyPartsAvailabilityReview(item, input) {
    const allDelivered = input?.allDelivered === true;
    const review = createPartsAvailabilityReview({
      caseId: item?.id,
      allDelivered,
      reviewedBy: input?.reviewedBy,
      reviewedAt: input?.reviewedAt,
      lines: (Array.isArray(input?.lines) ? input.lines : []).map((line) => ({
        ...line,
        unavailable: allDelivered ? false : line?.unavailable === true,
        canBeTaken: allDelivered || line?.unavailable !== true ? null : line?.canBeTaken,
      })),
    });
    item.partsAvailabilityReview = review;
    item.partsStatus = derivePartsStatus(review);
    return review;
  }

  async function savePartsAvailabilityReview(item, input, persist) {
    const review = applyPartsAvailabilityReview(item, input);
    if (typeof persist === "function") {
      const saved = await persist(item);
      if (saved !== true) throw new Error("La sauvegarde du contrôle des pièces n'a pas été confirmée.");
    }
    return review;
  }

  function deriveEffectivePartsStatus(item) {
    if (item?.partsAvailabilityReview && validatePartsAvailabilityReview(item.partsAvailabilityReview).valid) {
      return derivePartsStatus(item.partsAvailabilityReview);
    }
    return String(item?.partsStatus || "unchecked");
  }

  function formatPartsAvailabilityValidationErrors(error) {
    const messages = Array.isArray(error?.validationErrors)
      ? error.validationErrors.map((entry) => String(entry?.message || "").trim()).filter(Boolean)
      : [];
    return messages.join(" ") || String(error?.message || "Impossible d'enregistrer la revue des pièces.");
  }

  function renderPartsAvailabilityFormHtml(item, sourceLines, draft) {
    const allDelivered = draft?.allDelivered === true;
    const draftLines = Array.isArray(draft?.lines) ? draft.lines : sourceLines;
    const lineRows = draftLines.map((line, index) => {
      const unavailable = !allDelivered && line.unavailable === true;
      const sourceText = line.sourceLabel ? `<small>${escapePartsAvailabilityHtml(line.sourceLabel)}</small>` : "";
      const decision = unavailable
        ? `<fieldset class="parts-availability-decision" data-parts-decision="${index}">
            <legend>Prélèvement possible ?</legend>
            <label><input type="radio" name="can-be-taken-${index}" value="true" data-parts-can-be-taken="${index}" ${line.canBeTaken === true ? "checked" : ""}> OUI</label>
            <label><input type="radio" name="can-be-taken-${index}" value="false" data-parts-can-be-taken="${index}" ${line.canBeTaken === false ? "checked" : ""}> NON</label>
          </fieldset>`
        : "";
      return `<article class="parts-availability-line ${unavailable ? "is-unavailable" : ""}">
        <label class="parts-availability-line-check">
          <input type="checkbox" data-parts-unavailable="${index}" ${unavailable ? "checked" : ""} ${allDelivered ? "disabled" : ""}>
          <span><strong>${escapePartsAvailabilityHtml(line.designation)}</strong>${sourceText}</span>
          <b>Qté ${escapePartsAvailabilityHtml(line.quantity)}</b>
        </label>
        ${decision}
      </article>`;
    }).join("");

    return `<form id="parts-availability-form" data-parts-case-id="${escapePartsAvailabilityHtml(item?.id)}">
      <div id="parts-availability-error" class="validation-alert" role="alert" hidden></div>
      <label class="parts-availability-all-delivered">
        <input type="checkbox" data-parts-all-delivered ${allDelivered ? "checked" : ""}>
        <span><strong>Toutes les pièces sont livrées</strong><small>Cochez uniquement si aucune pièce ne manque.</small></span>
      </label>
      <div class="parts-availability-lines" ${allDelivered ? "hidden" : ""}>${lineRows}</div>
      <button class="primary-button parts-availability-save" type="submit">Enregistrer</button>
    </form>`;
  }

  function getPartsAvailabilityCases() {
    if (typeof state === "undefined" || !Array.isArray(state?.cases)) return [];
    return state.cases.filter((item) => collectCasePartsAvailabilityLines(item).length > 0);
  }

  function getPartsAvailabilityCurrentRole() {
    if (typeof getCurrentUser !== "function") return "";
    const user = getCurrentUser();
    return typeof getCanonicalUserRole === "function" ? getCanonicalUserRole(user) : String(user?.role || "");
  }

  function getOrCreatePartsAvailabilityDraft(item, sourceLines) {
    const caseId = String(item?.id || "");
    if (!partsAvailabilityDrafts.has(caseId)) {
      partsAvailabilityDrafts.set(caseId, buildPartsAvailabilityDraft(item?.partsAvailabilityReview, sourceLines));
    }
    const draft = partsAvailabilityDrafts.get(caseId);
    const draftLines = Array.isArray(draft?.lines) ? draft.lines : [];
    const sourceChanged = draftLines.length !== sourceLines.length || sourceLines.some((line, index) => {
      const draftLine = draftLines[index];
      return getPartsAvailabilityLineKey(draftLine) !== getPartsAvailabilityLineKey(line)
        || draftLine?.designation !== line?.designation
        || draftLine?.quantity !== line?.quantity;
    });
    if (!sourceChanged) return draft;

    const draftByKey = new Map(draftLines.map((line) => [getPartsAvailabilityLineKey(line), line]));
    const structureChanged = draftLines.length !== sourceLines.length || sourceLines.some((line) => {
      const previous = draftByKey.get(getPartsAvailabilityLineKey(line));
      return !previous || previous.quantity !== line.quantity;
    });
    const reconciled = {
      allDelivered: structureChanged ? false : draft?.allDelivered === true,
      lines: sourceLines.map((line) => {
        const previous = draftByKey.get(getPartsAvailabilityLineKey(line));
        return {
          ...line,
          unavailable: previous?.unavailable === true,
          canBeTaken: previous && typeof previous.canBeTaken === "boolean" ? previous.canBeTaken : null,
        };
      }),
    };
    partsAvailabilityDrafts.set(caseId, reconciled);
    return reconciled;
  }

  function renderPartsAvailabilityView() {
    if (typeof document === "undefined") return;
    const listTarget = document.getElementById("parts-availability-case-list");
    const detailTarget = document.getElementById("parts-availability-detail");
    if (!listTarget || !detailTarget) return;

    if (!canManagePartsAvailability(getPartsAvailabilityCurrentRole())) {
      listTarget.innerHTML = "";
      detailTarget.innerHTML = '<div class="empty-state"><strong>Accès non autorisé</strong></div>';
      return;
    }

    const cases = getPartsAvailabilityCases();
    if (!cases.some((item) => item.id === activePartsAvailabilityCaseId)) {
      activePartsAvailabilityCaseId = cases[0]?.id || "";
    }
    listTarget.innerHTML = cases.length
      ? cases.map((item) => {
          const lines = collectCasePartsAvailabilityLines(item);
          const status = deriveEffectivePartsStatus(item);
          const identity = item.plate || item.vin || "Immatriculation / VIN non renseigné";
          return `<button class="parts-availability-case-card ${item.id === activePartsAvailabilityCaseId ? "active" : ""}" type="button" data-parts-case="${escapePartsAvailabilityHtml(item.id)}">
            <strong>${escapePartsAvailabilityHtml(item.orNavNumber || item.id)}</strong>
            <span>${escapePartsAvailabilityHtml(item.vehicle || "Véhicule non renseigné")}</span>
            <small>${escapePartsAvailabilityHtml(identity)} · ${lines.length} pièce${lines.length > 1 ? "s" : ""}</small>
            <em class="parts-availability-status ${getPartsAvailabilityStatusClass(status)}" data-parts-status="${escapePartsAvailabilityHtml(status)}">${escapePartsAvailabilityHtml(PARTS_AVAILABILITY_STATUS_LABELS[status] || status)}</em>
          </button>`;
        }).join("")
      : '<div class="empty-inline">Aucun dossier avec des pièces à contrôler.</div>';

    const item = cases.find((candidate) => candidate.id === activePartsAvailabilityCaseId);
    if (!item) {
      detailTarget.innerHTML = '<div class="empty-state"><strong>Sélectionnez un dossier</strong></div>';
      return;
    }
    const sourceLines = collectCasePartsAvailabilityLines(item);
    const draft = getOrCreatePartsAvailabilityDraft(item, sourceLines);
    detailTarget.innerHTML = `<header class="parts-availability-detail-header">
        <div><span class="eyebrow">${escapePartsAvailabilityHtml(item.orNavNumber || item.id)}</span><h2>${escapePartsAvailabilityHtml(item.vehicle || "Véhicule")}</h2></div>
        <p>${escapePartsAvailabilityHtml(item.plate || item.vin || "Identité véhicule non renseignée")}</p>
      </header>
      ${renderPartsAvailabilityFormHtml(item, sourceLines, draft)}`;
  }

  function findPartsAvailabilityCase(caseId) {
    return getPartsAvailabilityCases().find((item) => String(item.id) === String(caseId));
  }

  function showPartsAvailabilityError(error) {
    const target = typeof document !== "undefined" ? document.getElementById("parts-availability-error") : null;
    if (!target) return;
    target.hidden = false;
    target.textContent = formatPartsAvailabilityValidationErrors(error);
  }

  function bindPartsAvailabilityUiEvents() {
    if (typeof document === "undefined" || partsAvailabilityEventsBound) return;
    partsAvailabilityEventsBound = true;

    document.addEventListener("click", (event) => {
      if (event.target?.closest?.('.nav-button[data-tab="parts-availability"]')) {
        renderPartsAvailabilityView();
        return;
      }
      const caseButton = event.target?.closest?.("[data-parts-case]");
      if (!caseButton) return;
      activePartsAvailabilityCaseId = caseButton.dataset.partsCase || "";
      renderPartsAvailabilityView();
    });

    document.addEventListener("change", (event) => {
      const form = event.target?.closest?.("#parts-availability-form");
      if (!form) return;
      const item = findPartsAvailabilityCase(form.dataset.partsCaseId);
      if (!item) return;
      const sourceLines = collectCasePartsAvailabilityLines(item);
      const draft = getOrCreatePartsAvailabilityDraft(item, sourceLines);

      if (event.target.matches?.("[data-parts-all-delivered]")) {
        draft.allDelivered = event.target.checked === true;
        if (draft.allDelivered) {
          draft.lines.forEach((line) => { line.unavailable = false; line.canBeTaken = null; });
        }
        renderPartsAvailabilityView();
        return;
      }
      if (event.target.matches?.("[data-parts-unavailable]")) {
        const index = Number(event.target.dataset.partsUnavailable);
        const line = draft.lines[index];
        if (!line) return;
        line.unavailable = event.target.checked === true;
        if (!line.unavailable) line.canBeTaken = null;
        draft.allDelivered = false;
        renderPartsAvailabilityView();
        return;
      }
      if (event.target.matches?.("[data-parts-can-be-taken]")) {
        const index = Number(event.target.dataset.partsCanBeTaken);
        const line = draft.lines[index];
        if (line) line.canBeTaken = event.target.value === "true";
      }
    });

    document.addEventListener("submit", async (event) => {
      const form = event.target?.closest?.("#parts-availability-form");
      if (!form) return;
      event.preventDefault();
      if (!canManagePartsAvailability(getPartsAvailabilityCurrentRole())) return;
      const item = findPartsAvailabilityCase(form.dataset.partsCaseId);
      if (!item) return;
      const sourceLines = collectCasePartsAvailabilityLines(item);
      const draft = getOrCreatePartsAvailabilityDraft(item, sourceLines);
      const user = typeof getCurrentUser === "function" ? getCurrentUser() : null;
      const saveButton = form.querySelector(".parts-availability-save");
      const saveButtonLabel = saveButton?.textContent || "Enregistrer";
      form.setAttribute("aria-busy", "true");
      form.classList.add("is-pending");
      if (saveButton) {
        saveButton.disabled = true;
        saveButton.classList.add("is-pending");
        saveButton.setAttribute("aria-busy", "true");
        saveButton.textContent = "Enregistrement?";
      }

      try {
        const review = await savePartsAvailabilityReview(item, {
          ...draft,
          reviewedBy: String(user?.id || user?.name || "").trim(),
          reviewedAt: new Date().toISOString(),
        }, async (changedCase) => {
          if (typeof addHistory === "function") {
            addHistory(changedCase, "parts.availability.reviewed", "Disponibilité des pièces contrôlée", `Statut : ${PARTS_AVAILABILITY_STATUS_LABELS[changedCase.partsStatus] || changedCase.partsStatus}`);
          }
          return typeof saveState === "function"
            ? saveState({ changedCase, flushCloud: true, cloudReason: "parts-availability-review" })
            : false;
        });
        partsAvailabilityDrafts.set(String(item.id), buildPartsAvailabilityDraft(review, sourceLines));
        renderPartsAvailabilityView();
        if (typeof quietNotify === "function") quietNotify("Contrôle des pièces enregistré.", "success");
      } catch (error) {
        showPartsAvailabilityError(error);
      } finally {
        if (form.isConnected) {
          form.removeAttribute("aria-busy");
          form.classList.remove("is-pending");
        }
        if (saveButton?.isConnected) {
          saveButton.disabled = false;
          saveButton.classList.remove("is-pending");
          saveButton.removeAttribute("aria-busy");
          saveButton.textContent = saveButtonLabel;
        }
      }
    });
  }

  Object.assign(globalScope, {
    applyPartsAvailabilityReview,
    buildPartsAvailabilityDraft,
    canManagePartsAvailability,
    collectCasePartsAvailabilityLines,
    deriveEffectivePartsStatus,
    formatPartsAvailabilityValidationErrors,
    getOrCreatePartsAvailabilityDraft,
    renderPartsAvailabilityFormHtml,
    renderPartsAvailabilityView,
    savePartsAvailabilityReview,
  });

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => {
        bindPartsAvailabilityUiEvents();
        renderPartsAvailabilityView();
      });
    } else {
      bindPartsAvailabilityUiEvents();
      renderPartsAvailabilityView();
    }
  }
})(globalThis);
