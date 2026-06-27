import { describe, expect, it } from 'vitest';
import {
  getGoNoGoCriteriaForRcEvaluation,
  getKnownLimitationsBeforeRc,
  getManualAcceptanceChecklist,
  getRcEvaluationChecklist,
} from '../src/domain/rc-evaluation-checklist';

function flattenChecklistText(): string {
  return JSON.stringify({
    sections: getRcEvaluationChecklist(),
    manual: getManualAcceptanceChecklist(),
    limitations: getKnownLimitationsBeforeRc(),
    criteria: getGoNoGoCriteriaForRcEvaluation(),
  });
}

describe('RC evaluation checklist (v24.0.0-alpha.17)', () => {
  it('contains the technical checklist', () => {
    const sections = getRcEvaluationChecklist();

    expect(sections.some((section) => section.id === 'technical')).toBe(true);
    expect(flattenChecklistText()).toContain('Checklist technique');
  });

  it('contains the SAV business checklist', () => {
    const sections = getRcEvaluationChecklist();

    expect(sections.some((section) => section.id === 'sav_business')).toBe(true);
    expect(flattenChecklistText()).toContain('Checklist métier SAV');
  });

  it('contains the security and data checklist', () => {
    const sections = getRcEvaluationChecklist();

    expect(sections.some((section) => section.id === 'security_data')).toBe(true);
    expect(flattenChecklistText()).toContain('Checklist sécurité / données');
  });

  it('contains the field UX checklist', () => {
    const sections = getRcEvaluationChecklist();

    expect(sections.some((section) => section.id === 'field_ux')).toBe(true);
    expect(flattenChecklistText()).toContain('Checklist UX terrain');
  });

  it('contains the roles and permissions checklist', () => {
    const sections = getRcEvaluationChecklist();

    expect(sections.some((section) => section.id === 'roles_permissions')).toBe(true);
    expect(flattenChecklistText()).toContain('Checklist rôles et permissions');
  });

  it('contains the automated tests checklist', () => {
    const sections = getRcEvaluationChecklist();

    expect(sections.some((section) => section.id === 'automated_tests')).toBe(true);
    expect(flattenChecklistText()).toContain('Checklist tests automatisés');
  });

  it('contains the manual acceptance checklist', () => {
    const manual = getManualAcceptanceChecklist();

    expect(manual.length).toBeGreaterThanOrEqual(3);
    expect(flattenChecklistText()).toContain('Checklist validation manuelle');
  });

  it('contains GO / NO-GO criteria for rc.1 decision', () => {
    const criteria = getGoNoGoCriteriaForRcEvaluation();

    expect(criteria.go.length).toBeGreaterThanOrEqual(5);
    expect(criteria.noGo.length).toBeGreaterThanOrEqual(5);
    expect(flattenChecklistText()).toContain('GO / NO-GO');
  });

  it('does not describe rc.1 as published, production, or final', () => {
    const text = flattenChecklistText();
    const forbiddenPhrases = [
      ['production', ' ready'].join(''),
      ['production', '-ready'].join(''),
      ['RC', ' publiée'].join(''),
      ['release candidate', ' publiée'].join(''),
      ['version finale', ' validée'].join(''),
    ];

    for (const phrase of forbiddenPhrases) {
      expect(text).not.toContain(phrase);
    }
  });

  it('does not request an automatic v24 tag', () => {
    const text = flattenChecklistText();
    const forbiddenTagPhrase = ['tag', ' v24'].join('');

    expect(text).not.toContain(forbiddenTagPhrase);
    expect(text).toContain('Aucun push ni tag automatique');
  });

  it('documents known limitations before any rc.1 tag decision', () => {
    const limitations = getKnownLimitationsBeforeRc();

    expect(limitations.length).toBeGreaterThanOrEqual(5);
    expect(limitations.join(' | ')).toContain('Release Candidate interne');
    expect(limitations.join(' | ')).toContain('Validation manuelle terrain requise');
  });
});
