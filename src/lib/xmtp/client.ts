/**
 * XMTP client wrapper (v5.0.1)
 * 
 * Production-ready implementation using @xmtp/browser-sdk.
 * Following xmtp.chat reference implementation.
 */

import {
  Client,
  type Signer,
  type SafeInboxState,
  type SafeGroupMember,
  type Identifier,
} from '@xmtp/browser-sdk';
import xmtpPackage from '@xmtp/browser-sdk/package.json';
import { logNetworkEvent } from '@/lib/stores';
import { useXmtpStore } from '@/lib/stores/xmtp-store';
import buildInfo from '@/build-info.json';
import { createEOASigner, createEphemeralSigner } from '@/lib/wagmi/signers';
import type { Conversation } from '@/types';
import { getAddress } from 'viem';

export interface XmtpIdentity {
  address: string;
  privateKey?: string;
  inboxId?: string;
  installationId?: string;
  chainId?: number; // For smart contract wallets
  signMessage?: (message: string) => Promise<string>; // For wallet-based signing via wagmi
  displayName?: string;
}

export interface IdentityProbeResult {
  isRegistered: boolean;
  inboxId: string | null;
  installationCount: number;
  inboxState?: SafeInboxState;
}

interface ConnectOptions {
  register?: boolean;
  enableHistorySync?: boolean;
}



export interface XmtpSdkConversation {
  id: string;
  createdAtNs: bigint;
  peerAddress: string;
  topic: string;
}

export interface XmtpMessage {
  id: string;
  conversationId: string;
  senderAddress: string;
  content: string | Uint8Array;
  sentAt: number;
  isLocalFallback?: boolean;
}

export type MessageCallback = (message: XmtpMessage) => void;
export type Unsubscribe = () => void;

export interface GroupMemberSummary {
  inboxId: string;
  address?: string;
  permissionLevel?: number;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  identifiers: Identifier[];
}

export interface GroupDetails {
  id: string;
  name: string;
  imageUrl?: string;
  description?: string;
  members: GroupMemberSummary[];
  adminAddresses: string[];
  superAdminAddresses: string[];
  adminInboxes: string[];
  superAdminInboxes: string[];
}

export interface InboxProfile {
  inboxId: string;
  displayName?: string;
  avatarUrl?: string;
  primaryAddress?: string;
  addresses: string[];
  identities: Array<{
    identifier: string;
    kind: string;
    isPrimary?: boolean;
  }>;
}

const ETH_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

const isEthereumAddress = (value: string): boolean => ETH_ADDRESS_REGEX.test(value);

const toIdentifierHex = (address: string): string =>
  address.startsWith('0x') || address.startsWith('0X') ? address.slice(2) : address;

/**
 * XMTP Client wrapper for v5 SDK
 */
export class XmtpClient {
  private client: Client | null = null;
  private identity: XmtpIdentity | null = null;
  private messageStreamCloser: { close: () => void } | null = null;

  private formatPayload(payload: unknown): string {
    if (typeof payload === 'string') {
      return payload;
    }

    if (payload instanceof Uint8Array) {
      return `Uint8Array(${payload.length})`;
    }

    try {
      return JSON.stringify(payload, null, 2);
    } catch (error) {
      return String(payload);
    }
  }

  private normalizeEthereumAddress(address: string): `0x${string}` {
    try {
      return getAddress(address as `0x${string}`);
    } catch (error) {
      console.warn('[XMTP] Invalid Ethereum address supplied:', address, error);
      throw new Error(`Invalid Ethereum address: ${address}`);
    }
  }

  private generateLocalId(prefix: string): string {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  private createLocalConversation(peerId: string, overrides?: Partial<Conversation>): Conversation {
    const now = Date.now();
    const id = overrides?.id ?? this.generateLocalId('local-conversation');
    const isGroup = overrides?.isGroup ?? false;

    const topic = overrides?.topic ?? (isGroup ? null : id);

    return {
      id,
      peerId,
      topic,
      lastMessageAt: overrides?.lastMessageAt ?? now,
      lastMessagePreview: overrides?.lastMessagePreview,
      unreadCount: overrides?.unreadCount ?? 0,
      pinned: overrides?.pinned ?? false,
      archived: overrides?.archived ?? false,
      mutedUntil: overrides?.mutedUntil,
      createdAt: overrides?.createdAt ?? now,
      displayName: overrides?.displayName ?? (isGroup ? overrides?.groupName ?? 'Local Group' : peerId),
      displayAvatar: overrides?.displayAvatar,
      isGroup,
      groupName: overrides?.groupName,
      groupImage: overrides?.groupImage,
      groupDescription: overrides?.groupDescription,
      members: overrides?.members,
      admins: overrides?.admins,
      memberInboxes: overrides?.memberInboxes,
      adminInboxes: overrides?.adminInboxes,
      superAdminInboxes: overrides?.superAdminInboxes,
      groupMembers: overrides?.groupMembers,
      isLocalOnly: true,
    };
  }

  private createLocalMessage(conversationId: string, content: string): XmtpMessage {
    const now = Date.now();
    return {
      id: this.generateLocalId('local-message'),
      conversationId,
      senderAddress:
        this.identity?.inboxId ??
        this.identity?.address ??
        'local-sender',
      content,
      sentAt: now,
      isLocalFallback: true,
    };
  }

  async deriveInboxIdFromAddress(address: string): Promise<string | null> {
    try {
      const normalized = this.normalizeEthereumAddress(address);
      try {
        const existing = await this.getInboxIdFromAddress(normalized);
        if (existing) {
          return existing;
        }
      } catch (error) {
        console.warn('[XMTP] deriveInboxIdFromAddress: getInboxIdFromAddress failed, falling back to Utils', error);
      }

      const { Utils } = await import('@xmtp/browser-sdk');
      const utils: InstanceType<typeof Utils> = new Utils(false);

      const identifier = {
        identifier: toIdentifierHex(normalized).toLowerCase(),
        identifierKind: 'Ethereum' as const,
      };

      try {
        const resolved = await utils.getInboxIdForIdentifier(identifier, 'production');
        if (resolved) {
          return resolved;
        }
      } catch (error) {
        console.warn('[XMTP] deriveInboxIdFromAddress: getInboxIdForIdentifier failed, attempting generateInboxId', error);
      }

      try {
        const generated = await utils.generateInboxId(identifier);
        if (generated) {
          return generated;
        }
      } catch (error) {
        console.warn('[XMTP] deriveInboxIdFromAddress: generateInboxId failed', error);
      }

      // As a last resort, return the normalized address
      return normalized;
    } catch (error) {
      console.error('[XMTP] deriveInboxIdFromAddress failed:', error);
      return null;
    }
  }

  async fetchInboxProfile(inboxId: string): Promise<InboxProfile> {
    const normalizedInboxId = inboxId.toLowerCase();

    const toIdentityRecord = (identifier: Identifier, index: number) => ({
      identifier: identifier.identifier.startsWith('0x')
        ? identifier.identifier.toLowerCase()
        : identifier.identifier.toLowerCase(),
      kind: identifier.identifierKind,
      isPrimary: index === 0,
    });

    const addressesFromIdentifiers = (identifiers: Identifier[] = []): string[] => {
      return identifiers
        .filter((identifier) => identifier.identifierKind === 'Ethereum')
        .map((identifier) =>
          identifier.identifier.startsWith('0x')
            ? identifier.identifier.toLowerCase()
            : `0x${identifier.identifier.toLowerCase()}`
        );
    };

    const buildProfile = (identifiers: Identifier[] | undefined): InboxProfile => {
      const identityRecords = (identifiers ?? []).map(toIdentityRecord);
      const addresses = addressesFromIdentifiers(identifiers);
      return {
        inboxId: normalizedInboxId,
        displayName: addresses[0],
        avatarUrl: undefined,
        primaryAddress: addresses[0],
        addresses,
        identities: identityRecords,
      };
    };

    try {
      if (this.client) {
        try {
          const latest = await this.client.preferences.getLatestInboxState(normalizedInboxId);
          if (latest) {
            return buildProfile(latest.identifiers ?? []);
          }
        } catch (error) {
          console.warn('[XMTP] fetchInboxProfile: getLatestInboxState failed, falling back to inboxStateFromInboxIds', error);
        }

        try {
          const states = await this.client.preferences.inboxStateFromInboxIds([normalizedInboxId], true);
          if (states?.length) {
            return buildProfile(states[0]?.identifiers ?? []);
          }
        } catch (error) {
          console.warn('[XMTP] fetchInboxProfile: inboxStateFromInboxIds failed', error);
        }
      }

      const { Utils } = await import('@xmtp/browser-sdk');
      const utils: InstanceType<typeof Utils> = new Utils(false);
      try {
        const states = await utils.inboxStateFromInboxIds([normalizedInboxId], 'production');
        if (states?.length) {
          const state = states[0] as SafeInboxState;
          return buildProfile(state.identifiers);
        }
      } catch (error) {
        console.warn('[XMTP] fetchInboxProfile: Utils inboxStateFromInboxIds failed', error);
      }
    } catch (error) {
      console.error('[XMTP] fetchInboxProfile unexpected error:', error);
    }

    return buildProfile([]);
  }

  private identifierFromAddress(address: string): Identifier {
    const normalized = this.normalizeEthereumAddress(address);
    return {
      identifier: toIdentifierHex(normalized).toLowerCase(),
      identifierKind: 'Ethereum',
    };
  }

  private extractAddressFromMember(member: SafeGroupMember): string | null {
    if (!member.accountIdentifiers) {
      return null;
    }

    for (const identifier of member.accountIdentifiers) {
      if (identifier.identifierKind !== 'Ethereum' || !identifier.identifier) {
        continue;
      }

      try {
        const segments = identifier.identifier.split(':');
        const raw = segments.length > 1 ? segments[segments.length - 1] : identifier.identifier;
        const withPrefix = raw.startsWith('0x') || raw.startsWith('0X') ? raw : `0x${raw}`;
        return getAddress(withPrefix as `0x${string}`);
      } catch (error) {
        console.warn('[XMTP] Failed to normalize member identifier:', identifier.identifier, error);
        return identifier.identifier;
      }
    }

    return null;
  }

  private async getGroupConversation(conversationId: string) {
    if (!this.client) {
      throw new Error('Client not connected');
    }

    const conversation = await this.client.conversations.getConversationById(conversationId);
    if (!conversation) {
      console.warn('[XMTP] Group conversation not found:', conversationId);
      return null;
    }

    if (typeof (conversation as { members?: () => Promise<SafeGroupMember[]> }).members !== 'function') {
      console.warn('[XMTP] Conversation is not a group:', conversationId);
      return null;
    }

    return conversation as unknown as {
      id: string;
      name?: string;
      imageUrl?: string;
      description?: string;
      sync?: () => Promise<unknown>;
      members: () => Promise<SafeGroupMember[]>;
      listAdmins?: () => Promise<string[]>;
      listSuperAdmins?: () => Promise<string[]>;
      updateName?: (name: string) => Promise<void>;
      updateImageUrl?: (imageUrl: string) => Promise<void>;
      updateDescription?: (description: string) => Promise<void>;
      addMembersByIdentifiers?: (identifiers: Identifier[]) => Promise<void>;
      removeMembersByIdentifiers?: (identifiers: Identifier[]) => Promise<void>;
      addMembers?: (inboxIds: string[]) => Promise<void>;
      removeMembers?: (inboxIds: string[]) => Promise<void>;
      addAdmin?: (inboxId: string) => Promise<void>;
      removeAdmin?: (inboxId: string) => Promise<void>;
    };
  }

  private async buildGroupDetails(conversationId: string, group: Awaited<ReturnType<typeof this.getGroupConversation>>): Promise<GroupDetails> {
    const safeGroup = group;
    if (!safeGroup) {
      throw new Error(`Group ${conversationId} unavailable`);
    }

    try {
      await safeGroup.sync?.();
    } catch (error) {
      console.warn('[XMTP] Failed to sync group before reading metadata:', conversationId, error);
    }

    let members: SafeGroupMember[] = [];
    try {
      members = await safeGroup.members();
    } catch (error) {
      console.warn('[XMTP] Failed to load group members:', conversationId, error);
    }

    const adminInboxIds = await (async () => {
      if (typeof safeGroup.listAdmins !== 'function') return [] as string[];
      try {
        return await safeGroup.listAdmins();
      } catch (error) {
        console.warn('[XMTP] Failed to list group admins:', conversationId, error);
        return [] as string[];
      }
    })();

    const superAdminInboxIds = await (async () => {
      if (typeof safeGroup.listSuperAdmins !== 'function') return [] as string[];
      try {
        return await safeGroup.listSuperAdmins();
      } catch (error) {
        console.warn('[XMTP] Failed to list group super admins:', conversationId, error);
        return [] as string[];
      }
    })();

    const memberSummaries: GroupMemberSummary[] = members.map((member) => {
      const address = this.extractAddressFromMember(member) ?? undefined;
      const isAdmin = adminInboxIds.includes(member.inboxId);
      const isSuperAdmin = superAdminInboxIds.includes(member.inboxId);
      return {
        inboxId: member.inboxId,
        address,
        permissionLevel: member.permissionLevel,
        isAdmin,
        isSuperAdmin,
        identifiers: member.accountIdentifiers ?? [],
      };
    });

    const toAddress = (inboxId: string) => {
      const match = memberSummaries.find((member) => member.inboxId === inboxId);
      return match?.address ?? inboxId;
    };

    const adminAddresses = Array.from(new Set(adminInboxIds.map(toAddress)));
    const superAdminAddresses = Array.from(new Set(superAdminInboxIds.map(toAddress)));

    return {
      id: conversationId,
      name: safeGroup.name ?? '',
      imageUrl: safeGroup.imageUrl ?? '',
      description: safeGroup.description ?? '',
      members: memberSummaries,
      adminAddresses,
      superAdminAddresses,
      adminInboxes: Array.from(new Set(adminInboxIds)),
      superAdminInboxes: Array.from(new Set(superAdminInboxIds)),
    };
  }

  async fetchGroupDetails(conversationId: string): Promise<GroupDetails | null> {
    try {
      const group = await this.getGroupConversation(conversationId);
      if (!group) {
        return null;
      }
      const details = await this.buildGroupDetails(conversationId, group);
      logNetworkEvent({
        direction: 'status',
        event: 'group:details_fetched',
        details: `Fetched metadata for group ${conversationId}`,
      });
      return details;
    } catch (error) {
      console.error('[XMTP] Failed to fetch group details:', error);
      return null;
    }
  }

  async updateGroupMetadata(
    conversationId: string,
    updates: { name?: string; imageUrl?: string; description?: string }
  ): Promise<GroupDetails | null> {
    const group = await this.getGroupConversation(conversationId);
    if (!group) {
      return null;
    }

    try {
      if (updates.name !== undefined && typeof group.updateName === 'function') {
        await group.updateName(updates.name);
      }
      if (updates.imageUrl !== undefined && typeof group.updateImageUrl === 'function') {
        await group.updateImageUrl(updates.imageUrl);
      }
      if (updates.description !== undefined && typeof group.updateDescription === 'function') {
        await group.updateDescription(updates.description);
      }

      logNetworkEvent({
        direction: 'outbound',
        event: 'group:metadata_updated',
        details: `Updated metadata for group ${conversationId}`,
        payload: this.formatPayload(updates),
      });

      return await this.buildGroupDetails(conversationId, group);
    } catch (error) {
      console.error('[XMTP] Failed to update group metadata:', error);
      throw error;
    }
  }

  async addMembersToGroup(conversationId: string, members: string[]): Promise<GroupDetails | null> {
    if (!members.length) {
      return this.fetchGroupDetails(conversationId);
    }

    if (!this.client) {
      console.warn('[XMTP] Client not connected; skipping remote addMembers and returning existing details');
      return this.fetchGroupDetails(conversationId);
    }

    const group = await this.getGroupConversation(conversationId);
    if (!group) {
      return null;
    }

    try {
      const inboxIds: string[] = [];
      const identifierPayloads: Identifier[] = [];

      for (const value of members) {
        if (!value || typeof value !== 'string') {
          continue;
        }
        const trimmed = value.trim();
        if (!trimmed) {
          continue;
        }
        if (isEthereumAddress(trimmed)) {
          try {
            identifierPayloads.push(this.identifierFromAddress(trimmed));
          } catch (error) {
            console.warn('[XMTP] Skipping invalid Ethereum address during addMembers:', trimmed, error);
          }
        } else {
          inboxIds.push(trimmed.toLowerCase());
        }
      }

      if (identifierPayloads.length) {
        if (typeof group.addMembersByIdentifiers === 'function') {
          await group.addMembersByIdentifiers(identifierPayloads);
        } else {
          throw new Error('SDK does not support addMembersByIdentifiers');
        }
      }

      if (inboxIds.length) {
        if (typeof group.addMembers === 'function') {
          await group.addMembers(inboxIds);
        } else {
          throw new Error('SDK does not support addMembers');
        }
      }

      logNetworkEvent({
        direction: 'outbound',
        event: 'group:add_members',
        details: `Added ${members.length} member(s) to group ${conversationId}`,
      });

      return await this.buildGroupDetails(conversationId, group);
    } catch (error) {
      console.error('[XMTP] Failed to add members to group:', error);
      throw error;
    }
  }

  async removeMembersFromGroup(conversationId: string, identifiersOrInboxes: string[]): Promise<GroupDetails | null> {
    if (!identifiersOrInboxes.length) {
      return this.fetchGroupDetails(conversationId);
    }

    if (!this.client) {
      console.warn('[XMTP] Client not connected; skipping remote removeMembers and returning existing details');
      return this.fetchGroupDetails(conversationId);
    }

    const group = await this.getGroupConversation(conversationId);
    if (!group) {
      return null;
    }

    try {
      const inboxIds: string[] = [];
      const identifierPayloads: Identifier[] = [];

      for (const value of identifiersOrInboxes) {
        if (typeof value !== 'string' || value.trim() === '') {
          continue;
        }
        const trimmed = value.trim();
        if (isEthereumAddress(trimmed)) {
          try {
            identifierPayloads.push(this.identifierFromAddress(trimmed));
          } catch (error) {
            console.warn('[XMTP] Skipping invalid Ethereum address during remove:', trimmed, error);
          }
        } else {
          inboxIds.push(trimmed);
        }
      }

      if (identifierPayloads.length && typeof group.removeMembersByIdentifiers === 'function') {
        await group.removeMembersByIdentifiers(identifierPayloads);
      }

      if (inboxIds.length && typeof group.removeMembers === 'function') {
        await group.removeMembers(inboxIds);
      }

      logNetworkEvent({
        direction: 'outbound',
        event: 'group:remove_members',
        details: `Removed ${identifiersOrInboxes.length} member(s) from group ${conversationId}`,
      });

      return await this.buildGroupDetails(conversationId, group);
    } catch (error) {
      console.error('[XMTP] Failed to remove members from group:', error);
      throw error;
    }
  }

  async promoteMemberToAdmin(conversationId: string, identifierOrInbox: string): Promise<GroupDetails | null> {
    const group = await this.getGroupConversation(conversationId);
    if (!group) {
      return null;
    }

    if (typeof group.addAdmin !== 'function') {
      throw new Error('SDK does not support admin promotion');
    }

    const target = identifierOrInbox.trim();
    const inboxId = isEthereumAddress(target)
      ? await this.getInboxIdFromAddress(target)
      : target;

    if (!inboxId) {
      throw new Error(`Unable to resolve XMTP inbox for ${identifierOrInbox}`);
    }

    try {
      await group.addAdmin(inboxId);
      logNetworkEvent({
        direction: 'outbound',
        event: 'group:promote_admin',
        details: `Promoted ${identifierOrInbox} (${inboxId}) to admin for group ${conversationId}`,
      });

      return await this.buildGroupDetails(conversationId, group);
    } catch (error) {
      console.error('[XMTP] Failed to promote member to admin:', error);
      throw error;
    }
  }

  async demoteAdminToMember(conversationId: string, identifierOrInbox: string): Promise<GroupDetails | null> {
    const group = await this.getGroupConversation(conversationId);
    if (!group) {
      return null;
    }

    if (typeof group.removeAdmin !== 'function') {
      throw new Error('SDK does not support admin demotion');
    }

    const target = identifierOrInbox.trim();
    const inboxId = isEthereumAddress(target)
      ? await this.getInboxIdFromAddress(target)
      : target;

    if (!inboxId) {
      throw new Error(`Unable to resolve XMTP inbox for ${identifierOrInbox}`);
    }

    try {
      await group.removeAdmin(inboxId);
      logNetworkEvent({
        direction: 'outbound',
        event: 'group:demote_admin',
        details: `Demoted ${identifierOrInbox} (${inboxId}) from admin for group ${conversationId}`,
      });

      return await this.buildGroupDetails(conversationId, group);
    } catch (error) {
      console.error('[XMTP] Failed to demote admin to member:', error);
      throw error;
    }
  }


  private async createSigner(identity: XmtpIdentity): Promise<Signer> {
    if (identity.privateKey) {
      console.log('[XMTP] Creating ephemeral signer (generated wallet)');
      return createEphemeralSigner(identity.privateKey as `0x${string}`);
    }

    if (identity.signMessage) {
      console.log('[XMTP] Creating EOA signer for wallet connection');
      return createEOASigner(identity.address as `0x${string}`, identity.signMessage);
    }

    throw new Error('Identity must have either privateKey or signMessage function');
  }

  /**
   * Connect to XMTP network with an identity
   */
  async connect(identity: XmtpIdentity, options?: ConnectOptions): Promise<void> {
    const { setConnectionStatus, setLastConnected, setError } = useXmtpStore.getState();

    // If already connected with the same identity, don't reconnect
    if (this.client && this.identity?.address === identity.address) {
      console.log('[XMTP] Already connected with this identity, skipping reconnect');
      return;
    }

    // If connected with a different identity, disconnect first
    if (this.client && this.identity?.address !== identity.address) {
      console.log('[XMTP] Disconnecting from previous identity before connecting new one');
      await this.disconnect();
    }

    logNetworkEvent({
      direction: 'outbound',
      event: 'connect',
      details: `Connecting as ${identity.address}`,
    });

    this.identity = identity;

    const shouldRegister = options?.register !== false;
    const shouldSyncHistory = options?.enableHistorySync !== false;

    let client: Client | null = null;

    try {
      setConnectionStatus('connecting');
      setError(null);

      // Step 1: Create the client
      logNetworkEvent({
        direction: 'outbound',
        event: 'connect:create_client',
        details: `Creating XMTP client for ${identity.address}`,
      });

      console.log('[XMTP] ═══════════════════════════════════════════════════');
      console.log('[XMTP] Build Info:', buildInfo);
      console.log('[XMTP] ═══════════════════════════════════════════════════');
      console.log('[XMTP] Creating client with address:', identity.address);
      console.log('[XMTP] Environment: production');
      console.log('[XMTP] SDK version: @xmtp/browser-sdk@' + xmtpPackage.version);
      console.log('[XMTP] User Agent:', navigator.userAgent);

      const signer = await this.createSigner(identity);

      console.log('[XMTP] Calling Client.create() with signer...');
      console.log('[XMTP] Client.create options:', {
        env: 'production',
        disableAutoRegister: true,
        loggingLevel: 'warn',
      });

      client = await Client.create(signer, {
        env: 'production',
        loggingLevel: 'warn',
        structuredLogging: false,
        performanceLogging: false,
        debugEventsEnabled: false,
        disableAutoRegister: true,
      });

      if (shouldRegister) {
        console.log('[XMTP] Registering inbox/installation after probe');
        await client.register();
      } else {
        console.log('[XMTP] Skipping register() per options (probe-only connection)');
      }

      if (shouldRegister) {
        try {
          const inboxState: SafeInboxState = await client.preferences.inboxState(true);
          const installationCount = inboxState.installations?.length ?? 0;
          if (installationCount >= 10) {
            throw new Error('⚠️ Installation limit reached (10/10). Please revoke old installations and retry.');
          }
          if (installationCount >= 8) {
            console.warn('[XMTP] Installation count nearing limit:', installationCount);
            logNetworkEvent({
              direction: 'status',
              event: 'connect:installation_warning',
              details: `Installation count ${installationCount}/10`,
            });
          }
        } catch (installError) {
          console.warn('[XMTP] Failed to inspect installation count after register:', installError);
        }
      }

      console.log('[XMTP] ✅ Client created successfully');
      console.log('[XMTP] Client properties:', {
        inboxId: client.inboxId,
        installationId: client.installationId,
        isReady: client.isReady,
      });
      this.client = client;

      // Save the installation ID to the identity if it's new
      if (identity.installationId !== client.installationId) {
        console.log('[XMTP] New installation ID detected, updating identity...');
        // The caller (useAuth) should handle saving this
        logNetworkEvent({
          direction: 'status',
          event: 'connect:installation_id',
          details: `Installation ID: ${client.installationId}`,
        });
      }

      logNetworkEvent({
        direction: 'status',
        event: 'connect:registration_check',
        details: `Register step ${shouldRegister ? 'completed' : 'skipped'}; inbox ID: ${client.inboxId}`,
      });

      setConnectionStatus('connected');
      setLastConnected(Date.now());

      logNetworkEvent({
        direction: 'status',
        event: 'connect:success',
        details: `Connected to XMTP as ${identity.address} (inbox: ${client.inboxId})`,
      });

      console.log('[XMTP] ✅ XMTP client connected', identity.address, 'inbox:', client.inboxId);

      // Start syncing conversations and streaming messages
      console.log('[XMTP] Starting conversation sync and message streaming...');
      const { setSyncStatus, setSyncProgress } = useXmtpStore.getState();

      setSyncStatus('syncing-conversations');
      setSyncProgress(0);
      await this.syncConversations();

      if (shouldSyncHistory) {
        console.log('[XMTP] History sync enabled – fetching past messages. This may take time if another device needs to provide history.');
        setSyncStatus('syncing-messages');
        setSyncProgress(40);
        await this.syncHistory();
        setSyncProgress(85);
      } else {
        console.log('[XMTP] Skipping history sync (local XMTP database detected).');
        setSyncStatus('syncing-messages');
        setSyncProgress(70);
      }

      await this.startMessageStream();

      setSyncProgress(100);
      setSyncStatus('complete');

      // Hide the sync indicator after a brief delay
      setTimeout(() => {
        setSyncStatus('idle');
        setSyncProgress(0);
      }, 2000);
    } catch (error) {
      console.warn('[XMTP] Connection failed:', error);
      console.warn('[XMTP] Error type:', typeof error);
      console.warn('[XMTP] Error constructor:', error?.constructor?.name);
      
      // Log full error details
      if (error instanceof Error) {
        console.warn('[XMTP] Error message:', error.message);
        console.warn('[XMTP] Error stack:', error.stack);
      } else {
        console.warn('[XMTP] Error value:', error);
      }
      
      let errorMessage = error instanceof Error ? error.message : String(error);
      
      // Detect the 10/10 installation limit error
      if (errorMessage.includes('10/10 installations') || errorMessage.includes('already registered 10')) {
        errorMessage = '⚠️ Installation limit reached (10/10). Please revoke old installations in Settings → XMTP Installations before connecting.';
        console.warn('[XMTP] ⚠️ INSTALLATION LIMIT REACHED - User must revoke old installations');
      }
      
      setConnectionStatus('error');
      setError(errorMessage);
      
      logNetworkEvent({
        direction: 'status',
        event: 'connect:error',
        details: errorMessage,
      });

      if (client) {
        try {
          await client.close();
        } catch (closeError) {
          console.warn('[XMTP] Failed to close client after connect error:', closeError);
        }
      }

      throw error; // Re-throw the original error
    }
  }

  async probeIdentity(identity: XmtpIdentity): Promise<IdentityProbeResult> {
    const identityAddress = identity.address.toLowerCase();
    
    // If we already have a client connected for this identity, use it instead of creating a new one
    // This avoids OPFS file handle conflicts
    if (this.client && this.identity?.address.toLowerCase() === identityAddress) {
      console.log('[XMTP] probeIdentity: Using existing connected client for same identity');
      
      try {
        // Use client.inboxId as source of truth (authoritative from client.init)
        let inboxId: string | null = this.client.inboxId || null;
        let isRegistered = false;
        let inboxState: SafeInboxState | undefined;

        if (inboxId) {
          console.log('[XMTP] probeIdentity: ✅ Found inboxId from existing client:', inboxId);
          isRegistered = true; // inboxId presence is authoritative
          
          try {
            inboxState = await this.client.preferences.inboxState(true);
            console.log('[XMTP] probeIdentity: Fetched inboxState from existing client:', {
              inboxId: inboxState?.inboxId,
              installationCount: inboxState?.installations?.length ?? 0,
            });
            
            // Use inbox ID from inboxState if available (most reliable)
            if (inboxState?.inboxId) {
              inboxId = inboxState.inboxId;
            }
          } catch (error) {
            console.warn('[XMTP] probeIdentity: Failed to fetch inbox state from existing client:', error);
            // Still use inboxId from client even if inboxState fetch fails
          }
        } else {
          // Fallback: only check isRegistered() if no inboxId found
          try {
            isRegistered = await this.client.isRegistered();
            console.log('[XMTP] probeIdentity: isRegistered() fallback =', isRegistered);
          } catch (error) {
            console.warn('[XMTP] probeIdentity: isRegistered() check failed:', error);
          }
        }

        return {
          isRegistered,
          inboxId,
          installationCount: inboxState?.installations?.length ?? 0,
          inboxState,
        };
      } catch (error) {
        console.warn('[XMTP] probeIdentity: Failed to probe using existing client, will create new one:', error);
        // Fall through to create a new client
      }
    }

    // If we have a client for a different identity, disconnect it first
    if (this.client && this.identity?.address.toLowerCase() !== identityAddress) {
      console.log('[XMTP] probeIdentity: Disconnecting client for different identity to avoid OPFS conflict');
      try {
        await this.disconnect();
        // Longer delay to ensure OPFS locks are fully released
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        console.warn('[XMTP] probeIdentity: Error disconnecting existing client:', error);
      }
    }

    const signer = await this.createSigner(identity);
    let client: Client | null = null;

    try {
      console.log('[XMTP] probeIdentity: Creating probe client...');
      client = await Client.create(signer, {
        env: 'production',
        loggingLevel: 'warn',
        structuredLogging: false,
        performanceLogging: false,
        debugEventsEnabled: false,
        disableAutoRegister: true,
      });
      console.log('[XMTP] probeIdentity: Probe client created successfully');
      console.log('[XMTP] probeIdentity: Client inboxId from init:', client.inboxId);

      // Check inbox ID first - client.inboxId from client.init is authoritative
      // If it exists, the user has a registered inbox (regardless of isRegistered() result)
      let inboxId: string | null = client.inboxId || null;
      let isRegistered = false;
      
      if (inboxId) {
        console.log('[XMTP] probeIdentity: ✅ Found inboxId from client.init:', inboxId);
        isRegistered = true; // inboxId presence is authoritative
      } else {
        // Only check isRegistered() as fallback if no inboxId from client.init
        try {
          isRegistered = await client.isRegistered();
          console.log('[XMTP] probeIdentity: isRegistered() fallback =', isRegistered);
        } catch (error) {
          console.warn('[XMTP] probeIdentity: isRegistered() check failed:', error);
        }
      }

      let inboxState: SafeInboxState | undefined;

      // Use inboxId as source of truth - if we have it, fetch inbox state
      if (inboxId) {
        try {
          // Force refresh from network to get full inbox state
          inboxState = await client.preferences.inboxState(true);
          console.log('[XMTP] probeIdentity: fetched inboxState:', {
            inboxId: inboxState?.inboxId,
            hasInstallations: Boolean(inboxState?.installations),
            installationCount: inboxState?.installations?.length ?? 0,
          });
          
          // Use inbox ID from inboxState if available (most reliable)
          if (inboxState?.inboxId) {
            inboxId = inboxState.inboxId;
            console.log('[XMTP] probeIdentity: ✅ Confirmed inboxId from inboxState:', inboxId);
          }
        } catch (error) {
          console.warn('[XMTP] probeIdentity: failed to fetch inbox state:', error);
          // If inboxState fetch fails but we have inboxId from client, still consider registered
          if (inboxId) {
            console.log('[XMTP] probeIdentity: Using inboxId from client.init despite inboxState fetch failure');
          }
        }

        // Fallback: if we still don't have inboxId, try findInboxIdByIdentifier
        if (!inboxId) {
          try {
            const identifier = {
              identifier: toIdentifierHex(identity.address).toLowerCase(),
              identifierKind: 'Ethereum' as const,
            };
            const resolvedInboxId = await client.findInboxIdByIdentifier(
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              identifier as any
            );
            if (resolvedInboxId) {
              inboxId = resolvedInboxId;
              isRegistered = true;
              console.log('[XMTP] probeIdentity: ✅ Got inboxId via findInboxIdByIdentifier:', resolvedInboxId);
            } else {
              console.warn('[XMTP] probeIdentity: ⚠️  No inboxId found via findInboxIdByIdentifier');
            }
          } catch (error) {
            console.warn('[XMTP] probeIdentity: findInboxIdByIdentifier failed:', error);
          }
        }
      } else if (!isRegistered) {
        // No inboxId found and isRegistered() returned false
        console.log('[XMTP] probeIdentity: User is not registered on XMTP (no inbox ID found)');
      }

      const installationCount = inboxState?.installations?.length ?? 0;

      console.log('[XMTP] probeIdentity: Final result:', {
        isRegistered,
        inboxId,
        installationCount,
        hasInboxState: Boolean(inboxState),
      });

      return {
        isRegistered,
        inboxId,
        installationCount,
        inboxState,
      };
    } finally {
      if (client) {
        try {
          console.log('[XMTP] probeIdentity: Closing probe client...');
          await client.close();
          console.log('[XMTP] probeIdentity: ✅ Probe client closed');
          // Longer delay to ensure OPFS locks are fully released before next operation
          await new Promise(resolve => setTimeout(resolve, 500));
        } catch (error) {
          console.warn('[XMTP] probeIdentity: failed to close probe client:', error);
          // Even if close fails, wait a bit to let OPFS clean up
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
    }
  }

  /**
   * Disconnect from XMTP network
   */
  async disconnect(): Promise<void> {
    const { setConnectionStatus } = useXmtpStore.getState();

    // Stop message streaming
    if (this.messageStreamCloser) {
      try {
        this.messageStreamCloser.close();
        console.log('[XMTP] Message stream closed');
      } catch (error) {
        console.error('[XMTP] Error closing message stream:', error);
      }
      this.messageStreamCloser = null;
    }

    if (this.client) {
      logNetworkEvent({
        direction: 'outbound',
        event: 'disconnect',
        details: `Disconnecting client for ${this.identity?.address ?? 'unknown identity'}`,
      });

      try {
        // CRITICAL: Must await client.close() to properly release OPFS database locks
        console.log('[XMTP] Closing client and releasing database locks...');
        await this.client.close();
        console.log('[XMTP] ✅ Client closed successfully');
        // Wait a bit to ensure OPFS file handles are fully released
        await new Promise(resolve => setTimeout(resolve, 300));
      } catch (error) {
        console.error('[XMTP] Error closing client:', error);
        // Even if close fails, wait a bit for cleanup
        await new Promise(resolve => setTimeout(resolve, 300));
      }

      this.client = null;
      this.identity = null;
      setConnectionStatus('disconnected');

      logNetworkEvent({
        direction: 'status',
        event: 'disconnect:success',
        details: 'XMTP client disconnected',
      });
      console.log('[XMTP] XMTP client fully disconnected');
    }
  }

  /**
   * Sync all conversations from the network
   */
  async syncConversations(): Promise<void> {
    if (!this.client) {
      throw new Error('Client not connected');
    }

    try {
      console.log('[XMTP] Syncing conversations...');
      await this.client.conversations.sync();
      const convos = await this.client.conversations.list();
      console.log(`[XMTP] ✅ Synced ${convos.length} conversations`);
      
      logNetworkEvent({
        direction: 'inbound',
        event: 'conversations:sync',
        details: `Synced ${convos.length} conversations`,
      });
    } catch (error) {
      console.error('[XMTP] Failed to sync conversations:', error);
      throw error;
    }
  }

  /**
   * Sync historical messages into the local DB and surface them to the app
   * so they appear in the UI like live messages.
   */
  async syncHistory(): Promise<void> {
    if (!this.client) {
      throw new Error('Client not connected');
    }

    try {
      console.log('[XMTP] Syncing full history (conversations + messages)...');
      await this.client.conversations.syncAll();

      // Backfill DMs into our app store by dispatching the same custom events
      // we use for live streaming messages.
      const dms = await this.client.conversations.listDms();
      console.log(`[XMTP] Backfilling messages for ${dms.length} DM conversations`);

      for (const dm of dms) {
        try {
          const decodedMessages = await dm.messages();
          // Oldest first so previews/unreads evolve naturally
          decodedMessages.sort((a, b) => (a.sentAtNs < b.sentAtNs ? -1 : a.sentAtNs > b.sentAtNs ? 1 : 0));

          for (const m of decodedMessages) {
            const content = typeof m.content === 'string' ? m.content : m.encodedContent.content;
            const xmsg = {
              id: m.id,
              conversationId: m.conversationId,
              senderAddress: m.senderInboxId,
              content,
              sentAt: Number(m.sentAtNs / 1000000n),
            } as XmtpMessage;

            window.dispatchEvent(
              new CustomEvent('xmtp:message', {
                detail: { conversationId: m.conversationId, message: xmsg },
              })
            );
          }
        } catch (dmErr) {
          console.warn('[XMTP] Failed to backfill messages for DM:', dm.id, dmErr);
        }
      }

      console.log('[XMTP] ✅ History sync + backfill complete');
    } catch (error) {
      console.error('[XMTP] History sync failed:', error);
      // Non-fatal — continue with live streaming
    }
  }

  /**
   * Start streaming all messages across all conversations
   */
  async startMessageStream(): Promise<void> {
    if (!this.client) {
      throw new Error('Client not connected');
    }

    try {
      console.log('[XMTP] Starting message stream...');
      
      // Stream all messages (DMs and groups)
      const stream = await this.client.conversations.streamAllMessages();
      this.messageStreamCloser = stream as unknown as { close: () => void };

      console.log('[XMTP] ✅ Message stream started');
      
      logNetworkEvent({
        direction: 'status',
        event: 'messages:stream_started',
        details: 'Listening for incoming messages',
      });

      // Handle incoming messages in the background
      (async () => {
        try {
          console.log('[XMTP] 📻 Stream loop started, waiting for messages...');
          let messageCount = 0;
          
          for await (const message of stream) {
            messageCount++;
            console.log(`[XMTP] 📨 Stream yielded message #${messageCount}`);
            
            if (!message) {
              console.warn('[XMTP] ⚠️  Message is null/undefined, skipping');
              continue;
            }
            
            // Skip messages sent by us (they're already in the UI from sendMessage)
            if (this.client && message.senderInboxId === this.client.inboxId) {
              console.log('[XMTP] ⏭️  Skipping our own message:', {
                id: message.id,
                ourInboxId: this.client.inboxId,
                senderInboxId: message.senderInboxId,
              });
              continue;
            }
            
            // Log the full message object to see what we're getting
            console.log('[XMTP] Full message object:');
            console.log(message);
            console.log('[XMTP] Message keys:', Object.keys(message));
            console.log('[XMTP] Message stringified:', JSON.stringify(message, (_key, value) => {
              // Handle BigInt serialization
              if (typeof value === 'bigint') {
                return value.toString() + 'n';
              }
              // Handle Uint8Array
              if (value instanceof Uint8Array) {
                return `Uint8Array(${value.length})`;
              }
              return value;
            }, 2));
            
            console.log('[XMTP] 📨 Parsed message:', {
              id: message.id,
              conversationId: message.conversationId,
              senderInboxId: message.senderInboxId,
              content: typeof message.content === 'string' ? message.content.substring(0, 50) : '(binary)',
              sentAtNs: message.sentAtNs,
            });

            logNetworkEvent({
              direction: 'inbound',
              event: 'message:received',
              details: `From ${message.senderInboxId}`,
            });

            // Dispatch to message store
            console.log('[XMTP] Dispatching custom event xmtp:message');
            window.dispatchEvent(new CustomEvent('xmtp:message', {
              detail: {
                conversationId: message.conversationId,
                message: {
                  id: message.id,
                  conversationId: message.conversationId,
                  senderAddress: message.senderInboxId,
                  content: message.content,
                  sentAt: message.sentAtNs ? Number(message.sentAtNs / 1000000n) : Date.now(),
                },
              },
            }));
            console.log('[XMTP] Custom event dispatched');
          }
          
          console.warn('[XMTP] 📻 Stream loop ended naturally (this shouldn\'t happen)');
        } catch (error) {
          console.error('[XMTP] Message stream error:', error);
          console.error('[XMTP] Error stack:', error instanceof Error ? error.stack : 'no stack');
          logNetworkEvent({
            direction: 'status',
            event: 'messages:stream_error',
            details: error instanceof Error ? error.message : String(error),
          });
        }
      })();
    } catch (error) {
      console.error('[XMTP] Failed to start message stream:', error);
      throw error;
    }
  }

  /**
   * Check if client is connected
   */
  isConnected(): boolean {
    return this.client !== null;
  }

  /**
   * Get the current identity address
   */
  getAddress(): string | null {
    return this.identity?.address || null;
  }

  /**
   * Get the client's inbox ID
   */
  getInboxId(): string | null {
    return this.client?.inboxId || null;
  }

  /**
   * Get the client's installation ID
   */
  getInstallationId(): string | null {
    return this.client?.installationId || null;
  }

  /**
   * Get the inbox state including all installations.
   * - If connected, refresh from network via Preferences API.
   * - If not connected, use Utils worker to resolve inboxId & fetch state without a client.
   */
  async getInboxState() {
    const isE2E = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_E2E_TEST === 'true');
    if (isE2E) {
      // Return a stubbed inbox state for E2E to avoid network calls
      const inboxId = this.identity?.inboxId ?? `local-${Date.now().toString(36)}`;
      const addr = (this.identity?.address ?? '0x').replace(/^0x/i, '').toLowerCase();
      const stub: SafeInboxState = {
        identifiers: addr ? [{ identifier: addr, identifierKind: 'Ethereum' } as unknown as Identifier] : [],
        inboxId,
        installations: [],
        recoveryIdentifier: { identifier: '', identifierKind: 'Ethereum' } as unknown as Identifier,
      } as unknown as SafeInboxState;
      return stub;
    }
    const withTimeout = async <T>(p: Promise<T>, ms = 10000): Promise<T> => {
      return await Promise.race<T>([
        p,
        new Promise<T>((_, reject) => setTimeout(() => reject(new Error('Timeout fetching inbox state')), ms)) as Promise<T>,
      ]);
    };

    if (this.client) {
      // Force refresh from network to avoid stale state
      return await withTimeout(this.client.preferences.inboxState(true));
    }

    if (!this.identity) {
      throw new Error('No identity available');
    }

    try {
      // Use Utils to resolve inboxId & fetch state without creating a full client
      const { Utils } = await import('@xmtp/browser-sdk');
      const utils: InstanceType<typeof Utils> = new Utils(false);

      const identifier: { identifier: string; identifierKind: 'Ethereum' } = {
        identifier: toIdentifierHex(this.identity.address).toLowerCase(),
        identifierKind: 'Ethereum',
      };

      const inboxId = await withTimeout(utils.getInboxIdForIdentifier(identifier, 'production'));
      if (!inboxId) {
        throw new Error('Inbox not found for this identity');
      }

      const states = (await withTimeout(utils.inboxStateFromInboxIds([inboxId], 'production')))
        .filter(Boolean);
      // Utils worker doesn't need explicit close; it dies with page lifecycle.
      return states[0];
    } catch (error) {
      console.error('[XMTP] Failed to fetch inbox state via Utils:', error);
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  /**
   * Revoke specific installations by their IDs
   * @param installationIds - Array of installation ID bytes to revoke
   */
  async revokeInstallations(installationIds: Uint8Array[]) {
    if (!this.client) {
      throw new Error('Client not connected');
    }
    console.log('[XMTP] Revoking installations:', installationIds);
    await this.client.revokeInstallations(installationIds);
    console.log('[XMTP] ✅ Installations revoked successfully');
    logNetworkEvent({
      direction: 'outbound',
      event: 'installations:revoke',
      details: `Revoked ${installationIds.length} installation(s)`,
    });
  }

  /**
   * Get key package statuses for installations
   * @param installationIds - Array of installation ID strings
   */
  async getKeyPackageStatuses(installationIds: string[]) {
    if (!this.client) {
      throw new Error('Client not connected');
    }
    return await this.client.getKeyPackageStatusesForInstallationIds(installationIds);
  }

  /**
   * Stream all incoming messages
   */
  streamMessages(_onMessage: MessageCallback): Unsubscribe {
    if (!this.client) {
      throw new Error('Client not connected');
    }

    logNetworkEvent({
      direction: 'status',
      event: 'messages:stream:start',
      details: 'Attempted to stream messages (not implemented)',
    });

    console.warn('XMTP message streaming is not implemented yet');

    return () => {
      logNetworkEvent({
        direction: 'status',
        event: 'messages:stream:stop',
        details: 'Stopped message streaming (stub)',
      });
      console.warn('XMTP message streaming stopped');
    };
  }

  /**
   * List all conversations
   */
  async listConversations(): Promise<Conversation[]> {
    if (!this.client) {
      throw new Error('Client not connected');
    }

    logNetworkEvent({
      direction: 'outbound',
      event: 'conversations:list',
      details: 'Listing conversations',
    });

    logNetworkEvent({
      direction: 'status',
      event: 'conversations:list:complete',
      details: 'Conversations list returned 0 results (stub implementation)',
    });

    return [];
  }

  /**
   * Get a specific conversation by peer address
   */
  async getConversation(peerAddress: string): Promise<Conversation | null> {
    if (!this.client) {
      throw new Error('Client not connected');
    }

    console.warn('XMTP getConversation not implemented yet for', peerAddress);
    logNetworkEvent({
      direction: 'outbound',
      event: 'conversations:get',
      details: `Requested conversation with ${peerAddress}`,
    });
    return null;
  }

  /**
   * Resolve the inbox ID associated with an Ethereum address.
   */
  async getInboxIdFromAddress(address: string): Promise<string | null> {
    if (!this.client) {
      throw new Error('Client not connected');
    }

    console.log('[XMTP] Looking up inbox ID for address:', address);

    try {
      const identifier = {
        identifier: toIdentifierHex(address).toLowerCase(),
        identifierKind: 'Ethereum' as const,
      };

      console.log('[XMTP] findInboxId identifier payload:', identifier);

      // Directly ask the client for the inbox ID associated to this identifier.
      const inboxId = await this.client.findInboxIdByIdentifier(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        identifier as any
      );

      if (inboxId) {
        console.log('[XMTP] ✅ Found inbox ID:', inboxId, 'for address:', address);
        return inboxId;
      }

      console.warn('[XMTP] ⚠️  No inbox ID found for address:', address);
      return null;
    } catch (error) {
      console.error('[XMTP] ❌ Failed to get inbox ID:', error);
      return null;
    }
  }

  /**
   * Create a new conversation with a peer
   * Accepts either an Ethereum address (0x...) or an inbox ID
   */
  async createConversation(peerAddressOrInboxId: string): Promise<Conversation> {
    if (!this.client) {
      console.warn('[XMTP] Client not connected; creating local conversation fallback for', peerAddressOrInboxId);
      const conversation = this.createLocalConversation(peerAddressOrInboxId, {
        displayName: peerAddressOrInboxId,
      });

      logNetworkEvent({
        direction: 'status',
        event: 'conversations:create:offline',
        details: `Created local conversation stub for ${peerAddressOrInboxId}`,
        payload: this.formatPayload(conversation),
      });

      return conversation;
    }

    console.log('[XMTP] Creating conversation with:', peerAddressOrInboxId);

    logNetworkEvent({
      direction: 'outbound',
      event: 'conversations:create',
      details: `Creating conversation with ${peerAddressOrInboxId}`,
    });

    try {
      // If it looks like an Ethereum address, we'll use the identifier path
      const inboxId = peerAddressOrInboxId;
      const displayAddress = peerAddressOrInboxId;

      let dmConversation;

      if (isEthereumAddress(peerAddressOrInboxId)) {
        console.log('[XMTP] Detected Ethereum address, creating conversation via identifier...');

        const identifier = {
          identifier: peerAddressOrInboxId.toLowerCase(),
          identifierKind: 'Ethereum' as const,
        };

        dmConversation = await this.client.conversations.newDmWithIdentifier(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          identifier as any
        );
      } else {
        console.log('[XMTP] Calling client.conversations.newDm with inbox ID:', inboxId);
        dmConversation = await this.client.conversations.newDm(inboxId);
      }
      
      console.log('[XMTP] ✅ DM conversation created:', {
        id: dmConversation.id,
        createdAtNs: dmConversation.createdAtNs,
      });

      const conversation: Conversation = {
        id: dmConversation.id,
        topic: dmConversation.id, // Use conversation ID as topic
        peerId: displayAddress, // Use the original address for display
        createdAt: dmConversation.createdAtNs ? Number(dmConversation.createdAtNs / 1000000n) : Date.now(),
        lastMessageAt: dmConversation.createdAtNs ? Number(dmConversation.createdAtNs / 1000000n) : Date.now(),
        unreadCount: 0,
        pinned: false,
        archived: false,
        isGroup: false, // Explicitly mark as DM
      };

      logNetworkEvent({
        direction: 'status',
        event: 'conversations:create:success',
        details: `Conversation ${conversation.id} created`,
        payload: this.formatPayload(conversation),
      });

      return conversation;
    } catch (error) {
      console.warn('[XMTP] ❌ Failed to create conversation via XMTP, using local fallback:', error);
      if (error instanceof Error) {
        console.warn('[XMTP] Error details:', {
          message: error.message,
          stack: error.stack,
        });
      }
      const fallbackConversation = this.createLocalConversation(peerAddressOrInboxId, {
        displayName: peerAddressOrInboxId,
      });

      logNetworkEvent({
        direction: 'status',
        event: 'conversations:create:offline',
        details: `Created fallback conversation for ${peerAddressOrInboxId}`,
        payload: this.formatPayload(fallbackConversation),
      });

      return fallbackConversation;
    }
  }

  /**
   * Create a new group conversation with multiple participants
   */
  async createGroupConversation(participantAddresses: string[]): Promise<Conversation> {
    if (!this.client) {
      console.warn('[XMTP] Client not connected; creating local group conversation fallback');
      const conversation = this.createLocalConversation(
        this.generateLocalId('local-group'),
        {
          isGroup: true,
          groupName: `Group with ${participantAddresses.length} members`,
          members: participantAddresses,
          admins: [this.identity?.address || ''].filter(Boolean),
        }
      );

      logNetworkEvent({
        direction: 'status',
        event: 'conversations:create_group:offline',
        details: `Created local group conversation stub (${participantAddresses.length} members)`,
        payload: this.formatPayload(conversation),
      });

      return conversation;
    }

    console.log('[XMTP] Creating group conversation with participants:', participantAddresses);

    logNetworkEvent({
      direction: 'outbound',
      event: 'conversations:create_group',
      details: `Creating group with ${participantAddresses.length} participants`,
    });

    try {
      const groupConversation = await this.client.conversations.newGroup(participantAddresses);

      console.log('[XMTP] ✅ Group conversation created:', {
        id: groupConversation.id,
        createdAtNs: groupConversation.createdAtNs,
      });

      const conversation: Conversation = {
        id: groupConversation.id,
        topic: groupConversation.id, // Use conversation ID as topic
        peerId: groupConversation.id, // For groups, peerAddress can be the group ID
        createdAt: groupConversation.createdAtNs ? Number(groupConversation.createdAtNs / 1000000n) : Date.now(),
        lastMessageAt: groupConversation.createdAtNs ? Number(groupConversation.createdAtNs / 1000000n) : Date.now(),
        unreadCount: 0,
        pinned: false,
        archived: false,
        isGroup: true, // Explicitly mark as group conversation
        groupName: `Group with ${participantAddresses.length} members`, // Default name
        members: participantAddresses, // Initial members
        admins: [this.identity?.address || ''].filter(Boolean), // Creator is admin
      };

      logNetworkEvent({
        direction: 'status',
        event: 'conversations:create_group:success',
        details: `Group conversation ${conversation.id} created`,
        payload: this.formatPayload(conversation),
      });

      return conversation;
    } catch (error) {
      console.warn('[XMTP] ❌ Failed to create group conversation via XMTP, using local fallback:', error);
      if (error instanceof Error) {
        console.warn('[XMTP] Error details:', {
          message: error.message,
          stack: error.stack,
        });
      }
      const fallbackConversation = this.createLocalConversation(
        this.generateLocalId('local-group'),
        {
          isGroup: true,
          groupName: `Group with ${participantAddresses.length} members`,
          members: participantAddresses,
          admins: [this.identity?.address || ''].filter(Boolean),
        }
      );

      logNetworkEvent({
        direction: 'status',
        event: 'conversations:create_group:offline',
        details: 'Created fallback group conversation',
        payload: this.formatPayload(fallbackConversation),
      });

      return fallbackConversation;
    }
  }

  /**
   * Send a message to a conversation
   */
  async sendMessage(conversationId: string, content: string): Promise<XmtpMessage> {
    if (!this.client) {
      console.warn('[XMTP] Client not connected; queuing message locally for conversation', conversationId);
      const localMessage = this.createLocalMessage(conversationId, content);
      logNetworkEvent({
        direction: 'status',
        event: 'messages:send:offline',
        details: `Stored local message for ${conversationId}`,
        payload: this.formatPayload(content),
      });
      return localMessage;
    }

    console.log('[XMTP] Sending message to conversation:', conversationId);

    logNetworkEvent({
      direction: 'outbound',
      event: 'messages:send',
      details: `Sending message on ${conversationId}`,
      payload: this.formatPayload(content),
    });

    try {
      // Try to fetch the conversation directly; fall back to sync if cache misses.
      let conversation = await this.client.conversations.getConversationById(conversationId);

      if (!conversation) {
        console.log('[XMTP] Conversation not found in cache, syncing before retry…');
        await this.client.conversations.sync();
        conversation = await this.client.conversations.getConversationById(conversationId);
      }

      if (!conversation) {
        throw new Error(`Conversation ${conversationId} not found after sync`);
      }

      console.log('[XMTP] Found conversation, sending message...');
      
      // Send the message
      await conversation.send(content);
      
      console.log('[XMTP] ✅ Message sent successfully');

      // Create a message object to return
      const message: XmtpMessage = {
        id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        conversationId: conversationId,
        senderAddress: this.identity?.address || 'unknown',
        content,
        sentAt: Date.now(),
      };

      logNetworkEvent({
        direction: 'status',
        event: 'messages:send:success',
        details: `Message sent on ${conversationId}`,
        payload: this.formatPayload(message),
      });

      return message;
    } catch (error) {
      console.warn('[XMTP] Failed to send message via XMTP, storing locally:', error);
      const fallbackMessage = this.createLocalMessage(conversationId, content);

      logNetworkEvent({
        direction: 'status',
        event: 'messages:send:offline',
        details: `Stored local message for ${conversationId} after send failure`,
        payload: this.formatPayload(content),
      });

      return fallbackMessage;
    }
  }

  /**
   * List messages from a conversation
   */
  async listMessages(
    conversationId: string,
    opts?: { limit?: number; before?: Date; after?: Date }
  ): Promise<XmtpMessage[]> {
    if (!this.client) {
      throw new Error('Client not connected');
    }

    console.warn('XMTP listMessages not implemented yet for', conversationId, opts);
    logNetworkEvent({
      direction: 'outbound',
      event: 'messages:list',
      details: `Requested messages for ${conversationId}`,
      payload: opts ? this.formatPayload(opts) : undefined,
    });

    logNetworkEvent({
      direction: 'status',
      event: 'messages:list:complete',
      details: `Message list for ${conversationId} returned 0 results (stub implementation)`,
    });
    return [];
  }

  /**
   * Check if an address or inbox ID can receive XMTP messages
   * Accepts either an Ethereum address (0x...) or an inbox ID
   */
  async canMessage(addressOrInboxId: string): Promise<boolean> {
    if (!this.client) {
      throw new Error('Client not connected');
    }

    if (!isEthereumAddress(addressOrInboxId)) {
      console.log('[XMTP] Input is not an Ethereum address, assuming inbox ID is valid');
      return true;
    }

    console.log('[XMTP] Checking if can receive messages:', addressOrInboxId);
    
    logNetworkEvent({
      direction: 'outbound',
      event: 'canMessage',
      details: `Checking if ${addressOrInboxId} can receive XMTP messages`,
    });

    try {
      // In XMTP v5, canMessage expects an array of Identifier objects
      const identifier = {
        identifier: addressOrInboxId.toLowerCase(),
        identifierKind: 'Ethereum' as const,
      };
      
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const canMsgMap = await this.client.canMessage([identifier as any]);
      
      // The SDK returns a Map where:
      // - If input is an address: key = inbox ID (if registered), value = true
      // - If input is inbox ID: key = inbox ID, value = true
      // So we need to check if ANY value in the map is true
      let result = false;
      for (const [key, value] of canMsgMap) {
        console.log(`[XMTP] canMessage map entry: ${key} = ${value}`);
        if (value) {
          result = true;
          break;
        }
      }
      
      console.log(`[XMTP] canMessage result for ${addressOrInboxId}:`, result);
      
      logNetworkEvent({
        direction: 'status',
        event: 'canMessage:result',
        details: `${addressOrInboxId} ${result ? 'can' : 'cannot'} receive messages`,
      });
      
      return result;
    } catch (error) {
      console.error('[XMTP] canMessage check failed:', error);
      
      logNetworkEvent({
        direction: 'status',
        event: 'canMessage:error',
        details: error instanceof Error ? error.message : String(error),
      });
      
      // Fallback: assume true (will fail later if actually can't message)
      console.warn('[XMTP] ⚠️  canMessage failed, assuming inbox is valid');
      return true;
    }
  }

}

// Singleton instance
let xmtpClientInstance: XmtpClient | null = null;

export function getXmtpClient(): XmtpClient {
  if (!xmtpClientInstance) {
    xmtpClientInstance = new XmtpClient();
  }
  return xmtpClientInstance;
}

export async function resetXmtpClient(): Promise<void> {
  if (xmtpClientInstance) {
    await xmtpClientInstance.disconnect();
    xmtpClientInstance = null;
  }
}
