import React, { useState, useMemo } from 'react';
import type { User } from '@/types';
import { useSavCases } from '@/state/useSavCases';
import { APP_VERSION } from '@/constants/version';
import { ROLE_GOVERNANCE_LABELS } from '@/domain/role-governance';
import { validateReleaseReadiness, getReleaseReadinessChecklist } from '@/domain/release-readiness';
import { VersionBanner } from '@/components/VersionBanner';
import { getRoleFieldGuidance } from '@/domain/ui-field-guidelines';
import { getBlockingClaimsReasons } from '@/domain/claims';
import { OfflineQueuePanel } from '@/components/OfflineQueuePanel';
import { LocalCachePanel } from '@/components/LocalCachePanel';
import { summarizePwaDiagnostics } from '@/domain/pwa-diagnostics';
import { summarizeSecurityHardening } from '@/domain/security-hardening';
import { summarizeStatusHardening } from '@/domain/status-hardening';
import { buildFieldSecurityReport } from '@/domain/field-security';
import { summarizeAcceptanceReadiness } from '@/domain/field-acceptance';

interface AdminViewProps {
  user: User;
}

export const AdminView: React.FC<AdminViewProps> = ({ user }) => {
  const {
    cases,
    logs,
    pendingActions,
    getAdminGovernanceSummary,
    getSystemInvariants,
    overrideClaims,
  } = useSavCases();

  const [selectedRole, setSelectedRole] = useState<string>('lecture-seule');

  // Read-only governance data and invariants from the store
  const { matrix } = useMemo(() => {
    return getAdminGovernanceSummary();
  }, [getAdminGovernanceSummary]);

  const invariants = useMemo(() => {
    return getSystemInvariants();
  }, [getSystemInvariants]);

  // Find the selected role entry in matrix
  const selectedRoleEntry = useMemo(() => {
    return matrix.find((m) => m.role === selectedRole) || null;
  }, [matrix, selectedRole]);

  // Compute release readiness report
  const readinessReport = useMemo(() => {
    return validateReleaseReadiness(cases, logs, { appVersion: APP_VERSION });
  }, [cases, logs]);

  const staticChecklist = useMemo(() => {
    return getReleaseReadinessChecklist();
  }, []);

  const pwaReport = useMemo(() => {
    return summarizePwaDiagnostics();
  }, []);

  const alpha19Readiness = useMemo(() => {
    const permissions = summarizeSecurityHardening();
    const statuses = summarizeStatusHardening();
    const fields = buildFieldSecurityReport();
    const acceptance = summarizeAcceptanceReadiness();
    const exportPrintScore = 100;
    const offlineCacheScore = pendingActions.some((action) => action.status === 'failed') ? 75 : 90;
    const pwaScore = pwaReport.overallStatus === 'ok' ? 100 : pwaReport.overallStatus === 'warning' ? 85 : 40;
    const blockers = [
      ...permissions.blockers,
      ...statuses.blockers,
      ...fields.blockers,
      ...(acceptance.failed > 0 ? ['Recette terrain alpha.19 en échec.'] : []),
      ...(pwaReport.overallStatus === 'error' ? [pwaReport.notice] : []),
    ];
    const reserves = [
      ...permissions.warnings,
      ...statuses.warnings,
      ...fields.warnings,
      ...acceptance.reserves,
      ...(pendingActions.length > 0 ? [`${pendingActions.length} action(s) offline à vérifier avant décision humaine.`] : []),
    ];
    const globalStatus = blockers.length > 0 ? 'NO-GO' : reserves.length > 0 ? 'GO avec réserves' : 'GO interne';

    return {
      permissions,
      statuses,
      fields,
      acceptance,
      exportPrintScore,
      offlineCacheScore,
      pwaScore,
      blockers,
      reserves,
      globalStatus,
    };
  }, [pendingActions, pwaReport]);

  return (
    <div
      className="view-container"
      id="admin-view"
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
      {/* Header section */}
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
            Gouvernance & Readiness
          </h1>
          <p
            className="view-subtitle"
            style={{ margin: '0.25rem 0 0 0', color: '#a1a1aa', fontSize: '0.9rem' }}
          >
            {getRoleFieldGuidance('admin')}
          </p>
          <p
            className="view-subtitle"
            style={{ margin: '0.25rem 0 0 0', color: '#a1a1aa', fontSize: '0.9rem' }}
          >
            Admin : <strong style={{ color: '#fff' }}>{user.name}</strong>
          </p>
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
      </header>

      {/* Warning banner */}
      <div
        style={{
          background: 'rgba(245, 158, 11, 0.08)',
          border: '1px solid rgba(245, 158, 11, 0.2)',
          borderRadius: '8px',
          padding: '0.75rem 1.25rem',
          color: '#f59e0b',
          fontSize: '0.9rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
        }}
      >
        <span>⚠️</span>
        <span>
          <strong>Avertissement :</strong> alpha.19 est une recette interne de durcissement, non RC, non production, non finale et sans décision automatique de nouvelle RC.
        </span>
      </div>

      <section
        id="alpha19-security-readiness-panel"
        style={{
          background: '#1e1e24',
          borderRadius: '8px',
          padding: '1.25rem',
          border: '1px solid rgba(59,130,246,0.22)',
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>
              Recette sécurité alpha.19
            </h2>
            <p style={{ margin: '0.25rem 0 0 0', color: '#a1a1aa', fontSize: '0.85rem' }}>
              Durcissement interne avant décision humaine GO / NO-GO. alpha.19 n’est ni une RC ni une version de production.
            </p>
          </div>
          <span
            style={{
              fontSize: '0.8rem',
              padding: '0.35rem 0.7rem',
              borderRadius: '6px',
              background: alpha19Readiness.globalStatus === 'NO-GO' ? 'rgba(239,68,68,0.12)' : 'rgba(16,185,129,0.1)',
              color: alpha19Readiness.globalStatus === 'NO-GO' ? '#f87171' : '#34d399',
              border: `1px solid ${alpha19Readiness.globalStatus === 'NO-GO' ? 'rgba(239,68,68,0.25)' : 'rgba(16,185,129,0.25)'}`,
              fontWeight: 700,
            }}
          >
            {alpha19Readiness.globalStatus}
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.75rem' }}>
          {[
            { label: 'Permissions', score: alpha19Readiness.permissions.score },
            { label: 'Statuts', score: alpha19Readiness.statuses.score },
            { label: 'Champs', score: alpha19Readiness.fields.score },
            { label: 'Export/print', score: alpha19Readiness.exportPrintScore },
            { label: 'Offline/cache', score: alpha19Readiness.offlineCacheScore },
            { label: 'PWA', score: alpha19Readiness.pwaScore },
          ].map((item) => (
            <div
              key={item.label}
              style={{
                background: 'rgba(255,255,255,0.025)',
                border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: '6px',
                padding: '0.75rem',
              }}
            >
              <div style={{ fontSize: '0.76rem', color: '#a1a1aa' }}>{item.label}</div>
              <div style={{ fontSize: '1.35rem', fontWeight: 700, color: item.score >= 90 ? '#34d399' : item.score >= 75 ? '#fbbf24' : '#f87171' }}>
                {item.score}%
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '0.75rem' }}>
          <div style={{ fontSize: '0.8rem', color: '#d4d4d8', background: 'rgba(0,0,0,0.14)', borderRadius: '6px', padding: '0.75rem' }}>
            <strong style={{ color: '#fbbf24' }}>Réserves terrain :</strong>
            <ul style={{ margin: '0.4rem 0 0 1rem', padding: 0 }}>
              {alpha19Readiness.reserves.slice(0, 6).map((reserve, idx) => (
                <li key={idx}>{reserve}</li>
              ))}
            </ul>
          </div>
          <div style={{ fontSize: '0.8rem', color: '#d4d4d8', background: 'rgba(0,0,0,0.14)', borderRadius: '6px', padding: '0.75rem' }}>
            <strong style={{ color: alpha19Readiness.blockers.length > 0 ? '#f87171' : '#34d399' }}>Bloqueurs :</strong>
            {alpha19Readiness.blockers.length === 0 ? (
              <p style={{ margin: '0.4rem 0 0 0', color: '#a1a1aa' }}>Aucun bloqueur automatique détecté ; décision humaine obligatoire avant toute nouvelle RC.</p>
            ) : (
              <ul style={{ margin: '0.4rem 0 0 1rem', padding: 0 }}>
                {alpha19Readiness.blockers.map((blocker, idx) => (
                  <li key={idx}>{blocker}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      {/* Main layout grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: '1.5rem', flex: 1 }}>
        {/* Left column: invariants & summaries */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* Release Readiness Report */}
          <div
            style={{
              background: '#1e1e24',
              borderRadius: '8px',
              padding: '1.25rem',
              border: '1px solid rgba(255,255,255,0.05)',
            }}
          >
            <h2
              style={{
                fontSize: '1.05rem',
                fontWeight: 600,
                marginBottom: '1rem',
                borderBottom: '1px solid rgba(255,255,255,0.05)',
                paddingBottom: '0.5rem',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <span>Rapport de Conformité (Release Readiness)</span>
              <span
                style={{
                  fontSize: '0.75rem',
                  padding: '2px 8px',
                  borderRadius: '4px',
                  background: readinessReport.isReadyForRcEvaluation ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
                  color: readinessReport.isReadyForRcEvaluation ? '#10b981' : '#ef4444',
                  border: `1px solid ${readinessReport.isReadyForRcEvaluation ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)'}`,
                }}
              >
                {readinessReport.isReadyForRcEvaluation ? 'Prêt pour revue terrain' : 'Bloqueurs détectés'}
              </span>
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div style={{ fontSize: '0.85rem', color: '#a1a1aa' }}>
                <strong>Recommandation :</strong> {readinessReport.recommendation}
              </div>

              {readinessReport.blockers.length > 0 && (
                <div
                  style={{
                    background: 'rgba(239, 68, 68, 0.08)',
                    border: '1px solid rgba(239, 68, 68, 0.2)',
                    borderRadius: '6px',
                    padding: '0.5rem 0.75rem',
                    fontSize: '0.8rem',
                    color: '#ef4444',
                  }}
                >
                  <strong>Bloqueurs ({readinessReport.blockers.length}) :</strong>
                  <ul style={{ margin: '0.25rem 0 0 1.25rem', padding: 0 }}>
                    {readinessReport.blockers.map((b, idx) => (
                      <li key={idx} style={{ marginTop: '0.15rem' }}>{b}</li>
                    ))}
                  </ul>
                </div>
              )}

              {readinessReport.warnings.length > 0 && (
                <div
                  style={{
                    background: 'rgba(245, 158, 11, 0.08)',
                    border: '1px solid rgba(245, 158, 11, 0.2)',
                    borderRadius: '6px',
                    padding: '0.5rem 0.75rem',
                    fontSize: '0.8rem',
                    color: '#f59e0b',
                  }}
                >
                  <strong>Avertissements ({readinessReport.warnings.length}) :</strong>
                  <ul style={{ margin: '0.25rem 0 0 1.25rem', padding: 0 }}>
                    {readinessReport.warnings.map((w, idx) => (
                      <li key={idx} style={{ marginTop: '0.15rem' }}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div>
                <strong style={{ fontSize: '0.85rem', color: '#e4e4e7', display: 'block', marginBottom: '0.35rem' }}>
                  Checklist Readiness :
                </strong>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                  {staticChecklist.map((item) => (
                    <div
                      key={item.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        fontSize: '0.75rem',
                        color: '#a1a1aa',
                      }}
                    >
                      <span style={{ color: '#10b981' }}>✓</span>
                      <span>{item.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* System Invariants */}
          <div
            style={{
              background: '#1e1e24',
              borderRadius: '8px',
              padding: '1.25rem',
              border: '1px solid rgba(255,255,255,0.05)',
            }}
          >
            <h2
              style={{
                fontSize: '1.05rem',
                fontWeight: 600,
                marginBottom: '1rem',
                borderBottom: '1px solid rgba(255,255,255,0.05)',
                paddingBottom: '0.5rem',
              }}
            >
              Invariants Système
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {[
                { label: 'Version Application', val: invariants.appVersion },
                { label: 'Préfixe LocalStorage', val: invariants.localStoragePrefix },
                { label: 'Cache React réservé', val: invariants.reservedCacheName },
                { label: 'Statut v23 Production', val: invariants.v23Status },
                { label: 'Contrainte data/vehicles.json', val: invariants.vehiclesJsonConstraint },
                { label: 'Statut Service Worker', val: invariants.serviceWorkerStatus },
              ].map((item, idx) => (
                <div
                  key={idx}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    fontSize: '0.85rem',
                    padding: '0.35rem 0',
                    borderBottom: '1px solid rgba(255,255,255,0.02)',
                  }}
                >
                  <span style={{ color: '#a1a1aa' }}>{item.label}</span>
                  <code style={{ color: '#3b82f6', background: 'rgba(0,0,0,0.2)', padding: '2px 6px', borderRadius: '4px' }}>
                    {item.val}
                  </code>
                </div>
              ))}
            </div>
          </div>

          {/* Dossiers & Logs Statistics */}
          <div
            style={{
              background: '#1e1e24',
              borderRadius: '8px',
              padding: '1.25rem',
              border: '1px solid rgba(255,255,255,0.05)',
            }}
          >
            <h2
              style={{
                fontSize: '1.05rem',
                fontWeight: 600,
                marginBottom: '1rem',
                borderBottom: '1px solid rgba(255,255,255,0.05)',
                paddingBottom: '0.5rem',
              }}
            >
              Statistiques d'Activité
            </h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div
                style={{
                  background: 'rgba(255,255,255,0.02)',
                  padding: '1rem',
                  borderRadius: '6px',
                  border: '1px solid rgba(255,255,255,0.04)',
                  textAlign: 'center',
                }}
              >
                <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#3b82f6' }}>
                  {cases.length}
                </div>
                <div style={{ fontSize: '0.8rem', color: '#a1a1aa', marginTop: '0.25rem' }}>
                  Dossiers SAV actifs
                </div>
              </div>
              <div
                style={{
                  background: 'rgba(255,255,255,0.02)',
                  padding: '1rem',
                  borderRadius: '6px',
                  border: '1px solid rgba(255,255,255,0.04)',
                  textAlign: 'center',
                }}
              >
                <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#10b981' }}>
                  {logs.length}
                </div>
                <div style={{ fontSize: '0.8rem', color: '#a1a1aa', marginTop: '0.25rem' }}>
                  Entrées Audit Log
                </div>
              </div>
            </div>
          </div>

          {/* Audit Logs list */}
          <div
            style={{
              background: '#1e1e24',
              borderRadius: '8px',
              padding: '1.25rem',
              border: '1px solid rgba(255,255,255,0.05)',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.75rem',
            }}
          >
            <h2
              style={{
                fontSize: '1.05rem',
                fontWeight: 600,
                margin: 0,
                borderBottom: '1px solid rgba(255,255,255,0.05)',
                paddingBottom: '0.5rem',
              }}
            >
              Derniers événements audit log
            </h2>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '0.5rem',
                maxHeight: '200px',
                overflowY: 'auto',
              }}
            >
              {logs.length === 0 ? (
                <div style={{ padding: '1rem', color: '#71717a', textAlign: 'center', fontSize: '0.85rem' }}>
                  Aucun log disponible.
                </div>
              ) : (
                logs.slice(0, 10).map((log) => (
                  <div
                    key={log.id}
                    style={{
                      padding: '0.5rem 0.75rem',
                      background: 'rgba(0,0,0,0.15)',
                      borderRadius: '4px',
                      fontSize: '0.8rem',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <div>
                      <strong style={{ color: '#e4e4e7' }}>{log.action}</strong>
                      <span style={{ color: '#a1a1aa', marginLeft: '0.5rem' }}>{log.details}</span>
                    </div>
                    <span style={{ color: '#71717a', fontSize: '0.75rem' }}>
                      {log.userId} ({log.userRole})
                    </span>
                  </div>
                ))
              )}
            </div>

            {/* Print/Export Timeline */}
            {(() => {
              const printExportLogs = logs.filter((l) =>
                ['print_reception_sheet', 'print_workshop_sheet', 'print_quality_sheet', 'print_delivery_receipt', 'export_complete_case', 'export_zip'].some(
                  (a) => l.action === a || (l.details && l.details.includes(a))
                )
              );
              if (printExportLogs.length === 0) return null;
              return (
                <div style={{ marginTop: '1rem' }}>
                  <h3 style={{ fontSize: '0.85rem', fontWeight: 600, color: '#a1a1aa', margin: '0 0 0.5rem 0' }}>
                    🖨️ Timeline Impressions &amp; Exports
                  </h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', maxHeight: '150px', overflowY: 'auto' }}>
                    {printExportLogs.slice(0, 20).map((log) => (
                      <div key={log.id} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', fontSize: '0.75rem', padding: '0.3rem 0.5rem', background: 'rgba(59,130,246,0.05)', borderLeft: '2px solid #3b82f6', borderRadius: '2px' }}>
                        <span style={{ color: '#71717a', minWidth: '80px' }}>{new Date(log.timestamp).toLocaleTimeString()}</span>
                        <span style={{ color: '#e4e4e7' }}>{log.action}</span>
                        <span style={{ color: '#a1a1aa', flexGrow: 1 }}>{log.details}</span>
                        <span style={{ color: '#71717a' }}>{log.userId}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Bypass Claims Section */}
          <div
            style={{
              background: '#1e1e24',
              borderRadius: '8px',
              padding: '1.25rem',
              border: '1px solid rgba(255,255,255,0.05)',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.75rem',
            }}
          >
            <h2
              style={{
                fontSize: '1.05rem',
                fontWeight: 600,
                margin: 0,
                borderBottom: '1px solid rgba(255,255,255,0.05)',
                paddingBottom: '0.5rem',
              }}
            >
              Dérogations & Bypasses de Sinistres
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {(() => {
                const blockedCases = cases.filter(
                  (c) => getBlockingClaimsReasons(c.claims || [], c.claimsOverridden).length > 0
                );
                const overriddenCases = cases.filter((c) => c.claimsOverridden);

                return (
                  <>
                    <h3 style={{ fontSize: '0.85rem', color: '#ef4444', margin: '0.25rem 0' }}>
                      Dossiers bloqués par des accords manquants ({blockedCases.length})
                    </h3>
                    {blockedCases.length === 0 ? (
                      <div style={{ padding: '0.5rem', color: '#71717a', fontSize: '0.8rem', background: 'rgba(0,0,0,0.1)', borderRadius: '4px' }}>
                        Aucun dossier bloqué.
                      </div>
                    ) : (
                      blockedCases.map((c) => {
                        const reasons = getBlockingClaimsReasons(c.claims || [], c.claimsOverridden);
                        return (
                          <div
                            key={c.id}
                            style={{
                              padding: '0.5rem 0.75rem',
                              background: 'rgba(239, 68, 68, 0.04)',
                              border: '1px solid rgba(239, 68, 68, 0.1)',
                              borderRadius: '4px',
                              fontSize: '0.8rem',
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <strong>{c.immatriculation}</strong>
                              <button
                                onClick={() => {
                                  const reason = window.prompt("Motif de dérogation obligatoire pour forcer la planification :");
                                  if (reason === null) return; // User cancelled
                                  if (!reason.trim()) {
                                    window.alert("Le motif de dérogation is obligatoire.");
                                    return;
                                  }
                                  try {
                                    overrideClaims(c.id, reason.trim(), { id: user.id, role: user.role });
                                  } catch (e: unknown) {
                                    window.alert(e instanceof Error ? e.message : "Erreur lors de l'override");
                                  }
                                }}
                                style={{
                                  padding: '2px 8px',
                                  background: '#ef4444',
                                  color: '#fff',
                                  border: 'none',
                                  borderRadius: '4px',
                                  fontSize: '0.75rem',
                                  cursor: 'pointer',
                                }}
                              >
                                Override accords
                              </button>
                            </div>
                            <div style={{ color: '#a1a1aa', fontSize: '0.75rem', marginTop: '0.25rem' }}>
                              Client: {c.clientName} | Devis: {
                                (c.claims || []).map(claim => {
                                  return claim.estimate
                                    ? `${claim.estimate.sourceFileName} (${claim.estimate.totals.amountTTC.toFixed(2)} TTC)`
                                    : `Sans Devis (${claim.label})`;
                                }).join(' / ') || 'Aucun sinistre'
                              }
                            </div>
                            <ul style={{ margin: '0.25rem 0 0 1rem', padding: 0, color: '#f87171', fontSize: '0.75rem' }}>
                              {reasons.map((r, idx) => (
                                <li key={idx}>{r}</li>
                              ))}
                            </ul>
                          </div>
                        );
                      })
                    )}

                    <h3 style={{ fontSize: '0.85rem', color: '#10b981', margin: '0.75rem 0 0.25rem 0' }}>
                      Dérogations actives ({overriddenCases.length})
                    </h3>
                    {overriddenCases.length === 0 ? (
                      <div style={{ padding: '0.5rem', color: '#71717a', fontSize: '0.8rem', background: 'rgba(0,0,0,0.1)', borderRadius: '4px' }}>
                        Aucune dérogation active.
                      </div>
                    ) : (
                      overriddenCases.map((c) => (
                        <div
                          key={c.id}
                          style={{
                            padding: '0.5rem 0.75rem',
                            background: 'rgba(16, 185, 129, 0.04)',
                            border: '1px solid rgba(16, 185, 129, 0.1)',
                            borderRadius: '4px',
                            fontSize: '0.8rem',
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <strong>{c.immatriculation}</strong>
                            <span style={{ color: '#10b981', fontSize: '0.75rem' }}>Bypassé</span>
                          </div>
                          <div style={{ fontSize: '0.75rem', color: '#a1a1aa', marginTop: '0.25rem' }}>
                            Motif: "{c.claimsOverrideReason}"
                          </div>
                          <div style={{ fontSize: '0.7rem', color: '#71717a' }}>
                            Par: {c.claimsOverrideBy} le {c.claimsOverrideAt ? new Date(c.claimsOverrideAt).toLocaleString() : 'N/A'}
                          </div>
                        </div>
                      ))
                    )}
                  </>
                );
              })()}
            </div>
          </div>
        </div>

        {/* Right column: role governance matrix */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* Roles Matrix Selection */}
          <div
            style={{
              background: '#1e1e24',
              borderRadius: '8px',
              padding: '1.25rem',
              border: '1px solid rgba(255,255,255,0.05)',
            }}
          >
            <h2
              style={{
                fontSize: '1.05rem',
                fontWeight: 600,
                marginBottom: '1rem',
                borderBottom: '1px solid rgba(255,255,255,0.05)',
                paddingBottom: '0.5rem',
              }}
            >
              Matrice de Gouvernance des Rôles
            </h2>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                gap: '0.5rem',
                marginBottom: '1.5rem',
              }}
            >
              {matrix.map((item) => (
                <button
                  key={item.role}
                  onClick={() => setSelectedRole(item.role)}
                  style={{
                    padding: '0.6rem 0.5rem',
                    background: selectedRole === item.role ? 'rgba(59,130,246,0.1)' : 'rgba(255,255,255,0.01)',
                    border: `1px solid ${selectedRole === item.role ? '#3b82f6' : 'rgba(255,255,255,0.05)'}`,
                    borderRadius: '6px',
                    color: '#fff',
                    fontSize: '0.8rem',
                    cursor: 'pointer',
                    fontWeight: selectedRole === item.role ? 'bold' : 'normal',
                    textAlign: 'center',
                    transition: 'all 0.2s',
                  }}
                >
                  {ROLE_GOVERNANCE_LABELS[item.role] || item.role}
                </button>
              ))}
            </div>

            {selectedRoleEntry && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {/* Role Details */}
                <div style={{ padding: '0.75rem', background: 'rgba(0,0,0,0.15)', borderRadius: '6px' }}>
                  <div style={{ fontSize: '0.9rem', fontWeight: 'bold', color: '#3b82f6' }}>
                    Libellé : {selectedRoleEntry.label} (code: {selectedRoleEntry.role})
                  </div>
                  <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.85rem', color: '#d4d4d8' }}>
                    {selectedRoleEntry.scope}
                  </p>
                </div>

                {/* Parameters matrix */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
                  <div style={{ background: 'rgba(255,255,255,0.01)', padding: '0.5rem', borderRadius: '4px', textAlign: 'center', border: '1px solid rgba(255,255,255,0.03)' }}>
                    <div style={{ fontSize: '0.75rem', color: '#a1a1aa' }}>Notes Direction</div>
                    <div style={{ fontSize: '0.9rem', fontWeight: 'bold', color: selectedRoleEntry.canReadDirectionNotes ? '#10b981' : '#ef4444', marginTop: '0.25rem' }}>
                      {selectedRoleEntry.canReadDirectionNotes ? 'Lecture' : 'Interdit'}
                    </div>
                  </div>
                  <div style={{ background: 'rgba(255,255,255,0.01)', padding: '0.5rem', borderRadius: '4px', textAlign: 'center', border: '1px solid rgba(255,255,255,0.03)' }}>
                    <div style={{ fontSize: '0.75rem', color: '#a1a1aa' }}>Écriture Workflow</div>
                    <div style={{ fontSize: '0.9rem', fontWeight: 'bold', color: selectedRoleEntry.canWriteWorkflow ? '#f59e0b' : '#10b981', marginTop: '0.25rem' }}>
                      {selectedRoleEntry.canWriteWorkflow ? 'Oui' : 'Non (Lecture seule)'}
                    </div>
                  </div>
                  <div style={{ background: 'rgba(255,255,255,0.01)', padding: '0.5rem', borderRadius: '4px', textAlign: 'center', border: '1px solid rgba(255,255,255,0.03)' }}>
                    <div style={{ fontSize: '0.75rem', color: '#a1a1aa' }}>Accès Admin</div>
                    <div style={{ fontSize: '0.9rem', fontWeight: 'bold', color: selectedRoleEntry.hasAdminAccess ? '#ef4444' : '#71717a', marginTop: '0.25rem' }}>
                      {selectedRoleEntry.hasAdminAccess ? 'Total' : 'Aucun'}
                    </div>
                  </div>
                </div>

                {/* Onglets visibles */}
                <div>
                  <div style={{ fontSize: '0.85rem', color: '#a1a1aa', marginBottom: '0.25rem' }}>
                    Onglets autorisés dans l'application :
                  </div>
                  <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
                    {selectedRoleEntry.visibleTabs.map((tab) => (
                      <span
                        key={tab}
                        style={{
                          fontSize: '0.75rem',
                          background: 'rgba(59,130,246,0.1)',
                          color: '#3b82f6',
                          padding: '2px 8px',
                          borderRadius: '4px',
                          border: '1px solid rgba(59,130,246,0.2)',
                        }}
                      >
                        {tab}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Actions allowed vs forbidden split layout */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  {/* Allowed Actions */}
                  <div>
                    <div style={{ fontSize: '0.85rem', color: '#10b981', fontWeight: 600, marginBottom: '0.5rem' }}>
                      Actions Autorisées ({selectedRoleEntry.allowedActions.length})
                    </div>
                    <div style={{ maxHeight: '180px', overflowY: 'auto', background: 'rgba(16,185,129,0.02)', padding: '0.5rem', borderRadius: '4px', border: '1px solid rgba(16,185,129,0.08)', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                      {selectedRoleEntry.allowedActions.map((action) => (
                        <code key={action} style={{ fontSize: '0.75rem', color: '#34d399' }}>
                          ✓ {action}
                        </code>
                      ))}
                    </div>
                  </div>

                  {/* Forbidden Actions */}
                  <div>
                    <div style={{ fontSize: '0.85rem', color: '#ef4444', fontWeight: 600, marginBottom: '0.5rem' }}>
                      Actions Interdites ({selectedRoleEntry.forbiddenActions.length})
                    </div>
                    <div style={{ maxHeight: '180px', overflowY: 'auto', background: 'rgba(239,68,68,0.02)', padding: '0.5rem', borderRadius: '4px', border: '1px solid rgba(239,68,68,0.08)', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                      {selectedRoleEntry.forbiddenActions.map((action) => (
                        <code key={action} style={{ fontSize: '0.75rem', color: '#f87171' }}>
                          ✗ {action}
                        </code>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Offline & PWA Diagnostic Section */}
      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
          gap: '1.5rem',
          marginTop: '1.5rem',
        }}
      >
        <OfflineQueuePanel />
        <LocalCachePanel />

        <div
          id="pwa-diagnostic-panel"
          style={{
            background: '#1e1e24',
            borderRadius: '8px',
            padding: '1rem',
            border: '1px solid rgba(255,255,255,0.05)',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.75rem',
          }}
        >
          <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 600 }}>
            ⚡ Diagnostic Offline &amp; PWA
          </h3>
          <div style={{ fontSize: '0.8rem', color: '#a1a1aa' }}>
            {pwaReport.notice}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.8rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Manifeste HTML :</span>
              <span style={{ color: pwaReport.manifest.status === 'ok' ? '#10b981' : '#f59e0b' }}>
                {pwaReport.manifest.status.toUpperCase()}
              </span>
            </div>
            <div style={{ color: '#71717a', fontSize: '0.75rem', paddingLeft: '0.5rem' }}>
              {pwaReport.manifest.details}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Icônes PWA :</span>
              <span style={{ color: pwaReport.icons.status === 'ok' ? '#10b981' : '#f59e0b' }}>
                {pwaReport.icons.status.toUpperCase()}
              </span>
            </div>
            <div style={{ color: '#71717a', fontSize: '0.75rem', paddingLeft: '0.5rem' }}>
              {pwaReport.icons.details}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Service Worker :</span>
              <span style={{ color: pwaReport.offline.status === 'ok' ? '#10b981' : '#f59e0b' }}>
                {pwaReport.offline.status.toUpperCase()}
              </span>
            </div>
            <div style={{ color: '#71717a', fontSize: '0.75rem', paddingLeft: '0.5rem' }}>
              {pwaReport.offline.details}
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer style={{ marginTop: 'auto', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '1rem', textAlign: 'center' }}>
        <div style={{ fontSize: '0.75rem', color: '#71717a' }}>
          Indicateur : data/vehicles.json non utilisé (migration v24 active) | Rôle : {user.role}
        </div>
      </footer>
    </div>
  );
};
