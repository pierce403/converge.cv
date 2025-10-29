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
    <div className="fixed top-0 left-0 right-0 z-50 text-primary-100">
      {/* Progress bar */}
      <div className="h-1 bg-primary-950/70">
        <div
          className="h-full bg-accent-500 transition-all duration-300 ease-out"
          style={{ width: `${syncProgress}%` }}
        />
      </div>

      {/* Status text */}
      <div className="bg-primary-950/90 backdrop-blur-sm border-b border-primary-800/60">
        <div className="max-w-7xl mx-auto px-4 py-1.5">
          <div className="flex items-center justify-center gap-2 text-xs text-primary-200">
            {syncStatus !== 'complete' && (
              <div className="w-3 h-3 border-2 border-accent-400 border-t-transparent rounded-full animate-spin" />
            )}
            <span>{statusText}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

