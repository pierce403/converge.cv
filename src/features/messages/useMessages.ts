/**
 * Messages hook for managing message operations
 */

import { useCallback } from 'react';
import { useMessageStore, useConversationStore, useAuthStore, useContactStore } from '@/lib/stores';
import { getStorage } from '@/lib/storage';
import { getXmtpClient, type XmtpMessage } from '@/lib/xmtp';
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
        const messages = await storage.listMessages(conversationId, { limit: 100 });
        setMessages(conversationId, messages);
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
          await upsertContactProfile({
            inboxId: recipientInboxId,
            displayName: recipientInboxId,
            primaryAddress: normalizedAddress?.toLowerCase(),
            addresses: addressList,
            identities: normalizedAddress
              ? [
                  {
                    identifier: normalizedAddress.toLowerCase(),
                    kind: 'Ethereum',
                    isPrimary: true,
                  },
                ]
              : [],
            source: 'inbox',
          });
          console.log('Automatically added new contact:', recipientInboxId);
        }

        // Create message object
        const message: Message = {
          id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          conversationId,
          sender: identity.address,
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

        // Send via XMTP
        try {
          const xmtp = getXmtpClient();
          if (opts?.replyToId) {
            await xmtp.sendReply(conversationId, opts.replyToId, content);
          } else {
            await xmtp.sendMessage(conversationId, content);
          }

          // Update status to sent
          message.status = 'sent';
          updateMessage(message.id, { status: 'sent' });
          await storage.updateMessageStatus(message.id, 'sent');
        } catch (xmtpError) {
          console.error('Failed to send via XMTP:', xmtpError);
          message.status = 'failed';
          updateMessage(message.id, { status: 'failed' });
          await storage.updateMessageStatus(message.id, 'failed');
        }

        // Update conversation
        updateConversation(conversationId, {
          lastMessageAt: message.sentAt,
          lastMessagePreview: content.substring(0, 100),
        });
      } catch (error) {
        console.error('Failed to send message:', error);
      } finally {
        setSending(false);
      }
    },
    [identity, addMessage, updateMessage, setSending, updateConversation, conversations, upsertContactProfile, isContact]
  );

  /**
   * React to a message with an emoji
   */
  const reactToMessage = useCallback(
    async (conversationId: string, messageId: string, emoji: string) => {
      if (!identity) return;
      try {
        await getXmtpClient().sendReaction(conversationId, messageId, emoji, 'added', 'unicode');
        // Optimistically update local store
        const current = messagesByConversation[conversationId] || [];
        const idx = current.findIndex((m) => m.id === messageId);
        if (idx >= 0) {
          const msg = current[idx];
          updateMessage(messageId, {
            reactions: [...(msg.reactions || []), { emoji, sender: identity.address, timestamp: Date.now() }],
          });
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
  const sendReadReceiptFor = useCallback(
    async (conversationId: string) => {
      try {
        await getXmtpClient().sendReadReceipt(conversationId);
      } catch {
        // non-fatal
      }
    },
    []
  );

  /**
   * Receive a message (from XMTP stream)
   */
  const receiveMessage = useCallback(
    async (conversationId: string, xmtpMessage: XmtpMessage) => {
      try {
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
        });

        // Increment unread if not viewing this conversation
        // (This would be better handled in a global message listener)
        incrementUnread(conversationId);
      } catch (error) {
        console.error('Failed to receive message:', error);
      }
    },
    [addMessage, updateConversation, incrementUnread, messagesByConversation, identity, removeMessage]
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
