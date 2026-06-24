import React, { useState } from 'react';
import type { Role, User } from '@/types';
import { ALL_ROLES } from '@/types';
import { Button } from '@/components/ui/Button';
import { APP_VERSION } from '@/constants/version';

const ROLE_LABELS: Record<Role, string> = {
  reception: 'Réception',
  technicien: 'Technicien',
  'chef-atelier': 'Chef Atelier',
  qualite: 'Qualité',
  'directeur-sav': 'Directeur SAV',
  admin: 'Admin Technique',
  'lecture-seule': 'Lecture Seule',
  livraison: 'Livraison',
};

interface LoginScreenProps {
  onLogin: (user: User) => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onLogin }) => {
  const [selectedRole, setSelectedRole] = useState<Role | ''>('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRole) {
      setError('Veuillez sélectionner un rôle.');
      return;
    }
    if (!name.trim()) {
      setError('Veuillez entrer votre nom.');
      return;
    }
    const user: User = {
      id: `v24-${selectedRole}-${Date.now()}`,
      name: name.trim(),
      role: selectedRole,
      canSwitchAccount: selectedRole === 'admin',
    };
    onLogin(user);
  };

  return (
    <div className="login-screen" id="login-screen">
      <div className="login-card">
        <div className="login-header">
          <div className="login-logo" aria-label="NIMR Carrosserie">
            <span className="login-logo-text">NIMR</span>
            <span className="login-logo-sub">Carrosserie SAV</span>
          </div>
          <p className="login-version">{APP_VERSION}</p>
        </div>

        <form className="login-form" onSubmit={handleSubmit} noValidate>
          <div className="form-group">
            <label htmlFor="login-name" className="form-label">
              Nom
            </label>
            <input
              id="login-name"
              type="text"
              className="form-input"
              value={name}
              onChange={(e) => { setName(e.target.value); setError(''); }}
              placeholder="Votre prénom et nom"
              autoComplete="name"
            />
          </div>

          <div className="form-group">
            <label htmlFor="login-role" className="form-label">
              Rôle
            </label>
            <select
              id="login-role"
              className="form-select"
              value={selectedRole}
              onChange={(e) => { setSelectedRole(e.target.value as Role); setError(''); }}
            >
              <option value="">— Sélectionner un rôle —</option>
              {ALL_ROLES.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABELS[role]}
                </option>
              ))}
            </select>
          </div>

          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}

          <Button
            type="submit"
            variant="primary"
            size="lg"
            id="login-submit-btn"
            style={{ width: '100%' }}
          >
            Se connecter
          </Button>
        </form>
      </div>
    </div>
  );
};
