import React, { useState, useMemo } from 'react';
import type { User } from '@/types';
import { useSavCases } from '@/state/useSavCases';
import { APP_VERSION } from '@/constants/version';
import { getBlockingClaimsReasons } from '@/domain/claims';
import { StatusBadge } from '@/components/StatusBadge';
import { PriorityBadge } from '@/components/PriorityBadge';
import { EmptyState } from '@/components/EmptyState';
import { VersionBanner } from '@/components/VersionBanner';
import { getRoleFieldGuidance } from '@/domain/ui-field-guidelines';
import { Button } from '@/components/ui/Button';
import { hasPermission } from '@/domain/action-permissions';
import { buildCompleteCaseBundle, downloadExportBundle } from '@/domain/export-bundle';
import { useConnectivity } from '@/state/useConnectivity';
import { getLocalSnapshotMetadata } from '@/state/local-cache-adapter';

interface DashboardViewProps {
  user: User;
  activeTab?: string;
}

export const DashboardView: React.FC<DashboardViewProps> = ({ user, activeTab = 'pilotage' }) => {
  const { cases, logs, getDirectorDashboard, pendingActions } = useSavCases();
  const { isOnline } = useConnectivity();
  const cacheMeta = getLocalSnapshotMetadata();

  // Selected case for the read-only details view under "dossiers" tab
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // Compute all metrics using the pure getDirectorDashboard method from our store
  const dashboardData = useMemo(() => {
    void cases; // Reference to ensure re-computation on change
    void logs;
    return getDirectorDashboard();
  }, [cases, logs, getDirectorDashboard]);

  const claimsMetrics = useMemo(() => {
    let dossiersBloques = 0;
    let attenteExpert = 0;
    let attenteClient = 0;

    cases.forEach((c) => {
      const claims = c.claims || [];
      const blockingReasons = getBlockingClaimsReasons(claims, c.claimsOverridden);
      if (blockingReasons.length > 0) {
        dossiersBloques++;
      }
      claims.forEach((claim) => {
        if (claim.status === 'expert_pending') {
          attenteExpert++;
        }
        if (claim.status === 'client_pending') {
          attenteClient++;
        }
      });
    });

    return { dossiersBloques, attenteExpert, attenteClient };
  }, [cases]);

  const estimatesMetrics = useMemo(() => {
    let nbDevisImportes = 0;
    let heuresMOEstimeesTotale = 0;
    const chargeParPole: Record<string, number> = {
      tolerie: 0,
      peinture: 0,
      preparation: 0,
      remontage: 0,
      finition: 0,
      mecanique: 0,
      controle_qualite: 0,
      autre: 0,
    };
    let dossiersAvecDevisMaisAccordManquant = 0;
    let dossiersSansDevis = 0;

    cases.forEach((c) => {
      let hasEstimate = false;
      const claims = c.claims || [];
      claims.forEach((claim) => {
        if (claim.estimate) {
          hasEstimate = true;
          nbDevisImportes++;
          const summary = claim.estimate.laborSummary || {};
          Object.entries(summary).forEach(([pole, hours]) => {
            const h = Number(hours) || 0;
            chargeParPole[pole] = (chargeParPole[pole] || 0) + h;
            heuresMOEstimeesTotale += h;
          });
        }
      });

      if (hasEstimate) {
        const blockingReasons = getBlockingClaimsReasons(claims, c.claimsOverridden);
        if (blockingReasons.length > 0) {
          dossiersAvecDevisMaisAccordManquant++;
        }
      } else {
        dossiersSansDevis++;
      }
    });

    return {
      nbDevisImportes,
      heuresMOEstimeesTotale: Number(heuresMOEstimeesTotale.toFixed(2)),
      chargeParPole,
      dossiersAvecDevisMaisAccordManquant,
      dossiersSansDevis,
    };
  }, [cases]);

  // Handle case details selection
  const selectedCase = useMemo(() => {
    if (!selectedCaseId) return null;
    return cases.find((c) => c.id === selectedCaseId) || null;
  }, [cases, selectedCaseId]);

  // Filtering for the case browser
  const filteredCases = useMemo(() => {
    return cases.filter((c) => {
      const matchesSearch =
        c.immatriculation.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.vin.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.clientName.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesStatus = statusFilter === 'all' || c.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [cases, searchQuery, statusFilter]);

  if (cases.length === 0) {
    return (
      <div
        className="view-container"
        id="dashboard-view"
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '3rem',
          color: '#fff',
          minHeight: '80vh',
          background: '#121214',
          fontFamily: 'Inter, sans-serif',
        }}
      >
        <span style={{ fontSize: '3rem', marginBottom: '1rem' }}>📊</span>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 600, color: '#fff', marginBottom: '0.5rem' }}>
          Tableau de Bord Directeur SAV
        </h2>
        <p style={{ color: '#a1a1aa', fontSize: '1rem', marginBottom: '1.5rem' }}>
          {getRoleFieldGuidance('directeur-sav')}
        </p>
        <p style={{ color: '#f87171', fontSize: '0.9rem', marginBottom: '1.5rem', fontWeight: 'bold' }}>
          Mode Consultation uniquement — Aucune action d’écriture autorisée.
        </p>
        <EmptyState role="directeur-sav" />
        <div style={{ fontSize: '0.75rem', color: '#71717a' }}>
          Indicateur: data/vehicles.json non utilisé (migration v24 active) — Version {APP_VERSION}
        </div>
      </div>
    );
  }

  // Render different sub-tab contents
  return (
    <div
      className="view-container"
      id="dashboard-view"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '1.5rem',
        padding: '1.5rem',
        color: '#fff',
        minHeight: '100vh',
        background: '#121214',
        fontFamily: 'Inter, sans-serif',
      }}
    >
      <VersionBanner />
      {/* View Header */}
      <header
        className="view-header"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          paddingBottom: '1rem',
          flexWrap: 'wrap',
          gap: '1rem',
        }}
      >
        <div>
          <h1 className="view-title" style={{ margin: 0, fontSize: '1.75rem', fontWeight: 700 }}>
            Tableau de Bord Directeur SAV
          </h1>
          <p
            className="view-subtitle"
            style={{ margin: '0.25rem 0 0 0', color: '#a1a1aa', fontSize: '0.9rem' }}
          >
            {getRoleFieldGuidance('directeur-sav')}
          </p>
          <p
            className="view-subtitle"
            style={{ margin: '0.25rem 0 0 0', color: '#a1a1aa', fontSize: '0.9rem' }}
          >
            Directeur : <strong style={{ color: '#fff' }}>{user.name}</strong>
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          {/* Health Score Pill */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-end',
              background: 'rgba(255,255,255,0.02)',
              border: '1px solid rgba(255,255,255,0.08)',
              padding: '0.5rem 1rem',
              borderRadius: '8px',
            }}
          >
            <span style={{ fontSize: '0.75rem', color: '#a1a1aa' }}>Santé Opérationnelle</span>
            <span
              style={{
                fontSize: '1.1rem',
                fontWeight: 700,
                color:
                  dashboardData.health.status === 'excellent'
                    ? '#10b981'
                    : dashboardData.health.status === 'moyen'
                    ? '#f59e0b'
                    : '#ef4444',
              }}
            >
              {dashboardData.health.healthScore}% ({dashboardData.health.status.toUpperCase()})
            </span>
          </div>

          <span
            style={{
              fontSize: '0.8rem',
              color: '#3b82f6',
              fontWeight: 600,
              background: 'rgba(59,130,246,0.1)',
              padding: '0.25rem 0.75rem',
              borderRadius: '9999px',
              border: '1px solid rgba(59,130,246,0.2)',
            }}
          >
            {APP_VERSION}
          </span>

          {hasPermission(user.role, 'export_complete_case') && (
            <Button
              variant="ghost"
              style={{ background: '#2563eb', color: '#fff', fontSize: '0.82rem' }}
              onClick={() => {
                const bundle = buildCompleteCaseBundle(cases[0], user.name);
                downloadExportBundle(bundle);
              }}
            >
              📦 Exporter Dossier
            </Button>
          )}
        </div>
      </header>

      {/* Read-Only Notice */}
      <div
        style={{
          background: 'rgba(59, 130, 246, 0.08)',
          border: '1px solid rgba(59, 130, 246, 0.2)',
          borderRadius: '8px',
          padding: '0.75rem 1.25rem',
          color: '#3b82f6',
          fontSize: '0.9rem',
          fontWeight: 500,
        }}
      >
        ℹ️ Mode Consultation & Pilotage — Aucune action d’écriture ou de modification autorisée.
      </div>

      {/* KPI Cards */}
      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '1rem',
        }}
      >
        <div
          style={{
            background: '#1e1e24',
            border: '1px solid rgba(255,255,255,0.05)',
            padding: '1.25rem',
            borderRadius: '8px',
          }}
        >
          <div style={{ fontSize: '0.85rem', color: '#a1a1aa', fontWeight: 500 }}>
            Total Dossiers SAV
          </div>
          <div style={{ fontSize: '2rem', fontWeight: 700, marginTop: '0.25rem' }}>
            {dashboardData.totalDossiers}
          </div>
        </div>

        <div
          style={{
            background: '#1e1e24',
            border: '1px solid rgba(255,255,255,0.05)',
            padding: '1.25rem',
            borderRadius: '8px',
          }}
        >
          <div style={{ fontSize: '0.85rem', color: '#a1a1aa', fontWeight: 500 }}>
            Dossiers Actifs / Ouverts
          </div>
          <div style={{ fontSize: '2rem', fontWeight: 700, color: '#3b82f6', marginTop: '0.25rem' }}>
            {dashboardData.dossiersOuverts}
          </div>
        </div>

        <div
          style={{
            background: '#1e1e24',
            border: '1px solid rgba(255,255,255,0.05)',
            padding: '1.25rem',
            borderRadius: '8px',
          }}
        >
          <div style={{ fontSize: '0.85rem', color: '#a1a1aa', fontWeight: 500 }}>
            Alertes / Blocages Critiques
          </div>
          <div
            style={{
              fontSize: '2rem',
              fontWeight: 700,
              color: dashboardData.blocagesCritiques > 0 ? '#ef4444' : '#10b981',
              marginTop: '0.25rem',
            }}
          >
            {dashboardData.blocagesCritiques}
          </div>
        </div>

        <div
          style={{
            background: '#1e1e24',
            border: '1px solid rgba(255,255,255,0.05)',
            padding: '1.25rem',
            borderRadius: '8px',
          }}
        >
          <div style={{ fontSize: '0.85rem', color: '#a1a1aa', fontWeight: 500 }}>
            Dossiers Clôturés / Livrés
          </div>
          <div style={{ fontSize: '2rem', fontWeight: 700, color: '#10b981', marginTop: '0.25rem' }}>
            {dashboardData.dossiersClotures + dashboardData.livres}
          </div>
        </div>
        <div
          style={{
            background: '#1e1e24',
            border: '1px solid rgba(255,255,255,0.05)',
            padding: '1.25rem',
            borderRadius: '8px',
          }}
        >
          <div style={{ fontSize: '0.85rem', color: '#a1a1aa', fontWeight: 500 }}>
            Dossiers bloqués par accord
          </div>
          <div style={{ fontSize: '2rem', fontWeight: 700, color: '#ef4444', marginTop: '0.25rem' }}>
            {claimsMetrics.dossiersBloques}
          </div>
        </div>

        <div
          style={{
            background: '#1e1e24',
            border: '1px solid rgba(255,255,255,0.05)',
            padding: '1.25rem',
            borderRadius: '8px',
          }}
        >
          <div style={{ fontSize: '0.85rem', color: '#a1a1aa', fontWeight: 500 }}>
            Claims en attente Expert
          </div>
          <div style={{ fontSize: '2rem', fontWeight: 700, color: '#f59e0b', marginTop: '0.25rem' }}>
            {claimsMetrics.attenteExpert}
          </div>
        </div>

        <div
          style={{
            background: '#1e1e24',
            border: '1px solid rgba(255,255,255,0.05)',
            padding: '1.25rem',
            borderRadius: '8px',
          }}
        >
          <div style={{ fontSize: '0.85rem', color: '#a1a1aa', fontWeight: 500 }}>
            Claims en attente Client
          </div>
          <div style={{ fontSize: '2rem', fontWeight: 700, color: '#3b82f6', marginTop: '0.25rem' }}>
            {claimsMetrics.attenteClient}
          </div>
        </div>

        <div
          style={{
            background: '#1e1e24',
            border: '1px solid rgba(255,255,255,0.05)',
            padding: '1.25rem',
            borderRadius: '8px',
          }}
        >
          <div style={{ fontSize: '0.85rem', color: '#a1a1aa', fontWeight: 500 }}>
            État Connexion
          </div>
          <div style={{ fontSize: '2rem', fontWeight: 700, color: isOnline ? '#10b981' : '#ef4444', marginTop: '0.25rem' }}>
            {isOnline ? 'En ligne' : 'Hors ligne'}
          </div>
        </div>

        <div
          style={{
            background: '#1e1e24',
            border: '1px solid rgba(255,255,255,0.05)',
            padding: '1.25rem',
            borderRadius: '8px',
          }}
        >
          <div style={{ fontSize: '0.85rem', color: '#a1a1aa', fontWeight: 500 }}>
            Actions en attente
          </div>
          <div style={{ fontSize: '2rem', fontWeight: 700, color: pendingActions.length > 0 ? '#f59e0b' : '#a1a1aa', marginTop: '0.25rem' }}>
            {pendingActions.length}
          </div>
        </div>

        <div
          style={{
            background: '#1e1e24',
            border: '1px solid rgba(255,255,255,0.05)',
            padding: '1.25rem',
            borderRadius: '8px',
          }}
        >
          <div style={{ fontSize: '0.85rem', color: '#a1a1aa', fontWeight: 500 }}>
            Cache Local (Snapshot)
          </div>
          <div style={{ fontSize: '1.1rem', fontWeight: 600, color: cacheMeta ? '#a7f3d0' : '#71717a', marginTop: '0.65rem' }}>
            {cacheMeta ? `Disponible (${cacheMeta.casesCount} dossiers)` : 'Non disponible'}
          </div>
        </div>
      </section>

      {/* Estimate & Labor Load KPI Section */}
      <section
        style={{
          marginTop: '1.5rem',
          background: '#1e1e24',
          border: '1px solid rgba(255,255,255,0.05)',
          padding: '1.5rem',
          borderRadius: '8px',
        }}
      >
        <h3 style={{ margin: '0 0 1rem 0', fontSize: '1rem', fontWeight: 600, color: '#3b82f6', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span>📋</span> Analyse des Devis & Charge Atelier
        </h3>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: '1rem',
            marginBottom: '1rem',
          }}
        >
          <div style={{ background: 'rgba(255,255,255,0.02)', padding: '1rem', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.03)' }}>
            <div style={{ fontSize: '0.75rem', color: '#a1a1aa', fontWeight: 500 }}>Devis Importés</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, marginTop: '0.25rem', color: '#fff' }}>
              {estimatesMetrics.nbDevisImportes}
            </div>
          </div>
          <div style={{ background: 'rgba(255,255,255,0.02)', padding: '1rem', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.03)' }}>
            <div style={{ fontSize: '0.75rem', color: '#a1a1aa', fontWeight: 500 }}>Total Heures MO</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, marginTop: '0.25rem', color: '#34d399' }}>
              {estimatesMetrics.heuresMOEstimeesTotale}h
            </div>
          </div>
          <div style={{ background: 'rgba(255,255,255,0.02)', padding: '1rem', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.03)' }}>
            <div style={{ fontSize: '0.75rem', color: '#a1a1aa', fontWeight: 500 }}>Devis bloqués par accord</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, marginTop: '0.25rem', color: '#ef4444' }}>
              {estimatesMetrics.dossiersAvecDevisMaisAccordManquant}
            </div>
          </div>
          <div style={{ background: 'rgba(255,255,255,0.02)', padding: '1rem', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.03)' }}>
            <div style={{ fontSize: '0.75rem', color: '#a1a1aa', fontWeight: 500 }}>Dossiers sans Devis</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, marginTop: '0.25rem', color: '#a1a1aa' }}>
              {estimatesMetrics.dossiersSansDevis}
            </div>
          </div>
        </div>

        {/* Charge by pole */}
        <div style={{ marginTop: '1rem', padding: '0.75rem', background: 'rgba(255,255,255,0.01)', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.03)' }}>
          <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#aaa', marginBottom: '0.5rem' }}>Charge estimée par pôle atelier :</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '0.5rem' }}>
            {Object.entries(estimatesMetrics.chargeParPole).map(([pole, hours]) => (
              <div key={pole} style={{ fontSize: '0.75rem', color: '#ccc', padding: '0.25rem 0.5rem', background: 'rgba(255,255,255,0.02)', borderRadius: '4px', display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ textTransform: 'capitalize' }}>{pole.replace('_', ' ')}</span>
                <strong style={{ color: hours > 0 ? '#3b82f6' : '#888' }}>{hours}h</strong>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Main Tab Content */}
      {activeTab === 'pilotage' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', flex: 1 }}>
          {/* Left Panel: Status Pipeline & Technician Load */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            {/* Status Pipeline */}
            <div
              style={{
                background: '#1e1e24',
                borderRadius: '8px',
                padding: '1.5rem',
                border: '1px solid rgba(255,255,255,0.05)',
              }}
            >
              <h2
                style={{
                  fontSize: '1.1rem',
                  fontWeight: 600,
                  marginBottom: '1rem',
                  borderBottom: '1px solid rgba(255,255,255,0.05)',
                  paddingBottom: '0.5rem',
                }}
              >
                Pipeline des Dossiers par Statut
              </h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {[
                  { label: 'Réception / Brouillon', count: dashboardData.receptionEnCours },
                  { label: 'Diagnostic Atelier', count: dashboardData.diagnosticEnCours },
                  { label: 'Attente de Pièces', count: dashboardData.attentePieces },
                  { label: 'Réparation en cours', count: dashboardData.reparationEnCours },
                  { label: 'Travaux terminés', count: dashboardData.travauxTermines },
                  { label: 'Attente QC / Contrôle', count: dashboardData.attenteQC },
                  { label: 'QC Approuvés', count: dashboardData.qcApprouves },
                  { label: 'QC Rejetés / Reprise', count: dashboardData.qcRejetes + dashboardData.repriseAtelier },
                  { label: 'Prêts pour livraison', count: dashboardData.pretsLivraison },
                  { label: 'Livrés au client', count: dashboardData.livres },
                ].map((item, idx) => {
                  const maxCount = Math.max(...cases.map(() => 1), cases.length);
                  const pct = (item.count / maxCount) * 100;
                  return (
                    <div key={idx}>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          fontSize: '0.85rem',
                          color: '#a1a1aa',
                          marginBottom: '0.25rem',
                        }}
                      >
                        <span>{item.label}</span>
                        <span style={{ fontWeight: 'bold', color: '#fff' }}>{item.count}</span>
                      </div>
                      <div
                        style={{
                          width: '100%',
                          height: '6px',
                          background: 'rgba(255,255,255,0.03)',
                          borderRadius: '3px',
                          overflow: 'hidden',
                        }}
                      >
                        <div
                          style={{
                            width: `${pct}%`,
                            height: '100%',
                            background: '#3b82f6',
                            borderRadius: '3px',
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Technician Load */}
            <div
              style={{
                background: '#1e1e24',
                borderRadius: '8px',
                padding: '1.5rem',
                border: '1px solid rgba(255,255,255,0.05)',
              }}
            >
              <h2
                style={{
                  fontSize: '1.1rem',
                  fontWeight: 600,
                  marginBottom: '1rem',
                  borderBottom: '1px solid rgba(255,255,255,0.05)',
                  paddingBottom: '0.5rem',
                }}
              >
                Charge Actuelle par Technicien (Atelier)
              </h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {dashboardData.chargeTechniciens.map((tech) => {
                  return (
                    <div
                      key={tech.technicianId}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '0.5rem 0.75rem',
                        background: 'rgba(255,255,255,0.02)',
                        borderRadius: '6px',
                        border: '1px solid rgba(255,255,255,0.04)',
                      }}
                    >
                      <span style={{ fontSize: '0.9rem', color: '#e4e4e7' }}>
                        {tech.technicianName}
                      </span>
                      <span
                        style={{
                          fontSize: '0.85rem',
                          fontWeight: 'bold',
                          padding: '0.125rem 0.5rem',
                          borderRadius: '4px',
                          background:
                            tech.activeCasesCount > 3
                              ? 'rgba(239,68,68,0.15)'
                              : tech.activeCasesCount > 0
                              ? 'rgba(59,130,246,0.15)'
                              : 'rgba(255,255,255,0.05)',
                          color:
                            tech.activeCasesCount > 3
                              ? '#ef4444'
                              : tech.activeCasesCount > 0
                              ? '#3b82f6'
                              : '#71717a',
                          border:
                            tech.activeCasesCount > 3
                              ? '1px solid rgba(239,68,68,0.2)'
                              : tech.activeCasesCount > 0
                              ? '1px solid rgba(59,130,246,0.2)'
                              : '1px solid rgba(255,255,255,0.05)',
                        }}
                      >
                        {tech.activeCasesCount} dossier(s) actif(s)
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Right Panel: Blocking Alerts & Aging Buckets */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            {/* Blocking Alerts */}
            <div
              style={{
                background: '#1e1e24',
                borderRadius: '8px',
                padding: '1.5rem',
                border: '1px solid rgba(255,255,255,0.05)',
                display: 'flex',
                flexDirection: 'column',
                gap: '1rem',
              }}
            >
              <h2
                style={{
                  fontSize: '1.1rem',
                  fontWeight: 600,
                  margin: 0,
                  borderBottom: '1px solid rgba(255,255,255,0.05)',
                  paddingBottom: '0.5rem',
                }}
              >
                Alertes de Blocage Critique ({dashboardData.alerts.length})
              </h2>
              {dashboardData.alerts.length === 0 ? (
                <div style={{ padding: '2rem', textAlign: 'center', color: '#71717a' }}>
                  <span style={{ fontSize: '1.5rem', display: 'block', marginBottom: '0.5rem' }}>
                    ✅
                  </span>
                  Aucune alerte de blocage détectée.
                </div>
              ) : (
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.75rem',
                    maxHeight: '350px',
                    overflowY: 'auto',
                  }}
                >
                  {dashboardData.alerts.map((alert) => (
                    <div
                      key={alert.caseId}
                      style={{
                        padding: '0.75rem',
                        background:
                          alert.type === 'waiting_parts_old'
                            ? 'rgba(249,115,22,0.08)'
                            : alert.type === 'quality_rejected'
                            ? 'rgba(239,68,68,0.08)'
                            : 'rgba(255,255,255,0.03)',
                        border: `1px solid ${
                          alert.type === 'waiting_parts_old'
                            ? 'rgba(249,115,22,0.2)'
                            : alert.type === 'quality_rejected'
                            ? 'rgba(239,68,68,0.2)'
                            : 'rgba(255,255,255,0.08)'
                        }`,
                        borderRadius: '6px',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          marginBottom: '0.25rem',
                        }}
                      >
                        <strong style={{ color: '#fff' }}>{alert.immatriculation}</strong>
                        <StatusBadge status={alert.status} />
                      </div>
                      <p style={{ margin: 0, fontSize: '0.85rem', color: '#d4d4d8' }}>
                        {alert.description}
                      </p>
                      <small style={{ color: '#71717a', fontSize: '0.75rem' }}>
                        Âge du dossier : {Math.round(alert.ageHours)} heures
                      </small>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Aging Buckets */}
            <div
              style={{
                background: '#1e1e24',
                borderRadius: '8px',
                padding: '1.5rem',
                border: '1px solid rgba(255,255,255,0.05)',
              }}
            >
              <h2
                style={{
                  fontSize: '1.1rem',
                  fontWeight: 600,
                  marginBottom: '1rem',
                  borderBottom: '1px solid rgba(255,255,255,0.05)',
                  paddingBottom: '0.5rem',
                }}
              >
                Distribution de l'Ancienneté (Dossiers Ouverts)
              </h2>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(4, 1fr)',
                  gap: '0.75rem',
                  textAlign: 'center',
                }}
              >
                {[
                  { label: '< 24h', val: dashboardData.aging.lessThan24h, color: '#10b981' },
                  { label: '24h - 48h', val: dashboardData.aging.between24hAnd48h, color: '#3b82f6' },
                  { label: '48h - 72h', val: dashboardData.aging.between48hAnd72h, color: '#f59e0b' },
                  { label: '> 72h', val: dashboardData.aging.moreThan72h, color: '#ef4444' },
                ].map((item, idx) => (
                  <div
                    key={idx}
                    style={{
                      background: 'rgba(255,255,255,0.02)',
                      padding: '0.75rem',
                      borderRadius: '6px',
                      border: '1px solid rgba(255,255,255,0.04)',
                    }}
                  >
                    <div style={{ fontSize: '1.5rem', fontWeight: 700, color: item.color }}>
                      {item.val}
                    </div>
                    <div style={{ fontSize: '0.8rem', color: '#a1a1aa', marginTop: '0.25rem' }}>
                      {item.label}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'today' && (
        <div
          style={{
            background: '#1e1e24',
            borderRadius: '8px',
            padding: '1.5rem',
            border: '1px solid rgba(255,255,255,0.05)',
            display: 'flex',
            flexDirection: 'column',
            gap: '1.5rem',
          }}
        >
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
            <div
              style={{
                background: 'rgba(255,255,255,0.02)',
                padding: '1rem',
                borderRadius: '6px',
                border: '1px solid rgba(255,255,255,0.04)',
              }}
            >
              <div style={{ fontSize: '0.85rem', color: '#a1a1aa' }}>Réceptionné Aujourd'hui</div>
              <div style={{ fontSize: '1.75rem', fontWeight: 700, color: '#3b82f6', marginTop: '0.25rem' }}>
                {dashboardData.dailyReception.receivedToday} véhicule(s)
              </div>
            </div>

            <div
              style={{
                background: 'rgba(255,255,255,0.02)',
                padding: '1rem',
                borderRadius: '6px',
                border: '1px solid rgba(255,255,255,0.04)',
              }}
            >
              <div style={{ fontSize: '0.85rem', color: '#a1a1aa' }}>Taux Rejet Contrôle Qualité</div>
              <div style={{ fontSize: '1.75rem', fontWeight: 700, color: '#ef4444', marginTop: '0.25rem' }}>
                {dashboardData.tauxQCRejet.toFixed(1)}%
              </div>
            </div>

            <div
              style={{
                background: 'rgba(255,255,255,0.02)',
                padding: '1rem',
                borderRadius: '6px',
                border: '1px solid rgba(255,255,255,0.04)',
              }}
            >
              <div style={{ fontSize: '0.85rem', color: '#a1a1aa' }}>Taux Réussite Livraison</div>
              <div style={{ fontSize: '1.75rem', fontWeight: 700, color: '#10b981', marginTop: '0.25rem' }}>
                {dashboardData.tauxLivraison.toFixed(1)}%
              </div>
            </div>
          </div>

          <div>
            <h3 style={{ fontSize: '1.05rem', fontWeight: 600, marginBottom: '0.75rem' }}>
              Historique des événements récents
            </h3>
            {logs.length === 0 ? (
              <p style={{ color: '#71717a', fontSize: '0.9rem', textAlign: 'center', padding: '2rem' }}>
                Aucun log d'activité disponible.
              </p>
            ) : (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.5rem',
                  maxHeight: '400px',
                  overflowY: 'auto',
                }}
              >
                {logs.slice(0, 30).map((log) => (
                  <div
                    key={log.id}
                    style={{
                      padding: '0.75rem',
                      background: 'rgba(255,255,255,0.01)',
                      border: '1px solid rgba(255,255,255,0.04)',
                      borderRadius: '6px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      fontSize: '0.85rem',
                    }}
                  >
                    <div>
                      <span
                        style={{
                          color: '#3b82f6',
                          fontWeight: 'bold',
                          marginRight: '0.5rem',
                          background: 'rgba(59,130,246,0.1)',
                          padding: '1px 5px',
                          borderRadius: '4px',
                        }}
                      >
                        {log.action}
                      </span>
                      <span style={{ color: '#e4e4e7' }}>{log.details}</span>
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', color: '#71717a' }}>
                      <span>Par: {log.userId} ({log.userRole})</span>
                      <span>•</span>
                      <span>{new Date(log.timestamp).toLocaleTimeString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'dossiers' && (
        <div style={{ display: 'grid', gridTemplateColumns: '350px 1fr', gap: '1.5rem', flex: 1 }}>
          {/* Left panel: list of all cases */}
          <div
            style={{
              background: '#1e1e24',
              borderRadius: '8px',
              padding: '1rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '1rem',
              border: '1px solid rgba(255,255,255,0.05)',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <input
                type="text"
                placeholder="Rechercher immat, VIN, client..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.6rem 0.75rem',
                  background: '#121214',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: '6px',
                  color: '#fff',
                  fontSize: '0.875rem',
                }}
              />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.6rem 0.75rem',
                  background: '#121214',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: '6px',
                  color: '#fff',
                  fontSize: '0.875rem',
                }}
              >
                <option value="all">Tous les statuts</option>
                <option value="draft">Brouillon</option>
                <option value="received">Réceptionné</option>
                <option value="diagnosis">Diagnostic</option>
                <option value="waiting_parts">Attente Pièces</option>
                <option value="repair">Réparation</option>
                <option value="work_completed">Travaux Finis</option>
                <option value="quality_pending">QC en attente</option>
                <option value="quality_rejected">QC Rejeté</option>
                <option value="quality_rework">Reprise Atelier</option>
                <option value="quality_approved">QC Approuvé</option>
                <option value="ready_delivery">Prêt Livraison</option>
                <option value="delivered">Livré</option>
                <option value="closed">Clôturé</option>
                <option value="cancelled">Annulé</option>
              </select>
            </div>

            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '0.5rem',
                overflowY: 'auto',
                maxHeight: '500px',
              }}
            >
              {filteredCases.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setSelectedCaseId(c.id)}
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    background: selectedCaseId === c.id ? 'rgba(59,130,246,0.1)' : 'rgba(255,255,255,0.01)',
                    border: `1px solid ${selectedCaseId === c.id ? '#3b82f6' : 'rgba(255,255,255,0.05)'}`,
                    borderRadius: '6px',
                    textAlign: 'left',
                    color: '#fff',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontWeight: 'bold' }}>{c.immatriculation}</span>
                    <StatusBadge status={c.status} />
                  </div>
                  <div style={{ fontSize: '0.8rem', color: '#a1a1aa', marginTop: '0.25rem' }}>
                    VIN: {c.vin}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: '#71717a' }}>Client: {c.clientName}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Right panel: read-only case details */}
          <div
            style={{
              background: '#1e1e24',
              borderRadius: '8px',
              padding: '1.5rem',
              border: '1px solid rgba(255,255,255,0.05)',
              overflowY: 'auto',
              maxHeight: '620px',
            }}
          >
            {selectedCase ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                <header style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '1rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h2 style={{ margin: 0, fontSize: '1.5rem' }}>Dossier {selectedCase.immatriculation}</h2>
                    <StatusBadge status={selectedCase.status} />
                  </div>
                  <p style={{ margin: '0.25rem 0 0 0', color: '#a1a1aa', fontSize: '0.85rem' }}>
                    Créé le : {new Date(selectedCase.createdAt).toLocaleString()} | Dernière mise à jour :{' '}
                    {new Date(selectedCase.updatedAt).toLocaleString()}
                  </p>
                </header>

                {/* Grid detail */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div>
                    <h3 style={{ fontSize: '0.95rem', color: '#3b82f6', marginBottom: '0.5rem' }}>
                      Informations Véhicule
                    </h3>
                    <p style={{ fontSize: '0.9rem', margin: '0.25rem 0' }}>
                      <span style={{ color: '#71717a' }}>Immatriculation :</span> {selectedCase.immatriculation}
                    </p>
                    <p style={{ fontSize: '0.9rem', margin: '0.25rem 0' }}>
                      <span style={{ color: '#71717a' }}>VIN :</span> {selectedCase.vin}
                    </p>
                    <p style={{ fontSize: '0.9rem', margin: '0.25rem 0' }}>
                      <span style={{ color: '#71717a' }}>Date Réception :</span>{' '}
                      {selectedCase.receptionDate ? new Date(selectedCase.receptionDate).toLocaleString() : 'N/A'}
                    </p>
                  </div>
                  <div>
                    <h3 style={{ fontSize: '0.95rem', color: '#3b82f6', marginBottom: '0.5rem' }}>
                      Contact Client (Fictif)
                    </h3>
                    <p style={{ fontSize: '0.9rem', margin: '0.25rem 0' }}>
                      <span style={{ color: '#71717a' }}>Nom Client :</span> {selectedCase.clientName}
                    </p>
                    <p style={{ fontSize: '0.9rem', margin: '0.25rem 0' }}>
                      <span style={{ color: '#71717a' }}>Téléphone :</span> {selectedCase.telephone}
                    </p>
                  </div>
                </div>

                <hr style={{ border: 'none', borderTop: '1px solid rgba(255,255,255,0.05)' }} />

                {/* Workshop assignments */}
                <div>
                  <h3 style={{ fontSize: '0.95rem', color: '#3b82f6', marginBottom: '0.5rem' }}>
                    Intervenants & Atelier
                  </h3>
                  <p style={{ fontSize: '0.9rem', margin: '0.25rem 0' }}>
                    <span style={{ color: '#71717a' }}>Technicien affecté :</span>{' '}
                    {selectedCase.assignedTechnicianName
                      ? `${selectedCase.assignedTechnicianName} (${selectedCase.assignedTechnicianId})`
                      : 'Aucun technicien affecté'}
                  </p>
                  <p style={{ fontSize: '0.9rem', margin: '0.25rem 0' }}>
                    <span style={{ color: '#71717a' }}>Priorité Atelier :</span>{' '}
                    {selectedCase.workshopPriority ? (
                      <PriorityBadge priority={selectedCase.workshopPriority as 'low' | 'normal' | 'high' | 'urgent'} />
                    ) : (
                      <span style={{ color: '#71717a' }}>non définie</span>
                    )}
                  </p>
                  <p style={{ fontSize: '0.9rem', margin: '0.25rem 0' }}>
                    <span style={{ color: '#71717a' }}>Baie Atelier :</span> {selectedCase.workshopBay || 'N/A'}
                  </p>
                  <p style={{ fontSize: '0.9rem', margin: '0.25rem 0' }}>
                    <span style={{ color: '#71717a' }}>Estimation :</span>{' '}
                    {selectedCase.estimatedDurationMinutes
                      ? `${selectedCase.estimatedDurationMinutes} minutes`
                      : 'Non estimé'}
                  </p>
                </div>

                {/* Tasks List */}
                {selectedCase.workshopTasks && selectedCase.workshopTasks.length > 0 && (
                  <div>
                    <h3 style={{ fontSize: '0.95rem', color: '#3b82f6', marginBottom: '0.5rem' }}>
                      Tâches Atelier
                    </h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                      {selectedCase.workshopTasks.map((t) => (
                        <div
                          key={t.id}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            padding: '0.4rem 0.6rem',
                            background: 'rgba(255,255,255,0.02)',
                            borderRadius: '4px',
                            fontSize: '0.85rem',
                          }}
                        >
                          <span>{t.label}</span>
                          <span
                            style={{
                              color:
                                t.status === 'done'
                                  ? '#10b981'
                                  : t.status === 'in_progress'
                                  ? '#eab308'
                                  : '#71717a',
                            }}
                          >
                            {t.status === 'done' ? 'Terminé' : t.status === 'in_progress' ? 'En cours' : 'En attente'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* QC Details */}
                {selectedCase.qcStatus && (
                  <div>
                    <h3 style={{ fontSize: '0.95rem', color: '#3b82f6', marginBottom: '0.5rem' }}>
                      Contrôle Qualité
                    </h3>
                    <p style={{ fontSize: '0.9rem', margin: '0.25rem 0' }}>
                      <span style={{ color: '#71717a' }}>QC Statut :</span>{' '}
                      <span style={{ fontWeight: 'bold' }}>{selectedCase.qcStatus.toUpperCase()}</span>
                    </p>
                    {selectedCase.qcCheckedAt && (
                      <p style={{ fontSize: '0.9rem', margin: '0.25rem 0' }}>
                        <span style={{ color: '#71717a' }}>Contrôlé le :</span>{' '}
                        {new Date(selectedCase.qcCheckedAt).toLocaleString()} par {selectedCase.qcCheckedBy}
                      </p>
                    )}
                    {selectedCase.qcRejectionReason && (
                      <p style={{ fontSize: '0.9rem', margin: '0.25rem 0', color: '#f87171' }}>
                        <span style={{ color: '#f87171', fontWeight: 'bold' }}>Motif de Rejet :</span>{' '}
                        {selectedCase.qcRejectionReason}
                      </p>
                    )}
                    {selectedCase.qcReworkReason && (
                      <p style={{ fontSize: '0.9rem', margin: '0.25rem 0', color: '#f43f5e' }}>
                        <span style={{ color: '#f43f5e', fontWeight: 'bold' }}>Motif de Reprise :</span>{' '}
                        {selectedCase.qcReworkReason}
                      </p>
                    )}
                  </div>
                )}

                {/* Notes Direction */}
                <div>
                  <h3 style={{ fontSize: '0.95rem', color: '#3b82f6', marginBottom: '0.5rem' }}>
                    Notes Direction (Lecture seule)
                  </h3>
                  <div
                    style={{
                      padding: '0.75rem',
                      background: 'rgba(255,255,255,0.02)',
                      border: '1px solid rgba(255,255,255,0.06)',
                      borderRadius: '6px',
                      fontSize: '0.9rem',
                      fontStyle: 'italic',
                      color: selectedCase.directionNotes ? '#e4e4e7' : '#71717a',
                    }}
                  >
                    {selectedCase.directionNotes || 'Aucune note de direction sur ce dossier.'}
                  </div>
                </div>
              </div>
            ) : (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: '100%',
                  color: '#71717a',
                  fontSize: '0.95rem',
                }}
              >
                Sélectionnez un dossier pour consulter ses détails en lecture seule.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Footer / indicator */}
      <footer style={{ marginTop: 'auto', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '1rem' }}>
        <div style={{ fontSize: '0.75rem', color: '#71717a', textAlign: 'center' }}>
          Indicateur: data/vehicles.json non utilisé (migration v24 active) | Rôle actuel : {user.role}
        </div>
      </footer>
    </div>
  );
};
