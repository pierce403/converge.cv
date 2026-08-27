import { describe, expect, it } from 'vitest';
import {
  CthuwuTypingCodec,
  ContentTypeCthuwuTyping,
  parseCthuwuTypingControl,
} from './cthuwu-codecs';

describe('Cthuwu typing codec', () => {
  const typing = {
    type: 'cthuwu.typing.v1',
    active: true,
    expiresAtNs: '1800000000000000000',
  } as const;

  it('round-trips the exact non-push typing control', () => {
    const codec = new CthuwuTypingCodec();
    const encoded = codec.encode(typing);

    expect(encoded.type).toEqual(ContentTypeCthuwuTyping);
    expect(codec.decode(encoded)).toEqual(typing);
    expect(codec.shouldPush()).toBe(false);
  });

  it('rejects malformed or expanded controls', () => {
    expect(parseCthuwuTypingControl({ ...typing, active: 'yes' })).toBeNull();
    expect(parseCthuwuTypingControl({ ...typing, extra: true })).toBeNull();
    expect(parseCthuwuTypingControl({ ...typing, expiresAtNs: '0' })).toBeNull();
  });
});
