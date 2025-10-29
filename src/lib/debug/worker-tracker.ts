// Simple global tracker for dedicated Web Workers created via new Worker(...)
// It monkey-patches window.Worker to capture instances, basic metadata,
// and provides a small API on window.__workerTracker to enumerate/terminate.

declare global {
  interface Window {
    __workerTracker?: {
      workers: Map<number, WorkerInfo>;
      nextId: number;
      list: () => PublicWorkerInfo[];
      terminate: (id: number) => boolean;
      get: (id: number) => PublicWorkerInfo | undefined;
    };
  }
}

type WorkerStatus = 'running' | 'terminated';

type WorkerInfo = {
  id: number;
  worker: Worker;
  scriptUrl: string;
  type?: WorkerOptions['type'];
  createdAt: number;
  status: WorkerStatus;
  messages: number;
  errors: number;
  lastError?: string;
};

export type PublicWorkerInfo = Omit<WorkerInfo, 'worker'>;

function dispatchUpdate() {
  try {
    window.dispatchEvent(new CustomEvent('worker-tracker:update'));
  } catch {}
}

function toPublic(w: WorkerInfo): PublicWorkerInfo {
  const { worker: _w, ...rest } = w;
  return rest;
}

// Patch once
(() => {
  if (typeof window === 'undefined') return;
  if ((window as any).__workerTrackerPatched) return;
  (window as any).__workerTrackerPatched = true;

  const OriginalWorker = window.Worker;
  if (!OriginalWorker) return;

  const tracker = (window.__workerTracker = window.__workerTracker ?? {
    workers: new Map<number, WorkerInfo>(),
    nextId: 1,
    list() {
      return Array.from(this.workers.values()).map(toPublic);
    },
    terminate(id: number) {
      const info = this.workers.get(id);
      if (!info || info.status === 'terminated') return false;
      try {
        info.worker.terminate();
        info.status = 'terminated';
        dispatchUpdate();
        return true;
      } catch {
        return false;
      }
    },
    get(id: number) {
      const info = this.workers.get(id);
      return info ? toPublic(info) : undefined;
    },
  });

  // Override constructor
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).Worker = function (scriptURL: string | URL, options?: WorkerOptions) {
    const worker = new OriginalWorker(scriptURL as any, options as any);
    const id = tracker.nextId++;
    const info: WorkerInfo = {
      id,
      worker,
      scriptUrl: typeof scriptURL === 'string' ? scriptURL : scriptURL.toString(),
      type: options?.type,
      createdAt: Date.now(),
      status: 'running',
      messages: 0,
      errors: 0,
    };

    // Track events
    worker.addEventListener('message', () => {
      const rec = tracker.workers.get(id);
      if (rec) {
        rec.messages += 1;
        dispatchUpdate();
      }
    });
    worker.addEventListener('error', (e: ErrorEvent) => {
      const rec = tracker.workers.get(id);
      if (rec) {
        rec.errors += 1;
        rec.lastError = e.message || 'Worker error';
        dispatchUpdate();
      }
    });

    const origTerminate = worker.terminate.bind(worker);
    worker.terminate = () => {
      const ok = origTerminate();
      const rec = tracker.workers.get(id);
      if (rec) {
        rec.status = 'terminated';
        dispatchUpdate();
      }
      return ok;
    };

    tracker.workers.set(id, info);
    dispatchUpdate();
    return worker;
  } as typeof Worker;
})();

