import React from 'react';
import type { User } from '@/types';

interface PlanningViewProps {
  user: User;
}

export const PlanningView: React.FC<PlanningViewProps> = ({ user }) => {
  return (
    <div className="view-container" id="planning-view">
      <header className="view-header">
        <h1 className="view-title">Planning / Suivi Atelier</h1>
        <p className="view-subtitle">Chef Atelier : {user.name}</p>
      </header>
      <main className="view-main">
        <div className="view-placeholder">
          <span className="view-placeholder-icon">📅</span>
          <p>Vue planning — à implémenter en v24.1</p>
          <ul className="view-feature-list">
            <li>Vue planning hebdomadaire</li>
            <li>Affectation des techniciens</li>
            <li>Suivi des dossiers en cours</li>
            <li>Alertes retard / blocage</li>
          </ul>
        </div>
      </main>
    </div>
  );
};
