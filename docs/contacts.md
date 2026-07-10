# Contact Management

Converge keeps a separate local contact projection for each loaded XMTP inbox.
It follows the current Convos model: the peer's published profile is the name
and avatar source, while contacts are a local convenience rather than a custom
cross-device address-book protocol.

## Product Contract

- Contacts are scoped to the selected inbox's IndexedDB namespace.
- Starting or sending in a conversation, explicitly choosing Add Contact, or
  another deliberate participation action can create a contact.
- Passive conversation discovery alone does not create a durable contact.
- The displayed name/avatar comes from the peer's published XMTP/Convos
  profile. ENS and Farcaster can enrich identifiers and reputation, but do not
  replace a newer peer-published profile.
- Converge does not expose private aliases, private avatar overrides, or notes.
  Legacy `preferredName`, `preferredAvatar`, and `notes` fields remain readable
  for migration compatibility but are cleared whenever a contact is normalized
  or merged.
- Converge does not implement a private contact-sync protocol. Another device
  rebuilds its local contact list through its own participation and published
  profiles.

## Storage

Contacts are stored in the namespaced Dexie database:

```text
ConvergeDB:<normalized-inbox-id>
```

The current table declaration is:

```ts
contacts: '&inboxId, primaryAddress, *addresses'
```

- `inboxId` is the normalized XMTP inbox ID and primary key.
- `primaryAddress` is an optional associated account address.
- `addresses` is a deduplicated multi-entry list used to resolve known account
  identifiers back to one contact.
- Switching inboxes changes the storage namespace before contacts are loaded,
  so one brand/social identity never inherits another inbox's address book.
- Zustand holds only the active inbox's in-memory projection. Its localStorage
  persistence intentionally stores no contact rows; IndexedDB is authoritative.

Source files:

- Store and merge rules: [`src/lib/stores/contact-store.ts`](../src/lib/stores/contact-store.ts)
- Dexie driver: [`src/lib/storage/dexie-driver.ts`](../src/lib/storage/dexie-driver.ts)
- Namespace selection: [`src/lib/storage/index.ts`](../src/lib/storage/index.ts)

## Contact Shape

The current `Contact` interface includes:

```ts
interface Contact {
  inboxId: string;
  name: string;
  avatar?: string;
  description?: string;
  createdAt: number;
  source?: 'farcaster' | 'inbox' | 'manual';
  isBlocked?: boolean;
  isInboxOnly?: boolean;
  primaryAddress?: string;
  addresses?: string[];
  identities?: ContactIdentity[];
  farcasterUsername?: string;
  farcasterFid?: number;
  farcasterScore?: number;
  farcasterFollowerCount?: number;
  farcasterFollowingCount?: number;
  farcasterActiveStatus?: string;
  farcasterPowerBadge?: boolean;
  lastSyncedAt?: number;
}
```

The TypeScript interface still declares legacy private-override fields so old
rows deserialize safely. Current normalization deliberately writes those fields
as `undefined`.

## Creation And Updates

Primary contact creation paths are user actions:

- Add Contact from a conversation/contact card.
- Starting a new one-to-one conversation.
- Sending a message or attachment to a peer that is not yet a contact.
- Blocking a peer, which stores the minimum inbox-keyed record needed to retain
  the block decision.

Inbound conversation discovery creates the conversation row without adding the
sender to the address book. Published profile messages are consumed silently;
they update profile data associated with the peer rather than appearing as chat
bubbles.

`upsertContactProfile()` is the canonical merge path. It:

- resolves address-like inputs to an XMTP inbox ID before persistence;
- refuses to persist malformed or unresolved `0x...` values as inbox IDs;
- merges associated account identifiers without duplicates;
- migrates an older address-keyed row to the canonical inbox ID;
- applies peer-published name/avatar data;
- preserves Farcaster reputation fields as secondary metadata; and
- clears legacy private aliases, avatar overrides, and notes.

## Published Profiles

Names are application profile data, not XMTP inbox properties.

- Convos-style groups use `convos.org/profile_update:1.0` and
  `convos.org/profile_snapshot:1.0`.
- Legacy DMs can use the structured `converge.cv/profile:1.0` content type.
- Current merge precedence is documented in
  [`CONVOS_PROFILE_SPEC.md`](../CONVOS_PROFILE_SPEC.md). Direct profile updates
  outrank snapshots and legacy group appData; timestamps prevent older history
  from replacing newer profile state.
- Human and agent names use the same published-profile channel. Agent
  `memberKind` is retained, but cryptographic agent-attestation verification is
  still not implemented.
- Converge does not yet decrypt current Convos encrypted profile-image slots;
  see the interop limitations in [`ARCHITECTURE.md`](../ARCHITECTURE.md).

## Consent

XMTP consent is encrypted, network-synchronized state scoped to an inbox. The
Browser SDK caches it in that inbox's local XMTP database. Converge does not
copy consent into a global contact table or invent a contact-sync layer.

Only the selected inbox opens an XMTP client. Therefore an inactive inbox does
not refresh consent in the background; it refreshes after the user selects and
syncs that inbox.

## Burn Inbox

Burn Inbox deletes the selected namespace's contacts along with messages,
attachments, profile state, keys, and the XMTP database. Contacts from other
loaded inboxes remain in their own namespaces.
