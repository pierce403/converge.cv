import { describe, expect, it } from 'vitest';
import {
  hasEthereumHexPrefix,
  isEthereumAddress,
  normalizeEthereumAddress,
  requireEthereumAddress,
} from './ethereum';

const BODY = 'ABCDEFabcdef1234567890abcdefABCDEF123456';
const CANONICAL = '0xabcdefabcdef1234567890abcdefabcdef123456';

describe('Ethereum address normalization', () => {
  it.each([
    BODY,
    `0x${BODY}`,
    `0X${BODY}`,
    `0x0x${BODY}`,
    `0X0x0X${BODY}`,
    `  0x${BODY}  `,
  ])('canonicalizes %s', (value) => {
    expect(normalizeEthereumAddress(value)).toBe(CANONICAL);
    expect(isEthereumAddress(value)).toBe(true);
  });

  it.each([
    '',
    '0x',
    '0x1234',
    `0x0x${BODY}00`,
    `0x${BODY.slice(0, -1)}g`,
    null,
    undefined,
  ])('rejects malformed input %s', (value) => {
    expect(normalizeEthereumAddress(value)).toBeNull();
    expect(isEthereumAddress(value)).toBe(false);
  });

  it('throws a useful error when a required address is malformed', () => {
    expect(() => requireEthereumAddress('0x0x1234', 'Wallet address')).toThrow(
      /Wallet address must contain exactly 20 bytes/
    );
  });

  it('detects case-insensitive Ethereum prefixes', () => {
    expect(hasEthereumHexPrefix(' 0X1234')).toBe(true);
    expect(hasEthereumHexPrefix('1234')).toBe(false);
  });
});
