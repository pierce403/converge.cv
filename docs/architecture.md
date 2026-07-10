# Architecture

The canonical architecture and decision tracker now lives at [`../ARCHITECTURE.md`](../ARCHITECTURE.md).

Converge.cv is a Signal-like, local-first Progressive Web App built on XMTP protocol v3 (using `@xmtp/browser-sdk` 6.1.2).

## High-level components

- **UI**: React 18 + TypeScript + Vite + Tailwind CSS
- **State**: Zustand stores under `src/lib/stores/`
- **Storage**: Dexie (IndexedDB) under `src/lib/storage/`
- **Messaging**: XMTP client wrapper under `src/lib/xmtp/`
- **Features**: feature modules under `src/features/`

## Key product principles

- **Friction-free onboarding** (true first run creates an inbox, then opens the dismissible profile editor; no passphrase or wallet prompt)
- **Inbox-based account switching** (one profile row per inbox, one connected inbox at a time, isolated local namespaces)
- **Wallets as optional authority** (wallet approval joins/recover/administers an existing inbox; normal messaging uses the local Converge key)
- **Local-first** (data persists on-device via IndexedDB)
- **Honest local security** (browser data is unencrypted at rest; incomplete lock/passphrase/passkey controls stay hidden)
- **Experimental app-level push** (one browser toggle and per-inbox routing/activity state; live relay delivery remains unverified)

Burn Inbox is a selected-inbox Settings action. It closes the client, attempts
static installation revocation, and wipes the complete local inbox namespace
regardless of remote revocation success. A blocked local deletion preserves the
key and registry row for retry; a successful final-inbox wipe preserves an
intentional empty state.

## Where to look

- **Deep dive / current decisions**: [`../AGENTS.md`](../AGENTS.md)
- **Canonical architecture tracker**: [`../ARCHITECTURE.md`](../ARCHITECTURE.md)
- **Technical context**: [`../AGENTS.md`](../AGENTS.md) and [`../README.md`](../README.md)
- **User-facing behavior**: [`../FEATURES.md`](../FEATURES.md)
