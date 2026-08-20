import type { InboxState, Identifier, Signer } from '@xmtp/browser-sdk';
import type { Identity } from '@/types';
import { normalizeEthereumAddress } from '@/lib/utils/ethereum';
import {
  getInboxDefaultDatabasePath,
  getPersistentXmtpDatabaseUri,
} from './opfs-database';

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
  removeAccount?(identifier: Identifier): Promise<unknown>;
  changeRecoveryIdentifier?(identifier: Identifier): Promise<unknown>;
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
  | 'complete';

export interface ProvisionDeviceResult {
  inboxId: string;
  installationId: string;
  installationRegistered: boolean;
}

const normalizeId = (value: string | null | undefined) => value?.trim().toLowerCase() || null;

const normalizeInstallationId = (value: string | null | undefined) =>
  value?.trim().replace(/^(?:0x)+/i, '').toLowerCase() || null;

export const installationIdsMatch = (left: string | null | undefined, right: string | null | undefined) => {
  const normalizedLeft = normalizeInstallationId(left);
  const normalizedRight = normalizeInstallationId(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
};

export const identifiersMatch = (left: Identifier, right: Identifier) =>
  left.identifierKind === right.identifierKind &&
  left.identifier.trim().toLowerCase().replace(/^(?:0x)+/i, '') ===
    right.identifier.trim().toLowerCase().replace(/^(?:0x)+/i, '');

export const stateHasIdentifier = (state: InboxState | undefined, identifier: Identifier) =>
  Boolean(
    state &&
      (state.accountIdentifiers?.some((candidate) => identifiersMatch(candidate, identifier)) ||
        (state.recoveryIdentifier && identifiersMatch(state.recoveryIdentifier, identifier)))
  );

export const stateHasInstallation = (
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

const isInstallationLimitLikeError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /too\s*many\s*installations|10\s*\/\s*10|installation limit|already registered 10/i.test(
    message
  );
};

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

export function getExactClientDbPath(
  address: string,
  mode: XmtpDbPathMode,
  expectedInboxId?: string
): string | undefined {
  if (mode === 'inbox-default') {
    return expectedInboxId ? getInboxDefaultDatabasePath(expectedInboxId) : undefined;
  }
  return getClientDbPath(address, mode);
}

export function getPersistentClientDbPath(
  address: string,
  mode: XmtpDbPathMode,
  expectedInboxId: string | undefined,
  openMode: 'rw' | 'rwc' = 'rwc'
): string {
  const logicalPath = getExactClientDbPath(address, mode, expectedInboxId);
  if (!logicalPath) {
    throw new Error('An inbox ID is required to open the persistent XMTP database.');
  }
  return getPersistentXmtpDatabaseUri(logicalPath, openMode);
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
  result: {
    inboxId: string;
    installationId: string;
    databasePathMode?: XmtpDbPathMode;
    previousInstallationId?: string;
  }
): Identity {
  const inboxId = normalizeId(result.inboxId) ?? result.inboxId;
  const previousInstallationId =
    result.previousInstallationId &&
    !installationIdsMatch(result.previousInstallationId, result.installationId)
      ? result.previousInstallationId
      : identity.staleInstallationId;
  return {
    ...identity,
    inboxId,
    installationId: result.installationId,
    staleInstallationId: previousInstallationId,
    xmtpDbPathMode: result.databasePathMode ?? identity.xmtpDbPathMode,
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
    needsHistorySync: result.historySyncRequested ? true : ready.needsHistorySync,
    historySyncRequestedAt: result.historySyncRequested
      ? completedAt
      : ready.historySyncRequestedAt,
    historySyncStatus: result.historySyncRequested ? 'requested' : ready.historySyncStatus,
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
      `XMTP has not propagated browser installation ${installationId} far enough. Retry Add This Device; if this installation remains absent, Converge will replace only its pending local XMTP database.`
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
    return await provision(undefined);
  }
}

/**
 * Directly provision an external wallet inbox on this browser device.
 * The external wallet itself registers the browser installation without creating or associating an intermediary EOA.
 */
export async function provisionExternalWalletDevice(
  walletSigner: Signer,
  expectedInboxId: string,
  dependencies: ProvisionDeviceDependencies
): Promise<ProvisionDeviceResult> {
  const sleep = dependencies.sleep ?? defaultSleep;
  const notify = async (phase: DeviceProvisioningPhase) => {
    await dependencies.onPhase?.(phase);
  };

  await notify('preflight');
  const targetIdentifier = await walletSigner.getIdentifier();
  const expected = normalizeId(expectedInboxId);
  const resolvedTarget = normalizeId(await dependencies.resolveInboxId(targetIdentifier));

  if (!expected || !resolvedTarget || resolvedTarget !== expected) {
    throw new Error('The connected wallet no longer resolves to the selected XMTP inbox.');
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
    manager = await dependencies.createManager(walletSigner);
  } catch (error) {
    if (isInstallationLimitLikeError(error)) {
      throw new InstallationLimitError(expected);
    }
    throw error;
  }
  try {
    if (normalizeId(manager.inboxId) !== expected) {
      throw new Error('The wallet client opened a different XMTP inbox.');
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
    console.info('[XMTP] External wallet installation check', {
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
      throw new InstallationMembershipPendingError(expected, manager.installationId);
    }

    await notify('complete');
    return {
      inboxId: expected,
      installationId: manager.installationId,
      installationRegistered,
    };
  } finally {
    await manager.close();
    await sleep(350);
  }
}
