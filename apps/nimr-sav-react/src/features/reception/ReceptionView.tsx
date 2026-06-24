import React, { useState, useMemo } from 'react';
import type { User } from '@/types';
import { useSavCases } from '@/state/useSavCases';
import { RECEPTION_PRESETS } from '@/constants/reception-presets';
import { validateFictiveFields } from '@/domain/validation-rules';
import { transitionCase } from '@/domain/workflow-engine';
import { createAuditLog } from '@/domain/audit-log';
import { SavCase } from '@/domain/sav-case';
import { hasPermission, canViewDirectionNotes } from '@/domain/action-permissions';
import { Button } from '@/components/ui/Button';

interface ReceptionViewProps {
  user: User;
}

export const ReceptionView: React.FC<ReceptionViewProps> = ({ user }) => {
  const { cases, logs, addCase, addLog } = useSavCases();

  // Form states
  const [immatriculation, setImmatriculation] = useState('DEMO-');
  const [vin, setVin] = useState('VIN-DEMO-');
  const [clientName, setClientName] = useState('Client Démo ');
  const [telephone, setTelephone] = useState('00000000');
  const [kilometrage, setKilometrage] = useState<number | ''>('');
  const [modele, setModele] = useState('');
  const [motif, setMotif] = useState('');
  const [typeIntervention, setTypeIntervention] = useState('mecanique');
  const [priorite, setPriorite] = useState('normale');
  const [observations, setObservations] = useState('');
  const [formError, setFormError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Active view tab in list panel
  const [activeListTab, setActiveListTab] = useState<'drafts' | 'received_today' | 'logs'>('drafts');

  // Authorization checks
  const canCreate = hasPermission(user.role, 'create_case');
  const canReceive = hasPermission(user.role, 'receive_case');
  const canViewNotes = canViewDirectionNotes(user.role);

  // Compute lists
  const drafts = useMemo(() => cases.filter((c) => c.status === 'draft'), [cases]);

  const receivedToday = useMemo(() => {
    const todayStr = new Date().toISOString().split('T')[0];
    return cases.filter(
      (c) => c.status === 'received' && c.receptionDate.startsWith(todayStr)
    );
  }, [cases]);

  // Form helper: reset fields
  const handleResetForm = () => {
    setImmatriculation('DEMO-');
    setVin('VIN-DEMO-');
    setClientName('Client Démo ');
    setTelephone('00000000');
    setKilometrage('');
    setModele('');
    setMotif('');
    setTypeIntervention('mecanique');
    setPriorite('normale');
    setObservations('');
    setFormError('');
  };

  // Form validator
  const validateForm = (): boolean => {
    if (!immatriculation.trim()) {
      setFormError('L\'immatriculation est requise.');
      return false;
    }
    if (!vin.trim()) {
      setFormError('Le VIN est requis.');
      return false;
    }
    if (!clientName.trim()) {
      setFormError('Le nom du client est requis.');
      return false;
    }
    if (!telephone.trim()) {
      setFormError('Le numéro de téléphone est requis.');
      return false;
    }
    if (kilometrage === '' || kilometrage < 0) {
      setFormError('Un kilométrage valide est requis.');
      return false;
    }
    if (!modele.trim()) {
      setFormError('Le modèle du véhicule est requis.');
      return false;
    }
    if (!motif) {
      setFormError('Veuillez sélectionner un motif de réception.');
      return false;
    }

    // Strict fictive validation
    const fictiveError = validateFictiveFields({
      immatriculation,
      vin,
      clientName,
      telephone,
    });

    if (fictiveError) {
      setFormError(fictiveError);
      return false;
    }

    setFormError('');
    return true;
  };

  // Handler: Create Draft Case
  const handleCreateDraft = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;

    const newCaseId = `case-${Date.now()}`;
    const newCase: SavCase = {
      id: newCaseId,
      immatriculation: immatriculation.trim(),
      vin: vin.trim(),
      clientName: clientName.trim(),
      telephone: telephone.trim(),
      status: 'draft',
      receptionDate: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      directionNotes: canViewNotes ? 'Observations direction SAV' : undefined,
    };

    // Save case & audit log
    addCase(newCase);

    const creationLog = createAuditLog(
      newCaseId,
      user.id,
      user.role,
      'create_case',
      undefined,
      'draft',
      `Dossier brouillon créé pour le véhicule ${modele} (${immatriculation}). Motif: ${motif}. Kilométrage: ${kilometrage} km.`
    );
    addLog(creationLog);

    setSuccessMsg(`Dossier brouillon ${newCaseId} créé avec succès !`);
    handleResetForm();
    setTimeout(() => setSuccessMsg(''), 5000);
  };

  // Handler: Receive directement (Draft -> Received)
  const handleReceiveDirectly = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;

    const newCaseId = `case-${Date.now()}`;
    const draftCase: SavCase = {
      id: newCaseId,
      immatriculation: immatriculation.trim(),
      vin: vin.trim(),
      clientName: clientName.trim(),
      telephone: telephone.trim(),
      status: 'draft',
      receptionDate: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      directionNotes: canViewNotes ? 'Observations direction SAV' : undefined,
    };

    // 1. Log create_case
    addCase(draftCase);
    const creationLog = createAuditLog(
      newCaseId,
      user.id,
      user.role,
      'create_case',
      undefined,
      'draft',
      `Dossier brouillon créé automatiquement avant réception.`
    );
    addLog(creationLog);

    // 2. Transition draft -> received
    const result = transitionCase(draftCase, 'received', user);
    if (result.success && result.updatedCase && result.auditLog) {
      addCase(result.updatedCase);
      addLog(result.auditLog);
      setSuccessMsg(`Dossier ${newCaseId} créé et réceptionné avec succès !`);
      handleResetForm();
      setTimeout(() => setSuccessMsg(''), 5000);
    } else {
      setFormError(result.error || 'Erreur lors de la transition de réception.');
    }
  };

  // Handler: Receptionner an existing draft case from list
  const handleReceiveDraft = (draftCase: SavCase) => {
    const result = transitionCase(draftCase, 'received', user);
    if (result.success && result.updatedCase && result.auditLog) {
      addCase(result.updatedCase);
      addLog(result.auditLog);
      setSuccessMsg(`Dossier ${draftCase.id} réceptionné avec succès !`);
      setTimeout(() => setSuccessMsg(''), 5000);
    } else {
      alert(result.error || 'Erreur lors de la transition de réception.');
    }
  };

  if (!canCreate || !canReceive) {
    return (
      <div className="view-container">
        <header className="view-header">
          <h1 className="view-title">Accès non autorisé</h1>
        </header>
        <main className="view-main">
          <div className="form-error" style={{ padding: '1rem', borderRadius: '4px' }}>
            Votre rôle ({user.role}) ne dispose pas des permissions requises pour accéder à la Réception.
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="view-container" id="reception-view" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem', padding: '1rem' }}>

      {/* Left panel: Form */}
      <div className="reception-form-container" style={{ background: 'rgba(255,255,255,0.05)', padding: '1.5rem', borderRadius: '8px' }}>
        <h2 style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '0.5rem', marginBottom: '1.5rem' }}>
          Réception de véhicule
        </h2>

        {successMsg && (
          <div className="success-msg" style={{ background: '#1b5e20', color: '#fff', padding: '0.75rem', borderRadius: '4px', marginBottom: '1rem' }}>
            {successMsg}
          </div>
        )}

        {formError && (
          <div className="form-error" style={{ background: '#b71c1c', color: '#fff', padding: '0.75rem', borderRadius: '4px', marginBottom: '1rem' }}>
            {formError}
          </div>
        )}

        <form onSubmit={handleCreateDraft} noValidate style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

          <div className="form-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>

            <div className="form-group">
              <label className="form-label">Immatriculation Démo *</label>
              <input
                type="text"
                className="form-input"
                value={immatriculation}
                onChange={(e) => setImmatriculation(e.target.value)}
                placeholder="DEMO-..."
              />
            </div>

            <div className="form-group">
              <label className="form-label">VIN Démo *</label>
              <input
                type="text"
                className="form-input"
                value={vin}
                onChange={(e) => setVin(e.target.value)}
                placeholder="VIN-DEMO-..."
              />
            </div>

            <div className="form-group">
              <label className="form-label">Nom Client Démo *</label>
              <input
                type="text"
                className="form-input"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                placeholder="Client Démo..."
              />
            </div>

            <div className="form-group">
              <label className="form-label">Téléphone Démo *</label>
              <input
                type="text"
                className="form-input"
                value={telephone}
                onChange={(e) => setTelephone(e.target.value)}
                placeholder="00000000"
              />
            </div>

            <div className="form-group">
              <label className="form-label">Modèle Véhicule *</label>
              <input
                type="text"
                className="form-input"
                value={modele}
                onChange={(e) => setModele(e.target.value)}
                placeholder="Modèle"
              />
            </div>

            <div className="form-group">
              <label className="form-label">Kilométrage *</label>
              <input
                type="number"
                className="form-input"
                value={kilometrage}
                onChange={(e) => setKilometrage(e.target.value === '' ? '' : Number(e.target.value))}
                placeholder="Kilométrage"
              />
            </div>

          </div>

          <div className="form-group">
            <label className="form-label">Motif de Réception (Presets) *</label>
            <select
              className="form-select"
              value={motif}
              onChange={(e) => setMotif(e.target.value)}
            >
              <option value="">— Sélectionner un motif —</option>
              {RECEPTION_PRESETS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>

          <div className="form-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>

            <div className="form-group">
              <label className="form-label">Type Intervention</label>
              <select
                className="form-select"
                value={typeIntervention}
                onChange={(e) => setTypeIntervention(e.target.value)}
              >
                <option value="mecanique">Mécanique</option>
                <option value="carrosserie">Carrosserie</option>
                <option value="electrique">Électrique</option>
                <option value="entretien">Entretien</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Priorité</label>
              <select
                className="form-select"
                value={priorite}
                onChange={(e) => setPriorite(e.target.value)}
              >
                <option value="basse">Basse</option>
                <option value="normale">Normale</option>
                <option value="haute">Haute</option>
              </select>
            </div>

          </div>

          <div className="form-group">
            <label className="form-label">Observations Réception</label>
            <textarea
              className="form-input"
              value={observations}
              onChange={(e) => setObservations(e.target.value)}
              placeholder="Observations supplémentaires..."
              rows={3}
              style={{ resize: 'vertical' }}
            />
          </div>

          <div className="form-actions" style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
            <Button type="submit" variant="ghost" style={{ flex: 1 }}>
              Créer dossier (Brouillon)
            </Button>
            <Button type="button" variant="primary" onClick={handleReceiveDirectly} style={{ flex: 1 }}>
              Réceptionner dossier
            </Button>
          </div>

        </form>
      </div>

      {/* Right panel: Lists */}
      <div className="reception-lists-container" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

        {/* Navigation tabs */}
        <div className="list-tabs" style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.1)', gap: '1rem', paddingBottom: '0.25rem' }}>
          <button
            onClick={() => setActiveListTab('drafts')}
            style={{
              background: 'none',
              border: 'none',
              color: activeListTab === 'drafts' ? '#2196f3' : '#aaa',
              borderBottom: activeListTab === 'drafts' ? '2px solid #2196f3' : 'none',
              padding: '0.5rem 1rem',
              cursor: 'pointer',
              fontWeight: activeListTab === 'drafts' ? 'bold' : 'normal'
            }}
          >
            Brouillons ({drafts.length})
          </button>

          <button
            onClick={() => setActiveListTab('received_today')}
            style={{
              background: 'none',
              border: 'none',
              color: activeListTab === 'received_today' ? '#4caf50' : '#aaa',
              borderBottom: activeListTab === 'received_today' ? '2px solid #4caf50' : 'none',
              padding: '0.5rem 1rem',
              cursor: 'pointer',
              fontWeight: activeListTab === 'received_today' ? 'bold' : 'normal'
            }}
          >
            Reçus aujourd'hui ({receivedToday.length})
          </button>

          <button
            onClick={() => setActiveListTab('logs')}
            style={{
              background: 'none',
              border: 'none',
              color: activeListTab === 'logs' ? '#ff9800' : '#aaa',
              borderBottom: activeListTab === 'logs' ? '2px solid #ff9800' : 'none',
              padding: '0.5rem 1rem',
              cursor: 'pointer',
              fontWeight: activeListTab === 'logs' ? 'bold' : 'normal'
            }}
          >
            Logs d'Audit ({logs.length})
          </button>
        </div>

        {/* Tab contents */}
        <div className="list-content" style={{ flex: 1, maxHeight: '500px', overflowY: 'auto' }}>

          {activeListTab === 'drafts' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {drafts.length === 0 ? (
                <p style={{ color: '#888', fontStyle: 'italic' }}>Aucun dossier en brouillon.</p>
              ) : (
                drafts.map((c) => (
                  <div key={c.id} style={{ background: 'rgba(255,255,255,0.03)', padding: '1rem', borderRadius: '6px', borderLeft: '4px solid #9e9e9e', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <h4 style={{ margin: 0 }}>{c.immatriculation} — {c.vin}</h4>
                      <p style={{ margin: '0.25rem 0 0', fontSize: '0.85rem', color: '#aaa' }}>
                        Client : {c.clientName} | Téléphone : {c.telephone}
                      </p>
                      <p style={{ margin: '0.25rem 0 0', fontSize: '0.8rem', color: '#888' }}>
                        Créé le : {new Date(c.createdAt).toLocaleTimeString()}
                      </p>
                    </div>
                    <Button size="sm" onClick={() => handleReceiveDraft(c)}>
                      Réceptionner
                    </Button>
                  </div>
                ))
              )}
            </div>
          )}

          {activeListTab === 'received_today' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {receivedToday.length === 0 ? (
                <p style={{ color: '#888', fontStyle: 'italic' }}>Aucun véhicule réceptionné aujourd'hui.</p>
              ) : (
                receivedToday.map((c) => (
                  <div key={c.id} style={{ background: 'rgba(255,255,255,0.03)', padding: '1rem', borderRadius: '6px', borderLeft: '4px solid #4caf50' }}>
                    <h4 style={{ margin: 0 }}>{c.immatriculation} — {c.vin}</h4>
                    <p style={{ margin: '0.25rem 0 0', fontSize: '0.85rem', color: '#aaa' }}>
                      Client : {c.clientName} | Statut : <span style={{ color: '#4caf50' }}>{c.status}</span>
                    </p>
                    <p style={{ margin: '0.25rem 0 0', fontSize: '0.8rem', color: '#888' }}>
                      Réceptionné à : {new Date(c.receptionDate).toLocaleTimeString()}
                    </p>
                  </div>
                ))
              )}
            </div>
          )}

          {activeListTab === 'logs' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {logs.length === 0 ? (
                <p style={{ color: '#888', fontStyle: 'italic' }}>Aucun log d'audit disponible.</p>
              ) : (
                logs.map((log) => (
                  <div key={log.id} style={{ background: 'rgba(255,255,255,0.02)', padding: '0.75rem', borderRadius: '4px', fontSize: '0.85rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: '#ff9800', marginBottom: '0.25rem' }}>
                      <span><strong>{log.action}</strong></span>
                      <span style={{ color: '#888' }}>{new Date(log.timestamp).toLocaleTimeString()}</span>
                    </div>
                    <p style={{ margin: 0, color: '#ddd' }}>{log.details}</p>
                    <p style={{ margin: '0.25rem 0 0', fontSize: '0.75rem', color: '#888' }}>
                      Acteur : {log.userRole} (ID: {log.userId})
                      {log.fromStatus && ` | Transition: ${log.fromStatus} -> ${log.toStatus}`}
                    </p>
                  </div>
                ))
              )}
            </div>
          )}

        </div>

      </div>

    </div>
  );
};
