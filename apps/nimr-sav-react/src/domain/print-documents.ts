import { SavCase, Claim } from './sav-case';
import { APP_VERSION } from '../constants/version';

export type PrintableDocumentType =
  | 'reception_sheet'
  | 'workshop_sheet'
  | 'quality_check_sheet'
  | 'delivery_receipt'
  | 'claim_summary'
  | 'estimate_summary'
  | 'complete_case';

export function sanitizePrintableText(text: string | undefined | null): string {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

export function formatPrintDate(isoDate: string | undefined | null): string {
  if (!isoDate) return 'N/A';
  try {
    const d = new Date(isoDate);
    if (isNaN(d.getTime())) return 'N/A';
    return d.toLocaleDateString('fr-FR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return 'N/A';
  }
}

export function formatPrintMoney(amount: number | undefined | null): string {
  if (amount === undefined || amount === null) return '0.00 TND';
  return `${amount.toFixed(2)} TND`;
}

export function formatPrintDuration(minutes: number | undefined | null): string {
  if (!minutes) return '0h00';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h${m.toString().padStart(2, '0')}`;
}

export function getPrintDocumentTitle(documentType: PrintableDocumentType): string {
  const titles: Record<PrintableDocumentType, string> = {
    reception_sheet: 'Fiche de Réception Véhicule',
    workshop_sheet: 'Ordre de Travail Atelier',
    quality_check_sheet: 'Fiche de Contrôle Qualité',
    delivery_receipt: 'Procès-Verbal de Restitution Client',
    claim_summary: 'Synthèse des Sinistres & Claims',
    estimate_summary: 'Synthèse du Devis Estimatif',
    complete_case: 'Dossier SAV Complet',
  };
  return titles[documentType] || 'Document SAV';
}

export function buildPrintableHtml(title: string, bodyContent: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${sanitizePrintableText(title)}</title>
  <style>
    body {
      font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
      color: #333;
      background: #fff;
      margin: 0;
      padding: 20px;
      font-size: 13px;
      line-height: 1.4;
    }
    .header {
      border-bottom: 2px solid #333;
      padding-bottom: 10px;
      margin-bottom: 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .header h1 {
      font-size: 20px;
      margin: 0;
      text-transform: uppercase;
    }
    .logo-area {
      font-weight: bold;
      font-size: 16px;
      color: #1a56db;
    }
    .meta-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 15px;
      margin-bottom: 20px;
      background: #f9fafb;
      padding: 15px;
      border: 1px solid #e5e7eb;
      border-radius: 4px;
    }
    .meta-item {
      display: flex;
      justify-content: space-between;
      border-bottom: 1px dashed #e5e7eb;
      padding-bottom: 4px;
    }
    .meta-item strong {
      color: #111827;
    }
    .section-title {
      font-size: 14px;
      font-weight: bold;
      border-bottom: 1px solid #374151;
      padding-bottom: 4px;
      margin-top: 25px;
      margin-bottom: 10px;
      text-transform: uppercase;
      color: #111827;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 15px;
    }
    th, td {
      border: 1px solid #d1d5db;
      padding: 8px;
      text-align: left;
    }
    th {
      background-color: #f3f4f6;
      font-weight: bold;
    }
    .badge {
      display: inline-block;
      padding: 2px 6px;
      font-size: 10px;
      font-weight: bold;
      border-radius: 3px;
      background: #e5e7eb;
      color: #374151;
    }
    .badge-approved { background: #d1fae5; color: #065f46; }
    .badge-pending { background: #fef3c7; color: #92400e; }
    .badge-rejected { background: #fee2e2; color: #991b1b; }
    .footer {
      margin-top: 50px;
      border-top: 1px solid #e5e7eb;
      padding-top: 10px;
      font-size: 10px;
      color: #9ca3af;
      text-align: center;
      display: flex;
      justify-content: space-between;
    }
    .signature-area {
      margin-top: 40px;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 50px;
    }
    .signature-box {
      border: 1px solid #d1d5db;
      height: 100px;
      padding: 10px;
      border-radius: 4px;
    }
    .signature-title {
      font-weight: bold;
      margin-bottom: 40px;
    }
    .warning-banner {
      background: #fffbeb;
      border: 1px solid #fef3c7;
      color: #b45309;
      padding: 10px;
      border-radius: 4px;
      margin-bottom: 15px;
      font-weight: bold;
    }
    @media print {
      body {
        padding: 0;
      }
      .no-print {
        display: none;
      }
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="logo-area">NIMR CARROSSERIE SAV</div>
    <h1>${sanitizePrintableText(title)}</h1>
  </div>
  ${bodyContent}
  <div class="footer">
    <span>Application NIMR SAV v24 (Migration Active)</span>
    <span>Version : ${sanitizePrintableText(APP_VERSION)}</span>
    <span>Date d'édition : ${sanitizePrintableText(new Date().toLocaleDateString('fr-FR'))}</span>
  </div>
</body>
</html>`;
}

function buildCaseMetaHtml(c: SavCase): string {
  return `
  <div class="meta-grid">
    <div class="meta-item"><strong>Numéro de Dossier :</strong> <span>${sanitizePrintableText(c.id)}</span></div>
    <div class="meta-item"><strong>Immatriculation :</strong> <span>${sanitizePrintableText(c.immatriculation)}</span></div>
    <div class="meta-item"><strong>N° de Châssis (VIN) :</strong> <span>${sanitizePrintableText(c.vin)}</span></div>
    <div class="meta-item"><strong>Nom Client :</strong> <span>${sanitizePrintableText(c.clientName)}</span></div>
    <div class="meta-item"><strong>Téléphone :</strong> <span>${sanitizePrintableText(c.telephone)}</span></div>
    <div class="meta-item"><strong>Date Réception :</strong> <span>${formatPrintDate(c.receptionDate)}</span></div>
    <div class="meta-item"><strong>Statut Global :</strong> <span class="badge">${sanitizePrintableText(c.status.toUpperCase())}</span></div>
    <div class="meta-item"><strong>Priorité Atelier :</strong> <span>${sanitizePrintableText(c.workshopPriority || 'normale')}</span></div>
  </div>`;
}

function buildClaimsHtml(claims: Claim[] | undefined, claimsOverridden = false, claimsOverrideReason = ''): string {
  if (!claims || claims.length === 0) {
    return '<p>Aucun sinistre (claim) associé à ce dossier.</p>';
  }

  let html = `
  <table>
    <thead>
      <tr>
        <th>Libellé Sinistre</th>
        <th>Type</th>
        <th>Payeur</th>
        <th>Montant Estimé</th>
        <th>Accord Expert</th>
        <th>Accord Client</th>
        <th>Statut</th>
      </tr>
    </thead>
    <tbody>`;

  claims.forEach(cl => {
    const expertBadge = cl.expertApproved ? 'badge-approved' : 'badge-pending';
    const clientBadge = cl.clientApproved ? 'badge-approved' : 'badge-pending';
    html += `
      <tr>
        <td>${sanitizePrintableText(cl.label)}</td>
        <td>${sanitizePrintableText(cl.claimType)}</td>
        <td>${sanitizePrintableText(cl.payerType)}</td>
        <td>${formatPrintMoney(cl.estimatedAmount)}</td>
        <td><span class="badge ${expertBadge}">${cl.expertApproved ? 'Validé' : 'En attente'}</span> ${cl.expertName ? `(${sanitizePrintableText(cl.expertName)})` : ''}</td>
        <td><span class="badge ${clientBadge}">${cl.clientApproved ? 'Validé' : 'En attente'}</span> ${cl.clientApprovalReference ? `(Réf: ${sanitizePrintableText(cl.clientApprovalReference)})` : ''}</td>
        <td><span class="badge">${sanitizePrintableText(cl.status.toUpperCase())}</span></td>
      </tr>`;
  });

  html += '</tbody></table>';

  if (claimsOverridden) {
    html += `
    <div class="warning-banner" style="background:#ecfdf5; border-color:#a7f3d0; color:#047857;">
      Dérogation active : accords forcés par l'administration.<br>
      Raison : "${sanitizePrintableText(claimsOverrideReason)}"
    </div>`;
  }

  return html;
}

function buildEstimatesHtml(claims: Claim[] | undefined): string {
  let hasEstimate = false;
  let html = '';

  (claims || []).forEach(cl => {
    if (cl.estimate) {
      hasEstimate = true;
      html += `
      <div style="margin-top: 15px; padding: 10px; border: 1px solid #e5e7eb; border-radius: 4px;">
        <h4 style="margin: 0 0 8px 0; color: #1a56db;">Devis pour ${sanitizePrintableText(cl.label)} (Fichier : ${sanitizePrintableText(cl.estimate.sourceFileName)})</h4>
        <table>
          <tr>
            <th>Total HT</th>
            <td>${formatPrintMoney(cl.estimate.totals.amountHT)}</td>
            <th>Total TVA</th>
            <td>${formatPrintMoney(cl.estimate.totals.amountTVA)}</td>
            <th>Total TTC</th>
            <td><strong>${formatPrintMoney(cl.estimate.totals.amountTTC)}</strong></td>
          </tr>
        </table>
        <strong>Charge estimée par pôle d'atelier :</strong>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 8px; margin-top: 5px;">`;

      Object.entries(cl.estimate.laborSummary).forEach(([pole, hours]) => {
        if (hours > 0) {
          html += `
          <div style="background: #f9fafb; padding: 4px 8px; border: 1px solid #e5e7eb; font-size: 11px; border-radius: 3px; display: flex; justify-content: space-between;">
            <span style="text-transform: capitalize;">${sanitizePrintableText(pole.replace('_', ' '))}</span>
            <strong>${hours}h</strong>
          </div>`;
        }
      });

      html += `
        </div>
      </div>`;
    }
  });

  if (!hasEstimate) {
    return '<p>Aucun devis importé pour ce dossier.</p>';
  }
  return html;
}

export function buildReceptionSheet(c: SavCase): string {
  let body = buildCaseMetaHtml(c);
  body += '<div class="section-title">Description & Motif de la Réception</div>';
  body += `<p style="white-space: pre-wrap; background: #f9fafb; padding: 10px; border: 1px solid #e5e7eb; border-radius: 4px;">${sanitizePrintableText(c.directionNotes || 'Aucun motif ou note spécifiée.')}</p>`;

  body += '<div class="section-title">Liste des Sinistres (Claims) déclarés</div>';
  body += buildClaimsHtml(c.claims, c.claimsOverridden, c.claimsOverrideReason);

  body += `
  <div class="signature-area">
    <div class="signature-box">
      <div class="signature-title">Signature Conseiller Client</div>
    </div>
    <div class="signature-box">
      <div class="signature-title">Signature Client (Bon pour accord de prise en charge)</div>
    </div>
  </div>`;

  return buildPrintableHtml(getPrintDocumentTitle('reception_sheet'), body);
}

export function buildWorkshopSheet(c: SavCase): string {
  let body = buildCaseMetaHtml(c);

  body += '<div class="section-title">Planification Atelier</div>';
  body += `
  <div class="meta-grid" style="background:#fff; border-color:#d1d5db;">
    <div class="meta-item"><strong>Poste / Baie affectée :</strong> <span>${sanitizePrintableText(c.workshopBay || 'Non affecté')}</span></div>
    <div class="meta-item"><strong>Durée planifiée :</strong> <span>${formatPrintDuration(c.estimatedDurationMinutes)}</span></div>
    <div class="meta-item"><strong>Technicien affecté :</strong> <span>${sanitizePrintableText(c.assignedTechnicianName || 'Non affecté')}</span></div>
    <div class="meta-item"><strong>Début des travaux :</strong> <span>${formatPrintDate(c.plannedStartAt)}</span></div>
    <div class="meta-item"><strong>Fin des travaux :</strong> <span>${formatPrintDate(c.plannedEndAt)}</span></div>
    <div class="meta-item"><strong>Date estimée de livraison :</strong> <span>${formatPrintDate(c.estimatedReadyDate)}</span></div>
  </div>`;

  body += '<div class="section-title">Devis & Charges de Main d\'Oeuvre</div>';
  body += buildEstimatesHtml(c.claims);

  body += '<div class="section-title">Tâches de Travail Atelier</div>';
  if (c.workshopTasks && c.workshopTasks.length > 0) {
    body += `
    <table>
      <thead>
        <tr>
          <th>Pôle</th>
          <th>Tâche / Opération</th>
          <th>Durée Estimée</th>
          <th>Statut</th>
        </tr>
      </thead>
      <tbody>`;
    c.workshopTasks.forEach(t => {
      body += `
        <tr>
          <td style="text-transform: capitalize;">${sanitizePrintableText(t.pole || 'autre')}</td>
          <td>${sanitizePrintableText(t.label)}</td>
          <td>${formatPrintDuration(t.estimatedDurationMinutes)}</td>
          <td><span class="badge">${sanitizePrintableText(t.status.toUpperCase())}</span></td>
        </tr>`;
    });
    body += '</tbody></table>';
  } else {
    body += '<p>Aucune tâche d\'atelier générée pour ce dossier.</p>';
  }

  body += `
  <div class="signature-area">
    <div class="signature-box" style="height: 80px;">
      <div class="signature-title">Visa Chef d'Atelier</div>
    </div>
    <div class="signature-box" style="height: 80px;">
      <div class="signature-title">Visa Technicien affecté</div>
    </div>
  </div>`;

  return buildPrintableHtml(getPrintDocumentTitle('workshop_sheet'), body);
}

export function buildQualityCheckSheet(c: SavCase): string {
  let body = buildCaseMetaHtml(c);

  body += '<div class="section-title">Statut Contrôle Qualité</div>';
  body += `
  <div class="meta-grid" style="background:#fff; border-color:#d1d5db;">
    <div class="meta-item"><strong>Statut QC :</strong> <span class="badge">${sanitizePrintableText((c.qcStatus || 'En attente').toUpperCase())}</span></div>
    <div class="meta-item"><strong>Validé le :</strong> <span>${formatPrintDate(c.qcCheckedAt)}</span></div>
    <div class="meta-item"><strong>Contrôleur :</strong> <span>${sanitizePrintableText(c.qcCheckedBy || 'N/A')}</span></div>
    <div class="meta-item"><strong>Motif de rejet/reprise éventuel :</strong> <span>${sanitizePrintableText(c.qcRejectionReason || c.qcReworkReason || 'Aucun')}</span></div>
  </div>`;

  body += '<div class="section-title">Checklist de Conformité</div>';
  const checklist = c.qcChecklist;
  if (checklist) {
    const items = Array.isArray(checklist) ? checklist : (checklist.items || []);
    if (items.length > 0) {
      body += `
      <table>
        <thead>
          <tr>
            <th>Élément Contrôlé</th>
            <th>Requis</th>
            <th>Résultat</th>
          </tr>
        </thead>
        <tbody>`;
      items.forEach(item => {
        body += `
          <tr>
            <td>${sanitizePrintableText(item.label)}</td>
            <td>${item.required ? 'Oui' : 'Non'}</td>
            <td><strong>${item.checked ? '✔️ CONFORME' : '❌ NON CONFORME / A REFAIRE'}</strong></td>
          </tr>`;
      });
      body += '</tbody></table>';
    } else {
      body += '<p>Checklist vide.</p>';
    }
  } else {
    body += '<p>Aucune checklist de contrôle qualité disponible pour ce dossier.</p>';
  }

  body += `
  <div class="signature-area">
    <div class="signature-box" style="height: 80px;">
      <div class="signature-title">Signature Contrôleur Qualité</div>
    </div>
  </div>`;

  return buildPrintableHtml(getPrintDocumentTitle('quality_check_sheet'), body);
}

export function buildDeliveryReceipt(c: SavCase): string {
  let body = buildCaseMetaHtml(c);

  body += '<div class="section-title">Restitution & Livraison du Véhicule</div>';
  body += `
  <div class="meta-grid" style="background:#fff; border-color:#d1d5db;">
    <div class="meta-item"><strong>Date et Heure Restitution :</strong> <span>${formatPrintDate(c.deliveredAt || c.deliveryDate)}</span></div>
    <div class="meta-item"><strong>Livré par :</strong> <span>${sanitizePrintableText(c.deliveredBy || 'N/A')}</span></div>
    <div class="meta-item"><strong>Nom du Réceptionnaire :</strong> <span>${sanitizePrintableText(c.deliveryRecipientName || c.clientName)}</span></div>
    <div class="meta-item"><strong>Référence Preuve / Signataire :</strong> <span>${sanitizePrintableText(c.deliveryProofReference || 'N/A')}</span></div>
  </div>`;

  body += '<div class="section-title">Notes de Livraison</div>';
  body += `<p style="white-space: pre-wrap; background: #f9fafb; padding: 10px; border: 1px solid #e5e7eb; border-radius: 4px;">${sanitizePrintableText(c.deliveryNotes || 'Aucune note de livraison.')}</p>`;

  body += '<div class="section-title">Synthèse des Travaux & Sinistres</div>';
  body += buildClaimsHtml(c.claims, c.claimsOverridden, c.claimsOverrideReason);

  body += `
  <div class="signature-area" style="margin-top: 50px;">
    <div class="signature-box">
      <div class="signature-title">Signature Conseiller Livraison (NIMR)</div>
    </div>
    <div class="signature-box">
      <div class="signature-title">Signature Client / Réceptionnaire (Décharge de réception conforme)</div>
    </div>
  </div>`;

  return buildPrintableHtml(getPrintDocumentTitle('delivery_receipt'), body);
}

export function buildClaimSummary(c: SavCase): string {
  let body = `<h3>Sinistres déclarés pour le dossier ${sanitizePrintableText(c.immatriculation)}</h3>`;
  body += buildClaimsHtml(c.claims, c.claimsOverridden, c.claimsOverrideReason);
  return buildPrintableHtml(getPrintDocumentTitle('claim_summary'), body);
}

export function buildEstimateSummary(c: SavCase): string {
  let body = `<h3>Devis & Charges de Main d'Oeuvre pour le dossier ${sanitizePrintableText(c.immatriculation)}</h3>`;
  body += buildEstimatesHtml(c.claims);
  return buildPrintableHtml(getPrintDocumentTitle('estimate_summary'), body);
}

export function buildCompleteCasePrint(c: SavCase): string {
  let body = '<h2>Dossier Technique & Commercial SAV Complet</h2>';
  body += buildCaseMetaHtml(c);

  body += '<div class="section-title">1. Réception & Motif de Prise en Charge</div>';
  body += `<p style="white-space: pre-wrap; background: #f9fafb; padding: 10px; border: 1px solid #e5e7eb; border-radius: 4px;">${sanitizePrintableText(c.directionNotes || 'Aucun motif spécifié.')}</p>`;

  body += '<div class="section-title">2. Sinistres & Claims Rattachés</div>';
  body += buildClaimsHtml(c.claims, c.claimsOverridden, c.claimsOverrideReason);

  body += '<div class="section-title">3. Détails Devis & Calcul Charge Atelier</div>';
  body += buildEstimatesHtml(c.claims);

  body += '<div class="section-title">4. Planification & Tâches d\'Atelier</div>';
  if (c.workshopTasks && c.workshopTasks.length > 0) {
    body += `
    <table>
      <thead>
        <tr>
          <th>Pôle</th>
          <th>Tâche / Opération</th>
          <th>Durée Estimée</th>
          <th>Statut</th>
        </tr>
      </thead>
      <tbody>`;
    c.workshopTasks.forEach(t => {
      body += `
        <tr>
          <td style="text-transform: capitalize;">${sanitizePrintableText(t.pole || 'autre')}</td>
          <td>${sanitizePrintableText(t.label)}</td>
          <td>${formatPrintDuration(t.estimatedDurationMinutes)}</td>
          <td><span class="badge">${sanitizePrintableText(t.status.toUpperCase())}</span></td>
        </tr>`;
    });
    body += '</tbody></table>';
  } else {
    body += '<p>Aucune tâche d\'atelier enregistrée.</p>';
  }

  body += '<div class="section-title">5. Contrôle Qualité Technique</div>';
  const checklist = c.qcChecklist;
  if (checklist) {
    const items = Array.isArray(checklist) ? checklist : (checklist.items || []);
    if (items.length > 0) {
      body += `
      <table>
        <thead>
          <tr>
            <th>Élément Contrôlé</th>
            <th>Résultat</th>
          </tr>
        </thead>
        <tbody>`;
      items.forEach(item => {
        body += `
          <tr>
            <td>${sanitizePrintableText(item.label)}</td>
            <td><strong>${item.checked ? '✔️ CONFORME' : '❌ NON CONFORME'}</strong></td>
          </tr>`;
      });
      body += '</tbody></table>';
    }
  }

  body += '<div class="section-title">6. Restitution au Client</div>';
  body += `
  <div class="meta-grid" style="background:#fff; border-color:#d1d5db;">
    <div class="meta-item"><strong>Date Restitution :</strong> <span>${formatPrintDate(c.deliveredAt || c.deliveryDate)}</span></div>
    <div class="meta-item"><strong>Nom Réceptionnaire :</strong> <span>${sanitizePrintableText(c.deliveryRecipientName || c.clientName)}</span></div>
    <div class="meta-item"><strong>Preuve :</strong> <span>${sanitizePrintableText(c.deliveryProofReference || 'N/A')}</span></div>
  </div>`;

  return buildPrintableHtml(getPrintDocumentTitle('complete_case'), body);
}

/** Alias for read-only view document preview */
export const buildCompleteCaseSummary = buildCompleteCasePrint;
