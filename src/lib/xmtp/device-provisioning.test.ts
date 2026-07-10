import type { InboxState, Identifier, Signer } from '@xmtp/browser-sdk';
import { describe, expect, it, vi } from 'vitest';
import {
  completeProvisioning,
  getClientDbPath,
  getScwRetryChainId,
  InstallationLimitError,
  planClientInstallation,
  provisionFreshDeviceKey,
  ReassignmentRequiredError,
  recordInstallationReady,
  shouldRequestHistorySync,
  signerIdentityKey,
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
  registerThrowsAfterMutation?: boolean;
  addAccountThrowsAfterMutation?: boolean;
}) {
  let associatedDeviceInbox = options?.deviceInbox;
  let associatedIdentifier = deviceIdentifier;
  const installationIds = [...(options?.installationIds ?? [])];
  const register = vi.fn(async () => {
    if (!installationIds.includes(manager.installationId!)) {
      installationIds.push(manager.installationId!);
    }
    if (options?.registerThrowsAfterMutation) {
      throw new Error('registration response was interrupted');
    }
  });
  const addAccount = vi.fn(async (newSigner: Signer) => {
    associatedIdentifier = await newSigner.getIdentifier();
    associatedDeviceInbox = targetInbox;
    if (options?.addAccountThrowsAfterMutation) {
      throw new Error('association response was interrupted');
    }
  });
  const close = vi.fn(async () => undefined);
  const manager: DeviceProvisioningClient = {
    inboxId: targetInbox,
    installationId: 'installation-new',
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
  const fetchInboxState = vi.fn(async () =>
    options?.omitInboxState
      ? undefined
      : ({
          inboxId: targetInbox,
          installations: installationIds.map((id) => ({ id })),
          accountIdentifiers: [
            targetIdentifier,
            ...(associatedDeviceInbox === targetInbox ? [associatedIdentifier] : []),
          ],
        } as InboxState)
  );
  const createManager = vi.fn(async () => manager);
  const sleep = vi.fn(async () => undefined);

  return {
    manager,
    register,
    addAccount,
    close,
    dependencies: { resolveInboxId, fetchInboxState, createManager, sleep },
  };
}

describe('fresh device provisioning', () => {
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
        knownInstallationId: '0xinstallation-new',
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

  it('resumes when register throws after the installation reaches the ledger', async () => {
    const harness = setup({ registerThrowsAfterMutation: true });

    const result = await provisionFreshDeviceKey(
      signer(targetIdentifier),
      signer(deviceIdentifier),
      targetInbox,
      harness.dependencies
    );

    expect(result.installationRegistered).toBe(true);
    expect(result.accountAdded).toBe(true);
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
      signerIdentityKey({ address: base.address, privateKey: '0x01' })
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
