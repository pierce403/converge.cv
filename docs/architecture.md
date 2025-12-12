# Architecture

Converge.cv is a Signal-like, local-first Progressive Web App built on XMTP protocol v3 (using `@xmtp/browser-sdk` v5.x).

## High-level components

- **UI**: React 18 + TypeScript + Vite + Tailwind CSS
- **State**: Zustand stores under `src/lib/stores/`
- **Storage**: Dexie (IndexedDB) under `src/lib/storage/`
- **Messaging**: XMTP client wrapper under `src/lib/xmtp/`
- **Features**: feature modules under `src/features/`

## Key product principles

- **Friction-free onboarding** (no passphrase by default, no manual wallet entry)
- **Local-first** (data persists on-device via IndexedDB)
- **Optional security** (lock/vault features exist but should not block onboarding by default)

## Where to look

- **Deep dive / current decisions**: [`../AGENTS.md`](../AGENTS.md)
- **Technical overview**: [`../PROJECT_SUMMARY.md`](../PROJECT_SUMMARY.md)
- **User-facing behavior**: [`../FEATURES.md`](../FEATURES.md)

