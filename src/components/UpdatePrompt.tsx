/**
 * Update Prompt Component
 * Shows when a new version is available
 */

import { useState, useEffect } from 'react';

export function UpdatePrompt() {
  const [showPrompt, setShowPrompt] = useState(false);
  
  // PWA update detection would go here
  // Currently disabled until vite-plugin-pwa types are properly configured
  const needRefresh = false;
  const updateServiceWorker = () => {
    window.location.reload();
  };

  useEffect(() => {
    if (needRefresh) {
      setShowPrompt(true);
    }
  }, [needRefresh]);

  const handleUpdate = () => {
    updateServiceWorker(true);
  };

  const handleDismiss = () => {
    setShowPrompt(false);
  };

  if (!showPrompt) {
    return null;
  }

  return (
    <div className="fixed top-4 left-4 right-4 md:left-auto md:right-4 md:max-w-sm z-50">
      <div className="bg-primary-600 border border-primary-500 rounded-lg shadow-xl p-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 bg-white/20 rounded-lg flex items-center justify-center flex-shrink-0">
            <svg
              className="w-6 h-6 text-white"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
          </div>

          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-white mb-1">Update Available</h3>
            <p className="text-sm text-white/90 mb-3">
              A new version of Converge is ready. Refresh to get the latest features and fixes.
            </p>

            <div className="flex gap-2">
              <button
                onClick={handleUpdate}
                className="bg-white text-primary-600 hover:bg-white/90 font-medium rounded-lg text-sm px-4 py-2 transition-colors"
              >
                Update Now
              </button>
              <button
                onClick={handleDismiss}
                className="bg-white/20 hover:bg-white/30 text-white font-medium rounded-lg text-sm px-4 py-2 transition-colors"
              >
                Later
              </button>
            </div>
          </div>

          <button
            onClick={handleDismiss}
            className="text-white/80 hover:text-white flex-shrink-0"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

