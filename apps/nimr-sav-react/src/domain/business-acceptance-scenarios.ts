import type { Role } from '../types';
import type { AuditLogEntry } from './audit-log';
import { CASE_STATUSES, type CaseStatus } from './case-status';
import { isQCValidated } from './delivery-rules';
import { OFFICIAL_ROLES } from './role-governance';
import type { SavCase } from './sav-case';
import { ALLOWED_TRANSITIONS } from './workflow-engine';

export const ACCEPTANCE_CASE_IDS = {
  completeDelivery: 'acceptance-case-a',
  waitingParts: 'acceptance-case-b',
  qualityRework: 'acceptance-case-c',
  blockedDelivery: 'acceptance-case-d',
  cancelled: 'acceptance-case-e',
} as const;

export interface AcceptanceScenarioActor {
  id: string;
  name: string;
  role: Role;
}

export interface AcceptanceScenarioActors {
  reception: AcceptanceScenarioActor;
  chefAtelier: AcceptanceScenarioActor;
  technicians: readonly [
    AcceptanceScenarioActor,
    AcceptanceScenarioActor,
    AcceptanceScenarioActor,
    AcceptanceScenarioActor,
  ];
  quality: AcceptanceScenarioActor;
  delivery: AcceptanceScenarioActor;
  director: AcceptanceScenarioActor;
  admin: AcceptanceScenarioActor;
  readonly: AcceptanceScenarioActor;
}

export interface BusinessAcceptanceMetrics {
  totalCases: number;
  totalLogs: number;
  uniqueCases: number;
  deliveredCases: number;
  waitingPartsCases: number;
  reworkCases: number;
  blockedDeliveryCases: number;
  consultationMutationLogs: number;
}

export interface BusinessAcceptanceValidationResult {
  success: boolean;
  blockers: string[];
  warnings: string[];
  checks: Record<string, boolean>;
  metrics: BusinessAcceptanceMetrics;
}

export interface SimpleValidationResult {
  success: boolean;
  errors: string[];
}

interface WorkflowStep {
  from: CaseStatus;
  to: CaseStatus;
  actor: AcceptanceScenarioActor;
}

interface WorkflowDefinition {
  caseId: string;
  technician?: AcceptanceScenarioActor;
  steps: readonly WorkflowStep[];
}

const FIXED_DAY = '2026-06-25';
const CONSULTATION_ROLES: readonly Role[] = ['directeur-sav', 'admin', 'lecture-seule'];
const ACCEPTED_CLIENT_NAMES = new Set(['Client Démo A', 'Client Démo B']);

function atTime(hour: number, minute: number): string {
  return `${FIXED_DAY}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000Z`;
}

function cloneLog(log: AuditLogEntry): AuditLogEntry {
  return { ...log };
}

function transitionExists(
  logs: readonly AuditLogEntry[],
  caseId: string,
  fromStatus: CaseStatus,
  toStatus: CaseStatus,
): boolean {
  return logs.some(
    (log) =>
      log.caseId === caseId &&
      log.fromStatus === fromStatus &&
      log.toStatus === toStatus,
  );
}

function isRoleAllowedForTransition(
  role: Role,
  fromStatus: CaseStatus,
  toStatus: CaseStatus,
): boolean {
  if (fromStatus === 'draft' && toStatus === 'received') return role === 'reception';
  if (toStatus === 'cancelled') return role === 'reception' || role === 'chef-atelier' || role === 'admin';
  if (fromStatus === 'received' && toStatus === 'diagnosis') return role === 'chef-atelier';
  if (fromStatus === 'diagnosis' && (toStatus === 'waiting_parts' || toStatus === 'repair')) {
    return role === 'chef-atelier';
  }
  if (fromStatus === 'waiting_parts' && toStatus === 'repair') {
    return role === 'chef-atelier' || role === 'technicien';
  }
  if (fromStatus === 'repair' && toStatus === 'work_completed') {
    return role === 'technicien' || role === 'chef-atelier';
  }
  if (
    (fromStatus === 'work_completed' && toStatus === 'quality_pending') ||
    (fromStatus === 'quality_pending' &&
      (toStatus === 'quality_approved' || toStatus === 'quality_rejected')) ||
    (fromStatus === 'quality_rejected' && toStatus === 'quality_rework') ||
    (fromStatus === 'quality_rework' && toStatus === 'quality_pending')
  ) {
    return role === 'qualite';
  }
  if (
    (fromStatus === 'quality_approved' && toStatus === 'ready_delivery') ||
    (fromStatus === 'ready_delivery' && toStatus === 'delivered')
  ) {
    return role === 'livraison';
  }
  if (fromStatus === 'delivered' && toStatus === 'closed') {
    return role === 'directeur-sav' || role === 'admin';
  }
  return false;
}

function createMetrics(
  cases: readonly SavCase[],
  logs: readonly AuditLogEntry[],
): BusinessAcceptanceMetrics {
  const caseIds = new Set(cases.map((savCase) => savCase.id));
  const blockedDeliveryCase = cases.find(
    (savCase) => savCase.id === ACCEPTANCE_CASE_IDS.blockedDelivery,
  );

  return {
    totalCases: cases.length,
    totalLogs: logs.length,
    uniqueCases: caseIds.size,
    deliveredCases: cases.filter((savCase) => savCase.status === 'delivered').length,
    waitingPartsCases: cases.filter((savCase) => savCase.status === 'waiting_parts').length,
    reworkCases: cases.filter(
      (savCase) =>
        savCase.status === 'quality_rejected' || savCase.status === 'quality_rework',
    ).length,
    blockedDeliveryCases:
      blockedDeliveryCase && blockedDeliveryCase.status !== 'ready_delivery' &&
      blockedDeliveryCase.status !== 'delivered'
        ? 1
        : 0,
    consultationMutationLogs: logs.filter((log) =>
      CONSULTATION_ROLES.includes(log.userRole as Role),
    ).length,
  };
}

export function createAcceptanceScenarioActors(): AcceptanceScenarioActors {
  return {
    reception: { id: 'acceptance-reception', name: 'Réception Démo', role: 'reception' },
    chefAtelier: {
      id: 'acceptance-chef-atelier',
      name: 'Chef Atelier Démo',
      role: 'chef-atelier',
    },
    technicians: [
      { id: 'acceptance-tech-a', name: 'Technicien Démo A', role: 'technicien' },
      { id: 'acceptance-tech-b', name: 'Technicien Démo B', role: 'technicien' },
      { id: 'acceptance-tech-c', name: 'Technicien Démo C', role: 'technicien' },
      { id: 'acceptance-tech-d', name: 'Technicien Démo D', role: 'technicien' },
    ],
    quality: { id: 'acceptance-quality', name: 'Qualité Démo', role: 'qualite' },
    delivery: { id: 'acceptance-delivery', name: 'Livraison Démo', role: 'livraison' },
    director: {
      id: 'acceptance-director',
      name: 'Direction SAV Démo',
      role: 'directeur-sav',
    },
    admin: { id: 'acceptance-admin', name: 'Admin Démo', role: 'admin' },
    readonly: {
      id: 'acceptance-readonly',
      name: 'Consultation Démo',
      role: 'lecture-seule',
    },
  };
}

export function createAcceptanceScenarioCases(): SavCase[] {
  const actors = createAcceptanceScenarioActors();
  const requiredChecklist = [
    { id: 'qc-fixation', label: 'Fixations contrôlées', checked: true, required: true },
    { id: 'qc-finition', label: 'Finition contrôlée', checked: true, required: true },
  ];

  return [
    {
      id: ACCEPTANCE_CASE_IDS.completeDelivery,
      immatriculation: 'DEMO-A-001',
      vin: 'DEMOA000000000001',
      clientName: 'Client Démo A',
      telephone: '00000000',
      status: 'delivered',
      assignedTechnicianId: actors.technicians[0].id,
      assignedTechnicianName: actors.technicians[0].name,
      workshopPriority: 'haute',
      workshopBay: 'A1',
      workshopTasks: [
        {
          id: 'task-a-1',
          label: 'Réparation carrosserie fictive',
          status: 'done',
          createdAt: atTime(8, 20),
        },
      ],
      qcChecklist: requiredChecklist.map((item) => ({ ...item })),
      qcStatus: 'approved',
      qcCheckedAt: atTime(11, 0),
      qcCheckedBy: actors.quality.id,
      deliveryPreparedAt: atTime(11, 30),
      deliveryPreparedBy: actors.delivery.id,
      deliveredAt: atTime(12, 0),
      deliveredBy: actors.delivery.id,
      deliveryDate: atTime(12, 0),
      deliveryRecipientName: 'Client Démo A',
      deliveryProofReference: 'DEMO-PREUVE-A',
      receptionDate: atTime(8, 0),
      createdAt: atTime(7, 55),
      updatedAt: atTime(12, 0),
    },
    {
      id: ACCEPTANCE_CASE_IDS.waitingParts,
      immatriculation: 'DEMO-B-002',
      vin: 'DEMOB000000000002',
      clientName: 'Client Démo B',
      telephone: '00000000',
      status: 'waiting_parts',
      assignedTechnicianId: actors.technicians[1].id,
      assignedTechnicianName: actors.technicians[1].name,
      workshopPriority: 'normale',
      workshopBay: 'B1',
      workshopTasks: [
        {
          id: 'task-b-1',
          label: 'Remplacement pièce fictive',
          status: 'pending',
          createdAt: atTime(8, 25),
        },
      ],
      receptionDate: atTime(8, 2),
      createdAt: atTime(7, 57),
      updatedAt: atTime(9, 2),
    },
    {
      id: ACCEPTANCE_CASE_IDS.qualityRework,
      immatriculation: 'DEMO-C-003',
      vin: 'DEMOA000000000003',
      clientName: 'Client Démo A',
      telephone: '00000000',
      status: 'quality_rework',
      assignedTechnicianId: actors.technicians[2].id,
      assignedTechnicianName: actors.technicians[2].name,
      workshopPriority: 'haute',
      workshopBay: 'C1',
      workshopTasks: [
        {
          id: 'task-c-1',
          label: 'Reprise finition fictive',
          status: 'in_progress',
          createdAt: atTime(8, 30),
        },
      ],
      qcChecklist: [
        { id: 'qc-c-1', label: 'Finition contrôlée', checked: false, required: true },
      ],
      qcStatus: 'in_progress',
      qcCheckedAt: atTime(11, 4),
      qcCheckedBy: actors.quality.id,
      qcRejectionReason: 'Finition fictive à reprendre',
      qcReworkReason: 'Reprise atelier demandée après contrôle',
      receptionDate: atTime(8, 4),
      createdAt: atTime(7, 59),
      updatedAt: atTime(11, 24),
    },
    {
      id: ACCEPTANCE_CASE_IDS.blockedDelivery,
      immatriculation: 'DEMO-D-004',
      vin: 'DEMOB000000000004',
      clientName: 'Client Démo B',
      telephone: '00000000',
      status: 'quality_pending',
      assignedTechnicianId: actors.technicians[3].id,
      assignedTechnicianName: actors.technicians[3].name,
      workshopPriority: 'normale',
      workshopBay: 'D1',
      workshopTasks: [
        {
          id: 'task-d-1',
          label: 'Contrôle préalable fictif',
          status: 'done',
          createdAt: atTime(8, 35),
        },
      ],
      qcChecklist: [
        { id: 'qc-d-1', label: 'Contrôle final requis', checked: false, required: true },
      ],
      qcStatus: 'in_progress',
      receptionDate: atTime(8, 6),
      createdAt: atTime(8, 1),
      updatedAt: atTime(10, 46),
    },
    {
      id: ACCEPTANCE_CASE_IDS.cancelled,
      immatriculation: 'DEMO-E-005',
      vin: 'DEMOA000000000005',
      clientName: 'Client Démo A',
      telephone: '00000000',
      status: 'cancelled',
      receptionDate: atTime(8, 8),
      createdAt: atTime(8, 3),
      updatedAt: atTime(8, 28),
    },
  ];
}

export function createAcceptanceScenarioTimeline(): AuditLogEntry[] {
  const actors = createAcceptanceScenarioActors();
  const workflows: readonly WorkflowDefinition[] = [
    {
      caseId: ACCEPTANCE_CASE_IDS.completeDelivery,
      technician: actors.technicians[0],
      steps: [
        { from: 'draft', to: 'received', actor: actors.reception },
        { from: 'received', to: 'diagnosis', actor: actors.chefAtelier },
        { from: 'diagnosis', to: 'repair', actor: actors.chefAtelier },
        { from: 'repair', to: 'work_completed', actor: actors.technicians[0] },
        { from: 'work_completed', to: 'quality_pending', actor: actors.quality },
        { from: 'quality_pending', to: 'quality_approved', actor: actors.quality },
        { from: 'quality_approved', to: 'ready_delivery', actor: actors.delivery },
        { from: 'ready_delivery', to: 'delivered', actor: actors.delivery },
      ],
    },
    {
      caseId: ACCEPTANCE_CASE_IDS.waitingParts,
      technician: actors.technicians[1],
      steps: [
        { from: 'draft', to: 'received', actor: actors.reception },
        { from: 'received', to: 'diagnosis', actor: actors.chefAtelier },
        { from: 'diagnosis', to: 'waiting_parts', actor: actors.chefAtelier },
      ],
    },
    {
      caseId: ACCEPTANCE_CASE_IDS.qualityRework,
      technician: actors.technicians[2],
      steps: [
        { from: 'draft', to: 'received', actor: actors.reception },
        { from: 'received', to: 'diagnosis', actor: actors.chefAtelier },
        { from: 'diagnosis', to: 'repair', actor: actors.chefAtelier },
        { from: 'repair', to: 'work_completed', actor: actors.technicians[2] },
        { from: 'work_completed', to: 'quality_pending', actor: actors.quality },
        { from: 'quality_pending', to: 'quality_rejected', actor: actors.quality },
        { from: 'quality_rejected', to: 'quality_rework', actor: actors.quality },
      ],
    },
    {
      caseId: ACCEPTANCE_CASE_IDS.blockedDelivery,
      technician: actors.technicians[3],
      steps: [
        { from: 'draft', to: 'received', actor: actors.reception },
        { from: 'received', to: 'diagnosis', actor: actors.chefAtelier },
        { from: 'diagnosis', to: 'repair', actor: actors.chefAtelier },
        { from: 'repair', to: 'work_completed', actor: actors.technicians[3] },
        { from: 'work_completed', to: 'quality_pending', actor: actors.quality },
      ],
    },
    {
      caseId: ACCEPTANCE_CASE_IDS.cancelled,
      steps: [
        { from: 'draft', to: 'received', actor: actors.reception },
        { from: 'received', to: 'cancelled', actor: actors.reception },
      ],
    },
  ];

  const logs: AuditLogEntry[] = [];
  let logNumber = 1;

  const addLog = (
    caseId: string,
    actor: AcceptanceScenarioActor,
    action: string,
    minuteOffset: number,
    fromStatus?: CaseStatus,
    toStatus?: CaseStatus,
    details?: string,
  ) => {
    const hour = 8 + Math.floor(minuteOffset / 60);
    const minute = minuteOffset % 60;
    logs.push({
      id: `acceptance-log-${String(logNumber).padStart(3, '0')}`,
      caseId,
      userId: actor.id,
      userRole: actor.role,
      action,
      fromStatus,
      toStatus,
      timestamp: atTime(hour, minute),
      details,
    });
    logNumber += 1;
  };

  workflows.forEach((workflow, workflowIndex) => {
    const caseOffset = workflowIndex * 2;
    addLog(
      workflow.caseId,
      actors.reception,
      'CASE_CREATED',
      caseOffset,
      undefined,
      undefined,
      'Dossier fictif créé pour la recette métier.',
    );

    workflow.steps.forEach((step, stepIndex) => {
      const stepOffset = 5 + caseOffset + stepIndex * 20;
      addLog(
        workflow.caseId,
        step.actor,
        'STATUS_TRANSITION',
        stepOffset,
        step.from,
        step.to,
        `Transition métier ${step.from} vers ${step.to}.`,
      );

      if (step.to === 'diagnosis' && workflow.technician) {
        addLog(
          workflow.caseId,
          actors.chefAtelier,
          'TECHNICIAN_ASSIGNED',
          stepOffset + 1,
          step.to,
          step.to,
          `Affectation à ${workflow.technician.id}.`,
        );
        addLog(
          workflow.caseId,
          actors.chefAtelier,
          'WORKSHOP_PLANNED',
          stepOffset + 2,
          step.to,
          step.to,
          'Planification atelier fictive enregistrée.',
        );
      }

      if (step.to === 'repair' && workflow.technician) {
        addLog(
          workflow.caseId,
          workflow.technician,
          'TASK_STARTED',
          stepOffset + 1,
          step.to,
          step.to,
          'Tâche atelier fictive démarrée.',
        );
      }

      if (step.to === 'work_completed' && workflow.technician) {
        addLog(
          workflow.caseId,
          workflow.technician,
          'TASK_COMPLETED',
          stepOffset + 1,
          step.to,
          step.to,
          'Tâche atelier fictive terminée.',
        );
      }
    });
  });

  return logs.sort(
    (left, right) =>
      new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime(),
  );
}

export function getCaseTimeline(
  caseId: string,
  logs: readonly AuditLogEntry[],
): AuditLogEntry[] {
  return logs
    .filter((log) => log.caseId === caseId)
    .map(cloneLog)
    .sort(
      (left, right) =>
        new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime(),
    );
}

export function groupLogsByCaseId(
  logs: readonly AuditLogEntry[],
): Record<string, AuditLogEntry[]> {
  const grouped: Record<string, AuditLogEntry[]> = {};

  for (const log of logs) {
    if (!grouped[log.caseId]) grouped[log.caseId] = [];
    grouped[log.caseId].push(cloneLog(log));
  }

  for (const caseId of Object.keys(grouped)) {
    grouped[caseId].sort(
      (left, right) =>
        new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime(),
    );
  }

  return grouped;
}

export function validateTimelineOrder(
  logs: readonly AuditLogEntry[],
): SimpleValidationResult {
  const errors: string[] = [];
  const lastTimestampByCase = new Map<string, number>();

  for (const log of logs) {
    const timestamp = Date.parse(log.timestamp);
    if (!Number.isFinite(timestamp)) {
      errors.push(`Log '${log.id}' has an invalid timestamp.`);
      continue;
    }

    const previousTimestamp = lastTimestampByCase.get(log.caseId);
    if (previousTimestamp !== undefined && timestamp < previousTimestamp) {
      errors.push(`Timeline for case '${log.caseId}' is not chronological.`);
    }
    lastTimestampByCase.set(log.caseId, timestamp);
  }

  return { success: errors.length === 0, errors };
}

export function validateMultiCaseWorkflowConsistency(
  cases: readonly SavCase[],
  logs: readonly AuditLogEntry[],
): BusinessAcceptanceValidationResult {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const caseIds = new Set<string>();
  const logIds = new Set<string>();
  const casesById = new Map<string, SavCase>();

  for (const savCase of cases) {
    if (caseIds.has(savCase.id)) blockers.push(`Duplicate case id '${savCase.id}'.`);
    caseIds.add(savCase.id);
    casesById.set(savCase.id, savCase);

    if (!CASE_STATUSES.includes(savCase.status)) {
      blockers.push(`Case '${savCase.id}' uses an unofficial status.`);
    }
  }

  for (const log of logs) {
    if (logIds.has(log.id)) blockers.push(`Duplicate log id '${log.id}'.`);
    logIds.add(log.id);
    if (!casesById.has(log.caseId)) {
      blockers.push(`Log '${log.id}' references unknown case '${log.caseId}'.`);
    }
    if (!OFFICIAL_ROLES.includes(log.userRole as Role)) {
      blockers.push(`Log '${log.id}' uses an unofficial role.`);
    }
  }

  const timelineOrder = validateTimelineOrder(logs);
  blockers.push(...timelineOrder.errors);

  for (const savCase of cases) {
    const timeline = getCaseTimeline(savCase.id, logs);
    const transitions = timeline.filter(
      (log) =>
        log.fromStatus !== undefined &&
        log.toStatus !== undefined &&
        log.fromStatus !== log.toStatus,
    );
    let currentStatus: CaseStatus = 'draft';

    for (const transition of transitions) {
      const fromStatus = transition.fromStatus as CaseStatus;
      const toStatus = transition.toStatus as CaseStatus;
      if (fromStatus !== currentStatus) {
        blockers.push(
          `Case '${savCase.id}' transition chain expected '${currentStatus}' but found '${fromStatus}'.`,
        );
      }
      if (!ALLOWED_TRANSITIONS[fromStatus]?.includes(toStatus)) {
        blockers.push(
          `Case '${savCase.id}' contains invalid transition '${fromStatus}' to '${toStatus}'.`,
        );
      }
      if (
        !isRoleAllowedForTransition(
          transition.userRole as Role,
          fromStatus,
          toStatus,
        )
      ) {
        blockers.push(
          `Case '${savCase.id}' transition '${fromStatus}' to '${toStatus}' uses an unauthorized role.`,
        );
      }
      currentStatus = toStatus;
    }

    if (transitions.length > 0 && currentStatus !== savCase.status) {
      blockers.push(
        `Case '${savCase.id}' final status '${savCase.status}' does not match timeline '${currentStatus}'.`,
      );
    }

    const taskLogs = timeline.filter(
      (log) => log.action === 'TASK_STARTED' || log.action === 'TASK_COMPLETED',
    );
    for (const taskLog of taskLogs) {
      if (
        savCase.assignedTechnicianId &&
        taskLog.userId !== savCase.assignedTechnicianId
      ) {
        blockers.push(`Case '${savCase.id}' task log uses another technician.`);
      }
    }

    const deliveryTransitions = transitions.filter(
      (log) => log.toStatus === 'ready_delivery' || log.toStatus === 'delivered',
    );
    if (
      (savCase.status === 'waiting_parts' ||
        savCase.status === 'quality_rejected' ||
        savCase.status === 'quality_rework') &&
      deliveryTransitions.length > 0
    ) {
      blockers.push(`Blocked case '${savCase.id}' contains a delivery transition.`);
    }

    const deliveredIndex = transitions.findIndex(
      (log) => log.toStatus === 'delivered',
    );
    if (deliveredIndex >= 0) {
      const transitionsAfterDelivery = transitions.slice(deliveredIndex + 1);
      if (
        transitionsAfterDelivery.some(
          (log) => log.fromStatus !== 'delivered' || log.toStatus !== 'closed',
        )
      ) {
        blockers.push(`Delivered case '${savCase.id}' moves backward in its timeline.`);
      }
    }
  }

  if (cases.length === 0) warnings.push('No acceptance cases were provided.');
  if (logs.length === 0) warnings.push('No acceptance logs were provided.');

  const checks = {
    uniqueCaseIds: caseIds.size === cases.length,
    uniqueLogIds: logIds.size === logs.length,
    traceableLogs: logs.every((log) => caseIds.has(log.caseId)),
    chronologicalTimelines: timelineOrder.success,
    isolatedTechnicians: blockers.every(
      (blocker) => !blocker.includes('uses another technician'),
    ),
    deliveryGuards: blockers.every(
      (blocker) => !blocker.includes('contains a delivery transition'),
    ),
    deliveredIsForwardOnly: blockers.every(
      (blocker) => !blocker.includes('moves backward'),
    ),
  };

  return {
    success: blockers.length === 0,
    blockers,
    warnings,
    checks,
    metrics: createMetrics(cases, logs),
  };
}

export function validateBusinessAcceptanceScenario(
  cases: readonly SavCase[],
  logs: readonly AuditLogEntry[],
): BusinessAcceptanceValidationResult {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const byId = new Map(cases.map((savCase) => [savCase.id, savCase]));
  const completeCase = byId.get(ACCEPTANCE_CASE_IDS.completeDelivery);
  const waitingCase = byId.get(ACCEPTANCE_CASE_IDS.waitingParts);
  const reworkCase = byId.get(ACCEPTANCE_CASE_IDS.qualityRework);
  const blockedDeliveryCase = byId.get(ACCEPTANCE_CASE_IDS.blockedDelivery);
  const finalCase = byId.get(ACCEPTANCE_CASE_IDS.cancelled);

  if (cases.length < 5) blockers.push('At least five parallel acceptance cases are required.');
  if (!completeCase) blockers.push('Complete delivery scenario is missing.');
  if (!waitingCase) blockers.push('Waiting-parts scenario is missing.');
  if (!reworkCase) blockers.push('Quality rework scenario is missing.');
  if (!blockedDeliveryCase) blockers.push('Blocked delivery scenario is missing.');
  if (!finalCase) blockers.push('Cancelled or closed scenario is missing.');

  for (const savCase of cases) {
    if (!ACCEPTED_CLIENT_NAMES.has(savCase.clientName)) {
      blockers.push(`Case '${savCase.id}' does not use an approved fictitious client.`);
    }
    if (!savCase.vin || !savCase.immatriculation) {
      blockers.push(`Case '${savCase.id}' is missing fictitious vehicle identification.`);
    }
  }

  if (
    completeCase &&
    (completeCase.status !== 'delivered' ||
      completeCase.qcStatus !== 'approved' ||
      !isQCValidated(completeCase) ||
      !completeCase.deliveryProofReference)
  ) {
    blockers.push('Complete scenario is not delivered with approved QC and proof.');
  }

  if (waitingCase?.status !== 'waiting_parts') {
    blockers.push('Waiting-parts scenario does not remain blocked.');
  }

  if (
    reworkCase?.status !== 'quality_rework' ||
    !reworkCase.qcRejectionReason ||
    !reworkCase.qcReworkReason
  ) {
    blockers.push('Quality rejection scenario does not contain a documented rework.');
  }

  if (
    blockedDeliveryCase &&
    (blockedDeliveryCase.status === 'ready_delivery' ||
      blockedDeliveryCase.status === 'delivered' ||
      isQCValidated(blockedDeliveryCase))
  ) {
    blockers.push('Blocked delivery scenario is incorrectly eligible for delivery.');
  }

  if (finalCase && finalCase.status !== 'cancelled' && finalCase.status !== 'closed') {
    blockers.push('Final scenario must be cancelled or closed.');
  }

  if (
    !transitionExists(
      logs,
      ACCEPTANCE_CASE_IDS.completeDelivery,
      'quality_approved',
      'ready_delivery',
    ) ||
    !transitionExists(
      logs,
      ACCEPTANCE_CASE_IDS.completeDelivery,
      'ready_delivery',
      'delivered',
    )
  ) {
    blockers.push('Complete scenario delivery transitions are missing.');
  }

  if (
    !transitionExists(
      logs,
      ACCEPTANCE_CASE_IDS.qualityRework,
      'quality_pending',
      'quality_rejected',
    ) ||
    !transitionExists(
      logs,
      ACCEPTANCE_CASE_IDS.qualityRework,
      'quality_rejected',
      'quality_rework',
    )
  ) {
    blockers.push('Quality rejection and workshop rework transitions are missing.');
  }

  const consultationMutationLogs = logs.filter((log) =>
    CONSULTATION_ROLES.includes(log.userRole as Role),
  );
  if (consultationMutationLogs.length > 0) {
    blockers.push('Consultation roles generated workflow mutation logs.');
  }

  const consistency = validateMultiCaseWorkflowConsistency(cases, logs);
  blockers.push(...consistency.blockers);
  warnings.push(...consistency.warnings);

  const checks = {
    completeDelivery: completeCase?.status === 'delivered',
    waitingPartsBlocked: waitingCase?.status === 'waiting_parts',
    qualityReworkDocumented: reworkCase?.status === 'quality_rework',
    prematureDeliveryBlocked:
      blockedDeliveryCase !== undefined &&
      blockedDeliveryCase.status === 'quality_pending' &&
      !isQCValidated(blockedDeliveryCase),
    finalCaseSupported:
      finalCase?.status === 'cancelled' || finalCase?.status === 'closed',
    consultationIsPassive: consultationMutationLogs.length === 0,
    multiCaseConsistency: consistency.success,
  };

  return {
    success: blockers.length === 0,
    blockers,
    warnings,
    checks,
    metrics: createMetrics(cases, logs),
  };
}

function normalizeForComparison(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeForComparison(item));
  }
  if (value !== null && typeof value === 'object') {
    const normalized: Record<string, unknown> = {};
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([left], [right]) => left.localeCompare(right),
    );
    for (const [key, item] of entries) {
      normalized[key] = normalizeForComparison(item);
    }
    return normalized;
  }
  return value;
}

export function validateNoConsultationMutation(
  before: unknown,
  after: unknown,
): SimpleValidationResult {
  const beforeSnapshot = JSON.stringify(normalizeForComparison(before));
  const afterSnapshot = JSON.stringify(normalizeForComparison(after));
  const success = beforeSnapshot === afterSnapshot;

  return {
    success,
    errors: success ? [] : ['Consultation changed the supplied business data snapshot.'],
  };
}

export function summarizeBusinessAcceptanceReadiness(
  result: Pick<BusinessAcceptanceValidationResult, 'success' | 'blockers' | 'metrics'>,
): string {
  if (!result.success) {
    return `alpha.12 présente ${result.blockers.length} bloqueur(s) de recette métier interne.`;
  }

  return `alpha.12 prête pour recette métier interne : ${result.metrics.totalCases} dossiers simulés, ${result.metrics.totalLogs} événements traçables, non RC et non destinée à la production.`;
}
