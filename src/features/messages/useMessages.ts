/**
 * Messages hook for managing message operations
 */

import { useCallback } from 'react';
import { useMessageStore, useConversationStore, useAuthStore } from '@/lib/stores';
import { getStorage } from '@/lib/storage';
import { getXmtpClient, type XmtpMessage } from '@/lib/xmtp';
import type { Message } from '@/types';

export function useMessages() {
  const messageStore = useMessageStore();
  const conversationStore = useConversationStore();
  const { identity } = useAuthStore();

  /**
   * Load messages for a conversation
   */
  const loadMessages = useCallback(
    async (conversationId: string) => {
      try {
        messageStore.setLoading(true);
        const storage = await getStorage();
        const messages = await storage.listMessages(conversationId, { limit: 100 });
        messageStore.setMessages(conversationId, messages);
      } catch (error) {
        console.error('Failed to load messages:', error);
      } finally {
        messageStore.setLoading(false);
      }
    },
    [messageStore]
  );

  /**
   * Send a message
   */
  const sendMessage = useCallback(
    async (conversationId: string, content: string) => {
      if (!identity) {
        console.error('No identity available');
        return;
      }

      try {
        messageStore.setSending(true);

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
        };

        // Add to store immediately
        messageStore.addMessage(conversationId, message);

        // Persist to storage
        const storage = await getStorage();
        await storage.putMessage(message);

        // Send via XMTP
        try {
          const xmtp = getXmtpClient();
          await xmtp.sendMessage(conversationId, content);

          // Update status to sent
          message.status = 'sent';
          messageStore.updateMessage(message.id, { status: 'sent' });
          await storage.updateMessageStatus(message.id, 'sent');
        } catch (xmtpError) {
          console.error('Failed to send via XMTP:', xmtpError);
          message.status = 'failed';
          messageStore.updateMessage(message.id, { status: 'failed' });
          await storage.updateMessageStatus(message.id, 'failed');
        }

        // Update conversation
        conversationStore.updateConversation(conversationId, {
          lastMessageAt: message.sentAt,
          lastMessagePreview: content.substring(0, 100),
        });
      } catch (error) {
        console.error('Failed to send message:', error);
      } finally {
        messageStore.setSending(false);
      }
    },
    [identity, messageStore, conversationStore]
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

        // Add to store
        messageStore.addMessage(conversationId, message);

        // Persist to storage
        const storage = await getStorage();
        await storage.putMessage(message);

        // Update conversation
        conversationStore.updateConversation(conversationId, {
          lastMessageAt: message.sentAt,
          lastMessagePreview: message.body.substring(0, 100),
        });

        // Increment unread if not viewing this conversation
        // (This would be better handled in a global message listener)
        conversationStore.incrementUnread(conversationId);
      } catch (error) {
        console.error('Failed to receive message:', error);
      }
    },
    [messageStore, conversationStore]
  );

  /**
   * Delete a message
   */
  const deleteMessage = useCallback(
    async (messageId: string) => {
      try {
        const storage = await getStorage();
        await storage.deleteMessage(messageId);
        messageStore.removeMessage(messageId);
      } catch (error) {
        console.error('Failed to delete message:', error);
      }
    },
    [messageStore]
  );

  return {
    ...messageStore,
    loadMessages,
    sendMessage,
    receiveMessage,
    deleteMessage,
  };
}

