# Convos Profile Interoperability

## Verified Source Baseline

This document follows current `convos-ios` source at `origin/dev` commit
`590d2689937614db729c910b5a409520856c9d2c` (2026-07-10). The important recent
changes are the unified-profile rewrite in `0dc31f48` (2026-07-06) and the
conversation-scoped metadata correction in `b4e62896` (2026-07-08).

The upstream `docs/adr/005-member-profile-system.md` still names parts of the
pre-rewrite storage and publishing flow. For current behavior, the source under
`ConvosCore/Sources/ConvosCore/Profiles/` is authoritative.

## Product Model

Convos names are application profile data. They are not XMTP accounts, inboxes,
identities, or installations.

Current Convos iOS resolves a participant's display name, member kind, and
general metadata as one canonical identity keyed by XMTP `inboxId`. A profile
event learned in one conversation can therefore update how that inbox renders
elsewhere on the same Convos installation. This is local unification, not a
public profile directory: every other participant or installation must still
receive the profile through an MLS group message or snapshot.

The current storage scopes are:

- `DBProfile`: canonical name, member kind, and received metadata per inbox.
- `DBMyProfile`: the local user's global source profile.
- `DBProfileAvatar`: encrypted avatar slot per `(inboxId, conversationId)`
  because encryption uses that conversation's image key.
- `DBSelfConversationMetadata`: the local user's `connections` and `timezone`
  values per conversation. These are merged over global metadata when sending.

Contact names no longer override canonical Convos profile identity. `contact`
remains the lowest `ProfileSource` for legacy migration and gap filling.

## Wire Messages

Both profile content types are protobuf, have no fallback text, and use
`shouldPush = false`:

- `convos.org/profile_update:1.0`
- `convos.org/profile_snapshot:1.0`

`ProfileUpdate` fields:

- `name = 1`
- `encrypted_image = 2`
- `member_kind = 3` (`1` declares a generic agent)
- `metadata = 4`, a map of string keys to typed string/double/bool values

The update's subject is the XMTP message `senderInboxId`; an inbox ID is not
included in the payload.

`ProfileSnapshot` contains repeated `MemberProfile` values:

- raw inbox ID bytes `= 1`
- name `= 2`
- encrypted image `= 3`
- member kind `= 4`
- typed metadata map `= 5`

An encrypted image reference is valid only when it has a nonempty URL, a
32-byte salt, and a 12-byte nonce. The conversation image-encryption key is not
in the profile message. Current Convos treats an absent or malformed image as
"no avatar statement," even on `ProfileUpdate`; the v1 wire format cannot
distinguish a deliberate clear from a name-only update.

## Resolution And Merge Rules

Profile source precedence, lowest to highest, is:

1. Legacy contact/backfill data.
2. A legacy profile read from `group.appData`.
3. A `ProfileSnapshot` relayed by a group member.
4. A self-authored `ProfileUpdate` from the subject inbox.

Within one source, the newer XMTP message timestamp wins. A lower source can
fill a blank but cannot replace populated higher-authority data. Blank names do
not clear a populated name.

Metadata has additional rules:

- A winning nonempty map replaces the stored map as one authoritative value.
- A direct `ProfileUpdate` whose proto map decodes empty clears only the
  conversation-managed `connections` and `timezone` keys. It preserves other
  keys such as agent attestations and leaves a tombstone that prevents an older
  snapshot from restoring revoked scoped values.
- An empty snapshot or appData metadata map is treated as no statement and
  cannot clear metadata.

`member_kind = 1` is only an unverified agent declaration. Convos authenticates
an agent separately using the `attestation`, `attestation_ts`, and
`attestation_kid` metadata plus its trusted keyset. Once verified, an agent kind
is not downgraded by a later generic or missing kind.

## Self Profile Publication

A Convos profile edit updates the global local `DBMyProfile`. Propagation is
lazy and conversation-specific:

- the active/priority conversation is published immediately;
- a conversation publishes on ready/open and before an outgoing send when the
  local profile is newer than that conversation's successful-publish stamp;
- a durable per-conversation queue retries failed uploads and sends with capped
  backoff;
- `publishedProfileUpdatedAt` advances only after the `ProfileUpdate` is
  delivered.

Each group still receives its own `ProfileUpdate`, so a name such as "Orange
Orca" reaches every group where that user becomes active. Current Convos iOS
then best-effort mirrors the same profile into `group.appData` for older clients.

## Profile Snapshots

Snapshots solve the MLS forward-secrecy gap: a newly added member cannot read
profile messages sent before joining. Current Convos sends snapshots:

- when the creator first stores/discovers a new group;
- after a direct member addition;
- after an accepted invite request;
- after a verified already-member invite replay;
- after device pairing, when the initiating installation sees the new
  installation and broadcasts a fresh snapshot to every allowed group.

The current builder:

1. Syncs the group and reads the authoritative current roster.
2. Loads canonical `DBProfile` identity, the avatar slot for this conversation,
   and the local user's `DBMyProfile`.
3. Scans up to 500 messages newest-first, taking the newest direct update per
   sender and the newest snapshot as fallback.
4. Lets usable recent-message fields overlay stored state while stored state
   fills gaps.
5. Filters to the current roster and drops inbox-only entries with no usable
   name, valid image, member kind, or metadata.

The sender is therefore included when its local profile has usable content; an
empty self profile is not emitted merely because it belongs to the sender.

## Invite Profile

`convos.org/join_request:1.0` is a pushed JSON message sent to the invite
creator's DM. Its fallback text is the invite slug. The current shape is:

```json
{
  "inviteSlug": "...",
  "profile": {
    "name": "Orange Orca",
    "imageURL": "https://...",
    "memberKind": "agent"
  },
  "metadata": {
    "key": "string value"
  }
}
```

The profile and metadata are optional. Join-request metadata is string-to-string,
not the typed protobuf metadata map. A creator should persist a verified
requester's usable profile before constructing the post-add snapshot.

## Legacy appData

`group.appData` remains a lower-authority compatibility channel. It is base64url
protobuf, either uncompressed or framed as:

1. byte `0x1f`;
2. a four-byte big-endian uncompressed size;
3. a DEFLATE body.

Current readers accept both raw-DEFLATE bodies produced by iOS and zlib-wrapped
bodies produced by other Convos tooling.

Convos iOS still best-effort mirrors profile publication into appData with its
retrying atomic metadata helper. Converge deliberately does not perform this
write: the Browser SDK does not expose the same safe compare-and-swap helper,
and rewriting the shared blob can lose concurrent invite tags or metadata.
Converge reads appData as a fallback and keeps invite-tag edits as an explicit,
separate metadata operation.

## Converge Compatibility Mapping

Converge currently interoperates on the wire as follows:

- It publishes its self-authored update on group activation, before group sends,
  and after an explicit profile save, with persisted revision deduplication.
- It sends roster snapshots after group creation, direct additions, and invite
  acceptance. It refreshes `group.members()` before receiving or building a
  snapshot so membership races do not discard a newly added profile.
- It stores source and timestamp with each conversation member. A direct
  self-authored update also refreshes the global contact name; a relayed snapshot
  remains conversation-scoped because Converge does not yet have Convos' full
  canonical profile repository and trust-aware global merge.
- It preserves agent kind and typed metadata, but `member_kind = 1` is displayed
  as a generic agent declaration; Converge does not yet verify Convos agent
  attestations.
- It treats an empty direct update as the current scoped-metadata revocation
  signal and accepts both raw-DEFLATE and zlib-wrapped compressed appData.
- It preserves encrypted avatar references but does not yet obtain the image key,
  decrypt, and render those avatars.
- It does not yet broadcast profile snapshots to every group after a new device
  joins an existing inbox.
- Its profile publisher is revision-deduplicated but does not yet implement the
  durable retry queue used by Convos iOS.

These are implementation differences, not alternate wire formats. The required
interop invariant remains: every member of a group should receive a usable name
for each named participant, including agents, through a direct update or a
current-roster snapshot.

## Observed Upstream Edge Cases

The audited Convos source still contains two transitional paths that should not
be copied as protocol requirements:

- Direct-add contact seeding and invite-request profile persistence still write
  legacy `DBMemberProfile` rows, while the unified snapshot builder reads
  `DBProfile` and `DBMyProfile`. A profile absent from recent messages may
  therefore miss that legacy seed.
- Incoming `connections` and `timezone` values ultimately merge into global
  `DBProfile.metadata`, even though the sender scopes them per conversation.
  This can theoretically relay scoped metadata through a snapshot in another
  group.

Converge should follow the wire semantics above while avoiding reliance on these
transitional storage details.
