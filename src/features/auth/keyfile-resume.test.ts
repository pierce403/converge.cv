import type { InboxState } from '@xmtp/browser-sdk';
import { describe, expect, it } from 'vitest';
import type { Identity } from '@/types';
import {
  findPendingKeyfileRestore,
  getResumableKeyfileInstallationId,
} from './keyfile-resume';

const address = `0x${'11'.repeat(20)}`;
const inboxId = 'a'.repeat(64);
const privateKey = `0x${'22'.repeat(32)}`;
const pending: Identity = {
  address,
  publicKey: '0x1234',
  privateKey,
  createdAt: 1,
  provisioningMode: 'keyfile-restore',
  provisioningPending: true,
  expectedInboxId: inboxId,
  installationId: '0xINSTALLATION-1',
};

const state = (ids: string[]) =>
  ({
    inboxId,
    installations: ids.map((id) => ({ id })),
    accountIdentifiers: [],
  }) as unknown as InboxState;

describe('keyfile installation resume', () => {
  it('allows a 10/10 restore to resume only when its exact pending installation is registered', () => {
    const fullState = state([
      'installation-1',
      ...Array.from({ length: 9 }, (_, index) => `other-${index}`),
    ]);

    expect(
      getResumableKeyfileInstallationId([pending], {
        address: address.toUpperCase(),
        privateKey,
        inboxId: inboxId.toUpperCase(),
        inboxState: fullState,
      })
    ).toBe('0xINSTALLATION-1');
  });

  it('does not resume a different key, inbox, or unregistered installation', () => {
    expect(
      getResumableKeyfileInstallationId([pending], {
        address,
        privateKey: `0x${'33'.repeat(32)}`,
        inboxId,
        inboxState: state(['installation-1']),
      })
    ).toBeUndefined();
    expect(
      getResumableKeyfileInstallationId([pending], {
        address,
        privateKey,
        inboxId: 'b'.repeat(64),
        inboxState: state(['installation-1']),
      })
    ).toBeUndefined();
    expect(
      getResumableKeyfileInstallationId([pending], {
        address,
        privateKey,
        inboxId,
        inboxState: state(['other-installation']),
      })
    ).toBeUndefined();
  });

  it('finds the exact pending record so createIdentity preserves its local database IDs', () => {
    expect(
      findPendingKeyfileRestore([pending], {
        address,
        privateKey,
        inboxId,
      })
    ).toBe(pending);
  });
});
