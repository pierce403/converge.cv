/**
 * Chat list component
 */

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useConversations } from './useConversations';
import { useConversationStore, useMessageStore } from '@/lib/stores';
import { getStorage } from '@/lib/storage';
import { getXmtpClient } from '@/lib/xmtp';
import { clearResyncReadState, getResyncReadState, setResyncReadState } from '@/lib/xmtp/resync-state';
import { formatDistanceToNow } from '@/lib/utils/date';
import { getContactInfo } from '@/lib/default-contacts';
import { useContactStore, useAuthStore } from '@/lib/stores';
import type { Contact } from '@/lib/stores/contact-store';
import { ContactCardModal } from '@/components/ContactCardModal';
import { ConversationDetailsModal } from '@/features/conversations/ConversationDetailsModal';
import { sanitizeAvatarGlyph, sanitizeImageSrc } from '@/lib/utils/image';

export function ChatList() {
  const { conversations, isLoading } = useConversations();
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [detailsConvId, setDetailsConvId] = useState<string | null>(null);
  const [pressTimer, setPressTimer] = useState<number | null>(null);
  const [isResyncing, setIsResyncing] = useState(false);
  type ConversationItem = typeof conversations[number];
  const contacts = useContactStore((state) => state.contacts);
  const loadContacts = useContactStore((state) => state.loadContacts);
  const setConversations = useConversationStore((s) => s.setConversations);
  const { loadConversations } = useConversations();
  const messagesByConversation = useMessageStore((s) => s.messagesByConversation);

  const startLongPress = (convId: string) => (e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation();
    if (pressTimer) {
      window.clearTimeout(pressTimer);
    }
    const t = window.setTimeout(() => {
      setDetailsConvId(convId);
    }, 550);
    setPressTimer(t);
  };

  const clearLongPress = () => {
    if (pressTimer) {
      window.clearTimeout(pressTimer);
      setPressTimer(null);
    }
  };

  useEffect(() => {
    loadContacts();
  }, [loadContacts]);

  const contactsByAddress = useMemo(() => {
    const map = new Map<string, Contact>();
    contacts.forEach((contact) => {
      contact.addresses?.forEach((address) => {
        map.set(address.toLowerCase(), contact);
      });
    });
    return map;
  }, [contacts]);

  const contactsByInboxId = useMemo(() => {
    const map = new Map<string, Contact>();
    contacts.forEach((contact) => {
      map.set(contact.inboxId.toLowerCase(), contact);
    });
    return map;
  }, [contacts]);

  const identity = useAuthStore((s) => s.identity);

  const getContactForConversation = (conversation: ConversationItem) => {
    if (conversation.isGroup) {
      return undefined;
    }
    const peerId = conversation.peerId?.toLowerCase?.();
    if (!peerId) {
      return undefined;
    }
    // Hide self-DMs just in case
    const myInbox = identity?.inboxId?.toLowerCase();
    const myAddr = identity?.address?.toLowerCase();
    if ((myInbox && peerId === myInbox) || (myAddr && peerId === myAddr)) {
      return undefined;
    }
    return contactsByAddress.get(peerId) ?? contactsByInboxId.get(peerId);
  };

  const renderAvatar = (avatar: string | undefined, fallback: string) => {
    const safeAvatar = sanitizeImageSrc(avatar);
    if (safeAvatar) {
      return (
        <img
          src={safeAvatar}
          alt="Conversation avatar"
          className="w-full h-full rounded-full object-cover"
        />
      );
    }
    const avatarGlyph = sanitizeAvatarGlyph(avatar);
    if (avatarGlyph) {
      return (
        <span className="text-lg" aria-hidden>
          {avatarGlyph}
        </span>
      );
    }
    return (
      <span className="text-white font-semibold" aria-hidden>
        {fallback.slice(0, 2).toUpperCase()}
      </span>
    );
  };

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

  const normalizePreviewText = (value: string): string => {
    const trimmed = value.trim();
    if (!trimmed) return '';
    if (trimmed.startsWith('cv:profile:')) return 'Profile updated';
    if (trimmed.startsWith('{') && trimmed.includes('"type"') && trimmed.includes('"profile"')) {
      return 'Profile updated';
    }
    if (trimmed.startsWith('data:image/')) {
      return 'Profile updated';
    }
    return value;
  };

  // Sort: pinned first, then by lastMessageAt
  const sortedConversations = [...conversations].sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return b.lastMessageAt - a.lastMessageAt;
  });

  const activeConversations = sortedConversations.filter((c) => !c.archived);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-primary-200">Loading conversations...</div>
      </div>
    );
  }

  if (activeConversations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-4 text-center">
        <div className="w-20 h-20 bg-primary-900/60 rounded-full flex items-center justify-center mb-4">
          <svg
            className="w-10 h-10 text-primary-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
            />
          </svg>
        </div>
        <h3 className="text-lg font-semibold mb-2 text-primary-50">No conversations yet</h3>
        <p className="text-primary-200 mb-4">Start a new chat to begin messaging</p>
        <Link to="/new-chat" className="btn-primary">
          New Chat
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto">
        {activeConversations.map((conversation) => {
          const contact = getContactForConversation(conversation);
          const defaultContactInfo = !conversation.isGroup
            ? getContactInfo(contact?.primaryAddress ?? contact?.addresses?.[0] ?? conversation.peerId)
            : undefined;

          const displayName = conversation.isGroup
            ? conversation.groupName || 'Group Chat'
            : contact?.preferredName
              || contact?.name
              || conversation.displayName
              || defaultContactInfo?.name
              || formatIdentifier(contact?.primaryAddress ?? contact?.addresses?.[0] ?? conversation.peerId);

          const avatarSource = conversation.isGroup
            ? conversation.groupImage || conversation.displayAvatar
            : conversation.displayAvatar || contact?.preferredAvatar || contact?.avatar || defaultContactInfo?.avatar;

          const fallbackAvatarLabel = conversation.isGroup
            ? conversation.groupName || 'Group'
            : contact?.primaryAddress ?? contact?.addresses?.[0] ?? conversation.peerId;

          const conversationDescription = contact?.description ?? defaultContactInfo?.description;

          // Compute preview from most recent message if available for extra correctness
          let subtitle = conversation.lastMessagePreview || '';
          const msgs = messagesByConversation[conversation.id] || [];
          if (msgs.length) {
            const last = msgs[msgs.length - 1];
            if (last.type === 'text') subtitle = normalizePreviewText(last.body);
            else if (last.type === 'system') subtitle = last.body;
            else subtitle = '📎 Attachment';
          }
          subtitle = normalizePreviewText(subtitle);
          if (!subtitle) {
            subtitle = conversationDescription || 'No messages yet';
          }

          return (
            <div
              key={conversation.id}
              className="border-b border-primary-900/40 hover:bg-primary-900/50 transition-colors"
              onMouseDown={startLongPress(conversation.id)}
              onMouseUp={clearLongPress}
              onMouseLeave={clearLongPress}
              onTouchStart={startLongPress(conversation.id)}
              onTouchEnd={clearLongPress}
            >
              <div className="flex items-center px-4 py-3">
                {/* Avatar - clickable */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (conversation.isGroup) {
                      return;
                    }

                    if (contact) {
                      setSelectedContact(contact);
                      return;
                    }

                    const rawPeerId = conversation.peerId;
                    const normalizedPeerId = rawPeerId?.toLowerCase?.();
                    if (!normalizedPeerId) {
                      console.warn('[ChatList] Missing peer identifier for conversation', conversation.id);
                      return;
                    }

                    const fallbackAddress = normalizedPeerId.startsWith('0x')
                      ? normalizedPeerId
                      : undefined;

                    const normalizedAddress = fallbackAddress?.toLowerCase();

                    const placeholder: Contact = {
                      inboxId: normalizedPeerId,
                      name: displayName || formatIdentifier(normalizedPeerId),
                      preferredName: displayName || undefined,
                      avatar: avatarSource,
                      preferredAvatar: avatarSource,
                      description: conversationDescription,
                      createdAt: Date.now(),
                      source: 'inbox',
                      isInboxOnly: true,
                      primaryAddress: normalizedAddress,
                      addresses: normalizedAddress ? [normalizedAddress] : [],
                      identities: normalizedAddress
                        ? [
                            {
                              identifier: normalizedAddress,
                              kind: 'Ethereum',
                              isPrimary: true,
                            },
                          ]
                        : [],
                    };

                    setSelectedContact(placeholder);
                  }}
                  className="w-12 h-12 rounded-full bg-primary-700/80 flex items-center justify-center flex-shrink-0 text-lg hover:ring-2 hover:ring-accent-400 transition-all"
                >
                  {conversation.isGroup && !avatarSource ? (
                    <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.653-.146-1.28-.422-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.653.146-1.28.422-1.857m0 0a5 5 0 019.156 0M12 10a3 3 0 11-6 0 3 0 016 0zm-6 0a3 0 10-6 0 3 3 0 006 0z" />
                    </svg>
                  ) : (
                    renderAvatar(avatarSource, fallbackAvatarLabel)
                  )}
                </button>

                {/* Content - clickable to open conversation */}
                <Link
                  to={`/chat/${conversation.id}`}
                  className="flex-1 min-w-0 ml-3"
                >
                  <div className="flex items-baseline justify-between mb-1">
                    <h3 className="text-sm font-semibold truncate">{displayName}</h3>
                    <span className="text-xs text-primary-300 ml-2 flex-shrink-0">
                      {formatDistanceToNow(conversation.lastMessageAt)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-primary-200 truncate">
                      {subtitle}
                    </p>
                    {conversation.unreadCount > 0 && (
                      <span className="ml-2 bg-accent-500 text-white text-xs font-semibold rounded-full w-5 h-5 flex items-center justify-center flex-shrink-0">
                        {conversation.unreadCount > 9 ? '9+' : conversation.unreadCount}
                      </span>
                    )}
                  </div>
                </Link>

                {/* Pin indicator */}
                {conversation.pinned && (
                  <div className="ml-2">
                    <svg
                      className="w-4 h-4 text-accent-400"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path d="M10 2a1 1 0 011 1v1.323l3.954 1.582 1.599-.8a1 1 0 01.894 1.79l-1.233.616 1.738 5.42a1 1 0 01-.285 1.05A3.989 3.989 0 0115 15a3.989 3.989 0 01-2.667-1.019 1 1 0 01-.285-1.05l1.738-5.42-1.233-.617a1 1 0 01.894-1.788l1.599.799L11 4.323V3a1 1 0 011-1h-2z" />
                    </svg>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* New chat and New Group buttons */}
      <div className="p-4 border-t border-primary-900/40 bg-primary-950/40 flex gap-2">
        <Link to="/new-chat" className="btn-primary w-full inline-flex items-center justify-center text-center">
          + New Chat
        </Link>
        <Link to="/new-group" className="btn-secondary w-full inline-flex items-center justify-center text-center">
          + New Group
        </Link>
        <button
          className="btn-secondary w-full"
          disabled={isResyncing}
          onClick={async () => {
            if (isResyncing) return;
            if (!confirm('This will delete all local conversations and the XMTP database, then reload everything fresh from the network. Continue?')) {
              return;
            }
            setIsResyncing(true);
            try {
              const xmtp = getXmtpClient();
              const currentIdentity = useAuthStore.getState().identity;
              
              // 1) Preserve read state before clearing
              const storage = await getStorage();
              const existing = await storage.listConversations();
              const preservedReadState = new Map<string, { lastReadAt?: number; lastReadMessageId?: string | null }>();
              for (const c of existing) {
                if (c.lastReadAt !== undefined || c.lastReadMessageId !== undefined) {
                  preservedReadState.set(c.id, {
                    lastReadAt: c.lastReadAt,
                    lastReadMessageId: c.lastReadMessageId ?? null,
                  });
                }
              }
              setResyncReadState(preservedReadState);
              
              // 2) Visibly clear current list
              setConversations([]);
              
              // 3) Disconnect XMTP to release OPFS locks
              console.log('[Resync] Disconnecting XMTP client...');
              try {
                await xmtp.disconnect();
                // Wait for OPFS locks to be released
                await new Promise(resolve => setTimeout(resolve, 500));
              } catch (e) {
                console.warn('[Resync] XMTP disconnect failed:', e);
              }
              
              // 4) Clear XMTP OPFS database to remove corrupted MLS state
              console.log('[Resync] Clearing XMTP database...');
              try {
                const opfsAddresses = currentIdentity?.address ? [currentIdentity.address] : [];
                await storage.clearAllData({ opfsAddresses });
              } catch (e) {
                console.warn('[Resync] Failed to clear XMTP database:', e);
              }
              
              // 5) Reconnect to XMTP (creates fresh database)
              console.log('[Resync] Reconnecting to XMTP...');
              if (currentIdentity) {
                try {
                  await xmtp.connect(currentIdentity, { enableHistorySync: true });
                  try {
                    await xmtp.sendSyncRequest();
                  } catch (e) {
                    console.warn('[Resync] XMTP sendSyncRequest failed:', e);
                  }
                } catch (e) {
                  console.warn('[Resync] XMTP reconnect failed:', e);
                }
              }
              
              // 6) Load conversations from fresh sync
              await loadConversations();
              
              // 7) Restore read state
              const resyncedState = getResyncReadState();
              if (resyncedState && resyncedState.size > 0) {
                try {
                  const refreshedStorage = await getStorage();
                  for (const [conversationId, state] of resyncedState.entries()) {
                    const existingConversation = await refreshedStorage.getConversation(conversationId);
                    if (!existingConversation) continue;
                    const updates: Partial<typeof existingConversation> = {};
                    if (state.lastReadAt !== undefined) {
                      updates.lastReadAt = state.lastReadAt;
                    }
                    if (state.lastReadMessageId !== undefined) {
                      updates.lastReadMessageId = state.lastReadMessageId ?? undefined;
                    }
                    if (Object.keys(updates).length > 0) {
                      await refreshedStorage.putConversation({ ...existingConversation, ...updates });
                      useConversationStore.getState().updateConversation(conversationId, updates);
                    }
                  }
                } catch (e) {
                  console.warn('[Resync] Failed to restore read state after resync:', e);
                } finally {
                  clearResyncReadState();
                }
              } else {
                clearResyncReadState();
              }
              
              try {
                window.dispatchEvent(new CustomEvent('ui:toast', { detail: 'Resynced conversations from network' }));
              } catch (e) {
                /* ignore */
              }
            } catch (err) {
              console.error('Resync failed:', err);
              alert('Resync failed. See console for details.');
              clearResyncReadState();
            } finally {
              setIsResyncing(false);
            }
          }}
        >
          {isResyncing ? 'Resyncing…' : 'Resync All'}
        </button>
      </div>

      {/* User info modal */}
      {selectedContact && (
        <ContactCardModal contact={selectedContact} onClose={() => setSelectedContact(null)} />
      )}
      {detailsConvId && (
        <ConversationDetailsModal
          conversationId={detailsConvId}
          onClose={() => setDetailsConvId(null)}
        />
      )}
    </div>
  );
}
