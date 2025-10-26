/**
 * Debug log state store
 */

import { create } from 'zustand';

export type DebugLogLevel = 'log' | 'info' | 'warn' | 'error';

export interface DebugLogEntry {
  id: string;
  level: DebugLogLevel;
  message: string;
  details?: string;
  timestamp: number;
}

interface DebugLogState {
  entries: DebugLogEntry[];
  addEntry: (entry: DebugLogEntry) => void;
  clear: () => void;
}

const MAX_LOG_ENTRIES = 200;

export const useDebugStore = create<DebugLogState>((set) => ({
  entries: [],
  addEntry: (entry) =>
    set((state) => {
      const nextEntries = [...state.entries, entry];
      if (nextEntries.length > MAX_LOG_ENTRIES) {
        nextEntries.splice(0, nextEntries.length - MAX_LOG_ENTRIES);
      }
      return { entries: nextEntries };
    }),
  clear: () => set({ entries: [] }),
}));
