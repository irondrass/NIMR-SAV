import { Estimate, EstimateLine, WorkshopPole, WorkshopTask } from './sav-case';

export function classifyLaborLine(label: string): WorkshopPole {
  const norm = label
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  // 1. Preparation
  if (/\b(poncage|preparation|mastic|masquage|prep|prepa|ponc|masticage|poncer|sablage)\b/.test(norm)) {
    return 'preparation';
  }
  // 2. Peinture
  if (/\b(peinture|vernis|appret|teinte|raccord|peint|nacre|opaque|verniss|vernissage|met|metallise|tri-couche)\b/.test(norm)) {
    return 'peinture';
  }
  // 3. Remontage
  if (norm.includes('d/p') || norm.includes('dp') || /\b(montage|demontage|repose|deposes|repose|accessoires|rem|dep|mont|dem|optique|phare|feu|serrure|vitrage|pare-brise|gache|poignee)\b/.test(norm)) {
    return 'remontage';
  }
  // 4. Tôlerie
  if (/\b(redressage|redress|redr|redressa|marbre|passage sur marbre|chassis|batis|equerrage|ajustage|soudure|solder|tolerie|toliere|aile|capot|porte|pare-chocs|malle|serrurerie)\b/.test(norm)) {
    return 'tolerie';
  }
  // 5. Finition
  if (/\b(lustrage|nettoyage|controle final|retouche|fini|lustr|lavage|clean|lavage exterieur|nettoyage interieur|finition)\b/.test(norm)) {
    return 'finition';
  }
  // 6. Mécanique
  if (/\b(vidange|freinage|suspension|moteur|climatisation|diagnostic mecanique|diagnostic|electrique|electricite|electronique|amortisseur|plaquettes|disques|embrayage|boite|vitesse|huile|filtre|bougies|diag|mecanique|mecan)\b/.test(norm)) {
    return 'mecanique';
  }
  // 7. Contrôle qualité
  if (/\b(essai|controle|validation|inspection|essai routier|qc|qualite|quality)\b/.test(norm)) {
    return 'controle_qualite';
  }

  return 'autre';
}

export function classifyPartLine(label: string): boolean {
  const norm = label.toLowerCase();
  const partsKeywords = [
    'agrafe', 'embleme', 'monogramme', 'huile', 'filtre', 'liquide', 'mousse', 'renfort',
    'support', 'feu', 'optique', 'phare', 'pare-chocs', 'aile', 'capot', 'porte', 'pare-brise'
  ];
  return partsKeywords.some(kw => norm.includes(kw));
}

export function allocateEstimateLineToPole(line: EstimateLine, pole: WorkshopPole): EstimateLine {
  return {
    ...line,
    selectedPole: pole,
  };
}

export function allocateEstimateLinesToPoles(
  lines: EstimateLine[],
  allocations: Record<string, WorkshopPole>
): EstimateLine[] {
  return lines.map((line) => {
    if (allocations[line.id]) {
      return {
        ...line,
        selectedPole: allocations[line.id],
      };
    }
    return line;
  });
}

export function calculateLaborSummaryByPole(lines: EstimateLine[]): Record<WorkshopPole, number> {
  const summary: Record<WorkshopPole, number> = {
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
      summary[line.selectedPole] = Number((summary[line.selectedPole] + line.laborHours).toFixed(2));
    }
  }

  return summary;
}

export function calculateWorkshopLoadFromEstimate(estimate: Estimate): Record<WorkshopPole, number> {
  return calculateLaborSummaryByPole(estimate.lines);
}

export function convertLaborHoursToPlanningMinutes(hours: number): number {
  return Math.round(hours * 60);
}

export function getPoleLabel(pole: WorkshopPole): string {
  const labels: Record<WorkshopPole, string> = {
    tolerie: 'Tôlerie',
    peinture: 'Peinture',
    preparation: 'Préparation',
    remontage: 'Remontage',
    finition: 'Finition',
    mecanique: 'Mécanique',
    controle_qualite: 'Contrôle qualité',
    autre: 'Autre',
  };
  return labels[pole] || String(pole);
}

export function generateWorkshopTasksFromEstimate(estimate: Estimate): WorkshopTask[] {
  const tasks: WorkshopTask[] = [];
  const summary = calculateWorkshopLoadFromEstimate(estimate);
  const now = new Date().toISOString();

  let index = 1;
  for (const poleKey of Object.keys(summary)) {
    const pole = poleKey as WorkshopPole;
    const hours = summary[pole];
    if (hours > 0) {
      tasks.push({
        id: `tsk-est-${pole}-${index++}`,
        label: `Travaux de ${getPoleLabel(pole)} (${hours}h)`,
        status: 'pending',
        estimatedDurationMinutes: convertLaborHoursToPlanningMinutes(hours),
        createdAt: now,
        pole,
      });
    }
  }

  return tasks;
}

export function summarizePoleAllocation(estimate: Estimate): string {
  const summary = calculateWorkshopLoadFromEstimate(estimate);
  return Object.entries(summary)
    .filter(([_, hours]) => hours > 0)
    .map(([pole, hours]) => `${getPoleLabel(pole as WorkshopPole)}: ${hours}h`)
    .join(', ');
}
