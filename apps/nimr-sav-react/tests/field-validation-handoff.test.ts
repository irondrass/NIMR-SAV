import { describe, expect, it } from 'vitest';
import { CASE_STATUSES } from '../src/domain/case-status';
import {
  getBlockingIssuesChecklist,
  getFieldValidationPlan,
  getFinalRcDecisionTemplate,
  getRoleBasedManualValidationSteps,
  getWorkshopDaySimulationChecklist,
} from '../src/domain/field-validation-handoff';
import { OFFICIAL_ROLES } from '../src/domain/role-governance';

function handoffText(): string {
  return JSON.stringify({
    plan: getFieldValidationPlan(),
    roles: getRoleBasedManualValidationSteps(),
    day: getWorkshopDaySimulationChecklist(),
    blockers: getBlockingIssuesChecklist(),
    decision: getFinalRcDecisionTemplate(),
  });
}

describe('Field validation handoff (v24.0.0-alpha.17)', () => {
  it('provides the field validation plan', () => {
    const plan = getFieldValidationPlan();

    expect(plan.length).toBeGreaterThanOrEqual(4);
    expect(handoffText()).toContain('validation terrain');
  });

  it('provides manual validation steps for every official role', () => {
    const roleSteps = getRoleBasedManualValidationSteps();
    const roles = roleSteps.map((step) => step.role);

    expect(new Set(roles)).toEqual(new Set(OFFICIAL_ROLES));
    for (const step of roleSteps) {
      expect(step.steps.length).toBeGreaterThanOrEqual(3);
      expect(step.expectedEvidence).toBeTruthy();
    }
  });

  it('provides the workshop day simulation checklist', () => {
    const checklist = getWorkshopDaySimulationChecklist();

    expect(checklist.length).toBeGreaterThanOrEqual(8);
    expect(handoffText()).toContain('Réception de plusieurs dossiers');
    expect(handoffText()).toContain('Livraison client');
    expect(handoffText()).toContain('Consultation direction/admin/lecture seule');
  });

  it('covers expected official statuses in the day simulation', () => {
    const statuses = getWorkshopDaySimulationChecklist().flatMap(
      (item) => item.expectedStatuses,
    );

    for (const status of statuses) {
      expect(CASE_STATUSES).toContain(status);
    }
    expect(new Set(statuses)).toEqual(
      new Set([
        'draft',
        'received',
        'diagnosis',
        'repair',
        'work_completed',
        'waiting_parts',
        'quality_pending',
        'quality_rejected',
        'quality_rework',
        'quality_approved',
        'ready_delivery',
        'delivered',
      ]),
    );
  });

  it('provides the blocking issues checklist', () => {
    const blockers = getBlockingIssuesChecklist();
    const text = handoffText();

    expect(blockers.length).toBeGreaterThanOrEqual(8);
    expect(text).toContain('Perte de dossier');
    expect(text).toContain('Mutation par lecture seule');
    expect(text).toContain('Livraison sans qualité approuvée');
    expect(text).toContain('Erreur console critique');
    expect(text).toContain('Échec test, build ou audit');
  });

  it('provides the final GO / NO-GO decision template', () => {
    const decision = getFinalRcDecisionTemplate();
    const optionIds = decision.options.map((option) => option.id);

    expect(optionIds).toEqual([
      'go_rc1_tag',
      'no_go_rc1',
      'go_with_reservations',
      'corrective_rc1_or_rc2',
    ]);
    expect(decision.mandatorySignoffs).toEqual(OFFICIAL_ROLES);
  });

  it('does not declare rc.1 as production or final', () => {
    const text = handoffText();
    const forbiddenPhrases = [
      ['production', ' ready'].join(''),
      ['production', '-ready'].join(''),
      ['version finale', ' validée'].join(''),
      ['v24.0.0', ' final validé'].join(''),
    ];

    for (const phrase of forbiddenPhrases) {
      expect(text).not.toContain(phrase);
    }
    expect(text).toContain('Aucun déploiement production');
    expect(text).toContain('version finale v24.0.0 reste hors périmètre');
  });

  it('does not instruct automatic tagging', () => {
    const text = handoffText();
    const forbiddenTagPhrase = ['tag', ' v24'].join('');

    expect(text).not.toContain(forbiddenTagPhrase);
    expect(text).toContain('tag rc.1 éventuel reste une décision humaine séparée');
  });

  it('uses only official roles', () => {
    const planRoles = getFieldValidationPlan().map((step) => step.owner);
    const roleStepRoles = getRoleBasedManualValidationSteps().map((step) => step.role);
    const simulationRoles = getWorkshopDaySimulationChecklist().flatMap(
      (item) => item.involvedRoles,
    );
    const decisionRoles = [...getFinalRcDecisionTemplate().mandatorySignoffs];

    for (const role of [...planRoles, ...roleStepRoles, ...simulationRoles, ...decisionRoles]) {
      expect(OFFICIAL_ROLES).toContain(role);
    }
  });

  it('uses only official statuses', () => {
    const statuses = getWorkshopDaySimulationChecklist().flatMap(
      (item) => item.expectedStatuses,
    );

    for (const status of statuses) {
      expect(CASE_STATUSES).toContain(status);
    }
  });
});
