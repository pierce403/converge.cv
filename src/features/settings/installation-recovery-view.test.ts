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
  it('describes the exact one-for-one 8/10 recovery', () => {
    expect(getInstallationRecoveryView(base)).toEqual({
      canRepair: true,
      reason: 'opened a different installation',
      outcome:
        'Repair will replace only the saved unavailable installation. The inbox should remain at about 8/10.',
    });
  });

  it('describes use of one available slot for a non-recovery account key', () => {
    expect(
      getInstallationRecoveryView({
        ...base,
        signerIsRecoveryIdentifier: false,
      })
    ).toMatchObject({
      canRepair: true,
      outcome: expect.stringContaining('8/10 → 9/10'),
    });
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
        'Repair will resume this exact installation, which is already present on the inbox ledger. It will not use another installation slot.',
    });
  });

  it('offers the same candidate after an interrupted repair at 10/10', () => {
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
        'Resume will reuse the same staged candidate and recheck the exact prior installation before any mutation. If that prior ID cannot be removed, repair stops without creating another candidate.',
    });
  });
});
