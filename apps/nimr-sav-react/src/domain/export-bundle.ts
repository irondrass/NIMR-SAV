import { SavCase } from './sav-case';
import { collectCasePhotos, dataUrlToExportContent, buildPhotoExportFileName } from './photo-export';
import {
  buildReceptionSheet,
  buildWorkshopSheet,
  buildQualityCheckSheet,
  buildDeliveryReceipt,
  buildCompleteCasePrint
} from './print-documents';

export type ExportFileType = 'html' | 'json' | 'text' | 'photo' | 'manifest';

export interface ExportBundleFile {
  id: string;
  fileName: string;
  fileType: ExportFileType;
  mimeType: string;
  content: string; // Text content or base64 data
  size: number;
  source: string;
  relatedClaimId?: string;
  relatedEstimateId?: string;
  relatedPhotoId?: string;
}

export interface ExportBundle {
  id: string;
  caseId: string;
  generatedAt: string;
  generatedBy: string;
  files: ExportBundleFile[];
  manifest: string;
  warnings: string[];
}

export function sanitizeExportFileName(name: string): string {
  return name
    .replace(/[àáâãäå]/g, 'a')
    .replace(/[ç]/g, 'c')
    .replace(/[éèêë]/g, 'e')
    .replace(/[íìîï]/g, 'i')
    .replace(/[ñ]/g, 'n')
    .replace(/[óòôõöø]/g, 'o')
    .replace(/[úùûü]/g, 'u')
    .replace(/[ÿ]/g, 'y')
    .replace(/[^a-zA-Z0-9_.-]/g, '_');
}

export function buildSafeExportFileName(c: SavCase): string {
  const clientPart = sanitizeExportFileName(c.clientName || 'Client');
  const platePart = sanitizeExportFileName(c.immatriculation || c.id);
  return `${clientPart}_${platePart}`;
}

export function buildCaseExportManifest(c: SavCase, files: ExportBundleFile[]): string {
  const manifestData = {
    caseId: c.id,
    immatriculation: c.immatriculation,
    vin: c.vin,
    clientName: c.clientName,
    exportedAt: new Date().toISOString(),
    filesCount: files.length,
    files: files.map(f => ({
      fileName: f.fileName,
      fileType: f.fileType,
      mimeType: f.mimeType,
      sizeBytes: f.size,
      source: f.source,
    })),
  };
  return JSON.stringify(manifestData, null, 2);
}

export function buildCaseJsonExport(c: SavCase): string {
  return JSON.stringify(c, null, 2);
}

export function buildCaseTextSummary(c: SavCase): string {
  const claimsText = (c.claims || [])
    .map(
      cl =>
        `- ${cl.label} [${cl.claimType}] : Status=${cl.status}, ExpertApproved=${cl.expertApproved}, ClientApproved=${cl.clientApproved}`
    )
    .join('\n');

  return `=========================================
DOSSIER SAV NIMR : ${c.immatriculation}
=========================================
Client : ${c.clientName}
Téléphone : ${c.telephone}
VIN : ${c.vin}
Statut Global : ${c.status}
Date Réception : ${c.receptionDate}
Priorité Atelier : ${c.workshopPriority || 'normale'}
Poste affecté : ${c.workshopBay || 'Non affecté'}

-----------------------------------------
SINISTRES & CLAIMS :
-----------------------------------------
${claimsText || 'Aucun sinistre'}

-----------------------------------------
NOTES DE LA DIRECTION :
-----------------------------------------
${c.directionNotes || 'Aucune note.'}

-----------------------------------------
LOGS / AUDIT DU WORKFLOW :
-----------------------------------------
Date de création : ${c.createdAt}
Dernière mise à jour : ${c.updatedAt}
`;
}

export function collectCasePhotoExports(c: SavCase): ExportBundleFile[] {
  const photos = collectCasePhotos(c);
  return photos.map((p, idx) => {
    const rawData = p.dataUrl || '';
    const { mimeType, base64 } = dataUrlToExportContent(rawData);
    const fileName = `photos/${buildPhotoExportFileName(p, idx + 1)}`;
    const size = Math.round(base64.length * 0.75); // rough estimate of bytes from base64

    return {
      id: p.id,
      fileName,
      fileType: 'photo',
      mimeType,
      content: base64,
      size,
      source: 'case_photos',
      relatedClaimId: p.relatedClaimId,
      relatedEstimateId: p.relatedEstimateId,
      relatedPhotoId: p.id,
    };
  });
}

export function getExportWarnings(c: SavCase): string[] {
  const warnings: string[] = [];
  const photos = collectCasePhotos(c);
  if (photos.length === 0) {
    warnings.push("Aucune photo n'est associée à ce dossier.");
  }
  const hasClaims = c.claims && c.claims.length > 0;
  if (!hasClaims) {
    warnings.push("Aucun sinistre (claim) n'est associé à ce dossier.");
  } else {
    c.claims?.forEach(cl => {
      if (!cl.estimate) {
        warnings.push(`Aucun devis n'est importé pour le sinistre: ${cl.label}`);
      }
    });
  }
  return warnings;
}

export function calculateExportBundleSize(files: ExportBundleFile[]): number {
  return files.reduce((sum, f) => sum + f.size, 0);
}

export function buildCompleteCaseBundle(c: SavCase, actor: string): ExportBundle {
  const files: ExportBundleFile[] = [];

  // 1. JSON complete export
  const jsonContent = buildCaseJsonExport(c);
  files.push({
    id: `file-json-${c.id}`,
    fileName: `dossier.json`,
    fileType: 'json',
    mimeType: 'application/json',
    content: jsonContent,
    size: jsonContent.length,
    source: 'system_export_json',
  });

  // 2. TXT complete summary
  const textContent = buildCaseTextSummary(c);
  files.push({
    id: `file-txt-${c.id}`,
    fileName: `synthese-dossier.txt`,
    fileType: 'text',
    mimeType: 'text/plain',
    content: textContent,
    size: textContent.length,
    source: 'system_export_txt',
  });

  // 3. Fiche reception HTML
  const receptionHtml = buildReceptionSheet(c);
  files.push({
    id: `file-html-reception-${c.id}`,
    fileName: `fiche-reception.html`,
    fileType: 'html',
    mimeType: 'text/html',
    content: receptionHtml,
    size: receptionHtml.length,
    source: 'system_export_html_reception',
  });

  // 4. Fiche atelier HTML
  const workshopHtml = buildWorkshopSheet(c);
  files.push({
    id: `file-html-workshop-${c.id}`,
    fileName: `fiche-atelier.html`,
    fileType: 'html',
    mimeType: 'text/html',
    content: workshopHtml,
    size: workshopHtml.length,
    source: 'system_export_html_workshop',
  });

  // 5. QC HTML if status is available
  if (c.qcStatus) {
    const qcHtml = buildQualityCheckSheet(c);
    files.push({
      id: `file-html-qc-${c.id}`,
      fileName: `controle-qualite.html`,
      fileType: 'html',
      mimeType: 'text/html',
      content: qcHtml,
      size: qcHtml.length,
      source: 'system_export_html_qc',
    });
  }

  // 6. PV Restitution HTML
  const deliveryHtml = buildDeliveryReceipt(c);
  files.push({
    id: `file-html-delivery-${c.id}`,
    fileName: `pv-restitution.html`,
    fileType: 'html',
    mimeType: 'text/html',
    content: deliveryHtml,
    size: deliveryHtml.length,
    source: 'system_export_html_delivery',
  });

  // 7. Complete Print html
  const completeHtml = buildCompleteCasePrint(c);
  files.push({
    id: `file-html-complete-${c.id}`,
    fileName: `synthese-dossier.html`,
    fileType: 'html',
    mimeType: 'text/html',
    content: completeHtml,
    size: completeHtml.length,
    source: 'system_export_html_complete',
  });

  // 8. Add photos if available
  const photoFiles = collectCasePhotoExports(c);
  files.push(...photoFiles);

  // 9. Generate and prepend/append Manifest file
  const manifestContent = buildCaseExportManifest(c, files);
  const manifestFile: ExportBundleFile = {
    id: `file-manifest-${c.id}`,
    fileName: `manifest.json`,
    fileType: 'manifest',
    mimeType: 'application/json',
    content: manifestContent,
    size: manifestContent.length,
    source: 'system_export_manifest',
  };
  files.unshift(manifestFile);

  const warnings = getExportWarnings(c);

  return {
    id: `bun-${Math.random().toString(36).substr(2, 9)}`,
    caseId: c.id,
    generatedAt: new Date().toISOString(),
    generatedBy: actor,
    files,
    manifest: manifestContent,
    warnings,
  };
}

// Ported pure TypeScript ZIP builder
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[n] = c >>> 0;
}

function crc32(data: Uint8Array): number {
  let crc = -1;
  for (let index = 0; index < data.length; index += 1) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ data[index]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

export function base64ToUint8Array(base64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(base64, 'base64'));
  }
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

export function createZipBlobFromBundle(bundle: ExportBundle): Blob {
  const files: { path: string; data: Uint8Array }[] = [];
  const encoder = new TextEncoder();

  bundle.files.forEach(f => {
    let dataBytes: Uint8Array;
    if (f.fileType === 'photo' && f.content) {
      try {
        dataBytes = base64ToUint8Array(f.content);
      } catch {
        dataBytes = encoder.encode(f.content);
      }
    } else {
      dataBytes = encoder.encode(f.content || '');
    }
    files.push({
      path: f.fileName,
      data: dataBytes,
    });
  });

  return compileZipBlob(files);
}

function compileZipBlob(files: { path: string; data: Uint8Array }[]): Blob {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  files.forEach((file) => {
    const nameBytes = encoder.encode(file.path.replace(/^\/+/, ""));
    const data = file.data;
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

  return new Blob([...chunks, ...central, end] as BlobPart[], { type: "application/zip" });
}

export function downloadExportBundle(bundle: ExportBundle): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }
  try {
    const zipBlob = createZipBlobFromBundle(bundle);
    const url = URL.createObjectURL(zipBlob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${buildSafeExportFileName({
      id: bundle.caseId,
      immatriculation: '',
      vin: '',
      clientName: bundle.generatedBy, // fallbacks
      telephone: '',
      status: 'draft',
      receptionDate: '',
      createdAt: '',
      updatedAt: '',
    })}.zip`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (err) {
    console.error("Impossible de télécharger le ZIP", err);
  }
}
