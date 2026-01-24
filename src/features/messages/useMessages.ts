/**
 * Messages hook for managing message operations
 */

import { useCallback } from 'react';
import { useMessageStore, useConversationStore, useAuthStore, useContactStore } from '@/lib/stores';
import { getStorage } from '@/lib/storage';
import { getXmtpClient, type XmtpMessage } from '@/lib/xmtp';
import { getResyncReadStateFor } from '@/lib/xmtp/resync-state';
import type { Message, Attachment as StoredAttachment, Conversation } from '@/types';
import { getAddress, isAddress } from 'viem';
import { isLikelyConvosInviteCode, tryParseConvosInvite } from '@/lib/utils/convos-invite';

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10MB safety cap

const toArrayBuffer = (data: Uint8Array): ArrayBuffer => {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return copy.buffer;
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

export function useMessages() {
  const messagesByConversation = useMessageStore((state) => state.messagesByConversation);
  const isSending = useMessageStore((state) => state.isSending);
  const setMessages = useMessageStore((state) => state.setMessages);
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
    async (conversationId: string, syncFromNetwork = false) => {
      try {
        setLoading(conversationId, true);

        // If syncing from network, sync the conversation first
        if (syncFromNetwork) {
          await syncConversation(conversationId, { force: true });
        }

        const storage = await getStorage();
        let messages = await storage.listMessages(conversationId, { limit: 100 });
        // Filter legacy reaction and reply placeholder bubbles persisted prior to aggregation/structured handling
        messages = messages.filter(
          (m) =>
            !(
              m.type === 'system' &&
              (/^reaction$/i.test(m.body) || /^reply$/i.test(m.body))
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
      } catch (error) {
        console.error('Failed to load messages:', error);
      } finally {
        setLoading(conversationId, false);
      }
    },
    [setLoading, setMessages, syncConversation]
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

      // If recipientInboxId looks like an address, try to derive the actual inbox ID
      let actualInboxId = recipientInboxId;
      if (normalizedAddress) {
        try {
          const xmtp = getXmtpClient();
          // Use getInboxIdFromAddress first (more reliable for registered users)
          let derivedInboxId = await xmtp.getInboxIdFromAddress(normalizedAddress);
          if (!derivedInboxId) {
            // Fallback to deriveInboxIdFromAddress if getInboxIdFromAddress fails
            derivedInboxId = await xmtp.deriveInboxIdFromAddress(normalizedAddress);
          }
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
      // Use the derived inbox ID, or the address if derivation failed
      let profile = undefined;
      try {
        const xmtp = getXmtpClient();
        const profileLookupKey = actualInboxId.startsWith('0x') ? normalizedAddress || actualInboxId : actualInboxId;
        profile = await xmtp.fetchInboxProfile(profileLookupKey);
        console.log('[useMessages] Fetched profile for new contact:', profile);

        // If profile has a valid inbox ID (not an address), use it
        if (profile.inboxId && !profile.inboxId.startsWith('0x') && profile.inboxId.length > 10) {
          actualInboxId = profile.inboxId.toLowerCase();
          console.log('[useMessages] Using inbox ID from profile:', actualInboxId);
        }
      } catch (e) {
        console.warn('[useMessages] Failed to fetch profile for new contact, will use fallback:', e);
      }

      // Ensure we're not using an address as the inbox ID
      if (actualInboxId.startsWith('0x')) {
        console.error('[useMessages] ERROR: Contact inbox ID is still an address:', actualInboxId);
        // Try one more time to get the inbox ID
        if (normalizedAddress) {
          try {
            const xmtp = getXmtpClient();
            const lastAttempt = await xmtp.getInboxIdFromAddress(normalizedAddress);
            if (lastAttempt && !lastAttempt.startsWith('0x')) {
              actualInboxId = lastAttempt.toLowerCase();
              console.log('[useMessages] Successfully resolved inbox ID on last attempt:', actualInboxId);
            }
          } catch (e) {
            console.error('[useMessages] Final attempt to resolve inbox ID failed:', e);
          }
        }
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

      if (!file.type.startsWith('image/')) {
        try {
          window.dispatchEvent(new CustomEvent('ui:toast', { detail: 'Please select an image file.' }));
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

        await ensureContactForConversation(conversation);

        const now = Date.now();
        const localMessageId = `msg_${now}_${Math.random().toString(36).substr(2, 9)}`;
        const attachmentId = `att_${localMessageId}`;
        const filename = file.name || 'image';
        const mimeType = file.type || 'application/octet-stream';

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

        const fileBuffer = await file.arrayBuffer();
        const attachmentMeta: StoredAttachment = {
          id: attachmentId,
          messageId: localMessageId,
          filename,
          mimeType,
          size: fileBuffer.byteLength,
        };
        await storage.putAttachment(attachmentMeta, fileBuffer);

        let latestMessageId = message.id;
        let latestMessageSentAt = message.sentAt;
        let latestMessageSender = message.sender;

        try {
          const xmtp = getXmtpClient();
          const sentMessage = await xmtp.sendAttachment(conversationId, {
            filename,
            mimeType,
            data: new Uint8Array(fileBuffer),
          });

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
          if (resolvedId !== message.id) {
            removeMessage(message.id);
            await storage.deleteMessage(message.id);
            addMessage(conversationId, finalMessage);
            await storage.putMessage(finalMessage);

            const storedAttachment = await storage.getAttachment(attachmentId);
            if (storedAttachment) {
              const updatedAttachment: StoredAttachment = {
                ...storedAttachment.attachment,
                id: finalAttachmentId,
                messageId: resolvedId,
                storageRef: remoteMeta?.url ?? storedAttachment.attachment.storageRef,
                sha256: remoteMeta?.contentDigest ?? storedAttachment.attachment.sha256,
              };
              await storage.putAttachment(updatedAttachment, storedAttachment.data);
              await storage.deleteAttachment(attachmentId);
            }
          } else {
            updateMessage(resolvedId, { status: finalStatus, sentAt: resolvedSentAt, attachmentId: finalAttachmentId });
            await storage.updateMessageStatus(resolvedId, finalStatus);
            const storedAttachment = await storage.getAttachment(attachmentId);
            if (storedAttachment && remoteMeta) {
              const updatedAttachment: StoredAttachment = {
                ...storedAttachment.attachment,
                storageRef: remoteMeta.url,
                sha256: remoteMeta.contentDigest,
              };
              await storage.putAttachment(updatedAttachment, storedAttachment.data);
            }
          }
        } catch (xmtpError) {
          console.error('Failed to send attachment via XMTP:', xmtpError);
          updateMessage(message.id, { status: 'failed' });
          await storage.updateMessageStatus(message.id, 'failed');
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
  type ReceiptMap = Record<string, number>;
  const getReceiptMap = useCallback(() => {
    const g = globalThis as unknown as { __cv_last_receipts?: ReceiptMap };
    if (!g.__cv_last_receipts) g.__cv_last_receipts = {};
    return g.__cv_last_receipts;
  }, []);

  const sendReadReceiptFor = useCallback(
    async (conversationId: string, latestIncomingAt?: number) => {
      try {
        // Compute latest incoming ts if not provided
        let latest = latestIncomingAt;
        if (latest == null) {
          const mineAddr = identity?.address?.toLowerCase();
          const mineInbox = identity?.inboxId?.toLowerCase();
          const list = messagesByConversation[conversationId] || [];
          for (const m of list) {
            const s = m.sender?.toLowerCase?.();
            const fromPeer = s && s !== mineAddr && s !== mineInbox;
            if (fromPeer) {
              latest = Math.max(latest || 0, m.sentAt || 0);
            }
          }
        }
        if (!latest) return;

        const map = getReceiptMap();
        const prev = map[conversationId] || 0;
        const now = Date.now();
        // Only send if we haven't acknowledged up to this message yet, and rate-limit to avoid duplicates
        if (latest <= prev || now - prev < 5000) return;

        await getXmtpClient().sendReadReceipt(conversationId);
        map[conversationId] = latest;
      } catch {
        // non-fatal
      }
    },
    [identity, messagesByConversation, getReceiptMap]
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
        const inMemory = messagesByConversation[conversationId] || [];
        if (inMemory.some((m) => m.id === xmtpMessage.id)) {
          return;
        }
        const storage = await getStorage();
        try {
          const existing = await storage.getMessage(xmtpMessage.id);
          if (existing) {
            return;
          }
        } catch {
          // ignore storage lookup errors; proceed with processing
        }
        const remoteAttachment = xmtpMessage.remoteAttachment;
        const inlineAttachment = xmtpMessage.attachment;
        if (remoteAttachment || inlineAttachment) {
          const attachmentId = `att_${xmtpMessage.id}`;
          let stored = await storage.getAttachment(attachmentId);

          if (!stored) {
            try {
              if (inlineAttachment) {
                const buffer = toArrayBuffer(inlineAttachment.data);
                const meta: StoredAttachment = {
                  id: attachmentId,
                  messageId: xmtpMessage.id,
                  filename: inlineAttachment.filename,
                  mimeType: inlineAttachment.mimeType,
                  size: inlineAttachment.data.byteLength,
                };
                await storage.putAttachment(meta, buffer);
                stored = { attachment: meta, data: buffer };
              } else if (remoteAttachment) {
                if (remoteAttachment.contentLength > MAX_ATTACHMENT_BYTES) {
                  try {
                    window.dispatchEvent(
                      new CustomEvent('ui:toast', {
                        detail: `Attachment too large (${Math.round(remoteAttachment.contentLength / (1024 * 1024))}MB).`,
                      })
                    );
                  } catch {
                    // ignore toast errors
                  }
                } else {
                  const decoded = await getXmtpClient().loadRemoteAttachment(remoteAttachment);
                  const buffer = toArrayBuffer(decoded.data);
                  const meta: StoredAttachment = {
                    id: attachmentId,
                    messageId: xmtpMessage.id,
                    filename: decoded.filename,
                    mimeType: decoded.mimeType,
                    size: decoded.data.byteLength,
                    storageRef: remoteAttachment.url,
                    sha256: remoteAttachment.contentDigest,
                  };
                  await storage.putAttachment(meta, buffer);
                  stored = { attachment: meta, data: buffer };
                }
              }
            } catch (attachmentError) {
              console.warn('[useMessages] Failed to load attachment:', attachmentError);
            }
          } else if (remoteAttachment && !stored.attachment.storageRef) {
            try {
              const updated: StoredAttachment = {
                ...stored.attachment,
                storageRef: remoteAttachment.url,
                sha256: remoteAttachment.contentDigest,
              };
              await storage.putAttachment(updated, stored.data);
              stored = { attachment: updated, data: stored.data };
            } catch (err) {
              // ignore metadata update errors
            }
          }

          const attachmentName =
            stored?.attachment.filename || inlineAttachment?.filename || remoteAttachment?.filename || 'Attachment';

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
    ]
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
    sendMessage,
    sendAttachment,
    reactToMessage,
    sendReadReceiptFor,
    receiveMessage,
    deleteMessage,
  };
}
