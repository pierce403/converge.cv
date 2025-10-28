/**
 * Conversation view component
 */

import { useEffect, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useMessageStore } from '@/lib/stores';
import { useConversations } from '@/features/conversations';
import { MessageBubble } from './MessageBubble';
import { MessageComposer } from './MessageComposer';
import { useMessages } from './useMessages';
import type { XmtpMessage } from '@/lib/xmtp';

export function ConversationView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { conversations } = useConversations();
  const { messagesByConversation, isLoading } = useMessageStore();
  const { sendMessage, loadMessages, receiveMessage } = useMessages();

  const conversation = conversations.find((c) => c.id === id);
  const messages = useMemo(() => messagesByConversation[id || ''] || [], [messagesByConversation, id]);

  useEffect(() => {
    if (id) {
      loadMessages(id);
    }
  }, [id, loadMessages]);

  useEffect(() => {
    // Listen for incoming XMTP messages
    const handleIncomingMessage = (event: Event) => {
      const customEvent = event as CustomEvent<{ conversationId: string; message: XmtpMessage }>;
      const { conversationId, message } = customEvent.detail;
      
      // Only handle messages for the currently viewed conversation
      if (conversationId === id) {
        console.log('[ConversationView] Received message for current conversation:', message);
        receiveMessage(conversationId, message);
      }
    };

    window.addEventListener('xmtp:message', handleIncomingMessage);
    return () => {
      window.removeEventListener('xmtp:message', handleIncomingMessage);
    };
  }, [id, receiveMessage]);

  useEffect(() => {
    // Scroll to bottom when messages change
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (!conversation) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <p className="text-slate-400 mb-4">Conversation not found</p>
          <button onClick={() => navigate('/')} className="btn-primary">
            Back to Chats
          </button>
        </div>
      </div>
    );
  }

  const handleSend = async (content: string) => {
    if (!id) return;
    await sendMessage(id, content);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="bg-slate-800 border-b border-slate-700 px-4 py-3 flex items-center gap-3">
        <button
          onClick={() => navigate('/')}
          className="p-2 hover:bg-slate-700 rounded-lg transition-colors"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        <div className="w-10 h-10 rounded-full bg-primary-600 flex items-center justify-center flex-shrink-0">
          <span className="text-white font-semibold text-sm">
            {conversation.peerId.slice(2, 4).toUpperCase()}
          </span>
        </div>

        <div className="flex-1 min-w-0">
          <h2 className="font-semibold truncate">
            {conversation.peerId.slice(0, 10)}...{conversation.peerId.slice(-8)}
          </h2>
          <p className="text-xs text-slate-400">XMTP messaging</p>
        </div>

        <button className="p-2 hover:bg-slate-700 rounded-lg transition-colors">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z"
            />
          </svg>
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 bg-slate-900">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-slate-400">Loading messages...</div>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="w-16 h-16 bg-slate-800 rounded-full flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                />
              </svg>
            </div>
            <p className="text-slate-400">No messages yet</p>
            <p className="text-sm text-slate-500 mt-1">Send a message to start the conversation</p>
          </div>
        ) : (
          <>
            {messages.map((message) => (
              <MessageBubble key={message.id} message={message} />
            ))}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Composer */}
      <MessageComposer onSend={handleSend} />
    </div>
  );
}

