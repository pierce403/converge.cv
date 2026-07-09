import { describe, expect, it } from 'vitest';
import { IdentifierKind, type Identifier } from '@xmtp/browser-sdk';
import { formatXmtpIdentifier } from './identifiers';

describe('formatXmtpIdentifier', () => {
  it('does not double-prefix an XMTP Ethereum identifier', () => {
    const address = `0x${'ab'.repeat(20)}`;
    expect(
      formatXmtpIdentifier({
        identifier: address,
        identifierKind: IdentifierKind.Ethereum,
      })
    ).toBe(address);
  });

  it('repairs unprefixed and repeated-prefix Ethereum identifiers', () => {
    const body = 'cd'.repeat(20);
    const identifierKind = IdentifierKind.Ethereum;
    expect(formatXmtpIdentifier({ identifier: body, identifierKind })).toBe(`0x${body}`);
    expect(formatXmtpIdentifier({ identifier: `0x0X${body}`, identifierKind })).toBe(`0x${body}`);
  });

  it('does not add an Ethereum prefix to another identifier kind', () => {
    expect(
      formatXmtpIdentifier({
        identifier: 'passkey-value',
        identifierKind: IdentifierKind.Passkey,
      } as Identifier)
    ).toBe('passkey-value');
  });
});
