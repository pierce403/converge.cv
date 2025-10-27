import { useMemo, useState } from 'react';
import {
  useAuthStore,
  useConversationStore,
  useDebugStore,
  useXmtpStore,
} from '@/lib/stores';
import { formatDistanceToNow } from '@/lib/utils/date';

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

  const [showDiagnosticsInfo, setShowDiagnosticsInfo] = useState(false);

  // Check advanced features
  const diagnostics = useMemo(() => {
    const isCrossOriginIsolated = typeof window !== 'undefined' && window.crossOriginIsolated === true;
    const hasSharedArrayBuffer = typeof SharedArrayBuffer !== 'undefined';
    const hasWebAssembly = typeof WebAssembly !== 'undefined';
    
    // Check if service worker has set headers
    let hasCOOP = false;
    let hasCOEP = false;
    
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      // Try to detect from navigation entry (Chrome/Edge)
      try {
        const entry = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
        if (entry) {
          // This is approximate - we can't directly read headers from client side
          hasCOOP = isCrossOriginIsolated; // COOP must be set if isolated
          hasCOEP = isCrossOriginIsolated; // COEP must be set if isolated
        }
      } catch (e) {
        // Fallback
        hasCOOP = isCrossOriginIsolated;
        hasCOEP = isCrossOriginIsolated;
      }
    }

    const allGood = isCrossOriginIsolated && hasSharedArrayBuffer && hasWebAssembly && hasCOOP && hasCOEP;

    return {
      isCrossOriginIsolated,
      hasSharedArrayBuffer,
      hasWebAssembly,
      hasCOOP,
      hasCOEP,
      allGood,
    };
  }, []);

  return (
    <div className="min-h-full bg-slate-950 text-slate-100">
      <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-bold">Debug Console</h1>
            <p className="text-sm text-slate-400">
              Inspect application state, XMTP activity, and runtime issues captured in the app.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <span className="rounded-full bg-slate-800 px-3 py-1">
              {consoleEntries.length} console log{consoleEntries.length === 1 ? '' : 's'}
            </span>
            <span className="rounded-full bg-slate-800 px-3 py-1">
              {networkEntries.length} network event{networkEntries.length === 1 ? '' : 's'}
            </span>
            <span className="rounded-full bg-slate-800 px-3 py-1">
              {errorEntries.length} error{errorEntries.length === 1 ? '' : 's'}
            </span>
            <button
              type="button"
              onClick={clearAll}
              className="ml-auto rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-slate-200 hover:border-slate-500"
            >
              Clear all logs
            </button>
          </div>
        </header>

        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <article className="rounded-xl border border-slate-800 bg-slate-900 p-4">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Auth</h2>
            <p className="mt-2 text-lg font-semibold">
              {isAuthenticated ? 'Authenticated' : 'Not authenticated'}
            </p>
            <p className="text-sm text-slate-400">{isVaultUnlocked ? 'Vault unlocked' : 'Vault locked'}</p>
          </article>

          <article className="rounded-xl border border-slate-800 bg-slate-900 p-4">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Identity</h2>
            <p className="mt-2 text-lg font-semibold truncate" title={identity?.address || '—'}>
              {identity?.address ?? '—'}
            </p>
            <p className="text-sm text-slate-400 truncate" title={identity?.displayName || 'No display name'}>
              {identity?.displayName ?? 'No display name'}
            </p>
          </article>

          <article className="rounded-xl border border-slate-800 bg-slate-900 p-4">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Conversations</h2>
            <dl className="mt-2 space-y-1 text-sm text-slate-300">
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

          <article className="rounded-xl border border-slate-800 bg-slate-900 p-4">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">XMTP</h2>
            <p className="mt-2 text-lg font-semibold capitalize">{connectionStatus}</p>
            <p className="text-sm text-slate-400">
              Last connected {lastConnected ? formatDistanceToNow(lastConnected) : 'never'}
            </p>
            {xmtpError && <p className="mt-1 text-sm text-red-400">{xmtpError}</p>}
          </article>
        </section>

        {/* Advanced Features Diagnostics */}
        <section className="rounded-xl border border-slate-800 bg-slate-900">
          <header className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-300">
                Advanced Features Status
              </h2>
              <button
                type="button"
                onClick={() => setShowDiagnosticsInfo(true)}
                className="text-slate-400 hover:text-slate-200"
                title="What is this?"
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                </svg>
              </button>
            </div>
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${diagnostics.allGood ? 'bg-green-500' : 'bg-yellow-500'}`} />
              <span className={`text-sm font-medium ${diagnostics.allGood ? 'text-green-500' : 'text-yellow-500'}`}>
                {diagnostics.allGood ? 'All Systems Operational' : 'Limited Functionality'}
              </span>
            </div>
          </header>
          <div className="p-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
              <div className="flex items-center gap-3 p-3 rounded-lg bg-slate-800">
                <div className={`w-3 h-3 rounded-full flex-shrink-0 ${diagnostics.hasWebAssembly ? 'bg-green-500' : 'bg-red-500'}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">WebAssembly</div>
                  <div className="text-xs text-slate-400">{diagnostics.hasWebAssembly ? 'Available' : 'Unavailable'}</div>
                </div>
              </div>

              <div className="flex items-center gap-3 p-3 rounded-lg bg-slate-800">
                <div className={`w-3 h-3 rounded-full flex-shrink-0 ${diagnostics.hasCOOP ? 'bg-green-500' : 'bg-red-500'}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">COOP Header</div>
                  <div className="text-xs text-slate-400">{diagnostics.hasCOOP ? 'Set' : 'Missing'}</div>
                </div>
              </div>

              <div className="flex items-center gap-3 p-3 rounded-lg bg-slate-800">
                <div className={`w-3 h-3 rounded-full flex-shrink-0 ${diagnostics.hasCOEP ? 'bg-green-500' : 'bg-red-500'}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">COEP Header</div>
                  <div className="text-xs text-slate-400">{diagnostics.hasCOEP ? 'Set' : 'Missing'}</div>
                </div>
              </div>

              <div className="flex items-center gap-3 p-3 rounded-lg bg-slate-800">
                <div className={`w-3 h-3 rounded-full flex-shrink-0 ${diagnostics.isCrossOriginIsolated ? 'bg-green-500' : 'bg-red-500'}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">Cross-Origin Isolation</div>
                  <div className="text-xs text-slate-400">{diagnostics.isCrossOriginIsolated ? 'Enabled' : 'Disabled'}</div>
                </div>
              </div>

              <div className="flex items-center gap-3 p-3 rounded-lg bg-slate-800">
                <div className={`w-3 h-3 rounded-full flex-shrink-0 ${diagnostics.hasSharedArrayBuffer ? 'bg-green-500' : 'bg-red-500'}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">SharedArrayBuffer</div>
                  <div className="text-xs text-slate-400">{diagnostics.hasSharedArrayBuffer ? 'Available' : 'Unavailable'}</div>
                </div>
              </div>
            </div>

            {!diagnostics.allGood && (
              <div className="mt-4 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
                <div className="flex items-start gap-2">
                  <svg className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                  <div className="flex-1">
                    <div className="text-sm font-medium text-yellow-500">XMTP features may not work correctly</div>
                    <div className="text-xs text-slate-400 mt-1">
                      Wait for "Enabling advanced mode" to complete, or try reloading the page.
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Diagnostics Info Modal */}
        {showDiagnosticsInfo && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowDiagnosticsInfo(false)}>
            <div className="bg-slate-900 rounded-xl border border-slate-800 max-w-2xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              <div className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <h3 className="text-xl font-bold">About Advanced Features</h3>
                  <button
                    onClick={() => setShowDiagnosticsInfo(false)}
                    className="text-slate-400 hover:text-slate-200"
                  >
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                
                <div className="space-y-4 text-sm text-slate-300">
                  <div>
                    <h4 className="font-semibold text-slate-200 mb-2">🚀 WebAssembly (WASM)</h4>
                    <p>A binary instruction format that enables high-performance execution of code in browsers. XMTP uses WASM for efficient cryptographic operations and database management.</p>
                  </div>

                  <div>
                    <h4 className="font-semibold text-slate-200 mb-2">🔒 COOP (Cross-Origin-Opener-Policy)</h4>
                    <p>
                      HTTP header set to <code className="bg-slate-800 px-1 rounded">same-origin</code> that isolates the browsing context. 
                      This prevents other websites from accessing your XMTP data and enables advanced security features.
                    </p>
                  </div>

                  <div>
                    <h4 className="font-semibold text-slate-200 mb-2">🛡️ COEP (Cross-Origin-Embedder-Policy)</h4>
                    <p>
                      HTTP header set to <code className="bg-slate-800 px-1 rounded">credentialless</code> that controls loading of cross-origin resources. 
                      Required for SharedArrayBuffer access.
                    </p>
                  </div>

                  <div>
                    <h4 className="font-semibold text-slate-200 mb-2">🔐 Cross-Origin Isolation</h4>
                    <p>
                      When both COOP and COEP headers are properly set, the browser enables cross-origin isolation. 
                      This unlocks powerful features like SharedArrayBuffer while maintaining security.
                    </p>
                  </div>

                  <div>
                    <h4 className="font-semibold text-slate-200 mb-2">⚡ SharedArrayBuffer</h4>
                    <p>
                      Allows sharing memory between the main thread and Web Workers for high-performance parallel processing. 
                      XMTP's SQLite database runs in a worker thread and uses SharedArrayBuffer for blazing-fast message queries.
                    </p>
                  </div>

                  <div className="pt-4 border-t border-slate-800">
                    <h4 className="font-semibold text-slate-200 mb-2">🔧 How Converge Enables This</h4>
                    <p>
                      GitHub Pages doesn't natively support COOP/COEP headers, so Converge uses a service worker to inject them dynamically. 
                      On first load, you'll see "Enabling advanced mode" while the service worker activates. After a quick reload, 
                      all features are fully operational.
                    </p>
                  </div>
                </div>

                <div className="mt-6 flex justify-end">
                  <button
                    onClick={() => setShowDiagnosticsInfo(false)}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg font-medium"
                  >
                    Got it
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        <section className="rounded-xl border border-slate-800 bg-slate-900">
          <header className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-300">Network Log</h2>
            <button
              type="button"
              onClick={clearNetwork}
              className="rounded-lg border border-slate-700 px-3 py-1 text-xs text-slate-300 hover:border-slate-500"
            >
              Clear network log
            </button>
          </header>
          <div className="max-h-80 overflow-y-auto">
            {reversedNetwork.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-slate-500">
                XMTP requests and responses will appear here.
              </p>
            ) : (
              <ul className="divide-y divide-slate-800">
                {reversedNetwork.map((entry) => (
                  <li key={entry.id} className="px-4 py-3 text-sm">
                    <div className="flex items-center justify-between text-xs uppercase tracking-wide">
                      <span
                        className={
                          entry.direction === 'outbound'
                            ? 'font-semibold text-blue-400'
                            : entry.direction === 'inbound'
                              ? 'font-semibold text-emerald-400'
                              : 'font-semibold text-slate-400'
                        }
                      >
                        {entry.direction}
                      </span>
                      <span className="text-slate-500">
                        {new Date(entry.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <p className="mt-1 text-base font-medium text-slate-200">{entry.event}</p>
                    {entry.details && <p className="mt-1 text-xs text-slate-400">{entry.details}</p>}
                    {entry.payload && (
                      <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-800/80 p-3 text-[11px] leading-relaxed text-slate-200">
                        {entry.payload}
                      </pre>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className="rounded-xl border border-slate-800 bg-slate-900">
          <header className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-300">Console Log</h2>
            <button
              type="button"
              onClick={clearConsole}
              className="rounded-lg border border-slate-700 px-3 py-1 text-xs text-slate-300 hover:border-slate-500"
            >
              Clear console log
            </button>
          </header>
          <div className="max-h-80 overflow-y-auto">
            {reversedConsole.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-slate-500">
                Console output from the running app will appear here.
              </p>
            ) : (
              <ul className="divide-y divide-slate-800">
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
                                ? 'font-semibold text-blue-400'
                                : 'font-semibold text-slate-400'
                        }
                      >
                        {entry.level}
                      </span>
                      <span className="text-slate-500">
                        {new Date(entry.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <p className="mt-2 text-slate-200 whitespace-pre-wrap break-words">{entry.message}</p>
                    {entry.details && (
                      <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-800/80 p-3 text-[11px] leading-relaxed text-slate-200">
                        {entry.details}
                      </pre>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className="rounded-xl border border-slate-800 bg-slate-900">
          <header className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-300">Error Log</h2>
            <button
              type="button"
              onClick={clearErrors}
              className="rounded-lg border border-slate-700 px-3 py-1 text-xs text-slate-300 hover:border-slate-500"
            >
              Clear error log
            </button>
          </header>
          <div className="max-h-80 overflow-y-auto">
            {reversedErrors.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-slate-500">
                Runtime errors, stack traces, and unhandled rejections will be captured here.
              </p>
            ) : (
              <ul className="divide-y divide-slate-800">
                {reversedErrors.map((entry) => (
                  <li key={entry.id} className="px-4 py-3 text-sm">
                    <div className="flex items-center justify-between text-xs uppercase tracking-wide">
                      <span className="font-semibold text-red-400">{entry.source}</span>
                      <span className="text-slate-500">
                        {new Date(entry.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <p className="mt-2 text-base font-semibold text-slate-200">{entry.message}</p>
                    {entry.details && <p className="mt-1 text-xs text-slate-400">{entry.details}</p>}
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
