import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
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
import { JoinGroupPage } from '@/features/conversations/JoinGroupPage';
import { HandleXmtpProtocol } from '@/app/HandleXmtpProtocol';
import { getLastRoute, shouldRestoreLastRoute } from '@/lib/utils/route-persistence';

export function AppRouter() {
  const { isAuthenticated, isVaultUnlocked, checkExistingIdentity } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    // Only attempt to restore identity when user is not yet authenticated.
    // Prevents double-connect loops after onboarding (e.g., WalletConnect reopening Rainbow).
    if (!isAuthenticated) {
      checkExistingIdentity();
    }
  }, [isAuthenticated, checkExistingIdentity]);

  // Restore last route after authentication
  useEffect(() => {
    if (isAuthenticated && isVaultUnlocked) {
      const currentPath = location.pathname;
      
      // Only restore if we're on the home page
      if (shouldRestoreLastRoute(currentPath)) {
        const lastRoute = getLastRoute();
        
        // Restore if we have a saved route and it's not the home page
        if (lastRoute && lastRoute !== '/' && lastRoute !== currentPath) {
          console.log('[Router] Restoring last route:', lastRoute);
          navigate(lastRoute, { replace: true });
        }
      }
    }
  }, [isAuthenticated, isVaultUnlocked, navigate, location.pathname]);

  // Not authenticated - show onboarding
  if (!isAuthenticated) {
    return (
      <Routes>
        <Route path="/onboarding" element={<OnboardingPage />} />
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
        <Route path="join-group/:conversationId" element={<JoinGroupPage />} />
        <Route path="/handle-xmtp-protocol" element={<HandleXmtpProtocol />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
