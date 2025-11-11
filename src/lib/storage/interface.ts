/**
 * Storage driver interface for swappable backends (Dexie, SQLite, etc.)
 */

import type { Conversation, Message, Attachment, VaultSecrets, Identity } from '@/types';
import type { Contact } from '../stores/contact-store';

export interface PageOpts {
  limit?: number;
  offset?: number;
  before?: number; // timestamp
  after?: number; // timestamp
}

export interface Query {
  pinned?: boolean;
  archived?: boolean;
  search?: string;
}

export interface StorageDriver {
  // Initialization
  init(): Promise<void>;
  close(): Promise<void>;

  // Conversations
  putConversation(conversation: Conversation): Promise<void>;
  getConversation(id: string): Promise<Conversation | undefined>;
  listConversations(query?: Query): Promise<Conversation[]>;
  deleteConversation(id: string): Promise<void>;
  updateConversationReadState(
    id: string,
    updates: {
      unreadCount?: number;
      lastReadAt?: number;
      lastReadMessageId?: string | null;
    }
  ): Promise<void>;

  // Messages
  putMessage(message: Message): Promise<void>;
  getMessage(id: string): Promise<Message | undefined>;
  listMessages(conversationId: string, opts?: PageOpts): Promise<Message[]>;
  deleteMessage(id: string): Promise<void>;
  updateMessageStatus(id: string, status: Message['status']): Promise<void>;
  updateMessageReactions(id: string, reactions: Message['reactions']): Promise<void>;
  deleteExpiredMessages(): Promise<number>; // returns count deleted

  // Attachments
  putAttachment(attachment: Attachment, data: ArrayBuffer): Promise<void>;
  getAttachment(id: string): Promise<{ attachment: Attachment; data: ArrayBuffer } | undefined>;
  deleteAttachment(id: string): Promise<void>;

  // Identity
  putIdentity(identity: Identity): Promise<void>;
  getIdentity(): Promise<Identity | undefined>;
  listIdentities(): Promise<Identity[]>;
  getIdentityByAddress(address: string): Promise<Identity | undefined>;
  getIdentityByInboxId(inboxId: string): Promise<Identity | undefined>;
  deleteIdentity(): Promise<void>;
  deleteIdentityByAddress(address: string): Promise<void>;

  // Contacts
  putContact(contact: Contact): Promise<void>;
  getContact(inboxId: string): Promise<Contact | undefined>;
  listContacts(): Promise<Contact[]>;
  deleteContact(inboxId: string): Promise<void>;
  updateContact(inboxId: string, updates: Partial<Contact>): Promise<void>;

  // Vault secrets
  putVaultSecrets(secrets: VaultSecrets): Promise<void>;
  getVaultSecrets(): Promise<VaultSecrets | undefined>;
  deleteVaultSecrets(): Promise<void>;

  // Clear all data
  clearAllData(): Promise<void>;

  // Search
  searchMessages(query: string, limit?: number): Promise<Message[]>;

  // Maintenance
  vacuum(): Promise<void>;
  getStorageSize(): Promise<number>; // bytes
}
