import { describe, expect, it, beforeEach, vi } from 'vitest';
import { XmtpClient } from './client';
import { useContactStore } from '@/lib/stores';

describe('XmtpClient.fetchInboxProfile (local mode)', () => {
  beforeEach(() => {
    try {
      // Reset persisted state between tests.
      useContactStore.persist?.clearStorage?.();
    } catch {
      // ignore
    }
    useContactStore.setState({ contacts: [], isLoading: false } as never);
  });

  it('does not call preferences.fetchInboxStates or conversations.getDmByInboxId', async () => {
    const xmtp = new XmtpClient();

    const getDmByInboxId = vi.fn(async () => {
      throw new Error('should not be called');
    });
    const fetchInboxStates = vi.fn(async () => {
      throw new Error('should not be called');
    });

    (xmtp as unknown as { client: unknown }).client = {
      conversations: { getDmByInboxId },
      preferences: { fetchInboxStates },
    };

    const inboxId = 'a'.repeat(64);
    const profile = await xmtp.fetchInboxProfile(inboxId, { mode: 'local' });

    expect(profile.inboxId).toBe(inboxId);
    expect(getDmByInboxId).not.toHaveBeenCalled();
    expect(fetchInboxStates).not.toHaveBeenCalled();
  });

  it('defaults to local mode', async () => {
    const xmtp = new XmtpClient();

    const getDmByInboxId = vi.fn(async () => {
      throw new Error('should not be called');
    });
    const fetchInboxStates = vi.fn(async () => {
      throw new Error('should not be called');
    });

    (xmtp as unknown as { client: unknown }).client = {
      conversations: { getDmByInboxId },
      preferences: { fetchInboxStates },
    };

    const inboxId = 'b'.repeat(64);
    await xmtp.fetchInboxProfile(inboxId);

    expect(getDmByInboxId).not.toHaveBeenCalled();
    expect(fetchInboxStates).not.toHaveBeenCalled();
  });
});
