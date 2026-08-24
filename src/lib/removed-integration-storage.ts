const REMOVED_INTEGRATION_STORAGE_KEYS = [
  'converge-farcaster-settings',
] as const;

const REMOVED_INTEGRATION_STORAGE_PREFIXES = [
  'converge:neynar:',
] as const;

function getBrowserLocalStorage(): Storage | null {
  if (typeof window === 'undefined') return null;

  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Remove credentials and caches left behind by integrations no longer shipped. */
export function clearRemovedIntegrationStorage(
  storage: Storage | null = getBrowserLocalStorage(),
): void {
  if (!storage) return;

  for (const key of REMOVED_INTEGRATION_STORAGE_KEYS) {
    try {
      storage.removeItem(key);
    } catch {
      // Continue best-effort cleanup when browser storage is constrained.
    }
  }

  const matchingKeys: string[] = [];
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key && REMOVED_INTEGRATION_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix))) {
        matchingKeys.push(key);
      }
    }
  } catch {
    return;
  }

  for (const key of matchingKeys) {
    try {
      storage.removeItem(key);
    } catch {
      // Continue best-effort cleanup for the remaining removed integration data.
    }
  }
}
