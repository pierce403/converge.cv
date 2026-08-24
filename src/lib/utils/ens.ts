/**
 * ENS resolution utilities
 */

import { normalize } from 'viem/ens';
import { createPublicClient, fallback, http } from 'viem';
import { mainnet } from 'viem/chains';

type EnsPublicClient = Pick<ReturnType<typeof createPublicClient>, 'getEnsAddress' | 'getEnsName'> &
  Partial<Pick<ReturnType<typeof createPublicClient>, 'getEnsAvatar'>>;

let ensClient: EnsPublicClient | null = null;

function getEnsClient(): EnsPublicClient {
  if (ensClient) {
    return ensClient;
  }
  const envUrls = (import.meta.env?.VITE_MAINNET_RPC_URLS as string | undefined)
    ?.split(',')
    .map((url) => url.trim())
    .filter(Boolean) ?? [];
  const rpcUrls = envUrls.length
    ? envUrls
    : [
        'https://eth.llamarpc.com',
        'https://cloudflare-eth.com',
        'https://rpc.ankr.com/eth',
        'https://eth.drpc.org',
      ];
  const transports = rpcUrls.map((url) => http(url, { timeout: 10_000 }));
  const transport = transports.length > 1 ? fallback(transports) : transports[0];
  // Create a public client for ENS resolution
  ensClient = createPublicClient({
    chain: mainnet,
    transport,
  });
  return ensClient;
}

// Allow tests (or future environments) to inject a client.
export function setEnsClient(next: EnsPublicClient | null): void {
  ensClient = next;
}

const isVitest = () =>
  typeof process !== 'undefined' &&
  Boolean((process.env as Record<string, string | undefined>)?.VITEST);

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  if (isVitest()) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(fn: () => Promise<T>, opts?: { maxAttempts?: number }): Promise<T> {
  const maxAttempts = Math.max(1, opts?.maxAttempts ?? 2);
  let attempt = 0;
  let backoffMs = 250;
  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      return await fn();
    } catch (error) {
      if (attempt >= maxAttempts) {
        throw error;
      }
      await sleep(backoffMs);
      backoffMs = Math.min(1500, Math.round(backoffMs * 1.75));
    }
  }
  // Unreachable, but TS wants a return.
  return await fn();
}

/**
 * Check if a string is an ENS name
 */
export function isENSName(address: string): boolean {
  const candidate = address.trim();
  if (
    candidate.length === 0 ||
    candidate.length > 255 ||
    !candidate.includes('.') ||
    /[\s@/:]/.test(candidate)
  ) {
    return false;
  }
  try {
    const normalized = normalize(candidate);
    return normalized.endsWith('.eth') && !normalized.startsWith('.');
  } catch {
    return false;
  }
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
    // Normalize the ENS name (handles unicode, etc.)
    const normalized = normalize(ensName.trim());
    
    // Resolve to address
    const address = await withRetry(() => getEnsClient().getEnsAddress({ name: normalized }));
    
    if (address) {
      return address;
    } else {
      console.warn('[ENS] No address found for the requested name');
      return null;
    }
  } catch (error) {
    console.error('[ENS] Failed to resolve name:', error);
    return null;
  }
}

/**
 * Resolve an address or ENS name to an Ethereum address
 */
export async function resolveAddressOrENS(input: string): Promise<string | null> {
  const candidate = input.trim();

  // Already an Ethereum address
  if (isEthereumAddress(candidate)) {
    return candidate;
  }
  
  // Try to resolve as ENS name
  if (isENSName(candidate)) {
    return await resolveENS(candidate);
  }
  
  // Invalid input
  console.error('[ENS] Invalid address or ENS name input');
  return null;
}

/**
 * Reverse lookup: Resolve an Ethereum address to its ENS name
 */
export async function resolveENSFromAddress(address: string): Promise<string | null> {
  try {
    if (!isEthereumAddress(address)) {
      return null;
    }

    const ensName = await withRetry(() =>
      getEnsClient().getEnsName({ address: address as `0x${string}` })
    );
    
    if (ensName) {
      return ensName;
    } else {
      console.warn('[ENS] No reverse ENS name found');
      return null;
    }
  } catch (error) {
    console.error('[ENS] Failed to reverse resolve ENS name:', error);
    return null;
  }
}

/** Resolve the avatar record for an ENS name. */
export async function resolveENSAvatar(ensName: string): Promise<string | null> {
  try {
    const normalized = normalize(ensName.trim());
    const client = getEnsClient();
    if (!client.getEnsAvatar) return null;
    return await withRetry(() => client.getEnsAvatar!({ name: normalized }));
  } catch (error) {
    console.error('[ENS] Failed to resolve avatar:', error);
    return null;
  }
}

/**
 * Return the reverse-ENS name only if it ends with `.base.eth`.
 */
export async function resolveBaseEthName(address: string): Promise<string | null> {
  try {
    const ensName = await resolveENSFromAddress(address);
    if (ensName && ensName.toLowerCase().endsWith('.base.eth')) {
      return ensName;
    }
    return null;
  } catch (error) {
    console.error('[Base.eth] Failed to resolve:', error);
    return null;
  }
}
