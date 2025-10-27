import { useEffect, useState } from 'react';

function getIsolationState(): boolean {
  if (typeof window === 'undefined') {
    return true;
  }

  if (typeof window.crossOriginIsolated === 'boolean') {
    return window.crossOriginIsolated;
  }

  return false;
}

export function CrossOriginIsolationNotice() {
  const [isIsolated, setIsIsolated] = useState(() => getIsolationState());

  useEffect(() => {
    setIsIsolated(getIsolationState());

    const handleVisibilityChange = () => {
      setIsIsolated(getIsolationState());
    };

    window.addEventListener('focus', handleVisibilityChange);
    window.addEventListener('pageshow', handleVisibilityChange);

    return () => {
      window.removeEventListener('focus', handleVisibilityChange);
      window.removeEventListener('pageshow', handleVisibilityChange);
    };
  }, []);

  if (isIsolated) {
    return null;
  }

  return (
    <div className="bg-amber-500 text-slate-900 text-sm text-center px-4 py-2">
      <span className="font-semibold">Enabling advanced mode…</span>
      <span className="ml-2">
        Preparing secure worker features for XMTP and SQLite performance.
      </span>
    </div>
  );
}
