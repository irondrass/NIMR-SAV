/* NIMR v21.87 - règles métier carrosserie client, import MO paramétrable et optimisation peinture */
(function () {
  const APP_RULE_VERSION = '21.96';

  // Hotfix v21.95: garde de compatibilité pour les anciens bundles/cache
  // qui appelaient encore buildOriginalEstimateLinesV2187() par son nom local.
  // En l'exposant aussi comme variable globale réutilisable, on évite le crash
  // lors suppression puis réimport du même dossier avec un service worker/cache ancien.
  if (typeof window.buildOriginalEstimateLinesV2187 !== 'function' && typeof window.buildOriginalEstimateLines === 'function') {
    window.buildOriginalEstimateLinesV2187 = window.buildOriginalEstimateLines;
  }
  const originalClassifyLaborLine = typeof classifyLaborLine === 'function' ? classifyLaborLine : null;
  const originalBuildOriginalEstimateLines = typeof buildOriginalEstimateLines === 'function' ? buildOriginalEstimateLines : null;
  const originalBuildAppliedEstimateLines = typeof buildAppliedEstimateLines === 'function' ? buildAppliedEstimateLines : null;

  const PAINTABLE_PHASES = ['prep', 'paint'];
  const PARAM_PHASES = ['body', 'oilService', 'mechanical', 'electrical', 'prep', 'paint', 'reassembly', 'finish'];
  const FIXED_QUALITY_HOURS = 0;

  function normalizeEstimateLineIdentity(operation) {
    return normalizeEstimateOperationText(operation || '')
      .replace(/^MO[-/][A-Z0-9]+\s+/, '')
      .replace(/\b(DR|DROIT|DROITE|GH|GAUCHE)\b/g, '')
      .replace(/\bCOMPLET\b/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function estimateLineHasSide(operation) {
    return /\b(DR|DROIT|DROITE|GH|GAUCHE)\b/.test(normalizeEstimateOperationText(operation || ''));
  }

  function dedupeLaborInputs(lines) {
    const kept = [];
    (lines || []).forEach((line) => {
      const operation = line?.operation || line?.text || '';
      const hours = roundPlanningHours(line?.hours ?? line?.laborHours ?? 0);
      const identity = normalizeEstimateLineIdentity(operation);
      const sameIndex = kept.findIndex((candidate) => {
        const cOperation = candidate?.operation || candidate?.text || '';
        const cHours = roundPlanningHours(candidate?.hours ?? candidate?.laborHours ?? 0);
        return identity && normalizeEstimateLineIdentity(cOperation) === identity && Math.abs(cHours - hours) <= 0.01;
      });
      if (sameIndex === -1) {
        kept.push(line);
        return;
      }
      const oldHasSide = estimateLineHasSide(kept[sameIndex]?.operation || kept[sameIndex]?.text || '');
      const newHasSide = estimateLineHasSide(operation);
      // Cas réel constaté : une ligne générique puis la même ligne avec DR/GH.
      // On garde la ligne la plus précise, mais on ne fusionne jamais deux lignes toutes deux latéralisées.
      if (!oldHasSide && newHasSide) kept[sameIndex] = line;
      if (oldHasSide && newHasSide) kept.push(line);
    });
    return kept;
  }

  function enforceDealerDurationRules(totals) {
    if (!totals) return totals;
    const paint = Number(totals.paint || 0);
    totals.finish = paint > 0 ? roundPlanningHours(paint * 0.5) : 0;
    totals.quality = 0;
    totals.finalCheck = 0.25;
    return totals;
  }

  function phaseLabel(key) {
    return (typeof getDurationLabel === 'function' && getDurationLabel(key)) || (DURATIONS || []).find(([value]) => value === key)?.[1] || key;
  }

  function lineCode(text) {
    const source = String(text || '').trim();
    const direct = source.match(/^([A-Z]{2,4}(?:[-/][A-Z0-9]+)+)/i);
    if (direct) return direct[1].toUpperCase();
    const embedded = source.match(/\b(MO-(?:TOL|MEC|\d+))\b/i);
    return embedded ? embedded[1].toUpperCase() : '';
  }

  function extractLaborTableSegment(text) {
    const source = String(text || '').replace(/\s+/g, ' ').trim();
    const match = source.match(/\b(MO-(?:TOL|MEC|\d+))\b[\s\S]*$/i);
    return match ? source.slice(match.index).trim() : source;
  }

  function stripLineCode(text) {
    return String(text || '').replace(/^[A-Z]{2,4}(?:[-/][A-Z0-9]+)+\s+/i, '').trim();
  }

  function isPaintSupplyCode(code, normalized) {
    return code === 'MO-002067' || /\bPRODUITS?\s+(?:DE\s+)?PEINTURE\b/.test(normalized || '') || /\bPEINTURE\s+PRODUITS?\b/.test(normalized || '');
  }


  function isAllowedLaborCode(code) {
    const value = String(code || '').trim().toUpperCase();
    if (!value) return true;
    return value === 'MO-TOL' || value === 'MO-MEC';
  }

  function hasLaborPlanningKeyword(operation) {
    const n = normalizeEstimateOperationText(operation || '');
    return /\b(D\s*\/\s*P|CHANG(?:EMENT)?|DEPOSE|POSE|REPOSE|DEMONTAGE|REMONTAGE|PREPARAT(?:ION|IN)|PEINTURE\s+ET\s+F(?:I)?NITION|DRESSAGE|MARBRE|REMPLACEMENT|REMPL|REMP|REPARATION|CONTROLE|DIAGNOSTIC|VIDANGE|ENTRETIEN|ELECTRIQUE|ELECTRICITE|MECANIQUE|MECAN)\b/.test(n);
  }

  function shouldKeepOriginalLaborLine(line) {
    if (line?.manual) return roundPlanningHours(Number(line?.laborHours ?? line?.hours ?? 0)) > 0;
    const operation = line?.operation || line?.rawText || line?.text || '';
    const normalized = normalizeEstimateOperationText(operation);
    const code = String(line?.code || lineCode(line?.rawText || line?.text || operation) || '').trim().toUpperCase();
    const hours = roundPlanningHours(Number(line?.laborHours ?? line?.hours ?? 0));
    if (hours <= 0) return false;
    if (isPaintSupplyCode(code, normalized)) return false;
    if (code && !isAllowedLaborCode(code) && !hasLaborPlanningKeyword(operation)) return false;
    if (/\b(PRODUITS?|FOURNITURES?|MATIERES?|MATERIEL|CONSOMMABLES?)\s+(?:DE\s+)?PEINTURE\b/.test(normalized)) return false;
    return hasLaborPlanningKeyword(operation) || isAllowedLaborCode(code);
  }

  function cleanOriginalLaborLines(lines) {
    return dedupeLaborInputs((lines || []).filter(shouldKeepOriginalLaborLine)).map(normalizeOriginalLineForPlanning);
  }

  function getOriginalLaborTotal(lines) {
    return roundPlanningHours((lines || []).reduce((sum, line) => sum + Number(line?.laborHours || 0), 0));
  }

  function cleanClaimEstimateForPlanning(claim) {
    if (!claim?.estimate) return claim;
    const before = claim.estimate.originalLines || [];
    if (before.length) {
      claim.estimate.originalLines = cleanOriginalLaborLines(before);
    } else if (claim.estimate.lines?.length) {
      claim.estimate.originalLines = cleanOriginalLaborLines(claim.estimate.lines.map((line) => ({
        id: line.id || uid('estimate-original-line'),
        code: line.code || '',
        operation: line.operation || 'Opération devis',
        rawText: line.rawText || line.operation || '',
        laborHours: Number(line.laborHours || 0),
        allocations: [{ phase: line.phase, operation: line.operation || '', laborHours: Number(line.laborHours || 0) }],
      })));
    }
    if (claim.estimate.originalLines.length) {
      const optimized = optimizeEstimateAllocationsFromOriginalLines(claim.estimate.originalLines);
      const lines = optimized.lines.slice();
      if (Number(optimized.totals.finish || 0) > 0) {
        lines.push({ id: uid('estimate-line'), phase: 'finish', operation: 'Finition + lavage - 50% du temps peinture', laborHours: roundPlanningHours(optimized.totals.finish) });
      }
      lines.push({ id: uid('estimate-line'), phase: 'finalCheck', operation: 'Contrôle final forfaitaire', laborHours: 0.25 });
      claim.estimate.lines = lines;
      claim.estimate.paintOptimization = optimized.paintOptimization;
      claim.estimate.totalOriginalHours = getOriginalLaborTotal(claim.estimate.originalLines);
    }
    return claim;
  }

  window.cleanClaimEstimateForPlanning = cleanClaimEstimateForPlanning;
  window.cleanOriginalLaborLines = cleanOriginalLaborLines;

  function inferPaintGroup(operation) {
    const n = normalizeEstimateOperationText(operation || '');
    const hasDR = /\b(DR|DROIT|DROITE)\b/.test(n);
    const hasGH = /\b(GH|GAUCHE)\b/.test(n);
    if (hasDR) return 'right';
    if (hasGH) return 'left';
    if (/\b(PARE\s*CHOCS?\s*AV|PARECHOCS?\s*AV|CALANDRE|PHARE|OPTIQUE\s+DE\s+PHARE)\b/.test(n)) return 'front';
    if (/\b(PARE\s*CHOCS?\s*AR|PARECHOCS?\s*AR|MALLE|JUPE|FEU\s+AR)\b/.test(n)) return 'rear';
    if (/\b(CAPOT|PAVILLON|TOIT)\b/.test(n)) return 'center';
    return 'general';
  }

  function inferPieceKind(operation) {
    const n = normalizeEstimateOperationText(operation || '');
    if (/\b(DRESSAGE|REPARATION|REDRESSAGE)\b/.test(n)) return 'repair';
    if (/\b(CHANG|REMPLACEMENT|REMP|REMPL)\b/.test(n)) return 'new';
    return 'new';
  }

  function mayNeedTwoSides(operation) {
    const n = normalizeEstimateOperationText(operation || '');
    return /\b(PORTE|CAPOT|MALLE)\b/.test(n);
  }

  function inferPaintFaces(operation, pieceKind) {
    // Règle atelier : les portes/capot/malle peuvent être peintes 2 côtés seulement si pièce neuve/remplacement.
    // En dressage/réparation, on reste en extérieur seulement.
    if (pieceKind === 'new' && mayNeedTwoSides(operation)) return 'two_sides';
    return 'outside';
  }

  function makeWeightedAllocations(operation, hours, selectedPhases) {
    const phases = [...new Set((selectedPhases || []).filter((phase) => PARAM_PHASES.includes(phase)))];
    if (!phases.length) return [];
    const weights = phases.map((phase) => (phase === 'prep' ? 2 : phase === 'paint' ? 1 : 1));
    const totalWeight = weights.reduce((sum, value) => sum + value, 0) || 1;
    let consumed = 0;
    return phases.map((phase, index) => {
      let value;
      if (index === phases.length - 1) {
        value = Math.max(0, Number(hours || 0) - consumed);
      } else {
        value = Number(hours || 0) * (weights[index] / totalWeight);
        consumed += roundPlanningHours(value);
      }
      return makeDistribution(phase, operation, value);
    }).filter((allocation) => Number(allocation.laborHours || 0) > 0);
  }

  function getSelectedPhasesFromLine(line) {
    const source = Array.isArray(line?.allocations) && line.allocations.length
      ? line.allocations.map((allocation) => allocation.phase)
      : (line?.phase ? [line.phase] : []);
    return [...new Set(source.filter(Boolean))];
  }

  function normalizeOriginalLineForPlanning(line) {
    const operation = line?.operation || line?.rawText || 'Opération devis';
    const pieceKind = line?.pieceKind || inferPieceKind(operation);
    const paintFaces = line?.paintFaces || inferPaintFaces(operation, pieceKind);
    const paintGroup = line?.paintGroup || inferPaintGroup(operation);
    const selectedPhases = line?.selectedPhases || getSelectedPhasesFromLine(line);
    const laborHours = roundPlanningHours(Number(line?.laborHours || 0));
    // Toujours recalculer la répartition à partir des étapes cochées.
    // Cela évite l'ancien 50/50 préparation/peinture qui restait affiché après import
    // jusqu'au décocher/recocher manuel. La règle atelier est 2/3 préparation, 1/3 peinture.
    const allocations = makeWeightedAllocations(operation, laborHours, selectedPhases);
    return {
      ...line,
      operation,
      laborHours,
      allocations,
      selectedPhases: getSelectedPhasesFromLine({ allocations }),
      pieceKind,
      paintFaces,
      paintGroup,
      paintOptimizationEligible: true,
    };
  }

  window.classifyLaborLine = function classifyLaborLineV2187(line, options = {}) {
    const rawText = String(line || '').replace(/\s+/g, ' ').trim();
    const text = extractLaborTableSegment(rawText);
    if (!text || text.length < 3) return null;
    const normalized = normalizeEstimateOperationText(text);
    if (typeof isEstimateLegalOrFooterLine === 'function' && isEstimateLegalOrFooterLine(normalized)) return { type: 'ignored', reason: 'Note client ou pied de page ignoré' };
    const code = lineCode(text);
    if (/^ART/.test(code)) return null;
    if (isPaintSupplyCode(code, normalized)) return { type: 'ignored', reason: 'Produit de peinture ignoré comme fourniture' };

    if (/^MO-/.test(code)) {
      const pricingInfo = extractEstimatePricingInfo(text);
      const hoursInfo = pricingInfo.hoursInfo || extractLaborHours(text);
      if (!hoursInfo || !Number(hoursInfo.hours)) return { type: 'ignored', reason: 'Quantité MO introuvable' };
      const operation = sanitizeEstimateOperation(stripLineCode(text.slice(0, hoursInfo.index) || text));
      let distributions = distributeLaborHours(operation, hoursInfo.hours, options);
      if (!distributions.length) distributions = [makeDistribution('body', operation, hoursInfo.hours)];
      const pieceKind = inferPieceKind(operation);
      return {
        type: 'labor',
        code,
        text: rawText,
        operation,
        hours: roundPlanningHours(hoursInfo.hours),
        distributions,
        pieceKind,
        paintFaces: inferPaintFaces(operation, pieceKind),
        paintGroup: inferPaintGroup(operation),
      };
    }

    const fallback = originalClassifyLaborLine ? originalClassifyLaborLine(line, options) : null;
    if (fallback?.type === 'labor') {
      const operation = fallback.operation || stripLineCode(text);
      const pieceKind = fallback.pieceKind || inferPieceKind(operation);
      return {
        ...fallback,
        text: rawText,
        code: code || fallback.code || '',
        pieceKind,
        paintFaces: fallback.paintFaces || inferPaintFaces(operation, pieceKind),
        paintGroup: fallback.paintGroup || inferPaintGroup(operation),
      };
    }
    return fallback;
  };

  function buildOriginalEstimateLinesV2187(preview) {
    return cleanOriginalLaborLines((preview.laborLines || []).map((line) => ({
      id: uid('estimate-original-line'),
      code: line.code || lineCode(line.text || line.operation || ''),
      operation: line.operation || line.text || 'Opération devis',
      laborHours: roundPlanningHours(line.hours || 0),
      rawText: line.text || line.operation || '',
      allocations: (line.distributions || []).map((distribution) => ({
        phase: distribution.phase,
        operation: distribution.operation || line.operation || '',
        laborHours: roundPlanningHours(distribution.laborHours || 0),
      })),
      pieceKind: line.pieceKind || inferPieceKind(line.operation || line.text || ''),
      paintFaces: line.paintFaces || inferPaintFaces(line.operation || line.text || '', line.pieceKind || inferPieceKind(line.operation || line.text || '')),
      paintGroup: line.paintGroup || inferPaintGroup(line.operation || line.text || ''),
    })));
  }

  window.buildOriginalEstimateLinesV2187 = buildOriginalEstimateLinesV2187;
  window.buildOriginalEstimateLines = buildOriginalEstimateLinesV2187;

  function groupLabel(group) {
    return {
      right: 'Côté droit',
      left: 'Côté gauche',
      front: 'Avant',
      rear: 'Arrière',
      center: 'Capot / centre',
      general: 'Général',
    }[group] || group || 'Général';
  }

  function paintFactor(line) {
    if (line?.paintFaces !== 'two_sides') return 1;
    const n = normalizeEstimateOperationText(line.operation || line.rawText || '');
    if (/\bPORTE\b/.test(n)) return 1.6;
    if (/\b(CAPOT|MALLE)\b/.test(n)) return 1.5;
    return 1.5;
  }

  function optimizeEstimateAllocationsFromOriginalLines(originalLines) {
    const totals = Object.fromEntries(ESTIMATE_PLANNING_KEYS.map((key) => [key, 0]));
    const appliedLines = [];
    const paintGroups = new Map();

    (originalLines || []).map(normalizeOriginalLineForPlanning).forEach((line) => {
      (line.allocations || []).forEach((allocation) => {
        if (!allocation.phase || !(allocation.phase in totals)) return;
        const laborHours = roundPlanningHours(Number(allocation.laborHours || 0));
        if (laborHours <= 0) return;
        if (allocation.phase === 'paint') {
          const group = line.paintGroup || inferPaintGroup(line.operation || line.rawText || '');
          if (!paintGroups.has(group)) paintGroups.set(group, []);
          paintGroups.get(group).push({
            line,
            operation: line.operation || allocation.operation || 'Peinture',
            hours: roundPlanningHours(laborHours * paintFactor(line)),
            rawHours: laborHours,
          });
          return;
        }
        totals[allocation.phase] = roundPlanningHours(totals[allocation.phase] + laborHours);
        appliedLines.push({
          id: uid('estimate-line'),
          phase: allocation.phase,
          operation: allocation.operation || line.operation || phaseLabel(allocation.phase),
          laborHours,
        });
      });
    });

    const groupResults = [];
    paintGroups.forEach((items, group) => {
      const sorted = items.slice().sort((a, b) => b.hours - a.hours);
      const max = sorted[0]?.hours || 0;
      const others = sorted.slice(1).reduce((sum, item) => sum + Number(item.hours || 0), 0);
      const total = roundPlanningHours(max + others * 0.25);
      groupResults.push({ group, label: groupLabel(group), total, items });
    });
    groupResults.sort((a, b) => b.total - a.total);
    const paintTotal = groupResults.length
      ? roundPlanningHours((groupResults[0]?.total || 0) + groupResults.slice(1).reduce((sum, group) => sum + Number(group.total || 0), 0) * 0.4)
      : 0;
    totals.paint = paintTotal;
    if (paintTotal > 0) {
      appliedLines.push({
        id: uid('estimate-line'),
        phase: 'paint',
        operation: 'Peinture mutualisée par zone/côté cabine',
        laborHours: paintTotal,
        paintOptimized: true,
        paintOptimization: groupResults,
      });
    }

    return {
      totals: enforceDealerDurationRules(Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, roundPlanningHours(value || 0)]))),
      lines: appliedLines,
      paintOptimization: groupResults,
    };
  }

  window.optimizeEstimateAllocationsFromOriginalLines = optimizeEstimateAllocationsFromOriginalLines;

  window.buildAppliedEstimateLines = function buildAppliedEstimateLinesV2187(preview) {
    const originalLines = preview.originalLines || window.buildOriginalEstimateLines(preview);
    const optimized = optimizeEstimateAllocationsFromOriginalLines(originalLines);
    if (optimized.lines.length) {
      const lines = optimized.lines.slice();
      if (Number(optimized.totals.finish || 0) > 0) {
        lines.push({ id: uid('estimate-line'), phase: 'finish', operation: 'Finition + lavage - 50% du temps peinture', laborHours: roundPlanningHours(optimized.totals.finish) });
      }
      lines.push({ id: uid('estimate-line'), phase: 'finalCheck', operation: 'Contrôle final forfaitaire', laborHours: 0.25 });
      return lines;
    }
    const fallback = originalBuildAppliedEstimateLines ? originalBuildAppliedEstimateLines(preview) : (preview.distributedLines || []);
    return fallback.map((line) => ({ ...line, laborHours: roundPlanningHours(line.laborHours || 0) }));
  };

  function syncClaimEstimateLinesFromOriginal(claim) {
    cleanClaimEstimateForPlanning(claim);
  }

  window.syncClaimEstimateLinesFromOriginal = syncClaimEstimateLinesFromOriginal;

  const originalRecompute = typeof recomputeCaseDurationsFromClaims === 'function' ? recomputeCaseDurationsFromClaims : null;
  window.recomputeCaseDurationsFromClaims = function recomputeCaseDurationsFromClaimsV2187(item) {
    (item?.claims || []).forEach((claim) => {
      if (claim.estimate?.originalLines?.length) syncClaimEstimateLinesFromOriginal(claim);
    });
    const result = originalRecompute ? originalRecompute(item) : false;
    if (item?.durations) {
      item.durations.finish = Number(item.durations.paint || 0) > 0 ? roundPlanningHours(Number(item.durations.paint || 0) * 0.5) : 0;
      item.durations.quality = 0;
      item.durations.finalCheck = 0.25;
    }
    return result;
  };

  window.recalculateImportedLaborForCase = function recalculateImportedLaborForCase(item) {
    if (!item) return;
    (item.claims || []).forEach(syncClaimEstimateLinesFromOriginal);
    if (typeof recomputeCaseDurationsFromClaims === 'function') recomputeCaseDurationsFromClaims(item);
    if (typeof clearPlanningIfNeeded === 'function') clearPlanningIfNeeded(item, 'Planning annulé après modification du paramétrage main-d’œuvre. Recalculez un RDV.');
    generatedProposals[item.id] = null;
    saveState();
  };

  window.updateImportedLaborLineAllocation = function updateImportedLaborLineAllocation(item, claimId, lineId, selectedPhases, options = {}) {
    const claim = (item.claims || []).find((candidate) => candidate.id === claimId);
    const line = claim?.estimate?.originalLines?.find((candidate) => candidate.id === lineId);
    if (!line) return;
    line.operation = line.operation || line.rawText || 'Opération devis';
    line.laborHours = roundPlanningHours(Number(line.laborHours || 0));
    line.selectedPhases = selectedPhases;
    line.allocations = makeWeightedAllocations(line.operation, line.laborHours, selectedPhases);
    if (options.pieceKind) line.pieceKind = options.pieceKind;
    if (options.paintFaces) line.paintFaces = options.paintFaces;
    if (options.paintGroup) line.paintGroup = options.paintGroup;
    if (!line.pieceKind) line.pieceKind = inferPieceKind(line.operation);
    if (!line.paintFaces) line.paintFaces = inferPaintFaces(line.operation, line.pieceKind);
    if (!line.paintGroup) line.paintGroup = inferPaintGroup(line.operation);
    recalculateImportedLaborForCase(item);
  };

  function renderPaintOptimizationSummary(item) {
    const groups = [];
    (item.claims || []).forEach((claim) => {
      (claim.estimate?.paintOptimization || []).forEach((group) => groups.push(group));
    });
    if (!groups.length) return '';
    const total = groups.length
      ? roundPlanningHours((groups.slice().sort((a,b) => b.total - a.total)[0]?.total || 0) + groups.slice().sort((a,b) => b.total - a.total).slice(1).reduce((sum, group) => sum + Number(group.total || 0), 0) * 0.4)
      : 0;
    return `<div class="paint-optimization-summary"><strong>Peinture mutualisée :</strong> ${groups.map((group) => `${escapeHtml(group.label || groupLabel(group.group))} ${formatLocalizedDecimal(group.total)} h`).join(' · ')} <b>Total cabine retenu ${formatLocalizedDecimal(total)} h</b></div>`;
  }
  window.renderPaintOptimizationSummary = renderPaintOptimizationSummary;

  window.NIMR_BUSINESS_RULES_VERSION = APP_RULE_VERSION;
})();

(function () {
  const PHASES = ['body', 'oilService', 'mechanical', 'electrical', 'prep', 'paint', 'reassembly', 'finish'];
  const GROUP_OPTIONS = [
    ['front', 'Avant'], ['right', 'Côté droit'], ['left', 'Côté gauche'], ['rear', 'Arrière'], ['center', 'Capot / centre'], ['general', 'Général'],
  ];
  const PHASE_HELP = {
    prep: 'Préparation = poids 2 quand elle est cochée avec peinture',
    paint: 'Peinture = poids 1 et optimisation cabine par zone/côté',
  };

  function ensureLaborLineDefaults(line) {
    if (!line) return line;
    const operation = line.operation || line.rawText || 'Opération devis';
    if (!line.pieceKind) line.pieceKind = /\b(DRESSAGE|REPARATION|REDRESSAGE)\b/.test(normalizeEstimateOperationText(operation)) ? 'repair' : 'new';
    if (!line.paintFaces) {
      const canTwoSides = /\b(PORTE|CAPOT|MALLE)\b/.test(normalizeEstimateOperationText(operation));
      line.paintFaces = canTwoSides && line.pieceKind === 'new' ? 'two_sides' : 'outside';
    }
    if (!line.paintGroup && typeof inferPaintGroup === 'function') line.paintGroup = inferPaintGroup(operation);
    if (!line.paintGroup) {
      const n = normalizeEstimateOperationText(operation);
      line.paintGroup = /\b(DR|DROIT|DROITE)\b/.test(n) ? 'right' : /\b(GH|GAUCHE)\b/.test(n) ? 'left' : /\b(PARE\s*CHOCS?\s*AV|CAPOT|CALANDRE|PHARE|OPTIQUE)\b/.test(n) ? 'front' : /\b(PARE\s*CHOCS?\s*AR|MALLE|JUPE)\b/.test(n) ? 'rear' : 'general';
    }
    return line;
  }

  function getPlanningLaborRows(item) {
    const rows = [];
    (item.claims || []).forEach((claim) => {
      cleanClaimEstimateForPlanning(claim);
      if (!claim.estimate?.originalLines?.length && claim.estimate?.lines?.length) {
        claim.estimate.originalLines = claim.estimate.lines.map((line) => ({
          id: line.id || uid('estimate-original-line'),
          operation: line.operation || 'Opération devis',
          laborHours: Number(line.laborHours || 0),
          allocations: [{ phase: line.phase, operation: line.operation || '', laborHours: Number(line.laborHours || 0) }],
        }));
      }
      (claim.estimate?.originalLines || []).forEach((line) => {
        ensureLaborLineDefaults(line);
        const allocations = Array.isArray(line.allocations) ? line.allocations.filter((a) => a.phase && Number(a.laborHours || 0) > 0) : [];
        const selectedPhases = [...new Set(allocations.map((allocation) => allocation.phase))];
        const laborHours = Number(line.laborHours || allocations.reduce((sum, allocation) => sum + Number(allocation.laborHours || 0), 0));
        if (!laborHours) return;
        rows.push({
          claim,
          claimLabel: `${claim.number || ''} ${claim.title || 'Ordre'}`.trim(),
          line,
          selectedPhases,
          operation: line.operation || line.rawText || 'Opération devis',
          laborHours,
          allocations,
        });
      });
    });
    return rows;
  }

  function allocationSummary(row) {
    if (!row.allocations.length) return '<span class="labor-allocation-empty">Aucune étape affectée</span>';
    return row.allocations.map((allocation) => `
      <span class="labor-allocation-pill">
        ${escapeHtml((typeof getDurationLabel === 'function' && getDurationLabel(allocation.phase)) || allocation.phase)}
        <strong>${formatLocalizedDecimal(allocation.laborHours)} h</strong>
      </span>
    `).join('');
  }

  function renderPhaseCheckboxes(row) {
    return PHASES.map((phase) => `
      <label class="labor-phase-check" title="${escapeAttr(PHASE_HELP[phase] || '')}">
        <input type="checkbox" data-labor-phase="${phase}" ${row.selectedPhases.includes(phase) ? 'checked' : ''} />
        <span>${escapeHtml((typeof getDurationLabel === 'function' && getDurationLabel(phase)) || phase)}</span>
      </label>
    `).join('');
  }

  function renderLaborPaintControls(row) {
    const needsPaintControls = row.selectedPhases.includes('prep') || row.selectedPhases.includes('paint');
    return `
      <div class="labor-paint-controls ${needsPaintControls ? '' : 'muted-controls'}">
        <label>État pièce
          <select data-labor-piece-kind>
            <option value="new" ${row.line.pieceKind === 'new' ? 'selected' : ''}>Pièce neuve / remplacée</option>
            <option value="repair" ${row.line.pieceKind === 'repair' ? 'selected' : ''}>Pièce à réparer / dressage</option>
          </select>
        </label>
        <label>Côté peinture
          <select data-labor-paint-faces>
            <option value="outside" ${row.line.paintFaces !== 'two_sides' ? 'selected' : ''}>Extérieur seulement</option>
            <option value="two_sides" ${row.line.paintFaces === 'two_sides' ? 'selected' : ''}>Deux côtés</option>
          </select>
        </label>
        <label>Zone de groupement
          <select data-labor-paint-group>
            ${GROUP_OPTIONS.map(([value, label]) => `<option value="${value}" ${row.line.paintGroup === value ? 'selected' : ''}>${label}</option>`).join('')}
          </select>
        </label>
      </div>
    `;
  }

  window.renderImportedLaborReview = function renderImportedLaborReviewV2187(root, item) {
    const durationGrid = $('[data-field="durations"]', root);
    if (!durationGrid) return;
    let panel = $('[data-field="imported-labor-review"]', root);
    if (!panel) {
      panel = document.createElement('div');
      panel.className = 'imported-labor-review imported-labor-review-v2187';
      panel.dataset.field = 'imported-labor-review';
      durationGrid.parentNode.insertBefore(panel, durationGrid);
    }
    const rows = getPlanningLaborRows(item);
    if (!rows.length) {
      panel.innerHTML = `
        <div class="imported-labor-head">
          <div>
            <h3>Main-d’œuvre importée du devis</h3>
            <p>Aucune ligne MO importée. Importez le devis dans Ordres & devis ou saisissez les durées manuellement.</p>
          </div>
        </div>`;
      return;
    }
    const total = rows.reduce((sum, row) => sum + Number(row.laborHours || 0), 0);
    panel.innerHTML = `
      <div class="imported-labor-head">
        <div>
          <h3>Main-d’œuvre importée du devis</h3>
          <p>Chaque ligne peut être affectée à une ou plusieurs étapes. Préparation + peinture se répartissent 2/3 et 1/3, puis la peinture est mutualisée par zone/côté.</p>
        </div>
        <strong>${formatLocalizedDecimal(total)} h MO devis</strong>
      </div>
      ${(typeof renderPaintOptimizationSummary === 'function' ? renderPaintOptimizationSummary(item) : '')}
      <div class="imported-labor-list parametric-labor-list">
        ${rows.map((row, index) => `
          <article class="imported-labor-row parametric-labor-row" data-claim-id="${escapeAttr(row.claim.id)}" data-line-id="${escapeAttr(row.line.id)}">
            <div class="imported-labor-main">
              <span class="labor-row-index">${index + 1}</span>
              <div>
                <strong>${escapeHtml(row.operation)}</strong>
                <small>${escapeHtml(row.claimLabel || 'Ordre')} ${row.line.code ? ` · ${escapeHtml(row.line.code)}` : ''}</small>
              </div>
              <b>${formatLocalizedDecimal(row.laborHours)} h</b>
            </div>
            <div class="labor-param-grid">
              <div class="labor-phase-grid">${renderPhaseCheckboxes(row)}</div>
              ${renderLaborPaintControls(row)}
            </div>
            <div class="labor-allocation-summary">${allocationSummary(row)}</div>
          </article>
        `).join('')}
      </div>`;

    $$('[data-claim-id][data-line-id]', panel).forEach((card) => {
      const apply = () => {
        const selectedPhases = $$('[data-labor-phase]', card).filter((input) => input.checked).map((input) => input.dataset.laborPhase);
        const pieceKind = $('[data-labor-piece-kind]', card)?.value || 'new';
        const paintFaces = $('[data-labor-paint-faces]', card)?.value || 'outside';
        const paintGroup = $('[data-labor-paint-group]', card)?.value || 'general';
        if (typeof updateImportedLaborLineAllocation === 'function') {
          updateImportedLaborLineAllocation(item, card.dataset.claimId, card.dataset.lineId, selectedPhases, { pieceKind, paintFaces, paintGroup });
          renderCaseDetail();
          renderPlanning();
          renderMetrics();
        }
      };
      $$('input, select', card).forEach((control) => control.addEventListener('change', apply));
    });
  };
})();
