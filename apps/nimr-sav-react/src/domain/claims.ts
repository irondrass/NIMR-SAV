import { Claim } from './sav-case';

export function createDefaultClaim(): Claim {
  const now = new Date().toISOString();
  return {
    id: `claim-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    label: 'Nouveau sinistre',
    claimType: 'insurance',
    payerType: 'assurance',
    status: 'draft',
    description: '',
    estimatedAmount: 0,
    expertApproved: false,
    clientApproved: false,
    requiredApprovals: ['expert', 'client'],
    createdAt: now,
    updatedAt: now,
  };
}

export function normalizeClaim(claim: Partial<Claim>): Claim {
  const now = new Date().toISOString();
  const claimType = claim.claimType || 'insurance';

  const defaultPayer: Record<string, 'assurance' | 'client' | 'garantie' | 'interne'> = {
    insurance: 'assurance',
    customer: 'client',
    warranty: 'garantie',
    internal: 'interne',
    mixed: 'client',
  };
  const payerType = claim.payerType || defaultPayer[claimType] || 'assurance';

  let requiredApprovals = claim.requiredApprovals;
  if (!requiredApprovals) {
    if (claimType === 'insurance') {
      requiredApprovals = ['expert', 'client'];
    } else if (claimType === 'customer') {
      requiredApprovals = ['client'];
    } else if (claimType === 'warranty') {
      requiredApprovals = ['internal'];
    } else {
      requiredApprovals = ['internal'];
    }
  }

  return {
    id: claim.id || `claim-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    label: claim.label || 'Sinistre sans nom',
    claimType,
    payerType,
    status: claim.status || 'draft',
    description: claim.description || '',
    estimatedAmount: claim.estimatedAmount !== undefined ? claim.estimatedAmount : 0,
    expertApproved: !!claim.expertApproved,
    clientApproved: !!claim.clientApproved,
    expertApprovalAt: claim.expertApprovalAt,
    clientApprovalAt: claim.clientApprovalAt,
    expertName: claim.expertName || '',
    clientApprovalReference: claim.clientApprovalReference || '',
    requiredApprovals,
    notes: claim.notes || '',
    createdAt: claim.createdAt || now,
    updatedAt: claim.updatedAt || now,
  };
}

export function normalizeClaims(claims: unknown): Claim[] {
  if (!claims || !Array.isArray(claims)) return [];
  return claims.map((c) => normalizeClaim(c));
}

export function getClaimRequiredApprovals(claim: Claim): string[] {
  return claim.requiredApprovals || [];
}

export function isClaimExpertApprovalRequired(claim: Claim): boolean {
  return getClaimRequiredApprovals(claim).includes('expert');
}

export function isClaimClientApprovalRequired(claim: Claim): boolean {
  return getClaimRequiredApprovals(claim).includes('client');
}

export function isClaimApprovedForPlanning(claim: Claim): boolean {
  if (claim.status === 'cancelled') return true;
  if (claim.status === 'rejected') return false;

  if (claim.claimType === 'insurance') {
    return claim.expertApproved && claim.clientApproved;
  }
  if (claim.claimType === 'customer') {
    return claim.clientApproved;
  }
  // warranty / internal require approved status
  return claim.status === 'approved';
}

export function getBlockingClaimsReasons(claims: Claim[] | undefined, overridden = false): string[] {
  if (overridden) return [];
  if (!claims || claims.length === 0) return [];

  const reasons: string[] = [];
  claims.forEach((claim) => {
    if (claim.status === 'cancelled') return;
    if (claim.status === 'rejected') {
      reasons.push(`Le sinistre "${claim.label}" est rejeté.`);
      return;
    }

    if (claim.claimType === 'insurance') {
      if (!claim.expertApproved) {
        reasons.push(`Accord expert manquant pour "${claim.label}".`);
      }
      if (!claim.clientApproved) {
        reasons.push(`Accord client manquant pour "${claim.label}".`);
      }
    } else if (claim.claimType === 'customer') {
      if (!claim.clientApproved) {
        reasons.push(`Accord client manquant pour "${claim.label}".`);
      }
    } else if (claim.claimType === 'warranty' || claim.claimType === 'internal') {
      if (claim.status !== 'approved') {
        reasons.push(`Validation interne manquante pour "${claim.label}".`);
      }
    }
  });

  return reasons;
}

export function areAllClaimsApprovedForPlanning(claims: Claim[] | undefined, overridden = false): boolean {
  return getBlockingClaimsReasons(claims, overridden).length === 0;
}

export function summarizeClaims(claims: Claim[] | undefined): string {
  if (!claims || claims.length === 0) return 'Aucun sinistre';
  const activeClaims = claims.filter(c => c.status !== 'cancelled');
  if (activeClaims.length === 0) return '0 sinistre actif';
  const approvedCount = activeClaims.filter(isClaimApprovedForPlanning).length;
  return `${activeClaims.length} sinistre(s) (${approvedCount} approuvé(s), ${activeClaims.length - approvedCount} en attente)`;
}

function updateClaimStatusAndDates(claim: Claim): Claim {
  const updated = { ...claim, updatedAt: new Date().toISOString() };
  if (updated.status === 'cancelled' || updated.status === 'rejected') {
    return updated;
  }

  if (updated.claimType === 'insurance') {
    if (updated.expertApproved && updated.clientApproved) {
      updated.status = 'approved';
    } else if (updated.expertApproved) {
      updated.status = 'client_pending';
    } else if (updated.clientApproved) {
      updated.status = 'expert_pending';
    } else {
      updated.status = 'expert_pending';
    }
  } else if (updated.claimType === 'customer') {
    if (updated.clientApproved) {
      updated.status = 'approved';
    } else {
      updated.status = 'client_pending';
    }
  } else {
    // warranty / internal: keep draft or manually set to approved
  }

  return updated;
}

export function approveClaimExpert(claim: Claim, expertName: string): Claim {
  const now = new Date().toISOString();
  return updateClaimStatusAndDates({
    ...claim,
    expertApproved: true,
    expertName,
    expertApprovalAt: now,
  });
}

export function approveClaimClient(claim: Claim, reference: string): Claim {
  const now = new Date().toISOString();
  return updateClaimStatusAndDates({
    ...claim,
    clientApproved: true,
    clientApprovalReference: reference,
    clientApprovalAt: now,
  });
}

export function rejectClaim(claim: Claim, reason: string): Claim {
  return {
    ...claim,
    status: 'rejected',
    notes: claim.notes ? `${claim.notes}\nRejet: ${reason}` : `Rejet: ${reason}`,
    updatedAt: new Date().toISOString(),
  };
}

export function cancelClaim(claim: Claim): Claim {
  return {
    ...claim,
    status: 'cancelled',
    updatedAt: new Date().toISOString(),
  };
}
