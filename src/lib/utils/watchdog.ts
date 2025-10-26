/**
 * Lightweight event loop watchdog that attempts to recover from long stalls by reloading the app.
 *
 * PWAs are expected to stay responsive; when the UI thread is blocked for an extended period the
 * experience effectively "hangs". Because service workers and the app shell persist between
 * sessions, a forced reload is the most practical "hard reset" available in the browser.
 */

import { useDebugStore } from '@/lib/stores';

type Cleanup = () => void;

interface WatchdogOptions {
  /** Milliseconds the UI thread can stall before triggering recovery. */
  thresholdMs?: number;
  /** How often (in ms) the watchdog checks for a stall. */
  checkIntervalMs?: number;
  /** Optional callback fired before the default reload recovery runs. */
  onHangDetected?: (gapMs: number) => void;
}

let stopWatchdog: Cleanup | undefined;

function logWatchdogEvent(message: string, details?: string) {
  try {
    const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

    useDebugStore.getState().addEntry({
      id,
      level: 'error',
      message,
      details,
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error('Failed to record watchdog event', error);
  }
}

export function startAppWatchdog(options: WatchdogOptions = {}): Cleanup | undefined {
  if (typeof window === 'undefined' || stopWatchdog) {
    return stopWatchdog;
  }

  const { thresholdMs = 10_000, checkIntervalMs = 2_000, onHangDetected } = options;

  let rafId: number | undefined;
  let lastTick = performance.now();
  let recovering = false;

  const resetTick = () => {
    lastTick = performance.now();
  };

  const rafLoop = () => {
    resetTick();
    rafId = window.requestAnimationFrame(rafLoop);
  };

  rafId = window.requestAnimationFrame(rafLoop);

  const handleHang = (gapMs: number) => {
    if (recovering) {
      return;
    }

    recovering = true;

    logWatchdogEvent(
      `Watchdog detected a ${Math.round(gapMs)}ms UI stall`,
      'Reloading app shell to restore responsiveness.',
    );

    try {
      onHangDetected?.(gapMs);
    } catch (error) {
      console.error('Watchdog onHangDetected handler failed', error);
    }

    // Reload after the current tick so the log entry is persisted in the debug store.
    window.setTimeout(() => {
      window.location.reload();
    }, 0);
  };

  const checkForHang = () => {
    if (document.visibilityState !== 'visible') {
      resetTick();
      return;
    }

    const now = performance.now();
    const gap = now - lastTick;

    if (gap > thresholdMs) {
      handleHang(gap);
    }
  };

  const intervalId = window.setInterval(checkForHang, checkIntervalMs);

  const visibilityListener = () => {
    if (document.visibilityState === 'visible') {
      resetTick();
    }
  };

  document.addEventListener('visibilitychange', visibilityListener);

  stopWatchdog = () => {
    if (rafId !== undefined) {
      window.cancelAnimationFrame(rafId);
    }
    window.clearInterval(intervalId);
    document.removeEventListener('visibilitychange', visibilityListener);
    stopWatchdog = undefined;
  };

  return stopWatchdog;
}
