import React, { useState, useMemo } from 'react';
import type { User } from '@/types';
import { useSavCases } from '@/state/useSavCases';
import { APP_VERSION } from '@/constants/version';
import { canViewDirectionNotes } from '@/domain/action-permissions';
import { StatusBadge } from '@/components/StatusBadge';
import { PriorityBadge } from '@/components/PriorityBadge';
import { EmptyState } from '@/components/EmptyState';
import { VersionBanner } from '@/components/VersionBanner';
import { getRoleFieldGuidance } from '@/domain/ui-field-guidelines';
import { getBlockingClaimsReasons } from '@/domain/claims';
import { buildCompleteCaseSummary } from '@/domain/print-documents';

interface ReadOnlyViewProps {
  user: User;
}

export const ReadOnlyView: React.FC<ReadOnlyViewProps> = ({ user }) => {
  const {
    getReadOnlyCases,
    getReadOnlyLogs,
  } = useSavCases();

  const cases = getReadOnlyCases();
  const logs = getReadOnlyLogs();

  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // Selected case
  const selectedCase = useMemo(() => {
    if (!selectedCaseId) return null;
    return cases.find((c) => c.id === selectedCaseId) || null;
  }, [cases, selectedCaseId]);

  // Logs for selected case
  const caseLogs = useMemo(() => {
    if (!selectedCaseId) return [];
    return logs.filter((l) => l.caseId === selectedCaseId);
  }, [logs, selectedCaseId]);

  // Filter cases
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
        id="readonly-view"
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
        <span style={{ fontSize: '3rem', marginBottom: '1rem' }}>👁️</span>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 600, color: '#fff', marginBottom: '0.5rem' }}>
          Mode Lecture Seule
        </h2>
        <p style={{ color: '#a1a1aa', fontSize: '1rem', marginBottom: '1.5rem' }}>
          {getRoleFieldGuidance('lecture-seule')}
        </p>
        <EmptyState role="lecture-seule" />
        <div style={{ fontSize: '0.75rem', color: '#71717a' }}>
          Indicateur: data/vehicles.json non utilisé (migration v24 active) — Version {APP_VERSION}
        </div>
      </div>
    );
  }

  return (
    <div
      className="view-container"
      id="readonly-view"
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
            Mode Lecture Seule
          </h1>
          <p
            className="view-subtitle"
            style={{ margin: '0.25rem 0 0 0', color: '#a1a1aa', fontSize: '0.9rem' }}
          >
            {getRoleFieldGuidance('lecture-seule')}
          </p>
          <p
            className="view-subtitle"
            style={{ margin: '0.25rem 0 0 0', color: '#a1a1aa', fontSize: '0.9rem' }}
          >
            Session de : <strong style={{ color: '#fff' }}>{user.name} ({user.role})</strong>
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
          background: 'rgba(59, 130, 246, 0.08)',
          border: '1px solid rgba(59, 130, 246, 0.2)',
          borderRadius: '8px',
          padding: '0.75rem 1.25rem',
          color: '#3b82f6',
          fontSize: '0.9rem',
          fontWeight: 500,
        }}
      >
        ℹ️ Aucune action disponible (lecture seule). Release Candidate interne rc.1 (non production, non finale).
      </div>

      {/* Main Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: '1.5rem', flex: 1, minHeight: 0 }}>
        {/* Left pane: list of cases */}
        <aside
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
              maxHeight: '520px',
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
        </aside>

        {/* Right pane: details */}
        <main
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

              {/* Grid info */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
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

              {/* Workshop */}
              <div>
                <h3 style={{ fontSize: '0.95rem', color: '#3b82f6', marginBottom: '0.5rem' }}>
                  Atelier & Affectation
                </h3>
                <p style={{ fontSize: '0.9rem', margin: '0.25rem 0' }}>
                  <span style={{ color: '#71717a' }}>Technicien affecté :</span>{' '}
                  {selectedCase.assignedTechnicianName
                    ? `${selectedCase.assignedTechnicianName} (${selectedCase.assignedTechnicianId})`
                    : 'Non assigné'}
                </p>
                <p style={{ fontSize: '0.9rem', margin: '0.25rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ color: '#71717a' }}>Priorité :</span>{' '}
                  {selectedCase.workshopPriority ? (
                    <PriorityBadge priority={selectedCase.workshopPriority as 'low' | 'normal' | 'high' | 'urgent'} />
                  ) : (
                    <span style={{ color: '#71717a' }}>non définie</span>
                  )}
                </p>
                <p style={{ fontSize: '0.9rem', margin: '0.25rem 0' }}>
                  <span style={{ color: '#71717a' }}>Baie Atelier :</span> {selectedCase.workshopBay || 'Non renseigné'}
                </p>
              </div>

              {/* Tasks list */}
              {selectedCase.workshopTasks && selectedCase.workshopTasks.length > 0 && (
                <div>
                  <h4 style={{ fontSize: '0.9rem', color: '#a1a1aa', marginBottom: '0.4rem' }}>
                    Tâches planifiées :
                  </h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                    {selectedCase.workshopTasks.map((t) => (
                      <div
                        key={t.id}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          padding: '0.4rem 0.6rem',
                          background: 'rgba(0,0,0,0.15)',
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
                      <span style={{ fontWeight: 'bold' }}>Motif de Rejet :</span>{' '}
                      {selectedCase.qcRejectionReason}
                    </p>
                  )}
                </div>
              )}

              {/* Delivery Details */}
              {selectedCase.deliveredAt && (
                <div>
                  <h3 style={{ fontSize: '0.95rem', color: '#3b82f6', marginBottom: '0.5rem' }}>
                    Détails de Livraison
                  </h3>
                  <p style={{ fontSize: '0.9rem', margin: '0.25rem 0' }}>
                    <span style={{ color: '#71717a' }}>Livré le :</span>{' '}
                    {new Date(selectedCase.deliveredAt).toLocaleString()} par {selectedCase.deliveredBy}
                  </p>
                  <p style={{ fontSize: '0.9rem', margin: '0.25rem 0' }}>
                    <span style={{ color: '#71717a' }}>Récipiendaire :</span> {selectedCase.deliveryRecipientName}
                  </p>
                  <p style={{ fontSize: '0.9rem', margin: '0.25rem 0' }}>
                    <span style={{ color: '#71717a' }}>Référence Preuve :</span> {selectedCase.deliveryProofReference}
                  </p>
                </div>
              )}

              {/* Claims section */}
              <div>
                <h3 style={{ fontSize: '0.95rem', color: '#3b82f6', marginBottom: '0.5rem' }}>
                  Sinistres / OR (Claims)
                </h3>
                {selectedCase.claims && selectedCase.claims.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {selectedCase.claims.map((claim) => (
                      <div
                        key={claim.id}
                        style={{
                          padding: '0.75rem',
                          background: 'rgba(255, 255, 255, 0.02)',
                          border: '1px solid rgba(255, 255, 255, 0.05)',
                          borderRadius: '6px',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                          <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{claim.label}</span>
                          <span
                            style={{
                              fontSize: '0.75rem',
                              padding: '0.2rem 0.5rem',
                              borderRadius: '4px',
                              background:
                                claim.status === 'approved'
                                  ? 'rgba(16, 185, 129, 0.1)'
                                  : claim.status === 'rejected'
                                  ? 'rgba(239, 68, 68, 0.1)'
                                  : claim.status === 'cancelled'
                                  ? 'rgba(113, 113, 122, 0.1)'
                                  : 'rgba(234, 179, 8, 0.1)',
                              color:
                                claim.status === 'approved'
                                  ? '#10b981'
                                  : claim.status === 'rejected'
                                  ? '#ef4444'
                                  : claim.status === 'cancelled'
                                  ? '#71717a'
                                  : '#eab308',
                              border: '1px solid currentColor',
                            }}
                          >
                            {claim.status.toUpperCase()}
                          </span>
                        </div>
                        <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.8rem', color: '#a1a1aa' }}>
                          Type: {claim.claimType} | Payeur: {claim.payerType} | Montant estimé: {claim.estimatedAmount} €
                        </p>
                        {claim.description && (
                          <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.8rem', color: '#d4d4d8' }}>
                            {claim.description}
                          </p>
                        )}
                        {claim.estimate ? (
                          <div style={{ margin: '0 0 0.5rem 0', padding: '0.5rem', background: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255, 255, 255, 0.05)', borderRadius: '4px', fontSize: '0.75rem' }}>
                            <div style={{ color: '#34d399', fontWeight: 'bold', marginBottom: '0.25rem' }}>
                              📄 Devis : {claim.estimate.sourceFileName} ({claim.estimate.sourceType.toUpperCase()})
                            </div>
                            <div style={{ color: '#ccc', marginBottom: '0.25rem' }}>
                              HT: {claim.estimate.totals.amountHT.toFixed(2)} | TVA: {claim.estimate.totals.amountTVA.toFixed(2)} | TTC: {claim.estimate.totals.amountTTC.toFixed(2)} {claim.estimate.totals.currency}
                            </div>
                            <div style={{ color: '#ccc', marginBottom: '0.25rem' }}>
                              Charge : {
                                Object.entries(claim.estimate.laborSummary)
                                  .filter(([_, h]) => h > 0)
                                  .map(([p, h]) => `${p}: ${h}h`)
                                  .join(', ') || 'Aucune heure MO'
                              }
                            </div>
                            {claim.estimate.warnings.length > 0 && (
                              <div style={{ color: '#fca5a5', fontSize: '0.7rem' }}>
                                ⚠️ {claim.estimate.warnings.join(' | ')}
                              </div>
                            )}
                          </div>
                        ) : (
                          <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.75rem', color: '#71717a', fontStyle: 'italic' }}>
                            Aucun devis importé pour ce sinistre.
                          </p>
                        )}

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.8rem', background: 'rgba(0,0,0,0.15)', padding: '0.5rem', borderRadius: '4px' }}>
                          <div>
                            <strong>Accord Expert: </strong>
                            {claim.requiredApprovals.includes('expert') ? (
                              claim.expertApproved ? (
                                <span style={{ color: '#10b981' }}>Validé (Par: {claim.expertName || 'N/A'})</span>
                              ) : (
                                <span style={{ color: '#eab308' }}>En attente</span>
                              )
                            ) : (
                              <span style={{ color: '#71717a' }}>Non requis</span>
                            )}
                          </div>
                          <div>
                            <strong>Accord Client: </strong>
                            {claim.requiredApprovals.includes('client') ? (
                              claim.clientApproved ? (
                                <span style={{ color: '#10b981' }}>Validé (Réf: {claim.clientApprovalReference || 'N/A'})</span>
                              ) : (
                                <span style={{ color: '#eab308' }}>En attente</span>
                              )
                            ) : (
                              <span style={{ color: '#71717a' }}>Non requis</span>
                            )}
                          </div>
                          {claim.notes && (
                            <div style={{ marginTop: '0.25rem', fontSize: '0.75rem', color: '#a1a1aa', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '0.25rem' }}>
                              Note: {claim.notes}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p style={{ fontSize: '0.9rem', color: '#71717a', margin: 0 }}>Aucun sinistre enregistré.</p>
                )}
                {selectedCase.claimsOverridden && (
                  <div
                    style={{
                      marginTop: '0.75rem',
                      padding: '0.5rem 0.75rem',
                      background: 'rgba(16, 185, 129, 0.1)',
                      border: '1px solid rgba(16, 185, 129, 0.2)',
                      color: '#10b981',
                      borderRadius: '6px',
                      fontSize: '0.8rem',
                    }}
                  >
                    ⚠️ Accords bypassés par Admin le{' '}
                    {selectedCase.claimsOverrideAt ? new Date(selectedCase.claimsOverrideAt).toLocaleString() : 'N/A'}{' '}
                    pour la raison : "{selectedCase.claimsOverrideReason}"
                  </div>
                )}
                {(() => {
                  const reasons = getBlockingClaimsReasons(selectedCase.claims || [], selectedCase.claimsOverridden);
                  if (reasons.length > 0) {
                    return (
                      <div
                        style={{
                          marginTop: '0.5rem',
                          padding: '0.5rem 0.75rem',
                          background: 'rgba(239, 68, 68, 0.1)',
                          border: '1px solid rgba(239, 68, 68, 0.2)',
                          color: '#ef4444',
                          borderRadius: '6px',
                          fontSize: '0.8rem',
                        }}
                      >
                        <strong>Planification bloquée : accord expert/client manquant</strong>
                        <ul style={{ margin: '0.25rem 0 0 1.25rem', padding: 0 }}>
                          {reasons.map((r, idx) => (
                            <li key={idx}>{r}</li>
                          ))}
                        </ul>
                      </div>
                    );
                  }
                  return null;
                })()}
              </div>

              {/* Direction notes hidden check */}
              {canViewDirectionNotes(user.role) && selectedCase.directionNotes && (
                <div>
                  <h3 style={{ fontSize: '0.95rem', color: '#3b82f6', marginBottom: '0.5rem' }}>
                    Notes Direction
                  </h3>
                  <div
                    style={{
                      padding: '0.75rem',
                      background: 'rgba(255,255,255,0.02)',
                      borderRadius: '4px',
                      fontStyle: 'italic',
                      fontSize: '0.85rem',
                    }}
                  >
                    {selectedCase.directionNotes}
                  </div>
                </div>
              )}

              {/* Documents Preview Section */}
              <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                <h3 style={{ fontSize: '0.95rem', color: '#3b82f6', marginBottom: '0.5rem' }}>
                  📄 Documents Consultables
                </h3>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <button
                    onClick={() => {
                      if (typeof window !== 'undefined') {
                        const html = buildCompleteCaseSummary(selectedCase);
                        const w = window.open('', '_blank');
                        if (w) { w.document.write(html); w.document.close(); }
                      }
                    }}
                    style={{ padding: '0.35rem 0.7rem', background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.3)', borderRadius: '4px', color: '#93c5fd', fontSize: '0.8rem', cursor: 'pointer' }}
                  >
                    🔍 Résumé complet dossier
                  </button>
                </div>
              </div>

              {/* Logs section */}
              {caseLogs.length > 0 && (
                <div>
                  <h3 style={{ fontSize: '0.95rem', color: '#3b82f6', marginBottom: '0.5rem' }}>
                    Historique des transitions du dossier
                  </h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                    {caseLogs.map((log) => (
                      <div
                        key={log.id}
                        style={{
                          padding: '0.4rem 0.6rem',
                          background: 'rgba(0,0,0,0.15)',
                          borderRadius: '4px',
                          fontSize: '0.8rem',
                          display: 'flex',
                          justifyContent: 'space-between',
                        }}
                      >
                        <span>{log.details}</span>
                        <span style={{ color: '#71717a', fontSize: '0.75rem' }}>
                          {log.userId} ({log.userRole})
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
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
        </main>
      </div>

      {/* Footer */}
      <footer style={{ marginTop: 'auto', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '1rem', textAlign: 'center' }}>
        <div style={{ fontSize: '0.75rem', color: '#71717a' }}>
          Indicateur : data/vehicles.json non utilisé (migration v24 active) | Rôle : {user.role}
        </div>
      </footer>
    </div>
  );
};
