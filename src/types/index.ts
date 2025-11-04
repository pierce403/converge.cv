/**
 * Core application types
 */

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
  createdAt: number;
  isGroup?: boolean;
  groupName?: string; // Human-readable name for group chats
  groupImage?: string; // URL or base64 data for group avatar
  groupDescription?: string; // Optional description for the group
  members?: string[]; // List of member addresses
  admins?: string[]; // List of admin addresses
}

export interface Message {
  id: string;
  conversationId: string;
  sender: string;
  sentAt: number;
  receivedAt?: number;
  type: 'text' | 'attachment' | 'system';
  body: string;
  status: 'pending' | 'sent' | 'delivered' | 'failed';
  reactions: Reaction[];
  expiresAt?: number;
  replyTo?: string;
}

export interface Reaction {
  emoji: string;
  sender: string;
  timestamp: number;
}

export interface Attachment {
  id: string;
  messageId: string;
  mimeType: string;
  size: number;
  filename: string;
  storageRef: string;
  sha256?: string;
  thumbnailRef?: string;
}

export interface VaultSecrets {
  wrappedVaultKey: string;
  method: 'passkey' | 'passphrase';
  salt: string;
  iterations?: number;
  passkeyCredentialId?: string;
}

export interface Identity {
  address: string;
  publicKey: string;
  privateKey?: string; // Should be encrypted in storage
  createdAt: number;
  avatar?: string; // Avatar URL or data URI
  displayName?: string; // Optional display name
  inboxId?: string; // XMTP inbox ID
  installationId?: string; // XMTP installation ID for this device
  farcasterFid?: number; // Farcaster FID for contact syncing
}

export interface InboxRegistryEntry {
  inboxId: string;
  displayLabel: string;
  primaryDisplayIdentity: string;
  lastOpenedAt: number;
  hasLocalDB: boolean;
}

export type MessageStatus = 'pending' | 'sent' | 'delivered' | 'failed';
export type ConversationType = 'dm' | 'group';

// Ethereum wallet types
export interface EthereumProvider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, callback: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, callback: (...args: unknown[]) => void) => void;
  isMetaMask?: boolean;
}

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

