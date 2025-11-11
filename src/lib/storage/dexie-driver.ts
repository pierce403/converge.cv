/**
 * Dexie (IndexedDB) implementation of StorageDriver
 */

import Dexie, { Table } from 'dexie';
import type {
  Conversation,
  Message,
  Attachment,
  VaultSecrets,
  Identity,
  DeletedConversationRecord,
  IgnoredConversationRecord,
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
  // Legacy contacts table keyed by address (v1/v2)
  contacts!: Table<Contact & { address?: string }, string>;
  // New contacts table keyed by inboxId (v3)
  contacts_v3!: Table<Contact, string>;
  deletedConversations!: Table<DeletedConversationRecord, string>;
  ignoredConversations!: Table<IgnoredConversationRecord, string>;

  constructor(name: string) {
    super(name);

    this.version(1).stores({
      conversations: 'id, lastMessageAt, pinned, archived, peerId',
      messages: 'id, conversationId, sentAt, sender, [conversationId+sentAt]',
      attachments: 'id, messageId',
      attachmentData: 'id',
      identity: 'address',
      vaultSecrets: 'method',
      contacts: 'address',
    });

    this.version(2)
      .stores({
        conversations: 'id, lastMessageAt, pinned, archived, peerId',
        messages: 'id, conversationId, sentAt, sender, [conversationId+sentAt]',
        attachments: 'id, messageId',
        attachmentData: 'id',
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
        contacts: 'address',
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

          for (const legacy of legacyContacts as Array<Contact & { address?: string }>) {
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
      ignoredConversations: '&conversationId',
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
      reason: record.reason,
    };
    await this.dataDb.deletedConversations.put(entry);
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

  async ignoreConversation(record: Omit<IgnoredConversationRecord, 'createdAt'> & { createdAt?: number }): Promise<void> {
    if (!record.conversationId) {
      return;
    }
    const entry: IgnoredConversationRecord = {
      conversationId: record.conversationId,
      createdAt: record.createdAt ?? Date.now(),
      reason: record.reason,
    };
    await this.dataDb.ignoredConversations.put(entry);
  }

  async unignoreConversation(conversationId: string): Promise<void> {
    if (!conversationId) {
      return;
    }
    await this.dataDb.ignoredConversations.delete(conversationId);
  }

  async isConversationIgnored(conversationId: string): Promise<boolean> {
    if (!conversationId) {
      return false;
    }
    const record = await this.dataDb.ignoredConversations.get(conversationId);
    return Boolean(record);
  }

  async listIgnoredConversationIds(): Promise<string[]> {
    const entries = await this.dataDb.ignoredConversations.toArray();
    return entries.map((entry) => entry.conversationId);
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
    await this.dataDb.contacts_v3.put(contact);
  }

  async getContact(inboxId: string): Promise<Contact | undefined> {
    return await this.dataDb.contacts_v3.get(inboxId);
  }

  async listContacts(): Promise<Contact[]> {
    return await this.dataDb.contacts_v3.toArray();
  }

  async deleteContact(inboxId: string): Promise<void> {
    await this.dataDb.contacts_v3.delete(inboxId);
  }

  async updateContact(inboxId: string, updates: Partial<Contact>): Promise<void> {
    await this.dataDb.contacts_v3.update(inboxId, updates);
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
  async clearAllData(): Promise<void> {
    await this.dataDb.transaction('rw', [
      this.dataDb.conversations,
      this.dataDb.messages,
      this.dataDb.attachments,
      this.dataDb.attachmentData,
      this.dataDb.contacts,
      this.dataDb.contacts_v3,
      this.dataDb.deletedConversations,
      this.dataDb.ignoredConversations,
    ], async () => {
      await this.dataDb.conversations.clear();
      await this.dataDb.messages.clear();
      await this.dataDb.attachments.clear();
      await this.dataDb.attachmentData.clear();
      await this.dataDb.contacts.clear();
      await this.dataDb.contacts_v3.clear();
      await this.dataDb.deletedConversations.clear();
      await this.dataDb.ignoredConversations.clear();
      console.log('[Storage] ✅ All IndexedDB data cleared');
    });

    // Also clear XMTP OPFS database
    try {
      const opfsRoot = await navigator.storage.getDirectory();
      // XMTP stores databases with names like "xmtp-production-{address}.db3"
      // @ts-expect-error - OPFS API types
      for await (const [name] of opfsRoot.entries()) {
        if (name.startsWith('xmtp-') && name.endsWith('.db3')) {
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
