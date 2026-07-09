import type { Identity } from '@/types';

export type ClientRegistrationPolicy = 'new-inbox' | 'existing-inbox' | 'resume-only';

export function registrationCapabilities(policy: ClientRegistrationPolicy): {
  allowInboxCreation: boolean;
  allowInstallationRegistration: boolean;
} {
  return {
    allowInboxCreation: policy === 'new-inbox',
    allowInstallationRegistration: policy !== 'resume-only',
  };
}

export function registrationPolicyForStoredIdentity(
  identity: Identity,
  isPendingProvisioning: boolean
): ClientRegistrationPolicy {
  if (!isPendingProvisioning) {
    return 'resume-only';
  }
  if (identity.provisioningMode === 'new-inbox') {
    return 'new-inbox';
  }
  if (identity.provisioningMode === 'keyfile-restore') {
    return identity.expectedInboxId ? 'existing-inbox' : 'new-inbox';
  }
  return 'resume-only';
}
