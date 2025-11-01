import { create } from 'zustand';
import type { InboxRegistryEntry } from '@/types';

const STORAGE_KEY = 'converge.inboxRegistry.v1';
const CURRENT_KEY = 'converge.currentInboxId.v1';

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
    return parsed.map((entry) => ({
      ...entry,
      lastOpenedAt: entry.lastOpenedAt ?? 0,
      hasLocalDB: Boolean(entry.hasLocalDB),
    }));
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
    return window.localStorage.getItem(CURRENT_KEY);
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
    const existingIndex = entries.findIndex((e) => e.inboxId === entry.inboxId);
    let updatedEntries: InboxRegistryEntry[];
    if (existingIndex >= 0) {
      updatedEntries = [...entries];
      updatedEntries[existingIndex] = { ...updatedEntries[existingIndex], ...entry };
    } else {
      updatedEntries = [...entries, entry];
    }
    set({ entries: updatedEntries });
    writeEntriesToStorage(updatedEntries);
  },
  updateEntry: (inboxId, updates) => {
    const entries = get().entries;
    const index = entries.findIndex((entry) => entry.inboxId === inboxId);
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
    const entries = get().entries.filter((entry) => entry.inboxId !== inboxId);
    const currentInboxId = get().currentInboxId === inboxId ? null : get().currentInboxId;
    set({ entries, currentInboxId });
    writeEntriesToStorage(entries);
    if (currentInboxId === null) {
      writeCurrentInboxId(null);
    }
  },
  setCurrentInbox: (inboxId) => {
    set({ currentInboxId: inboxId });
    writeCurrentInboxId(inboxId);
  },
  reset: () => {
    set({ entries: [], currentInboxId: null, isHydrated: true });
    writeEntriesToStorage([]);
    writeCurrentInboxId(null);
  },
}));

export function getInboxDisplayLabel(entry: InboxRegistryEntry): string {
  if (entry.displayLabel.trim().length > 0) {
    return entry.displayLabel;
  }
  const identifier = entry.primaryDisplayIdentity;
  if (identifier.startsWith('0x')) {
    return `${identifier.slice(0, 6)}…${identifier.slice(-4)}`;
  }
  if (identifier.length > 12) {
    return `${identifier.slice(0, 4)}…${identifier.slice(-4)}`;
  }
  return identifier;
}
