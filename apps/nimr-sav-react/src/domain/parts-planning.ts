export interface PartsPreparationPlan {
  caseId: string;
  partsNeeded: boolean;
  leadTimeMinutes: number;
  suggestedStartDate: Date;
  requiredParts: string[];
}

export function detectNewPartsPreparationNeed(typeIntervention: string, description: string): boolean {
  const descLower = description.toLowerCase();
  const keywords = [
    'neuf',
    'neuve',
    'remplacement',
    'changer',
    'commander',
    'pièce',
    'piece',
    'aile',
    'capot',
    'pare-choc',
    'optique',
    'phare',
  ];

  const hasKeyword = keywords.some((kw) => descLower.includes(kw));
  const isHeavyIntervention = typeIntervention === 'tole' || typeIntervention === 'peinture';

  return isHeavyIntervention || hasKeyword;
}

export function suggestParallelNewPartsPreparation(
  caseId: string,
  typeIntervention: string,
  description: string,
  scheduledStartDate: Date,
): PartsPreparationPlan {
  const partsNeeded = detectNewPartsPreparationNeed(typeIntervention, description);

  // Default lead times: 2 days for painting / panel beating, 1 day for mechanics/others
  let leadTimeDays = 1;
  const requiredParts: string[] = [];

  const descLower = description.toLowerCase();
  if (descLower.includes('aile')) requiredParts.push('Aile neuve');
  if (descLower.includes('capot')) requiredParts.push('Capot neuf');
  if (descLower.includes('pare-choc')) requiredParts.push('Pare-choc neuf');
  if (requiredParts.length === 0) {
    requiredParts.push('Pièces de rechange standard');
  }

  if (typeIntervention === 'peinture' || typeIntervention === 'tole') {
    leadTimeDays = 2;
  }

  const leadTimeMinutes = leadTimeDays * 480; // 8 hours per day

  // Suggested start date is scheduledStartDate minus leadTimeDays
  const suggestedStartDate = new Date(scheduledStartDate);
  suggestedStartDate.setDate(suggestedStartDate.getDate() - leadTimeDays);

  return {
    caseId,
    partsNeeded,
    leadTimeMinutes,
    suggestedStartDate,
    requiredParts,
  };
}

export function summarizePartsPreparationPlan(plan: PartsPreparationPlan): string {
  if (!plan.partsNeeded) {
    return `Aucune préparation anticipée de pièces neuves requise pour le dossier ${plan.caseId}.`;
  }

  const dateStr = plan.suggestedStartDate.toLocaleDateString('fr-FR');
  return `Préparation anticipée requise pour le dossier ${plan.caseId} : commande et peinture des pièces (${plan.requiredParts.join(', ')}) suggérée dès le ${dateStr} (lead time : ${plan.leadTimeMinutes} min).`;
}
