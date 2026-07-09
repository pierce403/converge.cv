import { describe, expect, it } from 'vitest';
import { classifyWalletBytecode, isEip7702DelegationCode } from './wallet-account';

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
