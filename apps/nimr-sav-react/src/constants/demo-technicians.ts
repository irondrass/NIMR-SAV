export interface DemoTechnician {
  id: string;
  name: string;
}

export const DEMO_TECHNICIANS: readonly DemoTechnician[] = [
  { id: 'TECH-DEMO-001', name: 'Technicien Démo A' },
  { id: 'TECH-DEMO-002', name: 'Technicien Démo B' },
  { id: 'TECH-DEMO-003', name: 'Technicien Démo C' },
] as const;
