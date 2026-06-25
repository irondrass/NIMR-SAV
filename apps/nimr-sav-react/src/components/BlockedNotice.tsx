import React from 'react';
import { CaseStatus } from '../domain/case-status';
import { Role } from '../types';
import { getBlockedStateMessage } from '../domain/ui-field-guidelines';

interface BlockedNoticeProps {
  status: CaseStatus;
  role: Role;
  messageOverride?: string;
}

export const BlockedNotice: React.FC<BlockedNoticeProps> = ({ status, role, messageOverride }) => {
  return (
    <div
      className="blocked-notice-banner"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.75rem',
        padding: '0.75rem 1rem',
        backgroundColor: 'rgba(239, 68, 68, 0.1)',
        border: '1px solid rgba(239, 68, 68, 0.25)',
        borderRadius: '6px',
        color: '#fca5a5',
        fontSize: '0.85rem',
        margin: '1rem 0',
      }}
    >
      <span style={{ fontSize: '1.1rem' }} role="img" aria-label="warning icon">
        ⚠️
      </span>
      <p style={{ margin: 0, fontWeight: 500 }}>
        {messageOverride || getBlockedStateMessage(status, role)}
      </p>
    </div>
  );
};
