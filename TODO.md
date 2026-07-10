# converge.cv — TODO

**Last updated**: 2026-07-10

This is the live backlog. Keep it short and current. Completed work should move to `AGENTS.md` or stay in git history.

## P0 (must fix)

- Encrypt private keys at rest in IndexedDB (device-based; keep no-passphrase default).
- Complete a live two-browser XMTP validation of wallet-approved device joining,
  distinct installation IDs, reload reuse, and older-device history transfer.
- Fix conversation mute semantics so muting doesn’t drop inbound messages (see `docs/conversations.md`).
- Fix persisted previews for system messages (`DexieDriver.putMessage` treats non-text as attachments).
- Add automated coverage for the “Resync All” flow.
- Decide on service worker strategy:
  - Keep minimal `public/sw.js` (push-only) vs re-enable `vite-plugin-pwa`/Workbox.
  - If re-enabling caching, avoid “offline messaging” copy.

## P1 (high)

- Add verified default bot contacts (keep `src/lib/default-contacts.ts` empty until real XMTP-enabled addresses exist).
- Verify the vapid.party XMTP relay routes, closed-app delivery, and welcome-topic coverage end to end before removing the experimental label.
- Add unit/integration tests for inbox-id resolution + `canMessage` regressions.
- Run the desktop/mobile multi-inbox Playwright smoke test in CI and add a stubbed send-message scenario.

## Messaging

- Image attachments shipped (RemoteAttachment + Thirdweb IPFS); add multi-file + video support next.
- Disappearing messages (timer + local cleanup).
- Delivery/read state UX.

## Conversations & Groups

- “Archived conversations” view or stop hiding archived items.
- Revisit delete vs ignore semantics (“delete locally” vs “ignore forever”).
- Group chat UX polish (members/admins list, promote/demote, add/remove).
- Permission policy editor (policyType/policySet).
- Leave group and “disband” flows.

## Documentation

- Keep `README.md`, `FEATURES.md`, `ARCHITECTURE.md`, and `AGENTS.md` aligned with shipped identity and notification behavior.

## Future / Stretch

- SQLite WASM migration (OPFS).
- Full-text search (FTS5).
- Performance profiling / Lighthouse.
- Accessibility audit.
- Voice messages.
- Video attachments.
- Link previews.
- Message forwarding.
- Existing-device approval for adding a fresh local key without requiring a wallet.
