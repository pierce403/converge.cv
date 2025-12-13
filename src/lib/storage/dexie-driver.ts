/**
 * Dexie (IndexedDB) implementation of StorageDriver
 *
 * Canonical schema source:
 * - `ConvergeDB` below defines the IndexedDB schema via Dexie `version(...).stores(...)`.
 *
 * Important: this schema is used for TWO databases:
 * - Global DB: `ConvergeDB` (identity + vault secrets)
 * - Namespaced DB: `ConvergeDB:${namespace}` (conversations/messages/contacts/attachments + tombstones)
 *
 * Dexie index syntax quick reference:
 * - `id` = primary key
 * - `&id` = unique index (and primary key when first)
 * - `++id` = auto-incrementing primary key
 * - `*values` = multiEntry index for an array field
 * - `[a+b]` = compound index (ex: pagination by `[conversationId+sentAt]`)
 */

import Dexie, { Table } from 'dexie';
import type {
  Conversation,
  Message,
  Attachment,
  VaultSecrets,
  Identity,
  DeletedConversationRecord,
} from '@/types';
import type { StorageDriver, PageOpts, Query } from './interface';
import type { Contact } from '../stores/contact-store';

interface AttachmentData {
  id: string;
  data: ArrayBuffer;
}

class ConvergeDB extends Dexie {
  conversations!: Table<Conversation, string>;
  messages!: Table<Message, string>;
  attachments!: Table<Attachment, string>;
  attachmentData!: Table<AttachmentData, string>;
  identity!: Table<Identity, string>;
  vaultSecrets!: Table<VaultSecrets, string>;
  contacts!: Table<Contact, string>;
  deletedConversations!: Table<DeletedConversationRecord, string>;

  constructor(name: string) {
    super(name);

    this.version(1).stores({
      // Conversation list metadata (DMs + groups). Primary key: `id`.
      conversations: 'id, lastMessageAt, pinned, archived, peerId',
      // Message rows. Primary key: `id`. Compound index supports paging by time per conversation.
      messages: 'id, conversationId, sentAt, sender, [conversationId+sentAt]',
      // Attachment metadata linked to a message. Binary bytes live in `attachmentData`.
      attachments: 'id, messageId',
      // Raw attachment bytes (ArrayBuffer), keyed by attachment `id`.
      attachmentData: 'id',
      // Local identity records (currently 1 per device). Primary key: `address`.
      identity: 'address',
      // Vault encryption config/secrets. Primary key: `method`.
      vaultSecrets: 'method',
      // Legacy contacts table keyed by address (v1/v2). Replaced by `contacts_v3` in v3.
      contacts: 'address',
    });

    this.version(2)
      .stores({
        conversations: 'id, lastMessageAt, pinned, archived, peerId',
        messages: 'id, conversationId, sentAt, sender, [conversationId+sentAt]',
        attachments: 'id, messageId',
        attachmentData: 'id',
        // Add secondary index on inboxId for lookups/migrations.
        identity: 'address, inboxId',
        vaultSecrets: 'method',
        contacts: 'address',
      })
      .upgrade(async (transaction) => {
        const identities = await transaction.table('identity').toArray();
        await Promise.all(
          identities.map((identity) =>
            transaction.table('identity').put({ ...identity })
          )
        );
      });

    // IMPORTANT: Dexie does not support changing the primary key of an existing table.
    // Instead of altering 'contacts', create a new store 'contacts_v3' and migrate data.
    this.version(3)
      .stores({
        conversations: 'id, lastMessageAt, pinned, archived, peerId',
        messages: 'id, conversationId, sentAt, sender, [conversationId+sentAt]',
        attachments: 'id, messageId',
        attachmentData: 'id',
        identity: 'address, inboxId',
        vaultSecrets: 'method',
        // Legacy contacts keyed by address.
        contacts: 'address',
        // Current contacts keyed by inboxId, plus indexes for lookup by any known address.
        contacts_v3: '&inboxId, primaryAddress, *addresses',
      })
      .upgrade(async (transaction) => {
        const contactsTable = transaction.table('contacts');
        const contactsV3 = transaction.table('contacts_v3');
        try {
          const legacyContacts = await contactsTable.toArray();

          const normalizeIdentifier = (value: string): string => value.trim().toLowerCase();
          const normalizeCandidate = (value?: string | null): string | null => {
            if (!value || typeof value !== 'string') {
              return null;
            }
            const trimmed = value.trim();
            if (!trimmed) {
              return null;
            }
            return normalizeIdentifier(trimmed);
          };

          const collectAddresses = (record: Contact & { address?: string }): string[] => {
            const deduped = new Set<string>();
            const sources = [
              record.address,
              record.primaryAddress,
              ...(Array.isArray(record.addresses) ? record.addresses : []),
            ];
            for (const entry of sources) {
              const normalised = normalizeCandidate(entry);
              if (normalised) {
                deduped.add(normalised);
              }
            }
            return Array.from(deduped);
          };

          const deriveInboxId = (record: Contact & { address?: string }): string | null => {
            const candidates = [
              record.inboxId,
              record.address,
              record.primaryAddress,
              ...(Array.isArray(record.addresses) ? record.addresses : []),
            ];
            for (const candidate of candidates) {
              const normalised = normalizeCandidate(candidate);
              if (normalised) {
                return normalised;
              }
            }
            return null;
          };

          const migrated = new Map<string, Contact>();

          type LegacyContactRow = Contact & { address?: string };
          for (const legacy of legacyContacts as LegacyContactRow[]) {
            const inboxId = deriveInboxId(legacy);
            if (!inboxId) {
              console.warn('[Storage] Skipping contact without identifiable inbox during migration:', legacy);
              continue;
            }

            const addresses = collectAddresses(legacy);
            const primaryAddress = addresses[0];

            const baseContact: Contact = {
              ...legacy,
              inboxId,
              addresses,
              primaryAddress,
              createdAt: legacy.createdAt ?? Date.now(),
            };

            // @ts-expect-error - remove legacy field if present
            delete baseContact.address;

            const existing = migrated.get(inboxId);
            if (existing) {
              migrated.set(inboxId, {
                ...existing,
                ...baseContact,
                addresses: Array.from(new Set([...(existing.addresses ?? []), ...(baseContact.addresses ?? [])])),
                primaryAddress: baseContact.primaryAddress ?? existing.primaryAddress,
                avatar: baseContact.avatar ?? existing.avatar,
                preferredAvatar: baseContact.preferredAvatar ?? existing.preferredAvatar,
                name: baseContact.name ?? existing.name,
                preferredName: baseContact.preferredName ?? existing.preferredName,
              });
            } else {
              migrated.set(inboxId, baseContact);
            }
          }

          if (migrated.size > 0) {
            await contactsV3.bulkPut(Array.from(migrated.values()));
          }
        } catch (error) {
          console.error('[Storage] Failed to migrate contacts store to inboxId schema. Clearing legacy contacts.', error);
          // Don't throw; leave legacy table as-is to avoid blocking DB open
        }
      });

    this.version(4)
      .stores({
        conversations: 'id, lastMessageAt, pinned, archived, peerId, lastReadAt',
        messages: 'id, conversationId, sentAt, sender, [conversationId+sentAt]',
        attachments: 'id, messageId',
        attachmentData: 'id',
        identity: 'address, inboxId',
        vaultSecrets: 'method',
        contacts: 'address',
        contacts_v3: '&inboxId, primaryAddress, *addresses',
      })
      .upgrade(async (transaction) => {
        const conversationsTable = transaction.table('conversations');
        const conversations = await conversationsTable.toArray();
        await Promise.all(
          conversations.map((conversation) =>
            conversationsTable.put({
              ...conversation,
              lastReadAt: conversation.lastReadAt ?? 0,
            })
          )
        );
      });

    this.version(5).stores({
      conversations: 'id, lastMessageAt, pinned, archived, peerId, lastReadAt',
      messages: 'id, conversationId, sentAt, sender, [conversationId+sentAt]',
      attachments: 'id, messageId',
      attachmentData: 'id',
      identity: 'address, inboxId',
      vaultSecrets: 'method',
      contacts: 'address',
      contacts_v3: '&inboxId, primaryAddress, *addresses',
      // Tombstones to keep "deleted/hidden" conversations from reappearing on resync.
      deletedConversations: '&conversationId, peerId',
    });

    this.version(6).stores({
      conversations: 'id, lastMessageAt, pinned, archived, peerId, lastReadAt',
      messages: 'id, conversationId, sentAt, sender, [conversationId+sentAt]',
      attachments: 'id, messageId',
      attachmentData: 'id',
      identity: 'address, inboxId',
      vaultSecrets: 'method',
      contacts: 'address',
      contacts_v3: '&inboxId, primaryAddress, *addresses',
      deletedConversations: '&conversationId, peerId',
      // Temporary table used by older ignore semantics (removed in v7).
      ignoredConversations: '&conversationId',
    });

    this.version(7)
      .stores({
        // Conversation list metadata (DMs + groups). Primary key: `id`.
        conversations: 'id, lastMessageAt, pinned, archived, peerId, lastReadAt',
        // Message rows. Primary key: `id`. Compound index supports paging by time per conversation.
        messages: 'id, conversationId, sentAt, sender, [conversationId+sentAt]',
        // Attachment metadata linked to a message. Binary bytes live in `attachmentData`.
        attachments: 'id, messageId',
        // Raw attachment bytes (ArrayBuffer), keyed by attachment `id`.
        attachmentData: 'id',
        // Local identity records (currently 1 per device). Primary key: `address`.
        identity: 'address, inboxId',
        // Vault encryption config/secrets. Primary key: `method`.
        vaultSecrets: 'method',
        // Legacy contacts keyed by address (retained for migrations/compat).
        contacts: 'address',
        // Current contacts keyed by inboxId, plus indexes for lookup by any known address.
        contacts_v3: '&inboxId, primaryAddress, *addresses',
        // Tombstones to keep "deleted/hidden" conversations from reappearing on resync.
        deletedConversations: '&conversationId, peerId',
        // Remove `ignoredConversations` store (table deletion).
        ignoredConversations: null,
      })
      .upgrade(async (transaction) => {
        try {
          await transaction.table('ignoredConversations').clear();
        } catch (error) {
          console.warn('[Storage] Failed to clear ignored conversations during migration:', error);
        }
      });

    // v8: remove the legacy address-keyed `contacts` table so we can reuse the name.
    this.version(8).stores({
      conversations: 'id, lastMessageAt, pinned, archived, peerId, lastReadAt',
      messages: 'id, conversationId, sentAt, sender, [conversationId+sentAt]',
      attachments: 'id, messageId',
      attachmentData: 'id',
      identity: 'address, inboxId',
      vaultSecrets: 'method',
      contacts: null,
      contacts_v3: '&inboxId, primaryAddress, *addresses',
      deletedConversations: '&conversationId, peerId',
      ignoredConversations: null,
    });

    // v9: rename `contacts_v3` -> `contacts` (keyed by inboxId). If anything looks off, start fresh.
    this.version(9)
      .stores({
        conversations: 'id, lastMessageAt, pinned, archived, peerId, lastReadAt',
        messages: 'id, conversationId, sentAt, sender, [conversationId+sentAt]',
        attachments: 'id, messageId',
        attachmentData: 'id',
        identity: 'address, inboxId',
        vaultSecrets: 'method',
        contacts: '&inboxId, primaryAddress, *addresses',
        contacts_v3: null,
        deletedConversations: '&conversationId, peerId',
        ignoredConversations: null,
      })
      .upgrade(async (transaction) => {
        try {
          const from = transaction.table('contacts_v3');
          const to = transaction.table('contacts');
          const rows = (await from.toArray()) as unknown as Contact[];

          let shouldReset = false;
          for (const row of rows) {
            if (!row || typeof row !== 'object') {
              shouldReset = true;
              break;
            }
            const inboxId = (row as { inboxId?: unknown }).inboxId;
            if (typeof inboxId !== 'string' || inboxId.trim().length === 0) {
              shouldReset = true;
              break;
            }
            // Contacts must be keyed by XMTP inboxId, not an Ethereum address.
            if (inboxId.trim().toLowerCase().startsWith('0x')) {
              shouldReset = true;
              break;
            }
          }

          if (shouldReset) {
            console.warn('[Storage] Contacts schema/data mismatch detected. Resetting contacts.');
            await to.clear();
            return;
          }

          if (rows.length > 0) {
            await to.bulkPut(rows);
          }
        } catch (error) {
          console.warn('[Storage] Failed to migrate contacts_v3 to contacts. Resetting contacts.', error);
          try {
            await transaction.table('contacts').clear();
          } catch {
            // ignore
          }
        }
      });
  }
}

export class DexieDriver implements StorageDriver {
  private globalDb: ConvergeDB; // identities, vault
  private dataDb: ConvergeDB;   // conversations, messages, contacts, attachments

  constructor(namespace = 'default') {
    this.globalDb = new ConvergeDB('ConvergeDB');
    this.dataDb = new ConvergeDB(`ConvergeDB:${namespace}`);
  }

  async init(): Promise<void> {
    await this.globalDb.open();
    await this.dataDb.open();
  }

  async close(): Promise<void> {
    this.globalDb.close();
    this.dataDb.close();
  }

  // Conversations
  async putConversation(conversation: Conversation): Promise<void> {
    const normalized: Conversation = {
      ...conversation,
      lastReadAt: conversation.lastReadAt ?? 0,
    };
    await this.dataDb.conversations.put(normalized);
  }

  async getConversation(id: string): Promise<Conversation | undefined> {
    return await this.dataDb.conversations.get(id);
  }

  async listConversations(query?: Query): Promise<Conversation[]> {
    let collection = this.dataDb.conversations.orderBy('lastMessageAt').reverse();

    if (query?.pinned !== undefined) {
      collection = collection.filter((c) => c.pinned === query.pinned);
    }

    if (query?.archived !== undefined) {
      collection = collection.filter((c) => c.archived === query.archived);
    }

    if (query?.search) {
      const searchLower = query.search.toLowerCase();
      collection = collection.filter((c) =>
        c.peerId.toLowerCase().includes(searchLower)
      );
    }

    const messages = await collection.toArray();
    return messages.reverse();
  }

  async deleteConversation(id: string): Promise<void> {
    await this.dataDb.transaction('rw', [this.dataDb.conversations, this.dataDb.messages], async () => {
      await this.dataDb.conversations.delete(id);
      await this.dataDb.messages.where('conversationId').equals(id).delete();
    });
  }

  async markConversationDeleted(record: DeletedConversationRecord): Promise<void> {
    const normalizedPeer = record.peerId ? record.peerId.toLowerCase() : '';
    const entry: DeletedConversationRecord = {
      conversationId: record.conversationId,
      peerId: normalizedPeer,
      deletedAt: record.deletedAt ?? Date.now(),
      reason: record.reason ?? 'user-hidden',
    };
    await this.dataDb.deletedConversations.put(entry);
  }

  async listDeletedConversations(): Promise<DeletedConversationRecord[]> {
    return this.dataDb.deletedConversations.orderBy('deletedAt').reverse().toArray();
  }

  async isConversationDeleted(conversationId: string): Promise<boolean> {
    const record = await this.dataDb.deletedConversations.get(conversationId);
    return Boolean(record);
  }

  async isPeerDeleted(peerId: string): Promise<boolean> {
    if (!peerId) {
      return false;
    }
    const normalized = peerId.toLowerCase();
    const record = await this.dataDb.deletedConversations.where('peerId').equals(normalized).first();
    return Boolean(record);
  }

  async unmarkConversationDeletion(conversationId: string): Promise<void> {
    await this.dataDb.deletedConversations.delete(conversationId);
  }

  async unmarkPeerDeletion(peerId: string): Promise<void> {
    if (!peerId) {
      return;
    }
    const normalized = peerId.toLowerCase();
    await this.dataDb.deletedConversations.where('peerId').equals(normalized).delete();
  }

  async updateConversationReadState(
    id: string,
    updates: { unreadCount?: number; lastReadAt?: number; lastReadMessageId?: string | null }
  ): Promise<void> {
    const patch: Partial<Conversation & { lastReadMessageId?: string | null }> = {};
    if (updates.unreadCount !== undefined) {
      patch.unreadCount = updates.unreadCount;
    }
    if (updates.lastReadAt !== undefined) {
      patch.lastReadAt = updates.lastReadAt;
    }
    if (updates.lastReadMessageId !== undefined) {
      patch.lastReadMessageId = updates.lastReadMessageId ?? undefined;
    }
    if (Object.keys(patch).length === 0) {
      return;
    }
    await this.dataDb.conversations.update(id, patch);
  }

  // Messages
  async putMessage(message: Message): Promise<void> {
    await this.dataDb.messages.put(message);
    
    // Update conversation lastMessageAt and preview
    const conversation = await this.dataDb.conversations.get(message.conversationId);
    if (conversation) {
      await this.dataDb.conversations.update(message.conversationId, {
        lastMessageAt: message.sentAt,
        lastMessagePreview: message.type === 'text' ? message.body.substring(0, 100) : '📎 Attachment',
        lastMessageId: message.id,
        lastMessageSender: message.sender,
      });
    }
  }

  async getMessage(id: string): Promise<Message | undefined> {
    return await this.dataDb.messages.get(id);
  }

  async listMessages(conversationId: string, opts?: PageOpts): Promise<Message[]> {
    let collection = this.dataDb.messages
      .where('[conversationId+sentAt]')
      .between([conversationId, Dexie.minKey], [conversationId, Dexie.maxKey])
      .reverse();

    if (opts?.before) {
      collection = collection.filter((m) => m.sentAt < opts.before!);
    }

    if (opts?.after) {
      collection = collection.filter((m) => m.sentAt > opts.after!);
    }

    if (opts?.limit) {
      collection = collection.limit(opts.limit);
    }

    if (opts?.offset) {
      collection = collection.offset(opts.offset);
    }

    const messages = await collection.toArray();
    return messages.reverse();
  }

  async deleteMessage(id: string): Promise<void> {
    await this.dataDb.messages.delete(id);
  }

  async updateMessageStatus(id: string, status: Message['status']): Promise<void> {
    await this.dataDb.messages.update(id, { status });
  }

  async updateMessageReactions(id: string, reactions: Message['reactions']): Promise<void> {
    await this.dataDb.messages.update(id, { reactions });
  }

  async deleteExpiredMessages(): Promise<number> {
    const now = Date.now();
    const expired = await this.dataDb.messages
      .filter((m) => m.expiresAt !== undefined && m.expiresAt < now)
      .toArray();

    await this.dataDb.messages.bulkDelete(expired.map((m) => m.id));
    return expired.length;
  }

  // Attachments
  async putAttachment(attachment: Attachment, data: ArrayBuffer): Promise<void> {
    await this.dataDb.transaction('rw', [this.dataDb.attachments, this.dataDb.attachmentData], async () => {
      await this.dataDb.attachments.put(attachment);
      await this.dataDb.attachmentData.put({ id: attachment.id, data });
    });
  }

  async getAttachment(
    id: string
  ): Promise<{ attachment: Attachment; data: ArrayBuffer } | undefined> {
    const [attachment, attachmentData] = await Promise.all([
      this.dataDb.attachments.get(id),
      this.dataDb.attachmentData.get(id),
    ]);

    if (!attachment || !attachmentData) {
      return undefined;
    }

    return { attachment, data: attachmentData.data };
  }

  async deleteAttachment(id: string): Promise<void> {
    await this.dataDb.transaction('rw', [this.dataDb.attachments, this.dataDb.attachmentData], async () => {
      await this.dataDb.attachments.delete(id);
      await this.dataDb.attachmentData.delete(id);
    });
  }

  // Identity
  async putIdentity(identity: Identity): Promise<void> {
    await this.globalDb.identity.put(identity);
  }

  async getIdentity(): Promise<Identity | undefined> {
    const identities = await this.globalDb.identity.toArray();
    return identities[0];
  }

  async listIdentities(): Promise<Identity[]> {
    return await this.globalDb.identity.toArray();
  }

  async getIdentityByAddress(address: string): Promise<Identity | undefined> {
    return await this.globalDb.identity.get(address);
  }

  async getIdentityByInboxId(inboxId: string): Promise<Identity | undefined> {
    return await this.globalDb.identity.where('inboxId').equals(inboxId).first();
  }

  async deleteIdentity(): Promise<void> {
    await this.globalDb.identity.clear();
  }

  async deleteIdentityByAddress(address: string): Promise<void> {
    await this.globalDb.identity.delete(address);
  }

  // Contacts
  async putContact(contact: Contact): Promise<void> {
    await this.dataDb.contacts.put(contact);
  }

  async getContact(inboxId: string): Promise<Contact | undefined> {
    return await this.dataDb.contacts.get(inboxId);
  }

  async listContacts(): Promise<Contact[]> {
    return await this.dataDb.contacts.toArray();
  }

  async deleteContact(inboxId: string): Promise<void> {
    await this.dataDb.contacts.delete(inboxId);
  }

  async updateContact(inboxId: string, updates: Partial<Contact>): Promise<void> {
    await this.dataDb.contacts.update(inboxId, updates);
  }

  // Vault secrets
  async putVaultSecrets(secrets: VaultSecrets): Promise<void> {
    await this.globalDb.vaultSecrets.put(secrets);
  }

  async getVaultSecrets(): Promise<VaultSecrets | undefined> {
    const secrets = await this.globalDb.vaultSecrets.toArray();
    return secrets[0];
  }

  async deleteVaultSecrets(): Promise<void> {
    await this.globalDb.vaultSecrets.clear();
  }

  // Clear ALL data
  async clearAllData(options?: { opfsAddresses?: string[] }): Promise<void> {
    await this.dataDb.transaction('rw', [
      this.dataDb.conversations,
      this.dataDb.messages,
      this.dataDb.attachments,
      this.dataDb.attachmentData,
      this.dataDb.contacts,
      this.dataDb.deletedConversations,
    ], async () => {
      await this.dataDb.conversations.clear();
      await this.dataDb.messages.clear();
      await this.dataDb.attachments.clear();
      await this.dataDb.attachmentData.clear();
      await this.dataDb.contacts.clear();
      await this.dataDb.deletedConversations.clear();
      console.log('[Storage] ✅ All IndexedDB data cleared');
    });

    // Also clear XMTP OPFS database
    try {
      const targets = (options?.opfsAddresses ?? [])
        .map((addr) => addr?.toLowerCase?.().trim())
        .filter((addr) => addr && addr.length > 0) as string[];

      const opfsRoot = await navigator.storage.getDirectory();
      // XMTP stores databases with names like "xmtp-production-{address}.db3"
      // @ts-expect-error - OPFS API types
      for await (const [name] of opfsRoot.entries()) {
        if (name.startsWith('xmtp-') && name.endsWith('.db3')) {
          if (targets.length > 0) {
            const nameLower = name.toLowerCase();
            const matched = targets.some((addr) => nameLower.includes(addr.replace(/^0x/, '')));
            if (!matched) {
              continue;
            }
          }
          await opfsRoot.removeEntry(name);
          console.log('[Storage] ✅ Cleared XMTP database:', name);
        }
      }
    } catch (error) {
      console.warn('[Storage] Could not clear XMTP OPFS databases:', error);
      // Non-fatal - continue anyway
    }
  }

  // Search - basic prefix search on Dexie
  async searchMessages(query: string, limit = 50): Promise<Message[]> {
    const queryLower = query.toLowerCase();
    return await this.dataDb.messages
      .filter(
        (m: Message) =>
          m.type === 'text' &&
          (m.body.toLowerCase().includes(queryLower) ||
            m.sender.toLowerCase().includes(queryLower))
      )
      .limit(limit)
      .toArray();
  }

  // Maintenance
  async vacuum(): Promise<void> {
    // Dexie doesn't need explicit vacuum like SQLite
    // but we can delete orphaned data
    const messageIds = new Set((await this.dataDb.messages.toArray()).map((m: Message) => m.id));
    const attachments = await this.dataDb.attachments.toArray();

    const orphaned = attachments.filter((a: Attachment) => !messageIds.has(a.messageId));
    await Promise.all(orphaned.map((a) => this.deleteAttachment(a.id)));
  }

  async getStorageSize(): Promise<number> {
    // IndexedDB size estimation
    if ('storage' in navigator && 'estimate' in navigator.storage) {
      const estimate = await navigator.storage.estimate();
      return estimate.usage || 0;
    }
    return 0;
  }
}
