import React, { useState, useMemo } from 'react';
import type { User } from '@/types';
import { useSavCases } from '@/state/useSavCases';
import { DEMO_TECHNICIANS } from '@/constants/demo-technicians';
import { hasPermission } from '@/domain/action-permissions';
import { SavCase, WorkshopTask } from '@/domain/sav-case';
import { CaseStatus } from '@/domain/case-status';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/EmptyState';
import { StatusBadge } from '@/components/StatusBadge';
import { PriorityBadge } from '@/components/PriorityBadge';
import { VersionBanner } from '@/components/VersionBanner';
import { getRoleFieldGuidance, getStatusDisplay } from '@/domain/ui-field-guidelines';

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
    <div
      className="view-container"
      id="planning-view"
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
          Planification Atelier
        </h1>
        <p className="view-subtitle" style={{ margin: '0.25rem 0 0 0', color: '#a1a1aa', fontSize: '0.9rem' }}>
          planifier les interventions, priorités, tâches et affectations
        </p>
        <div style={{ marginTop: '0.75rem', fontSize: '0.85rem', color: '#3b82f6', fontStyle: 'italic' }}>
          {getRoleFieldGuidance(user.role)}
        </div>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '2rem' }}>
        {/* Left panel: List by status tabs */}
        <div className="planning-list-panel" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {/* Workshop status tabs */}
          <div
            className="status-tabs"
            style={{
              display: 'flex',
              borderBottom: '1px solid rgba(255,255,255,0.1)',
              gap: '0.5rem',
              paddingBottom: '0.25rem',
              overflowX: 'auto',
            }}
          >
            {(['received', 'diagnosis', 'waiting_parts', 'repair', 'work_completed'] as CaseStatus[]).map((status) => (
              <button
                key={status}
                onClick={() => {
                  setActiveTab(status);
                  setSelectedCaseId(null);
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: activeTab === status ? '#3b82f6' : '#888',
                  borderBottom: activeTab === status ? '2px solid #3b82f6' : 'none',
                  padding: '0.5rem 0.75rem',
                  cursor: 'pointer',
                  fontWeight: activeTab === status ? 'bold' : 'normal',
                  whiteSpace: 'nowrap',
                }}
              >
                {getStatusDisplay(status)}
              </button>
            ))}
          </div>

          {/* Case list */}
          <div style={{ flex: 1, maxHeight: '600px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {filteredCases.length === 0 ? (
              <EmptyState role="chef-atelier" messageOverride={`Aucun dossier avec le statut : ${getStatusDisplay(activeTab)}.`} />
            ) : (
              filteredCases.map((c) => (
                <div
                  key={c.id}
                  onClick={() => handleSelectCase(c)}
                  style={{
                    background: selectedCaseId === c.id ? 'rgba(59, 130, 246, 0.15)' : 'rgba(255,255,255,0.03)',
                    border: selectedCaseId === c.id ? '1px solid #3b82f6' : '1px solid rgba(255,255,255,0.05)',
                    padding: '1rem',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    transition: 'all 0.2s',
                  }}
                >
                  <div>
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
                      <span>Tech : {c.assignedTechnicianName || 'Non affecté'}</span>
                      <span>|</span>
                      <span>
                        Priorité :{' '}
                        {c.workshopPriority ? (
                           <PriorityBadge priority={c.workshopPriority as 'low' | 'normal' | 'high' | 'urgent'} />
                        ) : (
                          <span style={{ fontSize: '0.75rem', color: '#71717a' }}>non définie</span>
                        )}
                      </span>
                    </div>
                    <p style={{ margin: '0.25rem 0 0', fontSize: '0.8rem', color: '#888' }}>
                      Reçu le : {new Date(c.receptionDate).toLocaleDateString()}
                    </p>
                  </div>
                  <span style={{ fontSize: '1.2rem', color: '#3b82f6' }}>➡️</span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right panel: Details, Planning & Actions */}
        <div
          className="planning-detail-panel"
          style={{
            background: 'rgba(255,255,255,0.03)',
            padding: '1.5rem',
            borderRadius: '8px',
            border: '1px solid rgba(255,255,255,0.05)',
            display: 'flex',
            flexDirection: 'column',
            gap: '1.5rem',
            maxHeight: '700px',
            overflowY: 'auto',
          }}
        >
          {!selectedCase ? (
            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '100%', minHeight: '300px', color: '#888' }}>
              <span style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>📋</span>
              <p style={{ fontSize: '0.95rem', textAlign: 'center' }}>Sélectionnez un dossier de l'atelier pour planifier ou effectuer des actions.</p>
            </div>
          ) : (
            <>
              <div>
                <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600 }}>Détail : {selectedCase.immatriculation}</h2>
                <div style={{ margin: '0.25rem 0 0', color: '#888', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span>ID: {selectedCase.id}</span>
                  <span>|</span>
                  <span>
                    Statut : <StatusBadge status={selectedCase.status} />
                  </span>
                </div>
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
              <div style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '1.5rem' }}>
                <h3 style={{ fontSize: '1rem', fontWeight: 600, margin: '0 0 0.75rem 0' }}>Affectation & Priorité</h3>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.85rem', color: '#a1a1aa', marginBottom: '0.5rem' }}>Affecter un technicien</label>
                    <select
                      disabled={!canAssign}
                      className="form-select"
                      value={selectedCase.assignedTechnicianId || ''}
                      onChange={(e) => handleAssignTech(e.target.value)}
                      style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.15)', background: '#18181b', color: '#fff' }}
                    >
                      <option value="">— Non affecté —</option>
                      {DEMO_TECHNICIANS.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.85rem', color: '#a1a1aa', marginBottom: '0.5rem' }}>Priorité Atelier</label>
                    <select
                      disabled={!canSetPriority}
                      className="form-select"
                      value={selectedCase.workshopPriority || ''}
                      onChange={(e) => handleSetPriority(e.target.value as 'basse' | 'normale' | 'haute')}
                      style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.15)', background: '#18181b', color: '#fff' }}
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
              <div style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '1.5rem' }}>
                <h3 style={{ fontSize: '1rem', fontWeight: 600, margin: '0 0 0.75rem 0' }}>Planification de l'intervention</h3>

                <form onSubmit={handleSavePlanning} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.85rem', color: '#a1a1aa', marginBottom: '0.25rem' }}>Baie Atelier</label>
                      <input
                        disabled={!canPlan}
                        type="text"
                        className="form-input"
                        value={bay}
                        onChange={(e) => setBay(e.target.value)}
                        placeholder="Ex: Baie A"
                        style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.15)', background: '#18181b', color: '#fff' }}
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.85rem', color: '#a1a1aa', marginBottom: '0.25rem' }}>Durée estimée (min)</label>
                      <input
                        disabled={!canPlan}
                        type="number"
                        className="form-input"
                        value={duration}
                        onChange={(e) => setDuration(e.target.value === '' ? '' : Number(e.target.value))}
                        placeholder="Ex: 60"
                        style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.15)', background: '#18181b', color: '#fff' }}
                      />
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.85rem', color: '#a1a1aa', marginBottom: '0.25rem' }}>Début Planifié</label>
                      <input
                        disabled={!canPlan}
                        type="datetime-local"
                        className="form-input"
                        value={startAt}
                        onChange={(e) => setStartAt(e.target.value)}
                        style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.15)', background: '#18181b', color: '#fff' }}
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.85rem', color: '#a1a1aa', marginBottom: '0.25rem' }}>Fin Planifiée</label>
                      <input
                        disabled={!canPlan}
                        type="datetime-local"
                        className="form-input"
                        value={endAt}
                        onChange={(e) => setEndAt(e.target.value)}
                        style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.15)', background: '#18181b', color: '#fff' }}
                      />
                    </div>
                  </div>

                  {canPlan && (
                    <Button type="submit" variant="ghost" style={{ marginTop: '0.5rem' }}>
                      Enregistrer Planification
                    </Button>
                  )}
                </form>
              </div>

              {/* Step 3: Workshop Tasks Management */}
              <div style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)', paddingBottom: '1.5rem' }}>
                <h3 style={{ fontSize: '1rem', fontWeight: 600, margin: '0 0 0.75rem 0' }}>Tâches Atelier</h3>

                {/* Add task form */}
                {canPlan && (
                  <form onSubmit={handleAddTask} style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
                    <input
                      type="text"
                      className="form-input"
                      value={taskLabel}
                      onChange={(e) => setTaskLabel(e.target.value)}
                      placeholder="Nouvelle tâche (ex: Ponçage)"
                      style={{ flex: 1, padding: '0.5rem', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.15)', background: '#18181b', color: '#fff' }}
                    />
                    <Button type="submit" variant="ghost" size="sm">
                      Ajouter
                    </Button>
                  </form>
                )}

                {/* Tasks list */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {(selectedCase.workshopTasks || []).length === 0 ? (
                    <p style={{ color: '#888', fontStyle: 'italic', fontSize: '0.85rem', margin: 0 }}>Aucune tâche atelier.</p>
                  ) : (
                    (selectedCase.workshopTasks || []).map((t) => (
                      <div
                        key={t.id}
                        onClick={() => canPlan && handleToggleTaskStatus(t)}
                        style={{
                          background: 'rgba(255,255,255,0.02)',
                          padding: '0.6rem 0.8rem',
                          borderRadius: '4px',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          cursor: canPlan ? 'pointer' : 'default',
                          border: '1px solid rgba(255,255,255,0.03)',
                        }}
                      >
                        <span style={{ fontSize: '0.85rem' }}>{t.label}</span>
                        <span
                          style={{
                            fontSize: '0.75rem',
                            fontWeight: 600,
                            padding: '0.2rem 0.5rem',
                            borderRadius: '4px',
                            background: t.status === 'done' ? 'rgba(16, 185, 129, 0.15)' : t.status === 'in_progress' ? 'rgba(245, 158, 11, 0.15)' : 'rgba(255,255,255,0.08)',
                            color: t.status === 'done' ? '#10b981' : t.status === 'in_progress' ? '#f59e0b' : '#888',
                          }}
                        >
                          {t.status === 'done' ? 'Terminée' : t.status === 'in_progress' ? 'En cours' : 'En attente'}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Step 4: Workflow transitions */}
              <div style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '1.5rem' }}>
                <h3 style={{ fontSize: '1rem', fontWeight: 600, margin: '0 0 0.75rem 0' }}>Workflow Actions</h3>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
                  {selectedCase.status === 'received' && (
                    <Button onClick={() => handleTransition('diagnosis')}>
                      Lancer Diagnostic
                    </Button>
                  )}

                  {selectedCase.status === 'diagnosis' && (
                    <>
                      <Button onClick={() => handleTransition('waiting_parts')} variant="ghost">
                        Mettre en Attente Pièces
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
                    <p style={{ color: '#888', fontStyle: 'italic', fontSize: '0.9rem', margin: 0 }}>
                      Aucune transition atelier disponible pour le statut : {getStatusDisplay(selectedCase.status)}.
                    </p>
                  )}
                </div>
              </div>

              {/* Step 5: Audit logs */}
              <div>
                <h3 style={{ fontSize: '1rem', fontWeight: 600, margin: '0 0 0.75rem 0' }}>Logs d'Audit du Dossier ({caseLogs.length})</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '200px', overflowY: 'auto' }}>
                  {caseLogs.length === 0 ? (
                    <p style={{ color: '#888', fontStyle: 'italic', fontSize: '0.9rem', margin: 0 }}>Aucun log disponible pour ce dossier.</p>
                  ) : (
                    caseLogs.map((log) => (
                      <div
                        key={log.id}
                        style={{
                          background: 'rgba(255,255,255,0.01)',
                          padding: '0.5rem',
                          borderRadius: '4px',
                          fontSize: '0.8rem',
                          border: '1px solid rgba(255,255,255,0.03)',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#f59e0b' }}>
                          <span>{log.action}</span>
                          <span style={{ color: '#888' }}>{new Date(log.timestamp).toLocaleTimeString()}</span>
                        </div>
                        <p style={{ margin: '0.25rem 0 0', color: '#ddd' }}>{log.details}</p>
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
      <VersionBanner />
    </div>
  );
};
