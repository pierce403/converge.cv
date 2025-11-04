# converge.cv - XMTP v3 PWA Development TODO

## Project Overview
Building a Signal-like PWA for XMTP v5 messaging - local-first, installable, encrypted.

## Latest Updates (2025-10-29)
- [x] Direct DM creation via identifier: removed `canMessage` gate and now call `conversations.newDmWithIdentifier({ identifier, identifierKind: 'Ethereum' })` for addresses; preserves `0x`/checksum and fixes `invalid hexadecimal digit: "x"` errors.
- [x] Outgoing messages: fetch conversation by id before `send` and retry after a `conversations.sync()` if needed; sending now works for newly created DMs.
- [x] First‑connect sync: run `conversations.sync()`, `conversations.syncAll()`, and a history backfill pass before starting `streamAllMessages()` so prior messages appear on first load.
- [x] Installations: added Force Network Refresh + Fetch Statuses actions, fetch via `client.preferences.inboxState(true)` when connected and via `Utils` when not; added timeouts and improved types.
- [x] Clear All Data expanded: disconnect wagmi wallet, close XMTP client, clear Dexie tables and XMTP OPFS DBs, purge SW caches, then hard reload.
- [x] Debug: new Web Workers panel with live worker tracking and Service Worker management; initialized worker tracker early and resolved TS typings.
- [x] Telemetry: disabled structured/perf/debug telemetry and reduced logging level for production client options.
- [x] Scripts: added `check_deploy.sh` to watch GitHub Pages deployments with `gh`.
- [x] Misc: refreshed theme palette and cleaned up lints/unused assets; dynamic SDK version shown in logs.

## Latest Updates (2025-10-28)
- [x] Upgraded `@xmtp/browser-sdk` to 5.0.1 and aligned signer implementations with xmtp.chat.
- [x] Fixed `canMessage` to resolve inbox IDs for Ethereum addresses on first attempt.
- [x] Added `storage.clearAllData()` to wipe IndexedDB and XMTP OPFS databases during logout/reset.
- [x] Improved XMTP installations management UI with key package status visuals and better error handling.
- [x] Cleaned up unused assets and variables.

## Follow-ups From Recent Changes
- [ ] Add automated tests covering `storage.clearAllData()` to ensure Dexie + OPFS wipes stay intact.
- [ ] Add integration test for the `canMessage` + inbox ID resolution flow to prevent regressions.
- [ ] Document the XMTP v5 upgrade and new installation management tools in README.

---

## Sprint 1: Foundation & Setup

### Phase 1: Project Initialization ✅
- [x] Initialize git repository
- [x] Create TODO.md for tracking
- [x] Scaffold Vite + React + TypeScript project
- [x] Configure Tailwind CSS
- [x] Setup ESLint & Prettier
- [x] Install dependencies
- [x] Initial commit

### Phase 2: PWA Infrastructure
- [ ] Install vite-plugin-pwa & configure manifest
- [ ] Create service worker (sw.ts) with Workbox
- [ ] Add PWA icons (192x192, 512x512)
- [ ] Setup app shell caching strategy
- [ ] Test install on mobile/desktop

### Phase 3: Dependencies & Configuration
- [ ] Install core deps: zustand, react-router-dom, dexie
- [x] Install XMTP v5 SDK (@xmtp/*)
- [ ] Install headless UI components
- [ ] Setup TypeScript paths & aliases
- [ ] Configure Vitest for testing

### Phase 4: Project Structure ✅
- [x] Create folder structure (/app, /features, /lib, /components, /types)
- [x] Setup routing with react-router-dom
- [x] Create app shell & providers
- [x] Setup Zustand store structure
- [x] Create basic Layout and navigation
- [x] Add placeholder pages
- [x] Setup GitHub Actions CI/CD

---

## Sprint 2: Storage & Crypto Layer ✅

### Phase 5: Storage Driver Interface ✅
- [x] Design StorageDriver interface
- [x] Implement DexieDriver with schema
- [x] Create DB models (conversations, messages, attachments, secrets)
- [x] Add indexes for queries
- [ ] Unit tests for storage operations

### Phase 6: Crypto Vault ✅
- [x] Implement vault key generation (AES-GCM)
- [x] WebAuthn/Passkey integration (PRF extension) - prepared
- [x] Passphrase fallback (PBKDF2/Argon2)
- [x] Encrypt/decrypt at-rest data helpers
- [x] Key wrapping/unwrapping logic
- [ ] Unit tests for crypto operations

---

## Sprint 3: XMTP Integration ✅

### Phase 7: XMTP Client Wrapper ✅
- [x] Create XmtpClient class wrapper
- [x] Implement connect() with identity (baseline)
- [x] Implement streamMessages() listener (baseline)
- [x] Implement send() functionality (baseline)
- [x] List conversations helper (baseline)
- [x] Error mapping & normalization
- [x] Local XMTP harness for testing (placeholder ready for real SDK)

---

## Sprint 4: Core Features - Auth & Onboarding ✅

### Phase 8: Authentication Flow ✅
- [x] Onboarding screen UI
- [x] Wallet connection flow (basic)
- [x] Create/restore identity
- [x] Lock screen component
- [x] Unlock vault flow (passkey/passphrase)
- [x] Auth state management (Zustand)
- [x] useAuth hook with all methods

---

## Sprint 5: Core Features - Messaging UI ✅

### Phase 9: Chat List ✅
- [x] ChatList component with sorting
- [x] ChatItem component (preview, timestamp, unread badge)
- [x] Pinned conversations display
- [x] Archived conversations (backend support)
- [x] Empty state with call-to-action
- [x] useConversations hook

### Phase 10: Conversation View ✅
- [x] Conversation screen layout with header
- [x] MessageBubble component (sent/received styles)
- [x] Message composer with auto-resize
- [x] Message status indicators
- [x] Reactions display
- [x] Empty state
- [x] useMessages hook

### Phase 11: New Chat Flow ✅
- [x] New chat screen
- [x] Address/handle input with validation
- [x] Contact validation via XMTP
- [x] Start conversation action
- [x] Navigation to new conversation

---

## Sprint 6: Advanced Messaging Features

### Phase 12: Rich Messaging
- [ ] Attachment support (file picker)
- [ ] Attachment storage & encryption
- [ ] Attachment preview & download
- [ ] Message reactions UI
- [ ] Disappearing messages timer
- [ ] Message status (pending/sent/failed)

### Phase 13: Message Lifecycle
- [ ] Send queue implementation
- [ ] Offline message queuing
- [ ] Retry failed messages
- [ ] Cleanup expired messages
- [ ] Sync cursor per conversation

---

## Sprint 7: Push Notifications & Service Worker

### Phase 14: Web Push Setup ✅
- [x] Push subscription utilities
- [x] Push notification permissions
- [x] Badge update functionality
- [x] Push preferences storage
- [x] Enable/disable push notifications
- [ ] Service worker push handler (needs real implementation)
- [ ] VAPID key generation (documented)

### Phase 15: SW Bridge & Background Sync ✅
- [x] PostMessage channel (app ↔ SW)
- [x] Service worker messaging interface
- [x] Push subscription management
- [x] Badge API integration
- [x] Notification permission handling
- [ ] Background sync registration (future)
- [ ] Runtime caching for attachments (Workbox handles basics)

---

## Sprint 8: Settings & Polish

### Phase 16: Settings Screen ✅
- [x] Settings UI layout with sections
- [x] Account information display
- [x] Lock vault action
- [x] Logout with confirmation
- [x] Storage size calculation
- [x] Data export (placeholder)
- [x] Clear all data with confirmation
- [x] Notification settings UI
- [x] About section with links

### Phase 17: Search ✅
- [x] Search UI component with input
- [x] Prefix search on Dexie
- [x] Search messages by content
- [x] Search results display
- [x] Navigate to conversation from result
- [x] Empty states

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

### Contact Management
- [x] Create `src/lib/stores/contact-store.ts`
- [x] Update `src/lib/storage/interface.ts` with contact methods
- [x] Implement contact methods in `src/lib/storage/dexie-driver.ts`
- [x] Export `useContactStore` from `src/lib/stores/index.ts`
- [x] Automatic contact addition when sending a message to a new identity in `src/features/messages/useMessages.ts`
- [x] Add "Add as Contact" button in 1:1 conversations in `src/features/messages/ConversationView.tsx`
- [x] Update `AddContactButton.tsx` to use `useContactStore` and check if contact already exists.

### UI - Contacts Tab
- [x] Add "Contacts" tab to bottom navigation in `src/app/Layout.tsx`
- [x] Create `src/features/contacts/ContactsPage.tsx`
- [x] Add route for `/contacts` in `src/app/Router.tsx`
- [x] Populate `ContactsPage.tsx` with actual contacts from `useContactStore`.
- [x] Implement search/filter in `ContactsPage.tsx`.

### UI - New Group Flow
- [x] Add "New Group" button to `src/features/conversations/ChatList.tsx`
- [x] Create `src/features/conversations/NewGroupPage.tsx`
- [x] Add route for `/new-group` in `src/app/Router.tsx`
- [x] Populate `NewGroupPage.tsx` with selectable contacts from `useContactStore`.
- [x] Implement search/filter in `NewGroupPage.tsx`.
- [x] Implement group creation logic in `NewGroupPage.tsx`.

### Group Chat Functionality
- [x] Implement XMTP group chat creation.
- [x] Implement XMTP group message sending/receiving.

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
- [x] Fetch key package statuses for installations
- [x] Display validation errors in UI
- [x] Show expiry timestamps (formatted)
- [x] Add status badges (valid/expired/error)
- [x] Sort installations by creation date (newest first)
- [ ] Add "Revoke All Other Installations" button
- [ ] Replace browser `confirm`/`alert` flows with in-app modals
- [ ] Implement auto-reconnect flow after revoking the current device

---

## Documentation & References
- [x] Added XMTP_BASICS.md explaining identity, inboxes, and installations with links to official docs and xmtp.chat.
- [ ] Update README to reference the new debug Web Workers panel and installations tools.
- [ ] Add a short guide for `check_deploy.sh` usage in DEPLOYMENT.md.

## Testing Follow-ups
- [ ] Unit test: Utils-based inbox state fetch when disconnected (timeouts, errors).
- [ ] Integration test: New DM creation and first message send using `newDmWithIdentifier`.
- [ ] E2E: Clear All Data performs wallet disconnect, client close, DB + cache wipe, and reload.
