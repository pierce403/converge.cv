# Features and Specifications

## One-Click Onboarding and Inbox Switching
- Landing flow keeps the experience minimal by defaulting to a single-step landing view and switching into wallet selection when the user arrives with `?connect=1` (e.g., from the inbox switcher).
- Registry hydration runs on load so previously used inboxes are listed with last-opened timestamps and buttons to reopen them without re-onboarding.
- Wallet connect, probing, and keyfile import are unified under a single `view` state machine (`'landing' | 'wallet' | 'probing' | 'results' | 'processing' | 'keyfile'`) so all entry points share status messaging and error handling.
- Wallet-based XMTP signing requests are deduplicated and cached per challenge, with expiry-aware refresh so reconnect flows avoid repeated wallet signature popups.
- While waiting on an external wallet signature, a blocking modal clearly indicates the app is waiting, shows the wallet provider, request preview, and elapsed wait time until approval/rejection.
- Switching inboxes surfaces step-by-step status banners (closing current inbox, preparing storage, loading the target inbox, reloading) so users see progress while the app swaps namespaces.
- The identity switcher includes a profile card that previews display name and avatar, lets users update and publish changes to XMTP, resync profile details from the network, and surface a QR code for sharing the current address without leaving the modal.
- Deep links like `/u/:userId` (ENS/address) and `/i/:inboxId` open a DM composer when already signed in, or route through onboarding and then return to the target.
- Wallet connections are provider-aware: users can switch between Native (MetaMask/Coinbase/WalletConnect), Thirdweb (standard Thirdweb Connect modal), and Privy (embedded/external wallets) from onboarding or Settings, with the choice persisted locally.
- Privy and Thirdweb fall back to baked-in app/client IDs when env vars are missing (`VITE_PRIVY_APP_ID`, `VITE_THIRDWEB_CLIENT_ID`).
- Settings reconnect for native wallets mirrors onboarding by showing explicit wallet choices instead of auto-connecting a default.

### Inbox Switcher Isolation
- Each inbox selection (e.g., personal vs. work) loads a distinct XMTP identity and IndexedDB storage namespace so conversations, contacts, drafts, and keys never leak across inboxes.
- Switching inboxes triggers a full teardown of the current client/session, rehydrates the registry list, and reopens the selected identity with its own cached message history.
- The switcher UI lists available inboxes with their last-opened time, displays connection status per entry, and provides an explicit "Add new inbox" path that reuses the single-step onboarding flow.
- Inbox IDs are normalized when stored and matched so namespace switches persist across reloads instead of snapping back to the previous identity.
- A destructive burn action lives inside the inbox switcher, wiping the current identity’s keys plus its local messages and contacts on this device.

## Messaging Experience
- Message bubbles support long-press/right-click actions (reply, copy, delete, forward placeholder) via a modal, and maintain sent/read state indicators for pending/sent/delivered/failed statuses.
- Inline replies render a quoted header that resolves the referenced message body when available, while normal text is linkified so URLs open in a new tab.
- Reactions are grouped and pinned to the bottom of each bubble with counts, aligning left/right based on message ownership.
- Composer controls now keep the send button vertically centered with the message textarea at one-line height on mobile/PWA, preventing a bottom-offset send button.
- Image attachments can be picked from the paper-clip button, encrypted client-side, uploaded to IPFS via Thirdweb storage, and sent over XMTP RemoteAttachment with inline image rendering and local IndexedDB caching.
- Group chat composer supports @-mentions with live member suggestions; mentions render inline with highlight styling and incoming messages that mention you are visually emphasized.
- Conversations load the most recent messages first and lazily prepend older history only when the user scrolls upward, keeping large threads fast while preserving full local storage history.
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
- Sending a group message now performs a best-effort upsert of the sender’s Convos-style profile (name + URL avatar) into group appData so Convos clients can discover Converge profile updates.

## Group Management
- Group settings expose metadata editing for name, image, and description alongside XMTP permission updates, member invites/removals, and admin promotions/demotions.
- Join policy options map to XMTP permission policies (members, admins, super admins, closed) with descriptive guidance, while group avatar uploads are downscaled to fit XMTP metadata limits.
- Group creation uses XMTP identifier-based APIs (address identifiers) so new groups are real network conversations, and membership-change events trigger group refreshes to surface newly joined groups promptly.
- Member diagnostics in group settings validate that all members have XMTP identity updates, highlighting invalid or unknown members that can break invite approvals.

## Web Push Notifications
- Push enablement checks browser capabilities, requests Notification permission, registers the service worker, subscribes with PushManager using the VAPID public key, and sends the subscription to vapid.party with optional user/channel identifiers.
- Enabling push no longer forces a page reload (service worker takeover should not disconnect wallet-backed identities).
- Helpers report errors for unsupported environments, allow permission status checks, and expose unsubscribe helpers to cleanly remove push subscriptions.

## Local-First Operation
- Conversation lists, messages, profiles, and inbox registry entries are persisted in IndexedDB (via Dexie) so reopening the app immediately restores history without waiting for the network.
- Incoming streams apply updates to the local store first, then reconcile with the network by explicitly syncing conversations; resync tools clear and repopulate local caches when needed.
- Identity keys are stored on-device and reused via deterministic XMTP client paths, enabling consistent installs without server-side custody or cloud backups.
- Recent history backfill deduplicates stored messages, preserves read state for existing threads, and narrows sync windows using per-conversation timestamps to avoid replaying old messages as unread.

## Static Hosting and PWA Polish
- The app is delivered as static HTML/CSS/JS through GitHub Pages and uses Workbox-powered vite-plugin-pwa to precache the shell for quick reloads.
- Mobile-friendly styles, responsive layout primitives, and install prompts keep the experience "app-like" on phones, with viewport-safe spacing and touch-target sizing to match PWA expectations.
- Keyboard-open behavior in mobile PWA mode now uses VisualViewport-driven app height and fully removes the bottom nav from layout while typing, with a focused-input viewport-baseline fallback so iOS/PWA keyboard states still hide nav even when `innerHeight` tracks `visualViewport.height`.

## Debug and Diagnostics
- The `/debug` console aggregates logs, XMTP network events, and runtime errors with tools for clearing caches, inspecting storage, and managing push notifications.
- A "Claim Invite Code" tool accepts Convos invite links or raw codes, extracts the creator inbox ID from the signed invite payload, and sends the sanitized invite slug via XMTP DM to request access.

## Group Invites (Convos-Compatible)
- Group chat menus can generate Convos-compatible invite codes and provide one-click copy buttons for the Convos link, Converge link, or raw invite slug.
- Generated invites embed an encrypted conversation token (ChaCha20-Poly1305 + HKDF) and a signed payload using the creator’s secp256k1 key, mirroring Convos’ signed invite format.
- Invite tag storage now prefers Convos’ current channel (`group.updateAppData`) and preserves legacy description-based metadata as a fallback for older groups.
- Incoming DM messages containing valid invite codes are intercepted and queued for creator approval; accepted requests verify the signature, decrypt the conversation token, and add the sender to the target group.
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

## Unified Contact Card
- **Identity Fusion**: The contact card serves as the central hub for merging a user's fragmentation across web3. It resolves and displays:
  - **Farcaster Identity**: Fetches real-time profile data (username, PFP, bio, follower counts, badges) via Neynar.
  - **ENS**: Resolves primary ENS names (e.g., `dean.eth`) for Ethereum addresses.
  - **XMTP Inbox**: Resolves the canonical, network-derived Inbox ID (v3 identity) instead of relying on raw Ethereum addresses.
- **Smart Resolution & Fallback**: When viewing a contact, the system attempts to "upgrade" the identity from a simple address to a rich profile. If a Farcaster profile is found, it takes precedence for display (name/avatar), while the ENS name remains visible as a secondary identifier.
- **Live Refresh**: A dedicated "Refresh" action forces a re-verification of the identity against the network. This pulls the latest Farcaster stats (score, badges) and strictly resolves the XMTP Inbox ID, ensuring the contact record is always up-to-date and uses the correct, modern XMTP identifiers.
- **Trust Indicators**: Displays critical reputation signals like the Farcaster Power Badge and Neynar user score directly on the card, helping users make informed decisions about who they are messaging.
