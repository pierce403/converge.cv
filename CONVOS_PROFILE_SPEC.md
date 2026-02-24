# Convos Profile Spec (from convos-cli)

## Summary
Convos per-conversation profiles (display name + avatar URL) are stored in XMTP group metadata (`appData`). The `convos conversation update-profile` command reads the existing `appData`, upserts the caller's profile (keyed by XMTP `inboxId`), and writes the updated metadata back to the group via `updateAppData`.

This is **not** part of `xmtp-js` or the XMTP CLI. The behavior comes from the Convos CLI repository (`xmtplabs/convos-cli`).

## CLI Command Behavior
Command:
```
convos conversation update-profile <conversation-id> --name "Alice" --image "https://example.com/avatar.jpg"
```

Flow:
1. Load the local identity associated with `<conversation-id>`.
2. Create an XMTP client for that identity and `sync()` conversations.
3. Fetch the conversation by ID and require it to be a **group** (DMs are rejected).
4. Read `group.appData` (empty string if missing) and parse it into metadata.
5. Build a profile object:
   - `inboxId` = `client.inboxId`
   - `name` is included only if `--name` is passed
   - `image` is included only if `--image` is passed
   - Passing an empty string clears the field (sets it to `undefined`).
6. `upsertProfile(metadata, profile)` updates or adds the profile by inboxId (case-insensitive).
7. Serialize metadata back to `appData` and write it with `group.updateAppData(...)`.
8. Update the **local identity store** with the new `profileName` (name only; image is not stored locally).

Clear behavior:
- `--name "" --image ""` produces a profile entry with only `inboxId` set.
- That results in an “anonymous” profile in Convos because name + image are absent.

## Storage Model (appData)
The `appData` string is a **base64url-encoded protobuf**, optionally compressed. Schema matches the Convos iOS client (`ConversationCustomMetadata`).

### Protobuf Schema (logical fields)
- `ConversationCustomMetadata`
  - `tag` (field 1, string)
  - `profiles` (field 2, repeated `ConversationProfile`)
  - `expiresAtUnix` (field 3, sfixed64, optional)
  - `imageEncryptionKey` (field 4, bytes, optional)
  - `encryptedGroupImage` (field 5, `EncryptedImageRef`, optional)

- `ConversationProfile`
  - `inboxId` (field 1, bytes)
  - `name` (field 2, string, optional)
  - `image` (field 3, string, optional)
  - `encryptedImage` (field 4, `EncryptedImageRef`, optional)

- `EncryptedImageRef`
  - `url` (field 1, string)
  - `salt` (field 2, bytes)
  - `nonce` (field 3, bytes)

### What convos-cli actually reads/writes
- Reads/writes: `tag`, `profiles[].inboxId`, `profiles[].name`, `profiles[].image`, `expiresAtUnix`
- Ignores: `encryptedImage`, `imageEncryptionKey`, `encryptedGroupImage` (present in schema but not surfaced)

### Inbox ID encoding
- Stored as raw bytes in protobuf.
- Encoded/decoded as hex strings in the CLI (no `0x` prefix in storage).

## Encoding & Compression
Encoding pipeline in `serializeAppData`:
1. Protobuf-encode metadata.
2. If payload > 100 bytes, `deflate` it.
3. Only keep compression if compressed is **smaller** than raw.
4. If compressed, prepend a 5-byte header:
   - `0x1f` marker (1 byte)
   - original size (4 bytes, big-endian)
5. Base64url-encode the final bytes.
6. Enforce 8 KB size limit on the encoded string.

Decoding in `parseAppData`:
- If string starts with `{`, treat as legacy JSON and parse `{ tag, expiresAtUnix }`.
- Otherwise, base64url-decode, check for the `0x1f` compression marker, then inflate.
- If parse fails, returns `{ tag: "", profiles: [] }`.

## Profile Upsert Semantics
`upsertProfile` behavior:
- Matches profiles by `inboxId` case-insensitively.
- If match exists, merges fields (`{ ...existing, ...profile }`).
- If no match, appends a new profile.

Because empty-string clears are converted to `undefined`, a clear operation **removes** that field when re-serialized. The profile entry itself remains, which Convos interprets as “anonymous”.

## Related Profile Touchpoints
- `convos conversations create --profile-name` writes the creator's profile into `appData` at group creation time.
- `convos conversations join --profile-name` upserts the joiner’s profile after acceptance.
- `convos conversation profiles` lists group members and their stored profile name/image (if any).

## Practical Implication for Converge
To be Convos-compatible, write the **same protobuf appData** into the group’s `appData` field, using the caller’s XMTP `inboxId` as the profile key. A simple name/image update is sufficient for Convos to display it.
