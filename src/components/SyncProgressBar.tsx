/**
 * Unobtrusive progress bar showing XMTP sync status
 */

import { useXmtpStore } from '@/lib/stores/xmtp-store';

export function SyncProgressBar() {
  const { syncStatus, syncProgress } = useXmtpStore();

  // Don't show if idle
  if (syncStatus === 'idle') {
    return null;
  }

  const statusText = {
    'syncing-conversations': 'Syncing conversations...',
    'syncing-messages': 'Loading messages...',
    'complete': 'Sync complete ✓',
  }[syncStatus] || '';

  return (
    <div className="fixed top-0 left-0 right-0 z-50">
      {/* Progress bar */}
      <div className="h-1 bg-slate-800">
        <div
          className="h-full bg-primary-500 transition-all duration-300 ease-out"
          style={{ width: `${syncProgress}%` }}
        />
      </div>
      
      {/* Status text */}
      <div className="bg-slate-800/95 backdrop-blur-sm border-b border-slate-700">
        <div className="max-w-7xl mx-auto px-4 py-1.5">
          <div className="flex items-center justify-center gap-2 text-xs text-slate-300">
            {syncStatus !== 'complete' && (
              <div className="w-3 h-3 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
            )}
            <span>{statusText}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

