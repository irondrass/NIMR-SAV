import React, { useState, useMemo } from 'react';
import type { User } from '@/types';
import { useSavCases } from '@/state/useSavCases';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/StatusBadge';
import { buildDeliveryReceipt } from '@/domain/print-documents';
import { hasPermission } from '@/domain/action-permissions';
import { EmptyState } from '@/components/EmptyState';
import { BlockedNotice } from '@/components/BlockedNotice';
import { getRoleFieldGuidance } from '@/domain/ui-field-guidelines';
import { useConnectivity } from '@/state/useConnectivity';
import { createOfflineAction } from '@/domain/offline-queue';

interface DeliveryViewProps {
  user: User;
}

export const DeliveryView: React.FC<DeliveryViewProps> = ({ user }) => {
  const {
    cases,
    logs,
    prepareDelivery,
    deliverCase,
    recordPrintAction,
    enqueueOfflineAction,
    saveLocalSnapshot,
  } = useSavCases();

  const { isOffline } = useConnectivity();

  // Resolve actor for delivery operations (supporting demo session if user is not livraison/admin)
  const actor = useMemo(() => {
    const isLivraison = user.role === 'livraison' || user.role === 'admin';
    return {
      id: isLivraison ? user.id : 'LIV-DEMO-001',
      name: isLivraison ? user.name : 'Livreur Démo',
      role: isLivraison && user.role !== 'admin' ? user.role : ('livraison' as const),
    };
  }, [user]);

  // Filter cases visible to Livraison (all except draft and cancelled, to show blocked/notices)
  const deliveryCases = useMemo(() => {
    return cases.filter((c) =>
      c.status !== 'draft' && c.status !== 'cancelled'
    );
  }, [cases]);

  // Selected case id for detail view
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);

  const selectedCase = useMemo(() => {
    return deliveryCases.find((c) => c.id === selectedCaseId) || null;
  }, [deliveryCases, selectedCaseId]);

  const handlePrintDeliveryReceipt = () => {
    if (!selectedCase) return;
    const html = buildDeliveryReceipt(selectedCase);
    recordPrintAction(selectedCase.id, 'delivery_receipt', actor);
    if (typeof window !== 'undefined') {
      const w = window.open('', '_blank');
      if (w) {
        w.document.write(html);
        w.document.close();
        w.print();
      }
    }
  };

  const [recipientName, setRecipientName] = useState('');
  const [proofReference, setProofReference] = useState('');
  const [notes, setNotes] = useState('');
  const [showDeliveryForm, setShowDeliveryForm] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Get logs for the selected case
  const caseLogs = useMemo(() => {
    if (!selectedCaseId) return [];
    return logs.filter((l) => l.caseId === selectedCaseId);
  }, [logs, selectedCaseId]);

  const handleSelectCase = (caseId: string) => {
    setSelectedCaseId(caseId);
    setRecipientName('');
    setProofReference('');
    setNotes('');
    setShowDeliveryForm(false);
    setErrorMsg('');
    setSuccessMsg('');
  };

  const handlePrepareDelivery = async (caseId: string) => {
    try {
      setErrorMsg('');
      setSuccessMsg('');
      prepareDelivery(caseId, actor);
      if (isOffline) {
        enqueueOfflineAction(createOfflineAction('delivery_update', { caseId, status: 'ready_delivery' }, { id: actor.id, role: actor.role }));
        saveLocalSnapshot();
        setSuccessMsg("Dossier préparé pour la livraison avec succès ! (Action locale sauvegardée)");
      } else {
        setSuccessMsg("Dossier préparé pour la livraison avec succès !");
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDeliverCase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCase) return;
    try {
      setErrorMsg('');
      setSuccessMsg('');
      const payload = {
        recipientName,
        proofReference,
        notes: notes.trim() ? notes : undefined,
      };
      deliverCase(selectedCase.id, payload, actor);
      if (isOffline) {
        enqueueOfflineAction(createOfflineAction('delivery_update', { caseId: selectedCase.id, status: 'delivered', ...payload }, { id: actor.id, role: actor.role }));
        saveLocalSnapshot();
        setSuccessMsg("Véhicule livré avec succès ! Preuve enregistrée. (Action locale sauvegardée)");
      } else {
        setSuccessMsg("Véhicule livré avec succès ! Preuve enregistrée.");
      }
      setRecipientName('');
      setProofReference('');
      setNotes('');
      setShowDeliveryForm(false);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="view-container" id="delivery-view" style={{ display: 'flex', flexDirection: 'column', gap: '1rem', padding: '1rem', color: '#fff', minHeight: '100vh', background: '#121214' }}>
      <header className="view-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '1rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 className="view-title" style={{ margin: 0, fontSize: '1.5rem', fontWeight: 600 }}>Livraison Client</h1>
          <p className="view-subtitle" style={{ margin: '0.25rem 0 0 0', color: '#a1a1aa', fontSize: '0.875rem' }}>
            {getRoleFieldGuidance('livraison')}
          </p>
          <p className="view-subtitle" style={{ margin: '0.25rem 0 0 0', color: '#a1a1aa', fontSize: '0.875rem' }}>
            Session de : <strong style={{ color: '#fff' }}>{actor.name} ({actor.role})</strong>
          </p>
          {isOffline && (
            <div style={{ marginTop: '0.75rem', padding: '0.5rem', background: 'rgba(239,68,68,0.15)', border: '1px solid #ef4444', borderRadius: '4px', color: '#fca5a5', fontSize: '0.8rem' }}>
              ⚠️ Mode hors ligne : consultation livraison via les données locales. Les actions de livraison seront sauvegardées localement.
            </div>
          )}
        </div>
      </header>

      {/* Main Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: '1rem', flex: 1, minHeight: 0 }}>
        {/* Left Side: Case list */}
        <aside style={{ background: '#1e1e24', borderRadius: '8px', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem', border: '1px solid rgba(255,255,255,0.05)' }}>
          <h2 style={{ fontSize: '1.1rem', margin: 0, fontWeight: 600 }}>Dossiers livraison ({deliveryCases.length})</h2>

          {deliveryCases.length === 0 ? (
            <EmptyState role="livraison" />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', overflowY: 'auto', flex: 1 }}>
              {deliveryCases.map((c) => (
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
            <EmptyState role="livraison" messageOverride="Sélectionnez un dossier dans la liste pour commencer ou finaliser sa livraison." />
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
                      {hasPermission(user.role, 'print_delivery_receipt') && (
                        <Button size="sm" onClick={handlePrintDeliveryReceipt}>
                          🖨️ PV Restitution
                        </Button>
                      )}
                    </div>
                    <p style={{ margin: 0, fontSize: '0.8rem', color: '#71717a' }}>
                      Reçu le : {new Date(selectedCase.receptionDate).toLocaleString()}
                    </p>
                  </div>
                </div>
              </section>

              {/* Read-Only Workshop & QC Information */}
              <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', background: 'rgba(255,255,255,0.02)', padding: '1rem', borderRadius: '6px' }}>
                <div>
                  <h4 style={{ margin: '0 0 0.25rem 0', color: '#71717a', fontSize: '0.75rem', textTransform: 'uppercase' }}>Technicien Affecté</h4>
                  <span style={{ fontSize: '0.9rem' }}>{selectedCase.assignedTechnicianName || 'Non affecté'}</span>
                </div>
                <div>
                  <h4 style={{ margin: '0 0 0.25rem 0', color: '#71717a', fontSize: '0.75rem', textTransform: 'uppercase' }}>Statut Contrôle QC</h4>
                  <span style={{ fontSize: '0.9rem', color: selectedCase.qcCheckedAt ? '#22c55e' : '#ef4444', fontWeight: 600 }}>
                    {selectedCase.qcCheckedAt ? '✓ Validé (Approuvé)' : '✗ Non approuvé'}
                  </span>
                </div>
                <div>
                  <h4 style={{ margin: '0 0 0.25rem 0', color: '#71717a', fontSize: '0.75rem', textTransform: 'uppercase' }}>Date Validation QC</h4>
                  <span style={{ fontSize: '0.9rem' }}>
                    {selectedCase.qcCheckedAt ? new Date(selectedCase.qcCheckedAt).toLocaleString() : 'Non renseignée'}
                  </span>
                </div>
                <div>
                  <h4 style={{ margin: '0 0 0.25rem 0', color: '#71717a', fontSize: '0.75rem', textTransform: 'uppercase' }}>Validateur QC</h4>
                  <span style={{ fontSize: '0.9rem' }}>{selectedCase.qcCheckedBy || 'Non renseigné'}</span>
                </div>
              </section>

              {/* Delivery Data (Prepared and Delivered info) */}
              {(selectedCase.deliveryPreparedAt || selectedCase.deliveredAt) && (
                <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', background: 'rgba(59,130,246,0.03)', border: '1px solid rgba(59,130,246,0.1)', padding: '1rem', borderRadius: '6px' }}>
                  {selectedCase.deliveryPreparedAt && (
                    <div>
                      <h4 style={{ margin: '0 0 0.25rem 0', color: '#3b82f6', fontSize: '0.75rem', textTransform: 'uppercase' }}>Préparé pour livraison le</h4>
                      <span style={{ fontSize: '0.9rem' }}>{new Date(selectedCase.deliveryPreparedAt).toLocaleString()} par {selectedCase.deliveryPreparedBy}</span>
                    </div>
                  )}
                  {selectedCase.deliveredAt && (
                    <div>
                      <h4 style={{ margin: '0 0 0.25rem 0', color: '#10b981', fontSize: '0.75rem', textTransform: 'uppercase' }}>Remis au client le</h4>
                      <span style={{ fontSize: '0.9rem' }}>{new Date(selectedCase.deliveredAt).toLocaleString()} par {selectedCase.deliveredBy}</span>
                    </div>
                  )}
                  {selectedCase.deliveryRecipientName && (
                    <div>
                      <h4 style={{ margin: '0 0 0.25rem 0', color: '#a1a1aa', fontSize: '0.75rem', textTransform: 'uppercase' }}>Réceptionnaire</h4>
                      <span style={{ fontSize: '0.9rem' }}>{selectedCase.deliveryRecipientName}</span>
                    </div>
                  )}
                  {selectedCase.deliveryProofReference && (
                    <div>
                      <h4 style={{ margin: '0 0 0.25rem 0', color: '#a1a1aa', fontSize: '0.75rem', textTransform: 'uppercase' }}>Preuve / Réf OR</h4>
                      <span style={{ fontSize: '0.9rem' }}>{selectedCase.deliveryProofReference}</span>
                    </div>
                  )}
                </section>
              )}

              {/* Delivery Notes */}
              {selectedCase.deliveryNotes && (
                <div style={{ padding: '0.75rem', background: 'rgba(255,255,255,0.02)', borderLeft: '4px solid #a1a1aa', borderRadius: '4px', fontSize: '0.9rem' }}>
                  <strong style={{ color: '#a1a1aa', display: 'block', marginBottom: '0.25rem' }}>Remarques de livraison :</strong>
                  {selectedCase.deliveryNotes}
                </div>
              )}

              {/* Blocked notice if QC not approved */}
              {selectedCase.status !== 'quality_approved' && selectedCase.status !== 'ready_delivery' && selectedCase.status !== 'delivered' && (
                <BlockedNotice status={selectedCase.status} role="livraison" />
              )}

              {/* Interactive Pilot */}
              <section style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '1.5rem' }}>
                <h3 style={{ fontSize: '1.1rem', margin: '0 0 1rem 0', fontWeight: 600 }}>Pilote de Livraison</h3>

                {selectedCase.status === 'quality_approved' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', alignItems: 'flex-start' }}>
                    <p style={{ margin: 0, fontSize: '0.9rem', color: '#a1a1aa' }}>
                      Le contrôle qualité de ce dossier a été validé. Vous pouvez préparer le véhicule pour livraison afin d'éditer la preuve finale.
                    </p>
                    <Button onClick={() => handlePrepareDelivery(selectedCase.id)} id="btn-prepare-delivery">
                      📦 Préparer la livraison
                    </Button>
                  </div>
                )}

                {selectedCase.status === 'ready_delivery' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                    {!showDeliveryForm ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', alignItems: 'flex-start' }}>
                        <p style={{ margin: 0, fontSize: '0.9rem', color: '#a1a1aa' }}>
                          Le véhicule est prêt à être livré. Veuillez saisir les informations de remise client pour valider la livraison.
                        </p>
                        <Button onClick={() => setShowDeliveryForm(true)} id="btn-show-delivery-form">
                          ✍️ Signer & Valider la livraison
                        </Button>
                      </div>
                    ) : (
                      <form onSubmit={handleDeliverCase} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', padding: '1rem', background: 'rgba(59,130,246,0.03)', border: '1px solid rgba(59,130,246,0.1)', borderRadius: '6px' }} id="delivery-form">
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                            <label style={{ fontSize: '0.85rem', fontWeight: 600 }} htmlFor="recipient-name">
                              Nom du réceptionnaire client *
                            </label>
                            <input
                              type="text"
                              id="recipient-name"
                              value={recipientName}
                              onChange={(e) => setRecipientName(e.target.value)}
                              placeholder="Ex: M. Dupont"
                              style={{
                                padding: '0.5rem',
                                borderRadius: '4px',
                                background: '#121214',
                                border: '1px solid rgba(255,255,255,0.15)',
                                color: '#fff',
                                fontSize: '0.9rem',
                              }}
                              required
                            />
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                            <label style={{ fontSize: '0.85rem', fontWeight: 600 }} htmlFor="proof-ref">
                              Référence de la preuve (OR) *
                            </label>
                            <input
                              type="text"
                              id="proof-ref"
                              value={proofReference}
                              onChange={(e) => setProofReference(e.target.value)}
                              placeholder="Ex: PREUVE-2026-009"
                              style={{
                                padding: '0.5rem',
                                borderRadius: '4px',
                                background: '#121214',
                                border: '1px solid rgba(255,255,255,0.15)',
                                color: '#fff',
                                fontSize: '0.9rem',
                              }}
                              required
                            />
                          </div>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                          <label style={{ fontSize: '0.85rem', fontWeight: 600 }} htmlFor="delivery-notes">
                            Remarques / Remontées client
                          </label>
                          <textarea
                            id="delivery-notes"
                            rows={3}
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            placeholder="Saisir d'éventuelles remarques..."
                            style={{
                              padding: '0.5rem',
                              borderRadius: '4px',
                              background: '#121214',
                              border: '1px solid rgba(255,255,255,0.15)',
                              color: '#fff',
                              fontSize: '0.9rem',
                              resize: 'vertical',
                            }}
                          />
                        </div>

                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <Button
                            type="submit"
                            disabled={!recipientName.trim() || !proofReference.trim()}
                            style={{ background: '#10b981', color: '#000' }}
                            id="btn-confirm-delivery"
                          >
                            Valider la remise du véhicule
                          </Button>
                          <Button
                            type="button"
                            onClick={() => {
                              setShowDeliveryForm(false);
                              setRecipientName('');
                              setProofReference('');
                              setNotes('');
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

                {selectedCase.status === 'delivered' && (
                  <div style={{ padding: '1rem', background: 'rgba(16,185,129,0.05)', border: '1px dashed rgba(16,185,129,0.2)', borderRadius: '6px', fontSize: '0.9rem', color: '#4ade80' }}>
                    ✓ Le véhicule a été livré et remis au client. Les opérations de SAV sont officiellement closes pour la livraison.
                  </div>
                )}
              </section>

              {/* Audit logs summary for the case */}
              <section style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '1.5rem' }}>
                <h3 style={{ fontSize: '1.1rem', margin: '0 0 0.75rem 0', fontWeight: 600 }}>Journal des événements Livraison</h3>
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
