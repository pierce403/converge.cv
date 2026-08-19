import { Routes, Route, Navigate } from 'react-router-dom';
import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { Layout } from './Layout';
import { useAuth } from '@/features/auth/useAuth';
import { ChatWorkspace } from '@/features/conversations/ChatWorkspace';
import { HandleXmtpProtocol } from '@/app/HandleXmtpProtocol';
import { UserConnectRedirect, InboxConnectRedirect, InviteConnectRedirect } from '@/app/deeplinks';
import { startMessageRetentionScheduler } from '@/lib/message-retention';
import { clearAllBrowserData } from '@/lib/identity/clear-browser-data';

const OnboardingPage = lazy(() =>
  import('@/features/auth/OnboardingPage').then(({ OnboardingPage }) => ({
    default: OnboardingPage,
  }))
);
const NewChatPage = lazy(() =>
  import('@/features/conversations/NewChatPage').then(({ NewChatPage }) => ({
    default: NewChatPage,
  }))
);
const SettingsPage = lazy(() =>
  import('@/features/settings/SettingsPage').then(({ SettingsPage }) => ({ default: SettingsPage }))
);
const DebugPage = lazy(() =>
  import('@/features/debug/DebugPage').then(({ DebugPage }) => ({ default: DebugPage }))
);
const SearchPage = lazy(() =>
  import('@/features/search/SearchPage').then(({ SearchPage }) => ({ default: SearchPage }))
);
const ContactsPage = lazy(() =>
  import('@/features/contacts/ContactsPage').then(({ ContactsPage }) => ({ default: ContactsPage }))
);
const NewGroupPage = lazy(() =>
  import('@/features/conversations/NewGroupPage').then(({ NewGroupPage }) => ({
    default: NewGroupPage,
  }))
);
const GroupSettingsPage = lazy(() =>
  import('@/features/conversations/GroupSettingsPage').then(({ GroupSettingsPage }) => ({
    default: GroupSettingsPage,
  }))
);
const StartDmPage = lazy(() =>
  import('@/features/conversations/StartDmPage').then(({ StartDmPage }) => ({
    default: StartDmPage,
  }))
);
const ContactLinkPage = lazy(() =>
  import('@/features/contacts/ContactLinkPage').then(({ ContactLinkPage }) => ({
    default: ContactLinkPage,
  }))
);
const InviteClaimPage = lazy(() =>
  import('@/features/conversations/InviteClaimPage').then(({ InviteClaimPage }) => ({
    default: InviteClaimPage,
  }))
);

export function AppRouter() {
  const { isAuthenticated, checkExistingIdentity } = useAuth();
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const clearAllRef = useRef(false);
  const authRestoreInFlightRef = useRef(false);
  const clearAllFlag =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('clear_all_data') === 'true';

  useEffect(() => {
    if (clearAllFlag) return;
    return startMessageRetentionScheduler();
  }, [clearAllFlag]);

  useEffect(() => {
    if (!clearAllFlag || clearAllRef.current) {
      return;
    }

    clearAllRef.current = true;

    const wipe = async () => {
      console.log('[AppRouter] Detected clear_all_data flag - wiping local state...');
      await clearAllBrowserData();
    };

    void wipe();
  }, [clearAllFlag]);

  useEffect(() => {
    // Only attempt to restore identity when user is not yet authenticated.
    // Prevents double-connect loops after onboarding (e.g., WalletConnect reopening Rainbow).
    if (clearAllFlag) {
      authRestoreInFlightRef.current = false;
      setIsCheckingAuth(false);
      return;
    }
    if (!isAuthenticated) {
      if (authRestoreInFlightRef.current) {
        return;
      }
      authRestoreInFlightRef.current = true;
      checkExistingIdentity().finally(() => {
        authRestoreInFlightRef.current = false;
        setIsCheckingAuth(false);
      });
    } else {
      authRestoreInFlightRef.current = false;
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

  const lazyPage = (page: ReactNode) => <Suspense fallback={loadingScreen}>{page}</Suspense>;

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
        <Route path="/onboarding" element={lazyPage(<OnboardingPage />)} />
        <Route path="/i/:inboxId" element={<InboxConnectRedirect />} />
        <Route path="/u/:userId" element={<UserConnectRedirect />} />
        <Route path="/invite" element={<InviteConnectRedirect />} />
        <Route path="/invite/:code" element={<InviteConnectRedirect />} />
        <Route path="/handle-xmtp-protocol" element={<HandleXmtpProtocol />} />
        <Route path="*" element={<Navigate to="/onboarding" replace />} />
      </Routes>
    );
  }

  // Default identities have no passphrase/passkey lock flow.
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<ChatWorkspace />} />
        <Route path="chat/:id" element={<ChatWorkspace />} />
        <Route path="chat/:conversationId/settings" element={lazyPage(<GroupSettingsPage />)} />
        <Route path="new-chat" element={lazyPage(<NewChatPage />)} />
        <Route path="new-group" element={lazyPage(<NewGroupPage />)} />
        <Route path="search" element={lazyPage(<SearchPage />)} />
        <Route path="settings" element={lazyPage(<SettingsPage />)} />
        <Route path="debug" element={lazyPage(<DebugPage />)} />
        <Route path="contacts" element={lazyPage(<ContactsPage />)} />
        {/* New simplified deep links */}
        <Route path="i/:inboxId" element={lazyPage(<StartDmPage />)} />
        <Route path="u/:userId" element={lazyPage(<ContactLinkPage />)} />
        <Route path="invite" element={lazyPage(<InviteClaimPage />)} />
        <Route path="invite/:code" element={lazyPage(<InviteClaimPage />)} />
        <Route path="/handle-xmtp-protocol" element={<HandleXmtpProtocol />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
