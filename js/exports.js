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
  saveState();
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
  saveState();
  renderCaseDetail();
}

async function exportCaseFolder(item) {
  return exportCaseFolderZip(item, { clientOnly: false });
}

async function exportClientFolder(item) {
  return exportCaseFolderZip(item, { clientOnly: true });
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
          { path: `${folder}/00_Dossier_global/00_Devis_original_importe/`, data: new Uint8Array(), type: "application/x-directory" },
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
          { path: `${folder}/PDF/00_Devis_original_importe/`, data: new Uint8Array(), type: "application/x-directory" },
        ];
    const pdfRoot = hasClaims ? `${folder}/00_Dossier_global` : `${folder}/PDF`;
    const addPdf = (name, lines) => {
      files.push({ path: `${pdfRoot}/${name}.pdf`, data: createSimplePdf(lines), type: "application/pdf" });
    };
    const sourceFile = item.expertEstimate?.sourceFile;
    if (sourceFile?.id && typeof getDocumentRecord === "function") {
      const record = await getDocumentRecord(sourceFile.id).catch(() => null);
      if (record?.blob) {
        const bytes = new Uint8Array(await record.blob.arrayBuffer());
        const sourceName = sanitizeFilename(sourceFile.name || "devis-original.pdf");
        const sourceExt = /\.[a-z0-9]{2,5}$/i.test(sourceName) ? "" : ".pdf";
        files.push({
          path: `${pdfRoot}/00_Devis_original_importe/${sourceName}${sourceExt}`,
          data: bytes,
          type: sourceFile.type || record.blob.type || "application/octet-stream",
        });
      }
    }

    for (const claim of item.claims || []) {
      const claimFolder = `${folder}/Ordres_SAV/${sanitizeFilename(`${claim.number || 'OT'}_${claim.title || 'Ordre'}`)}`;
      files.push({ path: `${claimFolder}/`, data: new Uint8Array(), type: "application/x-directory" });
      files.push({ path: `${claimFolder}/Devis/`, data: new Uint8Array(), type: "application/x-directory" });
      files.push({ path: `${claimFolder}/Photos/`, data: new Uint8Array(), type: "application/x-directory" });
      files.push({ path: `${claimFolder}/01_Fiche_ordre.pdf`, data: createSimplePdf(buildClaimPdfLines(item, claim)), type: "application/pdf" });
      const claimSource = claim.estimate?.sourceFile;
      if (claimSource?.id && typeof getDocumentRecord === "function") {
        const record = await getDocumentRecord(claimSource.id).catch(() => null);
        if (record?.blob) {
          const bytes = new Uint8Array(await record.blob.arrayBuffer());
          const sourceName = sanitizeFilename(claimSource.name || `${claim.number || 'devis'}-original.pdf`);
          const sourceExt = /\.[a-z0-9]{2,5}$/i.test(sourceName) ? "" : ".pdf";
          files.push({
            path: `${claimFolder}/Devis/${sourceName}${sourceExt}`,
            data: bytes,
            type: claimSource.type || record.blob.type || "application/octet-stream",
          });
        }
      }
    }

    addPdf("00_Fiche_reception_vehicule", buildReceptionPdfLines(item));
    addPdf("01_Devis_initial", buildEstimatePdfLines(item));
    addPdf("02_Devis_expert_confirme", buildConfirmedExpertEstimatePdfLines(item));
    addPdf("03_Confirmation_expert", buildExpertPdfLines(item));
    addPdf("04_Confirmation_client", buildClientPdfLines(item));
    addPdf("05_Affectations_planning", buildPlanningPdfLines(item));
    addPdf("06_Controle_qualite", buildQualityPdfLines(item));
    addPdf("07_PV_restitution_client", buildDeliveryPdfLines(item));
    if (!clientOnly) {
      addPdf("08_Logs_dossier", buildLogsPdfLines(item));
      files.push({ path: `${folder}/dossier.json`, data: new TextEncoder().encode(JSON.stringify(item, null, 2)), type: "application/json" });
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
    saveState();
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
    `Accord expert: ${claim.expertApproved ? 'Oui' : 'Non'}`,
    `Validation client/interne: ${claim.clientApproved ? 'Oui' : 'Non'}`,
    `Inclus planning global: ${claim.includeInPlanning !== false ? 'Oui' : 'Non'}`,
    '',
    'LIGNES MAIN-D\'OEUVRE',
    ...(estimateLines.length
      ? estimateLines.map((line) => `${line.operation || line.rawText || 'Opération'} - ${formatLocalizedDecimal(line.laborHours || 0)} h`)
      : appliedLines.map((line) => `${getDurationLabel(line.phase)} - ${line.operation || ''} - ${formatLocalizedDecimal(line.laborHours || 0)} h`)),
    '',
    'PIÈCES / ARTICLES IMPORTÉS',
    ...((claim.estimate?.parts || []).length
      ? claim.estimate.parts.map((part) => `${part.designation || 'Article'} - Qté ${formatLocalizedDecimal(part.quantity || 0)} - PU ${part.unitPrice ? formatLocalizedDecimal(part.unitPrice) : '-'} - Montant ${part.amount ? formatLocalizedDecimal(part.amount) : '-'}`)
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
      <td class="num">${part.unitPrice ? formatLocalizedDecimal(part.unitPrice) : '-'}</td>
      <td class="num">${part.amount ? formatLocalizedDecimal(part.amount) : '-'}</td>
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
    `Accord expert: ${item.flags.expertApproved ? "Validé" : "Non validé"}`,
    `Devis expert confirmé: ${item.expertEstimate?.confirmed ? "Oui" : "Non"}`,
    `Total MO devis expert: ${formatLocalizedDecimal(expertEstimateTotalHours(item))} h`,
  ];
}

function buildClientPdfLines(item) {
  return [
    ...buildCommonPdfHeader(item, "CONFIRMATION CLIENT", "Document client"),
    `Validation client/interne: ${item.flags.clientApproved ? "Reçue" : "Non reçue"}`,
    item.appointment ? `RDV fixé: ${formatDateTime(item.appointment.start)}` : "RDV non fixé",
    item.appointment ? `Livraison estimée: ${formatDateTime(item.appointment.delivery)}` : "Livraison estimée non planifiée",
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
    ...buildCommonPdfHeader(item, "CONTRÔLE QUALITÉ", "Document qualité"),
    `Type d'intervention: ${getInterventionTypeLabelForPrint(item)}`,
    `Contrôleur: ______________________________`,
    `Date/heure contrôle: ______________________________`,
    "",
    ...checklist.map((label) => `${item.qualityChecklist?.[label] ? "[OK]" : "[  ]"} ${label}`),
    "",
    `Contrôle qualité validé: ${item.flags.qualityApproved ? "Oui" : "Non"}`,
    `Résultat: [  ] Accepté   [  ] Refusé`,
    `Défaut constaté: ______________________________`,
    `Action corrective: ______________________________`,
    `Recontrôle nécessaire: [  ] Oui   [  ] Non`,
    "",
    "Signature qualité: ______________________________",
    "Signature chef atelier: ______________________________",
  ];
}

function buildDeliveryPdfLines(item) {
  return [
    ...buildCommonPdfHeader(item, "PV DE RESTITUTION VÉHICULE", "Document client"),
    `Date/heure livraison: ______________________________`,
    `Kilométrage sortie: ______________________________ km`,
    `Véhicule reçu: ${item.flags.received ? "Oui" : "Non"}`,
    `Travaux démarrés: ${item.flags.workStarted ? "Oui" : "Non"}`,
    `Travaux terminés: ${item.flags.workCompleted ? "Oui" : "Non"}`,
    `Contrôle qualité validé: ${item.flags.qualityApproved ? "Oui" : "Non"}`,
    `Livraison effectuée: ${item.flags.delivered ? "Oui" : "Non"}`,
    `Photos après réparation: ${getPhotoCountByCategory(item, "after") ? "Oui" : "Non"} (${getPhotoCountByCategory(item, "after")})`,
    "",
    "Résumé travaux réalisés:",
    item.damageNotes || "À compléter",
    "",
    "Réserves client: ______________________________",
    "Documents remis: [  ] Facture   [  ] Carte grise   [  ] Rapport contrôle",
    "Clés / accessoires remis: ______________________________",
    "",
    "Le véhicule est restitué après contrôle qualité, sous réserve des observations mentionnées ci-dessus.",
    "",
    "Signature client: ______________________________",
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

function printRepairOrder(item) {
  const title = "Ordre de réparation";
  const archiveMode = isCaseReadonlyArchive(item);
  const assignments = state.bookings.filter((booking) => booking.caseId === item.id);
  const rows = DURATIONS.map(
    ([key, label]) => `
      <tr>
        <td>${escapeHtml(label)}</td>
        <td>${formatLocalizedDecimal(item.durations[key] || 0)} h</td>
      </tr>
    `,
  ).join("");
  const expertEstimateRows = buildClaimEstimateHtmlRows(item);
  const partRows = buildClaimEstimatePartHtmlRows(item);
  const assignmentRows = assignments
    .map((booking) => {
      const resources = booking.resourceIds.map((id) => getResource(id)?.name).filter(Boolean).join(", ");
      const statusValue = typeof getBookingOperationalStatus === "function"
        ? getBookingOperationalStatus(booking, item)
        : booking.status;
      const operationalStatus = archiveMode ? "Archive / terminé" : (statusValue ? getBookingStatusLabel(booking) : null);
      return `
        <tr>
          <td>${escapeHtml(booking.title)}</td>
          <td>${escapeHtml(resources)}</td>
          <td>${formatDateTime(booking.start)}</td>
          <td>${formatDateTime(booking.end)}</td>
          <td>${escapeHtml(operationalStatus || booking.status || "Planifié")}</td>
        </tr>
      `;
    })
    .join("");

  const popup = window.open("", "_blank", "width=900,height=1100");
  if (!popup) {
    notifyUser("Le navigateur a bloqué l'ouverture du PDF. Autorisez les pop-ups pour imprimer.");
    return;
  }
  popup.document.write(`
    <!doctype html>
    <html lang="fr">
      <head>
        <meta charset="utf-8" />
        <title>${title} - ${escapeHtml(item.clientName)}</title>
        <style>
          @page { size: A4; margin: 10mm; }
          body { color: #14212b; font-family: Arial, sans-serif; font-size: 11px; line-height: 1.25; margin: 0; }
          header { align-items: flex-start; border-bottom: 2px solid #11415f; display: flex; justify-content: space-between; padding-bottom: 8px; }
          h1 { color: #11415f; font-size: 20px; margin: 0 0 4px; }
          h2 { font-size: 13px; margin: 12px 0 5px; }
          p { margin: 2px 0; }
          table { border-collapse: collapse; margin-top: 4px; width: 100%; }
          th, td { border: 1px solid #dce4e9; padding: 4px 5px; text-align: left; vertical-align: top; }
          th { background: #f5f8fa; }
          .grid { display: grid; gap: 8px; grid-template-columns: repeat(2, 1fr); margin-top: 8px; }
          .muted { color: #687987; }
          .box { border: 1px solid #dce4e9; padding: 7px; }
          .num { text-align: right; white-space: nowrap; }
          .avoid-break { break-inside: avoid; page-break-inside: avoid; }
          .signatures { display: grid; gap: 18px; grid-template-columns: repeat(2, 1fr); margin-top: 22px; }
          .signature { border-top: 1px solid #14212b; padding-top: 6px; }
          @media print {
            body { margin: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            button, nav, .tabs, .topbar, .app-shell > main > :not(.print-document) { display: none !important; }
          }
        </style>
      </head>
      <body>
        ${renderPrintHeaderHtml(title, item, "Document interne atelier", [
          `<strong>Devis :</strong> ${escapeHtml(getClaimReferenceSummary(item, "devis"))}`,
        ])}
        ${archiveMode ? `<section class="avoid-break"><h2>Archive lecture seule</h2><p><strong>${escapeHtml(getArchivedCaseMessage(item))}</strong> Ce document est conservé pour consultation, historique et archivage.</p></section>` : ""}
        <section class="grid">
          <div class="box">
            <h2>Client</h2>
            <p><strong>Nom:</strong> ${escapeHtml(item.clientName)}</p>
            <p><strong>Téléphone:</strong> ${escapeHtml(item.phone || "-")}</p>
            <p><strong>Assurance:</strong> ${escapeHtml(item.insurance || "-")}</p>
          </div>
          <div class="box">
            <h2>Véhicule</h2>
            <p><strong>Modèle:</strong> ${escapeHtml(item.vehicle || "-")}</p>
            <p><strong>Immatriculation:</strong> ${escapeHtml(item.plate || "-")}</p>
            <p><strong>Couleur:</strong> ${escapeHtml(item.color || "-")}</p>
            <p><strong>Kilométrage:</strong> ${escapeHtml(item.mileage ? `${item.mileage} km` : "-")}</p>
            <p><strong>VIN:</strong> ${escapeHtml(item.vin || "-")}</p>
          </div>
        </section>
        <section>
          <h2>Travaux demandés</h2>
          <p>${escapeHtml(item.damageNotes || "Aucune note renseignée.")}</p>
        </section>
        ${renderPartsBlockerHtml(item)}
        <section class="avoid-break">
          <h2>Devis / main-d’œuvre confirmé</h2>
          <p><strong>Référence:</strong> ${escapeHtml(item.expertEstimate?.reference || "-")}</p>
          <p><strong>État:</strong> ${item.expertEstimate?.confirmed ? "Confirmé" : "Non confirmé"}</p>
          <table>
            <thead><tr><th>Ordre</th><th>Étape</th><th>Opération</th><th>Main d'œuvre</th></tr></thead>
            <tbody>${expertEstimateRows || `<tr><td colspan="4">Aucune ligne MO importée ou saisie dans les ordres.</td></tr>`}</tbody>
          </table>
          <p><strong>Total MO devis importés:</strong> ${formatLocalizedDecimal(getAllClaimEstimateTotalHours(item))} h</p>
        </section>
        <section class="avoid-break">
          <h2>Pièces / articles importés du devis</h2>
          <table>
            <thead><tr><th>Ordre</th><th>Désignation</th><th>Qté</th><th>PU</th><th>Montant</th></tr></thead>
            <tbody>${partRows || `<tr><td colspan="5">Aucune pièce ou article importé depuis le devis.</td></tr>`}</tbody>
          </table>
        </section>
        <section class="avoid-break">
          <h2>Durées estimées</h2>
          <table>
            <thead><tr><th>Opération</th><th>Durée</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
          <p><strong>Total atelier:</strong> ${sumDurations(item)} h</p>
        </section>
        <section class="avoid-break">
          <h2>Affectations atelier</h2>
          <table>
            <thead><tr><th>Travail</th><th>Ressource</th><th>Début</th><th>Fin</th><th>Statut</th></tr></thead>
            <tbody>${assignmentRows || `<tr><td colspan="5">Aucune affectation planifiée.</td></tr>`}</tbody>
          </table>
        </section>
        <section class="avoid-break">
          <h2>Checklist qualité</h2>
          <table>
            <tbody>${getQualityChecklistForCase(item).map(
              (label) => `<tr><td>${escapeHtml(label)}</td><td>${item.qualityChecklist?.[label] ? "OK" : "À faire"}</td></tr>`,
            ).join("")}</tbody>
          </table>
        </section>
        <section class="avoid-break">
          <h2>Consignes atelier</h2>
          <p>Type d'intervention : <strong>${escapeHtml(getInterventionTypeLabelForPrint(item))}</strong></p>
          <p>Vérifier le statut pièces et signaler immédiatement toute anomalie, demande de complément ou impact délai.</p>
        </section>
        <div class="signatures">
          <div class="signature">Signature chef atelier</div>
          <div class="signature">Signature réception</div>
        </div>
        <script>window.addEventListener("load", () => window.print());</script>
      </body>
    </html>
  `);
  popup.document.close();
}




function printDailyPlanningGantt(dateKey = state.planningDate) {
  const date = typeof dateKey === "string" ? parseDateKey(dateKey) : new Date(dateKey);
  const dayKey = todayKey(date);
  const dayStart = atTime(date, "08:00");
  const dayEnd = atTime(date, "17:00");
  const totalDayMinutes = Math.max(1, diffMinutes(dayStart, dayEnd));
  const intervals = getDayIntervals(date);
  const holiday = getHoliday(date);
  const caseById = new Map(state.cases.map((item) => [item.id, item]));
  const dailyColorMap = buildDailyVehicleColorMap(dayKey);
  const activeResources = orderPlanningResources(state.resources.filter(isDisplayPlanningResource));

  const intervalText = intervals.length
    ? intervals.map((interval) => `${formatTime(interval.start)}-${formatTime(interval.end)}`).join(" / ")
    : holiday ? `Jour férié : ${holiday.label}` : "Jour fermé";

  const timelineTicks = () => {
    const ticks = [];
    for (let hour = 8; hour <= 17; hour += 1) {
      const left = ((hour - 8) * 60 * 100) / totalDayMinutes;
      ticks.push(`<div class="tick" style="left:${left}%"><span>${String(hour).padStart(2, "0")}:00</span></div>`);
    }
    return ticks.join("");
  };

  const pauseBands = () => {
    if (!intervals.length) return `<div class="pause-band" style="left:0;width:100%"></div>`;
    const bands = [];
    let cursor = new Date(dayStart);
    intervals.forEach((interval) => {
      if (cursor < interval.start) bands.push(renderPrintBand(cursor, interval.start));
      cursor = interval.end;
    });
    if (cursor < dayEnd) bands.push(renderPrintBand(cursor, dayEnd));
    return bands.join("");
  };

  function renderPrintBand(start, end) {
    const left = Math.max(0, Math.min(100, (diffMinutes(dayStart, start) * 100) / totalDayMinutes));
    const width = Math.max(0, Math.min(100 - left, (diffMinutes(start, end) * 100) / totalDayMinutes));
    return `<div class="pause-band" style="left:${left}%;width:${width}%"></div>`;
  }

  const bookingsForResource = (resource) => {
    const rows = [];
    state.bookings.forEach((booking) => {
      if (!isPrintableWorkBooking(booking)) return;
      if (!isBookingVisibleForResource(booking, resource.id)) return;
      const item = caseById.get(booking.caseId);
      if (!item) return;
      if (!isActivePrintableWorkBooking(booking, item)) return;
      (booking.segments || []).forEach((segment) => {
        const segmentStart = new Date(segment.start);
        const segmentEnd = new Date(segment.end);
        if (segmentEnd <= dayStart || segmentStart >= dayEnd) return;
        const clippedStart = maxDate(segmentStart, dayStart);
        const clippedEnd = minDate(segmentEnd, dayEnd);
        if (clippedEnd <= clippedStart) return;
        rows.push({ booking, item, start: clippedStart, end: clippedEnd });
      });
    });
    rows.sort((a, b) => a.start - b.start || a.end - b.end || String(a.booking.title || "").localeCompare(String(b.booking.title || "")));
    return rows;
  };

  const buildRows = (resourceFilter) => activeResources
    .filter(resourceFilter)
    .map((resource) => ({ resource, bookings: bookingsForResource(resource) }))
    .filter((row) => row.bookings.length);

  const humanRows = buildRows((resource) => !isEquipmentResource(resource));
  const equipmentRows = buildRows((resource) => isEquipmentResource(resource));
  const allRows = [...humanRows, ...equipmentRows];

  const primaryHumanMinutes = humanRows.reduce((sum, row) => sum + row.bookings.reduce((bookingSum, rowBooking) => {
    if (!isPrimaryResourceBooking(rowBooking.booking, row.resource.id)) return bookingSum;
    return bookingSum + diffMinutes(rowBooking.start, rowBooking.end);
  }, 0), 0);
  const dossierCount = new Set(allRows.flatMap((row) => row.bookings.map((entry) => entry.booking.caseId))).size;
  const allEntries = allRows.flatMap((row) => row.bookings.map((entry) => ({ ...entry, resource: row.resource })));
  const plannedCaseIds = new Set(allEntries.map((entry) => entry.booking.caseId));
  const plannedCases = [...plannedCaseIds].map((id) => caseById.get(id)).filter(Boolean);
  const blockedCases = plannedCases.filter((item) => isCaseBlocked(item));
  const deliveryCases = plannedCases.filter((item) => {
    const delivery = item.appointment?.delivery || state.bookings.find((booking) => booking.caseId === item.id)?.delivery;
    return delivery && todayKey(new Date(delivery)) === dayKey;
  });
  const now = new Date();
  const lateEntries = allEntries.filter((entry) => new Date(entry.booking.end || entry.end) < now && entry.booking.status !== "completed" && !entry.item.flags?.workCompleted);
  const leaveEntries = state.bookings.filter((booking) => {
    if (booking.type !== "leave") return false;
    return (booking.segments || []).some((segment) => {
      const start = new Date(segment.start);
      const end = new Date(segment.end);
      return end > dayStart && start < dayEnd;
    });
  });
  const absentResources = [...new Set(leaveEntries.flatMap((booking) => booking.resourceIds || []))]
    .map((id) => getResource(id)?.name)
    .filter(Boolean);

  const getEntryMeta = (entry) => {
    const model = shortVehicleModel(entry.item.vehicle || entry.item.model || "Véhicule");
    const plate = entry.item.plate || entry.item.registration || "";
    const vehicleLine = `${model}${plate ? ` · ${plate}` : ""}`;
    const stage = getDurationLabel(entry.booking.key) || entry.booking.title || "Étape planning";
    const timeLine = `${formatTime(entry.start)}-${formatTime(entry.end)}`;
    const minutes = diffMinutes(entry.start, entry.end);
    return { model, plate, vehicleLine, stage, timeLine, minutes };
  };

  const getEntryNumberMap = (rows) => {
    const map = new Map();
    let number = 1;
    rows.forEach(({ bookings }) => bookings.forEach((entry) => {
      map.set(entry, number);
      number += 1;
    }));
    return map;
  };

  const bookingBlock = (entry, numberMap) => {
    const left = Math.max(0, Math.min(100, (diffMinutes(dayStart, entry.start) * 100) / totalDayMinutes));
    const rawWidth = (diffMinutes(entry.start, entry.end) * 100) / totalDayMinutes;
    const width = Math.max(1.2, Math.min(100 - left, rawWidth));
    const meta = getEntryMeta(entry);
    const color = getBookingPlanningColor(entry.booking, dailyColorMap) || entry.booking.color || "#174f72";
    const stateClass = isCaseBlocked(entry.item)
      ? " blocked"
      : entry.booking.status === "paused"
        ? " paused"
        : entry.booking.status === "completed"
          ? " completed"
          : (new Date(entry.booking.end || entry.end) < now && !entry.item.flags?.workCompleted)
            ? " late"
            : "";
    const taskNumber = numberMap.get(entry) || "";
    const maxTextLength = Math.max(String(meta.vehicleLine || "").length, String(meta.stage || "").length + String(meta.timeLine || "").length + 3);
    const availableChars = Math.max(4, Math.floor(width * 1.2));
    const numberOnly = Boolean(taskNumber) && (width < 14 || maxTextLength > availableChars);
    const compactClass = numberOnly ? " number-only" : meta.minutes <= 20 ? " tiny" : meta.minutes <= 35 ? " compact" : "";
    return `
      <div class="booking${stateClass}${compactClass}" style="left:${left}%;width:${width}%;background:${escapeAttr(color)}" title="${escapeAttr(`#${taskNumber} - ${meta.vehicleLine} - ${meta.stage} - ${meta.timeLine}`)}">
        <span class="task-no">${escapeHtml(String(taskNumber))}</span>
        ${numberOnly ? "" : `<strong>${escapeHtml(meta.vehicleLine)}</strong><span>${escapeHtml(meta.stage)} · ${escapeHtml(meta.timeLine)}</span>`}
      </div>`;
  };

  const renderStatusLegend = () => `
    <section class="status-legend">
      <span><i class="legend-normal"></i>Tâche normale</span>
      <span><i class="legend-blocked"></i>Tâche bloquée</span>
      <span><i class="legend-paused"></i>Tâche en pause</span>
      <span><i class="legend-completed"></i>Tâche terminée</span>
      <span><i class="legend-late"></i>Tâche en retard</span>
      <span><i class="legend-closed"></i>Pause / fermeture atelier</span>
    </section>
  `;

  const renderRows = (rows, numberMap) => rows.map(({ resource, bookings }) => `
    <div class="gantt-row">
      <div class="resource-label">
        <strong>${escapeHtml(resource.name)}</strong>
        <span>${escapeHtml(ROLE_LABELS[resource.role] || resource.role || "Atelier")}${resource.location ? ` · ${escapeHtml(resource.location)}` : ""}</span>
      </div>
      <div class="timeline">
        ${pauseBands()}
        ${bookings.map((entry) => bookingBlock(entry, numberMap)).join("")}
      </div>
    </div>`).join("");

  const renderTaskLegend = (rows, numberMap) => {
    const entries = rows.flatMap(({ resource, bookings }) => bookings.map((entry) => ({ resource, entry })));
    if (!entries.length) return "";
    return `
      <section class="task-legend">
        <h2>Liste détaillée des tâches</h2>
        <p class="muted">Les numéros correspondent aux badges affichés dans le Gantt. Cette liste rend lisibles les créneaux courts.</p>
        <table>
          <thead><tr><th>N°</th><th>Ressource</th><th>Horaire</th><th>Véhicule</th><th>Étape</th><th>Durée</th></tr></thead>
          <tbody>
            ${entries.map(({ resource, entry }) => {
              const meta = getEntryMeta(entry);
              return `<tr>
                <td class="num">${escapeHtml(String(numberMap.get(entry) || ""))}</td>
                <td>${escapeHtml(resource.name)}</td>
                <td>${escapeHtml(meta.timeLine)}</td>
                <td>${escapeHtml(meta.vehicleLine)}</td>
                <td>${escapeHtml(meta.stage)}</td>
                <td>${formatLocalizedDecimal(meta.minutes / 60)} h</td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>
      </section>`;
  };

  const renderPage = (title, rows, extraClass = "") => {
    const numberMap = getEntryNumberMap(rows);
    return `
    <section class="page ${extraClass}">
      <header>
        <div>
          <h1>${escapeHtml(title)}</h1>
          <p class="muted">NIMR SAV · Service Après-Vente Automobile</p>
          <p>Document planning</p>
          <p><strong>Journée :</strong> ${escapeHtml(longDate(date))}</p>
          <p><strong>Horaires :</strong> ${escapeHtml(intervalText)}</p>
        </div>
        <div class="right">
          <p><strong>Imprimé le :</strong> ${formatDateTime(new Date())}</p>
          <p><strong>Ressources planifiées :</strong> ${rows.length}</p>
          <p><strong>Format :</strong> A4 paysage</p>
        </div>
      </header>
      <section class="summary">
        <div><strong>Total planifié</strong><br>${formatLocalizedDecimal(primaryHumanMinutes / 60)} h</div>
        <div><strong>Dossiers</strong><br>${dossierCount}</div>
        <div><strong>Occup. humaine</strong><br>${Math.round(humanDayLoad(date) * 100)}%</div>
        <div><strong>Occup. matérielle</strong><br>${Math.round(equipmentDayLoad(date) * 100)}%</div>
        <div><strong>Calendrier</strong><br>${escapeHtml(intervals.length ? "Ouvert" : "Fermé")}</div>
      </section>
      ${renderStatusLegend()}
      ${rows.length ? `
        <div class="gantt-print">
          <div class="gantt-header">
            <div class="gantt-corner">Ressource</div>
            <div class="time-scale">${timelineTicks()}${pauseBands()}</div>
          </div>
          ${renderRows(rows, numberMap)}
        </div>
        ${renderTaskLegend(rows, numberMap)}` : `<div class="empty">Aucune tâche planifiée pour cette catégorie.</div>`}
    </section>`;
  };

  const renderSummaryPage = () => `
    <section class="page">
      <header>
        <div>
          <h1>Synthèse planning atelier</h1>
          <p class="muted">NIMR SAV · Service Après-Vente Automobile</p>
          <p>Document planning</p>
          <p><strong>Journée :</strong> ${escapeHtml(longDate(date))}</p>
          <p><strong>Horaires :</strong> ${escapeHtml(intervalText)}</p>
        </div>
        <div class="right">
          <p><strong>Imprimé le :</strong> ${formatDateTime(new Date())}</p>
          <p><strong>Format :</strong> A4 paysage</p>
        </div>
      </header>
      <section class="summary large-summary">
        <div><strong>Total dossiers</strong><br>${dossierCount}</div>
        <div><strong>Total heures humaines</strong><br>${formatLocalizedDecimal(primaryHumanMinutes / 60)} h</div>
        <div><strong>Occupation humaine</strong><br>${Math.round(humanDayLoad(date) * 100)}%</div>
        <div><strong>Occupation matérielle</strong><br>${Math.round(equipmentDayLoad(date) * 100)}%</div>
        <div><strong>Dossiers bloqués</strong><br>${blockedCases.length}</div>
        <div><strong>Livraisons prévues</strong><br>${deliveryCases.length}</div>
        <div><strong>Travaux en retard</strong><br>${lateEntries.length}</div>
        <div><strong>Ressources absentes</strong><br>${absentResources.length}</div>
      </section>
      ${renderStatusLegend()}
      <section class="task-legend">
        <h2>Dossiers bloqués</h2>
        ${blockedCases.length ? `<table><thead><tr><th>Client</th><th>Véhicule</th><th>Blocage</th></tr></thead><tbody>${blockedCases.map((item) => `<tr><td>${escapeHtml(item.clientName || "-")}</td><td>${escapeHtml(item.vehicle || "-")}<br><span class="muted">${escapeHtml(item.plate || item.vin || "-")}</span></td><td>${escapeHtml(getCaseBlockerLabel(item) || "-")}</td></tr>`).join("")}</tbody></table>` : `<div class="empty">Aucun dossier bloqué planifié ce jour.</div>`}
      </section>
      <section class="task-legend">
        <h2>Livraisons prévues / retards / absences</h2>
        <table>
          <tbody>
            <tr><th>Livraisons prévues</th><td>${deliveryCases.map((item) => escapeHtml(`${item.clientName || "-"} - ${item.plate || item.vin || ""}`)).join("<br>") || "Aucune"}</td></tr>
            <tr><th>Travaux en retard</th><td>${lateEntries.map((entry) => escapeHtml(`${entry.item.clientName || "-"} - ${entry.booking.title || "Travail"}`)).join("<br>") || "Aucun"}</td></tr>
            <tr><th>Ressources absentes</th><td>${absentResources.map((name) => escapeHtml(name)).join("<br>") || "Aucune"}</td></tr>
          </tbody>
        </table>
      </section>
    </section>
  `;

  const pages = [renderSummaryPage(), renderPage("Planning atelier journalier - Ressources humaines", humanRows, "page-break")];
  if (equipmentRows.length) pages.push(renderPage("Planning atelier journalier - Ressources matérielles", equipmentRows, "page-break"));

  const popup = window.open("", "_blank", "width=1400,height=900");
  if (!popup) {
    notifyUser("Le navigateur a bloqué l'ouverture. Autorisez les pop-ups pour imprimer le planning Gantt.", "error");
    return;
  }

  popup.document.write(`
    <!doctype html><html lang="fr"><head><meta charset="utf-8" />
    <title>Planning Gantt - ${escapeHtml(longDate(date))}</title>
    <style>
      @page { size: A4 landscape; margin: 6mm; }
      * { box-sizing: border-box; }
      html, body { margin: 0; padding: 0; }
      body { color: #0d2433; font-family: Arial, sans-serif; font-size: 9px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .page { margin: 0 auto; max-width: 285mm; min-height: 190mm; }
      .page-break { break-before: page; page-break-before: always; }
      header { align-items: flex-start; border-bottom: 2px solid #11415f; display: flex; justify-content: space-between; padding: 0 0 3mm; }
      h1 { color: #11415f; font-size: 15px; line-height: 1.1; margin: 0 0 1mm; }
      p { margin: 0.5mm 0; }
      .right { text-align: right; }
      .muted { color: #5f7280; font-size: 8px; }
      .summary { display: grid; gap: 2mm; grid-template-columns: repeat(4, 1fr); margin: 3mm 0; }
      .summary div { border: 1px solid #d9e2e8; font-size: 9px; line-height: 1.15; min-height: 10mm; padding: 1.5mm 2mm; }
      .large-summary { grid-template-columns: repeat(4, 1fr); }
      .status-legend { align-items: center; display: flex; flex-wrap: wrap; gap: 2mm 4mm; margin: 2mm 0 3mm; }
      .status-legend span { align-items: center; color: #45606f; display: inline-flex; font-size: 7.5px; gap: 1mm; }
      .status-legend i { border: 1px solid #50606b; display: inline-block; height: 3mm; width: 5mm; }
      .legend-normal { background: #174f72; }
      .legend-blocked { background: #7c2d12; }
      .legend-paused { background: #7c3aed; }
      .legend-completed { background: #047857; }
      .legend-late { background: #b91c1c; }
      .legend-closed { background: #f3eee6; }
      .gantt-print { border: 1px solid #d9e2e8; overflow: hidden; width: 100%; }
      .gantt-header, .gantt-row { display: grid; grid-template-columns: 34mm 1fr; }
      .gantt-corner, .resource-label { background: #f5f8fa; border-right: 1px solid #d9e2e8; color: #45606f; }
      .gantt-corner { font-weight: 700; min-height: 6mm; padding: 1mm 1.5mm; }
      .time-scale, .timeline { position: relative; }
      .time-scale { background: #f5f8fa; min-height: 6mm; }
      .gantt-row { border-top: 1px solid #d9e2e8; min-height: 13mm; }
      .resource-label { padding: 1.6mm 1.8mm; }
      .resource-label strong { color: #001525; display: block; font-size: 9.5px; line-height: 1.05; }
      .resource-label span { color: #5f7280; display: block; font-size: 7.2px; font-weight: 600; line-height: 1.1; margin-top: 0.8mm; }
      .timeline { min-height: 13mm; }
      .tick { border-left: 1px solid #d9e2e8; bottom: 0; color: #45606f; font-size: 7px; left: 0; position: absolute; top: 0; }
      .tick span { display: block; padding-left: 1mm; padding-top: 1mm; }
      .pause-band { background: #f3eee6; bottom: 0; left: 0; position: absolute; top: 0; z-index: 0; }
      .booking { border-radius: 1.3mm; box-shadow: 0 1mm 3mm rgba(0,0,0,.16); color: #fff; display: flex; flex-direction: column; justify-content: center; min-height: 8.5mm; overflow: hidden; padding: 1mm 1.6mm; position: absolute; top: 2mm; z-index: 2; }
      .booking.blocked { outline: 0.7mm solid #7c2d12; outline-offset: 0; }
      .booking.paused { outline: 0.7mm dashed #7c3aed; outline-offset: 0; }
      .booking.completed { opacity: 0.72; }
      .booking.late { outline: 0.7mm solid #b91c1c; outline-offset: 0; }
      .booking .task-no { background: rgba(255,255,255,.25); border: 0.25mm solid rgba(255,255,255,.35); border-radius: 999px; display: inline-flex; font-size: 6.5px; font-weight: 800; height: 3.4mm; line-height: 1; margin: 0; padding-top: 0.45mm; position: absolute; right: 0.8mm; text-align: center; top: 0.7mm; width: 3.4mm; }
      .booking strong { display: block; font-size: 8px; line-height: 1.05; max-width: calc(100% - 4.5mm); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .booking span { display: block; font-size: 7px; font-weight: 600; line-height: 1.05; margin-top: 0.8mm; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .booking.compact { min-width: 15mm; padding: 1mm 1.1mm; }
      .booking.compact strong { font-size: 7px; }
      .booking.compact span:not(.task-no) { font-size: 6.2px; }
      .booking.tiny, .booking.number-only { min-width: 9mm; padding: 0.8mm; }
      .booking.tiny strong, .booking.tiny span:not(.task-no), .booking.number-only strong, .booking.number-only span:not(.task-no) { display: none; }
      .booking.tiny .task-no, .booking.number-only .task-no { left: 50%; right: auto; top: 50%; transform: translate(-50%, -50%); }
      .task-legend { break-inside: avoid; margin-top: 3mm; page-break-inside: avoid; }
      .task-legend h2 { color: #11415f; font-size: 10px; margin: 0 0 1mm; }
      .task-legend table { border-collapse: collapse; font-size: 7.2px; width: 100%; }
      .task-legend th, .task-legend td { border: 1px solid #d9e2e8; padding: 0.9mm 1.1mm; text-align: left; vertical-align: top; }
      .task-legend th { background: #f5f8fa; color: #45606f; }
      .task-legend .num { font-weight: 800; text-align: center; width: 8mm; }
      .empty { border: 1px solid #d9e2e8; color: #5f7280; font-size: 11px; padding: 8mm; text-align: center; }
      @media print {
        body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .page { max-width: none; width: 100%; }
        header, .summary, .gantt-print { break-inside: avoid; page-break-inside: avoid; }
      }
    </style></head><body>${pages.join("")}<script>window.addEventListener("load", () => setTimeout(() => window.print(), 150));</script></body></html>
  `);
  popup.document.close();
}

function printDailyPlanning(dateKey = state.planningDate) {
  const date = typeof dateKey === "string" ? parseDateKey(dateKey) : new Date(dateKey);
  const dayKey = todayKey(date);
  const dayStart = startOfDay(date);
  const dayEnd = startOfDay(addDays(date, 1));
  const activeResources = orderPlanningResources(state.resources.filter(isHumanPlanningResource));
  const intervals = getDayIntervals(date);
  const holiday = getHoliday(date);

  const rowsByResource = activeResources.map((resource) => {
    const rows = [];
    state.bookings.forEach((booking) => {
      if (!isPrintableWorkBooking(booking)) return;
      if (!isPrimaryResourceBooking(booking, resource.id)) return;
      const caseItem = state.cases.find((item) => item.id === booking.caseId);
      if (!caseItem) return;
      if (!isActivePrintableWorkBooking(booking, caseItem)) return;
      (booking.segments || []).forEach((segment) => {
        const segmentStart = new Date(segment.start);
        const segmentEnd = new Date(segment.end);
        if (segmentEnd <= dayStart || segmentStart >= dayEnd) return;
        const clippedStart = maxDate(segmentStart, dayStart);
        const clippedEnd = minDate(segmentEnd, dayEnd);
        if (clippedEnd <= clippedStart) return;
        rows.push({
          booking,
          caseItem,
          start: clippedStart,
          end: clippedEnd,
          minutes: diffMinutes(clippedStart, clippedEnd),
        });
      });
    });
    rows.sort((a, b) => a.start - b.start || String(a.booking.title || "").localeCompare(String(b.booking.title || "")));
    return { resource, rows };
  });

  const totalMinutes = rowsByResource.reduce(
    (sum, group) => sum + group.rows.reduce((rowSum, row) => rowSum + row.minutes, 0),
    0,
  );
  const resourceSections = rowsByResource
    .filter(({ rows }) => rows.length)
    .map(({ resource, rows }) => {
      const resourceTotal = rows.reduce((sum, row) => sum + row.minutes, 0);
      const body = rows.length
        ? rows.map((row, index) => {
            const item = row.caseItem || {};
            const action = typeof getCaseNextAction === "function" ? getCaseNextAction(item) : null;
            const riskLabel = isCaseBlocked(item) ? "Bloqué" : action?.priority === "urgent" ? "Urgent" : action?.priority === "attention" ? "Attention" : "Normal";
            const partsLabel = PARTS_STATUS_LABELS[normalizePartsStatus(item.partsStatus)] || "Non vérifié";
            const blockerLabel = getCaseBlockerLabel(item) || "-";
            const delivery = row.booking.delivery || item.appointment?.delivery || "";
            const actualStart = row.booking.actualStart || row.booking.startedAt || "";
            const actualEnd = row.booking.actualEnd || row.booking.completedAt || "";
            const observation = row.booking.pauseReason || row.booking.details || item.blockerDetails || "";
            return `
              <tr>
                <td>${index + 1}</td>
                <td>${formatTime(row.start)} - ${formatTime(row.end)}</td>
                <td>${formatLocalizedDecimal(row.minutes / 60)} h</td>
                <td>
                  <strong>${escapeHtml(row.booking.title || getDurationLabel(row.booking.key) || "Travail atelier")}</strong>
                  <div class="muted">${escapeHtml(getDurationLabel(row.booking.key) || row.booking.key || "-")}</div>
                </td>
                <td>
                  <strong>${escapeHtml(item.clientName || "-")}</strong>
                  <div class="muted">${escapeHtml(item.phone || "")}</div>
                </td>
                <td>
                  ${escapeHtml(item.vehicle || "-")}
                  <div class="muted">Immat.: ${escapeHtml(item.plate || "-")} · VIN: ${escapeHtml(item.vin || "-")}</div>
                </td>
                <td>${escapeHtml(getPrintOrderReference(item))}</td>
                <td>${escapeHtml(riskLabel)}</td>
                <td>${escapeHtml(getPrintStatusLabel(item))}</td>
                <td>${escapeHtml(partsLabel)}</td>
                <td>${escapeHtml(blockerLabel)}</td>
                <td>${delivery ? formatDateTime(delivery) : "-"}</td>
                <td>${actualStart ? formatDateTime(actualStart) : ""}</td>
                <td>${actualEnd ? formatDateTime(actualEnd) : ""}</td>
                <td>${escapeHtml(observation)}</td>
                <td class="check-cell">□</td>
                <td class="signature-cell"></td>
              </tr>
            `;
          }).join("")
        : ``;
      return `
        <section class="resource-block">
          <h2>${escapeHtml(resource.name)} <span>${escapeHtml(ROLE_LABELS[resource.role] || resource.role || "Atelier")} · ${escapeHtml(resource.location || "Atelier")}${resource.fastLane ? " · Fast Lane" : ""}</span></h2>
          <table>
            <thead>
              <tr>
                <th>N°</th>
                <th>Horaire</th>
                <th>Durée</th>
                <th>Tâche</th>
                <th>Client</th>
                <th>Véhicule</th>
                <th>Réf. OR</th>
                <th>Priorité / risque</th>
                <th>Statut dossier</th>
                <th>Statut pièces</th>
                <th>Blocage</th>
                <th>Livraison prévue</th>
                <th>Début réel</th>
                <th>Fin réelle</th>
                <th>Observation</th>
                <th>Fait</th>
                <th>Signature</th>
              </tr>
            </thead>
            <tbody>${body}</tbody>
          </table>
          <p class="resource-total"><strong>Total ${escapeHtml(resource.name)} :</strong> ${formatLocalizedDecimal(resourceTotal / 60)} h</p>
        </section>
      `;
    })
    .join("");

  const intervalText = intervals.length
    ? intervals.map((interval) => `${formatTime(interval.start)}-${formatTime(interval.end)}`).join(" / ")
    : holiday ? `Jour férié : ${holiday.label}` : "Jour fermé";

  const popup = window.open("", "_blank", "width=1200,height=900");
  if (!popup) {
    notifyUser("Le navigateur a bloqué l'ouverture. Autorisez les pop-ups pour imprimer le planning journalier.", "error");
    return;
  }
  popup.document.write(`
    <!doctype html>
    <html lang="fr">
      <head>
        <meta charset="utf-8" />
        <title>Planning atelier - ${escapeHtml(longDate(date))}</title>
        <style>
          body { color: #14212b; font-family: Arial, sans-serif; margin: 22px; }
          header { align-items: flex-start; border-bottom: 2px solid #11415f; display: flex; justify-content: space-between; padding-bottom: 14px; }
          h1 { color: #11415f; font-size: 24px; margin: 0 0 6px; }
          h2 { color: #14212b; font-size: 15px; margin: 20px 0 8px; }
          h2 span { color: #687987; font-size: 12px; font-weight: normal; }
          p { margin: 4px 0; }
          table { border-collapse: collapse; font-size: 11px; margin-top: 8px; width: 100%; }
          th, td { border: 1px solid #dce4e9; padding: 6px; text-align: left; vertical-align: top; }
          th { background: #f5f8fa; }
          .right { text-align: right; }
          .muted { color: #687987; font-size: 10px; }
          .summary { display: grid; gap: 10px; grid-template-columns: repeat(4, 1fr); margin: 16px 0; }
          .summary div { border: 1px solid #dce4e9; padding: 10px; }
          .resource-block { break-inside: avoid; page-break-inside: avoid; }
          .resource-total { text-align: right; }
          .check-cell { font-size: 18px; text-align: center; width: 38px; }
          .signature-cell { min-width: 90px; }
          .empty { color: #687987; text-align: center; }
          .footer-signatures { display: grid; gap: 24px; grid-template-columns: repeat(3, 1fr); margin-top: 34px; }
          .signature-box { border-top: 1px solid #14212b; min-height: 54px; padding-top: 8px; }
          @media print { body { margin: 10mm; } header { break-after: avoid; } }
        </style>
      </head>
      <body>
        <header>
          <div>
            <h1>Planning atelier journalier</h1>
            <p class="muted">NIMR SAV · Service Après-Vente Automobile</p>
            <p>Document planning</p>
            <p><strong>Journée :</strong> ${escapeHtml(longDate(date))}</p>
            <p><strong>Horaires :</strong> ${escapeHtml(intervalText)}</p>
          </div>
          <div class="right">
            <p><strong>Imprimé le :</strong> ${formatDateTime(new Date())}</p>
            <p><strong>Ressources actives :</strong> ${activeResources.length}</p>
          </div>
        </header>
        <section class="summary">
          <div><strong>Total planifié</strong><br>${formatLocalizedDecimal(totalMinutes / 60)} h</div>
          <div><strong>Dossiers concernés</strong><br>${new Set(rowsByResource.flatMap((group) => group.rows.map((row) => row.booking.caseId))).size}</div>
          <div><strong>Occup. humaine</strong><br>${Math.round(humanDayLoad(date) * 100)}%</div>
          <div><strong>Occup. matérielle</strong><br>${Math.round(equipmentDayLoad(date) * 100)}%</div>
          <div><strong>État calendrier</strong><br>${escapeHtml(intervals.length ? "Ouvert" : "Fermé")}</div>
        </section>
        ${resourceSections}
        <section class="footer-signatures">
          <div class="signature-box">Chef atelier</div>
          <div class="signature-box">Réception</div>
          <div class="signature-box">Direction / contrôle</div>
        </section>
        <script>window.addEventListener("load", () => window.print());</script>
      </body>
    </html>
  `);
  popup.document.close();
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
          <div class="box"><h2>Client</h2><p><strong>Nom :</strong> ${escapeHtml(item.clientName || '-')}</p><p><strong>Téléphone :</strong> ${escapeHtml(item.phone || '-')}</p><p><strong>Assurance :</strong> ${escapeHtml(item.insurance || '-')}</p></div>
          <div class="box"><h2>Véhicule</h2><p><strong>Modèle :</strong> ${escapeHtml(item.vehicle || '-')}</p><p><strong>Immat. :</strong> ${escapeHtml(item.plate || '-')}</p><p><strong>VIN :</strong> ${escapeHtml(item.vin || '-')}</p><p><strong>Zone :</strong> ${escapeHtml(supplement.vehicleArea || '-')}</p></div>
        </section>
        <section><h2>Motif / dommage découvert</h2><p>${escapeHtml(supplement.reason || 'Aucun motif renseigné.')}</p></section>
        <section><h2>Accords</h2><p>Accord expert : <strong>${supplement.expertApproved ? 'Oui' : 'Non'}</strong> · Validation client/interne : <strong>${supplement.clientApproved ? 'Oui' : 'Non'}</strong></p></section>
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
      .page-break { page-break-before: always; } @media print { body { margin: 14mm; } .page-break { break-before: page; } }
    </style></head><body>${pages}<script>window.addEventListener('load', () => window.print());</script></body></html>
  `);
  popup.document.close();
  addHistory(item, 'supplement.printed', 'Ordre complémentaire imprimé', `${supplements.length} complément(s)`);
  saveState();
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

function buildTechnicianTaskPrintCss() {
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
  const notes = (booking.notes || []).map((note) => `${formatDateTime(note.at)} - ${getResource(note.by)?.name || note.by || "Technicien"} : ${escapeHtml(note.text)}`).join("<br>") || "Aucune note.";
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
        <style>${buildTechnicianTaskPrintCss()}</style>
      </head>
      <body>
        <header>
          <div>
            <h1>NIMR SAV</h1>
            <p>${PRINT_WORKSHOP_SUBTITLE}</p>
            <p>${PRINT_WORKSHOP_SCOPE}</p>
            <p><strong>Fiche de travail technicien</strong></p>
          </div>
          <div class="right">
            <p><strong>Dossier :</strong> ${escapeHtml(getPrintCaseReference(item))}</p>
            <p><strong>Réf. OR :</strong> ${escapeHtml(getPrintOrderReference(item))}</p>
            <p><strong>Imprimé le :</strong> ${formatDateTime(new Date())}</p>
            <p><strong>Statut :</strong> ${escapeHtml(getPrintStatusLabel(item))}</p>
          </div>
        </header>
        <section class="grid">
          <div class="box">
            <h2>Client / véhicule</h2>
            <p><strong>Client :</strong> ${escapeHtml(item.clientName || "-")}</p>
            <p><strong>Téléphone :</strong> ${escapeHtml(item.phone || "-")}</p>
            <p><strong>Véhicule :</strong> ${escapeHtml(item.vehicle || "-")}</p>
            <p><strong>Immatriculation :</strong> ${escapeHtml(item.plate || "-")}</p>
            <p><strong>VIN :</strong> ${escapeHtml(item.vin || "-")}</p>
            <p><strong>Kilométrage :</strong> ${escapeHtml(item.mileage || "-")}</p>
          </div>
          <div class="box">
            <h2>Tâche atelier</h2>
            <p><strong>Ordre :</strong> ${escapeHtml(getPrintOrderReference(item))}</p>
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
            <tr><th>Consignes</th><td>${escapeHtml(booking.details || item.damageNotes || "Aucune consigne renseignée.")}</td></tr>
            <tr><th>Pièces prévues</th><td>${escapeHtml(getAllClaimEstimateParts(item).map((part) => `${part.designation || "Article"} x ${formatLocalizedDecimal(part.quantity || 0)}`).join(" / ") || "Aucune pièce renseignée.")}</td></tr>
            <tr><th>Notes numériques</th><td>${notes}</td></tr>
          </tbody></table>
        </section>
        <section>
          <h2>Suivi manuscrit</h2>
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
  saveState();
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
    <style>${buildTechnicianTaskPrintCss()}</style></head><body>
      <header>
        <div><h1>NIMR SAV</h1><p>${PRINT_WORKSHOP_SUBTITLE}</p><p><strong>Fiche de pause / blocage</strong></p></div>
        <div class="right"><p><strong>Dossier :</strong> ${escapeHtml(getPrintCaseReference(item))}</p><p><strong>Réf. OR :</strong> ${escapeHtml(getPrintOrderReference(item))}</p><p><strong>Imprimé le :</strong> ${formatDateTime(new Date())}</p></div>
      </header>
      <section class="grid">
        <div class="box"><h2>Véhicule</h2><p><strong>Client :</strong> ${escapeHtml(item.clientName || "-")}</p><p><strong>Véhicule :</strong> ${escapeHtml(item.vehicle || "-")}</p><p><strong>Immat. / VIN :</strong> ${escapeHtml(item.plate || item.vin || "-")}</p></div>
        <div class="box"><h2>Tâche concernée</h2><p><strong>Technicien :</strong> ${escapeHtml(technicianName)}</p><p><strong>Tâche :</strong> ${escapeHtml(booking.title || getDurationLabel(booking.key) || "-")}</p><p><strong>Heure pause :</strong> ${booking.pausedAt ? formatDateTime(booking.pausedAt) : ""}</p><p><strong>Heure reprise :</strong> ${booking.resumedAt ? formatDateTime(booking.resumedAt) : ""}</p></div>
      </section>
      <section><h2>Motif / commentaire</h2><table><tbody><tr><th>Motif pause</th><td>${escapeHtml(booking.pauseReason || "-")}</td></tr><tr><th>Motif blocage</th><td>${escapeHtml(booking.blockReason || "-")}</td></tr><tr><th>Commentaire</th><td>${escapeHtml(booking.blockDetails || "")}</td></tr><tr><th>Impact planning estimé</th><td>${booking.remainingMinutes ? `${formatLocalizedDecimal(booking.remainingMinutes / 60)} h restantes` : ""}</td></tr></tbody></table></section>
      <section class="signature-grid"><div class="signature-box"><strong>Signature technicien</strong></div><div class="signature-box"><strong>Signature chef atelier si nécessaire</strong></div></section>
      <footer>Document pause / blocage · ${formatDateTime(new Date())}</footer>
      <script>window.addEventListener('load', () => window.print());</script>
    </body></html>
  `);
  popup.document.close();
}

function printTechnicianWorkOrders(item) {
  item.expertEstimate = normalizeExpertEstimate(item.expertEstimate);
  if (isArchivedCaseForOperationalPrint(item)) {
    notifyUser("Dossier clôturé : les ordres techniciens opérationnels ne sont plus proposés. Imprimez l'ordre de réparation archive.", "warn");
    return;
  }
  const assignments = state.bookings.filter((booking) => booking.caseId === item.id && isPrintableWorkBooking(booking));
  if (!assignments.length) {
    notifyUser("Aucune tâche assignée. Calculez/validez le planning avant d'imprimer les ordres techniciens.", "error");
    return;
  }
  const businessAssignments = getPrintableTechnicianBusinessAssignments(assignments);

  const grouped = new Map();
  businessAssignments.forEach((booking) => {
    const humanResourceIds = (booking.resourceIds || []).filter((resourceId) => isPrintHumanResource(getResource(resourceId)));
    humanResourceIds.forEach((resourceId) => {
      const resource = getResource(resourceId) || { id: resourceId, name: "Technicien", role: "atelier", location: "" };
      if (!grouped.has(resource.id)) grouped.set(resource.id, { resource, tasks: [] });
      grouped.get(resource.id).tasks.push(booking);
    });
  });
  if (!grouped.size) {
    notifyUser("Aucune ressource humaine assignée. Les équipements seuls ne génèrent pas d'ordre technicien.", "warn");
    return;
  }

  const pages = [...grouped.values()].map(({ resource, tasks }, index) => {
    const sortedTasks = [...tasks].sort((a, b) => new Date(a.start) - new Date(b.start));
    const taskPhases = new Set(sortedTasks.map((booking) => booking.key).filter(Boolean));
    const taskRows = sortedTasks
      .map((booking, taskIndex) => `
        <tr>
          <td>${taskIndex + 1}</td>
          <td>
            <strong>${escapeHtml(booking.title || getDurationLabel(booking.key) || "Travail atelier")}</strong>
            <div class="muted">Étape: ${escapeHtml(getDurationLabel(booking.key) || booking.key || "-")}</div>
            <div class="muted">Équipement: ${escapeHtml((booking.resourceIds || []).map((id) => getResource(id)).filter(isPrintEquipmentResource).map((resource) => resource.name).join(", ") || "-")}</div>
          </td>
          <td>${formatDateTime(booking.start)}</td>
          <td>${formatDateTime(booking.end)}</td>
          <td>${booking.actualStart ? formatDateTime(booking.actualStart) : ""}</td>
          <td>${booking.actualEnd || booking.completedAt ? formatDateTime(booking.actualEnd || booking.completedAt) : ""}</td>
          <td>${escapeHtml(booking.pauseReason || "")}</td>
          <td class="check-cell">□</td>
        </tr>
      `)
      .join("");

    const estimateRows = buildTechnicianEstimateRows(item, taskPhases);
    const estimateSection = estimateRows.length
      ? `
        <section>
          <h2>Rappel main-d'œuvre du devis</h2>
          <p class="muted">Lignes reprises du devis exactement pour rappeler les opérations à réaliser. Les lignes mixtes sont affichées aux techniciens concernés avec la part affectée.</p>
          <table class="estimate-table">
            <thead>
              <tr><th>N°</th><th>Ligne devis / opération</th><th>Qté devis</th><th>Part affectée</th><th>Étape concernée</th><th>Fait</th></tr>
            </thead>
            <tbody>${estimateRows.map((line, lineIndex) => `
              <tr>
                <td>${lineIndex + 1}</td>
                <td><strong>${escapeHtml(line.operation)}</strong>${line.rawText && line.rawText !== line.operation ? `<div class="muted">${escapeHtml(line.rawText)}</div>` : ""}</td>
                <td>${formatLocalizedDecimal(line.laborHours)} h</td>
                <td>${formatLocalizedDecimal(line.assignedHours)} h</td>
                <td>${escapeHtml(line.phaseLabel)}</td>
                <td class="check-cell">□</td>
              </tr>
            `).join("")}</tbody>
          </table>
        </section>
      `
      : `
        <section>
          <h2>Rappel main-d'œuvre du devis</h2>
          <div class="empty-inline">Aucune ligne de main-d'œuvre devis affectée à ce technicien. Importez le devis dans l'onglet Ordres & devis.</div>
        </section>
      `;

    return `
      <section class="work-order-page ${index ? "page-break" : ""}">
        <header>
          <div>
            <h1>Ordre de travail technicien</h1>
            <p class="muted">NIMR SAV · Service Après-Vente Automobile</p>
            <p>Document technicien</p>
            <p><strong>Technicien / ressource :</strong> ${escapeHtml(resource.name)}</p>
            <p><strong>Poste :</strong> ${escapeHtml(resource.location || resource.role || "-")}</p>
          </div>
          <div class="right">
            <p><strong>Imprimé le :</strong> ${formatDateTime(new Date())}</p>
            <p><strong>Réf. OR :</strong> ${escapeHtml(getPrintOrderReference(item))}</p>
            <p><strong>Devis :</strong> ${escapeHtml(getClaimReferenceSummary(item, 'devis'))}</p>
            <p><strong>Statut dossier :</strong> ${escapeHtml(getPrintStatusLabel(item))}</p>
          </div>
        </header>

        <section class="grid">
          <div class="box">
            <h2>Client</h2>
            <p><strong>Nom :</strong> ${escapeHtml(item.clientName || "-")}</p>
            <p><strong>Téléphone :</strong> ${escapeHtml(item.phone || "-")}</p>
            <p><strong>Assurance :</strong> ${escapeHtml(item.insurance || "-")}</p>
          </div>
          <div class="box">
            <h2>Véhicule</h2>
            <p><strong>Modèle :</strong> ${escapeHtml(item.vehicle || "-")}</p>
            <p><strong>Immatriculation :</strong> ${escapeHtml(item.plate || "-")}</p>
            <p><strong>Couleur :</strong> ${escapeHtml(item.color || "-")}</p>
            <p><strong>Kilométrage :</strong> ${escapeHtml(item.mileage ? `${item.mileage} km` : "-")}</p>
            <p><strong>VIN :</strong> ${escapeHtml(item.vin || "-")}</p>
          </div>
        </section>

        <section>
          <h2>Tâches planifiées</h2>
          <table>
            <thead>
              <tr><th>N°</th><th>Tâche planning</th><th>Début prévu</th><th>Fin prévue</th><th>Début réel</th><th>Fin réelle</th><th>Pause / cause</th><th>Fait</th></tr>
            </thead>
            <tbody>${taskRows}</tbody>
          </table>
        </section>

        ${estimateSection}

        <section>
          <h2>Consignes / observations</h2>
          <p>${escapeHtml(item.damageNotes || "Aucune observation renseignée.")}</p>
        </section>

        <section>
          <h2>Suivi atelier</h2>
          <table>
            <tbody>
              <tr><td>Pièce manquante</td><td class="check-cell">□</td><td>Anomalie découverte</td><td class="check-cell">□</td></tr>
              <tr><td>Besoin de complément</td><td class="check-cell">□</td><td>Essai réalisé</td><td class="check-cell">□</td></tr>
              <tr><td>Travail terminé</td><td class="check-cell">□</td><td>Retour qualité</td><td class="check-cell">□</td></tr>
            </tbody>
          </table>
          <div class="notes-box">Observations technicien / demande complément :</div>
        </section>

        <section class="signature-grid">
          <div class="signature-box">
            <strong>Signature technicien</strong>
            <span>Nom, date et signature</span>
          </div>
          <div class="signature-box">
            <strong>Validation chef atelier</strong>
            <span>Nom, date et signature</span>
          </div>
        </section>
      </section>
    `;
  }).join("");

  const popup = window.open("", "_blank", "width=900,height=1100");
  if (!popup) {
    notifyUser("Le navigateur a bloqué l'ouverture. Autorisez les pop-ups pour imprimer les ordres techniciens.");
    return;
  }
  popup.document.write(`
    <!doctype html>
    <html lang="fr">
      <head>
        <meta charset="utf-8" />
        <title>Ordres techniciens - ${escapeHtml(item.clientName || "Dossier")}</title>
        <style>
          @page { size: A4 portrait; margin: 8mm; }
          * { box-sizing: border-box; }
          body { color: #14212b; font-family: Arial, sans-serif; font-size: 10.5px; line-height: 1.18; margin: 8mm auto; max-width: 194mm; }
          .work-order-page { break-after: page; page-break-after: always; }
          .work-order-page:last-child { break-after: auto; page-break-after: auto; }
          header { align-items: flex-start; border-bottom: 2px solid #11415f; display: flex; justify-content: space-between; padding-bottom: 7px; }
          h1 { color: #11415f; font-size: 16px; margin: 0 0 3px; }
          h2 { font-size: 11px; margin: 8px 0 4px; }
          p { margin: 2px 0; }
          section { break-inside: avoid; page-break-inside: avoid; }
          table { border-collapse: collapse; margin-top: 4px; table-layout: fixed; width: 100%; }
          th, td { border: 1px solid #dce4e9; padding: 3px 4px; text-align: left; vertical-align: top; word-break: break-word; }
          th { background: #f5f8fa; }
          .right { text-align: right; }
          .grid { display: grid; gap: 6px; grid-template-columns: repeat(2, 1fr); margin-top: 8px; }
          .box { border: 1px solid #dce4e9; padding: 5px; }
          .muted { color: #687987; font-size: 9.5px; }
          .empty-inline { border: 1px dashed #dce4e9; color: #687987; padding: 6px; }
          .notes-box { border: 1px solid #dce4e9; min-height: 42px; padding: 5px; }
          .check-cell { font-size: 13px; text-align: center; width: 32px; }
          .estimate-table th:nth-child(1), .estimate-table td:nth-child(1) { width: 24px; }
          .estimate-table th:nth-child(2), .estimate-table td:nth-child(2) { width: 44%; }
          .estimate-table th:nth-child(3), .estimate-table td:nth-child(3) { width: 42px; }
          .estimate-table th:nth-child(4), .estimate-table td:nth-child(4) { width: 48px; }
          .estimate-table th:nth-child(6), .estimate-table td:nth-child(6) { width: 32px; }
          .estimate-table td { font-size: 9.5px; }
          .signature-grid { break-inside: avoid; display: grid; gap: 28px; grid-template-columns: repeat(2, 1fr); margin-top: 18px; page-break-inside: avoid; }
          .signature-box { border-top: 1px solid #14212b; min-height: 34px; padding-top: 5px; }
          .signature-box span { color: #687987; display: block; font-size: 9px; margin-top: 3px; }
          .page-break { page-break-before: always; }
          @media print { body { margin: 0; max-width: none; } .page-break { break-before: page; } }
        </style>
      </head>
      <body>${pages}<script>window.addEventListener("load", () => window.print());</script></body>
    </html>
  `);
  popup.document.close();

  addHistory(item, "work_orders.printed", "Ordres de travail techniciens imprimés", `${grouped.size} technicien${grouped.size > 1 ? "s" : ""}`);
  saveState();
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
