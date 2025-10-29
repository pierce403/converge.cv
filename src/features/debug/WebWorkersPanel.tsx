import { useEffect, useState } from 'react';

type WorkerStatus = 'running' | 'terminated';
type PublicWorkerInfo = {
  id: number;
  scriptUrl: string;
  type?: WorkerOptions['type'];
  createdAt: number;
  status: WorkerStatus;
  messages: number;
  errors: number;
  lastError?: string;
};

declare global {
  interface Window {
    __workerTracker?: {
      list: () => PublicWorkerInfo[];
      terminate: (id: number) => boolean;
    };
  }
}

export function WebWorkersPanel() {
  const [workers, setWorkers] = useState<PublicWorkerInfo[]>([]);
  const [swRegs, setSwRegs] = useState<ServiceWorkerRegistration[]>([]);
  const [busy, setBusy] = useState(false);
  const [swError, setSwError] = useState<string | null>(null);

  const refreshWorkers = () => {
    try {
      const list = window.__workerTracker?.list?.() ?? [];
      setWorkers(list);
    } catch {
      setWorkers([]);
    }
  };

  const refreshServiceWorkers = async () => {
    setBusy(true);
    setSwError(null);
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        setSwRegs(Array.from(regs));
      } else {
        setSwRegs([]);
      }
    } catch (e) {
      setSwError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    refreshWorkers();
    refreshServiceWorkers();
    const onUpdate = () => refreshWorkers();
    window.addEventListener('worker-tracker:update', onUpdate);
    return () => window.removeEventListener('worker-tracker:update', onUpdate);
  }, []);

  const terminateWorker = (id: number) => {
    window.__workerTracker?.terminate?.(id);
    refreshWorkers();
  };

  const unregisterSw = async (reg: ServiceWorkerRegistration) => {
    setBusy(true);
    setSwError(null);
    try {
      await reg.unregister();
      await refreshServiceWorkers();
    } catch (e) {
      setSwError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-xl border border-primary-800/60 bg-primary-950/30">
      <header className="flex items-center justify-between border-b border-primary-800/60 px-4 py-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-primary-100">Web Workers</h2>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={refreshWorkers}
            className="rounded-lg border border-primary-800/60 px-3 py-1 text-xs text-primary-100 hover:border-primary-700"
            title="Enumerate dedicated workers created by this page"
          >
            Refresh Workers
          </button>
          <button
            type="button"
            onClick={refreshServiceWorkers}
            disabled={busy}
            className="rounded-lg border border-primary-800/60 px-3 py-1 text-xs text-primary-100 hover:border-primary-700 disabled:opacity-50"
            title="Enumerate Service Worker registrations"
          >
            {busy ? 'Refreshing…' : 'Refresh Service Workers'}
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-2">
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-primary-200">Dedicated Workers ({workers.length})</h3>
          {workers.length === 0 ? (
            <p className="text-sm text-primary-300">No dedicated web workers tracked.</p>
          ) : (
            <ul className="space-y-2">
              {workers.map((w) => (
                <li key={w.id} className="rounded-lg border border-primary-800/60 bg-primary-900/30 p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium text-primary-100">Worker #{w.id}</div>
                      <div className="text-xs text-primary-300 truncate" title={w.scriptUrl}>{w.scriptUrl}</div>
                      <div className="mt-1 text-xs text-primary-300">
                        Status: <span className={w.status === 'running' ? 'text-emerald-400' : 'text-primary-300'}>{w.status}</span>
                        {' • '}Type: {w.type ?? 'classic'}
                        {' • '}Created: {new Date(w.createdAt).toLocaleTimeString()}
                        {' • '}Msgs: {w.messages} Errs: {w.errors}
                        {w.lastError ? <span className="ml-2 text-red-400">Last error: {w.lastError}</span> : null}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => terminateWorker(w.id)}
                        disabled={w.status !== 'running'}
                        className="rounded border border-red-600/60 px-2 py-1 text-xs text-red-300 hover:border-red-500 disabled:opacity-50"
                        title="Terminate this dedicated worker (calls worker.terminate())"
                      >
                        Terminate
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-primary-200">Service Workers ({swRegs.length})</h3>
          {swError && <div className="mb-2 rounded border border-red-600/40 bg-red-900/20 p-2 text-xs text-red-300">{swError}</div>}
          {swRegs.length === 0 ? (
            <p className="text-sm text-primary-300">No service worker registrations.</p>
          ) : (
            <ul className="space-y-2">
              {swRegs.map((reg, idx) => {
                const sw = reg.active ?? reg.waiting ?? reg.installing;
                const scriptUrl = sw ? sw.scriptURL : 'unknown';
                const state = sw ? sw.state : 'unknown';
                return (
                  <li key={idx} className="rounded-lg border border-primary-800/60 bg-primary-900/30 p-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm font-medium text-primary-100">{reg.scope}</div>
                        <div className="text-xs text-primary-300 truncate" title={scriptUrl}>{scriptUrl}</div>
                        <div className="mt-1 text-xs text-primary-300">State: {state}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => unregisterSw(reg)}
                          disabled={busy}
                          className="rounded border border-yellow-600/60 px-2 py-1 text-xs text-yellow-300 hover:border-yellow-500 disabled:opacity-50"
                          title="Unregister this service worker"
                        >
                          Unregister
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
