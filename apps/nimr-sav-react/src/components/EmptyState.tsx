import React from 'react';
import { Role } from '../types';
import { getEmptyStateForRole } from '../domain/ui-field-guidelines';

interface EmptyStateProps {
  role: Role;
  messageOverride?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({ role, messageOverride }) => {
  const getIcon = (r: Role): string => {
    switch (r) {
      case 'reception': return '📝';
      case 'chef-atelier': return '🗓️';
      case 'technicien': return '🔧';
      case 'qualite': return '🛡️';
      case 'livraison': return '📦';
      default: return '🔍';
    }
  };

  return (
    <div
      className="empty-state-container"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2.5rem',
        background: 'rgba(255, 255, 255, 0.02)',
        border: '1px dashed rgba(255, 255, 255, 0.1)',
        borderRadius: '8px',
        textAlign: 'center',
        margin: '1.5rem 0',
      }}
    >
      <span style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }} role="img" aria-label="empty icon">
        {getIcon(role)}
      </span>
      <p style={{ margin: 0, color: '#a1a1aa', fontSize: '0.95rem', lineHeight: 1.5 }}>
        {messageOverride || getEmptyStateForRole(role)}
      </p>
    </div>
  );
};
