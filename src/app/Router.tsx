import { Routes, Route, Navigate } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { Layout } from './Layout';
import { OnboardingPage, LockScreen, useAuth } from '@/features/auth';
import { ChatList } from '@/features/conversations';
import { ConversationView } from '@/features/messages';
import { NewChatPage } from '@/features/conversations/NewChatPage';
import { SettingsPage } from '@/features/settings';
import { DebugPage } from '@/features/debug';
import { SearchPage } from '@/features/search';
import { ContactsPage } from '@/features/contacts/ContactsPage';
import { NewGroupPage } from '@/features/conversations/NewGroupPage';
import { GroupSettingsPage } from '@/features/conversations/GroupSettingsPage';
import { HandleXmtpProtocol } from '@/app/HandleXmtpProtocol';
import { UserConnectRedirect, InboxConnectRedirect } from '@/app/deeplinks';
import { StartDmPage } from '@/features/conversations/StartDmPage';
import { ContactLinkPage } from '@/features/contacts/ContactLinkPage';
import { closeStorage, getStorageNamespace } from '@/lib/storage';
import { useAuthStore, useInboxRegistryStore } from '@/lib/stores';
import { resetXmtpClient } from '@/lib/xmtp/client';

export function AppRouter() {
  const { isAuthenticated, isVaultUnlocked, checkExistingIdentity } = useAuth();
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const clearAllRef = useRef(false);
  const clearAllFlag =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('clear_all_data') === 'true';

  useEffect(() => {
    if (!clearAllFlag || clearAllRef.current) {
      return;
    }

    clearAllRef.current = true;

    const wipe = async () => {
      console.log('[AppRouter] Detected clear_all_data flag - wiping local state...');

      try {
        await resetXmtpClient();
      } catch (e) {
        console.warn('[AppRouter] Failed to reset XMTP client (non-fatal):', e);
      }

      try {
        await closeStorage();
      } catch (e) {
        console.warn('[AppRouter] Failed to close storage (non-fatal):', e);
      }

      try {
        const deleteDb = async (name: string) =>
          new Promise<void>((resolve) => {
            const req = indexedDB.deleteDatabase(name);
            req.onsuccess = () => resolve();
            req.onerror = () => resolve();
            req.onblocked = () => {
              console.warn('[AppRouter] DB delete blocked:', name);
              resolve();
            };
          });

        const idbWithDatabases = indexedDB as unknown as { databases?: () => Promise<Array<{ name?: string }>> };
        const dbs = await idbWithDatabases?.databases?.();
        if (Array.isArray(dbs) && dbs.length > 0) {
          for (const db of dbs) {
            if (db.name) {
              console.log('[AppRouter] Deleting DB:', db.name);
              await deleteDb(db.name);
            }
          }
        } else {
          const fallbackNamespace = getStorageNamespace();
          await deleteDb('ConvergeDB');
          await deleteDb(`ConvergeDB:${fallbackNamespace}`);
          await deleteDb('ConvergeDB:default');
        }
      } catch (e) {
        console.warn('[AppRouter] Failed to delete IndexedDB databases (non-fatal):', e);
      }

      try {
        const storageManager = navigator.storage as unknown as { getDirectory?: () => Promise<FileSystemDirectoryHandle> };
        if (storageManager?.getDirectory) {
          const opfsRoot = await storageManager.getDirectory();
          // @ts-expect-error - OPFS API types
          for await (const [name] of opfsRoot.entries()) {
            if (name.startsWith('xmtp-') && name.endsWith('.db3')) {
              await opfsRoot.removeEntry(name);
              console.log('[AppRouter] Cleared OPFS DB:', name);
            }
          }
        }
      } catch (e) {
        console.warn('[AppRouter] Failed to clear OPFS databases (non-fatal):', e);
      }

      try {
        if (typeof window !== 'undefined') {
          try { window.localStorage.clear(); } catch (err) { /* ignore */ }
          try { window.sessionStorage.clear(); } catch (err) { /* ignore */ }
        }
      } catch (e) {
        console.warn('[AppRouter] Failed to clear web storage (non-fatal):', e);
      }

      try {
        useInboxRegistryStore.getState().reset();
      } catch (e) {
        console.warn('[AppRouter] Failed to reset inbox registry (non-fatal):', e);
      }

      try {
        useAuthStore.getState().logout();
      } catch (e) {
        console.warn('[AppRouter] Failed to reset auth store (non-fatal):', e);
      }

      try {
        if ('caches' in window) {
          const cacheNames = await caches.keys();
          await Promise.all(cacheNames.map((name) => caches.delete(name)));
        }
        if ('serviceWorker' in navigator) {
          const registrations = await navigator.serviceWorker.getRegistrations();
          await Promise.all(registrations.map((reg) => reg.unregister()));
        }
      } catch (e) {
        console.warn('[AppRouter] Failed to clear SW caches/registrations (non-fatal):', e);
      }

      console.log('[AppRouter] Wipe complete. Reloading clean entry point.');
      window.location.replace('/onboarding');
    };

    void wipe();
  }, [clearAllFlag]);

  useEffect(() => {
    // Only attempt to restore identity when user is not yet authenticated.
    // Prevents double-connect loops after onboarding (e.g., WalletConnect reopening Rainbow).
    if (clearAllFlag) {
      setIsCheckingAuth(false);
      return;
    }
    if (!isAuthenticated) {
      checkExistingIdentity().finally(() => {
        setIsCheckingAuth(false);
      });
    } else {
      setIsCheckingAuth(false);
    }
  }, [clearAllFlag, isAuthenticated, checkExistingIdentity]);

  const loadingScreen = (
    <div className="flex items-center justify-center h-screen">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-accent-500 mx-auto mb-4"></div>
        <p className="text-primary-300">Loading...</p>
      </div>
    </div>
  );

  const clearingScreen = (
    <div className="flex items-center justify-center h-screen">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-accent-500 mx-auto mb-4"></div>
        <p className="text-primary-300">Clearing local data...</p>
      </div>
    </div>
  );

  if (clearAllFlag) {
    return (
      <Routes>
        <Route path="*" element={clearingScreen} />
      </Routes>
    );
  }

  // Not authenticated - checking or onboarding
  if (!isAuthenticated) {
    // Important: while we are restoring identity from storage, preserve the current URL
    // (including deep links like /u/:userId) and avoid redirecting to onboarding prematurely.
    if (isCheckingAuth) {
      return (
        <Routes>
          <Route path="*" element={loadingScreen} />
        </Routes>
      );
    }

    return (
      <Routes>
        <Route path="/onboarding" element={<OnboardingPage />} />
        <Route path="/i/:inboxId" element={<InboxConnectRedirect />} />
        <Route path="/u/:userId" element={<UserConnectRedirect />} />
        <Route path="/handle-xmtp-protocol" element={<HandleXmtpProtocol />} />
        <Route path="*" element={<Navigate to="/onboarding" replace />} />
      </Routes>
    );
  }

  // Authenticated but vault locked - show lock screen
  if (!isVaultUnlocked) {
    return (
      <Routes>
        <Route path="/lock" element={<LockScreen />} />
        <Route path="*" element={<Navigate to="/lock" replace />} />
      </Routes>
    );
  }

  // Authenticated and unlocked - show app
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<ChatList />} />
        <Route path="chat/:id" element={<ConversationView />} />
        <Route path="chat/:conversationId/settings" element={<GroupSettingsPage />} />
        <Route path="new-chat" element={<NewChatPage />} />
        <Route path="new-group" element={<NewGroupPage />} />
        <Route path="search" element={<SearchPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="debug" element={<DebugPage />} />
        <Route path="contacts" element={<ContactsPage />} />
        {/* New simplified deep links */}
        <Route path="i/:inboxId" element={<StartDmPage />} />
        <Route path="u/:userId" element={<ContactLinkPage />} />
        <Route path="/handle-xmtp-protocol" element={<HandleXmtpProtocol />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
