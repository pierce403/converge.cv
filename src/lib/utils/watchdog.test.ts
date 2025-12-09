import { afterEach, describe, expect, it, vi } from 'vitest';
import { startAppWatchdog } from './watchdog';
import { logErrorEvent } from '@/lib/stores';

vi.mock('@/lib/stores', () => ({
  logErrorEvent: vi.fn(),
}));

const originalClearInterval = globalThis.clearInterval;

describe('watchdog', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    // ensure global timers remain intact after stubbing
    globalThis.clearInterval = originalClearInterval;
  });

  it('detects hang and triggers reload + callback', () => {
    vi.useFakeTimers();
    const reload = vi.fn();
    const raf = vi.fn(() => 1 as unknown as number); // don't recurse
    const cancelRaf = vi.fn();
    const now = vi
      .fn()
      .mockReturnValueOnce(0) // initial call inside startAppWatchdog
      .mockReturnValue(20_000); // later gap for hang detection
    (globalThis as any).performance.now = now;
    (globalThis as any).window.requestAnimationFrame = raf as any;
    (globalThis as any).window.cancelAnimationFrame = cancelRaf as any;
    (globalThis as any).window.setTimeout = vi.fn((cb) => {
      cb();
      return 1;
    }) as any;

    let intervalCb: () => void = () => {};
    (globalThis as any).window.setInterval = vi.fn((cb) => {
      intervalCb = cb;
      // trigger immediately
      cb();
      return 1;
    }) as any;
    (globalThis as any).window.clearInterval = vi.fn();
    (globalThis as any).document = {
      visibilityState: 'visible',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as any;
    (globalThis as any).window.location = { reload } as any;

    const onHangDetected = vi.fn();
    const stop = startAppWatchdog({ thresholdMs: 5_000, checkIntervalMs: 10_000, onHangDetected });
    expect(onHangDetected).toHaveBeenCalled();
    expect(reload).toHaveBeenCalled();
    expect(logErrorEvent).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'watchdog' })
    );

    stop?.();
    expect(cancelRaf).toHaveBeenCalled();
  });
});
