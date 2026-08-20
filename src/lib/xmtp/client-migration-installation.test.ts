import { afterEach, describe, expect, it, vi } from 'vitest';

const sdkMocks = vi.hoisted(() => ({
  getInboxIdForIdentifier: vi.fn(),
}));

vi.mock('@xmtp/browser-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@xmtp/browser-sdk')>();
  return {
    ...actual,
    getInboxIdForIdentifier: sdkMocks.getInboxIdForIdentifier,
  };
});

import {
  Client,
  IdentifierKind,
  type InboxState,
} from '@xmtp/browser-sdk';
import { XmtpClient } from './client';

describe('XmtpClient device-join migration installation verification', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    sdkMocks.getInboxIdForIdentifier.mockReset();
  });

  it('returns the exact local installation when the saved installation is stale', async () => {
    const inboxId = 'ab'.repeat(32);
    const savedInstallationId = 'aa'.repeat(32);
    const localInstallationId = 'bb'.repeat(32);
    const walletAddress = `0x${'11'.repeat(20)}`;
    const localEoaAddress = `0x${'22'.repeat(20)}`;
    const walletIdentifier = {
      identifier: walletAddress,
      identifierKind: IdentifierKind.Ethereum,
    };
    const finalLedgerState = {
      inboxId,
      recoveryIdentifier: walletIdentifier,
      accountIdentifiers: [walletIdentifier],
      installations: [savedInstallationId, localInstallationId].map(
        (id, index) => ({
          id,
          bytes: new Uint8Array([index + 1]),
          clientTimestampNs: BigInt(index + 1),
        })
      ),
    } as unknown as InboxState;
    const close = vi.fn(async () => undefined);
    const exactLocalClient = {
      installationId: localInstallationId,
      close,
    };
    const xmtp = new XmtpClient();
    const internal = xmtp as unknown as {
      createSigner: () => Promise<{
        getIdentifier: () => Promise<typeof walletIdentifier>;
      }>;
    };
    internal.createSigner = vi.fn(async () => ({
      getIdentifier: vi.fn(async () => walletIdentifier),
    }));
    sdkMocks.getInboxIdForIdentifier.mockResolvedValue(inboxId);
    const fetchInboxStates = vi
      .spyOn(Client, 'fetchInboxStates')
      .mockResolvedValue([finalLedgerState]);
    const create = vi
      .spyOn(Client, 'create')
      .mockResolvedValue(exactLocalClient as unknown as Client);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const result = await xmtp.migrateDeviceJoinIdentity({
      walletIdentity: {
        address: walletAddress,
        walletType: 'EOA',
      },
      localEoaAddress,
      expectedInboxId: inboxId,
      knownInstallationId: savedInstallationId,
    });

    expect(result).toEqual({
      success: true,
      inboxId,
      installationId: localInstallationId,
    });
    expect(result.installationId).not.toBe(savedInstallationId);
    expect(create).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        dbPath: expect.stringContaining(inboxId),
        disableAutoRegister: true,
      })
    );
    expect(close).toHaveBeenCalledOnce();
    expect(fetchInboxStates).toHaveBeenCalledTimes(2);
  });
});
