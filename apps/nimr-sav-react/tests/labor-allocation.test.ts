import { describe, it, expect } from 'vitest';
import {
  classifyLaborLine,
  calculateLaborSummaryByPole,
  convertLaborHoursToPlanningMinutes,
  generateWorkshopTasksFromEstimate
} from '../src/domain/labor-allocator';
import { parseEstimateText } from '../src/domain/estimate-parser';

describe('Labor Allocator Domain Tests', () => {
  it('correctly classifies labor description to poles', () => {
    // Tolerie
    expect(classifyLaborLine('REDRESSAGE PORTIERE')).toBe('tolerie');
    expect(classifyLaborLine('PASSAGE SUR MARBRE')).toBe('tolerie');

    // Peinture
    expect(classifyLaborLine('PEINTURE COMPLETE')).toBe('peinture');
    expect(classifyLaborLine('VERNISSAGE AILE')).toBe('peinture');

    // Preparation
    expect(classifyLaborLine('PONCAGE CAPOT')).toBe('preparation');
    expect(classifyLaborLine('PREPARATION CABINE')).toBe('preparation');

    // Remontage
    expect(classifyLaborLine('DEMONTAGE PARE-CHOCS')).toBe('remontage');
    expect(classifyLaborLine('REPOSE OPTIQUE FEU')).toBe('remontage');

    // Finition
    expect(classifyLaborLine('LUSTRAGE CARROSSERIE')).toBe('finition');
    expect(classifyLaborLine('LAVAGE INTERIEUR')).toBe('finition');

    // Mecanique
    expect(classifyLaborLine('VIDANGE MOTEUR')).toBe('mecanique');
    expect(classifyLaborLine('DIAGNOSTIC ELECTRIQUE')).toBe('mecanique');

    // Autre
    expect(classifyLaborLine('OPERATION SANS NOM SPECIAL')).toBe('autre');
  });

  it('calculates labor summary and converts hours to minutes', () => {
    const devisTxt = `
D/P AILE AVANT 1.50 33.000 49.500
PEINTURE APPRET 2.00 33.000 66.000
VIDANGE HUILE 1.00 35.000 35.000
    `;

    const estimate = parseEstimateText(devisTxt);
    const summary = calculateLaborSummaryByPole(estimate.lines);

    expect(summary.remontage).toBe(1.5);
    expect(summary.peinture).toBe(2);
    expect(summary.mecanique).toBe(1);

    expect(convertLaborHoursToPlanningMinutes(1.5)).toBe(90);
    expect(convertLaborHoursToPlanningMinutes(2)).toBe(120);
  });

  it('generates workshop tasks from parsed estimate', () => {
    const devisTxt = `
REDRESSAGE PORTIERE 3.00 33.000 99.000
PEINTURE COMPLETE 2.50 33.000 82.500
    `;

    const estimate = parseEstimateText(devisTxt);
    const tasks = generateWorkshopTasksFromEstimate(estimate);

    expect(tasks).toHaveLength(2);

    const tolerieTask = tasks.find(t => t.pole === 'tolerie' || t.label.includes('Tôlerie'));
    expect(tolerieTask).toBeDefined();
    expect(tolerieTask?.estimatedDurationMinutes).toBe(180);

    const peintureTask = tasks.find(t => t.pole === 'peinture' || t.label.includes('Peinture'));
    expect(peintureTask).toBeDefined();
    expect(peintureTask?.estimatedDurationMinutes).toBe(150);
  });
});
