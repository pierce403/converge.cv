# Converge Push Notifications – Plan and Implementation Notes

This document describes how we will implement push notifications for the Converge PWA, what services are involved, how messages flow end‑to‑end, and what is still unknown or out of scope. It also summarizes how the convos‑ios project handles push so that we can model our approach appropriately.

## Goals

- Deliver “new activity” notifications when the app is closed or in the background.
- Don’t leak message content to servers. Backends should not need to decrypt message bodies.
- Keep the UX consistent across links (/g/:id, /i/:inboxId, /u/:userId) and route users into the correct context when they arrive via a notification.

## High‑Level Architecture

1) Browser client (PWA)
   - Registers a Service Worker (SW) with a `push` handler that displays notifications.
   - Requests Notification permission and subscribes to Web Push (VAPID) via `PushManager.subscribe`.
   - Sends the push subscription (endpoint + keys) to a Converge Push Relay backend, along with the user’s XMTP inboxId and installation metadata.

2) Converge Push Relay (server)
   - Owns a VAPID keypair for Web Push.
   - Stores subscriptions keyed by `inboxId` + `installationId` + `browser fingerprint`.
   - Maintains an XMTP client per inbox or uses a shared worker that listens to new message events per inbox. (Multiple strategies described below.)
   - On new inbound activity for a given inbox, dispatches a minimal Web Push payload (no message content) to the registered subscription endpoints.

3) Browser SW
   - Receives the push event and shows a notification.
   - Includes enough `data` in the notification (e.g., `conversationId`, optional `senderDisplayName`) so that clicking focuses/open the app and navigates to `/chat/:id`.
   - The app then syncs/streams messages as usual; message bodies are never included in the push payload.

## Privacy Model

- The push payload contains metadata only (e.g., type=new_message, conversationId, sender label if available via public profile). No decrypted message body is sent through the push pipeline.
- Decryption happens only in the client using the already‑present XMTP keys in IndexedDB/OPFS.

## What convos‑ios Does (Summary)

From the `tmp/convos-ios` snapshot:

- iOS uses a Notification Service Extension (NSE) (`NotificationService/NotificationService.swift`).
  - APNs delivers a push to the NSE.
  - The NSE forwards the payload to a `PushNotificationHandler` in `ConvosCore` to validate/interpret the push, possibly fetch/derive additional context, and decide whether to show/suppress the notification.
  - On failure or timeout, it suppresses or shows a minimal fallback notification.
- ConvosCore depends on Firebase (see `ConvosCore/Package.swift` references to `FirebaseCore`, `FirebaseAppCheck`), suggesting an App Check–protected API/relay for ticketing push or fetching context.
- Critical detail: iOS can run the NSE on‑device with access to secure key material, which allows richer processing at delivery time without exposing plaintext to servers.

Implication for web:
- Browsers’ Service Workers cannot run arbitrary native code or keep a full XMTP runtime reliably alive on push delivery. So we avoid decrypting in the SW and instead show minimal notifications that route into the live app.

## Push Relay Strategies (Server)

Two possible patterns:

1) Inbox‑listener per user (preferred for correctness)
   - The relay maintains an XMTP client for each registered inboxId (with the user’s permission/ticket), subscribes to message streams, and schedules Web Push on inbound events.
   - Pros: True offline notifications, works when the browser is closed.
   - Cons: Requires a relay credential model and resource management (connections, installation limits, scaling).

2) Event fan‑out (if XMTP exposes notification hooks)
   - If XMTP or an upstream service (e.g., xmtp.chat) exposes webhook/notification events per inbox, we register endpoints to receive new‑message events and then push via VAPID.
   - Pros: Lower infra complexity.
   - Cons: Availability depends on upstream; not always possible.

Unknowns to finalize:
- Which backend do we use? If we can leverage the same “chat‑api” infra that convos‑ios uses (not included here), we should add a `/push/register` endpoint to accept Web Push subscriptions and a worker that dispatches notifications. Otherwise, we stand up a minimal relay with the above responsibilities.
- How to authenticate the subscription registration? Options: wallet signature of a nonce, XMTP‑proof, or a session cookie from an authenticated web session.
- VAPID keypair provisioning and storage.

## PWA Implementation Plan

1) Service Worker (public/sw.js)
   - Listen to `push` and `notificationclick` events.
   - Show a minimal notification with title/body and a URL to open/focus on click.
   - Note: We do not perform XMTP decryption or sync in the SW.

2) Client subscription (src/lib/push)
   - `registerServiceWorkerForPush()` to register SW and ensure permission.
   - `subscribeForPush()` using `PushManager.subscribe({ userVisibleOnly: true, applicationServerKey: <VAPID PUBLIC KEY> })`.
   - Serialize and POST the subscription to `VITE_PUSH_API_BASE + /push/register` with `{ inboxId, installationId, subscription }`.
   - Store local subscription state in IndexedDB or localStorage to support unsubscribe/update.

3) Settings UI
   - Add “Notifications” card with Enable/Disable/Status and a quick test button that asks the backend to send a test push to the current subscription.

4) Deep‑link routing
   - Clicking a group notification opens `/g/:conversationId` (or legacy `/chat/:id` where we can map to group), which routes the user to the conversation.
   - Clicking a DM notification opens `/chat/:id` (or `/i/:inboxId` when we need to resolve state).

## What We Implemented Now

- A minimal service worker (`public/sw.js`) with push + click handlers.
- A push client module (`src/lib/push/index.ts`) that registers SW, requests permission, and attempts to subscribe with a VAPID public key from `VITE_VAPID_PUBLIC_KEY`.
- Settings UI buttons to Enable/Disable and send your current subscription blob to a push relay configured via `VITE_PUSH_API_BASE`. If these variables are absent, we fail gracefully and log why.

## Required Configuration (Production)

- `VITE_VAPID_PUBLIC_KEY`: Base64URL‑encoded public key for Web Push.
- `VITE_PUSH_API_BASE`: Base URL of the Converge Push Relay.
- Relay endpoints:
  - `POST /push/register` – body: `{ inboxId, installationId?, subscription, userAgent? }`.
  - `DELETE /push/register` – body or query: `{ inboxId, endpoint }`.
  - (Optional) `POST /push/test` – send a test push to a registration.

## Unknowns / Open Questions

- Convos iOS backend details: The snapshot shows an NSE and references to Firebase/AppCheck but not the server code. To reuse their infra, we need:
  - An agreed registration format for browser push (endpoint + keys) and a scoped token linking it to an inbox.
  - A fan‑out worker that knows how to map XMTP events → push targets, without decrypting messages.
- Background notification content: Browsers require `userVisibleOnly: true`. We can’t fully silence notifications; we must display something to comply with Web Push policy.
- Battery and quotas: Some browsers suspend SW or push for inactive sites. Expectations should be documented for reliability.

## Future Enhancements

- Enrich push titles with sender display names via server‑side public profile resolution (ENS/XMTP profile), still without including message plaintext.
- Tap actions: Add “Reply” action that opens a quick reply composer in the app view.
- Unsubscribe on sign‑out and rotate subscriptions when installations change.

