import type { Identity } from '@/types';
import { getStorage } from '@/lib/storage';
import { useInboxRegistryStore } from '@/lib/stores/inbox-registry-store';
import { inboxIdsMatch, normalizeInboxId } from '@/lib/utils/inbox';

export function findLoadedIdentityForInbox(
  identities: Identity[],
  inboxId: string
): Identity | undefined {
  return identities.find(
    (identity) =>
      identity.provisioningPending !== true &&
      Boolean(identity.inboxId) &&
      inboxIdsMatch(identity.inboxId, inboxId)
  );
}

/**
 * Treat the global identity table as authoritative when the localStorage-backed
 * switcher registry is stale or was cleared independently.
 */
export async function isInboxLoadedLocally(rawInboxId: string): Promise<boolean> {
  const inboxId = normalizeInboxId(rawInboxId);
  if (!inboxId) return false;

  const registry = useInboxRegistryStore.getState();
  registry.hydrate();
  if (registry.hasInbox(inboxId)) return true;

  const identity = findLoadedIdentityForInbox(
    await (await getStorage()).listIdentities(),
    inboxId
  );
  if (!identity) return false;

  registry.upsertEntry({
    inboxId,
    displayLabel: identity.displayName || identity.address,
    avatar: identity.avatar,
    primaryDisplayIdentity: identity.displayName || identity.address,
    lastOpenedAt: identity.createdAt,
    hasLocalDB: true,
  });
  return true;
}
