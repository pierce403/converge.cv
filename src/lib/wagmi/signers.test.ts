import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetSignerCachesForTests,
  createEOASigner,
  createSCWSigner,
  createEphemeralSigner,
} from './signers';
import { IdentifierKind } from '@xmtp/browser-sdk';

vi.mock('viem/accounts', () => ({
  privateKeyToAccount: (_pk: string) => ({
    address: '0x1234567890abcdef1234567890abcdef12345678',
    signMessage: vi.fn(async ({ message }) => `0xsigned-${message}`),
  }),
}));

describe('wagmi signers', () => {
  beforeEach(() => {
    __resetSignerCachesForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates EOA signer that lowercases identifiers and forwards signatures', async () => {
    const signMessage = vi.fn(async (msg: string) => `0x${Buffer.from(msg).toString('hex')}`);
    const signer = createEOASigner('0xABCDEFabcdef1234567890abcdefABCDEF123456', signMessage);

    const id = await Promise.resolve(signer.getIdentifier());
    expect(id.identifier).toBe('0xabcdefabcdef1234567890abcdefabcdef123456');
    expect(id.identifierKind).toBe(IdentifierKind.Ethereum);

    const bytes = await signer.signMessage('hello');
    expect(Array.from(bytes)).toEqual(Array.from(Buffer.from('hello')));
    expect(signMessage).toHaveBeenCalledWith('hello');
  });

  it('creates SCW signer with chain id and lowercased identifier', async () => {
    const signMessage = vi.fn(async () => '0x1234');
    const signer = createSCWSigner('0xFACEFACEfacefaceFACEFACEfaceFACEFACE0000', signMessage, 8453);

    const id = await Promise.resolve(signer.getIdentifier());
    expect(id.identifier).toBe('0xfacefacefacefacefacefacefacefaceface0000');
    const chainId = (signer as { getChainId?: () => bigint }).getChainId?.();
    expect(chainId).toBe(BigInt(8453));
    await signer.signMessage('msg');
    expect(signMessage).toHaveBeenCalled();
  });

  it('repairs repeated and case-insensitive prefixes before creating identifiers', async () => {
    const signMessage = vi.fn(async () => '0x1234');
    const signer = createEOASigner(
      '0X0xABCDEFabcdef1234567890abcdefABCDEF123456' as `0x${string}`,
      signMessage
    );

    const id = await Promise.resolve(signer.getIdentifier());
    expect(id.identifier).toBe('0xabcdefabcdef1234567890abcdefabcdef123456');
  });

  it('rejects malformed wallet addresses before they reach XMTP', () => {
    const signMessage = vi.fn(async () => '0x1234');

    expect(() => createEOASigner('0x0x1234' as `0x${string}`, signMessage)).toThrow(
      /EOA signer address must contain exactly 20 bytes/
    );
    expect(() => createSCWSigner('0xnot-an-address' as `0x${string}`, signMessage, 8453)).toThrow(
      /SCW signer address must contain exactly 20 bytes/
    );
  });

  it('deduplicates concurrent wallet signature requests for the same message', async () => {
    const deferred: { resolve?: (signature: string) => void } = {};
    const signMessage = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          deferred.resolve = resolve;
        })
    );

    const signer = createEOASigner('0xABCDEFabcdef1234567890abcdefABCDEF123456', signMessage);
    const message = 'XMTP wallet auth request';

    const first = signer.signMessage(message);
    const second = signer.signMessage(message);

    expect(signMessage).toHaveBeenCalledTimes(1);

    if (typeof deferred.resolve !== 'function') {
      throw new Error('Signature resolver was not captured.');
    }
    deferred.resolve('0x1234');
    const [firstBytes, secondBytes] = await Promise.all([first, second]);

    expect(Array.from(firstBytes)).toEqual([18, 52]);
    expect(Array.from(secondBytes)).toEqual([18, 52]);
    expect(signMessage).toHaveBeenCalledTimes(1);
  });

  it('reuses signatures until near expiry and refreshes when close to expiration', async () => {
    vi.useFakeTimers();
    const start = new Date('2026-02-24T00:00:00.000Z');
    vi.setSystemTime(start);

    const signMessage = vi.fn(async () => '0x1234');
    const signer = createEOASigner('0xABCDEFabcdef1234567890abcdefABCDEF123456', signMessage);
    const expiresAt = new Date(start.getTime() + 2 * 60 * 1000).toISOString();
    const message = `XMTP auth challenge\nValid Until: ${expiresAt}`;

    await signer.signMessage(message);
    await signer.signMessage(message);
    expect(signMessage).toHaveBeenCalledTimes(1);

    // Move inside the refresh-skew window (<=60s before expiry), forcing a refresh.
    vi.setSystemTime(new Date(start.getTime() + 95 * 1000));
    await signer.signMessage(message);

    expect(signMessage).toHaveBeenCalledTimes(2);
  });

  it('creates ephemeral signer that derives address and signs messages', async () => {
    const signer = createEphemeralSigner(
      '0x8a4c3bcdde28b6b64656c4c993be7b8bd4e7f88a68a651d81a1c4efc148f2f6d'
    );

    const id = await Promise.resolve(signer.getIdentifier());
    expect(id.identifier).toBe('0x1234567890abcdef1234567890abcdef12345678');
    const bytes = await signer.signMessage('ping');
    expect(bytes.length).toBeGreaterThan(0);
  });
});
