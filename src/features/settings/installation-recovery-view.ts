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
          'Retry Repair This Browser to recheck and finish the same live installation. Converge will keep its key in memory and will not register, replace, or delete another installation while the ledger is still settling.',
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
        'The inspected installation is already present on the inbox ledger. Repair will verify it without using another installation slot.',
    };
  }

  if (recovery.signerIsRecoveryIdentifier && recovery.expectedInstallationVisible) {
    const outcome =
      recovery.existingInstallationCount >= 10
        ? 'This inbox is at 10/10. Repair will first remove only the exact saved unavailable installation, then save and register the installation from this live database attempt without reopening it.'
        : `Repair will save and verify the installation from this live database attempt before trying to remove only the exact saved unavailable installation. The inbox should return to about ${recovery.existingInstallationCount}/10; if cleanup does not settle, the verified replacement remains connected and the prior ID can be revoked later.`;
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
        'Converge will recheck the ledger and the exact prior installation, then open the local database once for this repair attempt. An unregistered installation ID may change after its worker closes, so the attempt saves and registers the ID it opens without reopening it.',
    };
  }

  return {
    canRepair: true,
    reason:
      recovery.reason === 'installation-mismatch'
        ? 'opened a different installation'
        : 'has not been registered',
    outcome: `Repair will open the local database once, save and register the installation from that live attempt without reopening it, and use one open slot (${recovery.existingInstallationCount}/10 → ${recovery.existingInstallationCount + 1}/10). The old installation remains available for later cleanup.`,
  };
}
