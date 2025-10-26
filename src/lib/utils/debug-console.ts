/**
 * Debug console helpers for capturing console output into the debug store.
 */

import { useDebugStore, type DebugLogLevel } from '@/lib/stores';

let consolePatched = false;

function formatValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (
    value instanceof Error &&
    typeof value.stack === 'string' &&
    value.stack.length > 0
  ) {
    return value.stack;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function addEntry(level: DebugLogLevel, args: unknown[]): void {
  const [message, ...rest] = args;
  const entryMessage = formatValue(message);
  const details = rest.length > 0 ? rest.map(formatValue).join('\n') : undefined;

  const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  useDebugStore.getState().addEntry({
    id,
    level,
    message: entryMessage,
    details,
    timestamp: Date.now(),
  });
}

export function setupDebugConsole(): void {
  if (consolePatched) {
    return;
  }

  const original = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
  };

  const wrap = (level: DebugLogLevel, fn: (...args: unknown[]) => void) =>
    (...args: unknown[]) => {
      fn(...args);
      try {
        addEntry(level, args);
      } catch (error) {
        original.error('Failed to record debug log entry:', error);
      }
    };

  console.log = wrap('log', original.log);
  console.info = wrap('info', original.info);
  console.warn = wrap('warn', original.warn);
  console.error = wrap('error', original.error);

  consolePatched = true;
}
