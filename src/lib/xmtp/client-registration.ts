import type { InboxState, Identifier } from '@xmtp/browser-sdk';
import {
  StaleInstallationError,
  XMTP_INSTALLATION_LIMIT,
} from './device-provisioning';
import {
  registrationCapabilities,
  type ClientRegistrationPolicy,
} from './registration-policy';

export interface RegistrationClient {
  inboxId?: string;
  installationId?: string;
  isRegistered(): Promise<boolean>;
  register(): Promise<unknown>;
}

export interface ClientRegistrationDependencies {
  resolveInboxId(identifier: Identifier): Promise<string | undefined>;
  fetchInboxState(inboxId: string): Promise<InboxState | undefined>;
  onInstallationReady?(result: {
    inboxId: string;
    installationId: string;
    installationRegistered: boolean;
  }): Promise<void> | void;
  sleep?(milliseconds: number): Promise<void>;
}

export interface ClientRegistrationInput {
  client: RegistrationClient;
  identifier: Identifier;
  policy: ClientRegistrationPolicy;
  expectedInboxId?: string;
  expectedInstallationId?: string;
}

export interface ClientRegistrationResult {
  inboxId: string;
  installationId: string;
  installationRegistered: boolean;
  existingInstallationCount: number;
}

const defaultSleep = async (milliseconds: number) =>
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

const normalizeInboxId = (value: string | null | undefined) =>
  value?.trim().toLowerCase() || null;

export const normalizeInstallationId = (value: string | null | undefined) =>
  value?.trim().replace(/^(?:0x)+/i, '').toLowerCase() || null;

export const installationIdsMatch = (
  left: string | null | undefined,
  right: string | null | undefined
) => {
  const normalizedLeft = normalizeInstallationId(left);
  const normalizedRight = normalizeInstallationId(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
};

const identifiersMatch = (left: Identifier, right: Identifier) =>
  left.identifierKind === right.identifierKind &&
  left.identifier.trim().toLowerCase().replace(/^(?:0x)+/, '') ===
    right.identifier.trim().toLowerCase().replace(/^(?:0x)+/, '');

const stateHasInstallation = (
  state: InboxState | undefined,
  installationId: string
) =>
  Boolean(
    state?.installations?.some((installation) =>
      installationIdsMatch(installation.id, installationId)
    )
  );

const stateHasIdentifier = (state: InboxState | undefined, identifier: Identifier) =>
  Boolean(
    state?.accountIdentifiers?.some((candidate) => identifiersMatch(candidate, identifier))
  );

const isPendingIdentityStateError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /missing identity update|uninitialized identity|identity update not found/i.test(message);
};

async function waitForVerifiedRegistration(
  client: RegistrationClient,
  identifier: Identifier,
  inboxId: string,
  installationId: string,
  dependencies: ClientRegistrationDependencies
): Promise<boolean> {
  const sleep = dependencies.sleep ?? defaultSleep;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    let resolvedInboxId: string | null = null;
    let state: InboxState | undefined;
    try {
      resolvedInboxId = normalizeInboxId(await dependencies.resolveInboxId(identifier));
      if (resolvedInboxId === inboxId) {
        state = await dependencies.fetchInboxState(inboxId);
      }
    } catch (error) {
      if (!isPendingIdentityStateError(error)) {
        throw error;
      }
    }

    if (
      resolvedInboxId === inboxId &&
      stateHasIdentifier(state, identifier) &&
      stateHasInstallation(state, installationId) &&
      (await client.isRegistered())
    ) {
      return true;
    }

    await sleep(Math.min(2_000, 250 * 2 ** attempt));
  }
  return false;
}

/**
 * Register or resume exactly one Browser SDK client installation.
 *
 * `Client.create({ disableAutoRegister: true })` assigns a prospective inbox ID
 * even when the signer has no identity update. Registration decisions therefore
 * come from `isRegistered()` and the network resolver, never inboxId presence.
 */
export async function ensureClientRegistration(
  input: ClientRegistrationInput,
  dependencies: ClientRegistrationDependencies
): Promise<ClientRegistrationResult> {
  const { client, identifier, policy } = input;
  const { allowInboxCreation, allowInstallationRegistration } =
    registrationCapabilities(policy);
  const inboxId = normalizeInboxId(client.inboxId);
  const installationId = client.installationId;

  if (!inboxId || !installationId) {
    throw new Error('XMTP created a client without a usable inbox or installation ID.');
  }

  const expectedInboxId = normalizeInboxId(input.expectedInboxId);
  if (expectedInboxId && inboxId !== expectedInboxId) {
    throw new Error(
      `XMTP opened inbox ${client.inboxId} instead of expected inbox ${input.expectedInboxId}.`
    );
  }
  const expectedInstallationMismatch = Boolean(
    input.expectedInstallationId &&
      !installationIdsMatch(installationId, input.expectedInstallationId)
  );

  const resolvedInboxId = normalizeInboxId(await dependencies.resolveInboxId(identifier));
  if (resolvedInboxId && resolvedInboxId !== inboxId) {
    throw new Error(
      `XMTP resolved this signer to inbox ${resolvedInboxId}, but the local database opened ${inboxId}.`
    );
  }
  if (!resolvedInboxId && !allowInboxCreation) {
    throw new Error(
      'XMTP did not resolve this identity to the expected existing inbox. Registration was stopped to avoid creating an unrelated inbox.'
    );
  }

  let preState: InboxState | undefined;
  if (resolvedInboxId) {
    preState = await dependencies.fetchInboxState(inboxId);
    if (!preState) {
      throw new Error('XMTP did not return the resolved inbox state. Registration was stopped.');
    }
  }

  const existingInstallationCount = preState?.installations?.length ?? 0;
  const installationAlreadyVisible = stateHasInstallation(preState, installationId);
  if (expectedInstallationMismatch) {
    if (policy === 'resume-only') {
      throw new Error(
        'XMTP did not reopen the expected browser installation. Registration was stopped to avoid creating another installation.'
      );
    }
    if (stateHasInstallation(preState, input.expectedInstallationId!)) {
      throw new StaleInstallationError(inboxId, input.expectedInstallationId!);
    }
    console.info(
      '[XMTP] The saved pending installation is no longer on the inbox ledger; resuming with this browser database.'
    );
  }
  const alreadyRegistered = await client.isRegistered();

  if (alreadyRegistered) {
    const verified = await waitForVerifiedRegistration(
      client,
      identifier,
      inboxId,
      installationId,
      dependencies
    );
    if (!verified) {
      throw new Error(
        'XMTP opened a registered local installation, but the signer and installation could not be verified in the inbox state.'
      );
    }
    await dependencies.onInstallationReady?.({
      inboxId,
      installationId,
      installationRegistered: false,
    });
    return {
      inboxId,
      installationId,
      installationRegistered: false,
      existingInstallationCount,
    };
  }

  if (!allowInstallationRegistration) {
    throw new Error(
      'This browser does not have a registered XMTP installation. Reconnect the controlling wallet or restore the key on this device instead of creating one silently.'
    );
  }
  if (resolvedInboxId && existingInstallationCount >= XMTP_INSTALLATION_LIMIT && !installationAlreadyVisible) {
    throw new Error(
      `Installation limit reached (10/10) for inbox ${inboxId}. Revoke an old installation before adding this device.`
    );
  }

  // Persist the exact local database installation only after policy/capacity
  // checks, but before the first network mutation so an interrupted register
  // can safely resume this same installation.
  await dependencies.onInstallationReady?.({
    inboxId,
    installationId,
    installationRegistered: false,
  });

  let registerError: unknown;
  try {
    await client.register();
  } catch (error) {
    registerError = error;
  }

  const verified = await waitForVerifiedRegistration(
    client,
    identifier,
    inboxId,
    installationId,
    dependencies
  );

  if (!verified) {
    if (registerError) {
      throw registerError;
    }
    if (installationAlreadyVisible) {
      throw new Error(
        'The XMTP installation is visible on the identity ledger, but its local database is not ready. Retry to resume this same installation.'
      );
    }
    throw new Error(
      'XMTP registration did not produce a verified signer and browser installation. Retry to resume this same local key.'
    );
  }

  const installationRegistered = !installationAlreadyVisible;
  await dependencies.onInstallationReady?.({
    inboxId,
    installationId,
    installationRegistered,
  });

  return {
    inboxId,
    installationId,
    installationRegistered,
    existingInstallationCount,
  };
}
