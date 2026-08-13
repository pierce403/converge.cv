import type { InboxState, Identifier } from '@xmtp/browser-sdk';
import { XMTP_INSTALLATION_LIMIT, type XmtpDbPathMode } from './device-provisioning';
import { installationIdsMatch } from './client-registration';

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

/**
 * Prepare one explicit browser-installation repair without creating a second
 * candidate. The candidate is persisted before any ledger mutation. If the
 * signer is recovery authority, only the exact superseded installation is
 * revoked; arbitrary/oldest installations are never selected here.
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
    !candidateVisible &&
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

  let previousInstallationRevoked = false;
  if (canRevokePrevious && previousInstallation?.bytes) {
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
        previousInstallationRevoked = true;
        break;
      }
      if (attempt < 9) {
        await sleep(Math.min(2_000, 250 * 2 ** attempt));
      }
    }

    if (!previousInstallationRevoked) {
      if (revokeError) {
        throw revokeError;
      }
      throw new Error(
        'XMTP accepted the exact removal request, but the saved unavailable installation is still visible. Wait for the removal to appear, then retry; no replacement was registered.'
      );
    }
  }

  state = await requireCurrentState(
    input.inboxId,
    input.signerIdentifier,
    dependencies.fetchInboxState
  );
  const refreshedCandidateVisible = state.installations?.some((installation) =>
    installationIdsMatch(installation.id, input.candidateInstallationId)
  ) ?? false;
  if (
    !refreshedCandidateVisible &&
    (state.installations?.length ?? 0) >= XMTP_INSTALLATION_LIMIT
  ) {
    throw new Error(
      'Installation limit reached (10/10) while repair was preparing. The same candidate was preserved; revoke one installation and retry.'
    );
  }

  return {
    inboxId: input.inboxId,
    candidateInstallationId: input.candidateInstallationId,
    previousInstallationId: previousInstallation?.id,
    previousInstallationRevoked,
    previousInstallationAbsent,
    registrationRequired: !input.candidateLocallyRegistered,
    existingInstallationCount: state.installations?.length ?? 0,
  };
}
