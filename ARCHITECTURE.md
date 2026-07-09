# Converge Architecture

This root file is the canonical architecture and decision tracker for Converge. The older overview at `docs/architecture.md` links here.

## Current Stack

- Static React 18 + TypeScript + Vite PWA hosted on GitHub Pages.
- Local-first state and data storage with Zustand plus Dexie/IndexedDB.
- XMTP protocol v3 through `@xmtp/browser-sdk` 6.1.2 on the production network.
- No Converge backend. Client code may only use public `VITE_*` configuration.

## Product Principles

- One-click onboarding: no passphrase or manual wallet entry by default.
- Local-first app state with XMTP end-to-end transport encryption; browser data is not encrypted at rest today.
- Static deployability: GitHub Pages remains sufficient for the Converge app shell.
- No placeholder credentials: client code must not ship fake API keys, vapid.party API keys, or private relay credentials.

## XMTP Identity, Inbox, And Installation Model

### Product Terms

- A Converge local app key is an XMTP account identity backed by a secp256k1 private key.
- An XMTP inbox ID is the stable messaging destination. Multiple account identities can resolve to one inbox.
- An XMTP installation is the device/app-instance key stored in the Browser SDK SQLite database. It is not the local app key.
- Create new Converge inbox means a new local account key, a new XMTP inbox, and this browser's first installation.
- Restore from keyfile means reuse the exact private key or mnemonic. A new browser resolves that account to its existing inbox and registers a distinct installation.
- Add this device to existing inbox means create a fresh local account key, associate it with the target inbox, and reuse one browser installation authorized by a wallet that already controls that inbox.

### Wallet-Approved Device Bootstrap

1. Resolve the wallet identifier through the XMTP identity ledger. A prospective `Client.inboxId` is not proof that a ledger inbox exists.
2. Check the target inbox installation count before any registration. At 10/10, stop and offer the existing static recovery flow.
3. Generate the fresh local device account key without creating a client for it.
4. Confirm through the ledger that the fresh key has no inbox. If it already resolves anywhere, block; the normal flow never reassigns it.
5. Open the wallet signer with the SDK's inbox-aware default database path and `disableAutoRegister: true`.
6. Register that browser installation with the wallet if the installation is not already in the target inbox.
7. Call `unsafe_addAccount(freshSigner, true)`. The pinned SDK requires `true` even for an unregistered key, so Converge's ledger preflight is the invariant that makes this an association rather than a reassignment.
8. Wait until the fresh identifier resolves to the target inbox.
9. Close the wallet manager and reopen the same default inbox database with the fresh signer.
10. Require both the target `inboxId` and the wallet-approved `installationId` to match before marking onboarding complete.
11. Call `sendSyncRequest()` for the joined device and explain that an older installation must be online to provide decrypted history. Persist failed requests for retry.

The manager and final local-key client intentionally share the SDK default path, `xmtp-production-<inbox-id>.db3`. Existing identities without a path-mode marker retain the previous address-based path so upgrading does not create an installation on the next reload.

### Reassignment Policy

- The default UI never moves an already-registered account key.
- The browser SDK high-level `unsafe_addAccount` implementation rejects an account that already resolves to an inbox, despite the API's reassignment acknowledgement flag.
- Explicit reassignment would strand that identity's previous inbox and requires a separate lower-level, strongly confirmed workflow. Converge currently refuses it instead of pretending two inboxes can be merged.
- Settings creates a new device key and leaves the current Converge inbox in the registry.

### Limits And Recovery

- XMTP allows 10 active installations and 256 cumulative inbox updates.
- Static installation recovery uses the target inbox recovery signer, refetches live inbox state, and revokes one explicitly confirmed installation only while the inbox is still at 10/10. Wallet joins use the wallet signer; keyfile restores can use the restored signer.
- Creation time is not activity time; the UI warns that the oldest installation may still be active.
- Nonzero SCW chain mismatches retry with XMTP's originally registered chain ID. Legacy SCW chain ID `0` remains blocked because a browser wallet cannot produce the expected chain-zero smart-wallet signature.

### Local Security

- Local private keys, mnemonics, decrypted messages, contacts, attachment caches, and Browser SDK SQLite data are unencrypted at rest.
- Keyfiles contain plaintext private-key or mnemonic material.
- Wallet signatures authorize XMTP identity and installation changes. The wallet is not required for normal sends after the fresh local key is associated.
- Passphrase, passkey, and vault-lock controls are hidden until Converge implements real encryption-at-rest and recoverable unlock behavior.

## Convos XMTP Interop

### Implemented Now In Converge

- New user-initiated one-to-one chats use Convos' current single-peer MLS group pattern instead of creating a fresh DM. The stored `peerId` remains the other inbox ID for contact lookup, but `isGroup` is true so messages publish into a group conversation that Convos can list.
- Legacy DMs remain readable and sendable. Invite-claim transport still uses a DM to the invite creator because Convos' join flow sends a request to the creator, not to the target group.
- Converge registers these Convos custom content types with the XMTP SDK:
  - `convos.org/profile_update:1.0`
  - `convos.org/profile_snapshot:1.0`
  - `convos.org/typing_indicator:1.0`
  - `convos.org/join_request:1.0`
- Profile update/snapshot and typing/thinking side channels are handled silently and are not persisted as visible chat bubbles.
- Group sends, replies, and attachments best-effort publish the local display name through Convos `profile_update` and mirror merged profile metadata into `group.appData`.
- Convos `group.appData` profile merging now preserves existing encrypted image refs, legacy image URLs, and `connections` when Converge only has a partial update.
- Invite claiming sends a Convos `join_request` payload with the invite slug fallback instead of sending a raw invite slug as normal text.

### Current Limitations

- Existing local DM rows are not migrated into Convos-style groups. Starting a chat prefers an existing single-peer group but reuses a matching legacy DM when no group exists, avoiding duplicate threads.
- Converge does not decrypt Convos encrypted profile images yet. It preserves encrypted refs in appData but only uses plaintext display names and legacy plaintext avatar URLs for rendering.
- No live Converge-to-Convos end-to-end regression was run in this implementation pass. The changes are covered by local protocol codec and appData tests, but real cross-client delivery still needs manual verification with Convos.

## Push Notifications Through vapid.party

### Goal

Converge should use vapid.party as an XMTP-aware Web Push relay:

1. Converge registers a browser `PushSubscription`.
2. Converge sends the subscription, current XMTP identity, and available XMTP topic HMAC keys directly to vapid.party.
3. vapid.party watches XMTP message traffic by topic/HMAC filter.
4. vapid.party sends a minimal Web Push payload.
5. `public/sw.js` shows a visible notification.
6. Clicking the notification focuses or opens Converge.
7. The app syncs XMTP and decrypts messages locally.

### Implemented Now In Converge

- `src/lib/push/config.ts` only accepts public config:
  - `VITE_VAPID_PARTY_API_BASE`, defaulting to `https://vapid.party/api`.
  - `VITE_VAPID_PUBLIC_KEY` as an optional cached/fallback VAPID public key.
- `src/lib/push/subscribe.ts` now:
  - registers/reuses `/sw.js`;
  - requests `Notification` permission from the Settings/Debug user action;
  - creates/reuses a `PushSubscription` with the vapid.party public VAPID key;
  - gathers `inboxId`, `installationId`, and address from the connected XMTP client/auth store;
  - gathers locally exposed conversation HMAC keys via `client.conversations.hmacKeys()`;
  - POSTs a versioned XMTP registration payload to vapid.party without `X-API-Key`.
- `src/lib/xmtp/client.ts` exposes `getPushHmacKeys()` as a thin wrapper around the installed SDK's `hmacKeys()` API.
- `public/sw.js` shows a generic visible notification and same-origin click URL. It does not decrypt XMTP and does not assume plaintext message content exists.
- Debug no longer attempts client-side `POST /send`; real test pushes must come from the relay side.

### Required vapid.party Backend Support

The public vapid.party code and OpenAPI currently expose generic Web Push endpoints (`/api/subscribe`, `/api/send`, `/api/vapid/public-key`) that require `X-API-Key`. Converge does not use those from the browser because that would expose a secret.

vapid.party needs these public XMTP-aware endpoints:

#### Public VAPID Key

`GET {VITE_VAPID_PARTY_API_BASE}/xmtp/vapid-public-key`

- Authentication: none.
- Response accepted by Converge:

```json
{ "success": true, "data": { "publicKey": "BASE64URL_VAPID_PUBLIC_KEY" } }
```

Converge also accepts `{ "publicKey": "..." }` or a plain text key. Until this route is deployed, set `VITE_VAPID_PUBLIC_KEY`.

#### Register Or Update Subscription

`POST {VITE_VAPID_PARTY_API_BASE}/xmtp/subscriptions`

- Authentication: no client-side secret. Backend should validate origin/CORS, rate limit, and may add a future public challenge/proof if needed.
- Idempotency: upsert by `subscription.endpoint` plus `identity.inboxId` plus `identity.installationId`.
- Update behavior: a later POST for the same key replaces subscription keys, topic HMAC keys, user agent, and timestamps.
- Request body:

```json
{
  "version": 1,
  "app": {
    "id": "converge.cv",
    "origin": "https://converge.cv"
  },
  "identity": {
    "inboxId": "XMTP_INBOX_ID",
    "installationId": "XMTP_INSTALLATION_ID",
    "address": "0x..."
  },
  "subscription": {
    "endpoint": "https://push.example/...",
    "expirationTime": null,
    "keys": {
      "p256dh": "BASE64URL",
      "auth": "BASE64URL"
    }
  },
  "xmtp": {
    "env": "production",
    "topicSource": "conversations.hmacKeys",
    "topics": [
      {
        "topic": "/xmtp/mls/1/...",
        "hmacKeys": [
          { "epoch": "1", "key": "BASE64URL_HMAC_KEY" }
        ]
      }
    ]
  },
  "preferences": {
    "minimalPayloadOnly": true,
    "plaintextPreview": false
  },
  "userAgent": "browser UA",
  "registeredAt": "2026-07-09T00:00:00.000Z"
}
```

#### Unsubscribe

`DELETE {VITE_VAPID_PARTY_API_BASE}/xmtp/subscriptions`

- Request body:

```json
{
  "version": 1,
  "app": { "id": "converge.cv", "origin": "https://converge.cv" },
  "endpoint": "https://push.example/...",
  "identity": {
    "inboxId": "XMTP_INBOX_ID",
    "installationId": "XMTP_INSTALLATION_ID",
    "address": "0x..."
  },
  "deletedAt": "2026-07-09T00:00:00.000Z"
}
```

Converge calls this best-effort, then removes the local browser subscription.

### Minimal Push Payload

vapid.party should send only metadata that the service worker can display without message plaintext:

```json
{
  "type": "xmtp.new_message",
  "title": "Converge",
  "body": "New encrypted message",
  "url": "/",
  "tag": "converge-xmtp-notification",
  "data": {
    "conversationId": "optional-conversation-id"
  }
}
```

`public/sw.js` also accepts a `{ "payload": { ... } }` wrapper. Click URLs are resolved against Converge's own origin and cross-origin URLs are ignored.

### Privacy And Security Model

- vapid.party receives Web Push endpoint data, XMTP inbox/installation identifiers, conversation topics, and HMAC keys needed to filter encrypted XMTP traffic.
- vapid.party must not receive decrypted XMTP message bodies, attachment contents, private keys, wallet signatures for message content, or local database state.
- Push payloads must not include plaintext message content. The service worker shows generic copy and opens Converge for local sync/decryption.
- HMAC/topic material is sensitive metadata. It enables notification routing, not decryption. Store it server-side with least privilege, rotate on each registration update, and delete on unsubscribe.
- Converge must remain static; adding a Converge backend is a non-goal.

### Current Limitations

- No real end-to-end push delivery has been verified from vapid.party. Do not claim push notifications are complete until a live relay test passes.
- `@xmtp/browser-sdk` 6.1.2 exposes `conversations.hmacKeys()`; Converge verified that locally. A separate documented welcome-topic helper was not found. This may limit notification coverage for brand-new inbound conversations while the app is fully closed.
- The current public vapid.party deployment/source still documents API-key generic endpoints, not the XMTP public endpoints above. Converge will fail gracefully until those routes exist or `VITE_VAPID_PUBLIC_KEY` plus `/xmtp/subscriptions` are deployed.
- Browser Web Push reliability depends on platform policy. iOS/iPadOS Home Screen web apps support Web Push on 16.4+, but delivery remains subject to OS/browser limits.

### Follow-Up Checklist

- Implement the vapid.party `/xmtp/vapid-public-key` and `/xmtp/subscriptions` routes.
- Add relay-side XMTP stream/filter workers that use registered topics/HMAC keys without decrypting content.
- Add relay-side expiry/rotation cleanup for subscription endpoints and old HMAC epochs.
- Verify live push delivery with a real installed PWA and document exact tested platforms.
- Revisit XMTP welcome/new-conversation topic coverage once the SDK exposes a documented helper or vapid.party has another reliable first-contact signal.
