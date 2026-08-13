import { IdentifierKind, type InboxState, type Identifier } from '@xmtp/browser-sdk';
import { describe, expect, it, vi } from 'vitest';
import {
  InstallationRecoveryRequiredError,
  type InstallationRecoveryDetails,
  type RegistrationClient,
} from './client-registration';
import {
  prepareInstallationRepair,
  runInstallationRepairSession,
  selectPreviousInstallationForRepair,
} from './installation-repair';

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
  it('keeps the exact stale predecessor across prospective candidate rotations', () => {
    expect(
      selectPreviousInstallationForRepair(
        {
          installationId: 'staged-candidate',
          staleInstallationId: 'saved-old',
          installationRepairPending: true,
        },
        {
          expectedInstallationId: 'staged-candidate',
          localInstallationId: 'new-ephemeral-candidate',
        }
      )
    ).toBe('saved-old');
    expect(
      selectPreviousInstallationForRepair(
        {
          installationId: 'saved-old',
          installationRepairPending: false,
        },
        {
          expectedInstallationId: 'saved-old',
          localInstallationId: 'new-ephemeral-candidate',
        }
      )
    ).toBe('saved-old');
  });

  it('persists one candidate but keeps the exact superseded installation until registration when capacity is available', async () => {
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

    expect(events).toEqual(['persist:candidate-new']);
    expect(revokeInstallation).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      candidateInstallationId: 'candidate-new',
      previousInstallationId: 'saved-old',
      previousInstallationRevoked: false,
      previousInstallationAbsent: false,
      registrationRequired: true,
      existingInstallationCount: 8,
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
    let current = state([
      'saved-old',
      ...Array.from({ length: 9 }, (_, index) => `other-${index}`),
    ]);
    const revokeInstallation = vi.fn(async () => {
      current = state(current.installations.filter((item) => item.id !== 'saved-old').map((item) => item.id));
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
    const current = state(['saved-old', ...Array.from({ length: 9 }, (_, index) => `other-${index}`)]);
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

  it('preserves the repair journal if capacity reaches 10 before registration', async () => {
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

describe('browser installation repair session', () => {
  const recovery = (
    overrides: Partial<InstallationRecoveryDetails> = {}
  ): InstallationRecoveryDetails => ({
    reason: 'installation-unregistered',
    inboxId,
    localInstallationId: 'candidate-a',
    expectedInstallationVisible: false,
    localInstallationVisible: false,
    localInstallationRegistered: false,
    signerIsRecoveryIdentifier: true,
    existingInstallationCount: 0,
    databasePathMode: 'inbox-default',
    ...overrides,
  });

  it('rebases an ephemeral candidate and stages then registers the opened client itself', async () => {
    const events: string[] = [];
    let registered = false;
    let current = state([]);
    const register = vi.fn(async function (this: RegistrationClient) {
      expect(this).toBe(client);
      events.push(`register:${this.installationId}`);
      registered = true;
      current = state(['candidate-b']);
    });
    const client: RegistrationClient = {
      inboxId,
      installationId: 'candidate-b',
      isRegistered: vi.fn(async () => registered),
      register,
    };

    const result = await runInstallationRepairSession(
      {
        client,
        recovery: recovery(),
        signerIdentifier,
        expectedInboxId: inboxId,
        previousInstallationId: 'candidate-a',
        databasePathMode: 'inbox-default',
      },
      {
        resolveInboxId: vi.fn(async () => inboxId),
        fetchInboxState: vi.fn(async () => current),
        revokeInstallation: vi.fn(async () => undefined),
        onCandidateReady: vi.fn(async ({ candidateInstallationId }) => {
          events.push(`stage:${candidateInstallationId}`);
        }),
        onInstallationReady: vi.fn(async ({ installationId, installationRegistered }) => {
          events.push(`ready:${installationId}:${installationRegistered}`);
        }),
        sleep: vi.fn(async () => undefined),
      }
    );

    expect(events).toEqual([
      'stage:candidate-b',
      'ready:candidate-b:false',
      'register:candidate-b',
      'ready:candidate-b:true',
    ]);
    expect(register).toHaveBeenCalledOnce();
    expect(result.candidateInstallationId).toBe('candidate-b');
    expect(result.preparation).toMatchObject({
      candidateInstallationId: 'candidate-b',
      previousInstallationAbsent: true,
      registrationRequired: true,
    });
    expect(result.registration).toMatchObject({
      inboxId,
      installationId: 'candidate-b',
      installationRegistered: true,
    });
  });

  it('registers before optional exact cleanup at 8/10 and succeeds when cleanup is rejected', async () => {
    const events: string[] = [];
    let registered = false;
    let current = state([
      'saved-old',
      ...Array.from({ length: 7 }, (_, index) => `other-${index}`),
    ]);
    const register = vi.fn(async () => {
      events.push('register:candidate-b');
      registered = true;
      current = state([
        'saved-old',
        ...Array.from({ length: 7 }, (_, index) => `other-${index}`),
        'candidate-b',
      ]);
    });
    const client: RegistrationClient = {
      inboxId,
      installationId: 'candidate-b',
      isRegistered: vi.fn(async () => registered),
      register,
    };
    const revokeInstallation = vi.fn(async () => {
      events.push('revoke:saved-old');
      throw new Error('cleanup signature rejected');
    });
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const result = await (async () => {
      try {
        return await runInstallationRepairSession(
          {
            client,
            recovery: recovery({ existingInstallationCount: 8 }),
            signerIdentifier,
            expectedInboxId: inboxId,
            previousInstallationId: 'saved-old',
            databasePathMode: 'inbox-default',
          },
          {
            resolveInboxId: vi.fn(async () => inboxId),
            fetchInboxState: vi.fn(async () => current),
            revokeInstallation,
            onCandidateReady: vi.fn(async () => {
              events.push('stage:candidate-b');
            }),
            onInstallationReady: vi.fn(async ({ installationRegistered }) => {
              if (installationRegistered) events.push('verified:candidate-b');
            }),
            sleep: vi.fn(async () => undefined),
          }
        );
      } finally {
        warning.mockRestore();
      }
    })();

    expect(events).toEqual([
      'stage:candidate-b',
      'register:candidate-b',
      'verified:candidate-b',
      'revoke:saved-old',
    ]);
    expect(register).toHaveBeenCalledOnce();
    expect(revokeInstallation).toHaveBeenCalledOnce();
    expect(revokeInstallation).toHaveBeenCalledWith(inboxId, [installation('saved-old').bytes]);
    expect(current.installations.map((item) => item.id)).toContain('saved-old');
    expect(result.registration).toMatchObject({
      installationId: 'candidate-b',
      installationRegistered: true,
    });
    expect(result.preparation).toMatchObject({
      previousInstallationId: 'saved-old',
      previousInstallationRevoked: false,
      previousInstallationAbsent: false,
    });
  });

  it('verifies candidate durability after registration and before optional prior cleanup', async () => {
    const events: string[] = [];
    const durabilityFailure = new Error('registered candidate did not survive reopen');
    let registered = false;
    let current = state([
      'saved-old',
      ...Array.from({ length: 7 }, (_, index) => `other-${index}`),
    ]);
    const client: RegistrationClient = {
      inboxId,
      installationId: 'candidate-b',
      isRegistered: vi.fn(async () => registered),
      register: vi.fn(async () => {
        events.push('register:candidate-b');
        registered = true;
        current = state([
          'saved-old',
          ...Array.from({ length: 7 }, (_, index) => `other-${index}`),
          'candidate-b',
        ]);
      }),
    };
    const revokeInstallation = vi.fn(async () => {
      events.push('revoke:saved-old');
    });

    await expect(
      runInstallationRepairSession(
        {
          client,
          recovery: recovery({ existingInstallationCount: 8 }),
          signerIdentifier,
          expectedInboxId: inboxId,
          previousInstallationId: 'saved-old',
          databasePathMode: 'inbox-default',
        },
        {
          resolveInboxId: vi.fn(async () => inboxId),
          fetchInboxState: vi.fn(async () => current),
          revokeInstallation,
          onCandidateReady: vi.fn(async () => {
            events.push('stage:candidate-b');
          }),
          onInstallationReady: vi.fn(async ({ installationRegistered }) => {
            if (installationRegistered) events.push('verified:candidate-b');
          }),
          verifyCandidateDurability: vi.fn(async () => {
            events.push('durable:candidate-b');
            throw durabilityFailure;
          }),
          sleep: vi.fn(async () => undefined),
        }
      )
    ).rejects.toBe(durabilityFailure);

    expect(events).toEqual([
      'stage:candidate-b',
      'register:candidate-b',
      'verified:candidate-b',
      'durable:candidate-b',
    ]);
    expect(revokeInstallation).not.toHaveBeenCalled();
  });

  it('stages and revokes the exact predecessor before registering at 10/10', async () => {
    const events: string[] = [];
    let registered = false;
    let current = state([
      'saved-old',
      ...Array.from({ length: 9 }, (_, index) => `other-${index}`),
    ]);
    const register = vi.fn(async () => {
      events.push('register:candidate-b');
      registered = true;
      current = state([
        ...Array.from({ length: 9 }, (_, index) => `other-${index}`),
        'candidate-b',
      ]);
    });
    const client: RegistrationClient = {
      inboxId,
      installationId: 'candidate-b',
      isRegistered: vi.fn(async () => registered),
      register,
    };
    const revokeInstallation = vi.fn(async () => {
      events.push('revoke:saved-old');
      current = state(
        current.installations
          .filter((item) => item.id !== 'saved-old')
          .map((item) => item.id)
      );
    });

    const result = await runInstallationRepairSession(
      {
        client,
        recovery: recovery({ existingInstallationCount: 10 }),
        signerIdentifier,
        expectedInboxId: inboxId,
        previousInstallationId: 'saved-old',
        databasePathMode: 'inbox-default',
      },
      {
        resolveInboxId: vi.fn(async () => inboxId),
        fetchInboxState: vi.fn(async () => current),
        revokeInstallation,
        onCandidateReady: vi.fn(async () => {
          events.push('stage:candidate-b');
        }),
        onInstallationReady: vi.fn(async () => undefined),
        sleep: vi.fn(async () => undefined),
      }
    );

    expect(events).toEqual([
      'stage:candidate-b',
      'revoke:saved-old',
      'register:candidate-b',
    ]);
    expect(revokeInstallation).toHaveBeenCalledWith(inboxId, [installation('saved-old').bytes]);
    expect(register).toHaveBeenCalledOnce();
    expect(result.registration.installationId).toBe('candidate-b');
    expect(result.preparation).toMatchObject({
      previousInstallationRevoked: true,
      previousInstallationAbsent: false,
    });
  });

  it('refreshes a partial registration failure for the same candidate without registering twice', async () => {
    let current = state([]);
    const register = vi.fn(async () => {
      current = state(['candidate-b']);
      throw new Error('registration response interrupted');
    });
    const client: RegistrationClient = {
      inboxId,
      installationId: 'candidate-b',
      isRegistered: vi.fn(async () => false),
      register,
    };

    const failure = runInstallationRepairSession(
      {
        client,
        recovery: recovery(),
        signerIdentifier,
        expectedInboxId: inboxId,
        previousInstallationId: 'candidate-a',
        databasePathMode: 'inbox-default',
      },
      {
        resolveInboxId: vi.fn(async () => inboxId),
        fetchInboxState: vi.fn(async () => current),
        revokeInstallation: vi.fn(async () => undefined),
        onCandidateReady: vi.fn(async () => undefined),
        onInstallationReady: vi.fn(async () => undefined),
        sleep: vi.fn(async () => undefined),
      }
    );

    await expect(failure).rejects.toBeInstanceOf(InstallationRecoveryRequiredError);
    await expect(failure).rejects.toMatchObject({
      details: {
        reason: 'installation-unregistered',
        inboxId,
        expectedInstallationId: 'candidate-b',
        localInstallationId: 'candidate-b',
        expectedInstallationVisible: true,
        localInstallationVisible: true,
        localInstallationRegistered: false,
      },
    });
    expect(register).toHaveBeenCalledOnce();
  });

  it('does not replace a ledger-visible interrupted candidate after its local key was lost', async () => {
    const client: RegistrationClient = {
      inboxId,
      installationId: 'candidate-after-reload',
      isRegistered: vi.fn(async () => false),
      register: vi.fn(async () => undefined),
    };
    const onCandidateReady = vi.fn(async () => undefined);

    await expect(
      runInstallationRepairSession(
        {
          client,
          recovery: recovery({
            expectedInstallationId: 'staged-before-reload',
            expectedInstallationVisible: true,
            localInstallationId: 'candidate-from-inspection',
          }),
          signerIdentifier,
          expectedInboxId: inboxId,
          interruptedRepairCandidateId: 'staged-before-reload',
          previousInstallationId: 'saved-old',
          databasePathMode: 'inbox-default',
        },
        {
          resolveInboxId: vi.fn(async () => inboxId),
          fetchInboxState: vi.fn(async () => state(['staged-before-reload', 'saved-old'])),
          revokeInstallation: vi.fn(async () => undefined),
          onCandidateReady,
          onInstallationReady: vi.fn(async () => undefined),
        }
      )
    ).rejects.toThrow(/previously staged.*visible/i);

    expect(client.isRegistered).not.toHaveBeenCalled();
    expect(client.register).not.toHaveBeenCalled();
    expect(onCandidateReady).not.toHaveBeenCalled();
  });

  it('does not rebase a refreshed local candidate while the interrupted journal candidate is visible', async () => {
    const client: RegistrationClient = {
      inboxId,
      installationId: 'candidate-after-reload',
      isRegistered: vi.fn(async () => false),
      register: vi.fn(async () => undefined),
    };
    const onCandidateReady = vi.fn(async () => undefined);
    const revokeInstallation = vi.fn(async () => undefined);

    await expect(
      runInstallationRepairSession(
        {
          client,
          recovery: recovery({
            expectedInstallationId: 'staged-before-reload',
            expectedInstallationVisible: true,
            localInstallationId: 'candidate-after-reload',
          }),
          signerIdentifier,
          expectedInboxId: inboxId,
          interruptedRepairCandidateId: 'staged-before-reload',
          previousInstallationId: 'saved-old',
          databasePathMode: 'inbox-default',
        },
        {
          resolveInboxId: vi.fn(async () => inboxId),
          fetchInboxState: vi.fn(async () => state(['staged-before-reload', 'saved-old'])),
          revokeInstallation,
          onCandidateReady,
          onInstallationReady: vi.fn(async () => undefined),
        }
      )
    ).rejects.toThrow(/previously staged.*visible/i);

    expect(client.isRegistered).not.toHaveBeenCalled();
    expect(client.register).not.toHaveBeenCalled();
    expect(onCandidateReady).not.toHaveBeenCalled();
    expect(revokeInstallation).not.toHaveBeenCalled();
  });

  it('catches a staged candidate that becomes visible after the recovery snapshot', async () => {
    const client: RegistrationClient = {
      inboxId,
      installationId: 'candidate-after-reload',
      isRegistered: vi.fn(async () => false),
      register: vi.fn(async () => undefined),
    };
    const onCandidateReady = vi.fn(async () => undefined);

    await expect(
      runInstallationRepairSession(
        {
          client,
          recovery: recovery({
            expectedInstallationId: 'staged-before-reload',
            expectedInstallationVisible: false,
            localInstallationId: 'candidate-from-stale-inspection',
          }),
          signerIdentifier,
          expectedInboxId: inboxId,
          interruptedRepairCandidateId: 'staged-before-reload',
          previousInstallationId: 'saved-old',
          databasePathMode: 'inbox-default',
        },
        {
          resolveInboxId: vi.fn(async () => inboxId),
          fetchInboxState: vi.fn(async () => state(['staged-before-reload', 'saved-old'])),
          revokeInstallation: vi.fn(async () => undefined),
          onCandidateReady,
          onInstallationReady: vi.fn(async () => undefined),
        }
      )
    ).rejects.toThrow(/previously staged.*visible/i);

    expect(client.register).not.toHaveBeenCalled();
    expect(onCandidateReady).not.toHaveBeenCalled();
  });

  it('settles repeated absence before rebasing an interrupted ephemeral candidate', async () => {
    let registered = false;
    let current = state([]);
    const client: RegistrationClient = {
      inboxId,
      installationId: 'candidate-after-reload',
      isRegistered: vi.fn(async () => registered),
      register: vi.fn(async () => {
        registered = true;
        current = state(['candidate-after-reload']);
      }),
    };
    const sleep = vi.fn(async () => undefined);

    await expect(
      runInstallationRepairSession(
        {
          client,
          recovery: recovery({
            expectedInstallationId: 'staged-before-reload',
            expectedInstallationVisible: false,
            localInstallationId: 'candidate-from-stale-inspection',
          }),
          signerIdentifier,
          expectedInboxId: inboxId,
          interruptedRepairCandidateId: 'staged-before-reload',
          previousInstallationId: 'saved-old',
          databasePathMode: 'inbox-default',
        },
        {
          resolveInboxId: vi.fn(async () => inboxId),
          fetchInboxState: vi.fn(async () => current),
          revokeInstallation: vi.fn(async () => undefined),
          onCandidateReady: vi.fn(async () => undefined),
          onInstallationReady: vi.fn(async () => undefined),
          sleep,
        }
      )
    ).resolves.toMatchObject({ candidateInstallationId: 'candidate-after-reload' });

    expect(sleep).toHaveBeenCalledTimes(9);
    expect(client.register).toHaveBeenCalledOnce();
  });

  it.each([
    {
      label: 'registered',
      recoveryOverrides: {
        localInstallationRegistered: true,
      },
    },
    {
      label: 'ledger-visible',
      recoveryOverrides: {
        localInstallationVisible: true,
      },
    },
  ])(
    'rejects a $label candidate mismatch before staging or registration',
    async ({ recoveryOverrides }) => {
      const client: RegistrationClient = {
        inboxId,
        installationId: 'candidate-b',
        isRegistered: vi.fn(async () => false),
        register: vi.fn(async () => undefined),
      };
      const onCandidateReady = vi.fn(async () => undefined);
      const onInstallationReady = vi.fn(async () => undefined);

      await expect(
        runInstallationRepairSession(
          {
            client,
            recovery: recovery(recoveryOverrides),
            signerIdentifier,
            expectedInboxId: inboxId,
            previousInstallationId: 'candidate-a',
            databasePathMode: 'inbox-default',
          },
          {
            resolveInboxId: vi.fn(async () => inboxId),
            fetchInboxState: vi.fn(async () => state(['candidate-a'])),
            revokeInstallation: vi.fn(async () => undefined),
            onCandidateReady,
            onInstallationReady,
          }
        )
      ).rejects.toThrow(/changed after it had registered or appeared/i);

      expect(client.isRegistered).not.toHaveBeenCalled();
      expect(client.register).not.toHaveBeenCalled();
      expect(onCandidateReady).not.toHaveBeenCalled();
      expect(onInstallationReady).not.toHaveBeenCalled();
    }
  );
});
