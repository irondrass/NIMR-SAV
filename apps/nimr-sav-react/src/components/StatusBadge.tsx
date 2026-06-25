import React from 'react';
import { CaseStatus } from '../domain/case-status';
import { getStatusDisplay } from '../domain/ui-field-guidelines';

interface StatusBadgeProps {
  status: CaseStatus;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status }) => {
  const getStatusColor = (s: CaseStatus): string => {
    switch (s) {
      case 'draft': return '#94a3b8';
      case 'received': return '#3b82f6';
      case 'diagnosis': return '#6366f1';
      case 'waiting_parts': return '#f97316';
      case 'repair': return '#eab308';
      case 'work_completed': return '#10b981';
      case 'quality_pending': return '#38bdf8';
      case 'quality_rejected': return '#ef4444';
      case 'quality_rework': return '#f43f5e';
      case 'quality_approved': return '#059669';
      case 'ready_delivery': return '#10b981';
      case 'delivered': return '#4b5563';
      case 'closed': return '#6b7280';
      case 'cancelled': return '#374151';
      default: return '#6b7280';
    }
  };

  return (
    <span
      className={`status-badge badge-${status}`}
      style={{
        display: 'inline-block',
        padding: '0.25rem 0.75rem',
        borderRadius: '9999px',
        fontSize: '0.75rem',
        fontWeight: 600,
        backgroundColor: `${getStatusColor(status)}20`,
        color: getStatusColor(status),
        border: `1px solid ${getStatusColor(status)}30`,
        whiteSpace: 'nowrap',
      }}
    >
      {getStatusDisplay(status)}
    </span>
  );
};
