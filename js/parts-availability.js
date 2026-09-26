function projectPartsAvailabilityLines(sourceParts) {
  if (!Array.isArray(sourceParts)) {
    throw new TypeError("Les pièces source doivent être fournies sous forme de tableau.");
  }

  return sourceParts.map((sourcePart, index) => {
    const part = sourcePart && typeof sourcePart === "object" ? sourcePart : {};
    const line = {
      sourcePartId: String(part.sourcePartId || part.id || `source-part-${index + 1}`).trim(),
      designation: String(part.designation || part.name || "").trim(),
      quantity: Number(part.quantity ?? 0),
      unavailable: part.unavailable ?? false,
      canBeTaken: part.canBeTaken ?? null,
    };

    const unavailableReason = String(part.unavailableReason || "").trim();
    const note = String(part.note || part.notes || "").trim();
    const sourceOrigin = String(part.sourceOrigin || "").trim();
    const sourceLabel = String(part.sourceLabel || "").trim();
    if (unavailableReason) line.unavailableReason = unavailableReason;
    if (note) line.note = note;
    if (sourceOrigin) line.sourceOrigin = sourceOrigin;
    if (sourceLabel) line.sourceLabel = sourceLabel;

    return line;
  });
}

function validatePartsAvailabilityReview(review) {
  const errors = [];
  const addError = (code, path, message) => errors.push({ code, path, message });

  if (!review || typeof review !== "object" || Array.isArray(review)) {
    addError("INVALID_REVIEW", "review", "La revue de disponibilité est obligatoire.");
    return { valid: false, errors };
  }

  if (!String(review.caseId || "").trim()) {
    addError("CASE_ID_REQUIRED", "caseId", "Le dossier est obligatoire.");
  }
  if (typeof review.allDelivered !== "boolean") {
    addError("ALL_DELIVERED_REQUIRED", "allDelivered", "La confirmation de livraison doit être booléenne.");
  }
  if (!String(review.reviewedBy || "").trim()) {
    addError("REVIEWED_BY_REQUIRED", "reviewedBy", "L'auteur de la revue est obligatoire.");
  }
  if (!String(review.reviewedAt || "").trim()) {
    addError("REVIEWED_AT_REQUIRED", "reviewedAt", "La date de revue est obligatoire.");
  }
  if (!Array.isArray(review.lines)) {
    addError("LINES_REQUIRED", "lines", "Les lignes de pièces doivent être fournies sous forme de tableau.");
    return { valid: errors.length === 0, errors };
  }

  if (review.allDelivered === false && !review.lines.some((line) => line?.unavailable === true)) {
    addError("NO_UNAVAILABLE_PART_SELECTED", "lines", "Au moins une pièce indisponible doit être sélectionnée lorsque toutes les pièces ne sont pas livrées.");
  }

  review.lines.forEach((line, index) => {
    const path = `lines[${index}]`;
    if (!line || typeof line !== "object" || Array.isArray(line)) {
      addError("INVALID_LINE", path, "La ligne de pièce est invalide.");
      return;
    }
    if (!String(line.sourcePartId || "").trim()) {
      addError("SOURCE_PART_ID_REQUIRED", `${path}.sourcePartId`, "L'identité de la pièce source est obligatoire.");
    }
    if (!String(line.designation || "").trim()) {
      addError("DESIGNATION_REQUIRED", `${path}.designation`, "La désignation de la pièce est obligatoire.");
    }
    if (!Number.isFinite(line.quantity) || line.quantity < 0) {
      addError("INVALID_QUANTITY", `${path}.quantity`, "La quantité doit être un nombre supérieur ou égal à zéro.");
    }
    if (typeof line.unavailable !== "boolean") {
      addError("UNAVAILABLE_REQUIRED", `${path}.unavailable`, "La disponibilité de la pièce doit être booléenne.");
      return;
    }

    if (review.allDelivered === true && line.unavailable === true) {
      addError("ALL_DELIVERED_CONFLICT", `${path}.unavailable`, "Une pièce ne peut pas être indisponible si toutes les pièces sont livrées.");
    }
    if (line.unavailable === true && typeof line.canBeTaken !== "boolean") {
      addError("CAN_BE_TAKEN_REQUIRED", `${path}.canBeTaken`, "Une pièce indisponible doit être marquée prélevable ou non prélevable.");
    }
    if (line.unavailable === false && line.canBeTaken !== null) {
      addError("CAN_BE_TAKEN_FORBIDDEN", `${path}.canBeTaken`, "Une pièce disponible ne peut pas porter de décision de prélèvement.");
    }
    if (review.allDelivered === true && line.canBeTaken !== null) {
      addError("ALL_DELIVERED_CAN_BE_TAKEN_CONFLICT", `${path}.canBeTaken`, "Aucune décision de prélèvement n'est autorisée lorsque toutes les pièces sont livrées.");
    }
  });

  return { valid: errors.length === 0, errors };
}

function createPartsAvailabilityReview(input) {
  const source = input && typeof input === "object" ? input : {};
  const review = {
    caseId: String(source.caseId || "").trim(),
    allDelivered: source.allDelivered,
    reviewedBy: String(source.reviewedBy || "").trim(),
    reviewedAt: String(source.reviewedAt || "").trim(),
    lines: projectPartsAvailabilityLines(source.lines),
  };
  const validation = validatePartsAvailabilityReview(review);

  if (!validation.valid) {
    const error = new TypeError("Revue de disponibilité des pièces invalide.");
    error.validationErrors = validation.errors;
    throw error;
  }

  return review;
}

function derivePartsStatus(review) {
  const validation = validatePartsAvailabilityReview(review);
  if (!validation.valid) return "unchecked";
  if (review.allDelivered === true) return "available";

  const unavailableCount = review.lines.filter((line) => line.unavailable === true).length;
  if (unavailableCount === 0) return "available";
  if (unavailableCount === review.lines.length) return "waiting_parts";
  return "partial";
}
