import { describe, expect, it } from 'vitest';
import {
  classifyWalletBytecode,
  isEip7702DelegationCode,
  normalizeWalletAccounts,
} from './wallet-account';

describe('wallet account classification', () => {
  it('treats empty bytecode as an EOA', () => {
    expect(classifyWalletBytecode(undefined)).toBe('EOA');
    expect(classifyWalletBytecode('0x')).toBe('EOA');
  });

  it('treats normal contract bytecode as an SCW', () => {
    expect(classifyWalletBytecode('0x6080604052')).toBe('SCW');
  });

  it('keeps EIP-7702 delegated accounts on the EOA signer path', () => {
    const delegation = `0xef0100${'ab'.repeat(20)}`;
    expect(isEip7702DelegationCode(delegation)).toBe(true);
    expect(classifyWalletBytecode(delegation)).toBe('EOA');
  });
});

describe('normalizeWalletAccounts', () => {
  const body = 'ABCDEFabcdef1234567890abcdefABCDEF123456';
  const canonical = `0x${body.toLowerCase()}`;

  it('canonicalizes and deduplicates connector string accounts', () => {
    expect(normalizeWalletAccounts([`0X0x${body}`, canonical])).toEqual([canonical]);
  });

  it('accepts object account results and drops malformed values', () => {
    expect(
      normalizeWalletAccounts([
        { address: body },
        { address: '0x0x1234' },
        null,
      ])
    ).toEqual([canonical]);
  });

  it('distinguishes a missing account list from an empty one', () => {
    expect(normalizeWalletAccounts(undefined)).toBeUndefined();
    expect(normalizeWalletAccounts([])).toEqual([]);
  });
});
