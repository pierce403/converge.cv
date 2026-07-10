import type { InboxState, Identifier, Signer } from '@xmtp/browser-sdk';
import { describe, expect, it, vi } from 'vitest';
import {
  completeProvisioning,
  getClientDbPath,
  getScwRetryChainId,
  InstallationMembershipPendingError,
  InstallationLimitError,
  planClientInstallation,
  provisionFreshDeviceKey,
  provisionWithStaleInstallationRecovery,
  ReassignmentRequiredError,
  recordInstallationReady,
  shouldRequestHistorySync,
  signerIdentityKey,
  StaleLocalInstallationError,
  type DeviceProvisioningClient,
} from './device-provisioning';

const targetInbox = 'a'.repeat(64);
const otherInbox = 'b'.repeat(64);
const targetIdentifier = {
  identifier: `0x${'11'.repeat(20)}`,
  identifierKind: 0,
} as Identifier;
const deviceIdentifier = {
  identifier: `0x${'22'.repeat(20)}`,
  identifierKind: 0,
} as Identifier;

const signer = (identifier: Identifier): Signer => ({
  type: 'EOA',
  getIdentifier: () => identifier,
  signMessage: async () => new Uint8Array([1]),
});

function setup(options?: {
  deviceInbox?: string;
  installationIds?: string[];
  omitInboxState?: boolean;
  locallyRegistered?: boolean;
  registerNoop?: boolean;
  staticInstallationStaysStale?: boolean;
  staticInstallationVisibleAfter?: number;
  registerThrowsAfterMutation?: boolean;
  addAccountThrowsAfterMutation?: boolean;
  addAccountMissingExistingMemberAttempts?: number;
  addAccountError?: Error;
  targetIsCurrentAuthority?: boolean;
}) {
  let associatedDeviceInbox = options?.deviceInbox;
  let associatedIdentifier = deviceIdentifier;
  const installationIds = [...(options?.installationIds ?? [])];
  let locallyRegistered =
    options?.locallyRegistered ?? installationIds.includes('installation-new');
  let delayedVisibilityReads = 0;
  let registrationCanBecomeVisible = locallyRegistered;
  const events: string[] = [];
  let addAccountAttempts = 0;
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
  const addAccount = vi.fn(async (newSigner: Signer) => {
    addAccountAttempts += 1;
    if (
      options?.addAccountMissingExistingMemberAttempts !== undefined &&
      addAccountAttempts <= options.addAccountMissingExistingMemberAttempts
    ) {
      throw new Error('Missing existing member');
    }
    if (options?.addAccountError) {
      throw options.addAccountError;
    }
    events.push('add-account');
    associatedIdentifier = await newSigner.getIdentifier();
    associatedDeviceInbox = targetInbox;
    if (options?.addAccountThrowsAfterMutation) {
      throw new Error('association response was interrupted');
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
    unsafe_addAccount: addAccount,
    fetchInboxIdByIdentifier: vi.fn(async () => associatedDeviceInbox),
    close,
  };
  const resolveInboxId = vi.fn(async (identifier: Identifier) =>
    identifier.identifier.toLowerCase() === targetIdentifier.identifier.toLowerCase()
      ? targetInbox
      : associatedDeviceInbox
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
            ...(associatedDeviceInbox === targetInbox ? [associatedIdentifier] : []),
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
    addAccount,
    close,
    events,
    dependencies: { resolveInboxId, fetchInboxState, createManager, sleep },
  };
}

describe('fresh device provisioning', () => {
  it('replaces one stale local installation without changing the staged key flow', async () => {
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

  it('registers the replacement installation before associating the preserved device key', async () => {
    const staleHarness = setup({
      locallyRegistered: true,
      staticInstallationStaysStale: true,
    });
    staleHarness.manager.installationId = 'installation-stale';
    const replacementHarness = setup();
    replacementHarness.manager.installationId = 'installation-replacement';
    const target = signer(targetIdentifier);
    const device = signer(deviceIdentifier);
    let attempt = 0;
    const provision = async (knownInstallationId?: string) => {
      const harness = attempt++ === 0 ? staleHarness : replacementHarness;
      return await provisionFreshDeviceKey(target, device, targetInbox, {
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
    expect(staleHarness.addAccount).not.toHaveBeenCalled();
    expect(replacementHarness.register).toHaveBeenCalledOnce();
    expect(replacementHarness.addAccount).toHaveBeenCalledOnce();
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
      return await provisionFreshDeviceKey(
        signer(targetIdentifier),
        signer(deviceIdentifier),
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

  it('registers one target-inbox installation before adding a fresh device key', async () => {
    const harness = setup();

    const result = await provisionFreshDeviceKey(
      signer(targetIdentifier),
      signer(deviceIdentifier),
      targetInbox,
      harness.dependencies
    );

    expect(result).toEqual({
      inboxId: targetInbox,
      installationId: 'installation-new',
      accountAdded: true,
      installationRegistered: true,
    });
    expect(harness.register).toHaveBeenCalledTimes(1);
    expect(harness.addAccount).toHaveBeenCalledWith(expect.any(Object), true);
    expect(harness.register.mock.invocationCallOrder[0]).toBeLessThan(
      harness.addAccount.mock.invocationCallOrder[0]
    );
    expect(harness.close).toHaveBeenCalledTimes(1);
  });

  it('reports lifecycle phases and persists the manager installation before mutation', async () => {
    const harness = setup();
    const phases: string[] = [];
    const onInstallationReady = vi.fn(async () => undefined);

    await provisionFreshDeviceKey(
      signer(targetIdentifier),
      signer(deviceIdentifier),
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
      'associating-key',
      'association-submitted',
      'verifying-association',
      'complete',
    ]);
  });

  it('reuses the same installation and association after reload', async () => {
    const harness = setup({
      deviceInbox: targetInbox,
      installationIds: ['installation-new'],
    });

    const result = await provisionFreshDeviceKey(
      signer(targetIdentifier),
      signer(deviceIdentifier),
      targetInbox,
      harness.dependencies
    );

    expect(result.installationRegistered).toBe(false);
    expect(result.accountAdded).toBe(false);
    expect(harness.register).not.toHaveBeenCalled();
    expect(harness.addAccount).not.toHaveBeenCalled();
  });

  it('allows two distinct device keys to resolve to one inbox with distinct installations', async () => {
    const first = setup();
    first.manager.installationId = 'installation-device-a';
    const second = setup();
    second.manager.installationId = 'installation-device-b';

    const [firstResult, secondResult] = await Promise.all([
      provisionFreshDeviceKey(
        signer(targetIdentifier),
        signer(deviceIdentifier),
        targetInbox,
        first.dependencies
      ),
      provisionFreshDeviceKey(
        signer(targetIdentifier),
        signer({ identifier: `0x${'33'.repeat(20)}`, identifierKind: 0 } as Identifier),
        targetInbox,
        second.dependencies
      ),
    ]);

    expect(firstResult.inboxId).toBe(targetInbox);
    expect(secondResult.inboxId).toBe(targetInbox);
    expect(firstResult.installationId).not.toBe(secondResult.installationId);
  });

  it('retries association visibility before reporting success', async () => {
    const harness = setup();
    const fetchAssociation = harness.manager.fetchInboxIdByIdentifier as ReturnType<typeof vi.fn>;
    fetchAssociation
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValue(targetInbox);

    const result = await provisionFreshDeviceKey(
      signer(targetIdentifier),
      signer(deviceIdentifier),
      targetInbox,
      harness.dependencies
    );

    expect(result.accountAdded).toBe(true);
    expect(fetchAssociation.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('waits beyond the old eight-attempt window for network association visibility', async () => {
    const harness = setup();
    let deviceNetworkLookups = 0;
    harness.dependencies.resolveInboxId = vi.fn(async (identifier: Identifier) => {
      if (identifier.identifier.toLowerCase() === targetIdentifier.identifier.toLowerCase()) {
        return targetInbox;
      }
      deviceNetworkLookups += 1;
      return deviceNetworkLookups >= 11 ? targetInbox : undefined;
    });

    const result = await provisionFreshDeviceKey(
      signer(targetIdentifier),
      signer(deviceIdentifier),
      targetInbox,
      harness.dependencies
    );

    expect(result.accountAdded).toBe(true);
    expect(deviceNetworkLookups).toBeGreaterThan(8);
  });

  it('blocks at 10 installations before registration or association', async () => {
    const harness = setup({ installationIds: Array.from({ length: 10 }, (_, i) => `i-${i}`) });

    await expect(
      provisionFreshDeviceKey(
        signer(targetIdentifier),
        signer(deviceIdentifier),
        targetInbox,
        harness.dependencies
      )
    ).rejects.toBeInstanceOf(InstallationLimitError);

    expect(harness.register).not.toHaveBeenCalled();
    expect(harness.addAccount).not.toHaveBeenCalled();
    expect(harness.dependencies.createManager).not.toHaveBeenCalled();
  });

  it('resumes its already-registered installation when the inbox is otherwise full', async () => {
    const installationIds = [
      'installation-new',
      ...Array.from({ length: 9 }, (_, index) => `other-${index}`),
    ];
    const harness = setup({ deviceInbox: targetInbox, installationIds });

    const result = await provisionFreshDeviceKey(
      signer(targetIdentifier),
      signer(deviceIdentifier),
      targetInbox,
      {
        ...harness.dependencies,
        knownInstallationId: '0X0xinstallation-new',
      }
    );

    expect(result.installationRegistered).toBe(false);
    expect(harness.register).not.toHaveBeenCalled();
  });

  it('maps SDK installation-limit failures during manager creation to the recoverable error', async () => {
    const harness = setup({
      installationIds: Array.from({ length: 9 }, (_, index) => `existing-${index}`),
    });
    harness.dependencies.createManager = vi.fn(async () => {
      throw new Error('TooManyInstallations');
    });

    await expect(
      provisionFreshDeviceKey(
        signer(targetIdentifier),
        signer(deviceIdentifier),
        targetInbox,
        harness.dependencies
      )
    ).rejects.toBeInstanceOf(InstallationLimitError);
  });

  it('resumes when register throws after the manager becomes locally registered', async () => {
    const harness = setup({
      registerThrowsAfterMutation: true,
      staticInstallationVisibleAfter: 3,
    });

    const result = await provisionFreshDeviceKey(
      signer(targetIdentifier),
      signer(deviceIdentifier),
      targetInbox,
      harness.dependencies
    );

    expect(result.installationRegistered).toBe(true);
    expect(result.accountAdded).toBe(true);
    expect(harness.manager.isRegistered).toHaveBeenCalled();
  });

  it('waits until the manager installation is a published inbox member before association', async () => {
    const harness = setup({ staticInstallationVisibleAfter: 3 });

    const result = await provisionFreshDeviceKey(
      signer(targetIdentifier),
      signer(deviceIdentifier),
      targetInbox,
      harness.dependencies
    );

    expect(result.installationRegistered).toBe(true);
    expect(result.accountAdded).toBe(true);
    expect(harness.manager.isRegistered).toHaveBeenCalled();
    expect(harness.register).toHaveBeenCalledOnce();
    expect(harness.dependencies.fetchInboxState.mock.calls.length).toBeGreaterThan(3);
    expect(harness.events.indexOf('installation-visible')).toBeLessThan(
      harness.events.indexOf('add-account')
    );
  });

  it('stops after bounded association retries when fresh membership never propagates', async () => {
    const harness = setup({
      staticInstallationStaysStale: true,
      addAccountMissingExistingMemberAttempts: 8,
    });

    await expect(
      provisionFreshDeviceKey(
        signer(targetIdentifier),
        signer(deviceIdentifier),
        targetInbox,
        harness.dependencies
      )
    ).rejects.toBeInstanceOf(InstallationMembershipPendingError);

    expect(harness.register).toHaveBeenCalledOnce();
    expect(harness.addAccount).toHaveBeenCalledTimes(8);
  });

  it('retries Missing existing member with the same fresh installation', async () => {
    const harness = setup({
      staticInstallationStaysStale: true,
      addAccountMissingExistingMemberAttempts: 2,
    });

    const result = await provisionFreshDeviceKey(
      signer(targetIdentifier),
      signer(deviceIdentifier),
      targetInbox,
      harness.dependencies
    );

    expect(result.installationRegistered).toBe(true);
    expect(result.accountAdded).toBe(true);
    expect(harness.register).toHaveBeenCalledOnce();
    expect(harness.addAccount).toHaveBeenCalledTimes(3);
  });

  it('resumes a locally registered installation after static membership catches up', async () => {
    const harness = setup({
      locallyRegistered: true,
      staticInstallationVisibleAfter: 3,
    });

    const result = await provisionFreshDeviceKey(
      signer(targetIdentifier),
      signer(deviceIdentifier),
      targetInbox,
      {
        ...harness.dependencies,
        knownInstallationId: 'installation-new',
      }
    );

    expect(result.installationRegistered).toBe(false);
    expect(result.accountAdded).toBe(true);
    expect(harness.register).not.toHaveBeenCalled();
  });

  it('does not trust local registration while the installation is absent from the inbox ledger', async () => {
    const harness = setup({
      locallyRegistered: true,
      staticInstallationStaysStale: true,
    });

    await expect(
      provisionFreshDeviceKey(
        signer(targetIdentifier),
        signer(deviceIdentifier),
        targetInbox,
        {
          ...harness.dependencies,
          knownInstallationId: 'installation-new',
        }
      )
    ).rejects.toBeInstanceOf(StaleLocalInstallationError);

    expect(harness.register).not.toHaveBeenCalled();
    expect(harness.addAccount).not.toHaveBeenCalled();
  });

  it('fails closed when register returns but the local installation remains unregistered', async () => {
    const harness = setup({ registerNoop: true });

    await expect(
      provisionFreshDeviceKey(
        signer(targetIdentifier),
        signer(deviceIdentifier),
        targetInbox,
        harness.dependencies
      )
    ).rejects.toThrow('not registered in its local XMTP database');

    expect(harness.register).toHaveBeenCalledOnce();
    expect(harness.addAccount).not.toHaveBeenCalled();
  });

  it('does not retry unrelated add-account failures', async () => {
    const harness = setup({ addAccountError: new Error('signature rejected') });

    await expect(
      provisionFreshDeviceKey(
        signer(targetIdentifier),
        signer(deviceIdentifier),
        targetInbox,
        harness.dependencies
      )
    ).rejects.toThrow('signature rejected');

    expect(harness.addAccount).toHaveBeenCalledOnce();
  });

  it('resumes verification when add-account throws after the association reaches the ledger', async () => {
    const harness = setup({ addAccountThrowsAfterMutation: true });

    const result = await provisionFreshDeviceKey(
      signer(targetIdentifier),
      signer(deviceIdentifier),
      targetInbox,
      harness.dependencies
    );

    expect(result.inboxId).toBe(targetInbox);
    expect(result.accountAdded).toBe(true);
    expect(harness.dependencies.resolveInboxId).toHaveBeenCalledWith(deviceIdentifier);
  });

  it('does not finish an interrupted add-account until the independent resolver sees it', async () => {
    const harness = setup({ addAccountThrowsAfterMutation: true });
    harness.dependencies.resolveInboxId = vi.fn(async (identifier: Identifier) =>
      identifier.identifier.toLowerCase() === targetIdentifier.identifier.toLowerCase()
        ? targetInbox
        : undefined
    );

    await expect(
      provisionFreshDeviceKey(
        signer(targetIdentifier),
        signer(deviceIdentifier),
        targetInbox,
        harness.dependencies
      )
    ).rejects.toThrow('association is not visible everywhere yet');

    const deviceLookups = harness.dependencies.resolveInboxId.mock.calls.filter(
      ([identifier]) => identifier.identifier === deviceIdentifier.identifier
    );
    expect(deviceLookups.length).toBeGreaterThan(1);
  });

  it('fails closed when target inbox capacity cannot be fetched', async () => {
    const harness = setup({ omitInboxState: true });

    await expect(
      provisionFreshDeviceKey(
        signer(targetIdentifier),
        signer(deviceIdentifier),
        targetInbox,
        harness.dependencies
      )
    ).rejects.toThrow('could not verify the installation limit');

    expect(harness.register).not.toHaveBeenCalled();
    expect(harness.addAccount).not.toHaveBeenCalled();
  });

  it('requires the approving wallet to remain a current inbox authority', async () => {
    const harness = setup({ targetIsCurrentAuthority: false });

    await expect(
      provisionFreshDeviceKey(
        signer(targetIdentifier),
        signer(deviceIdentifier),
        targetInbox,
        harness.dependencies
      )
    ).rejects.toThrow(/not a current account or recovery authority/i);

    expect(harness.dependencies.createManager).not.toHaveBeenCalled();
    expect(harness.register).not.toHaveBeenCalled();
    expect(harness.addAccount).not.toHaveBeenCalled();
  });

  it('refuses to reassign a key that already belongs to another inbox', async () => {
    const harness = setup({ deviceInbox: otherInbox });

    await expect(
      provisionFreshDeviceKey(
        signer(targetIdentifier),
        signer(deviceIdentifier),
        targetInbox,
        harness.dependencies
      )
    ).rejects.toBeInstanceOf(ReassignmentRequiredError);

    expect(harness.dependencies.createManager).not.toHaveBeenCalled();
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

  it('keeps failed history requests pending and records successful requests', () => {
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
    expect(succeeded.needsHistorySync).toBe(false);
    expect(succeeded.historySyncRequestedAt).toBe(1234);
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
