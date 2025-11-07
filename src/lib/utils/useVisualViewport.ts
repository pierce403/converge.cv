import { useEffect } from 'react';

/**
 * Sync CSS viewport variables with the real visual viewport and
 * toggle a keyboard-open class when the keyboard is likely visible.
 */
export function useVisualViewport(): void {
  useEffect(() => {
    const root = document.getElementById('root') || document.documentElement;
    const vv = (window as unknown as { visualViewport?: VisualViewport }).visualViewport;

    const apply = () => {
      const height = vv?.height ?? window.innerHeight;
      const vh = height / 100;
      root.style.setProperty('--vh', `${vh}px`);

      const keyboardOffset = Math.max(0, window.innerHeight - height);
      root.style.setProperty('--keyboard-offset', `${keyboardOffset}px`);
      if (keyboardOffset > 80) {
        root.classList.add('keyboard-open');
      } else {
        root.classList.remove('keyboard-open');
      }
    };

    apply();
    vv?.addEventListener('resize', apply);
    vv?.addEventListener('scroll', apply);
    window.addEventListener('resize', apply);
    return () => {
      vv?.removeEventListener('resize', apply);
      vv?.removeEventListener('scroll', apply);
      window.removeEventListener('resize', apply);
    };
  }, []);
}
