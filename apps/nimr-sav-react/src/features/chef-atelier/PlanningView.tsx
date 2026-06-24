import React, { useState, useMemo } from 'react';
import type { User } from '@/types';
import { useSavCases } from '@/state/useSavCases';
import { DEMO_TECHNICIANS } from '@/constants/demo-technicians';
import { hasPermission } from '@/domain/action-permissions';
import { SavCase, WorkshopTask } from '@/domain/sav-case';
import { CaseStatus } from '@/domain/case-status';
import { Button } from '@/components/ui/Button';

interface PlanningViewProps {
  user: User;
}

export const PlanningView: React.FC<PlanningViewProps> = ({ user }) => {
  const {
    cases,
    logs,
    assignTechnician,
    setWorkshopPriority,
    planWorkshopTask,
    transitionWorkshopCase,
  } = useSavCases();

  // Selected case for planning/modifications
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);

  // Planning form fields (for the selected case)
  const [bay, setBay] = useState('');
  const [duration, setDuration] = useState<number | ''>('');
  const [taskLabel, setTaskLabel] = useState('');
  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [infoMsg, setInfoMsg] = useState('');

  // Active list tab in the panel
  const [activeTab, setActiveTab] = useState<CaseStatus>('received');

  // Authorization checks
  const canAssign = hasPermission(user.role, 'assign_technician');
  const canSetPriority = hasPermission(user.role, 'change_workshop_status');
  const canPlan = hasPermission(user.role, 'schedule_case');

  // Compute selected case details
  const selectedCase = useMemo(() => {
    return cases.find((c) => c.id === selectedCaseId) || null;
  }, [cases, selectedCaseId]);

  // Load selected case values into local form states
  const handleSelectCase = (c: SavCase) => {
    setSelectedCaseId(c.id);
    setBay(c.workshopBay || '');
    setDuration(c.estimatedDurationMinutes !== undefined ? c.estimatedDurationMinutes : '');
    setStartAt(c.plannedStartAt ? c.plannedStartAt.substring(0, 16) : '');
    setEndAt(c.plannedEndAt ? c.plannedEndAt.substring(0, 16) : '');
    setTaskLabel('');
    setErrorMsg('');
    setInfoMsg('');
  };

  // Filter cases for the active status tab
  const filteredCases = useMemo(() => {
    return cases.filter((c) => c.status === activeTab);
  }, [cases, activeTab]);

  // Actions
  const handleAssignTech = (techId: string) => {
    if (!selectedCaseId) return;
    try {
      assignTechnician(selectedCaseId, techId, user);
      setInfoMsg('Technicien affecté avec succès.');
      setErrorMsg('');
    } catch (e) {
      setErrorMsg((e as Error).message || 'Erreur lors de l\'affectation.');
    }
  };

  const handleSetPriority = (priority: 'basse' | 'normale' | 'haute') => {
    if (!selectedCaseId) return;
    try {
      setWorkshopPriority(selectedCaseId, priority, user);
      setInfoMsg('Priorité définie avec succès.');
      setErrorMsg('');
    } catch (e) {
      setErrorMsg((e as Error).message || 'Erreur lors de la mise à jour de la priorité.');
    }
  };

  const handleSavePlanning = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCaseId || !selectedCase) return;

    try {
      const payload: {
        bay?: string;
        duration?: number;
        startAt?: string;
        endAt?: string;
      } = {
        bay: bay.trim() || undefined,
        duration: duration === '' ? undefined : Number(duration),
        startAt: startAt ? new Date(startAt).toISOString() : undefined,
        endAt: endAt ? new Date(endAt).toISOString() : undefined,
      };

      planWorkshopTask(selectedCaseId, payload, user);
      setInfoMsg('Planification enregistrée avec succès.');
      setErrorMsg('');
    } catch (e) {
      setErrorMsg((e as Error).message || 'Erreur lors de l\'enregistrement de la planification.');
    }
  };

  const handleAddTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCaseId || !selectedCase || !taskLabel.trim()) return;

    try {
      const newTask: WorkshopTask = {
        id: `task-${Date.now()}`,
        label: taskLabel.trim(),
        status: 'pending',
        createdAt: new Date().toISOString(),
      };

      const existingTasks = selectedCase.workshopTasks || [];
      const updatedTasks = [...existingTasks, newTask];

      planWorkshopTask(selectedCaseId, { tasks: updatedTasks }, user);
      setTaskLabel('');
      setInfoMsg('Tâche ajoutée avec succès.');
      setErrorMsg('');
    } catch (e) {
      setErrorMsg((e as Error).message || 'Erreur lors de l\'ajout de la tâche.');
    }
  };

  const handleToggleTaskStatus = (task: WorkshopTask) => {
    if (!selectedCaseId || !selectedCase) return;

    const nextStatuses: Record<string, 'pending' | 'in_progress' | 'done'> = {
      pending: 'in_progress',
      in_progress: 'done',
      done: 'pending',
    };

    const updatedTasks = (selectedCase.workshopTasks || []).map((t) => {
      if (t.id === task.id) {
        return { ...t, status: nextStatuses[t.status] };
      }
      return t;
    });

    try {
      planWorkshopTask(selectedCaseId, { tasks: updatedTasks }, user);
      setInfoMsg('Statut de la tâche mis à jour.');
    } catch (e) {
      setErrorMsg((e as Error).message || 'Erreur lors de la modification de la tâche.');
    }
  };

  const handleTransition = (nextStatus: CaseStatus) => {
    if (!selectedCaseId) return;
    try {
      transitionWorkshopCase(selectedCaseId, nextStatus, user);
      setInfoMsg(`Dossier basculé vers le statut : ${nextStatus}.`);
      setErrorMsg('');
      // If the case moved out of current view tab, clear selection or update
      if (selectedCase && selectedCase.status !== nextStatus) {
        setSelectedCaseId(null);
      }
    } catch (e) {
      setErrorMsg((e as Error).message || 'Erreur lors de la transition de statut.');
    }
  };

  // Filter logs related to selected case
  const caseLogs = useMemo(() => {
    if (!selectedCaseId) return [];
    return logs.filter((log) => log.caseId === selectedCaseId);
  }, [logs, selectedCaseId]);

  return (
    <div className="view-container" id="planning-view" style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '2rem', padding: '1rem' }}>

      {/* Left panel: List by status tabs */}
      <div className="planning-list-panel" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        <header className="view-header" style={{ marginBottom: 0 }}>
          <h1 className="view-title">Planning & Suivi Atelier</h1>
          <p className="view-subtitle">Rôle : Chef Atelier | Utilisateur : {user.name}</p>
        </header>

        {/* Workshop status tabs */}
        <div className="status-tabs" style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.1)', gap: '0.5rem', paddingBottom: '0.25rem', overflowX: 'auto' }}>
          {(['received', 'diagnosis', 'waiting_parts', 'repair', 'work_completed'] as CaseStatus[]).map((status) => (
            <button
              key={status}
              onClick={() => { setActiveTab(status); setSelectedCaseId(null); }}
              style={{
                background: 'none',
                border: 'none',
                color: activeTab === status ? '#2196f3' : '#aaa',
                borderBottom: activeTab === status ? '2px solid #2196f3' : 'none',
                padding: '0.5rem 0.75rem',
                cursor: 'pointer',
                fontWeight: activeTab === status ? 'bold' : 'normal',
                whiteSpace: 'nowrap'
              }}
            >
              {status.toUpperCase().replace('_', ' ')}
            </button>
          ))}
        </div>

        {/* Case list */}
        <div style={{ flex: 1, maxHeight: '600px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {filteredCases.length === 0 ? (
            <p style={{ color: '#888', fontStyle: 'italic' }}>Aucun dossier dans ce statut.</p>
          ) : (
            filteredCases.map((c) => (
              <div
                key={c.id}
                onClick={() => handleSelectCase(c)}
                style={{
                  background: selectedCaseId === c.id ? 'rgba(33, 150, 243, 0.15)' : 'rgba(255,255,255,0.03)',
                  border: selectedCaseId === c.id ? '1px solid #2196f3' : '1px solid transparent',
                  padding: '1rem',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}
              >
                <div>
                  <h4 style={{ margin: 0 }}>{c.immatriculation} — {c.vin}</h4>
                  <p style={{ margin: '0.25rem 0 0', fontSize: '0.85rem', color: '#aaa' }}>
                    Tech : {c.assignedTechnicianName || 'Non affecté'} | Priorité : <span style={{ fontWeight: 'bold' }}>{c.workshopPriority || 'non définie'}</span>
                  </p>
                  <p style={{ margin: '0.25rem 0 0', fontSize: '0.8rem', color: '#888' }}>
                    Reçu le : {new Date(c.receptionDate).toLocaleDateString()}
                  </p>
                </div>
                <span style={{ fontSize: '1.5rem' }}>➡️</span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Right panel: Details, Planning & Actions */}
      <div className="planning-detail-panel" style={{ background: 'rgba(255,255,255,0.05)', padding: '1.5rem', borderRadius: '8px', display: 'flex', flexDirection: 'column', gap: '1.5rem', maxHeight: '700px', overflowY: 'auto' }}>

        {!selectedCase ? (
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '100%', color: '#888' }}>
            <span style={{ fontSize: '3rem', marginBottom: '1rem' }}>📋</span>
            <p>Sélectionnez un dossier de l'atelier pour planifier ou effectuer des actions.</p>
          </div>
        ) : (
          <>
            <div>
              <h2 style={{ margin: 0 }}>Détail : {selectedCase.immatriculation}</h2>
              <p style={{ margin: '0.25rem 0 0', color: '#888', fontSize: '0.9rem' }}>ID: {selectedCase.id} | Statut : <strong style={{ color: '#ff9800' }}>{selectedCase.status}</strong></p>
            </div>

            {errorMsg && (
              <div style={{ background: '#b71c1c', color: '#fff', padding: '0.75rem', borderRadius: '4px', fontSize: '0.9rem' }}>
                {errorMsg}
              </div>
            )}

            {infoMsg && (
              <div style={{ background: '#1b5e20', color: '#fff', padding: '0.75rem', borderRadius: '4px', fontSize: '0.9rem' }}>
                {infoMsg}
              </div>
            )}

            {/* Step 1: Assignment & Priority */}
            <div style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '1.5rem' }}>
              <h3>Affectation & Priorité</h3>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '0.5rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', color: '#aaa', marginBottom: '0.25rem' }}>Affecter un technicien</label>
                  <select
                    disabled={!canAssign}
                    className="form-select"
                    value={selectedCase.assignedTechnicianId || ''}
                    onChange={(e) => handleAssignTech(e.target.value)}
                  >
                    <option value="">— Non affecté —</option>
                    {DEMO_TECHNICIANS.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', color: '#aaa', marginBottom: '0.25rem' }}>Priorité Atelier</label>
                  <select
                    disabled={!canSetPriority}
                    className="form-select"
                    value={selectedCase.workshopPriority || ''}
                    onChange={(e) => handleSetPriority(e.target.value as 'basse' | 'normale' | 'haute')}
                  >
                    <option value="">— Non définie —</option>
                    <option value="basse">Basse</option>
                    <option value="normale">Normale</option>
                    <option value="haute">Haute</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Step 2: Planning Details */}
            <div style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '1.5rem' }}>
              <h3>Planification de l'intervention</h3>

              <form onSubmit={handleSavePlanning} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '0.5rem' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.85rem', color: '#aaa' }}>Baie Atelier</label>
                    <input
                      disabled={!canPlan}
                      type="text"
                      className="form-input"
                      value={bay}
                      onChange={(e) => setBay(e.target.value)}
                      placeholder="Ex: Baie A"
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.85rem', color: '#aaa' }}>Durée estimée (min)</label>
                    <input
                      disabled={!canPlan}
                      type="number"
                      className="form-input"
                      value={duration}
                      onChange={(e) => setDuration(e.target.value === '' ? '' : Number(e.target.value))}
                      placeholder="Ex: 60"
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.85rem', color: '#aaa' }}>Début Planifié</label>
                    <input
                      disabled={!canPlan}
                      type="datetime-local"
                      className="form-input"
                      value={startAt}
                      onChange={(e) => setStartAt(e.target.value)}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.85rem', color: '#aaa' }}>Fin Planifiée</label>
                    <input
                      disabled={!canPlan}
                      type="datetime-local"
                      className="form-input"
                      value={endAt}
                      onChange={(e) => setEndAt(e.target.value)}
                    />
                  </div>
                </div>

                {canPlan && (
                  <Button type="submit" size="sm" variant="ghost" style={{ marginTop: '0.5rem' }}>
                    Enregistrer Planification
                  </Button>
                )}
              </form>
            </div>

            {/* Step 3: Tasks List */}
            <div style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '1.5rem' }}>
              <h3>Tâches Atelier ({selectedCase.workshopTasks?.length || 0})</h3>

              {/* Add task form */}
              {canPlan && (
                <form onSubmit={handleAddTask} style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', marginBottom: '0.75rem' }}>
                  <input
                    type="text"
                    className="form-input"
                    value={taskLabel}
                    onChange={(e) => setTaskLabel(e.target.value)}
                    placeholder="Nouvelle tâche (ex: Remplacement plaquettes)"
                  />
                  <Button type="submit" size="sm">Ajouter</Button>
                </form>
              )}

              {/* Tasks List */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {!selectedCase.workshopTasks || selectedCase.workshopTasks.length === 0 ? (
                  <p style={{ color: '#888', fontStyle: 'italic', fontSize: '0.9rem' }}>Aucune tâche planifiée.</p>
                ) : (
                  selectedCase.workshopTasks.map((t) => (
                    <div
                      key={t.id}
                      onClick={() => handleToggleTaskStatus(t)}
                      style={{
                        background: 'rgba(255,255,255,0.02)',
                        padding: '0.5rem 0.75rem',
                        borderRadius: '4px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        cursor: 'pointer',
                        borderLeft: t.status === 'done' ? '4px solid #4caf50' : t.status === 'in_progress' ? '4px solid #ff9800' : '4px solid #9e9e9e'
                      }}
                    >
                      <span>{t.label}</span>
                      <span style={{ fontSize: '0.8rem', color: '#aaa' }}>
                        {t.status.toUpperCase().replace('_', ' ')}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Step 4: Workflow Actions */}
            <div style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '1.5rem' }}>
              <h3>Transitions Atelier</h3>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.5rem' }}>

                {selectedCase.status === 'received' && (
                  <Button onClick={() => handleTransition('diagnosis')}>
                    Lancer Diagnostic
                  </Button>
                )}

                {selectedCase.status === 'diagnosis' && (
                  <>
                    <Button variant="ghost" onClick={() => handleTransition('waiting_parts')}>
                      Attente Pièces
                    </Button>
                    <Button onClick={() => handleTransition('repair')}>
                      Lancer Réparation
                    </Button>
                  </>
                )}

                {selectedCase.status === 'waiting_parts' && (
                  <Button onClick={() => handleTransition('repair')}>
                    Lancer Réparation
                  </Button>
                )}

                {selectedCase.status === 'repair' && (
                  <Button onClick={() => handleTransition('work_completed')}>
                    Terminer Intervention
                  </Button>
                )}

                {selectedCase.status === 'quality_rejected' && (
                  <Button onClick={() => handleTransition('quality_rework')}>
                    Relancer pour Reprise
                  </Button>
                )}

                {/* If no transition matches role guidelines */}
                {!['received', 'diagnosis', 'waiting_parts', 'repair', 'quality_rejected'].includes(selectedCase.status) && (
                  <p style={{ color: '#888', fontStyle: 'italic', fontSize: '0.9rem' }}>
                    Aucune transition atelier disponible pour ce statut actuel ({selectedCase.status}).
                  </p>
                )}

              </div>
            </div>

            {/* Step 5: Audit logs */}
            <div>
              <h3>Logs d'Audit du Dossier ({caseLogs.length})</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.5rem', maxHeight: '200px', overflowY: 'auto' }}>
                {caseLogs.length === 0 ? (
                  <p style={{ color: '#888', fontStyle: 'italic', fontSize: '0.9rem' }}>Aucun log disponible pour ce dossier.</p>
                ) : (
                  caseLogs.map((log) => (
                    <div key={log.id} style={{ background: 'rgba(255,255,255,0.01)', padding: '0.5rem', borderRadius: '4px', fontSize: '0.8rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', color: '#ff9800' }}>
                        <span>{log.action}</span>
                        <span style={{ color: '#888' }}>{new Date(log.timestamp).toLocaleTimeString()}</span>
                      </div>
                      <p style={{ margin: '0.25rem 0 0' }}>{log.details}</p>
                      <p style={{ margin: '0.1rem 0 0', fontSize: '0.75rem', color: '#666' }}>
                        Acteur : {log.userRole}
                        {log.fromStatus && ` (${log.fromStatus} -> ${log.toStatus})`}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </div>

          </>
        )}

      </div>

    </div>
  );
};
