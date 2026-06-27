import { describe, expect, it } from 'vitest';
import {
  buildFullFieldAcceptancePlan,
  buildRoleAcceptanceScenario,
  evaluateAcceptanceResult,
  getRoleAcceptanceChecklist,
  summarizeAcceptanceReadiness,
} from '../src/domain/field-acceptance';
import { OFFICIAL_ROLES } from '../src/domain/role-governance';

describe('Field acceptance alpha.19', () => {
  it('builds one acceptance scenario per official role', () => {
    const plan = buildFullFieldAcceptancePlan();
    expect(plan).toHaveLength(OFFICIAL_ROLES.length);
    expect(plan.map((scenario) => scenario.role)).toEqual(OFFICIAL_ROLES);
  });

  it('covers mandatory role workflows', () => {
    expect(getRoleAcceptanceChecklist('reception').map((step) => step.id)).toEqual(
      expect.arrayContaining(['draft', 'receive', 'photos', 'estimate', 'print'])
    );
    expect(getRoleAcceptanceChecklist('technicien').map((step) => step.id)).toContain('no_export');
    expect(getRoleAcceptanceChecklist('lecture-seule').map((step) => step.id)).toContain('no_mutation');
  });

  it('evaluates GO, reserves and NO-GO outcomes', () => {
    expect(evaluateAcceptanceResult(['pass', 'pass']).decision).toBe('GO interne');
    expect(evaluateAcceptanceResult(['pass', 'manual']).decision).toBe('GO avec réserves');
    expect(evaluateAcceptanceResult(['pass', 'fail']).decision).toBe('NO-GO');
  });

  it('summarizes alpha.19 readiness without automatic production outcome', () => {
    const summary = summarizeAcceptanceReadiness();
    expect(summary.decision).toBe('GO avec réserves');
    expect(summary.reserves.join(' ')).toContain('aucune RC');
    expect(summary.reserves.join(' ')).not.toContain('production automatique validée');
  });

  it('returns a detailed scenario for Admin diagnostics', () => {
    const scenario = buildRoleAcceptanceScenario('admin');
    expect(scenario.objective).toContain('Diagnostiquer');
    expect(scenario.noGoCriteria.join(' ')).toContain('SW React');
  });
});
