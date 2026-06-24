import React, { useState, useMemo } from 'react';
import type { User } from '@/types';
import { useSavCases } from '@/state/useSavCases';
import { DEMO_TECHNICIANS } from '@/constants/demo-technicians';
import { Button } from '@/components/ui/Button';

interface TechnicianViewProps {
  user: User;
}

export const TechnicianView: React.FC<TechnicianViewProps> = ({ user }) => {
  const {
    cases,
    logs,
    startTechnicianWork,
    updateWorkshopTaskStatus,
    completeTechnicianWork,
  } = useSavCases();

  // Pick a demo technician to simulate (default based on user name/id or pick first)
  const [selectedTechId, setSelectedTechId] = useState<string>(() => {
    if (user.id.startsWith('TECH-DEMO-')) return user.id;
    if (user.name.includes('A') || user.name.toLowerCase().includes('a')) return 'TECH-DEMO-001';
    if (user.name.includes('B') || user.name.toLowerCase().includes('b')) return 'TECH-DEMO-002';
    if (user.name.includes('C') || user.name.toLowerCase().includes('c')) return 'TECH-DEMO-003';
    return 'TECH-DEMO-001';
  });

  const selectedTech = useMemo(() => {
    return DEMO_TECHNICIANS.find((t) => t.id === selectedTechId) || DEMO_TECHNICIANS[0];
  }, [selectedTechId]);

  // Filter cases assigned to this technician
  const assignedCases = useMemo(() => {
    return cases.filter((c) => c.assignedTechnicianId === selectedTechId);
  }, [cases, selectedTechId]);

  // Selected case id for detail view
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);

  const selectedCase = useMemo(() => {
    return assignedCases.find((c) => c.id === selectedCaseId) || null;
  }, [assignedCases, selectedCaseId]);

  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Get logs for the selected case
  const caseLogs = useMemo(() => {
    if (!selectedCaseId) return [];
    return logs.filter((l) => l.caseId === selectedCaseId);
  }, [logs, selectedCaseId]);

  const handleSelectCase = (caseId: string) => {
    setSelectedCaseId(caseId);
    setErrorMsg('');
    setSuccessMsg('');
  };

  const handleStartWork = async (caseId: string) => {
    try {
      setErrorMsg('');
      setSuccessMsg('');
      const actor = { id: selectedTech.id, role: 'technicien' as const };
      startTechnicianWork(caseId, actor);
      setSuccessMsg("L'intervention a été démarrée avec succès !");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const handleUpdateTaskStatus = async (caseId: string, taskId: string, nextStatus: 'pending' | 'in_progress' | 'done') => {
    try {
      setErrorMsg('');
      setSuccessMsg('');
      const actor = { id: selectedTech.id, role: 'technicien' as const };
      updateWorkshopTaskStatus(caseId, taskId, nextStatus, actor);
      setSuccessMsg(`Tâche mise à jour avec succès vers : ${nextStatus}`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const handleCompleteWork = async (caseId: string) => {
    try {
      setErrorMsg('');
      setSuccessMsg('');
      const actor = { id: selectedTech.id, role: 'technicien' as const };
      completeTechnicianWork(caseId, actor);
      setSuccessMsg("L'intervention a été complétée avec succès !");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="view-container" id="technician-view" style={{ display: 'flex', flexDirection: 'column', gap: '1rem', padding: '1rem', color: '#fff', minHeight: '100vh', background: '#121214' }}>

      {/* Header and Simulation Mode Selector */}
      <header className="view-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '1rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 className="view-title" style={{ margin: 0, fontSize: '1.75rem', fontWeight: '700', background: 'linear-gradient(45deg, #00b0ff, #00e5ff)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>Espace Technicien</h1>
          <p className="view-subtitle" style={{ margin: '0.25rem 0 0', color: '#aaa', fontSize: '0.9rem' }}>
            Connecté en tant que : <strong style={{ color: '#fff' }}>{user.name}</strong> ({user.role})
          </p>
        </div>

        {/* Demo Technician Simulator picker */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', background: 'rgba(255,255,255,0.04)', padding: '0.5rem 1rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.08)' }}>
          <label htmlFor="tech-simulator-select" style={{ fontSize: '0.85rem', color: '#aaa', fontWeight: '500' }}>
            Simuler Technicien :
          </label>
          <select
            id="tech-simulator-select"
            value={selectedTechId}
            onChange={(e) => {
              setSelectedTechId(e.target.value);
              setSelectedCaseId(null);
              setErrorMsg('');
              setSuccessMsg('');
            }}
            style={{
              background: '#1a1a1e',
              color: '#fff',
              border: '1px solid rgba(255,255,255,0.15)',
              padding: '0.25rem 0.5rem',
              borderRadius: '4px',
              fontSize: '0.85rem',
              cursor: 'pointer'
            }}
          >
            {DEMO_TECHNICIANS.map((tech) => (
              <option key={tech.id} value={tech.id}>
                {tech.name} ({tech.id})
              </option>
            ))}
          </select>
        </div>
      </header>

      {/* Main Layout Grid */}
      <div className="view-main" style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: '1.5rem', flex: 1, minHeight: 0 }}>

        {/* Left Side: List of Assigned Cases */}
        <div className="cases-list-panel" style={{ background: '#1a1a1e', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '12px', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem', minHeight: 0 }}>
          <h2 style={{ margin: 0, fontSize: '1.2rem', color: '#fff', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span>📋</span> Dossiers Assignés ({assignedCases.length})
          </h2>

          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.75rem', paddingRight: '0.25rem' }}>
            {assignedCases.length === 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#888', textAlign: 'center', padding: '2rem' }}>
                <span style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>📭</span>
                <p style={{ margin: 0, fontSize: '0.9rem' }}>Aucun dossier affecté à ce technicien.</p>
              </div>
            ) : (
              assignedCases.map((c) => (
                <div
                  key={c.id}
                  id={`case-card-${c.id}`}
                  onClick={() => handleSelectCase(c.id)}
                  style={{
                    background: selectedCaseId === c.id ? 'rgba(0, 176, 255, 0.12)' : 'rgba(255,255,255,0.02)',
                    border: selectedCaseId === c.id ? '1px solid #00b0ff' : '1px solid rgba(255,255,255,0.05)',
                    borderRadius: '8px',
                    padding: '1rem',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.5rem'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontWeight: '700', color: '#fff' }}>{c.immatriculation}</span>
                    <span style={{
                      fontSize: '0.75rem',
                      padding: '0.2rem 0.5rem',
                      borderRadius: '4px',
                      fontWeight: 'bold',
                      background: c.status === 'repair' ? '#ff9800' : c.status === 'work_completed' ? '#4caf50' : '#757575',
                      color: '#fff'
                    }}>
                      {c.status.toUpperCase().replace('_', ' ')}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: '#aaa', fontSize: '0.8rem' }}>
                    <span>VIN: {c.vin}</span>
                    <span>Priorité: <strong style={{ color: c.workshopPriority === 'haute' ? '#f44336' : c.workshopPriority === 'normale' ? '#ff9800' : '#4caf50' }}>{c.workshopPriority || 'aucune'}</strong></span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right Side: Detailed View and Technician Controls */}
        <div className="case-detail-panel" style={{ background: '#1a1a1e', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '12px', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem', minHeight: 0, overflowY: 'auto' }}>

          {!selectedCase ? (
            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '100%', color: '#888' }}>
              <span style={{ fontSize: '3rem', marginBottom: '1rem' }}>🔧</span>
              <p style={{ margin: 0 }}>Sélectionnez un dossier à gauche pour afficher les tâches et démarrer l'intervention.</p>
            </div>
          ) : (
            <>
              {/* Header Details */}
              <div style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <h2 style={{ margin: 0, fontSize: '1.5rem' }}>Détails : {selectedCase.immatriculation}</h2>
                  <span style={{
                    fontSize: '0.85rem',
                    padding: '0.25rem 0.6rem',
                    borderRadius: '6px',
                    fontWeight: 'bold',
                    background: 'rgba(0, 176, 255, 0.15)',
                    border: '1px solid #00b0ff',
                    color: '#00b0ff'
                  }}>
                    {selectedCase.status.toUpperCase().replace('_', ' ')}
                  </span>
                </div>
                <p style={{ margin: '0.25rem 0 0', color: '#aaa', fontSize: '0.85rem' }}>VIN : {selectedCase.vin}</p>
              </div>

              {/* Status messages */}
              {errorMsg && (
                <div style={{ background: '#d32f2f', color: '#fff', padding: '0.75rem 1rem', borderRadius: '6px', fontSize: '0.9rem', fontWeight: '500' }}>
                  ⚠️ {errorMsg}
                </div>
              )}
              {successMsg && (
                <div style={{ background: '#388e3c', color: '#fff', padding: '0.75rem 1rem', borderRadius: '6px', fontSize: '0.9rem', fontWeight: '500' }}>
                  ✅ {successMsg}
                </div>
              )}

              {/* Intervention Info Cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem' }}>
                <div style={{ background: 'rgba(255,255,255,0.02)', padding: '0.75rem 1rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.04)' }}>
                  <span style={{ fontSize: '0.8rem', color: '#aaa', display: 'block' }}>Baie Atelier</span>
                  <span style={{ fontSize: '1rem', fontWeight: 'bold', color: '#fff' }}>{selectedCase.workshopBay || 'Non définie'}</span>
                </div>
                <div style={{ background: 'rgba(255,255,255,0.02)', padding: '0.75rem 1rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.04)' }}>
                  <span style={{ fontSize: '0.8rem', color: '#aaa', display: 'block' }}>Priorité</span>
                  <span style={{ fontSize: '1rem', fontWeight: 'bold', color: selectedCase.workshopPriority === 'haute' ? '#f44336' : selectedCase.workshopPriority === 'normale' ? '#ff9800' : '#4caf50' }}>
                    {selectedCase.workshopPriority?.toUpperCase() || 'NORMALE'}
                  </span>
                </div>
                <div style={{ background: 'rgba(255,255,255,0.02)', padding: '0.75rem 1rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.04)' }}>
                  <span style={{ fontSize: '0.8rem', color: '#aaa', display: 'block' }}>Durée Estimée</span>
                  <span style={{ fontSize: '1rem', fontWeight: 'bold', color: '#fff' }}>
                    {selectedCase.estimatedDurationMinutes ? `${selectedCase.estimatedDurationMinutes} min` : 'Non définie'}
                  </span>
                </div>
              </div>

              {/* Client Demand */}
              <div style={{ background: 'rgba(0, 176, 255, 0.04)', borderLeft: '4px solid #00b0ff', padding: '0.75rem 1rem', borderRadius: '4px' }}>
                <strong style={{ display: 'block', fontSize: '0.85rem', color: '#00b0ff', marginBottom: '0.25rem' }}>Demande Client / Motif de Réception :</strong>
                <p style={{ margin: 0, fontSize: '0.9rem', color: '#eee', lineHeight: '1.4' }}>
                  {caseLogs.find(l => l.action === 'create_case')?.details?.split('Motif: ')[1]?.split('. Kilométrage')[0] || 'Entretien général / diagnostic demandé'}
                </p>
              </div>

              {/* Controls and Status transition actions */}
              <div style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '1.25rem' }}>
                <h3 style={{ margin: '0 0 0.75rem 0', fontSize: '1.1rem' }}>Actions Intervention</h3>
                <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>

                  {/* Start Work Action */}
                  {(selectedCase.status === 'diagnosis' || selectedCase.status === 'waiting_parts') && (
                    <Button onClick={() => handleStartWork(selectedCase.id)} variant="primary" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span>▶️</span> Démarrer l'intervention
                    </Button>
                  )}

                  {/* Already in repair status message */}
                  {selectedCase.status === 'repair' && (
                    <span style={{ color: '#aaa', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'rgba(255,152,0,0.08)', padding: '0.5rem 1rem', borderRadius: '6px', border: '1px solid rgba(255,152,0,0.2)' }}>
                      <span>⚙️</span> Intervention en cours... complétez toutes les tâches ci-dessous pour terminer.
                    </span>
                  )}

                  {/* Complete Work Action */}
                  {selectedCase.status === 'repair' && (
                    <Button
                      onClick={() => handleCompleteWork(selectedCase.id)}
                      variant="primary"
                      disabled={!(selectedCase.workshopTasks && selectedCase.workshopTasks.length > 0 && selectedCase.workshopTasks.every(t => t.status === 'done'))}
                      style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: '#388e3c', borderColor: '#388e3c' }}
                    >
                      <span>🏁</span> Terminer l'intervention
                    </Button>
                  )}

                  {/* Other statuses info */}
                  {!['diagnosis', 'waiting_parts', 'repair'].includes(selectedCase.status) && (
                    <span style={{ color: '#aaa', fontSize: '0.85rem', fontStyle: 'italic' }}>
                      Aucune action disponible pour le statut actuel ({selectedCase.status}).
                    </span>
                  )}
                </div>
              </div>

              {/* Tasks List */}
              <div style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '1.25rem' }}>
                <h3 style={{ margin: '0 0 0.75rem 0', fontSize: '1.1rem' }}>Tâches Atelier ({selectedCase.workshopTasks?.length || 0})</h3>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {!selectedCase.workshopTasks || selectedCase.workshopTasks.length === 0 ? (
                    <p style={{ color: '#888', fontStyle: 'italic', fontSize: '0.9rem', margin: 0 }}>Aucune tâche planifiée par le Chef d'Atelier.</p>
                  ) : (
                    selectedCase.workshopTasks.map((t) => (
                      <div
                        key={t.id}
                        style={{
                          background: 'rgba(255,255,255,0.015)',
                          padding: '0.75rem 1rem',
                          borderRadius: '8px',
                          border: '1px solid rgba(255,255,255,0.04)',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          flexWrap: 'wrap',
                          gap: '0.75rem',
                          borderLeft: t.status === 'done' ? '4px solid #4caf50' : t.status === 'in_progress' ? '4px solid #ff9800' : '4px solid #9e9e9e'
                        }}
                      >
                        <div>
                          <span style={{ fontWeight: '500', color: '#fff', fontSize: '0.95rem' }}>{t.label}</span>
                          <span style={{ display: 'block', fontSize: '0.75rem', color: '#aaa', marginTop: '0.15rem' }}>
                            Statut : <strong style={{ color: t.status === 'done' ? '#4caf50' : t.status === 'in_progress' ? '#ff9800' : '#aaa' }}>{t.status.toUpperCase().replace('_', ' ')}</strong>
                          </span>
                        </div>

                        {/* Task transition triggers */}
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          {t.status === 'pending' && selectedCase.status === 'repair' && (
                            <Button size="sm" variant="ghost" onClick={() => handleUpdateTaskStatus(selectedCase.id, t.id, 'in_progress')}>
                              ⚙️ Commencer
                            </Button>
                          )}
                          {t.status === 'in_progress' && selectedCase.status === 'repair' && (
                            <Button size="sm" variant="ghost" onClick={() => handleUpdateTaskStatus(selectedCase.id, t.id, 'done')} style={{ borderColor: '#4caf50', color: '#4caf50' }}>
                              ✅ Terminer
                            </Button>
                          )}
                          {t.status === 'done' && (
                            <span style={{ fontSize: '0.85rem', color: '#4caf50', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                              <span>✓</span> Complétée
                            </span>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* History / Audit Logs */}
              <div>
                <h3 style={{ margin: '0 0 0.75rem 0', fontSize: '1.1rem' }}>Historique du Dossier</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '180px', overflowY: 'auto', paddingRight: '0.25rem' }}>
                  {caseLogs.length === 0 ? (
                    <p style={{ color: '#888', fontStyle: 'italic', fontSize: '0.9rem', margin: 0 }}>Aucun historique disponible.</p>
                  ) : (
                    caseLogs.map((log) => (
                      <div key={log.id} style={{ background: 'rgba(255,255,255,0.01)', padding: '0.5rem 0.75rem', borderRadius: '6px', fontSize: '0.8rem', border: '1px solid rgba(255,255,255,0.03)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#00b0ff', marginBottom: '0.15rem' }}>
                          <span style={{ fontWeight: '600' }}>{log.action}</span>
                          <span style={{ color: '#888' }}>{new Date(log.timestamp).toLocaleTimeString()}</span>
                        </div>
                        <p style={{ margin: 0, color: '#eee' }}>{log.details}</p>
                        <p style={{ margin: '0.15rem 0 0 0', fontSize: '0.75rem', color: '#666' }}>
                          Acteur : {log.userRole} (ID: {log.userId})
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

    </div>
  );
};
