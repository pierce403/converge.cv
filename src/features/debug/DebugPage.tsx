import { useMemo } from 'react';
import {
  useAuthStore,
  useConversationStore,
  useDebugStore,
  useXmtpStore,
} from '@/lib/stores';
import { formatDistanceToNow } from '@/lib/utils/date';
import { WebWorkersPanel } from './WebWorkersPanel';
import buildInfo from '../../build-info.json'; // Import build info

export function DebugPage() {
  const consoleEntries = useDebugStore((state) => state.consoleEntries);
  const networkEntries = useDebugStore((state) => state.networkEntries);
  const errorEntries = useDebugStore((state) => state.errorEntries);
  const clearConsole = useDebugStore((state) => state.clearConsole);
  const clearNetwork = useDebugStore((state) => state.clearNetwork);
  const clearErrors = useDebugStore((state) => state.clearErrors);
  const clearAll = useDebugStore((state) => state.clearAll);

  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const isVaultUnlocked = useAuthStore((state) => state.isVaultUnlocked);
  const identity = useAuthStore((state) => state.identity);

  const conversationSummary = useConversationStore((state) => ({
    total: state.conversations.length,
    pinned: state.conversations.filter((conversation) => conversation.pinned).length,
    archived: state.conversations.filter((conversation) => conversation.archived).length,
    isLoading: state.isLoading,
  }));

  const { connectionStatus, lastConnected, error: xmtpError } = useXmtpStore();

  const reversedConsole = useMemo(() => consoleEntries.slice().reverse(), [consoleEntries]);
  const reversedNetwork = useMemo(() => networkEntries.slice().reverse(), [networkEntries]);
  const reversedErrors = useMemo(() => errorEntries.slice().reverse(), [errorEntries]);


  return (
    <div className="min-h-full bg-primary-950/90 text-primary-50">
      <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-bold">Debug Console</h1>
            <p className="text-sm text-primary-200">
              Inspect application state, XMTP activity, and runtime issues captured in the app.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-primary-200">
            <span className="rounded-full bg-primary-900/60 px-3 py-1">
              {consoleEntries.length} console log{consoleEntries.length === 1 ? '' : 's'}
            </span>
            <span className="rounded-full bg-primary-900/60 px-3 py-1">
              {networkEntries.length} network event{networkEntries.length === 1 ? '' : 's'}
            </span>
            <span className="rounded-full bg-primary-900/60 px-3 py-1">
              {errorEntries.length} error{errorEntries.length === 1 ? '' : 's'}
            </span>
            <button
              type="button"
              onClick={clearAll}
              className="ml-auto rounded-full border border-primary-800/60 bg-primary-950/30 px-3 py-1 text-primary-100 hover:border-primary-700"
            >
              Clear all logs
            </button>
          </div>
        </header>

        {/* Build Info */}
        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <article className="rounded-xl border border-primary-800/60 bg-primary-950/30 p-4">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-primary-200">Build Info</h2>
            <dl className="mt-2 space-y-1 text-sm text-primary-100">
              <div className="flex items-center justify-between">
                <dt>Version</dt>
                <dd>{buildInfo.version}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt>Build Time</dt>
                <dd>{new Date(buildInfo.buildTime).toLocaleString()}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt>Commit</dt>
                <dd>
                  <a
                    href={`https://github.com/pierce403/converge.cv/commit/${buildInfo.gitHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent-300 hover:underline"
                  >
                    {buildInfo.gitHash}
                  </a>
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt>Branch</dt>
                <dd>{buildInfo.gitBranch}</dd>
              </div>
            </dl>
          </article>
        </section>

        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <article className="rounded-xl border border-primary-800/60 bg-primary-950/30 p-4">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-primary-200">Auth</h2>
            <p className="mt-2 text-lg font-semibold">
              {isAuthenticated ? 'Authenticated' : 'Not authenticated'}
            </p>
            <p className="text-sm text-primary-200">{isVaultUnlocked ? 'Vault unlocked' : 'Vault locked'}</p>
          </article>

          <article className="rounded-xl border border-primary-800/60 bg-primary-950/30 p-4">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-primary-200">Identity</h2>
            <p className="mt-2 text-lg font-semibold truncate" title={identity?.address || '—'}>
              {identity?.address ?? '—'}
            </p>
            <p className="text-sm text-primary-200 truncate" title={identity?.displayName || 'No display name'}>
              {identity?.displayName ?? 'No display name'}
            </p>
          </article>

          <article className="rounded-xl border border-primary-800/60 bg-primary-950/30 p-4">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-primary-200">Conversations</h2>
            <dl className="mt-2 space-y-1 text-sm text-primary-100">
              <div className="flex items-center justify-between">
                <dt>Total</dt>
                <dd>{conversationSummary.total}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt>Pinned</dt>
                <dd>{conversationSummary.pinned}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt>Archived</dt>
                <dd>{conversationSummary.archived}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt>Status</dt>
                <dd>{conversationSummary.isLoading ? 'Loading…' : 'Idle'}</dd>
              </div>
            </dl>
          </article>

          <article className="rounded-xl border border-primary-800/60 bg-primary-950/30 p-4">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-primary-200">XMTP</h2>
            <p className="mt-2 text-lg font-semibold capitalize">{connectionStatus}</p>
            <p className="text-sm text-primary-200">
              Last connected {lastConnected ? formatDistanceToNow(lastConnected) : 'never'}
            </p>
            {xmtpError && <p className="mt-1 text-sm text-red-400">{xmtpError}</p>}
          </article>
        </section>

        <WebWorkersPanel />

        <section className="rounded-xl border border-primary-800/60 bg-primary-950/30">
          <header className="flex items-center justify-between border-b border-primary-800/60 px-4 py-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-primary-100">Network Log</h2>
            <button
              type="button"
              onClick={clearNetwork}
              className="rounded-lg border border-primary-800/60 px-3 py-1 text-xs text-primary-100 hover:border-primary-700"
            >
              Clear network log
            </button>
          </header>
          <div className="max-h-80 overflow-y-auto">
            {reversedNetwork.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-primary-300">
                XMTP requests and responses will appear here.
              </p>
            ) : (
              <ul className="divide-y divide-primary-800/60">
                {reversedNetwork.map((entry) => (
                  <li key={entry.id} className="px-4 py-3 text-sm">
                    <div className="flex items-center justify-between text-xs uppercase tracking-wide">
                      <span
                        className={
                          entry.direction === 'outbound'
                            ? 'font-semibold text-accent-300'
                            : entry.direction === 'inbound'
                              ? 'font-semibold text-emerald-400'
                              : 'font-semibold text-primary-200'
                        }
                      >
                        {entry.direction}
                      </span>
                      <span className="text-primary-300">
                        {new Date(entry.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <p className="mt-1 text-base font-medium text-primary-100">{entry.event}</p>
                    {entry.details && <p className="mt-1 text-xs text-primary-200">{entry.details}</p>}
                    {entry.payload && (
                      <pre className="mt-2 overflow-x-auto rounded-lg bg-primary-900/70 p-3 text-[11px] leading-relaxed text-primary-100">
                        {entry.payload}
                      </pre>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className="rounded-xl border border-primary-800/60 bg-primary-950/30">
          <header className="flex items-center justify-between border-b border-primary-800/60 px-4 py-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-primary-100">Console Log</h2>
            <button
              type="button"
              onClick={clearConsole}
              className="rounded-lg border border-primary-800/60 px-3 py-1 text-xs text-primary-100 hover:border-primary-700"
            >
              Clear console log
            </button>
          </header>
          <div className="max-h-80 overflow-y-auto">
            {reversedConsole.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-primary-300">
                Console output from the running app will appear here.
              </p>
            ) : (
              <ul className="divide-y divide-primary-800/60">
                {reversedConsole.map((entry) => (
                  <li key={entry.id} className="px-4 py-3 text-sm">
                    <div className="flex items-center justify-between text-xs uppercase tracking-wide">
                      <span
                        className={
                          entry.level === 'error'
                            ? 'font-semibold text-red-400'
                            : entry.level === 'warn'
                              ? 'font-semibold text-yellow-400'
                              : entry.level === 'info'
                                ? 'font-semibold text-accent-300'
                                : 'font-semibold text-primary-200'
                        }
                      >
                        {entry.level}
                      </span>
                      <span className="text-primary-300">
                        {new Date(entry.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <p className="mt-2 text-primary-100 whitespace-pre-wrap break-words">{entry.message}</p>
                    {entry.details && (
                      <pre className="mt-2 overflow-x-auto rounded-lg bg-primary-900/70 p-3 text-[11px] leading-relaxed text-primary-100">
                        {entry.details}
                      </pre>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className="rounded-xl border border-primary-800/60 bg-primary-950/30">
          <header className="flex items-center justify-between border-b border-primary-800/60 px-4 py-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-primary-100">Error Log</h2>
            <button
              type="button"
              onClick={clearErrors}
              className="rounded-lg border border-primary-800/60 px-3 py-1 text-xs text-primary-100 hover:border-primary-700"
            >
              Clear error log
            </button>
          </header>
          <div className="max-h-80 overflow-y-auto">
            {reversedErrors.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-primary-300">
                Runtime errors, stack traces, and unhandled rejections will be captured here.
              </p>
            ) : (
              <ul className="divide-y divide-primary-800/60">
                {reversedErrors.map((entry) => (
                  <li key={entry.id} className="px-4 py-3 text-sm">
                    <div className="flex items-center justify-between text-xs uppercase tracking-wide">
                      <span className="font-semibold text-red-400">{entry.source}</span>
                      <span className="text-primary-300">
                        {new Date(entry.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <p className="mt-2 text-base font-semibold text-primary-100">{entry.message}</p>
                    {entry.details && <p className="mt-1 text-xs text-primary-200">{entry.details}</p>}
                    {entry.stack && (
                      <pre className="mt-2 overflow-x-auto rounded-lg bg-red-950/40 p-3 text-[11px] leading-relaxed text-red-100">
                        {entry.stack}
                      </pre>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
