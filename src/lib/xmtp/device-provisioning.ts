import type { InboxState, Identifier, Signer } from '@xmtp/browser-sdk';
import type { Identity } from '@/types';

export const XMTP_INSTALLATION_LIMIT = 10;

export type XmtpDbPathMode = 'legacy-address' | 'inbox-default';

export interface DeviceProvisioningClient {
  inboxId?: string;
  installationId?: string;
  register(): Promise<unknown>;
  unsafe_addAccount(signer: Signer, allowInboxReassign: boolean): Promise<unknown>;
  fetchInboxIdByIdentifier(identifier: Identifier): Promise<string | undefined>;
  close(): Promise<unknown> | void;
}

export interface ProvisionDeviceDependencies {
  resolveInboxId(identifier: Identifier): Promise<string | undefined>;
  fetchInboxState(inboxId: string): Promise<InboxState | undefined>;
  createManager(signer: Signer): Promise<DeviceProvisioningClient>;
}

export interface ProvisionDeviceResult {
  inboxId: string;
  installationId: string;
  accountAdded: boolean;
  installationRegistered: boolean;
}

const normalizeId = (value: string | null | undefined) => value?.trim().toLowerCase() || null;

async function waitForInboxAssociation(
  identifier: Identifier,
  expectedInboxId: string,
  resolveInboxId: ProvisionDeviceDependencies['resolveInboxId']
): Promise<boolean> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (normalizeId(await resolveInboxId(identifier)) === expectedInboxId) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
  }
  return false;
}

export function signerIdentityKey(identity: {
  address: string;
  privateKey?: string;
  walletType?: 'EOA' | 'SCW';
  chainId?: number;
}): string {
  const signerSource = identity.privateKey ? 'local' : 'wallet';
  const walletType = identity.privateKey ? 'EOA' : identity.walletType ?? 'EOA';
  const chainId = walletType === 'SCW' ? identity.chainId ?? 1 : 0;
  return `${identity.address.toLowerCase()}|${signerSource}|${walletType}|${chainId}`;
}

export function getClientDbPath(
  address: string,
  mode: XmtpDbPathMode | undefined
): string | undefined {
  if (mode === 'inbox-default') {
    return undefined;
  }
  return `xmtp-production-${address.toLowerCase()}.db3`;
}

export function shouldRequestHistorySync(input: {
  installationRegistered: boolean;
  existingInstallationCount: number;
  explicitlyRequested?: boolean;
}): boolean {
  return Boolean(
    input.explicitlyRequested ||
      (input.installationRegistered && input.existingInstallationCount > 0)
  );
}

export function planClientInstallation(input: {
  inboxId: string;
  hasCurrentInstallation: boolean;
  existingInstallationCount: number;
}): { registerInstallation: boolean; requestHistoryAfterRegistration: boolean } {
  if (input.hasCurrentInstallation) {
    return { registerInstallation: false, requestHistoryAfterRegistration: false };
  }
  if (input.existingInstallationCount >= XMTP_INSTALLATION_LIMIT) {
    throw new InstallationLimitError(input.inboxId);
  }
  return {
    registerInstallation: true,
    requestHistoryAfterRegistration: input.existingInstallationCount > 0,
  };
}

export function getScwRetryChainId(
  walletType: 'EOA' | 'SCW' | undefined,
  currentChainId: number | undefined,
  initiallyAddedWith: number
): number | null {
  if (walletType !== 'SCW' || initiallyAddedWith === 0 || currentChainId === initiallyAddedWith) {
    return null;
  }
  return initiallyAddedWith;
}

export function recordInstallationReady(
  identity: Identity,
  result: { inboxId: string; installationId: string }
): Identity {
  const inboxId = normalizeId(result.inboxId) ?? result.inboxId;
  return {
    ...identity,
    inboxId,
    installationId: result.installationId,
    expectedInboxId: identity.expectedInboxId ?? inboxId,
  };
}

export function completeProvisioning(
  identity: Identity,
  result: { inboxId: string; installationId: string; historySyncRequested: boolean },
  completedAt = Date.now()
): Identity {
  const ready = recordInstallationReady(identity, result);
  return {
    ...ready,
    provisioningPending: false,
    needsHistorySync: result.historySyncRequested ? false : ready.needsHistorySync,
    historySyncRequestedAt: result.historySyncRequested
      ? completedAt
      : ready.historySyncRequestedAt,
  };
}

export class InstallationLimitError extends Error {
  readonly inboxId: string;

  constructor(inboxId: string) {
    super(
      `Installation limit reached (10/10) for inbox ${inboxId}. Revoke an old installation before adding this device.`
    );
    this.name = 'InstallationLimitError';
    this.inboxId = inboxId;
  }
}

export class ReassignmentRequiredError extends Error {
  readonly existingInboxId: string;
  readonly targetInboxId: string;

  constructor(existingInboxId: string, targetInboxId: string) {
    super(
      `This key already belongs to inbox ${existingInboxId}. Converge will not move it to ${targetInboxId} because that would strand its previous inbox.`
    );
    this.name = 'ReassignmentRequiredError';
    this.existingInboxId = existingInboxId;
    this.targetInboxId = targetInboxId;
  }
}

/**
 * Bootstrap one browser installation with wallet authority, then associate a fresh
 * local account key with the same inbox. The manager and final local-key client must
 * use the SDK's inbox-based default database path so they share one installation.
 */
export async function provisionFreshDeviceKey(
  targetSigner: Signer,
  deviceSigner: Signer,
  expectedInboxId: string,
  dependencies: ProvisionDeviceDependencies
): Promise<ProvisionDeviceResult> {
  const targetIdentifier = await targetSigner.getIdentifier();
  const deviceIdentifier = await deviceSigner.getIdentifier();
  const expected = normalizeId(expectedInboxId);
  const resolvedTarget = normalizeId(await dependencies.resolveInboxId(targetIdentifier));

  if (!expected || !resolvedTarget || resolvedTarget !== expected) {
    throw new Error('The connected wallet no longer resolves to the selected XMTP inbox.');
  }

  const existingDeviceInbox = normalizeId(await dependencies.resolveInboxId(deviceIdentifier));
  if (existingDeviceInbox && existingDeviceInbox !== expected) {
    throw new ReassignmentRequiredError(existingDeviceInbox, expected);
  }

  const manager = await dependencies.createManager(targetSigner);
  try {
    if (normalizeId(manager.inboxId) !== expected) {
      throw new Error('The wallet management client opened a different XMTP inbox.');
    }
    if (!manager.installationId) {
      throw new Error('XMTP did not create a local installation for this browser.');
    }

    const state = await dependencies.fetchInboxState(expected);
    if (!state) {
      throw new Error(
        'XMTP did not return the target inbox state, so Converge could not verify the installation limit.'
      );
    }
    const installations = state.installations ?? [];
    const hasManagerInstallation = installations.some(
      (installation) => installation.id === manager.installationId
    );

    let installationRegistered = false;
    if (!hasManagerInstallation) {
      if (installations.length >= XMTP_INSTALLATION_LIMIT) {
        throw new InstallationLimitError(expected);
      }
      await manager.register();
      installationRegistered = true;
    }

    let accountAdded = false;
    if (!existingDeviceInbox) {
      const managerResolved = normalizeId(
        await manager.fetchInboxIdByIdentifier(deviceIdentifier)
      );
      if (managerResolved) {
        if (managerResolved !== expected) {
          throw new ReassignmentRequiredError(managerResolved, expected);
        }
      } else {
        // The SDK requires this acknowledgement even for an unregistered key. The
        // two ledger checks above guarantee that this call is not a reassignment.
        await manager.unsafe_addAccount(deviceSigner, true);
        accountAdded = true;
      }
    }

    const managerConfirmed = await waitForInboxAssociation(
      deviceIdentifier,
      expected,
      (identifier) => manager.fetchInboxIdByIdentifier(identifier)
    );
    if (!managerConfirmed) {
      throw new Error('XMTP did not associate the new device key with the target inbox.');
    }
    if (
      accountAdded &&
      !(await waitForInboxAssociation(deviceIdentifier, expected, dependencies.resolveInboxId))
    ) {
      throw new Error('The new device key association is not visible on the XMTP identity ledger yet.');
    }

    return {
      inboxId: expected,
      installationId: manager.installationId,
      accountAdded,
      installationRegistered,
    };
  } finally {
    await manager.close();
  }
}
