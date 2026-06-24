import React from 'react';
import type { User } from '@/types';

interface ReceptionViewProps {
  user: User;
}

export const ReceptionView: React.FC<ReceptionViewProps> = ({ user }) => {
  return (
    <div className="view-container" id="reception-view">
      <header className="view-header">
        <h1 className="view-title">Réception guidée</h1>
        <p className="view-subtitle">Bonjour, {user.name}</p>
      </header>
      <main className="view-main">
        <div className="view-placeholder">
          <span className="view-placeholder-icon">📋</span>
          <p>Interface de réception — à implémenter en v24.1</p>
          <ul className="view-feature-list">
            <li>Nouveau dossier véhicule</li>
            <li>Saisie immatriculation</li>
            <li>Diagnostic initial guidé</li>
            <li>Assignation technicien</li>
          </ul>
        </div>
      </main>
    </div>
  );
};
