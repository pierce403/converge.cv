import { useCallback, useMemo, useState } from 'react';
import type { Conversation, DeletedConversationRecord, Identity, Message } from '@/types';
import type { Contact } from '@/lib/stores/contact-store';
import { getStorage, getStorageNamespace } from '@/lib/storage';

type TableKey = 'contacts' | 'conversations' | 'messages' | 'identities' | 'deletedConversations';
type ExplorerMode = 'static' | 'messages-search' | 'messages-conversation';

type ExplorerRow = Contact | Conversation | Message | Identity | DeletedConversationRecord;

const TABLE_OPTIONS: Array<{ value: TableKey; label: string; hint: string }> = [
  {
    value: 'contacts',
    label: 'Contacts',
    hint: 'Contacts from Dexie (contacts).',
  },
  {
    value: 'conversations',
    label: 'Conversations',
    hint: 'Conversation list metadata from Dexie.',
  },
  {
    value: 'messages',
    label: 'Messages',
    hint: 'Search messages globally, or browse by conversationId.',
  },
  {
    value: 'identities',
    label: 'Identities',
    hint: 'Local identities from the global DB.',
  },
  {
    value: 'deletedConversations',
    label: 'Deleted Conversations',
    hint: 'Tombstones/ignore markers that prevent resync re-creating threads.',
  },
];

const PAGE_SIZES = [25, 50, 100, 250] as const;

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function safePrettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function matchesFilter(value: unknown, filter: string): boolean {
  const needle = filter.trim().toLowerCase();
  if (!needle) return true;
  return safeStringify(value).toLowerCase().includes(needle);
}

function summarizeRow(table: TableKey, row: ExplorerRow): { title: string; subtitle?: string; meta?: string } {
  if (table === 'contacts') {
    const contact = row as Contact;
    return {
      title: contact.inboxId,
      subtitle: contact.preferredName || contact.name || '—',
      meta: contact.primaryAddress || contact.addresses?.[0] || '',
    };
  }

  if (table === 'conversations') {
    const convo = row as Conversation;
    return {
      title: convo.id,
      subtitle: convo.displayName || convo.peerId,
      meta: `${convo.unreadCount ?? 0} unread`,
    };
  }

  if (table === 'messages') {
    const msg = row as Message;
    const preview = msg.type === 'text' ? msg.body : msg.body || msg.type;
    return {
      title: msg.id,
      subtitle: `${msg.conversationId} • ${msg.sender}`,
      meta: preview.length > 80 ? `${preview.slice(0, 80)}…` : preview,
    };
  }

  if (table === 'identities') {
    const identity = row as Identity;
    return {
      title: identity.address,
      subtitle: identity.inboxId || identity.displayName || '—',
    };
  }

  const deleted = row as DeletedConversationRecord;
  return {
    title: deleted.conversationId,
    subtitle: deleted.peerId || '—',
    meta: deleted.reason || 'user-hidden',
  };
}

function formatCount(count: number): string {
  if (count >= 1_000_000) return `${Math.round(count / 100_000) / 10}M`;
  if (count >= 10_000) return `${Math.round(count / 1_000)}k`;
  return String(count);
}

export function DatabaseExplorerPanel() {
  const namespace = getStorageNamespace();
  const [table, setTable] = useState<TableKey>('contacts');
  const [mode, setMode] = useState<ExplorerMode>('static');

  const [filterInput, setFilterInput] = useState('');
  const [conversationIdInput, setConversationIdInput] = useState('');
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZES)[number]>(50);

  const [appliedFilter, setAppliedFilter] = useState('');
  const [appliedConversationId, setAppliedConversationId] = useState('');

  const [rows, setRows] = useState<ExplorerRow[]>([]);
  const [visibleLimit, setVisibleLimit] = useState(50);

  const [messageOffset, setMessageOffset] = useState(0);
  const [messageSearchLimit, setMessageSearchLimit] = useState(50);
  const [hasMore, setHasMore] = useState(false);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const appliedHint = useMemo(() => TABLE_OPTIONS.find((opt) => opt.value === table)?.hint ?? '', [table]);

  const visibleRows = useMemo(() => {
    if (mode === 'static') {
      return rows.slice(0, visibleLimit);
    }
    return rows;
  }, [mode, rows, visibleLimit]);

  const canLoadMore = useMemo(() => {
    if (isLoading) return false;
    if (mode === 'static') {
      return visibleLimit < rows.length;
    }
    return hasMore;
  }, [hasMore, isLoading, mode, rows.length, visibleLimit]);

  const clearResults = useCallback(() => {
    setRows([]);
    setVisibleLimit(pageSize);
    setAppliedFilter('');
    setAppliedConversationId('');
    setMessageOffset(0);
    setMessageSearchLimit(pageSize);
    setHasMore(false);
    setError(null);
    setMode('static');
  }, [pageSize]);

  const runSearch = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setRows([]);
    setHasMore(false);
    setVisibleLimit(pageSize);

    const filter = filterInput.trim();
    const conversationId = conversationIdInput.trim();
    setAppliedFilter(filter);

    try {
      const storage = await getStorage();

      if (table === 'messages') {
        if (conversationId) {
          setMode('messages-conversation');
          setAppliedConversationId(conversationId);
          setMessageOffset(0);

          const firstPage = await storage.listMessages(conversationId, { limit: pageSize, offset: 0 });
          const pageNewestFirst = firstPage.slice().reverse();
          const filtered = filter ? pageNewestFirst.filter((msg) => matchesFilter(msg, filter)) : pageNewestFirst;
          setRows(filtered);
          setHasMore(firstPage.length === pageSize);
          return;
        }

        if (!filter) {
          setMode('messages-search');
          setError('Messages require a filter or a conversationId.');
          return;
        }

        setMode('messages-search');
        setAppliedConversationId('');
        setMessageSearchLimit(pageSize);

        const found = await storage.searchMessages(filter, pageSize);
        const sorted = found.slice().sort((a, b) => (b.sentAt ?? 0) - (a.sentAt ?? 0));
        setRows(sorted);
        setHasMore(found.length === pageSize);
        return;
      }

      setMode('static');
      setAppliedConversationId('');

      let raw: ExplorerRow[] = [];
      if (table === 'contacts') raw = (await storage.listContacts()) as ExplorerRow[];
      else if (table === 'conversations') raw = (await storage.listConversations()) as ExplorerRow[];
      else if (table === 'identities') raw = (await storage.listIdentities()) as ExplorerRow[];
      else raw = (await storage.listDeletedConversations()) as ExplorerRow[];

      const filtered = filter ? raw.filter((row) => matchesFilter(row, filter)) : raw;
      setRows(filtered);
    } catch (err) {
      console.error('[DatabaseExplorer] Failed to query table', err);
      setError(err instanceof Error ? err.message : 'Failed to load table data.');
    } finally {
      setIsLoading(false);
    }
  }, [conversationIdInput, filterInput, pageSize, table]);

  const loadMore = useCallback(async () => {
    if (isLoading) return;

    if (mode === 'static') {
      setVisibleLimit((prev) => Math.min(prev + pageSize, rows.length));
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const storage = await getStorage();
      if (mode === 'messages-conversation') {
        const nextOffset = messageOffset + pageSize;
        const page = await storage.listMessages(appliedConversationId, { limit: pageSize, offset: nextOffset });
        const pageNewestFirst = page.slice().reverse();
        const filtered = appliedFilter ? pageNewestFirst.filter((msg) => matchesFilter(msg, appliedFilter)) : pageNewestFirst;
        setRows((prev) => [...prev, ...filtered]);
        setMessageOffset(nextOffset);
        setHasMore(page.length === pageSize);
        return;
      }

      const nextLimit = messageSearchLimit + pageSize;
      const found = await storage.searchMessages(appliedFilter, nextLimit);
      const sorted = found.slice().sort((a, b) => (b.sentAt ?? 0) - (a.sentAt ?? 0));
      setRows(sorted);
      setMessageSearchLimit(nextLimit);
      setHasMore(found.length === nextLimit);
    } catch (err) {
      console.error('[DatabaseExplorer] Failed to load more', err);
      setError(err instanceof Error ? err.message : 'Failed to load more results.');
    } finally {
      setIsLoading(false);
    }
  }, [appliedConversationId, appliedFilter, isLoading, messageOffset, messageSearchLimit, mode, pageSize, rows.length]);

  return (
    <section className="rounded-xl border border-primary-800/60 bg-primary-950/30">
      <header className="flex flex-col gap-2 border-b border-primary-800/60 px-4 py-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-primary-100">Database Explorer</h2>
          <p className="mt-1 text-xs text-primary-300">
            Dexie namespace: <span className="font-mono text-primary-100">{namespace}</span>
          </p>
        </div>
        <button type="button" onClick={clearResults} className="btn-secondary">
          Clear
        </button>
      </header>

      <div className="px-4 py-3 space-y-3">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-12">
          <div className="md:col-span-3">
            <label htmlFor="dbx-table" className="block text-xs font-medium text-primary-200">
              Table
            </label>
            <select
              id="dbx-table"
              value={table}
              onChange={(e) => {
                setTable(e.target.value as TableKey);
                clearResults();
              }}
              className="mt-1 w-full rounded-lg border border-primary-800/60 bg-primary-950/60 px-3 py-2 text-sm text-primary-100 focus:outline-none focus:ring-2 focus:ring-accent-400"
            >
              {TABLE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-2">
            <label htmlFor="dbx-page-size" className="block text-xs font-medium text-primary-200">
              Page size
            </label>
            <select
              id="dbx-page-size"
              value={pageSize}
              onChange={(e) => {
                const next = Number(e.target.value) as (typeof PAGE_SIZES)[number];
                setPageSize(next);
                setVisibleLimit(next);
                setMessageSearchLimit(next);
              }}
              className="mt-1 w-full rounded-lg border border-primary-800/60 bg-primary-950/60 px-3 py-2 text-sm text-primary-100 focus:outline-none focus:ring-2 focus:ring-accent-400"
            >
              {PAGE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </div>

          {table === 'messages' && (
            <div className="md:col-span-3">
              <label htmlFor="dbx-conversation" className="block text-xs font-medium text-primary-200">
                Conversation ID
              </label>
              <input
                id="dbx-conversation"
                value={conversationIdInput}
                onChange={(e) => setConversationIdInput(e.target.value)}
                placeholder="Optional (browse by conversation)"
                className="mt-1 w-full rounded-lg border border-primary-800/60 bg-primary-950/60 px-3 py-2 text-sm text-primary-100 placeholder-primary-400 focus:outline-none focus:ring-2 focus:ring-accent-400"
              />
            </div>
          )}

          <div className={table === 'messages' ? 'md:col-span-3' : 'md:col-span-5'}>
            <label htmlFor="dbx-filter" className="block text-xs font-medium text-primary-200">
              Filter
            </label>
            <input
              id="dbx-filter"
              value={filterInput}
              onChange={(e) => setFilterInput(e.target.value)}
              placeholder="String match (case-insensitive)"
              className="mt-1 w-full rounded-lg border border-primary-800/60 bg-primary-950/60 px-3 py-2 text-sm text-primary-100 placeholder-primary-400 focus:outline-none focus:ring-2 focus:ring-accent-400"
            />
          </div>

          <div className="md:col-span-1 flex items-end">
            <button type="button" onClick={runSearch} className="btn-primary w-full" disabled={isLoading}>
              {isLoading ? 'Loading…' : 'Search'}
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs text-primary-200">
          <span className="rounded-full border border-primary-800/60 bg-primary-950/40 px-2 py-1">
            {formatCount(rows.length)} result{rows.length === 1 ? '' : 's'}
          </span>
          {mode === 'static' && rows.length > 0 && (
            <span className="rounded-full border border-primary-800/60 bg-primary-950/40 px-2 py-1">
              showing {formatCount(visibleRows.length)}
            </span>
          )}
          {appliedConversationId && (
            <span className="rounded-full border border-primary-800/60 bg-primary-950/40 px-2 py-1 font-mono">
              conversationId={appliedConversationId}
            </span>
          )}
          {appliedFilter && (
            <span className="rounded-full border border-primary-800/60 bg-primary-950/40 px-2 py-1 font-mono">
              filter={appliedFilter}
            </span>
          )}
          {appliedHint && <span className="text-primary-300">{appliedHint}</span>}
        </div>

        {error && (
          <div className="rounded-lg border border-red-500/60 bg-red-900/30 px-3 py-2 text-xs text-red-200">
            {error}
          </div>
        )}

        <div className="max-h-[28rem] overflow-y-auto rounded-xl border border-primary-900/50 bg-primary-950/40">
          {isLoading && rows.length === 0 ? (
            <div className="flex h-48 items-center justify-center text-sm text-primary-300">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="flex h-48 items-center justify-center text-sm text-primary-300">
              Select a table, set an optional filter, then click Search.
            </div>
          ) : (
            <ul className="divide-y divide-primary-900/60">
              {visibleRows.map((row) => {
                const summary = summarizeRow(table, row);
                const key =
                  table === 'contacts'
                    ? (row as Contact).inboxId
                    : table === 'conversations'
                      ? (row as Conversation).id
                      : table === 'messages'
                        ? (row as Message).id
                        : table === 'identities'
                          ? (row as Identity).address
                          : `${(row as DeletedConversationRecord).conversationId}:${(row as DeletedConversationRecord).deletedAt}`;
                return (
                  <li key={key} className="px-4 py-3 text-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-mono text-xs text-primary-100 break-all">{summary.title}</div>
                        {summary.subtitle && (
                          <div className="mt-1 text-sm text-primary-100 break-words">{summary.subtitle}</div>
                        )}
                        {summary.meta && (
                          <div className="mt-1 text-xs text-primary-300 break-words">{summary.meta}</div>
                        )}
                      </div>
                      <details className="shrink-0">
                        <summary className="cursor-pointer select-none rounded border border-primary-800/60 px-2 py-1 text-xs text-primary-100 hover:border-primary-700">
                          JSON
                        </summary>
                        <pre className="mt-2 max-w-[80vw] overflow-x-auto rounded-lg bg-primary-900/70 p-3 text-[11px] leading-relaxed text-primary-100">
                          {safePrettyJson(row)}
                        </pre>
                      </details>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {canLoadMore && (
          <div className="flex justify-center">
            <button type="button" onClick={loadMore} className="btn-secondary" disabled={isLoading}>
              {isLoading ? 'Loading…' : 'Load more'}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
