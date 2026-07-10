import type { Identity, InboxRegistryEntry } from '@/types';
import {
  closeStorage,
  getStorage,
  getStorageNamespace,
  setStorageNamespace,
} from '@/lib/storage';
import {
  useAuthStore,
  useContactStore,
  useConversationStore,
  useDebugStore,
  useInboxRegistryStore,
  useMessageStore,
  useXmtpStore,
} from '@/lib/stores';
import { getXmtpClient } from '@/lib/xmtp';
import { inboxIdsMatch, normalizeInboxId } from '@/lib/utils/inbox';
import { clearLastRoute } from '@/lib/utils/route-persistence';
import { clearNeynarVerificationCacheForAddresses } from '@/lib/farcaster/neynar';
import { removePushRegistrationForInbox } from '@/lib/push';
import { clearResyncReadState } from '@/lib/xmtp/resync-state';
import {
  clearIntentionalEmptyInboxState,
  markIntentionalEmptyInboxState,
} from '@/features/auth/onboarding-state';

const REMOTE_REVOKE_FALLBACK =
  'Converge could not revoke this browser installation. The local wipe continued; revoke the installation from another connected device.';

export interface BurnInboxResult {
  inboxId: string;
  revokeAttempted: boolean;
  installationRevoked: boolean;
  revokeWarning?: string;
  pushWarning?: string;
  localDataRemoved: boolean;
  localCleanupWarnings: string[];
  removedIdentityCount: number;
  remainingInboxIds: string[];
  nextInboxId: string | null;
  intentionallyEmpty: boolean;
}

interface ClearInboxDataResult {
  opfsWarning?: string;
}

export interface BurnInboxDependencies {
  getIdentities(): Promise<Identity[]>;
  getRegistryState(): {
    entries: InboxRegistryEntry[];
    currentInboxId: string | null;
  };
  getActiveIdentityInboxId(): string | null;
  getConnectedInboxId(): string | null;
  revokeCurrentInstallation(input: {
    expectedInboxId: string;
    expectedInstallationId?: string;
  }): Promise<unknown>;
  disconnectCurrentClient(): Promise<void>;
  removePushRegistration(inboxId: string): Promise<boolean>;
  getStorageNamespace(): string;
  clearInboxData(inboxId: string, opfsTargets: string[]): Promise<ClearInboxDataResult>;
  deleteIdentityByAddress(address: string): Promise<void>;
  removeRegistryEntry(inboxId: string): void;
  setCurrentRegistryInbox(inboxId: string | null): void;
  setStorageNamespace(namespace: string): Promise<void>;
  clearInboxBrowserState(inboxId: string, identities: Identity[]): void;
  clearActiveRuntimeState(): void;
  setIntentionalEmptyState(isEmpty: boolean): void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function matchingInboxIdentities(identities: Identity[], inboxId: string): Identity[] {
  return identities.filter(
    (identity) =>
      inboxIdsMatch(identity.inboxId, inboxId) ||
      inboxIdsMatch(identity.expectedInboxId, inboxId)
  );
}

function orderedRemainingEntries(
  entries: InboxRegistryEntry[],
  burnedInboxId: string
): InboxRegistryEntry[] {
  return entries
    .filter((entry) => !inboxIdsMatch(entry.inboxId, burnedInboxId))
    .sort((left, right) => right.lastOpenedAt - left.lastOpenedAt);
}

export async function burnInboxWithDependencies(
  rawInboxId: string,
  dependencies: BurnInboxDependencies
): Promise<BurnInboxResult> {
  const inboxId = normalizeInboxId(rawInboxId);
  if (!inboxId) {
    throw new Error('A valid XMTP inbox ID is required.');
  }

  const identities = await dependencies.getIdentities();
  const targetIdentities = matchingInboxIdentities(identities, inboxId);
  const registryState = dependencies.getRegistryState();
  const remainingEntries = orderedRemainingEntries(registryState.entries, inboxId);
  const remainingInboxIds = remainingEntries.map((entry) => entry.inboxId);
  for (const identity of identities) {
    const remainingIdentityInboxId = normalizeInboxId(identity.inboxId);
    if (
      remainingIdentityInboxId &&
      !inboxIdsMatch(remainingIdentityInboxId, inboxId) &&
      !remainingInboxIds.some((candidate) =>
        inboxIdsMatch(candidate, remainingIdentityInboxId)
      )
    ) {
      // A damaged/stale registry must not make Burn Inbox treat a still-loaded
      // local identity as an intentionally empty app.
      remainingInboxIds.push(remainingIdentityInboxId);
    }
  }
  const activeInboxId =
    dependencies.getActiveIdentityInboxId() ?? registryState.currentInboxId;
  const wasActive = inboxIdsMatch(activeInboxId, inboxId);
  const connectedToTarget = inboxIdsMatch(dependencies.getConnectedInboxId(), inboxId);
  const previousNamespace = dependencies.getStorageNamespace();
  const expectedInstallationId = targetIdentities.find(
    (identity) => identity.installationId
  )?.installationId;

  let revokeAttempted = false;
  let installationRevoked = false;
  let revokeWarning: string | undefined;
  let pushWarning: string | undefined;

  if (connectedToTarget) {
    revokeAttempted = true;
    try {
      await dependencies.revokeCurrentInstallation({
        expectedInboxId: inboxId,
        expectedInstallationId,
      });
      installationRevoked = true;
    } catch (error) {
      revokeWarning = `${REMOTE_REVOKE_FALLBACK} ${errorMessage(error)}`;
    }
  } else {
    revokeWarning = `${REMOTE_REVOKE_FALLBACK} The selected inbox was not connected.`;
  }

  try {
    const relayCleanupSucceeded = await dependencies.removePushRegistration(inboxId);
    if (!relayCleanupSucceeded) {
      pushWarning =
        'Local notification state was wiped, but the push relay did not confirm removal for this inbox.';
    }
  } catch (error) {
    pushWarning = `Push notification cleanup could not be confirmed: ${errorMessage(error)}`;
  }

  if (connectedToTarget) {
    try {
      await dependencies.disconnectCurrentClient();
    } catch (error) {
      console.warn('[BurnInbox] Failed to disconnect the selected inbox before local cleanup:', error);
    }
  }

  const localCleanupWarnings: string[] = [];
  const opfsTargets = Array.from(
    new Set([
      inboxId,
      ...targetIdentities.map((identity) => identity.address),
    ])
  );

  try {
    const clearResult = await dependencies.clearInboxData(inboxId, opfsTargets);
    if (clearResult.opfsWarning) {
      localCleanupWarnings.push(`XMTP database cleanup: ${clearResult.opfsWarning}`);
    }
  } catch (error) {
    localCleanupWarnings.push(`Inbox database cleanup: ${errorMessage(error)}`);
  }

  if (localCleanupWarnings.length > 0) {
    return {
      inboxId,
      revokeAttempted,
      installationRevoked,
      revokeWarning,
      pushWarning,
      localDataRemoved: false,
      localCleanupWarnings,
      removedIdentityCount: 0,
      remainingInboxIds: [inboxId, ...remainingInboxIds],
      nextInboxId: activeInboxId ?? inboxId,
      intentionallyEmpty: false,
    };
  }

  let removedIdentityCount = 0;
  for (const identity of targetIdentities) {
    try {
      await dependencies.deleteIdentityByAddress(identity.address);
      removedIdentityCount += 1;
    } catch (error) {
      localCleanupWarnings.push(
        `Local account key cleanup for ${identity.address}: ${errorMessage(error)}`
      );
    }
  }

  if (removedIdentityCount !== targetIdentities.length) {
    return {
      inboxId,
      revokeAttempted,
      installationRevoked,
      revokeWarning,
      pushWarning,
      localDataRemoved: false,
      localCleanupWarnings,
      removedIdentityCount,
      remainingInboxIds: [inboxId, ...remainingInboxIds],
      nextInboxId: activeInboxId ?? inboxId,
      intentionallyEmpty: false,
    };
  }

  try {
    dependencies.clearInboxBrowserState(inboxId, targetIdentities);
  } catch (error) {
    localCleanupWarnings.push(`Browser metadata cleanup: ${errorMessage(error)}`);
  }

  try {
    dependencies.removeRegistryEntry(inboxId);
  } catch (error) {
    localCleanupWarnings.push(`Inbox registry cleanup: ${errorMessage(error)}`);
  }

  const intentionallyEmpty = remainingInboxIds.length === 0;
  const nextInboxId = wasActive
    ? remainingInboxIds[0] ?? null
    : registryState.currentInboxId;

  try {
    dependencies.setCurrentRegistryInbox(nextInboxId);
  } catch (error) {
    localCleanupWarnings.push(`Current inbox cleanup: ${errorMessage(error)}`);
  }

  try {
    await dependencies.setStorageNamespace(
      wasActive ? nextInboxId ?? 'default' : previousNamespace
    );
  } catch (error) {
    localCleanupWarnings.push(`Storage namespace cleanup: ${errorMessage(error)}`);
  }

  if (wasActive) {
    try {
      dependencies.clearActiveRuntimeState();
    } catch (error) {
      localCleanupWarnings.push(`In-memory inbox cleanup: ${errorMessage(error)}`);
    }
  }

  try {
    dependencies.setIntentionalEmptyState(intentionallyEmpty);
  } catch (error) {
    localCleanupWarnings.push(`Empty onboarding marker: ${errorMessage(error)}`);
  }

  return {
    inboxId,
    revokeAttempted,
    installationRevoked,
    revokeWarning,
    pushWarning,
    localDataRemoved: true,
    localCleanupWarnings,
    removedIdentityCount,
    remainingInboxIds,
    nextInboxId,
    intentionallyEmpty,
  };
}

function removeBrowserStorageKey(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Best-effort metadata cleanup; the caller records failures from enumeration.
  }
}

export function clearInboxBrowserState(inboxId: string, identities: Identity[]): void {
  if (typeof window === 'undefined') {
    return;
  }

  const normalizedInboxId = normalizeInboxId(inboxId) ?? inboxId;
  const addresses = identities.map((identity) => identity.address.toLowerCase());
  const installationIds = identities
    .map((identity) => identity.installationId)
    .filter((value): value is string => Boolean(value));

  for (const address of addresses) {
    removeBrowserStorageKey(`personalization-reminder:${address}`);
    removeBrowserStorageKey(`pending-profile-save:${address}`);
    removeBrowserStorageKey(`self-farcaster:last-check:${address}`);
  }
  removeBrowserStorageKey(`pending-profile-save:${normalizedInboxId}`);
  for (const installationId of installationIds) {
    removeBrowserStorageKey(`converge.historySyncNotice.${installationId}`);
  }

  const forcedInboxId = window.localStorage.getItem('converge.forceInboxId.v1');
  if (inboxIdsMatch(forcedInboxId, normalizedInboxId)) {
    removeBrowserStorageKey('converge.forceInboxId.v1');
  }

  const profileEditorIntentKey = 'converge.profileEditorIntent.v1';
  const profileEditorIntent = window.localStorage.getItem(profileEditorIntentKey);
  if (profileEditorIntent) {
    try {
      const parsed = JSON.parse(profileEditorIntent) as {
        inboxId?: string;
        address?: string;
      };
      const targetsBurnedInbox = inboxIdsMatch(parsed.inboxId, normalizedInboxId);
      const targetsBurnedAddress = addresses.includes(parsed.address?.toLowerCase() ?? '');
      if (targetsBurnedInbox || targetsBurnedAddress) {
        removeBrowserStorageKey(profileEditorIntentKey);
      }
    } catch {
      // Leave unrelated or malformed global onboarding state untouched.
    }
  }
  clearNeynarVerificationCacheForAddresses(addresses);
}

const runtimeDependencies: BurnInboxDependencies = {
  getIdentities: async () => (await getStorage()).listIdentities(),
  getRegistryState: () => {
    const registry = useInboxRegistryStore.getState();
    registry.hydrate();
    const hydrated = useInboxRegistryStore.getState();
    return {
      entries: [...hydrated.entries],
      currentInboxId: hydrated.currentInboxId,
    };
  },
  getActiveIdentityInboxId: () => useAuthStore.getState().identity?.inboxId ?? null,
  getConnectedInboxId: () => getXmtpClient().getInboxId(),
  revokeCurrentInstallation: (input) => getXmtpClient().revokeCurrentInstallation(input),
  disconnectCurrentClient: () => getXmtpClient().disconnect(),
  removePushRegistration: (inboxId) => removePushRegistrationForInbox(inboxId),
  getStorageNamespace,
  clearInboxData: async (inboxId, opfsTargets) => {
    await setStorageNamespace(inboxId);
    const targetStorage = await getStorage();
    const result = await targetStorage.clearAllData({ opfsAddresses: opfsTargets });
    return { opfsWarning: result.opfsWarning };
  },
  deleteIdentityByAddress: async (address) => {
    const storage = await getStorage();
    await storage.deleteIdentityByAddress(address);
  },
  removeRegistryEntry: (inboxId) => useInboxRegistryStore.getState().removeEntry(inboxId),
  setCurrentRegistryInbox: (inboxId) =>
    useInboxRegistryStore.getState().setCurrentInbox(inboxId),
  setStorageNamespace: async (namespace) => {
    await closeStorage();
    await setStorageNamespace(namespace);
  },
  clearInboxBrowserState,
  clearActiveRuntimeState: () => {
    useAuthStore.getState().logout();
    useConversationStore.setState({
      conversations: [],
      activeConversationId: null,
      isLoading: false,
    });
    useMessageStore.setState({
      messagesByConversation: {},
      loadingConversations: {},
      loadedConversations: {},
      isSending: false,
    });
    useContactStore.setState({ contacts: [], isLoading: false });
    useXmtpStore.setState({
      connectionStatus: 'disconnected',
      lastConnected: null,
      error: null,
      lastSyncedAt: null,
      syncStatus: 'idle',
      syncProgress: 0,
    });
    useDebugStore.getState().clearAll();
    clearResyncReadState();
    clearLastRoute();
  },
  setIntentionalEmptyState: (isEmpty) => {
    if (isEmpty) {
      markIntentionalEmptyInboxState();
    } else {
      clearIntentionalEmptyInboxState();
    }
  },
};

export async function burnInbox(inboxId: string): Promise<BurnInboxResult> {
  return burnInboxWithDependencies(inboxId, runtimeDependencies);
}
