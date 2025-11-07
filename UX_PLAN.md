# Mobile Layout & Keyboard UX Plan

This document details the approach to eliminate the “bottom gap”/page slip and to make keyboard behavior consistent across iOS/Android/desktop, while keeping the bottom navigation stable and the composer usable.

## Goals

- No layout jump or empty gap when entering a conversation or switching routes.
- Bottom navigation remains consistent; doesn’t overlap content.
- Composer stays visible and usable when the keyboard opens; the last message remains readable.
- No content hidden under the keyboard; smooth return when the keyboard closes.

## Root Causes

- `100vh` is unstable on mobile: visible viewport height changes with browser chrome and keyboard, causing jumps (especially iOS Safari).
- Multiple scroll containers (body + inner) allow the browser to apply scroll anchoring in surprising ways.
- Keyboard occlusion isn’t accounted for; bottom bars overlap or leave gaps.
- Safe-area insets and address-bar collapse add inconsistent padding/margins.

## Strategy

- Single scroll container: only the main content scrolls. `html, body` do not scroll.
- Dynamic viewport height: use VisualViewport to drive a `--vh` CSS var and to detect keyboard occlusion (`--keyboard-offset`).
- Sticky bottom nav: kept inside the app shell (not fixed to `body`) so it participates in the dynamic viewport.
- Composer docking: in conversation view, the composer is measured and the message list gets bottom padding equal to `composer height + safe inset (+ nav height when visible)`, so the last message is never obscured.
- Keyboard-aware behavior: when the keyboard opens, slide the bottom nav out of the way; when it closes, bring it back smoothly.

## Implementation

### CSS

- `html, body { height: 100%; overflow: hidden; }`
- `#root { min-height: calc(var(--vh, 1vh) * 100); display: flex; flex-direction: column; }`
- `@supports (height: 100dvh) { #root { min-height: 100dvh; } }`
- Define vars:
  - `--vh` – updated via VisualViewport
  - `--safe-bottom` – `env(safe-area-inset-bottom, 0px)`
- Bottom nav is sticky and respects safe area.
- `.keyboard-open nav { transform: translateY(100%); opacity: 0; pointer-events: none; }` (recommended default)

### VisualViewport Hook

- Listens to `visualViewport.resize`/`visualViewport.scroll` and `window.resize`.
- Sets `--vh` = `visualViewport.height / 100` (fallback to `1vh`).
- Computes `--keyboard-offset` = `max(0, window.innerHeight - visualViewport.height)`.
- Toggles `.keyboard-open` on `#root` when `--keyboard-offset` exceeds a threshold (~80px).

### Layout Structure

- Header (static)
- Main (flex: 1; overflow-y: auto; `overscroll-behavior: contain`)
- Bottom nav (sticky bottom: 0; uses safe-area padding)

### Conversation View

- Measure composer height via `ResizeObserver`.
- Apply `padding-bottom` on the scrollable message list: `calc(composerHeight + var(--safe-bottom))`.
- On composer focus, if user is near the bottom, autoscroll to bottom after the viewport settles.
- On incoming/sent message, autoscroll if near bottom; otherwise, leave scroll position.

## Testing Notes

- Desktop Playwright checks:
  - No extra whitespace: `#root` height ≈ viewport height; bottom nav within viewport.
  - Only main scrolls: body has `overflow: hidden` and `main` has `overflow-y: auto`.
  - Entering a conversation does not increase document height or leave gaps.
- Mobile keyboards are hard to simulate in headless CI; we validate the CSS variables and structure as proxies.

## Acceptance Criteria

- No persistent bottom gap after route changes.
- Bottom nav and composer never overlap or float incorrectly when the keyboard opens.
- Last message is readable with the composer open; autoscroll works when appropriate.

