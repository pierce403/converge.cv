import { useEffect, useRef, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useMessageStore, useAuthStore, useContactStore } from '@/lib/stores';
import { useConversations } from '@/features/conversations';
import { MessageBubble } from './MessageBubble';
import { MessageComposer } from './MessageComposer';
import { useMessages } from './useMessages';
import { ContactCardModal } from '@/components/ContactCardModal';
import { getContactInfo } from '@/lib/default-contacts';
import { AddContactButton } from '@/features/contacts/AddContactButton';
import type { Message } from '@/types';
import type { Contact as ContactType } from '@/lib/stores/contact-store';

export function ConversationView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [showUserInfo, setShowUserInfo] = useState(false);

  const { conversations } = useConversations();
  const { messagesByConversation, isLoading } = useMessageStore();
  const { sendMessage, loadMessages } = useMessages();
  const { identity } = useAuthStore(); // Get current user identity
  const contacts = useContactStore((state) => state.contacts);
  const loadContacts = useContactStore((state) => state.loadContacts);

  const conversation = conversations.find((c) => c.id === id);
  const messages = useMemo(() => messagesByConversation[id || ''] || [], [messagesByConversation, id]);

  const isCurrentUserAdmin = useMemo(() => {
    if (!conversation?.isGroup || !identity?.address || !conversation.admins) {
      return false;
    }
    return conversation.admins.includes(identity.address);
  }, [conversation, identity]);

  useEffect(() => {
    if (id) {
      loadMessages(id);
    }
  }, [id, loadMessages]);

  useEffect(() => {
    loadContacts();
  }, [loadContacts]);

  // Note: Message handling is done globally in Layout.tsx
  // This component just displays messages from the store

  useEffect(() => {
    // Scroll to bottom when messages change
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const contact = useMemo(() => {
    if (!conversation || conversation.isGroup) {
      return undefined;
    }
    const peerLower = conversation.peerId.toLowerCase();
    return (
      contacts.find((entry) => entry.inboxId.toLowerCase() === peerLower) ??
      contacts.find((entry) =>
        entry.addresses?.some((address) => address.toLowerCase() === peerLower)
      )
    );
  }, [conversation, contacts]);

  const defaultContactInfo = useMemo(() => {
    if (!conversation || conversation.isGroup) {
      return undefined;
    }
    const lookupKey = contact?.primaryAddress ?? contact?.addresses?.[0] ?? conversation.peerId;
    return getContactInfo(lookupKey);
  }, [conversation, contact]);

  const formatIdentifier = (value: string) => {
    if (!value) {
      return '';
    }
    if (value.startsWith('0x') && value.length > 10) {
      return `${value.slice(0, 6)}...${value.slice(-4)}`;
    }
    if (value.length > 18) {
      return `${value.slice(0, 10)}...${value.slice(-4)}`;
    }
    return value;
  };

  const conversationDisplayName = useMemo(() => {
    if (!conversation) {
      return '';
    }
    if (conversation.isGroup) {
      return conversation.groupName || 'Group Chat';
    }
    return conversation.displayName
      || contact?.preferredName
      || contact?.name
      || defaultContactInfo?.name
      || formatIdentifier(contact?.primaryAddress ?? contact?.addresses?.[0] ?? conversation.peerId);
  }, [conversation, contact, defaultContactInfo]);

  const conversationAvatar = useMemo(() => {
    if (!conversation) {
      return undefined;
    }
    if (conversation.isGroup) {
      return conversation.groupImage || conversation.displayAvatar;
    }
    return (
      conversation.displayAvatar ||
      contact?.preferredAvatar ||
      contact?.avatar ||
      defaultContactInfo?.avatar
    );
  }, [conversation, contact, defaultContactInfo]);

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

  const inboxIdForActions = contact?.inboxId ?? conversation.peerId;
  const contactForModal: ContactType = contact ?? ({
    inboxId: inboxIdForActions.toLowerCase(),
    name: conversationDisplayName,
    createdAt: Date.now(),
    primaryAddress: undefined,
    addresses: [],
    identities: [],
    isInboxOnly: true,
    source: 'inbox',
  } as ContactType);

  const renderAvatar = (avatar: string | undefined, fallback: string) => {
    if (avatar && avatar.startsWith('http')) {
      return <img src={avatar} alt="Conversation avatar" className="w-full h-full rounded-full object-cover" />;
    }
    if (avatar) {
      return <span className="text-lg" aria-hidden>{avatar}</span>;
    }
    const label = fallback.startsWith('0x') && fallback.length > 6
      ? fallback.slice(2, 4).toUpperCase()
      : fallback.slice(0, 2).toUpperCase();
    return <span className="text-white font-semibold" aria-hidden>{label}</span>;
  };

  const handleSend = async (content: string) => {
    if (!id) return;
    await sendMessage(id, content);
  };

  return (
    <div className="flex flex-col h-full text-primary-50">
      {/* Header */}
      <div className="bg-primary-950/70 border-b border-primary-800/60 px-4 py-3 flex items-center gap-3 backdrop-blur-md">
        <button
          onClick={() => navigate('/')}
          className="p-2 text-primary-200 hover:text-primary-50 hover:bg-primary-900/50 rounded-lg transition-colors"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        {conversation.isGroup ? (
          <>
            <button
              onClick={() => navigate(`/chat/${conversation.id}/settings`)}
              className="w-10 h-10 rounded-full bg-primary-800/70 flex items-center justify-center flex-shrink-0 hover:ring-2 hover:ring-accent-400 transition-all"
              title="Group Settings"
            >
              {conversationAvatar ? (
                renderAvatar(conversationAvatar, conversation.groupName || 'Group')
              ) : (
                <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.653-.146-1.28-.422-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.653.146-1.28.422-1.857m0 0a5 5 0 019.156 0M12 10a3 3 0 11-6 0 3 3 0 016 0zm-6 0a3 0 10-6 0 3 3 0 6 0z" />
                </svg>
              )}
            </button>
            <div className="flex-1 min-w-0 text-left flex items-center justify-between">
              <h2 className="font-semibold truncate text-primary-50">{conversationDisplayName}</h2>
              {isCurrentUserAdmin && (
                <button
                  onClick={() => navigate(`/chat/${conversation.id}/settings`)}
                  className="p-2 text-primary-200 hover:text-primary-50 hover:bg-primary-900/50 rounded-lg transition-colors"
                  title="Group Settings"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            <button
              onClick={() => setShowUserInfo(true)}
              className="w-10 h-10 rounded-full bg-primary-800/70 flex items-center justify-center flex-shrink-0 hover:ring-2 hover:ring-accent-400 transition-all"
            >
              {renderAvatar(conversationAvatar, inboxIdForActions)}
            </button>

            <button
              onClick={() => setShowUserInfo(true)}
              className="flex-1 min-w-0 text-left hover:opacity-80 transition-opacity"
            >
              <div className="flex items-center gap-2">
                <h2 className="font-semibold truncate text-primary-50">{conversationDisplayName}</h2>
                <AddContactButton
                  inboxId={conversation.peerId}
                  primaryAddress={contact?.primaryAddress}
                  fallbackName={conversationDisplayName}
                />
              </div>
              <p className="text-xs text-primary-300">XMTP messaging</p>
            </button>
          </>
        )}
        <button className="p-2 text-primary-200 hover:text-primary-50 hover:bg-primary-900/50 rounded-lg transition-colors">
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
      <div className="flex-1 overflow-y-auto px-4 py-4 bg-primary-950/30">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-primary-200">Loading messages...</div>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="w-16 h-16 bg-primary-900/60 rounded-full flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                />
              </svg>
            </div>
            <p className="text-primary-200">No messages yet</p>
            <p className="text-sm text-primary-300 mt-1">Send a message to start the conversation</p>
          </div>
        ) : (
          <>
            {messages.map((message: Message) => (
              <MessageBubble key={message.id} message={message} />
            ))}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Composer */}
      <MessageComposer onSend={handleSend} />

      {/* User info modal */}
      {showUserInfo && (
        <ContactCardModal contact={contactForModal} onClose={() => setShowUserInfo(false)} />
      )}
    </div>
  );
}
