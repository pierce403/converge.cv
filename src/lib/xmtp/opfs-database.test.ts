import { describe, expect, it, vi } from 'vitest';
import { deleteInboxDefaultDatabase, getInboxDefaultDatabasePath } from './opfs-database';

const inboxId = 'a'.repeat(64);

describe('XMTP inbox database recovery', () => {
  it('targets exactly one production inbox database', () => {
    expect(getInboxDefaultDatabasePath(`0x${inboxId.toUpperCase()}`)).toBe(
      `xmtp-production-${inboxId}.db3`
    );
    expect(() => getInboxDefaultDatabasePath('not-an-inbox')).toThrow(/invalid inbox ID/i);
  });

  it('deletes only the requested database and closes the OPFS worker', async () => {
    const fileExists = vi.fn(async () => true);
    const deleteFile = vi.fn(async () => true);
    const close = vi.fn();

    await expect(
      deleteInboxDefaultDatabase(inboxId, async () => ({ fileExists, deleteFile, close }))
    ).resolves.toBe(true);

    expect(fileExists).toHaveBeenCalledWith(`xmtp-production-${inboxId}.db3`);
    expect(deleteFile).toHaveBeenCalledTimes(1);
    expect(deleteFile).toHaveBeenCalledWith(`xmtp-production-${inboxId}.db3`);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('does not issue a delete when the exact inbox database is absent', async () => {
    const deleteFile = vi.fn(async () => true);
    const close = vi.fn();

    await expect(
      deleteInboxDefaultDatabase(inboxId, async () => ({
        fileExists: async () => false,
        deleteFile,
        close,
      }))
    ).resolves.toBe(false);

    expect(deleteFile).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });
});
