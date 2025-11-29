import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Identity, VaultSecrets } from '@/types';
import { ensureInboxStorageNamespace } from './namespacing';

const baseIdentity: Identity = {
  address: '0xabc123',
  publicKey: '0xpublic',
  createdAt: 1,
};

const sourceStorage = {
  getVaultSecrets: vi.fn(async () => null as VaultSecrets | null),
  putIdentity: vi.fn(),
  putVaultSecrets: vi.fn(),
};

const targetStorage = {
  getVaultSecrets: vi.fn(async () => null as VaultSecrets | null),
  putIdentity: vi.fn(),
  putVaultSecrets: vi.fn(),
};

let currentNamespace = 'default';

vi.mock('@/lib/storage', () => ({
  getStorage: vi.fn(async () => (currentNamespace === 'default' ? sourceStorage : targetStorage)),
  setStorageNamespace: vi.fn(async (ns: string) => {
    currentNamespace = ns;
  }),
  getStorageNamespace: () => currentNamespace,
}));

describe('ensureInboxStorageNamespace', () => {
  beforeEach(() => {
    currentNamespace = 'default';
    vi.clearAllMocks();
    sourceStorage.getVaultSecrets.mockResolvedValue({
      wrappedVaultKey: 'key',
      method: 'passphrase',
      salt: 's',
      iterations: 1,
    });
  });

  it('moves identity and secrets when switching namespaces', async () => {
    await ensureInboxStorageNamespace('inbox-1', baseIdentity);

    const { setStorageNamespace } = await import('@/lib/storage');

    expect(setStorageNamespace).toHaveBeenCalledWith('inbox-1');
    expect(targetStorage.putIdentity).toHaveBeenCalledWith(baseIdentity);
    expect(targetStorage.putVaultSecrets).toHaveBeenCalledWith({
      wrappedVaultKey: 'key',
      method: 'passphrase',
      salt: 's',
      iterations: 1,
    });
    expect(sourceStorage.putIdentity).not.toHaveBeenCalled();
  });

  it('reuses storage when namespace is unchanged', async () => {
    currentNamespace = 'inbox-1';
    await ensureInboxStorageNamespace('inbox-1', baseIdentity);

    expect(targetStorage.putIdentity).toHaveBeenCalledWith(baseIdentity);
    expect(sourceStorage.putIdentity).not.toHaveBeenCalled();
  });
});
