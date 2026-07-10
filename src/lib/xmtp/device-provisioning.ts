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
  knownInstallationId?: string;
  onInstallationReady?: (installationId: string) => Promise<void> | void;
  onPhase?: (phase: DeviceProvisioningPhase) => Promise<void> | void;
  sleep?: (milliseconds: number) => Promise<void>;
}

export type DeviceProvisioningPhase =
  | 'preflight'
  | 'opening-manager'
  | 'manager-ready'
  | 'registering-installation'
  | 'installation-registered'
  | 'associating-key'
  | 'association-submitted'
  | 'verifying-association'
  | 'complete';

export interface ProvisionDeviceResult {
  inboxId: string;
  installationId: string;
  accountAdded: boolean;
  installationRegistered: boolean;
}

const normalizeId = (value: string | null | undefined) => value?.trim().toLowerCase() || null;

const normalizeInstallationId = (value: string | null | undefined) =>
  value?.trim().toLowerCase().replace(/^0x/, '') || null;

const installationIdsMatch = (left: string | null | undefined, right: string | null | undefined) =>
  normalizeInstallationId(left) === normalizeInstallationId(right);

const defaultSleep = async (milliseconds: number) =>
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

const isInstallationLimitLikeError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /too\s*many\s*installations|10\s*\/\s*10|installation limit|already registered 10/i.test(
    message
  );
};

async function waitForInboxAssociation(
  identifier: Identifier,
  expectedInboxId: string,
  resolveInboxId: ProvisionDeviceDependencies['resolveInboxId'],
  sleep: (milliseconds: number) => Promise<void>
): Promise<boolean> {
  for (let attempt = 0; attempt < 15; attempt += 1) {
    if (normalizeId(await resolveInboxId(identifier)) === expectedInboxId) {
      return true;
    }
    await sleep(Math.min(3_000, 250 * 2 ** attempt));
  }
  return false;
}

async function waitForInstallation(
  inboxId: string,
  installationId: string,
  fetchInboxState: ProvisionDeviceDependencies['fetchInboxState'],
  sleep: (milliseconds: number) => Promise<void>
): Promise<boolean> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const state = await fetchInboxState(inboxId);
    if (
      state?.installations?.some((installation) =>
        installationIdsMatch(installation.id, installationId)
      )
    ) {
      return true;
    }
    await sleep(Math.min(2_000, 250 * 2 ** attempt));
  }
  return false;
}

async function waitForAccountIdentifier(
  inboxId: string,
  identifier: Identifier,
  fetchInboxState: ProvisionDeviceDependencies['fetchInboxState'],
  sleep: (milliseconds: number) => Promise<void>
): Promise<boolean> {
  const expectedKind = identifier.identifierKind;
  const expectedIdentifier = identifier.identifier.trim().toLowerCase().replace(/^(?:0x)+/i, '');
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const state = await fetchInboxState(inboxId);
    if (
      state?.accountIdentifiers?.some(
        (candidate) =>
          candidate.identifierKind === expectedKind &&
          candidate.identifier.trim().toLowerCase().replace(/^(?:0x)+/i, '') ===
            expectedIdentifier
      )
    ) {
      return true;
    }
    await sleep(Math.min(2_000, 250 * 2 ** attempt));
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

export class StaleInstallationError extends Error {
  readonly inboxId: string;
  readonly installationId: string;

  constructor(inboxId: string, installationId: string) {
    super(
      `Interrupted browser installation ${installationId} is still registered for inbox ${inboxId}, but its local database now opens a different installation. Remove that interrupted installation before retrying.`
    );
    this.name = 'StaleInstallationError';
    this.inboxId = inboxId;
    this.installationId = installationId;
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
  const sleep = dependencies.sleep ?? defaultSleep;
  const notify = async (phase: DeviceProvisioningPhase) => {
    await dependencies.onPhase?.(phase);
  };

  await notify('preflight');
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

  const preflightState = await dependencies.fetchInboxState(expected);
  if (!preflightState) {
    throw new Error(
      'XMTP did not return the target inbox state, so Converge could not verify the installation limit.'
    );
  }
  const knownInstallationPresent = preflightState.installations?.some((installation) =>
    installationIdsMatch(installation.id, dependencies.knownInstallationId)
  );
  if (
    (preflightState.installations?.length ?? 0) >= XMTP_INSTALLATION_LIMIT &&
    !knownInstallationPresent
  ) {
    throw new InstallationLimitError(expected);
  }

  await notify('opening-manager');
  let manager: DeviceProvisioningClient;
  try {
    manager = await dependencies.createManager(targetSigner);
  } catch (error) {
    if (isInstallationLimitLikeError(error)) {
      throw new InstallationLimitError(expected);
    }
    throw error;
  }
  try {
    if (normalizeId(manager.inboxId) !== expected) {
      throw new Error('The wallet management client opened a different XMTP inbox.');
    }
    if (!manager.installationId) {
      throw new Error('XMTP did not create a local installation for this browser.');
    }
    if (
      dependencies.knownInstallationId &&
      !installationIdsMatch(manager.installationId, dependencies.knownInstallationId)
    ) {
      throw new Error(
        'XMTP opened a different local installation while resuming device setup. Registration was stopped.'
      );
    }
    await dependencies.onInstallationReady?.(manager.installationId);
    await notify('manager-ready');

    const state = await dependencies.fetchInboxState(expected);
    if (!state) {
      throw new Error(
        'XMTP did not return the target inbox state, so Converge could not verify the installation limit.'
      );
    }
    const installations = state.installations ?? [];
    const hasManagerInstallation = installations.some(
      (installation) => installationIdsMatch(installation.id, manager.installationId)
    );

    let installationRegistered = false;
    if (!hasManagerInstallation) {
      if (installations.length >= XMTP_INSTALLATION_LIMIT) {
        throw new InstallationLimitError(expected);
      }
      await notify('registering-installation');
      try {
        await manager.register();
      } catch (error) {
        if (isInstallationLimitLikeError(error)) {
          throw new InstallationLimitError(expected);
        }
        const stateAfterError = await dependencies.fetchInboxState(expected);
        const registrationSettled = stateAfterError?.installations?.some((installation) =>
          installationIdsMatch(installation.id, manager.installationId)
        );
        if (!registrationSettled) {
          throw error;
        }
        console.info(
          '[XMTP] Browser installation became visible while register() was settling; resuming device setup.'
        );
      }
      installationRegistered = true;
      if (!(await waitForInstallation(expected, manager.installationId, dependencies.fetchInboxState, sleep))) {
        throw new Error(
          'XMTP accepted the browser installation, but it is not visible on the identity ledger yet. Retry to resume this same installation.'
        );
      }
      await notify('installation-registered');
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
        await notify('associating-key');
        try {
          await manager.unsafe_addAccount(deviceSigner, true);
          accountAdded = true;
        } catch (error) {
          const resolvedAfterError = normalizeId(
            await manager.fetchInboxIdByIdentifier(deviceIdentifier)
          );
          if (resolvedAfterError !== expected) {
            throw error;
          }
          // The request response was interrupted, but the manager can already
          // observe the committed association. Treat it as submitted so the
          // independent static resolver must also converge before we continue.
          accountAdded = true;
          console.info(
            '[XMTP] Device key association became visible while the add-account request was settling; resuming verification.'
          );
        }
        await notify('association-submitted');
      }
    }

    await notify('verifying-association');
    const managerConfirmed = await waitForInboxAssociation(
      deviceIdentifier,
      expected,
      (identifier) => manager.fetchInboxIdByIdentifier(identifier),
      sleep
    );
    if (!managerConfirmed) {
      throw new Error('XMTP did not associate the new device key with the target inbox.');
    }
    if (
      accountAdded &&
      !(await waitForInboxAssociation(deviceIdentifier, expected, dependencies.resolveInboxId, sleep))
    ) {
      throw new Error(
        'XMTP accepted the new device key, but the association is not visible everywhere yet. Retry to finish setup with this same key.'
      );
    }
    if (!(await waitForAccountIdentifier(expected, deviceIdentifier, dependencies.fetchInboxState, sleep))) {
      throw new Error(
        'The device key resolves to the target inbox, but XMTP has not returned it in the inbox identity state yet. Retry to finish setup with this same key.'
      );
    }

    await notify('complete');
    return {
      inboxId: expected,
      installationId: manager.installationId,
      accountAdded,
      installationRegistered,
    };
  } finally {
    await manager.close();
    // The Browser SDK worker releases its OPFS/SQLite lock asynchronously.
    await sleep(350);
  }
}
