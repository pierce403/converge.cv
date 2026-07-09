export type CanonicalEthereumAddress = `0x${string}`;

const ETHEREUM_ADDRESS_BODY = /^[0-9a-f]{40}$/i;
const ETHEREUM_PREFIX = /^0x/i;

/**
 * Return one lowercase, 0x-prefixed Ethereum address.
 *
 * XMTP identifier payloads have historically appeared with no prefix, an
 * uppercase prefix, or repeated prefixes. Repeated prefixes are repairable
 * only when the remaining value is exactly one 20-byte address.
 */
export function normalizeEthereumAddress(value: unknown): CanonicalEthereumAddress | null {
  if (typeof value !== 'string') return null;

  let body = value.trim();
  if (!body) return null;

  while (ETHEREUM_PREFIX.test(body)) {
    body = body.slice(2);
  }

  if (!ETHEREUM_ADDRESS_BODY.test(body)) return null;
  return `0x${body.toLowerCase()}`;
}

export function isEthereumAddress(value: unknown): value is string {
  return normalizeEthereumAddress(value) !== null;
}

export function requireEthereumAddress(value: unknown, label = 'Ethereum address'): CanonicalEthereumAddress {
  const normalized = normalizeEthereumAddress(value);
  if (!normalized) {
    throw new Error(`${label} must contain exactly 20 bytes of hexadecimal address data.`);
  }
  return normalized;
}

export function hasEthereumHexPrefix(value: unknown): boolean {
  return typeof value === 'string' && ETHEREUM_PREFIX.test(value.trim());
}
