# converge.cv — TODO

**Last updated**: 2025-12-20

This is the live backlog. Keep it short and current. Completed work should move to `AGENTS.md` or stay in git history.

## P0 (must fix)

- Encrypt private keys at rest in IndexedDB (device-based; keep no-passphrase default).
- Fix conversation mute semantics so muting doesn’t drop inbound messages (see `docs/conversations.md`).
- Fix persisted previews for system messages (`DexieDriver.putMessage` treats non-text as attachments).
- Add automated tests for `storage.clearAllData()` (Dexie + OPFS) and the “Resync All” flow.
- Decide on service worker strategy:
  - Keep minimal `public/sw.js` (push-only) vs re-enable `vite-plugin-pwa`/Workbox.
  - If re-enabling caching, avoid “offline messaging” copy.

## P1 (high)

- Add verified default bot contacts (keep `src/lib/default-contacts.ts` empty until real XMTP-enabled addresses exist).
- Push notification architecture for real messaging (server/relay likely required).
- Notification deep-link routing to the correct conversation.
- Add unit/integration tests for inbox-id resolution + `canMessage` regressions.
- Playwright E2E coverage for:
  - Inbox switching.
  - Send message in E2E mode (stubbed XMTP).

## Messaging

- Attachments (ContentTypeRemoteAttachment): upload backend, UI, storage.
- Typing indicators.
- Disappearing messages (timer + local cleanup).
- Delivery/read state UX.

## Conversations & Groups

- “Archived conversations” view or stop hiding archived items.
- Revisit delete vs ignore semantics (“delete locally” vs “ignore forever”).
- Group chat UX polish (members/admins list, promote/demote, add/remove).
- Permission policy editor (policyType/policySet).
- Leave group and “disband” flows.

## Documentation

- Update root `README.md` with:
  - XMTP v5 upgrade notes + installation management UX.
  - Push notifications (vapid.party).
  - Docs index (`docs/`).
- Keep `FEATURES.md` aligned with shipped UX changes.

## Future / Stretch

- SQLite WASM migration (OPFS).
- Full-text search (FTS5).
- Performance profiling / Lighthouse.
- Accessibility audit.
- Voice messages.
- Video attachments.
- Link previews.
- Message forwarding.
- Multi-device sync.
