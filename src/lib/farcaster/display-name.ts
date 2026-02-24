export interface FarcasterDisplayNameCandidate {
  display_name?: string | null;
  displayName?: string | null;
  username?: string | null;
  fname?: string | null;
}

const pickFirstNonEmpty = (...values: Array<string | null | undefined>): string | null => {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return null;
};

/**
 * Preferred naming order for Farcaster identities:
 * 1. Human-facing display name
 * 2. Username/fname fallback
 */
export const pickFarcasterDisplayName = (
  profile?: FarcasterDisplayNameCandidate | null
): string | null => {
  if (!profile) return null;
  return pickFirstNonEmpty(
    profile.display_name,
    profile.displayName,
    profile.username,
    profile.fname
  );
};
