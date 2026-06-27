import { Estimate, EstimateLine, EstimateTotals, EstimateSourceType, EstimateLineType, WorkshopPole } from './sav-case';
import { classifyLaborLine } from './labor-allocator';

// Helpers to sanitize and normalize text
export function stripHtmlToText(html: string): string {
  if (!html) return '';
  // Replace block tags and line breaks with newlines to preserve lines
  let text = html.replace(/<\/p>|<\/div>|<\/tr>|<br\s*\/?>/gi, '\n');
  // Strip all other HTML tags
  text = text.replace(/<[^>]*>/g, ' ');
  // Decode HTML entities
  text = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"');
  return text;
}

export function normalizeEstimateText(text: string): string {
  return String(text || '')
    .replace(/\r?\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

export function detectEstimateSourceType(fileName: string, content: string): EstimateSourceType {
  const name = (fileName || '').toLowerCase();
  if (name.endsWith('.html') || name.endsWith('.htm') || content.includes('<!DOCTYPE html') || content.includes('<html') || content.includes('</html>')) {
    return 'html';
  }
  if (name.endsWith('.txt')) {
    return 'txt';
  }
  if (fileName === 'pasted_text' || (!fileName && content.length > 0)) {
    return 'pasted_text';
  }
  return 'unknown';
}

export function normalizeMoneyValue(value: string | number): number {
  if (typeof value === 'number') return value;
  let normalized = String(value || '').replace(/\u00a0/g, ' ').trim();
  if (!normalized) return 0;
  // Remove currency words / symbols
  normalized = normalized.replace(/(TND|DT|TVA|HT|TTC|TIMBRE)/gi, '').trim();
  const comma = normalized.lastIndexOf(',');
  const dot = normalized.lastIndexOf('.');
  normalized = normalized.replace(/\s/g, '');
  if (comma >= 0 && dot >= 0) {
    normalized = comma > dot ? normalized.replace(/\./g, '').replace(',', '.') : normalized.replace(/,/g, '');
  } else if (comma >= 0) {
    normalized = normalized.replace(',', '.');
  }
  const parsed = parseFloat(normalized);
  return isFinite(parsed) ? parsed : 0;
}

export function normalizeLaborHours(value: string | number): number {
  const num = normalizeMoneyValue(value);
  return num > 0 && num <= 100 ? num : 0;
}

function cleanDescription(desc: string): string {
  return desc
    .replace(/\s+/g, ' ')
    .replace(/[:;-]+$/g, '')
    .trim();
}

// Function to classify detected pole
function detectPoleFromLabel(label: string): WorkshopPole {
  return classifyLaborLine(label);
}

// Extract totals from estimate body text
export function extractEstimateTotals(text: string): EstimateTotals {
  const totals: EstimateTotals = {
    amountHT: 0,
    amountTVA: 0,
    amountTTC: 0,
    currency: 'TND',
  };

  const lines = text.split('\n');
  for (const line of lines) {
    const normLine = line.toUpperCase();
    if (normLine.includes('TOTAL HT') || normLine.includes('MONTANT HT')) {
      const match = line.match(/(?:TOTAL HT|MONTANT HT)\s*[:-]?\s*([\d\s,.]+)/i);
      if (match) totals.amountHT = normalizeMoneyValue(match[1]);
    } else if (normLine.includes('TVA') && (normLine.includes('TOTAL') || normLine.includes('MONTANT') || /TVA\s*[:-]?\s*[\d\s,.]+/.test(normLine))) {
      const match = line.match(/(?:TVA)\s*(?:\d+%)?\s*[:-]?\s*([\d\s,.]+)/i);
      if (match) totals.amountTVA = normalizeMoneyValue(match[1]);
    } else if (normLine.includes('TOTAL TTC') || normLine.includes('MONTANT TTC') || normLine.includes('TOTAL GENERAL')) {
      const match = line.match(/(?:TOTAL TTC|MONTANT TTC|TOTAL GENERAL)\s*[:-]?\s*([\d\s,.]+)/i);
      if (match) totals.amountTTC = normalizeMoneyValue(match[1]);
    }
  }

  // Fallback if HT or TTC is 0
  if (totals.amountTTC === 0 && totals.amountHT > 0) {
    totals.amountTTC = totals.amountHT + totals.amountTVA;
  }
  if (totals.amountHT === 0 && totals.amountTTC > 0) {
    totals.amountHT = totals.amountTTC - totals.amountTVA;
  }

  return totals;
}

// Parse a single line to determine if it is a valid estimate line
export function parseEstimateLine(lineText: string): Partial<EstimateLine> | null {
  const text = lineText.trim();
  if (!text || text.length < 5) return null;

  // Skip legal/header/footer garbage
  const norm = text.toUpperCase();
  const skipKeywords = [
    'LU ET APPROUVE', 'SIGNATURE', 'CACHET', 'PAGE ', 'DEVIS GENERAL', 'CONDITIONS DE PAYEMENT',
    'CE DEVIS RESTE', 'ENGAGEMENT DES TRAVAUX', 'ATELIER', 'N° DEVIS', 'DATE DEVIS', 'CLIENT'
  ];
  if (skipKeywords.some(keyword => norm.includes(keyword))) {
    return null;
  }

  // Look for numeric columns at the end of the line: Qté, PU, Montant
  // Example: "REPARATION CAPOT 1.00 33.000 33.000" or "PARE-CHOCS AV 1 450,00 450,00"
  // Let's match 3 numeric segments at the end of the line
  const numbersRegex = /([0-9\s,.]+)\s+([0-9\s,.]+)\s+([0-9\s,.]+)$/;
  const match = text.match(numbersRegex);

  if (!match) return null;

  const rawLabelPart = text.slice(0, match.index).trim();
  if (!rawLabelPart) return null;

  // Split label into potential code and clean label
  let code = '';
  let label = rawLabelPart;
  const codeMatch = rawLabelPart.match(/^([A-Z0-9/-]+)\s+(.+)$/i);
  if (codeMatch && codeMatch[1].length >= 3 && /\d/.test(codeMatch[1])) {
    code = codeMatch[1];
    label = codeMatch[2];
  }

  label = cleanDescription(label);
  if (!label || label.length < 2) return null;

  const quantity = normalizeMoneyValue(match[1]);
  const unitPrice = normalizeMoneyValue(match[2]);
  const totalPrice = normalizeMoneyValue(match[3]);

  if (quantity <= 0 || unitPrice <= 0 || totalPrice <= 0) return null;

  // Check line type
  let lineType: EstimateLineType = 'unknown';
  let isLabor = false;
  let isPart = false;
  let isPaintMaterial = false;
  let isNewPart = false;
  let laborHours = 0;

  const laborRates = [33, 35];
  const isLaborRate = laborRates.some(rate => Math.abs(unitPrice - rate) < 0.01);
  const normLabel = label.toUpperCase();

  const laborKeywords = [
    'MAIN D\'OEUVRE', 'MAIN D OUVRE', 'MO ', 'M.O', 'POSE', 'DEPOSE', 'REMONTAGE', 'DEMONTAGE',
    'REDRESSAGE', 'PEINTURE', 'LAVAGE', 'LUSTRAGE', 'ESSAI', 'CONTROLE', 'DIAGNOSTIC', 'MECANIQUE',
    'D/P', 'CHANGEMENT', 'REMPLACEMENT', 'REPAIR', 'REPARATION', 'PREPARATION'
  ];

  const paintMaterialsKeywords = [
    'PRODUIT PEINTURE', 'PRODUITS PEINTURE', 'FOURNITURE PEINTURE', 'MATIERE PEINTURE', 'CONSOMMABLE PEINTURE'
  ];

  if (isLaborRate || laborKeywords.some(kw => normLabel.includes(kw))) {
    lineType = 'labor';
    isLabor = true;
    laborHours = quantity; // Quantity represents hours on labor lines
  } else if (paintMaterialsKeywords.some(kw => normLabel.includes(kw))) {
    lineType = 'paint_material';
    isPaintMaterial = true;
  } else {
    lineType = 'part';
    isPart = true;
    // Check if new part
    if (normLabel.includes('NEUF') || normLabel.includes('NEUVE') || normLabel.includes('REMPLACEMENT') || normLabel.includes('CHANGEMENT') || code) {
      isNewPart = true;
    }
  }

  const detectedPole = detectPoleFromLabel(label);

  // Confidence score for this line
  let confidence = 0.8;
  if (isLaborRate && isLabor) confidence = 0.98;
  if (isPart && code) confidence = 0.95;

  return {
    lineType,
    code,
    label,
    quantity,
    unitPrice,
    totalPrice,
    laborHours,
    detectedPole,
    selectedPole: detectedPole,
    isPart,
    isLabor,
    isPaintMaterial,
    isNewPart,
    confidence,
    rawLine: text,
  };
}

export function extractEstimateLines(text: string): EstimateLine[] {
  const rawLines = text.split('\n');
  const lines: EstimateLine[] = [];
  let index = 1;

  for (const rawLine of rawLines) {
    const parsed = parseEstimateLine(rawLine);
    if (parsed) {
      lines.push({
        id: `est-line-${index++}`,
        lineType: parsed.lineType || 'unknown',
        code: parsed.code || '',
        label: parsed.label || '',
        quantity: parsed.quantity || 0,
        unitPrice: parsed.unitPrice || 0,
        totalPrice: parsed.totalPrice || 0,
        laborHours: parsed.laborHours || 0,
        detectedPole: parsed.detectedPole || 'autre',
        selectedPole: parsed.selectedPole || 'autre',
        isPart: !!parsed.isPart,
        isLabor: !!parsed.isLabor,
        isPaintMaterial: !!parsed.isPaintMaterial,
        isNewPart: !!parsed.isNewPart,
        confidence: parsed.confidence || 0.5,
        rawLine: parsed.rawLine || rawLine,
      });
    }
  }

  return lines;
}

// Generate warnings based on parsed estimate details
export function getEstimateParsingWarnings(estimate: Estimate): string[] {
  const warnings: string[] = [];
  if (estimate.lines.length === 0) {
    warnings.push('Aucune ligne de devis valide détectée.');
  }
  const laborLines = estimate.lines.filter(l => l.isLabor);
  if (laborLines.length === 0) {
    warnings.push('Aucune ligne de main-d\'œuvre détectée.');
  }
  if (estimate.totals.amountTTC === 0) {
    warnings.push('Montant TTC non détecté ou nul.');
  }
  if (estimate.totals.amountHT === 0) {
    warnings.push('Montant HT non détecté ou nul.');
  }
  return warnings;
}

export function parseEstimateText(text: string, fileName?: string, importedBy?: string): Estimate {
  const normText = normalizeEstimateText(text);
  const detectedType = detectEstimateSourceType(fileName || '', normText);
  const totals = extractEstimateTotals(normText);
  const lines = extractEstimateLines(normText);

  // Compute labor summary (hours per pole)
  const laborSummary: Record<WorkshopPole, number> = {
    tolerie: 0,
    peinture: 0,
    preparation: 0,
    remontage: 0,
    finition: 0,
    mecanique: 0,
    controle_qualite: 0,
    autre: 0,
  };

  for (const line of lines) {
    if (line.isLabor) {
      laborSummary[line.selectedPole] = Number((laborSummary[line.selectedPole] + line.laborHours).toFixed(2));
    }
  }

  // Compute parts summary
  const partsSummary = {
    totalPartsCount: 0,
    totalPartsAmountHT: 0,
    newPartsCount: 0,
  };

  for (const line of lines) {
    if (line.isPart) {
      partsSummary.totalPartsCount += line.quantity;
      partsSummary.totalPartsAmountHT += line.totalPrice;
      if (line.isNewPart) {
        partsSummary.newPartsCount += line.quantity;
      }
    }
  }
  partsSummary.totalPartsAmountHT = Number(partsSummary.totalPartsAmountHT.toFixed(2));

  // Compute confidence score
  let confidenceScore = 0.5;
  if (lines.length > 0) {
    const totalConfidence = lines.reduce((sum, l) => sum + l.confidence, 0);
    confidenceScore = Number((totalConfidence / lines.length).toFixed(2));
  }

  const estimate: Estimate = {
    id: `est-${Math.random().toString(36).substr(2, 9)}`,
    sourceFileName: fileName || 'devis.txt',
    sourceType: detectedType,
    importedAt: new Date().toISOString(),
    importedBy: importedBy || 'Système',
    rawTextPreview: text.substring(0, 1000),
    totals,
    lines,
    laborSummary,
    partsSummary,
    warnings: [],
    confidenceScore,
  };

  estimate.warnings = getEstimateParsingWarnings(estimate);
  return estimate;
}

export function parseEstimateHtml(html: string, fileName?: string, importedBy?: string): Estimate {
  const text = stripHtmlToText(html);
  return parseEstimateText(text, fileName || 'devis.html', importedBy);
}

export function summarizeParsedEstimate(estimate: Estimate): string {
  const partsInfo = `${estimate.partsSummary.totalPartsCount} pièces (${estimate.partsSummary.totalPartsAmountHT.toFixed(2)} HT)`;
  const laborHours = Object.values(estimate.laborSummary).reduce((sum, h) => sum + h, 0);
  const laborInfo = `${laborHours.toFixed(2)} heures MO réparties sur les pôles`;
  const totalTTC = `${estimate.totals.amountTTC.toFixed(2)} ${estimate.totals.currency}`;
  return `Devis: ${estimate.sourceFileName} | Total TTC: ${totalTTC} | Pièces: ${partsInfo} | MO: ${laborInfo}`;
}
