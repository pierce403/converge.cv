# Feature Parity Checklist

This document outlines the feature parity between `converge.cv`, `convos-ios`, and Signal Messenger.

## Converge.cv vs. Convos-iOS

### Convos-iOS Features:
- [ ] Built on XMTP protocol
- [ ] No signup (scan, tap, airdrop into conversation)
- [ ] No numbers (new identity in every conversation)
- [ ] No history (time bomb groupchats with irreversible countdowns)
- [ ] No spam (every conversation is invitation-only)
- [ ] No tracking (zero data collection)
- [ ] No server (messages stored on device, secured by XMTP)
- [ ] Privacy-first messenger
- [ ] Instant, impermanent, self-evidently private conversations
- [ ] Push notifications

### Converge.cv Parity:
- [x] Built on XMTP protocol (v5)
- [x] No signup (one-click onboarding, auto-generate wallets)
- [ ] No numbers (currently uses single identity per app instance, but new identities can be generated)
- [ ] No history (no time-bombing, messages are persistent)
- [ ] No spam (invitation-only not explicitly implemented, but XMTP is permissioned)
- [x] No tracking (zero data collection, local-first)
- [x] No server (messages stored on device, secured by XMTP)
- [x] Privacy-first messenger (local-first, E2E encrypted)
- [x] Instant, impermanent, self-evidently private conversations (instant messaging, but not impermanent/time-bombed)
- [ ] Push notifications (not yet implemented)

## Converge.cv vs. Signal Messenger

### Signal Messenger Features:
- [ ] End-to-end encryption
- [ ] Open-source
- [ ] Minimal data logging
- [ ] GDPR compliant
- [ ] Disappearing messages
- [ ] View-once media
- [ ] Screen security (prevent screenshots, cover chat content in app switcher)
- [ ] Screen lock (PIN, password, password, biometric)
- [ ] Session verification (safety numbers)
- [ ] No ads or trackers
- [ ] Instant messaging (text, voice notes, images, videos, stickers, GIFs, files)
- [ ] Voice and video calls (one-to-one and group up to 40)
- [ ] Group chats (up to 1,000 participants)
- [ ] Group links (invitation links with approval)
- [ ] Message reaction emojis
- [ ] Note to Self
- [ ] Read receipts and typing indicators (with option to disable)
- [ ] Message deletion (for everyone within 3 hours)
- [ ] Cross-platform availability (Android, iOS, macOS, Windows, Linux)
- [ ] Customizable app icon and name
- [ ] Message effects (spoilers, italics)
- [ ] QR code for adding contacts
- [ ] Cryptocurrency wallet (in-app payments)
- [ ] Blur faces in photos

### Converge.cv Parity:
- [x] End-to-end encryption (via XMTP)
- [x] Open-source (project is open-source)
- [x] Minimal data logging (local-first, no tracking)
- [ ] GDPR compliant (not explicitly stated, but local-first nature helps)
- [ ] Disappearing messages (not implemented)
- [ ] View-once media (not implemented)
- [ ] Screen security (not implemented)
- [ ] Screen lock (optional manual lock, but not forced)
- [ ] Session verification (not implemented)
- [x] No ads or trackers (local-first, no tracking)
- [x] Instant messaging (text, images, videos, files - via XMTP)
- [ ] Voice and video calls (not implemented)
- [x] Group chats (XMTP SDK supports it, UI not implemented)
- [ ] Group links (not implemented)
- [ ] Message reaction emojis (not implemented)
- [ ] Note to Self (not implemented)
- [x] Read receipts and typing indicators (not explicitly mentioned, but XMTP has delivery status)
- [ ] Message deletion (not implemented)
- [x] Cross-platform availability (PWA, so web-based)
- [ ] Customizable app icon and name (not implemented)
- [ ] Message effects (not implemented)
- [x] QR code for adding contacts (QRScanner component exists)
- [ ] Cryptocurrency wallet (not implemented)
- [ ] Blur faces in photos (not implemented)

## Converge.cv Current Feature Set Summary:

*   **Core Messaging:** XMTP v5 integration, end-to-end encrypted, instant messaging (text), message streaming, outgoing DM creation, first-message send.
*   **Identity & Auth:** Frictionless one-click onboarding, auto-generated wallets, multi-wallet support (MetaMask, Coinbase, WalletConnect), identities stored in IndexedDB, optional manual lock screen.
*   **PWA:** Install prompts, update notifications, local-first, no server, no tracking.
*   **UI/UX:** Clean UI, proper feature messaging, debug log control, full-screen debug tab, default conversations.
*   **Utilities:** Watchdog for UI thread stalls, installations & device management (network refresh, status, clear data), web workers panel, QRScanner.
*   **Development:** Open-source, minimal data logging.
