import type { InboxState, Identifier, Signer } from '@xmtp/browser-sdk';
import { describe, expect, it, vi } from 'vitest';
import {
  completeProvisioning,
  getExactClientDbPath,
  getClientDbPath,
  getPersistentClientDbPath,
  getScwRetryChainId,
  InstallationLimitError,
  planClientInstallation,
  provisionExternalWalletDevice,
  provisionWithStaleInstallationRecovery,
  recordInstallationReady,
  shouldRequestHistorySync,
  signerIdentityKey,
  StaleLocalInstallationError,
  type DeviceProvisioningClient,
} from './device-provisioning';

const targetInbox = 'a'.repeat(64);
const targetIdentifier = {
  identifier: `0x${'11'.repeat(20)}`,
  identifierKind: 0,
} as Identifier;

const signer = (identifier: Identifier): Signer => ({
  type: 'EOA',
  getIdentifier: () => identifier,
  signMessage: async () => new Uint8Array([1]),
});

function setup(options?: {
  installationIds?: string[];
  omitInboxState?: boolean;
  locallyRegistered?: boolean;
  registerNoop?: boolean;
  staticInstallationStaysStale?: boolean;
  staticInstallationVisibleAfter?: number;
  registerThrowsAfterMutation?: boolean;
  targetIsCurrentAuthority?: boolean;
}) {
  const installationIds = [...(options?.installationIds ?? [])];
  let locallyRegistered =
    options?.locallyRegistered ?? installationIds.includes('installation-new');
  let delayedVisibilityReads = 0;
  let registrationCanBecomeVisible = locallyRegistered;
  const events: string[] = [];

  const register = vi.fn(async () => {
    registrationCanBecomeVisible = true;
    if (!options?.registerNoop) {
      locallyRegistered = true;
      if (
        !options?.staticInstallationStaysStale &&
        options?.staticInstallationVisibleAfter === undefined &&
        !installationIds.includes(manager.installationId!)
      ) {
        installationIds.push(manager.installationId!);
      }
    }
    if (options?.registerThrowsAfterMutation) {
      throw new Error('registration response was interrupted');
    }
  });

  const close = vi.fn(async () => undefined);
  let fetchManagerInboxState = async (): Promise<InboxState> => {
    throw new Error('Manager inbox-state reader was not initialized.');
  };
  const manager: DeviceProvisioningClient = {
    inboxId: targetInbox,
    installationId: 'installation-new',
    preferences: {
      fetchInboxState: async () => await fetchManagerInboxState(),
    },
    isRegistered: vi.fn(async () => locallyRegistered),
    register,
    fetchInboxIdByIdentifier: vi.fn(async () => targetInbox),
    close,
  };
  const resolveInboxId = vi.fn(async (identifier: Identifier) =>
    identifier.identifier.toLowerCase() === targetIdentifier.identifier.toLowerCase()
      ? targetInbox
      : undefined
  );
  const fetchInboxState = vi.fn(async () => {
    if (
      registrationCanBecomeVisible &&
      options?.staticInstallationVisibleAfter !== undefined &&
      !installationIds.includes(manager.installationId!)
    ) {
      delayedVisibilityReads += 1;
      if (delayedVisibilityReads >= options.staticInstallationVisibleAfter) {
        installationIds.push(manager.installationId!);
        events.push('installation-visible');
      }
    }
    return options?.omitInboxState
      ? undefined
      : ({
          inboxId: targetInbox,
          recoveryIdentifier:
            options?.targetIsCurrentAuthority === false
              ? ({ identifier: `0x${'44'.repeat(20)}`, identifierKind: 0 } as Identifier)
              : targetIdentifier,
          installations: installationIds.map((id) => ({ id })),
          accountIdentifiers: [
            ...(options?.targetIsCurrentAuthority === false ? [] : [targetIdentifier]),
          ],
        } as InboxState);
  });
  fetchManagerInboxState = async () => {
    const state = await fetchInboxState();
    if (!state) {
      throw new Error('Manager inbox state unavailable.');
    }
    return state;
  };
  const createManager = vi.fn(async () => manager);
  const sleep = vi.fn(async () => undefined);

  return {
    manager,
    register,
    close,
    events,
    dependencies: { resolveInboxId, fetchInboxState, createManager, sleep },
  };
}

describe('direct external wallet device provisioning', () => {
  it('replaces one stale local installation without changing the wallet flow', async () => {
    const stale = new StaleLocalInstallationError(targetInbox, 'installation-stale');
    const provision = vi
      .fn<(resumeInstallationId?: string) => Promise<string>>()
      .mockRejectedValueOnce(stale)
      .mockResolvedValueOnce('installation-replacement');
    const reset = vi.fn(async () => undefined);

    await expect(
      provisionWithStaleInstallationRecovery('installation-stale', provision, reset)
    ).resolves.toBe('installation-replacement');

    expect(provision.mock.calls).toEqual([['installation-stale'], [undefined]]);
    expect(reset).toHaveBeenCalledOnce();
    expect(reset).toHaveBeenCalledWith(stale);
  });

  it('does not loop when the replacement installation also fails', async () => {
    const first = new StaleLocalInstallationError(targetInbox, 'installation-stale');
    const second = new StaleLocalInstallationError(targetInbox, 'installation-replacement');
    const provision = vi
      .fn<(resumeInstallationId?: string) => Promise<string>>()
      .mockRejectedValueOnce(first)
      .mockRejectedValueOnce(second);
    const reset = vi.fn(async () => undefined);

    await expect(
      provisionWithStaleInstallationRecovery('installation-stale', provision, reset)
    ).rejects.toBe(second);

    expect(provision).toHaveBeenCalledTimes(2);
    expect(reset).toHaveBeenCalledOnce();
  });

  it('registers the replacement installation directly under the external wallet', async () => {
    const staleHarness = setup({
      locallyRegistered: true,
      staticInstallationStaysStale: true,
    });
    staleHarness.manager.installationId = 'installation-stale';
    const replacementHarness = setup();
    replacementHarness.manager.installationId = 'installation-replacement';
    const target = signer(targetIdentifier);
    let attempt = 0;
    const provision = async (knownInstallationId?: string) => {
      const harness = attempt++ === 0 ? staleHarness : replacementHarness;
      return await provisionExternalWalletDevice(target, targetInbox, {
        ...harness.dependencies,
        knownInstallationId,
      });
    };

    const result = await provisionWithStaleInstallationRecovery(
      'installation-stale',
      provision,
      async () => undefined
    );

    expect(result.installationId).toBe('installation-replacement');
    expect(staleHarness.register).not.toHaveBeenCalled();
    expect(replacementHarness.register).toHaveBeenCalledOnce();
  });

  it('rechecks 10/10 capacity before opening a replacement installation', async () => {
    const staleHarness = setup({
      locallyRegistered: true,
      staticInstallationStaysStale: true,
    });
    staleHarness.manager.installationId = 'installation-stale';
    const fullHarness = setup({
      installationIds: Array.from({ length: 10 }, (_, index) => `installation-${index}`),
    });
    let attempt = 0;
    const provision = async (knownInstallationId?: string) => {
      const harness = attempt++ === 0 ? staleHarness : fullHarness;
      return await provisionExternalWalletDevice(
        signer(targetIdentifier),
        targetInbox,
        { ...harness.dependencies, knownInstallationId }
      );
    };

    await expect(
      provisionWithStaleInstallationRecovery(
        'installation-stale',
        provision,
        async () => undefined
      )
    ).rejects.toBeInstanceOf(InstallationLimitError);

    expect(fullHarness.dependencies.createManager).not.toHaveBeenCalled();
    expect(fullHarness.register).not.toHaveBeenCalled();
  });

  it('registers one target-inbox installation directly for external wallet', async () => {
    const harness = setup();

    const result = await provisionExternalWalletDevice(
      signer(targetIdentifier),
      targetInbox,
      harness.dependencies
    );

    expect(result).toEqual({
      inboxId: targetInbox,
      installationId: 'installation-new',
      installationRegistered: true,
    });
    expect(harness.register).toHaveBeenCalledTimes(1);
    expect(harness.close).toHaveBeenCalledTimes(1);
  });

  it('reports lifecycle phases and persists the installation before mutation', async () => {
    const harness = setup();
    const phases: string[] = [];
    const onInstallationReady = vi.fn(async () => undefined);

    await provisionExternalWalletDevice(
      signer(targetIdentifier),
      targetInbox,
      {
        ...harness.dependencies,
        onInstallationReady,
        onPhase: async (phase) => {
          phases.push(phase);
        },
      }
    );

    expect(onInstallationReady).toHaveBeenCalledWith('installation-new');
    expect(phases).toEqual([
      'preflight',
      'opening-manager',
      'manager-ready',
      'registering-installation',
      'installation-registered',
      'verifying-installation',
      'complete',
    ]);
  });

  it('reuses the same installation after reload', async () => {
    const harness = setup({
      installationIds: ['installation-new'],
    });

    const result = await provisionExternalWalletDevice(
      signer(targetIdentifier),
      targetInbox,
      harness.dependencies
    );

    expect(result.installationRegistered).toBe(false);
    expect(harness.register).not.toHaveBeenCalled();
  });

  it('blocks at 10 installations before registration', async () => {
    const harness = setup({ installationIds: Array.from({ length: 10 }, (_, i) => `i-${i}`) });

    await expect(
      provisionExternalWalletDevice(
        signer(targetIdentifier),
        targetInbox,
        harness.dependencies
      )
    ).rejects.toBeInstanceOf(InstallationLimitError);

    expect(harness.register).not.toHaveBeenCalled();
    expect(harness.dependencies.createManager).not.toHaveBeenCalled();
  });

  it('resumes its already-registered installation when the inbox is otherwise full', async () => {
    const installationIds = [
      'installation-new',
      ...Array.from({ length: 9 }, (_, index) => `other-${index}`),
    ];
    const harness = setup({ installationIds });

    const result = await provisionExternalWalletDevice(
      signer(targetIdentifier),
      targetInbox,
      {
        ...harness.dependencies,
        knownInstallationId: '0X0xinstallation-new',
      }
    );

    expect(result.installationRegistered).toBe(false);
    expect(harness.register).not.toHaveBeenCalled();
  });

  it('resumes when register throws after the manager becomes locally registered', async () => {
    const harness = setup({
      registerThrowsAfterMutation: true,
      staticInstallationVisibleAfter: 3,
    });

    const result = await provisionExternalWalletDevice(
      signer(targetIdentifier),
      targetInbox,
      harness.dependencies
    );

    expect(result.installationRegistered).toBe(true);
    expect(harness.manager.isRegistered).toHaveBeenCalled();
  });

  it('resumes a locally registered installation after static membership catches up', async () => {
    const harness = setup({
      locallyRegistered: true,
      staticInstallationVisibleAfter: 3,
    });

    const result = await provisionExternalWalletDevice(
      signer(targetIdentifier),
      targetInbox,
      {
        ...harness.dependencies,
        knownInstallationId: 'installation-new',
      }
    );

    expect(result.installationRegistered).toBe(false);
    expect(harness.register).not.toHaveBeenCalled();
  });

  it('does not trust local registration while the installation is absent from the inbox ledger', async () => {
    const harness = setup({
      locallyRegistered: true,
      staticInstallationStaysStale: true,
    });

    await expect(
      provisionExternalWalletDevice(
        signer(targetIdentifier),
        targetInbox,
        {
          ...harness.dependencies,
          knownInstallationId: 'installation-new',
        }
      )
    ).rejects.toBeInstanceOf(StaleLocalInstallationError);

    expect(harness.register).not.toHaveBeenCalled();
  });

  it('fails closed when register returns but the local installation remains unregistered', async () => {
    const harness = setup({ registerNoop: true });

    await expect(
      provisionExternalWalletDevice(
        signer(targetIdentifier),
        targetInbox,
        harness.dependencies
      )
    ).rejects.toThrow('not registered in its local XMTP database');

    expect(harness.register).toHaveBeenCalledOnce();
  });

  it('fails closed when target inbox capacity cannot be fetched', async () => {
    const harness = setup({ omitInboxState: true });

    await expect(
      provisionExternalWalletDevice(
        signer(targetIdentifier),
        targetInbox,
        harness.dependencies
      )
    ).rejects.toThrow('could not verify the installation limit');

    expect(harness.register).not.toHaveBeenCalled();
  });

  it('requires the approving wallet to remain a current inbox authority', async () => {
    const harness = setup({ targetIsCurrentAuthority: false });

    await expect(
      provisionExternalWalletDevice(
        signer(targetIdentifier),
        targetInbox,
        harness.dependencies
      )
    ).rejects.toThrow(/not a current account or recovery authority/i);

    expect(harness.dependencies.createManager).not.toHaveBeenCalled();
    expect(harness.register).not.toHaveBeenCalled();
  });
});

describe('client identity and history policy', () => {
  it('persists installation readiness before completing new-inbox provisioning', () => {
    const pending = {
      address: '0x1234',
      publicKey: '0x5678',
      privateKey: '0xabcd',
      createdAt: 1,
      provisioningMode: 'new-inbox' as const,
      provisioningPending: true,
      xmtpDbPathMode: 'inbox-default' as const,
    };

    const ready = recordInstallationReady(pending, {
      inboxId: targetInbox.toUpperCase(),
      installationId: 'installation-new',
    });
    expect(ready).toMatchObject({
      inboxId: targetInbox,
      expectedInboxId: targetInbox,
      installationId: 'installation-new',
      provisioningPending: true,
    });

    const complete = completeProvisioning(
      ready,
      {
        inboxId: targetInbox,
        installationId: 'installation-new',
        historySyncRequested: false,
      },
      100
    );
    expect(complete.provisioningPending).toBe(false);
    expect(complete.historySyncRequestedAt).toBeUndefined();
  });

  it('keeps failed history requests pending and tracks requested history accurately without false clear', () => {
    const identity = {
      address: '0x1234',
      publicKey: '0x5678',
      privateKey: '0xabcd',
      createdAt: 1,
      provisioningMode: 'keyfile-restore' as const,
      provisioningPending: true,
      needsHistorySync: true,
    };
    const failed = completeProvisioning(identity, {
      inboxId: targetInbox,
      installationId: 'installation-keyfile',
      historySyncRequested: false,
    });
    expect(failed.needsHistorySync).toBe(true);
    expect(failed.historySyncRequestedAt).toBeUndefined();

    const succeeded = completeProvisioning(
      identity,
      {
        inboxId: targetInbox,
        installationId: 'installation-keyfile',
        historySyncRequested: true,
      },
      1234
    );
    // needsHistorySync is NOT cleared merely because publication succeeded
    expect(succeeded.needsHistorySync).toBe(true);
    expect(succeeded.historySyncRequestedAt).toBe(1234);
    expect(succeeded.historySyncStatus).toBe('requested');
  });

  it('records an alternate verified database path and retains only the superseded installation for cleanup', () => {
    const repaired = recordInstallationReady(
      {
        address: '0x1234',
        publicKey: '0x5678',
        createdAt: 1,
        installationId: 'saved-old',
        xmtpDbPathMode: 'inbox-default',
      },
      {
        inboxId: targetInbox,
        installationId: 'verified-alternate',
        databasePathMode: 'legacy-address',
        previousInstallationId: 'saved-old',
      }
    );

    expect(repaired).toMatchObject({
      inboxId: targetInbox,
      installationId: 'verified-alternate',
      staleInstallationId: 'saved-old',
      xmtpDbPathMode: 'legacy-address',
    });
  });

  it('plans fresh local key to new inbox as one registration without history', () => {
    expect(
      planClientInstallation({
        inboxId: targetInbox,
        hasCurrentInstallation: false,
        existingInstallationCount: 0,
      })
    ).toEqual({ registerInstallation: true, requestHistoryAfterRegistration: false });
  });

  it('plans same-key keyfile restore as the same inbox with one new installation', () => {
    expect(
      planClientInstallation({
        inboxId: targetInbox,
        hasCurrentInstallation: false,
        existingInstallationCount: 2,
      })
    ).toEqual({ registerInstallation: true, requestHistoryAfterRegistration: true });
  });

  it('plans reload with the persisted database as no new installation', () => {
    expect(
      planClientInstallation({
        inboxId: targetInbox,
        hasCurrentInstallation: true,
        existingInstallationCount: 2,
      })
    ).toEqual({ registerInstallation: false, requestHistoryAfterRegistration: false });
  });

  it('uses the inbox-aware SDK path for new identities and preserves legacy paths', () => {
    expect(getClientDbPath('0xABCD', 'inbox-default')).toBeUndefined();
    expect(getClientDbPath('0xABCD', undefined)).toBe('xmtp-production-0xabcd.db3');
    expect(getExactClientDbPath('0xABCD', 'inbox-default', targetInbox)).toBe(
      `xmtp-production-${targetInbox}.db3`
    );
    expect(getExactClientDbPath('0xABCD', 'legacy-address', targetInbox)).toBe(
      'xmtp-production-0xabcd.db3'
    );
    expect(getPersistentClientDbPath('0xABCD', 'inbox-default', targetInbox, 'rw')).toBe(
      `file:xmtp-production-${targetInbox}.db3?mode=rw&vfs=opfs-libxmtp`
    );
    expect(getPersistentClientDbPath('0xABCD', 'legacy-address', targetInbox)).toBe(
      'file:xmtp-production-0xabcd.db3?mode=rwc&vfs=opfs-libxmtp'
    );
  });

  it('compares signer source, wallet type, and SCW chain ID', () => {
    const base = { address: '0xABCD', walletType: 'SCW' as const, chainId: 8453 };
    expect(signerIdentityKey(base)).not.toBe(signerIdentityKey({ ...base, chainId: 1 }));
    expect(signerIdentityKey(base)).not.toBe(
      signerIdentityKey({ address: base.address, walletType: 'SCW' })
    );
    expect(signerIdentityKey(base)).not.toBe(
      signerIdentityKey({ ...base, walletType: 'EOA' })
    );
    expect(signerIdentityKey(base)).not.toBe(
      signerIdentityKey({ address: base.address, privateKey: '0x01' })
    );
  });

  it('uses one signer and legacy database key for repaired Ethereum address forms', () => {
    const body = 'abcdefabcdef1234567890abcdefabcdef123456';
    const canonical = `0x${body}`;
    const repeatedPrefix = `0X0x${body.toUpperCase()}`;
    const signer = { walletType: 'SCW' as const, chainId: 8453 };

    expect(signerIdentityKey({ address: repeatedPrefix, ...signer })).toBe(
      signerIdentityKey({ address: canonical, ...signer })
    );
    expect(getClientDbPath(repeatedPrefix, 'legacy-address')).toBe(
      `xmtp-production-${canonical}.db3`
    );
  });

  it('requests history for a new installation on an existing inbox only', () => {
    expect(
      shouldRequestHistorySync({ installationRegistered: true, existingInstallationCount: 1 })
    ).toBe(true);
    expect(
      shouldRequestHistorySync({ installationRegistered: true, existingInstallationCount: 0 })
    ).toBe(false);
    expect(
      shouldRequestHistorySync({
        installationRegistered: false,
        existingInstallationCount: 0,
        explicitlyRequested: true,
      })
    ).toBe(true);
  });

  it('retries only nonzero SCW chain mismatches', () => {
    expect(getScwRetryChainId('SCW', 8453, 1)).toBe(1);
    expect(getScwRetryChainId('SCW', 8453, 0)).toBeNull();
    expect(getScwRetryChainId('EOA', 8453, 1)).toBeNull();
  });
});
