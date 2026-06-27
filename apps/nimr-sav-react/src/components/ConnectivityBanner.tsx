import React from 'react';
import { useConnectivity } from '../state/useConnectivity';
import { useSavCases } from '../state/useSavCases';

export const ConnectivityBanner: React.FC = () => {
  const { isOffline, message } = useConnectivity();
  const { pendingActions } = useSavCases();
  const queuedCount = pendingActions.filter((a) => a.status === 'queued').length;

  if (!isOffline && queuedCount === 0) return null;

  const getBannerStyles = () => {
    if (isOffline) {
      return {
        background: '#ef4444',
        color: '#fff',
        borderBottom: '1px solid #b91c1c',
      };
    }
    // online but has queued actions
    return {
      background: '#f59e0b',
      color: '#000',
      borderBottom: '1px solid #d97706',
    };
  };

  return (
    <div
      id="connectivity-banner"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0.6rem 1rem',
        fontSize: '0.85rem',
        fontWeight: 600,
        ...getBannerStyles(),
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <span>{isOffline ? '⚠️' : '🔄'}</span>
        <span>
          {isOffline ? 'Mode hors ligne' : 'Reconnecté'} — {message}.{' '}
          {queuedCount > 0 ? `${queuedCount} action(s) en attente de synchronisation.` : 'Aucune action en attente.'}
        </span>
      </div>
      {queuedCount > 0 && (
        <div style={{ fontSize: '0.8rem', background: 'rgba(0,0,0,0.15)', padding: '0.2rem 0.5rem', borderRadius: '4px' }}>
          Données locales non synchronisées
        </div>
      )}
    </div>
  );
};
