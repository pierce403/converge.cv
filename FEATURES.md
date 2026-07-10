# Features and Specifications

## Multi-Inbox Product Model

This section describes the multi-inbox behavior shipped on 2026-07-10. Later
implementation notes add protocol detail but must not contradict this product
model.

### First Run And Profiles

- On a true first visit, Converge automatically generates a local account key, registers a new XMTP inbox and installation, then opens the existing profile editor before contacts or messages.
- The profile editor starts with the deterministic Color Animal name, supports avatar upload, and is dismissible. Dismissing it keeps the generated profile.
- Creating another inbox later immediately switches to it and opens the same profile editor.
- An intentionally empty state is different from first run. After burning the last loaded inbox, Converge returns to empty onboarding and does not automatically create a replacement.

### Inbox Accounts And Switching

- The top-left control is an Inbox Switcher. It has one entry per loaded XMTP inbox, not one entry per associated account key or installation.
- Each inbox is an independent social identity, similar to managing separate brand accounts. Its profile, contacts, consent view, conversations, drafts, attachments, keys, and local caches remain isolated from every other inbox.
- Switcher entries show the inbox profile name and avatar by default. Inbox IDs, account addresses, installation IDs, and key details belong in technical details views.
- Only the selected inbox opens an XMTP client and syncs. Switching fully closes the current client before opening the next inbox.
- Add Inbox offers Create new inbox, Import keyfile, and Add this device to existing inbox.
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
- One browser `PushSubscription` is shared by relay registrations keyed per loaded inbox and installation. Each registration batches that inbox's known XMTP conversation topics.
- Enabling notifications registers every loaded inbox while keeping only the selected inbox connected to XMTP. Disabling notifications deletes every loaded-inbox relay registration before unsubscribing the shared browser endpoint.
- Push for an inactive inbox records an approximate pending-activity hint and lights that inbox in the switcher. It does not connect, sync, or claim an exact unread count until the user selects that inbox.
- Visible notification copy may use the full inbox profile name, for example "New activity for Orange Orca," but does not expose the sender or message body.
- Clicking a notification opens or focuses Converge without automatically switching inboxes. The activity dot remains on the target inbox until the user selects it.
- Delivery remains experimental until the vapid.party routes, topic refresh, and new-conversation welcome-topic coverage pass a live end-to-end test.

## Identity Implementation

- A true first visit automatically creates and verifies the first inbox, then holds the main UI behind the dismissible Color Animal name/avatar editor. A durable marker keeps the intentionally empty post-burn state from being mistaken for first run.
- Create new Converge inbox remains one click: Converge generates a secp256k1 local account key, uses the SDK's inbox-aware database path, registers a new XMTP inbox/installation, and opens the app without a passphrase.
- Generated local keys receive the deterministic Color Animal display-name suggestion used by personalization; legacy generated labels remain replaceable.
- Restore from keyfile reuses the exact private key or mnemonic. It does not create a separate local account key. On a browser without the XMTP database, the same account resolves to the same inbox and registers a new installation.
- Add this device to existing inbox generates a fresh local account key only after the user chooses a wallet-controlled inbox. It never registers that fresh key as a temporary standalone inbox.
- Wallet probing uses the XMTP identity ledger rather than treating the prospective `Client.inboxId` as proof of registration.
- Fresh-client registration uses `client.isRegistered()` instead of fetching nonexistent inbox state. Converge persists the prospective installation before one allowed `register()` call, then requires the signer and normalized installation ID to appear in network inbox state before completing onboarding.
- During wallet-approved device joins, Browser SDK 6.1.2 can finish `register()` before a separate static inbox-state reader observes the installation. Local `isRegistered()` state is not sufficient authorization for the next identity update: Converge polls until the exact manager installation appears in the published inbox state and never calls `unsafe_addAccount` while it is absent. A timeout preserves the pending key and installation for an explicit retry.
- Reload and restore paths never infer registration from `inboxId` presence and never retry `register()` blindly. They pin the persisted installation ID, so a different local installation is rejected rather than silently replacing it. A settled-but-interrupted mutation resumes the same local database; a `register()` no-op or mismatched installation fails with an actionable error.
- The wallet signer registers or reuses one inbox-aware browser installation, the fresh unregistered key is associated with `unsafe_addAccount(..., true)`, and the final local-key client must reopen the same inbox and installation before onboarding succeeds.
- Converge statically verifies that the fresh key has no existing inbox. A registered key is never moved by the normal UI; reassignment would strand its prior inbox and is refused.
- If the target is at the 10-installation limit, onboarding and Settings block before association. Static recovery is offered only to the inbox recovery identity, refetches live state, and revokes only enough confirmed installations to return to 9/10.
- Smart-wallet provisioning and recovery retry XMTP's originally registered nonzero SCW chain ID when reported. Legacy chain ID `0` remains blocked with instructions to use an already-connected XMTP device.
- A newly registered installation sends `sendSyncRequest()`. The UI explains that an older device must be online and that sharing an inbox ID does not guarantee restored decrypted history.
- New identities use the SDK default `xmtp-production-<inbox-id>.db3` path. Existing records without a migration marker keep their legacy address path so a normal reload does not create an extra installation.
- Every successful connection persists the live final installation ID. Installation revocation stays disabled unless that ID is present in a refreshed inbox state.
- Pending provisioning keys are persisted before identity-ledger mutation and resumed after interruption; only a key with a validated private-key/address pair plus both persisted inbox and installation IDs is eligible for new-inbox resume. Incomplete pre-registration attempts are removed instead of trapping later Create New actions.
- A malformed unrelated identity row is preserved for recovery but skipped during identity enumeration, and a failed identity-storage read stops XMTP before it can open a different database path.
- Provisioning exposes explicit registration, installation-membership confirmation, account association, ledger-confirmation, and reopen phases. Interrupted responses resume once the exact mutation becomes visible, and an already-registered pending installation can finish even when the inbox has since reached 10/10 only after that installation is confirmed as a current inbox member.
- If a pending installation remains on the XMTP ledger but its local database now opens a different installation, Converge blocks retry and asks the recovery identity to remove that exact stale installation before touching older devices. Exact recovery never falls back to the oldest device when the stale ID is absent, and pending state is cleared only after fresh ledger reads show the removal.
- Ethereum identifiers are normalized at signer, storage, contact, member-profile, and display boundaries. Repairable missing, uppercase, or repeated prefixes migrate to one lowercase `0x`; invalid 20-byte addresses are rejected.
- Registry hydration collapses legacy account-key rows into one entry per inbox. Switching tears down the client, swaps the app-data namespace, and reopens the selected local identity.
- Wallet providers remain selectable between Native, Thirdweb, and Privy. Wallet approval is authority for an existing inbox, not the default long-term message signer.
- Mobile wallet deep links are owned by the selected connector so its request can resume after returning to Converge. Native, Privy, and Thirdweb connection results carry an account-bound signer into the immediate XMTP continuation instead of waiting for React wallet state to catch up. Approval signatures are bound to the exact selected account, and provider switches preserve the onboarding wallet-approval view.
- A selected wallet option never falls through to a different installed connector. Wallet bytecode checks run concurrently with a five-second bound; if every RPC check fails, Converge asks whether the connected signer is a regular wallet or smart account instead of guessing. The smart-account choice requires the connector's real chain ID.
- Wallet continuation errors remain visible instead of being relabeled as generic connection failures. Thirdweb reconnect uses the address, chain, and account-bound signer delivered by its completion callback rather than a stale render snapshot.
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
- Composer controls now keep the send button vertically centered with the message textarea at one-line height on mobile/PWA, preventing a bottom-offset send button.
- Composer activity sends Convos-compatible `convos.org/typing_indicator:1.0` messages with `shouldPush:false`, and inbound typing indicators are shown transiently without being persisted as chat history.
- Image attachments can be picked from the paper-clip button, encrypted client-side, uploaded to IPFS via Thirdweb storage, and sent over XMTP RemoteAttachment with inline image rendering and local IndexedDB caching.
- Group chat composer supports @-mentions with live member suggestions; mentions render inline with highlight styling and incoming messages that mention you are visually emphasized.
- Conversations load the most recent messages first and lazily prepend older history only when the user scrolls upward, keeping large threads fast while preserving full local storage history.
- Conversation list updates are now idempotent while history is loading: duplicate DM rows are collapsed by conversation ID and canonical peer key so replayed/backfilled message events cannot flood the chat list.
- New inbound conversations are now discovered continuously while connected: XMTP runs a throttled background discovery sync and immediately refreshes the in-memory chat list from IndexedDB after sync writes, so first-time DMs appear without reload/manual resync.
- Read receipts are emitted only for non-self DMs and are throttled by last send time, preventing cross-client metadata spam (for example repeated `{}` rows in xmtp.chat during self-chat testing).
- Desktop-width chat routes now render a persistent split view: conversation list on the left, selected conversation on the right, with mobile behavior unchanged.
- Avatar rendering now prevents raw URL/data payload strings from being printed as text in avatar slots; non-image avatar values are treated as short glyphs only (otherwise initials fallback).

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
- Group settings expose metadata editing for name, image, and description alongside XMTP permission updates, member invites/removals, and admin promotions/demotions.
- Join policy options map to XMTP permission policies (members, admins, super admins, closed) with descriptive guidance, while group avatar uploads are downscaled to fit XMTP metadata limits.
- Group creation uses XMTP identifier-based APIs (address identifiers) so new groups are real network conversations, and membership-change events trigger group refreshes to surface newly joined groups promptly.
- Member diagnostics in group settings validate that all members have XMTP identity updates, highlighting invalid or unknown members that can break invite approvals.

## Experimental Web Push Implementation
- Push enablement checks browser capabilities, requests Notification permission, registers the service worker, and creates or reuses one app/browser `PushSubscription` using the vapid.party VAPID public key.
- Converge caches one logical relay registration per loaded inbox/installation and batches each inbox's locally exposed conversation HMAC topic keys from `client.conversations.hmacKeys()`. Only the active inbox is connected; inactive inboxes reuse their last cached registration material.
- Push config is public-only: `VITE_VAPID_PARTY_API_BASE` and optional `VITE_VAPID_PUBLIC_KEY`. Converge remains a static PWA with no backend.
- The service worker maps an opaque inbox handle to a locally cached profile name, shows copy such as "New activity for Orange Orca," and stores an approximate per-inbox activity hint. The switcher renders that hint as a dot without opening or syncing the inactive inbox.
- Notification clicks preserve same-origin URLs and only open/focus Converge. They do not switch inboxes; selecting the dotted inbox performs the XMTP sync and determines the real unread state.
- End-to-end push delivery still requires vapid.party to ship the XMTP-aware public endpoints documented in `ARCHITECTURE.md`; do not present live push delivery as complete until a real relay test passes.
- Enabling push no longer forces a page reload (service worker takeover should not disconnect wallet-backed identities).
- Disabling notifications attempts to delete every cached inbox/installation relay record before unsubscribing the shared endpoint. Failed relay deletions remain as local tombstones for later cleanup; the app-level status reports expected versus registered inboxes.

## Local-First Operation
- Conversation lists, messages, profiles, and inbox-scoped data are persisted in IndexedDB (via Dexie); the small cross-inbox registry is stored in localStorage so the switcher can choose a namespace before opening it.
- Incoming streams apply updates to the local store first, then reconcile with the network by explicitly syncing conversations; resync tools clear and repopulate local caches when needed. Disconnect ends the Browser SDK `AsyncStreamProxy` with its asynchronous `end()` API before closing the client.
- Private keys, mnemonics, decrypted app data, and the Browser SDK database are stored locally without encryption at rest. Keyfile exports are plaintext sensitive material.
- New identities use inbox-aware XMTP database paths; legacy identities retain their existing address-based path to avoid installation churn during migration.
- Recent history backfill deduplicates stored messages, preserves read state for existing threads, and narrows sync windows using per-conversation timestamps to avoid replaying old messages as unread.

## Static Hosting and PWA Polish
- The app is delivered as static HTML/CSS/JS through GitHub Pages. The current minimal service worker handles push/isolation behavior; offline app-shell precaching and install/update prompts remain disabled while XMTP stability work continues.
- Mobile-friendly styles and responsive layout primitives keep the experience app-like on phones, with viewport-safe spacing and touch-target sizing.
- Keyboard-open behavior in mobile PWA mode now uses VisualViewport-driven app height and fully removes the bottom nav from layout while typing, with a focused-input viewport-baseline fallback so iOS/PWA keyboard states still hide nav even when `innerHeight` tracks `visualViewport.height`.

## Debug and Diagnostics
- The `/debug` console aggregates logs, XMTP network events, and runtime errors with tools for clearing caches, inspecting storage, and managing push notifications.
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
