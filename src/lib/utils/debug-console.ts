/**
 * Debug console helpers for capturing console output into the debug store.
 */

import {
  logConsoleEvent,
  logErrorEvent,
  type DebugLogLevel,
  type ErrorLogSource,
} from '@/lib/stores';

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

function findErrorLike(args: unknown[]): { message?: string; stack?: string } | null {
  for (const value of args) {
    if (value instanceof Error) {
      return { message: value.message, stack: value.stack ?? undefined };
    }

    if (typeof value === 'object' && value && 'stack' in value && typeof (value as { stack: unknown }).stack === 'string') {
      const stack = (value as { stack: unknown }).stack as string;
      const message = 'message' in (value as { message?: unknown }) && typeof (value as { message?: unknown }).message === 'string'
        ? ((value as { message?: unknown }).message as string)
        : undefined;
      return { message, stack };
    }
  }

  return null;
}

function recordConsoleEntry(level: DebugLogLevel, args: unknown[]): void {
  const [message, ...rest] = args;
  const entryMessage = formatValue(message);
  const details = rest.length > 0 ? rest.map(formatValue).join('\n') : undefined;

  logConsoleEvent({
    level,
    message: entryMessage,
    details,
  });

  if (level === 'error') {
    const errorInfo = findErrorLike(args);
    const errorMessage = errorInfo?.message || (typeof message === 'string' ? message : entryMessage);
    const stack = errorInfo?.stack || (message instanceof Error ? message.stack : undefined);

    logErrorEvent({
      source: 'console',
      message: errorMessage,
      stack,
      details,
    });
  }
}

function handleRuntimeError(message: string, source: ErrorLogSource, stack?: string, details?: string): void {
  logErrorEvent({
    source,
    message,
    stack,
    details,
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
        recordConsoleEntry(level, args);
      } catch (error) {
        original.error('Failed to record debug log entry:', error);
      }
    };

  console.log = wrap('log', original.log);
  console.info = wrap('info', original.info);
  console.warn = wrap('warn', original.warn);
  console.error = wrap('error', original.error);

  if (typeof window !== 'undefined') {
    window.addEventListener('error', (event) => {
      try {
        // Skip noisy worker errors with no useful info
        if (event.message === 'Script error.' && !event.filename) {
          return;
        }
        
        const message = event.message || 'Runtime error';
        const stack = event.error instanceof Error ? event.error.stack : undefined;
        const details = [event.filename, event.lineno, event.colno]
          .filter((part) => part !== undefined && part !== null && part !== 0)
          .join(':');

        handleRuntimeError(message, 'runtime', stack, details || undefined);
      } catch (error) {
        original.error('Failed to record runtime error', error);
      }
    });

    window.addEventListener('unhandledrejection', (event) => {
      try {
        const reason = event.reason;
        const stack = reason instanceof Error ? reason.stack : undefined;
        const message = reason instanceof Error
          ? reason.message
          : typeof reason === 'string'
            ? reason
            : 'Unhandled promise rejection';
        const details = typeof reason === 'object' && reason && reason !== null && !(reason instanceof Error)
          ? formatValue(reason)
          : undefined;

        handleRuntimeError(message, 'unhandled-rejection', stack, details);
      } catch (error) {
        original.error('Failed to record unhandled rejection', error);
      }
    });
  }

  consolePatched = true;
}
