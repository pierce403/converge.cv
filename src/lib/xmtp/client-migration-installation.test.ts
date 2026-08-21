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

import { Client, IdentifierKind, type InboxState } from '@xmtp/browser-sdk';
import { privateKeyToAccount } from 'viem/accounts';
import { XmtpClient } from './client';

describe('XmtpClient device-join migration installation verification', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    sdkMocks.getInboxIdForIdentifier.mockReset();
  });

  it('returns the exact local installation and proves wallet ownership when the saved installation is stale', async () => {
    const inboxId = 'ab'.repeat(32);
    const savedInstallationId = 'aa'.repeat(32);
    const localInstallationId = 'bb'.repeat(32);
    const walletAccount = privateKeyToAccount(`0x${'11'.repeat(32)}`);
    const walletAddress = walletAccount.address;
    const localEoaAddress = `0x${'22'.repeat(20)}`;
    const walletIdentifier = {
      identifier: walletAddress,
      identifierKind: IdentifierKind.Ethereum,
    };
    const finalLedgerState = {
      inboxId,
      recoveryIdentifier: walletIdentifier,
      accountIdentifiers: [walletIdentifier],
      installations: [savedInstallationId, localInstallationId].map((id, index) => ({
        id,
        bytes: new Uint8Array([index + 1]),
        clientTimestampNs: BigInt(index + 1),
      })),
    } as unknown as InboxState;
    const close = vi.fn(async () => undefined);
    const exactLocalClient = {
      inboxId,
      installationId: localInstallationId,
      close,
    };
    const walletSignMessage = vi.fn(
      async (message: string) => await walletAccount.signMessage({ message })
    );
    const xmtp = new XmtpClient();
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
        signMessage: walletSignMessage,
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
        knownInboxId: inboxId,
      })
    );
    expect(close).toHaveBeenCalledOnce();
    expect(fetchInboxStates).toHaveBeenCalledTimes(2);
    expect(walletSignMessage).toHaveBeenCalledOnce();
    expect(walletSignMessage.mock.calls[0]?.[0]).toContain('Converge XMTP identity migration');
    expect(walletSignMessage.mock.calls[0]?.[0]).toContain(`Inbox: ${inboxId}`);
  });

  it('fails closed instead of trusting an unverifiable no-op smart-wallet signature', async () => {
    const inboxId = 'af'.repeat(32);
    const installationId = 'bf'.repeat(32);
    const walletAddress = `0x${'13'.repeat(20)}`;
    const localEoaAddress = `0x${'14'.repeat(20)}`;
    const walletIdentifier = {
      identifier: walletAddress,
      identifierKind: IdentifierKind.Ethereum,
    };
    const finalLedgerState = {
      inboxId,
      recoveryIdentifier: walletIdentifier,
      accountIdentifiers: [walletIdentifier],
      installations: [
        {
          id: installationId,
          bytes: new Uint8Array([1]),
          clientTimestampNs: BigInt(1),
        },
      ],
    } as unknown as InboxState;
    const walletSignMessage = vi.fn(async () => '0x1234');
    sdkMocks.getInboxIdForIdentifier.mockResolvedValue(inboxId);
    const fetchInboxStates = vi
      .spyOn(Client, 'fetchInboxStates')
      .mockResolvedValue([finalLedgerState]);
    const create = vi
      .spyOn(Client, 'create')
      .mockRejectedValue(new Error('Client.create must not run for unverifiable SCW proof'));

    const xmtp = new XmtpClient();
    await expect(
      xmtp.migrateDeviceJoinIdentity({
        walletIdentity: {
          address: walletAddress,
          chainId: 8453,
          walletType: 'SCW',
          signMessage: walletSignMessage,
        },
        localEoaAddress,
        expectedInboxId: inboxId,
        knownInstallationId: installationId,
      })
    ).rejects.toThrow(/cannot safely finish an already-updated smart-wallet migration/i);

    expect(fetchInboxStates).toHaveBeenCalledOnce();
    expect(create).not.toHaveBeenCalled();
    expect(walletSignMessage).not.toHaveBeenCalled();
  });

  it('falls back to exact inbox state after persistent wallet lookup failures and still removes the local account', async () => {
    vi.useFakeTimers();
    const inboxId = 'ac'.repeat(32);
    const installationId = 'bc'.repeat(32);
    const walletAddress = `0x${'31'.repeat(20)}`;
    const localEoaAddress = `0x${'32'.repeat(20)}`;
    const walletIdentifier = {
      identifier: walletAddress,
      identifierKind: IdentifierKind.Ethereum,
    };
    const localEoaIdentifier = {
      identifier: localEoaAddress,
      identifierKind: IdentifierKind.Ethereum,
    };
    const installation = {
      id: installationId,
      bytes: new Uint8Array([1]),
      clientTimestampNs: BigInt(1),
    };
    const initialState = {
      inboxId,
      recoveryIdentifier: walletIdentifier,
      accountIdentifiers: [walletIdentifier, localEoaIdentifier],
      installations: [installation],
    } as unknown as InboxState;
    const finalState = {
      ...initialState,
      accountIdentifiers: [walletIdentifier],
    } as unknown as InboxState;
    const failedLookup = new Error(
      'api client error api client at endpoint "/xmtp.identity.api.v1.IdentityApi/GetInboxIds" has error status: \'Unknown error\', self: "js api error: TypeError: Failed to fetch"'
    );
    sdkMocks.getInboxIdForIdentifier.mockRejectedValue(failedLookup);
    const fetchInboxStates = vi
      .spyOn(Client, 'fetchInboxStates')
      .mockResolvedValueOnce([initialState])
      .mockResolvedValueOnce([finalState]);
    const walletSignMessage = vi.fn(async () => '0x1234');
    const close = vi.fn(async () => undefined);
    const removeAccount = vi.fn();
    const create = vi.spyOn(Client, 'create').mockImplementation(async (signer) => {
      const migrationSigner = signer as unknown as {
        signMessage: (message: string) => Promise<Uint8Array>;
      };
      removeAccount.mockImplementationOnce(async () => {
        await migrationSigner.signMessage('remove-local-account');
      });
      return {
        inboxId,
        installationId,
        removeAccount,
        close,
      } as unknown as Client;
    });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const xmtp = new XmtpClient();
    const migration = xmtp.migrateDeviceJoinIdentity({
      walletIdentity: {
        address: walletAddress,
        walletType: 'EOA',
        signMessage: walletSignMessage,
      },
      localEoaAddress,
      expectedInboxId: inboxId,
      knownInstallationId: installationId,
    });

    await vi.runAllTimersAsync();
    await expect(migration).resolves.toEqual({
      success: true,
      inboxId,
      installationId,
    });
    expect(sdkMocks.getInboxIdForIdentifier).toHaveBeenCalledTimes(8);
    expect(fetchInboxStates).toHaveBeenCalledTimes(2);
    expect(fetchInboxStates).toHaveBeenNthCalledWith(1, [inboxId], 'production');
    expect(fetchInboxStates).toHaveBeenNthCalledWith(2, [inboxId], 'production');
    expect(create).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        disableAutoRegister: true,
        knownInboxId: inboxId,
      })
    );
    expect(removeAccount).toHaveBeenCalledOnce();
    expect(removeAccount).toHaveBeenCalledWith(localEoaIdentifier);
    expect(walletSignMessage).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it('rejects a different resolved wallet inbox before opening a client or signing', async () => {
    const inboxId = 'ad'.repeat(32);
    const differentInboxId = 'bd'.repeat(32);
    const walletAddress = `0x${'41'.repeat(20)}`;
    const localEoaAddress = `0x${'42'.repeat(20)}`;
    const walletSignMessage = vi.fn(async () => '0x1234');
    sdkMocks.getInboxIdForIdentifier.mockResolvedValue(differentInboxId);
    const fetchInboxStates = vi
      .spyOn(Client, 'fetchInboxStates')
      .mockRejectedValue(new Error('fetchInboxStates must not run for a mismatched inbox'));
    const create = vi
      .spyOn(Client, 'create')
      .mockRejectedValue(new Error('Client.create must not run for a mismatched inbox'));

    const xmtp = new XmtpClient();
    await expect(
      xmtp.migrateDeviceJoinIdentity({
        walletIdentity: {
          address: walletAddress,
          walletType: 'EOA',
          signMessage: walletSignMessage,
        },
        localEoaAddress,
        expectedInboxId: inboxId,
      })
    ).rejects.toThrow('The connected wallet does not resolve to the target XMTP inbox.');

    expect(fetchInboxStates).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(walletSignMessage).not.toHaveBeenCalled();
  });

  it('rejects an exact target state without wallet authority before opening a client or signing', async () => {
    const inboxId = 'ae'.repeat(32);
    const installationId = 'be'.repeat(32);
    const walletAddress = `0x${'51'.repeat(20)}`;
    const localEoaAddress = `0x${'52'.repeat(20)}`;
    const unrelatedAddress = `0x${'53'.repeat(20)}`;
    const localEoaIdentifier = {
      identifier: localEoaAddress,
      identifierKind: IdentifierKind.Ethereum,
    };
    const unrelatedIdentifier = {
      identifier: unrelatedAddress,
      identifierKind: IdentifierKind.Ethereum,
    };
    const stateWithoutWalletAuthority = {
      inboxId,
      recoveryIdentifier: unrelatedIdentifier,
      accountIdentifiers: [unrelatedIdentifier, localEoaIdentifier],
      installations: [
        {
          id: installationId,
          bytes: new Uint8Array([1]),
          clientTimestampNs: BigInt(1),
        },
      ],
    } as unknown as InboxState;
    const walletSignMessage = vi.fn(async () => '0x1234');
    sdkMocks.getInboxIdForIdentifier.mockResolvedValue(inboxId);
    const fetchInboxStates = vi
      .spyOn(Client, 'fetchInboxStates')
      .mockResolvedValue([stateWithoutWalletAuthority]);
    const create = vi
      .spyOn(Client, 'create')
      .mockRejectedValue(new Error('Client.create must not run without wallet authority'));

    const xmtp = new XmtpClient();
    await expect(
      xmtp.migrateDeviceJoinIdentity({
        walletIdentity: {
          address: walletAddress,
          walletType: 'EOA',
          signMessage: walletSignMessage,
        },
        localEoaAddress,
        expectedInboxId: inboxId,
      })
    ).rejects.toThrow(
      'The connected wallet is not a current account or recovery authority for this inbox.'
    );

    expect(fetchInboxStates).toHaveBeenCalledOnce();
    expect(fetchInboxStates).toHaveBeenCalledWith([inboxId], 'production');
    expect(create).not.toHaveBeenCalled();
    expect(walletSignMessage).not.toHaveBeenCalled();
  });

  it('closes and rejects a migration client for a different inbox before mutation or signing', async () => {
    const inboxId = 'af'.repeat(32);
    const wrongInboxId = 'bf'.repeat(32);
    const installationId = 'cf'.repeat(32);
    const walletAddress = `0x${'61'.repeat(20)}`;
    const localEoaAddress = `0x${'62'.repeat(20)}`;
    const walletIdentifier = {
      identifier: walletAddress,
      identifierKind: IdentifierKind.Ethereum,
    };
    const localEoaIdentifier = {
      identifier: localEoaAddress,
      identifierKind: IdentifierKind.Ethereum,
    };
    const initialState = {
      inboxId,
      recoveryIdentifier: walletIdentifier,
      accountIdentifiers: [walletIdentifier, localEoaIdentifier],
      installations: [
        {
          id: installationId,
          bytes: new Uint8Array([1]),
          clientTimestampNs: BigInt(1),
        },
      ],
    } as unknown as InboxState;
    const walletSignMessage = vi.fn(async () => '0x1234');
    sdkMocks.getInboxIdForIdentifier.mockResolvedValue(inboxId);
    vi.spyOn(Client, 'fetchInboxStates').mockResolvedValue([initialState]);
    const close = vi.fn(async () => undefined);
    const removeAccount = vi.fn(async () => undefined);
    const create = vi.spyOn(Client, 'create').mockResolvedValue({
      inboxId: wrongInboxId,
      installationId,
      removeAccount,
      close,
    } as unknown as Client);

    const xmtp = new XmtpClient();
    await expect(
      xmtp.migrateDeviceJoinIdentity({
        walletIdentity: {
          address: walletAddress,
          walletType: 'EOA',
          signMessage: walletSignMessage,
        },
        localEoaAddress,
        expectedInboxId: inboxId,
      })
    ).rejects.toThrow('XMTP opened a different inbox than the verified migration target.');

    expect(create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ knownInboxId: inboxId })
    );
    expect(close).toHaveBeenCalledOnce();
    expect(removeAccount).not.toHaveBeenCalled();
    expect(walletSignMessage).not.toHaveBeenCalled();
  });

  it('signs both recovery and local-account mutations and verifies the final exact state', async () => {
    const inboxId = 'a1'.repeat(32);
    const installationId = 'b1'.repeat(32);
    const walletAddress = `0x${'71'.repeat(20)}`;
    const localEoaAddress = `0x${'72'.repeat(20)}`;
    const walletIdentifier = {
      identifier: walletAddress,
      identifierKind: IdentifierKind.Ethereum,
    };
    const localEoaIdentifier = {
      identifier: localEoaAddress,
      identifierKind: IdentifierKind.Ethereum,
    };
    const installation = {
      id: installationId,
      bytes: new Uint8Array([1]),
      clientTimestampNs: BigInt(1),
    };
    const initialState = {
      inboxId,
      recoveryIdentifier: localEoaIdentifier,
      accountIdentifiers: [walletIdentifier, localEoaIdentifier],
      installations: [installation],
    } as unknown as InboxState;
    const postRecoveryState = {
      ...initialState,
      recoveryIdentifier: walletIdentifier,
    } as unknown as InboxState;
    const finalState = {
      ...postRecoveryState,
      accountIdentifiers: [walletIdentifier],
    } as unknown as InboxState;
    const fetchInboxStates = vi
      .spyOn(Client, 'fetchInboxStates')
      .mockResolvedValueOnce([initialState])
      .mockResolvedValueOnce([postRecoveryState])
      .mockResolvedValueOnce([finalState]);
    sdkMocks.getInboxIdForIdentifier.mockResolvedValue(inboxId);
    const walletSignMessage = vi.fn(async () => '0x1234');
    const recoveryClose = vi.fn(async () => undefined);
    const removeClose = vi.fn(async () => undefined);
    const changeRecoveryIdentifier = vi.fn();
    const removeAccount = vi.fn();
    const create = vi
      .spyOn(Client, 'create')
      .mockImplementationOnce(async (signer) => {
        const migrationSigner = signer as unknown as {
          signMessage: (message: string) => Promise<Uint8Array>;
        };
        changeRecoveryIdentifier.mockImplementationOnce(async () => {
          await migrationSigner.signMessage('change-recovery');
        });
        return {
          inboxId,
          installationId,
          changeRecoveryIdentifier,
          close: recoveryClose,
        } as unknown as Client;
      })
      .mockImplementationOnce(async (signer) => {
        const migrationSigner = signer as unknown as {
          signMessage: (message: string) => Promise<Uint8Array>;
        };
        removeAccount.mockImplementationOnce(async () => {
          await migrationSigner.signMessage('remove-local-account');
        });
        return {
          inboxId,
          installationId,
          removeAccount,
          close: removeClose,
        } as unknown as Client;
      });
    const phases: string[] = [];

    const xmtp = new XmtpClient();
    await expect(
      xmtp.migrateDeviceJoinIdentity({
        walletIdentity: {
          address: walletAddress,
          walletType: 'EOA',
          signMessage: walletSignMessage,
        },
        localEoaAddress,
        expectedInboxId: inboxId,
        knownInstallationId: installationId,
        onPhase: (phase) => {
          phases.push(phase);
        },
      })
    ).resolves.toEqual({
      success: true,
      inboxId,
      installationId,
    });

    expect(changeRecoveryIdentifier).toHaveBeenCalledOnce();
    expect(changeRecoveryIdentifier).toHaveBeenCalledWith(walletIdentifier);
    expect(removeAccount).toHaveBeenCalledOnce();
    expect(removeAccount).toHaveBeenCalledWith(localEoaIdentifier);
    expect(walletSignMessage).toHaveBeenCalledTimes(2);
    expect(recoveryClose).toHaveBeenCalledOnce();
    expect(removeClose).toHaveBeenCalledOnce();
    expect(fetchInboxStates).toHaveBeenCalledTimes(3);
    expect(fetchInboxStates).toHaveBeenNthCalledWith(3, [inboxId], 'production');
    expect(create).toHaveBeenCalledTimes(2);
    for (const [, options] of create.mock.calls) {
      expect(options).toEqual(
        expect.objectContaining({
          disableAutoRegister: true,
          knownInboxId: inboxId,
        })
      );
    }
    expect(phases).toEqual([
      'preflight',
      'updating-recovery',
      'removing-local-account',
      'verifying-network-state',
      'complete',
    ]);
  });
});
