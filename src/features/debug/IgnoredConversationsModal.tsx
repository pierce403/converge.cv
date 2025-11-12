import { useCallback, useEffect, useMemo, useState } from 'react';
import { getStorage } from '@/lib/storage';
import { formatDistanceToNow } from '@/lib/utils/date';
import type { DeletedConversationRecord } from '@/types';

interface IgnoredConversationsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

function reasonLabel(reason?: DeletedConversationRecord['reason']): string {
  switch (reason) {
    case 'user-hidden':
      return 'Hidden manually';
    case 'user-muted':
      return 'Muted conversation';
    case 'system':
      return 'System suppressed';
    default:
      return 'Unknown';
  }
}

export function IgnoredConversationsModal({ isOpen, onClose }: IgnoredConversationsModalProps) {
  const [entries, setEntries] = useState<DeletedConversationRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadEntries = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const storage = await getStorage();
      const records = await storage.listDeletedConversations();
      setEntries(records);
    } catch (err) {
      console.error('[IgnoredConversationsModal] Failed to load ignored list', err);
      setError(err instanceof Error ? err.message : 'Failed to load ignored conversations.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      void loadEntries();
    } else {
      setEntries([]);
      setError(null);
    }
  }, [isOpen, loadEntries]);

  const rows = useMemo(() => entries, [entries]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="relative flex max-h-[85vh] w-full max-w-4xl flex-col gap-4 overflow-hidden rounded-2xl border border-primary-800/70 bg-primary-950/95 p-6 text-primary-50 shadow-2xl">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-full p-2 text-primary-300 transition hover:bg-primary-900/70"
          aria-label="Close ignored conversations"
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path d="M6 6l12 12M6 18L18 6" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        <header className="space-y-2 pr-10">
          <h2 className="text-2xl font-bold">Ignored Conversations</h2>
          <p className="text-sm text-primary-200">
            Conversations in this list are skipped during full resyncs. Unmute or recreate a thread to remove it from this list.
          </p>
          <div className="flex items-center gap-2 text-xs text-primary-200">
            <span className="rounded-full border border-primary-800/60 bg-primary-950/40 px-2 py-1">
              {rows.length} entr{rows.length === 1 ? 'y' : 'ies'}
            </span>
            <button
              type="button"
              onClick={() => loadEntries()}
              className="rounded border border-primary-800/60 px-3 py-1 text-primary-100 transition hover:border-primary-700"
            >
              Refresh
            </button>
          </div>
        </header>

        {error && (
          <div className="rounded-lg border border-red-500/60 bg-red-900/30 px-3 py-2 text-xs text-red-200">
            {error}
          </div>
        )}

        <div className="flex-1 overflow-auto rounded-xl border border-primary-900/50 bg-primary-950/40">
          {loading ? (
            <div className="flex h-full items-center justify-center text-sm text-primary-300">Loading ignored conversations…</div>
          ) : rows.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-primary-300">
              No ignored conversations yet.
            </div>
          ) : (
            <table className="min-w-full divide-y divide-primary-900/60 text-sm">
              <thead className="bg-primary-900/40 text-xs uppercase tracking-wide text-primary-300">
                <tr>
                  <th scope="col" className="px-4 py-3 text-left">Conversation ID</th>
                  <th scope="col" className="px-4 py-3 text-left">Peer / Group ID</th>
                  <th scope="col" className="px-4 py-3 text-left">Reason</th>
                  <th scope="col" className="px-4 py-3 text-left">Ignored</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-primary-900/40">
                {rows.map((entry) => {
                  const relative = formatDistanceToNow(entry.deletedAt, { addSuffix: true });
                  const absolute = new Date(entry.deletedAt).toLocaleString();
                  return (
                    <tr key={`${entry.conversationId}-${entry.deletedAt}`} className="text-primary-100">
                      <td className="px-4 py-3 font-mono text-xs break-all">{entry.conversationId}</td>
                      <td className="px-4 py-3 font-mono text-xs break-all">{entry.peerId || '—'}</td>
                      <td className="px-4 py-3">{reasonLabel(entry.reason)}</td>
                      <td className="px-4 py-3 text-primary-200">
                        <span title={absolute}>{relative}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
