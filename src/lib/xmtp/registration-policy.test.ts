import { describe, expect, it } from 'vitest';
import type { Identity } from '@/types';
import {
  registrationCapabilities,
  registrationPolicyForStoredIdentity,
} from './registration-policy';

const identity = (overrides: Partial<Identity>): Identity => ({
  address: `0x${'11'.repeat(20)}`,
  publicKey: '',
  createdAt: 1,
  ...overrides,
});

describe('XMTP registration policy', () => {
  it('allows inbox creation only for an explicit new-inbox flow', () => {
    expect(registrationCapabilities('new-inbox')).toEqual({
      allowInboxCreation: true,
      allowInstallationRegistration: true,
    });
    expect(registrationCapabilities('existing-inbox')).toEqual({
      allowInboxCreation: false,
      allowInstallationRegistration: true,
    });
    expect(registrationCapabilities('resume-only')).toEqual({
      allowInboxCreation: false,
      allowInstallationRegistration: false,
    });
  });

  it('resumes fresh inbox and keyfile transitions without broadening normal reloads', () => {
    expect(
      registrationPolicyForStoredIdentity(
        identity({ provisioningMode: 'new-inbox', provisioningPending: true }),
        true
      )
    ).toBe('new-inbox');
    expect(
      registrationPolicyForStoredIdentity(
        identity({
          provisioningMode: 'keyfile-restore',
          provisioningPending: true,
          expectedInboxId: 'a'.repeat(64),
        }),
        true
      )
    ).toBe('existing-inbox');
    expect(
      registrationPolicyForStoredIdentity(
        identity({ provisioningMode: 'device-join', provisioningPending: true }),
        true
      )
    ).toBe('resume-only');
    expect(registrationPolicyForStoredIdentity(identity({ provisioningPending: false }), false)).toBe(
      'resume-only'
    );
  });
});
