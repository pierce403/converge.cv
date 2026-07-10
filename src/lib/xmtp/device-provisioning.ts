import type { InboxState, Identifier, Signer } from '@xmtp/browser-sdk';
import type { Identity } from '@/types';
import { normalizeEthereumAddress } from '@/lib/utils/ethereum';

export const XMTP_INSTALLATION_LIMIT = 10;

export type XmtpDbPathMode = 'legacy-address' | 'inbox-default';

export interface DeviceProvisioningClient {
  inboxId?: string;
  installationId?: string;
  preferences: {
    fetchInboxState(): Promise<InboxState>;
  };
  isRegistered(): Promise<boolean>;
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
  | 'verifying-installation'
  | 'repairing-installation'
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
  value?.trim().replace(/^(?:0x)+/i, '').toLowerCase() || null;

const installationIdsMatch = (left: string | null | undefined, right: string | null | undefined) => {
  const normalizedLeft = normalizeInstallationId(left);
  const normalizedRight = normalizeInstallationId(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
};

const identifiersMatch = (left: Identifier, right: Identifier) =>
  left.identifierKind === right.identifierKind &&
  left.identifier.trim().toLowerCase().replace(/^(?:0x)+/i, '') ===
    right.identifier.trim().toLowerCase().replace(/^(?:0x)+/i, '');

const stateHasIdentifier = (state: InboxState | undefined, identifier: Identifier) =>
  Boolean(
    state &&
      (state.accountIdentifiers?.some((candidate) => identifiersMatch(candidate, identifier)) ||
        (state.recoveryIdentifier && identifiersMatch(state.recoveryIdentifier, identifier)))
  );

const stateHasInstallation = (
  state: InboxState | undefined,
  installationId: string | null | undefined
) =>
  Boolean(
    state?.installations?.some((installation) =>
      installationIdsMatch(installation.id, installationId)
    )
  );

const defaultSleep = async (milliseconds: number) =>
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

const INSTALLATION_MEMBERSHIP_ATTEMPTS = 6;
const ADD_ACCOUNT_MEMBERSHIP_ATTEMPTS = 8;

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

async function waitForLocalRegistration(
  manager: DeviceProvisioningClient,
  sleep: (milliseconds: number) => Promise<void>
): Promise<boolean> {
  for (let attempt = 0; attempt < INSTALLATION_MEMBERSHIP_ATTEMPTS; attempt += 1) {
    if (await manager.isRegistered()) {
      return true;
    }
    await sleep(Math.min(2_000, 250 * 2 ** attempt));
  }
  return false;
}

async function waitForInstallationMembership(
  inboxId: string,
  installationId: string,
  manager: DeviceProvisioningClient,
  fetchInboxState: ProvisionDeviceDependencies['fetchInboxState'],
  sleep: (milliseconds: number) => Promise<void>
): Promise<boolean> {
  for (let attempt = 0; attempt < INSTALLATION_MEMBERSHIP_ATTEMPTS; attempt += 1) {
    try {
      if (stateHasInstallation(await manager.preferences.fetchInboxState(), installationId)) {
        return true;
      }
    } catch (error) {
      console.warn('[XMTP] Manager could not refresh its inbox state', {
        inboxId,
        installationId,
        attempt: attempt + 1,
        error,
      });
    }
    try {
      if (stateHasInstallation(await fetchInboxState(inboxId), installationId)) {
        return true;
      }
    } catch (error) {
      console.warn('[XMTP] Independent inbox-state refresh failed', {
        inboxId,
        installationId,
        attempt: attempt + 1,
        error,
      });
    }
    if (attempt < INSTALLATION_MEMBERSHIP_ATTEMPTS - 1) {
      await sleep(Math.min(3_000, 250 * 2 ** attempt));
    }
  }
  return false;
}

const isMissingExistingMemberError = (error: unknown) =>
  /missing existing member/i.test(error instanceof Error ? error.message : String(error ?? ''));

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
  const address = normalizeEthereumAddress(identity.address) ?? identity.address.trim().toLowerCase();
  const signerSource = identity.privateKey ? 'local' : 'wallet';
  const walletType = identity.privateKey ? 'EOA' : identity.walletType ?? 'EOA';
  const chainId = walletType === 'SCW' ? identity.chainId ?? 'unknown' : 0;
  return `${address}|${signerSource}|${walletType}|${chainId}`;
}

export function getClientDbPath(
  address: string,
  mode: XmtpDbPathMode | undefined
): string | undefined {
  if (mode === 'inbox-default') {
    return undefined;
  }
  const normalizedAddress = normalizeEthereumAddress(address) ?? address.trim().toLowerCase();
  return `xmtp-production-${normalizedAddress}.db3`;
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

export class InstallationMembershipPendingError extends Error {
  readonly inboxId: string;
  readonly installationId: string;

  constructor(inboxId: string, installationId: string) {
    super(
      `XMTP has not propagated browser installation ${installationId} far enough to authorize the local account key. Converge kept the same account key and did not reassign it. Retry Add This Device; if this installation remains absent, Converge will replace only its pending local XMTP database.`
    );
    this.name = 'InstallationMembershipPendingError';
    this.inboxId = inboxId;
    this.installationId = installationId;
  }
}

export class StaleLocalInstallationError extends Error {
  readonly inboxId: string;
  readonly installationId: string;

  constructor(inboxId: string, installationId: string) {
    super(
      `Saved browser installation ${installationId} is locally ready but is not a current member of inbox ${inboxId}. Its pending XMTP database must be replaced before device setup can continue.`
    );
    this.name = 'StaleLocalInstallationError';
    this.inboxId = inboxId;
    this.installationId = installationId;
  }
}

export async function provisionWithStaleInstallationRecovery<T>(
  knownInstallationId: string | undefined,
  provision: (resumeInstallationId?: string) => Promise<T>,
  reset: (error: StaleLocalInstallationError) => Promise<void>
): Promise<T> {
  try {
    return await provision(knownInstallationId);
  } catch (error) {
    if (!(error instanceof StaleLocalInstallationError)) {
      throw error;
    }
    await reset(error);
    // Recover exactly once; a replacement failure must remain visible rather
    // than creating installation churn.
    return await provision(undefined);
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
  if (!stateHasIdentifier(preflightState, targetIdentifier)) {
    throw new Error(
      'The connected wallet resolves to this XMTP inbox, but it is not a current account or recovery authority. Use a wallet that currently controls the inbox.'
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
    const managerAlreadyRegistered = await manager.isRegistered();
    console.info('[XMTP] Device manager installation check', {
      inboxId: expected,
      installationId: manager.installationId,
      knownInstallationId: dependencies.knownInstallationId ?? null,
      locallyRegistered: managerAlreadyRegistered,
      visibleInstallationIds: installations.map((installation) => installation.id),
    });

    let installationRegistered = false;
    let installationVisible = hasManagerInstallation;
    if (managerAlreadyRegistered && !installationVisible) {
      await notify('verifying-installation');
      installationVisible = await waitForInstallationMembership(
        expected,
        manager.installationId,
        manager,
        dependencies.fetchInboxState,
        sleep
      );
      if (!installationVisible) {
        // isRegistered() only reflects the persisted local identity. Reopening a
        // revoked or interrupted database reports true even when its installation
        // is absent from the network and register() cannot republish it.
        throw new StaleLocalInstallationError(expected, manager.installationId);
      }
    }

    if (!managerAlreadyRegistered) {
      if (installations.length >= XMTP_INSTALLATION_LIMIT && !hasManagerInstallation) {
        throw new InstallationLimitError(expected);
      }
      await notify('registering-installation');
      try {
        await manager.register();
      } catch (error) {
        if (isInstallationLimitLikeError(error)) {
          throw new InstallationLimitError(expected);
        }
        const registrationSettled = await manager.isRegistered();
        if (!registrationSettled) {
          throw error;
        }
        console.info(
          '[XMTP] Browser installation became locally registered while register() was settling; resuming device setup.'
        );
      }
      installationRegistered = !hasManagerInstallation;
      if (!(await waitForLocalRegistration(manager, sleep))) {
        throw new Error(
          'XMTP registration returned, but this browser installation is not registered in its local XMTP database. Retry to resume this same installation.'
        );
      }
      await notify('installation-registered');
    }

    if (!installationVisible) {
      await notify('verifying-installation');
      installationVisible = await waitForInstallationMembership(
        expected,
        manager.installationId,
        manager,
        dependencies.fetchInboxState,
        sleep
      );
    }
    if (!installationVisible) {
      console.info('[XMTP] Installation is not visible to inbox-state readers yet', {
        inboxId: expected,
        installationId: manager.installationId,
        locallyRegistered: await manager.isRegistered(),
      });
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
        for (let attempt = 0; attempt < ADD_ACCOUNT_MEMBERSHIP_ATTEMPTS; attempt += 1) {
          try {
            await manager.unsafe_addAccount(deviceSigner, true);
            accountAdded = true;
            // Server acceptance proves that the current installation was accepted
            // as an existing member even if a separate state reader is behind.
            installationVisible = true;
            break;
          } catch (error) {
            const resolvedAfterError = normalizeId(
              await manager.fetchInboxIdByIdentifier(deviceIdentifier)
            );
            if (resolvedAfterError === expected) {
              // The request response was interrupted, but the manager can already
              // observe the committed association. Treat it as submitted so the
              // independent static resolver must also converge before we continue.
              accountAdded = true;
              installationVisible = true;
              console.info(
                '[XMTP] Device key association became visible while the add-account request was settling; resuming verification.'
              );
              break;
            }
            if (!isMissingExistingMemberError(error)) {
              throw error;
            }
            if (attempt === ADD_ACCOUNT_MEMBERSHIP_ATTEMPTS - 1) {
              throw new InstallationMembershipPendingError(expected, manager.installationId);
            }
            console.info('[XMTP] Waiting for installation membership before retrying association', {
              inboxId: expected,
              installationId: manager.installationId,
              attempt: attempt + 1,
            });
            try {
              installationVisible = stateHasInstallation(
                await manager.preferences.fetchInboxState(),
                manager.installationId
              );
            } catch {
              // The add-account response remains authoritative; retry it below.
            }
            await sleep(Math.min(3_000, 250 * 2 ** attempt));
          }
        }
        await notify('association-submitted');
      }
    }

    if (!installationVisible) {
      throw new InstallationMembershipPendingError(expected, manager.installationId);
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
