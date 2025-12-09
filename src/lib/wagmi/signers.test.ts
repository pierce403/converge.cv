import { describe, expect, it, vi } from 'vitest';
import { createEOASigner, createSCWSigner, createEphemeralSigner } from './signers';

vi.mock('viem/accounts', () => ({
  privateKeyToAccount: (_pk: string) => ({
    address: '0x1234567890abcdef1234567890abcdef12345678',
    signMessage: vi.fn(async ({ message }) => `0xsigned-${message}`),
  }),
}));

describe('wagmi signers', () => {
  it('creates EOA signer that lowercases identifiers and forwards signatures', async () => {
    const signMessage = vi.fn(async (msg: string) => `0x${Buffer.from(msg).toString('hex')}`);
    const signer = createEOASigner('0xABCDEFabcdef1234567890abcdefABCDEF1234', signMessage);

    const id = await Promise.resolve(signer.getIdentifier());
    expect(id.identifier).toBe('0xabcdefabcdef1234567890abcdefabcdef1234');
    expect(id.identifierKind).toBe('Ethereum');

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
