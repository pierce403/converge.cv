/**
 * Direct external-wallet migration for legacy device-join identities.
 */

import type { Identity } from '@/types';
import { getStorage } from '@/lib/storage';
import { useInboxRegistryStore } from '@/lib/stores';
import { getXmtpClient } from '@/lib/xmtp';
import {
  ethereumAddressesEqual,
  requireEthereumAddress,
} from '@/lib/utils/ethereum';
import { normalizeInboxId } from '@/lib/utils/inbox';

export function isLegacyDeviceJoinIdentity(identity: Identity | null | undefined): boolean {
  if (!identity) return false;
  return Boolean(
    identity.provisioningMode === 'device-join' ||
      (identity.linkedWalletAddress && identity.privateKey) ||
      (identity.identityKind === 'local-app' && identity.linkedWalletAddress && identity.privateKey)
  );
}

export function detectIdentitiesNeedingMigration(identities: Identity[]): Identity[] {
  return identities.filter(isLegacyDeviceJoinIdentity);
}

export interface MigrateDeviceJoinParams {
  localIdentity: Identity;
  walletAddress: string;
  walletChainId?: number;
  walletType?: 'EOA' | 'SCW';
  signMessage: (message: string) => Promise<string>;
  onPhase?: (phase: string) => void;
}

export async function migrateLegacyDeviceJoinIdentity({
  localIdentity,
  walletAddress,
  walletChainId,
  walletType = 'EOA',
  signMessage,
  onPhase,
}: MigrateDeviceJoinParams): Promise<Identity> {
  const canonicalWallet = requireEthereumAddress(walletAddress, 'Connected migration wallet');
  const linkedWallet = localIdentity.linkedWalletAddress
    ? requireEthereumAddress(localIdentity.linkedWalletAddress, 'Linked wallet address')
    : null;

  if (linkedWallet && !ethereumAddressesEqual(canonicalWallet, linkedWallet)) {
    throw new Error(
      `Please connect the linked wallet ${linkedWallet} to authorize migration for this inbox.`
    );
  }

  const inboxId = normalizeInboxId(localIdentity.inboxId ?? localIdentity.expectedInboxId);
  if (!inboxId) {
    throw new Error('Could not determine target inbox ID for migration.');
  }

  const xmtp = getXmtpClient();
  console.info('[Migration] Starting direct external-wallet migration for inbox', {
    inboxId,
    localAddress: localIdentity.address,
    walletAddress: canonicalWallet,
  });

  const result = await xmtp.migrateDeviceJoinIdentity({
    walletIdentity: {
      address: canonicalWallet,
      chainId: walletChainId,
      walletType,
      signMessage,
    },
    localEoaAddress: localIdentity.address,
    expectedInboxId: inboxId,
    knownInstallationId: localIdentity.installationId,
    onPhase: async (phase) => {
      onPhase?.(phase);
    },
  });

  if (!result.success) {
    throw new Error('XMTP network migration was not verified. Local keys were preserved.');
  }

  console.info('[Migration] Network migration verified. Updating local identity storage...');
  onPhase?.('updating-local-storage');

  const migratedIdentity: Identity = {
    address: canonicalWallet,
    publicKey: '',
    privateKey: undefined,
    mnemonic: undefined,
    identityKind: 'wallet',
    walletType,
    walletChainId,
    inboxId,
    installationId: result.installationId || localIdentity.installationId,
    xmtpDbPathMode: 'inbox-default',
    displayName: localIdentity.displayName,
    avatar: localIdentity.avatar,
    createdAt: localIdentity.createdAt,
    lastSyncedAt: localIdentity.lastSyncedAt,
    needsHistorySync: localIdentity.needsHistorySync,
    historySyncRequestedAt: localIdentity.historySyncRequestedAt,
    historySyncStatus: localIdentity.historySyncStatus,
    expectedInboxId: inboxId,
    migrationRequired: false,
    migrationTargetWallet: undefined,
    migrationOldLocalAddress: undefined,
  };

  const storage = await getStorage();
  await storage.putIdentity(migratedIdentity);

  // Delete the old generated local EOA identity row now that migration is complete and verified
  if (!ethereumAddressesEqual(localIdentity.address, canonicalWallet)) {
    await storage.deleteIdentityByAddress(localIdentity.address);
  }

  const registry = useInboxRegistryStore.getState();
  const label =
    migratedIdentity.displayName ||
    `${migratedIdentity.address.slice(0, 6)}…${migratedIdentity.address.slice(-4)}`;

  registry.upsertEntry({
    inboxId,
    displayLabel: label,
    avatar: migratedIdentity.avatar,
    primaryDisplayIdentity: migratedIdentity.displayName || migratedIdentity.address,
    lastOpenedAt: Date.now(),
    hasLocalDB: true,
  });
  registry.markOpened(inboxId, true);

  console.info('[Migration] ✅ Migration successfully finished for inbox', inboxId);
  return migratedIdentity;
}
