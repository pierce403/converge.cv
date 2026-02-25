import { useEffect } from 'react';

const KEYBOARD_OFFSET_THRESHOLD_PX = 80;
const KEYBOARD_BASELINE_FALLBACK_PX = 40;
const NON_TEXT_INPUT_TYPES = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'hidden',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
]);

function isTextInputElement(element: Element | null): boolean {
  if (!(element instanceof HTMLElement)) {
    return false;
  }
  if (element.isContentEditable) {
    return true;
  }
  if (element instanceof HTMLTextAreaElement) {
    return !element.readOnly && !element.disabled;
  }
  if (element instanceof HTMLInputElement) {
    if (element.readOnly || element.disabled) {
      return false;
    }
    const type = (element.type || 'text').toLowerCase();
    return !NON_TEXT_INPUT_TYPES.has(type);
  }
  return false;
}

/**
 * Sync CSS viewport variables with the real visual viewport and
 * toggle a keyboard-open class when the keyboard is likely visible.
 */
export function useVisualViewport(): void {
  useEffect(() => {
    const root = document.getElementById('root') || document.documentElement;
    const vv = (window as unknown as { visualViewport?: VisualViewport }).visualViewport;
    let baselineHeight = vv?.height ?? window.innerHeight;

    const apply = () => {
      const height = vv?.height ?? window.innerHeight;
      const hasFocusedTextInput = isTextInputElement(document.activeElement);

      if (!hasFocusedTextInput) {
        // Track the last stable viewport height while keyboard is not active.
        baselineHeight = height;
      }

      const vh = height / 100;
      root.style.setProperty('--vh', `${vh}px`);

      const windowOffset = Math.max(0, window.innerHeight - height);
      const baselineOffset = Math.max(0, baselineHeight - height);
      const keyboardOffset = Math.max(windowOffset, baselineOffset);

      const keyboardOpen =
        keyboardOffset > KEYBOARD_OFFSET_THRESHOLD_PX ||
        (hasFocusedTextInput && baselineOffset > KEYBOARD_BASELINE_FALLBACK_PX);

      root.style.setProperty('--keyboard-offset', `${keyboardOffset}px`);
      if (keyboardOpen) {
        root.classList.add('keyboard-open');
      } else {
        root.classList.remove('keyboard-open');
      }
    };

    apply();
    vv?.addEventListener('resize', apply);
    vv?.addEventListener('scroll', apply);
    window.addEventListener('resize', apply);
    document.addEventListener('focusin', apply);
    document.addEventListener('focusout', apply);
    return () => {
      vv?.removeEventListener('resize', apply);
      vv?.removeEventListener('scroll', apply);
      window.removeEventListener('resize', apply);
      document.removeEventListener('focusin', apply);
      document.removeEventListener('focusout', apply);
      root.classList.remove('keyboard-open');
      root.style.setProperty('--keyboard-offset', '0px');
    };
  }, []);
}
