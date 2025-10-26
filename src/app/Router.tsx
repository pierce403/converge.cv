import { Routes, Route, Navigate } from 'react-router-dom';
import { useEffect } from 'react';
import { Layout } from './Layout';
import { OnboardingPage, LockScreen, useAuth } from '@/features/auth';

// Placeholder components - will be implemented in phases
const ChatListPage = () => (
  <div className="p-4">
    <h2 className="text-2xl font-bold mb-4">Chats</h2>
    <p className="text-slate-400">No conversations yet. Start a new chat!</p>
  </div>
);

const ConversationPage = () => (
  <div className="p-4">
    <h2 className="text-2xl font-bold mb-4">Conversation</h2>
    <p className="text-slate-400">Chat interface coming soon...</p>
  </div>
);

const SettingsPage = () => (
  <div className="p-4">
    <h2 className="text-2xl font-bold mb-4">Settings</h2>
    <p className="text-slate-400">Settings interface coming soon...</p>
  </div>
);

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
        <Route index element={<ChatListPage />} />
        <Route path="chat/:id" element={<ConversationPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

