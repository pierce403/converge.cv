import {
  normalizeEthereumAddress,
  type CanonicalEthereumAddress,
} from '@/lib/utils/ethereum';

export type WalletAccountType = 'EOA' | 'SCW';

export function normalizeWalletAccounts(
  accounts: unknown
): readonly CanonicalEthereumAddress[] | undefined {
  if (!Array.isArray(accounts)) return undefined;

  const normalized = accounts.flatMap((item) => {
    const raw =
      typeof item === 'string'
        ? item
        : typeof item === 'object' && item !== null && 'address' in item
          ? (item as { address?: unknown }).address
          : undefined;
    const address = normalizeEthereumAddress(raw);
    return address ? [address] : [];
  });

  return Array.from(new Set(normalized));
}

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
