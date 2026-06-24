import React from 'react';
import type { User } from '@/types';

interface AdminViewProps {
  user: User;
}

export const AdminView: React.FC<AdminViewProps> = ({ user }) => {
  return (
    <div className="view-container" id="admin-view">
      <header className="view-header">
        <h1 className="view-title">Paramètres Techniques</h1>
        <p className="view-subtitle">Admin : {user.name}</p>
      </header>
      <main className="view-main">
        <div className="view-placeholder">
          <span className="view-placeholder-icon">⚙️</span>
          <p>Administration technique — à implémenter en v24.1</p>
          <ul className="view-feature-list">
            <li>Gestion des utilisateurs</li>
            <li>Configuration Supabase</li>
            <li>Permissions et rôles</li>
            <li>Nettoyage et restauration</li>
          </ul>
        </div>
      </main>
    </div>
  );
};
