# converge.cv - XMTP protocol v3 PWA Development TODO

## Project Overview
Building a Signal-like PWA for XMTP protocol v3 using the current XMTP SDK v5.0.1 — local-first, installable, encrypted.

## Latest Updates (2025-10-29)

## Latest Updates (2025-10-28)

## Follow-ups From Recent Changes
- [ ] Add automated tests covering `storage.clearAllData()` to ensure Dexie + OPFS wipes stay intact.
- [ ] Add integration test for the `canMessage` + inbox ID resolution flow to prevent regressions.
- [ ] Document the XMTP v5 upgrade and new installation management tools in README.

---

## Sprint 1: Foundation & Setup

### Phase 1: Project Initialization ✅

### Phase 2: PWA Infrastructure
- [ ] Install vite-plugin-pwa & configure manifest
- [ ] Create service worker (sw.ts) with Workbox
- [ ] Add PWA icons (192x192, 512x512)
- [ ] Setup app shell caching strategy
- [ ] Test install on mobile/desktop

### Phase 3: Dependencies & Configuration
- [ ] Install core deps: zustand, react-router-dom, dexie
- [ ] Install headless UI components
- [ ] Setup TypeScript paths & aliases
- [ ] Configure Vitest for testing

### Phase 4: Project Structure ✅

---

## Sprint 2: Storage & Crypto Layer ✅

### Phase 5: Storage Driver Interface ✅
- [x] Fix mobile keyboard UX issues (pushing up layout)
- [ ] Add unit tests for new featuresage operations

### Phase 6: Crypto Vault ✅
- [ ] Unit tests for crypto operations

---

## Sprint 3: XMTP Integration ✅

### Phase 7: XMTP Client Wrapper ✅

---

## Sprint 4: Core Features - Auth & Onboarding ✅

### Phase 8: Authentication Flow ✅

---

## Sprint 5: Core Features - Messaging UI ✅

### Phase 9: Chat List ✅

### Phase 10: Conversation View ✅

### Phase 11: New Chat Flow ✅

---

## Sprint 6: Advanced Messaging Features

### Phase 12: Rich Messaging
- [ ] Attachment support (file picker)
- [ ] Attachment storage & encryption
- [ ] Attachment preview & download
- [ ] Message reactions UI
- [ ] Disappearing messages timer
- [ ] Message status (pending/sent/failed)

### Phase 12b: XMTP Content Types — Sending Roadmap
- [x] Reactions (ContentTypeReaction)
  - UX: Long press → modal → quick emoji row; optimistic update to bubble reactions
  - Notes: Inbound reactions currently render as system messages; next step is to aggregate onto target bubble and suppress system line
- [x] Replies (ContentTypeReply, text only)
  - UX: Long press → Reply; composer shows "Replying to …" banner; send as reply with inner text content
  - Notes: Inbound replies currently surface as system messages; next step is to render reply preview/quote and navigate to referenced message
- [x] Read Receipts (ContentTypeReadReceipt)
  - UX: Fire-and-forget when viewing messages; no visible UI yet beyond status placeholders
  - Notes: Map to message.status when SDK exposes delivery/read events consistently
- [ ] Typing Indicators
  - UX: Debounced typing start/stop from composer; show inline "User is typing…"
  - Notes: Confirm official content type availability or recommended approach in v5; add config to disable
- [ ] Attachments (ContentTypeRemoteAttachment)
  - UX: Add paperclip → file picker; show upload progress; inline thumbnail for images
  - Blocker: Requires upload endpoint to host encrypted payload; propose env `VITE_ATTACHMENT_UPLOAD_URL` or Web3.storage integration without placeholder keys
- [ ] Invitations
  - UX: Group invite send via share link is available; consider in-protocol invite content type if/when standardized

### Phase 13: Message Lifecycle
- [ ] Send queue implementation
- [ ] Offline message queuing
- [ ] Retry failed messages
- [ ] Cleanup expired messages
- [ ] Sync cursor per conversation

---

## Sprint 7: Push Notifications & Service Worker

### Phase 14: Web Push Setup ✅
- [ ] Service worker push handler (needs real implementation)
- [ ] VAPID key generation (documented)

### Phase 15: SW Bridge & Background Sync ✅
- [ ] Background sync registration (future)
- [ ] Runtime caching for attachments (Workbox handles basics)

---

## Sprint 8: Settings & Polish

### Phase 16: Settings Screen ✅

### Phase 17: Search ✅

---

## Sprint 9: Testing & Quality

### Phase 18: Unit Tests
- [ ] Storage driver tests
- [ ] Crypto vault tests
- [ ] XMTP wrapper tests
- [ ] Component tests (key UI)

### Phase 19: E2E Tests (Playwright)
- [ ] Onboarding flow test
- [ ] Create conversation test
- [ ] Send/receive message test
- [ ] Offline mode test
- [ ] Lock/unlock test

### Phase 20: Accessibility & Performance
- [ ] Keyboard navigation
- [ ] Screen reader support
- [ ] Focus management
- [ ] Reduced motion support
- [ ] Performance profiling
- [ ] Lighthouse audit

---

## Sprint 10: Documentation & Deploy

### Phase 21: Documentation
- [ ] README.md with setup instructions
- [ ] Architecture documentation
- [ ] API documentation
- [ ] Deployment guide
- [ ] User guide

### Phase 22: CI/CD
- [ ] GitHub Actions workflow
- [ ] TypeScript check
- [ ] Lint & format check
- [ ] Run tests
- [ ] Build & deploy to GitHub Pages

### Phase 23: Final Polish
- [ ] Browser testing (Chrome, Firefox, Safari)
- [ ] Mobile testing (iOS Safari, Android Chrome)
- [ ] PWA install testing
- [ ] Performance optimization
- [ ] Security audit

---

## Things We Don't Know How to Do Cleanly Yet

### Farcaster Contact Sync
- FID resolution from ENS addresses - The API endpoint for resolving Farcaster FIDs from Ethereum addresses via ENS names is unreliable and has unclear error handling
- API endpoint reliability - The `/api/farcaster/user/{identifier}` and `/api/farcaster/following/{fid}` endpoints may fail or return inconsistent data
- Contact merging logic - Merging inbox-only contacts (from incoming messages) with Farcaster-synced contacts requires careful handling of inbox IDs and identity resolution
- Clean UX for sync progress and errors - The sync process involves multiple API calls and ENS lookups that can fail at various stages, making it difficult to provide clear feedback to users

**Note**: The underlying infrastructure (FarcasterSyncModal component, syncFarcasterContacts function, Contact fields) remains in place for future implementation when we have a cleaner approach.

---

## Future Enhancements (Post-MVP)

### SQLite WASM Migration
- [ ] Implement SQLiteDriver (OPFS)
- [ ] Full-text search (FTS5)
- [ ] Schema migration from Dexie
- [ ] Performance benchmarking

### Advanced Features
- [ ] Group chat admin UI
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
