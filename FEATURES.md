# Features and Specifications

## One-Click Onboarding and Inbox Switching
- Landing flow keeps the experience minimal by defaulting to a single-step landing view and switching into wallet selection when the user arrives with `?connect=1` (e.g., from the inbox switcher).
- Registry hydration runs on load so previously used inboxes are listed with last-opened timestamps and buttons to reopen them without re-onboarding.
- Wallet connect, probing, and keyfile import are unified under a single `view` state machine (`'landing' | 'wallet' | 'probing' | 'results' | 'processing' | 'keyfile'`) so all entry points share status messaging and error handling.
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
- Image attachments can be picked from the paper-clip button, encrypted client-side, uploaded to IPFS via Thirdweb storage, and sent over XMTP RemoteAttachment with inline image rendering and local IndexedDB caching.

## Conversation Controls
- Conversation menus include contact management (add, block/unblock) and mute/unmute toggles that flip based on the current mutedUntil timestamp.
- A destructive “Delete conversation” option removes the thread locally and navigates back to the inbox to prevent resurface during resyncs.

## Profile Sharing and Enrichment
- Incoming `cv:profile` payloads embedded in messages are parsed to update contact display names and avatars, preferring the inline payload over fetched profiles while avoiding blocked or deleted peers.
- Profile fetches are throttled to a five-minute window per contact to reduce redundant network calls while still refreshing stale records.
- Identity/profile lookups honor rate-limit backoff signals (429/resource exhausted) by pausing XMTP identity API calls for an adaptive cooldown and falling back to minimal profiles until the cooldown clears.

## Group Management
- Group settings expose metadata editing for name, image, and description alongside XMTP permission updates, member invites/removals, and admin promotions/demotions.
- Join policy options map to XMTP permission policies (members, admins, super admins, closed) with descriptive guidance, while group avatar uploads are downscaled to fit XMTP metadata limits.
- Group creation uses XMTP identifier-based APIs (address identifiers) so new groups are real network conversations, and membership-change events trigger group refreshes to surface newly joined groups promptly.

## Web Push Notifications
- Push enablement checks browser capabilities, requests Notification permission, registers the service worker, subscribes with PushManager using the VAPID public key, and sends the subscription to vapid.party with optional user/channel identifiers.
- Enabling push no longer forces a page reload (service worker takeover should not disconnect wallet-backed identities).
- Helpers report errors for unsupported environments, allow permission status checks, and expose unsubscribe helpers to cleanly remove push subscriptions.

## Local-First Operation
- Conversation lists, messages, profiles, and inbox registry entries are persisted in IndexedDB (via Dexie) so reopening the app immediately restores history without waiting for the network.
- Incoming streams apply updates to the local store first, then reconcile with the network by explicitly syncing conversations; resync tools clear and repopulate local caches when needed.
- Identity keys are stored on-device and reused via deterministic XMTP client paths, enabling consistent installs without server-side custody or cloud backups.

## Static Hosting and PWA Polish
- The app is delivered as static HTML/CSS/JS through GitHub Pages and uses Workbox-powered vite-plugin-pwa to precache the shell for quick reloads.
- Mobile-friendly styles, responsive layout primitives, and install prompts keep the experience "app-like" on phones, with viewport-safe spacing and touch-target sizing to match PWA expectations.

## Debug and Diagnostics
- The `/debug` console aggregates logs, XMTP network events, and runtime errors with tools for clearing caches, inspecting storage, and managing push notifications.
- A "Claim Invite Code" tool accepts Convos invite links or raw codes, extracts the creator inbox ID from the signed invite payload, and sends the sanitized invite slug via XMTP DM to request access.

## Group Invites (Convos-Compatible)
- Group chat menus can generate Convos-compatible invite codes and provide one-click copy buttons for the Convos link, Converge link, or raw invite slug.
- Generated invites embed an encrypted conversation token (ChaCha20-Poly1305 + HKDF) and a signed payload using the creator’s secp256k1 key, mirroring Convos’ signed invite format.
- Incoming DM messages containing valid invite codes are intercepted: signatures are verified, the conversation token is decrypted, and the sender is added to the target group automatically.
- Wallet-based identities without a local key can still generate invites by approving a wallet signature that derives the invite signing/encryption key for the session.
- Invite requests show as a readable system message stub (group name/tag/expiry) instead of raw base64, with follow-up system notices for acceptance or failure.

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
