import { describe, expect, it } from 'vitest';
import {
  ACCEPTANCE_CASE_IDS,
  createAcceptanceScenarioActors,
  createAcceptanceScenarioCases,
  createAcceptanceScenarioTimeline,
  getCaseTimeline,
  groupLogsByCaseId,
  validateMultiCaseWorkflowConsistency,
  validateNoConsultationMutation,
  validateTimelineOrder,
} from '../src/domain/business-acceptance-scenarios';
import type { SavCase } from '../src/domain/sav-case';
import { transitionCase } from '../src/domain/workflow-engine';

describe('Multi-case workflow consistency (v24.0.0-alpha.18)', () => {
  it('keeps every case status, technician, task and timeline isolated', () => {
    const cases = createAcceptanceScenarioCases();
    const logs = createAcceptanceScenarioTimeline();
    const original = structuredClone({ cases, logs });
    const grouped = groupLogsByCaseId(logs);

    expect(Object.keys(grouped)).toHaveLength(5);
    for (const savCase of cases) {
      expect(grouped[savCase.id]?.length).toBeGreaterThan(0);
      expect(grouped[savCase.id].every((log) => log.caseId === savCase.id)).toBe(true);
    }

    const assignedTechnicians = cases
      .filter((savCase) => savCase.assignedTechnicianId)
      .map((savCase) => savCase.assignedTechnicianId);
    expect(new Set(assignedTechnicians).size).toBe(4);

    const changedCase = structuredClone(cases[0]);
    changedCase.workshopTasks![0].status = 'pending';
    expect(cases[1].workshopTasks?.[0].status).toBe('pending');
    expect(cases[2].workshopTasks?.[0].status).toBe('in_progress');
    expect(cases[0].workshopTasks?.[0].status).toBe('done');
    expect(validateNoConsultationMutation(original, { cases, logs }).success).toBe(true);
  });

  it('traces each log by caseId and returns chronological defensive copies', () => {
    const logs = createAcceptanceScenarioTimeline();
    const timeline = getCaseTimeline(ACCEPTANCE_CASE_IDS.completeDelivery, logs);
    const originalFirstAction = logs.find(
      (log) => log.caseId === ACCEPTANCE_CASE_IDS.completeDelivery,
    )!.action;

    expect(validateTimelineOrder(logs).success).toBe(true);
    expect(timeline.length).toBeGreaterThan(8);
    expect(timeline.every((log) => log.caseId === ACCEPTANCE_CASE_IDS.completeDelivery)).toBe(true);

    timeline[0].action = 'LOCAL_VIEW_CHANGE';
    expect(
      logs.find((log) => log.caseId === ACCEPTANCE_CASE_IDS.completeDelivery)!.action,
    ).toBe(originalFirstAction);
  });

  it('detects a non-chronological per-case timeline', () => {
    const logs = createAcceptanceScenarioTimeline();
    const firstCaseIndexes = logs
      .map((log, index) => ({ log, index }))
      .filter(({ log }) => log.caseId === ACCEPTANCE_CASE_IDS.completeDelivery)
      .slice(0, 2)
      .map(({ index }) => index);
    const reordered = [...logs];
    const first = reordered[firstCaseIndexes[0]];
    reordered[firstCaseIndexes[0]] = reordered[firstCaseIndexes[1]];
    reordered[firstCaseIndexes[1]] = first;

    const result = validateTimelineOrder(reordered);
    expect(result.success).toBe(false);
    expect(result.errors.join(' ')).toContain(ACCEPTANCE_CASE_IDS.completeDelivery);
  });

  it('blocks waiting parts and quality rework while approved QC enables delivery', () => {
    const actors = createAcceptanceScenarioActors();
    const cases = createAcceptanceScenarioCases();
    const waitingParts = cases.find(
      (savCase) => savCase.id === ACCEPTANCE_CASE_IDS.waitingParts,
    )!;
    const qualityRework = cases.find(
      (savCase) => savCase.id === ACCEPTANCE_CASE_IDS.qualityRework,
    )!;
    const deliveredTemplate = cases.find(
      (savCase) => savCase.id === ACCEPTANCE_CASE_IDS.completeDelivery,
    )!;

    expect(transitionCase(waitingParts, 'ready_delivery', actors.delivery).success).toBe(false);
    expect(transitionCase(qualityRework, 'ready_delivery', actors.delivery).success).toBe(false);

    const approvedCase: SavCase = {
      ...deliveredTemplate,
      status: 'quality_approved',
      deliveryRecipientName: undefined,
      deliveryProofReference: undefined,
      deliveredAt: undefined,
      deliveredBy: undefined,
      deliveryDate: undefined,
    };
    const prepared = transitionCase(approvedCase, 'ready_delivery', actors.delivery);
    expect(prepared.success, prepared.error).toBe(true);

    const withProof: SavCase = {
      ...prepared.updatedCase!,
      deliveryRecipientName: 'Client Démo A',
      deliveryProofReference: 'DEMO-PREUVE-A',
    };
    expect(transitionCase(withProof, 'delivered', actors.technicians[0]).success).toBe(false);
    expect(transitionCase(withProof, 'delivered', actors.director).success).toBe(false);

    const delivered = transitionCase(withProof, 'delivered', actors.delivery);
    expect(delivered.success, delivered.error).toBe(true);
    expect(delivered.updatedCase?.status).toBe('delivered');
  });

  it('never lets a delivered case move backward', () => {
    const actors = createAcceptanceScenarioActors();
    const deliveredCase = createAcceptanceScenarioCases().find(
      (savCase) => savCase.id === ACCEPTANCE_CASE_IDS.completeDelivery,
    )!;

    expect(transitionCase(deliveredCase, 'repair', actors.technicians[0]).success).toBe(false);
    expect(transitionCase(deliveredCase, 'cancelled', actors.admin).success).toBe(false);
    expect(transitionCase(deliveredCase, 'ready_delivery', actors.delivery).success).toBe(false);
  });

  it('validates simultaneous workflows with no cross-case collision', () => {
    const result = validateMultiCaseWorkflowConsistency(
      createAcceptanceScenarioCases(),
      createAcceptanceScenarioTimeline(),
    );

    expect(result.success, result.blockers.join(' | ')).toBe(true);
    expect(result.checks.uniqueCaseIds).toBe(true);
    expect(result.checks.traceableLogs).toBe(true);
    expect(result.checks.isolatedTechnicians).toBe(true);
    expect(result.checks.deliveryGuards).toBe(true);
    expect(result.checks.deliveredIsForwardOnly).toBe(true);
  });
});
