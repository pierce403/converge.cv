# converge.cv — TODO

**Last updated**: 2026-08-24

This is the live backlog. Keep it short and current. Completed work should move to `AGENTS.md` or stay in git history.

## P0 (must fix)

- Encrypt private keys at rest in IndexedDB (device-based; keep no-passphrase default).
- Complete a live two-browser XMTP validation of wallet-approved device joining,
  distinct installation IDs, reload reuse, and older-device history transfer.
- Validate the single-active-identity checkpoint against browser profiles that
  still contain multiple registry rows and namespaces. Existing identity,
  Dexie, OPFS, contact, and push state must remain intact.
- Decide on service worker strategy:
  - Keep minimal `public/sw.js` (push-only) vs re-enable `vite-plugin-pwa`/Workbox.
  - If re-enabling caching, avoid “offline messaging” copy.

## P1 (high)

- Verify the vapid.party XMTP relay routes, closed-app delivery, and welcome-topic coverage end to end before removing the experimental label.
- Add unit/integration tests for inbox-id resolution + `canMessage` regressions.
- Add desktop/mobile smoke coverage for all three onboarding choices and
  signer-less active-identity reopen.

## Messaging

- Image attachments shipped (RemoteAttachment + Thirdweb IPFS); add multi-file + video support next.
- Run a real-browser/XMTP expiry integration test for a newly created 14-day
  disappearing conversation; mocked CI covers creation options and
  deletion-stream/local-cascade behavior only. Also verify the independent
  local-history cutoff remains 28 days and existing chat settings are unchanged.
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
- Existing-device approval for adding a new device without requiring a wallet.
