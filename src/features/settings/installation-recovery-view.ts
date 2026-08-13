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
    stagedInstallationId?: string;
    staleInstallationId?: string;
    hasLiveRepairCandidate?: boolean;
  }
): InstallationRecoveryView {
  if (recovery.localInstallationRegistered && !recovery.localInstallationVisible) {
    if (context?.hasLiveRepairCandidate) {
      return {
        canRepair: true,
        reason:
          'is registered in this live browser session but has not appeared on the inbox ledger yet',
        outcome:
          'Retry Repair This Browser to recheck and finish the same live installation. Converge will keep its key in memory and will not register, replace, or delete another installation while the inbox ledger is still settling. Once it appears, Converge will reopen this local database and require the exact same installation before reporting success.',
      };
    }
    return {
      canRepair: false,
      reason:
        'reports local registration but is absent from the inbox ledger',
      outcome:
        'The local database says it is registered, but the inbox ledger does not contain it. Check again after network state settles; Converge will not replace or delete this ambiguous database.',
    };
  }

  if (
    context?.installationRepairPending &&
    context.stagedInstallationId &&
    recovery.expectedInstallationVisible &&
    recovery.expectedInstallationId?.replace(/^(?:0x)+/i, '').toLowerCase() ===
      context.stagedInstallationId.replace(/^(?:0x)+/i, '').toLowerCase() &&
    !recovery.localInstallationVisible
  ) {
    return {
      canRepair: false,
      reason: 'lost the local key for an interrupted installation that now appears on the inbox ledger',
      outcome:
        'Converge will not register another installation over this ambiguous partial repair. Keep this database intact and restore from another device or contact support before replacing it.',
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
        'The inspected installation is already present on the inbox ledger. Repair will confirm it on this live connection, then reopen the saved local database and require that exact installation before reporting success. It will not use another installation slot.',
    };
  }

  if (recovery.signerIsRecoveryIdentifier && recovery.expectedInstallationVisible) {
    const outcome =
      recovery.existingInstallationCount >= 10
        ? 'This inbox is at 10/10. Repair will first remove only the exact saved unavailable installation. It will then save and register the replacement on one live connection, reopen the same local database, and require the exact replacement before reporting success.'
        : `Repair will save and register the replacement on one live connection, then reopen the same local database and require the exact replacement before reporting success. Only then will it try to remove the exact saved unavailable installation. The inbox should return to about ${recovery.existingInstallationCount}/10; if cleanup does not settle, the verified replacement remains connected and the prior ID can be revoked later.`;
    return {
      canRepair: true,
      reason:
        recovery.reason === 'installation-mismatch'
          ? 'opened a different installation'
          : 'has not been registered',
      outcome,
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
        'Converge will first recheck the inbox ledger and the exact prior installation, removing only that unavailable prior installation if a slot is needed. An unregistered installation ID can change after its connection closes, so this attempt will save and register the installation it opens before closing it. Converge will then reopen the same local database and require that exact installation before reporting success.',
    };
  }

  return {
    canRepair: true,
    reason:
      recovery.reason === 'installation-mismatch'
        ? 'opened a different installation'
        : 'has not been registered',
    outcome: `Repair will use one open slot (${recovery.existingInstallationCount}/10 → ${recovery.existingInstallationCount + 1}/10). It will save and register the installation on one live connection, then reopen the same local database and require that exact installation before reporting success. The old installation remains available for later cleanup.`,
  };
}
