# Converge Architecture

This root file is the canonical architecture and decision tracker for Converge. The older overview at `docs/architecture.md` links here.

## Current Stack

- React 18 + TypeScript + Vite PWA hosted primarily as Cloudflare Workers Static Assets.
- Local-first state and data storage with Zustand plus Dexie/IndexedDB.
- XMTP protocol v3 through `@xmtp/browser-sdk` 6.1.2 on the production network.
- No application database or general Converge backend. One stateless Worker route streams already-encrypted XMTP device-history archives between the browser and XMTP's fixed history service.

## Product Principles

- Choice-first onboarding: always show the inbox actions before creating an identity or opening a wallet; no passphrase or manual wallet entry by default.
- Local-first app state with XMTP end-to-end transport encryption; browser data is not encrypted at rest today.
- Static-first deployability: Cloudflare serves the app shell with native SPA fallback and repo-controlled response headers; only the narrow encrypted-history relay runs Worker code.
- No placeholder credentials: client code must not ship fake API keys, vapid.party API keys, or private relay credentials.

## Implemented Multi-Inbox Product Contract

This section records the architecture implemented on 2026-07-10. Lower-level
protocol notes below explain the implementation and must remain consistent with
this contract.

### Onboarding Lifecycle

- Every unauthenticated visit starts on the inbox choice screen with Create new inbox, Restore from keyfile, and Connect external wallet. Startup must not automatically create an inbox or enter wallet approval.
- Create new inbox generates a local account key and registers its new XMTP inbox and first installation only after the user chooses it. It then opens the existing dismissible profile editor, prefilled with the deterministic Color Animal name, before the main messaging UI.
- Creating another inbox later selects it immediately and opens the same profile editor.
- Burning the final loaded inbox returns to the same inbox choice screen instead of silently creating a replacement inbox.
- An interrupted external-wallet connection is represented by an explicit resume action on the choice screen. Startup may discover the pending record, but it must not open the wallet flow until the user chooses to resume it.

### Inbox Registry And Runtime Isolation

- The top-left identity control is an Inbox Switcher. The registry has one entry per XMTP inbox, regardless of how many account identifiers or installations that inbox has.
- An inbox entry represents an independent social identity with its own profile, contacts, consent cache, conversations, attachments, keys, local storage namespace, and current memory-only composer draft. Drafts are not persisted across reloads. Its default switcher presentation is profile name and avatar; protocol identifiers stay in details views.
- Only the selected inbox owns a live XMTP client and performs conversation, message, profile, contact, or consent sync. Switching must completely close the current client and database handles before opening the selected inbox.
- The registry supports Create new inbox, Import keyfile, and Connect external wallet. Import loads the inbox resolved by the exact imported key. If that inbox is already in the registry, report "This inbox is already loaded" and make no state change.
- An imported account key that has no XMTP identity update may register its own new inbox. A registered imported key must resolve to its existing inbox and must not be reassigned as part of import.

### Account Keys, Installations, And Wallet Authority

- Use "local account key" or "Converge key" for the exportable secp256k1 key stored by the app. Reserve "installation" or "installation key" for the separate XMTP SDK key in the inbox database.
- Generated and restored inboxes use their local account key as the application signer. An external-wallet inbox uses the wallet address itself as the XMTP account identity, then reconnects signer-less after installation approval; routine messaging must not require wallet prompts.
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

- A Converge local account key is an XMTP account identity backed by a secp256k1 private key stored in IndexedDB.
- An external-wallet identity uses the external wallet address itself as the XMTP account identity. No private key is stored in app storage.
- An XMTP inbox ID is the stable messaging destination.
- An XMTP installation is the device/app-instance key stored in the Browser SDK SQLite database.
- Create new Converge inbox means a new local account key, a new XMTP inbox, and this browser's first installation for that inbox.
- Restore from keyfile means reuse the exact private key or mnemonic. A new browser resolves that account to its existing inbox and registers a distinct installation.
- Connect external wallet registers this browser installation directly under the external wallet identity, without generating intermediate local EOA keys or storing the wallet private key.

### External-Wallet Device Bootstrap

1. Resolve the wallet identifier through the XMTP identity ledger.
2. Check the target inbox installation count before any registration. At 10/10, stop and offer the existing static recovery flow.
3. Open the wallet signer with the SDK's inbox-aware default database path and `disableAutoRegister: true`.
4. Ask the manager's own `preferences.fetchInboxState()` network view whether the exact local installation is already a published member.
5. If the installation is absent and the manager is not locally ready, call `register()` once for that installation under the wallet identity, then verify the exact `installationId` in network state.
6. Store the identity record with `identityKind: 'wallet'` (no local private key).
7. Reconnect signer-less using `Client.build(identifier)` for routine messaging and background sync without prompting the wallet.
8. Publish a bounded device-history request for the joined device.

### Multi-Tab Database Concurrency Protection

XMTP OPFS SQLite databases cannot be safely accessed concurrently across browser tabs. Converge enforces tab concurrency using the Web Locks API:
- When connecting an inbox, Converge attempts to acquire an exclusive lock on `converge:xmtp-inbox-database:<inboxId>` with `{ ifAvailable: true }`.
- If another tab already holds the database open, connection fails immediately with a clear error preventing database corruption.
- When the client disconnects or the tab closes, the lock is released cleanly.

### Settled Browser Installation Recovery

Normal reconnect remains `resume-only`: it cannot register or revoke anything. Before opening a missing saved path, Converge uses the SDK OPFS read-only existence API to check the saved and alternate deterministic logical filenames (legacy address path versus inbox-default path). A real client opens the selected filename as `file:<logical-path>?mode=rwc&vfs=opfs-libxmtp`; explicitly naming libxmtp's OPFS VFS makes initialization fail closed instead of allowing wasm-bindings 1.8.1 to fall back to SQLite's in-memory VFS. It opens only an existing alternate first. A different local installation is adopted automatically only when `client.isRegistered()` and fresh inbox state both verify that exact installation and signer; the path-mode and installation marker are then repaired without a ledger mutation.

Otherwise connection raises a structured recovery state containing the saved and local installation IDs, local readiness, fresh ledger membership, recovery-authority match, path mode, and installation count. Settings can inspect the known inbox ledger with static SDK helpers while disconnected, but revocation controls remain disabled until a live current installation is verified. The Installations inventory loader is read-only with respect to stored identity metadata: it never derives or persists an installation ID or path mode from a list response, and a request generation guard prevents an older disconnected response from replacing newer post-repair UI state. Explicit revocation remains a separate confirmed mutation.

**Repair This Browser** is a distinct, confirmed lifecycle operation. It holds an inbox-scoped `navigator.locks` lease when available, opens the selected logical filename through the named persistent OPFS VFS with auto-registration disabled, refetches the expected inbox and signer authority, and persists `{installationId: candidate, staleInstallationId: prior, installationRepairPending: true, xmtpDbPathMode}` before the first ledger mutation. The live client is registered without closing or reopening before registration. After local and ledger verification, Converge terminates that worker, waits for its OPFS handles to release, and creates a fresh worker against the exact same database URI. The repair is durable only if resume-only verification recovers the same inbox, registered installation ID, signer, and ledger membership. With a free slot, that fresh-worker proof runs before recovery-authorized optional cleanup of the prior installation; only at 10/10 may required exact cleanup run first. A non-recovery account key never revokes another installation. Capacity is checked immediately before registration. Optional encrypted-history request failure cannot invalidate a durable repair or delay stream startup; it remains pending for a later deliberate retry.

Browser SDK 6.1.2 can generate a different prospective installation ID when an unregistered client's worker closes and the database is opened again. It can also log an OPFS initialization failure while allowing SQLite to use its default in-memory VFS; such a client may register successfully yet lose its installation key when the worker ends. Converge prevents that fallback by naming `opfs-libxmtp`, and it treats fresh-worker exact-ID reopen as part of registration success rather than as a later health check. A crash or reload before that proof resumes the repair journal and settles fresh local plus ledger state, but cannot promise the same unregistered candidate ID. The exact prior installation remains the only cleanup target; a new live attempt may restage the ID it opens and registers that ID without a pre-registration reopen. The operation never chooses the oldest installation, clears Dexie, or deletes OPFS. A locally registered candidate absent from fresh ledger state, a fresh-worker ID mismatch, or a ledger-visible partial registration whose private installation key was not durable remains fail-closed. A failed live attempt retains its staged client for an explicit same-tab retry only when that live client still matches the journaled candidate.

Registration policy is the sole mutation control. The removed legacy `register` boolean cannot contradict it, and an omitted policy defaults to `resume-only`. Production pins `@xmtp/browser-sdk` exactly and installs with the repository's pnpm version plus `--frozen-lockfile`; CI also runs the lifecycle tests before building.

If the persisted pending installation is still registered remotely but the inbox database opens a different local installation, Converge marks the remote ID stale and blocks another registration. That network-visible mismatch is not eligible for automatic local repair. The recovery identity can explicitly remove that exact stale ID before retrying, even below 10/10, so an interrupted setup does not consume a permanent extra slot or sacrifice an older active device.

Ethereum account identifiers have one canonical representation: lowercase `0x` plus exactly 40 hexadecimal characters. Boundary code repairs repeated/missing/case-variant prefixes only when the remaining payload is exactly 20 bytes, and rejects anything else before signer construction or persistence.

### Reassignment Policy

- The default UI never moves an already-registered account key.
- The browser SDK high-level `unsafe_addAccount` implementation rejects an account that already resolves to an inbox, despite the API's reassignment acknowledgement flag.
- Explicit reassignment would strand that identity's previous inbox and requires a separate lower-level, strongly confirmed workflow. Converge currently refuses it instead of pretending two inboxes can be merged.
- Settings registers the browser installation directly under the selected external wallet identity and leaves the current Converge inbox in the registry.

### Limits And Recovery

- XMTP allows 10 active installations and 256 cumulative inbox updates.
- Static installation recovery requires the target inbox recovery signer, refetches live inbox state, and revokes only enough explicitly confirmed installations to return to 9/10. An associated wallet that is not the recovery identity cannot use static recovery.
- Creation time is not activity time; the UI warns that the oldest installation may still be active.
- Nonzero SCW chain mismatches retry with XMTP's originally registered chain ID. Legacy SCW chain ID `0` remains blocked because a browser wallet cannot produce the expected chain-zero smart-wallet signature.

### Local Security

- Local private keys, mnemonics, decrypted messages, contacts, attachment caches, and Browser SDK SQLite data are unencrypted at rest.
- Keyfiles contain plaintext private-key or mnemonic material.
- Wallet signatures authorize XMTP identity and installation changes. The wallet is not required for normal sends after its browser installation is registered and the signer-less client is reopened.
- Explicit wallet selections resolve only to their matching connector; an unavailable connector fails visibly. EOA/SCW bytecode inspection is bounded and remains the default. When every inspection RPC fails, the user may explicitly identify the signer as a regular wallet or smart account; an explicit smart-account choice is rejected unless the connector supplied a valid chain ID.
- Passphrase, passkey, and vault-lock controls are hidden until Converge implements real encryption-at-rest and recoverable unlock behavior.

### Message Retention And Deletion

- `src/lib/message-retention-policy.ts` is the single policy source: four weeks is exactly 28 days, and the same duration is converted to nanoseconds for XMTP group creation options.
- Local retention is authoritative for Converge's decrypted data. Authentication prunes the selected namespace before the inbox UI renders; the app router independently schedules single-flight sweeps of every loaded inbox at open, hourly, and visible-tab resume without changing the active namespace. Every inbound/backfill handler rejects rows at or beyond the cutoff before persisting messages or attachment descriptors.
- `DexieDriver.deleteMessages()` is the only cascade primitive for manual deletion, cutoff sweeps, and XMTP deletion-stream events. One transaction deletes message rows, attachment metadata, plaintext bytes, encrypted remote descriptors, clears dangling read references, bounds unread state, and recomputes the newest conversation preview/ID/sender so deleted plaintext cannot survive in chat-list metadata.
- Mute is notification state only. It never writes a conversation/peer deletion tombstone, and storage reads remove legacy `user-muted` tombstones so later inbound messages are not suppressed. Only the explicit Delete conversation action creates a durable local-hide marker.
- New user-visible single-peer and multi-member MLS groups receive `messageDisappearingSettings` with a 28-day interval at creation. Existing groups are not mutated retroactively because the setting is shared, permissioned conversation state. Self/profile and invite-control DMs keep their specialized protocol behavior.
- The Browser SDK does not expose arbitrary per-message OPFS deletion for legacy/unconfigured conversations. Routine retention and Full Sync must never delete the active OPFS database; whole-database deletion remains restricted to explicit Burn Inbox or Clear All Browser Data flows.
- Retention catches up on the next app open after a browser was closed. No client can guarantee deletion from peers, other devices, screenshots/exports, remote infrastructure, or Thirdweb/IPFS ciphertext.

### XMTP Connection And Sync Lifecycle

- Connect, disconnect, provisioning, revocation, manual conversation sync, and full-history sync operations are serialized through one lifecycle queue. A disconnect waits for an in-flight connect or sync rather than closing its worker/database underneath it; a later disconnect cannot be swallowed by an earlier one when a connect sits between them.
- Startup subscribes to the all-message stream before running catch-up, closing the read-before-subscribe race. A separate conversation stream discovers a first inbound DM/group immediately; stream restarts schedule the same authoritative catch-up instead of relying on transport replay alone.
- Online, page-show, visible-tab resume, and the 60-second maintenance interval coalesce into one lifecycle-serialized, generation-bound recovery pass. It restores missing message/conversation/deletion streams, refreshes conversation discovery, then replays missed retained messages; old work cannot attach to a replacement client.
- Stateful Browser SDK sync calls cannot be cancelled. Keyed single-flight ownership survives a caller deadline, so timeout/retry paths rejoin the original operation rather than overlapping another mutation against the same worker/database.
- A database-worker close has a bounded caller deadline but is still non-cancellable. If it times out, Converge retains the inbox-scoped Web Lock, records the pending close, blocks another same-tab client open, and requires a reload rather than risking concurrent OPFS access; only a successful late close or tab teardown releases that safety state.
- Decoded live/history messages and durable system/reaction/group side effects pass through one shared FIFO before Dexie persistence. Events produced before both authenticated `Layout` consumers mount are buffered in memory, tagged with the inbox that produced them, and drained in order; `Layout` rejects a superseded inbox's queued work before accessing the active namespace. Message IDs deduplicate history/live replay.
- Manual/history completion and checkpoint advancement wait for the shared FIFO. Individual consumer failures remain observable even though the tail continues with later work, so a failed message, system event, or reaction cannot be reported as a successful durable repair.
- `identity.lastSyncedAt` is conversation-list freshness/UI state, not a message-history watermark. Recent queries use only the conversation's last successfully ingested sync/message time, with overlap and message-ID deduplication, so a list-only sync cannot permanently skip missed messages.
- A versioned local marker triggers one full retained-history repair per inbox for checkpoints written by older builds. The marker advances only after strict conversation/history work succeeds, both durable consumers remain registered at the same generation, and the FIFO records no persistence failure; unavailable storage or any incomplete pass leaves the repair pending for a later consumer-ready/recovery cycle.
- **Check now** force-refreshes conversation discovery and replays all retained history. Pull-to-refresh performs the same SDK sync, replay, and awaited durable ingestion for the selected conversation instead of merely refreshing the SDK's private cache.
- Reusing a ready same-signer client verifies the expected inbox and installation and restores all three streams plus recovery listeners. The live message, conversation, and native message-deletion streams are ended and drained before `Client.close()`.
- Full Sync is non-destructive: it force-syncs the conversation list, performs a strict retained-history backfill, applies the local retention sweep, and reloads the list. It never disconnects, clears IndexedDB, deletes OPFS, or attempts resume-only registration against a newly created database.
- Inbox-state management reads fail closed. Timeouts, cooldowns, or empty network responses surface an error instead of presenting a fabricated zero-installation state.
- There is no durable outbound retry queue. Text/reply/group operations therefore fail visibly when disconnected or rejected instead of returning local-only XMTP-shaped objects that could remain pending forever.

### Encrypted Device-History Transport

- Browser SDK device sync exports an AES-encrypted archive on an older installation and exchanges its download URL and key inside XMTP. The archive service never receives decrypted messages or installation private keys.
- XMTP's production history edge has returned upload/download responses without browser CORS headers even though the public server implementation enables CORS. Every Converge `Client.create` therefore uses the same-origin base `/api/xmtp-history`; the Cloudflare Worker accepts only `POST /upload` and `GET /files/<uuid>`, streams the opaque body to the fixed XMTP origin, keeps no application state or archive copy, and never logs payloads or file identifiers.
- History transfer is optional to ordinary XMTP operation. Requests are keyed by installation, single-flight, time-bounded, and cooldown-limited; message and deletion streams start independently. A request-publication result means only that another installation was asked to respond, not that its archive was uploaded or imported.
- The relay is a compatibility boundary, not a general proxy. It has no credentials, dynamic upstream, plaintext access, user routing, or durable storage. Direct history URLs emitted by other XMTP clients still depend on their configured service and its browser CORS behavior.

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

Converge's client-side integration treats XMTP alert registration as an app-scoped logical layer and vapid.party Web Push as the current delivery adapter:

1. Converge registers a browser `PushSubscription`.
2. Converge maintains one `converge.cv`-scoped logical XMTP alert registration per loaded inbox and installation on that shared subscription endpoint.
3. A singleton Cloudflare Container XMTP listener watches message and welcome traffic and forwards only minimal opaque match metadata to vapid.party's authenticated delivery ingest; encrypted envelopes are not queued or forwarded by the production contract.
4. vapid.party sends a minimal Web Push payload that identifies the inbox through an opaque local handle.
5. `public/sw.js` records an approximate per-inbox activity hint and shows a visible notification using the local inbox profile name when available.
6. Clicking the notification focuses or opens Converge without automatically switching inboxes.
7. The app syncs and decrypts only after that inbox is selected.

### App-Level Subscription Model

- Notification permission and the browser `PushSubscription` are app/browser-wide. There is no per-inbox or per-conversation user toggle.
- The app scope is part of every registration and deletion. Converge uses standard Web Push endpoint/key data without browser-vendor request branches. The public relay separately validates endpoints against its supported FCM, Mozilla, Apple, and WNS provider allowlist.
- The relay keeps one active route per `app + inboxId + installationId`; its physical Web Push endpoint and subscription keys are replaceable attributes of that route. One physical endpoint can serve many loaded inboxes, and deleting one logical registration leaves the others intact.
- Enabling notifications upserts every loaded inbox for which Converge has cached valid relay material. A newly created, imported, or joined inbox is upserted when it is active and its topics are available.
- Inactive inboxes remain registered at the relay but do not open an XMTP client or sync. Last-known topic material is stored in that inbox's local namespace and refreshed only while the inbox is active.
- Disabling notifications deletes every locally known inbox/installation relay record before unsubscribing the shared browser endpoint. Browser notification permission itself remains controlled by browser settings.
- Cache-only refresh is not notification disable: deleting HTTP/app caches must preserve the root and push-recovery service-worker registrations, their browser subscription, and logical relay state. The explicit destructive Clear All Data path may remove them after its separate confirmation.
- `isPushEnabled` must reflect the app-level preference and registration state, not merely the existence of a browser endpoint.
- A push for an inactive inbox stores a pending-activity flag in service-worker-accessible local state and uses a per-inbox notification tag. The Inbox Switcher displays a dot; only a later XMTP sync can determine exact unread state.
- Visible copy can say "New activity for <full inbox profile name>" but must not include sender or message content. The profile name is resolved locally from an opaque inbox handle and is never sent through the relay registration or push payload.

### Client Implementation

- `src/lib/push/config.ts` only accepts public config:
  - `VITE_VAPID_PARTY_API_BASE`, defaulting to `https://vapid.party/api`.
  - `VITE_VAPID_PUBLIC_KEY` as an optional cached/fallback VAPID public key.
- `src/lib/push/subscribe.ts`:
  - resolves the exact `/` registration for `/sw.js` and waits for that specific registration to activate; it does not assume the one-shot `navigator.serviceWorker.ready` registration has the requested scope;
  - requests `Notification` permission from the Settings/Debug user action;
  - validates the vapid.party public VAPID key's 65-byte uncompressed-point encoding before passing it to the browser for curve validation;
  - creates/reuses a `PushSubscription` through one shared in-flight provider request;
  - rechecks for an asynchronously completed subscription after provider rejection and uses bounded retry/backoff when replacing a stale-key subscription, because Chromium can resolve `unsubscribe()` before its push-provider deletion finishes;
  - after a provider-level root failure, registers the same worker under the VAPID-key-versioned `/__converge-push/<key-version>/` scope and retries there. A subscription belongs to a service-worker registration, so this gives origin-specific Chromium/FCM state a new registration identity without clearing Converge IndexedDB, OPFS, local keys, or messages;
  - prefers a matching recovery subscription during status, refresh, and disable operations; removes superseded root/recovery subscriptions only after the replacement endpoint is registered remotely and persisted locally; and never unregisters the root app worker as part of push recovery;
  - classifies browser provider rejection separately from relay registration failure and makes clear that no subscription or inbox data was sent to vapid.party when no endpoint exists, even though the public-key GET may have succeeded;
  - synchronizes the active conversation list and preferences before gathering the active `inboxId`, `installationId`, address, local profile name, and consent-filtered conversation HMAC keys;
  - caches one registration per loaded inbox/installation in `ConvergePushState` and upserts every loaded inbox with available material;
  - tracks app-level enabled/partial/disabled status instead of treating endpoint existence as sufficient;
  - checks coarse public relay health separately and marks end-to-end delivery ready only when the response explicitly confirms the listener and registration bridge are ready. A healthy Worker with no XMTP readiness field remains `unknown`;
  - deletes every cached relay record before unsubscribing globally and retains failed deletions as retryable tombstones;
  - POSTs/DELETEs versioned XMTP registration payloads without `X-API-Key`.
- `src/lib/xmtp/client.ts` synchronizes conversations and preferences, lists Allowed and Unknown conversations with `includeDuplicateDms: true`, calls each conversation's `hmacKeys()`, and merges all backing MLS groups and every distinct HMAC epoch. Denied conversations are excluded.
- Browser SDK 6.1.2 returns raw 16-byte group IDs (32 lowercase hex characters) as map keys. `src/lib/push/subscribe.ts` accepts only that raw shape or the full `/xmtp/mls/1/g-<32-hex-group-id>/proto` shape, canonicalizes the result to lowercase, and deterministically appends `/xmtp/mls/1/w-<64-hex-installation-id>/proto` with no HMAC key for installation welcomes.
- The active client watches XMTP `HmacKeyUpdate` and `ConsentUpdate` preference events. Conversation/sync changes and those preference changes trigger a debounced relay refresh. Relay mutations are serialized; concurrent refresh calls coalesce but retain one trailing newest snapshot. Disable/Burn synchronously advance a mutation generation and abort active relay requests, while permission/VAPID preparation stays outside the mutation lock, so stale Enable/refresh work cannot restore deleted state or block local cleanup.
- Relay fetch and body parsing are bounded to five seconds. If the relay accepts an upsert but final local persistence fails, Converge keeps the active route and browser subscription and stores the returned capability in a `pendingRegistration` recovery record. A retry sends that capability and finalizes the same route idempotently. Only explicit supersession, Disable, or Burn invokes DELETE; failed intentional cleanup remains a `pendingDeletion` tombstone.
- `public/sw.js` stores opaque-handle activity in `ConvergePushState`, resolves a locally cached inbox profile name, uses a per-inbox notification tag, and posts activity hints to open clients. It never decrypts XMTP or expects plaintext message content.
- `InboxSwitcher` loads and listens for those approximate activity hints, shows a dot for inactive inboxes, and clears the hint when that inbox is selected.
- Notification clicks ignore all relay-supplied navigation and focus/open `self.location.origin + '/'`. They cannot select an inbox, conversation, same-origin subroute, or external URL; the user chooses the dotted inbox before XMTP sync/decryption.
- Startup topic repair uses a session cooldown key containing the installation plus build version/hash. A new deployment therefore publishes one fresh snapshot even when an older build refreshed recently. The Debug action calls the refresh directly and bypasses this startup cooldown.
- Registration upserts may return a 256-bit diagnostic and management capability. Converge stores it only inside `ConvergePushState`; subsequent registration refreshes and deletes send it only as `Authorization: Bearer`, and the Debug Push Trace uses the same header on fixed `POST /api/xmtp/status` and `POST /api/xmtp/status/test` paths with no body, no referrer, and no cache. Exact-endpoint refreshes and authorized endpoint replacement preserve a valid capability. Exact-endpoint bootstrap or recovery without a valid stored capability may mint a replacement; a `409` capability conflict stops without an unauthenticated retry. The receipt, endpoint, inbox ID, installation ID, topics, and HMAC keys are never rendered or logged by diagnostics.
- The Push Trace compares local and relay group/welcome/HMAC counts and reports the last XMTP match independently from Queue/provider acceptance and service-worker receipt. Its local display test bypasses the relay; its relay test targets only the logical registration represented by the bearer capability. A successful diagnostic receipt is persisted only after `showNotification()` resolves and is tagged as `local` or `relay`, so it never becomes an inbox activity hint.

### vapid.party Relay Contract

Converge uses public XMTP-aware registration routes without shipping a vapid.party secret. The version-1 compatibility route is app-scoped to `converge.cv` and carries standard Web Push as its delivery adapter. The companion relay contract has an authenticated internal delivery ingest for the singleton XMTP listener. The Cloudflare-only production stack is a Worker API, D1 registration/bridge state, a delivery Queue, and a singleton Cloudflare Container running the listener. The public routes register routing metadata; by themselves they do not watch the XMTP network or produce automatic pushes.

The generic service boundary is the app-scoped XMTP alert registration: app, inbox, installation, topics, HMAC epochs, and opaque delivery metadata. A Farcaster Mini App or another delivery provider can use the same listener-side XMTP matching model later, but it needs its own app-scoped authenticated registration and delivery adapter. Converge's public compatibility route must not be reused to enroll another app silently.

Push-contract rollout order is mandatory: apply vapid.party D1 migration `0005_xmtp_diagnostics.sql`, deploy the vapid.party Worker/listener, verify CORS plus `/api/xmtp/status`, `/api/xmtp/status/test`, and public delivery health, then deploy Converge. The Worker requires the new D1 columns/tables, while the diagnostics-enabled Converge client requires the Worker's management-capability response and headers.

#### Public VAPID Key

`GET {VITE_VAPID_PARTY_API_BASE}/xmtp/vapid-public-key`

- Authentication: none.
- Response accepted by Converge:

```json
{ "success": true, "data": { "publicKey": "BASE64URL_VAPID_PUBLIC_KEY" } }
```

Converge also accepts `{ "publicKey": "..." }` or a plain text key. `VITE_VAPID_PUBLIC_KEY` remains an optional cached/fallback value.

#### Public Delivery Readiness

`GET {VITE_VAPID_PARTY_API_BASE}/health`

The relay's ordinary Worker health and XMTP delivery readiness are independent. The public response may include this coarse, secret-free state:

```json
{
  "success": true,
  "data": {
    "status": "healthy",
    "xmtp": {
      "deliveryReady": true,
      "listener": {
        "configured": true,
        "status": "ready",
        "lastCheckedAt": "2026-07-14T00:00:00.000Z"
      },
      "bridge": {
        "status": "synced",
        "pendingRegistrationCount": 0,
        "failedRegistrationCount": 0,
        "lastSuccessfulSyncAt": "2026-07-14T00:00:00.000Z"
      }
    }
  }
}
```

`deliveryReady` is true only when the listener is configured and recently ready and the registration bridge has no pending or failed rows. Listener status is derived server-side from an authenticated Cloudflare Container heartbeat; bridge counts describe the durable D1 snapshot/cursor state. Converge treats an absent field as `unknown`, an unreachable or explicitly non-ready pipeline as unavailable/degraded, and never derives readiness from HTTP 200, VAPID lookup, a browser endpoint, or a successful registration POST. The public response must not expose Container URLs, bearer tokens, database credentials, or delivery endpoint secrets. On 2026-07-14, after deployment of the Cloudflare-only stack, production public health reported `deliveryReady: true`, listener `ready`, bridge `synced`, and zero pending or failed registrations. A post-deployment real-Chrome canary then verified genuine welcome/group delivery and suppression behavior.

#### Register Or Update Subscription

`POST {VITE_VAPID_PARTY_API_BASE}/xmtp/subscriptions`

- Authentication: no client-side secret. Backend should validate origin/CORS, rate limit, and may add a future public challenge/proof if needed.
- Idempotency: upsert the one active route for `app.id` plus `identity.inboxId` plus `identity.installationId`; `subscription.endpoint` is replaceable.
- Update behavior: an authorized later POST for the same route replaces endpoint/subscription keys, topic HMAC keys, and timestamps while preserving its valid management capability.
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
        "topic": "/xmtp/mls/1/g-32_HEX_GROUP_ID/proto",
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

- Continuous delivery is an operational property, not a client registration property. The UI must treat the pipeline as unknown or unavailable whenever the public health response does not explicitly report `deliveryReady: true`.
- The Cloudflare Worker, D1 registration bridge, delivery Queue, and singleton Container listener are deployed. The listener uses XMTP `SubscribeAll`, which provides no replay cursor; messages arriving during a restart or disconnected interval can therefore miss their approximate push hint. XMTP conversation sync remains the authoritative recovery path after the app opens.
- The complete path was exercised on 2026-07-12 using real production XMTP sender/recipient inboxes, the official v3 notification server with temporary PostgreSQL, vapid.party's production D1/Queue worker, a real Chrome Web Push subscription, and the live Converge service worker. A genuine installation welcome and inbound group message produced opaque activity and locally named notifications; three HMAC epochs were accepted, and the recipient's own message produced no delivery.
- Production probes verified shared physical endpoints, independent logical deletion, genuine welcome/group delivery, three HMAC epochs, recipient-own-message and `shouldPush:false` suppression, and complete registration cleanup. These tests prove the contract at a point in time; live readiness still comes from public health and can regress independently.
- Browser Web Push reliability depends on platform policy. iOS/iPadOS Home Screen web apps support Web Push on 16.4+, but delivery remains subject to OS/browser limits.
- Chromium's generic `AbortError: Registration failed - push service error` is emitted by the browser provider before relay registration. It can mean a pending provider operation, origin-specific stale state after VAPID rotation, a disabled push provider, or another provider-side failure. `Notification.permission === 'granted'` and existing notifications from other apps do not prove that the provider can create a new subscription for this origin.
- Brave is identified with `navigator.brave.isBrave()`. The site's notification permission prompt controls only whether `converge.cv` may display notifications; it does not expose or enable Brave's separate browser-wide provider. When Brave returns this exact `AbortError`, verify **Use Google services for push messaging** in `brave://settings/privacy`, fully quit every Brave process and installed Converge window, relaunch, and retry. `chrome://gcm-internals` and `brave://gcm-internals` expose provider state without deleting Converge's local identity data.
- Cloudflare observability for the reported failure showed healthy vapid.party health/public-key responses and no subscription POST. The relay cannot diagnose or repair this stage because Converge does not contact it until `PushManager.subscribe()` returns an endpoint.

### Follow-Up Checklist

- Continuously validate the Cloudflare Container XMTP listener and D1-backed registration bridge; keep `deliveryReady` false whenever either side is stale, disconnected, pending, or failed.
- Evaluate a replay-capable XMTP ingestion path or explicitly retain best-effort push semantics around listener restart/disconnect windows.
- Add production expiry, retry, dead-letter, and observability policy for physical endpoints, logical registrations, and delivery attempts.
- Verify the same delivery matrix on supported mobile platforms and installed PWAs; the 2026-07-12 automated test used headless Google Chrome on Linux.
- Keep notification copy experimental until installed-PWA and mobile platform reliability is characterized.
