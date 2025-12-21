/**
 * Core application types
 */

export type GroupPermissionPolicyCode = 0 | 1 | 2 | 3 | 4 | 5;

export interface GroupPermissionPolicySet {
  addMemberPolicy: GroupPermissionPolicyCode;
  removeMemberPolicy: GroupPermissionPolicyCode;
  addAdminPolicy: GroupPermissionPolicyCode;
  removeAdminPolicy: GroupPermissionPolicyCode;
  updateGroupNamePolicy: GroupPermissionPolicyCode;
  updateGroupDescriptionPolicy: GroupPermissionPolicyCode;
  updateGroupImageUrlSquarePolicy: GroupPermissionPolicyCode;
  updateMessageDisappearingPolicy: GroupPermissionPolicyCode;
}

export type GroupPermissionsPolicyType = 0 | 1 | 2;

export interface GroupPermissionsState {
  policyType: GroupPermissionsPolicyType;
  policySet: GroupPermissionPolicySet;
}

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
  profileSentDisplayName?: boolean; // Track if we've sent our display name to this conversation
  profileSentAvatar?: boolean; // Track if we've sent our avatar to this conversation
  isGroup?: boolean;
  groupName?: string; // Human-readable name for group chats
  groupImage?: string; // URL or base64 data for group avatar
  groupDescription?: string; // Optional description for the group
  members?: string[]; // List of member addresses
  admins?: string[]; // List of admin addresses
  memberInboxes?: string[]; // XMTP inbox IDs for members
  adminInboxes?: string[]; // XMTP inbox IDs for admins
  superAdminInboxes?: string[]; // XMTP inbox IDs for super admins
  groupMembers?: GroupMember[];
  groupPermissions?: GroupPermissionsState;
  isLocalOnly?: boolean;
  /**
   * Timestamp (ms since epoch) of the last successful network sync for this conversation.
   * Used to throttle per-conversation sync calls.
   */
  lastSyncedAt?: number;
}

export interface DeletedConversationRecord {
  conversationId: string;
  peerId: string;
  deletedAt: number;
  reason?: 'user-hidden' | 'user-muted' | 'system';
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

export interface GroupMember {
  inboxId: string;
  address?: string;
  permissionLevel?: number;
  isAdmin?: boolean;
  isSuperAdmin?: boolean;
  displayName?: string;
  avatar?: string;
}

export interface Identity {
  address: string;
  publicKey: string;
  privateKey?: string; // Should be encrypted in storage
  createdAt: number;
  /**
   * Timestamp (ms since epoch) of the last successful XMTP "check inbox" / conversation sync.
   * Used to throttle redundant network syncs across reloads.
   */
  lastSyncedAt?: number;
  avatar?: string; // Avatar URL or data URI
  displayName?: string; // Optional display name
  inboxId?: string; // XMTP inbox ID
  installationId?: string; // XMTP installation ID for this device
  farcasterFid?: number; // Farcaster FID for contact syncing
  mnemonic?: string; // Optional BIP39 phrase for local identities
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
