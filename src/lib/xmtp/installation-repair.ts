import type { InboxState, Identifier } from '@xmtp/browser-sdk';
import { XMTP_INSTALLATION_LIMIT, type XmtpDbPathMode } from './device-provisioning';
import {
  ensureClientRegistration,
  InstallationRecoveryRequiredError,
  installationIdsMatch,
  type ClientRegistrationDependencies,
  type ClientRegistrationResult,
  type InstallationRecoveryDetails,
  type RegistrationClient,
} from './client-registration';

export interface InstallationRepairInput {
  inboxId: string;
  candidateInstallationId: string;
  previousInstallationId?: string;
  candidateLocallyRegistered: boolean;
  signerIdentifier: Identifier;
  databasePathMode: XmtpDbPathMode;
}

export interface InstallationRepairDependencies {
  fetchInboxState(inboxId: string): Promise<InboxState | undefined>;
  revokeInstallation(inboxId: string, installationBytes: Uint8Array[]): Promise<void>;
  onCandidateReady(result: {
    inboxId: string;
    candidateInstallationId: string;
    previousInstallationId?: string;
    databasePathMode: XmtpDbPathMode;
  }): Promise<void> | void;
  sleep?(milliseconds: number): Promise<void>;
}

export interface InstallationRepairPreparation {
  inboxId: string;
  candidateInstallationId: string;
  previousInstallationId?: string;
  previousInstallationRevoked: boolean;
  previousInstallationAbsent: boolean;
  registrationRequired: boolean;
  existingInstallationCount: number;
}

export interface InstallationRepairSessionInput {
  client: RegistrationClient;
  recovery: InstallationRecoveryDetails;
  signerIdentifier: Identifier;
  expectedInboxId: string;
  interruptedRepairCandidateId?: string;
  previousInstallationId?: string;
  databasePathMode: XmtpDbPathMode;
}

export interface InstallationRepairSessionDependencies
  extends ClientRegistrationDependencies {
  revokeInstallation(inboxId: string, installationBytes: Uint8Array[]): Promise<void>;
  onCandidateReady: InstallationRepairDependencies['onCandidateReady'];
  verifyCandidateDurability?(candidateInstallationId: string): Promise<void>;
}

export interface InstallationRepairSessionResult {
  candidateInstallationId: string;
  preparation: InstallationRepairPreparation;
  registration: ClientRegistrationResult;
}

export function selectPreviousInstallationForRepair(
  journal: {
    installationId?: string;
    staleInstallationId?: string;
    installationRepairPending?: boolean;
  },
  recovery: Pick<
    InstallationRecoveryDetails,
    'expectedInstallationId' | 'localInstallationId'
  >
): string | undefined {
  if (journal.installationRepairPending) {
    return journal.staleInstallationId ?? recovery.expectedInstallationId;
  }
  return !installationIdsMatch(journal.installationId, recovery.localInstallationId)
    ? journal.installationId
    : journal.staleInstallationId;
}

const normalizeInboxId = (value: string | null | undefined) =>
  value?.trim().replace(/^(?:0x)+/i, '').toLowerCase() || null;

const identifiersMatch = (left: Identifier, right: Identifier) =>
  left.identifierKind === right.identifierKind &&
  left.identifier.trim().replace(/^(?:0x)+/i, '').toLowerCase() ===
    right.identifier.trim().replace(/^(?:0x)+/i, '').toLowerCase();

const stateHasSigner = (state: InboxState, identifier: Identifier) =>
  Boolean(
    state.accountIdentifiers?.some((candidate) => identifiersMatch(candidate, identifier)) ||
      (state.recoveryIdentifier && identifiersMatch(state.recoveryIdentifier, identifier))
  );

const signerIsRecoveryIdentifier = (state: InboxState, identifier: Identifier) =>
  Boolean(
    state.recoveryIdentifier && identifiersMatch(state.recoveryIdentifier, identifier)
  );

const defaultSleep = async (milliseconds: number) =>
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

async function requireCurrentState(
  inboxId: string,
  signerIdentifier: Identifier,
  fetchInboxState: InstallationRepairDependencies['fetchInboxState']
): Promise<InboxState> {
  const state = await fetchInboxState(inboxId);
  if (!state || normalizeInboxId(state.inboxId) !== normalizeInboxId(inboxId)) {
    throw new Error('XMTP did not return the expected inbox state. Browser repair was stopped.');
  }
  if (!stateHasSigner(state, signerIdentifier)) {
    throw new Error(
      'This local account key is no longer authorized for the expected XMTP inbox. Browser repair was stopped.'
    );
  }
  return state;
}

interface PreviousInstallationRemovalResult {
  absent: boolean;
  revoked: boolean;
  state: InboxState;
}

async function removePreviousInstallation(
  input: {
    inboxId: string;
    candidateInstallationId: string;
    previousInstallationId: string;
    signerIdentifier: Identifier;
    required: boolean;
  },
  dependencies: Pick<
    InstallationRepairDependencies,
    'fetchInboxState' | 'revokeInstallation' | 'sleep'
  >
): Promise<PreviousInstallationRemovalResult> {
  let state = await requireCurrentState(
    input.inboxId,
    input.signerIdentifier,
    dependencies.fetchInboxState
  );
  const previousInstallation = state.installations?.find(
    (installation) =>
      !installationIdsMatch(installation.id, input.candidateInstallationId) &&
      installationIdsMatch(installation.id, input.previousInstallationId)
  );
  if (!previousInstallation) {
    return { absent: true, revoked: false, state };
  }

  if (
    !previousInstallation.bytes ||
    !signerIsRecoveryIdentifier(state, input.signerIdentifier)
  ) {
    if (input.required) {
      throw new Error(
        'Installation limit reached (10/10). Revoke the saved unavailable installation from a recovery wallet or another device, then retry this browser repair.'
      );
    }
    return { absent: false, revoked: false, state };
  }

  let revokeError: unknown;
  try {
    await dependencies.revokeInstallation(input.inboxId, [previousInstallation.bytes]);
  } catch (error) {
    revokeError = error;
  }

  const sleep = dependencies.sleep ?? defaultSleep;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    state = await requireCurrentState(
      input.inboxId,
      input.signerIdentifier,
      dependencies.fetchInboxState
    );
    const stillVisible = state.installations?.some((installation) =>
      installationIdsMatch(installation.id, previousInstallation.id)
    );
    if (!stillVisible) {
      return { absent: false, revoked: true, state };
    }
    if (attempt < 9) {
      await sleep(Math.min(2_000, 250 * 2 ** attempt));
    }
  }

  if (input.required) {
    if (revokeError) {
      throw revokeError;
    }
    throw new Error(
      'XMTP accepted the exact removal request, but the saved unavailable installation is still visible. Wait for the removal to appear, then retry; no replacement was registered.'
    );
  }

  console.warn(
    '[XMTP] The browser installation is registered, but exact cleanup of the saved unavailable installation did not settle:',
    revokeError ?? 'installation remains visible'
  );
  return { absent: false, revoked: false, state };
}

async function requireInterruptedCandidateAbsent(
  inboxId: string,
  interruptedInstallationId: string,
  signerIdentifier: Identifier,
  dependencies: Pick<InstallationRepairSessionDependencies, 'fetchInboxState' | 'sleep'>
): Promise<void> {
  const sleep = dependencies.sleep ?? defaultSleep;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const state = await requireCurrentState(
      inboxId,
      signerIdentifier,
      dependencies.fetchInboxState
    );
    if (
      state.installations?.some((installation) =>
        installationIdsMatch(installation.id, interruptedInstallationId)
      )
    ) {
      throw new Error(
        'A previously staged XMTP repair installation is visible on the inbox ledger, but its local key is not ready in this database. Converge did not register another installation; restore from another device or contact support before replacing it.'
      );
    }
    if (attempt < 9) {
      await sleep(Math.min(2_000, 250 * 2 ** attempt));
    }
  }
}

/**
 * Prepare one explicit browser-installation repair without creating a second
 * candidate. The candidate is journaled before any ledger mutation. Below the
 * installation limit, the old installation remains available until the new
 * candidate has registered; at 10/10 only its exact saved predecessor may be
 * removed first. Arbitrary/oldest installations are never selected here.
 */
export async function prepareInstallationRepair(
  input: InstallationRepairInput,
  dependencies: InstallationRepairDependencies
): Promise<InstallationRepairPreparation> {
  let state = await requireCurrentState(
    input.inboxId,
    input.signerIdentifier,
    dependencies.fetchInboxState
  );
  const candidateVisible = state.installations?.some((installation) =>
    installationIdsMatch(installation.id, input.candidateInstallationId)
  ) ?? false;

  if (input.candidateLocallyRegistered && !candidateVisible) {
    throw new Error(
      'The local XMTP database says it is registered, but repeated network state does not contain it. Converge left the database untouched; restore from another device or contact support before resetting it.'
    );
  }

  const previousInstallation =
    input.previousInstallationId &&
    !installationIdsMatch(input.previousInstallationId, input.candidateInstallationId)
      ? state.installations?.find((installation) =>
          installationIdsMatch(installation.id, input.previousInstallationId)
        )
      : undefined;
  const previousInstallationAbsent = Boolean(
    input.previousInstallationId && !previousInstallation
  );
  const canRevokePrevious = Boolean(
    previousInstallation?.bytes &&
      signerIsRecoveryIdentifier(state, input.signerIdentifier)
  );

  if (
    !candidateVisible &&
    !canRevokePrevious &&
    (state.installations?.length ?? 0) >= XMTP_INSTALLATION_LIMIT
  ) {
    throw new Error(
      'Installation limit reached (10/10). Revoke the saved unavailable installation from a recovery wallet or another device, then retry this browser repair.'
    );
  }

  await dependencies.onCandidateReady({
    inboxId: input.inboxId,
    candidateInstallationId: input.candidateInstallationId,
    previousInstallationId: previousInstallation?.id,
    databasePathMode: input.databasePathMode,
  });

  state = await requireCurrentState(
    input.inboxId,
    input.signerIdentifier,
    dependencies.fetchInboxState
  );
  const refreshedCandidateVisible = state.installations?.some((installation) =>
    installationIdsMatch(installation.id, input.candidateInstallationId)
  ) ?? false;
  let previousInstallationRevoked = false;
  let refreshedPreviousInstallationAbsent = previousInstallationAbsent;
  if (!refreshedCandidateVisible && (state.installations?.length ?? 0) >= XMTP_INSTALLATION_LIMIT) {
    if (!previousInstallation?.id || !canRevokePrevious) {
      throw new Error(
        'Installation limit reached (10/10) while repair was preparing. The repair journal and inbox data were preserved; revoke one installation and retry.'
      );
    }
    const removal = await removePreviousInstallation(
      {
        inboxId: input.inboxId,
        candidateInstallationId: input.candidateInstallationId,
        previousInstallationId: previousInstallation.id,
        signerIdentifier: input.signerIdentifier,
        required: true,
      },
      dependencies
    );
    state = removal.state;
    previousInstallationRevoked = removal.revoked;
    refreshedPreviousInstallationAbsent = removal.absent;
  }

  return {
    inboxId: input.inboxId,
    candidateInstallationId: input.candidateInstallationId,
    previousInstallationId: previousInstallation?.id,
    previousInstallationRevoked,
    previousInstallationAbsent: refreshedPreviousInstallationAbsent,
    registrationRequired: !input.candidateLocallyRegistered,
    existingInstallationCount: state.installations?.length ?? 0,
  };
}

/**
 * Inspect, stage, register, and verify one repair candidate without closing it
 * before registration. An unregistered installation key is held only by that
 * live worker until registration stores it; after verification, the caller may
 * close and reopen the registered database to prove durability.
 */
export async function runInstallationRepairSession(
  input: InstallationRepairSessionInput,
  dependencies: InstallationRepairSessionDependencies
): Promise<InstallationRepairSessionResult> {
  const inboxId = normalizeInboxId(input.client.inboxId);
  const expectedInboxId = normalizeInboxId(input.expectedInboxId);
  const candidateInstallationId = input.client.installationId;
  if (!inboxId || !expectedInboxId || inboxId !== expectedInboxId) {
    throw new Error('The repair database opened a different XMTP inbox.');
  }
  if (!candidateInstallationId) {
    throw new Error('The repair database opened without an XMTP installation ID.');
  }

  const candidateChanged = !installationIdsMatch(
    candidateInstallationId,
    input.recovery.localInstallationId
  );
  const priorCandidateWasEphemeral =
    !input.recovery.localInstallationRegistered &&
    !input.recovery.localInstallationVisible;
  if (candidateChanged && !priorCandidateWasEphemeral) {
    throw new Error(
      'The local XMTP repair candidate changed after it had registered or appeared on the inbox ledger. No ledger mutation was attempted; check the saved installation again.'
    );
  }

  if (
    input.interruptedRepairCandidateId &&
    !installationIdsMatch(candidateInstallationId, input.interruptedRepairCandidateId)
  ) {
    // The snapshot that opened Settings can lag a just-published identity
    // update. Settle repeated authoritative reads before rebasing an
    // interrupted candidate so a late ledger-visible install is not orphaned.
    await requireInterruptedCandidateAbsent(
      expectedInboxId,
      input.interruptedRepairCandidateId,
      input.signerIdentifier,
      dependencies
    );
  }

  const candidateLocallyRegistered = await input.client.isRegistered();
  const preparation = await prepareInstallationRepair(
    {
      inboxId: expectedInboxId,
      candidateInstallationId,
      previousInstallationId: input.previousInstallationId,
      candidateLocallyRegistered,
      signerIdentifier: input.signerIdentifier,
      databasePathMode: input.databasePathMode,
    },
    {
      fetchInboxState: dependencies.fetchInboxState,
      revokeInstallation: dependencies.revokeInstallation,
      onCandidateReady: dependencies.onCandidateReady,
      sleep: dependencies.sleep,
    }
  );

  let registration: ClientRegistrationResult;
  try {
    registration = await ensureClientRegistration(
      {
        client: input.client,
        identifier: input.signerIdentifier,
        policy: 'existing-inbox',
        expectedInboxId,
        expectedInstallationId: candidateInstallationId,
        databasePathMode: input.databasePathMode,
        requireExpectedInstallation: true,
      },
      {
        resolveInboxId: dependencies.resolveInboxId,
        fetchInboxState: dependencies.fetchInboxState,
        onInstallationReady: dependencies.onInstallationReady,
        sleep: dependencies.sleep,
      }
    );
  } catch (error) {
    // Refresh the failure against the candidate that was actually staged. This
    // prevents a partial ledger publish from being mistaken for permission to
    // generate and register another installation after this worker closes.
    try {
      const state = await requireCurrentState(
        expectedInboxId,
        input.signerIdentifier,
        dependencies.fetchInboxState
      );
      const localInstallationRegistered = await input.client.isRegistered();
      const localInstallationVisible = Boolean(
        state.installations?.some((installation) =>
          installationIdsMatch(installation.id, candidateInstallationId)
        )
      );
      const refreshed = new InstallationRecoveryRequiredError({
        reason:
          localInstallationRegistered && !localInstallationVisible
            ? 'local-registration-not-on-ledger'
            : 'installation-unregistered',
        inboxId: expectedInboxId,
        expectedInstallationId: candidateInstallationId,
        localInstallationId: candidateInstallationId,
        expectedInstallationVisible: localInstallationVisible,
        localInstallationVisible,
        localInstallationRegistered,
        signerIsRecoveryIdentifier: signerIsRecoveryIdentifier(
          state,
          input.signerIdentifier
        ),
        existingInstallationCount: state.installations?.length ?? 0,
        databasePathMode: input.databasePathMode,
      });
      Object.defineProperty(refreshed, 'cause', { value: error });
      throw refreshed;
    } catch (inspectionError) {
      if (inspectionError instanceof InstallationRecoveryRequiredError) {
        throw inspectionError;
      }
      throw error;
    }
  }

  // Registration is not complete from Converge's perspective until a fresh
  // Browser SDK worker can reopen the same persistent database and recover the
  // exact installation. This catches an SDK OPFS-to-memory fallback before the
  // UI reports success or optional cleanup removes the prior installation.
  await dependencies.verifyCandidateDurability?.(candidateInstallationId);

  if (
    preparation.previousInstallationId &&
    !preparation.previousInstallationRevoked &&
    !preparation.previousInstallationAbsent
  ) {
    try {
      const removal = await removePreviousInstallation(
        {
          inboxId: expectedInboxId,
          candidateInstallationId,
          previousInstallationId: preparation.previousInstallationId,
          signerIdentifier: input.signerIdentifier,
          required: false,
        },
        dependencies
      );
      preparation.previousInstallationRevoked = removal.revoked;
      preparation.previousInstallationAbsent = removal.absent;
    } catch (error) {
      // Registration is already locally durable and ledger-verified. Optional
      // cleanup of the exact predecessor must not turn that success into a
      // disconnected client; retain its ID for a later explicit cleanup.
      console.warn(
        '[XMTP] Browser repair succeeded, but the prior installation could not be rechecked for cleanup:',
        error
      );
    }
  }

  return {
    candidateInstallationId,
    preparation,
    registration,
  };
}
