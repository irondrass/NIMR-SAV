import React from 'react';
import type { User } from '@/types';

interface QCViewProps {
  user: User;
}

export const QCView: React.FC<QCViewProps> = ({ user }) => {
  return (
    <div className="view-container" id="qc-view">
      <header className="view-header">
        <h1 className="view-title">Contrôle Qualité</h1>
        <p className="view-subtitle">Contrôleur : {user.name}</p>
      </header>
      <main className="view-main">
        <div className="view-placeholder">
          <span className="view-placeholder-icon">✅</span>
          <p>Vue QC dédiée — à implémenter en v24.1</p>
          <ul className="view-feature-list">
            <li>Checklist QC par véhicule</li>
            <li>Validation finale avant livraison</li>
            <li>Historique des contrôles</li>
            <li>Signalement de non-conformités</li>
          </ul>
        </div>
      </main>
    </div>
  );
};
