import React from 'react';
import type { User } from '@/types';

interface TechnicianViewProps {
  user: User;
}

export const TechnicianView: React.FC<TechnicianViewProps> = ({ user }) => {
  return (
    <div className="view-container" id="technician-view">
      <header className="view-header">
        <h1 className="view-title">Mes tâches</h1>
        <p className="view-subtitle">Technicien : {user.name}</p>
      </header>
      <main className="view-main">
        <div className="view-placeholder">
          <span className="view-placeholder-icon">🔧</span>
          <p>Vue technicien — à implémenter en v24.1</p>
          <ul className="view-feature-list">
            <li>Tâches assignées du jour</li>
            <li>Statut d'avancement</li>
            <li>Pièces en attente</li>
            <li>Temps de travail</li>
          </ul>
        </div>
      </main>
    </div>
  );
};
