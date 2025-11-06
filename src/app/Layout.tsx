import { useEffect } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { DebugLogPanel } from '@/components/DebugLogPanel';
import { ToastContainer } from '@/components/ToastContainer';
import { SyncProgressBar } from '@/components/SyncProgressBar';
import { useConversationStore, useContactStore, useMessageStore } from '@/lib/stores';
import { useMessages } from '@/features/messages/useMessages';
import { getStorage } from '@/lib/storage';
import { getXmtpClient } from '@/lib/xmtp';
import type { Conversation } from '@/types';
import type { XmtpMessage } from '@/lib/xmtp';
import type { Contact } from '@/lib/stores/contact-store';
import { InboxSwitcher } from '@/features/identity/InboxSwitcher';
import { saveLastRoute } from '@/lib/utils/route-persistence';
// Do not enrich from ENS/Farcaster for avatars or names. Use XMTP network data only.


export function Layout() {
  const location = useLocation();
  const { addConversation, updateConversation } = useConversationStore();
  const { receiveMessage } = useMessages();
  const loadContacts = useContactStore((state) => state.loadContacts);

  // Save route for persistence across refreshes
  useEffect(() => {
    saveLastRoute(location.pathname);
  }, [location.pathname]);

  useEffect(() => {
    loadContacts();
  }, [loadContacts]);

  // Global message listener - handles ALL incoming XMTP messages
  // Intentionally register once; store/state is accessed via getState() where needed.
  useEffect(() => {
    const shouldRefreshContact = (contact: Contact): boolean => {
      const now = Date.now();
      const lastSynced = contact.lastSyncedAt ?? 0;
      const refreshIntervalMs = 30 * 60 * 1000; // 30 minutes
      if (!contact.preferredName || !contact.preferredAvatar) {
        return true;
      }
      return now - lastSynced > refreshIntervalMs;
    };

    const enrichContactProfile = async (contact: Contact) => {
      try {
        if (!shouldRefreshContact(contact)) return;
        const xmtp = getXmtpClient();
        const profile = await xmtp.fetchInboxProfile(contact.inboxId);
        await useContactStore.getState().upsertContactProfile({
          inboxId: profile.inboxId,
          displayName: profile.displayName,
          avatarUrl: profile.avatarUrl,
          primaryAddress: profile.primaryAddress,
          addresses: profile.addresses,
          identities: profile.identities,
          source: 'inbox',
          metadata: { ...contact, lastSyncedAt: Date.now() },
        });
      } catch (error) {
        console.warn('[Layout] Failed to enrich contact profile:', error);
      }
    };

    const handleIncomingMessage = async (event: Event) => {
      const customEvent = event as CustomEvent<{ conversationId: string; message: XmtpMessage }>;
      const { conversationId, message } = customEvent.detail;
      
      console.log('[Layout] Global message listener: received message', {
        conversationId,
        messageId: message.id,
        senderInboxId: message.senderAddress,
      });

      try {
        const senderInboxId = message.senderAddress;
        const contactStore = useContactStore.getState();
        const xmtp = getXmtpClient();
        // Avoid hammering utils/preferences for every message: refresh at most every 5 minutes per contact
        const existingContact = contactStore.getContactByInboxId(senderInboxId) ?? contactStore.getContactByAddress(senderInboxId);
        const nowTs = Date.now();
        const lastSync = existingContact?.lastSyncedAt ?? 0;
        let profile = undefined as Awaited<ReturnType<typeof xmtp.fetchInboxProfile>> | undefined;
        if (!existingContact || nowTs - lastSync > 5 * 60 * 1000) {
          profile = await xmtp.fetchInboxProfile(senderInboxId);
        }
        const upserted = await contactStore.upsertContactProfile({
          inboxId: senderInboxId,
          displayName: profile?.displayName,
          avatarUrl: profile?.avatarUrl,
          primaryAddress: profile?.primaryAddress,
          addresses: profile?.addresses,
          identities: profile?.identities,
          source: 'inbox',
        });
        const contact = upserted;

        // Enrich with ENS (and Farcaster if available) asynchronously
        void enrichContactProfile(contact);

        const storage = await getStorage();

        let conversation = useConversationStore.getState().conversations.find((c) => c.id === conversationId);

        if (!conversation) {
          console.log('[Layout] Creating new conversation for:', conversationId);

          const peerId = contact?.inboxId || senderInboxId;
          // Avoid creating a self-DM conversation
          const myInbox = getXmtpClient().getInboxId()?.toLowerCase();
          if (myInbox && peerId.toLowerCase() === myInbox) {
            console.log('[Layout] Skipping creation of self-DM conversation');
            return;
          }
          const newConversation: Conversation = {
            id: conversationId,
            peerId,
            createdAt: Date.now(),
            lastMessageAt: message.sentAt || Date.now(),
            lastMessagePreview: '',
            unreadCount: 0,
            pinned: false,
            archived: false,
            displayName: contact.preferredName ?? contact.name,
            displayAvatar: contact.preferredAvatar ?? contact.avatar,
          };

          addConversation(newConversation);
          await storage.putConversation(newConversation);

          console.log('[Layout] ✅ New conversation created:', newConversation);

          conversation = newConversation;
          // Deduplicate: remove any other DM with same peer id
          try {
            const store = useConversationStore.getState();
            const peerKey = (contact.inboxId || senderInboxId).toLowerCase();
            const dupes = store.conversations.filter(
              (c) => !c.isGroup && c.id !== newConversation.id && c.peerId.toLowerCase() === peerKey
            );
            for (const d of dupes) {
              store.removeConversation(d.id);
              try { await storage.deleteConversation(d.id); } catch (e) { /* ignore */ }
            }
          } catch (e) { /* ignore */ }
        } else {
          const updates: Partial<Conversation> = {};
          const displayName = contact.preferredName ?? contact.name;
          if (displayName && conversation.displayName !== displayName) {
            updates.displayName = displayName;
          }
          const avatar = contact.preferredAvatar ?? contact.avatar;
          if (avatar && conversation.displayAvatar !== avatar) {
            updates.displayAvatar = avatar;
          }

          if (Object.keys(updates).length > 0) {
            updateConversation(conversation.id, updates);
            await storage.putConversation({ ...conversation, ...updates });
            conversation = { ...conversation, ...updates } as Conversation;
          }
          // Deduplicate against existing by peer id also when conversation already existed
          try {
            const store = useConversationStore.getState();
            const peerKey = (contact.inboxId || senderInboxId).toLowerCase();
            const dupes = store.conversations.filter(
              (c) => !c.isGroup && c.id !== conversation!.id && c.peerId.toLowerCase() === peerKey
            );
            for (const d of dupes) {
              store.removeConversation(d.id);
              try { await storage.deleteConversation(d.id); } catch (e) { /* ignore */ }
            }
          } catch (e) { /* ignore */ }
        }
        console.log('[Layout] Processing message with receiveMessage()');
        await receiveMessage(conversationId, message);
        
        console.log('[Layout] ✅ Message processed successfully');
      } catch (error) {
        console.error('[Layout] Failed to handle incoming message:', error);
      }
    };

    console.log('[Layout] 🎧 Global message listener registered');
    window.addEventListener('xmtp:message', handleIncomingMessage);
    // Also handle system messages (e.g., membership changes)
    const handleSystemMessage = async (event: Event) => {
      const custom = event as CustomEvent<{
        conversationId: string;
        system: { id: string; senderInboxId?: string; body: string; sentAt?: number };
      }>;
      const { conversationId, system } = custom.detail;
      try {
        const storage = await getStorage();
        const msg = {
          id: system.id,
          conversationId,
          sender: system.senderInboxId || 'system',
          sentAt: system.sentAt || Date.now(),
          receivedAt: Date.now(),
          type: 'system' as const,
          body: system.body,
          status: 'delivered' as const,
          reactions: [],
        };
        useMessageStore.getState().addMessage(conversationId, msg);
        await storage.putMessage(msg);
        useConversationStore.getState().updateConversation(conversationId, {
          lastMessageAt: msg.sentAt,
          lastMessagePreview: msg.body.substring(0, 100),
        });
      } catch (err) {
        console.warn('[Layout] Failed to handle system message', err);
      }
    };
    window.addEventListener('xmtp:system', handleSystemMessage);
    
    // Handle read receipts for status updates (no bubbles)
    const handleReadReceipt = async (event: Event) => {
      const custom = event as CustomEvent<{ conversationId: string; senderInboxId?: string; sentAt?: number }>;
      const { conversationId, sentAt } = custom.detail;
      try {
        const myInbox = getXmtpClient().getInboxId()?.toLowerCase();
        const myAddr = getXmtpClient().getAddress()?.toLowerCase();
        const state = useMessageStore.getState();
        const msgs = state.messagesByConversation[conversationId] || [];
        for (const m of msgs) {
          const senderLower = m.sender?.toLowerCase?.();
          if (senderLower && (senderLower === myInbox || senderLower === myAddr)) {
            if (!sentAt || m.sentAt <= sentAt) {
              state.updateMessage(m.id, { status: 'delivered' });
              try {
                const storage = await getStorage();
                await storage.updateMessageStatus(m.id, 'delivered');
              } catch (e) {
                // ignore storage failure
              }
            }
          }
        }
      } catch (err) {
        console.warn('[Layout] Failed to handle read receipt', err);
      }
    };
    window.addEventListener('xmtp:read-receipt', handleReadReceipt);
    
    return () => {
      console.log('[Layout] 🔇 Global message listener unregistered');
      window.removeEventListener('xmtp:message', handleIncomingMessage);
      window.removeEventListener('xmtp:system', handleSystemMessage);
      window.removeEventListener('xmtp:read-receipt', handleReadReceipt);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Proactively enrich all loaded contacts from XMTP (no ENS/Farcaster)
  useEffect(() => {
    const run = async () => {
      try {
        const state = useContactStore.getState();
        for (const c of state.contacts) {
          const now = Date.now();
          const last = c.lastSyncedAt ?? 0;
          if (!c.preferredName || !c.preferredAvatar || now - last > 30 * 60 * 1000) {
            try {
              const xmtp = getXmtpClient();
              const profile = await xmtp.fetchInboxProfile(c.inboxId);
              await state.upsertContactProfile({
                inboxId: profile.inboxId,
                displayName: profile.displayName,
                avatarUrl: profile.avatarUrl,
                primaryAddress: profile.primaryAddress,
                addresses: profile.addresses,
                identities: profile.identities,
                source: 'inbox',
                metadata: { ...c, lastSyncedAt: Date.now() },
              });
            } catch {
              // non-fatal
            }
          }
        }
      } catch {
        // ignore
      }
    };
    run();
  }, []);

  return (
    <div className="flex flex-col h-screen text-primary-50">
      {/* Sync progress bar */}
      <SyncProgressBar />
      <ToastContainer />

      {/* Header */}
      <header className="bg-primary-950/80 border-b border-primary-800/60 px-3 py-2 flex items-center justify-between gap-2 backdrop-blur-md shadow-lg">
        <div className="flex items-center gap-3">
          <InboxSwitcher />
          <h1 className="hidden text-lg font-bold text-primary-50 sm:block">Converge</h1>
        </div>
        <div className="flex items-center gap-1">
          <Link
            to="/search"
            className="p-2 text-primary-200 hover:text-white border border-primary-800/60 hover:border-primary-700 rounded-lg transition-colors bg-primary-900/40 hover:bg-primary-800/60"
            title="Search"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </Link>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto bg-primary-950/20">
        <Outlet />
      </main>

      {/* Bottom navigation */}
      <nav className="bg-primary-950/80 border-t border-primary-800/60 px-4 py-3 backdrop-blur-md shadow-inner">
        <div className="flex justify-around max-w-lg mx-auto">
          <Link
            to="/contacts"
            className={`flex flex-col items-center px-4 py-2 rounded-lg transition-colors ${
              location.pathname === '/contacts'
                ? 'text-accent-300 bg-primary-900/70 shadow-lg'
                : 'text-primary-300 hover:text-primary-100'
            }`}
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.653-.146-1.28-.422-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.653.146-1.28.422-1.857m0 0a5 5 0 019.156 0M12 10a3 3 0 11-6 0 3 3 0 016 0zm-6 0a3 3 0 10-6 0 3 3 0 006 0z" />
            </svg>
            <span className="text-xs mt-1">Contacts</span>
          </Link>

          <Link
            to="/"
            className={`flex flex-col items-center px-4 py-2 rounded-lg transition-colors ${
              location.pathname === '/'
                ? 'text-accent-300 bg-primary-900/70 shadow-lg'
                : 'text-primary-300 hover:text-primary-100'
            }`}
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            <span className="text-xs mt-1">Chats</span>
          </Link>

          <Link
            to="/settings"
            className={`flex flex-col items-center px-4 py-2 rounded-lg transition-colors ${
              location.pathname === '/settings'
                ? 'text-accent-300 bg-primary-900/70 shadow-lg'
                : 'text-primary-300 hover:text-primary-100'
            }`}
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <span className="text-xs mt-1">Settings</span>
          </Link>

          <DebugLogPanel />
        </div>
      </nav>
    </div>
  );
}
