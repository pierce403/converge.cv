# Contact Management

Converge keeps a local contact projection for the one active XMTP identity. It
follows the current Convos model: the peer's published profile is the canonical
name and avatar source, ENS can provide secondary identity recognition, and
contacts are a local convenience rather than a custom cross-device address-book
protocol.

## Product Contract

- Contacts are scoped to the active identity's existing IndexedDB namespace.
- Starting or sending in a conversation, explicitly choosing Add Contact, or
  another deliberate participation action can create a contact.
- Passive conversation discovery alone does not create a durable contact.
- The displayed name/avatar comes from the peer's published XMTP/Convos
  profile. ENS can enrich identity recognition but does not replace a newer
  peer-published profile. Farcaster/Neynar enrichment is removed.
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
- The former registry and inactive namespaces remain internal compatibility
  data. They are not shown or merged, and simplification work must not delete
  their contact tables.
- Zustand holds only the active identity's in-memory projection. Its localStorage
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
  source?: 'inbox' | 'manual';
  isBlocked?: boolean;
  isInboxOnly?: boolean;
  primaryAddress?: string;
  addresses?: string[];
  identities?: ContactIdentity[];
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
- removes obsolete Farcaster/Neynar metadata from normalized rows; and
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

Only the active identity opens an XMTP client and refreshes consent. Retained
compatibility identities do not background-sync and are not selectable in the
ordinary UI.

## Burn Inbox

Burn Inbox deletes the active namespace's contacts along with messages,
attachments, profile state, keys, and the XMTP database. Retained compatibility
namespaces are not implicitly merged or deleted.
