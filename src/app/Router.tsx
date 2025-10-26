import { Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './Layout';

// Placeholder components - will be implemented in phases
const OnboardingPage = () => (
  <div className="flex items-center justify-center min-h-screen">
    <div className="text-center">
      <h1 className="text-4xl font-bold mb-4">Welcome to Converge</h1>
      <p className="text-slate-400 mb-8">Secure, local-first messaging with XMTP v3</p>
      <button className="btn-primary">Get Started</button>
    </div>
  </div>
);

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
  // TODO: Check auth state to conditionally render routes
  const isAuthenticated = false;

  if (!isAuthenticated) {
    return (
      <Routes>
        <Route path="/onboarding" element={<OnboardingPage />} />
        <Route path="*" element={<Navigate to="/onboarding" replace />} />
      </Routes>
    );
  }

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

