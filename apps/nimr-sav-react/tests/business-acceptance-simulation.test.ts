import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';
import { APP_VERSION } from '../src/constants/version';
import { hasPermission } from '../src/domain/action-permissions';
import type { AuditLogEntry } from '../src/domain/audit-log';
import {
  ACCEPTANCE_CASE_IDS,
  createAcceptanceScenarioActors,
  createAcceptanceScenarioCases,
  createAcceptanceScenarioTimeline,
  summarizeBusinessAcceptanceReadiness,
  validateBusinessAcceptanceScenario,
  validateNoConsultationMutation,
} from '../src/domain/business-acceptance-scenarios';
import type { CaseStatus } from '../src/domain/case-status';
import type { SavCase } from '../src/domain/sav-case';
import { transitionCase } from '../src/domain/workflow-engine';
import type { Role } from '../src/types';

describe('Business acceptance simulation (v24.0.0-alpha.18)', () => {
  it('aligns application and package versions on rc.1', () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(__dirname, '../package.json'), 'utf-8'),
    );
    const packageLock = JSON.parse(
      readFileSync(resolve(__dirname, '../package-lock.json'), 'utf-8'),
    );

    expect(APP_VERSION).toBe('v24.0.0-alpha.18');
    expect(packageJson.version).toBe('24.0.0-alpha.18');
    expect(packageLock.version).toBe('24.0.0-alpha.18');
    expect(packageLock.packages[''].version).toBe('24.0.0-alpha.18');
  });

  it('creates five fictitious parallel cases and all official acceptance actors', () => {
    const cases = createAcceptanceScenarioCases();
    const actors = createAcceptanceScenarioActors();
    const actorRoles = [
      actors.reception.role,
      actors.chefAtelier.role,
      ...actors.technicians.map((actor) => actor.role),
      actors.quality.role,
      actors.delivery.role,
      actors.director.role,
      actors.admin.role,
      actors.readonly.role,
    ];

    expect(cases).toHaveLength(5);
    expect(new Set(cases.map((savCase) => savCase.id)).size).toBe(5);
    expect(cases.every((savCase) => savCase.clientName.startsWith('Client Démo'))).toBe(true);
    expect(cases.every((savCase) => savCase.vin.startsWith('DEMO'))).toBe(true);
    expect(new Set(actorRoles)).toEqual(
      new Set([
        'reception',
        'chef-atelier',
        'technicien',
        'qualite',
        'livraison',
        'directeur-sav',
        'admin',
        'lecture-seule',
      ]),
    );
  });

  it('covers the complete reception-to-delivery workflow with authorized actors only', () => {
    const actors = createAcceptanceScenarioActors();
    const template = createAcceptanceScenarioCases().find(
      (savCase) => savCase.id === ACCEPTANCE_CASE_IDS.completeDelivery,
    );
    expect(template).toBeDefined();

    let current: SavCase = {
      ...template!,
      status: 'draft',
      qcStatus: undefined,
      qcCheckedAt: undefined,
      qcCheckedBy: undefined,
      deliveryPreparedAt: undefined,
      deliveryPreparedBy: undefined,
      deliveredAt: undefined,
      deliveredBy: undefined,
      deliveryDate: undefined,
      deliveryRecipientName: undefined,
      deliveryProofReference: undefined,
    };
    const generatedLogs: AuditLogEntry[] = [];

    const advance = (
      targetStatus: CaseStatus,
      actor: { id: string; role: Role },
    ) => {
      const result = transitionCase(current, targetStatus, actor);
      expect(result.success, result.error).toBe(true);
      expect(result.updatedCase).toBeDefined();
      expect(result.auditLog).toBeDefined();
      current = result.updatedCase!;
      generatedLogs.push(result.auditLog!);
    };

    expect(hasPermission('reception', 'create_case')).toBe(true);
    expect(hasPermission('reception', 'receive_case')).toBe(true);
    advance('received', actors.reception);

    expect(hasPermission('chef-atelier', 'assign_technician')).toBe(true);
    expect(hasPermission('chef-atelier', 'schedule_case')).toBe(true);
    current = {
      ...current,
      assignedTechnicianId: actors.technicians[0].id,
      assignedTechnicianName: actors.technicians[0].name,
    };
    advance('diagnosis', actors.chefAtelier);
    advance('repair', actors.chefAtelier);

    expect(hasPermission('technicien', 'start_task')).toBe(true);
    expect(hasPermission('technicien', 'complete_task')).toBe(true);
    advance('work_completed', actors.technicians[0]);

    expect(hasPermission('qualite', 'validate_qc')).toBe(true);
    expect(hasPermission('qualite', 'reject_qc')).toBe(true);
    advance('quality_pending', actors.quality);
    advance('quality_approved', actors.quality);
    current = {
      ...current,
      qcStatus: 'approved',
      qcCheckedAt: '2026-06-25T11:00:00.000Z',
      qcCheckedBy: actors.quality.id,
    };

    expect(hasPermission('livraison', 'prepare_delivery')).toBe(true);
    expect(hasPermission('livraison', 'deliver_case')).toBe(true);
    advance('ready_delivery', actors.delivery);
    current = {
      ...current,
      deliveryRecipientName: 'Client Démo A',
      deliveryProofReference: 'DEMO-PREUVE-A',
    };
    advance('delivered', actors.delivery);

    expect(current.status).toBe('delivered');
    expect(current.qcStatus).toBe('approved');
    expect(generatedLogs).toHaveLength(8);
    expect(generatedLogs.every((log) => log.action === 'STATUS_TRANSITION')).toBe(true);
  });

  it('blocks delivery before QC approval and after QC rejection', () => {
    const actors = createAcceptanceScenarioActors();
    const cases = createAcceptanceScenarioCases();
    const waitingParts = cases.find(
      (savCase) => savCase.id === ACCEPTANCE_CASE_IDS.waitingParts,
    )!;
    const blockedDelivery = cases.find(
      (savCase) => savCase.id === ACCEPTANCE_CASE_IDS.blockedDelivery,
    )!;
    const qualityRework = cases.find(
      (savCase) => savCase.id === ACCEPTANCE_CASE_IDS.qualityRework,
    )!;

    for (const blockedCase of [waitingParts, blockedDelivery, qualityRework]) {
      const result = transitionCase(blockedCase, 'ready_delivery', actors.delivery);
      expect(result.success).toBe(false);
      expect(result.auditLog).toBeUndefined();
    }

    const rejectedInput: SavCase = {
      ...blockedDelivery,
      status: 'quality_pending',
      qcRejectionReason: 'Défaut fictif constaté',
    };
    const rejected = transitionCase(rejectedInput, 'quality_rejected', actors.quality);
    expect(rejected.success).toBe(true);

    const rework = transitionCase(
      {
        ...rejected.updatedCase!,
        qcReworkReason: 'Reprise fictive demandée',
      },
      'quality_rework',
      actors.quality,
    );
    expect(rework.success).toBe(true);
    expect(rework.updatedCase?.status).toBe('quality_rework');

    const rejectedDelivery = transitionCase(
      rework.updatedCase!,
      'ready_delivery',
      actors.delivery,
    );
    expect(rejectedDelivery.success).toBe(false);
    expect(rejectedDelivery.auditLog).toBeUndefined();
  });

  it('keeps Direction, Admin governance and read-only consultation passive', () => {
    const actors = createAcceptanceScenarioActors();
    const source = {
      cases: createAcceptanceScenarioCases(),
      logs: createAcceptanceScenarioTimeline(),
    };
    const before = structuredClone(source);

    const directorView = structuredClone(source.cases);
    const adminGovernanceView = {
      totalCases: source.cases.length,
      totalLogs: source.logs.length,
    };
    const readonlyView = structuredClone(source);

    directorView[0].clientName = 'Vue Direction modifiée localement';
    readonlyView.cases[0].telephone = '11111111';
    readonlyView.logs[0].details = 'Vue lecture seule modifiée localement';

    expect(adminGovernanceView).toEqual({
      totalCases: 5,
      totalLogs: source.logs.length,
    });
    expect(validateNoConsultationMutation(before, source).success).toBe(true);
    expect(source.cases[0].clientName).toBe('Client Démo A');
    expect(source.cases[0].telephone).toBe('00000000');
    expect(
      source.logs.some((log) =>
        [actors.director.id, actors.admin.id, actors.readonly.id].includes(log.userId),
      ),
    ).toBe(false);

    expect(hasPermission('lecture-seule', 'create_case')).toBe(false);
    expect(hasPermission('lecture-seule', 'deliver_case')).toBe(false);
    expect(hasPermission('directeur-sav', 'prepare_delivery')).toBe(false);
    expect(hasPermission('directeur-sav', 'deliver_case')).toBe(false);
  });

  it('validates the complete business acceptance dataset and readiness summary', () => {
    const result = validateBusinessAcceptanceScenario(
      createAcceptanceScenarioCases(),
      createAcceptanceScenarioTimeline(),
    );
    const summary = summarizeBusinessAcceptanceReadiness(result);

    expect(result.success, result.blockers.join(' | ')).toBe(true);
    expect(result.metrics.totalCases).toBe(5);
    expect(result.metrics.deliveredCases).toBe(1);
    expect(result.metrics.waitingPartsCases).toBe(1);
    expect(result.metrics.reworkCases).toBe(1);
    expect(result.metrics.consultationMutationLogs).toBe(0);
    expect(summary).toContain('alpha.12 conservée sous rc.1 interne');
    expect(summary).toContain('sans exposition production');
  });

  it('reports empty or partial local data safely without mutating it', () => {
    const emptyCases: SavCase[] = [];
    const emptyLogs: AuditLogEntry[] = [];
    const partialCases = [
      {
        id: 'partial-case',
        status: 'draft',
      },
    ] as unknown as SavCase[];
    const partialBefore = structuredClone(partialCases);

    expect(() => validateBusinessAcceptanceScenario(emptyCases, emptyLogs)).not.toThrow();
    expect(validateBusinessAcceptanceScenario(emptyCases, emptyLogs).success).toBe(false);
    expect(() => validateBusinessAcceptanceScenario(partialCases, emptyLogs)).not.toThrow();
    expect(partialCases).toEqual(partialBefore);
  });
});
