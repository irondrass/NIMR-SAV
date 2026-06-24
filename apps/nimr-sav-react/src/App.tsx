import React, { useState, useCallback } from 'react';
import type { User } from '@/types';
import { ROLE_DEFAULT_VIEW, ROLE_ALLOWED_TABS } from '@/types';
import { APP_VERSION } from '@/constants/version';
import { LoginScreen } from '@/features/auth/LoginScreen';
import { ReceptionView } from '@/features/reception/ReceptionView';
import { TechnicianView } from '@/features/technician/TechnicianView';
import { QCView } from '@/features/qc/QCView';
import { PlanningView } from '@/features/chef-atelier/PlanningView';
import { DashboardView } from '@/features/directeur/DashboardView';
import { AdminView } from '@/features/admin/AdminView';
import { ReadOnlyView } from '@/features/lecture-seule/ReadOnlyView';
import { Button } from '@/components/ui/Button';

/**
 * Role-based view renderer.
 * Each role gets exactly the view configured in ROLE_DEFAULT_VIEW.
 * Directeur SAV and Admin have access to multiple tabs via ROLE_ALLOWED_TABS.
 */
function renderViewForRole(user: User, activeTab: string): React.ReactNode {
  const allowedTabs = ROLE_ALLOWED_TABS[user.role];
  const tab = allowedTabs.includes(activeTab) ? activeTab : allowedTabs[0];

  switch (tab) {
    case 'reception':
      return <ReceptionView user={user} />;
    case 'mes-taches':
      return <TechnicianView user={user} />;
    case 'planning':
    case 'suivi-atelier':
      return <PlanningView user={user} />;
    case 'controle-qualite':
      return <QCView user={user} />;
    case 'pilotage':
    case 'today':
    case 'dossiers':
      return <DashboardView user={user} />;
    case 'admin':
    case 'utilisateurs':
      return <AdminView user={user} />;
    case 'lecture':
      return <ReadOnlyView user={user} />;
    default:
      return <DashboardView user={user} />;
  }
}

const TAB_LABELS: Record<string, string> = {
  reception: 'Réception',
  'mes-taches': 'Mes tâches',
  planning: 'Planning',
  'suivi-atelier': 'Suivi Atelier',
  'controle-qualite': 'Contrôle QC',
  pilotage: 'Pilotage',
  today: "Aujourd'hui",
  dossiers: 'Dossiers',
  admin: 'Admin',
  utilisateurs: 'Utilisateurs',
  lecture: 'Consultation',
};

export const App: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [activeTab, setActiveTab] = useState<string>('');

  const handleLogin = useCallback((user: User) => {
    setCurrentUser(user);
    setActiveTab(ROLE_DEFAULT_VIEW[user.role].replace('/', ''));
  }, []);

  const handleLogout = useCallback(() => {
    setCurrentUser(null);
    setActiveTab('');
  }, []);

  if (!currentUser) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  const allowedTabs = ROLE_ALLOWED_TABS[currentUser.role];

  return (
    <div className="app-shell" id="app-shell">
      {/* Top bar */}
      <header className="app-topbar" role="banner">
        <div className="topbar-brand">
          <span className="topbar-logo">NIMR</span>
          <span className="topbar-version">{APP_VERSION}</span>
        </div>
        <div className="topbar-user">
          <span className="topbar-username">{currentUser.name}</span>
          <Button
            variant="ghost"
            size="sm"
            id="logout-btn"
            onClick={handleLogout}
          >
            {currentUser.canSwitchAccount ? 'Changer de compte' : 'Déconnexion'}
          </Button>
        </div>
      </header>

      {/* Tab navigation — only if role has multiple tabs */}
      {allowedTabs.length > 1 && (
        <nav className="app-tabs" role="navigation" aria-label="Navigation par rôle">
          {allowedTabs.map((tab) => (
            <button
              key={tab}
              id={`tab-${tab}`}
              className={`app-tab ${activeTab === tab ? 'app-tab--active' : ''}`}
              onClick={() => setActiveTab(tab)}
              aria-current={activeTab === tab ? 'page' : undefined}
            >
              {TAB_LABELS[tab] ?? tab}
            </button>
          ))}
        </nav>
      )}

      {/* Main view */}
      <main className="app-content" role="main">
        {renderViewForRole(currentUser, activeTab)}
      </main>
    </div>
  );
};
