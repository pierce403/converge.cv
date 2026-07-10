import { IdentifierKind, type InboxState, type Identifier } from '@xmtp/browser-sdk';
import { describe, expect, it, vi } from 'vitest';
import { ensureClientRegistration, installationIdsMatch } from './client-registration';
import { StaleInstallationError } from './device-provisioning';

const inboxId = 'a'.repeat(64);
const identifier: Identifier = {
  identifier: `0x${'11'.repeat(20)}`,
  identifierKind: IdentifierKind.Ethereum,
};

const inboxState = (
  installationIds: string[],
  accountIdentifiers: Identifier[] = [identifier]
) =>
  ({
    inboxId,
    installations: installationIds.map((id) => ({ id })),
    accountIdentifiers,
  }) as InboxState;

function harness(options?: {
  resolved?: boolean;
  registered?: boolean;
  installations?: string[];
  registerNoop?: boolean;
  registerThrowsAfterMutation?: boolean;
  accountIdentifiers?: Identifier[];
}) {
  let resolved = options?.resolved ?? false;
  let registered = options?.registered ?? false;
  const installations = [...(options?.installations ?? [])];
  const events: string[] = [];
  const client = {
    inboxId,
    installationId: '0xAABB',
    isRegistered: vi.fn(async () => registered),
    register: vi.fn(async () => {
      events.push('register');
      if (!options?.registerNoop) {
        registered = true;
        resolved = true;
        if (!installations.some((id) => id.toLowerCase().replace(/^0x/, '') === 'aabb')) {
          installations.push('aabb');
        }
      }
      if (options?.registerThrowsAfterMutation) {
        throw new Error('request interrupted');
      }
    }),
  };
  const resolveInboxId = vi.fn(async () => (resolved ? inboxId : undefined));
  const fetchInboxState = vi.fn(async () =>
    inboxState(installations, options?.accountIdentifiers ?? [identifier])
  );
  const onInstallationReady = vi.fn(async () => {
    events.push('persist');
  });

  return {
    client,
    events,
    dependencies: {
      resolveInboxId,
      fetchInboxState,
      onInstallationReady,
      sleep: vi.fn(async () => undefined),
    },
  };
}

describe('ensureClientRegistration', () => {
  it('never treats two missing installation IDs as the same installation', () => {
    expect(installationIdsMatch(undefined, undefined)).toBe(false);
    expect(installationIdsMatch('0X0xaabb', 'aabb')).toBe(true);
  });

  it('registers a fresh identity without probing nonexistent inbox state first', async () => {
    const setup = harness();

    const result = await ensureClientRegistration(
      { client: setup.client, identifier, policy: 'new-inbox' },
      setup.dependencies
    );

    expect(result).toMatchObject({
      inboxId,
      installationId: '0xAABB',
      installationRegistered: true,
      existingInstallationCount: 0,
    });
    expect(setup.client.register).toHaveBeenCalledOnce();
    expect(setup.events.slice(0, 2)).toEqual(['persist', 'register']);
    expect(setup.dependencies.fetchInboxState).toHaveBeenCalledOnce();
  });

  it('fails closed when an existing-inbox flow cannot resolve the signer', async () => {
    const setup = harness();

    await expect(
      ensureClientRegistration(
        { client: setup.client, identifier, policy: 'existing-inbox', expectedInboxId: inboxId },
        setup.dependencies
      )
    ).rejects.toThrow(/expected existing inbox/i);
    expect(setup.client.register).not.toHaveBeenCalled();
    expect(setup.dependencies.fetchInboxState).not.toHaveBeenCalled();
    expect(setup.dependencies.onInstallationReady).not.toHaveBeenCalled();
  });

  it('adds an installation to an existing inbox only when policy permits it', async () => {
    const setup = harness({
      resolved: true,
      installations: Array.from({ length: 9 }, (_, index) => `old-${index}`),
    });

    const result = await ensureClientRegistration(
      { client: setup.client, identifier, policy: 'existing-inbox', expectedInboxId: inboxId },
      setup.dependencies
    );

    expect(result.existingInstallationCount).toBe(9);
    expect(result.installationRegistered).toBe(true);
    expect(setup.client.register).toHaveBeenCalledOnce();
  });

  it('reuses a registered installation across 0x and casing differences', async () => {
    const setup = harness({ resolved: true, registered: true, installations: ['aabb'] });

    const result = await ensureClientRegistration(
      {
        client: setup.client,
        identifier,
        policy: 'resume-only',
        expectedInboxId: inboxId.toUpperCase(),
        expectedInstallationId: '0X0xaabb',
      },
      setup.dependencies
    );

    expect(result.installationRegistered).toBe(false);
    expect(setup.client.register).not.toHaveBeenCalled();
  });

  it('blocks a genuinely new installation when the inbox is at 10/10', async () => {
    const setup = harness({
      resolved: true,
      installations: Array.from({ length: 10 }, (_, index) => `old-${index}`),
    });

    await expect(
      ensureClientRegistration(
        { client: setup.client, identifier, policy: 'existing-inbox' },
        setup.dependencies
      )
    ).rejects.toThrow(/10\/10/);
    expect(setup.client.register).not.toHaveBeenCalled();
    expect(setup.dependencies.onInstallationReady).not.toHaveBeenCalled();
  });

  it('resumes an exact pending installation even when the inbox is full', async () => {
    const setup = harness({
      resolved: true,
      installations: ['aabb', ...Array.from({ length: 9 }, (_, index) => `old-${index}`)],
    });

    const result = await ensureClientRegistration(
      { client: setup.client, identifier, policy: 'existing-inbox' },
      setup.dependencies
    );

    expect(result.installationRegistered).toBe(false);
    expect(setup.client.register).toHaveBeenCalledOnce();
  });

  it('settles an interrupted register call without submitting a second registration', async () => {
    const setup = harness({ registerThrowsAfterMutation: true });

    const result = await ensureClientRegistration(
      { client: setup.client, identifier, policy: 'new-inbox' },
      setup.dependencies
    );

    expect(result.installationRegistered).toBe(true);
    expect(setup.client.register).toHaveBeenCalledOnce();
  });

  it('rejects a register no-op that never becomes locally and remotely verified', async () => {
    const setup = harness({ registerNoop: true });

    await expect(
      ensureClientRegistration(
        { client: setup.client, identifier, policy: 'new-inbox' },
        setup.dependencies
      )
    ).rejects.toThrow(/did not produce a verified signer/i);
    expect(setup.client.register).toHaveBeenCalledOnce();
  });

  it('requires the signer identifier as well as the installation in post-registration state', async () => {
    const setup = harness({
      resolved: true,
      registered: true,
      installations: ['aabb'],
      accountIdentifiers: [],
    });

    await expect(
      ensureClientRegistration(
        { client: setup.client, identifier, policy: 'resume-only' },
        setup.dependencies
      )
    ).rejects.toThrow(/could not be verified/i);
    expect(setup.dependencies.onInstallationReady).not.toHaveBeenCalled();
  });

  it('does not persist a prospective installation when resume-only registration is disallowed', async () => {
    const setup = harness({ resolved: true, installations: [] });

    await expect(
      ensureClientRegistration(
        { client: setup.client, identifier, policy: 'resume-only' },
        setup.dependencies
      )
    ).rejects.toThrow(/does not have a registered XMTP installation/i);
    expect(setup.client.register).not.toHaveBeenCalled();
    expect(setup.dependencies.onInstallationReady).not.toHaveBeenCalled();
  });

  it('requires recovery when a mismatched saved installation is still on the ledger', async () => {
    const setup = harness({ resolved: true, installations: ['install-old'] });

    await expect(
      ensureClientRegistration(
        {
          client: setup.client,
          identifier,
          policy: 'new-inbox',
          expectedInstallationId: 'install-old',
        },
        setup.dependencies
      )
    ).rejects.toBeInstanceOf(StaleInstallationError);
    expect(setup.client.register).not.toHaveBeenCalled();
    expect(setup.dependencies.onInstallationReady).not.toHaveBeenCalled();
  });

  it('replaces a lost pending installation only after proving it is absent from the ledger', async () => {
    const setup = harness({ resolved: true, installations: [] });

    const result = await ensureClientRegistration(
      {
        client: setup.client,
        identifier,
        policy: 'new-inbox',
        expectedInstallationId: 'install-old',
      },
      setup.dependencies
    );

    expect(result.installationId).toBe('0xAABB');
    expect(setup.client.register).toHaveBeenCalledOnce();
    expect(setup.dependencies.onInstallationReady).toHaveBeenCalled();
  });
});
