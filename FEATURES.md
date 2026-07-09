# Features and Specifications

## Onboarding, Device Keys, and Inbox Switching
- Empty-browser startup now opens an explicit choice instead of auto-registering a generated key.
- Create new Converge inbox remains one click: Converge generates a secp256k1 local account key, uses the SDK's inbox-aware database path, registers a new XMTP inbox/installation, and opens the app without a passphrase.
- Generated local keys receive the deterministic Color Animal display-name suggestion used by personalization; legacy generated labels remain replaceable.
- Restore from keyfile reuses the exact private key or mnemonic. It does not create a separate per-device account key. On a browser without the XMTP database, the same account resolves to the same inbox and registers a new installation.
- Add this device to existing inbox generates a fresh local account key only after the user chooses a wallet-controlled inbox. It never registers that fresh key as a temporary standalone inbox.
- Wallet probing uses the XMTP identity ledger rather than treating the prospective `Client.inboxId` as proof of registration.
- The wallet signer registers or reuses one inbox-aware browser installation, the fresh unregistered key is associated with `unsafe_addAccount(..., true)`, and the final local-key client must reopen the same inbox and installation before onboarding succeeds.
- Converge statically verifies that the fresh key has no existing inbox. A registered key is never moved by the normal UI; reassignment would strand its prior inbox and is refused.
- If the target is at the 10-installation limit, onboarding and Settings block before association and offer signer-authorized one-installation recovery. The destructive step refetches live state and stops if another device already freed capacity.
- Smart-wallet provisioning and recovery retry XMTP's originally registered nonzero SCW chain ID when reported. Legacy chain ID `0` remains blocked with instructions to use an already-connected XMTP device.
- A newly registered installation sends `sendSyncRequest()`. The UI explains that an older device must be online and that sharing an inbox ID does not guarantee restored decrypted history.
- New identities use the SDK default `xmtp-production-<inbox-id>.db3` path. Existing records without a migration marker keep their legacy address path so a normal reload does not create an extra installation.
- Every successful connection persists the live final installation ID. Installation revocation stays disabled unless that ID is present in a refreshed inbox state.
- Pending provisioning keys are persisted before identity-ledger mutation and resumed after interruption; failed Settings/switcher attempts restore the previously active identity and namespace.
- Registry hydration lists previously used inboxes with last-opened timestamps. Switching inboxes tears down the client, swaps the app-data namespace, and reopens the selected local identity.
- Wallet providers remain selectable between Native, Thirdweb, and Privy. Wallet approval is authority for an existing inbox, not the default long-term message signer.
- Deep links return through the chosen onboarding flow and then resume the target route.

### Inbox Switcher Isolation
- Each inbox selection (e.g., personal vs. work) loads a distinct XMTP identity and IndexedDB storage namespace so conversations, contacts, drafts, and keys never leak across inboxes.
- Switching inboxes triggers a full teardown of the current client/session, rehydrates the registry list, and reopens the selected identity with its own cached message history.
- The switcher UI lists available inboxes with their last-opened time, displays connection status per entry, and provides explicit paths to create another inbox or add a fresh browser key to an existing wallet-controlled inbox.
- Inbox IDs are normalized when stored and matched so namespace switches persist across reloads instead of snapping back to the previous identity.
- A destructive burn action lives inside the inbox switcher, wiping the current identity’s keys plus its local messages and contacts on this device.

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
- `canMessageWithInbox` now resolves and returns the canonical inbox ID in one pass, so background contact sync avoids separate inbox-derivation and can-message network calls.
- DM creation, message send preflight, conversation cleanup canonicalization, and contacts refresh all route through the shared resolver path instead of chained fallback lookups.
- Contact Details refresh now prefers Farcaster `display_name` (human display name) over Farcaster username/fname when updating Converge contact display names, with username only as fallback.
- Contact Details refresh now persists the resolved display label across reopen cycles by preventing follow-up identity upserts from overwriting the refreshed name with stale placeholder metadata.
- Legacy/stray text profile payloads are now recognized and consumed as metadata (not chat bubbles), preventing base64-heavy profile payloads from showing in conversation previews/history.
- Group conversations now read Convos profile metadata from XMTP `group.appData` (including compressed Convos payloads), hydrating member display names/avatars in chat and group settings where available.
- Convos profile side channels (`convos.org/profile_update:1.0` and `convos.org/profile_snapshot:1.0`) are registered with the XMTP SDK, consumed silently, and used to hydrate contact/member display names without rendering metadata bubbles.
- Sending a group message, reply, or attachment now publishes a silent Convos `profile_update` and best-effort upserts the sender’s merged Convos profile (name + URL avatar, preserving encrypted image and connections fields) into group appData so Convos clients can discover Converge profile updates.

## Group Management
- Group settings expose metadata editing for name, image, and description alongside XMTP permission updates, member invites/removals, and admin promotions/demotions.
- Join policy options map to XMTP permission policies (members, admins, super admins, closed) with descriptive guidance, while group avatar uploads are downscaled to fit XMTP metadata limits.
- Group creation uses XMTP identifier-based APIs (address identifiers) so new groups are real network conversations, and membership-change events trigger group refreshes to surface newly joined groups promptly.
- Member diagnostics in group settings validate that all members have XMTP identity updates, highlighting invalid or unknown members that can break invite approvals.

## Web Push Notifications
- Push enablement checks browser capabilities, requests Notification permission, registers the service worker, subscribes with PushManager using the vapid.party VAPID public key, and sends a versioned XMTP registration payload directly to vapid.party.
- The registration payload includes the Web Push subscription, current XMTP inbox ID, installation ID, and locally exposed conversation HMAC topic keys from `client.conversations.hmacKeys()`; it does not include plaintext message content or any client-side vapid.party API key.
- Push config is public-only: `VITE_VAPID_PARTY_API_BASE` and optional `VITE_VAPID_PUBLIC_KEY`. Converge remains a static PWA with no backend.
- The service worker shows generic visible notifications such as "New encrypted message", preserves same-origin click URLs, and focuses/opens the app so XMTP sync/decryption happens locally.
- End-to-end push delivery still requires vapid.party to ship the XMTP-aware public endpoints documented in `ARCHITECTURE.md`; do not present live push delivery as complete until a real relay test passes.
- Enabling push no longer forces a page reload (service worker takeover should not disconnect wallet-backed identities).
- Helpers report errors for unsupported environments, allow permission status checks, and expose unsubscribe helpers to cleanly remove push subscriptions.

## Local-First Operation
- Conversation lists, messages, profiles, and inbox registry entries are persisted in IndexedDB (via Dexie) so reopening the app immediately restores history without waiting for the network.
- Incoming streams apply updates to the local store first, then reconcile with the network by explicitly syncing conversations; resync tools clear and repopulate local caches when needed.
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
- Incoming DM messages containing Convos `join_request` payloads or legacy valid invite codes are intercepted and queued for creator approval; accepted requests verify the signature, decrypt the conversation token, and add the sender to the target group.
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
- Users can supply a Neynar API key (or rely on a built-in default) from Settings to unlock Farcaster-aware features.
- Contacts now include a Farcaster sync action when a Neynar key is present, importing followed accounts with usernames, FIDs, scores, follower stats, and power badge metadata.
- Contact cards surface Farcaster links alongside Neynar scores, follower/following counts, and power badge badges when available.
- A Farcaster settings panel allows saving the user’s FID and configuring Neynar score/follower/power-badge thresholds that hide incoming messages failing those criteria; filters apply globally across conversations.
- The contacts list highlights Farcaster-derived entries and shows their Neynar score so users can gauge trust at a glance.
- Browser Neynar lookups use a failure cooldown: CORS/network failures temporarily disable further Neynar calls, verification 404s are cached per address, and Converge no longer retries the legacy Neynar fallback URL from the static PWA.
- Automatic self-profile Farcaster refresh honors its hourly cooldown even when the profile is incomplete, and skips ENS/API fallbacks entirely unless `VITE_FARCASTER_API_BASE` is configured.

## Unified Contact Card
- **Identity Fusion**: The contact card serves as the central hub for merging a user's fragmentation across web3. It resolves and displays:
  - **Farcaster Identity**: Fetches real-time profile data (username, PFP, bio, follower counts, badges) via Neynar.
  - **ENS**: Resolves primary ENS names (e.g., `dean.eth`) for Ethereum addresses.
  - **XMTP Inbox**: Resolves the canonical, network-derived Inbox ID (v3 identity) instead of relying on raw Ethereum addresses.
- **Smart Resolution & Fallback**: When viewing a contact, the system attempts to "upgrade" the identity from a simple address to a rich profile. If a Farcaster profile is found, it takes precedence for display (name/avatar), while the ENS name remains visible as a secondary identifier.
- **Live Refresh**: A dedicated "Refresh" action forces a re-verification of the identity against the network. This pulls the latest Farcaster stats (score, badges) and strictly resolves the XMTP Inbox ID, ensuring the contact record is always up-to-date and uses the correct, modern XMTP identifiers.
- **Trust Indicators**: Displays critical reputation signals like the Farcaster Power Badge and Neynar user score directly on the card, helping users make informed decisions about who they are messaging.
