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

  constructor() {
    super('ConvergeDB');

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
  }
}

export class DexieDriver implements StorageDriver {
  private db: ConvergeDB;

  constructor() {
    this.db = new ConvergeDB();
  }

  async init(): Promise<void> {
    await this.db.open();
  }

  async close(): Promise<void> {
    this.db.close();
  }

  // Conversations
  async putConversation(conversation: Conversation): Promise<void> {
    await this.db.conversations.put(conversation);
  }

  async getConversation(id: string): Promise<Conversation | undefined> {
    return await this.db.conversations.get(id);
  }

  async listConversations(query?: Query): Promise<Conversation[]> {
    let collection = this.db.conversations.orderBy('lastMessageAt').reverse();

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
    await this.db.transaction('rw', [this.db.conversations, this.db.messages], async () => {
      await this.db.conversations.delete(id);
      await this.db.messages.where('conversationId').equals(id).delete();
    });
  }

  async updateConversationUnread(id: string, count: number): Promise<void> {
    await this.db.conversations.update(id, { unreadCount: count });
  }

  // Messages
  async putMessage(message: Message): Promise<void> {
    await this.db.messages.put(message);
    
    // Update conversation lastMessageAt and preview
    const conversation = await this.db.conversations.get(message.conversationId);
    if (conversation) {
      await this.db.conversations.update(message.conversationId, {
        lastMessageAt: message.sentAt,
        lastMessagePreview: message.type === 'text' ? message.body.substring(0, 100) : '📎 Attachment',
      });
    }
  }

  async getMessage(id: string): Promise<Message | undefined> {
    return await this.db.messages.get(id);
  }

  async listMessages(conversationId: string, opts?: PageOpts): Promise<Message[]> {
    let collection = this.db.messages
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
    await this.db.messages.delete(id);
  }

  async updateMessageStatus(id: string, status: Message['status']): Promise<void> {
    await this.db.messages.update(id, { status });
  }

  async deleteExpiredMessages(): Promise<number> {
    const now = Date.now();
    const expired = await this.db.messages
      .filter((m) => m.expiresAt !== undefined && m.expiresAt < now)
      .toArray();

    await this.db.messages.bulkDelete(expired.map((m) => m.id));
    return expired.length;
  }

  // Attachments
  async putAttachment(attachment: Attachment, data: ArrayBuffer): Promise<void> {
    await this.db.transaction('rw', [this.db.attachments, this.db.attachmentData], async () => {
      await this.db.attachments.put(attachment);
      await this.db.attachmentData.put({ id: attachment.id, data });
    });
  }

  async getAttachment(
    id: string
  ): Promise<{ attachment: Attachment; data: ArrayBuffer } | undefined> {
    const [attachment, attachmentData] = await Promise.all([
      this.db.attachments.get(id),
      this.db.attachmentData.get(id),
    ]);

    if (!attachment || !attachmentData) {
      return undefined;
    }

    return { attachment, data: attachmentData.data };
  }

  async deleteAttachment(id: string): Promise<void> {
    await this.db.transaction('rw', [this.db.attachments, this.db.attachmentData], async () => {
      await this.db.attachments.delete(id);
      await this.db.attachmentData.delete(id);
    });
  }

  // Identity
  async putIdentity(identity: Identity): Promise<void> {
    await this.db.identity.put(identity);
  }

  async getIdentity(): Promise<Identity | undefined> {
    const identities = await this.db.identity.toArray();
    return identities[0];
  }

  async listIdentities(): Promise<Identity[]> {
    return await this.db.identity.toArray();
  }

  async getIdentityByAddress(address: string): Promise<Identity | undefined> {
    return await this.db.identity.get(address);
  }

  async getIdentityByInboxId(inboxId: string): Promise<Identity | undefined> {
    return await this.db.identity.where('inboxId').equals(inboxId).first();
  }

  async deleteIdentity(): Promise<void> {
    await this.db.identity.clear();
  }

  async deleteIdentityByAddress(address: string): Promise<void> {
    await this.db.identity.delete(address);
  }

  // Contacts
  async putContact(contact: Contact): Promise<void> {
    await this.db.contacts_v3.put(contact);
  }

  async getContact(inboxId: string): Promise<Contact | undefined> {
    return await this.db.contacts_v3.get(inboxId);
  }

  async listContacts(): Promise<Contact[]> {
    return await this.db.contacts_v3.toArray();
  }

  async deleteContact(inboxId: string): Promise<void> {
    await this.db.contacts_v3.delete(inboxId);
  }

  async updateContact(inboxId: string, updates: Partial<Contact>): Promise<void> {
    await this.db.contacts_v3.update(inboxId, updates);
  }

  // Vault secrets
  async putVaultSecrets(secrets: VaultSecrets): Promise<void> {
    await this.db.vaultSecrets.put(secrets);
  }

  async getVaultSecrets(): Promise<VaultSecrets | undefined> {
    const secrets = await this.db.vaultSecrets.toArray();
    return secrets[0];
  }

  async deleteVaultSecrets(): Promise<void> {
    await this.db.vaultSecrets.clear();
  }

  // Clear ALL data
  async clearAllData(): Promise<void> {
    await this.db.transaction('rw', [
      this.db.conversations,
      this.db.messages,
      this.db.attachments,
      this.db.attachmentData,
      this.db.identity,
      this.db.vaultSecrets,
      this.db.contacts,
      this.db.contacts_v3,
    ], async () => {
      await this.db.conversations.clear();
      await this.db.messages.clear();
      await this.db.attachments.clear();
      await this.db.attachmentData.clear();
      await this.db.identity.clear();
      await this.db.vaultSecrets.clear();
      await this.db.contacts.clear();
      await this.db.contacts_v3.clear();
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
    return await this.db.messages
      .filter(
        (m) =>
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
    const messageIds = new Set((await this.db.messages.toArray()).map((m) => m.id));
    const attachments = await this.db.attachments.toArray();

    const orphaned = attachments.filter((a) => !messageIds.has(a.messageId));
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
