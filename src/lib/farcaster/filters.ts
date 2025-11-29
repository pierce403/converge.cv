import type { Contact } from '@/lib/stores/contact-store';
import type { FarcasterFilterSettings } from '@/lib/stores/farcaster-store';

const hasFarcasterIdentity = (contact?: Contact | null) =>
  Boolean(contact?.farcasterFid || contact?.farcasterUsername || contact?.source === 'farcaster');

export interface FilterResult {
  passes: boolean;
  reasons: string[];
}

export function evaluateContactAgainstFilters(
  contact: Contact | null | undefined,
  filters: FarcasterFilterSettings
): FilterResult {
  if (!filters.enabled) {
    return { passes: true, reasons: [] };
  }

  const reasons: string[] = [];

  if (filters.requireFarcasterIdentity && !hasFarcasterIdentity(contact)) {
    reasons.push('No Farcaster identity linked');
  }

  const score = contact?.farcasterScore;
  if (filters.minScore != null && filters.minScore > 0) {
    if (typeof score === 'number') {
      if (score < filters.minScore) {
        reasons.push(`Neynar score ${score} below minimum ${filters.minScore}`);
      }
    } else if (filters.requireFarcasterIdentity) {
      reasons.push('Missing Neynar score');
    }
  }

  const followerCount = contact?.farcasterFollowerCount;
  if (filters.minFollowerCount != null && filters.minFollowerCount > 0 && typeof followerCount === 'number') {
    if (followerCount < filters.minFollowerCount) {
      reasons.push(`Follower count ${followerCount} below ${filters.minFollowerCount}`);
    }
  }

  const followingCount = contact?.farcasterFollowingCount;
  if (filters.minFollowingCount != null && filters.minFollowingCount > 0 && typeof followingCount === 'number') {
    if (followingCount < filters.minFollowingCount) {
      reasons.push(`Following count ${followingCount} below ${filters.minFollowingCount}`);
    }
  }

  if (filters.requireActiveStatus && contact?.farcasterActiveStatus) {
    if (contact.farcasterActiveStatus.toLowerCase() !== 'active') {
      reasons.push('Farcaster profile is not active');
    }
  }

  if (filters.requirePowerBadge) {
    const hasPowerBadge = contact?.farcasterPowerBadge === true;
    if (!hasPowerBadge) {
      reasons.push('Power badge required');
    }
  }

  return { passes: reasons.length === 0, reasons };
}
