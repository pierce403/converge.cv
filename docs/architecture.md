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

- **Choice-first onboarding** (show Create, Restore, and Connect external wallet before any identity or wallet action; successful creation then opens the dismissible profile editor)
- **Inbox-based account switching** (one profile row per inbox, one connected inbox at a time, isolated local namespaces)
- **Direct external-wallet identity** (the wallet address itself is the XMTP account identity; approval registers this browser installation and routine messaging reopens signer-less)
- **Local-first** (data persists on-device via IndexedDB)
- **Honest local security** (browser data is unencrypted at rest; incomplete lock/passphrase/passkey controls stay hidden)
- **Experimental app-level push** (one browser toggle and per-inbox routing/activity state; the Cloudflare relay is deployed and tested, while live-stream gaps and mobile reliability remain explicit limitations)

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
