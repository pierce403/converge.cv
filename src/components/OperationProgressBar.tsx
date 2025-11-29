import { useEffect, useState } from 'react';

interface OperationStatusDetail {
  id: string;
  message: string;
  step: number;
  total: number;
  state?: 'running' | 'complete';
}

interface OperationState {
  id: string;
  message: string;
  step: number;
  total: number;
  state: 'running' | 'complete';
}

export function OperationProgressBar() {
  const [operation, setOperation] = useState<OperationState | null>(null);

  useEffect(() => {
    const handleUpdate = (event: Event) => {
      const detail = (event as CustomEvent<OperationStatusDetail | undefined>).detail;
      if (!detail) return;
      const total = detail.total > 0 ? detail.total : 1;
      const step = Math.min(Math.max(detail.step, 0), total);
      setOperation({
        id: detail.id,
        message: detail.message,
        step,
        total,
        state: detail.state ?? 'running',
      });
    };

    window.addEventListener('ui:operation-status', handleUpdate as EventListener);
    return () => window.removeEventListener('ui:operation-status', handleUpdate as EventListener);
  }, []);

  useEffect(() => {
    if (operation?.state !== 'complete') return;
    const timer = setTimeout(() => setOperation(null), 1500);
    return () => clearTimeout(timer);
  }, [operation]);

  if (!operation) {
    return null;
  }

  const progress = Math.min(100, Math.max(0, (operation.step / operation.total) * 100));

  return (
    <div className="fixed top-0 left-0 right-0 z-[60] text-primary-100 pointer-events-none">
      <div className="h-1 bg-primary-950/70">
        <div
          className="h-full bg-accent-500 transition-all duration-300 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>
      <div className="bg-primary-950/90 backdrop-blur-sm border-b border-primary-800/60">
        <div className="max-w-7xl mx-auto px-4 py-1.5">
          <div className="flex items-center justify-center gap-2 text-xs text-primary-200">
            {operation.state !== 'complete' ? (
              <div className="w-3 h-3 border-2 border-accent-400 border-t-transparent rounded-full animate-spin" />
            ) : (
              <span className="text-accent-300">✓</span>
            )}
            <span className="text-center">{operation.message}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
