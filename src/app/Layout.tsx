import { Outlet, Link, useLocation } from 'react-router-dom';
import { PWAInstallPrompt } from '@/components/PWAInstallPrompt';
import { UpdatePrompt } from '@/components/UpdatePrompt';
import { DebugLogPanel } from '@/components/DebugLogPanel';

export function Layout() {
  const location = useLocation();

  return (
    <div className="flex flex-col h-screen">
      {/* PWA Install Prompt */}
      <PWAInstallPrompt />
      
      {/* Update Available Prompt */}
      <UpdatePrompt />
      
      {/* Header */}
      <header className="bg-slate-800 border-b border-slate-700 px-4 py-3 flex items-center justify-between">
        <h1 className="text-xl font-bold">Converge</h1>
        <Link
          to="/search"
          className="p-2 hover:bg-slate-700 rounded-lg transition-colors"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
        </Link>
      </header>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>

      {/* Bottom navigation */}
      <nav className="bg-slate-800 border-t border-slate-700 px-4 py-3">
        <div className="flex justify-around max-w-lg mx-auto">
          <Link
            to="/"
            className={`flex flex-col items-center px-4 py-2 rounded-lg transition-colors ${
              location.pathname === '/'
                ? 'text-primary-500 bg-slate-700'
                : 'text-slate-400 hover:text-slate-200'
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
                ? 'text-primary-500 bg-slate-700'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <span className="text-xs mt-1">Settings</span>
          </Link>
        </div>
      </nav>

      <DebugLogPanel />
    </div>
  );
}

