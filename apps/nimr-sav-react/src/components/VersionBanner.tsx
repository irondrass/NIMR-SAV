import React from 'react';
import { APP_VERSION } from '../constants/version';

export const VersionBanner: React.FC = () => {
  return (
    <div
      className="version-banner"
      style={{
        width: '100%',
        padding: '0.5rem 1rem',
        fontSize: '0.75rem',
        color: '#71717a',
        textAlign: 'center',
        borderTop: '1px solid rgba(255, 255, 255, 0.05)',
        backgroundColor: 'rgba(0, 0, 0, 0.1)',
        marginTop: 'auto',
      }}
    >
      <span>NIMR Carrosserie SAV — {APP_VERSION} (Migration active — v23.2.6 pilote stable)</span>
    </div>
  );
};
