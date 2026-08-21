import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Identity } from '@/types';
import {
  isLegacyDeviceJoinIdentity,
  detectIdentitiesNeedingMigration,
  migrateLegacyDeviceJoinIdentity,
} from './migration';
import { getXmtpClient } from '@/lib/xmtp';

const identities: Identity[] = [];
const mockStorage = {
  listIdentities: vi.fn(async () => [...identities]),
  getIdentityByAddress: vi.fn(async (addr: string) =>
    identities.find((i) => i.address.toLowerCase() === addr.toLowerCase())
  ),
  putIdentity: vi.fn(async (identity: Identity) => {
    const idx = identities.findIndex(
      (i) => i.address.toLowerCase() === identity.address.toLowerCase()
    );
    if (idx >= 0) {
      identities[idx] = identity;
    } else {
      identities.push(identity);
    }
  }),
  deleteIdentityByAddress: vi.fn(async (addr: string) => {
    const idx = identities.findIndex((i) => i.address.toLowerCase() === addr.toLowerCase());
    if (idx >= 0) identities.splice(idx, 1);
  }),
};

vi.mock('@/lib/storage', () => ({
  getStorage: vi.fn(async () => mockStorage),
}));

vi.mock('@/lib/xmtp', () => ({
  getXmtpClient: vi.fn(),
}));

describe('legacy device join identity migration', () => {
  const targetWallet = '0x1111111111111111111111111111111111111111';
  const localEoa = '0x2222222222222222222222222222222222222222';
  const targetInbox = 'a'.repeat(64);

  const legacyIdentity: Identity = {
    address: localEoa,
    publicKey: '0x02abc',
    privateKey: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    mnemonic: 'word '.repeat(11) + 'word',
    identityKind: 'local-app',
    provisioningMode: 'device-join',
    provisioningPending: false,
    xmtpDbPathMode: 'inbox-default',
    linkedWalletAddress: targetWallet,
    linkedWalletChainId: 1,
    linkedAt: 1000,
    displayName: 'Legacy Account',
    inboxId: targetInbox,
    installationId: 'installation-1',
    createdAt: 1000,
  };

  const pureLocalIdentity: Identity = {
    address: '0x3333333333333333333333333333333333333333',
    publicKey: '0x03abc',
    privateKey: '0xabcdef',
    identityKind: 'local-app',
    inboxId: 'b'.repeat(64),
    createdAt: 1000,
  };

  const directWalletIdentity: Identity = {
    address: targetWallet,
    publicKey: '',
    identityKind: 'wallet',
    inboxId: targetInbox,
    createdAt: 1000,
  };

  beforeEach(() => {
    identities.length = 0;
    vi.clearAllMocks();
  });

  it('detects legacy device-join identities accurately', () => {
    expect(isLegacyDeviceJoinIdentity(legacyIdentity)).toBe(true);
    expect(isLegacyDeviceJoinIdentity(pureLocalIdentity)).toBe(false);
    expect(isLegacyDeviceJoinIdentity(directWalletIdentity)).toBe(false);
    expect(isLegacyDeviceJoinIdentity(null)).toBe(false);
  });

  it('filters list of identities for those needing migration', () => {
    const list = [legacyIdentity, pureLocalIdentity, directWalletIdentity];
    const needing = detectIdentitiesNeedingMigration(list);
    expect(needing).toEqual([legacyIdentity]);
  });

  it('migrates legacy identity by removing local key, deleting old storage, and creating wallet identity', async () => {
    identities.push({ ...legacyIdentity });
    const mockMigrate = vi.fn(async () => ({
      success: true,
      inboxId: targetInbox,
      installationId: 'installation-1',
    }));

    (getXmtpClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      migrateDeviceJoinIdentity: mockMigrate,
    });

    const phases: string[] = [];
    const signMessage = vi.fn(async () => '0xsignature');

    const migrated = await migrateLegacyDeviceJoinIdentity({
      localIdentity: legacyIdentity,
      walletAddress: targetWallet,
      walletChainId: 1,
      walletType: 'EOA',
      signMessage,
      onPhase: (phase) => phases.push(phase),
    });

    expect(mockMigrate).toHaveBeenCalledWith({
      walletIdentity: {
        address: targetWallet,
        chainId: 1,
        walletType: 'EOA',
        signMessage,
      },
      localEoaAddress: localEoa,
      expectedInboxId: targetInbox,
      knownInstallationId: 'installation-1',
      onPhase: expect.any(Function),
    });

    expect(migrated).toMatchObject({
      address: targetWallet,
      identityKind: 'wallet',
      inboxId: targetInbox,
      installationId: 'installation-1',
      xmtpDbPathMode: 'inbox-default',
      migrationRequired: false,
    });

    // Ensure privateKey and mnemonic are deleted
    expect(migrated.privateKey).toBeUndefined();
    expect(migrated.mnemonic).toBeUndefined();
    expect(migrated.linkedWalletAddress).toBeUndefined();

    expect(mockStorage.putIdentity).toHaveBeenCalledWith(migrated);
    expect(mockStorage.deleteIdentityByAddress).toHaveBeenCalledWith(localEoa);
    expect(identities).toEqual([migrated]);
  });

  it('preserves the legacy identity and local key when network migration fails', async () => {
    identities.push({ ...legacyIdentity });
    const mockMigrate = vi.fn(async () => {
      throw new Error('api client error: TypeError: Failed to fetch');
    });
    (getXmtpClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      migrateDeviceJoinIdentity: mockMigrate,
    });

    await expect(
      migrateLegacyDeviceJoinIdentity({
        localIdentity: legacyIdentity,
        walletAddress: targetWallet,
        signMessage: async () => '0xsignature',
      })
    ).rejects.toThrow(/Failed to fetch/);

    expect(mockStorage.putIdentity).not.toHaveBeenCalled();
    expect(mockStorage.deleteIdentityByAddress).not.toHaveBeenCalled();
    expect(identities).toEqual([legacyIdentity]);
    expect(identities[0]?.privateKey).toBe(legacyIdentity.privateKey);
  });

  it('refuses to migrate if connected wallet does not match linked wallet address', async () => {
    const wrongWallet = '0x9999999999999999999999999999999999999999';
    await expect(
      migrateLegacyDeviceJoinIdentity({
        localIdentity: legacyIdentity,
        walletAddress: wrongWallet,
        signMessage: async () => '0x',
      })
    ).rejects.toThrow(/Please connect the linked wallet/i);
  });
});
