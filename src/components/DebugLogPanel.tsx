import { useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useDebugStore } from '@/lib/stores';

export function DebugLogPanel() {
  const location = useLocation();
  const totalLogs = useDebugStore(
    (state) => state.consoleEntries.length + state.networkEntries.length + state.errorEntries.length,
  );
  const errorCount = useDebugStore((state) => state.errorEntries.length);

  const isActive = useMemo(() => location.pathname.startsWith('/debug'), [location.pathname]);
  const badgeLabel = useMemo(() => {
    if (errorCount > 0) {
      return `${errorCount} error${errorCount === 1 ? '' : 's'}`;
    }

    if (totalLogs > 0) {
      return `${totalLogs} log${totalLogs === 1 ? '' : 's'}`;
    }

    return null;
  }, [errorCount, totalLogs]);

  return (
    <Link
      to="/debug"
      className={`relative flex flex-col items-center px-4 py-2 rounded-lg transition-colors ${
        isActive ? 'text-accent-300 bg-primary-900/70' : 'text-primary-300 hover:text-primary-100'
      }`}
    >
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M9 19c-1.278-.705-3-2.41-3-5 0-3.866 3.582-7 8-7a6 6 0 016 6c0 2.694-1.714 4.314-3 5m-8 1h8m-4-4v4"
        />
      </svg>
      <span className="text-xs mt-1">Debug</span>
      {badgeLabel && (
        <span
          className={`absolute -top-1 -right-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
            errorCount > 0 ? 'bg-red-500 text-white' : 'bg-primary-900/70 text-primary-100'
          }`}
        >
          {badgeLabel}
        </span>
      )}
    </Link>
  );
}
