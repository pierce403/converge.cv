/**
 * Debug log state store
 */

import { create } from 'zustand';

export type DebugLogLevel = 'log' | 'info' | 'warn' | 'error';

export type NetworkLogDirection = 'outbound' | 'inbound' | 'status';

export type ErrorLogSource = 'console' | 'runtime' | 'unhandled-rejection' | 'watchdog';

export interface BaseLogEntry {
  id: string;
  timestamp: number;
}

export interface ConsoleLogEntry extends BaseLogEntry {
  level: DebugLogLevel;
  message: string;
  details?: string;
}

export interface NetworkLogEntry extends BaseLogEntry {
  direction: NetworkLogDirection;
  event: string;
  details?: string;
  payload?: string;
}

export interface ErrorLogEntry extends BaseLogEntry {
  message: string;
  stack?: string;
  source: ErrorLogSource;
  details?: string;
}

export type ConsoleLogInput = Omit<ConsoleLogEntry, 'id' | 'timestamp'> & Partial<Pick<ConsoleLogEntry, 'timestamp'>>;
export type NetworkLogInput = Omit<NetworkLogEntry, 'id' | 'timestamp'> & Partial<Pick<NetworkLogEntry, 'timestamp'>>;
export type ErrorLogInput = Omit<ErrorLogEntry, 'id' | 'timestamp'> & Partial<Pick<ErrorLogEntry, 'timestamp'>>;

interface DebugLogState {
  consoleEntries: ConsoleLogEntry[];
  networkEntries: NetworkLogEntry[];
  errorEntries: ErrorLogEntry[];
  recordConsoleLog: (entry: ConsoleLogInput) => void;
  recordNetworkLog: (entry: NetworkLogInput) => void;
  recordErrorLog: (entry: ErrorLogInput) => void;
  clearConsole: () => void;
  clearNetwork: () => void;
  clearErrors: () => void;
  clearAll: () => void;
}

const MAX_CONSOLE_ENTRIES = 200;
const MAX_NETWORK_ENTRIES = 200;
const MAX_ERROR_ENTRIES = 200;

function createLogEntryId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function appendWithLimit<T>(entries: T[], entry: T, maxEntries: number): T[] {
  if (entries.length >= maxEntries) {
    const sliceStart = entries.length - maxEntries + 1;
    return [...entries.slice(sliceStart), entry];
  }

  return [...entries, entry];
}

export const useDebugStore = create<DebugLogState>((set) => ({
  consoleEntries: [],
  networkEntries: [],
  errorEntries: [],
  recordConsoleLog: (entry) =>
    set((state) => ({
      consoleEntries: appendWithLimit(
        state.consoleEntries,
        {
          id: createLogEntryId(),
          timestamp: entry.timestamp ?? Date.now(),
          level: entry.level,
          message: entry.message,
          details: entry.details,
        },
        MAX_CONSOLE_ENTRIES,
      ),
    })),
  recordNetworkLog: (entry) =>
    set((state) => ({
      networkEntries: appendWithLimit(
        state.networkEntries,
        {
          id: createLogEntryId(),
          timestamp: entry.timestamp ?? Date.now(),
          direction: entry.direction,
          event: entry.event,
          details: entry.details,
          payload: entry.payload,
        },
        MAX_NETWORK_ENTRIES,
      ),
    })),
  recordErrorLog: (entry) =>
    set((state) => ({
      errorEntries: appendWithLimit(
        state.errorEntries,
        {
          id: createLogEntryId(),
          timestamp: entry.timestamp ?? Date.now(),
          message: entry.message,
          stack: entry.stack,
          source: entry.source,
          details: entry.details,
        },
        MAX_ERROR_ENTRIES,
      ),
    })),
  clearConsole: () => set({ consoleEntries: [] }),
  clearNetwork: () => set({ networkEntries: [] }),
  clearErrors: () => set({ errorEntries: [] }),
  clearAll: () => set({ consoleEntries: [], networkEntries: [], errorEntries: [] }),
}));

export function logConsoleEvent(entry: ConsoleLogInput): void {
  useDebugStore.getState().recordConsoleLog(entry);
}

export function logNetworkEvent(entry: NetworkLogInput): void {
  useDebugStore.getState().recordNetworkLog(entry);
}

export function logErrorEvent(entry: ErrorLogInput): void {
  useDebugStore.getState().recordErrorLog(entry);
}
