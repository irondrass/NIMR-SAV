import React from 'react';
import type { User } from '@/types';

interface ReadOnlyViewProps {
  user: User;
}

export const ReadOnlyView: React.FC<ReadOnlyViewProps> = ({ user }) => {
  return (
    <div className="view-container" id="readonly-view">
      <header className="view-header">
        <h1 className="view-title">Consultation</h1>
        <p className="view-subtitle">Observateur : {user.name}</p>
      </header>
      <main className="view-main">
        <div className="view-placeholder">
          <span className="view-placeholder-icon">👁️</span>
          <p>Accès lecture seule — à implémenter en v24.1</p>
          <ul className="view-feature-list">
            <li>Consultation des dossiers</li>
            <li>Aucune modification possible</li>
            <li>Export en lecture seule</li>
          </ul>
        </div>
      </main>
    </div>
  );
};
