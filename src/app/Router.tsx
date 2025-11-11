import { Routes, Route, Navigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
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

export function AppRouter() {
  const { isAuthenticated, isVaultUnlocked, checkExistingIdentity } = useAuth();
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);

  useEffect(() => {
    // Only attempt to restore identity when user is not yet authenticated.
    // Prevents double-connect loops after onboarding (e.g., WalletConnect reopening Rainbow).
    if (!isAuthenticated) {
      checkExistingIdentity().finally(() => {
        setIsCheckingAuth(false);
      });
    } else {
      setIsCheckingAuth(false);
    }
  }, [isAuthenticated, checkExistingIdentity]);

  // Not authenticated - checking or onboarding
  if (!isAuthenticated) {
    return (
      <Routes>
        <Route path="/onboarding" element={<OnboardingPage />} />
        <Route path="/i/:inboxId" element={<InboxConnectRedirect />} />
        <Route path="/u/:userId" element={<UserConnectRedirect />} />
        {isCheckingAuth ? (
          // While checking auth, render all app routes but show loading screen
          // This preserves the URL so it doesn't redirect
          <Route path="*" element={
            <div className="flex items-center justify-center h-screen">
              <div className="text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-accent-500 mx-auto mb-4"></div>
                <p className="text-primary-300">Loading...</p>
              </div>
            </div>
          } />
        ) : (
          <Route path="*" element={<Navigate to="/onboarding" replace />} />
        )}
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
