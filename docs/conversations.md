# Conversation Management

This document explains how Converge.cv creates, stores, updates, and deletes conversations.

## TL;DR

- **Conversation records are persisted in IndexedDB** (Dexie) in the `conversations` table.
- **Zustand holds the in-memory list** (`useConversationStore`), and `useConversations.loadConversations()` hydrates it from IndexedDB.
- **`localStorage` is not the conversation database**. It only stores the active storage namespace (`converge.storageNamespace.v1`).
- **Inbound XMTP messages can create conversations automatically** (so your chat list stays in sync with the network).
- **“Deleted/ignored” conversations are tracked separately** in `deletedConversations` so they don’t reappear after resync.

## Data model (schema)

### TypeScript schema

The canonical `Conversation` and `DeletedConversationRecord` types live here:

- `Conversation`, `DeletedConversationRecord`: [`src/types/index.ts`](../src/types/index.ts#L25)

```ts
export interface Conversation {
  id: string;
  peerId: string;
  topic?: string | null; // Nullable for groups, or will be group.id
  lastMessageAt: number;
  lastMessagePreview?: string;
  unreadCount: number;
  pinned: boolean;
  archived: boolean;
  mutedUntil?: number;
  lastMessageId?: string;
  lastMessageSender?: string;
  lastReadAt?: number;
  lastReadMessageId?: string;
  createdAt: number;
  displayName?: string;
  displayAvatar?: string;
  profileSentDisplayName?: boolean;
  profileSentAvatar?: boolean;
  isGroup?: boolean;
  groupName?: string;
  groupImage?: string;
  groupDescription?: string;
  members?: string[];
  admins?: string[];
  memberInboxes?: string[];
  adminInboxes?: string[];
  superAdminInboxes?: string[];
  groupMembers?: GroupMember[];
  groupPermissions?: GroupPermissionsState;
  isLocalOnly?: boolean;
}

export interface DeletedConversationRecord {
  conversationId: string;
  peerId: string;
  deletedAt: number;
  reason?: 'user-hidden' | 'user-muted' | 'system';
}
```

### DM vs Group semantics

Converge stores both DMs and groups in the same `conversations` table.

**DM conventions** (intended):

- `conversation.id`: XMTP conversation ID
- `conversation.peerId`: the peer’s **XMTP inbox id** (lowercased)
- `conversation.isGroup`: `false` or `undefined`
- `conversation.topic`: varies by writer (see “Gotchas”)

**Group conventions**:

- `conversation.id`: XMTP group id
- `conversation.peerId`: typically the same as `conversation.id`
- `conversation.isGroup`: `true`
- `members` / `memberInboxes` / `groupMembers`: best-effort local cache of group membership

## Persistence: IndexedDB vs localStorage

### IndexedDB (Dexie) — source of truth

The StorageDriver interface defines the primitives used everywhere:

- `putConversation/getConversation/listConversations/deleteConversation`: [`src/lib/storage/interface.ts`](../src/lib/storage/interface.ts#L28)
- Deleted markers: `markConversationDeleted/isConversationDeleted/isPeerDeleted`: [`src/lib/storage/interface.ts`](../src/lib/storage/interface.ts#L38)

Dexie implementation:

- Full Dexie schema reference: [`docs/storage-schema.md`](storage-schema.md)
- DB + schema versions: [`src/lib/storage/dexie-driver.ts`](../src/lib/storage/dexie-driver.ts#L49)
- Current store definitions (v7): [`src/lib/storage/dexie-driver.ts`](../src/lib/storage/dexie-driver.ts#L254)

The current stores relevant to conversations are:

```ts
conversations: 'id, lastMessageAt, pinned, archived, peerId, lastReadAt'
messages: 'id, conversationId, sentAt, sender, [conversationId+sentAt]'
deletedConversations: '&conversationId, peerId'
```

Notes:

- Conversations are indexed by `lastMessageAt` for fast chat list sorting.
- `deletedConversations` has a unique primary key on `conversationId` (`&conversationId`) and an index on `peerId`.

### Namespacing: conversations are per-inbox

Converge splits local data by “namespace” (roughly “which inbox is active”).

- Namespace key in localStorage: `converge.storageNamespace.v1` ([`src/lib/storage/index.ts`](../src/lib/storage/index.ts#L15))
- Dexie DB names:
  - global DB: `ConvergeDB` (identity/vault)
  - data DB: `ConvergeDB:${namespace}` ([`src/lib/storage/dexie-driver.ts`](../src/lib/storage/dexie-driver.ts#L293))

### localStorage — what’s used by conversation flows

Conversations themselves are not stored in localStorage.

The key that matters for conversations is:

- `converge.storageNamespace.v1` ([`src/lib/storage/index.ts`](../src/lib/storage/index.ts#L15))

## Where conversations are written (all write paths)

The following table is meant to be exhaustive for “create/update/delete persisted conversations”.

### Create (persist a new conversation record)

| Trigger | Creates record? | Code path |
|---|---:|---|
| Load with zero history → seed default bots | Yes | [`src/features/conversations/useConversations.ts`](../src/features/conversations/useConversations.ts#L216) (seeding at `putConversation`) |
| “New Chat” UI (user-initiated DM) | Yes | `createConversation()` → [`src/features/conversations/useConversations.ts`](../src/features/conversations/useConversations.ts#L394) |
| Deep link `/i/:inboxId` (start DM) | Yes (via createConversation) | [`src/features/conversations/StartDmPage.tsx`](../src/features/conversations/StartDmPage.tsx#L6) |
| Incoming message for unknown conversation | Yes | Global listener creates & persists conversation: [`src/app/Layout.tsx`](../src/app/Layout.tsx#L195) (creation at `putConversation`) |
| XMTP “Check inbox” / sync | Yes | `syncConversations()` persists missing DMs + groups: [`src/lib/xmtp/client.ts`](../src/lib/xmtp/client.ts#L2033) |
| “New Group” UI | Yes | `createGroupConversation()` → [`src/features/conversations/useConversations.ts`](../src/features/conversations/useConversations.ts#L538) |

### Update (mutate an existing conversation record)

| Trigger | Typical fields updated | Code path |
|---|---|---|
| Send message | `lastMessageAt`, `lastMessagePreview`, `lastMessageId`, `lastMessageSender` | [`src/features/messages/useMessages.ts`](../src/features/messages/useMessages.ts#L117) |
| Receive message | `lastMessageAt`, `lastMessagePreview`, unread increments | [`src/features/messages/useMessages.ts`](../src/features/messages/useMessages.ts#L413) |
| Receive system message | preview + timestamp | [`src/app/Layout.tsx`](../src/app/Layout.tsx#L486) |
| “Mark read” / open conversation | `unreadCount`, `lastReadAt`, `lastReadMessageId` | [`src/features/conversations/useConversations.ts`](../src/features/conversations/useConversations.ts#L730) and [`src/lib/storage/dexie-driver.ts`](../src/lib/storage/dexie-driver.ts#L389) |
| Pin / Archive | `pinned`, `archived` | [`src/features/conversations/useConversations.ts`](../src/features/conversations/useConversations.ts#L602) / [`src/features/conversations/useConversations.ts`](../src/features/conversations/useConversations.ts#L623) |
| Mute / unmute | `mutedUntil` (+ also writes deleted marker; see “Gotchas”) | [`src/features/conversations/useConversations.ts`](../src/features/conversations/useConversations.ts#L644) |
| Group membership changes | `members`, `memberInboxes`, `admins`, `groupMembers` | `addMembersToGroup/removeMembersFromGroup`: [`src/features/conversations/useConversations.ts`](../src/features/conversations/useConversations.ts#L792) |
| Group metadata changes | `groupName`, `groupImage`, `groupDescription` | `updateGroupMetadata`: [`src/features/conversations/useConversations.ts`](../src/features/conversations/useConversations.ts#L951) |
| Group permissions changes | `groupPermissions` | `updateGroupPermission`: [`src/features/conversations/useConversations.ts`](../src/features/conversations/useConversations.ts#L985) |
| Ensure our profile sent flags | `profileSentDisplayName/profileSentAvatar` | [`src/lib/xmtp/client.ts`](../src/lib/xmtp/client.ts#L3146) |
| Periodic profile enrichment / canonicalization | `peerId`, `displayName`, `displayAvatar` | [`src/features/conversations/useConversations.ts`](../src/features/conversations/useConversations.ts#L76) |

### Delete (remove conversation + prevent reappearing)

There are two distinct concepts:

1) **Local deletion** — removes the conversation + messages from IndexedDB
2) **Ignore marker** — adds a record to `deletedConversations` so the conversation is not recreated during future syncs

| Trigger | What happens | Code path |
|---|---|---|
| “Delete conversation” menu item | Mark deleted, delete conversation + messages, remove from store | [`src/features/messages/ConversationView.tsx`](../src/features/messages/ConversationView.tsx#L883) → [`src/features/conversations/useConversations.ts`](../src/features/conversations/useConversations.ts#L687) |
| Hide group (aka deleteGroup) | Same as above | `deleteGroup()` calls `hideConversation`: [`src/features/conversations/useConversations.ts`](../src/features/conversations/useConversations.ts#L875) |
| Skip recreating on inbound messages | `isConversationDeleted/isPeerDeleted` gates message handler | [`src/app/Layout.tsx`](../src/app/Layout.tsx#L209) |

## How “Resync All” works

The “Resync All” button is destructive: it wipes local IndexedDB tables and the XMTP OPFS database, reconnects XMTP, and reloads.

- UI flow: [`src/features/conversations/ChatList.tsx`](../src/features/conversations/ChatList.tsx#L335)
- Read-state preservation helpers: [`src/lib/xmtp/resync-state.ts`](../src/lib/xmtp/resync-state.ts#L1)

Important interactions:

- `deletedConversations` markers are persisted in IndexedDB, so a “deleted” conversation should not reappear after resync.
- A resync temporarily stores read state in `globalThis.__cv_resync_read_state` and restores it after repopulating conversations.

## Inconsistencies / gotchas (worth fixing)

These are code-level inconsistencies that can surprise future work.

1) **Mute currently behaves like “ignore” for inbound messages**

- `toggleMute()` writes a `DeletedConversationRecord` with reason `user-muted`: [`src/features/conversations/useConversations.ts`](../src/features/conversations/useConversations.ts#L644)
- The global message listener drops messages for any `isConversationDeleted(...)`: [`src/app/Layout.tsx`](../src/app/Layout.tsx#L209)

Net effect: muting may prevent message ingestion entirely, not just notifications/badges.

2) **System message previews in storage can be wrong**

- `DexieDriver.putMessage()` updates `lastMessagePreview` to `'📎 Attachment'` for any non-text message type (including `system`):
  [`src/lib/storage/dexie-driver.ts`](../src/lib/storage/dexie-driver.ts#L410)
- Chat list logic expects system previews to show the body: [`src/features/conversations/ChatList.tsx`](../src/features/conversations/ChatList.tsx#L200)
- Layout patches the preview in-memory after storing the system message, but the persisted preview still uses the generic string:
  [`src/app/Layout.tsx`](../src/app/Layout.tsx#L486)

3) **Deleting a conversation does not delete attachment blobs**

- `deleteConversation()` deletes from `conversations` + `messages` only: [`src/lib/storage/dexie-driver.ts`](../src/lib/storage/dexie-driver.ts#L341)

This can orphan `attachments/attachmentData` rows.

4) **`topic` semantics differ depending on creator**

- Local fallback sets group `topic` to `null` (`isGroup ? null : id`): [`src/lib/xmtp/client.ts`](../src/lib/xmtp/client.ts#L656)
- XMTP sync sets `topic: id` for both DMs and groups: [`src/lib/xmtp/client.ts`](../src/lib/xmtp/client.ts#L2033)
- New DM uses `xmtpConv.topic`: [`src/features/conversations/useConversations.ts`](../src/features/conversations/useConversations.ts#L394)

If UI starts relying on `topic`, it needs a canonical rule.

5) **Archived conversations are written but not really viewable**

- `toggleArchive()` flips the flag: [`src/features/conversations/useConversations.ts`](../src/features/conversations/useConversations.ts#L623)
- `loadConversations()` only loads `archived: false`: [`src/features/conversations/useConversations.ts`](../src/features/conversations/useConversations.ts#L216)

Without an “Archived” view, archived conversations effectively disappear until some other code path loads them.

## Debugging & inspection

- View “ignored/deleted” conversation markers: [`src/features/debug/IgnoredConversationsModal.tsx`](../src/features/debug/IgnoredConversationsModal.tsx#L1)
- Storage entry points (Dexie driver): [`src/lib/storage/dexie-driver.ts`](../src/lib/storage/dexie-driver.ts#L287)
