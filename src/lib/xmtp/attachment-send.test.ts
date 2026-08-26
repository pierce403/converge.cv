import { describe, expect, it, vi } from 'vitest';
import { ConsentState, type RemoteAttachment } from '@xmtp/browser-sdk';
import { AttachmentConsentError, XmtpClient } from './client';

const codecMocks = vi.hoisted(() => ({
  encodeText: vi.fn(async (text: string) => ({
    type: {
      authorityId: 'xmtp.org',
      typeId: 'text',
      versionMajor: 1,
      versionMinor: 0,
    },
    parameters: {},
    content: new TextEncoder().encode(text),
  })),
  encryptAttachment: vi.fn(async (value: { filename?: string }) => ({
    payload: new Uint8Array([7, 8, 9]),
    contentDigest: 'digest',
    contentLength: 3,
    filename: value.filename,
    nonce: new Uint8Array(12).fill(1),
    salt: new Uint8Array(32).fill(2),
    secret: new Uint8Array(32).fill(3),
  })),
  decryptAttachment: vi.fn(async () => ({
    content: new Uint8Array([1, 2, 3]),
    filename: 'photo.png',
    mimeType: 'image/png',
  })),
}));

vi.mock('@xmtp/browser-sdk', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@xmtp/browser-sdk')>()),
  encodeText: codecMocks.encodeText,
  encryptAttachment: codecMocks.encryptAttachment,
  decryptAttachment: codecMocks.decryptAttachment,
}));

type ClientInternals = {
  client: {
    inboxId?: string;
    conversations: {
      getConversationById: (conversationId: string) => Promise<unknown>;
      getMessageById?: (messageId: string) => Promise<unknown>;
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

  it('rejects text, reply, and group creation while disconnected instead of inventing a queue', async () => {
    const client = new XmtpClient();

    await expect(client.sendMessage('conversation-1', 'hello')).rejects.toThrow(
      'XMTP is not connected',
    );
    await expect(client.sendReply('conversation-1', 'message-1', 'hello')).rejects.toThrow(
      'XMTP is not connected',
    );
    await expect(client.createGroupConversation(['a'.repeat(64)])).rejects.toThrow(
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

  it('returns authoritative SDK timestamps and expiry for text, reply, and attachment sends', async () => {
    const client = new XmtpClient();
    const sentAtNs = 1_000_000_000n;
    const expiresAtNs = 1_210_600_000_000_000n;
    const sendText = vi.fn(async () => 'text-message');
    const sendReply = vi.fn(async () => 'reply-message');
    const sendRemoteAttachment = vi.fn(async () => 'attachment-message');
    const conversation = {
      peerInboxId: vi.fn(async () => 'peer-inbox'),
      sendText,
      sendReply,
      sendRemoteAttachment,
    };
    const getConversationById = vi.fn(async () => conversation);
    const getMessageById = vi.fn(async (messageId: string) => ({
      id: messageId,
      senderInboxId: 'self-inbox',
      sentAtNs,
      expiresAtNs,
    }));
    (client as unknown as ClientInternals).client = {
      inboxId: 'self-inbox',
      conversations: { getConversationById, getMessageById },
    };
    (
      client as unknown as {
        ensureProfileSent: () => Promise<void>;
      }
    ).ensureProfileSent = vi.fn(async () => undefined);

    let uploadedPayload = new Uint8Array();
    (
      client as unknown as {
        uploadEncryptedAttachmentPayload: (
          payload: Uint8Array,
        ) => Promise<{ uri: string; url: string }>;
      }
    ).uploadEncryptedAttachmentPayload = vi.fn(async (payload: Uint8Array) => {
      uploadedPayload = new Uint8Array(payload);
      return {
        uri: 'ipfs://attachment-test',
        url: 'https://cdn.example.com/attachment.enc',
      };
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () => new Response(new Uint8Array(uploadedPayload), { status: 200 }),
    );

    try {
      const [textMessage, replyMessage, attachmentMessage] = await Promise.all([
        client.sendMessage('conversation-1', 'hello'),
        client.sendReply('conversation-1', 'target-message', 'reply'),
        client.sendAttachment('conversation-1', attachment),
      ]);

      for (const message of [textMessage, replyMessage, attachmentMessage]) {
        expect(message.sentAt).toBe(1_000);
        expect(message.expiresAt).toBe(1_210_600_000);
      }
      expect(getMessageById).toHaveBeenCalledWith('text-message');
      expect(getMessageById).toHaveBeenCalledWith('reply-message');
      expect(getMessageById).toHaveBeenCalledWith('attachment-message');
    } finally {
      fetchSpy.mockRestore();
    }
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
