import { privateKeyToAccount } from 'viem/accounts';
import type { Identity } from '@/types';
import { normalizeEthereumAddress } from '@/lib/utils/ethereum';
import { inboxIdsMatch } from '@/lib/utils/inbox';

const isValidResumableAttempt = (identity: Identity) => {
  if (
    identity.provisioningMode !== 'new-inbox' ||
    identity.provisioningPending !== true ||
    !identity.privateKey ||
    !identity.inboxId ||
    !identity.installationId ||
    identity.xmtpDbPathMode !== 'inbox-default' ||
    (identity.expectedInboxId && !inboxIdsMatch(identity.expectedInboxId, identity.inboxId))
  ) {
    return false;
  }

  try {
    const derived = privateKeyToAccount(identity.privateKey as `0x${string}`).address;
    return normalizeEthereumAddress(derived) === normalizeEthereumAddress(identity.address);
  } catch {
    return false;
  }
};

export function planPendingNewInboxAttempts(identities: Identity[]): {
  resumable?: Identity;
  discardable: Identity[];
} {
  const pending = identities.filter(
    (identity) =>
      identity.provisioningMode === 'new-inbox' && identity.provisioningPending === true
  );
  const resumable = pending
    .filter(isValidResumableAttempt)
    .sort((left, right) => right.createdAt - left.createdAt)[0];

  return {
    resumable,
    // No registration mutation occurs before both IDs are persisted together.
    // Pre-mutation attempts can therefore be removed without stranding an inbox.
    discardable: pending.filter(
      (identity) => !identity.inboxId && !identity.installationId
    ),
  };
}
