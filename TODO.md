# converge.cv — TODO

**Last updated**: 2025-12-12

This file is a living backlog. The old “Sprint/Phase” roadmap from early development is now out of date; use git history if you need to recover it.

## Project Overview

- Signal-like, local-first PWA for **XMTP protocol v3**
- Current SDK: `@xmtp/browser-sdk` **v5.0.1**
- UI: React 18 + Vite + Tailwind
- State: Zustand
- Storage: Dexie (IndexedDB) + XMTP OPFS database

## What Changed Since TODO.md Was Last Updated (2025-11-22)

High-level themes pulled from `git log` since commit `e6de012` (2025-11-22).

### 2025-12-12

- Added developer docs directory + index.
- Added detailed docs for **contact management** and **conversation management**.
- Fixed Neynar verification lookup parsing (bulk-by-address response variants).

### 2025-12-11

- Hardened “clear data / resync” flows (close storage before wipes; reload-trigger pattern).
- Improved contact refresh correctness (Farcaster/ENS/XMTP precedence, offline-friendly refresh, persist Farcaster fields).
- Updated `FEATURES.md` (Unified Contact Card details).

### 2025-12-09

- Major Farcaster sync improvements (Neynar integration, FID resolution, better UI/error reporting).
- Wallet reconnect UX improvements (show wallet chooser when provider missing; reconnect button in settings).
- Testing improvements (broader unit coverage, E2E test stabilization).
- XMTP stability fixes (prevent inbox-id derivation hangs; fix DM creation identity confusion).

### 2025-11-26 → 2025-11-30

- Added inbox switching UX improvements (status banner, toasts) and fixed per-namespace persistence.
- Added Web Push notifications via `vapid.party` + Debug page controls.
- More robust profile loading + identifier normalization.

## Top Priorities (P0)

- [ ] **Encrypt private keys at rest in IndexedDB** (device-based; keep no-passphrase default).
- [ ] **Fix conversation mute semantics** so muting doesn’t drop inbound messages.
  - See gotcha in `docs/conversations.md`.
- [ ] **Fix persisted previews for system messages** (`DexieDriver.putMessage` treats non-text as attachments).
  - See gotcha in `docs/conversations.md`.
- [ ] Add automated tests for `storage.clearAllData()` (Dexie + OPFS wipes) and the “Resync All” flow.
- [ ] Clean up / reconcile service worker approach:
  - [ ] Decide whether to keep minimal `public/sw.js` (push-only) vs re-enable `vite-plugin-pwa`/Workbox.
  - [ ] If re-enabling full PWA caching, ensure we **don’t promise “offline messaging”** in UI copy.

## Messaging Roadmap

### Attachments (ContentTypeRemoteAttachment)

- [ ] Decide on upload backend (must use real creds; no placeholders).
- [ ] UI: file picker → upload progress → inline preview (images) → download.
- [ ] Storage: store attachment metadata + encrypted bytes/refs (Dexie `attachments` + `attachmentData`).

### Message lifecycle / UX

- [ ] Typing indicators.
- [ ] Disappearing messages (timer + local cleanup).
- [ ] Delivery/read state UX (map receipts to visible status where it helps).

## Conversations

- [ ] Add “Archived conversations” view or stop hiding archived items.
- [ ] Revisit conversation deletion vs ignore markers:
  - [ ] “Delete locally” vs “Ignore forever” should likely be separate actions.

## Groups

- [ ] Improve group chat UX beyond basic functionality:
  - [ ] Group settings polish (members/admins list, promote/demote, add/remove).
  - [ ] Permission policy editor (policyType/policySet).
  - [ ] Leave group flow and “disband” flow (super admin).

## Farcaster / Contacts

- [ ] Add verified default bot contacts (keep `src/lib/default-contacts.ts` empty until we have real XMTP-enabled addresses).
- [x] ENS enrichment:
  - [x] `.fcast.id` lookups via Neynar verification + caching (`resolveFcastId`)
  - [x] `.base.eth` lookups as a filtered reverse-ENS (`resolveBaseEthName`)
- [x] Farcaster sync hardening:
  - [x] Rate limiting/backoff for Neynar + RPC calls (Vitest-safe delays)
  - [x] Bulk Neynar profile enrichment for large following lists (`fetchNeynarUsersBulk`)

## Push Notifications

- [ ] Decide push architecture for “real” messaging notifications.
  - Current `vapid.party` integration can register + subscribe, but fully reliable messaging push usually needs a server/relay.
- [ ] Notification routing: deep link to the right conversation and handle focus/reuse.

## Testing & Quality

- [ ] Add unit test coverage for the StorageDriver “conversation + message” primitives.
- [ ] Add unit/integration tests for inbox-id resolution + `canMessage` regression prevention.
- [ ] Playwright E2E:
  - [ ] Onboarding flow
  - [ ] Create DM
  - [ ] Send message in E2E mode (stub)
  - [ ] Inbox switching

## Documentation

- [ ] Update root `README.md` with:
  - [ ] XMTP v5 upgrade notes + installation management UX
  - [ ] Push notifications (vapid.party)
  - [ ] Docs index (`docs/`)
- [ ] Keep `FEATURES.md` updated as shipped UX changes.

## Future / Stretch

- [ ] SQLite WASM migration (OPFS)
- [ ] Full-text search (FTS5)
- [ ] Performance profiling / Lighthouse
- [ ] Accessibility audit
- [ ] Voice messages
- [ ] Video attachments
- [ ] Link previews
- [ ] Message forwarding
- [ ] Multi-device sync

## Contact List & Group Chats

---

## Deployment Info
- **Domain**: converge.cv
- **Hosting**: GitHub Pages
- **Repo**: git@github.com:pierce403/converge.cv.git

---

## Tech Stack Reference
- **Framework**: React + TypeScript + Vite
- **Routing**: react-router-dom
- **State**: Zustand
- **Styling**: Tailwind CSS + Headless UI
- **PWA**: vite-plugin-pwa (Workbox)
- **Messaging**: XMTP v5 browser SDK
- **Storage**: Dexie (IndexedDB) → SQLite WASM (future)
- **Crypto**: WebCrypto (AES-GCM), WebAuthn
- **Testing**: Vitest + Playwright

---

**Last Updated**: 2025-10-29
**Status**: ✅ MVP v0.1.0 COMPLETE (XMTP v5 upgrade landed)

---

## Current State Snapshot (2025-10-29)

**Authentication & Identity**
- One-click onboarding auto-generates an XMTP-ready wallet and registers on the production network.
- Optional wallet connection flows via wagmi v2 (MetaMask, Coinbase Wallet, WalletConnect, injected).
- Vault stays unlocked by default; manual lock/logout lives in Settings.
- `Clear All Data` now wipes Dexie tables and XMTP OPFS databases.

**Messaging**
- XMTP v5.0.1 client streams conversations/messages in real time (send/receive ✅).
- Default contacts seed new inboxes; debug tab surfaces logs/state snapshots.
- New DM creation uses `newDmWithIdentifier` for Ethereum addresses; no pre‑check gate. SDK performs inbox lookup internally.

**Settings & Device Management**
- Installations panel lists all devices, fetches key package statuses, and supports per-device revoke.
- Watchdog detects UI thread stalls and reloads the PWA automatically.
- Debug console tab aggregates console, XMTP events, and runtime errors.

**PWA & Platform**
- Service worker + Workbox configured (install/update prompts currently disabled for debugging).
- COOP/COEP headers injected via the service worker to enable SharedArrayBuffer isolation.
- Vite build patched to bundle XMTP wasm worker assets after `pnpm install`.
- Web Workers debug panel lists active workers and allows SW management.

**Known Gaps**
- Delivery state UI, retries, and offline send queue.
- Device-level key encryption (private keys currently plaintext in IndexedDB).
- Multi-identity UI/IndexedDB schema, attachments, group chat support.
- Re-enable install/update prompts and document XMTP v5 changes in README.

**Key Management Limitations**
- Wiping local session or MLS keys for specific conversations currently only deletes Dexie records; the XMTP client will resync
  keys from the network on the next connection. A more robust per-conversation key eviction flow likely requires upstream
  support for remote key/package revocation or finer-grained sync controls, which we should revisit if the SDK exposes these
  hooks in the future.

---

## Current Sprint: Identity & Wallet Management (2025-10-28)

### Identity Manager in Settings
- [ ] Create IdentityManager component
- [ ] List all stored identities with address, inbox ID, installation ID
- [ ] Add "Switch Identity" functionality
- [ ] Add "Remove Identity" for each identity
- [ ] Show current active identity with badge

### Multi-Identity Support
- [ ] Update IndexedDB schema to support multiple identities
- [ ] Add identity list to auth store
- [ ] Implement identity switching logic
- [ ] Handle XMTP client reconnection on identity switch
- [ ] Persist active identity selection

### Enhanced Installations Table  
- [ ] Add "Revoke All Other Installations" button
- [ ] Replace browser `confirm`/`alert` flows with in-app modals
- [ ] Implement auto-reconnect flow after revoking the current device

---

## Documentation & References
- [ ] Update README to reference the new debug Web Workers panel and installations tools.
- [ ] Add a short guide for `check_deploy.sh` usage in DEPLOYMENT.md.

## Testing Follow-ups
- [ ] Unit test: Utils-based inbox state fetch when disconnected (timeouts, errors).
- [ ] Integration test: New DM creation and first message send using `newDmWithIdentifier`.
- [ ] E2E: Clear All Data performs wallet disconnect, client close, DB + cache wipe, and reload.
