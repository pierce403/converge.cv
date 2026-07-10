export type CanonicalHexInput = `0x${string}`;

/**
 * Normalize transport/storage variations without weakening the downstream
 * cryptographic parser's byte-length or character validation.
 */
export function canonicalizeHexInput(value: string): CanonicalHexInput {
  let body = value.trim();
  while (/^0x/i.test(body)) {
    body = body.slice(2);
  }
  return `0x${body}`;
}
