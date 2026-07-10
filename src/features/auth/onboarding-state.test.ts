import { beforeEach, describe, expect, it } from 'vitest';
import type { Identity, InboxRegistryEntry } from '@/types';
import {
  clearIntentionalEmptyInboxState,
  clearProfileEditorIntent,
  findPendingProvisioningIdentity,
  hasIntentionalEmptyInboxState,
  markIntentionalEmptyInboxState,
  profileEditorIntentMatchesIdentity,
  readProfileEditorIntent,
  requestProfileEditor,
  shouldAutoCreateFirstInbox,
} from './onboarding-state';

const entry: InboxRegistryEntry = {
  inboxId: 'inbox-one',
  displayLabel: 'Orange Orca',
  primaryDisplayIdentity: 'Orange Orca',
  lastOpenedAt: 1,
  hasLocalDB: true,
};

const identity: Identity = {
  address: '0x1111111111111111111111111111111111111111',
  publicKey: '0xpublic',
  inboxId: 'inbox-one',
  createdAt: 1,
};

describe('onboarding state', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('auto-creates only for a hydrated, truly empty first visit', () => {
    expect(
      shouldAutoCreateFirstInbox({
        isRegistryHydrated: true,
        entries: [],
        hasExplicitOnboardingIntent: false,
        isIntentionalEmpty: false,
        hasPendingProvisioning: false,
      })
    ).toBe(true);

    expect(
      shouldAutoCreateFirstInbox({
        isRegistryHydrated: true,
        entries: [entry],
        hasExplicitOnboardingIntent: false,
        isIntentionalEmpty: false,
        hasPendingProvisioning: false,
      })
    ).toBe(false);
    expect(
      shouldAutoCreateFirstInbox({
        isRegistryHydrated: true,
        entries: [],
        hasExplicitOnboardingIntent: true,
        isIntentionalEmpty: false,
        hasPendingProvisioning: false,
      })
    ).toBe(false);
    expect(
      shouldAutoCreateFirstInbox({
        isRegistryHydrated: true,
        entries: [],
        hasExplicitOnboardingIntent: false,
        isIntentionalEmpty: true,
        hasPendingProvisioning: false,
      })
    ).toBe(false);
    expect(
      shouldAutoCreateFirstInbox({
        isRegistryHydrated: true,
        entries: [],
        hasExplicitOnboardingIntent: false,
        isIntentionalEmpty: false,
        hasPendingProvisioning: true,
      })
    ).toBe(false);
  });

  it('persists an intentional empty state until a new inbox succeeds', () => {
    markIntentionalEmptyInboxState();
    expect(hasIntentionalEmptyInboxState()).toBe(true);

    clearIntentionalEmptyInboxState();
    expect(hasIntentionalEmptyInboxState()).toBe(false);
  });

  it('restores the newest interrupted provisioning flow instead of treating it as first run', () => {
    const pendingJoin: Identity = {
      ...identity,
      address: '0x2222222222222222222222222222222222222222',
      createdAt: 3,
      provisioningMode: 'device-join',
      provisioningPending: true,
    };
    const olderPending: Identity = {
      ...identity,
      createdAt: 2,
      provisioningMode: 'new-inbox',
      provisioningPending: true,
    };

    expect(findPendingProvisioningIdentity([olderPending, pendingJoin])).toBe(pendingJoin);
  });

  it('persists a profile editor request and matches it by inbox', () => {
    requestProfileEditor({
      address: identity.address,
      inboxId: 'INBOX-ONE',
      reason: 'new-inbox',
    });

    const intent = readProfileEditorIntent();
    expect(intent?.reason).toBe('new-inbox');
    expect(profileEditorIntentMatchesIdentity(intent, identity)).toBe(true);
    expect(
      profileEditorIntentMatchesIdentity(intent, { ...identity, inboxId: 'another-inbox' })
    ).toBe(false);

    clearProfileEditorIntent();
    expect(readProfileEditorIntent()).toBeNull();
  });

  it('matches an address-only profile request after repairing repeated prefixes', () => {
    expect(
      profileEditorIntentMatchesIdentity(
        {
          address: `0X0x${identity.address.slice(2).toUpperCase()}`,
          reason: 'first-inbox',
        },
        { ...identity, inboxId: undefined }
      )
    ).toBe(true);
  });
});
