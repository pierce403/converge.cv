import { beforeEach, describe, expect, it } from 'vitest';
import type { Identity } from '@/types';
import {
  clearIntentionalEmptyInboxState,
  clearProfileEditorIntent,
  decideOnboardingEntry,
  findPendingProvisioningIdentity,
  hasIntentionalEmptyInboxState,
  markIntentionalEmptyInboxState,
  profileEditorIntentMatchesIdentity,
  readProfileEditorIntent,
  requestProfileEditor,
} from './onboarding-state';

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

  it('persists an intentional empty state until a new inbox succeeds', () => {
    markIntentionalEmptyInboxState();
    expect(hasIntentionalEmptyInboxState()).toBe(true);

    clearIntentionalEmptyInboxState();
    expect(hasIntentionalEmptyInboxState()).toBe(false);
  });

  it('finds the newest interrupted provisioning flow without auto-opening it', () => {
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

  it('keeps a clean onboarding state on the landing choices', () => {
    expect(decideOnboardingEntry({})).toEqual({
      view: 'landing',
      resumeAction: undefined,
      legacyActionToConsume: undefined,
    });
  });

  it('keeps a pending device join on landing with an explicit resume action', () => {
    const pendingJoin: Identity = {
      ...identity,
      provisioningMode: 'device-join',
      provisioningPending: true,
    };

    expect(decideOnboardingEntry({ pendingProvisioning: pendingJoin })).toEqual({
      view: 'landing',
      resumeAction: 'device-join',
      legacyActionToConsume: undefined,
    });
  });

  it('consumes legacy entry actions without skipping the landing choices', () => {
    expect(decideOnboardingEntry({ explicitAction: 'connect' })).toEqual({
      view: 'landing',
      resumeAction: undefined,
      legacyActionToConsume: 'connect',
    });
    expect(decideOnboardingEntry({ explicitAction: 'import' })).toEqual({
      view: 'landing',
      resumeAction: undefined,
      legacyActionToConsume: 'import',
    });
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
