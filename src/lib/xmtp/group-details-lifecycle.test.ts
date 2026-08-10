import { afterEach, describe, expect, it, vi } from 'vitest';
import { XmtpClient } from './client';

type ClientInternals = {
  client: {
    conversations: {
      getConversationById: (conversationId: string) => Promise<unknown>;
    };
  } | null;
};

const internals = (client: XmtpClient) => client as unknown as ClientInternals;

describe('XmtpClient group detail lifecycle', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('treats a disconnected group refresh as a quiet no-op', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(new XmtpClient().fetchGroupDetails('group-id')).resolves.toBeNull();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('stays quiet when disconnect wins the race with a group refresh', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const client = new XmtpClient();
    internals(client).client = {
      conversations: {
        getConversationById: vi.fn(async () => {
          throw new Error('Client not connected');
        }),
      },
    };

    await expect(client.fetchGroupDetails('group-id')).resolves.toBeNull();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('still reports unexpected group refresh failures', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const client = new XmtpClient();
    const failure = new Error('unexpected worker failure');
    internals(client).client = {
      conversations: {
        getConversationById: vi.fn(async () => {
          throw failure;
        }),
      },
    };

    await expect(client.fetchGroupDetails('group-id')).resolves.toBeNull();
    expect(consoleError).toHaveBeenCalledWith('[XMTP] Failed to fetch group details:', failure);
  });
});
