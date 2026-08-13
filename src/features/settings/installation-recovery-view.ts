import type { InstallationRecoveryDetails } from '@/lib/xmtp/client-registration';

export interface InstallationRecoveryView {
  canRepair: boolean;
  reason: string;
  outcome: string;
}

export function getInstallationRecoveryView(
  recovery: InstallationRecoveryDetails,
  context?: {
    installationRepairPending?: boolean;
    staleInstallationId?: string;
  }
): InstallationRecoveryView {
  if (recovery.localInstallationRegistered && !recovery.localInstallationVisible) {
    return {
      canRepair: false,
      reason:
        'reports local registration but is absent from the inbox ledger',
      outcome:
        'The local database says it is registered, but the inbox ledger does not contain it. Check again after network state settles; Converge will not replace or delete this ambiguous database.',
    };
  }

  if (
    recovery.existingInstallationCount >= 10 &&
    !(
      recovery.localInstallationVisible ||
      recovery.signerIsRecoveryIdentifier &&
      (recovery.expectedInstallationVisible ||
        (context?.installationRepairPending && context.staleInstallationId))
    )
  ) {
    return {
      canRepair: false,
      reason:
        recovery.reason === 'installation-mismatch'
          ? 'opened a different installation'
          : 'has not been registered',
      outcome:
        'This inbox is at 10/10 and this key cannot remove the exact saved installation. Revoke one installation from the recovery wallet or another connected device, then check again.',
    };
  }

  if (recovery.localInstallationVisible) {
    return {
      canRepair: true,
      reason:
        recovery.reason === 'installation-mismatch'
          ? 'opened a different installation'
          : 'has not been registered locally',
      outcome:
        'Repair will resume this exact installation, which is already present on the inbox ledger. It will not use another installation slot.',
    };
  }

  if (recovery.signerIsRecoveryIdentifier && recovery.expectedInstallationVisible) {
    return {
      canRepair: true,
      reason:
        recovery.reason === 'installation-mismatch'
          ? 'opened a different installation'
          : 'has not been registered',
      outcome: `Repair will replace only the saved unavailable installation. The inbox should remain at about ${recovery.existingInstallationCount}/10.`,
    };
  }

  if (
    recovery.signerIsRecoveryIdentifier &&
    context?.installationRepairPending &&
    context.staleInstallationId
  ) {
    return {
      canRepair: true,
      reason:
        recovery.reason === 'installation-mismatch'
          ? 'opened a different installation'
          : 'has not been registered',
      outcome:
        'Resume will reuse the same staged candidate and recheck the exact prior installation before any mutation. If that prior ID cannot be removed, repair stops without creating another candidate.',
    };
  }

  return {
    canRepair: true,
    reason:
      recovery.reason === 'installation-mismatch'
        ? 'opened a different installation'
        : 'has not been registered',
    outcome: `Repair will use one open slot (${recovery.existingInstallationCount}/10 → ${recovery.existingInstallationCount + 1}/10). The old installation remains available for later cleanup.`,
  };
}
