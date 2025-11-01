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

  constructor() {
    super('ConvergeDB');

    this.version(1).stores({
      conversations: 'id, lastMessageAt, pinned, archived, peerId',
      messages: 'id, conversationId, sentAt, sender, [conversationId+sentAt]',
      attachments: 'id, messageId',
      attachmentData: 'id',
      identity: 'address',
      vaultSecrets: 'method',
    });

    this.version(2)
      .stores({
        conversations: 'id, lastMessageAt, pinned, archived, peerId',
        messages: 'id, conversationId, sentAt, sender, [conversationId+sentAt]',
        attachments: 'id, messageId',
        attachmentData: 'id',
        identity: 'address, inboxId',
        vaultSecrets: 'method',
      })
      .upgrade(async (transaction) => {
        const identities = await transaction.table('identity').toArray();
        await Promise.all(
          identities.map((identity) =>
            transaction.table('identity').put({ ...identity })
          )
        );
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

    return await collection.toArray();
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

    return await collection.toArray();
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
    ], async () => {
      await this.db.conversations.clear();
      await this.db.messages.clear();
      await this.db.attachments.clear();
      await this.db.attachmentData.clear();
      await this.db.identity.clear();
      await this.db.vaultSecrets.clear();
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

