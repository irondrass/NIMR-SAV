const ESTIMATE_LABOR_HOURLY_RATES = [33, 35];
const ESTIMATE_LABOR_MAX_HOURS = 80;

function getFileExtension(fileName = "") {
  const match = String(fileName).toLowerCase().match(/\.([a-z0-9]+)$/);
  return match ? match[1] : "";
}

function validateEstimateImportFile(file) {
  if (!file) return "Sélectionnez un fichier devis à importer.";
  if (file.size > MAX_ESTIMATE_IMPORT_SIZE) return "Fichier trop volumineux. Taille maximale : 10 Mo.";
  const extension = getFileExtension(file.name);
  if (!ESTIMATE_IMPORT_EXTENSIONS.includes(extension)) {
    return "Format non supporté. Importez un PDF texte, Excel ou CSV.";
  }
  return "";
}

async function handleEstimateImportFile(event, item, root) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!item) {
    notifyUser("Sélectionnez un dossier avant d'importer un devis.", "error");
    return;
  }
  const permissionGuard = guardEstimateImport(item);
  if (!permissionGuard.ok) return;
  if (!file) return;
  const validationError = validateEstimateImportFile(file);
  if (validationError) {
    notifyUser(validationError, "error");
    return;
  }
  const status = $("[data-field='estimate-import-status']", root);
  if (status) status.textContent = "Analyse du devis...";
  try {
    const extracted = await extractEstimateTextFromFile(file);
    const parsed = parseEstimateText(extracted.text, {
      fileName: file.name,
      sourceType: extracted.sourceType,
      rows: extracted.rows,
      lines: extracted.lines,
      claimType: "client",
    });
    if (!parsed.laborLines.length) {
      throw new Error("Aucune ligne de main-d'œuvre détectée. Vérifiez le fichier ou saisissez les durées manuellement.");
    }
    estimateImportPreviews[item.id] = prepareEstimateImportPreview(parsed, item);
    estimateImportPreviews[item.id].sourceFile = {
      id: uid("estimate-doc"),
      name: file.name || "devis-original.pdf",
      type: file.type || "application/octet-stream",
      size: file.size || 0,
      category: "estimate_original",
      createdAt: new Date().toISOString(),
      blob: file.slice(0, file.size, file.type || "application/octet-stream"),
    };
    notifyUser("Devis analysé. Vérifiez la répartition avant application.");
    renderEstimateImportPreview(root, item);
  } catch (error) {
    console.error("Import devis impossible", error);
    delete estimateImportPreviews[item.id];
    if (status) status.textContent = "Import devis impossible.";
    renderEstimateImportPreview(root, item);
    notifyUser(error.message || "Format non supporté. Importez un PDF texte, Excel ou CSV.", "error");
  }
}


async function handleClaimEstimateImportFile(event, item, claimId, root) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!item) return;
  const permissionGuard = guardEstimateImport(item);
  if (!permissionGuard.ok) return;
  const claim = (item.claims || []).find((candidate) => candidate.id === claimId);
  if (!claim) {
    notifyUser("Ordre de travail introuvable.", "error");
    return;
  }
  if (!file) return;
  const validationError = validateEstimateImportFile(file);
  if (validationError) {
    notifyUser(validationError, "error");
    return;
  }
  try {
    notifyUser(`Analyse du devis pour ${claim.number || claim.title}...`);
    const extracted = await extractEstimateTextFromFile(file);
    const parsed = parseEstimateText(extracted.text, {
      fileName: file.name,
      sourceType: extracted.sourceType,
      rows: extracted.rows,
      lines: extracted.lines,
      claimType: claim.type || "assurance",
    });
    if (!parsed.laborLines.length) {
      throw new Error("Aucune ligne de main-d'œuvre détectée pour cet ordre.");
    }
    const preview = prepareEstimateImportPreview(parsed, item);
    preview.sourceFile = {
      id: uid("estimate-doc"),
      name: file.name || "devis-ordre.pdf",
      type: file.type || "application/octet-stream",
      size: file.size || 0,
      category: "claim_estimate_original",
      createdAt: new Date().toISOString(),
      blob: file.slice(0, file.size, file.type || "application/octet-stream"),
    };
    await applyEstimateImportToClaim(item, claim, preview);
    notifyUser(`Devis importé dans ${claim.number || claim.title}. Planning global recalculé.`, "success");
    renderCaseDetail();
  } catch (error) {
    console.error("Import devis ordre impossible", error);
    notifyUser(error.message || "Import devis ordre impossible.", "error");
  }
}

async function extractEstimateTextFromFile(file) {
  if (!file) throw new Error("Sélectionnez un dossier avant d'importer un devis.");
  const name = file.name.toLowerCase();
  const extension = getFileExtension(name);
  if (extension === "csv" || file.type.includes("csv")) {
    const text = await readFileAsText(file);
    const rows = parseCsv(text);
    return { sourceType: "csv", text, rows, lines: rows.map((row) => row.join(" ")) };
  }
  if (extension === "xlsx") {
    const rows = await parseXlsxRows(await readFileAsArrayBuffer(file));
    const lines = rows.map((row) => row.join(" "));
    return { sourceType: "xlsx", text: lines.join("\n"), rows, lines };
  }
  if (extension === "pdf" || file.type === "application/pdf") {
    const text = await extractPdfText(await readFileAsArrayBuffer(file));
    if (normalizeEstimateOperationText(text).length < 20) {
      throw new Error("Le texte du PDF n'a pas pu être extrait par le lecteur intégré. Essayez une version Excel/CSV ou un PDF non scanné.");
    }
    return { sourceType: "pdf", text, rows: [], lines: splitEstimateSourceLines(text) };
  }
  throw new Error("Format non supporté. Importez un PDF texte, Excel ou CSV.");
}

async function parseXlsxRows(buffer) {
  const entries = await unzipXlsx(buffer);
  const sharedStrings = parseSharedStrings(entries.get("xl/sharedStrings.xml") || "");
  const sheetPath = [...entries.keys()].find((path) => /^xl\/worksheets\/sheet\d+\.xml$/.test(path));
  if (!sheetPath) throw new Error("Aucune feuille Excel lisible trouvée.");
  return parseWorksheet(entries.get(sheetPath), sharedStrings);
}

function parseEstimateText(text, options = {}) {
  const sourceLines = splitEstimateSourceLines((options.lines?.length ? options.lines : text.split(/\r?\n/)).join("\n"));
  const info = extractEstimateInfo(text, sourceLines);
  const laborLines = [];
  const partsLines = [];
  const distributedLines = [];
  const ignoredLines = [];
  const allocations = Object.fromEntries(ESTIMATE_PLANNING_KEYS.map((key) => [key, 0]));
  let detectedHours = 0;

  sourceLines.forEach((line) => {
    const result = classifyLaborLine(line, options);
    if (result?.type === "labor") {
      laborLines.push(result);
      detectedHours += result.hours;
      result.distributions.forEach((distribution) => {
        allocations[distribution.phase] = roundPlanningHours((allocations[distribution.phase] || 0) + distribution.laborHours);
        distributedLines.push({
          id: uid("estimate-line"),
          phase: distribution.phase,
          operation: distribution.operation,
          laborHours: distribution.laborHours,
        });
      });
    } else {
      const part = classifyEstimatePartLine(line);
      if (part) {
        partsLines.push(part);
      } else if (result?.type === "ignored") {
        ignoredLines.push({ text: line, reason: result.reason });
      }
    }
  });

  return {
    fileName: options.fileName || "devis",
    sourceType: options.sourceType || "texte",
    info,
    laborLines,
    partsLines: dedupeEstimatePartLines(partsLines),
    distributedLines,
    ignoredLines,
    allocations,
    detectedHours: roundPlanningHours(detectedHours),
  };
}

function prepareEstimateImportPreview(parsed, item) {
  const durations = Object.fromEntries(ESTIMATE_ALLOWED_KEYS.map((key) => [key, 0]));
  ESTIMATE_PLANNING_KEYS.forEach((key) => {
    durations[key] = roundPlanningHours(parsed.allocations[key] || 0);
  });
  applyPaintPreparationRatio(durations);
  durations.finish = roundPlanningHours(durations.finish || 0);
  durations.quality = roundPlanningHours(Number(item.durations?.quality ?? DEFAULT_DURATIONS.quality));
  return { ...parsed, durations };
}

function applyPaintPreparationRatio(durations) {
  if (!durations) return durations;
  const oldPrep = Number(durations.prep || 0);
  const oldPaint = Number(durations.paint || 0);
  const total = roundPlanningHours(oldPrep + oldPaint);
  if (total <= 0) return durations;

  const newPrep = roundPlanningHours(total * (2 / 3));
  durations.prep = newPrep;
  durations.paint = roundPlanningHours(Math.max(0, total - newPrep));
  return durations;
}

function normalizeEstimatePreviewDurations(durations, item) {
  const normalized = Object.fromEntries(ESTIMATE_ALLOWED_KEYS.map((key) => [key, 0]));
  ESTIMATE_PLANNING_KEYS.forEach((key) => {
    normalized[key] = roundPlanningHours(durations?.[key] || 0);
  });
  normalized.finish = roundPlanningHours(Number(normalized.paint || 0) * 0.5);
  normalized.quality = 0.25;
  return normalized;
}

function classifyLaborLine(line, options = {}) {
  const text = String(line || "").replace(/\s+/g, " ").trim();
  if (!text || text.length < 3) return null;
  const normalized = normalizeEstimateOperationText(text);
  if (isEstimateLegalOrFooterLine(normalized)) return { type: "ignored", reason: "Note client ou pied de page ignoré" };
  if (isPaintSupplyLine(normalized)) return { type: "ignored", reason: "Produit de peinture ignoré comme fourniture" };

  if (/\b(DESIGNATION|QTE|PRIX\s+UNITAIRE|MONTANT)\b/.test(normalized)) {
    return { type: "ignored", reason: "Ligne d'en-tête ou de tableau concaténée" };
  }

  const pricingInfo = extractEstimatePricingInfo(text);
  const isConfirmedLabor = pricingInfo.hasLaborHourlyRate;

  // Bypass hardIgnored for FILTRE/HUILE if they are confirmed labor (have 33/35 PU).
  // Also include REMP (without L) as a common labor abbreviation.
  const isFiltreOrHuileLabor = isConfirmedLabor && /\b(FILTRE|HUILE)\b/.test(normalized);
  const laborException = isFiltreOrHuileLabor || /\b(REMP|REMPL|REMPLACEMENT)\s+FEU\b/.test(normalized) || /\b(CHANG(?:EMENT)?|REMP|REMPL)\b/.test(normalized);

  const hardIgnored = [
    "FOURNITURE",
    "AGRAFE",
    "EMBLEME",
    "MONOGRAMME",
    "HUILE",
    "FILTRE",
    "LIQUIDE",
    "MOUSSE",
    "RENFORT",
    "SUPPORT",
    "FEU ARRIERE",
    "PARE CHOCS COMPLET",
    "TOTAL",
    "TVA",
    "TIMBRE",
  ].some((keyword) => normalized.includes(keyword));
  if (hardIgnored && !laborException) return { type: "ignored", reason: "Pièce, fourniture ou total ignoré" };

  if (pricingInfo.hasNumericTable && !pricingInfo.hasLaborHourlyRate) {
    return hasLaborKeyword(normalized) ? { type: "ignored", reason: "Prix unitaire non MO" } : null;
  }
  const hoursInfo = pricingInfo.hoursInfo || extractLaborHours(text);
  if (!hoursInfo || hoursInfo.hours <= 0) {
    return hasLaborKeyword(normalized) ? { type: "ignored", reason: "Quantité MO introuvable" } : null;
  }
  const operation = sanitizeEstimateOperation(text.slice(0, hoursInfo.index) || text);
  let distributions = distributeLaborHours(operation, hoursInfo.hours, options);
  if (!distributions.length) {
    if (isConfirmedLabor) {
      const defaultPhase = options.claimType === "vidange" || /\b(VIDANGE|ENTRETIEN|FILTRE)\b/.test(normalized)
        ? "oilService"
        : options.claimType === "electrical_client"
        ? "electrical"
        : options.claimType === "mechanical_client"
        ? "mechanical"
        : "body";
      distributions = [makeDistribution(defaultPhase, operation, hoursInfo.hours)];
    } else {
      return hasLaborKeyword(normalized) ? { type: "ignored", reason: "Phase planning non reconnue" } : null;
    }
  }
  return {
    type: "labor",
    text,
    operation,
    hours: roundPlanningHours(hoursInfo.hours),
    distributions,
  };
}

function isPaintSupplyLine(normalized) {
  return /\b(PRODUITS?|FOURNITURES?|MATIERES?|MATERIEL|CONSOMMABLES?)\s+(?:DE\s+)?PEINTURE\b/.test(normalized)
    || /\bPEINTURE\s+(?:PRODUITS?|FOURNITURES?|MATIERES?|MATERIEL|CONSOMMABLES?)\b/.test(normalized);
}

function classifyEstimatePartLine(line) {
  const text = String(line || "").replace(/\s+/g, " ").trim();
  if (!text || text.length < 3) return null;
  const normalized = normalizeEstimateOperationText(text);
  if (isEstimateLegalOrFooterLine(normalized)) return null;
  if (/\b(TOTAL|TVA|TIMBRE|DEVIS|RECEPTIONNAIRE|PAGE|CODE\s+MOTEUR|TYPE\s+MAIN|N\s*OR|N\s*DEVIS)\b/.test(normalized)) return null;
  if (classifyLaborLine(text)?.type === "labor") return null;

  const pricingInfo = extractEstimatePricingInfo(text);
  if (!pricingInfo.matches.length) return null;
  if (pricingInfo.hasLaborHourlyRate) return null;
  const matches = pricingInfo.matches;
  const qtyMatch = matches[0];
  const unitMatch = matches.length >= 2 ? matches[matches.length - 2] : null;
  const amountMatch = matches.length >= 2 ? matches[matches.length - 1] : null;
  const quantity = qtyMatch?.hours || 0;
  const unitPrice = unitMatch?.hours || 0;
  const amount = amountMatch?.hours || 0;
  if (!quantity || quantity <= 0 || quantity > 999) return null;
  if (!unitPrice || !amount) return null;
  const designation = sanitizeEstimateOperation(text.slice(0, qtyMatch.index) || text);
  if (!designation || designation.length < 2) return null;
  return {
    id: uid("estimate-part"),
    designation,
    quantity: roundPlanningHours(quantity),
    unitPrice: roundPlanningHours(unitPrice),
    amount: roundPlanningHours(amount),
    rawText: text,
  };
}

function dedupeEstimatePartLines(parts) {
  const seen = new Set();
  const result = [];
  (parts || []).forEach((part) => {
    const key = [normalizeEstimateOperationText(part.designation), part.quantity, part.unitPrice, part.amount].join("|");
    if (seen.has(key)) return;
    seen.add(key);
    result.push(part);
  });
  return result;
}

function distributeLaborHours(operation, hours, options = {}) {
  const normalized = normalizeEstimateOperationText(operation);
  const cleanDetail = removeKnownOperationPrefix(operation);
  if (/\bD\s*\/\s*P\s+ET\s+PREPARAT(?:ION|IN)\b/.test(normalized)) {
    const [body, reassembly] = splitPlanningHours(hours, [0.5, 0.5]);
    return [
      makeDistribution("body", `D/P ${cleanDetail}`, body),
      makeDistribution("reassembly", `REMONTAGE ${cleanDetail}`, reassembly),
    ];
  }
  if (/\bPEINTURE\s+ET\s+F(?:I)?NITION\b/.test(normalized)) {
    const [prep, paint] = splitPlanningHours(hours, [0.5, 0.5]);
    return [
      makeDistribution("prep", `PREPARATION ${cleanDetail}`, prep),
      makeDistribution("paint", `PEINTURE ${cleanDetail}`, paint),
    ];
  }
  if (/\bDRESSAGE\b/.test(normalized)) {
    const [body, prep, paint] = splitPlanningHours(hours, [1 / 3, 1 / 3, 1 / 3]);
    return [
      makeDistribution("body", `DRESSAGE ${cleanDetail}`, body),
      makeDistribution("prep", `PREPARATION ${cleanDetail}`, prep),
      makeDistribution("paint", `PEINTURE ${cleanDetail}`, paint),
    ];
  }
  if (/\b(PASSAGE\s+SUR\s+MARBRE|MARBRE)\b/.test(normalized)) return [makeDistribution("body", operation, hours)];
  if (/\b(VIDANGE|ENTRETIEN\s+RAPIDE|SERVICE\s+RAPIDE|FILTRE|FILTRES)\b/.test(normalized)) return [makeDistribution("oilService", operation, hours)];
  const isClientOnly = typeof isClientOnlyRepairClaim === "function"
    ? isClientOnlyRepairClaim({ type: options.claimType })
    : ["client", "vidange", "mechanical_client", "electrical_client"].includes(options.claimType);
  const insuranceElectricalPattern = /\b(AIRBAGS?|DIAGNOSTIC|BATTERIE|HAUTE\s+TENSION|HV|PYROTECHNIQUE)\b/;
  const clientElectricalPattern = /\b(AIRBAGS?|DIAGNOSTIC|ELECTRIQUE|ELECTRICITE|ALTERNATEUR|DEMARREUR|BATTERIE|FAISCEAU|CAPTEUR|HAUTE\s+TENSION|HV)\b/;
  if ((isClientOnly ? clientElectricalPattern : insuranceElectricalPattern).test(normalized)) return [makeDistribution("electrical", operation, hours)];
  if (/\b(REMPLACEMENT\s+BOITE|BOITE\s+VITESSE|EMBRAYAGE|FREIN|SUSPENSION|DISTRIBUTION|MOTEUR|MECANIQUE|MECAN)\b/.test(normalized)) return [makeDistribution("mechanical", operation, hours)];
  if (/\b(CHANG(?:EMENT)?|REMP|REMPL|REMPLACEMENT)\s+(FEU|OPTIQUE|PHARE|PROJECTEUR|LANTERNE|PARE\s+BOUE|SUPPORT|AILE|PARE\s+CHOC|JUPE|MALLE|CAPOT|PORTE|SERRURE)\b/.test(normalized)) {
    return [makeDistribution("reassembly", operation, hours)];
  }
  if (/\bCHANG(?:EMENT)?\b/.test(normalized)) return [makeDistribution("reassembly", operation, hours)];
  if (/\bPREPARATION\b/.test(normalized)) return [makeDistribution("prep", operation, hours)];
  if (/\bPEINTURE\b/.test(normalized)) return [makeDistribution("paint", operation, hours)];
  if (/\bD\s*\/\s*P\b/.test(normalized)) {
    const [body, reassembly] = splitPlanningHours(hours, [0.5, 0.5]);
    return [
      makeDistribution("body", `D/P ${cleanDetail}`, body),
      makeDistribution("reassembly", `REMONTAGE ${cleanDetail}`, reassembly),
    ];
  }
  if (/\b(DEMONTAGE|DEPOSE)\b/.test(normalized)) return [makeDistribution("body", operation, hours)];
  if (/\b(REMONTAGE|REPOSE)\b/.test(normalized)) return [makeDistribution("reassembly", operation, hours)];
  if (/\bFINITION\b/.test(normalized)) return [makeDistribution("finish", operation, hours)];
  if (/\b(BOITE|VITESSE)\b/.test(normalized)) return [makeDistribution("mechanical", operation, hours)];
  if (/\b(REMP|REMPL|REMPLACEMENT)\b/.test(normalized)) return [makeDistribution("reassembly", operation, hours)];
  if (/\bREPARATION\b/.test(normalized)) return [makeDistribution("body", operation, hours)];
  return [];
}

async function applyEstimateImportToCase(item, preview) {
  if (!preview) return;
  const permissionGuard = guardEstimateImport(item);
  if (!permissionGuard.ok) return;
  const durations = normalizeEstimatePreviewDurations(preview.durations, item);
  ESTIMATE_ALLOWED_KEYS.forEach((key) => {
    item.durations[key] = roundPlanningHours(durations[key]);
  });
  applyDetectedEstimateInfo(item, preview.info);
  const previousSourceFileId = item.expertEstimate?.sourceFile?.id || "";
  item.expertEstimate = normalizeExpertEstimate({
    reference: cleanParsedEstimateNumber(preview.info.estimateNumber) || item.expertEstimate?.reference || "",
    confirmed: true,
    confirmedAt: new Date().toISOString(),
    lines: buildAppliedEstimateLines(preview),
    originalLines: buildOriginalEstimateLines(preview),
    parts: buildEstimatePartLines(preview),
    sourceFile: preview.sourceFile
      ? {
          id: preview.sourceFile.id,
          name: preview.sourceFile.name,
          type: preview.sourceFile.type,
          size: preview.sourceFile.size,
          category: preview.sourceFile.category,
          createdAt: preview.sourceFile.createdAt,
        }
      : item.expertEstimate?.sourceFile || null,
  });
  if (preview.sourceFile?.blob && typeof saveDocumentRecord === "function") {
    await saveDocumentRecord(item.id, item.expertEstimate.sourceFile, preview.sourceFile.blob);
    if (previousSourceFileId && previousSourceFileId !== item.expertEstimate.sourceFile.id && typeof deleteDocumentRecord === "function") {
      await deleteDocumentRecord(previousSourceFileId).catch(() => null);
    }
  }
  item.claims = normalizeRepairClaims(item.claims, item);
  let mainClaim = item.claims[0];
  if (!mainClaim) {
    mainClaim = normalizeRepairClaim({
      id: uid("claim"),
      number: "OT-001",
      title: preview.info?.vehicleArea || preview.info?.estimateNumber || "Intervention principale",
      vehicleArea: preview.info?.vehicleArea || "",
      estimateNumber: cleanParsedEstimateNumber(preview.info?.estimateNumber) || "",
      orNumber: item.orNavNumber || "",
      status: "draft",
      includeInPlanning: true,
    }, 0);
    item.claims.push(mainClaim);
    addHistory(item, "claim.created", "Ordre créé automatiquement", getClaimLabel(mainClaim));
  }
  await applyEstimateImportToClaim(item, mainClaim, preview, { silent: true, keepGlobalHistory: true });
  recomputeCaseDurationsFromClaims(item);
  if (typeof refreshCaseApprovalFlagsFromClaims === "function") refreshCaseApprovalFlagsFromClaims(item);
  if (typeof clearPlanningIfNeeded === "function") clearPlanningIfNeeded(item, "Planning annulé après import d'un devis modifiant les durées. Recalculez un RDV.");
  generatedProposals[item.id] = null;
  delete estimateImportPreviews[item.id];
  const details = [
    `${formatLocalizedDecimal(preview.detectedHours)} h de main-d'œuvre détectées depuis le fichier ${preview.fileName}. Répartition appliquée aux durées estimées.`,
    preview.info.estimateNumber ? `N° devis : ${preview.info.estimateNumber}` : "",
  ]
    .filter(Boolean)
    .join(" ");
  addHistory(item, "expert.estimate.imported", "Devis validé importé", details);
  saveState();
  notifyUser("Répartition appliquée aux durées estimées.");
  renderCaseDetail();
}


function cleanParsedEstimateNumber(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const normalized = normalizeEstimateOperationText(text);
  if (normalized === 'ESTIMATIF ATELIER' || normalized === 'DEVIS ESTIMATIF ATELIER' || normalized === 'ATELIER') return '';
  if (/^PAGE\s*\d+/i.test(text)) return '';
  return text;
}

async function applyEstimateImportToClaim(item, claim, preview, options = {}) {
  if (!item || !claim || !preview) return;
  if (!options.skipPermission) {
    const permissionGuard = guardEstimateImport(item);
    if (!permissionGuard.ok) return;
  }
  const previousSourceFileId = claim.estimate?.sourceFile?.id || "";
  applyDetectedEstimateInfo(item, preview.info || {});
  const parsedEstimateNumber = cleanParsedEstimateNumber(preview.info.estimateNumber);
  claim.estimateNumber = parsedEstimateNumber || claim.estimateNumber || "";
  claim.orNumber = preview.info.orNumber || claim.orNumber || item.orNavNumber || "";
  if (isClientOnlyRepairClaim(claim)) claim.expertApproved = true;
  if (claim.status !== "done") {
    claim.status = isClientOnlyRepairClaim(claim)
      ? (claim.clientApproved ? "approved" : "client_pending")
      : (claim.expertApproved ? (claim.clientApproved ? "approved" : "client_pending") : "expert_pending");
  }
  claim.estimate = normalizeExpertEstimate({
    reference: parsedEstimateNumber || claim.estimateNumber || "",
    confirmed: true,
    confirmedAt: new Date().toISOString(),
    lines: buildAppliedEstimateLines(preview),
    originalLines: buildOriginalEstimateLines(preview),
    parts: buildEstimatePartLines(preview),
    sourceFile: preview.sourceFile
      ? {
          id: preview.sourceFile.id,
          name: preview.sourceFile.name,
          type: preview.sourceFile.type,
          size: preview.sourceFile.size,
          category: preview.sourceFile.category,
          createdAt: preview.sourceFile.createdAt,
        }
      : claim.estimate?.sourceFile || null,
  });
  claim.updatedAt = new Date().toISOString();
  if (preview.sourceFile?.blob && typeof saveDocumentRecord === "function") {
    await saveDocumentRecord(item.id, claim.estimate.sourceFile, preview.sourceFile.blob);
    if (previousSourceFileId && previousSourceFileId !== claim.estimate.sourceFile.id && typeof deleteDocumentRecord === "function") {
      await deleteDocumentRecord(previousSourceFileId).catch(() => null);
    }
  }
  recomputeCaseDurationsFromClaims(item);
  if (typeof refreshCaseApprovalFlagsFromClaims === "function") refreshCaseApprovalFlagsFromClaims(item);
  if (typeof clearPlanningIfNeeded === "function") clearPlanningIfNeeded(item, "Planning annulé après import d'un devis modifiant les durées. Recalculez un RDV.");
  generatedProposals[item.id] = null;
  if (!options.silent) {
    addHistory(item, "claim.estimate.imported", "Devis ordre de réparation importé", `${getClaimLabel(claim)} - ${formatLocalizedDecimal(preview.detectedHours)} h MO`);
    saveState();
  }
}

function applyDetectedEstimateInfo(item, info) {
  const updates = [
    ["clientName", info.clientName],
    ["phone", info.phone],
    ["vehicle", info.vehicle],
    ["plate", info.plate],
    ["vin", info.vin],
    ["mileage", info.mileage],
    ["orNavNumber", info.orNumber],
  ];
  const importPlaceholders = new Set(["", "Client", "Client devis"]);
  updates.forEach(([field, value]) => {
    const current = String(item[field] || "").trim();
    if (value && importPlaceholders.has(current)) item[field] = value;
  });
}


function buildEstimatePartLines(preview) {
  return (preview.partsLines || []).map((part) => ({
    id: part.id || uid("estimate-part"),
    designation: part.designation || part.rawText || "Article devis",
    quantity: roundPlanningHours(part.quantity || 0),
    unitPrice: roundPlanningHours(part.unitPrice || 0),
    amount: roundPlanningHours(part.amount || 0),
    rawText: part.rawText || part.designation || "",
  }));
}

function buildOriginalEstimateLines(preview) {
  return (preview.laborLines || []).map((line) => ({
    id: uid("estimate-original-line"),
    operation: line.operation || line.text || "Opération devis",
    laborHours: roundPlanningHours(line.hours || 0),
    rawText: line.text || line.operation || "",
    allocations: (line.distributions || []).map((distribution) => ({
      phase: distribution.phase,
      operation: distribution.operation || line.operation || "",
      laborHours: roundPlanningHours(distribution.laborHours || 0),
    })),
  }));
}

function buildAppliedEstimateLines(preview) {
  const currentTotals = Object.fromEntries(ESTIMATE_PLANNING_KEYS.map((key) => [key, 0]));
  preview.distributedLines.forEach((line) => {
    if (line.phase in currentTotals) currentTotals[line.phase] = roundPlanningHours(currentTotals[line.phase] + Number(line.laborHours || 0));
  });
  const edited = ESTIMATE_PLANNING_KEYS.some((key) => Math.abs((preview.durations[key] || 0) - (currentTotals[key] || 0)) > 0.01);
  if (!edited) return preview.distributedLines;
  return ESTIMATE_PLANNING_KEYS
    .filter((key) => Number(preview.durations[key] || 0) > 0)
    .map((key) => ({
      id: uid("estimate-line"),
      phase: key,
      operation: `Import devis - ${getDurationLabel(key)}`,
      laborHours: roundPlanningHours(preview.durations[key]),
    }));
}

function splitEstimateSourceLines(text) {
  const source = String(text || "");
  const pdfTableRows = extractPdfContentTableRows(source);
  const columnarRows = extractColumnarEstimateRows(source);
  const dressageMarker = "DRESSAGE__ET__PEINTURE";
  const protectedSource = source.replace(/\bDRESSAGE\s+ET\s+PEINTURE\b/gi, dressageMarker);
  const expanded = protectedSource
    // Split before each real operation.  The protected dressage marker must also
    // be a split point; otherwise a consumable row like "PEINTURE 5 180,000
    // 900,000" can stay glued to the following "DRESSAGE ET PEINTURE ...
    // 8 33,000 ..." row and appear as a fake MO operation.
    .replace(/\s+(?=(?:D\/P|DRESSAGE__ET__PEINTURE|DRESSAGE|PEINTURE|PRODUITS?\s+(?:DE\s+)?PEINTURE|REMP|REMPL|REMPLACEMENT|DEPOSE|DÉPOSE|DEMONTAGE|DÉMONTAGE|REMONTAGE|REPOSE|PETIT(?:E)? FOURNITURE|ENTRETIEN|VIDANGE|FILTRE|RONDELLE|HUILE|BOUCHON|JOINT|COLLIER)\b)/gi, "\n")
    .split(/\r?\n/)
    .map((line) => line.replace(new RegExp(dressageMarker, "g"), "DRESSAGE ET PEINTURE"))
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  if (columnarRows.length) {
    return dedupeEstimateSourceRows([...pdfTableRows, ...columnarRows, ...expanded]);
  }
  if (pdfTableRows.length) return dedupeEstimateSourceRows([...pdfTableRows, ...expanded]);
  return dedupeEstimateSourceRows(expanded);
}

function dedupeEstimateSourceRows(rows) {
  const seen = new Set();
  const result = [];
  (rows || []).forEach((row) => {
    const text = String(row || "").replace(/\s+/g, " ").trim();
    if (!text) return;
    const labor = classifyLaborLine(text);
    let key = normalizeEstimateOperationText(text);
    if (labor?.type === "labor") {
      // The PDF reader can return the same operation twice from two extraction paths:
      // one complete table row (operation + qte + PU + montant) and one columnar row
      // (operation + qte + PU).  They are not exact strings, but they represent the
      // same devis line and must be applied only once.
      key = ["LABOR", normalizeEstimateOperationText(labor.operation), roundPlanningHours(labor.hours)].join("|");
    }
    if (seen.has(key)) return;
    seen.add(key);
    result.push(text);
  });
  return result;
}

function extractPdfContentTableRows(text) {
  const rows = [];
  const source = String(text || "");
  const operationPattern =
    "\\(((?:D\\s*\\/\\s*P|PEINTURE|DRESSAGE|REMP|REMPL|REMPLACEMENT|DEPOSE|DÉPOSE|DEMONTAGE|DÉMONTAGE|REMONTAGE|REPOSE|PETIT FOURNITURE)[^()]*)\\)\\s*Tj" +
    "[\\s\\S]{0,700}?\\((\\d+(?:[,.]\\d+)?)\\)\\s*Tj" +
    "[\\s\\S]{0,500}?\\((3[35][,.]000)\\)\\s*Tj" +
    "[\\s\\S]{0,500}?\\((\\d+(?:[,.]\\d+)?)\\)\\s*Tj";
  const regex = new RegExp(operationPattern, "gi");
  let match;
  while ((match = regex.exec(source))) {
    const operation = decodePdfLiteral(match[1]).replace(/\s+/g, " ").trim();
    if (!operation) continue;
    rows.push(`${operation} ${match[2]} ${match[3]} ${match[4]}`);
  }
  return [...new Set(rows)];
}

function extractColumnarEstimateRows(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const designationIndex = lines.findIndex((line) => normalizeEstimateOperationText(line) === "DESIGNATION");
  if (designationIndex < 0) return [];

  const quantityHeaderIndex = lines.findIndex((line, index) => index > designationIndex && normalizeEstimateOperationText(line) === "QTE");
  const codeModelIndex = lines.findIndex((line, index) => index > designationIndex && normalizeEstimateOperationText(line) === "CODE MODELE");
  let operationEndIndex = [quantityHeaderIndex, codeModelIndex].filter((index) => index > designationIndex).sort((a, b) => a - b)[0];
  if (!operationEndIndex) operationEndIndex = quantityHeaderIndex;
  if (!operationEndIndex || operationEndIndex <= designationIndex) return [];

  const operations = lines
    .slice(designationIndex + 1, operationEndIndex)
    .filter((line) => !/^\d+(?:[,.]\d+)?$/.test(line))
    .filter((line) => !/^(Code modèle|Qté|Prix|unitaire|Montant)$/i.test(line));
  if (!operations.length) return [];

  const headerIndexes = [quantityHeaderIndex];
  ["PRIX", "UNITAIRE", "MONTANT"].forEach((header) => {
    const found = lines.findIndex((line, index) => index > operationEndIndex && normalizeEstimateOperationText(line) === header);
    if (found >= 0) headerIndexes.push(found);
  });
  const qteStart = Math.max(...headerIndexes.filter((index) => index >= 0)) + 1;
  const numbers = lines.slice(qteStart).filter(isEstimateNumberToken);
  const quantities = numbers.slice(0, operations.length);
  if (quantities.length < operations.length) return [];

  const rows = [];
  operations.forEach((operation, index) => {
    const qty = quantities[index];
    const normalized = normalizeEstimateOperationText(operation);
    if (!qty || !hasLaborKeyword(normalized)) return;
    rows.push(`${operation} ${qty} 33,000`);
  });
  return rows;
}

function isEstimateNumberToken(value) {
  const text = String(value || "").replace(/\u00a0/g, " ").trim();
  return /^\d+(?:\s\d{3})*(?:[,.]\d+)?$/.test(text);
}

function splitRawEstimateMetadataLines(text) {
  return String(text || "")
    .replace(/\u00a0/g, " ")
    .split(/\r?\n/)
    .map((line) => String(line || "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function cleanupEstimateVehicleDescription(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text
    .replace(/^(DFM|DONGFENG|CHERY|HYUNDAI|KIA|TOYOTA|PEUGEOT|RENAULT|NISSAN|VOLKSWAGEN|MG|HAVAL|FIAT|CITROEN|MITSUBISHI|ISUZU)\s+/i, "")
    .replace(/\s+\d{1,3}(?:\s?\d{3})?\s*$/i, "")
    .trim();
}

function inferEstimateHeaderInfo(text) {
  const lines = splitRawEstimateMetadataLines(text);
  const oneLine = String(text || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  const info = {};
  const cltIndex = lines.findIndex((line) => /^CLT[-\s]?\d+/i.test(line));
  if (cltIndex >= 0) {
    info.clientNumber = lines[cltIndex];
    const clientLine = lines.slice(cltIndex + 1, cltIndex + 4).find((line) => !/^(Fax|Tel|N°|No|Devis|Date|Page)\b/i.test(line));
    if (clientLine) info.clientName = clientLine;
  }
  const telLine = lines.find((line) => /^Tel\b/i.test(line));
  if (telLine) {
    const phone = telLine.replace(/^Tel\s*[:\-]?\s*/i, "").trim();
    if (phone) info.phone = phone;
  }
  const estimateMatch = oneLine.match(/\b(DV-[A-Z0-9-]+)\b/i);
  const orMatch = oneLine.match(/\b(OR-[A-Z0-9-]+)\b/i);
  if (estimateMatch) info.estimateNumber = estimateMatch[1].toUpperCase();
  if (orMatch) info.orNumber = orMatch[1].toUpperCase();
  const plateVinMatch = oneLine.match(/\b(\d{1,6}\s*TU\s*\d{1,6})\s+([A-HJ-NPR-Z0-9]{17})\b/i);
  if (plateVinMatch) {
    info.plate = plateVinMatch[1].replace(/\s+/g, "").toUpperCase();
    info.vin = plateVinMatch[2].toUpperCase();
  }
  const brandLineIndex = lines.findIndex((line) => /^(DFM|DONGFENG|CHERY|HYUNDAI|KIA|TOYOTA|PEUGEOT|RENAULT|NISSAN|VOLKSWAGEN|MG|HAVAL|FIAT|CITROEN|MITSUBISHI|ISUZU)\b/i.test(line));
  if (brandLineIndex >= 0) {
    const vehicleRaw = lines[brandLineIndex];
    const mileageMatch = vehicleRaw.match(/\b(\d{1,3}(?:\s?\d{3})+)\b\s*$/);
    const withoutMileage = mileageMatch ? vehicleRaw.slice(0, mileageMatch.index).trim() : vehicleRaw;
    const vehicle = cleanupEstimateVehicleDescription(withoutMileage);
    if (vehicle) info.vehicle = vehicle;
    if (mileageMatch) info.mileage = mileageMatch[1].replace(/\s+/g, "");
  }
  return info;
}

function extractEstimateInfo(text, lines = splitEstimateSourceLines(text)) {
  const value = (aliases) => findEstimateLabelValue(lines, aliases);
  const headerInfo = inferEstimateHeaderInfo(text);
  return {
    clientName: value(["client"]) || headerInfo.clientName || "",
    clientNumber: value(["n client", "no client", "numero client", "numéro client"]) || headerInfo.clientNumber || "",
    phone: value(["telephone", "téléphone", "tel"]) || headerInfo.phone || "",
    estimateNumber: value(["n devis", "no devis", "numero devis", "numéro devis", "devis"]) || headerInfo.estimateNumber || "",
    orNumber: value(["n or", "no or", "numero or", "numéro or"]) || headerInfo.orNumber || "",
    estimateDate: value(["date devis", "date"]),
    receptionist: value(["receptionnaire", "réceptionnaire"]),
    vehicle: value(["vehicule", "véhicule"]) || headerInfo.vehicle || "",
    mileage: value(["kilometrage", "kilométrage"]) || headerInfo.mileage || "",
    plate: value(["immatriculation", "matricule"]) || headerInfo.plate || "",
    vin: value(["vin", "chassis", "châssis"]) || headerInfo.vin || "",
    firstRegistration: value(["premiere immatriculation", "première immatriculation"]),
  };
}

function findEstimateLabelValue(lines, aliases) {
  const normalizedAliases = aliases.map(normalizeHeader).sort((a, b) => b.length - a.length);
  for (const line of lines) {
    const compact = line.replace(/\s+/g, " ").trim();
    const normalized = normalizeHeader(compact);
    const alias = normalizedAliases.find((item) => normalized === item || normalized.startsWith(`${item} `));
    if (!alias) continue;
    const labelPattern = aliases
      .map((item) => item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("|");
    const match = compact.match(new RegExp(`^(?:${labelPattern})\\s*[:\\-]?\\s*(.+)$`, "i"));
    const raw = match?.[1] || compact.split(/[:\-]/).slice(1).join("-").trim();
    if (raw) return raw.trim();
  }
  return "";
}

function hasLaborKeyword(normalized) {
  return /\b(D\s*\/\s*P|CHANG(?:EMENT)?|DEPOSE|POSE|REPOSE|DEMONTAGE|REMONTAGE|PREPARAT(?:ION|IN)|PEINTURE|F(?:I)?NITION|DRESSAGE|MARBRE|REMPLACEMENT|REMPL|REMP|REPARATION|CONTROLE|DIAGNOSTIC|AIRBAGS?|BOITE|VITESSE|VIDANGE|ENTRETIEN|ELECTRIQUE|ELECTRICITE|MECANIQUE|MECAN|EMBRAYAGE|FREIN|SUSPENSION|DISTRIBUTION|MOTEUR)\b/.test(normalized);
}

function isEstimateLegalOrFooterLine(normalized) {
  const text = String(normalized || "").replace(/\s+/g, " ").trim();
  if (!text) return false;
  const legalPatterns = [
    /\bCE\s+DEVIS\s+RESTE\s+ESTIMATIF\b/,
    /\bDEVIS\s+COMPLEMENTAIRE\b/,
    /\bCONFIRMATION\s+DE\s+LA\s+PART\s+DU\s+CLIENT\b/,
    /\bSIGNATURE\s+DU\s+PRESENT\s+DEVIS\b/,
    /\bENGAGEMENT\s+DES\s+TRAVAUX\b/,
    /\bEN\s+CAS\s+D\s+ANNULATION\s+DES\s+TRAVAUX\b/,
    /\bCLIENT\s+EST\s+OBLIGE\b/,
    /\bSUPERSTRUCTURE\s+DE\s+CHARGE\b/,
    /\bPNEUMATIQUES\b/,
    /\bBATTERIES\b/,
    /\bPAYER\s+LES\s+FRAIS\b/,
    /\bFRAIS\s+DE\s+DEMONTAGE\b/,
    /\bFRAIS\s+D\s+ETABLISSEMENT\s+DU\s+DEVIS\b/,
    /\bRECUPERER\s+LE\s+VEHICULE\b/,
    /\b48\s*H\b/,
    /\bSTATIONNEMENT\b/,
    /\b30\s*DT\b/,
    /\bSAUF\s+VENTE\s+ENTRE\s+TEMPS\b/,
    /\bVALABLE\s+SEPT\s+7\s+JOURS\b/,
    /\bLU\s+ET\s+APPROUVE\b/,
    /\bNOM\s+PRENOM\b/,
    /\bIDENTIFIANT\s+CIN\b/,
    /\bCACHET\s+ET\s+SIGNATURE\b/,
  ];
  return legalPatterns.some((pattern) => pattern.test(text));
}

function extractEstimatePricingInfo(line) {
  const source = String(line || "");
  const matches = getEstimateNumberMatches(source);
  const result = {
    matches,
    hasNumericTable: matches.length >= 3,
    hasLaborHourlyRate: false,
    hourlyRate: 0,
    hoursInfo: null,
  };
  for (let index = 1; index < matches.length; index += 1) {
    // If we have 3 or more numbers, the last number is the line total amount.
    // In a parts line (e.g. Qty 2, PU 16.5, Total 33), the total might match 33/35 TND,
    // but it is not the hourly rate. The hourly rate must always be the unit price (non-last match).
    if (index === matches.length - 1 && matches.length >= 3) {
      continue;
    }
    const current = matches[index];
    const previous = matches[index - 1];
    if (isEstimateLaborHourlyRate(current.hours) && previous.hours > 0 && previous.hours <= ESTIMATE_LABOR_MAX_HOURS) {
      result.hasLaborHourlyRate = true;
      result.hourlyRate = current.hours;
      result.hoursInfo = previous;
      return result;
    }
  }
  return result;
}

function getEstimateNumberMatches(line) {
  const source = String(line || "");
  return [...source.matchAll(/\d+(?:[\s\u00a0]\d{3})*(?:[,.]\d+)?|\d+(?:[,.]\d+)?/g)]
    .map((match) => {
      const index = match.index || 0;
      const before = source[index - 1] || "";
      const after = source[index + match[0].length] || "";
      return {
        raw: match[0],
        index,
        hours: parseEstimateNumber(match[0]),
        embeddedInWord: /[A-Za-zÀ-ÿ]/.test(before) || /[A-Za-zÀ-ÿ]/.test(after),
      };
    })
    .filter((match) => Number.isFinite(match.hours) && !match.embeddedInWord);
}

function isEstimateLaborHourlyRate(value) {
  const rates = (typeof state !== "undefined" && state?.settings?.estimateLaborHourlyRates) || ESTIMATE_LABOR_HOURLY_RATES;
  return rates.some((rate) => Math.abs(Number(value || 0) - rate) < 0.01);
}

function extractLaborHours(line) {
  const matches = getEstimateNumberMatches(line);
  if (!matches.length) return null;

  // Dans les devis atelier NIMR/Sage, une ligne MO fiable est : OPERATION | Qté | Prix unitaire | Montant.
  // Le prix unitaire MO est le critère le plus sûr : 33,000 ou 35,000 DT/h.
  // On prend donc la quantité située juste avant ce prix, ce qui évite de confondre une pièce avec une MO.
  const pricingInfo = extractEstimatePricingInfo(line);
  if (pricingInfo.hoursInfo) return pricingInfo.hoursInfo;

  // Fallback réservé aux saisies manuelles / CSV sans prix unitaire.
  return matches.find((match) => match.hours > 0 && match.hours <= 40) || null;
}

function sanitizeEstimateOperation(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/[:;\-]+$/g, "")
    .trim();
}

function removeKnownOperationPrefix(operation) {
  const withoutPrefix = String(operation || "")
    .replace(/^\s*D\s*\/\s*P\s+ET\s+PREPARAT(?:ION|IN)\s*/i, "")
    .replace(/^\s*PEINTURE\s+ET\s+F(?:I)?NITION\s*/i, "")
    .replace(/^\s*DRESSAGE\s+ET\s+PEINTURE\s*/i, "")
    .trim();
  return withoutPrefix || operation;
}

function makeDistribution(phase, operation, laborHours) {
  return {
    phase,
    operation: sanitizeEstimateOperation(operation),
    laborHours: roundPlanningHours(laborHours),
  };
}

function splitPlanningHours(total, weights) {
  const rounded = [];
  let consumed = 0;
  weights.forEach((weight, index) => {
    if (index === weights.length - 1) {
      rounded.push(roundPlanningHours(total - consumed));
      return;
    }
    const value = roundPlanningHours(total * weight);
    rounded.push(value);
    consumed += value;
  });
  return rounded;
}

function parseEstimateNumber(value) {
  let normalized = String(value ?? "")
    .replace(/\u00a0/g, " ")
    .trim();
  if (!normalized) return 0;
  const comma = normalized.lastIndexOf(",");
  const dot = normalized.lastIndexOf(".");
  normalized = normalized.replace(/\s/g, "");
  if (comma >= 0 && dot >= 0) {
    normalized = comma > dot ? normalized.replace(/\./g, "").replace(",", ".") : normalized.replace(/,/g, "");
  } else if (comma >= 0) {
    normalized = normalized.replace(",", ".");
  }
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeEstimateOperationText(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, " ")
    .replace(/[^a-zA-Z0-9/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function roundPlanningHours(value) {
  return Math.round(Number(value || 0) * 1000000) / 1000000;
}

async function extractPdfText(buffer) {
  const pdfjsText = await extractPdfTextWithPdfJs(buffer);
  if (isUsableEstimatePdfText(pdfjsText)) return pdfjsText;
  return extractPdfTextFallback(buffer);
}

async function extractPdfTextWithPdfJs(buffer) {
  if (!window.pdfjsLib?.getDocument) return "";
  try {
    window.pdfjsLib.GlobalWorkerOptions = window.pdfjsLib.GlobalWorkerOptions || {};
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.min.js";
    const pdf = await window.pdfjsLib.getDocument({ data: buffer }).promise;
    const pages = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const positioned = content.items
        .map((item) => ({
          text: item.str || "",
          x: Number(item.transform?.[4] || 0),
          y: Number(item.transform?.[5] || 0),
        }))
        .filter((item) => item.text.trim());
      pages.push(buildPdfTextLines(positioned));
      pages.push(positioned.map((item) => item.text).join(" "));
    }
    return pages.join("\n");
  } catch (error) {
    console.warn("Extraction PDF.js impossible, fallback local utilisé", error);
    return "";
  }
}

function buildPdfTextLines(items) {
  const rows = [];
  items
    .slice()
    .sort((a, b) => b.y - a.y || a.x - b.x)
    .forEach((item) => {
      const row = rows.find((candidate) => Math.abs(candidate.y - item.y) <= 2);
      if (row) {
        row.items.push(item);
        row.y = (row.y + item.y) / 2;
      } else {
        rows.push({ y: item.y, items: [item] });
      }
    });
  return rows
    .sort((a, b) => b.y - a.y)
    .map((row) =>
      row.items
        .sort((a, b) => a.x - b.x)
        .map((item) => item.text)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean)
    .join("\n");
}

async function extractPdfTextFallback(buffer) {
  const bytes = new Uint8Array(buffer);
  const raw = new TextDecoder("latin1").decode(bytes);
  const chunks = [raw];
  const streamRegex = /stream\r?\n/g;
  let match;
  while ((match = streamRegex.exec(raw))) {
    const start = match.index + match[0].length;
    const end = raw.indexOf("endstream", start);
    if (end < 0) break;
    const dictionary = raw.slice(Math.max(0, match.index - 1200), match.index);
    const streamBytes = bytes.slice(start, raw[end - 1] === "\r" || raw[end - 1] === "\n" ? end - 1 : end);
    if (/\/FlateDecode\b/.test(dictionary) && "DecompressionStream" in window) {
      const inflated = await inflatePdfStream(streamBytes);
      if (inflated) chunks.push(inflated);
    } else {
      chunks.push(new TextDecoder("latin1").decode(streamBytes));
    }
  }
  const decoded = decodePdfTextFragments(chunks.join("\n"));
  if (!isUsableEstimatePdfText(decoded)) return "";
  return decoded;
}

function isUsableEstimatePdfText(text) {
  const normalized = normalizeEstimateOperationText(text);
  return /\b(CLIENT|DEVIS|D\s*\/\s*P|PEINTURE|DRESSAGE|REMPLACEMENT|REMP|IMMATRICULATION|VIN|VEHICULE)\b/.test(normalized);
}

async function inflatePdfStream(bytes) {
  for (const mode of ["deflate", "deflate-raw"]) {
    try {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(mode));
      return new TextDecoder("latin1").decode(await new Response(stream).arrayBuffer());
    } catch (error) {
      // Try the next deflate flavor.
    }
  }
  return "";
}

function decodePdfTextFragments(text) {
  const pieces = [];
  [...String(text || "").matchAll(/\((?:\\.|[^\\)])*\)/g)].forEach((match) => {
    const decoded = decodePdfLiteral(match[0].slice(1, -1));
    if (decoded.trim().length > 1) pieces.push(decoded);
  });
  [...String(text || "").matchAll(/<([0-9A-Fa-f\s]{4,})>/g)].forEach((match) => {
    const decoded = decodePdfHex(match[1]);
    if (decoded.trim().length > 1) pieces.push(decoded);
  });
  const fallback = String(text || "")
    .replace(/[^\x20-\x7EÀ-ÿ\r\n]/g, " ")
    .replace(/\s+/g, " ");
  return [...pieces, fallback].join("\n").replace(/\s+\n/g, "\n");
}

function decodePdfLiteral(value) {
  return String(value || "")
    .replace(/\\([()\\])/g, "$1")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\n")
    .replace(/\\t/g, " ")
    .replace(/\\([0-7]{1,3})/g, (_, octal) => String.fromCharCode(Number.parseInt(octal, 8)));
}

function decodePdfHex(value) {
  const hex = String(value || "").replace(/\s/g, "");
  const bytes = [];
  for (let index = 0; index < hex.length - 1; index += 2) {
    bytes.push(Number.parseInt(hex.slice(index, index + 2), 16));
  }
  return new TextDecoder("latin1").decode(new Uint8Array(bytes));
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && quoted && next === '"') {
      value += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if ((char === "," || char === ";") && !quoted) {
      row.push(value);
      value = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
    } else {
      value += char;
    }
  }
  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }
  return rows.filter((items) => items.some((cell) => String(cell).trim()));
}

async function unzipXlsx(buffer) {
  const view = new DataView(buffer);
  const eocdOffset = findEndOfCentralDirectory(view);
  const entryCount = view.getUint16(eocdOffset + 10, true);
  let centralOffset = view.getUint32(eocdOffset + 16, true);
  const entries = new Map();
  for (let index = 0; index < entryCount; index += 1) {
    if (view.getUint32(centralOffset, true) !== 0x02014b50) throw new Error("Archive XLSX invalide.");
    const method = view.getUint16(centralOffset + 10, true);
    const compressedSize = view.getUint32(centralOffset + 20, true);
    const nameLength = view.getUint16(centralOffset + 28, true);
    const extraLength = view.getUint16(centralOffset + 30, true);
    const commentLength = view.getUint16(centralOffset + 32, true);
    const localOffset = view.getUint32(centralOffset + 42, true);
    const name = decodeBytes(new Uint8Array(buffer, centralOffset + 46, nameLength));
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.slice(dataStart, dataStart + compressedSize);
    entries.set(name, await decodeZipEntry(compressed, method));
    centralOffset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function findEndOfCentralDirectory(view) {
  for (let offset = view.byteLength - 22; offset >= Math.max(0, view.byteLength - 66000); offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) return offset;
  }
  throw new Error("Fichier XLSX invalide.");
}

async function decodeZipEntry(buffer, method) {
  if (method === 0) return decodeBytes(new Uint8Array(buffer));
  if (method !== 8) throw new Error("Méthode de compression XLSX non supportée.");
  if (!("DecompressionStream" in window)) {
    throw new Error("Votre navigateur ne peut pas décompresser ce XLSX. Exportez-le en CSV ou utilisez Chrome/Edge récent.");
  }
  const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return decodeBytes(new Uint8Array(await new Response(stream).arrayBuffer()));
}

function decodeBytes(bytes) {
  return new TextDecoder("utf-8").decode(bytes);
}

function parseSharedStrings(xml) {
  if (!xml) return [];
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  return [...doc.getElementsByTagName("si")].map((si) => [...si.getElementsByTagName("t")].map((node) => node.textContent || "").join(""));
}

function parseWorksheet(xml, sharedStrings) {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  return [...doc.getElementsByTagName("row")].map((row) => {
    const cells = [];
    [...row.getElementsByTagName("c")].forEach((cell) => {
      const ref = cell.getAttribute("r") || "";
      const column = columnIndex(ref.replace(/\d+/g, ""));
      cells[column] = readCellValue(cell, sharedStrings);
    });
    return cells.map((value) => value || "");
  });
}

function readCellValue(cell, sharedStrings) {
  const type = cell.getAttribute("t");
  if (type === "inlineStr") return cell.getElementsByTagName("t")[0]?.textContent || "";
  const raw = cell.getElementsByTagName("v")[0]?.textContent || "";
  if (type === "s") return sharedStrings[Number(raw)] || "";
  return raw;
}

function columnIndex(letters) {
  return [...letters].reduce((sum, letter) => sum * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}
