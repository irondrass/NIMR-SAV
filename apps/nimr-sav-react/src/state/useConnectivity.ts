import { useState, useEffect } from 'react';
import {
  ConnectivityStatus,
  getInitialConnectivityStatus,
  deriveConnectivityMessage,
  deriveConnectivitySeverity,
} from '../domain/connectivity';

export function useConnectivity() {
  const [status, setStatus] = useState<ConnectivityStatus>(getInitialConnectivityStatus());
  const [lastChangedAt, setLastChangedAt] = useState<string>(new Date().toISOString());

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleOnline = () => {
      setStatus('online');
      setLastChangedAt(new Date().toISOString());
    };

    const handleOffline = () => {
      setStatus('offline');
      setLastChangedAt(new Date().toISOString());
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Also update on mount to be sure
    setStatus(navigator.onLine ? 'online' : 'offline');

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const isOnline = status === 'online';
  const isOffline = status === 'offline';
  const message = deriveConnectivityMessage(status);
  const severity = deriveConnectivitySeverity(status);

  return {
    status,
    isOnline,
    isOffline,
    lastChangedAt,
    message,
    severity,
  };
}
