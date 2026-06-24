import React from 'react';
import type { User } from '@/types';

interface DashboardViewProps {
  user: User;
}

export const DashboardView: React.FC<DashboardViewProps> = ({ user }) => {
  return (
    <div className="view-container" id="dashboard-view">
      <header className="view-header">
        <h1 className="view-title">Pilotage SAV</h1>
        <p className="view-subtitle">Directeur : {user.name}</p>
      </header>
      <main className="view-main">
        <div className="view-placeholder">
          <span className="view-placeholder-icon">📊</span>
          <p>Dashboard Directeur SAV — à implémenter en v24.1</p>
          <ul className="view-feature-list">
            <li>KPIs performance atelier</li>
            <li>Dossiers en cours / livrés</li>
            <li>Suivi plannings et today</li>
            <li>Contrôle qualité synthèse</li>
          </ul>
        </div>
      </main>
    </div>
  );
};
