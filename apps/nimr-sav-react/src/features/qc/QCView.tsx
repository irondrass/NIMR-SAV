import React, { useState, useMemo } from 'react';
import type { User } from '@/types';
import { useSavCases } from '@/state/useSavCases';
import { Button } from '@/components/ui/Button';
import { normalizeQcChecklist } from '@/domain/qc-rules';
import { buildQualityCheckSheet } from '@/domain/print-documents';
import { hasPermission } from '@/domain/action-permissions';
import { StatusBadge } from '@/components/StatusBadge';
import { PriorityBadge } from '@/components/PriorityBadge';
import { EmptyState } from '@/components/EmptyState';
import { getRoleFieldGuidance } from '@/domain/ui-field-guidelines';

interface QCViewProps {
  user: User;
}

export const QCView: React.FC<QCViewProps> = ({ user }) => {
  const {
    cases,
    logs,
    startQualityCheck,
    updateQualityChecklist,
    approveQualityCheck,
    rejectQualityCheck,
    sendQualityCaseToRework,
    recordPrintAction,
  } = useSavCases();

  // Pick a simulated QC user if the logged in user doesn't have QC permissions
  const actor = useMemo(() => {
    const isQC = user.role === 'qualite' || user.role === 'admin';
    return {
      id: isQC ? user.id : 'QC-DEMO-001',
      name: isQC ? user.name : 'Contrôleur Qualité Démo',
      role: isQC && user.role !== 'admin' ? user.role : ('qualite' as const),
    };
  }, [user]);

  // Filter cases visible to QC: work_completed, quality_pending, quality_rejected, quality_rework
  const qcCases = useMemo(() => {
    return cases.filter((c) =>
      c.status === 'work_completed' ||
      c.status === 'quality_pending' ||
      c.status === 'quality_rejected' ||
      c.status === 'quality_rework'
    );
  }, [cases]);

  // Selected case id for detail view
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);

  const selectedCase = useMemo(() => {
    return qcCases.find((c) => c.id === selectedCaseId) || null;
  }, [qcCases, selectedCaseId]);

  const handlePrintQualityCheckSheet = () => {
    if (!selectedCase) return;
    const html = buildQualityCheckSheet(selectedCase);
    recordPrintAction(selectedCase.id, 'quality_check_sheet', actor);
    if (typeof window !== 'undefined') {
      const w = window.open('', '_blank');
      if (w) {
        w.document.write(html);
        w.document.close();
        w.print();
      }
    }
  };

  const [rejectionReason, setRejectionReason] = useState('');
  const [reworkReason, setReworkReason] = useState('');
  const [showRejectionForm, setShowRejectionForm] = useState(false);
  const [showReworkForm, setShowReworkForm] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Get logs for the selected case
  const caseLogs = useMemo(() => {
    if (!selectedCaseId) return [];
    return logs.filter((l) => l.caseId === selectedCaseId);
  }, [logs, selectedCaseId]);

  const handleSelectCase = (caseId: string) => {
    setSelectedCaseId(caseId);
    setRejectionReason('');
    setReworkReason('');
    setShowRejectionForm(false);
    setShowReworkForm(false);
    setErrorMsg('');
    setSuccessMsg('');
  };

  const handleStartCheck = async (caseId: string) => {
    try {
      setErrorMsg('');
      setSuccessMsg('');
      startQualityCheck(caseId, actor);
      setSuccessMsg("Contrôle qualité démarré avec succès !");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const handleToggleChecklistItem = async (itemId: string) => {
    if (!selectedCase) return;
    try {
      setErrorMsg('');
      const currentItems = normalizeQcChecklist(selectedCase.qcChecklist);
      const updatedItems = currentItems.map((item) =>
        item.id === itemId ? { ...item, checked: !item.checked } : item
      );
      updateQualityChecklist(selectedCase.id, updatedItems, actor);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const handleApproveQC = async (caseId: string) => {
    try {
      setErrorMsg('');
      setSuccessMsg('');
      approveQualityCheck(caseId, actor);
      setSuccessMsg("Contrôle qualité validé et approuvé !");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const handleRejectQC = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCase) return;
    try {
      setErrorMsg('');
      setSuccessMsg('');
      rejectQualityCheck(selectedCase.id, rejectionReason, actor);
      setSuccessMsg("Contrôle qualité rejeté avec succès.");
      setRejectionReason('');
      setShowRejectionForm(false);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const handleSendToRework = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCase) return;
    try {
      setErrorMsg('');
      setSuccessMsg('');
      sendQualityCaseToRework(selectedCase.id, reworkReason, actor);
      setSuccessMsg("Dossier renvoyé en reprise atelier avec succès.");
      setReworkReason('');
      setShowReworkForm(false);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  // Check if checklist validation is enabled (all required checked)
  const isValidationEnabled = useMemo(() => {
    if (!selectedCase) return false;
    const items = normalizeQcChecklist(selectedCase.qcChecklist);
    if (items.length === 0) return false;
    return items.filter((item) => item.required).every((item) => item.checked);
  }, [selectedCase]);

  return (
    <div className="view-container" id="qc-view" style={{ display: 'flex', flexDirection: 'column', gap: '1rem', padding: '1rem', color: '#fff', minHeight: '100vh', background: '#121214' }}>
      <header className="view-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '1rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 className="view-title" style={{ margin: 0, fontSize: '1.5rem', fontWeight: 600 }}>Contrôle Qualité</h1>
          <p className="view-subtitle" style={{ margin: '0.25rem 0 0 0', color: '#a1a1aa', fontSize: '0.875rem' }}>
            {getRoleFieldGuidance('qualite')}
          </p>
          <p className="view-subtitle" style={{ margin: '0.25rem 0 0 0', color: '#a1a1aa', fontSize: '0.875rem' }}>
            Session de : <strong style={{ color: '#fff' }}>{actor.name} ({actor.role})</strong>
          </p>
        </div>
      </header>

      {/* Main Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: '1rem', flex: 1, minHeight: 0 }}>
        {/* Left Side: Case list */}
        <aside style={{ background: '#1e1e24', borderRadius: '8px', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem', border: '1px solid rgba(255,255,255,0.05)' }}>
          <h2 style={{ fontSize: '1.1rem', margin: 0, fontWeight: 600 }}>Dossiers à contrôler ({qcCases.length})</h2>

          {qcCases.length === 0 ? (
            <EmptyState role="qualite" />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', overflowY: 'auto', flex: 1 }}>
              {qcCases.map((c) => (
                <button
                  key={c.id}
                  onClick={() => handleSelectCase(c.id)}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-start',
                    gap: '0.25rem',
                    width: '100%',
                    padding: '0.75rem',
                    background: selectedCaseId === c.id ? 'rgba(59,130,246,0.1)' : 'rgba(255,255,255,0.02)',
                    border: `1px solid ${selectedCaseId === c.id ? '#3b82f6' : 'rgba(255,255,255,0.05)'}`,
                    borderRadius: '6px',
                    textAlign: 'left',
                    color: '#fff',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
                    <span style={{ fontWeight: 'bold', fontSize: '0.95rem' }}>{c.immatriculation}</span>
                    <StatusBadge status={c.status} />
                  </div>
                  <div style={{ fontSize: '0.8rem', color: '#a1a1aa' }}>VIN: {c.vin}</div>
                  <div style={{ fontSize: '0.8rem', color: '#71717a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', width: '100%' }}>
                    {c.clientName}
                  </div>
                </button>
              ))}
            </div>
          )}
        </aside>

        {/* Right Side: Detail pane */}
        <main style={{ background: '#1e1e24', borderRadius: '8px', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.5rem', overflowY: 'auto', border: '1px solid rgba(255,255,255,0.05)' }}>
          {errorMsg && (
            <div style={{ padding: '0.75rem', background: 'rgba(239,68,68,0.1)', border: '1px solid #ef4444', borderRadius: '6px', color: '#f87171', fontSize: '0.9rem' }}>
              ⚠️ {errorMsg}
            </div>
          )}
          {successMsg && (
            <div style={{ padding: '0.75rem', background: 'rgba(34,197,94,0.1)', border: '1px solid #22c55e', borderRadius: '6px', color: '#4ade80', fontSize: '0.9rem' }}>
              ✅ {successMsg}
            </div>
          )}

          {!selectedCase ? (
            <EmptyState role="qualite" messageOverride="Sélectionnez un dossier dans la liste pour commencer le contrôle qualité." />
          ) : (
            <>
              {/* Case Header Details */}
              <section style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
                  <div>
                    <h2 style={{ margin: 0, fontSize: '1.4rem' }}>
                      Véhicule : {selectedCase.immatriculation} <span style={{ color: '#71717a', fontWeight: 'normal', fontSize: '1rem' }}>({selectedCase.vin})</span>
                    </h2>
                    <p style={{ margin: '0.5rem 0 0 0', color: '#a1a1aa' }}>
                      Client : <strong>{selectedCase.clientName}</strong> | Tél : <strong>{selectedCase.telephone}</strong>
                    </p>
                  </div>
                  <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.5rem' }}>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      <StatusBadge status={selectedCase.status} />
                      {hasPermission(user.role, 'print_quality_sheet') && (
                        <Button size="sm" onClick={handlePrintQualityCheckSheet}>
                          🖨️ Fiche Qualité
                        </Button>
                      )}
                    </div>
                    <p style={{ margin: 0, fontSize: '0.8rem', color: '#71717a' }}>
                      Reçu le : {new Date(selectedCase.receptionDate).toLocaleString()}
                    </p>
                  </div>
                </div>
              </section>

              {/* Read-Only Workshop Information */}
              <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', background: 'rgba(255,255,255,0.02)', padding: '1rem', borderRadius: '6px' }}>
                <div>
                  <h4 style={{ margin: '0 0 0.25rem 0', color: '#71717a', fontSize: '0.75rem', textTransform: 'uppercase' }}>Technicien Affecté</h4>
                  <span style={{ fontSize: '0.9rem' }}>{selectedCase.assignedTechnicianName || 'Non affecté'}</span>
                </div>
                <div>
                  <h4 style={{ margin: '0 0 0.25rem 0', color: '#71717a', fontSize: '0.75rem', textTransform: 'uppercase' }}>Priorité Atelier</h4>
                  <div>
                    <PriorityBadge priority={selectedCase.workshopPriority || 'normal'} />
                  </div>
                </div>
                <div>
                  <h4 style={{ margin: '0 0 0.25rem 0', color: '#71717a', fontSize: '0.75rem', textTransform: 'uppercase' }}>Baie Atelier</h4>
                  <span style={{ fontSize: '0.9rem' }}>{selectedCase.workshopBay || 'Non planifié'}</span>
                </div>
                <div>
                  <h4 style={{ margin: '0 0 0.25rem 0', color: '#71717a', fontSize: '0.75rem', textTransform: 'uppercase' }}>Tâches exécutées</h4>
                  <span style={{ fontSize: '0.9rem' }}>
                    {selectedCase.workshopTasks?.filter(t => t.status === 'done').length || 0} / {selectedCase.workshopTasks?.length || 0} terminées
                  </span>
                </div>
              </section>

              {/* QC Rejection & Rework Logs */}
              {selectedCase.qcRejectionReason && (
                <div style={{ padding: '0.75rem', background: 'rgba(239,68,68,0.05)', borderLeft: '4px solid #ef4444', borderRadius: '4px', fontSize: '0.9rem' }}>
                  <strong style={{ color: '#f87171', display: 'block', marginBottom: '0.25rem' }}>Motif du dernier rejet QC :</strong>
                  {selectedCase.qcRejectionReason}
                </div>
              )}
              {selectedCase.qcReworkReason && (
                <div style={{ padding: '0.75rem', background: 'rgba(249,115,22,0.05)', borderLeft: '4px solid #f97316', borderRadius: '4px', fontSize: '0.9rem' }}>
                  <strong style={{ color: '#fb923c', display: 'block', marginBottom: '0.25rem' }}>Motif du renvoi en reprise atelier :</strong>
                  {selectedCase.qcReworkReason}
                </div>
              )}

              {/* Workshop Tasks Details (Read-only list) */}
              <section>
                <h3 style={{ fontSize: '1.1rem', margin: '0 0 0.5rem 0', fontWeight: 600 }}>Tâches d'atelier associées</h3>
                {(!selectedCase.workshopTasks || selectedCase.workshopTasks.length === 0) ? (
                  <p style={{ margin: 0, fontSize: '0.9rem', color: '#71717a' }}>Aucune tâche d'atelier enregistrée.</p>
                ) : (
                  <div style={{ display: 'grid', gap: '0.5rem', background: 'rgba(255,255,255,0.01)', padding: '0.75rem', borderRadius: '6px' }}>
                    {selectedCase.workshopTasks.map((t) => (
                      <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem', padding: '0.25rem 0', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                        <span>{t.label}</span>
                        <strong style={{ color: t.status === 'done' ? '#22c55e' : t.status === 'in_progress' ? '#eab308' : '#71717a' }}>
                          {t.status === 'done' ? 'Terminé' : t.status === 'in_progress' ? 'En cours' : 'En attente'}
                        </strong>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Quality Control Workflow Interface */}
              <section style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '1.5rem' }}>
                <h3 style={{ fontSize: '1.1rem', margin: '0 0 1rem 0', fontWeight: 600 }}>Pilote de Contrôle Qualité</h3>

                {selectedCase.status === 'work_completed' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', alignItems: 'flex-start' }}>
                    <p style={{ margin: 0, fontSize: '0.9rem', color: '#a1a1aa' }}>
                      Les travaux sont terminés. Le véhicule est disponible pour démarrer la procédure de contrôle.
                    </p>
                    <Button onClick={() => handleStartCheck(selectedCase.id)}>
                      🏁 Commencer le Contrôle Qualité
                    </Button>
                  </div>
                )}

                {selectedCase.status === 'quality_pending' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                    {/* Checklist */}
                    <div>
                      <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.95rem', color: '#a1a1aa' }}>Checklist QC :</h4>
                      <div style={{ display: 'grid', gap: '0.75rem' }}>
                        {normalizeQcChecklist(selectedCase.qcChecklist).map((item) => (
                          <label
                            key={item.id}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '0.5rem',
                              padding: '0.75rem',
                              background: 'rgba(255,255,255,0.02)',
                              border: '1px solid rgba(255,255,255,0.05)',
                              borderRadius: '6px',
                              cursor: 'pointer',
                              fontSize: '0.9rem',
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={item.checked}
                              onChange={() => handleToggleChecklistItem(item.id)}
                              style={{ width: '1.1rem', height: '1.1rem', cursor: 'pointer' }}
                            />
                            <span>
                              {item.label} {item.required && <strong style={{ color: '#ef4444' }}>* (Requis)</strong>}
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>

                    {/* Actions Validation / Rejet */}
                    {!showRejectionForm ? (
                      <div style={{ display: 'flex', gap: '1rem' }}>
                        <Button
                          disabled={!isValidationEnabled}
                          onClick={() => handleApproveQC(selectedCase.id)}
                          style={{
                            background: isValidationEnabled ? '#22c55e' : '#14532d',
                            color: isValidationEnabled ? '#000' : '#86efac',
                            opacity: isValidationEnabled ? 1 : 0.6,
                          }}
                        >
                          ✅ Valider & Approuver le QC
                        </Button>
                        <Button
                          onClick={() => setShowRejectionForm(true)}
                          style={{ background: '#ef4444', color: '#000' }}
                        >
                          ❌ Rejeter & Signaler défaut
                        </Button>
                      </div>
                    ) : (
                      <form onSubmit={handleRejectQC} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', padding: '1rem', background: 'rgba(239,68,68,0.03)', border: '1px solid rgba(239,68,68,0.1)', borderRadius: '6px' }}>
                        <label style={{ fontSize: '0.9rem', fontWeight: 600 }}>
                          Motif de rejet obligatoire :
                        </label>
                        <textarea
                          rows={3}
                          value={rejectionReason}
                          onChange={(e) => setRejectionReason(e.target.value)}
                          placeholder="Décrivez précisément le(s) défaut(s) constaté(s)..."
                          style={{
                            width: '100%',
                            padding: '0.5rem',
                            borderRadius: '4px',
                            background: '#121214',
                            border: '1px solid rgba(255,255,255,0.15)',
                            color: '#fff',
                            fontSize: '0.9rem',
                            resize: 'vertical',
                          }}
                          required
                        />
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <Button
                            type="submit"
                            disabled={!rejectionReason.trim()}
                            style={{ background: '#ef4444', color: '#000' }}
                          >
                            Confirmer le rejet
                          </Button>
                          <Button
                            type="button"
                            onClick={() => {
                              setShowRejectionForm(false);
                              setRejectionReason('');
                            }}
                            style={{ background: '#3f3f46', color: '#fff' }}
                          >
                            Annuler
                          </Button>
                        </div>
                      </form>
                    )}
                  </div>
                )}

                {selectedCase.status === 'quality_rejected' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <p style={{ margin: 0, fontSize: '0.9rem', color: '#a1a1aa' }}>
                      Le véhicule a échoué au contrôle qualité. Vous devez formaliser son renvoi en reprise à l'atelier afin que le technicien puisse réintervenir.
                    </p>
                    {!showReworkForm ? (
                      <Button
                        onClick={() => setShowReworkForm(true)}
                        style={{ background: '#f97316', color: '#000' }}
                      >
                        🔧 Renvoyer en reprise atelier
                      </Button>
                    ) : (
                      <form onSubmit={handleSendToRework} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', padding: '1rem', background: 'rgba(249,115,22,0.03)', border: '1px solid rgba(249,115,22,0.1)', borderRadius: '6px' }}>
                        <label style={{ fontSize: '0.9rem', fontWeight: 600 }}>
                          Instructions de reprise obligatoires :
                        </label>
                        <textarea
                          rows={3}
                          value={reworkReason}
                          onChange={(e) => setReworkReason(e.target.value)}
                          placeholder="Indiquez au technicien les correctifs à apporter..."
                          style={{
                            width: '100%',
                            padding: '0.5rem',
                            borderRadius: '4px',
                            background: '#121214',
                            border: '1px solid rgba(255,255,255,0.15)',
                            color: '#fff',
                            fontSize: '0.9rem',
                            resize: 'vertical',
                          }}
                          required
                        />
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <Button
                            type="submit"
                            disabled={!reworkReason.trim()}
                            style={{ background: '#f97316', color: '#000' }}
                          >
                            Confirmer le renvoi à l'atelier
                          </Button>
                          <Button
                            type="button"
                            onClick={() => {
                              setShowReworkForm(false);
                              setReworkReason('');
                            }}
                            style={{ background: '#3f3f46', color: '#fff' }}
                          >
                            Annuler
                          </Button>
                        </div>
                      </form>
                    )}
                  </div>
                )}

                {selectedCase.status === 'quality_rework' && (
                  <div style={{ padding: '1rem', background: 'rgba(255,255,255,0.02)', border: '1px dashed rgba(255,255,255,0.1)', borderRadius: '6px', fontSize: '0.9rem', color: '#a1a1aa' }}>
                    ⚙️ Le dossier a été renvoyé à l'atelier pour correction. En attente de l'achèvement des travaux correctifs par le technicien.
                  </div>
                )}
              </section>

              {/* Audit logs summary for the case */}
              <section style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '1.5rem' }}>
                <h3 style={{ fontSize: '1.1rem', margin: '0 0 0.75rem 0', fontWeight: 600 }}>Journal des événements QC</h3>
                {caseLogs.length === 0 ? (
                  <p style={{ margin: 0, fontSize: '0.85rem', color: '#71717a' }}>Aucun log disponible.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '180px', overflowY: 'auto', background: '#121214', padding: '0.75rem', borderRadius: '6px' }}>
                    {caseLogs.map((l) => (
                      <div key={l.id} style={{ fontSize: '0.8rem', padding: '0.25rem 0', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                        <span style={{ color: '#71717a' }}>[{new Date(l.timestamp).toLocaleTimeString()}]</span>{' '}
                        <strong style={{ color: '#3b82f6' }}>{l.action}</strong> par{' '}
                        <span style={{ color: '#a1a1aa' }}>{l.userId} ({l.userRole})</span>
                        {l.details && <div style={{ color: '#71717a', marginLeft: '0.5rem', fontStyle: 'italic' }}>{l.details}</div>}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </main>
      </div>
    </div>
  );
};
