import { describe, expect, it, vi } from 'vitest';
import type { Identity } from '@/types';
import { loadStoredIdentityForXmtp, XmtpIdentityStorageError } from './xmtp-storage';

const address = `0x${'11'.repeat(20)}`;
const identity: Identity = {
  address,
  publicKey: '0x1234',
  privateKey: '0xabcd',
  createdAt: 1,
  inboxId: 'inbox-1',
  installationId: 'installation-1',
};

describe('XMTP identity storage preflight', () => {
  it('returns the persisted identity metadata used to reopen the same installation', async () => {
    const getIdentityByAddress = vi.fn(async () => identity);

    await expect(
      loadStoredIdentityForXmtp(address, async () => ({ getIdentityByAddress }))
    ).resolves.toBe(identity);
    expect(getIdentityByAddress).toHaveBeenCalledWith(address);
  });

  it('fails closed with an actionable error when IndexedDB cannot be read', async () => {
    const storageFailure = new Error('IndexedDB transaction aborted');
    const error = await loadStoredIdentityForXmtp(address, async () => {
      throw storageFailure;
    }).catch((caught) => caught);

    expect(error).toBeInstanceOf(XmtpIdentityStorageError);
    expect(error.message).toContain('stopped to avoid opening a different installation');
    expect(error.cause).toBe(storageFailure);
  });
});
