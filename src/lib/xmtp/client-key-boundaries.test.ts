import { describe, expect, it, vi } from 'vitest';
import type { Signer } from '@xmtp/browser-sdk';
import { hexToBytes } from 'viem';
import { deriveInvitePrivateKeyFromSignature } from '@/lib/utils/convos-invite';
import { XmtpClient, type XmtpIdentity } from './client';

vi.mock('@/lib/storage', () => ({
  getStorage: vi.fn(async () => ({
    getIdentityByAddress: vi.fn(async () => null),
    putIdentity: vi.fn(async () => undefined),
  })),
}));

type ClientInternals = {
  identity: XmtpIdentity | null;
  resolveInvitePrivateKey(creatorInboxId: string): Promise<Uint8Array>;
  createSigner(identity: XmtpIdentity): Promise<Signer>;
};

const internals = (client: XmtpClient) => client as unknown as ClientInternals;

describe('XmtpClient cryptographic input boundaries', () => {
  it('decodes local and persisted invite keys with case-insensitive repeated prefixes', async () => {
    const privateKeyBody = '12'.repeat(32);
    const localClient = internals(new XmtpClient());
    localClient.identity = {
      address: `0x${'11'.repeat(20)}`,
      privateKey: `0X0x${privateKeyBody}`,
    };
    await expect(localClient.resolveInvitePrivateKey('local-inbox')).resolves.toEqual(
      hexToBytes(`0x${privateKeyBody}`)
    );

    const inviteKeyBody = '34'.repeat(32);
    const persistedClient = internals(new XmtpClient());
    persistedClient.identity = {
      address: `0x${'22'.repeat(20)}`,
      inviteKey: `0X0x${inviteKeyBody}`,
      inviteKeyInboxId: 'persisted-inbox',
    };
    await expect(persistedClient.resolveInvitePrivateKey('persisted-inbox')).resolves.toEqual(
      hexToBytes(`0x${inviteKeyBody}`)
    );
  });

  it('derives the same invite key from an uppercase-prefixed wallet signature', async () => {
    const inboxId = 'wallet-inbox';
    const signatureBody = '56'.repeat(65);
    const message = `Converge Invite Key v1:${inboxId}`;
    const expected = await deriveInvitePrivateKeyFromSignature(
      hexToBytes(`0x${signatureBody}`),
      message
    );
    const client = internals(new XmtpClient());
    client.identity = {
      address: `0x${'33'.repeat(20)}`,
      signMessage: vi.fn(async () => `0X0x${signatureBody}`),
    };

    await expect(client.resolveInvitePrivateKey(inboxId)).resolves.toEqual(expected);
  });

  it('requires an explicit SCW chain ID while preserving EOA and legacy chain-zero signers', async () => {
    const client = internals(new XmtpClient());
    const signMessage = vi.fn(async () => '0x1234');
    const address = `0x${'44'.repeat(20)}`;

    await expect(
      client.createSigner({ address, walletType: 'SCW', signMessage })
    ).rejects.toThrow(/require the wallet network chain ID/);

    const legacySigner = await client.createSigner({
      address,
      walletType: 'SCW',
      chainId: 0,
      signMessage,
    });
    expect((legacySigner as { getChainId?: () => bigint }).getChainId?.()).toBe(0n);

    await expect(client.createSigner({ address, walletType: 'EOA', signMessage })).resolves.toEqual(
      expect.objectContaining({ type: 'EOA' })
    );
  });

  it('normalizes a historical repeated-prefix private key before signer creation', async () => {
    const client = internals(new XmtpClient());
    const signer = await client.createSigner({
      address: `0x${'55'.repeat(20)}`,
      privateKey: `0X0x${'01'.repeat(32)}`,
    });

    await expect(Promise.resolve(signer.getIdentifier())).resolves.toEqual(
      expect.objectContaining({ identifier: expect.stringMatching(/^0x[0-9a-f]{40}$/) })
    );
  });
});
