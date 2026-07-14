# Converge Architecture

This root file is the canonical architecture and decision tracker for Converge. The older overview at `docs/architecture.md` links here.

## Current Stack

- Static React 18 + TypeScript + Vite PWA hosted on GitHub Pages.
- Local-first state and data storage with Zustand plus Dexie/IndexedDB.
- XMTP protocol v3 through `@xmtp/browser-sdk` 6.1.2 on the production network.
- No Converge backend. Client code may only use public `VITE_*` configuration.

## Product Principles

- Choice-first onboarding: always show the inbox actions before creating an identity or opening a wallet; no passphrase or manual wallet entry by default.
- Local-first app state with XMTP end-to-end transport encryption; browser data is not encrypted at rest today.
- Static deployability: GitHub Pages remains sufficient for the Converge app shell.
- No placeholder credentials: client code must not ship fake API keys, vapid.party API keys, or private relay credentials.

## Implemented Multi-Inbox Product Contract

This section records the architecture implemented on 2026-07-10. Lower-level
protocol notes below explain the implementation and must remain consistent with
this contract.

### Onboarding Lifecycle

- Every unauthenticated visit starts on the inbox choice screen with Create new inbox, Restore from keyfile, and Add this device to existing inbox. Startup must not automatically create an inbox or enter wallet approval.
- Create new inbox generates a local account key and registers its new XMTP inbox and first installation only after the user chooses it. It then opens the existing dismissible profile editor, prefilled with the deterministic Color Animal name, before the main messaging UI.
- Creating another inbox later selects it immediately and opens the same profile editor.
- Burning the final loaded inbox returns to the same inbox choice screen instead of silently creating a replacement inbox.
- An interrupted wallet-approved device join is represented by an explicit resume action on the choice screen. Startup may discover the pending record, but it must not open the wallet flow until the user chooses to resume it.

### Inbox Registry And Runtime Isolation

- The top-left identity control is an Inbox Switcher. The registry has one entry per XMTP inbox, regardless of how many account identifiers or installations that inbox has.
- An inbox entry represents an independent social identity with its own profile, contacts, consent cache, conversations, drafts, attachments, keys, and local storage namespace. Its default switcher presentation is profile name and avatar; protocol identifiers stay in details views.
- Only the selected inbox owns a live XMTP client and performs conversation, message, profile, contact, or consent sync. Switching must completely close the current client and database handles before opening the selected inbox.
- The registry supports Create new inbox, Import keyfile, and Add this device to existing inbox. Import loads the inbox resolved by the exact imported key. If that inbox is already in the registry, report "This inbox is already loaded" and make no state change.
- An imported account key that has no XMTP identity update may register its own new inbox. A registered imported key must resolve to its existing inbox and must not be reassigned as part of import.

### Account Keys, Installations, And Wallet Authority

- Use "local account key" or "Converge key" for the exportable secp256k1 key stored by the app. Reserve "installation" or "installation key" for the separate XMTP SDK key in the inbox database.
- The local account key is the normal application signer. Wallets are optional authority for joining an existing inbox, recovery, and identity administration; routine messaging must not require wallet prompts.
- XMTP messages are represented to recipients as coming from `senderInboxId`. Converge must not offer a message-level selector for associated account keys. A future transaction-signing key selector belongs to a separate wallet feature.
- Plaintext key export is implemented under the collapsed Advanced settings section and is never presented as an onboarding task or backup nag. Permanent loss after losing the only local copy is an accepted default tradeoff.
- Before associating a wallet or account identifier, onboarding and Settings display the public/permanent identity-history warning and require an explicit acknowledgment before approval can continue.
- Native Wagmi/Reown is the sole wallet connection stack and owns Coinbase/Base, WalletConnect, MetaMask, and injected-wallet deep-link lifecycles. Privy and Thirdweb wallet-provider UI are removed. Attachment ciphertext is uploaded through Thirdweb's narrow HTTPS storage contract without loading its wallet SDK; Thirdweb is not part of wallet authorization.

### Burn Inbox

- Burn Inbox is implemented only in the selected inbox's Settings and requires one quick confirmation.
- The operation captures the exact current installation, closes the client, and attempts static XMTP revocation with the local account signer. It then wipes the local account key, XMTP database, messages, contacts, consent cache, drafts, attachments, profile, and every inbox-scoped cache even when remote revocation fails.
- An associated local key that is not the inbox recovery identity may be unable to authorize static revocation; the UI reports that another connected device must revoke it. A blocked local database/OPFS deletion is different: Converge preserves the key and registry row and requires a retry rather than claiming the wipe completed.
- A revocation failure must not block the local wipe. Report that the remote installation may remain active and should be revoked from another connected device.
- Burning removes local access and device data. It cannot erase the network inbox, messages already distributed through XMTP, or permanent identity history.

### Contacts, Consent, And Published Profiles

- Contacts and consent projections are namespaced per inbox. Follow current Convos behavior unless a documented Converge-specific decision deliberately differs.
- Contact creation is action-gated by active participation such as starting/sending in a conversation or explicitly adding the peer. Passive network discovery alone does not create a durable private address book.
- Contact records display the peer's published profile. Legacy private aliases, avatar overrides, and notes are discarded; Converge does not add a custom cross-device contact-sync protocol.
- XMTP consent is encrypted network-synchronized inbox state with a local cache. Inactive inboxes do not background-sync consent; they refresh it when selected.
- Each local inbox owns an independent profile. Convos profile update/snapshot messages remain the cross-client name channel for people and agents; the implementation limitations below still apply to encrypted avatars.

## XMTP Identity, Inbox, And Installation Model

### Product Terms

- A Converge local account key is an XMTP account identity backed by a secp256k1 private key.
- An XMTP inbox ID is the stable messaging destination. Multiple account identities can resolve to one inbox.
- An XMTP installation is the device/app-instance key stored in the Browser SDK SQLite database. It is not the local account key.
- Create new Converge inbox means a new local account key, a new XMTP inbox, and this browser's first installation for that inbox.
- Restore from keyfile means reuse the exact private key or mnemonic. A new browser resolves that account to its existing inbox and registers a distinct installation.
- Add this device to existing inbox means create a fresh local account key, associate it with the target inbox, and reuse one browser installation authorized by a wallet that already controls that inbox.

### Wallet-Approved Device Bootstrap

1. Resolve the wallet identifier through the XMTP identity ledger. A prospective `Client.inboxId` is not proof that a ledger inbox exists.
2. Check the target inbox installation count before any registration. At 10/10, stop and offer the existing static recovery flow.
3. Generate the fresh local account key without creating a client for it.
4. Confirm through the ledger that the fresh key has no inbox. If it already resolves anywhere, block; the normal flow never reassigns it.
5. Open the wallet signer with the SDK's inbox-aware default database path and `disableAutoRegister: true`.
6. Ask the manager's own `preferences.fetchInboxState()` network view whether the exact local installation is already a published member. Browser SDK 6.1.2 `isRegistered()` proves only that the local database is ready; it cannot skip publication or membership verification.
7. If the installation is absent and the manager is not locally ready, call `register()` once for that installation, then poll the manager's network-refreshed inbox state for the exact `installationId`. Also require the connected wallet to remain a current account or recovery authority. A previously ready pending manager that remains network-absent is stale and enters the one-time repair below.
8. Call `unsafe_addAccount(freshSigner, true)`. Libxmtp pre-signs this update with the current installation as the existing member, so the XMTP publish endpoint remains the final protocol authorization boundary. After a fresh registration, state readers can lag across XMTP nodes; retry only the exact non-mutating `Missing existing member` rejection for a bounded period while refetching manager state. The pinned SDK requires `true` even for an unregistered key, so the fresh-key ledger preflight prevents reassignment.
9. Wait until the fresh identifier resolves to the target inbox and appears in the target inbox identity state.
10. Close the wallet manager and reopen the same default inbox database with the fresh signer.
11. Require both the target `inboxId` and the wallet-approved `installationId` to match before marking onboarding complete.
12. Call `sendSyncRequest()` for the joined device and explain that an older installation must be online to provide decrypted history. Persist failed requests for retry.

The manager and final local-key client intentionally share the SDK default path, `xmtp-production-<inbox-id>.db3`. Existing identities without a path-mode marker retain the previous address-based path so upgrading does not create an installation on the next reload.

Provisioning persists the manager installation ID before registration or account association. It checks that exact installation through both `manager.preferences.fetchInboxState()` and an independent network reader; local `isRegistered()` never substitutes for either. After a fresh registration, a bounded `Missing existing member` retry handles cross-node publication lag without regenerating a key or installation. The server rejects every attempt until it recognizes the installation as an existing member, so the retry cannot publish an unauthorized identity update. The fresh account association must then converge through the manager resolver, the independent network resolver, and the target inbox identity state.

If a pending inbox-default manager database is locally ready but its installation remains absent from the network after bounded registration polling, Converge may repair it exactly once. The repair closes the manager, deletes only that pending `xmtp-production-<inbox-id>.db3` database, clears the pending installation marker, preserves the staged local account key, refetches the target inbox, and rechecks the 10/10 installation limit before creating a replacement installation. It must not run for legacy/custom database paths, a network-visible installation, or more than once in one provisioning attempt. At 10/10 it stops and offers the normal safe recovery flow without opening the replacement client. Interrupted responses otherwise preserve the same key and installation, then surface a deliberate resume action on the inbox choice screen; startup never resumes wallet approval automatically. `Client.create` uses explicit `new-inbox`, `existing-inbox`, or `resume-only` registration policy; existing-inbox and reload paths pin the persisted installation ID and fail closed rather than falling back to inbox creation or silently accepting another installation.

The pinned Browser SDK predates XMTP's April 2026 `waitForRegistrationVisible` quorum option, and the option is not present in published stable 7.0.0 either. Until Converge deliberately upgrades to a release that actually exposes it, Converge must not pass that unsupported option. Converge combines explicit network-state polling with bounded retries of only the server's `Missing existing member` rejection; final association convergence remains a separate proof after publication.

`Client.create({ disableAutoRegister: true })` still assigns a prospective deterministic `inboxId` for a signer that has no identity update. Converge therefore uses `client.isRegistered()` for local registration readiness and resolves the signer independently through the network. It never calls `preferences.fetchInboxState()` as a fresh-inbox existence test. A permitted transition persists the installation first, calls `register()` at most once, then verifies all three facts before completion: the signer resolves to the expected inbox, the signer appears in `accountIdentifiers`, and the normalized installation ID appears in `installations`. Conversation sync and stream startup happen after this identity boundary and are non-fatal to an already verified inbox installation.

Registration policy is the sole mutation control. The removed legacy `register` boolean cannot contradict it, and an omitted policy defaults to `resume-only`. Production pins `@xmtp/browser-sdk` exactly and installs with the repository's pnpm version plus `--frozen-lockfile`; CI also runs the lifecycle tests before building.

If the persisted pending installation is still registered remotely but the inbox database opens a different local installation, Converge marks the remote ID stale and blocks another registration. That network-visible mismatch is not eligible for automatic local repair. The recovery identity can explicitly remove that exact stale ID before retrying, even below 10/10, so an interrupted setup does not consume a permanent extra slot or sacrifice an older active device.

Ethereum account identifiers have one canonical representation: lowercase `0x` plus exactly 40 hexadecimal characters. Boundary code repairs repeated/missing/case-variant prefixes only when the remaining payload is exactly 20 bytes, and rejects anything else before signer construction or persistence.

### Reassignment Policy

- The default UI never moves an already-registered account key.
- The browser SDK high-level `unsafe_addAccount` implementation rejects an account that already resolves to an inbox, despite the API's reassignment acknowledgement flag.
- Explicit reassignment would strand that identity's previous inbox and requires a separate lower-level, strongly confirmed workflow. Converge currently refuses it instead of pretending two inboxes can be merged.
- Settings creates a fresh local account key for a wallet-approved join and leaves the current Converge inbox in the registry.

### Limits And Recovery

- XMTP allows 10 active installations and 256 cumulative inbox updates.
- Static installation recovery requires the target inbox recovery signer, refetches live inbox state, and revokes only enough explicitly confirmed installations to return to 9/10. An associated wallet that is not the recovery identity cannot use static recovery.
- Creation time is not activity time; the UI warns that the oldest installation may still be active.
- Nonzero SCW chain mismatches retry with XMTP's originally registered chain ID. Legacy SCW chain ID `0` remains blocked because a browser wallet cannot produce the expected chain-zero smart-wallet signature.

### Local Security

- Local private keys, mnemonics, decrypted messages, contacts, attachment caches, and Browser SDK SQLite data are unencrypted at rest.
- Keyfiles contain plaintext private-key or mnemonic material.
- Wallet signatures authorize XMTP identity and installation changes. The wallet is not required for normal sends after the fresh local key is associated.
- Explicit wallet selections resolve only to their matching connector; an unavailable connector fails visibly. EOA/SCW bytecode inspection is bounded and remains the default. When every inspection RPC fails, the user may explicitly identify the signer as a regular wallet or smart account; an explicit smart-account choice is rejected unless the connector supplied a valid chain ID.
- Passphrase, passkey, and vault-lock controls are hidden until Converge implements real encryption-at-rest and recoverable unlock behavior.

## Convos XMTP Interop

### Implemented Now In Converge

- New user-initiated one-to-one chats use Convos' current single-peer MLS group pattern instead of creating a fresh DM. The stored `peerId` remains the other inbox ID for contact lookup, but `isGroup` is true so messages publish into a group conversation that Convos can list.
- XMTP conversation type and UI presentation are deliberately separate. A generic two-member MLS group can present as a direct chat; a named or multi-person group presents as a group, never falls back to peer-specific display fields, and exposes its participant count and Group Info roster.
- Legacy DMs remain readable and sendable. Invite-claim transport still uses a DM to the invite creator because Convos' join flow sends a request to the creator, not to the target group.
- SDK group state is authoritative over the local conversation shape. Unknown inbound messages are classified through the SDK before sender-based DM assumptions, and every normal sync probes non-DM SDK conversations so historical DM-shaped group rows are promoted and fully hydrated with metadata, members, admins, and permissions.
- A matching `senderInboxId` identifies the social inbox, not the browser installation. Live messages and `GroupUpdated` events from another installation of the active inbox are processed; authoritative XMTP message IDs deduplicate a current-browser publish echoed by the stream.
- Converge registers these Convos custom content types with the XMTP SDK:
  - `convos.org/profile_update:1.0`
  - `convos.org/profile_snapshot:1.0`
  - `convos.org/typing_indicator:1.0`
  - `convos.org/join_request:1.0`
- Profile update/snapshot and typing/thinking side channels are handled silently and are not persisted as visible chat bubbles.
- Convos names are application profile data, not XMTP identity properties. Current Convos iOS unifies name, member kind, and general received metadata locally by `inboxId`; encrypted avatar slots remain per conversation, and the profile transport is still an MLS group message that must reach each participant/installation.
- Profile state follows Convos precedence (`profile_update > profile_snapshot > appData > contact`), with the XMTP timestamp breaking ties, lower sources filling gaps only, blank names unable to clear known names, and direct empty metadata updates clearing only the conversation-managed `connections`/`timezone` keys.
- Group activation, group sends, and explicit profile saves publish the local display name through a self-authored Convos `profile_update`; legacy `group.appData` profiles are read as a lower-authority fallback but are not rewritten by profile publication.
- Group creation, direct member additions, and invite acceptance publish a current-roster `profile_snapshot` after the membership change so the new MLS member can learn pre-join names.
- Inbound snapshots refresh `group.members()` before roster filtering, and invite approval persists the requester profile locally before publishing, preventing membership-event ordering from dropping a newly added name.
- Profile protobuf support round-trips agent `memberKind` and typed metadata values. `memberKind = 1` is only a generic agent declaration; Converge does not yet implement Convos' attestation verification. Stored member profiles retain provenance and timestamps, and message/typing/mention/member surfaces prefer the Convos group profile over placeholder contacts.
- Single-image interoperability uses XMTP's standard `RemoteAttachment`. Converge encrypts locally, uploads ciphertext to an HTTPS-readable store, then retrieves and decrypts that exact descriptor before publishing; a storage or XMTP failure is surfaced and never represented as a successfully posted local-only image.
- Inbound RemoteAttachments are descriptor-first. Receipt persists display metadata in `attachments` and the encrypted URL/key envelope in inbox-scoped `remoteAttachments`; it does not create a network request. Recoverable plaintext bytes live separately in `attachmentData`, under a 100 MiB per-inbox LRU budget, so eviction never destroys the descriptor needed for retry.
- `useMessages.loadAttachment()` is the only inbound remote fetch path. Authorization runs inside the two-slot download semaphore, coalesces `client.preferences.sync()` for up to five seconds, binds the active inbox, and requires the SDK conversation's current consent state to be `Allowed` immediately before host contact. Trusted hosts can invoke it only from a visible message bubble, while unknown hosts require a hostname-labelled user action. The fetch helper enforces canonical HTTPS/public-looking targets, privacy-oriented fetch options, no redirects, a 15-second timeout, streamed/exact 10 MiB bounds, SDK digest/decryption, raster signature/MIME agreement, and image dimension limits.
- The renderer accepts only validated static JPEG, PNG, and WebP object URLs and never wraps attachment blobs in navigation links. SVG, HTML, animated PNG/WebP, unsupported formats, invalid descriptors, and oversized or malformed bytes remain metadata-only blocked/failed states.
- Remote-cache reservation/eviction/write and optimistic-to-authoritative sent-message reconciliation are transactional. Cache completion first proves its metadata still exists and is not blocked, while failure recording uses a conditional update, preventing in-flight downloads from resurrecting deleted or newly blocked attachment rows. The v10 migration discards pre-policy remote cache bytes; replay restores their descriptor for a validated download.
- This is a browser risk reduction policy, not a network or malware sandbox: public DNS can change after static validation, fetching discloses network metadata to the host, browser image decoders remain an attack surface, and local descriptors/decrypted bytes remain plaintext in IndexedDB. `FEATURES.md` is the user-facing security contract.
- Profile publication does not rewrite the full `group.appData` blob because XMTP exposes no compare-and-swap for concurrent metadata updates. Invite-tag edits remain a separate explicit metadata operation.
- The appData reader accepts both current iOS raw-DEFLATE and tooling zlib-wrapped frames. A fieldless direct profile update remains meaningful and runs the scoped-metadata clear path.
- Invite claiming sends a Convos `join_request` payload with the current local profile name. Invite approval retains that requester profile and includes it in the post-add snapshot.

### Current Limitations

- Existing local DM rows are not migrated into Convos-style groups. Starting a chat prefers an existing single-peer group but reuses a matching legacy DM when no group exists, avoiding duplicate threads.
- Unlike current Convos iOS, Converge does not yet maintain a trust-aware canonical profile repository for all relayed sources: group member state remains conversation-scoped, while direct self-authored updates also refresh the global contact name.
- Converge does not yet run Convos' post-pair profile snapshot broadcast across every allowed group or its durable per-conversation profile retry queue.
- Converge does not decrypt Convos encrypted profile images yet. It preserves encrypted refs in appData but only uses plaintext display names and legacy plaintext avatar URLs for rendering.
- No live Converge-to-Convos end-to-end regression was run in this implementation pass. Local tests cover protobuf metadata, source precedence, activation publication, and a post-join snapshot containing a local user, requester, and named agent; real cross-client delivery still needs manual verification with Convos.

## Push Notifications Through vapid.party

### Goal

Converge's client-side integration treats vapid.party as an XMTP-aware Web Push relay:

1. Converge registers a browser `PushSubscription`.
2. Converge maintains one vapid.party relay registration per loaded inbox and installation on that shared subscription endpoint.
3. An always-on XMTP listener watches message and welcome traffic and forwards matching encrypted envelopes to vapid.party's authenticated delivery ingest.
4. vapid.party sends a minimal Web Push payload that identifies the inbox through an opaque local handle.
5. `public/sw.js` records an approximate per-inbox activity hint and shows a visible notification using the local inbox profile name when available.
6. Clicking the notification focuses or opens Converge without automatically switching inboxes.
7. The app syncs and decrypts only after that inbox is selected.

### App-Level Subscription Model

- Notification permission and the browser `PushSubscription` are app/browser-wide. There is no per-inbox or per-conversation user toggle.
- The relay stores the physical Web Push endpoint separately from logical registrations keyed by `subscription.endpoint + inboxId + installationId`. One physical endpoint can therefore serve many loaded inboxes, and deleting one logical registration leaves the others intact.
- Enabling notifications upserts every loaded inbox for which Converge has cached valid relay material. A newly created, imported, or joined inbox is upserted when it is active and its topics are available.
- Inactive inboxes remain registered at the relay but do not open an XMTP client or sync. Last-known topic material is stored in that inbox's local namespace and refreshed only while the inbox is active.
- Disabling notifications deletes every locally known inbox/installation relay record before unsubscribing the shared browser endpoint. Browser notification permission itself remains controlled by browser settings.
- `isPushEnabled` must reflect the app-level preference and registration state, not merely the existence of a browser endpoint.
- A push for an inactive inbox stores a pending-activity flag in service-worker-accessible local state and uses a per-inbox notification tag. The Inbox Switcher displays a dot; only a later XMTP sync can determine exact unread state.
- Visible copy can say "New activity for <full inbox profile name>" but must not include sender or message content. The profile name is resolved locally from an opaque inbox handle and is never sent through the relay registration or push payload.

### Client Implementation

- `src/lib/push/config.ts` only accepts public config:
  - `VITE_VAPID_PARTY_API_BASE`, defaulting to `https://vapid.party/api`.
  - `VITE_VAPID_PUBLIC_KEY` as an optional cached/fallback VAPID public key.
- `src/lib/push/subscribe.ts`:
  - registers/reuses `/sw.js` and waits for the active root registration through `navigator.serviceWorker.ready`;
  - requests `Notification` permission from the Settings/Debug user action;
  - validates the vapid.party public VAPID key's 65-byte uncompressed-point encoding before passing it to the browser for curve validation;
  - creates/reuses a `PushSubscription` through one shared in-flight provider request;
  - rechecks for an asynchronously completed subscription after provider rejection and uses bounded retry/backoff when replacing a stale-key subscription, because Chromium can resolve `unsubscribe()` before its push-provider deletion finishes;
  - classifies browser provider rejection separately from relay registration failure and makes clear that vapid.party was not contacted when no endpoint exists;
  - gathers the active `inboxId`, `installationId`, address, local profile name, and consent-filtered conversation HMAC keys;
  - caches one registration per loaded inbox/installation in `ConvergePushState` and upserts every loaded inbox with available material;
  - tracks app-level enabled/partial/disabled status instead of treating endpoint existence as sufficient;
  - deletes every cached relay record before unsubscribing globally and retains failed deletions as retryable tombstones;
  - POSTs/DELETEs versioned XMTP registration payloads without `X-API-Key`.
- `src/lib/xmtp/client.ts` synchronizes preferences, lists Allowed and Unknown conversations with `includeDuplicateDms: true`, calls each conversation's `hmacKeys()`, and merges all backing MLS groups and every distinct HMAC epoch. Denied conversations are excluded.
- Browser SDK 6.1.2 returns raw 32-byte group IDs as map keys. `src/lib/push/subscribe.ts` canonicalizes those IDs as `/xmtp/mls/1/g-<group-id>/proto` and deterministically appends `/xmtp/mls/1/w-<installation-id>/proto` with no HMAC key for installation welcomes.
- The active client watches XMTP `HmacKeyUpdate` and `ConsentUpdate` preference events. Conversation/sync changes and those preference changes trigger a debounced relay refresh. Relay mutations are serialized; concurrent refresh calls coalesce but retain one trailing newest snapshot. Disable/Burn synchronously advance a mutation generation and abort active relay requests, while permission/VAPID preparation stays outside the mutation lock, so stale Enable/refresh work cannot restore deleted state or block local cleanup.
- Relay fetch and body parsing are bounded to five seconds. A successful registration POST is counted only after local persistence completes; a later local failure triggers DELETE rollback, with a pending-deletion tombstone retained when rollback cannot be confirmed.
- `public/sw.js` stores opaque-handle activity in `ConvergePushState`, resolves a locally cached inbox profile name, uses a per-inbox notification tag, and posts activity hints to open clients. It never decrypts XMTP or expects plaintext message content.
- `InboxSwitcher` loads and listens for those approximate activity hints, shows a dot for inactive inboxes, and clears the hint when that inbox is selected.
- Notification clicks ignore all relay-supplied navigation and focus/open `self.location.origin + '/'`. They cannot select an inbox, conversation, same-origin subroute, or external URL; the user chooses the dotted inbox before XMTP sync/decryption.
- Debug no longer attempts client-side `POST /send`; real test pushes must come from the relay side.

### vapid.party Relay Contract

Converge uses public XMTP-aware registration routes without shipping a vapid.party secret. The companion relay contract also has an authenticated internal delivery ingest for an XMTP listener. The public routes register routing metadata; by themselves they do not watch the XMTP network or produce automatic pushes.

#### Public VAPID Key

`GET {VITE_VAPID_PARTY_API_BASE}/xmtp/vapid-public-key`

- Authentication: none.
- Response accepted by Converge:

```json
{ "success": true, "data": { "publicKey": "BASE64URL_VAPID_PUBLIC_KEY" } }
```

Converge also accepts `{ "publicKey": "..." }` or a plain text key. `VITE_VAPID_PUBLIC_KEY` remains an optional cached/fallback value.

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
        "topic": "/xmtp/mls/1/g-64_HEX_GROUP_ID/proto",
        "hmacKeys": [
          { "epoch": "8", "key": "BASE64URL_HMAC_KEY" },
          { "epoch": "9", "key": "BASE64URL_HMAC_KEY" }
        ]
      },
      {
        "topic": "/xmtp/mls/1/w-64_HEX_INSTALLATION_ID/proto",
        "hmacKeys": []
      }
    ]
  },
  "notification": {
    "inboxHandle": "opaque-local-inbox-handle"
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

The endpoint deletes one logical inbox/installation registration. Global disable calls it for every cached loaded registration and only then removes the shared browser subscription. Failed relay cleanup is retained locally for a later retry.

### Minimal Push Payload

vapid.party sends only the event type and opaque local inbox handle:

```json
{
  "type": "xmtp.new_message",
  "inboxHandle": "opaque-local-inbox-handle"
}
```

`public/sw.js` also accepts a `{ "payload": { ... } }` wrapper for compatibility. It resolves the local inbox profile name, records the activity hint, and uses the handle for notification coalescing. It constructs the title, body, tag, and root URL locally; relay-supplied copy or navigation has no effect. Clicking opens/focuses the app but does not automatically switch inboxes.

### Privacy And Security Model

- vapid.party receives Web Push endpoint data, XMTP inbox/installation identifiers, conversation topics, and HMAC keys needed to filter encrypted XMTP traffic.
- vapid.party receives an opaque inbox handle but not the local profile name. Human-readable notification copy stays in the browser.
- vapid.party must not receive decrypted XMTP message bodies, attachment contents, private keys, wallet signatures for message content, or local database state.
- Push payloads must not include plaintext message content. The service worker shows generic copy and opens Converge for local sync/decryption.
- HMAC/topic material is sensitive metadata. It enables notification routing, not decryption. Store it server-side with least privilege, atomically replace the registered snapshot while preserving every currently supplied epoch, and delete it with the logical registration.
- Converge must remain static; adding a Converge backend is a non-goal.

### Current Limitations

- No always-on XMTP listener is deployed to feed message/welcome envelopes into vapid.party's authenticated delivery ingest. Public registration success therefore does not imply automatic XMTP push delivery.
- The complete path was exercised on 2026-07-12 using real production XMTP sender/recipient inboxes, the official v3 notification server with temporary PostgreSQL, vapid.party's production D1/Queue worker, a real Chrome FCM subscription, and the live Converge service worker. A genuine installation welcome and inbound group message produced opaque activity and locally named notifications; three HMAC epochs were accepted, and the recipient's own message produced no delivery.
- A separate production relay probe verified two logical inboxes sharing one physical endpoint, duplicate and `shouldPush:false` suppression, deletion of one logical registration without affecting the other, and complete registration cleanup. These tests prove the contract and delivery path, but do not make delivery continuous after the disposable listener exits.
- Browser Web Push reliability depends on platform policy. iOS/iPadOS Home Screen web apps support Web Push on 16.4+, but delivery remains subject to OS/browser limits.
- Chromium's generic `AbortError: Registration failed - push service error` is emitted by the browser provider before relay registration. It can mean a pending provider operation, a disabled push provider, or a provider-side failure. Brave users must enable its Google push-services setting; `chrome://gcm-internals` and `brave://gcm-internals` expose provider state without deleting Converge's local identity data.

### Follow-Up Checklist

- Deploy an always-on XMTP listener with durable state and connect it to vapid.party's authenticated ciphertext-envelope ingest.
- Add production expiry, retry, dead-letter, and observability policy for physical endpoints, logical registrations, and delivery attempts.
- Verify the same delivery matrix on supported mobile platforms and installed PWAs; the 2026-07-12 automated test used headless Google Chrome on Linux.
- Keep notification copy experimental until the persistent listener is deployed and platform reliability is characterized.
