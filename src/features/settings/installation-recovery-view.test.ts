import { describe, expect, it } from 'vitest';
import type { InstallationRecoveryDetails } from '@/lib/xmtp/client-registration';
import { getInstallationRecoveryView } from './installation-recovery-view';

const base: InstallationRecoveryDetails = {
  reason: 'installation-mismatch',
  inboxId: 'a'.repeat(64),
  expectedInstallationId: 'saved',
  localInstallationId: 'candidate',
  expectedInstallationVisible: true,
  localInstallationVisible: false,
  localInstallationRegistered: false,
  signerIsRecoveryIdentifier: true,
  existingInstallationCount: 8,
  databasePathMode: 'inbox-default',
};

describe('installation recovery Settings view', () => {
  it('describes replacement-first recovery and retained cleanup fallback at 8/10', () => {
    expect(getInstallationRecoveryView(base)).toEqual({
      canRepair: true,
      reason: 'opened a different installation',
      outcome:
        'Repair will save and verify the installation from this live database attempt before trying to remove only the exact saved unavailable installation. The inbox should return to about 8/10; if cleanup does not settle, the verified replacement remains connected and the prior ID can be revoked later.',
    });
  });

  it('describes exact predecessor cleanup before registration at 10/10', () => {
    expect(
      getInstallationRecoveryView({
        ...base,
        existingInstallationCount: 10,
      })
    ).toMatchObject({
      canRepair: true,
      outcome: expect.stringContaining('first remove only the exact saved unavailable'),
    });
  });

  it('describes use of one available slot for a non-recovery account key', () => {
    const view = getInstallationRecoveryView({
      ...base,
      signerIsRecoveryIdentifier: false,
    });

    expect(view).toMatchObject({
      canRepair: true,
      outcome: expect.stringContaining('8/10 → 9/10'),
    });
    expect(view.outcome).toContain('without reopening it');
    expect(view.outcome).not.toContain('same staged candidate');
  });

  it('does not offer repair for ambiguous local-ready network-absent state', () => {
    expect(
      getInstallationRecoveryView({
        ...base,
        localInstallationRegistered: true,
      })
    ).toMatchObject({
      canRepair: false,
      outcome: expect.stringContaining('will not replace or delete'),
    });
  });

  it('retries a local-ready network-absent candidate while its live key is retained', () => {
    expect(
      getInstallationRecoveryView(
        {
          ...base,
          localInstallationRegistered: true,
        },
        {
          installationRepairPending: true,
          stagedInstallationId: 'candidate',
          staleInstallationId: 'saved',
          hasLiveRepairCandidate: true,
        }
      )
    ).toEqual({
      canRepair: true,
      reason:
        'is registered in this live browser session but has not appeared on the inbox ledger yet',
      outcome:
        'Retry Repair This Browser to recheck and finish the same live installation. Converge will keep its key in memory and will not register, replace, or delete another installation while the ledger is still settling.',
    });
  });

  it('does not replace a ledger-visible interrupted candidate whose local key was lost', () => {
    expect(
      getInstallationRecoveryView(
        {
          ...base,
          expectedInstallationId: 'staged-candidate',
          localInstallationId: 'new-ephemeral-candidate',
          expectedInstallationVisible: true,
          localInstallationVisible: false,
          localInstallationRegistered: false,
        },
        {
          installationRepairPending: true,
          stagedInstallationId: 'staged-candidate',
          staleInstallationId: 'saved-old',
        }
      )
    ).toMatchObject({
      canRepair: false,
      outcome: expect.stringContaining('will not register another installation'),
    });
  });

  it('does not offer repair at 10/10 without exact recovery authority', () => {
    expect(
      getInstallationRecoveryView({
        ...base,
        existingInstallationCount: 10,
        signerIsRecoveryIdentifier: false,
      })
    ).toMatchObject({
      canRepair: false,
      outcome: expect.stringContaining('10/10'),
    });
  });

  it('offers exact-candidate resume at 10/10 when it is already ledger-visible', () => {
    expect(
      getInstallationRecoveryView({
        ...base,
        expectedInstallationVisible: false,
        localInstallationVisible: true,
        existingInstallationCount: 10,
        signerIsRecoveryIdentifier: false,
      })
    ).toEqual({
      canRepair: true,
      reason: 'opened a different installation',
      outcome:
        'The inspected installation is already present on the inbox ledger. Repair will verify it without using another installation slot.',
    });
  });

  it('explains that an interrupted unregistered candidate may change at 10/10', () => {
    expect(
      getInstallationRecoveryView(
        {
          ...base,
          expectedInstallationId: 'candidate',
          expectedInstallationVisible: false,
          existingInstallationCount: 10,
        },
        {
          installationRepairPending: true,
          staleInstallationId: 'saved-old',
        }
      )
    ).toEqual({
      canRepair: true,
      reason: 'opened a different installation',
      outcome:
        'Converge will recheck the ledger and the exact prior installation, then open the local database once for this repair attempt. An unregistered installation ID may change after its worker closes, so the attempt saves and registers the ID it opens without reopening it.',
    });
  });
});
