import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveBaseEthName, resolveFcastId, setEnsClient } from './ens';

const mockFetchNeynarUserByVerification = vi.fn();

vi.mock('@/lib/farcaster/neynar', () => ({
  fetchNeynarUserByVerification: (...args: unknown[]) => mockFetchNeynarUserByVerification(...args),
}));

vi.mock('@/lib/stores/farcaster-store', () => ({
  useFarcasterStore: {
    getState: () => ({
      getEffectiveNeynarApiKey: () => 'test-key',
    }),
  },
}));

afterEach(() => {
  mockFetchNeynarUserByVerification.mockReset();
  setEnsClient(null);
});

describe('ens utils', () => {
  it('resolveFcastId returns null for invalid addresses', async () => {
    const res = await resolveFcastId('not-an-address');
    expect(res).toBeNull();
    expect(mockFetchNeynarUserByVerification).not.toHaveBeenCalled();
  });

  it('resolveFcastId resolves username via Neynar and caches per address', async () => {
    mockFetchNeynarUserByVerification.mockResolvedValueOnce({ username: 'alice' });

    const addr = '0x1111111111111111111111111111111111111111';
    const first = await resolveFcastId(addr);
    expect(first).toBe('alice.fcast.id');

    const second = await resolveFcastId(addr);
    expect(second).toBe('alice.fcast.id');

    expect(mockFetchNeynarUserByVerification).toHaveBeenCalledTimes(1);
    expect(mockFetchNeynarUserByVerification).toHaveBeenCalledWith(addr.toLowerCase(), 'test-key');
  });

  it('resolveBaseEthName only returns *.base.eth names', async () => {
    const client = {
      getEnsAddress: vi.fn(async () => null),
      getEnsName: vi.fn(async () => 'bob.base.eth'),
    };
    setEnsClient(client as unknown as Parameters<typeof setEnsClient>[0]);

    const addr = '0x2222222222222222222222222222222222222222';
    const baseName = await resolveBaseEthName(addr);
    expect(baseName).toBe('bob.base.eth');

    client.getEnsName.mockResolvedValueOnce('alice.eth');
    const notBase = await resolveBaseEthName(addr);
    expect(notBase).toBeNull();
  });
});

