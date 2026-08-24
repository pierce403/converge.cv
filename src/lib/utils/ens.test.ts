import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  isENSName,
  resolveAddressOrENS,
  resolveBaseEthName,
  resolveENS,
  setEnsClient,
} from './ens';

afterEach(() => {
  setEnsClient(null);
});

describe('ens utils', () => {
  it('accepts normalized ENS names and rejects URLs, emails, and dotted prose', () => {
    expect(isENSName('alice.eth')).toBe(true);
    expect(isENSName('alice.base.eth')).toBe(true);
    expect(isENSName('https://alice.eth')).toBe(false);
    expect(isENSName('alice@example.eth')).toBe(false);
    expect(isENSName('not a.name')).toBe(false);
    expect(isENSName('example.com')).toBe(false);
    expect(isENSName('plain.dotted.input')).toBe(false);
  });

  it('resolves whitespace-padded ENS names using the validated normalized candidate', async () => {
    const resolvedAddress = '0x1111111111111111111111111111111111111111';
    const getEnsAddress = vi.fn(async () => resolvedAddress);
    setEnsClient({
      getEnsAddress,
      getEnsName: vi.fn(async () => null),
    } as unknown as Parameters<typeof setEnsClient>[0]);

    await expect(resolveAddressOrENS('  alice.eth\n')).resolves.toBe(resolvedAddress);
    expect(getEnsAddress).toHaveBeenCalledWith({ name: 'alice.eth' });

    getEnsAddress.mockClear();
    await expect(resolveENS('  ALICE.eth\t')).resolves.toBe(resolvedAddress);
    expect(getEnsAddress).toHaveBeenCalledWith({ name: 'alice.eth' });
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
