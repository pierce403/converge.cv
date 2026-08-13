# Retention, XMTP Connection, And Code-Size Audit

Date: 2026-08-12
Release: 0.5.7

## Outcome

This audit changed the shipped defaults and removed the highest-risk connection and storage behavior it found. It also records the larger refactors that should remain separate, test-led work rather than being mixed into the retention release.

## Message Retention

| Surface | Finding | Resolution |
| --- | --- | --- |
| Dexie messages | `expiresAt` existed but had no writers and its cleanup function had no caller. | A fixed indexed `sentAt` cutoff now applies to every loaded inbox at app open, hourly, and visible-tab resume. Native expiry is also honored. |
| Attachments | Deleting a message could leave some descriptor/data relationships behind. | One transaction deletes messages, attachment metadata, plaintext bytes, and remote descriptors by message ID. |
| Conversation list | Deleted plaintext remained in `lastMessagePreview`; `lastMessageId`, sender, read reference, and unread metadata could dangle. | The deletion transaction recomputes the newest retained message and repairs all dependent fields. |
| Ingest/backfill | Full history had no retention lower bound and an expired SDK row could repopulate Dexie. | History queries are bounded to the 28-day cutoff and every UI ingest path rejects expired messages before any write. |
| XMTP OPFS | The Browser SDK has native disappearing settings/deletion events, but no safe arbitrary per-message OPFS delete API for old unconfigured conversations. | New visible conversations request 28-day disappearing messages and deletion events mirror into Dexie. Routine retention never destroys the active OPFS database. |

Retention limitations are intentional and user-visible: a closed browser catches up on next open; existing shared group policies are not silently changed; peer/device copies, screenshots/exports, remote infrastructure, and Thirdweb/IPFS ciphertext are outside Converge's local deletion guarantee.

## XMTP Connection Paths

The audited paths were fresh local inbox creation, keyfile restore, wallet-approved device join, normal reload/resume, inbox switching, background discovery, live message/deletion streams, manual full sync, installation management, Burn Inbox, and offline sends.

| Severity | Finding | Resolution |
| --- | --- | --- |
| Critical | Resync All disconnected, erased the active inbox's Dexie and OPFS databases, then attempted resume-only reconnect with the old installation ID. The replacement database could create a different installation; wallet-backed records also lacked a signer. Errors were swallowed after data loss. | Replaced with strict non-destructive Full Sync. It keeps the client/database, force-syncs conversations, backfills only retained history, runs retention, and reloads the list. |
| High | Concurrent connect/disconnect calls could create or close the same OPFS database concurrently and let stale work overwrite a newer session. | Connect, disconnect, provisioning, revocation, manual sync, and full sync share one lifecycle queue. Disconnect requests retain exact queue order. |
| High | Same-signer reuse stopped background discovery before returning and did not ensure the live stream was running. | Reuse verifies the expected inbox/installation, restores missing message/deletion streams, and restarts discovery. |
| High | Bootstrap stream failure was swallowed with no recovery path; old background work could survive a client replacement. | The visible background health loop restarts missing streams before its periodic sync, is lifecycle-serialized, and rejects stale client generations. |
| High | Message deletion events from XMTP were not consumed. | A second SDK stream feeds the shared transactional local deletion path and is drained before client close. |
| Medium | Installation UI could interpret network/cooldown failure as an empty inbox state. | Inbox-state reads now fail closed with an explicit error. |
| Medium | Text/reply/group paths returned local-only objects described as queued, but no durable outbound retry worker existed. | These operations now fail visibly; the existing optimistic row becomes failed and can be retried after reconnection. |

### Remaining XMTP Refactor Work

- `src/lib/xmtp/client.ts` is still the main structural hotspot. DM history, group history, and live stream paths repeat decoded-content classification. Extract one table-tested classifier/dispatcher before changing protocol behavior; expected reduction is roughly 400–700 lines and, more importantly, less behavior drift.
- Provisioning and revocation now use the same lifecycle queue as connect/disconnect, but remain deliberately specialized. Any later extraction must retain exact inbox/installation fail-closed checks and the 10/10 recovery rules.
- Push preference streaming is React-effect-owned while message/deletion streams are client-owned. A later pass can give all long-lived XMTP streams one session-generation owner, provided push topic refresh behavior remains intact.
- Cross-tab OPFS ownership is still enforced only by the SDK/browser. A later hardening pass should hold a per-database `navigator.locks` lease for the client lifetime and present an explicit “inbox open in another tab” state.
- `client.ts`, `push/subscribe.ts`, `SettingsPage.tsx`, `OnboardingPage.tsx`, `GroupSettingsPage.tsx`, `useMessages.ts`, `Layout.tsx`, and `ConversationView.tsx` remain the largest source modules. Split by domain boundaries, not by arbitrary line count.

## Code And Bundle Size

Baseline production inventory before this release:

- About 44,997 production source lines.
- Initial entry: 1,856,440 bytes raw / 577,821 bytes gzip.
- XMTP WASM: 11,224,270 bytes raw / about 3.95 MiB gzip, loaded with the SDK path rather than the untouched first-choice screen.
- Largest application file: `src/lib/xmtp/client.ts` at about 7,666 lines.

Implemented reductions:

- Non-core routes use `React.lazy`/`Suspense`.
- `jsqr` and `qrcode` load only when their scanner/overlay interaction starts.
- Two byte-identical 33,154-byte icons were replaced with the existing canonical icon.
- Unreferenced modals, identity button, service-worker bridge, test-only production utilities, obsolete coverage script, captured debug page, Vite placeholder, and unauthenticated standalone cache wipe were removed.
- Unused XMTP wrapper methods and stubs were removed; fake local-only send/group fallbacks were removed.

Final integrated initial entry is 1,477,666 bytes raw / 464,737 bytes gzip, down 378,774 raw bytes (20.4%) and 113,084 gzip bytes (19.6%) from the pre-audit entry. Route splitting slightly increases total emitted JavaScript because of chunk wrappers and compression boundaries; this is a startup/network-on-demand improvement, not a claim that total dependency code shrank. Static duplicate-icon removal saves another 66,308 deployed bytes.

All declared runtime dependencies still have production callers. Duplicate crypto and Coinbase SDK majors are transitive through the wallet stack; forcing resolution overrides would be unsafe and was not done.

### Remaining Size And Runtime Work

- `ContactCardModal.tsx` is still eagerly imported by three screens and pulls QR, ENS, and Farcaster helpers. A shared lazy modal boundary is the next low-to-medium-risk startup reduction; it needs focus-restoration coverage first.
- `main.tsx` always installs console capture and `Providers.tsx` always installs worker tracking. Worker tracking currently emits a DOM event for every worker message. Retain error diagnostics, but gate verbose payload/message accounting behind Debug activation and coalesce UI updates.
- Settings clear-data preparation and Router post-reload deletion intentionally overlap to release OPFS locks, but their policy and error copy are duplicated. Consolidate them behind one tested wipe-state contract without removing the reload boundary.
- DM history, group history, and live delivery duplicate content classification in the largest module. That refactor offers more source reduction than further dependency trimming, but should follow table-driven protocol tests.

## Verification Contract

The release gate covers policy boundaries, cascade/preview repair, old attachment rejection before persistence, scheduler single-flight, native deletion-stream lifecycle, new-conversation expiry options, lifecycle serialization, visible offline failures, full Vitest, TypeScript, lint, production build, and Wrangler dry-run. Native OPFS expiry remains a real-XMTP/browser integration property and is not represented as proven by mocked unit tests.
