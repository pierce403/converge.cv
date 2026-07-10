# Convos Profile Interoperability

## Product Model

Convos names are application-level group profile messages. They are not XMTP
identity, account, inbox, or installation properties. A participant called
"Orange Orca" must publish that name into each MLS group where it should appear.

Current Convos iOS uses these channels, from lowest to highest authority:

1. A contact/local fallback.
2. The legacy profile in `group.appData`.
3. A `convos.org/profile_snapshot:1.0` entry relayed by a group member.
4. A self-authored `convos.org/profile_update:1.0` from the subject inbox.

Within one source, the newer XMTP message timestamp wins. Blank names do not
clear a known nonblank name. Converge stores the source and timestamp with each
group member so history order cannot roll a direct update back to a stale
snapshot.

## Profile Messages

Both message types are protobuf, have no fallback text, and use
`shouldPush:false`.

`ProfileUpdate` fields:

- `name = 1`
- `encrypted_image = 2`
- `member_kind = 3` (`1` means agent)
- `metadata = 4`, a map of string keys to typed string/double/bool values

The subject is the XMTP message's `senderInboxId`; there is no inbox ID in the
payload.

`ProfileSnapshot` contains repeated `MemberProfile` values:

- raw inbox ID bytes `= 1`
- name `= 2`
- encrypted image `= 3`
- member kind `= 4`
- typed metadata map `= 5`

Snapshots are necessary because a member added to an MLS group cannot decrypt
profile messages sent before it joined. Converge sends a current-roster snapshot
after group creation, direct member addition, and invite acceptance. The builder
syncs the roster, scans up to 500 recent messages, merges stored/appData state,
and always includes the local profile. Receivers refresh the current XMTP roster
before filtering snapshot entries so a post-add snapshot cannot race stale local
membership state.

## Invite Names

`convos.org/join_request:1.0` is JSON and can include:

```json
{
  "inviteSlug": "...",
  "profile": { "name": "Orange Orca" },
  "metadata": {}
}
```

Converge sends its current generated or user-selected display name in this
request. A Converge invite creator retains that requester profile, adds the
member, and includes it in the post-add snapshot.

## Legacy appData

`group.appData` remains a backward-compatibility fallback. It is base64url
protobuf, optionally compressed with the Convos `0x1f` header. Converge reads
legacy profile entries at lower authority than snapshots and direct updates.
Profile publication deliberately does not rewrite this full shared blob: the
SDK exposes no compare-and-swap, so a read/merge/write cycle could erase a
concurrent invite tag or a metadata field added by a newer client. Invite-tag
edits remain a separate explicit metadata operation.

## Current Limitation

Converge preserves Convos encrypted avatar references but does not yet decrypt
and render those group-scoped avatars. Names, agent kind, and typed agent
metadata are decoded, persisted, snapshotted, and shown without metadata chat
bubbles.
