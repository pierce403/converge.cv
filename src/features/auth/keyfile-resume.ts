import type { InboxState } from '@xmtp/browser-sdk';
import type { Identity } from '@/types';
import { normalizeEthereumAddress } from '@/lib/utils/ethereum';

const normalizeInboxId = (value: string | null | undefined) =>
  value?.trim().toLowerCase() || null;

const normalizeInstallationId = (value: string | null | undefined) =>
  value?.trim().toLowerCase().replace(/^0x/i, '') || null;

export function findPendingKeyfileRestore(
  identities: Identity[],
  input: { address: string; privateKey?: string; inboxId?: string }
): Identity | undefined {
  const address = normalizeEthereumAddress(input.address);
  const inboxId = normalizeInboxId(input.inboxId);
  if (!address || !input.privateKey) {
    return undefined;
  }

  return identities.find((identity) => {
    if (
      identity.provisioningMode !== 'keyfile-restore' ||
      identity.provisioningPending !== true ||
      normalizeEthereumAddress(identity.address) !== address ||
      identity.privateKey !== input.privateKey
    ) {
      return false;
    }

    const pendingInboxId = normalizeInboxId(identity.expectedInboxId ?? identity.inboxId);
    return !inboxId || !pendingInboxId || pendingInboxId === inboxId;
  });
}

export function getResumableKeyfileInstallationId(
  identities: Identity[],
  input: {
    address: string;
    privateKey?: string;
    inboxId?: string;
    inboxState?: InboxState;
  }
): string | undefined {
  const pending = findPendingKeyfileRestore(identities, input);
  const installationId = normalizeInstallationId(pending?.installationId);
  if (
    !pending?.installationId ||
    !installationId ||
    !input.inboxState?.installations?.some(
      (installation) => normalizeInstallationId(installation.id) === installationId
    )
  ) {
    return undefined;
  }
  return pending.installationId;
}
