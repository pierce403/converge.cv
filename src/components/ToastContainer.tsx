import { useEffect, useState } from 'react';

type Toast = { id: string; message: string };

export function ToastContainer() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<string>;
      const message = typeof ce.detail === 'string' ? ce.detail : String(ce.detail);
      const id = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      setToasts((prev) => [...prev, { id, message }]);
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 3500);
    };
    window.addEventListener('ui:toast', handler as EventListener);
    return () => window.removeEventListener('ui:toast', handler as EventListener);
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto bg-primary-900/90 text-primary-50 border border-primary-700 rounded-lg px-3 py-2 shadow-lg backdrop-blur"
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}

