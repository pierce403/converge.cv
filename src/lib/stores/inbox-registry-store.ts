import { create } from 'zustand';
import type { InboxRegistryEntry } from '@/types';
import { normalizeInboxId } from '@/lib/utils/inbox';
import { normalizeEthereumAddress } from '@/lib/utils/ethereum';

const STORAGE_KEY = 'converge.inboxRegistry.v1';
const CURRENT_KEY = 'converge.currentInboxId.v1';

export const INBOX_ALREADY_LOADED_MESSAGE = 'This inbox is already loaded';

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof localStorage !== 'undefined';
}

function readEntriesFromStorage(): InboxRegistryEntry[] {
  if (!isBrowser()) {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as InboxRegistryEntry[];
    if (!Array.isArray(parsed)) {
      return [];
    }
    const normalized = parsed
      .map((entry) => ({
        ...entry,
        inboxId: normalizeInboxId(entry.inboxId) || '',
        lastOpenedAt: entry.lastOpenedAt ?? 0,
        hasLocalDB: Boolean(entry.hasLocalDB),
      }))
      .filter((entry) => entry.inboxId.length > 0);

    // Older builds could persist more than one account-key row for the same
    // inbox. The product switcher is inbox-based, so collapse them here.
    return normalized.reduce<InboxRegistryEntry[]>((entries, entry) => {
      const existingIndex = entries.findIndex((candidate) => candidate.inboxId === entry.inboxId);
      if (existingIndex === -1) {
        return [...entries, entry];
      }
      const existing = entries[existingIndex];
      const newer = entry.lastOpenedAt >= existing.lastOpenedAt ? entry : existing;
      const older = newer === entry ? existing : entry;
      const next = [...entries];
      next[existingIndex] = {
        ...older,
        ...newer,
        avatar: newer.avatar || older.avatar,
        hasLocalDB: newer.hasLocalDB || older.hasLocalDB,
        lastOpenedAt: Math.max(newer.lastOpenedAt, older.lastOpenedAt),
      };
      return next;
    }, []);
  } catch (error) {
    console.warn('[InboxRegistry] Failed to read registry from storage:', error);
    return [];
  }
}

function writeEntriesToStorage(entries: InboxRegistryEntry[]): void {
  if (!isBrowser()) {
    return;
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch (error) {
    console.warn('[InboxRegistry] Failed to persist registry:', error);
  }
}

function readCurrentInboxId(): string | null {
  if (!isBrowser()) {
    return null;
  }
  try {
    return normalizeInboxId(window.localStorage.getItem(CURRENT_KEY));
  } catch (error) {
    console.warn('[InboxRegistry] Failed to read current inbox id:', error);
    return null;
  }
}

function writeCurrentInboxId(inboxId: string | null): void {
  if (!isBrowser()) {
    return;
  }
  try {
    if (inboxId) {
      window.localStorage.setItem(CURRENT_KEY, inboxId);
    } else {
      window.localStorage.removeItem(CURRENT_KEY);
    }
  } catch (error) {
    console.warn('[InboxRegistry] Failed to persist current inbox id:', error);
  }
}

interface InboxRegistryState {
  entries: InboxRegistryEntry[];
  currentInboxId: string | null;
  isHydrated: boolean;
  hydrate: () => void;
  upsertEntry: (entry: InboxRegistryEntry) => void;
  updateEntry: (inboxId: string, updates: Partial<InboxRegistryEntry>) => void;
  markOpened: (inboxId: string, hasLocalDB?: boolean) => void;
  removeEntry: (inboxId: string) => void;
  hasInbox: (inboxId: string | null | undefined) => boolean;
  setCurrentInbox: (inboxId: string | null) => void;
  reset: () => void;
}

export const useInboxRegistryStore = create<InboxRegistryState>((set, get) => ({
  entries: [],
  currentInboxId: null,
  isHydrated: false,
  hydrate: () => {
    if (get().isHydrated) {
      return;
    }
    const entries = readEntriesFromStorage();
    const currentInboxId = readCurrentInboxId();
    set({ entries, currentInboxId, isHydrated: true });
  },
  upsertEntry: (entry) => {
    const entries = get().entries;
    const normalizedInboxId = normalizeInboxId(entry.inboxId);
    if (!normalizedInboxId) {
      return;
    }
    const normalizedEntry = { ...entry, inboxId: normalizedInboxId };
    const existingIndex = entries.findIndex((e) => e.inboxId === normalizedInboxId);
    let updatedEntries: InboxRegistryEntry[];
    if (existingIndex >= 0) {
      updatedEntries = [...entries];
      updatedEntries[existingIndex] = { ...updatedEntries[existingIndex], ...normalizedEntry };
    } else {
      updatedEntries = [...entries, normalizedEntry];
    }
    set({ entries: updatedEntries });
    writeEntriesToStorage(updatedEntries);
  },
  updateEntry: (inboxId, updates) => {
    const normalizedInboxId = normalizeInboxId(inboxId);
    if (!normalizedInboxId) {
      return;
    }
    const entries = get().entries;
    const index = entries.findIndex((entry) => entry.inboxId === normalizedInboxId);
    if (index === -1) {
      return;
    }
    const updatedEntries = [...entries];
    updatedEntries[index] = { ...updatedEntries[index], ...updates };
    set({ entries: updatedEntries });
    writeEntriesToStorage(updatedEntries);
  },
  markOpened: (inboxId, hasLocalDB = true) => {
    const now = Date.now();
    get().updateEntry(inboxId, { lastOpenedAt: now, hasLocalDB });
    get().setCurrentInbox(inboxId);
  },
  removeEntry: (inboxId) => {
    const normalizedInboxId = normalizeInboxId(inboxId);
    const entries = get().entries.filter((entry) => entry.inboxId !== normalizedInboxId);
    const currentInboxId = get().currentInboxId === normalizedInboxId ? null : get().currentInboxId;
    set({ entries, currentInboxId });
    writeEntriesToStorage(entries);
    if (currentInboxId === null) {
      writeCurrentInboxId(null);
    }
  },
  hasInbox: (inboxId) => {
    const normalizedInboxId = normalizeInboxId(inboxId);
    return Boolean(
      normalizedInboxId && get().entries.some((entry) => entry.inboxId === normalizedInboxId)
    );
  },
  setCurrentInbox: (inboxId) => {
    const normalizedInboxId = normalizeInboxId(inboxId);
    set({ currentInboxId: normalizedInboxId });
    writeCurrentInboxId(normalizedInboxId);
  },
  reset: () => {
    set({ entries: [], currentInboxId: null, isHydrated: true });
    writeEntriesToStorage([]);
    writeCurrentInboxId(null);
  },
}));

export function getInboxDisplayLabel(entry: InboxRegistryEntry): string {
  const displayLabel = entry.displayLabel.trim();
  const technicalLabel =
    /^(?:identity|wallet|app key)\s/i.test(displayLabel) ||
    Boolean(normalizeEthereumAddress(displayLabel)) ||
    /^[0-9a-f]{64}$/i.test(displayLabel);
  if (displayLabel.length > 0 && !technicalLabel) {
    return displayLabel;
  }
  const identifier = entry.primaryDisplayIdentity;
  if (normalizeEthereumAddress(identifier) || /^[0-9a-f]{64}$/i.test(identifier)) {
    return 'Unnamed inbox';
  }
  if (identifier.length > 12) {
    return `${identifier.slice(0, 4)}…${identifier.slice(-4)}`;
  }
  return identifier;
}
