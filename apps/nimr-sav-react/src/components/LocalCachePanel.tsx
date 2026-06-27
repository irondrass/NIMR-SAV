import React, { useState, useEffect } from 'react';
import { useSavCases } from '../state/useSavCases';
import { getLocalSnapshotMetadata, hasLocalSnapshot, loadSnapshotFromLocalStorage, SnapshotMetadata } from '../state/local-cache-adapter';

export const LocalCachePanel: React.FC = () => {
  const { saveLocalSnapshot, restoreLocalSnapshot, clearLocalCache } = useSavCases();
  const [metadata, setMetadata] = useState<SnapshotMetadata | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refreshMetadata = () => {
    setMetadata(getLocalSnapshotMetadata());
  };

  useEffect(() => {
    refreshMetadata();
  }, []);

  const handleSave = () => {
    const res = saveLocalSnapshot();
    if (res.success) {
      setMessage("Snapshot local sauvegardé avec succès.");
      refreshMetadata();
    } else {
      setMessage(`Erreur : ${res.error}`);
    }
    setTimeout(() => setMessage(null), 5000);
  };

  const handleRestore = () => {
    if (!hasLocalSnapshot()) return;
    if (window.confirm("Voulez-vous restaurer le snapshot local ? Cela écrasera l'état actuel de l'application.")) {
      const snap = loadSnapshotFromLocalStorage();
      if (!snap) {
        setMessage("Erreur: Aucun snapshot disponible pour la restauration.");
        return;
      }
      const res = restoreLocalSnapshot(snap);
      if (res.success) {
        setMessage("Snapshot local restauré avec succès.");
        refreshMetadata();
      } else {
        setMessage(`Erreur de restauration : ${res.error}`);
      }
      setTimeout(() => setMessage(null), 5000);
    }
  };

  const handleClear = () => {
    if (window.confirm("Voulez-vous vider le cache local ? Cette action est irréversible.")) {
      clearLocalCache();
      setMessage("Cache local vidé.");
      refreshMetadata();
      setTimeout(() => setMessage(null), 5000);
    }
  };

  return (
    <div
      id="local-cache-panel"
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
      <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 600 }}>
        💾 Cache Local &amp; Sauvegardes
      </h3>

      <div style={{ fontSize: '0.8rem', color: '#a1a1aa' }}>
        {metadata ? (
          <div>
            Snapshot local disponible :
            <ul style={{ margin: '0.25rem 0 0 1rem', padding: 0 }}>
              <li>Créé le : {metadata.createdAt ? new Date(metadata.createdAt).toLocaleString() : 'Inconnu'}</li>
              <li>Version App : {metadata.appVersion}</li>
              <li>Nombre de dossiers : {metadata.casesCount}</li>
              <li>Actions en attente : {metadata.pendingCount}</li>
            </ul>
          </div>
        ) : (
          "Aucun snapshot local enregistré."
        )}
      </div>

      {message && (
        <div style={{ fontSize: '0.8rem', color: '#10b981', background: 'rgba(16,185,129,0.05)', padding: '0.4rem', borderRadius: '4px' }}>
          {message}
        </div>
      )}

      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <button
          onClick={handleSave}
          style={{
            padding: '0.35rem 0.75rem',
            background: 'rgba(59,130,246,0.1)',
            border: '1px solid rgba(59,130,246,0.3)',
            borderRadius: '4px',
            color: '#93c5fd',
            fontSize: '0.8rem',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          💾 Sauvegarder Snapshot
        </button>

        {hasLocalSnapshot() && (
          <>
            <button
              onClick={handleRestore}
              style={{
                padding: '0.35rem 0.75rem',
                background: 'rgba(16,185,129,0.1)',
                border: '1px solid rgba(16,185,129,0.3)',
                borderRadius: '4px',
                color: '#a7f3d0',
                fontSize: '0.8rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              🔄 Restaurer Snapshot
            </button>
            <button
              onClick={handleClear}
              style={{
                padding: '0.35rem 0.75rem',
                background: 'rgba(239,68,68,0.1)',
                border: '1px solid rgba(239,68,68,0.3)',
                borderRadius: '4px',
                color: '#fca5a5',
                fontSize: '0.8rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              🗑️ Vider Cache
            </button>
          </>
        )}
      </div>
    </div>
  );
};
