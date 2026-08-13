import { IdentifierKind, type InboxState, type Identifier } from '@xmtp/browser-sdk';
import { describe, expect, it, vi } from 'vitest';
import { prepareInstallationRepair } from './installation-repair';

const inboxId = 'a'.repeat(64);
const signerIdentifier: Identifier = {
  identifier: `0x${'11'.repeat(20)}`,
  identifierKind: IdentifierKind.Ethereum,
};
const otherRecoveryIdentifier: Identifier = {
  identifier: `0x${'22'.repeat(20)}`,
  identifierKind: IdentifierKind.Ethereum,
};

const installation = (id: string) => ({
  id,
  bytes: new TextEncoder().encode(id),
});

function state(
  installationIds: string[],
  recoveryIdentifier: Identifier = signerIdentifier
): InboxState {
  return {
    inboxId,
    accountIdentifiers: [signerIdentifier],
    recoveryIdentifier,
    installations: installationIds.map(installation),
  } as InboxState;
}

describe('explicit browser installation repair', () => {
  it('persists one candidate before revoking only the exact superseded installation', async () => {
    let current = state(['saved-old', ...Array.from({ length: 7 }, (_, index) => `other-${index}`)]);
    const events: string[] = [];
    const revokeInstallation = vi.fn(async (_inboxId: string, bytes: Uint8Array[]) => {
      events.push(`revoke:${new TextDecoder().decode(bytes[0])}`);
      current = state(current.installations.filter((item) => item.id !== 'saved-old').map((item) => item.id));
    });

    const result = await prepareInstallationRepair(
      {
        inboxId,
        candidateInstallationId: 'candidate-new',
        previousInstallationId: 'saved-old',
        candidateLocallyRegistered: false,
        signerIdentifier,
        databasePathMode: 'inbox-default',
      },
      {
        fetchInboxState: vi.fn(async () => current),
        revokeInstallation,
        onCandidateReady: vi.fn(async ({ candidateInstallationId }) => {
          events.push(`persist:${candidateInstallationId}`);
        }),
        sleep: vi.fn(async () => undefined),
      }
    );

    expect(events).toEqual(['persist:candidate-new', 'revoke:saved-old']);
    expect(revokeInstallation).toHaveBeenCalledWith(inboxId, [installation('saved-old').bytes]);
    expect(result).toMatchObject({
      candidateInstallationId: 'candidate-new',
      previousInstallationId: 'saved-old',
      previousInstallationRevoked: true,
      previousInstallationAbsent: false,
      registrationRequired: true,
      existingInstallationCount: 7,
    });
  });

  it('uses an available slot without revoking another installation when the signer is not recovery authority', async () => {
    const current = state(
      ['saved-old', ...Array.from({ length: 7 }, (_, index) => `other-${index}`)],
      otherRecoveryIdentifier
    );
    const revokeInstallation = vi.fn(async () => undefined);
    const onCandidateReady = vi.fn(async () => undefined);

    const result = await prepareInstallationRepair(
      {
        inboxId,
        candidateInstallationId: 'candidate-new',
        previousInstallationId: 'saved-old',
        candidateLocallyRegistered: false,
        signerIdentifier,
        databasePathMode: 'inbox-default',
      },
      {
        fetchInboxState: vi.fn(async () => current),
        revokeInstallation,
        onCandidateReady,
      }
    );

    expect(result.previousInstallationRevoked).toBe(false);
    expect(result.previousInstallationAbsent).toBe(false);
    expect(result.existingInstallationCount).toBe(8);
    expect(onCandidateReady).toHaveBeenCalledOnce();
    expect(revokeInstallation).not.toHaveBeenCalled();
  });

  it('stops at 10/10 before persisting or registering a candidate when exact revocation is unavailable', async () => {
    const current = state(
      ['saved-old', ...Array.from({ length: 9 }, (_, index) => `other-${index}`)],
      otherRecoveryIdentifier
    );
    const onCandidateReady = vi.fn(async () => undefined);
    const revokeInstallation = vi.fn(async () => undefined);

    await expect(
      prepareInstallationRepair(
        {
          inboxId,
          candidateInstallationId: 'candidate-new',
          previousInstallationId: 'saved-old',
          candidateLocallyRegistered: false,
          signerIdentifier,
          databasePathMode: 'legacy-address',
        },
        {
          fetchInboxState: vi.fn(async () => current),
          revokeInstallation,
          onCandidateReady,
        }
      )
    ).rejects.toThrow(/10\/10/);
    expect(onCandidateReady).not.toHaveBeenCalled();
    expect(revokeInstallation).not.toHaveBeenCalled();
  });

  it('settles a revoke that committed even when its request threw', async () => {
    let current = state(['saved-old']);
    const revokeInstallation = vi.fn(async () => {
      current = state([]);
      throw new Error('response interrupted');
    });

    await expect(
      prepareInstallationRepair(
        {
          inboxId,
          candidateInstallationId: 'candidate-new',
          previousInstallationId: 'saved-old',
          candidateLocallyRegistered: false,
          signerIdentifier,
          databasePathMode: 'inbox-default',
        },
        {
          fetchInboxState: vi.fn(async () => current),
          revokeInstallation,
          onCandidateReady: vi.fn(async () => undefined),
          sleep: vi.fn(async () => undefined),
        }
      )
    ).resolves.toMatchObject({ previousInstallationRevoked: true });
    expect(revokeInstallation).toHaveBeenCalledOnce();
  });

  it('stops when exact revocation is rejected instead of silently consuming a slot', async () => {
    const current = state(['saved-old', ...Array.from({ length: 7 }, (_, index) => `other-${index}`)]);
    const revokeInstallation = vi.fn(async () => {
      throw new Error('signature chain rejected');
    });

    await expect(
      prepareInstallationRepair(
        {
          inboxId,
          candidateInstallationId: 'candidate-new',
          previousInstallationId: 'saved-old',
          candidateLocallyRegistered: false,
          signerIdentifier,
          databasePathMode: 'inbox-default',
        },
        {
          fetchInboxState: vi.fn(async () => current),
          revokeInstallation,
          onCandidateReady: vi.fn(async () => undefined),
          sleep: vi.fn(async () => undefined),
        }
      )
    ).rejects.toThrow(/signature chain rejected/i);
    expect(revokeInstallation).toHaveBeenCalledOnce();
  });

  it('never replaces a locally registered database that is missing from the ledger', async () => {
    const onCandidateReady = vi.fn(async () => undefined);
    const revokeInstallation = vi.fn(async () => undefined);

    await expect(
      prepareInstallationRepair(
        {
          inboxId,
          candidateInstallationId: 'candidate-new',
          previousInstallationId: 'saved-old',
          candidateLocallyRegistered: true,
          signerIdentifier,
          databasePathMode: 'inbox-default',
        },
        {
          fetchInboxState: vi.fn(async () => state(['saved-old'])),
          revokeInstallation,
          onCandidateReady,
        }
      )
    ).rejects.toThrow(/left the database untouched/i);
    expect(onCandidateReady).not.toHaveBeenCalled();
    expect(revokeInstallation).not.toHaveBeenCalled();
  });

  it('preserves the same staged candidate if capacity reaches 10 before registration', async () => {
    let current = state(Array.from({ length: 8 }, (_, index) => `other-${index}`), otherRecoveryIdentifier);
    const onCandidateReady = vi.fn(async () => {
      current = state(Array.from({ length: 10 }, (_, index) => `other-${index}`), otherRecoveryIdentifier);
    });

    await expect(
      prepareInstallationRepair(
        {
          inboxId,
          candidateInstallationId: 'candidate-new',
          candidateLocallyRegistered: false,
          signerIdentifier,
          databasePathMode: 'inbox-default',
        },
        {
          fetchInboxState: vi.fn(async () => current),
          revokeInstallation: vi.fn(async () => undefined),
          onCandidateReady,
        }
      )
    ).rejects.toThrow(/while repair was preparing/i);
    expect(onCandidateReady).toHaveBeenCalledOnce();
  });

  it('marks an interrupted repair previous ID settled when it is already absent on retry', async () => {
    const result = await prepareInstallationRepair(
      {
        inboxId,
        candidateInstallationId: 'candidate-new',
        previousInstallationId: 'saved-old',
        candidateLocallyRegistered: false,
        signerIdentifier,
        databasePathMode: 'inbox-default',
      },
      {
        fetchInboxState: vi.fn(async () => state([])),
        revokeInstallation: vi.fn(async () => undefined),
        onCandidateReady: vi.fn(async () => undefined),
      }
    );

    expect(result).toMatchObject({
      previousInstallationId: undefined,
      previousInstallationRevoked: false,
      previousInstallationAbsent: true,
      registrationRequired: true,
    });
  });
});
