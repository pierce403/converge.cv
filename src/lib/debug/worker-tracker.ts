// Simple global tracker for dedicated Web Workers created via new Worker(...)
// It monkey-patches window.Worker to capture instances, basic metadata,
// and provides a small API on window.__workerTracker to enumerate/terminate.

// Avoid augmenting Window typing; store on window as any to prevent TS collisions

type WorkerTrackerApi = {
  workers: Map<number, WorkerInfo>;
  nextId: number;
  list: () => PublicWorkerInfo[];
  terminate: (id: number) => boolean;
  get: (id: number) => PublicWorkerInfo | undefined;
};

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
  } catch (_e) {
    // ignore
  }
}

function toPublic(w: WorkerInfo): PublicWorkerInfo {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { worker: _ignored, ...rest } = w;
  return rest;
}

// Patch once
(() => {
  if (typeof window === 'undefined') return;
  const flagWin = window as unknown as { __workerTrackerPatched?: boolean };
  if (flagWin.__workerTrackerPatched) return;
  flagWin.__workerTrackerPatched = true;

  const OriginalWorker = window.Worker;
  if (!OriginalWorker) return;

  const anyWindow = window as unknown as { __workerTracker?: WorkerTrackerApi; Worker: typeof Worker };
  const tracker: WorkerTrackerApi = (anyWindow.__workerTracker as WorkerTrackerApi | undefined) ?? {
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
  };
  anyWindow.__workerTracker = tracker;

  // Override constructor
  const PatchedWorker = function (this: Worker, scriptURL: string | URL, options?: WorkerOptions) {
    const worker = new OriginalWorker(scriptURL, options);
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
  } as unknown as typeof Worker;

  // Assign patched constructor with correct shape
  anyWindow.Worker = PatchedWorker;
})();
