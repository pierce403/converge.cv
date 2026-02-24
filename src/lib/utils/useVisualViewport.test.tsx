import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { useVisualViewport } from './useVisualViewport';

type MockVisualViewport = {
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  setHeight: (nextHeight: number) => void;
  emit: (event: 'resize' | 'scroll') => void;
  readonly height: number;
};

function createMockVisualViewport(initialHeight: number): MockVisualViewport {
  let height = initialHeight;
  const listeners: Record<'resize' | 'scroll', Set<() => void>> = {
    resize: new Set(),
    scroll: new Set(),
  };

  const viewport = {
    get height() {
      return height;
    },
    addEventListener: vi.fn((event: string, callback: EventListenerOrEventListenerObject) => {
      if ((event === 'resize' || event === 'scroll') && typeof callback === 'function') {
        listeners[event].add(callback as () => void);
      }
    }),
    removeEventListener: vi.fn((event: string, callback: EventListenerOrEventListenerObject) => {
      if ((event === 'resize' || event === 'scroll') && typeof callback === 'function') {
        listeners[event].delete(callback as () => void);
      }
    }),
    setHeight(nextHeight: number) {
      height = nextHeight;
    },
    emit(event: 'resize' | 'scroll') {
      listeners[event].forEach((listener) => listener());
    },
  };

  Object.defineProperty(window, 'visualViewport', {
    configurable: true,
    value: viewport,
  });

  return viewport;
}

function HookHarness() {
  useVisualViewport();
  return <div data-testid="hook-harness" />;
}

describe('useVisualViewport', () => {
  afterEach(() => {
    delete (window as unknown as { visualViewport?: VisualViewport }).visualViewport;
    document.getElementById('root')?.remove();
    vi.restoreAllMocks();
  });

  it('sets --vh using visualViewport height', () => {
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      writable: true,
      value: 900,
    });
    createMockVisualViewport(600);

    const root = document.createElement('div');
    root.id = 'root';
    document.body.appendChild(root);

    render(<HookHarness />, { container: root });

    expect(parseFloat(root.style.getPropertyValue('--vh'))).toBe(6);
  });

  it('toggles keyboard-open class based on keyboard offset threshold', () => {
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      writable: true,
      value: 900,
    });
    const viewport = createMockVisualViewport(900);

    const root = document.createElement('div');
    root.id = 'root';
    document.body.appendChild(root);

    render(<HookHarness />, { container: root });

    expect(root.classList.contains('keyboard-open')).toBe(false);

    viewport.setHeight(760); // offset 140 > 80 threshold
    viewport.emit('resize');
    expect(root.classList.contains('keyboard-open')).toBe(true);

    viewport.setHeight(860); // offset 40 <= 80 threshold
    viewport.emit('scroll');
    expect(root.classList.contains('keyboard-open')).toBe(false);
  });

  it('cleans up listeners and keyboard class on unmount', () => {
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      writable: true,
      value: 900,
    });
    const viewport = createMockVisualViewport(760); // keyboard-open initially true
    const removeWindowListenerSpy = vi.spyOn(window, 'removeEventListener');

    const root = document.createElement('div');
    root.id = 'root';
    document.body.appendChild(root);

    const { unmount } = render(<HookHarness />, { container: root });
    expect(root.classList.contains('keyboard-open')).toBe(true);

    unmount();

    expect(viewport.removeEventListener).toHaveBeenCalledWith('resize', expect.any(Function));
    expect(viewport.removeEventListener).toHaveBeenCalledWith('scroll', expect.any(Function));
    expect(removeWindowListenerSpy).toHaveBeenCalledWith('resize', expect.any(Function));
    expect(root.classList.contains('keyboard-open')).toBe(false);
    expect(root.style.getPropertyValue('--keyboard-offset')).toBe('0px');
  });
});
