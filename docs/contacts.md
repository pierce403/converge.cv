# Contact Management

This document explains how Converge.cv creates, stores, merges, and refreshes contacts.

## TL;DR

- **Contact records are persisted in IndexedDB** (Dexie) in the `contacts` table.
- **Zustand holds the in-memory contact list** (`useContactStore`), and `loadContacts()` hydrates it from IndexedDB.
- **`localStorage` is *not* the primary contact DB**. It only stores:
  - the active inbox namespace (`converge.storageNamespace.v1`)
  - small settings blobs (ex: Farcaster settings)
  - a stub for the contacts store persistence (`converge-contacts-storage` stores `{}` by design)
- **XMTP is the canonical source** for inbox ID ↔ address links and inbox profile identity state.
- **Farcaster and ENS enrich the same `Contact` record**, using merge rules that preserve user edits.

## Data model (schema)

### TypeScript schema

The contact schema lives in the Zustand contact store:

- `ContactIdentity` + `Contact`: [`src/lib/stores/contact-store.ts`](../src/lib/stores/contact-store.ts#L28)

```ts
export interface ContactIdentity {
  identifier: string;
  kind: string;
  displayLabel?: string;
  isPrimary?: boolean;
}

export interface Contact {
  inboxId: string;
  name: string;
  avatar?: string;
  description?: string;
  preferredName?: string;
  preferredAvatar?: string;
  notes?: string;
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

Notes:

- `inboxId` is the **primary key** for the persisted contact record.
  - It is normalized to lowercase in the store (`normalizeInboxId`).
- `addresses` is a **deduped** list of known identifiers (usually Ethereum addresses); it’s used for:
  - finding an existing contact by any known address
  - migrating “legacy” contacts that were created with an address instead of an inbox id
- `identities` is a structured list of linked identities.
  - XMTP-provided identity state maps into this.
  - ENS identities may be added by refresh flows.
- `preferredName` / `preferredAvatar` / `notes` are **user-facing overrides** (may come from user edits or trusted sources).

### IndexedDB schema (Dexie)

Contacts are stored in IndexedDB via Dexie.

- DB implementation: [`src/lib/storage/dexie-driver.ts`](../src/lib/storage/dexie-driver.ts)
- Full Dexie schema reference: [`docs/storage-schema.md`](storage-schema.md)
- `contacts` store definition: [`src/lib/storage/dexie-driver.ts`](../src/lib/storage/dexie-driver.ts)

The current contacts store is:

```ts
contacts: '&inboxId, primaryAddress, *addresses'
```

Meaning (Dexie syntax):

- `&inboxId` = unique primary key
- `primaryAddress` = indexed field
- `*addresses` = multiEntry index (allows querying by any address in the array)

### Namespacing: contacts are per-inbox

Storage is namespaced per inbox.

- Namespace key in localStorage: `converge.storageNamespace.v1` ([`src/lib/storage/index.ts`](../src/lib/storage/index.ts#L15))
- Dexie DB names:
  - global DB: `ConvergeDB`
  - data DB: `ConvergeDB:${namespace}` ([`src/lib/storage/dexie-driver.ts`](../src/lib/storage/dexie-driver.ts#L293))

This means:

- Contacts live in the **data DB** for the currently selected inbox namespace.
- Switching inboxes switches the underlying IndexedDB “shard”.

## Where contacts are written (all write paths)

There are two primitives:

- `addContact(contact)` — “manual add” (expects a full-ish `Contact`)
- `upsertContactProfile(profile)` — “merge + canonicalize” (preferred; creates or updates)

Both ultimately persist through the storage driver:

- `StorageDriver.putContact(...)`: [`src/lib/storage/interface.ts`](../src/lib/storage/interface.ts#L76)
- Dexie implementation uses `contacts`: [`src/lib/storage/dexie-driver.ts`](../src/lib/storage/dexie-driver.ts)

### Create / upsert triggers

| Trigger | Creates new contact? | Code path |
|---|---:|---|
| Manual add button | Yes | [`src/features/contacts/AddContactButton.tsx`](../src/features/contacts/AddContactButton.tsx#L23) → `addContact` |
| Contact card “Add/Remove” toggle | Yes | [`src/components/ContactCardModal.tsx`](../src/components/ContactCardModal.tsx#L100) → `addContact` |
| DM menu “Add to contacts” | Yes | [`src/features/messages/ConversationView.tsx`](../src/features/messages/ConversationView.tsx#L799) → `upsertContactProfile` |
| Sending a message to a non-contact | Yes | [`src/features/messages/useMessages.ts`](../src/features/messages/useMessages.ts#L147) → `upsertContactProfile` |
| Creating a new conversation | Yes (best-effort) | [`src/features/conversations/useConversations.ts`](../src/features/conversations/useConversations.ts#L417) → `upsertContactProfile` |
| Opening a shared `/contact/:userId` link | Yes | [`src/features/contacts/ContactLinkPage.tsx`](../src/features/contacts/ContactLinkPage.tsx#L17) → `upsertContactProfile` |
| Viewing user info modal (best-effort profile fetch) | Possibly | [`src/components/UserInfoModal.tsx`](../src/components/UserInfoModal.tsx#L37) → `upsertContactProfile` |
| Incoming XMTP message (auto-add only if sender has displayName) | Possibly | [`src/app/Layout.tsx`](../src/app/Layout.tsx#L286) → `upsertContactProfile` |
| Farcaster sync (following list) | Yes | [`src/lib/stores/contact-store.ts`](../src/lib/stores/contact-store.ts#L476) → `storage.putContact` |
| Block user (persist block even if not a saved contact) | Yes (placeholder) | [`src/lib/stores/contact-store.ts`](../src/lib/stores/contact-store.ts#L272) |

### Update-only flows (don’t intentionally create new contacts)

| Trigger | Code path |
|---|---|
| Refresh all contacts after XMTP connects | [`src/app/Layout.tsx`](../src/app/Layout.tsx#L694) |
| Periodic/conditional enrichment on app activity | [`src/app/Layout.tsx`](../src/app/Layout.tsx#L165) |
| Group member profile refresh (only for existing contacts) | [`src/features/messages/ConversationView.tsx`](../src/features/messages/ConversationView.tsx#L260) |
| Contact card “Refresh inbox” (manual merge of Farcaster/ENS/XMTP) | [`src/components/ContactCardModal.tsx`](../src/components/ContactCardModal.tsx#L118) |
| Contacts page “Refresh” | [`src/features/contacts/ContactsPage.tsx`](../src/features/contacts/ContactsPage.tsx#L203) |

## Persistence: what’s in localStorage vs IndexedDB

### IndexedDB (Dexie) — source of truth for contacts

Contacts are persisted in IndexedDB (Dexie) via `putContact/getContact/listContacts`.

- `useContactStore.loadContacts()` reads: [`src/lib/stores/contact-store.ts`](../src/lib/stores/contact-store.ts#L317)
- `DexieDriver.putContact()` writes: [`src/lib/storage/dexie-driver.ts`](../src/lib/storage/dexie-driver.ts#L538)

### localStorage — keys used by contact flows

1) Storage namespace (controls which IndexedDB shard is active)

- Key: `converge.storageNamespace.v1`
- Implementation: [`src/lib/storage/index.ts`](../src/lib/storage/index.ts#L15)

2) Contact store persist stub

The contact store is wrapped with Zustand `persist`, but it intentionally stores **no contacts**:

- Persist config: [`src/lib/stores/contact-store.ts`](../src/lib/stores/contact-store.ts#L694)

```ts
partialize: (_state) => ({}),
```

This leaves IndexedDB as the canonical contact database.

3) Farcaster settings (feeds Farcaster contact sync)

- Key: `converge-farcaster-settings`
- Implementation: [`src/lib/stores/farcaster-store.ts`](../src/lib/stores/farcaster-store.ts#L46)

4) Pending XMTP profile publish (not contacts, but affects the profile data we merge)

- Key: `pending-profile-save:${inboxKey}`
- Flush logic: [`src/app/Layout.tsx`](../src/app/Layout.tsx#L700)

## Merging identity data: XMTP + ENS + Farcaster

### XMTP: canonical inboxId + identity state

The XMTP wrapper exposes two important calls used throughout the app:

- `deriveInboxIdFromAddress(address)` resolves an Ethereum address → XMTP inbox ID (uses Utils fallback + timeout):
  [`src/lib/xmtp/client.ts`](../src/lib/xmtp/client.ts#L705)
- `fetchInboxProfile(inboxIdOrAddress)` returns a normalized profile object that includes:
  - `displayName`
  - `avatarUrl`
  - `primaryAddress`
  - `addresses[]`
  - `identities[]`
  [`src/lib/xmtp/client.ts`](../src/lib/xmtp/client.ts#L758)

Important detail: Converge also supports **profile broadcasts** via a message prefix:

- Prefix constant: `cv:profile:` ([`src/lib/xmtp/client.ts`](../src/lib/xmtp/client.ts#L168))
- `fetchInboxProfile` prefers a recent profile message from the DM history when available:
  [`src/lib/xmtp/client.ts`](../src/lib/xmtp/client.ts#L866)

### ENS: display name enrichment

ENS utilities live in:

- [`src/lib/utils/ens.ts`](../src/lib/utils/ens.ts#L1)

Currently:

- Reverse ENS (`0x...` → `name.eth`) is real (`resolveENSFromAddress`).
- `.fcast.id` lookups resolve via Neynar verification (when a Neynar key is available):
  [`resolveFcastId`](../src/lib/utils/ens.ts#L154)
- `.base.eth` lookups are a filtered reverse ENS result:
  [`resolveBaseEthName`](../src/lib/utils/ens.ts#L188)

ENS integration shows up in two main places:

1) Farcaster sync name selection prefers ENS when available:

- [`src/lib/farcaster/service.ts`](../src/lib/farcaster/service.ts#L267)

2) Contact card “Refresh inbox” can add an ENS identity and prefer it over XMTP displayName:

- Ranking + merge logic: [`src/components/ContactCardModal.tsx`](../src/components/ContactCardModal.tsx#L174)

### Farcaster: enrichment and bulk creation

Farcaster follow sync lives in the contact store:

- [`src/lib/stores/contact-store.ts`](../src/lib/stores/contact-store.ts#L476)

Core behavior:

- Fetches your following list (Neynar if available, else `VITE_FARCASTER_API_BASE`).
- Extracts an Ethereum address from Farcaster verifications.
- Resolves a preferred name using `resolveContactName` (ENS > .fcast.id > .base.eth > Farcaster display).
- Enriches stats via Neynar bulk fetch (`fetchNeynarUsersBulk`, chunked by 100):
  [`src/lib/farcaster/neynar.ts`](../src/lib/farcaster/neynar.ts#L166)
- Attempts to resolve the XMTP inbox ID for the verified address.

Farcaster-specific fields are stored on the `Contact` record (not as `ContactIdentity`), e.g. `farcasterFid`, `farcasterUsername`.

## Upsert + canonicalization rules (how updates work)

### The core merge function: `upsertContactProfile`

`upsertContactProfile` is the recommended way to write contacts because it:

- finds an existing contact by **inboxId OR any known address**
- merges `addresses` and `identities` with dedupe
- preserves existing Farcaster fields via `metadata`
- supports migrating a contact when its canonical inboxId becomes known

Implementation:

- [`src/lib/stores/contact-store.ts`](../src/lib/stores/contact-store.ts#L349)

Key detail: if an existing record is found but the canonical `inboxId` differs, the store deletes the legacy record:

- [`src/lib/stores/contact-store.ts`](../src/lib/stores/contact-store.ts#L468)

### Contact refresh merge priority (Contact Card)

The most explicit “merge brain” is the Contact Card refresh flow:

- [`src/components/ContactCardModal.tsx`](../src/components/ContactCardModal.tsx#L174)

It uses a priority model for name/avatar:

1. Farcaster
2. ENS
3. XMTP
4. “message” / local fallback

It also:

- aggregates identities from XMTP inbox state
- resolves ENS forward/backward when possible
- resolves inboxId from the primary Ethereum address
- persists the merged result via `upsertContactProfile`

### Automatic refresh cadence

Contacts use `lastSyncedAt` to throttle network work.

Examples:

- On incoming message, Converge avoids profile fetches more often than every ~5 minutes per contact:
  [`src/app/Layout.tsx`](../src/app/Layout.tsx#L258)
- Background enrichment treats contacts as stale after ~30 minutes or when missing name/avatar:
  [`src/app/Layout.tsx`](../src/app/Layout.tsx#L165)

## Related schemas

### Your own identity stores Farcaster FID

Your local `Identity` record stores `farcasterFid` to make Farcaster sync easier to re-run.

- `Identity.farcasterFid`: [`src/types/index.ts`](../src/types/index.ts#L114)
