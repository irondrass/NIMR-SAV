import React, { useState, useMemo } from 'react';
import type { User } from '@/types';
import { useSavCases } from '@/state/useSavCases';
import { RECEPTION_PRESETS } from '@/constants/reception-presets';
import { validateFictiveFields } from '@/domain/validation-rules';
import { transitionCase } from '@/domain/workflow-engine';
import { createAuditLog } from '@/domain/audit-log';
import { SavCase, Claim, CasePhoto } from '@/domain/sav-case';
import { getBlockingClaimsReasons } from '@/domain/claims';
import { hasPermission, canViewDirectionNotes } from '@/domain/action-permissions';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/EmptyState';
import { StatusBadge } from '@/components/StatusBadge';
import { VersionBanner } from '@/components/VersionBanner';
import { getRoleFieldGuidance } from '@/domain/ui-field-guidelines';
import {
  buildReceptionSheet,
  buildDeliveryReceipt
} from '@/domain/print-documents';
import {
  buildCompleteCaseBundle,
  downloadExportBundle,
  getExportWarnings
} from '@/domain/export-bundle';
import {
  collectCasePhotos
} from '@/domain/photo-export';

interface ReceptionViewProps {
  user: User;
}

export const ReceptionView: React.FC<ReceptionViewProps> = ({ user }) => {
  const {
    cases,
    logs,
    addCase,
    addLog,
    addClaim,
    updateClaim,
    approveClaimExpert,
    approveClaimClient,
    rejectClaim,
    cancelClaim,
    importEstimateForClaim,
    removeEstimateFromClaim,
    regenerateWorkshopTasksFromClaimEstimate,
    addPhotoToCase,
    removePhotoFromCase,
    recordPrintAction,
    recordExportAction,
  } = useSavCases();

  // Form states
  const [immatriculation, setImmatriculation] = useState('');
  const [vin, setVin] = useState('');
  const [clientName, setClientName] = useState('');
  const [telephone, setTelephone] = useState('');
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

  // Claims state
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [showAddClaimForm, setShowAddClaimForm] = useState(false);
  const [claimLabel, setClaimLabel] = useState('');
  const [claimType, setClaimType] = useState<'insurance' | 'customer' | 'warranty' | 'internal'>('insurance');
  const [pasteTextMap, setPasteTextMap] = useState<Record<string, string>>({});
  const [showPasteMap, setShowPasteMap] = useState<Record<string, boolean>>({});
  const [claimDescription, setClaimDescription] = useState('');
  const [claimAmount, setClaimAmount] = useState<number | ''>('');

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

  const selectedCase = useMemo(() => {
    if (!selectedCaseId) return null;
    return cases.find((c) => c.id === selectedCaseId) || null;
  }, [cases, selectedCaseId]);

  const handlePrint = (type: 'reception_sheet' | 'delivery_receipt') => {
    if (!selectedCase) return;
    let html = '';
    if (type === 'reception_sheet') {
      html = buildReceptionSheet(selectedCase);
    } else {
      html = buildDeliveryReceipt(selectedCase);
    }

    recordPrintAction(selectedCase.id, type, user);

    if (typeof window !== 'undefined') {
      const w = window.open('', '_blank');
      if (w) {
        w.document.write(html);
        w.document.close();
        w.print();
      }
    }
  };

  const handleExport = () => {
    if (!selectedCase) return;
    const bundle = buildCompleteCaseBundle(selectedCase, user.id);
    recordExportAction(selectedCase.id, user);
    downloadExportBundle(bundle);
  };

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>, category: 'before' | 'during' | 'after' | 'claim' | 'estimate' | 'quality' | 'delivery' | 'other') => {
    if (!selectedCase) return;
    const files = e.target.files;
    if (!files || files.length === 0) return;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        addPhotoToCase(
          selectedCase.id,
          {
            name: file.name,
            type: file.type,
            size: file.size,
            category,
            dataUrl,
          },
          user
        );
      };
      reader.readAsDataURL(file);
    }
  };

  const handleAddMockPhoto = (category: 'before' | 'during' | 'after' | 'claim' | 'estimate' | 'quality' | 'delivery' | 'other') => {
    if (!selectedCase) return;
    const mockBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const dataUrl = `data:image/png;base64,${mockBase64}`;
    addPhotoToCase(
      selectedCase.id,
      {
        name: `mock_photo_${category}_${Date.now()}.png`,
        type: 'image/png',
        size: 68,
        category,
        dataUrl,
      },
      user
    );
  };

  // Form helper: reset fields
  const handleResetForm = () => {
    setImmatriculation('');
    setVin('');
    setClientName('');
    setTelephone('');
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
    if (!clientName.trim()) {
      setFormError('Le nom du client est requis.');
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

    // Relaxed validation
    const fictiveError = validateFictiveFields({
      immatriculation,
      vin: vin || undefined,
      clientName,
      telephone: telephone || undefined,
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

  const handleAddClaimSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCaseId) return;
    if (!claimLabel.trim()) {
      alert('Veuillez renseigner un libellé.');
      return;
    }
    const defaultPayer: Record<string, 'assurance' | 'client' | 'garantie' | 'interne'> = {
      insurance: 'assurance',
      customer: 'client',
      warranty: 'garantie',
      internal: 'interne',
    };
    const payerType = defaultPayer[claimType];
    const newClaim: Partial<Claim> = {
      id: `claim-${Date.now()}`,
      label: claimLabel.trim(),
      claimType,
      payerType,
      status: claimType === 'insurance' ? 'expert_pending' : claimType === 'customer' ? 'client_pending' : 'approved',
      description: claimDescription.trim(),
      estimatedAmount: claimAmount === '' ? 0 : Number(claimAmount),
      expertApproved: false,
      clientApproved: false,
      requiredApprovals: claimType === 'insurance' ? ['expert', 'client'] : claimType === 'customer' ? ['client'] : ['internal'],
    };

    try {
      addClaim(selectedCaseId, newClaim, user);
      setClaimLabel('');
      setClaimDescription('');
      setClaimAmount('');
      setShowAddClaimForm(false);
    } catch (err) {
      alert((err as Error).message || 'Erreur lors de l\'ajout du sinistre.');
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
    <div
      className="view-container"
      id="reception-view"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '1.5rem',
        padding: '1.5rem',
        background: '#121214',
        color: '#fff',
        minHeight: '100vh',
        fontFamily: 'Inter, sans-serif',
      }}
    >
      <header className="view-header" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '1rem' }}>
        <h1 className="view-title" style={{ margin: 0, fontSize: '1.75rem', fontWeight: 700 }}>
          Réception SAV
        </h1>
        <p className="view-subtitle" style={{ margin: '0.25rem 0 0 0', color: '#a1a1aa', fontSize: '0.9rem' }}>
          créer et qualifier un dossier atelier
        </p>
        <div style={{ marginTop: '0.75rem', fontSize: '0.85rem', color: '#3b82f6', fontStyle: 'italic' }}>
          {getRoleFieldGuidance(user.role)}
        </div>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
        {/* Left panel: Form */}
        <div
          className="reception-form-container"
          style={{
            background: 'rgba(255,255,255,0.03)',
            padding: '1.5rem',
            borderRadius: '8px',
            border: '1px solid rgba(255,255,255,0.05)',
          }}
        >
          <h2 style={{ fontSize: '1.25rem', fontWeight: 600, paddingBottom: '0.5rem', marginBottom: '1.5rem', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
            Nouveau dossier de prise en charge
          </h2>

          {successMsg && (
            <div
              className="success-msg"
              style={{
                background: '#1b5e20',
                color: '#fff',
                padding: '0.75rem',
                borderRadius: '4px',
                marginBottom: '1rem',
                fontSize: '0.9rem',
              }}
            >
              {successMsg}
            </div>
          )}

          {formError && (
            <div
              className="form-error"
              style={{
                background: '#b71c1c',
                color: '#fff',
                padding: '0.75rem',
                borderRadius: '4px',
                marginBottom: '1rem',
                fontSize: '0.9rem',
              }}
            >
              {formError}
            </div>
          )}

          <form onSubmit={handleCreateDraft} noValidate style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div className="form-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div className="form-group">
                <label className="form-label" style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.85rem', color: '#a1a1aa' }}>Immatriculation Démo *</label>
                <input
                  type="text"
                  className="form-input"
                  value={immatriculation}
                  onChange={(e) => setImmatriculation(e.target.value)}
                  placeholder="DEMO-..."
                  style={{ width: '100%', padding: '0.6rem', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.15)', background: '#18181b', color: '#fff' }}
                />
              </div>

              <div className="form-group">
                <label className="form-label" style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.85rem', color: '#a1a1aa' }}>VIN Démo *</label>
                <input
                  type="text"
                  className="form-input"
                  value={vin}
                  onChange={(e) => setVin(e.target.value)}
                  placeholder="VIN-DEMO-..."
                  style={{ width: '100%', padding: '0.6rem', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.15)', background: '#18181b', color: '#fff' }}
                />
              </div>

              <div className="form-group">
                <label className="form-label" style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.85rem', color: '#a1a1aa' }}>Nom Client Démo *</label>
                <input
                  type="text"
                  className="form-input"
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  placeholder="Client Démo..."
                  style={{ width: '100%', padding: '0.6rem', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.15)', background: '#18181b', color: '#fff' }}
                />
              </div>

              <div className="form-group">
                <label className="form-label" style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.85rem', color: '#a1a1aa' }}>Téléphone Démo *</label>
                <input
                  type="text"
                  className="form-input"
                  value={telephone}
                  onChange={(e) => setTelephone(e.target.value)}
                  placeholder="00000000"
                  style={{ width: '100%', padding: '0.6rem', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.15)', background: '#18181b', color: '#fff' }}
                />
              </div>

              <div className="form-group">
                <label className="form-label" style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.85rem', color: '#a1a1aa' }}>Modèle Véhicule *</label>
                <input
                  type="text"
                  className="form-input"
                  value={modele}
                  onChange={(e) => setModele(e.target.value)}
                  placeholder="Modèle"
                  style={{ width: '100%', padding: '0.6rem', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.15)', background: '#18181b', color: '#fff' }}
                />
              </div>

              <div className="form-group">
                <label className="form-label" style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.85rem', color: '#a1a1aa' }}>Kilométrage *</label>
                <input
                  type="number"
                  className="form-input"
                  value={kilometrage}
                  onChange={(e) => setKilometrage(e.target.value === '' ? '' : Number(e.target.value))}
                  placeholder="Kilométrage"
                  style={{ width: '100%', padding: '0.6rem', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.15)', background: '#18181b', color: '#fff' }}
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label" style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.85rem', color: '#a1a1aa' }}>Motif de Réception (Presets) *</label>
              <select
                className="form-select"
                value={motif}
                onChange={(e) => setMotif(e.target.value)}
                style={{ width: '100%', padding: '0.6rem', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.15)', background: '#18181b', color: '#fff' }}
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
                <label className="form-label" style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.85rem', color: '#a1a1aa' }}>Type Intervention</label>
                <select
                  className="form-select"
                  value={typeIntervention}
                  onChange={(e) => setTypeIntervention(e.target.value)}
                  style={{ width: '100%', padding: '0.6rem', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.15)', background: '#18181b', color: '#fff' }}
                >
                  <option value="mecanique">Mécanique</option>
                  <option value="carrosserie">Carrosserie</option>
                  <option value="electrique">Électrique</option>
                  <option value="entretien">Entretien</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label" style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.85rem', color: '#a1a1aa' }}>Priorité</label>
                <select
                  className="form-select"
                  value={priorite}
                  onChange={(e) => setPriorite(e.target.value)}
                  style={{ width: '100%', padding: '0.6rem', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.15)', background: '#18181b', color: '#fff' }}
                >
                  <option value="basse">Basse</option>
                  <option value="normale">Normale</option>
                  <option value="haute">Haute</option>
                </select>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label" style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.85rem', color: '#a1a1aa' }}>Observations Réception</label>
              <textarea
                className="form-input"
                value={observations}
                onChange={(e) => setObservations(e.target.value)}
                placeholder="Observations supplémentaires..."
                rows={3}
                style={{ width: '100%', padding: '0.6rem', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.15)', background: '#18181b', color: '#fff', resize: 'vertical' }}
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
        <div
          className="reception-lists-container"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '1.5rem',
            background: 'rgba(255,255,255,0.01)',
            padding: '1.5rem',
            borderRadius: '8px',
            border: '1px solid rgba(255,255,255,0.03)',
          }}
        >
          {/* Navigation tabs */}
          <div
            className="list-tabs"
            style={{
              display: 'flex',
              borderBottom: '1px solid rgba(255,255,255,0.1)',
              gap: '1rem',
              paddingBottom: '0.25rem',
            }}
          >
            <button
              onClick={() => setActiveListTab('drafts')}
              style={{
                background: 'none',
                border: 'none',
                color: activeListTab === 'drafts' ? '#3b82f6' : '#888',
                borderBottom: activeListTab === 'drafts' ? '2px solid #3b82f6' : 'none',
                padding: '0.5rem 1rem',
                cursor: 'pointer',
                fontWeight: activeListTab === 'drafts' ? 'bold' : 'normal',
              }}
            >
              Brouillons ({drafts.length})
            </button>

            <button
              onClick={() => setActiveListTab('received_today')}
              style={{
                background: 'none',
                border: 'none',
                color: activeListTab === 'received_today' ? '#10b981' : '#888',
                borderBottom: activeListTab === 'received_today' ? '2px solid #10b981' : 'none',
                padding: '0.5rem 1rem',
                cursor: 'pointer',
                fontWeight: activeListTab === 'received_today' ? 'bold' : 'normal',
              }}
            >
              Reçus aujourd'hui ({receivedToday.length})
            </button>

            <button
              onClick={() => setActiveListTab('logs')}
              style={{
                background: 'none',
                border: 'none',
                color: activeListTab === 'logs' ? '#f59e0b' : '#888',
                borderBottom: activeListTab === 'logs' ? '2px solid #f59e0b' : 'none',
                padding: '0.5rem 1rem',
                cursor: 'pointer',
                fontWeight: activeListTab === 'logs' ? 'bold' : 'normal',
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
                  <EmptyState role="reception" messageOverride="Aucun dossier en brouillon." />
                ) : (
                  drafts.map((c) => (
                    <div
                      key={c.id}
                      style={{
                        background: 'rgba(255,255,255,0.03)',
                        padding: '1rem',
                        borderRadius: '6px',
                        borderLeft: '4px solid #9e9e9e',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <div>
                        <h4 style={{ margin: 0, fontSize: '0.95rem' }}>
                          {c.immatriculation} — {c.vin}
                        </h4>
                        <p style={{ margin: '0.25rem 0 0', fontSize: '0.85rem', color: '#aaa' }}>
                          Client : {c.clientName} | Tél : {c.telephone}
                        </p>
                        <p style={{ margin: '0.25rem 0 0', fontSize: '0.8rem', color: '#888' }}>
                          Créé le : {new Date(c.createdAt).toLocaleTimeString()}
                        </p>
                      </div>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <Button size="sm" variant="ghost" onClick={() => setSelectedCaseId(c.id)}>
                          Claims {c.claims && c.claims.length > 0 ? `(${c.claims.length})` : ''}
                        </Button>
                        <Button size="sm" onClick={() => handleReceiveDraft(c)}>
                          Réceptionner
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {activeListTab === 'received_today' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {receivedToday.length === 0 ? (
                  <EmptyState role="reception" messageOverride="Aucun véhicule réceptionné aujourd'hui." />
                ) : (
                  receivedToday.map((c) => (
                    <div
                      key={c.id}
                      style={{
                        background: 'rgba(255,255,255,0.03)',
                        padding: '1rem',
                        borderRadius: '6px',
                        borderLeft: '4px solid #10b981',
                      }}
                    >
                      <h4 style={{ margin: 0, fontSize: '0.95rem' }}>
                        {c.immatriculation} — {c.vin}
                      </h4>
                      <div
                        style={{
                          margin: '0.25rem 0 0',
                          fontSize: '0.85rem',
                          color: '#aaa',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.5rem',
                          flexWrap: 'wrap',
                        }}
                      >
                        <span>Client : {c.clientName}</span>
                        <span>|</span>
                        <span>
                          Statut : <StatusBadge status={c.status} />
                        </span>
                      </div>
                      <p style={{ margin: '0.25rem 0 0', fontSize: '0.8rem', color: '#888' }}>
                        Réceptionné à : {new Date(c.receptionDate).toLocaleTimeString()}
                      </p>
                      <div style={{ marginTop: '0.5rem', display: 'flex', justifyContent: 'flex-end' }}>
                        <Button size="sm" variant="ghost" onClick={() => setSelectedCaseId(c.id)}>
                          Gérer les Claims {c.claims && c.claims.length > 0 ? `(${c.claims.length})` : ''}
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {activeListTab === 'logs' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {logs.length === 0 ? (
                  <EmptyState role="reception" messageOverride="Aucun log d'audit disponible." />
                ) : (
                  logs.map((log) => (
                    <div
                      key={log.id}
                      style={{
                        background: 'rgba(255,255,255,0.02)',
                        padding: '0.75rem',
                        borderRadius: '4px',
                        fontSize: '0.85rem',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', color: '#f59e0b', marginBottom: '0.25rem' }}>
                        <span>
                          <strong>{log.action}</strong>
                        </span>
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

          {/* Claims / Sinistres management panel */}
          {selectedCase && (
            <div
              style={{
                marginTop: '1.5rem',
                padding: '1rem',
                background: 'rgba(255,255,255,0.02)',
                borderRadius: '6px',
                border: '1px solid rgba(255,255,255,0.05)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Sinistres / OR — {selectedCase.immatriculation}</h3>
                <Button size="sm" onClick={() => setShowAddClaimForm(!showAddClaimForm)}>
                  {showAddClaimForm ? 'Masquer' : 'Ajouter un Sinistre'}
                </Button>
              </div>

              {/* Add Claim Form */}
              {showAddClaimForm && (
                <form onSubmit={handleAddClaimSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1rem', paddingBottom: '1rem', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.8rem', color: '#a1a1aa', marginBottom: '0.25rem' }}>Libellé *</label>
                    <input
                      type="text"
                      value={claimLabel}
                      onChange={(e) => setClaimLabel(e.target.value)}
                      placeholder="e.g. Réparation pare-chocs"
                      style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.15)', background: '#18181b', color: '#fff', fontSize: '0.85rem' }}
                    />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.8rem', color: '#a1a1aa', marginBottom: '0.25rem' }}>Type de sinistre</label>
                      <select
                        value={claimType}
                        onChange={(e) => setClaimType(e.target.value as 'insurance' | 'customer' | 'warranty' | 'internal')}
                        style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.15)', background: '#18181b', color: '#fff', fontSize: '0.85rem' }}
                      >
                        <option value="insurance">Assurance</option>
                        <option value="customer">Client direct</option>
                        <option value="warranty">Garantie</option>
                        <option value="internal">Interne</option>
                      </select>
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.8rem', color: '#a1a1aa', marginBottom: '0.25rem' }}>Montant Estimé (€)</label>
                      <input
                        type="number"
                        value={claimAmount}
                        onChange={(e) => setClaimAmount(e.target.value === '' ? '' : Number(e.target.value))}
                        placeholder="0"
                        style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.15)', background: '#18181b', color: '#fff', fontSize: '0.85rem' }}
                      />
                    </div>
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.8rem', color: '#a1a1aa', marginBottom: '0.25rem' }}>Description</label>
                    <textarea
                      value={claimDescription}
                      onChange={(e) => setClaimDescription(e.target.value)}
                      placeholder="Détails du sinistre..."
                      rows={2}
                      style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.15)', background: '#18181b', color: '#fff', fontSize: '0.85rem', resize: 'vertical' }}
                    />
                  </div>
                  <Button size="sm" type="submit">Enregistrer le Sinistre</Button>
                </form>
              )}

              {/* Claims List */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {(!selectedCase.claims || selectedCase.claims.length === 0) ? (
                  <div style={{ fontSize: '0.85rem', color: '#888', fontStyle: 'italic' }}>Aucun sinistre enregistré sur ce dossier.</div>
                ) : (
                  selectedCase.claims.map((claim) => {
                    const blockages = getBlockingClaimsReasons([claim]);
                    const isBlocked = blockages.length > 0;
                    return (
                      <div key={claim.id} style={{ padding: '0.75rem', background: 'rgba(255,255,255,0.01)', border: '1px solid rgba(255,255,255,0.03)', borderRadius: '4px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                          <strong style={{ fontSize: '0.85rem' }}>{claim.label}</strong>
                          <span style={{ fontSize: '0.75rem', padding: '2px 6px', borderRadius: '4px', background: claim.status === 'approved' ? 'rgba(16,185,129,0.1)' : claim.status === 'rejected' ? 'rgba(239,68,68,0.1)' : 'rgba(245,158,11,0.1)', color: claim.status === 'approved' ? '#10b981' : claim.status === 'rejected' ? '#ef4444' : '#f59e0b' }}>
                            {claim.status.toUpperCase()}
                          </span>
                        </div>
                        <p style={{ margin: 0, fontSize: '0.8rem', color: '#aaa' }}>Type: {claim.claimType} | Payeur: {claim.payerType} {claim.estimatedAmount ? `| Estimé: ${claim.estimatedAmount} €` : ''}</p>
                        {claim.description && <p style={{ margin: '0.25rem 0 0', fontSize: '0.8rem', color: '#888' }}>{claim.description}</p>}

                        {/* Estimate section */}
                        {claim.estimate ? (
                          <div style={{ marginTop: '0.5rem', padding: '0.5rem', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '4px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                              <span style={{ fontSize: '0.8rem', color: '#34d399', fontWeight: 'bold' }}>
                                📄 Devis Importé : {claim.estimate.sourceFileName}
                              </span>
                              <div style={{ display: 'flex', gap: '0.5rem' }}>
                                <Button
                                  size="sm"
                                  onClick={() => {
                                    if (confirm("Voulez-vous régénérer les tâches de l'atelier depuis ce devis ? Cela écrasera les tâches actuelles du dossier.")) {
                                      regenerateWorkshopTasksFromClaimEstimate(selectedCase.id, claim.id, user);
                                    }
                                  }}
                                >
                                  🔄 Tâches Atelier
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  style={{ color: '#ef4444' }}
                                  onClick={() => {
                                    if (confirm("Voulez-vous retirer le devis de ce sinistre ?")) {
                                      removeEstimateFromClaim(selectedCase.id, claim.id, user);
                                    }
                                  }}
                                >
                                  Retirer
                                </Button>
                              </div>
                            </div>
                            <div style={{ fontSize: '0.75rem', color: '#bbb', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginTop: '0.25rem' }}>
                              <div>
                                <strong>Totaux :</strong> HT: {claim.estimate.totals.amountHT.toFixed(2)} | TVA: {claim.estimate.totals.amountTVA.toFixed(2)} | TTC: {claim.estimate.totals.amountTTC.toFixed(2)} {claim.estimate.totals.currency}
                              </div>
                              <div>
                                <strong>Pièces :</strong> {claim.estimate.partsSummary.totalPartsCount} articles ({claim.estimate.partsSummary.totalPartsAmountHT.toFixed(2)} HT)
                              </div>
                            </div>
                            <div style={{ fontSize: '0.75rem', color: '#bbb', marginTop: '0.25rem' }}>
                              <strong>Répartition MO :</strong> {
                                Object.entries(claim.estimate.laborSummary)
                                  .filter(([_, h]) => h > 0)
                                  .map(([p, h]) => `${p}: ${h}h`)
                                  .join(', ') || 'Aucune heure MO'
                              }
                            </div>
                            {claim.estimate.warnings.length > 0 && (
                              <div style={{ marginTop: '0.25rem', color: '#fca5a5', fontSize: '0.7rem' }}>
                                ⚠️ {claim.estimate.warnings.join(' | ')}
                              </div>
                            )}
                          </div>
                        ) : (
                          <div style={{ marginTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                              <input
                                type="file"
                                id={`est-file-${claim.id}`}
                                accept=".txt,.html"
                                style={{ display: 'none' }}
                                onChange={async (e) => {
                                  const file = e.target.files?.[0];
                                  if (!file) return;
                                  const reader = new FileReader();
                                  reader.onload = async (evt) => {
                                    const content = evt.target?.result as string;
                                    if (content) {
                                      try {
                                        importEstimateForClaim(selectedCase.id, claim.id, { fileName: file.name, content }, user);
                                      } catch (err: unknown) {
                                        alert(err instanceof Error ? err.message : "Erreur lors de l'import");
                                      }
                                    }
                                  };
                                  reader.readAsText(file);
                                }}
                              />
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => document.getElementById(`est-file-${claim.id}`)?.click()}
                              >
                                📥 Importer Devis (TXT/HTML)
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setShowPasteMap(prev => ({ ...prev, [claim.id]: !prev[claim.id] }))}
                              >
                                {showPasteMap[claim.id] ? 'Masquer' : 'Coller texte'}
                              </Button>
                            </div>
                            {showPasteMap[claim.id] && (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                                <textarea
                                  rows={3}
                                  placeholder="Coller le contenu du devis ici..."
                                  style={{ width: '100%', padding: '0.4rem', fontSize: '0.75rem', background: '#18181b', color: '#fff', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px' }}
                                  value={pasteTextMap[claim.id] || ''}
                                  onChange={(e) => setPasteTextMap(prev => ({ ...prev, [claim.id]: e.target.value }))}
                                />
                                <Button
                                  size="sm"
                                  onClick={() => {
                                    const content = pasteTextMap[claim.id];
                                    if (content && content.trim()) {
                                      try {
                                        importEstimateForClaim(selectedCase.id, claim.id, { fileName: 'texte_colle.txt', content }, user);
                                        setPasteTextMap(prev => ({ ...prev, [claim.id]: '' }));
                                        setShowPasteMap(prev => ({ ...prev, [claim.id]: false }));
                                      } catch (err: unknown) {
                                        alert(err instanceof Error ? err.message : "Erreur lors de l'import");
                                      }
                                    }
                                  }}
                                >
                                  Valider le texte collé
                                </Button>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Approvals Details */}
                        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem', fontSize: '0.75rem' }}>
                          {claim.requiredApprovals.includes('expert') && (
                            <span style={{ color: claim.expertApproved ? '#10b981' : '#ef4444' }}>
                              Accord Expert: {claim.expertApproved ? `✅ (Par: ${claim.expertName})` : '❌ Manquant'}
                            </span>
                          )}
                          {claim.requiredApprovals.includes('client') && (
                            <span style={{ color: claim.clientApproved ? '#10b981' : '#ef4444' }}>
                              Accord Client: {claim.clientApproved ? `✅ (Réf: ${claim.clientApprovalReference})` : '❌ Manquant'}
                            </span>
                          )}
                        </div>

                        {/* Blockages Summary */}
                        {isBlocked && (
                          <div style={{ marginTop: '0.5rem', padding: '0.4rem', background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.1)', borderRadius: '4px', color: '#f87171', fontSize: '0.75rem' }}>
                            ⚠️ Planification bloquée : {blockages.join(' ')}
                          </div>
                        )}

                        {/* Action buttons */}
                        {claim.status !== 'cancelled' && claim.status !== 'approved' && (
                          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                            {claim.requiredApprovals.includes('expert') && !claim.expertApproved && (
                              <Button
                                size="sm"
                                onClick={() => {
                                  const name = prompt("Saisir le nom de l'expert :");
                                  if (name && name.trim()) {
                                    approveClaimExpert(selectedCase.id, claim.id, name.trim(), user);
                                  }
                                }}
                              >
                                Valider Accord Expert
                              </Button>
                            )}
                            {claim.requiredApprovals.includes('client') && !claim.clientApproved && (
                              <Button
                                size="sm"
                                onClick={() => {
                                  const ref = prompt("Saisir la référence de l'accord :");
                                  if (ref && ref.trim()) {
                                    approveClaimClient(selectedCase.id, claim.id, ref.trim(), user);
                                  }
                                }}
                              >
                                Valider Accord Client
                              </Button>
                            )}
                            {claim.claimType === 'warranty' && (
                              <Button
                                size="sm"
                                onClick={() => {
                                  updateClaim(selectedCase.id, claim.id, { status: 'approved' }, user);
                                }}
                              >
                                Valider Garantie
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="ghost"
                              style={{ color: '#ef4444' }}
                              onClick={() => {
                                const reason = prompt("Saisir le motif du rejet :");
                                if (reason && reason.trim()) {
                                  rejectClaim(selectedCase.id, claim.id, reason.trim(), user);
                                }
                              }}
                            >
                              Rejeter
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => cancelClaim(selectedCase.id, claim.id, user)}
                            >
                              Annuler
                            </Button>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>

              {/* Dossier Incomplete Warnings */}
              {(() => {
                const warnings = getExportWarnings(selectedCase);
                if (warnings.length > 0) {
                  return (
                    <div style={{ marginTop: '1.25rem', padding: '0.75rem', background: 'rgba(245,158,11,0.05)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: '4px', color: '#fbbf24' }}>
                      <strong style={{ fontSize: '0.85rem', display: 'block', marginBottom: '0.25rem' }}>⚠️ Dossier Incomplet :</strong>
                      <ul style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.8rem' }}>
                        {warnings.map((w, idx) => <li key={idx}>{w}</li>)}
                      </ul>
                    </div>
                  );
                }
                return null;
              })()}

              {/* Print and Export Buttons */}
              <div style={{ marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                <h4 style={{ margin: '0 0 0.75rem 0', fontSize: '0.9rem', fontWeight: 600 }}>Impression &amp; Exportation</h4>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  {hasPermission(user.role, 'print_reception_sheet') && (
                    <Button onClick={() => handlePrint('reception_sheet')}>
                      🖨️ Fiche Réception
                    </Button>
                  )}
                  {hasPermission(user.role, 'print_delivery_receipt') && (
                    <Button onClick={() => handlePrint('delivery_receipt')}>
                      🖨️ PV Restitution
                    </Button>
                  )}
                  {hasPermission(user.role, 'export_complete_case') && (
                    <Button variant="ghost" style={{ background: '#2563eb', color: '#fff' }} onClick={handleExport}>
                      📦 Exporter Dossier (ZIP)
                    </Button>
                  )}
                </div>
              </div>

              {/* Photos Management Panel */}
              <div style={{ marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                <h4 style={{ margin: '0 0 0.75rem 0', fontSize: '0.9rem', fontWeight: 600 }}>Gestion des Photos</h4>

                {/* Photo uploader or Mock photo button */}
                {hasPermission(user.role, 'manage_case_photos') && (
                  <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '1rem' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.75rem', color: '#a1a1aa', marginBottom: '0.25rem' }}>Catégorie photo</label>
                      <select
                        id="photo-category-select"
                        defaultValue="before"
                        style={{ padding: '0.4rem', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.15)', background: '#18181b', color: '#fff', fontSize: '0.8rem' }}
                      >
                        <option value="before">Avant réparation</option>
                        <option value="during">En cours</option>
                        <option value="after">Après réparation</option>
                        <option value="claim">Sinistre</option>
                        <option value="estimate">Devis</option>
                        <option value="quality">Qualité</option>
                        <option value="delivery">Livraison</option>
                        <option value="other">Autre</option>
                      </select>
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.75rem', color: '#a1a1aa', marginBottom: '0.25rem' }}>Importer fichier</label>
                      <input
                        type="file"
                        multiple
                        accept="image/*"
                        onChange={(e) => {
                          const select = document.getElementById('photo-category-select') as HTMLSelectElement;
                          const cat = (select?.value || 'before') as CasePhoto['category'];
                          handlePhotoUpload(e, cat);
                        }}
                        style={{ fontSize: '0.8rem', color: '#ccc' }}
                      />
                    </div>
                    <div style={{ alignSelf: 'flex-end' }}>
                      <Button
                        size="sm"
                        variant="ghost"
                        style={{ border: '1px solid rgba(255,255,255,0.15)' }}
                        onClick={() => {
                          const select = document.getElementById('photo-category-select') as HTMLSelectElement;
                          const cat = (select?.value || 'before') as CasePhoto['category'];
                          handleAddMockPhoto(cat);
                        }}
                      >
                        📷 Ajouter Photo Test
                      </Button>
                    </div>
                  </div>
                )}

                {/* Photos List */}
                {(() => {
                  const photosList = collectCasePhotos(selectedCase);
                  if (photosList.length === 0) {
                    return <div style={{ fontSize: '0.8rem', color: '#888', fontStyle: 'italic' }}>Aucune photo associée à ce dossier.</div>;
                  }
                  return (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '0.75rem', marginTop: '0.5rem' }}>
                      {photosList.map((photo) => (
                        <div key={photo.id} style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '4px', padding: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.25rem', position: 'relative' }}>
                          {photo.dataUrl && (
                            <img src={photo.dataUrl} alt={photo.name} style={{ width: '100%', height: '80px', objectFit: 'cover', borderRadius: '2px', background: '#000' }} />
                          )}
                          <div style={{ fontSize: '0.75rem', fontWeight: 'bold', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }} title={photo.name}>
                            {photo.name}
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.7rem', color: '#aaa' }}>
                            <span style={{ textTransform: 'capitalize' }}>{photo.category}</span>
                            <span>{(photo.size / 1024).toFixed(1)} KB</span>
                          </div>
                          {hasPermission(user.role, 'manage_case_photos') && (
                            <button
                              onClick={() => {
                                if (confirm(`Voulez-vous supprimer la photo "${photo.name}" ?`)) {
                                  removePhotoFromCase(selectedCase.id, photo.id, user);
                                }
                              }}
                              style={{ position: 'absolute', top: '4px', right: '4px', background: 'rgba(239,68,68,0.8)', border: 'none', color: '#fff', borderRadius: '50%', width: '18px', height: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: '10px', fontWeight: 'bold' }}
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            </div>
          )}
        </div>
      </div>
      <VersionBanner />
    </div>
  );
};
