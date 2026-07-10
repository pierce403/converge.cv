import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Identity, InboxRegistryEntry } from '@/types';
import {
  burnInboxWithDependencies,
  clearInboxBrowserState,
  type BurnInboxDependencies,
} from './burn-inbox';

function identity(addressByte: string, inboxId: string): Identity {
  return {
    address: `0x${addressByte.repeat(40)}`,
    publicKey: '0x1234',
    privateKey: '0xabcd',
    createdAt: 1,
    inboxId,
    installationId: `${addressByte.repeat(64)}`,
  };
}

function registryEntry(inboxId: string, lastOpenedAt: number): InboxRegistryEntry {
  return {
    inboxId,
    displayLabel: inboxId,
    primaryDisplayIdentity: inboxId,
    lastOpenedAt,
    hasLocalDB: true,
  };
}

function createDependencies(options?: {
  entries?: InboxRegistryEntry[];
  identities?: Identity[];
  currentInboxId?: string | null;
  connectedInboxId?: string | null;
  activeInboxId?: string | null;
  revokeError?: Error;
  clearError?: Error;
  pushCleanupSucceeded?: boolean;
}) {
  const events: string[] = [];
  const deletedAddresses: string[] = [];
  const namespaces: string[] = [];
  const currentInboxIds: Array<string | null> = [];
  const intentionalEmptyStates: boolean[] = [];
  const entries = options?.entries ?? [];
  const identities = options?.identities ?? [];

  const dependencies: BurnInboxDependencies = {
    getIdentities: vi.fn(async () => identities),
    getRegistryState: vi.fn(() => ({
      entries,
      currentInboxId: options?.currentInboxId ?? null,
    })),
    getActiveIdentityInboxId: vi.fn(() => options?.activeInboxId ?? null),
    getConnectedInboxId: vi.fn(() => options?.connectedInboxId ?? null),
    revokeCurrentInstallation: vi.fn(async () => {
      events.push('revoke');
      if (options?.revokeError) {
        throw options.revokeError;
      }
    }),
    disconnectCurrentClient: vi.fn(async () => {
      events.push('disconnect');
    }),
    removePushRegistration: vi.fn(async () => {
      events.push('remove-push');
      return options?.pushCleanupSucceeded ?? true;
    }),
    getStorageNamespace: vi.fn(() => options?.currentInboxId ?? 'default'),
    clearInboxData: vi.fn(async () => {
      events.push('clear');
      if (options?.clearError) {
        throw options.clearError;
      }
      return {};
    }),
    deleteIdentityByAddress: vi.fn(async (address) => {
      events.push(`delete:${address}`);
      deletedAddresses.push(address);
    }),
    removeRegistryEntry: vi.fn(() => {
      events.push('remove-registry');
    }),
    setCurrentRegistryInbox: vi.fn((inboxId) => {
      currentInboxIds.push(inboxId);
    }),
    setStorageNamespace: vi.fn(async (namespace) => {
      namespaces.push(namespace);
    }),
    clearInboxBrowserState: vi.fn(),
    clearActiveRuntimeState: vi.fn(() => {
      events.push('clear-runtime');
    }),
    setIntentionalEmptyState: vi.fn((isEmpty) => {
      intentionalEmptyStates.push(isEmpty);
    }),
  };

  return {
    dependencies,
    deletedAddresses,
    events,
    namespaces,
    currentInboxIds,
    intentionalEmptyStates,
  };
}

describe('burnInboxWithDependencies', () => {
  it('revokes first, wipes only matching keys, and selects the newest remaining inbox', async () => {
    const target = identity('1', 'target-inbox');
    const other = identity('2', 'other-inbox');
    const harness = createDependencies({
      identities: [target, other],
      entries: [
        registryEntry('target-inbox', 30),
        registryEntry('older-inbox', 10),
        registryEntry('other-inbox', 20),
      ],
      currentInboxId: 'target-inbox',
      activeInboxId: 'target-inbox',
      connectedInboxId: 'target-inbox',
    });

    const result = await burnInboxWithDependencies('TARGET-INBOX', harness.dependencies);

    expect(result).toMatchObject({
      inboxId: 'target-inbox',
      revokeAttempted: true,
      installationRevoked: true,
      localDataRemoved: true,
      removedIdentityCount: 1,
      remainingInboxIds: ['other-inbox', 'older-inbox'],
      nextInboxId: 'other-inbox',
      intentionallyEmpty: false,
    });
    expect(result.revokeWarning).toBeUndefined();
    expect(harness.events.indexOf('revoke')).toBeLessThan(harness.events.indexOf('clear'));
    expect(harness.deletedAddresses).toEqual([target.address]);
    expect(harness.deletedAddresses).not.toContain(other.address);
    expect(harness.namespaces).toEqual(['other-inbox']);
    expect(harness.currentInboxIds).toEqual(['other-inbox']);
    expect(harness.intentionalEmptyStates).toEqual([false]);
    expect(harness.dependencies.clearInboxData).toHaveBeenCalledWith(
      'target-inbox',
      ['target-inbox', target.address]
    );
  });

  it('continues the local wipe and returns a warning when remote revocation fails', async () => {
    const target = identity('3', 'target-inbox');
    const harness = createDependencies({
      identities: [target],
      entries: [registryEntry('target-inbox', 1)],
      currentInboxId: 'target-inbox',
      activeInboxId: 'target-inbox',
      connectedInboxId: 'target-inbox',
      revokeError: new Error('network unavailable'),
      pushCleanupSucceeded: false,
    });

    const result = await burnInboxWithDependencies('target-inbox', harness.dependencies);

    expect(result.revokeAttempted).toBe(true);
    expect(result.installationRevoked).toBe(false);
    expect(result.revokeWarning).toContain('another connected device');
    expect(result.revokeWarning).toContain('network unavailable');
    expect(result.pushWarning).toContain('push relay did not confirm removal');
    expect(result.localDataRemoved).toBe(true);
    expect(harness.events).toContain('clear');
    expect(harness.deletedAddresses).toEqual([target.address]);
    expect(result.intentionallyEmpty).toBe(true);
    expect(harness.namespaces).toEqual(['default']);
    expect(harness.intentionalEmptyStates).toEqual([true]);
  });

  it('keeps the key and registry available when local database cleanup is blocked', async () => {
    const target = identity('4', 'target-inbox');
    const harness = createDependencies({
      identities: [target],
      entries: [registryEntry('target-inbox', 1)],
      currentInboxId: 'target-inbox',
      activeInboxId: 'target-inbox',
      connectedInboxId: null,
      clearError: new Error('IndexedDB blocked'),
    });

    const result = await burnInboxWithDependencies('target-inbox', harness.dependencies);

    expect(result.revokeAttempted).toBe(false);
    expect(result.revokeWarning).toContain('not connected');
    expect(result.localDataRemoved).toBe(false);
    expect(result.localCleanupWarnings).toContain(
      'Inbox database cleanup: IndexedDB blocked'
    );
    expect(harness.deletedAddresses).toEqual([]);
    expect(harness.events).not.toContain('remove-registry');
    expect(result.remainingInboxIds).toContain('target-inbox');
    expect(result.intentionallyEmpty).toBe(false);
  });

  it('preserves the active namespace when an inactive inbox is removed', async () => {
    const target = identity('5', 'inactive-inbox');
    const harness = createDependencies({
      identities: [target, identity('6', 'active-inbox')],
      entries: [
        registryEntry('inactive-inbox', 2),
        registryEntry('active-inbox', 1),
      ],
      currentInboxId: 'active-inbox',
      activeInboxId: 'active-inbox',
      connectedInboxId: 'active-inbox',
    });

    const result = await burnInboxWithDependencies('inactive-inbox', harness.dependencies);

    expect(result.nextInboxId).toBe('active-inbox');
    expect(harness.namespaces).toEqual(['active-inbox']);
    expect(harness.dependencies.clearActiveRuntimeState).not.toHaveBeenCalled();
    expect(harness.deletedAddresses).toEqual([target.address]);
  });

  it('does not mark the app empty when another identity is missing from a stale registry', async () => {
    const target = identity('9', 'target-inbox');
    const unregistered = identity('a', 'unregistered-inbox');
    const harness = createDependencies({
      identities: [target, unregistered],
      entries: [registryEntry('target-inbox', 1)],
      currentInboxId: 'target-inbox',
      activeInboxId: 'target-inbox',
      connectedInboxId: 'target-inbox',
    });

    const result = await burnInboxWithDependencies('target-inbox', harness.dependencies);

    expect(result.remainingInboxIds).toEqual(['unregistered-inbox']);
    expect(result.nextInboxId).toBe('unregistered-inbox');
    expect(result.intentionallyEmpty).toBe(false);
    expect(harness.intentionalEmptyStates).toEqual([false]);
  });
});

describe('clearInboxBrowserState', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('removes only metadata derived from the burned inbox identity', () => {
    const target = identity('7', 'target-inbox');
    const other = identity('8', 'other-inbox');
    const targetAddress = target.address.toLowerCase();
    const otherAddress = other.address.toLowerCase();

    window.localStorage.setItem(`personalization-reminder:${targetAddress}`, 'target');
    window.localStorage.setItem(`pending-profile-save:target-inbox`, 'target');
    window.localStorage.setItem(`self-farcaster:last-check:${targetAddress}`, 'target');
    window.localStorage.setItem(`converge.historySyncNotice.${target.installationId}`, 'dismissed');
    window.localStorage.setItem('converge.forceInboxId.v1', 'target-inbox');
    window.localStorage.setItem(
      'converge.profileEditorIntent.v1',
      JSON.stringify({ inboxId: 'target-inbox', address: target.address })
    );
    window.localStorage.setItem(`personalization-reminder:${otherAddress}`, 'other');

    clearInboxBrowserState('target-inbox', [target]);

    expect(window.localStorage.getItem(`personalization-reminder:${targetAddress}`)).toBeNull();
    expect(window.localStorage.getItem('pending-profile-save:target-inbox')).toBeNull();
    expect(window.localStorage.getItem(`self-farcaster:last-check:${targetAddress}`)).toBeNull();
    expect(window.localStorage.getItem(`converge.historySyncNotice.${target.installationId}`)).toBeNull();
    expect(window.localStorage.getItem('converge.forceInboxId.v1')).toBeNull();
    expect(window.localStorage.getItem('converge.profileEditorIntent.v1')).toBeNull();
    expect(window.localStorage.getItem(`personalization-reminder:${otherAddress}`)).toBe('other');
  });
});
