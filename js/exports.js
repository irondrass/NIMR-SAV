function renderDossierExport(root, item) {
  const target = $(`[data-field='dossier-export-summary']`, root);
  if (!target) return;
  const photoCount = item.photos?.length || 0;
  const bookingCount = state.bookings.filter((booking) => booking.caseId === item.id).length;
  target.textContent = `Prépare un dossier ZIP compatible Windows avec ${photoCount} photo${photoCount > 1 ? "s" : ""}, ${bookingCount} affectation${bookingCount > 1 ? "s" : ""} planning et les PDF de suivi du dossier.`;
}

function isPrintableWorkBooking(booking) {
  return Boolean(
    booking
      && booking.type !== "leave"
      && booking.caseId
      && booking.caseId !== "__leave__"
      && booking.temporary !== true
      && !booking.deletedAt
      && booking.status !== "cancelled"
  );
}

function isArchivedCaseForOperationalPrint(item) {
  return typeof isCaseOperationallyClosed === "function" ? isCaseOperationallyClosed(item) : Boolean(item?.flags?.delivered || item?.flags?.invoiced || item?.closedAt);
}

function isActivePrintableWorkBooking(booking, item = null) {
  if (!isPrintableWorkBooking(booking)) return false;
  const caseItem = item || state.cases.find((candidate) => candidate.id === booking.caseId);
  return !isArchivedCaseForOperationalPrint(caseItem);
}

async function markAppointmentNoShow(item) {
  const permissionGuard = guardAppointmentSchedule(item);
  if (!permissionGuard.ok) return;
  if (!item.appointment) {
    notifyUser("Aucun RDV fixé pour ce dossier.");
    return;
  }
  if (item.flags.received) {
    notifyUser("Le véhicule est déjà réceptionné. Impossible de marquer ce RDV comme manqué.");
    return;
  }
  const confirmed = await showConfirmModal("Marquer ce RDV comme manqué ? Les créneaux planning seront libérés et le dossier restera disponible pour un report.");
  if (!confirmed) return;
  state.bookings = state.bookings.filter((booking) => booking.caseId !== item.id);
  item.appointmentStatus = "no_show";
  addHistory(item, "appointment.no_show", "Client absent au RDV", `RDV initial: ${formatDateTime(item.appointment.start)}`);
  saveState({ changedCase: item });
  render();
}

async function rescheduleAppointment(item) {
  const permissionGuard = guardAppointmentSchedule(item);
  if (!permissionGuard.ok) return;
  if (!item.appointment) {
    notifyUser("Aucun RDV à reporter. Calculez d'abord un RDV.");
    return;
  }
  if (item.flags.received) {
    notifyUser("Le véhicule est déjà réceptionné. Le RDV ne peut plus être reporté.");
    return;
  }
  const confirmed = await showConfirmModal("Reporter ce RDV ? L'ancien créneau sera libéré. Cliquez ensuite sur Calculer RDV pour choisir une nouvelle date.");
  if (!confirmed) return;
  const oldStart = item.appointment.start;
  clearCasePlanning(item, `RDV reporté: ancien RDV ${formatDateTime(oldStart)} libéré`);
  item.appointmentStatus = "reschedule_pending";
  addHistory(item, "appointment.reschedule_pending", "Report de RDV demandé", `Ancien RDV: ${formatDateTime(oldStart)}`);
  saveState({ changedCase: item });
  renderCaseDetail();
}

async function exportCaseFolder(item) {
  return exportCaseFolderZip(item, { clientOnly: false });
}

async function exportClientFolder(item) {
  return exportCaseFolderZip(item, { clientOnly: true });
}

function buildOperationalCaseExport(item) {
  const bookings = (state.bookings || [])
    .filter((booking) => booking.caseId === item.id && booking.type !== "leave" && booking.temporary !== true)
    .map((booking) => ({
      id: booking.id,
      title: booking.title,
      key: booking.key,
      status: typeof getBookingOperationalStatus === "function" ? getBookingOperationalStatus(booking) : booking.status,
      plannedStart: booking.plannedStart || booking.start || null,
      plannedEnd: booking.plannedEnd || booking.end || null,
      actualStart: booking.actualStart || booking.startedAt || null,
      actualEnd: booking.actualEnd || booking.completedAt || null,
      plannedMinutes: Number(booking.plannedMinutes || 0),
      actualWorkedMinutes: Number(booking.actualWorkedMinutes || 0),
      resourceIds: Array.isArray(booking.resourceIds) ? [...booking.resourceIds] : [],
      equipmentResourceIds: Array.isArray(booking.equipmentResourceIds) ? [...booking.equipmentResourceIds] : [],
      dependencies: Array.isArray(booking.dependencies) ? [...booking.dependencies] : [],
      subcontracting: booking.subcontracting && typeof booking.subcontracting === "object"
        ? { ...booking.subcontracting }
        : null,
      blockReason: booking.blockReason || "",
      notes: Array.isArray(booking.notes) ? booking.notes.map((note) => ({ ...note })) : [],
    }));
  const laborTasks = (item.claims || []).flatMap((claim) => {
    const lines = claim.estimate?.originalLines?.length ? claim.estimate.originalLines : (claim.estimate?.lines || []);
    return lines.map((line) => ({
      id: line.id || "",
      order: claim.number || "",
      operation: line.operation || line.rawText || "",
      phase: line.phase || line.allocations?.[0]?.phase || "",
      requiredRole: line.requiredRole || line.allocations?.[0]?.requiredRole || "",
      laborHours: Number(line.laborHours || 0),
      status: line.status || "",
      source: line.source || item.source || "",
      dependencies: Array.isArray(line.dependencies) ? [...line.dependencies] : [],
    }));
  });
  return {
    schema: "nimr-sav-operational-case-v1",
    exportedAt: new Date().toISOString(),
    case: {
      id: item.id,
      source: item.source || "",
      importedAt: item.importedAt || null,
      createdAt: item.createdAt || null,
      closedAt: item.closedAt || null,
      archivedAt: item.archivedAt || null,
      clientName: item.clientName || "À compléter",
      phone: item.phone || "",
      vehicle: item.vehicle || "À compléter",
      plate: item.plate || "",
      vin: item.vin || "",
      mileage: item.mileage || "",
      orNavNumber: item.orNavNumber || "",
      pdfImportStatus: item.pdfImportStatus || "",
      durations: { ...(item.durations || {}) },
      deliveryEstimate: item.deliveryEstimate ? JSON.parse(JSON.stringify(item.deliveryEstimate)) : null,
      subcontracting: item.subcontracting ? JSON.parse(JSON.stringify(item.subcontracting)) : null,
      history: Array.isArray(item.history) ? item.history.map((entry) => ({ ...entry })) : [],
    },
    laborTasks,
    bookings,
  };
}

function getExportPhotoFolderName(category) {
  const normalized = normalizePhotoCategory(category);
  const folders = {
    before: "Avant_reparation",
    during: "En_cours",
    after: "Apres_reparation",
    supplement: "Complement_avant_accord",
  };
  return folders[normalized] || "Divers";
}

async function exportCaseFolderZip(item, { clientOnly = false } = {}) {
  try {
    const folder = sanitizeFilename(`${item.clientName || "Client"}_${item.plate || item.vin || item.id}${clientOnly ? "_client" : ""}`);
    const hasClaims = Array.isArray(item.claims) && item.claims.length > 0;
    const files = hasClaims
      ? [
          { path: `${folder}/00_Dossier_global/`, data: new Uint8Array(), type: "application/x-directory" },
          { path: `${folder}/Ordres_SAV/`, data: new Uint8Array(), type: "application/x-directory" },
          { path: `${folder}/Photos_globales/`, data: new Uint8Array(), type: "application/x-directory" },
          { path: `${folder}/Photos_globales/Avant_reparation/`, data: new Uint8Array(), type: "application/x-directory" },
          { path: `${folder}/Photos_globales/En_cours/`, data: new Uint8Array(), type: "application/x-directory" },
          { path: `${folder}/Photos_globales/Apres_reparation/`, data: new Uint8Array(), type: "application/x-directory" },
          { path: `${folder}/Photos_globales/Complement_avant_accord/`, data: new Uint8Array(), type: "application/x-directory" },
          { path: `${folder}/Photos_globales/Divers/`, data: new Uint8Array(), type: "application/x-directory" },
        ]
      : [
          { path: `${folder}/Photos/Avant_reparation/`, data: new Uint8Array(), type: "application/x-directory" },
          { path: `${folder}/Photos/En_cours/`, data: new Uint8Array(), type: "application/x-directory" },
          { path: `${folder}/Photos/Apres_reparation/`, data: new Uint8Array(), type: "application/x-directory" },
          { path: `${folder}/Photos/Complement_avant_accord/`, data: new Uint8Array(), type: "application/x-directory" },
          { path: `${folder}/Photos/Divers/`, data: new Uint8Array(), type: "application/x-directory" },
          { path: `${folder}/PDF/`, data: new Uint8Array(), type: "application/x-directory" },
        ];
    const pdfRoot = hasClaims ? `${folder}/00_Dossier_global` : `${folder}/PDF`;
    const addPdf = (name, lines) => {
      files.push({ path: `${pdfRoot}/${name}.pdf`, data: createSimplePdf(lines), type: "application/pdf" });
    };
    for (const claim of item.claims || []) {
      const claimFolder = `${folder}/Ordres_SAV/${sanitizeFilename(`${claim.number || 'OT'}_${claim.title || 'Ordre'}`)}`;
      files.push({ path: `${claimFolder}/`, data: new Uint8Array(), type: "application/x-directory" });
      files.push({ path: `${claimFolder}/Photos/`, data: new Uint8Array(), type: "application/x-directory" });
      files.push({ path: `${claimFolder}/01_Fiche_ordre.pdf`, data: createSimplePdf(buildClaimPdfLines(item, claim)), type: "application/pdf" });
    }

    addPdf("00_Fiche_reception_vehicule", buildReceptionPdfLines(item));
    addPdf("01_Devis_initial", buildEstimatePdfLines(item));
    addPdf("02_Affectations_planning", buildPlanningPdfLines(item));
    if (!clientOnly) {
      addPdf("03_Logs_dossier", buildLogsPdfLines(item));
      files.push({ path: `${folder}/dossier_atelier.json`, data: new TextEncoder().encode(JSON.stringify(buildOperationalCaseExport(item), null, 2)), type: "application/json" });
    }

    for (const photo of item.photos || []) {
      const record = await getPhotoRecord(photo.id).catch(() => null);
      if (!record?.blob) continue;
      const bytes = new Uint8Array(await record.blob.arrayBuffer());
      const ext = extensionForPhoto(photo.name, photo.type || record.blob.type);
      const category = getExportPhotoFolderName(photo.category);
      const photoRoot = hasClaims ? `${folder}/Photos_globales` : `${folder}/Photos`;
      files.push({ path: `${photoRoot}/${category}/${sanitizeFilename(photo.name || photo.id)}${ext}`, data: bytes, type: photo.type || record.blob.type || "application/octet-stream" });
    }

    const zip = createZip(files);
    downloadBlob(zip, `${folder}.zip`, "application/zip");
    const label = clientOnly ? "Dossier client exporté" : "Dossier Windows exporté";
    addHistory(item, clientOnly ? "case.client_folder.exported" : "case.folder.exported", label, `${files.length} fichier${files.length > 1 ? "s" : ""} généré${files.length > 1 ? "s" : ""}`);
    saveState({ changedCase: item });
    renderCaseDetail();
  } catch (error) {
    console.error(error);
    notifyUser("Export du dossier impossible. Vérifiez les photos et réessayez.", "error");
  }
}


function buildClaimPdfLines(item, claim) {
  const estimateLines = claim.estimate?.originalLines || [];
  const appliedLines = claim.estimate?.lines || [];
  return [
    ...buildCommonPdfHeader(item, `FICHE ORDRE SAV - ${claim.number || ''}`, "Document interne atelier"),
    `Véhicule: ${item.vehicle || ''} - ${item.plate || ''}`,
    `Libellé: ${claim.title || ''}`,
    `Zone: ${claim.vehicleArea || ''}`,
    `Type: ${claim.type || ''}`,
    `Statut: ${CLAIM_STATUS_LABELS?.[claim.status] || claim.status || ''}`,
    `N° devis: ${claim.estimateNumber || claim.estimate?.reference || ''}`,
    `N° ordre: ${claim.orNumber || ''}`,
    `Inclus planning global: ${claim.includeInPlanning !== false ? 'Oui' : 'Non'}`,
    '',
    'LIGNES MAIN-D\'OEUVRE',
    ...(estimateLines.length
      ? estimateLines.map((line) => `${line.operation || line.rawText || 'Opération'} - ${formatLocalizedDecimal(line.laborHours || 0)} h`)
      : appliedLines.map((line) => `${getDurationLabel(line.phase)} - ${line.operation || ''} - ${formatLocalizedDecimal(line.laborHours || 0)} h`)),
    '',
    'PIÈCES / ARTICLES IMPORTÉS',
    ...((claim.estimate?.parts || []).length
      ? claim.estimate.parts.map((part) => `${part.designation || 'Article'} - Qté ${formatLocalizedDecimal(part.quantity || 0)}`)
      : ['Aucune pièce importée.']),
  ];
}

async function deleteActiveCase(item) {
  if (!item) return;
  if (isCaseReadonlyArchive(item)) {
    notifyUser(getArchivedCaseMessage(item), "error");
    return;
  }
  const permissionGuard = guardSensitiveAction("case.delete", { item });
  if (!permissionGuard.ok) return;
  const confirmed = await showConfirmModal("Cette action supprimera définitivement le dossier, son historique, ses photos et ses réservations planning. Continuer ?");
  if (!confirmed) return;
  const typedOk = await showPromptModal("Pour confirmer la suppression définitive, tapez SUPPRIMER :", "SUPPRIMER");
  if (!typedOk) {
    notifyUser("Suppression annulée.");
    return;
  }
  try {
    addAuditLog("case.deleted", "Dossier supprimé", `${item.clientName || "Client"} - ${item.plate || item.vin || item.id}`, { item });
    await Promise.all((item.photos || []).map((photo) => deletePhotoRecord(photo.id).catch(() => null)));
    
    // Nettoyer les documents associés dans IndexedDB
    const docsToDelete = [];
    if (item.expertEstimate?.sourceFile?.id) {
      docsToDelete.push(item.expertEstimate.sourceFile.id);
    }
    (item.claims || []).forEach((claim) => {
      if (claim.estimate?.sourceFile?.id) {
        docsToDelete.push(claim.estimate.sourceFile.id);
      }
    });
    if (docsToDelete.length && typeof deleteDocumentRecord === "function") {
      await Promise.all(docsToDelete.map((docId) => deleteDocumentRecord(docId).catch(() => null)));
    }

    revokePhotoUrlsForCase(item);
    if (typeof markEntityCaseDeleted === "function") markEntityCaseDeleted(item);
    state.bookings.filter((booking) => booking.caseId === item.id).forEach((booking) => {
      if (typeof markEntityBookingDeleted === "function") markEntityBookingDeleted(booking.id);
    });
    state.bookings = state.bookings.filter((booking) => booking.caseId !== item.id);
    state.cases = state.cases.filter((caseItem) => caseItem.id !== item.id);
    if (activeCaseId === item.id) activeCaseId = state.cases[0]?.id || null;
    delete generatedProposals[item.id];
    delete estimateImportPreviews[item.id];
    
    // Déclencher un nettoyage des orphelins en arrière-plan
    if (typeof cleanupOrphanedStorage === "function") {
      cleanupOrphanedStorage().catch(() => null);
    }

    saveState();
    if (typeof flushSupabaseBackup === "function") await flushSupabaseBackup("case-deleted");
    notifyUser("Dossier supprimé définitivement.");
    render();
  } catch (error) {
    console.error("Suppression dossier impossible", error);
    notifyUser("Suppression du dossier impossible. Vérifiez le stockage local.", "error");
  }
}

const PRINT_WORKSHOP_SUBTITLE = "Service Après-Vente Automobile";
const PRINT_WORKSHOP_SCOPE = "Planning atelier global";

function getPrintStatusLabel(item) {
  return statusLabels[getCaseStatus(item)] || getCaseStatus(item) || "-";
}

function getPrintOrderReference(item) {
  const summary = getClaimReferenceSummary(item, "or");
  if (summary && summary !== "-") return summary;
  return item.orNavNumber || item.id || "-";
}

function getPrintCaseReference(item) {
  return item.internalNumber || getPrintOrderReference(item) || item.plate || item.vin || item.id || "-";
}

function getPrintDocumentTypeLabel(type) {
  return type || "Document interne atelier";
}

function getPrintHeaderMetaLines(item, type) {
  return [
    WORKSHOP_NAME,
    PRINT_WORKSHOP_SUBTITLE,
    PRINT_WORKSHOP_SCOPE,
    getPrintDocumentTypeLabel(type),
    `Référence dossier: ${getPrintCaseReference(item)}`,
    `Réf. OR: ${getPrintOrderReference(item)}`,
    `Imprimé le: ${formatDateTime(new Date())}`,
    `Statut dossier: ${getPrintStatusLabel(item)}`,
  ];
}

function buildCommonPdfHeader(item, title, type = "Document interne atelier") {
  return [
    ...getPrintHeaderMetaLines(item, type),
    title,
    "",
    `Dossier: ${item.clientName || ""}`,
    `Téléphone client: ${item.phone || ""}`,
    `Propriétaire / société: ${item.ownerName || ""}`,
    `Personne déposante: ${item.driverName || ""}`,
    `Téléphone déposant: ${item.driverPhone || ""}`,
    `Véhicule: ${item.vehicle || ""}`,
    `Immatriculation: ${item.plate || ""}`,
    `Kilométrage: ${item.mileage ? `${item.mileage} km` : ""}`,
    `VIN: ${item.vin || ""}`,
    `Créé le: ${formatDateTime(item.createdAt)}`,
    `Statut: ${getPrintStatusLabel(item)}`,
    "",
  ];
}

function renderPrintHeaderHtml(title, item, type = "Document interne atelier", extraLines = []) {
  return `
    <header>
      <div>
        <h1>${escapeHtml(title)}</h1>
        <p class="muted">${escapeHtml(WORKSHOP_NAME)} · ${escapeHtml(PRINT_WORKSHOP_SUBTITLE)}</p>
        <p>${escapeHtml(PRINT_WORKSHOP_SCOPE)}</p>
        <p><strong>Type :</strong> ${escapeHtml(getPrintDocumentTypeLabel(type))}</p>
        <p><strong>Référence dossier :</strong> ${escapeHtml(getPrintCaseReference(item))}</p>
        <p><strong>Réf. OR :</strong> ${escapeHtml(getPrintOrderReference(item))}</p>
      </div>
      <div class="right">
        <p><strong>Imprimé le :</strong> ${formatDateTime(new Date())}</p>
        <p><strong>Statut dossier :</strong> ${escapeHtml(getPrintStatusLabel(item))}</p>
        ${extraLines.map((line) => `<p>${line}</p>`).join("")}
      </div>
    </header>
  `;
}

function getPartsBlockerPdfLines(item) {
  const partsStatus = PARTS_STATUS_LABELS[normalizePartsStatus(item.partsStatus)] || "Non vérifié";
  const blockerReason = BLOCKER_REASON_LABELS[normalizeBlockerReason(item.blockerReason)] || "Aucun blocage";
  const blockerDetails = String(item.blockerDetails || "").trim() || "-";
  return [
    `Statut pièces: ${partsStatus}`,
    `Motif de blocage: ${blockerReason}`,
    `Détail blocage: ${blockerDetails}`,
  ];
}

function renderPartsBlockerHtml(item) {
  return `
    <section class="avoid-break">
      <h2>Pièces / blocage</h2>
      <table>
        <tbody>
          <tr><th>Statut pièces</th><td>${escapeHtml(PARTS_STATUS_LABELS[normalizePartsStatus(item.partsStatus)] || "Non vérifié")}</td></tr>
          <tr><th>Motif de blocage</th><td>${escapeHtml(BLOCKER_REASON_LABELS[normalizeBlockerReason(item.blockerReason)] || "Aucun blocage")}</td></tr>
          <tr><th>Détail blocage</th><td>${escapeHtml(String(item.blockerDetails || "").trim() || "-")}</td></tr>
        </tbody>
      </table>
    </section>
  `;
}

function getPhotoCountByCategory(item, category) {
  return (item.photos || []).filter((photo) => normalizePhotoCategory(photo.category) === category).length;
}

function getInterventionTypeLabelForPrint(item) {
  if (typeof getCaseTypeSummary === "function") return getCaseTypeSummary(item);
  return item.orderType || item.type || "Intervention atelier";
}

const QUALITY_CHECKLISTS_BY_INTERVENTION = {
  service_rapide: [
    "Niveau huile vérifié",
    "Filtre remplacé si prévu",
    "Témoin entretien remis à zéro",
    "Absence de fuite",
    "Essai / contrôle final",
    "Propreté véhicule",
  ],
  mecanique: [
    "Serrages contrôlés",
    "Absence de fuite",
    "Essai routier si nécessaire",
    "Défauts diagnostic traités",
    "Sécurité freinage / direction vérifiée",
  ],
  electrique: [
    "Défauts effacés",
    "Test batterie / alternateur si concerné",
    "Équipement réparé fonctionnel",
    "Contrôle voyant tableau de bord",
  ],
  diagnostic: [
    "Lecture défauts effectuée",
    "Cause probable documentée",
    "Essai ou mesure de confirmation",
    "Recommandation remise au chef atelier",
  ],
  carrosserie: [
    "Alignement carrosserie",
    "Teinte et vernis",
    "Remontage accessoires",
    "Nettoyage intérieur/extérieur",
    "Photos après réparation",
  ],
  garantie: [
    "Travaux conformes accord garantie",
    "Référence garantie vérifiée",
    "Pièces remplacées documentées",
    "Essai / contrôle final",
  ],
};

function getQualityChecklistType(item) {
  const rawType = typeof getCasePrimaryType === "function" ? getCasePrimaryType(item) : (item.orderType || item.type || "");
  const summary = getInterventionTypeLabelForPrint(item);
  const text = `${rawType} ${summary}`.toLowerCase();
  if (text.includes("vidange") || text.includes("rapide") || text.includes("entretien")) return "service_rapide";
  if (text.includes("élect") || text.includes("elect")) return "electrique";
  if (text.includes("diagnostic")) return "diagnostic";
  if (text.includes("mécan") || text.includes("mecan")) return "mecanique";
  if (text.includes("garantie")) return "garantie";
  return "carrosserie";
}

function getQualityChecklistForCase(item) {
  const type = getQualityChecklistType(item);
  return QUALITY_CHECKLISTS_BY_INTERVENTION[type] || DEFAULT_QUALITY_CHECKS;
}

function isPrintEquipmentResource(resource) {
  if (!resource) return false;
  if (typeof isEquipmentResource === "function") return isEquipmentResource(resource);
  return ["cabine", "zone_preparation", "pont_vidange", "pont_mecanique", "pont", "equipment"].includes(resource.role);
}

function isPrintHumanResource(resource) {
  return Boolean(resource && resource.active !== false && !isPrintEquipmentResource(resource));
}

function getAllClaimEstimateLines(item) {
  const rows = [];
  (item.claims || []).forEach((claim) => {
    const claimLabel = `${claim.number || ''} ${claim.title || 'Ordre'}`.trim();
    const sourceLines = (claim.estimate?.originalLines || []).length ? claim.estimate.originalLines : (claim.estimate?.lines || []);
    sourceLines.forEach((line) => {
      if (line.allocations?.length) {
        line.allocations.forEach((allocation) => rows.push({
          claim,
          claimLabel,
          phase: allocation.phase,
          operation: line.operation || line.rawText || allocation.operation || 'Opération devis',
          rawText: line.rawText || line.operation || '',
          laborHours: Number(line.laborHours || 0),
          assignedHours: Number(allocation.laborHours || 0),
        }));
      } else {
        rows.push({
          claim,
          claimLabel,
          phase: line.phase,
          operation: line.operation || line.rawText || 'Opération devis',
          rawText: line.rawText || line.operation || '',
          laborHours: Number(line.laborHours || 0),
          assignedHours: Number(line.laborHours || 0),
        });
      }
    });
  });
  return rows;
}

function getAllClaimEstimateTotalHours(item) {
  return roundHours(getAllClaimEstimateLines(item).reduce((sum, line) => sum + Number(line.assignedHours || 0), 0));
}

function getAllClaimEstimateParts(item) {
  const rows = [];
  (item.claims || []).forEach((claim) => {
    const claimLabel = `${claim.number || ''} ${claim.title || 'Ordre'}`.trim();
    (claim.estimate?.parts || []).forEach((part) => rows.push({
      claim,
      claimLabel,
      designation: part.designation || part.rawText || 'Article devis',
      quantity: Number(part.quantity || 0),
      unitPrice: Number(part.unitPrice || 0),
      amount: Number(part.amount || 0),
    }));
  });
  return rows;
}

function buildClaimEstimatePartHtmlRows(item) {
  return getAllClaimEstimateParts(item).map((part) => `
    <tr>
      <td>${escapeHtml(part.claimLabel)}</td>
      <td>${escapeHtml(part.designation || '-')}</td>
      <td class="num">${formatLocalizedDecimal(part.quantity || 0)}</td>
    </tr>
  `).join('');
}

function getClaimReferenceSummary(item, field) {
  const values = [];
  (item.claims || []).forEach((claim) => {
    const value = field === 'or' ? (claim.orNumber || '') : (claim.estimateNumber || claim.estimate?.reference || '');
    if (String(value || '').trim()) values.push(String(value).trim());
  });
  if (field === 'or' && item.orNavNumber) values.push(String(item.orNavNumber).trim());
  const unique = [...new Set(values.filter(Boolean))];
  return unique.length ? unique.join(' / ') : '-';
}

function getCaseDisplayReference(item) {
  const orSummary = getClaimReferenceSummary(item, 'or');
  if (orSummary && orSummary !== '-') return orSummary;
  if (item.plate) return item.plate;
  if (item.clientName) return item.clientName;
  return '-';
}

function buildClaimEstimateHtmlRows(item) {
  return getAllClaimEstimateLines(item).map((line) => `
    <tr>
      <td>${escapeHtml(line.claimLabel)}</td>
      <td>${escapeHtml(getDurationLabel(line.phase) || line.phase || '-')}</td>
      <td>${escapeHtml(line.operation || '-')}</td>
      <td>${formatLocalizedDecimal(line.assignedHours)} h</td>
    </tr>
  `).join('');
}

function buildClaimEstimatePdfTextLines(item) {
  const rows = getAllClaimEstimateLines(item);
  return rows.length
    ? rows.map((line) => `${line.claimLabel} - ${getDurationLabel(line.phase) || line.phase || '-'} - ${line.operation}: ${formatLocalizedDecimal(line.assignedHours)} h`)
    : ['Aucune ligne main-d’œuvre importée ou saisie dans les ordres.'];
}

function buildEstimatePdfLines(item) {
  return [
    ...buildCommonPdfHeader(item, "FICHE DOSSIER SAV", "Document interne atelier"),
    `Assurance: ${item.insurance || ""}`,
    `Réf. OR: ${item.orNavNumber || ""}`,
    ...getPartsBlockerPdfLines(item),
    "",
    "Notes dégâts:",
    item.damageNotes || "Non renseigné",
    "",
    "Durées estimées:",
    ...DURATIONS.map(([key, label]) => `${label}: ${formatLocalizedDecimal(item.durations?.[key] || 0)} h`),
    `Total atelier: ${sumDurations(item)} h`,
  ];
}

function buildConfirmedExpertEstimatePdfLines(item) {
  const totals = expertEstimateTotalsByPhase(item);
  return [
    ...buildCommonPdfHeader(item, "MAIN-D’ŒUVRE VALIDÉE - ORDRES SAV", "Document interne atelier"),
    `Nombre d'ordres: ${(item.claims || []).length}`,
    `Total MO importée: ${formatLocalizedDecimal(getAllClaimEstimateTotalHours(item))} h`,
    "",
    "Lignes main d'œuvre par ordre:",
    ...buildClaimEstimatePdfTextLines(item),
    "",
    "Totaux planning par étape:",
    ...DURATIONS.map(([key, label]) => `${label}: ${formatLocalizedDecimal(totals[key] || item.durations?.[key] || 0)} h`),
    `Total atelier: ${sumDurations(item)} h`,
  ];
}

function buildExpertPdfLines(item) {
  return [
    ...buildCommonPdfHeader(item, "CONFIRMATION EXPERT", "Document interne atelier"),
    `Expert: ${item.expertName || "Non renseigné"}`,
    `Téléphone expert: ${item.expertPhone || ""}`,
    `Email expert: ${item.expertEmail || ""}`,
    `Assurance: ${item.insurance || ""}`,
    `Devis importé confirmé: ${item.expertEstimate?.confirmed ? "Oui" : "Non"}`,
    `Total MO devis importé: ${formatLocalizedDecimal(expertEstimateTotalHours(item))} h`,
  ];
}

function buildClientPdfLines(item) {
  return [
    ...buildCommonPdfHeader(item, "CONFIRMATION CLIENT", "Document client"),
    item.appointment ? `RDV fixé: ${formatDateTime(item.appointment.start)}` : "RDV non fixé",
    item.appointment ? `Fin estimée: ${formatDateTime(item.appointment.delivery)}` : "Fin estimée non planifiée",
  ];
}

function buildPlanningPdfLines(item) {
  const bookings = state.bookings.filter((booking) => booking.caseId === item.id);
  return [
    ...buildCommonPdfHeader(item, "AFFECTATIONS PLANNING CONFIRMÉES", "Document planning"),
    item.appointment ? `RDV de dépôt: ${formatDateTime(item.appointment.start)}` : "RDV non fixé",
    `État RDV: ${item.appointmentStatus || "none"}`,
    "",
    ...(
      bookings.length
        ? bookings.flatMap((booking) => {
            const resources = booking.resourceIds.map((id) => getResource(id)?.name).filter(Boolean).join(", ");
            return [`${booking.title}`, `  Ressources: ${resources}`, `  Début: ${formatDateTime(booking.start)}`, `  Fin: ${formatDateTime(booking.end)}`, ""];
          })
        : ["Aucune affectation planning confirmée."]
    ),
  ];
}

function buildQualityPdfLines(item) {
  const checklist = getQualityChecklistForCase(item);
  return [
    ...buildCommonPdfHeader(item, "POINTS DE FINITION ATELIER", "Document atelier"),
    `Type d'intervention: ${getInterventionTypeLabelForPrint(item)}`,
    `Contrôleur: ______________________________`,
    `Date/heure vérification: ______________________________`,
    "",
    ...checklist.map((label) => `${item.qualityChecklist?.[label] ? "[OK]" : "[  ]"} ${label}`),
    "",
    `Vérification atelier enregistrée: ${item.flags.qualityApproved ? "Oui" : "Non"}`,
    `Résultat: [  ] Conforme   [  ] À reprendre`,
    `Défaut constaté: ______________________________`,
    `Action corrective: ______________________________`,
    `Recontrôle nécessaire: [  ] Oui   [  ] Non`,
    "",
    "Signature atelier: ______________________________",
    "Signature chef atelier: ______________________________",
  ];
}

function buildDeliveryPdfLines(item) {
  return [
    ...buildCommonPdfHeader(item, "FICHE CLÔTURE ATELIER", "Document atelier"),
    `Date/heure clôture: ______________________________`,
    `Kilométrage sortie: ______________________________ km`,
    `Véhicule reçu: ${item.flags.received ? "Oui" : "Non"}`,
    `Travaux démarrés: ${item.flags.workStarted ? "Oui" : "Non"}`,
    `Travaux terminés: ${item.flags.workCompleted ? "Oui" : "Non"}`,
    `Vérification atelier enregistrée: ${item.flags.qualityApproved ? "Oui" : "Non"}`,
    `Clôture effectuée: ${item.flags.delivered ? "Oui" : "Non"}`,
    `Photos après réparation: ${getPhotoCountByCategory(item, "after") ? "Oui" : "Non"} (${getPhotoCountByCategory(item, "after")})`,
    "",
    "Résumé travaux réalisés:",
    item.damageNotes || "À compléter",
    "",
    "Observations atelier: ______________________________",
    "Documents suivis: [  ] Carte grise   [  ] Rapport atelier",
    "Clés / accessoires contrôlés: ______________________________",
    "",
    "Le dossier atelier est clôturé sous réserve des observations mentionnées ci-dessus.",
    "",
    "Signature atelier: ______________________________",
    "Signature réception: ______________________________",
  ];
}

function buildReceptionPdfLines(item) {
  const beforeCount = getPhotoCountByCategory(item, "before");
  return [
    ...buildCommonPdfHeader(item, "FICHE RÉCEPTION VÉHICULE", "Document réception atelier / client"),
    `Propriétaire / société: ${item.ownerName || ""}`,
    `Personne déposante: ${item.driverName || ""}`,
    `Téléphone déposant: ${item.driverPhone || ""}`,
    `Couleur: ${item.color || ""}`,
    `Kilométrage entrée: ${item.mileage ? `${item.mileage} km` : ""}`,
    `Date/heure réception: ${item.flags.received ? formatDateTime(new Date()) : "À compléter"}`,
    `Motif client / observations réception: ${item.damageNotes || "À compléter"}`,
    `État apparent du véhicule: ______________________________`,
    `Accessoires remis: ______________________________`,
    `Photos avant réparation: ${beforeCount ? "Oui" : "Non"} (${beforeCount})`,
    "",
    "Signature réception: ______________________________",
    "Signature client/déposant: ______________________________",
  ];
}

function buildLogsPdfLines(item) {
  return [
    ...buildCommonPdfHeader(item, "LOGS COMPLETS DU DOSSIER", "Document interne atelier"),
    ...(item.history || []).map((entry) => `${formatDateTime(entry.at)} - ${entry.label}${entry.details ? ` - ${entry.details}` : ""}`),
  ];
}

function createSimplePdf(lines) {
  const safeLines = lines.flatMap((line) => wrapPdfLine(asciiPdfText(String(line ?? "")), 92));
  const content = ["BT", "/F1 10 Tf", "50 790 Td", "14 TL", ...safeLines.map((line) => `(${escapePdfText(line)}) Tj T*`), "ET"].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((obj, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}

function wrapPdfLine(line, size) {
  const chunks = [];
  let text = line || " ";
  while (text.length > size) {
    chunks.push(text.slice(0, size));
    text = text.slice(size);
  }
  chunks.push(text);
  return chunks;
}

function asciiPdfText(text) {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^ -~]/g, " ");
}

function escapePdfText(text) {
  return text.replace(/[\\()]/g, "\\$&").replace(/[\r\n]/g, " ");
}

function sanitizeFilename(value) {
  return String(value || "dossier")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "_")
    .slice(0, 120) || "dossier";
}

function extensionForPhoto(name, type) {
  const cleaned = String(name || "");
  if (/\.[a-z0-9]{2,5}$/i.test(cleaned)) return "";
  if (type === "image/png") return ".png";
  if (type === "image/webp") return ".webp";
  return ".jpg";
}

function downloadBlob(blob, filename, type) {
  const url = URL.createObjectURL(blob instanceof Blob ? blob : new Blob([blob], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function createZip(files) {
  const encoder = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;
  files.forEach((file) => {
    const nameBytes = encoder.encode(file.path.replace(/^\/+/, ""));
    const data = file.data instanceof Uint8Array ? file.data : encoder.encode(String(file.data || ""));
    const crc = crc32(data);
    const local = new Uint8Array(30 + nameBytes.length);
    const view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0x0800, true);
    view.setUint16(8, 0, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, data.length, true);
    view.setUint32(22, data.length, true);
    view.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    chunks.push(local, data);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const cview = new DataView(centralHeader.buffer);
    cview.setUint32(0, 0x02014b50, true);
    cview.setUint16(4, 20, true);
    cview.setUint16(6, 20, true);
    cview.setUint16(8, 0x0800, true);
    cview.setUint16(10, 0, true);
    cview.setUint32(16, crc, true);
    cview.setUint32(20, data.length, true);
    cview.setUint32(24, data.length, true);
    cview.setUint16(28, nameBytes.length, true);
    cview.setUint32(42, offset, true);
    centralHeader.set(nameBytes, 46);
    central.push(centralHeader);
    offset += local.length + data.length;
  });
  const centralSize = central.reduce((sum, chunk) => sum + chunk.length, 0);
  const end = new Uint8Array(22);
  const eview = new DataView(end.buffer);
  eview.setUint32(0, 0x06054b50, true);
  eview.setUint16(8, files.length, true);
  eview.setUint16(10, files.length, true);
  eview.setUint32(12, centralSize, true);
  eview.setUint32(16, offset, true);
  return new Blob([...chunks, ...central, end], { type: "application/zip" });
}

function crc32(data) {
  let crc = -1;
  for (let index = 0; index < data.length; index += 1) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ data[index]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function printCssText(value) {
  return '"' + String(value || '').replace(/["\\\n\r\f<>]/g, character => '\\' + character.codePointAt(0).toString(16) + ' ') + '"';
}

function getWorkshopPrintOperationTitle(booking) {
  return isOperationCentricBooking(booking) ? getPlanningOperationTitle(booking) : booking.title || getPlanningOperationTitle(booking);
}

function buildWorkshopPrintCss(reference, landscape = false) {
  return `@page { size:A4 ${landscape ? 'landscape' : 'portrait'}; margin:16mm 10mm 14mm;
    @top-left { content:${printCssText('NIMR SAV · ' + reference)}; font:9pt Arial; color:#35434b; }
    @bottom-left { content:"Document interne atelier · Vérifier les évolutions dans NIMR SAV"; font:8pt Arial; color:#35434b; }
    @bottom-right { content:"Page " counter(page) " / " counter(pages); font:8pt Arial; }
  }
  *{box-sizing:border-box} body{font:10pt/1.35 Arial,sans-serif;color:#192f3e;margin:0 auto;max-width:${landscape ? '277' : '190'}mm;background:white}
  h1{font-size:19pt;margin:0 0 4mm}h2{font-size:12pt;margin:5mm 0 2mm;break-after:avoid}h3{font-size:10pt;margin:3mm 0 1mm}
  p{margin:2mm 0}header{border-bottom:2px solid #163f57;padding-bottom:3mm;margin-bottom:4mm}
  table{border-collapse:collapse;width:100%;table-layout:fixed;margin:2mm 0 4mm}thead{display:table-header-group}tfoot{display:table-footer-group}
  th,td{border:1px solid #98aab5;padding:2mm;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#e9eef1;font-size:9pt}
  tr{break-inside:avoid}ul{padding-left:5mm}li{margin:1mm 0}small,.muted{font-size:9pt;color:#435966}.num{text-align:right;white-space:nowrap}
  .identity{display:flex;flex-wrap:wrap;gap:2mm 7mm}.notice{padding:2mm 3mm;border-left:3px solid #163f57;background:#f1f4f5}
  .note-space{min-height:12mm;border-bottom:1px solid #91a3af;margin-top:2mm}.signature{margin-top:7mm;border-top:1px solid #91a3af;padding-top:2mm}
  .print-section + .print-section{break-before:page}.avoid-break{break-inside:avoid}.toolbar{padding:3mm;background:#edf2f4;margin-bottom:4mm}
  .timeline{position:relative;height:10mm;border:1px solid #8397a3;margin:3mm 0;background:repeating-linear-gradient(to right,#fff 0,#fff calc(100% / 12 - 1px),#d6dfe4 calc(100% / 12 - 1px),#d6dfe4 calc(100% / 12))}
  .bar{position:absolute;height:6mm;top:2mm;background:#b7cbd6;border:1px solid #254459;overflow:hidden;font-size:8pt;text-align:center}
  .axis{display:flex;justify-content:space-between;font-size:8pt}.equipment-annex{display:none}
  body:has(#print-equipment:checked) .equipment-annex{display:block}
  @media screen{body{padding:8mm;box-shadow:0 0 3mm #bbc3c8}.print-section{margin-bottom:8mm}}
  @media print{.toolbar{display:none!important}body{max-width:none;-webkit-print-color-adjust:exact;print-color-adjust:exact}}
  `;
}

function openWorkshopPrint(title, reference, body, options = {}) {
  const popup = window.open('', '_blank', 'width=1100,height=950');
  if (!popup) { notifyUser("Autorisez l'ouverture de la fenêtre d'impression dans le navigateur.", 'warn'); return; }
  popup.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${escapeHtml(title)} - ${escapeHtml(reference)}</title><style>${buildWorkshopPrintCss(reference, options.landscape)}</style></head><body>
    <div class="toolbar"><button type="button" onclick="window.print()">Imprimer / Enregistrer en PDF</button> A4 · Échelle 100 % · Désactiver les en-têtes et pieds de page du navigateur.${options.equipment ? '<label><input id="print-equipment" type="checkbox"> Joindre le planning des équipements</label>' : ''}</div>
    ${body}<script>window.addEventListener('load',()=>window.print());</script></body></html>`);
  popup.document.close();
}

function renderWorkshopPrintIdentity(item, title, subtitle = '') {
  return `<header><h1>${escapeHtml(title)}</h1><div class="identity"><strong>Réf. OR : ${escapeHtml(getPrintOrderReference(item))}</strong><strong>${escapeHtml(item.plate || 'Immatriculation à compléter')}</strong><span>${escapeHtml(item.vehicle || '')}</span></div>
    ${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ''}<small>Édité le ${formatDateTime(new Date())} · ${escapeHtml(getPrintStatusLabel(item))}</small></header>`;
}

function getWorkshopPrintDayRows(dateLike, equipment = false) {
  const date = typeof dateLike === 'string' ? parseDateKey(dateLike) : new Date(dateLike);
  const start = startOfDay(date), end = addDays(start, 1);
  const cases = new Map(state.cases.filter(item => !item.deletedAt).map(item => [item.id, item]));
  const rows = [];
  state.bookings.filter(booking => isPrintableWorkBooking(booking) && !booking.deletedAt && booking.status !== 'cancelled' && !booking.needsScheduling).forEach(booking => {
    const item = cases.get(booking.caseId);
    if (!item || !isActivePrintableWorkBooking(booking, item)) return;
    const resources = (booking.resourceIds || []).map(getResource).filter(resource => equipment ? isPrintEquipmentResource(resource) : isPrintHumanResource(resource));
    resources.forEach(resource => (booking.segments || []).forEach(segment => {
      const from = maxDate(new Date(segment.start), start), until = minDate(new Date(segment.end), end);
      if (from < until) rows.push({ booking, item, resource, start:from, end:until, minutes:diffMinutes(from, until) });
    }));
  });
  return rows.sort((a,b) => a.resource.name.localeCompare(b.resource.name, 'fr') || a.start - b.start);
}

function renderWorkshopPrintRequests(item) {
  const requests = item.customerClaims || [];
  return requests.length ? `<h2>Demandes et points à vérifier</h2><ul>${requests.map(request => `<li><strong>${escapeHtml(request.title || request.text)}</strong> · ${escapeHtml(CUSTOMER_REQUEST_STATES[request.status] || 'Clôturé')}${request.nextAction ? ` · ${escapeHtml(request.nextAction)}` : ''}${request.outcome ? ` · ${escapeHtml(CUSTOMER_REQUEST_OUTCOMES[request.outcome] || request.outcome)}` : ''}</li>`).join('')}</ul>` : '';
}

function getPrintableWorkshopParts(item) {
  return getAllClaimEstimateParts(item).filter(part => part.quantity > 0 && !/^(?:(?:DFM\s+)?BOX\s*EV\s*$|Après\s*$|(?:VIN|PLAQ(?:UE)?|Châssis|Chassis)\s*[:#]\s*[A-Z0-9]{17}\b|Immat(?:riculation)?\s*[:#])/i.test(part.designation));
}

function printRepairOrder(item) {
  if (!item) return;
  const assignments = getCaseWorkBookings(item).filter(booking => !booking.deletedAt && booking.status !== 'cancelled');
  const parts = getPrintableWorkshopParts(item);
  const workRows = assignments.map(booking => `<tr><td>${escapeHtml(getWorkshopPrintOperationTitle(booking))}${booking.remainingEstimateRequired ? '<p>Temps restant à estimer</p>' : ''}</td>
    <td>${escapeHtml(getBookingTechnicianName(booking))}</td><td>${booking.needsScheduling ? 'À planifier' : `${formatDateTime(booking.start)}<br>${formatTime(booking.end)}`}</td>
    <td>${escapeHtml(getBookingStatusLabel(booking))}</td></tr>`).join('');
  const labor = getAllClaimEstimateLines(item);
  const laborRows = labor.map(line => `<tr><td>${escapeHtml(line.operation)}</td><td>${escapeHtml(getDurationLabel(line.phase) || line.phase || '')}</td><td class="num">${formatLocalizedDecimal(line.assignedHours)} h</td></tr>`).join('');
  const body = `${renderWorkshopPrintIdentity(item, 'Ordre de réparation', item.clientName || '')}
    <div class="identity">${item.vin ? `<span>VIN : ${escapeHtml(item.vin)}</span>` : ''}${item.mileage ? `<span>Kilométrage : ${escapeHtml(item.mileage)} km</span>` : ''}</div>
    <h2>Demande et consignes</h2><p>${escapeHtml(item.visitReason || item.arrivalNotes || item.damageNotes || 'À préciser')}</p>
    ${renderPartsBlockerHtml(item)}${renderWorkshopPrintRequests(item)}
    ${laborRows ? `<h2>Opérations prévues</h2><table><thead><tr><th style="width:65%">Opération</th><th>Phase</th><th style="width:15%">Heures source</th></tr></thead><tbody>${laborRows}</tbody></table>` : ''}
    ${parts.length ? `<h2>Pièces et fournitures</h2><table><thead><tr><th>Désignation</th><th style="width:15%">Qté</th></tr></thead><tbody>${parts.map(part => `<tr><td>${escapeHtml(part.designation)}</td><td class="num">${formatLocalizedDecimal(part.quantity)}</td></tr>`).join('')}</tbody></table>` : ''}
    <h2>Travaux et affectations</h2><table><thead><tr><th style="width:40%">Travail</th><th>Technicien</th><th>Créneau prévu</th><th>État</th></tr></thead><tbody>${workRows || '<tr><td colspan="4">Travaux à planifier.</td></tr>'}</tbody></table>
    ${(item.claims || []).some(claim => claim.durationMode === 'investigation' && !claim.diagnosticConclusion) ? '<p class="notice">Diagnostic en cours : durée totale et disponibilité à confirmer.</p>' : ''}
    <div class="avoid-break"><h2>Observations atelier</h2><div class="note-space"></div><p class="signature">Visa Chef Atelier : ____________________ · Date : ______________</p></div>`;
  openWorkshopPrint('Ordre de réparation', getPrintOrderReference(item), body);
}




function printDailyPlanningGantt(dateKey = state.planningDate) {
  const date = typeof dateKey === 'string' ? parseDateKey(dateKey) : new Date(dateKey);
  const humans = getWorkshopPrintDayRows(date), equipment = getWorkshopPrintDayRows(date, true);
  const all = [...humans, ...equipment];
  const opening = getDayIntervals(date);
  const starts = [...all.map(row => row.start), ...opening.map(row => row.start)];
  const ends = [...all.map(row => row.end), ...opening.map(row => row.end)];
  const from = starts.length ? Math.min(...starts.map(Number)) : atTime(date, '08:00').getTime();
  const until = ends.length ? Math.max(...ends.map(Number)) : atTime(date, '17:00').getTime();
  const span = Math.max(60000, until - from);
  const renderRows = (rows, title) => {
    const groups = new Map(); rows.forEach(row => { if (!groups.has(row.resource.id)) groups.set(row.resource.id, []); groups.get(row.resource.id).push(row); });
    return `<h2>${escapeHtml(title)}</h2>${[...groups.values()].map(group => `<section><h3>${escapeHtml(group[0].resource.name)}</h3>
      <div class="axis">${Array.from({length:5},(_,i) => `<span>${formatTime(new Date(from + span * i / 4))}</span>`).join('')}</div>
      <div class="timeline">${group.map((row,i) => `<span class="bar" style="left:${(row.start-from)*100/span}%;width:${(row.end-row.start)*100/span}%">${i+1}</span>`).join('')}</div>
      <table><thead><tr><th style="width:6%">N°</th><th style="width:16%">Horaire</th><th style="width:26%">Réf. OR / véhicule</th><th>Opération / état</th></tr></thead><tbody>${group.map((row,i) => `<tr><td>${i+1}</td><td>${formatTime(row.start)}–${formatTime(row.end)}<br>${formatLocalizedDecimal(row.minutes / 60)} h</td><td>${escapeHtml(getPrintOrderReference(row.item))} · ${escapeHtml(row.item.plate || row.item.vehicle || '')}</td><td>${escapeHtml(getWorkshopPrintOperationTitle(row.booking))} · ${escapeHtml(getBookingStatusLabel(row.booking))}</td></tr>`).join('')}</tbody></table></section>`).join('') || '<p>Aucun travail planifié.</p>'}`;
  };
  const body = `<header><h1>Planning Gantt · ${escapeHtml(formatDate(date))}</h1><p>Équipe atelier · les numéros renvoient au détail sous chaque ligne.</p><small>Édité le ${formatDateTime(new Date())}</small></header>${renderRows(humans, 'Techniciens')}
    <section class="print-section equipment-annex"><header><h1>Équipements · ${escapeHtml(formatDate(date))}</h1><p>Annexe de réservation des moyens. Ces lignes ne s'ajoutent pas aux heures des techniciens.</p></header>${renderRows(equipment, 'Moyens réservés')}</section>`;
  openWorkshopPrint('Planning Gantt', formatDate(date), body, {landscape:true,equipment:true});
}

function printDailyPlanning(dateKey = state.planningDate) {
  const date = typeof dateKey === 'string' ? parseDateKey(dateKey) : new Date(dateKey);
  const rows = getWorkshopPrintDayRows(date);
  const body = `<header><h1>Planning atelier</h1><p>${escapeHtml(formatDate(date))} · ${rows.length} créneau(x)</p><small>Édité le ${formatDateTime(new Date())}</small></header>
    <table><thead><tr><th style="width:14%">Technicien</th><th style="width:12%">Horaire prévu</th><th style="width:22%">Réf. OR / véhicule</th><th style="width:29%">Travail</th><th style="width:23%">État / Statut pièces / consignes</th></tr></thead><tbody>
    ${rows.map(row => `<tr><td>${escapeHtml(row.resource.name)}</td><td>${formatTime(row.start)}–${formatTime(row.end)}<br>${formatLocalizedDecimal(row.minutes / 60)} h</td><td>${escapeHtml(getPrintOrderReference(row.item))}<br><strong>${escapeHtml(row.item.plate || '')}</strong> · ${escapeHtml(row.item.vehicle || '')}</td>
      <td>${escapeHtml(getWorkshopPrintOperationTitle(row.booking))}</td><td>${escapeHtml(getBookingStatusLabel(row.booking))}<br>${escapeHtml(PARTS_STATUS_LABELS[normalizePartsStatus(row.item.partsStatus)] || 'Pièces à vérifier')}${row.booking.pauseReason || row.item.blockerDetails ? `<br>${escapeHtml(row.booking.pauseReason || row.item.blockerDetails)}` : ''}</td></tr>`).join('') || '<tr><td colspan="5">Aucun travail planifié sur cette journée.</td></tr>'}
    </tbody></table><p class="muted">Les horaires sont des prévisions. Une tâche suivante attend la fin du travail en cours et la levée de ses prérequis.</p>`;
  openWorkshopPrint('Planning atelier', formatDate(date), body, {landscape:true});
}


function printSupplementWorkOrders(item, supplementId = null) {
  item.supplements = normalizeRepairSupplements(item.supplements);
  const archiveMode = isCaseReadonlyArchive(item);
  const supplements = supplementId ? item.supplements.filter((supplement) => supplement.id === supplementId) : item.supplements;
  if (!supplements.length) {
    notifyUser("Aucune réparation complémentaire à imprimer.", "warn");
    return;
  }
  const pages = supplements.map((supplement, index) => {
    const partRows = supplement.parts.length
      ? supplement.parts.map((part, rowIndex) => `
        <tr><td>${rowIndex + 1}</td><td>${escapeHtml(part.designation)}</td><td>${formatLocalizedDecimal(part.quantity || 1)}</td><td>${escapeHtml(part.notes || '')}</td></tr>
      `).join('')
      : `<tr><td colspan="4">Aucune pièce complémentaire renseignée.</td></tr>`;
    const laborRows = supplement.laborLines.length
      ? supplement.laborLines.map((line, rowIndex) => `
        <tr><td>${rowIndex + 1}</td><td>${escapeHtml(getDurationLabel(line.phase) || line.phase)}</td><td>${escapeHtml(line.operation)}</td><td>${formatLocalizedDecimal(line.laborHours)} h</td><td class="check-cell">□</td></tr>
      `).join('')
      : `<tr><td colspan="5">Aucune main-d’œuvre complémentaire renseignée.</td></tr>`;
    return `
      <section class="supplement-page ${index ? 'page-break' : ''}">
        <header>
          <div>
            <h1>Ordre de travail complémentaire</h1>
            <p class="muted">NIMR SAV · Service Après-Vente Automobile</p>
            <p>Document interne atelier</p>
            <p><strong>Complément :</strong> ${escapeHtml(supplement.number || '-')} - ${escapeHtml(supplement.title || '')}</p>
            <p><strong>Statut :</strong> ${escapeHtml(SUPPLEMENT_STATUS_LABELS[supplement.status] || supplement.status)}</p>
          </div>
          <div class="right">
            <p><strong>Imprimé le :</strong> ${formatDateTime(new Date())}</p>
            <p><strong>Réf. OR :</strong> ${escapeHtml(getPrintOrderReference(item))}</p>
            <p><strong>Devis :</strong> ${escapeHtml(getClaimReferenceSummary(item, 'devis'))}</p>
            <p><strong>Statut dossier :</strong> ${escapeHtml(getPrintStatusLabel(item))}</p>
          </div>
        </header>
        ${archiveMode ? `<section class="avoid-break"><h2>Archive lecture seule</h2><p><strong>${escapeHtml(getArchivedCaseMessage(item))}</strong> Ce document est conservé pour consultation, historique et archivage.</p></section>` : ""}
        <section class="grid">
          <div class="box"><h2>Client</h2><p>${escapeHtml(item.clientName || '-')}</p></div>
          <div class="box"><h2>Véhicule</h2><p><strong>Modèle :</strong> ${escapeHtml(item.vehicle || '-')}</p><p><strong>Immat. :</strong> ${escapeHtml(item.plate || '-')}</p><p><strong>VIN :</strong> ${escapeHtml(item.vin || '-')}</p><p><strong>Zone :</strong> ${escapeHtml(supplement.vehicleArea || '-')}</p></div>
        </section>
        <section><h2>Motif / dommage découvert</h2><p>${escapeHtml(supplement.reason || 'Aucun motif renseigné.')}</p></section>
        <section><h2>Suivi atelier</h2><p>Complément intégré : <strong>${supplement.integrated ? 'Oui' : 'Non'}</strong></p></section>
        <section><h2>Impact atelier / client</h2>
          <table><tbody>
            <tr><td>Impact délai livraison</td><td></td><td>Impact planning</td><td></td></tr>
            <tr><td>Client informé</td><td class="check-cell">□</td><td>Pièces disponibles</td><td class="check-cell">□</td></tr>
            <tr><td>Accord requis avant exécution</td><td class="check-cell">□</td><td>Complément intégré au planning</td><td class="check-cell">□</td></tr>
          </tbody></table>
        </section>
        <section><h2>Pièces complémentaires</h2><table><thead><tr><th>N°</th><th>Désignation</th><th>Qté</th><th>Notes</th></tr></thead><tbody>${partRows}</tbody></table></section>
        <section><h2>Main-d’œuvre complémentaire</h2><table><thead><tr><th>N°</th><th>Étape</th><th>Opération</th><th>Temps</th><th>Fait</th></tr></thead><tbody>${laborRows}</tbody></table></section>
        <section><h2>Observations technicien</h2><div class="notes-box"></div></section>
        <section class="signature-grid"><div class="signature-box"><strong>Signature technicien</strong><span>Nom, date et signature</span></div><div class="signature-box"><strong>Validation chef atelier</strong><span>Nom, date et signature</span></div></section>
      </section>
    `;
  }).join('');
  const popup = window.open('', '_blank', 'width=900,height=1100');
  if (!popup) {
    notifyUser("Le navigateur a bloqué l'ouverture. Autorisez les pop-ups pour imprimer l'ordre complémentaire.", "error");
    return;
  }
  popup.document.write(`
    <!doctype html><html lang="fr"><head><meta charset="utf-8" />
    <title>Ordres complémentaires - ${escapeHtml(item.clientName || 'Dossier')}</title>
    <style>
      body { color: #14212b; font-family: Arial, sans-serif; margin: 28px; }
      header { align-items: flex-start; border-bottom: 2px solid #11415f; display: flex; justify-content: space-between; padding-bottom: 14px; }
      h1 { color: #11415f; font-size: 24px; margin: 0 0 6px; } h2 { font-size: 15px; margin: 20px 0 8px; } p { margin: 4px 0; }
      table { border-collapse: collapse; margin-top: 8px; width: 100%; } th, td { border: 1px solid #dce4e9; padding: 8px; text-align: left; vertical-align: top; } th { background: #f5f8fa; }
      .right { text-align: right; } .grid { display: grid; gap: 12px; grid-template-columns: repeat(2, 1fr); margin-top: 16px; } .box { border: 1px solid #dce4e9; padding: 10px; }
      .muted { color: #687987; font-size: 12px; } .check-cell { font-size: 20px; text-align: center; width: 54px; } .notes-box { border: 1px solid #dce4e9; min-height: 90px; }
      .signature-grid { display: grid; gap: 24px; grid-template-columns: repeat(2, 1fr); margin-top: 48px; } .signature-box { border-top: 1px solid #14212b; min-height: 70px; padding-top: 8px; } .signature-box span { color: #687987; display: block; font-size: 12px; margin-top: 6px; }
      .page-break { page-break-before: always; } @media print { body { margin: 0; } .page-break { break-before: page; } }
      ${buildWorkshopPrintCss(getPrintOrderReference(item))}
      .supplement-page header{padding-bottom:2mm;margin-bottom:2mm}
      .supplement-page h1{font-size:16pt;margin:0 0 1.5mm}
      .supplement-page h2{font-size:11pt;margin:2mm 0 1mm}
      .supplement-page p{margin:1mm 0}
      .supplement-page .grid{gap:3mm;margin-top:2mm}
      .supplement-page .box{padding:2mm}
      .supplement-page table{margin:1.5mm 0 2mm}
      .supplement-page th,.supplement-page td{padding:1.5mm 2mm}
      .supplement-page .check-cell{width:36px;font-size:16px}
      .supplement-page .notes-box{min-height:10mm}
      .supplement-page .signature-grid{display:grid;gap:12mm;grid-template-columns:repeat(2,1fr);margin-top:4mm}
      .supplement-page .signature-box{border-top:1px solid #14212b;min-height:10mm;padding-top:1.5mm}
    </style></head><body>${pages}<script>window.addEventListener('load', () => window.print());</script></body></html>
  `);
  popup.document.close();
  addHistory(item, 'supplement.printed', 'Ordre complémentaire imprimé', `${supplements.length} complément(s)`);
  saveState({ changedCase: item });
}

function getBookingEquipmentNames(booking) {
  return (booking.resourceIds || [])
    .map((id) => getResource(id))
    .filter((resource) => resource && isPrintEquipmentResource(resource))
    .map((resource) => resource.name)
    .join(", ");
}

function getBookingTechnicianName(booking, technicianId = "") {
  const explicit = getResource(technicianId);
  if (isPrintHumanResource(explicit)) return explicit.name;
  const human = (booking.resourceIds || []).map((id) => getResource(id)).find(isPrintHumanResource);
  return human?.name || "Technicien";
}

function getPrintableTechnicianBusinessAssignments(assignments = []) {
  if (typeof getBookingBusinessTaskId !== "function" || typeof getVisibleTechnicianBookingForFamily !== "function") {
    return assignments;
  }
  const grouped = new Map();
  assignments.forEach((booking) => {
    const businessTaskId = getBookingBusinessTaskId(booking) || booking.id;
    const key = `${booking.caseId || ""}::${businessTaskId}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(booking);
  });
  return [...grouped.values()]
    .map((family) => {
      const visible = getVisibleTechnicianBookingForFamily(family);
      return visible?.actionBooking || visible?.displayBooking || family[0] || null;
    })
    .filter(Boolean);
}

function buildTechnicianTaskPrintCss(reference = "Fiche technicien") {
  return `
    @page { size: A4 portrait; margin: 10mm; }
    * { box-sizing: border-box; }
    body { color: #14212b; font-family: Arial, sans-serif; font-size: 11px; line-height: 1.25; margin: 0 auto; max-width: 190mm; }
    header { align-items: flex-start; border-bottom: 2px solid #11415f; display: flex; justify-content: space-between; padding-bottom: 8px; }
    h1 { color: #11415f; font-size: 18px; margin: 0 0 3px; }
    h2 { font-size: 13px; margin: 12px 0 5px; }
    p { margin: 3px 0; }
    table { border-collapse: collapse; margin-top: 5px; width: 100%; }
    th, td { border: 1px solid #dce4e9; padding: 5px 6px; text-align: left; vertical-align: top; }
    th { background: #f5f8fa; }
    .right { text-align: right; }
    .grid { display: grid; gap: 8px; grid-template-columns: repeat(2, 1fr); margin-top: 10px; }
    .box { border: 1px solid #dce4e9; padding: 7px; }
    .muted { color: #687987; font-size: 10px; }
    .notes-box { border: 1px solid #dce4e9; min-height: 42px; padding: 6px; }
    .checklist { columns: 2; list-style: none; margin: 6px 0 0; padding: 0; }
    .checklist li { break-inside: avoid; margin: 3px 0; }
    .signature-grid { display: grid; gap: 24px; grid-template-columns: repeat(2, 1fr); margin-top: 34px; }
    .signature-box { border-top: 1px solid #14212b; min-height: 54px; padding-top: 6px; }
    footer { border-top: 1px solid #dce4e9; color: #687987; font-size: 9px; margin-top: 16px; padding-top: 5px; }
    @media print { body { margin: 0; } button, nav, .sidebar, .dashboard-strip, .sync-status-strip { display: none !important; } }
    ${buildWorkshopPrintCss(reference)}
    .signature-grid{margin-top:8mm}.signature-box{min-height:12mm}
  `;
}

function printTechnicianTaskSheet(item, bookingId, technicianId = "") {
  const booking = state.bookings.find((candidate) => candidate.id === bookingId && candidate.caseId === item?.id && isPrintableWorkBooking(candidate));
  if (!item || !booking) {
    notifyUser("Tâche introuvable pour impression.", "error");
    return;
  }
  const technicianName = getBookingTechnicianName(booking, technicianId);
  const equipment = getBookingEquipmentNames(booking) || "-";
  const notes = (booking.notes || []).map((note) => `${formatDateTime(note.at)} - ${escapeHtml(getResource(note.by)?.name || note.by || "Technicien")} : ${escapeHtml(note.text)}`).join("<br>") || "Aucune note.";
  const status = typeof getTechnicianTaskStatus === "function" ? getTechnicianTaskStatus(item, booking) : getBookingOperationalStatus(booking);
  const statusLabel = typeof getTechnicianStatusLabel === "function" ? getTechnicianStatusLabel(status) : getBookingStatusLabel(booking);
  const popup = window.open("", "_blank", "width=900,height=1100");
  if (!popup) {
    notifyUser("Le navigateur a bloqué l'ouverture. Autorisez les pop-ups pour imprimer la fiche tâche.", "error");
    return;
  }
  popup.document.write(`
    <!doctype html>
    <html lang="fr">
      <head>
        <meta charset="utf-8" />
        <title>Fiche tâche technicien - ${escapeHtml(item.clientName || "Dossier")}</title>
        <style>${buildTechnicianTaskPrintCss(getPrintOrderReference(item))}</style>
      </head>
      <body>
        <header>
          <div>
            <h1>NIMR SAV</h1>
            <p>${PRINT_WORKSHOP_SUBTITLE}</p>
            <p><strong>Fiche de travail technicien</strong></p>
          </div>
          <div class="right">
            <p><strong>Réf. OR :</strong> ${escapeHtml(getPrintOrderReference(item))}</p>
            <p><strong>Imprimé le :</strong> ${formatDateTime(new Date())}</p>
            <p><strong>Statut :</strong> ${escapeHtml(getPrintStatusLabel(item))}</p>
          </div>
        </header>
        <section class="grid">
          <div class="box">
            <h2>Client / véhicule</h2>
            <p><strong>Client :</strong> ${escapeHtml(item.clientName || "-")}</p>
            <p><strong>Véhicule :</strong> ${escapeHtml(item.vehicle || "-")}</p>
            <p><strong>Immatriculation :</strong> ${escapeHtml(item.plate || "-")}</p>
            ${item.vin ? `<p><strong>VIN :</strong> ${escapeHtml(item.vin)}</p>` : ''}
            ${item.mileage ? `<p><strong>Kilométrage :</strong> ${escapeHtml(item.mileage)}</p>` : ''}
          </div>
          <div class="box">
            <h2>Tâche atelier</h2>
            <p><strong>Opération :</strong> ${escapeHtml(getWorkshopPrintOperationTitle(booking))}</p>
            <p><strong>Étape :</strong> ${escapeHtml(getDurationLabel(booking.key) || booking.title || "-")}</p>
            <p><strong>Technicien :</strong> ${escapeHtml(technicianName)}</p>
            <p><strong>Équipement :</strong> ${escapeHtml(equipment)}</p>
            <p><strong>Prévu :</strong> ${formatDateTime(booking.start)} → ${formatDateTime(booking.end)}</p>
            <p><strong>Durée prévue :</strong> ${formatLocalizedDecimal((booking.plannedMinutes || getBookingDurationMinutes(booking)) / 60)} h</p>
            <p><strong>Statut :</strong> ${escapeHtml(statusLabel)}</p>
          </div>
        </section>
        <section>
          <h2>Consignes / pièces prévues</h2>
          <table><tbody>
            <tr><th>Consignes</th><td>${escapeHtml(booking.details || item.visitReason || item.damageNotes || "Aucune consigne renseignée.")}</td></tr>
            <tr><th>Pièces prévues</th><td>${escapeHtml(getPrintableWorkshopParts(item).map((part) => `${part.designation || "Article"} x ${formatLocalizedDecimal(part.quantity || 0)}`).join(" / ") || "Aucune pièce renseignée.")}</td></tr>
            <tr><th>Notes numériques</th><td>${notes}</td></tr>
          </tbody></table>
        </section>
        <section>
          <h2>Suivi manuscrit</h2>
          <p>Début réel : ${booking.startedAt ? formatDateTime(booking.startedAt) : '________________'} · Fin réelle : ${booking.completedAt ? formatDateTime(booking.completedAt) : '________________'}</p>
          <ul class="checklist">
            <li>□ tâche démarrée</li>
            <li>□ tâche mise en pause</li>
            <li>□ tâche reprise</li>
            <li>□ tâche terminée</li>
            <li>□ photo avant faite</li>
            <li>□ photo après faite</li>
            <li>□ anomalie signalée</li>
          </ul>
          <div class="notes-box">Commentaire manuscrit :</div>
        </section>
        <section class="signature-grid">
          <div class="signature-box"><strong>Signature technicien</strong><br><span class="muted">Nom, date et signature</span></div>
          <div class="signature-box"><strong>Validation chef atelier</strong><br><span class="muted">Nom, date et signature</span></div>
        </section>
        <footer>Document technicien · ${formatDateTime(new Date())}</footer>
        <script>window.addEventListener('load', () => window.print());</script>
      </body>
    </html>
  `);
  popup.document.close();
  addHistory(item, "planning.task.printed", "Fiche tâche imprimée", `${booking.title || getDurationLabel(booking.key)} · ${technicianName}`);
  saveState({ changedCase: item });
}

function printPauseBlockSheet(item, bookingId, technicianId = "") {
  const booking = state.bookings.find((candidate) => candidate.id === bookingId && candidate.caseId === item?.id && isPrintableWorkBooking(candidate));
  if (!item || !booking) {
    notifyUser("Tâche introuvable pour impression blocage/pause.", "error");
    return;
  }
  const technicianName = getBookingTechnicianName(booking, technicianId || booking.pausedBy || booking.blockedBy);
  const popup = window.open("", "_blank", "width=900,height=1100");
  if (!popup) {
    notifyUser("Le navigateur a bloqué l'ouverture. Autorisez les pop-ups pour imprimer la fiche de pause/blocage.", "error");
    return;
  }
  popup.document.write(`
    <!doctype html><html lang="fr"><head><meta charset="utf-8" />
    <title>Fiche pause blocage - ${escapeHtml(item.clientName || "Dossier")}</title>
    <style>${buildTechnicianTaskPrintCss(getPrintOrderReference(item))}</style></head><body>
      <header>
        <div><h1>NIMR SAV</h1><p>${PRINT_WORKSHOP_SUBTITLE}</p><p><strong>Fiche de pause / blocage</strong></p></div>
        <div class="right"><p><strong>Réf. OR :</strong> ${escapeHtml(getPrintOrderReference(item))}</p><p><strong>Imprimé le :</strong> ${formatDateTime(new Date())}</p></div>
      </header>
      <section class="grid">
        <div class="box"><h2>Véhicule</h2><p><strong>Client :</strong> ${escapeHtml(item.clientName || "-")}</p><p><strong>Véhicule :</strong> ${escapeHtml(item.vehicle || "-")}</p><p><strong>Immat. / VIN :</strong> ${escapeHtml(item.plate || item.vin || "-")}</p></div>
        <div class="box"><h2>Tâche concernée</h2><p><strong>Technicien :</strong> ${escapeHtml(technicianName)}</p><p><strong>Tâche :</strong> ${escapeHtml(booking.title || getDurationLabel(booking.key) || "-")}</p><p><strong>Heure pause :</strong> ${booking.pausedAt ? formatDateTime(booking.pausedAt) : ""}</p><p><strong>Heure reprise :</strong> ${booking.resumedAt ? formatDateTime(booking.resumedAt) : ""}</p></div>
      </section>
      <section><h2>Motif / commentaire</h2><table><tbody><tr><th>Motif pause</th><td>${escapeHtml(booking.pauseReason || "-")}</td></tr><tr><th>Motif blocage</th><td>${escapeHtml(booking.blockReason || "-")}</td></tr><tr><th>Commentaire</th><td>${escapeHtml(booking.blockDetails || "")}</td></tr><tr><th>Impact planning estimé</th><td>${booking.remainingMinutes ? `${formatLocalizedDecimal(booking.remainingMinutes / 60)} h restantes` : ""}</td></tr></tbody></table></section>
      ${booking.actualWorkedMinutes ? `<p>Temps réalisé enregistré : ${formatLocalizedDecimal(booking.actualWorkedMinutes / 60)} h.</p>` : ''}
      ${booking.remainingEstimateRequired || state.bookings.some(candidate => candidate.parentBookingId === booking.id && candidate.remainingEstimateRequired) ? '<p class="notice">Temps restant inconnu : estimation et nouvelle affectation requises auprès du Chef Atelier.</p>' : ''}
      <p>Décision / prochaine revue : ____________________________________________________</p>
      <section class="signature-grid"><div class="signature-box"><strong>Signature technicien</strong></div><div class="signature-box"><strong>Signature chef atelier si nécessaire</strong></div></section>
      <footer>Document pause / blocage · ${formatDateTime(new Date())}</footer>
      <script>window.addEventListener('load', () => window.print());</script>
    </body></html>
  `);
  popup.document.close();
}

function printTechnicianWorkOrders(item) {
  if (!item || isArchivedCaseForOperationalPrint(item)) { notifyUser("Dossier clôturé : imprimez l'ordre de réparation archive.", 'warn'); return; }
  const assignments = getPrintableTechnicianBusinessAssignments(getCaseWorkBookings(item).filter(booking => !booking.deletedAt && booking.status !== 'cancelled'));
  const groups = new Map();
  assignments.forEach(booking => (booking.resourceIds || []).map(getResource).filter(isPrintHumanResource).forEach(resource => { if (!groups.has(resource.id)) groups.set(resource.id, {resource,tasks:[]}); groups.get(resource.id).tasks.push(booking); }));
  if (!groups.size) { notifyUser("Aucune ressource humaine assignée. Planifiez les travaux avant l'impression.", 'warn'); return; }
  const body = [...groups.values()].map(({resource,tasks}) => `<section class="print-section">
    ${renderWorkshopPrintIdentity(item, 'Ordre de travail technicien', `${resource.name} · ${ROLE_LABELS[resource.role] || resource.role}`)}
    ${renderPartsBlockerHtml(item)}${renderWorkshopPrintRequests(item)}
    <table><thead><tr><th style="width:52%">Opération confiée à ${escapeHtml(resource.name)}</th><th style="width:27%">Prévision / état</th><th style="width:21%">Pointage</th></tr></thead><tbody>${tasks.sort((a,b)=>new Date(a.start)-new Date(b.start)).map(booking=>`<tr><td><strong>${escapeHtml(getWorkshopPrintOperationTitle(booking))}</strong>${booking.details ? `<p>${escapeHtml(booking.details)}</p>` : ''}${getBookingEquipmentNames(booking) ? `<p>Matériel : ${escapeHtml(getBookingEquipmentNames(booking))}</p>` : ''}</td><td>${booking.needsScheduling ? 'Reprise à planifier' : `${formatDateTime(booking.start)}<br>${formatTime(booking.end)} · ${formatLocalizedDecimal(getBookingPlannedMinutes(booking)/60)} h`}<br>${escapeHtml(getBookingStatusLabel(booking))}</td><td>Début réel :<br>${booking.startedAt || booking.actualStart ? formatDateTime(booking.startedAt || booking.actualStart) : '________'}<br>Fin réelle :<br>${booking.completedAt ? formatDateTime(booking.completedAt) : '________'}</td></tr>`).join('')}</tbody></table>
    <p>□ tâche démarrée &nbsp; □ tâche terminée &nbsp; □ anomalie signalée</p><div class="avoid-break"><h2>Pause / cause · Constat / reste à faire</h2><div class="note-space"></div><p class="signature">Visa technicien : ____________________ · Date : ______________</p></div></section>`).join('');
  openWorkshopPrint('Ordres techniciens', getPrintOrderReference(item), body);
}

function buildTechnicianEstimateRows(item, taskPhases) {
  const phaseLabels = (phases) => phases.map((phase) => getDurationLabel(phase) || phase).join(" + ");
  return (item.claims || []).flatMap((claim) => {
    const sourceLines = (claim.estimate?.originalLines || []).length ? claim.estimate.originalLines : (claim.estimate?.lines || []);
    return sourceLines.map((line) => {
      const allocations = (line.allocations || []).length
        ? (line.allocations || []).filter((allocation) => taskPhases.has(allocation.phase))
        : (taskPhases.has(line.phase) ? [{ phase: line.phase, laborHours: line.laborHours }] : []);
      if (!allocations.length) return null;
      return {
        operation: `${claim.number || ''} ${claim.title || 'Ordre'} - ${line.operation || line.rawText || 'Opération devis'}`.trim(),
        rawText: line.rawText || line.operation || '',
        laborHours: Number(line.laborHours || allocations.reduce((sum, allocation) => sum + Number(allocation.laborHours || 0), 0)),
        assignedHours: roundHours(allocations.reduce((sum, allocation) => sum + Number(allocation.laborHours || 0), 0)),
        phaseLabel: phaseLabels([...new Set(allocations.map((allocation) => allocation.phase))]),
      };
    }).filter(Boolean);
  });
}
