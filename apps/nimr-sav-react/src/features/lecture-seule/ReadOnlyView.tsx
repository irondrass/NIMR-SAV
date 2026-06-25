import React, { useState, useMemo } from 'react';
import type { User } from '@/types';
import { useSavCases } from '@/state/useSavCases';
import { APP_VERSION } from '@/constants/version';
import { CaseStatus } from '@/domain/case-status';
import { canViewDirectionNotes } from '@/domain/action-permissions';

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

  // Get status label helper
  const getStatusLabel = (status: CaseStatus): string => {
    switch (status) {
      case 'draft':
        return 'Brouillon';
      case 'received':
        return 'Réceptionné';
      case 'diagnosis':
        return 'Diagnostic';
      case 'waiting_parts':
        return 'Attente Pièces';
      case 'repair':
        return 'Réparation';
      case 'work_completed':
        return 'Travaux Finis';
      case 'quality_pending':
        return 'QC en attente';
      case 'quality_rejected':
        return 'QC Rejeté';
      case 'quality_rework':
        return 'Reprise Atelier';
      case 'quality_approved':
        return 'QC Approuvé';
      case 'ready_delivery':
        return 'Prêt Livraison';
      case 'delivered':
        return 'Livré';
      case 'closed':
        return 'Clôturé';
      case 'cancelled':
        return 'Annulé';
      default:
        return status;
    }
  };

  // Get status color helper
  const getStatusColor = (status: CaseStatus): string => {
    switch (status) {
      case 'draft':
        return '#94a3b8';
      case 'received':
        return '#3b82f6';
      case 'diagnosis':
        return '#6366f1';
      case 'waiting_parts':
        return '#f97316';
      case 'repair':
        return '#eab308';
      case 'work_completed':
        return '#10b981';
      case 'quality_pending':
        return '#e0f2fe';
      case 'quality_rejected':
        return '#ef4444';
      case 'quality_rework':
        return '#f43f5e';
      case 'quality_approved':
        return '#059669';
      case 'ready_delivery':
        return '#10b981';
      case 'delivered':
        return '#111827';
      case 'closed':
        return '#4b5563';
      case 'cancelled':
        return '#374151';
      default:
        return '#6b7280';
    }
  };

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
          Consultation SAV
        </h2>
        <p style={{ color: '#a1a1aa', fontSize: '1rem', marginBottom: '1.5rem' }}>
          Aucun dossier SAV disponible pour la consultation.
        </p>
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
            Consultation SAV
          </h1>
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
        }}
      >
        ℹ️ Mode lecture seule — aucune action de modification disponible.
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
                  <span
                    style={{
                      fontSize: '0.7rem',
                      padding: '1px 5px',
                      borderRadius: '4px',
                      background: getStatusColor(c.status),
                      color: '#000',
                      fontWeight: 600,
                    }}
                  >
                    {getStatusLabel(c.status)}
                  </span>
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
                  <span
                    style={{
                      padding: '0.25rem 0.75rem',
                      borderRadius: '6px',
                      fontWeight: 600,
                      background: getStatusColor(selectedCase.status),
                      color: '#000',
                    }}
                  >
                    {getStatusLabel(selectedCase.status)}
                  </span>
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
                <p style={{ fontSize: '0.9rem', margin: '0.25rem 0' }}>
                  <span style={{ color: '#71717a' }}>Priorité :</span> {selectedCase.workshopPriority || 'Basse'}
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
