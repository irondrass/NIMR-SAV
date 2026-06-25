import { SavCase } from './sav-case';
import { CaseStatus, CASE_STATUSES } from './case-status';
import { AuditLogEntry } from './audit-log';
import { DEMO_TECHNICIANS } from '../constants/demo-technicians';

const getAgeHours = (dateStr: string | undefined, now: Date): number => {
  if (!dateStr) return 0;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return 0;
  return Math.max(0, (now.getTime() - d.getTime()) / (1000 * 60 * 60));
};

export function countCasesByStatus(cases: SavCase[]): Record<CaseStatus, number> {
  const counts = {} as Record<CaseStatus, number>;
  for (const status of CASE_STATUSES) {
    counts[status] = 0;
  }
  for (const c of cases) {
    if (counts[c.status] !== undefined) {
      counts[c.status]++;
    }
  }
  return counts;
}

export function calculateWorkshopQueue(cases: SavCase[]): SavCase[] {
  const workshopStatuses = ['diagnosis', 'repair', 'waiting_parts', 'work_completed', 'quality_rework'];
  return cases.filter((c) => workshopStatuses.includes(c.status));
}

export function calculateQualityQueue(cases: SavCase[]): SavCase[] {
  const qualityStatuses = ['work_completed', 'quality_pending', 'quality_rejected', 'quality_rework'];
  return cases.filter((c) => qualityStatuses.includes(c.status));
}

export function calculateDeliveryQueue(cases: SavCase[]): SavCase[] {
  const deliveryStatuses = ['quality_approved', 'ready_delivery', 'delivered'];
  return cases.filter((c) => deliveryStatuses.includes(c.status));
}

export interface TechLoad {
  technicianId: string;
  technicianName: string;
  activeCasesCount: number;
}

export function calculateTechnicianLoad(cases: SavCase[]): TechLoad[] {
  const loadMap: Record<string, { name: string; count: number }> = {};

  // Initialize with known demo technicians
  for (const tech of DEMO_TECHNICIANS) {
    loadMap[tech.id] = { name: tech.name, count: 0 };
  }

  // Count active/open cases per technician
  for (const c of cases) {
    if (
      c.assignedTechnicianId &&
      c.status !== 'closed' &&
      c.status !== 'cancelled' &&
      c.status !== 'delivered'
    ) {
      if (!loadMap[c.assignedTechnicianId]) {
        loadMap[c.assignedTechnicianId] = {
          name: c.assignedTechnicianName || `Technicien ${c.assignedTechnicianId}`,
          count: 0,
        };
      }
      loadMap[c.assignedTechnicianId].count++;
    }
  }

  return Object.entries(loadMap).map(([id, data]) => ({
    technicianId: id,
    technicianName: data.name,
    activeCasesCount: data.count,
  }));
}

export interface BlockingAlert {
  caseId: string;
  immatriculation: string;
  vin: string;
  status: CaseStatus;
  type: 'waiting_parts_old' | 'quality_rejected' | 'quality_rework' | 'open_old';
  description: string;
  ageHours: number;
}

export function calculateBlockingAlerts(cases: SavCase[], now = new Date()): BlockingAlert[] {
  const alerts: BlockingAlert[] = [];

  for (const c of cases) {
    const age = getAgeHours(c.receptionDate || c.createdAt, now);
    const isOpen = c.status !== 'closed' && c.status !== 'cancelled' && c.status !== 'delivered';

    if (!isOpen) continue;

    if (c.status === 'waiting_parts' && age > 72) {
      alerts.push({
        caseId: c.id,
        immatriculation: c.immatriculation,
        vin: c.vin,
        status: c.status,
        type: 'waiting_parts_old',
        description: `En attente de pièces depuis ${Math.round(age)}h (seuil 72h dépassé).`,
        ageHours: age,
      });
    } else if (c.status === 'quality_rejected') {
      alerts.push({
        caseId: c.id,
        immatriculation: c.immatriculation,
        vin: c.vin,
        status: c.status,
        type: 'quality_rejected',
        description: `Contrôle qualité rejeté : ${c.qcRejectionReason || 'pas de motif renseigné'}.`,
        ageHours: age,
      });
    } else if (c.status === 'quality_rework') {
      alerts.push({
        caseId: c.id,
        immatriculation: c.immatriculation,
        vin: c.vin,
        status: c.status,
        type: 'quality_rework',
        description: `Dossier en reprise atelier (QC non conforme).`,
        ageHours: age,
      });
    } else if (age > 72) {
      alerts.push({
        caseId: c.id,
        immatriculation: c.immatriculation,
        vin: c.vin,
        status: c.status,
        type: 'open_old',
        description: `Dossier ouvert depuis ${Math.round(age)}h.`,
        ageHours: age,
      });
    }
  }

  return alerts.sort((a, b) => b.ageHours - a.ageHours);
}

export interface AgingBuckets {
  lessThan24h: number;
  between24hAnd48h: number;
  between48hAnd72h: number;
  moreThan72h: number;
}

export function calculateAgingBuckets(cases: SavCase[], now = new Date()): AgingBuckets {
  let lessThan24h = 0;
  let between24hAnd48h = 0;
  let between48hAnd72h = 0;
  let moreThan72h = 0;

  for (const c of cases) {
    if (c.status === 'closed' || c.status === 'cancelled' || c.status === 'delivered') {
      continue;
    }
    const age = getAgeHours(c.receptionDate || c.createdAt, now);
    if (age <= 24) {
      lessThan24h++;
    } else if (age <= 48) {
      between24hAnd48h++;
    } else if (age <= 72) {
      between48hAnd72h++;
    } else {
      moreThan72h++;
    }
  }

  return {
    lessThan24h,
    between24hAnd48h,
    between48hAnd72h,
    moreThan72h,
  };
}

export function calculateDailyReceptionStats(cases: SavCase[], now = new Date()) {
  const todayStr = now.toISOString().split('T')[0];
  const receivedToday = cases.filter((c) => {
    if (!c.receptionDate) return false;
    return c.receptionDate.startsWith(todayStr);
  }).length;
  return {
    receivedToday,
    date: todayStr,
  };
}

export function calculateOperationalHealth(cases: SavCase[], logs: AuditLogEntry[], now = new Date()) {
  void logs; // Reference parameter to avoid TS6133
  const openCases = cases.filter(
    (c) => c.status !== 'closed' && c.status !== 'cancelled' && c.status !== 'delivered'
  );
  if (openCases.length === 0) {
    return {
      healthScore: 100,
      status: 'excellent' as const,
      description: 'Tous les dossiers SAV actifs sont traités et finalisés.',
    };
  }

  const workshopLateCount = openCases.filter(
    (c) =>
      ['diagnosis', 'repair', 'waiting_parts', 'work_completed'].includes(c.status) &&
      getAgeHours(c.receptionDate || c.createdAt, now) > 48
  ).length;

  const qcLateCount = openCases.filter(
    (c) =>
      ['quality_pending', 'work_completed'].includes(c.status) &&
      getAgeHours(c.receptionDate || c.createdAt, now) > 24
  ).length;

  const deliveryLateCount = openCases.filter(
    (c) =>
      ['quality_approved', 'ready_delivery'].includes(c.status) &&
      getAgeHours(c.receptionDate || c.createdAt, now) > 24
  ).length;

  const criticalBlocksCount = calculateBlockingAlerts(cases, now).length;

  // Point-based penalty system
  const penalty =
    workshopLateCount * 10 + qcLateCount * 15 + deliveryLateCount * 10 + criticalBlocksCount * 20;
  const healthScore = Math.max(0, 100 - penalty);

  let status: 'excellent' | 'moyen' | 'critique' = 'excellent';
  if (healthScore < 50) status = 'critique';
  else if (healthScore < 80) status = 'moyen';

  return {
    healthScore: Math.round(healthScore),
    status,
    description: `Score de santé opérationnel : ${Math.round(healthScore)}%. ${criticalBlocksCount} blocage(s) critique(s), ${
      workshopLateCount + qcLateCount + deliveryLateCount
    } dossier(s) en retard.`,
  };
}

export interface DirectorDashboardData {
  totalDossiers: number;
  dossiersOuverts: number;
  dossiersClotures: number;
  dossiersAnnules: number;
  receptionEnCours: number;
  diagnosticEnCours: number;
  attentePieces: number;
  reparationEnCours: number;
  travauxTermines: number;
  attenteQC: number;
  qcApprouves: number;
  qcRejetes: number;
  repriseAtelier: number;
  pretsLivraison: number;
  livres: number;
  retardAtelier: number;
  retardQC: number;
  retardLivraison: number;
  blocagesCritiques: number;
  tauxQCRejet: number;
  tauxLivraison: number;
  chargeTechniciens: TechLoad[];
  alerts: BlockingAlert[];
  aging: AgingBuckets;
  dailyReception: { receivedToday: number; date: string };
  health: { healthScore: number; status: 'excellent' | 'moyen' | 'critique'; description: string };
}

export function calculateDirectorDashboard(
  cases: SavCase[],
  logs: AuditLogEntry[],
  now = new Date()
): DirectorDashboardData {
  const counts = countCasesByStatus(cases);

  const totalDossiers = cases.length;
  const dossiersOuverts = cases.filter(
    (c) => c.status !== 'closed' && c.status !== 'cancelled' && c.status !== 'delivered'
  ).length;
  const dossiersClotures = counts.closed;
  const dossiersAnnules = counts.cancelled;

  const receptionEnCours = counts.received + counts.draft;
  const diagnosticEnCours = counts.diagnosis;
  const attentePieces = counts.waiting_parts;
  const reparationEnCours = counts.repair;
  const travauxTermines = counts.work_completed;
  const attenteQC = counts.quality_pending;
  const qcApprouves = counts.quality_approved;
  const qcRejetes = counts.quality_rejected;
  const repriseAtelier = counts.quality_rework;
  const pretsLivraison = counts.ready_delivery;
  const livres = counts.delivered;

  // Retards
  const retardAtelier = cases.filter(
    (c) =>
      ['diagnosis', 'repair', 'waiting_parts', 'work_completed'].includes(c.status) &&
      getAgeHours(c.receptionDate || c.createdAt, now) > 48
  ).length;

  const retardQC = cases.filter(
    (c) =>
      ['quality_pending', 'work_completed'].includes(c.status) &&
      getAgeHours(c.receptionDate || c.createdAt, now) > 24
  ).length;

  const retardLivraison = cases.filter(
    (c) =>
      ['quality_approved', 'ready_delivery'].includes(c.status) &&
      getAgeHours(c.receptionDate || c.createdAt, now) > 24
  ).length;

  const alerts = calculateBlockingAlerts(cases, now);
  const blocagesCritiques = alerts.length;

  // Taux
  const passedQC = cases.filter((c) =>
    [
      'quality_approved',
      'ready_delivery',
      'delivered',
      'closed',
      'quality_rejected',
      'quality_rework',
    ].includes(c.status)
  ).length;
  const tauxQCRejet = passedQC > 0 ? (qcRejetes / passedQC) * 100 : 0;

  const eligibleDelivery = cases.filter((c) =>
    ['quality_approved', 'ready_delivery', 'delivered', 'closed'].includes(c.status)
  ).length;
  const tauxLivraison = eligibleDelivery > 0 ? (livres / eligibleDelivery) * 100 : 0;

  const chargeTechniciens = calculateTechnicianLoad(cases);
  const aging = calculateAgingBuckets(cases, now);
  const dailyReception = calculateDailyReceptionStats(cases, now);
  const health = calculateOperationalHealth(cases, logs, now);

  return {
    totalDossiers,
    dossiersOuverts,
    dossiersClotures,
    dossiersAnnules,
    receptionEnCours,
    diagnosticEnCours,
    attentePieces,
    reparationEnCours,
    travauxTermines,
    attenteQC,
    qcApprouves,
    qcRejetes,
    repriseAtelier,
    pretsLivraison,
    livres,
    retardAtelier,
    retardQC,
    retardLivraison,
    blocagesCritiques,
    tauxQCRejet,
    tauxLivraison,
    chargeTechniciens,
    alerts,
    aging,
    dailyReception,
    health,
  };
}
