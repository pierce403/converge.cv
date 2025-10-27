/**
 * ENS resolution utilities
 */

import { normalize } from 'viem/ens';
import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';

// Create a public client for ENS resolution
const publicClient = createPublicClient({
  chain: mainnet,
  transport: http('https://eth.llamarpc.com'), // Free public RPC
});

/**
 * Check if a string is an ENS name
 */
export function isENSName(address: string): boolean {
  return address.endsWith('.eth') || address.endsWith('.xyz') || address.includes('.');
}

/**
 * Check if a string is a valid Ethereum address
 */
export function isEthereumAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

/**
 * Resolve an ENS name to an Ethereum address
 */
export async function resolveENS(ensName: string): Promise<string | null> {
  try {
    console.log('[ENS] Resolving ENS name:', ensName);
    
    // Normalize the ENS name (handles unicode, etc.)
    const normalized = normalize(ensName);
    console.log('[ENS] Normalized name:', normalized);
    
    // Resolve to address
    const address = await publicClient.getEnsAddress({ name: normalized });
    
    if (address) {
      console.log('[ENS] ✅ Resolved to:', address);
      return address;
    } else {
      console.warn('[ENS] ⚠️  No address found for:', ensName);
      return null;
    }
  } catch (error) {
    console.error('[ENS] Failed to resolve:', ensName, error);
    return null;
  }
}

/**
 * Resolve an address or ENS name to an Ethereum address
 */
export async function resolveAddressOrENS(input: string): Promise<string | null> {
  // Already an Ethereum address
  if (isEthereumAddress(input)) {
    return input;
  }
  
  // Try to resolve as ENS name
  if (isENSName(input)) {
    return await resolveENS(input);
  }
  
  // Invalid input
  console.error('[ENS] Invalid input (not an address or ENS name):', input);
  return null;
}

