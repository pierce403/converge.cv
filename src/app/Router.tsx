import { Routes, Route, Navigate } from 'react-router-dom';
import { useEffect } from 'react';
import { Layout } from './Layout';
import { OnboardingPage, LockScreen, useAuth } from '@/features/auth';
import { ChatList } from '@/features/conversations';
import { ConversationView } from '@/features/messages';
import { NewChatPage } from '@/features/conversations/NewChatPage';
import { SettingsPage } from '@/features/settings';
import { DebugPage } from '@/features/debug';
import { SearchPage } from '@/features/search';

export function AppRouter() {
  const { isAuthenticated, isVaultUnlocked, checkExistingIdentity } = useAuth();

  useEffect(() => {
    // Check for existing identity on mount
    checkExistingIdentity();
  }, [checkExistingIdentity]);

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
        <Route path="new-chat" element={<NewChatPage />} />
        <Route path="search" element={<SearchPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="debug" element={<DebugPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

