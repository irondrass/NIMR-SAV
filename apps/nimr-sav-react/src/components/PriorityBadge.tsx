import React from 'react';
import { getPriorityDisplay } from '../domain/ui-field-guidelines';

interface PriorityBadgeProps {
  priority: 'basse' | 'normale' | 'haute' | 'low' | 'normal' | 'high' | 'urgent' | string;
}

export const PriorityBadge: React.FC<PriorityBadgeProps> = ({ priority }) => {
  const getPriorityColor = (p: string): string => {
    switch (p) {
      case 'basse':
      case 'low':
        return '#94a3b8';
      case 'normale':
      case 'normal':
        return '#3b82f6';
      case 'haute':
      case 'high':
        return '#f97316';
      case 'urgent':
        return '#ef4444';
      default:
        return '#6b7280';
    }
  };

  return (
    <span
      className={`priority-badge priority-${priority}`}
      style={{
        display: 'inline-block',
        padding: '0.2rem 0.5rem',
        borderRadius: '4px',
        fontSize: '0.7rem',
        fontWeight: 700,
        textTransform: 'uppercase',
        backgroundColor: `${getPriorityColor(priority)}15`,
        color: getPriorityColor(priority),
        border: `1px solid ${getPriorityColor(priority)}25`,
      }}
    >
      {getPriorityDisplay(priority)}
    </span>
  );
};
