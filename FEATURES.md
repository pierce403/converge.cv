# Features and Specifications

## Multi-Inbox Product Model

This section describes the multi-inbox behavior shipped on 2026-07-10. Later
implementation notes add protocol detail but must not contradict this product
model.

### Onboarding And Profiles

- Onboarding always opens on the inbox choice screen with Create new inbox, Restore from keyfile, and Add this device to existing inbox. It does not automatically create an inbox or open a wallet.
- Choosing Create new inbox generates a local account key and registers a new XMTP inbox and installation. After that inbox is ready, Converge opens the existing profile editor before contacts or messages.
- The profile editor starts with the deterministic Color Animal name, supports avatar upload, and is dismissible. Dismissing it keeps the generated profile.
- Creating another inbox later immediately switches to it and opens the same profile editor.
- After burning the last loaded inbox, Converge returns to the same inbox choice screen and does not automatically create a replacement.

### Inbox Accounts And Switching

- The top-left control is an Inbox Switcher. It has one entry per loaded XMTP inbox, not one entry per associated account key or installation.
- Each inbox is an independent social identity, similar to managing separate brand accounts. Its profile, contacts, consent view, conversations, drafts, attachments, keys, and local caches remain isolated from every other inbox.
- Switcher entries show the inbox profile name and avatar by default. Inbox IDs, account addresses, installation IDs, and key details belong in technical details views.
- Only the selected inbox opens an XMTP client and syncs. Switching fully closes the current client before opening the next inbox.
- Add Inbox offers Create new inbox, Import keyfile, and Add this device to existing inbox.
- An interrupted Add this device flow appears as a separate resume action on the inbox choice screen. Converge does not drop the user directly into wallet approval on a later visit.
- Importing a keyfile reuses the exact private key or mnemonic and loads the inbox to which it resolves. An unregistered imported key creates its own new inbox; a registered key reopens its existing inbox and creates only the installation needed by this browser.
- If an import resolves to an inbox already loaded locally, Converge says "This inbox is already loaded" and changes nothing.
- Messages are attributed to the sender's XMTP inbox, not a user-selected associated account key. Converge does not expose a "send with key" control. Any future transaction-signing key selector is a separate wallet feature.

### Local Account Keys And Wallets

- Normal messaging uses an exportable local account key, also called a Converge key. Reserve "installation key" or "device installation" for the separate key managed by the XMTP SDK database.
- Wallets are optional authority for joining an existing inbox, recovery, and administration. They are not the routine message signer after a local account key has joined the inbox.
- Plaintext key export is available only under Advanced settings. Converge never prompts or nags users to write down a seed phrase or export a key.
- Losing the only device and its only local key copy may permanently lose access; that tradeoff is accepted for the low-friction default.
- Before associating a wallet or account, both onboarding and Settings warn that the address-to-inbox link is publicly queryable and effectively permanent in XMTP identity history, and require explicit acknowledgment.

### Burn Inbox

- Burn Inbox is available only from the selected inbox's Settings and uses one quick confirmation prompt.
- Converge captures the exact current installation, closes its client, and attempts XMTP static revocation with the local account signer before wiping the inbox's local account key, XMTP database, messages, contacts, drafts, attachments, profile, and inbox-scoped caches. A non-recovery associated key may be unable to authorize revocation, but that does not block the local wipe.
- If remote revocation fails, the local wipe still completes and Converge explains that another connected device should revoke the remaining installation.
- If IndexedDB or XMTP database cleanup is blocked, Converge keeps the key and registry entry so the user can close other tabs and retry instead of falsely claiming a completed wipe.
- Burning removes the local account and device data; it does not erase the XMTP network inbox or its permanent identity history.

### Contacts And Consent

- Contacts are local and separate per inbox. Converge follows current Convos conventions unless a documented Converge product decision says otherwise.
- A peer becomes a contact after active user participation rather than passive discovery alone.
- Contact presentation uses the peer's published profile. Converge does not add private aliases, notes, or a custom cross-device contact-sync protocol.
- XMTP consent is encrypted network state scoped to the inbox and cached locally. An inactive inbox refreshes consent only after the user selects and syncs it.

### App-Level Notifications

- Notifications are one app/browser-level setting, not separate per-inbox or per-conversation toggles.
- XMTP alerts are app-scoped logical registrations. Standard Web Push is Converge's current delivery adapter: one physical browser `PushSubscription` is shared by logical registrations keyed per loaded inbox and installation. Deleting one logical registration does not remove another inbox that uses the same endpoint.
- Enabling notifications registers every loaded inbox while keeping only the selected inbox connected to XMTP. Disabling notifications deletes every loaded-inbox relay registration before unsubscribing the shared browser endpoint.
- Push for an inactive inbox records an approximate pending-activity hint and lights that inbox in the switcher. It does not connect, sync, or claim an exact unread count until the user selects that inbox.
- Visible notification copy may use the full locally cached inbox profile name, for example "New activity for Orange Orca." The relay receives only an opaque inbox handle and does not receive the profile name, sender, or message body.
- Clicking a notification always opens or focuses Converge's root page without automatically switching inboxes. Relay payloads cannot select a route, inbox, conversation, or external URL; the activity dot remains until the user selects the inbox.
- End-to-end welcome and group delivery has been verified with real production XMTP clients, vapid.party's deployed Cloudflare-only Worker/D1/Queue/Container listener, a real Chrome Web Push subscription, and Converge's live service worker. The 2026-07-14 post-deployment canary also verified three HMAC epochs, recipient-own-message and `shouldPush: false` suppression, and cleanup. A successful browser/relay registration is not proof of current continuous delivery; only explicit public readiness can report that operational state.

## Identity Implementation

- The inbox choice screen is the only unauthenticated entry point. Create new inbox remains a one-click action from that screen; only a successful creation opens the dismissible Color Animal name/avatar editor and then the main UI.
- Create new Converge inbox remains one click: Converge generates a secp256k1 local account key, uses the SDK's inbox-aware database path, registers a new XMTP inbox/installation, and opens the app without a passphrase.
- Generated local keys receive the deterministic Color Animal display-name suggestion used by personalization; legacy generated labels remain replaceable.
- Restore from keyfile reuses the exact private key or mnemonic. It does not create a separate local account key. On a browser without the XMTP database, the same account resolves to the same inbox and registers a new installation.
- Add this device to existing inbox generates a fresh local account key only after the user chooses a wallet-controlled inbox. It never registers that fresh key as a temporary standalone inbox.
- Wallet probing uses the XMTP identity ledger rather than treating the prospective `Client.inboxId` as proof of registration.
- Fresh-client registration uses `client.isRegistered()` instead of fetching nonexistent inbox state. Converge persists the prospective installation before one allowed `register()` call, then requires the signer and normalized installation ID to appear in network inbox state before completing onboarding.
- During wallet-approved device joins, Browser SDK 6.1.2 can report a locally ready installation before publication has propagated. Local `isRegistered()` state is not sufficient authorization for the next identity update: Converge refreshes the manager's own network inbox state with `preferences.fetchInboxState()` and checks the exact installation through an independent network reader.
- After a fresh registration, if those readers still lag and account association returns XMTP's exact `Missing existing member` error, Converge refetches manager state and retries only that rejected association for a bounded period. The XMTP server remains the authorization gate, so an unrecognized installation cannot mutate the inbox; other errors fail without replay.
- If a pending inbox-default XMTP database is locally ready but its installation remains absent from the network after bounded registration checks, Converge automatically replaces that database and installation once. It preserves the staged local account key, clears only the pending installation marker/database, refetches the target inbox, and rechecks 10/10 capacity before opening the replacement. It never replaces a network-visible installation or loops through additional installations.
- Reload and restore paths never infer registration from `inboxId` presence and never retry `register()` blindly. They pin the persisted installation ID, so a different local installation is rejected rather than silently replacing it. Each installation gets at most one registration call; only the narrowly scoped, network-absent pending-device repair may create one replacement installation.
- The wallet signer registers or reuses one inbox-aware browser installation, the fresh unregistered key is associated with `unsafe_addAccount(..., true)`, and the final local-key client must reopen the same inbox and installation before onboarding succeeds.
- Converge statically verifies that the fresh key has no existing inbox. A registered key is never moved by the normal UI; reassignment would strand its prior inbox and is refused.
- If the target is at the 10-installation limit, onboarding and Settings block before association. Static recovery is offered only to the inbox recovery identity, refetches live state, and revokes only enough confirmed installations to return to 9/10.
- Smart-wallet provisioning and recovery retry XMTP's originally registered nonzero SCW chain ID when reported. Legacy chain ID `0` remains blocked with instructions to use an already-connected XMTP device.
- A newly registered installation sends `sendSyncRequest()`. The UI explains that an older device must be online and that sharing an inbox ID does not guarantee restored decrypted history.
- New identities use the SDK default `xmtp-production-<inbox-id>.db3` path. Existing records without a migration marker keep their legacy address path so a normal reload does not create an extra installation.
- Every successful connection persists the live final installation ID. Installation revocation stays disabled unless that ID is present in a refreshed inbox state.
- Pending provisioning keys are persisted before identity-ledger mutation and resumed after interruption; only a key with a validated private-key/address pair plus both persisted inbox and installation IDs is eligible for new-inbox resume. Incomplete pre-registration attempts are removed instead of trapping later Create New actions.
- A malformed unrelated identity row is preserved for recovery but skipped during identity enumeration, and a failed identity-storage read stops XMTP before it can open a different database path.
- Provisioning exposes explicit registration, installation-membership confirmation, account association, ledger-confirmation, and reopen phases. Interrupted responses resume once the exact mutation becomes visible, and an already-registered pending installation can finish even when the inbox has since reached 10/10 only after that installation is confirmed as a current inbox member. A network-absent installation cannot use that exception: replacement rechecks capacity first and offers the safe recovery flow at 10/10.
- If a pending installation remains on the XMTP ledger but its local database now opens a different installation, Converge blocks retry and asks the recovery identity to remove that exact stale installation before touching older devices. Automatic replacement applies only when the pending installation is absent from fresh network state. Exact recovery never falls back to the oldest device when the stale ID is absent, and pending state is cleared only after fresh ledger reads show the removal.
- Ethereum identifiers are normalized at signer, storage, contact, member-profile, and display boundaries. Repairable missing, uppercase, or repeated prefixes migrate to one lowercase `0x`; invalid 20-byte addresses are rejected.
- Registry hydration collapses legacy account-key rows into one entry per inbox. Switching tears down the client, swaps the app-data namespace, and reopens the selected local identity.
- Native Wagmi/Reown is the only wallet connection stack. It provides Coinbase/Base, WalletConnect, MetaMask, and injected-wallet connectors; the Thirdweb and Privy wallet-provider UI is not part of onboarding or Settings.
- Thirdweb remains only as the outbound IPFS storage service for already-encrypted attachment payloads. Converge calls its narrow HTTPS upload contract directly and does not ship the Thirdweb wallet SDK, identity provider, embedded wallet, or WalletConnect stack.
- Mobile wallet deep links are owned by the selected native connector so its request can resume after returning to Converge. Connection results carry an account-bound signer into the immediate XMTP continuation instead of waiting for React wallet state to catch up. Approval signatures are bound to the exact selected account.
- A selected wallet option never falls through to a different installed connector. Wallet bytecode checks run concurrently with a five-second bound; if every RPC check fails, Converge asks whether the connected signer is a regular wallet or smart account instead of guessing. The smart-account choice requires the connector's real chain ID.
- Wallet continuation errors remain visible instead of being relabeled as generic connection failures. Reconnect uses the address, chain, and account-bound signer delivered by the native connector rather than a stale render snapshot.
- Network profile fallbacks that merely echo an Ethereum address or 64-character inbox ID are rejected as display names, preserving the generated Color Animal name until a real profile name is available.
- Deep links return through the chosen onboarding flow and then resume the target route.

### Current Inbox Switcher Isolation
- Each inbox selection (e.g., personal vs. work) loads a distinct XMTP identity and IndexedDB storage namespace so conversations, contacts, drafts, and keys never leak across inboxes.
- Switching inboxes triggers a full teardown of the current client/session, rehydrates the registry list, and reopens the selected identity with its own cached message history.
- The switcher has one row per inbox and shows profile name/avatar rather than protocol identifiers. Add Inbox provides Create new inbox, Import keyfile, and Add this device to existing inbox.
- A duplicate keyfile import stops before local mutation with "This inbox is already loaded". Creating a new inbox selects it immediately and opens the profile editor.
- Inbox IDs are normalized when stored and matched so namespace switches persist across reloads instead of snapping back to the previous identity.
- Burn Inbox lives in the selected inbox's Settings, not in the switcher, and implements the complete wipe/revocation contract above.

## Messaging Experience
- Message bubbles support long-press/right-click actions (reply, copy, delete, forward placeholder) via a modal, and maintain sent/read state indicators for pending/sent/delivered/failed statuses.
- Inline replies render a quoted header that resolves the referenced message body when available, while normal text is linkified so URLs open in a new tab.
- Reactions are grouped and pinned to the bottom of each bubble with counts, aligning left/right based on message ownership.
- New one-to-one chats are created as Convos-style single-peer XMTP MLS groups, while legacy DMs remain readable and invite-claim transport still uses a DM to the invite creator.
- Conversation presentation is separate from XMTP transport shape: single-peer Convos groups retain the compact direct-chat treatment, while actual multi-person groups use only group metadata, show a group marker and participant count, and never inherit a stale peer name or avatar.
- Composer controls now keep the send button vertically centered with the message textarea at one-line height on mobile/PWA, preventing a bottom-offset send button.
- Composer activity sends Convos-compatible `convos.org/typing_indicator:1.0` messages with `shouldPush:false`, and inbound typing indicators are shown transiently without being persisted as chat history.
- JPEG, PNG, and WebP image attachments can be picked from the paper-clip button, validated by signature/static-image/dimension rules, encrypted client-side, uploaded through Thirdweb's HTTPS IPFS storage contract, and sent over the standard XMTP RemoteAttachment type. The upload transport sends only opaque ciphertext under a fixed filename, validates the returned CID, preserves actionable quota/authentication errors, and aborts after two minutes. The encrypted payload must also fit the 10 MiB wire limit. Before publishing, Converge retrieves and decrypts the uploaded ciphertext over HTTPS; upload or publish failures become visible failed messages instead of local-only images that appear sent. A successful XMTP publish remains sent even if later local-cache reconciliation fails. Inbound messages store only the encrypted descriptor until the download policy below permits a fetch.
- Group chat composer supports @-mentions with live member suggestions; mentions render inline with highlight styling and incoming messages that mention you are visually emphasized.
- Conversations load the most recent messages first and lazily prepend older history only when the user scrolls upward, keeping large threads fast while preserving full local storage history.
- Conversation list updates are now idempotent while history is loading: duplicate DM rows are collapsed by conversation ID and canonical peer key so replayed/backfilled message events cannot flood the chat list.
- New inbound conversations are now discovered continuously while connected: XMTP runs a throttled background discovery sync and immediately refreshes the in-memory chat list from IndexedDB after sync writes, so first-time DMs appear without reload/manual resync.
- Messages and group updates authored by another installation of the active inbox are processed instead of being discarded as local echoes. Message IDs remain the deduplication boundary for events also produced by the current browser.
- Read receipts are emitted only for non-self DMs and are throttled by last send time, preventing cross-client metadata spam (for example repeated `{}` rows in xmtp.chat during self-chat testing).
- Desktop-width chat routes now render a persistent split view: conversation list on the left, selected conversation on the right, with mobile behavior unchanged.
- Avatar rendering now prevents raw URL/data payload strings from being printed as text in avatar slots; non-image avatar values are treated as short glyphs only (otherwise initials fallback).

### Attachment Download Security

#### Expected Properties

- Receiving, streaming, or backfilling an XMTP RemoteAttachment stores its encrypted URL/key envelope and display metadata in the active inbox namespace without contacting the attachment host. A message does not download a file merely because it appeared in history.
- Before a queued download is allowed to contact its host, Converge coalesces `client.preferences.sync()` for the visible download batch (at most a five-second freshness window) and then reads that conversation's XMTP consent state. `Unknown` and `Denied` conversations do not fetch attachment bytes. The attachment bubble offers protocol-level Accept or Unblock actions; conversation Block/Unblock controls publish `Denied`/`Allowed` respectively instead of changing only a local contact flag. Unblocking a group never clears an individual member's local contact block.
- For an allowed conversation, a known Converge, Convos, Thirdweb, or configured IPFS gateway may auto-load only after its message bubble intersects the viewport. Every other valid host requires an explicit button that names the hostname. No `IntersectionObserver` means no automatic download.
- Remote URLs must be canonical public-looking HTTPS URLs with no credentials, fragment, non-default port, obvious local hostname, or literal private/reserved IP address. Fetches omit credentials and referrers, bypass the HTTP cache, reject redirects, time out after 15 seconds, and share a global concurrency limit of two.
- The encrypted response is streamed and stopped above 10 MiB. Both its actual length and any HTTP `Content-Length` must agree with the XMTP descriptor; sender-declared size alone is never trusted. XMTP attachment decryption and digest verification must succeed before content is cached or rendered.
- Only static JPEG, PNG, and WebP images are rendered. The decrypted MIME type must match file signatures, dimensions are limited to 8192 pixels per side and 32 million pixels total, animated PNG/WebP is rejected, and SVG/HTML/other active or unsupported formats never receive a preview URL.
- Image object URLs are used only as `<img>` sources and are revoked when the bubble changes or unmounts. Converge does not expose an untrusted attachment blob as a navigation/download link.
- Each inbox has a 100 MiB plaintext attachment cache admission budget. Space reservation, least-recently-used remote eviction, and the new payload write share one IndexedDB transaction, so concurrent downloads cannot independently overcommit the budget. Eviction preserves the encrypted descriptor for a policy-checked retry; non-recoverable local/failed-send bytes are not silently evicted. A completed download cannot recreate an attachment deleted while it was in flight.

#### Limitations

- Explicitly or automatically fetching an attachment reveals the browser's network address and request timing to the selected HTTPS host. A "trusted" host classification permits automatic contact; it does not mean Converge trusts the sender or skips content validation.
- Static URL validation cannot prove where a public hostname will resolve later, prevent every DNS-rebinding case, or replace browser CORS/Private Network Access enforcement. The policy blocks obvious local targets but is not a general browser network sandbox.
- Validated raster bytes still pass through the browser's image decoders. Converge reduces the accepted format and resource surface but does not provide antivirus scanning, media transcoding, or a guarantee that browser decoders have no vulnerabilities.
- Attachment envelopes and decrypted cache bytes are stored unencrypted in the selected inbox's IndexedDB namespace. Burning that inbox removes them locally; browser/profile compromise or XSS while the app is available remains in scope for the local-security warning.
- Thirdweb/IPFS remains the only outbound hosting path for now. The uploaded object is encrypted ciphertext, but sending and later retrieval still depend on that provider's availability, quota/payment policy, and retention behavior; this release does not add alternate hosts or cache-control selection.

## Dependency Security

- Converge's installed graph excludes unused `@xmtp/proto`, Dexie React hooks, PWA/Workbox packages, test helpers, patch tooling, and the full Thirdweb SDK. The hand-maintained service worker and Browser SDK integration remain unchanged.
- Vite 6.4.3, Vitest 3.2.7, PostCSS 8.5.19, React Router 6.30.4, and scoped patched transitive releases replace the vulnerable versions reported on 2026-07-14. Wallet/XMTP major versions remain pinned to avoid turning an advisory cleanup into an untested protocol migration.
- GitHub CI, CodeQL, and dormant Socket workflows use current Node 24-based action majors; application build steps run on Node.js 22 instead of the retired Node.js 20 release.
- The resolved lockfile must return zero findings from npm's current bulk advisory API alongside the normal typecheck, lint, test, and production-build gates. The pinned pnpm 10 client now receives HTTP 410 from npm's retired legacy audit endpoint; use a current pnpm 11 audit client until the repository performs a deliberate package-manager migration.

## Conversation Controls
- Conversation menus include contact management (add, block/unblock) and mute/unmute toggles that flip based on the current mutedUntil timestamp.
- A destructive “Delete conversation” option removes the thread locally and navigates back to the inbox to prevent resurface during resyncs.

## Profile Sharing and Enrichment
- Incoming Converge profile updates (`converge.cv/profile:1.0`) are handled as silent metadata messages (no bubble / no push) to update contact display names and avatars, preferring the inline payload over fetched profiles while avoiding blocked or deleted peers.
- Profile fetches are throttled to a five-minute window per contact to reduce redundant network calls while still refreshing stale records.
- Identity/profile lookups honor rate-limit backoff signals (429/resource exhausted) by pausing XMTP identity API calls for an adaptive cooldown and falling back to minimal profiles until the cooldown clears.
- Address-to-inbox resolution is centralized through a single cached resolver (`resolveInboxIdForAddress`) with in-flight dedupe, a positive TTL cache (15m), and negative cache entries (60s) to reduce repeated `GetInboxIds` pressure.
- `canMessageWithInbox` resolves and returns the canonical inbox ID in one pass, reducing duplicate identity calls during user-initiated conversation/contact paths.
- DM creation, message send preflight, conversation cleanup canonicalization, and contacts refresh all route through the shared resolver path instead of chained fallback lookups.
- Contact Details refresh treats the peer-published XMTP/Convos name and avatar as canonical. Farcaster/ENS data remains secondary identity and reputation metadata and cannot overwrite a newer published profile.
- Contact normalization clears legacy private aliases, avatar overrides, and notes; no private contact-sync layer is implied by profile refresh.
- Legacy/stray text profile payloads are now recognized and consumed as metadata (not chat bubbles), preventing base64-heavy profile payloads from showing in conversation previews/history.
- Convos profile side channels (`convos.org/profile_update:1.0` and `convos.org/profile_snapshot:1.0`) are the primary name channel. Current Convos iOS unifies name/member kind by inbox locally while avatars remain conversation-encrypted; Converge applies the same wire precedence (`update > snapshot > appData > contact`) with source timestamps so stale history cannot replace a newer self-authored name.
- A local name such as "Orange Orca" is published when a group becomes active, before group sends, and after an explicit profile save. Legacy compressed `group.appData` profiles remain readable as a lower-authority fallback, but profile publication does not rewrite that shared metadata blob.
- Compressed Convos appData accepts both current iOS raw-DEFLATE bodies and zlib-wrapped bodies from other tooling. Empty direct profile updates clear only the scoped `connections`/`timezone` metadata keys.
- New groups and every successful member addition/invite approval publish a current-roster `profile_snapshot`, allowing the new MLS member to learn names that were sent before it joined.
- Snapshot application checks the current XMTP roster rather than only cached membership, so a newly added member's profile is retained even when the profile message races the local membership event.
- Profile codecs and stored group members preserve `memberKind` plus typed string/number/bool metadata, so named Convos agents remain identifiable across updates and snapshots. Group Settings marks kind `1` as a generic agent declaration; cryptographic Convos agent-attestation verification is not implemented yet.
- Single-peer Convos groups use the peer's resolved profile name in chat lists, headers, message labels, typing text, and mentions instead of leaving the conversation titled "Chat".

## Group Management
- Group Info is available from the chat header and overflow menu to every participant. It leads with the current participant count and roster; admins additionally get metadata, permission, invite/removal, and promotion controls.
- Group metadata and membership are refreshed from authoritative XMTP group state after every group update. Normal sync also repairs older group conversations that were accidentally stored as DM-shaped records, and remote metadata clears remove stale local values.
- Group settings expose metadata editing for name, image, and description alongside XMTP permission updates, member invites/removals, and admin promotions/demotions.
- Join policy options map to XMTP permission policies (members, admins, super admins, closed) with descriptive guidance, while group avatar uploads are downscaled to fit XMTP metadata limits.
- Group creation uses XMTP identifier-based APIs (address identifiers) so new groups are real network conversations, and membership-change events trigger group refreshes to surface newly joined groups promptly.
- Member diagnostics in group settings validate that all members have XMTP identity updates, highlighting invalid or unknown members that can break invite approvals.

## Experimental XMTP Alerts Over Web Push
- Push enablement checks browser capabilities, requests Notification permission, registers the service worker, and creates or reuses one app/browser `PushSubscription` using the vapid.party VAPID public key.
- Browser subscription setup resolves the exact root service-worker registration and waits for that registration to activate, validates the VAPID key before handing it to `PushManager`, and shares one in-flight provider request across repeated clicks. Replacing an older VAPID subscription uses bounded retry/backoff for Chromium's asynchronous provider cleanup race.
- If Chromium's root registration has origin-specific stale provider state, Converge retries on a VAPID-key-versioned recovery scope. This creates a fresh service-worker registration identity without clearing the inbox keys, IndexedDB, XMTP OPFS database, messages, or contacts. Superseded subscriptions are cleaned up only after the replacement endpoint is safely registered and stored.
- A browser push-provider failure is reported separately from a vapid.party relay failure. Until `PushManager.subscribe()` returns an endpoint, Converge sends no inbox, installation, topic, or subscription data to vapid.party.
- Brave-specific provider errors are detected through `navigator.brave` and distinguish the site's display permission from Brave's separate browser-wide Web Push provider. The recovery copy asks the user to verify **Use Google services for push messaging** and then fully quit/relaunch Brave. Websites cannot read that setting; site permission can remain granted, and already visible app, native, or extension notifications do not prove that Brave will accept a new origin subscription.
- Converge caches one logical relay registration per loaded inbox/installation on the shared physical endpoint. Only the active inbox is connected; inactive inboxes reuse their last cached registration material.
- Before collecting active-inbox topics, Converge syncs the XMTP conversation list and preferences, then includes Allowed and Unknown conversations, including every backing group of stitched/duplicate DMs. Denied conversations are excluded.
- Browser SDK 6.1.2 exposes bare 16-byte MLS group IDs as 32 hex characters. Converge canonicalizes them as `/xmtp/mls/1/g-<32-hex-group-id>/proto`, merges every distinct HMAC epoch returned per conversation, and adds `/xmtp/mls/1/w-<64-hex-installation-id>/proto` as the deterministic no-HMAC welcome topic.
- Topic snapshots refresh after active-inbox sync/conversation changes and on XMTP HMAC-key or consent updates. Refreshes are debounced, serialized, and coalesced per inbox/installation while preserving one trailing newest snapshot, so a slow relay POST cannot drop a later key rotation. Each release also performs one build-aware bootstrap refresh, repairing registrations created by an older topic normalizer. Disable and Burn invalidate stale work synchronously, abort active relay requests, and are never held behind a notification permission prompt.
- Push config is public-only: `VITE_VAPID_PARTY_API_BASE` and optional `VITE_VAPID_PUBLIC_KEY`. Converge remains a static PWA with no backend.
- The relay payload contains only the push type and opaque inbox handle. The service worker maps that handle to a locally cached profile name, shows copy such as "New activity for Orange Orca," and stores an approximate per-inbox activity hint. The switcher renders that hint as a dot without opening or syncing the inactive inbox.
- Notification clicks discard relay-supplied navigation and always open/focus the Converge root. They do not switch inboxes; selecting the dotted inbox performs the XMTP sync and determines the real unread state.
- The version-1 vapid.party compatibility contract is explicitly scoped to app ID `converge.cv`. Converge uses the standard Web Push API without browser-specific request branches, while vapid.party restricts public registrations to known FCM, Mozilla, Apple, and WNS provider endpoints. XMTP topic/HMAC registration is the generic logical layer; other apps or delivery adapters require their own app-scoped authenticated contract and are not silently added to Converge's public route.
- The vapid.party contract supports public VAPID lookup, one active route per app/inbox/installation with a replaceable shared browser endpoint, logical deletion, authenticated minimal opaque delivery metadata, and a coarse public health response. Its deployed Cloudflare-only runtime uses a Worker, D1 registration bridge, delivery Queue, and singleton Container XMTP listener. Registration success alone never changes delivery readiness to ready.
- Live verification covers two logical inboxes sharing one browser endpoint, deterministic welcome and canonical group topics, multiple HMAC epochs, duplicate and `shouldPush:false` suppression, independent logical deletion, a genuine XMTP production welcome, a genuine inbound group message, recipient-own-message suppression, opaque activity, and local-only notification copy.
- Enabling push no longer forces a page reload (service worker takeover should not disconnect wallet-backed identities).
- Clearing only cached app/network resources preserves notification service-worker registrations and the browser subscription. Notification state is removed only through explicit Disable Notifications or a separately confirmed destructive data wipe.
- Notification setup results remain visible inline in Settings and Debug instead of relying on transient browser alerts. The Debug Push Trace separately reports site permission, service-worker activation, browser provider subscription, local group/HMAC/welcome counts, capability-verified relay counts, listener/bridge readiness, last XMTP match, provider acceptance, and the last service-worker receipt. A generic healthy Worker response is shown as unknown, not ready.
- Push Trace can force a current-inbox topic re-registration without the startup cooldown, test local service-worker notification display, and send a bounded relay diagnostic to exactly the current logical registration. Relay management capability receipts remain in IndexedDB, are sent only in an `Authorization` header for refresh, deletion, and fixed no-store diagnostic paths, and are never displayed or logged. A capability conflict stops without an unauthenticated retry. Diagnostic pushes are labelled and never create inbox activity hints.
- Disabling notifications attempts to delete every cached inbox/installation relay record before unsubscribing the shared endpoint. Failed relay deletions remain as local tombstones for later cleanup; the app-level status reports expected versus registered inboxes.
- Relay requests, including response parsing, are bounded to five seconds. If a relay POST succeeds but final local persistence fails, Converge keeps the working route and browser subscription, retains its management capability in a pending-registration recovery record, and retries the same upsert without deleting the route. Explicit Disable, Burn, or supersession still deletes the intended route and retains a pending-deletion tombstone if cleanup fails.
- Delivery remains experimental because XMTP `SubscribeAll` has no replay cursor: a listener restart or disconnect can miss an approximate push hint, while XMTP inbox sync remains authoritative when Converge opens. Installed-PWA and mobile reliability are not yet characterized.

## Local-First Operation
- Conversation lists, messages, profiles, and inbox-scoped data are persisted in IndexedDB (via Dexie); the small cross-inbox registry is stored in localStorage so the switcher can choose a namespace before opening it.
- Incoming streams apply updates to the local store first, then reconcile with the network by explicitly syncing conversations; resync tools clear and repopulate local caches when needed. Disconnect ends the Browser SDK `AsyncStreamProxy` with its asynchronous `end()` API before closing the client.
- Private keys, mnemonics, decrypted app data, and the Browser SDK database are stored locally without encryption at rest. Keyfile exports are plaintext sensitive material.
- New identities use inbox-aware XMTP database paths; legacy identities retain their existing address-based path to avoid installation churn during migration.
- Recent history backfill deduplicates stored messages, preserves read state for existing threads, and narrows sync windows using per-conversation timestamps to avoid replaying old messages as unread.

## Static Hosting and PWA Polish
- The app is delivered as static HTML/CSS/JS through Cloudflare Workers Static Assets. Cloudflare provides native SPA fallback, immutable hashed-asset caching, and a no-cache root service worker; offline app-shell precaching and install/update prompts remain disabled while XMTP stability work continues.
- Mobile-friendly styles and responsive layout primitives keep the experience app-like on phones, with viewport-safe spacing and touch-target sizing.
- Keyboard-open behavior in mobile PWA mode now uses VisualViewport-driven app height and fully removes the bottom nav from layout while typing, with a focused-input viewport-baseline fallback so iOS/PWA keyboard states still hide nav even when `innerHeight` tracks `visualViewport.height`.

## Debug and Diagnostics
- The `/debug` console aggregates logs, XMTP network events, and runtime errors with tools for clearing caches, inspecting storage, and managing push notifications.
- Push Trace highlights the specific break point in browser display, relay registration, XMTP topic matching, or Web Push delivery. A welcome-only registration is flagged when the loaded inbox has conversations, and local versus relay topic/HMAC counts are compared directly.
- Messages sent by another installation of the recipient's same XMTP inbox are intentionally sender-suppressed; ordinary notification tests must originate from a different inbox.
- A "Claim Invite Code" tool accepts Convos invite links or raw codes (including current `https://popup.convos.org/v2?i=...` links), extracts the creator inbox ID from the signed invite payload, and sends a Convos `convos.org/join_request:1.0` DM to request access.

## Group Invites (Convos-Compatible)
- Group chat menus can generate Convos-compatible invite codes and provide one-click copy buttons for the Convos link, Converge link, or raw invite slug.
- Generated invites embed an encrypted conversation token (ChaCha20-Poly1305 + HKDF) and a signed payload using the creator’s secp256k1 key, mirroring Convos’ signed invite format.
- Invite tag storage now prefers Convos’ current channel (`group.updateAppData`) and preserves legacy description-based metadata as a fallback for older groups.
- Incoming DM messages containing Convos `join_request` payloads or legacy valid invite codes are intercepted and queued for creator approval; typed requester names are retained, and accepted requests verify the signature, decrypt the conversation token, add the sender, and publish the post-join profile snapshot.
- Wallet-based identities without a local key can still generate invites by approving a wallet signature that derives the invite signing/encryption key for the session.
- Invite requests show as a readable system message stub (group name/tag/expiry) instead of raw base64, with follow-up system notices for acceptance or failure.
- Invite requests are surfaced even when the DM consent state is unknown by scanning DMs on connect and periodically, then dispatching synthetic message events for valid invite slugs.
- Invite approvals now present a modal with group details and requester reputation (Farcaster stats when available), letting the creator explicitly accept or decline before any wallet signature prompt appears.
- Invite request messages include inline Accept/Reject/Review actions so admins can act directly from chat history or open the detailed review modal later.
- Invite approvals that require a wallet signature now reuse the connected wallet signer (prompting for a signature) instead of silently failing when the signer is missing.
- Wallet-signed invite approvals now derive a stable invite key from the wallet public key, preventing verification failures from non-deterministic signatures.
- Wallet-derived invite keys are now persisted per device so approvals work across reloads; if the key isn’t present, the app can re-derive it via a wallet signature.
- Invite approvals now retry a conversation sync before failing if the target group isn’t immediately available locally.
- Invite approvals now force a full conversation sync (plus listGroups fallback) before giving up on missing groups.
- Invite approvals normalize UUID-style group IDs (strip dashes) so Convos-formatted invites can match XMTP group IDs.
- Invite links opened by new users now return to the invite claim flow after onboarding (including wallet-connect flows that reload) and auto-send the request so the link only needs to be tapped once.
- Invite codes no longer embed group avatars to keep Convos invite links short and compatible with their handler.
- Invite creation and approval now validate that all group members have XMTP identity updates; invalid members block invites to prevent XMTPiOS “SequenceId not found in local db” sync errors.

## Farcaster + Neynar Integration
- Users can supply a Neynar API key (or rely on the user-provided built-in client key) from Settings for optional Farcaster identity/reputation lookup.
- Converge does not bulk-sync a Farcaster following list into the private contact projection. Farcaster data enriches an already relevant peer rather than acting as a cross-device contact source.
- Contact cards surface Farcaster links alongside Neynar scores, follower/following counts, and power badge badges when available.
- Farcaster settings configure optional Neynar score/follower/power-badge message thresholds; filters apply globally across conversations.
- The contacts list highlights Farcaster-derived entries and shows their Neynar score so users can gauge trust at a glance.
- Browser Neynar lookups use a failure cooldown: CORS/network failures temporarily disable further Neynar calls, verification 404s are cached per address, and Converge no longer retries the legacy Neynar fallback URL from the static PWA.

## Unified Contact Card
- **Identity Fusion**: The contact card serves as the central hub for merging a user's fragmentation across web3. It resolves and displays:
  - **Farcaster Identity**: Fetches real-time profile data (username, PFP, bio, follower counts, badges) via Neynar.
  - **ENS**: Resolves primary ENS names (e.g., `dean.eth`) for Ethereum addresses.
  - **XMTP Inbox**: Resolves the canonical, network-derived Inbox ID (v3 identity) instead of relying on raw Ethereum addresses.
- **Published Profile Precedence**: The peer's XMTP/Convos published name/avatar takes precedence. Farcaster and ENS remain secondary linked identities and reputation signals.
- **Live Refresh**: A dedicated "Refresh" action re-resolves the canonical XMTP inbox/profile and can refresh optional Farcaster/ENS metadata without creating private overrides.
- **Trust Indicators**: Displays critical reputation signals like the Farcaster Power Badge and Neynar user score directly on the card, helping users make informed decisions about who they are messaging.
