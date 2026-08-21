import type { Identity } from '@/types';
import { inboxIdsMatch } from '@/lib/utils/inbox';
import { ethereumAddressesEqual } from '@/lib/utils/ethereum';

const INTENTIONAL_EMPTY_KEY = 'converge.intentionalEmptyInboxState.v1';
const PROFILE_EDITOR_KEY = 'converge.profileEditorIntent.v1';

export const PROFILE_EDITOR_INTENT_EVENT = 'converge:profile-editor-intent';

export interface ProfileEditorIntent {
  address: string;
  inboxId?: string;
  reason: 'first-inbox' | 'new-inbox';
}

export type ExplicitOnboardingAction = 'connect' | 'import';

export interface OnboardingEntryDecision {
  view: 'landing' | 'wallet';
  resumeAction?: 'device-join';
  legacyActionToConsume?: ExplicitOnboardingAction;
}

export function decideOnboardingEntry(options: {
  explicitAction?: ExplicitOnboardingAction;
  pendingProvisioning?: Identity | null;
  pendingWalletFlow?: 'onboarding' | 'generic' | 'settings-inbox';
}): OnboardingEntryDecision {
  const resumeAction =
    options.pendingProvisioning?.provisioningMode === 'device-join' &&
    options.pendingProvisioning.provisioningPending === true
      ? 'device-join'
      : undefined;

  // A user-started external-wallet handoff is the sole automatic resume path;
  // it restores only the chooser and session probe, never a signature prompt.
  // Other unauthenticated entries stay on choices. Legacy query parameters are
  // consumed so they cannot reopen a flow on refresh.
  return {
    view: options.pendingWalletFlow === 'onboarding' ? 'wallet' : 'landing',
    resumeAction,
    legacyActionToConsume: options.explicitAction,
  };
}

export function findPendingProvisioningIdentity(
  identities: Identity[]
): Identity | undefined {
  return identities
    .filter((identity) => identity.provisioningPending === true)
    .sort((left, right) => right.createdAt - left.createdAt)[0];
}

function hasLocalStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function hasIntentionalEmptyInboxState(): boolean {
  if (!hasLocalStorage()) {
    return false;
  }

  try {
    return window.localStorage.getItem(INTENTIONAL_EMPTY_KEY) === 'true';
  } catch {
    return false;
  }
}

export function markIntentionalEmptyInboxState(): void {
  if (!hasLocalStorage()) {
    return;
  }

  try {
    window.localStorage.setItem(INTENTIONAL_EMPTY_KEY, 'true');
  } catch {
    // An unavailable localStorage must not prevent an inbox wipe.
  }
}

export function clearIntentionalEmptyInboxState(): void {
  if (!hasLocalStorage()) {
    return;
  }

  try {
    window.localStorage.removeItem(INTENTIONAL_EMPTY_KEY);
  } catch {
    // Best effort only.
  }
}

export function requestProfileEditor(intent: ProfileEditorIntent): void {
  if (!hasLocalStorage()) {
    return;
  }

  try {
    window.localStorage.setItem(PROFILE_EDITOR_KEY, JSON.stringify(intent));
    window.dispatchEvent(
      new CustomEvent<ProfileEditorIntent>(PROFILE_EDITOR_INTENT_EVENT, { detail: intent })
    );
  } catch {
    // The generated profile remains usable even when the intent cannot persist.
  }
}

export function readProfileEditorIntent(): ProfileEditorIntent | null {
  if (!hasLocalStorage()) {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(PROFILE_EDITOR_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<ProfileEditorIntent>;
    if (
      typeof parsed.address !== 'string' ||
      (parsed.reason !== 'first-inbox' && parsed.reason !== 'new-inbox')
    ) {
      return null;
    }
    return {
      address: parsed.address,
      inboxId: typeof parsed.inboxId === 'string' ? parsed.inboxId : undefined,
      reason: parsed.reason,
    };
  } catch {
    return null;
  }
}

export function profileEditorIntentMatchesIdentity(
  intent: ProfileEditorIntent | null,
  identity: Identity | null | undefined
): boolean {
  if (!intent || !identity) {
    return false;
  }
  if (intent.inboxId && identity.inboxId) {
    return inboxIdsMatch(intent.inboxId, identity.inboxId);
  }
  return ethereumAddressesEqual(intent.address, identity.address);
}

export function clearProfileEditorIntent(): void {
  if (!hasLocalStorage()) {
    return;
  }

  try {
    window.localStorage.removeItem(PROFILE_EDITOR_KEY);
  } catch {
    // Best effort only.
  }
}
