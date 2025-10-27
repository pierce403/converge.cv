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
  const [showTimeout, setShowTimeout] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    setIsIsolated(getIsolationState());

    // Auto-reload when service worker activates to enable isolation
    if ('serviceWorker' in navigator && !isIsolated) {
      navigator.serviceWorker.ready.then(() => {
        // Give SW a moment to take control, then reload
        setTimeout(() => {
          if (!getIsolationState()) {
            console.log('Service worker ready, reloading for cross-origin isolation...');
            window.location.reload();
          }
        }, 500);
      });
    }

    const handleVisibilityChange = () => {
      setIsIsolated(getIsolationState());
    };

    window.addEventListener('focus', handleVisibilityChange);
    window.addEventListener('pageshow', handleVisibilityChange);

    // Show timeout message after 5 seconds
    const timeoutTimer = setTimeout(() => {
      if (!getIsolationState()) {
        setShowTimeout(true);
      }
    }, 5000);

    // Update elapsed time every second
    const intervalTimer = setInterval(() => {
      setElapsedSeconds(prev => prev + 1);
    }, 1000);

    return () => {
      window.removeEventListener('focus', handleVisibilityChange);
      window.removeEventListener('pageshow', handleVisibilityChange);
      clearTimeout(timeoutTimer);
      clearInterval(intervalTimer);
    };
  }, [isIsolated]);

  if (isIsolated) {
    return null;
  }

  return (
    <div className="bg-amber-500 text-slate-900 text-sm text-center px-4 py-2">
      <div className="flex items-center justify-center gap-3">
        {/* Spinner */}
        <svg 
          className="animate-spin h-4 w-4" 
          xmlns="http://www.w3.org/2000/svg" 
          fill="none" 
          viewBox="0 0 24 24"
        >
          <circle 
            className="opacity-25" 
            cx="12" 
            cy="12" 
            r="10" 
            stroke="currentColor" 
            strokeWidth="4"
          />
          <path 
            className="opacity-75" 
            fill="currentColor" 
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
        </svg>
        
        <div>
          <span className="font-semibold">Enabling advanced mode…</span>
          {!showTimeout ? (
            <span className="ml-2">
              Preparing secure features for XMTP messaging.
            </span>
          ) : (
            <span className="ml-2">
              This is taking longer than expected. The page will reload automatically in a moment.
              {elapsedSeconds > 8 && (
                <button 
                  onClick={() => window.location.reload()} 
                  className="ml-2 underline font-semibold hover:text-slate-800"
                >
                  Reload now
                </button>
              )}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
