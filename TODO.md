# converge.cv - XMTP v3 PWA Development TODO

## Project Overview
Building a Signal-like PWA for XMTP v3 messaging - local-first, installable, encrypted.

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
- [ ] Install XMTP v3 SDK (@xmtp/*)
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

## Sprint 2: Storage & Crypto Layer

### Phase 5: Storage Driver Interface
- [ ] Design StorageDriver interface
- [ ] Implement DexieDriver with schema
- [ ] Create DB models (conversations, messages, attachments, secrets)
- [ ] Add indexes for queries
- [ ] Unit tests for storage operations

### Phase 6: Crypto Vault
- [ ] Implement vault key generation (AES-GCM)
- [ ] WebAuthn/Passkey integration (PRF extension)
- [ ] Passphrase fallback (PBKDF2/Argon2)
- [ ] Encrypt/decrypt at-rest data helpers
- [ ] Key wrapping/unwrapping logic
- [ ] Unit tests for crypto operations

---

## Sprint 3: XMTP Integration

### Phase 7: XMTP Client Wrapper
- [ ] Create XmtpClient class wrapper
- [ ] Implement connect() with identity
- [ ] Implement streamMessages() listener
- [ ] Implement send() functionality
- [ ] List conversations helper
- [ ] Error mapping & normalization
- [ ] Mock XMTP for testing

---

## Sprint 4: Core Features - Auth & Onboarding

### Phase 8: Authentication Flow
- [ ] Onboarding screen UI
- [ ] Wallet connection flow
- [ ] Create/restore identity
- [ ] Lock screen component
- [ ] Unlock vault flow (passkey/passphrase)
- [ ] Auth state management (Zustand)

---

## Sprint 5: Core Features - Messaging UI

### Phase 9: Chat List
- [ ] ChatList component with virtualization
- [ ] ChatItem component (preview, timestamp, unread badge)
- [ ] Pinned conversations
- [ ] Archived conversations
- [ ] Pull-to-refresh
- [ ] Empty state

### Phase 10: Conversation View
- [ ] Conversation screen layout
- [ ] MessageBubble component (sent/received)
- [ ] Message composer with input
- [ ] Virtualized message list
- [ ] Typing indicators
- [ ] Read receipts display

### Phase 11: New Chat Flow
- [ ] New chat screen
- [ ] Address/handle input
- [ ] Contact validation
- [ ] Start conversation action

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

### Phase 14: Web Push Setup
- [ ] VAPID key generation
- [ ] Push subscription UI
- [ ] Service worker push handler
- [ ] Notification click handler
- [ ] Badge update via SW bridge
- [ ] Fast sync on push wake

### Phase 15: SW Bridge & Background Sync
- [ ] PostMessage channel (app ↔ SW)
- [ ] Background sync registration
- [ ] Offline fallback pages
- [ ] Runtime caching for attachments
- [ ] SW lifecycle management

---

## Sprint 8: Settings & Polish

### Phase 16: Settings Screen
- [ ] Settings UI layout
- [ ] Lock method toggle (passkey/passphrase)
- [ ] Notification preferences
- [ ] Export encrypted backup
- [ ] Import backup
- [ ] Appearance settings (theme)

### Phase 17: Search
- [ ] Search UI component
- [ ] Prefix search on Dexie
- [ ] Search conversations
- [ ] Search messages
- [ ] Search results display

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
- **Messaging**: XMTP v3 browser SDK
- **Storage**: Dexie (IndexedDB) → SQLite WASM (future)
- **Crypto**: WebCrypto (AES-GCM), WebAuthn
- **Testing**: Vitest + Playwright

---

**Last Updated**: 2025-10-26
**Status**: 🚀 Starting Development

