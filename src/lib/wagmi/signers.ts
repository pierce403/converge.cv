/**
 * XMTP Signer creation utilities for different wallet types
 * Based on xmtp.chat implementation
 */

import { IdentifierKind, type Signer } from '@xmtp/browser-sdk';
import { toBytes, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

/**
 * Create a signer for an Externally Owned Account (normal wallet)
 * Used with MetaMask, WalletConnect, etc.
 */
export function createEOASigner(
  address: `0x${string}`,
  signMessage: (message: string) => Promise<string>
): Signer {
  return {
    type: 'EOA',
    getIdentifier: () => ({
      identifier: address.toLowerCase(),
      identifierKind: IdentifierKind.Ethereum,
    }),
    signMessage: async (message: string) => {
      const signature = await signMessage(message);
      return toBytes(signature);
    },
  };
}

/**
 * Create a signer for a Smart Contract Wallet (e.g., Base smart wallets)
 * Includes chainId for proper signature validation
 */
export function createSCWSigner(
  address: `0x${string}`,
  signMessage: (message: string) => Promise<string>,
  chainId: number = 1
): Signer {
  console.log('[Signer] Creating SCW signer with chain ID:', chainId);
  return {
    type: 'SCW',
    getIdentifier: () => ({
      identifier: address.toLowerCase(),
      identifierKind: IdentifierKind.Ethereum,
    }),
    signMessage: async (message: string) => {
      const signature = await signMessage(message);
      return toBytes(signature);
    },
    getChainId: () => BigInt(chainId),
  };
}

/**
 * Create a signer from a private key (for ephemeral/generated wallets)
 * This is what we use for the "random wallet" option
 */
export function createEphemeralSigner(privateKey: Hex): Signer {
  const account = privateKeyToAccount(privateKey);
  return {
    type: 'EOA',
    getIdentifier: () => ({
      identifier: account.address.toLowerCase(),
      identifierKind: IdentifierKind.Ethereum,
    }),
    signMessage: async (message: string) => {
      const signature = await account.signMessage({ message });
      return toBytes(signature);
    },
  };
}
