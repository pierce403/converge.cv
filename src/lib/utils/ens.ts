/**
 * ENS resolution utilities
 */

import { normalize } from 'viem/ens';
import { createPublicClient, fallback, http } from 'viem';
import { mainnet } from 'viem/chains';

type EnsPublicClient = Pick<ReturnType<typeof createPublicClient>, 'getEnsAddress' | 'getEnsName'>;

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

const fcastIdCache = new Map<string, string | null>();

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
    const address = await withRetry(() => getEnsClient().getEnsAddress({ name: normalized }));
    
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

/**
 * Reverse lookup: Resolve an Ethereum address to its ENS name
 */
export async function resolveENSFromAddress(address: string): Promise<string | null> {
  try {
    if (!isEthereumAddress(address)) {
      return null;
    }

    console.log('[ENS] Reverse resolving ENS name for address:', address);
    
    const ensName = await withRetry(() =>
      getEnsClient().getEnsName({ address: address as `0x${string}` })
    );
    
    if (ensName) {
      console.log('[ENS] ✅ Resolved to:', ensName);
      return ensName;
    } else {
      console.warn('[ENS] ⚠️  No ENS name found for address:', address);
      return null;
    }
  } catch (error) {
    console.error('[ENS] Failed to reverse resolve ENS name:', error);
    return null;
  }
}

/**
 * Resolve a `.fcast.id` name from an Ethereum address.
 *
 * Implementation: uses Neynar verification lookups when a Neynar API key is configured.
 */
export async function resolveFcastId(address: string): Promise<string | null> {
  try {
    if (!isEthereumAddress(address)) {
      return null;
    }
    const normalized = address.trim().toLowerCase();
    if (fcastIdCache.has(normalized)) {
      return fcastIdCache.get(normalized) ?? null;
    }
    console.log('[Fcast.id] Resolving .fcast.id for address:', address);

    const { useFarcasterStore } = await import('@/lib/stores/farcaster-store');
    const key = useFarcasterStore.getState().getEffectiveNeynarApiKey?.();
    if (!key) {
      fcastIdCache.set(normalized, null);
      return null;
    }

    const { fetchNeynarUserByVerification } = await import('@/lib/farcaster/neynar');
    const user = await fetchNeynarUserByVerification(normalized, key);
    const username = user?.username?.trim();
    const resolved = username ? `${username}.fcast.id` : null;
    fcastIdCache.set(normalized, resolved);
    return resolved;
  } catch (error) {
    console.error('[Fcast.id] Failed to resolve:', error);
    return null;
  }
}

/**
 * Return the reverse-ENS name only if it ends with `.base.eth`.
 */
export async function resolveBaseEthName(address: string): Promise<string | null> {
  try {
    console.log('[Base.eth] Resolving .base.eth for address:', address);
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
