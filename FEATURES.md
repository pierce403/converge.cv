# Features and Specifications

## One-Click Onboarding and Inbox Switching
- Landing flow keeps the experience minimal by defaulting to a single-step landing view and switching into wallet selection when the user arrives with `?connect=1` (e.g., from the inbox switcher).
- Registry hydration runs on load so previously used inboxes are listed with last-opened timestamps and buttons to reopen them without re-onboarding.
- Wallet connect, probing, and keyfile import are unified under a single `view` state machine (`'landing' | 'wallet' | 'probing' | 'results' | 'processing' | 'keyfile'`) so all entry points share status messaging and error handling.
- Switching inboxes surfaces step-by-step status banners (closing current inbox, preparing storage, loading the target inbox, reloading) so users see progress while the app swaps namespaces.

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

## Conversation Controls
- Conversation menus include contact management (add, block/unblock) and mute/unmute toggles that flip based on the current mutedUntil timestamp.
- A destructive “Delete conversation” option removes the thread locally and navigates back to the inbox to prevent resurface during resyncs.

## Profile Sharing and Enrichment
- Incoming `cv:profile` payloads embedded in messages are parsed to update contact display names and avatars, preferring the inline payload over fetched profiles while avoiding blocked or deleted peers.
- Profile fetches are throttled to a five-minute window per contact to reduce redundant network calls while still refreshing stale records.

## Group Management
- Group settings expose metadata editing for name, image, and description alongside XMTP permission updates, member invites/removals, and admin promotions/demotions.
- Join policy options map to XMTP permission policies (members, admins, super admins, closed) with descriptive guidance, while group avatar uploads are downscaled to fit XMTP metadata limits.

## Web Push Notifications
- Push enablement checks browser capabilities, requests Notification permission, registers the service worker, subscribes with PushManager using the VAPID public key, and sends the subscription to vapid.party with optional user/channel identifiers.
- Helpers report errors for unsupported environments, allow permission status checks, and expose unsubscribe helpers to cleanly remove push subscriptions.

## Local-First Operation
- Conversation lists, messages, profiles, and inbox registry entries are persisted in IndexedDB (via Dexie) so reopening the app immediately restores history without waiting for the network.
- Incoming streams apply updates to the local store first, then reconcile with the network by explicitly syncing conversations; resync tools clear and repopulate local caches when needed.
- Identity keys are stored on-device and reused via deterministic XMTP client paths, enabling consistent installs without server-side custody or cloud backups.

## Static Hosting and PWA Polish
- The app is delivered as static HTML/CSS/JS through GitHub Pages and uses Workbox-powered vite-plugin-pwa to precache the shell for quick reloads.
- Mobile-friendly styles, responsive layout primitives, and install prompts keep the experience "app-like" on phones, with viewport-safe spacing and touch-target sizing to match PWA expectations.

## Farcaster + Neynar Integration
- Users can supply a Neynar API key (or rely on a built-in default) from Settings to unlock Farcaster-aware features.
- Contacts now include a Farcaster sync action when a Neynar key is present, importing followed accounts with usernames, FIDs, scores, follower stats, and power badge metadata.
- Contact cards surface Farcaster links alongside Neynar scores, follower/following counts, and power badge badges when available.
- A Farcaster settings panel allows saving the user’s FID and configuring Neynar score/follower/power-badge thresholds that hide incoming messages failing those criteria, with per-conversation toggles to disable filtering quickly.
- The contacts list highlights Farcaster-derived entries and shows their Neynar score so users can gauge trust at a glance.
