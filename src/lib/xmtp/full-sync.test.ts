import { describe, expect, it, vi } from 'vitest';
import { runNonDestructiveFullSync } from './full-sync';

describe('runNonDestructiveFullSync', () => {
  it('syncs retained history without disconnecting or clearing local data', async () => {
    const client = {
      isConnected: vi.fn(() => true),
      syncConversations: vi.fn(async () => undefined),
      runFullHistorySync: vi.fn(async () => undefined),
      disconnect: vi.fn(async () => undefined),
      clearAllData: vi.fn(async () => undefined),
    };
    const runRetention = vi.fn(async () => undefined);
    const reloadConversations = vi.fn(async () => undefined);

    await runNonDestructiveFullSync(client, { runRetention, reloadConversations });

    expect(client.syncConversations).toHaveBeenCalledWith({
      force: true,
      reason: 'manual-full-sync',
      strict: true,
    });
    expect(client.runFullHistorySync).toHaveBeenCalledOnce();
    expect(runRetention).toHaveBeenCalledOnce();
    expect(reloadConversations).toHaveBeenCalledOnce();
    expect(client.disconnect).not.toHaveBeenCalled();
    expect(client.clearAllData).not.toHaveBeenCalled();
  });

  it('does not mutate local state when the network sync fails', async () => {
    const failure = new Error('network unavailable');
    const client = {
      isConnected: vi.fn(() => true),
      syncConversations: vi.fn(async () => {
        throw failure;
      }),
      runFullHistorySync: vi.fn(async () => undefined),
      disconnect: vi.fn(async () => undefined),
      clearAllData: vi.fn(async () => undefined),
    };
    const runRetention = vi.fn(async () => undefined);
    const reloadConversations = vi.fn(async () => undefined);

    await expect(
      runNonDestructiveFullSync(client, { runRetention, reloadConversations }),
    ).rejects.toBe(failure);

    expect(client.runFullHistorySync).not.toHaveBeenCalled();
    expect(runRetention).not.toHaveBeenCalled();
    expect(reloadConversations).not.toHaveBeenCalled();
    expect(client.disconnect).not.toHaveBeenCalled();
    expect(client.clearAllData).not.toHaveBeenCalled();
  });

  it('refuses to run without an active XMTP connection', async () => {
    const client = {
      isConnected: vi.fn(() => false),
      syncConversations: vi.fn(async () => undefined),
      runFullHistorySync: vi.fn(async () => undefined),
    };

    await expect(
      runNonDestructiveFullSync(client, {
        reloadConversations: vi.fn(async () => undefined),
      }),
    ).rejects.toThrow('XMTP is not connected yet');
    expect(client.syncConversations).not.toHaveBeenCalled();
  });
});
