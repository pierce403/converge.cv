/**
 * Storage driver interface for swappable backends (Dexie, SQLite, etc.)
 */

import type {
  Conversation,
  Message,
  Attachment,
  VaultSecrets,
  Identity,
  DeletedConversationRecord,
  StoredRemoteAttachmentEnvelope,
} from '@/types';
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

export interface ClearAllDataResult {
  deletedOpfsDatabases: string[];
  opfsWarning?: string;
}

export interface AttachmentCachePruneOptions {
  maxBytes: number;
  requiredBytes?: number;
  protectedIds?: string[];
}

export interface AttachmentCachePruneResult {
  usageBytes: number;
  evictedIds: string[];
}

export interface PublishedAttachmentReconciliation {
  optimisticMessageId: string;
  message: Message;
  attachment: Attachment;
  data: ArrayBuffer;
  remoteEnvelope?: StoredRemoteAttachmentEnvelope;
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
  markConversationDeleted(record: DeletedConversationRecord): Promise<void>;
  listDeletedConversations(): Promise<DeletedConversationRecord[]>;
  isConversationDeleted(conversationId: string): Promise<boolean>;
  isPeerDeleted(peerId: string): Promise<boolean>;
  unmarkConversationDeletion(conversationId: string): Promise<void>;
  unmarkPeerDeletion(peerId: string): Promise<void>;
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
  putAttachmentMetadata(attachment: Attachment): Promise<void>;
  markAttachmentFailed(id: string, failureReason: string): Promise<boolean>;
  getAttachmentMetadata(id: string): Promise<Attachment | undefined>;
  getAttachmentData(id: string): Promise<ArrayBuffer | undefined>;
  getAttachment(id: string): Promise<{ attachment: Attachment; data: ArrayBuffer } | undefined>;
  putRemoteAttachmentEnvelope(envelope: StoredRemoteAttachmentEnvelope): Promise<void>;
  getRemoteAttachmentEnvelope(id: string): Promise<StoredRemoteAttachmentEnvelope | undefined>;
  evictAttachmentData(id: string): Promise<void>;
  getAttachmentCacheUsage(): Promise<number>;
  pruneAttachmentCache(options: AttachmentCachePruneOptions): Promise<AttachmentCachePruneResult>;
  cacheRemoteAttachment(
    attachment: Attachment,
    data: ArrayBuffer,
    maxBytes: number,
  ): Promise<AttachmentCachePruneResult>;
  reconcilePublishedAttachment(input: PublishedAttachmentReconciliation): Promise<void>;
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
  clearAllData(options?: { opfsAddresses?: string[] }): Promise<ClearAllDataResult>;

  // Search
  searchMessages(query: string, limit?: number): Promise<Message[]>;

  // Maintenance
  vacuum(): Promise<void>;
  getStorageSize(): Promise<number>; // bytes
}
