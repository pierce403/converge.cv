import { describe, expect, it, vi } from 'vitest';
import { XmtpClient } from './client';

type ClientInternals = {
  client: {
    conversations: {
      getConversationById: (conversationId: string) => Promise<unknown>;
    };
  } | null;
};

const attachment = {
  content: new Uint8Array([1, 2, 3]),
  filename: 'photo.png',
  mimeType: 'image/png',
};

describe('XmtpClient attachment send failures', () => {
  it('rejects attachment sends while disconnected', async () => {
    const client = new XmtpClient();

    await expect(client.sendAttachment('conversation-1', attachment)).rejects.toThrow(
      'XMTP is not connected',
    );
  });

  it('propagates connected XMTP failures instead of returning a local-only message', async () => {
    const client = new XmtpClient();
    const lookupError = new Error('conversation lookup failed');
    const getConversationById = vi.fn().mockRejectedValue(lookupError);
    (client as unknown as ClientInternals).client = {
      conversations: { getConversationById },
    };

    await expect(client.sendAttachment('conversation-1', attachment)).rejects.toBe(lookupError);
    expect(getConversationById).toHaveBeenCalledWith('conversation-1');
  });
});
