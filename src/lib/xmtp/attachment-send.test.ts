import { describe, expect, it, vi } from 'vitest';
import { ConsentState, type RemoteAttachment } from '@xmtp/browser-sdk';
import { AttachmentConsentError, XmtpClient } from './client';

type ClientInternals = {
  client: {
    inboxId?: string;
    conversations: {
      getConversationById: (conversationId: string) => Promise<unknown>;
    };
    preferences?: {
      sync: () => Promise<void>;
    };
  } | null;
};

const attachment = {
  content: new Uint8Array([1, 2, 3]),
  filename: 'photo.png',
  mimeType: 'image/png',
};

const remoteAttachment: RemoteAttachment = {
  url: 'https://example.ipfscdn.io/photo.enc',
  contentDigest: 'digest',
  secret: new Uint8Array(32).fill(1),
  salt: new Uint8Array(32).fill(2),
  nonce: new Uint8Array(12).fill(3),
  scheme: 'https',
  contentLength: 512,
  filename: 'photo.png',
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

  it.each([ConsentState.Unknown, ConsentState.Denied])(
    'does not fetch incoming attachments when consent is %s',
    async (consentState) => {
      const client = new XmtpClient();
      const consentStateFn = vi.fn(async () => consentState);
      const getConversationById = vi.fn(async () => ({ consentState: consentStateFn }));
      const syncPreferences = vi.fn(async () => undefined);
      (client as unknown as ClientInternals).client = {
        conversations: { getConversationById },
        preferences: { sync: syncPreferences },
      };
      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      await expect(
        client.loadRemoteAttachment('conversation-1', remoteAttachment),
      ).rejects.toBeInstanceOf(AttachmentConsentError);

      expect(consentStateFn).toHaveBeenCalledTimes(1);
      expect(syncPreferences).toHaveBeenCalledTimes(1);
      expect(fetchSpy).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
    },
  );

  it('updates protocol consent before retrying an attachment', async () => {
    const client = new XmtpClient();
    const updateConsentState = vi.fn(async () => undefined);
    const getConversationById = vi.fn(async () => ({ updateConsentState }));
    (client as unknown as ClientInternals).client = {
      conversations: { getConversationById },
    };

    await client.updateConversationConsentState('conversation-1', ConsentState.Allowed);

    expect(updateConsentState).toHaveBeenCalledWith(ConsentState.Allowed);
  });
});
