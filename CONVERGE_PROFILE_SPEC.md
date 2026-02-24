# Converge DM Profile Spec

## Scope
- **Groups**: Converge delegates group profile management to Convos-style `appData` metadata and intends to stay aligned with Convos' schema and behavior. See `CONVOS_PROFILE_SPEC.md` for details.
- **DMs**: Converge manages DM profile data itself using a custom XMTP content type.

## DM Profile Content Type
Converge publishes DM profile metadata as a silent XMTP message using a custom content type:

- **authorityId**: `converge.cv`
- **typeId**: `profile`
- **version**: `1.0`

Payload (JSON, UTF-8 encoded):
```json
{
  "type": "profile",
  "v": 1,
  "displayName": "Alice",
  "avatarUrl": "https://...",
  "ts": 1700000000000
}
```

Notes:
- `fallback` is **omitted** so other clients can ignore the message cleanly.
- `shouldPush()` returns **false**, so profile broadcasts do not trigger push notifications.
- This is a **metadata message**, not intended to appear as a chat bubble.

Implementation: `src/lib/xmtp/profile-codec.ts`

## Validation & Size Limits
The codec sanitizes fields before encoding:
- `displayName`: trimmed, max **256** chars.
- `avatarUrl`: trimmed, max **4096** chars.
- Data URLs are allowed but capped at **256 KB** (estimated size from base64 payload).

Implementation: `src/lib/xmtp/profile-codec.ts`

## Sending Rules (DMs)
Converge only sends DM profile updates when the user explicitly acts (consent-safe):

1. **Save to self-DM** (`saveProfile`)
   - Sends the profile payload to the user's self-DM for cross-device recovery.
2. **Broadcast to allowed DMs** (`saveProfile`)
   - Best-effort broadcast to peers with consent state **Allowed**.
3. **Ensure profile is present when sending a DM** (`ensureProfileSent`)
   - When the user sends a DM message, Converge checks DM history for prior profile messages.
   - If display name or avatar is missing, it sends a profile payload.

Important:
- **No automatic sending** in response to inbound messages.
- Profile messages are sent with `shouldPush: false`.

Implementation: `src/lib/xmtp/client.ts` (`saveProfile`, `ensureProfileSent`)

## Receiving & Storage
Profile messages are **parsed and consumed as metadata**, not displayed:

- **Stream/backfill** handlers detect profile payloads and skip chat bubble creation.
- Contact/profile state is updated from profile payloads when available.

Implementation:
- `src/lib/xmtp/client.ts` (`extractProfileUpdate`, stream/backfill handlers)

## Why Profile Messages Don’t Show Up in Conversation History
Profile updates are **metadata-only**. Converge intentionally intercepts them and skips writing them into the message list to keep chat history clean.

Implementation:
- `src/lib/xmtp/client.ts` (stream/backfill skip)

## Summary
- **Groups**: use Convos `appData` profiles (shared, interoperable).
- **DMs**: use Converge’s `converge.cv/profile:1.0` content type.
- Profile messages are silent, consent-safe, and excluded from normal chat history.
