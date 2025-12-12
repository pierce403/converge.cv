# Dexie / IndexedDB Schema

This document describes Converge.cv’s **Dexie (IndexedDB)** schema: every table, its indexes, and what it’s used for.

If you only want the source-of-truth schema definition in code, start here:

- Dexie schema + migrations: `src/lib/storage/dexie-driver.ts#L36`
- Current store definitions (v7): `src/lib/storage/dexie-driver.ts#L254`

## Databases & namespacing

Converge uses **two IndexedDB databases** (both created through the same `ConvergeDB` schema class):

1) **Global DB**: `ConvergeDB`  
   Used for **device identity + vault secrets** (data that should not change when you switch inbox namespaces).

2) **Namespaced data DB**: `ConvergeDB:${namespace}`  
   Used for **conversations, messages, contacts, attachments, and deletion markers** (data that should be scoped to the
   currently active inbox).

The DB names are created here:

- `DexieDriver` constructor: `src/lib/storage/dexie-driver.ts#L291`

The current `namespace` is persisted in localStorage under `converge.storageNamespace.v1`:

- Namespace storage: `src/lib/storage/index.ts#L15`

## Dexie schema syntax (quick reference)

Dexie’s `stores({ ... })` strings are compact “index declarations”:

- `id` → primary key is `id`
- `&field` → unique index (and primary key when it’s the first field)
- `*arrayField` → multiEntry index (index each entry in an array)
- `[a+b]` → compound index
- `storeName: null` → delete that store (table) in this schema version

## Current schema (v7)

Defined here:

- `ConvergeDB.version(7).stores(...)`: `src/lib/storage/dexie-driver.ts#L254`

```ts
conversations: 'id, lastMessageAt, pinned, archived, peerId, lastReadAt'
messages: 'id, conversationId, sentAt, sender, [conversationId+sentAt]'
attachments: 'id, messageId'
attachmentData: 'id'
identity: 'address, inboxId'
vaultSecrets: 'method'
contacts: 'address'
contacts_v3: '&inboxId, primaryAddress, *addresses'
deletedConversations: '&conversationId, peerId'
ignoredConversations: null
```

## Stores (tables)

### `conversations`

- Dexie store: `src/lib/storage/dexie-driver.ts#L256`
- TypeScript type: `src/types/index.ts#L25`
- Stored in: **namespaced data DB**

Purpose: local “chat list” metadata (DMs + groups) so the UI is fast and stable across reloads.

Index notes:

- `lastMessageAt` is used for ordering the chat list (`listConversations`).
- `pinned` / `archived` enable filtered views.
- `peerId` is indexed for basic search/filtering (and for dedupe/canonicalization flows).
- `lastReadAt` supports unread/read UX.

Driver entry points:

- `putConversation/listConversations`: `src/lib/storage/dexie-driver.ts#L307`

### `messages`

- Dexie store: `src/lib/storage/dexie-driver.ts#L258`
- TypeScript type: `src/types/index.ts#L65`
- Stored in: **namespaced data DB**

Purpose: local message cache for rendering + searching.

Index notes:

- Compound index `[conversationId+sentAt]` is the backbone of paging messages by time:
  `src/lib/storage/dexie-driver.ts#L429`

Driver entry points:

- `putMessage/listMessages`: `src/lib/storage/dexie-driver.ts#L410`

### `attachments` and `attachmentData`

- Dexie stores: `src/lib/storage/dexie-driver.ts#L260`
- TypeScript type:
  - Attachment metadata: `src/types/index.ts#L85`
  - Attachment bytes: inline `AttachmentData` (`src/lib/storage/dexie-driver.ts#L31`)
- Stored in: **namespaced data DB**

Purpose: store attachment metadata + raw bytes locally.

Design note: metadata and bytes are split so you can query attachment rows without loading `ArrayBuffer` blobs.

Driver entry points:

- `putAttachment/getAttachment/deleteAttachment`: `src/lib/storage/dexie-driver.ts#L478`

### `contacts_v3` (current contacts table)

- Dexie store: `src/lib/storage/dexie-driver.ts#L270`
- TypeScript type: `src/lib/stores/contact-store.ts#L35`
- Stored in: **namespaced data DB**

Purpose: the canonical local contact table keyed by **XMTP inbox id**.

Index notes:

- Primary key: `inboxId`
- `primaryAddress` is indexed for direct lookups.
- `*addresses` is a multiEntry index so any known address can resolve a contact.

Driver entry points:

- `putContact/getContact/listContacts`: `src/lib/storage/dexie-driver.ts#L538`

### `contacts` (legacy contacts table)

- Dexie store: `src/lib/storage/dexie-driver.ts#L268`
- TypeScript type: `src/lib/stores/contact-store.ts#L35` (with an optional legacy `address` field in storage)
- Stored in: **namespaced data DB**

Purpose: compatibility/migration only. This used to be keyed by Ethereum `address` (pre-inboxId contacts).

Migration note:

- `contacts_v3` is introduced + migrated in schema v3:
  `src/lib/storage/dexie-driver.ts#L89`

### `deletedConversations`

- Dexie store: `src/lib/storage/dexie-driver.ts#L272`
- TypeScript type: `src/types/index.ts#L58`
- Stored in: **namespaced data DB**

Purpose: “tombstones” so a locally-deleted/hidden conversation does not get re-created after future XMTP syncs.

Index notes:

- Primary key: `conversationId`
- Index: `peerId` supports “hide all conversations with this peer” and related checks.

Driver entry points:

- `markConversationDeleted/isConversationDeleted/isPeerDeleted`: `src/lib/storage/dexie-driver.ts#L348`

### `identity`

- Dexie store: `src/lib/storage/dexie-driver.ts#L265`
- TypeScript type: `src/types/index.ts#L114`
- Stored in: **global DB**

Purpose: local device identity (wallet address + keys + XMTP identifiers).

Index notes:

- Primary key: `address`
- Secondary index: `inboxId` (added in schema v2 for reverse lookup/migrations)

Driver entry points:

- `putIdentity/getIdentity/getIdentityByInboxId`: `src/lib/storage/dexie-driver.ts#L508`

### `vaultSecrets`

- Dexie store: `src/lib/storage/dexie-driver.ts#L266`
- TypeScript type: `src/types/index.ts#L96`
- Stored in: **global DB**

Purpose: store the vault’s wrapped key material + parameters (passkey/passphrase).

Driver entry points:

- `putVaultSecrets/getVaultSecrets`: `src/lib/storage/dexie-driver.ts#L559`

### `ignoredConversations` (removed)

This store existed briefly (schema v6) and is removed in schema v7:

- Store removal: `src/lib/storage/dexie-driver.ts#L254`

## Schema version history (high level)

The schema is versioned in `ConvergeDB`:

- Schema versions: `src/lib/storage/dexie-driver.ts#L52`

Notable changes:

- v2: add `identity.inboxId` index (`src/lib/storage/dexie-driver.ts#L69`)
- v3: add `contacts_v3` and migrate legacy `contacts` (`src/lib/storage/dexie-driver.ts#L91`)
- v4: add `conversations.lastReadAt` (`src/lib/storage/dexie-driver.ts#L203`)
- v5: add `deletedConversations` (`src/lib/storage/dexie-driver.ts#L227`)
- v6: add `ignoredConversations` (`src/lib/storage/dexie-driver.ts#L240`)
- v7: remove `ignoredConversations` (`src/lib/storage/dexie-driver.ts#L254`)

## What this schema does *not* cover (XMTP OPFS)

XMTP maintains its own local SQLite database under OPFS (files like `xmtp-production-…*.db3`).

That data is not part of Dexie/IndexedDB and is handled separately (see `DexieDriver.clearAllData`):

- OPFS cleanup: `src/lib/storage/dexie-driver.ts#L599`
