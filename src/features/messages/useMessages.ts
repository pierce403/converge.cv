/**
 * Messages hook for managing message operations
 */

import { useCallback } from 'react';
import { ConsentState, type RemoteAttachment } from '@xmtp/browser-sdk';
import { useMessageStore, useConversationStore, useAuthStore, useContactStore } from '@/lib/stores';
import { getStorage } from '@/lib/storage';
import { getXmtpClient, type XmtpMessage } from '@/lib/xmtp';
import { getResyncReadStateFor } from '@/lib/xmtp/resync-state';
import {
  ALLOWED_INCOMING_IMAGE_MIME_TYPES,
  classifyTrustedAttachmentHost,
  MAX_INCOMING_ATTACHMENT_BYTES,
  validateIncomingAttachmentContent,
  validateIncomingAttachmentUrl,
} from '@/lib/xmtp/incoming-attachment';
import type {
  Message,
  Attachment as StoredAttachment,
  Conversation,
  StoredRemoteAttachmentEnvelope,
} from '@/types';
import { getAddress, isAddress } from 'viem';
import { isLikelyConvosInviteCode, tryParseConvosInvite } from '@/lib/utils/convos-invite';

const MAX_ATTACHMENT_BYTES = MAX_INCOMING_ATTACHMENT_BYTES;
const MAX_INBOX_ATTACHMENT_CACHE_BYTES = 100 * 1024 * 1024;
const SUPPORTED_ATTACHMENT_MIME_TYPES = new Set<string>(ALLOWED_INCOMING_IMAGE_MIME_TYPES);
const MESSAGE_PAGE_SIZE = 50;
const XMTP_INBOX_WITH_0X_REGEX = /^0x[a-f0-9]{64}$/i;

export interface LoadAttachmentOptions {
  allowUntrusted?: boolean;
}

export interface LoadedAttachment {
  attachment: StoredAttachment;
  data: ArrayBuffer;
}

export class AttachmentHostApprovalError extends Error {
  constructor(public readonly hostname: string) {
    super(`Loading this image requires approval for ${hostname}.`);
    this.name = 'AttachmentHostApprovalError';
  }
}

const attachmentDownloadRequests = new Map<string, Promise<LoadedAttachment>>();

const normalizeIdentityKey = (value?: string | null): string => {
  const trimmed = value?.trim().toLowerCase() || '';
  if (!trimmed) return '';
  if (XMTP_INBOX_WITH_0X_REGEX.test(trimmed)) {
    return trimmed.slice(2);
  }
  return trimmed;
};

const toArrayBuffer = (data: Uint8Array): ArrayBuffer => {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return copy.buffer;
};

const remoteAttachmentEnvelope = (
  id: string,
  messageId: string,
  conversationId: string,
  attachment: RemoteAttachment,
): StoredRemoteAttachmentEnvelope => ({
  id,
  messageId,
  conversationId,
  url: attachment.url,
  contentDigest: attachment.contentDigest,
  secret: new Uint8Array(attachment.secret),
  salt: new Uint8Array(attachment.salt),
  nonce: new Uint8Array(attachment.nonce),
  scheme: attachment.scheme,
  contentLength: attachment.contentLength,
  filename: attachment.filename,
});

const inspectRemoteAttachmentDescriptor = (
  attachment: RemoteAttachment,
): { sourceHost?: string; failureReason?: string } => {
  try {
    const url = validateIncomingAttachmentUrl(attachment.url);
    const scheme = attachment.scheme.trim().toLowerCase();
    if (scheme !== 'https' && scheme !== 'https://') {
      throw new Error('Remote attachment metadata does not use HTTPS');
    }
    if (
      !Number.isSafeInteger(attachment.contentLength) ||
      attachment.contentLength <= 0 ||
      attachment.contentLength > MAX_ATTACHMENT_BYTES
    ) {
      throw new Error(`Remote attachment exceeds the ${MAX_ATTACHMENT_BYTES}-byte limit`);
    }
    return { sourceHost: url.hostname.toLowerCase() };
  } catch (error) {
    return {
      failureReason:
        error instanceof Error ? error.message : 'Remote attachment metadata is invalid',
    };
  }
};

const formatInviteSummary = (
  invite: ReturnType<typeof tryParseConvosInvite>,
  opts?: { fromSelf?: boolean }
) => {
  if (!invite) return null;
  const { payload } = invite;
  const lines: string[] = [];
  lines.push(opts?.fromSelf ? 'Invite request sent' : 'Invite request received');
  if (payload.name) lines.push(`Group: ${payload.name}`);
  if (payload.tag) lines.push(`Tag: ${payload.tag}`);
  if (payload.expiresAt) lines.push(`Invite expires: ${payload.expiresAt.toLocaleString()}`);
  if (payload.conversationExpiresAt) {
    lines.push(`Group expires: ${payload.conversationExpiresAt.toLocaleString()}`);
  }
  return lines.join('\n');
};

const parseProfileMessageBody = (
  raw: string
): { displayName?: string; avatarUrl?: string } | null => {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const candidates: string[] = [trimmed];
  if (trimmed.startsWith('cv:profile:')) {
    candidates.push(trimmed.slice('cv:profile:'.length).trim());
  }

  for (const candidate of candidates) {
    if (!candidate.startsWith('{')) {
      continue;
    }
    try {
      const parsed = JSON.parse(candidate) as Record<string, unknown> | null;
      if (!parsed || typeof parsed !== 'object') {
        continue;
      }

      const typeValue = typeof parsed.type === 'string' ? parsed.type.trim().toLowerCase() : '';
      if (typeValue !== 'profile') {
        continue;
      }

      const versionValue = typeof parsed.v === 'number' ? parsed.v : undefined;
      if (versionValue !== undefined && versionValue !== 1) {
        continue;
      }

      const displayName =
        typeof parsed.displayName === 'string' && parsed.displayName.trim()
          ? parsed.displayName.trim()
          : undefined;
      const avatarUrl =
        typeof parsed.avatarUrl === 'string' && parsed.avatarUrl.trim()
          ? parsed.avatarUrl.trim()
          : undefined;

      if (displayName || avatarUrl) {
        return { displayName, avatarUrl };
      }
    } catch {
      // Ignore invalid JSON payloads.
    }
  }

  return null;
};

export function useMessages() {
  const messagesByConversation = useMessageStore((state) => state.messagesByConversation);
  const isSending = useMessageStore((state) => state.isSending);
  const setMessages = useMessageStore((state) => state.setMessages);
  const prependMessages = useMessageStore((state) => state.prependMessages);
  const addMessage = useMessageStore((state) => state.addMessage);
  const updateMessage = useMessageStore((state) => state.updateMessage);
  const removeMessage = useMessageStore((state) => state.removeMessage);
  const setLoading = useMessageStore((state) => state.setLoading);
  const setSending = useMessageStore((state) => state.setSending);
  const clearMessages = useMessageStore((state) => state.clearMessages);
  const updateConversation = useConversationStore((state) => state.updateConversation);
  const incrementUnread = useConversationStore((state) => state.incrementUnread);
  const conversations = useConversationStore((state) => state.conversations);
  const identity = useAuthStore((state) => state.identity);
  const upsertContactProfile = useContactStore((state) => state.upsertContactProfile);
  const isContact = useContactStore((state) => state.isContact);

  /**
   * Sync a conversation from XMTP network
   */
  const syncConversation = useCallback(
    async (conversationId: string, opts?: { force?: boolean }) => {
      try {
        const xmtp = getXmtpClient();
        if (!xmtp.isConnected()) {
          console.warn('[useMessages] Cannot sync conversation: XMTP client not connected');
          return;
        }

        const conversation = conversations.find((c) => c.id === conversationId);
        if (!conversation) {
          console.warn('[useMessages] Cannot sync conversation: conversation not found');
          return;
        }

        const globalCooldownMs = xmtp.getConversationSyncCooldownMs(conversationId);
        if (globalCooldownMs > 0 && !opts?.force) {
          console.warn(
            `[useMessages] Skipping conversation sync due to cooldown (${Math.round(globalCooldownMs / 1000)}s)`
          );
          return;
        }

        const minIntervalMs = 60 * 1000;
        if (!opts?.force && conversation.lastSyncedAt && Date.now() - conversation.lastSyncedAt < minIntervalMs) {
          return;
        }

        // Access the internal XMTP client instance
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const client = (xmtp as any).client;
        if (!client) {
          console.warn('[useMessages] Cannot sync conversation: XMTP client instance not available');
          return;
        }

        try {
          // Get the XMTP conversation object
          const xmtpConv = await client.conversations.getConversationById(conversationId);
          if (!xmtpConv) {
            console.warn('[useMessages] Cannot sync conversation: XMTP conversation not found');
            return;
          }

          // Sync messages for this conversation (both DMs and groups support sync())
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          if (typeof (xmtpConv as any).sync === 'function') {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (xmtpConv as any).sync();
            console.log('[useMessages] ✅ Synced conversation from XMTP:', conversationId);
          } else {
            console.warn('[useMessages] Conversation does not support sync() method');
          }

          const syncedAt = Date.now();
          updateConversation(conversationId, { lastSyncedAt: syncedAt });
          try {
            const storage = await getStorage();
            const existing = await storage.getConversation(conversationId);
            if (existing) {
              await storage.putConversation({ ...existing, lastSyncedAt: syncedAt });
            }
          } catch (syncErr) {
            console.warn('[useMessages] Failed to persist conversation sync timestamp', syncErr);
          }
        } catch (syncError) {
          xmtp.recordRateLimitForConversation(conversationId, syncError, 'conversation.sync');
          console.warn('[useMessages] Failed to sync conversation from XMTP:', syncError);
        }
      } catch (error) {
        console.error('[useMessages] Error syncing conversation:', error);
      }
    },
    [conversations, updateConversation]
  );

  /**
   * Load messages for a conversation
   */
  const loadMessages = useCallback(
    async (
      conversationId: string,
      syncFromNetwork = false,
      opts?: { pageSize?: number }
    ): Promise<{ count: number; hasMore: boolean }> => {
      const pageSize = opts?.pageSize ?? MESSAGE_PAGE_SIZE;
      try {
        setLoading(conversationId, true);

        // If syncing from network, sync the conversation first
        if (syncFromNetwork) {
          await syncConversation(conversationId, { force: true });
        }

        const storage = await getStorage();
        let messages = await storage.listMessages(conversationId, { limit: pageSize });
        // Filter legacy reaction and reply placeholder bubbles persisted prior to aggregation/structured handling
        messages = messages.filter(
          (m) =>
            !(
              (m.type === 'system' && (/^reaction$/i.test(m.body) || /^reply$/i.test(m.body))) ||
              (m.type === 'text' && Boolean(parseProfileMessageBody(m.body)))
            )
        );
        setMessages(conversationId, messages);

        // Best-effort: aggregate recent reactions from the network so chips render after refresh
        void (async () => {
          try {
            const xmtp = getXmtpClient();
            await xmtp.backfillReactionsForConversation(conversationId, 300);
          } catch (e) {
            // Non-fatal if offline
          }
        })();
        return { count: messages.length, hasMore: messages.length >= pageSize };
      } catch (error) {
        console.error('Failed to load messages:', error);
        return { count: 0, hasMore: false };
      } finally {
        setLoading(conversationId, false);
      }
    },
    [setLoading, setMessages, syncConversation]
  );

  const loadOlderMessages = useCallback(
    async (
      conversationId: string,
      opts?: { pageSize?: number }
    ): Promise<{ count: number; hasMore: boolean }> => {
      const pageSize = opts?.pageSize ?? MESSAGE_PAGE_SIZE;
      const existing = messagesByConversation[conversationId] || [];
      if (existing.length === 0) {
        return loadMessages(conversationId, false, { pageSize });
      }
      const oldest = existing[0]?.sentAt;
      if (!oldest) {
        return { count: 0, hasMore: false };
      }
      try {
        const storage = await getStorage();
        let messages = await storage.listMessages(conversationId, { limit: pageSize, before: oldest });
        messages = messages.filter(
          (m) =>
            !(
              (m.type === 'system' && (/^reaction$/i.test(m.body) || /^reply$/i.test(m.body))) ||
              (m.type === 'text' && Boolean(parseProfileMessageBody(m.body)))
            )
        );
        if (messages.length > 0) {
          prependMessages(conversationId, messages);
        }
        return { count: messages.length, hasMore: messages.length >= pageSize };
      } catch (error) {
        console.error('Failed to load older messages:', error);
        return { count: 0, hasMore: false };
      }
    },
    [messagesByConversation, prependMessages, loadMessages]
  );

  const ensureContactForConversation = useCallback(
    async (conversation: Conversation) => {
      const recipientInboxId = conversation.peerId;
      if (conversation.isGroup || isContact(recipientInboxId)) {
        return;
      }

      const normalizedAddress = isAddress(recipientInboxId)
        ? getAddress(recipientInboxId as `0x${string}`)
        : undefined;
      const addressList = normalizedAddress ? [normalizedAddress.toLowerCase()] : [];
      const xmtp = getXmtpClient();

      // If recipientInboxId looks like an address, try to derive the actual inbox ID
      let actualInboxId = recipientInboxId;
      if (normalizedAddress) {
        try {
          const derivedInboxId = await xmtp.resolveInboxIdForAddress(normalizedAddress, {
            context: 'useMessages:ensureContactForConversation',
          });
          if (derivedInboxId && !derivedInboxId.startsWith('0x')) {
            // Only use if it's actually an inbox ID (not an address)
            actualInboxId = derivedInboxId.toLowerCase();
            console.log('[useMessages] Derived inbox ID from address:', normalizedAddress, '->', actualInboxId);
          } else {
            console.warn('[useMessages] Derived value is still an address, not a valid inbox ID:', derivedInboxId);
          }
        } catch (e) {
          console.warn('[useMessages] Failed to derive inbox ID from address:', e);
        }
      }

      // Fetch profile from XMTP to get display name and avatar
      // Use the derived inbox ID (network mode)
      let profile = undefined;
      try {
        if (!actualInboxId.startsWith('0x')) {
          profile = await xmtp.refreshInboxProfile(actualInboxId);
          console.log('[useMessages] Refreshed profile for new contact:', profile);

          // If profile has a valid inbox ID (not an address), use it
          if (profile.inboxId && !profile.inboxId.startsWith('0x') && profile.inboxId.length > 10) {
            actualInboxId = profile.inboxId.toLowerCase();
            console.log('[useMessages] Using inbox ID from profile:', actualInboxId);
          }
        }
      } catch (e) {
        console.warn('[useMessages] Failed to fetch profile for new contact, will use fallback:', e);
      }

      // Ensure we're not using an address as the inbox ID
      if (actualInboxId.startsWith('0x')) {
        console.warn('[useMessages] Contact inbox ID remained address-like after single resolver attempt:', actualInboxId);
      }

      if (actualInboxId.toLowerCase().startsWith('0x')) {
        console.warn('[useMessages] Skipping contact upsert because inboxId is still address-like:', actualInboxId);
        return;
      }

      await upsertContactProfile({
        inboxId: actualInboxId,
        displayName: profile?.displayName, // Use XMTP profile display name
        avatarUrl: profile?.avatarUrl, // Use XMTP profile avatar
        primaryAddress: profile?.primaryAddress || normalizedAddress?.toLowerCase(),
        addresses: profile?.addresses || addressList,
        identities: profile?.identities || (normalizedAddress
          ? [
              {
                identifier: normalizedAddress.toLowerCase(),
                kind: 'Ethereum',
                isPrimary: true,
              },
            ]
          : []),
        source: 'inbox',
        persistIfMissing: true,
      });
      console.log('Automatically added new contact with inbox ID:', actualInboxId, 'display name:', profile?.displayName);
    },
    [isContact, upsertContactProfile]
  );

  /**
   * Send a message (optionally as a reply)
   */
  const sendMessage = useCallback(
    async (conversationId: string, content: string, opts?: { replyToId?: string }) => {
      if (!identity) {
        console.error('No identity available');
        return;
      }

      try {
        setSending(true);

        const conversation = conversations.find((c) => c.id === conversationId);
        if (!conversation) {
          console.error('Conversation not found for ID:', conversationId);
          setSending(false);
          return;
        }

        if (conversation.isLocalOnly || conversation.id.startsWith('local-conversation')) {
          const message =
            'This chat was created locally before XMTP conversation creation succeeded. Start a new chat with this address again so Converge can create a real XMTP conversation.';
          console.warn('[useMessages] Refusing to send from local-only conversation', {
            conversationId: conversation.id,
            peerId: conversation.peerId,
            isLocalOnly: conversation.isLocalOnly ?? false,
          });
          window.dispatchEvent(new CustomEvent('ui:toast', { detail: message }));
          setSending(false);
          return;
        }

        await ensureContactForConversation(conversation);

        const parsedInvite = isLikelyConvosInviteCode(content) ? tryParseConvosInvite(content) : null;
        const inviteSummary = parsedInvite ? formatInviteSummary(parsedInvite, { fromSelf: true }) : null;
        const resolvedBody = inviteSummary || content;
        const resolvedType: Message['type'] = parsedInvite ? 'system' : 'text';

        // Create message object
        const message: Message = {
          id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          conversationId,
          sender: identity.inboxId ?? identity.address,
          sentAt: Date.now(),
          type: resolvedType,
          body: resolvedBody,
          status: 'pending',
          reactions: [],
          replyTo: opts?.replyToId,
          metadata: parsedInvite
            ? {
                invite: {
                  kind: 'invite-request',
                  inviteCode: content,
                  payload: parsedInvite.payload,
                },
              }
            : undefined,
        };

        // Add to store immediately
        addMessage(conversationId, message);

        // Persist to storage
        const storage = await getStorage();
        await storage.putMessage(message);

        let latestMessageId = message.id;
        let latestMessageSentAt = message.sentAt;
        let latestMessageSender = message.sender;

        // Send via XMTP
        try {
          const xmtp = getXmtpClient();
          const sentMessage = opts?.replyToId
            ? await xmtp.sendReply(conversationId, opts.replyToId, content)
            : await xmtp.sendMessage(conversationId, content);

          const resolvedId = sentMessage.id || message.id;
          const resolvedSentAt = sentMessage.sentAt ?? message.sentAt;
          const finalStatus: Message['status'] = sentMessage.isLocalFallback ? 'pending' : 'sent';
          const finalMessage: Message = {
            ...message,
            id: resolvedId,
            sentAt: resolvedSentAt,
            status: finalStatus,
          };
          latestMessageId = finalMessage.id;
          latestMessageSentAt = finalMessage.sentAt;
          latestMessageSender = finalMessage.sender;

          if (resolvedId !== message.id) {
            removeMessage(message.id);
            await storage.deleteMessage(message.id);
            addMessage(conversationId, finalMessage);
            await storage.putMessage(finalMessage);
          } else {
            updateMessage(resolvedId, { status: finalStatus, sentAt: resolvedSentAt });
            await storage.updateMessageStatus(resolvedId, finalStatus);
          }
        } catch (xmtpError) {
          console.error('Failed to send via XMTP:', xmtpError);
          updateMessage(message.id, { status: 'failed' });
          await storage.updateMessageStatus(message.id, 'failed');
          try {
            const msg = xmtpError instanceof Error ? xmtpError.message : 'Failed to send message.';
            window.dispatchEvent(new CustomEvent('ui:toast', { detail: msg }));
          } catch {
            // ignore
          }
        }

        // Update conversation
        updateConversation(conversationId, {
          lastMessageAt: latestMessageSentAt,
          lastMessagePreview: resolvedBody.substring(0, 100),
          lastMessageId: latestMessageId,
          lastMessageSender: latestMessageSender,
        });
      } catch (error) {
        console.error('Failed to send message:', error);
      } finally {
        setSending(false);
      }
    },
    [
      identity,
      addMessage,
      updateMessage,
      removeMessage,
      setSending,
      updateConversation,
      conversations,
      ensureContactForConversation,
    ]
  );

  /**
   * Send an image attachment
   */
  const sendAttachment = useCallback(
    async (conversationId: string, file: File) => {
      if (!identity) {
        console.error('No identity available');
        return;
      }

      const normalizedMimeType = file.type.split(';', 1)[0].trim().toLowerCase();
      if (!SUPPORTED_ATTACHMENT_MIME_TYPES.has(normalizedMimeType)) {
        try {
          window.dispatchEvent(
            new CustomEvent('ui:toast', {
              detail: 'Please select a JPEG, PNG, or WebP image.',
            })
          );
        } catch {
          // ignore
        }
        return;
      }

      if (file.size > MAX_ATTACHMENT_BYTES) {
        try {
          window.dispatchEvent(
            new CustomEvent('ui:toast', {
              detail: `Image too large (${Math.round(file.size / (1024 * 1024))}MB). Max ${MAX_ATTACHMENT_BYTES / (1024 * 1024)}MB.`,
            })
          );
        } catch {
          // ignore
        }
        return;
      }

      try {
        setSending(true);

        const conversation = conversations.find((c) => c.id === conversationId);
        if (!conversation) {
          console.error('Conversation not found for ID:', conversationId);
          setSending(false);
          return;
        }

        const filename = file.name || 'image';
        const mimeType = normalizedMimeType;
        const fileBuffer = await file.arrayBuffer();
        try {
          validateIncomingAttachmentContent({
            content: new Uint8Array(fileBuffer),
            filename,
            mimeType,
          });
        } catch (validationError) {
          console.warn('[useMessages] Refusing unsafe outbound image:', validationError);
          try {
            window.dispatchEvent(
              new CustomEvent('ui:toast', {
                detail: 'Image must be a valid static JPEG, PNG, or WebP within the safety limits.',
              })
            );
          } catch {
            // ignore
          }
          return;
        }

        await ensureContactForConversation(conversation);

        const now = Date.now();
        const localMessageId = `msg_${now}_${Math.random().toString(36).substr(2, 9)}`;
        const attachmentId = `att_${localMessageId}`;

        const message: Message = {
          id: localMessageId,
          conversationId,
          sender: identity.inboxId ?? identity.address,
          sentAt: now,
          type: 'attachment',
          body: filename,
          attachmentId,
          status: 'pending',
          reactions: [],
        };

        addMessage(conversationId, message);

        const storage = await getStorage();
        await storage.putMessage(message);

        const attachmentMeta: StoredAttachment = {
          id: attachmentId,
          messageId: localMessageId,
          filename,
          mimeType,
          size: fileBuffer.byteLength,
          cacheState: 'cached',
          cachedBytes: fileBuffer.byteLength,
          cachedAt: now,
          lastAccessedAt: now,
          evictable: false,
        };
        await storage.putAttachment(attachmentMeta, fileBuffer);

        let latestMessageId = message.id;
        let latestMessageSentAt = message.sentAt;
        let latestMessageSender = message.sender;

        let sentMessage: XmtpMessage;
        try {
          sentMessage = await getXmtpClient().sendAttachment(conversationId, {
            filename,
            mimeType,
            content: new Uint8Array(fileBuffer),
          });
        } catch (xmtpError) {
          console.error('Failed to send attachment via XMTP:', xmtpError);
          updateMessage(message.id, { status: 'failed' });
          await storage.updateMessageStatus(message.id, 'failed');
          try {
            const msg = xmtpError instanceof Error ? xmtpError.message : 'Failed to send attachment.';
            window.dispatchEvent(new CustomEvent('ui:toast', { detail: msg }));
          } catch {
            // ignore
          }
          return;
        }

        const resolvedId = sentMessage.id || message.id;
        const resolvedSentAt = sentMessage.sentAt ?? message.sentAt;
        const finalStatus: Message['status'] = sentMessage.isLocalFallback ? 'pending' : 'sent';
        const finalAttachmentId = `att_${resolvedId}`;
        const finalMessage: Message = {
          ...message,
          id: resolvedId,
          sentAt: resolvedSentAt,
          status: finalStatus,
          attachmentId: finalAttachmentId,
        };
        latestMessageId = finalMessage.id;
        latestMessageSentAt = finalMessage.sentAt;
        latestMessageSender = finalMessage.sender;

        const remoteMeta = sentMessage.remoteAttachment;
        const remoteDescriptor = remoteMeta
          ? inspectRemoteAttachmentDescriptor(remoteMeta)
          : undefined;
        const finalAttachment: StoredAttachment = {
          ...attachmentMeta,
          id: finalAttachmentId,
          messageId: resolvedId,
          storageRef: remoteMeta?.url,
          sha256: remoteMeta?.contentDigest,
          sourceHost: remoteDescriptor?.sourceHost,
          cacheState: 'cached',
          failureReason: remoteDescriptor?.failureReason,
          evictable: Boolean(remoteMeta && !remoteDescriptor?.failureReason),
        };

        if (resolvedId !== message.id) {
          removeMessage(message.id);
          addMessage(conversationId, finalMessage);
        } else {
          updateMessage(resolvedId, {
            status: finalStatus,
            sentAt: resolvedSentAt,
            attachmentId: finalAttachmentId,
          });
        }

        try {
          // Atomically replace the optimistic row so an IndexedDB failure can
          // leave the old local row or the authoritative row, never both.
          await storage.reconcilePublishedAttachment({
            optimisticMessageId: message.id,
            message: finalMessage,
            attachment: finalAttachment,
            data: fileBuffer,
            remoteEnvelope: remoteMeta
              ? remoteAttachmentEnvelope(
                finalAttachmentId,
                resolvedId,
                conversationId,
                remoteMeta,
              )
              : undefined,
          });
        } catch (storageError) {
          console.error('Attachment sent, but local cache reconciliation failed:', storageError);
          try {
            window.dispatchEvent(
              new CustomEvent('ui:toast', {
                detail: 'Image sent, but its local cache could not be updated.',
              })
            );
          } catch {
            // ignore
          }
        }

        updateConversation(conversationId, {
          lastMessageAt: latestMessageSentAt,
          lastMessagePreview: '📎 Attachment',
          lastMessageId: latestMessageId,
          lastMessageSender: latestMessageSender,
        });
      } catch (error) {
        console.error('Failed to send attachment:', error);
      } finally {
        setSending(false);
      }
    },
    [
      identity,
      conversations,
      addMessage,
      updateMessage,
      removeMessage,
      setSending,
      updateConversation,
      ensureContactForConversation,
    ]
  );

  /**
   * React to a message with an emoji
   */
  const reactToMessage = useCallback(
    async (conversationId: string, messageId: string, emoji: string) => {
      if (!identity) return;
      try {
        const mySenders = [identity.inboxId?.toLowerCase(), identity.address?.toLowerCase()].filter(Boolean);
        const current = messagesByConversation[conversationId] || [];
        const idx = current.findIndex((m) => m.id === messageId);
        const now = Date.now();
        let alreadyReacted = false;
        if (idx >= 0) {
          const msg = current[idx];
          alreadyReacted = (msg.reactions || []).some(
            (r) => r.emoji === emoji && mySenders.includes(r.sender?.toLowerCase?.())
          );
        }

        if (alreadyReacted) {
          // Toggle off: send removal and optimistically remove
          await getXmtpClient().sendReaction(conversationId, messageId, emoji, 'removed', 'unicode');
          if (idx >= 0) {
            const msg = current[idx];
            const filtered = (msg.reactions || []).filter(
              (r) => !(r.emoji === emoji && mySenders.includes(r.sender?.toLowerCase?.()))
            );
            updateMessage(messageId, { reactions: filtered });
          }
        } else {
          await getXmtpClient().sendReaction(conversationId, messageId, emoji, 'added', 'unicode');
          // Optimistically add
          if (idx >= 0) {
            const msg = current[idx];
            const next = [...(msg.reactions || [])];
            next.push({ emoji, sender: identity.inboxId ?? identity.address, timestamp: now });
            updateMessage(messageId, { reactions: next });
          }
        }
      } catch (e) {
        console.warn('Failed to send reaction:', e);
      }
    },
    [identity, messagesByConversation, updateMessage]
  );

  /**
   * Send a lightweight read receipt for this conversation
   */
  // Track last receipt sent per conversation to avoid spamming
  // Persist last sent read-receipt timestamp per conversation on the global object.
  type ReceiptState = { ackedAt: number; sentAt: number };
  type ReceiptMap = Record<string, ReceiptState | number>;
  const getReceiptMap = useCallback(() => {
    const g = globalThis as unknown as { __cv_last_receipts?: ReceiptMap };
    if (!g.__cv_last_receipts) g.__cv_last_receipts = {};
    return g.__cv_last_receipts;
  }, []);

  const sendReadReceiptFor = useCallback(
    async (conversationId: string, latestIncomingAt?: number) => {
      try {
        const conversation = conversations.find((c) => c.id === conversationId);
        if (!conversation || conversation.isGroup) {
          return;
        }

        // Self-DMs should never emit read receipts (they appear as "{}" in some clients).
        const myAddress = normalizeIdentityKey(identity?.address);
        const myInbox = normalizeIdentityKey(identity?.inboxId);
        const peer = normalizeIdentityKey(conversation.peerId);
        if ((myInbox && peer === myInbox) || (myAddress && peer === myAddress)) {
          return;
        }

        const mine = new Set<string>();
        if (myAddress) {
          mine.add(myAddress);
        }
        if (myInbox) {
          mine.add(myInbox);
          mine.add(`0x${myInbox}`);
        }

        // Compute latest incoming ts if not provided
        let latest = latestIncomingAt;
        if (latest == null) {
          const list = messagesByConversation[conversationId] || [];
          for (const m of list) {
            const s = normalizeIdentityKey(m.sender);
            const fromPeer = s && !mine.has(s);
            if (fromPeer) {
              latest = Math.max(latest || 0, m.sentAt || 0);
            }
          }
        }
        if (!latest) return;

        const map = getReceiptMap();
        const raw = map[conversationId];
        const previousAckedAt =
          typeof raw === 'number'
            ? raw
            : raw?.ackedAt ?? 0;
        const previousSentAt =
          typeof raw === 'number'
            ? 0
            : raw?.sentAt ?? 0;
        const now = Date.now();
        // Only send if we haven't acknowledged up to this message yet, and rate-limit to avoid duplicates
        if (latest <= previousAckedAt || now - previousSentAt < 5000) return;

        await getXmtpClient().sendReadReceipt(conversationId);
        map[conversationId] = {
          ackedAt: latest,
          sentAt: now,
        };
      } catch {
        // non-fatal
      }
    },
    [identity, messagesByConversation, getReceiptMap, conversations]
  );

  /**
   * Receive a message (from XMTP stream)
   */
  const receiveMessage = useCallback(
    async (
      conversationId: string,
      xmtpMessage: XmtpMessage,
      options?: { isHistory?: boolean }
    ) => {
      try {
        const isHistory = options?.isHistory ?? false;
        const storage = await getStorage();
        const remoteAttachment = xmtpMessage.remoteAttachment;
        const inlineAttachment = xmtpMessage.attachment;
        const attachmentId = `att_${xmtpMessage.id}`;

        // Persist only the encrypted descriptor on receipt. This deliberately
        // happens before de-duplication so older metadata-only rows can repair
        // themselves when XMTP returns the same message again.
        if (remoteAttachment) {
          try {
            const descriptor = inspectRemoteAttachmentDescriptor(remoteAttachment);
            const existingMetadata = await storage.getAttachmentMetadata(attachmentId);
            let metadata: StoredAttachment;
            if (!existingMetadata) {
              metadata = {
                id: attachmentId,
                messageId: xmtpMessage.id,
                filename: remoteAttachment.filename ?? 'Image attachment',
                mimeType: 'application/octet-stream',
                size:
                  Number.isSafeInteger(remoteAttachment.contentLength) &&
                  remoteAttachment.contentLength > 0
                    ? remoteAttachment.contentLength
                    : 0,
                storageRef: remoteAttachment.url,
                sha256: remoteAttachment.contentDigest,
                sourceHost: descriptor.sourceHost,
                cacheState: descriptor.failureReason ? 'blocked' : 'metadata',
                cachedBytes: 0,
                evictable: true,
                failureReason: descriptor.failureReason,
              };
            } else {
              const legacyData = existingMetadata.cacheState === undefined
                ? await storage.getAttachmentData(attachmentId)
                : undefined;
              metadata = {
                ...existingMetadata,
                storageRef: remoteAttachment.url,
                sha256: remoteAttachment.contentDigest,
                sourceHost: existingMetadata.sourceHost ?? descriptor.sourceHost,
                failureReason: descriptor.failureReason ?? existingMetadata.failureReason,
                cacheState:
                  descriptor.failureReason
                    ? 'blocked'
                    : existingMetadata.cacheState ?? (legacyData ? 'cached' : 'metadata'),
                cachedBytes: legacyData?.byteLength ?? existingMetadata.cachedBytes ?? 0,
                cachedAt:
                  legacyData && !existingMetadata.cachedAt
                    ? Date.now()
                    : existingMetadata.cachedAt,
                lastAccessedAt:
                  legacyData && !existingMetadata.lastAccessedAt
                    ? Date.now()
                    : existingMetadata.lastAccessedAt,
                evictable: !descriptor.failureReason,
              };
            }
            if (descriptor.failureReason) {
              await storage.evictAttachmentData(attachmentId);
              metadata = {
                ...metadata,
                cacheState: 'blocked',
                cachedBytes: 0,
                cachedAt: undefined,
                evictable: false,
              };
            }
            await storage.putRemoteAttachmentEnvelope(
              remoteAttachmentEnvelope(
                attachmentId,
                xmtpMessage.id,
                conversationId,
                remoteAttachment,
              )
            );
            await storage.putAttachmentMetadata(metadata);
          } catch (attachmentError) {
            console.warn('[useMessages] Failed to persist attachment metadata:', attachmentError);
          }
        }

        const inMemory = messagesByConversation[conversationId] || [];
        if (inMemory.some((m) => m.id === xmtpMessage.id)) {
          return;
        }
        try {
          const existing = await storage.getMessage(xmtpMessage.id);
          if (existing) {
            return;
          }
        } catch {
          // ignore storage lookup errors; proceed with processing
        }
        if (remoteAttachment || inlineAttachment) {
          let metadata = await storage.getAttachmentMetadata(attachmentId);

          if (inlineAttachment && !metadata) {
            try {
              const buffer = toArrayBuffer(inlineAttachment.content);
              const now = Date.now();
              const inlineMetadata: StoredAttachment = {
                id: attachmentId,
                messageId: xmtpMessage.id,
                filename: inlineAttachment.filename ?? 'Attachment',
                mimeType: inlineAttachment.mimeType,
                size: inlineAttachment.content.byteLength,
                cacheState: 'cached',
                cachedBytes: inlineAttachment.content.byteLength,
                cachedAt: now,
                lastAccessedAt: now,
                evictable: false,
              };
              await storage.putAttachment(inlineMetadata, buffer);
              metadata = inlineMetadata;
            } catch (attachmentError) {
              console.warn('[useMessages] Failed to persist inline attachment:', attachmentError);
            }
          }

          const attachmentName =
            metadata?.filename || inlineAttachment?.filename || remoteAttachment?.filename || 'Attachment';

          const message: Message = {
            id: xmtpMessage.id,
            conversationId,
            sender: xmtpMessage.senderAddress,
            sentAt: xmtpMessage.sentAt,
            receivedAt: Date.now(),
            type: 'attachment',
            body: attachmentName,
            attachmentId,
            status: 'delivered',
            reactions: [],
            replyTo: xmtpMessage.replyToId,
          };

          addMessage(conversationId, message);
          await storage.putMessage(message);

          const currentLastMessageAt =
            conversations.find((c) => c.id === conversationId)?.lastMessageAt ??
            (await storage.getConversation(conversationId))?.lastMessageAt ??
            0;
          if (message.sentAt >= currentLastMessageAt) {
            updateConversation(conversationId, {
              lastMessageAt: message.sentAt,
              lastMessagePreview: '📎 Attachment',
              lastMessageId: message.id,
              lastMessageSender: message.sender,
            });
          }

          const myInbox = identity?.inboxId?.toLowerCase();
          const myAddr = identity?.address?.toLowerCase();
          const senderLower = message.sender?.toLowerCase?.();
          const fromSelf = senderLower && (senderLower === myInbox || senderLower === myAddr);
          if (!fromSelf) {
            const preserved = isHistory ? getResyncReadStateFor(conversationId) : undefined;
            const comparisonBase = preserved?.lastReadAt ?? conversations.find((c) => c.id === conversationId)?.lastReadAt ?? 0;
            const shouldIncrement = !isHistory || message.sentAt > comparisonBase;
            if (shouldIncrement) {
              incrementUnread(conversationId);
            }
          }
          return;
        }

        // Convert content to string if it's a Uint8Array
        const content = typeof xmtpMessage.content === 'string'
          ? xmtpMessage.content
          : new TextDecoder().decode(xmtpMessage.content);

        const parsedProfileMessage = parseProfileMessageBody(content);
        if (parsedProfileMessage) {
          try {
            await upsertContactProfile({
              inboxId: xmtpMessage.senderAddress,
              displayName: parsedProfileMessage.displayName,
              avatarUrl: parsedProfileMessage.avatarUrl,
              source: 'inbox',
            });
          } catch (profileError) {
            console.warn('[useMessages] Failed to apply profile metadata message:', profileError);
          }
          return;
        }

        const myInbox = identity?.inboxId?.toLowerCase();
        const myAddr = identity?.address?.toLowerCase();
        const senderLower = xmtpMessage.senderAddress?.toLowerCase?.();
        const fromSelf = Boolean(senderLower && (senderLower === myInbox || senderLower === myAddr));

        const parsedInvite = isLikelyConvosInviteCode(content) ? tryParseConvosInvite(content) : null;
        const inviteSummary = parsedInvite ? formatInviteSummary(parsedInvite, { fromSelf }) : null;

        const message: Message = {
          id: xmtpMessage.id,
          conversationId,
          sender: xmtpMessage.senderAddress,
          sentAt: xmtpMessage.sentAt,
          receivedAt: Date.now(),
          type: parsedInvite ? 'system' : 'text',
          body: inviteSummary || content,
          status: 'delivered',
          reactions: [],
          replyTo: xmtpMessage.replyToId,
          metadata: parsedInvite
            ? {
                invite: {
                  kind: 'invite-request',
                  inviteCode: content,
                  payload: parsedInvite.payload,
                  requesterProfile: xmtpMessage.convosJoinRequest?.profile,
                  requesterMetadata: xmtpMessage.convosJoinRequest?.metadata,
                },
              }
            : undefined,
        };

        if (parsedInvite && !isHistory && !fromSelf) {
          const targetConversation = conversations.find((c) => c.id === conversationId);
          if (!targetConversation?.isGroup) {
            try {
              if (typeof window !== 'undefined') {
                window.dispatchEvent(
                  new CustomEvent('ui:invite-request', {
                    detail: {
                      conversationId,
                      senderInboxId: message.sender,
                      messageId: message.id,
                      inviteCode: content,
                      payload: parsedInvite.payload,
                      requesterProfile: xmtpMessage.convosJoinRequest?.profile,
                      requesterMetadata: xmtpMessage.convosJoinRequest?.metadata,
                      receivedAt: message.sentAt || Date.now(),
                    },
                  })
                );
              }
            } catch (inviteError) {
              console.warn('[useMessages] Failed to dispatch invite request UI:', inviteError);
            }
          }
        }

        // Heuristic de-duplication: if this message is from us (inboxId),
        // remove a recent optimistic local message with same body.
        try {
          if (myInbox && senderLower && myInbox === senderLower) {
            const likely = messagesByConversation[conversationId] || [];
            const now = Date.now();
            const inviteBody = parsedInvite ? inviteSummary : null;
            const candidates = likely.filter(
              (m) =>
                (m.body === content || (inviteBody && m.body === inviteBody)) &&
                m.sender?.toLowerCase?.() === myAddr &&
                Math.abs(now - (m.sentAt || now)) < 7000
            );
            if (candidates.length > 0) {
              for (const dup of candidates) {
                await getStorage().then((s) => s.deleteMessage(dup.id).catch(() => {}));
                removeMessage(dup.id);
              }
            }
          }
        } catch (e) {
          // Non-fatal; continue
        }

        // Add to store
        addMessage(conversationId, message);

        // Persist to storage
        await storage.putMessage(message);

        // Update conversation
        const currentLastMessageAt =
          conversations.find((c) => c.id === conversationId)?.lastMessageAt ??
          (await storage.getConversation(conversationId))?.lastMessageAt ??
          0;
        if (message.sentAt >= currentLastMessageAt) {
          updateConversation(conversationId, {
            lastMessageAt: message.sentAt,
            lastMessagePreview: message.body.substring(0, 100),
            lastMessageId: message.id,
            lastMessageSender: message.sender,
          });
        }

        // Increment unread if not viewing this conversation
        // (This would be better handled in a global message listener)
        if (!fromSelf) {
          const preserved = isHistory ? getResyncReadStateFor(conversationId) : undefined;
          const comparisonBase = preserved?.lastReadAt ?? conversations.find((c) => c.id === conversationId)?.lastReadAt ?? 0;
          const shouldIncrement = !isHistory || message.sentAt > comparisonBase;
          if (shouldIncrement) {
            incrementUnread(conversationId);
          }
        }
      } catch (error) {
        console.error('Failed to receive message:', error);
      }
    },
    [
      addMessage,
      updateConversation,
      incrementUnread,
      messagesByConversation,
      identity,
      removeMessage,
      conversations,
      upsertContactProfile,
    ]
  );

  /**
   * Fetch, authenticate, decrypt, and cache a remote attachment after the UI
   * has established both conversation consent and host-approval policy.
   */
  const allowConversation = useCallback(
    async (conversationId: string, clearLocalContactBlock = false): Promise<void> => {
      await getXmtpClient().updateConversationConsentState(
        conversationId,
        ConsentState.Allowed,
      );

      if (!clearLocalContactBlock) return;
      const conversation = useConversationStore
        .getState()
        .conversations.find((candidate) => candidate.id === conversationId);
      if (!conversation || conversation.isGroup) return;

      const contactStore = useContactStore.getState();
      const peerContact =
        contactStore.getContactByInboxId(conversation.peerId) ??
        contactStore.getContactByAddress(conversation.peerId);
      if (peerContact?.isBlocked) {
        await contactStore.unblockContact(peerContact.inboxId);
      }
    },
    [],
  );

  const denyConversation = useCallback(async (conversationId: string): Promise<void> => {
    await getXmtpClient().updateConversationConsentState(
      conversationId,
      ConsentState.Denied,
    );
  }, []);

  const loadAttachment = useCallback(
    async (
      conversationId: string,
      attachmentId: string,
      options: LoadAttachmentOptions = {},
    ): Promise<LoadedAttachment> => {
      const storage = await getStorage();
      const metadata = await storage.getAttachmentMetadata(attachmentId);
      if (!metadata) {
        throw new Error('Attachment metadata is unavailable on this device.');
      }
      if (metadata.cacheState === 'blocked') {
        throw new Error(metadata.failureReason || 'This attachment is blocked by the download policy.');
      }

      const cachedData = await storage.getAttachmentData(attachmentId);
      if (cachedData) {
        const accessed: StoredAttachment = {
          ...metadata,
          cacheState: 'cached',
          cachedBytes: cachedData.byteLength,
          lastAccessedAt: Date.now(),
        };
        return { attachment: accessed, data: cachedData };
      }

      const envelope = await storage.getRemoteAttachmentEnvelope(attachmentId);
      if (!envelope || envelope.conversationId !== conversationId) {
        throw new Error('The encrypted attachment descriptor is unavailable on this device.');
      }

      const url = validateIncomingAttachmentUrl(envelope.url);
      const trust = classifyTrustedAttachmentHost(url);
      if (trust === 'untrusted' && !options.allowUntrusted) {
        throw new AttachmentHostApprovalError(url.hostname.toLowerCase());
      }

      const expectedInboxId = identity?.inboxId;
      const requestKey = `${expectedInboxId ?? identity?.address ?? 'unknown'}:${conversationId}:${attachmentId}`;
      const existingRequest = attachmentDownloadRequests.get(requestKey);
      if (existingRequest) {
        return await existingRequest;
      }

      const request = (async (): Promise<LoadedAttachment> => {
        try {
          const decoded = await getXmtpClient().loadRemoteAttachment(
            conversationId,
            envelope as RemoteAttachment,
            expectedInboxId,
          );
          const data = toArrayBuffer(decoded.content);

          const now = Date.now();
          const cachedMetadata: StoredAttachment = {
            ...metadata,
            filename: decoded.filename ?? metadata.filename,
            mimeType: decoded.mimeType,
            size: decoded.content.byteLength,
            sourceHost: url.hostname.toLowerCase(),
            cacheState: 'cached',
            cachedBytes: data.byteLength,
            cachedAt: now,
            lastAccessedAt: now,
            evictable: true,
            failureReason: undefined,
          };
          await storage.cacheRemoteAttachment(
            cachedMetadata,
            data,
            MAX_INBOX_ATTACHMENT_CACHE_BYTES,
          );
          return { attachment: cachedMetadata, data };
        } catch (error) {
          const failureReason =
            error instanceof Error ? error.message : 'The image could not be loaded safely.';
          try {
            await storage.markAttachmentFailed(attachmentId, failureReason);
          } catch {
            // Preserve the original download failure.
          }
          throw error;
        }
      })();

      attachmentDownloadRequests.set(requestKey, request);
      try {
        return await request;
      } finally {
        if (attachmentDownloadRequests.get(requestKey) === request) {
          attachmentDownloadRequests.delete(requestKey);
        }
      }
    },
    [identity?.address, identity?.inboxId],
  );

  /**
   * Delete a message
   */
  const deleteMessage = useCallback(
    async (messageId: string) => {
      try {
        const storage = await getStorage();
        await storage.deleteMessage(messageId);
        removeMessage(messageId);
      } catch (error) {
        console.error('Failed to delete message:', error);
      }
    },
    [removeMessage]
  );

  return {
    messagesByConversation,
    isSending,
    clearMessages,
    loadMessages,
    loadOlderMessages,
    sendMessage,
    sendAttachment,
    reactToMessage,
    sendReadReceiptFor,
    receiveMessage,
    allowConversation,
    denyConversation,
    loadAttachment,
    deleteMessage,
  };
}
