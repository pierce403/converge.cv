/**
 * XMTP Signer creation utilities for different wallet types
 * Based on xmtp.chat implementation
 */

import { IdentifierKind, type Signer } from '@xmtp/browser-sdk';
import { toBytes, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

type SignatureCacheEntry = {
  signature: string;
  validUntil: number;
};

const DEFAULT_SIGNATURE_VALIDITY_MS = 5 * 60 * 1000;
const SIGNATURE_REFRESH_SKEW_MS = 60 * 1000;
const SIGNATURE_FAILURE_COOLDOWN_MS = 15 * 1000;

const signatureCache = new Map<string, SignatureCacheEntry>();
const signatureInFlight = new Map<string, Promise<string>>();
const signatureFailureCooldown = new Map<string, number>();

function fingerprintMessage(message: string): string {
  let hash = 2166136261;
  for (let i = 0; i < message.length; i += 1) {
    hash ^= message.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function extractExpiryCandidate(rawValue: string, nowMs: number): number | null {
  const unixMatch = rawValue.match(/\b\d{10,13}\b/);
  if (unixMatch) {
    const parsed = Number(unixMatch[0]);
    if (Number.isFinite(parsed)) {
      const normalized = unixMatch[0].length === 13 ? parsed : parsed * 1000;
      if (normalized > nowMs) {
        return normalized;
      }
    }
  }

  const isoMatch = rawValue.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/i);
  if (isoMatch) {
    const parsed = Date.parse(isoMatch[0]);
    if (Number.isFinite(parsed) && parsed > nowMs) {
      return parsed;
    }
  }

  const parsed = Date.parse(rawValue.trim());
  if (Number.isFinite(parsed) && parsed > nowMs) {
    return parsed;
  }

  return null;
}

function extractSignatureExpiryMs(message: string, nowMs: number): number | null {
  const matches: string[] = [];
  const patterns = [
    /(?:expires?|expiration|valid until|valid through)\s*(?:at|on|time)?\s*[:-]\s*([^\n\r]+)/gi,
    /(?:expires?|expiration|valid until|valid through)\s+([^\n\r]+)/gi,
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null = pattern.exec(message);
    while (match) {
      if (match[1]) {
        matches.push(match[1]);
      }
      match = pattern.exec(message);
    }
  }

  if (matches.length === 0) {
    return null;
  }

  let earliest: number | null = null;
  for (const rawValue of matches) {
    const parsed = extractExpiryCandidate(rawValue, nowMs);
    if (!parsed) {
      continue;
    }
    if (!earliest || parsed < earliest) {
      earliest = parsed;
    }
  }

  return earliest;
}

function deriveSignatureValidUntil(message: string, nowMs: number): number {
  const parsedExpiry = extractSignatureExpiryMs(message, nowMs);
  if (parsedExpiry && parsedExpiry > nowMs) {
    return parsedExpiry;
  }
  return nowMs + DEFAULT_SIGNATURE_VALIDITY_MS;
}

function pruneCaches(nowMs: number): void {
  for (const [key, entry] of signatureCache.entries()) {
    if (entry.validUntil <= nowMs) {
      signatureCache.delete(key);
    }
  }
  for (const [key, cooldownUntil] of signatureFailureCooldown.entries()) {
    if (cooldownUntil <= nowMs) {
      signatureFailureCooldown.delete(key);
    }
  }
}

function createCachedSignMessage(
  cacheNamespace: string,
  signMessage: (message: string) => Promise<string>
): (message: string) => Promise<string> {
  return async (message: string) => {
    const nowMs = Date.now();
    pruneCaches(nowMs);

    const cacheKey = `${cacheNamespace}:${fingerprintMessage(message)}`;
    const cached = signatureCache.get(cacheKey);
    if (cached && cached.validUntil - SIGNATURE_REFRESH_SKEW_MS > nowMs) {
      return cached.signature;
    }

    const pending = signatureInFlight.get(cacheKey);
    if (pending) {
      return await pending;
    }

    const cooldownUntil = signatureFailureCooldown.get(cacheKey) ?? 0;
    if (cooldownUntil > nowMs) {
      const retryInSeconds = Math.max(1, Math.ceil((cooldownUntil - nowMs) / 1000));
      throw new Error(`Wallet signing temporarily throttled. Retry in ${retryInSeconds}s.`);
    }

    const inFlight = (async () => {
      try {
        const signature = await signMessage(message);
        const validUntil = deriveSignatureValidUntil(message, Date.now());
        signatureCache.set(cacheKey, { signature, validUntil });
        signatureFailureCooldown.delete(cacheKey);
        return signature;
      } catch (error) {
        signatureFailureCooldown.set(cacheKey, Date.now() + SIGNATURE_FAILURE_COOLDOWN_MS);
        throw error;
      } finally {
        signatureInFlight.delete(cacheKey);
      }
    })();

    signatureInFlight.set(cacheKey, inFlight);
    return await inFlight;
  };
}

// Exposed for deterministic unit tests.
export function __resetSignerCachesForTests(): void {
  signatureCache.clear();
  signatureInFlight.clear();
  signatureFailureCooldown.clear();
}

/**
 * Create a signer for an Externally Owned Account (normal wallet)
 * Used with MetaMask, WalletConnect, etc.
 */
export function createEOASigner(
  address: `0x${string}`,
  signMessage: (message: string) => Promise<string>
): Signer {
  const normalizedAddress = address.toLowerCase();
  const signMessageCached = createCachedSignMessage(`eoa:${normalizedAddress}`, signMessage);
  return {
    type: 'EOA',
    getIdentifier: () => ({
      identifier: normalizedAddress,
      identifierKind: IdentifierKind.Ethereum,
    }),
    signMessage: async (message: string) => {
      const signature = await signMessageCached(message);
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
  const normalizedAddress = address.toLowerCase();
  const normalizedChainId = Number.isFinite(chainId) ? chainId : 1;
  const signMessageCached = createCachedSignMessage(
    `scw:${normalizedAddress}:${normalizedChainId}`,
    signMessage
  );

  console.log('[Signer] Creating SCW signer with chain ID:', normalizedChainId);
  return {
    type: 'SCW',
    getIdentifier: () => ({
      identifier: normalizedAddress,
      identifierKind: IdentifierKind.Ethereum,
    }),
    signMessage: async (message: string) => {
      const signature = await signMessageCached(message);
      return toBytes(signature);
    },
    getChainId: () => BigInt(normalizedChainId),
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
