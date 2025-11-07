import { useEffect, useRef, useMemo, useState, Fragment } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useMessageStore, useAuthStore, useContactStore } from '@/lib/stores';
import { useConversations } from '@/features/conversations';
import { MessageBubble } from './MessageBubble';
import { MessageComposer } from './MessageComposer';
import { useMessages } from './useMessages';
import { ContactCardModal } from '@/components/ContactCardModal';
import { getContactInfo } from '@/lib/default-contacts';
import { isDisplayableImageSrc } from '@/lib/utils/image';
import { AddContactButton } from '@/features/contacts/AddContactButton';
import { getXmtpClient } from '@/lib/xmtp';
import type { Message } from '@/types';
import type { Contact as ContactType } from '@/lib/stores/contact-store';
import { Menu, Transition } from '@headlessui/react';

export function ConversationView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [contactForModal, setContactForModal] = useState<ContactType | null>(null);
  const [replyTo, setReplyTo] = useState<Message | null>(null);

  const { conversations, removeConversation, removeMembersFromGroup, deleteGroup } = useConversations();
  const { messagesByConversation, isLoading } = useMessageStore();
  const { sendMessage, loadMessages, sendReadReceiptFor } = useMessages();
  const { identity } = useAuthStore(); // Get current user identity
  const contacts = useContactStore((state) => state.contacts);
  const loadContacts = useContactStore((state) => state.loadContacts);

  const contactsByInboxId = useMemo(() => {
    const map = new Map<string, ContactType>();
    contacts.forEach((contact) => {
      map.set(contact.inboxId.toLowerCase(), contact);
    });
    return map;
  }, [contacts]);

  const contactsByAddress = useMemo(() => {
    const map = new Map<string, ContactType>();
    contacts.forEach((contact) => {
      if (contact.primaryAddress) {
        map.set(contact.primaryAddress.toLowerCase(), contact);
      }
      contact.addresses?.forEach((address) => {
        map.set(address.toLowerCase(), contact);
      });
    });
    return map;
  }, [contacts]);

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
    setContactForModal(null);
  }, [id]);

  useEffect(() => {
    loadContacts();
  }, [loadContacts]);

  useEffect(() => {
    if (!conversation?.isGroup) {
      return;
    }

    const memberSet = new Set<string>();
    conversation.groupMembers?.forEach((member) => {
      if (member.inboxId) {
        memberSet.add(member.inboxId.toLowerCase());
      }
    });
    conversation.memberInboxes?.forEach((memberInbox) => {
      if (memberInbox) {
        memberSet.add(memberInbox.toLowerCase());
      }
    });

    if (memberSet.size === 0) {
      return;
    }

    const myInboxLower = identity?.inboxId?.toLowerCase();
    let cancelled = false;

    const run = async () => {
      try {
        const xmtp = getXmtpClient();
        const contactStore = useContactStore.getState();
        for (const memberInbox of memberSet) {
          if (cancelled) {
            break;
          }
          if (!memberInbox) {
            continue;
          }
          if (myInboxLower && memberInbox === myInboxLower) {
            continue;
          }
          try {
            const existing = contactStore.getContactByInboxId(memberInbox);
            if (existing) {
              const now = Date.now();
              const last = existing.lastSyncedAt ?? 0;
              if (existing.preferredName && existing.preferredAvatar && now - last < 30 * 60 * 1000) {
                continue;
              }
            }

            const profile = await xmtp.fetchInboxProfile(memberInbox);
            if (cancelled) {
              return;
            }

            await contactStore.upsertContactProfile({
              inboxId: profile.inboxId ?? memberInbox,
              displayName: profile.displayName,
              avatarUrl: profile.avatarUrl,
              primaryAddress: profile.primaryAddress,
              addresses: profile.addresses,
              identities: profile.identities,
              source: 'inbox',
              metadata: { lastSyncedAt: Date.now() },
            });
          } catch (error) {
            console.warn('[ConversationView] Failed to refresh member profile', memberInbox, error);
          }
        }
      } catch (error) {
        console.warn('[ConversationView] Failed to load group member profiles', error);
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [conversation?.id, conversation?.isGroup, conversation?.groupMembers, conversation?.memberInboxes, identity?.inboxId]);

  // Note: Message handling is done globally in Layout.tsx
  // This component just displays messages from the store

  useEffect(() => {
    // Scroll to bottom when messages change
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    if (id && messages.length > 0 && conversation && !conversation.isGroup) {
      // Compute latest incoming message timestamp; send one receipt if needed
      const myInbox = identity?.inboxId?.toLowerCase();
      const myAddr = identity?.address?.toLowerCase();
      let latestIncomingAt = 0;
      for (const m of messages) {
        const s = m.sender?.toLowerCase?.();
        const fromPeer = s && s !== myInbox && s !== myAddr;
        if (fromPeer) latestIncomingAt = Math.max(latestIncomingAt, m.sentAt || 0);
      }
      if (latestIncomingAt) {
        void sendReadReceiptFor(id, latestIncomingAt);
      }
    }
  }, [messages, id, conversation, identity?.inboxId, identity?.address, sendReadReceiptFor]);

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

  const groupMemberProfiles = useMemo(() => {
    const map = new Map<string, { displayName?: string; avatar?: string; address?: string }>();
    if (!conversation?.isGroup) {
      return map;
    }

    conversation.groupMembers?.forEach((member) => {
      const inboxLower = member.inboxId?.toLowerCase?.();
      if (!inboxLower) {
        return;
      }
      const addressLower = member.address?.toLowerCase?.();
      const contactMatch =
        contactsByInboxId.get(inboxLower) || (addressLower ? contactsByAddress.get(addressLower) : undefined);
      const displayName =
        contactMatch?.preferredName ||
        contactMatch?.name ||
        member.displayName ||
        (addressLower ? formatIdentifier(addressLower) : formatIdentifier(inboxLower));
      const avatar = contactMatch?.preferredAvatar || contactMatch?.avatar || member.avatar;
      map.set(inboxLower, { displayName, avatar, address: addressLower });
    });

    conversation.memberInboxes?.forEach((memberInbox) => {
      const inboxLower = memberInbox?.toLowerCase?.();
      if (!inboxLower || map.has(inboxLower)) {
        return;
      }
      const contactMatch = contactsByInboxId.get(inboxLower);
      const addressLower = contactMatch?.primaryAddress?.toLowerCase();
      const displayName =
        contactMatch?.preferredName ||
        contactMatch?.name ||
        (addressLower ? formatIdentifier(addressLower) : formatIdentifier(inboxLower));
      const avatar = contactMatch?.preferredAvatar || contactMatch?.avatar;
      map.set(inboxLower, { displayName, avatar, address: addressLower });
    });

    return map;
  }, [conversation, contactsByInboxId, contactsByAddress]);

  const inboxIdForActions = contact?.inboxId ?? conversation?.peerId ?? '';
  const conversationContact = useMemo(() => {
    if (!conversation || conversation.isGroup) {
      return undefined;
    }
    if (contact) {
      return contact;
    }
    if (!inboxIdForActions) {
      return undefined;
    }
    const normalizedInbox = inboxIdForActions.toLowerCase();
    const fallbackAddress = defaultContactInfo?.address?.toLowerCase();
    const fallbackName =
      conversationDisplayName ||
      defaultContactInfo?.name ||
      formatIdentifier(normalizedInbox);
    return {
      inboxId: normalizedInbox,
      name: fallbackName,
      avatar: defaultContactInfo?.avatar,
      preferredAvatar: defaultContactInfo?.avatar,
      preferredName: defaultContactInfo?.name,
      createdAt: Date.now(),
      primaryAddress: fallbackAddress,
      addresses: fallbackAddress ? [fallbackAddress] : [],
      identities: fallbackAddress
        ? [
            {
              identifier: fallbackAddress,
              kind: 'Ethereum',
              isPrimary: true,
            },
          ]
        : [],
      isInboxOnly: true,
      source: 'inbox',
    } as ContactType;
  }, [conversation, conversationDisplayName, contact, inboxIdForActions, defaultContactInfo]);

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

  const resolveContactForSender = (senderLower: string | undefined): ContactType | null => {
    if (!senderLower) {
      return null;
    }
    const existingByInbox = contactsByInboxId.get(senderLower);
    if (existingByInbox) {
      return existingByInbox;
    }
    const existingByAddress = contactsByAddress.get(senderLower);
    if (existingByAddress) {
      return existingByAddress;
    }
    const profile = groupMemberProfiles.get(senderLower);
    const addressLower = profile?.address?.toLowerCase();
    const displayName = profile?.displayName || formatIdentifier(addressLower ?? senderLower);
    const avatar = profile?.avatar;
    return {
      inboxId: senderLower,
      name: displayName,
      avatar,
      preferredAvatar: avatar,
      preferredName: profile?.displayName,
      createdAt: Date.now(),
      primaryAddress: addressLower,
      addresses: addressLower ? [addressLower] : [],
      identities: addressLower
        ? [
            {
              identifier: addressLower,
              kind: 'Ethereum',
              isPrimary: true,
            },
          ]
        : [],
      isInboxOnly: true,
      source: 'inbox',
    } as ContactType;
  };

  const renderAvatar = (avatar: string | undefined, fallback: string) => {
    if (isDisplayableImageSrc(avatar)) {
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
    await sendMessage(id, content, replyTo ? { replyToId: replyTo.id } : undefined);
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
              onClick={() => {
                if (conversationContact) {
                  setContactForModal(conversationContact);
                }
              }}
              className="w-10 h-10 rounded-full bg-primary-800/70 flex items-center justify-center flex-shrink-0 hover:ring-2 hover:ring-accent-400 transition-all"
            >
              {renderAvatar(conversationAvatar, inboxIdForActions)}
            </button>

            <button
              onClick={() => {
                if (conversationContact) {
                  setContactForModal(conversationContact);
                }
              }}
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
        {conversation.isGroup ? (
          <Menu as="div" className="relative inline-block text-left z-[90]">
            <Menu.Button className="p-2 text-primary-200 hover:text-primary-50 hover:bg-primary-900/50 rounded-lg transition-colors">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
              </svg>
            </Menu.Button>
            <Transition
              as={Fragment}
              enter="transition ease-out duration-100"
              enterFrom="transform opacity-0 scale-95"
              enterTo="transform opacity-100 scale-100"
              leave="transition ease-in duration-75"
              leaveFrom="transform opacity-100 scale-100"
              leaveTo="transform opacity-0 scale-95"
            >
              <Menu.Items className="absolute right-0 mt-2 w-56 origin-top-right rounded-lg border border-primary-800/60 bg-primary-950/95 p-2 text-sm shadow-2xl backdrop-blur z-[100]">
                <Menu.Item>
                  {({ active }) => (
                    <button
                      onClick={async () => {
                        try {
                          const { groupShareUrl } = await import('@/lib/utils/links');
                          const url = groupShareUrl(conversation.id);
                          await navigator.clipboard.writeText(url);
                          alert('Group link copied to clipboard');
                        } catch (e) {
                          alert('Failed to copy link');
                        }
                      }}
                      className={`w-full rounded px-3 py-2 text-left ${active ? 'bg-primary-900/70 text-primary-100' : 'text-primary-200'}`}
                    >
                      Copy group link
                    </button>
                  )}
                </Menu.Item>
                <Menu.Item>
                  {({ active }) => (
                    <button
                      onClick={async () => {
                        try {
                          const me = identity?.inboxId || identity?.address;
                          if (!me) {
                            alert('No identity available');
                            return;
                          }
                          if (!confirm('Leave this group? You will stop receiving new messages.')) return;
                          await removeMembersFromGroup(conversation.id, [me]);
                          alert('You left the group');
                          navigate('/');
                        } catch (e) {
                          alert('Failed to leave group');
                        }
                      }}
                      className={`w-full rounded px-3 py-2 text-left ${active ? 'bg-primary-900/70 text-primary-100' : 'text-primary-200'}`}
                    >
                      Leave group
                    </button>
                  )}
                </Menu.Item>
                <div className="my-1 h-px bg-primary-800/60" />
                <Menu.Item>
                  {({ active }) => (
                    <button
                      onClick={async () => {
                        if (!confirm('Delete this group? You will leave the group and all local data will be removed.')) return;
                        try {
                          await deleteGroup(conversation.id, false);
                        } catch (e) {
                          // fallback: local delete
                          try { await removeConversation(conversation.id); } catch (_e) { void 0; }
                        }
                        navigate('/');
                      }}
                      className={`w-full rounded px-3 py-2 text-left ${active ? 'bg-red-900/40 text-red-200' : 'text-red-300'}`}
                    >
                      Delete group
                    </button>
                  )}
                </Menu.Item>
              </Menu.Items>
            </Transition>
          </Menu>
        ) : (
          <button className="p-2 text-primary-200 hover:text-primary-50 hover:bg-primary-900/50 rounded-lg transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
            </svg>
          </button>
        )}
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
            {messages.map((message: Message) => {
              const senderLower = message.sender?.toLowerCase?.();
              let senderInfo: { displayName?: string; avatarUrl?: string; fallback?: string } | undefined;
              let isSelf = false;

              if (conversation.isGroup && senderLower) {
                const myInboxLower = identity?.inboxId?.toLowerCase();
                const myAddressLower = identity?.address?.toLowerCase();
                isSelf =
                  ((myInboxLower ? senderLower === myInboxLower : false) ||
                    (myAddressLower ? senderLower === myAddressLower : false));

                if (isSelf) {
                  const fallback = identity?.displayName || 'You';
                  senderInfo = {
                    displayName: identity?.displayName || 'You',
                    avatarUrl: identity?.avatar,
                    fallback,
                  };
                } else {
                  const profile = groupMemberProfiles.get(senderLower);
                  let displayName = profile?.displayName;
                  let avatarUrl = profile?.avatar;
                  let fallback = profile?.address || senderLower;

                  if (!profile) {
                    const contactByInbox = contactsByInboxId.get(senderLower);
                    if (contactByInbox) {
                      displayName = contactByInbox.preferredName || contactByInbox.name;
                      avatarUrl = contactByInbox.preferredAvatar || contactByInbox.avatar;
                      fallback = contactByInbox.primaryAddress || senderLower;
                    } else {
                      const contactByAddress = contactsByAddress.get(senderLower);
                      if (contactByAddress) {
                        displayName = contactByAddress.preferredName || contactByAddress.name;
                        avatarUrl = contactByAddress.preferredAvatar || contactByAddress.avatar;
                        fallback = contactByAddress.primaryAddress || senderLower;
                      }
                    }
                  }

                  const resolvedFallback = fallback || senderLower;
                  senderInfo = {
                    displayName: displayName || formatIdentifier(resolvedFallback),
                    avatarUrl,
                    fallback: resolvedFallback,
                  };
                }
              }

              const senderContact =
                conversation.isGroup && senderLower && !isSelf
                  ? resolveContactForSender(senderLower)
                  : null;

              const handleAvatarClick = senderContact
                ? () => {
                    setContactForModal(senderContact);
                  }
                : undefined;

              return (
                <MessageBubble
                  key={message.id}
                  message={message}
                  onReplyRequest={(m) => setReplyTo(m)}
                  senderInfo={senderInfo}
                  showAvatar={Boolean(conversation.isGroup)}
                  showSenderLabel={Boolean(conversation.isGroup)}
                  onSenderClick={handleAvatarClick}
                />
              );
            })}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Composer */}
      <MessageComposer onSend={handleSend} replyToMessage={replyTo ?? undefined} onCancelReply={() => setReplyTo(null)} onSent={() => setReplyTo(null)} />

      {/* User info modal */}
      {contactForModal && (
        <ContactCardModal contact={contactForModal} onClose={() => setContactForModal(null)} />
      )}
    </div>
  );
}
