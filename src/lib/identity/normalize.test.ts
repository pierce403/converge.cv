import { describe, expect, it } from 'vitest';
import type { Identity } from '@/types';
import { identityAddressNeedsRepair, normalizeIdentityAddresses } from './normalize';

const baseIdentity: Identity = {
  address: `0x${'11'.repeat(20)}`,
  publicKey: '',
  createdAt: 1,
};

describe('identity address normalization', () => {
  it('repairs repeated prefixes on local and linked wallet addresses', () => {
    const repaired = normalizeIdentityAddresses({
      ...baseIdentity,
      address: `0x0X${'AA'.repeat(20)}`,
      linkedWalletAddress: `0X${'BB'.repeat(20)}`,
    });
    expect(repaired.address).toBe(`0x${'aa'.repeat(20)}`);
    expect(repaired.linkedWalletAddress).toBe(`0x${'bb'.repeat(20)}`);
    expect(identityAddressNeedsRepair({ ...baseIdentity, address: `0x0x${'11'.repeat(20)}` })).toBe(
      true
    );
  });

  it('rejects malformed identity addresses instead of passing them to XMTP', () => {
    expect(() => normalizeIdentityAddresses({ ...baseIdentity, address: '0x0x1234' })).toThrow(
      /Identity address/
    );
  });
});
