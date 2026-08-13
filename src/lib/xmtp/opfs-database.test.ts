import { describe, expect, it, vi } from 'vitest';
import {
  deleteInboxDefaultDatabase,
  getInboxDefaultDatabasePath,
  getPersistentXmtpDatabaseUri,
  xmtpDatabaseFileExists,
} from './opfs-database';

const inboxId = 'a'.repeat(64);

describe('XMTP inbox database recovery', () => {
  it('targets exactly one production inbox database', () => {
    expect(getInboxDefaultDatabasePath(`0x${inboxId.toUpperCase()}`)).toBe(
      `xmtp-production-${inboxId}.db3`
    );
    expect(() => getInboxDefaultDatabasePath('not-an-inbox')).toThrow(/invalid inbox ID/i);
  });

  it('pins persistent databases to the named OPFS VFS', () => {
    expect(getPersistentXmtpDatabaseUri('xmtp-production-saved.db3')).toBe(
      'file:xmtp-production-saved.db3?mode=rwc&vfs=opfs-libxmtp'
    );
    expect(getPersistentXmtpDatabaseUri('xmtp-production-saved.db3', 'rw')).toBe(
      'file:xmtp-production-saved.db3?mode=rw&vfs=opfs-libxmtp'
    );
    expect(() => getPersistentXmtpDatabaseUri('file:xmtp-production-saved.db3')).toThrow(
      /logical \.db3 path/i
    );
  });

  it('deletes only the requested database and closes the OPFS worker', async () => {
    vi.useFakeTimers();
    const fileExists = vi.fn(async () => true);
    const deleteFile = vi.fn(async () => true);
    const close = vi.fn();

    try {
      let settled = false;
      const deletion = deleteInboxDefaultDatabase(inboxId, async () => ({
        fileExists,
        deleteFile,
        close,
      }));
      void deletion.then(() => {
        settled = true;
      });

      await vi.advanceTimersByTimeAsync(0);

      expect(fileExists).toHaveBeenCalledWith(`xmtp-production-${inboxId}.db3`);
      expect(deleteFile).toHaveBeenCalledTimes(1);
      expect(deleteFile).toHaveBeenCalledWith(`xmtp-production-${inboxId}.db3`);
      expect(close).toHaveBeenCalledTimes(1);
      expect(settled).toBe(false);

      await vi.advanceTimersByTimeAsync(349);
      expect(settled).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      await expect(deletion).resolves.toBe(true);
      expect(settled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not issue a delete when the exact inbox database is absent', async () => {
    vi.useFakeTimers();
    const deleteFile = vi.fn(async () => true);
    const close = vi.fn();

    try {
      const deletion = deleteInboxDefaultDatabase(inboxId, async () => ({
        fileExists: async () => false,
        deleteFile,
        close,
      }));

      await vi.advanceTimersByTimeAsync(0);

      expect(deleteFile).not.toHaveBeenCalled();
      expect(close).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(350);
      await expect(deletion).resolves.toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('probes an exact database path without deleting it and closes the OPFS worker', async () => {
    const fileExists = vi.fn(async () => true);
    const deleteFile = vi.fn(async () => true);
    const close = vi.fn();

    await expect(
      xmtpDatabaseFileExists('xmtp-production-saved.db3', async () => ({
        fileExists,
        deleteFile,
        close,
      }))
    ).resolves.toBe(true);

    expect(fileExists).toHaveBeenCalledWith('xmtp-production-saved.db3');
    expect(deleteFile).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });
});
