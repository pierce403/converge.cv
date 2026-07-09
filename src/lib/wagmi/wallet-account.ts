export type WalletAccountType = 'EOA' | 'SCW';

/** EIP-7702 delegated EOAs have code, but must still use XMTP's EOA signer. */
export function isEip7702DelegationCode(bytecode?: string | null): boolean {
  return Boolean(bytecode && /^0xef0100[0-9a-f]{40}$/i.test(bytecode.trim()));
}

export function classifyWalletBytecode(bytecode?: string | null): WalletAccountType {
  const normalized = bytecode?.trim() ?? '';
  if (!normalized || normalized === '0x' || isEip7702DelegationCode(normalized)) {
    return 'EOA';
  }
  return 'SCW';
}
