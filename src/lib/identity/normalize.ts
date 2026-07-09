import type { Identity } from '@/types';
import { normalizeEthereumAddress, requireEthereumAddress } from '@/lib/utils/ethereum';

export function normalizeIdentityAddresses(identity: Identity): Identity {
  return {
    ...identity,
    address: requireEthereumAddress(identity.address, 'Identity address'),
    linkedWalletAddress:
      identity.linkedWalletAddress === undefined
        ? undefined
        : requireEthereumAddress(identity.linkedWalletAddress, 'Linked wallet address'),
  };
}

export function identityAddressNeedsRepair(identity: Identity): boolean {
  const normalizedAddress = normalizeEthereumAddress(identity.address);
  const normalizedLinked = normalizeEthereumAddress(identity.linkedWalletAddress);
  return Boolean(
    (normalizedAddress && normalizedAddress !== identity.address) ||
      (normalizedLinked && normalizedLinked !== identity.linkedWalletAddress)
  );
}
