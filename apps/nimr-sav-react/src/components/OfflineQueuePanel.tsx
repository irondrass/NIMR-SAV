import React, { useState } from 'react';
import { useSavCases } from '../state/useSavCases';
import { getOfflineActionLabel, summarizeOfflineQueue } from '../domain/offline-queue';
import { useConnectivity } from '../state/useConnectivity';

export const OfflineQueuePanel: React.FC = () => {
  const { pendingActions, replayPendingActions, cancelPendingAction, clearPendingAction } = useSavCases();
  const { isOnline } = useConnectivity();
  const [replayResult, setReplayResult] = useState<string | null>(null);

  const queuedActions = pendingActions.filter((a) => a.status === 'queued');
  const summaryText = summarizeOfflineQueue(pendingActions);

  const handleReplay = () => {
    const res = replayPendingActions();
    setReplayResult(
      `Synchronisation simulée terminée : ${res.succeeded.length} succès, ${res.failed.length} échec(s).`
    );
    setTimeout(() => setReplayResult(null), 5000);
  };

  if (pendingActions.length === 0) {
    return (
      <div style={{ padding: '1rem', background: '#1e1e24', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)', color: '#71717a', fontSize: '0.85rem' }}>
        Aucune action en attente dans la file d'attente hors ligne.
      </div>
    );
  }

  return (
    <div
      id="offline-queue-panel"
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 600 }}>
          📦 File d'attente Hors Ligne
        </h3>
        {isOnline && queuedActions.length > 0 && (
          <button
            onClick={handleReplay}
            style={{
              padding: '0.35rem 0.75rem',
              background: '#3b82f6',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              fontSize: '0.8rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            🔄 Rejouer les actions
          </button>
        )}
      </div>

      <div style={{ fontSize: '0.8rem', color: '#a1a1aa' }}>
        {summaryText}
        <br />
        <span style={{ fontStyle: 'italic', fontSize: '0.75rem' }}>
          * Reprise locale simulée après reconnexion (Aucune synchronisation serveur dans cette version).
        </span>
      </div>

      {replayResult && (
        <div style={{ fontSize: '0.8rem', color: '#10b981', background: 'rgba(16,185,129,0.05)', padding: '0.4rem', borderRadius: '4px' }}>
          {replayResult}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '180px', overflowY: 'auto' }}>
        {pendingActions.map((act) => (
          <div
            key={act.id}
            style={{
              padding: '0.5rem',
              background: 'rgba(0,0,0,0.15)',
              borderRadius: '4px',
              fontSize: '0.8rem',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <div>
              <div style={{ fontWeight: 600, color: '#e4e4e7' }}>
                {getOfflineActionLabel(act.type)}
              </div>
              <div style={{ fontSize: '0.7rem', color: '#71717a' }}>
                {new Date(act.timestamp).toLocaleTimeString()} | Statut :{' '}
                <span
                  style={{
                    color:
                      act.status === 'queued'
                        ? '#f59e0b'
                        : act.status === 'replayed'
                        ? '#10b981'
                        : '#ef4444',
                  }}
                >
                  {act.status}
                </span>
                {act.error && ` — Erreur : ${act.error}`}
              </div>
            </div>
            {act.status === 'queued' && (
              <button
                onClick={() => cancelPendingAction(act.id)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#ef4444',
                  cursor: 'pointer',
                  fontSize: '0.75rem',
                }}
              >
                Annuler
              </button>
            )}
            {act.status !== 'queued' && (
              <button
                onClick={() => clearPendingAction(act.id)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#71717a',
                  cursor: 'pointer',
                  fontSize: '0.75rem',
                }}
              >
                Effacer
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
