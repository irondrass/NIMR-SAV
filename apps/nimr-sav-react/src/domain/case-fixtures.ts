import { SavCase } from './sav-case';

export const DEMO_CASES: SavCase[] = [
  {
    id: 'case-demo-1',
    immatriculation: 'DEMO-001',
    vin: 'VIN-DEMO-0000000001',
    clientName: 'Client Démo A',
    telephone: '00000000',
    status: 'draft',
    receptionDate: '2026-06-24T12:00:00Z',
    createdAt: '2026-06-24T12:00:00Z',
    updatedAt: '2026-06-24T12:00:00Z',
  },
  {
    id: 'case-demo-2',
    immatriculation: 'DEMO-002',
    vin: 'VIN-DEMO-0000000002',
    clientName: 'Client Démo B',
    telephone: '00000000',
    status: 'quality_pending',
    receptionDate: '2026-06-23T08:30:00Z',
    qcChecklist: {
      items: [
        { id: 'qc-1', label: 'Contrôle Freinage', checked: false, required: true },
        { id: 'qc-2', label: 'Phares et Feux', checked: true, required: true },
      ],
    },
    createdAt: '2026-06-23T08:30:00Z',
    updatedAt: '2026-06-23T10:00:00Z',
  },
  {
    id: 'case-demo-3',
    immatriculation: 'DEMO-003',
    vin: 'VIN-DEMO-0000000003',
    clientName: 'Client Démo C',
    telephone: '00000000',
    status: 'ready_delivery',
    receptionDate: '2026-06-22T09:15:00Z',
    qcChecklist: {
      items: [
        { id: 'qc-1', label: 'Contrôle Freinage', checked: true, required: true },
        { id: 'qc-2', label: 'Phares et Feux', checked: true, required: true },
      ],
      validatedBy: 'qualite-user-123',
      validatedAt: '2026-06-22T15:30:00Z',
    },
    createdAt: '2026-06-22T09:15:00Z',
    updatedAt: '2026-06-22T15:30:00Z',
  },
];
