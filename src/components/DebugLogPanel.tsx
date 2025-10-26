import { useMemo, useState } from 'react';
import {
  useAuthStore,
  useConversationStore,
  useDebugStore,
  useXmtpStore,
} from '@/lib/stores';
import { formatDistanceToNow } from '@/lib/utils/date';

interface DebugLogPanelProps {
  placement?: 'floating' | 'nav';
}

export function DebugLogPanel({ placement = 'floating' }: DebugLogPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const entries = useDebugStore((state) => state.entries);
  const clearLogs = useDebugStore((state) => state.clear);

  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const isVaultUnlocked = useAuthStore((state) => state.isVaultUnlocked);
  const identity = useAuthStore((state) => state.identity);

  const conversationState = useConversationStore((state) => ({
    count: state.conversations.length,
    pinned: state.conversations.filter((conversation) => conversation.pinned).length,
    archived: state.conversations.filter((conversation) => conversation.archived).length,
    isLoading: state.isLoading,
  }));

  const { connectionStatus, lastConnected, error: xmtpError } = useXmtpStore();

  const recentEntries = useMemo(() => entries.slice().reverse(), [entries]);

  const isNavPlacement = placement === 'nav';
  const buttonClassName = isNavPlacement
    ? `flex flex-col items-center px-4 py-2 rounded-lg transition-colors ${
        isOpen ? 'text-primary-500 bg-slate-700' : 'text-slate-400 hover:text-slate-200'
      }`
    : 'fixed bottom-6 right-6 z-50 px-4 py-2 rounded-full bg-slate-800/90 hover:bg-slate-700 text-sm font-medium border border-slate-600 shadow-lg';
  const panelPositionClassName = isNavPlacement
    ? 'fixed bottom-24 inset-x-4 z-50 mx-auto max-w-lg w-full'
    : 'fixed bottom-24 right-6 z-50 w-96 max-w-[90vw]';

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen((value) => !value)}
        className={buttonClassName}
        aria-pressed={isOpen}
        aria-expanded={isOpen}
        aria-controls="debug-log-panel"
      >
        {isNavPlacement ? (
          <>
            <svg
              className="w-6 h-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 19c-1.278-.705-3-2.41-3-5 0-3.866 3.582-7 8-7a6 6 0 016 6c0 2.694-1.714 4.314-3 5m-8 1h8m-4-4v4"
              />
            </svg>
            <span className="text-xs mt-1">Debug</span>
          </>
        ) : (
          isOpen ? 'Close Debug Log' : 'Open Debug Log'
        )}
      </button>

      {isOpen && (
        <div
          id="debug-log-panel"
          className={`${panelPositionClassName} bg-slate-900/95 border border-slate-700 rounded-xl shadow-xl backdrop-blur-sm`}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-300">
              Debug Console
            </h2>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500">
                {entries.length} entr{entries.length === 1 ? 'y' : 'ies'}
              </span>
              <button
                type="button"
                className="text-xs text-slate-400 hover:text-primary-400"
                onClick={clearLogs}
              >
                Clear
              </button>
            </div>
          </div>

          <div className="px-4 py-3 border-b border-slate-800 text-xs text-slate-400 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="font-semibold text-slate-300">Auth</span>
                <div>{isAuthenticated ? 'Authenticated' : 'Not authenticated'}</div>
                <div>{isVaultUnlocked ? 'Vault unlocked' : 'Vault locked'}</div>
              </div>
              <div>
                <span className="font-semibold text-slate-300">Identity</span>
                <div className="truncate" title={identity?.address || '—'}>
                  {identity?.address ?? '—'}
                </div>
                <div className="truncate" title={identity?.displayName || 'No display name'}>
                  {identity?.displayName ?? 'No display name'}
                </div>
              </div>
              <div>
                <span className="font-semibold text-slate-300">Conversations</span>
                <div>Total: {conversationState.count}</div>
                <div>Pinned: {conversationState.pinned}</div>
                <div>Archived: {conversationState.archived}</div>
                <div>Loading: {conversationState.isLoading ? 'Yes' : 'No'}</div>
              </div>
              <div>
                <span className="font-semibold text-slate-300">XMTP</span>
                <div>Status: {connectionStatus}</div>
                <div>
                  Last connected:{' '}
                  {lastConnected ? formatDistanceToNow(lastConnected) : 'Never'}
                </div>
                {xmtpError && <div className="text-red-400">{xmtpError}</div>}
              </div>
            </div>
          </div>

          <div className="max-h-72 overflow-y-auto">
            {recentEntries.length === 0 ? (
              <div className="px-4 py-6 text-center text-xs text-slate-500">
                No log entries yet. Console output will appear here.
              </div>
            ) : (
              <ul className="divide-y divide-slate-800">
                {recentEntries.map((entry) => (
                  <li key={entry.id} className="px-4 py-3 text-xs">
                    <div className="flex items-center justify-between gap-3">
                      <span
                        className={`font-semibold uppercase tracking-wide ${
                          entry.level === 'error'
                            ? 'text-red-400'
                            : entry.level === 'warn'
                              ? 'text-yellow-400'
                              : entry.level === 'info'
                                ? 'text-blue-400'
                                : 'text-slate-400'
                        }`}
                      >
                        {entry.level}
                      </span>
                      <span className="text-slate-500">
                        {new Date(entry.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <p className="mt-2 text-slate-200 whitespace-pre-wrap break-words">
                      {entry.message}
                    </p>
                    {entry.details && (
                      <pre className="mt-2 bg-slate-800/80 rounded-lg p-2 text-[10px] leading-relaxed text-slate-300 overflow-x-auto">
                        {entry.details}
                      </pre>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </>
  );
}
