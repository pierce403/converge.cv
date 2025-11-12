/**
 * Messages hook for managing message operations
 */

import { useCallback } from 'react';
import { useMessageStore, useConversationStore, useAuthStore, useContactStore } from '@/lib/stores';
import { getStorage } from '@/lib/storage';
import { getXmtpClient, type XmtpMessage } from '@/lib/xmtp';
import { getResyncReadStateFor } from '@/lib/xmtp/resync-state';
import type { Message } from '@/types';
import { getAddress, isAddress } from 'viem';

export function useMessages() {
  const messagesByConversation = useMessageStore((state) => state.messagesByConversation);
  const isLoading = useMessageStore((state) => state.isLoading);
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
   * Load messages for a conversation
   */
  const loadMessages = useCallback(
    async (conversationId: string) => {
      try {
        setLoading(true);
        const storage = await getStorage();
        let messages = await storage.listMessages(conversationId, { limit: 100 });
        // Filter legacy reaction placeholder bubbles persisted prior to reaction aggregation
        messages = messages.filter((m) => !(m.type === 'system' && /^reaction$/i.test(m.body)));
        setMessages(conversationId, messages);

        // Best-effort: aggregate recent reactions from the network so chips render after refresh
        try {
          const xmtp = getXmtpClient();
          await xmtp.backfillReactionsForConversation(conversationId, 300);
        } catch (e) {
          // Non-fatal if offline
        }
      } catch (error) {
        console.error('Failed to load messages:', error);
      } finally {
        setLoading(false);
      }
    },
    [setLoading, setMessages]
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
        const recipientInboxId = conversation.peerId;

        // Check if recipient is a contact, if not, add them automatically
        if (!isContact(recipientInboxId)) {
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
        }

        // Create message object
        const message: Message = {
          id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          conversationId,
          sender: identity.inboxId ?? identity.address,
          sentAt: Date.now(),
          type: 'text',
          body: content,
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
          lastMessagePreview: content.substring(0, 100),
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
      upsertContactProfile,
      isContact,
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
        // Convert content to string if it's a Uint8Array
        const content = typeof xmtpMessage.content === 'string'
          ? xmtpMessage.content
          : new TextDecoder().decode(xmtpMessage.content);

        const message: Message = {
          id: xmtpMessage.id,
          conversationId,
          sender: xmtpMessage.senderAddress,
          sentAt: xmtpMessage.sentAt,
          receivedAt: Date.now(),
          type: 'text',
          body: content,
          status: 'delivered',
          reactions: [],
        };

        // Heuristic de-duplication: if this message is from us (inboxId),
        // remove a recent optimistic local message with same body.
        try {
            const myInbox = identity?.inboxId?.toLowerCase();
            const senderLower = xmtpMessage.senderAddress?.toLowerCase?.();
            if (myInbox && senderLower && myInbox === senderLower) {
              const likely = messagesByConversation[conversationId] || [];
              const now = Date.now();
            const myAddr = identity?.address?.toLowerCase();
            const candidates = likely.filter(
              (m) =>
                m.type === 'text' &&
                m.body === content &&
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
        const storage = await getStorage();
        await storage.putMessage(message);

        // Update conversation
        updateConversation(conversationId, {
          lastMessageAt: message.sentAt,
          lastMessagePreview: message.body.substring(0, 100),
          lastMessageId: message.id,
          lastMessageSender: message.sender,
        });

        // Increment unread if not viewing this conversation
        // (This would be better handled in a global message listener)
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
    isLoading,
    isSending,
    clearMessages,
    loadMessages,
    sendMessage,
    reactToMessage,
    sendReadReceiptFor,
    receiveMessage,
    deleteMessage,
  };
}
