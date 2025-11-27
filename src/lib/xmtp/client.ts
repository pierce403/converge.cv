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
  type SafeConversationDebugInfo,
  type SafeHmacKey,
  PermissionPolicy,
  PermissionUpdateType,
} from '@xmtp/browser-sdk';
import xmtpPackage from '@xmtp/browser-sdk/package.json';
import { logNetworkEvent, useContactStore } from '@/lib/stores';
import { useXmtpStore } from '@/lib/stores/xmtp-store';
import buildInfo from '@/build-info.json';
import { createEOASigner, createEphemeralSigner } from '@/lib/wagmi/signers';
import type {
  Conversation,
  GroupPermissionPolicyCode,
  GroupPermissionsState,
} from '@/types';
import { getAddress } from 'viem';
import { ContentTypeReaction, ReactionCodec, type Reaction as XmtpReaction } from '@xmtp/content-type-reaction';
import { ContentTypeReply, ReplyCodec } from '@xmtp/content-type-reply';
import { ContentTypeReadReceipt, ReadReceiptCodec } from '@xmtp/content-type-read-receipt';
import { RemoteAttachmentCodec } from '@xmtp/content-type-remote-attachment';
import { ContentTypeText } from '@xmtp/content-type-text';
import { GroupUpdatedCodec } from '@xmtp/content-type-group-updated';
import { getStorage } from '@/lib/storage';

// Intentionally no runtime debug flag here to avoid lint/type issues.

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
   replyToId?: string;
}

export type MessageCallback = (message: XmtpMessage) => void;
export type Unsubscribe = () => void;

function isGroupPermissionPolicyCode(value: number): value is GroupPermissionPolicyCode {
  return value === 0 || value === 1 || value === 2 || value === 3 || value === 4 || value === 5;
}

function toGroupPermissionPolicyCode(value: number | undefined): GroupPermissionPolicyCode {
  if (typeof value === 'number' && isGroupPermissionPolicyCode(value)) {
    return value;
  }

  console.warn('[XMTP] Received unknown group permission policy code:', value);
  return 0;
}

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
  permissions?: GroupPermissionsState;
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

export interface GroupKeySummary {
  currentEpoch?: number | null;
  maybeForked?: boolean;
  forkDetails?: string;
  epochRange?: { min: number; max: number } | null;
}

const ETH_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

const isEthereumAddress = (value: string): boolean => ETH_ADDRESS_REGEX.test(value);

const toIdentifierHex = (address: string): string =>
  address.startsWith('0x') || address.startsWith('0X') ? address.slice(2) : address;

const EMPTY_ETHEREUM_IDENTIFIER = { identifier: '', identifierKind: 'Ethereum' } as const;

function createStubInboxState({
  identifier,
  inboxId,
}: {
  identifier?: { identifier: string; identifierKind: 'Ethereum' };
  inboxId?: string | null;
}): SafeInboxState {
  const safeIdentifier = (identifier ?? EMPTY_ETHEREUM_IDENTIFIER) as unknown as Identifier;
  const identifiers = identifier ? [safeIdentifier] : [];
  return {
    identifiers,
    inboxId: inboxId ?? '',
    installations: [],
    recoveryIdentifier: safeIdentifier,
  } as unknown as SafeInboxState;
}

/**
 * XMTP Client wrapper for v5 SDK
 */
export class XmtpClient {
  private client: Client<unknown> | null = null;
  private identity: XmtpIdentity | null = null;
  private messageStreamCloser: { close: () => void } | null = null;
  private static readonly PROFILE_PREFIX = 'cv:profile:'; // JSON payload marker for profile records
  // Suppress noisy retries for inboxIds that trigger identity backend parse errors
  private inboxErrorCooldown: Map<string, number> = new Map();

  // Basic 429/rate-limit detection
  private isRateLimitError(err: unknown): boolean {
    try {
      const msg = err instanceof Error ? err.message : String(err ?? '');
      return /\b429\b/.test(msg) || /rate\s*limit/i.test(msg) || /exceeds rate limit/i.test(msg);
    } catch {
      return false;
    }
  }

  // Apply cooldown for inboxIds that produce identity/association errors
  private applyInboxErrorCooldown(inboxId: string, error: unknown): void {
    try {
      const msg = error instanceof Error ? error.message : String(error ?? '');
      // Match common identity-related errors that indicate the inbox doesn't exist or has issues
      const shouldCooldown = 
        /invalid hexadecimal digit/i.test(msg) ||
        /missing identity update/i.test(msg) ||
        /association error/i.test(msg);
      
      if (shouldCooldown) {
        // 30 minute cooldown to avoid spamming the API
        this.inboxErrorCooldown.set(inboxId.toLowerCase(), Date.now() + 30 * 60 * 1000);
        console.info('[XMTP] Cooldown applied to inboxId due to identity error:', inboxId);
      }
    } catch {
      // ignore
    }
  }

  // Exponential backoff wrapper for XMTP identity/preferences calls that may hit 429
  private async retryWithBackoff<T>(label: string, fn: () => Promise<T>, opts?: {
    attempts?: number;
    initialDelayMs?: number;
    factor?: number;
    jitter?: boolean;
  }): Promise<T> {
    const attempts = opts?.attempts ?? 5;
    const factor = opts?.factor ?? 2;
    const jitter = opts?.jitter ?? true;
    let delay = opts?.initialDelayMs ?? 500;
    let lastErr: unknown = undefined;
    for (let i = 0; i < attempts; i++) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        if (!this.isRateLimitError(err) || i === attempts - 1) {
          throw err;
        }
        const wait = jitter ? Math.floor(delay * (0.75 + Math.random() * 0.5)) : delay;
        console.warn(`[XMTP] ${label}: rate limited, retrying in ${wait}ms (attempt ${i + 2}/${attempts})`);
        await new Promise((res) => setTimeout(res, wait));
        delay *= factor;
      }
    }
    // Fallback throw (should not reach here due to early return/throw)
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  private formatGroupUpdatedLabel(payload: unknown): string | null {
    try {
      const any = payload as Record<string, unknown>;
      const added = (any['addedInboxes'] as Array<{ inboxId: string }> | undefined) || [];
      const removed = (any['removedInboxes'] as Array<{ inboxId: string }> | undefined) || [];
      const changes = (any['metadataFieldChanges'] as Array<{ fieldName: string; newValue?: string }> | undefined) || [];
      const who = (any['initiatedByInboxId'] as string | undefined) || '';
      const short = (id: string) => (id.length > 10 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id);
      if (added.length > 0) {
        const list = added.map((i) => short(i.inboxId)).join(', ');
        return `${short(who)} added ${list} to the group`;
      }
      if (removed.length > 0) {
        const list = removed.map((i) => short(i.inboxId)).join(', ');
        return `${short(who)} removed ${list} from the group`;
      }
      if (changes.length > 0) {
        const friendly = changes
          .map((c) => {
            const field =
              c.fieldName === 'group_name'
                ? 'name'
                : c.fieldName === 'description'
                  ? 'description'
                  : c.fieldName === 'group_image_url_square'
                    ? 'image'
                    : c.fieldName;
            return c.newValue && c.newValue !== ''
              ? `${field} to "${String(c.newValue).slice(0, 80)}"`
              : `${field}`;
          })
          .join(', ');
        return `${short(who)} changed ${friendly}`;
      }
    } catch {
      // ignore
    }
    return null;
  }

  private hexToBytes(hex: string): Uint8Array | null {
    try {
      const clean = hex.startsWith('0x') || hex.startsWith('0X') ? hex.slice(2) : hex;
      if (clean.length % 2 !== 0) return null;
      const out = new Uint8Array(clean.length / 2);
      for (let i = 0; i < clean.length; i += 2) {
        out[i / 2] = parseInt(clean.slice(i, i + 2), 16);
      }
      return out;
    } catch {
      return null;
    }
  }

  /**
   * Force revoke oldest installations without registering a new one.
   * Attempts a temporary management client (disableAutoRegister) to avoid hitting the 10/10 ceiling.
   * Keeps the most recent `keepLatest` installations (default 1) and revokes the rest.
   */
  async forceRevokeOldestInstallations(keepLatest = 1): Promise<{ revoked: string[] }> {
    if (!this.identity) throw new Error('No identity available');

    const performRevocation = async (client: Client<unknown>) => {
      const state = await client.preferences.inboxState(true);
      const list = (state.installations || []) as unknown as Array<{
        id?: string;
        clientTimestampNs?: bigint;
        [k: string]: unknown;
      }>;
      if (!list.length) return { revoked: [] };
      
      // Newest first
      list.sort((a, b) => (a.clientTimestampNs && b.clientTimestampNs && a.clientTimestampNs > b.clientTimestampNs ? -1 : 1));
      const toRevoke = list.slice(Math.max(keepLatest, 0));
      
      const bytes: Uint8Array[] = [];
      const revokedIds: string[] = [];
      
      for (const inst of toRevoke) {
        const rawBytes = (inst as unknown as { bytes?: Uint8Array; installationId?: Uint8Array; idBytes?: Uint8Array }).bytes
          || (inst as unknown as { installationId?: Uint8Array }).installationId
          || (inst as unknown as { idBytes?: Uint8Array }).idBytes
          || (typeof inst.id === 'string' ? this.hexToBytes(inst.id) : null);
        
        if (rawBytes) {
          bytes.push(rawBytes);
          if (typeof inst.id === 'string') revokedIds.push(inst.id);
        }
      }
      
      if (!bytes.length) return { revoked: [] };
      await client.revokeInstallations(bytes);
      return { revoked: revokedIds };
    };

    // 1. Try using existing client if available
    if (this.client) {
      try {
        console.log('[XMTP] forceRevokeOldestInstallations: Attempting with existing client');
        return await performRevocation(this.client);
      } catch (err) {
        console.warn('[XMTP] forceRevokeOldestInstallations: Existing client failed, trying temp client:', err);
        // Fall through to temp client
      }
    }

    // 2. Create a temporary client
    // NOTE: When 10/10 limit is reached, we CANNOT use the existing DB path because if that DB
    // corresponds to a new/unregistered installation, the network will reject it immediately.
    // Instead, we create a fresh ephemeral DB with disableAutoRegister: true.
    // This allows us to authenticate (sign the key bundle) and act as a "manager" client
    // without actually registering this new ephemeral installation on the network.
    const randomSuffix = Math.random().toString(36).substring(2, 10);
    const dbPath = `xmtp-revoke-temp-${randomSuffix}.db3`;
    
    const signer = await this.createSigner(this.identity);
    
    console.log('[XMTP] forceRevokeOldestInstallations: Creating ephemeral temp client (new DB) with disableAutoRegister');
    // Create a temporary client without auto-registering a new installation
    // so we can manage preferences/installations even when 10/10 is reached.
    const temp = await Client.create(signer, {
      env: 'production',
      dbPath,
      loggingLevel: 'warn',
      structuredLogging: false,
      performanceLogging: false,
      debugEventsEnabled: false,
      disableAutoRegister: true,
    });

    try {
      return await performRevocation(temp);
    } finally {
      try { await temp.close(); } catch { /* ignore */ }
    }
  }

  /**
   * Best-effort extraction of a content type identifier from a decoded/encoded message object.
   * Handles both decoded messages (dm.messages()) and raw wasm messages (getMessageById()).
   */
  private getContentTypeIdFromAny(msg: unknown): string | undefined {
    try {
      if (!msg || typeof msg !== 'object') return undefined;
      const anyMsg = msg as Record<string, unknown>;
      // Try decoded shape first: encodedContent?.type?.typeId (or type_id)
      const encoded = anyMsg['encodedContent'] as Record<string, unknown> | undefined;
      const typeObj = (encoded && (encoded['type'] as Record<string, unknown> | undefined)) || undefined;
      const fromEncoded =
        (typeObj?.['typeId'] as string | undefined) ||
        (typeObj?.['type_id'] as string | undefined);
      if (typeof fromEncoded === 'string') return fromEncoded;

      // Some stream message shapes may expose content.type directly
      const content = anyMsg['content'] as Record<string, unknown> | string | Uint8Array | undefined;
      if (content && typeof content === 'object') {
        const cType = (content as Record<string, unknown>)['type'] as Record<string, unknown> | undefined;
        const fromContent =
          (cType?.['typeId'] as string | undefined) ||
          (cType?.['type_id'] as string | undefined);
        if (typeof fromContent === 'string') return fromContent;
      }

      // Raw wasm message: content.type.typeId
      const rawContent = anyMsg['content'] as Record<string, unknown> | undefined;
      const rawType = rawContent && (rawContent['type'] as Record<string, unknown> | undefined);
      const fromRaw =
        (rawType?.['typeId'] as string | undefined) ||
        (rawType?.['type_id'] as string | undefined);
      if (typeof fromRaw === 'string') return fromRaw;
    } catch (err) {
      console.warn('[XMTP] getContentTypeIdFromAny failed:', err);
    }
    return undefined;
  }

  private isMissingConversationKeyError(err: unknown): boolean {
    if (err == null) {
      return false;
    }
    const message = err instanceof Error ? err.message : String(err ?? '');
    if (!message) {
      return false;
    }
    const normalized = message.toLowerCase();
    const checks: Array<(value: string) => boolean> = [
      (value) => value.includes('missing') && value.includes('key'),
      (value) => value.includes('no key'),
      (value) => value.includes('key not found'),
      (value) => value.includes('secret not found'),
      (value) => value.includes('no session key'),
      (value) => value.includes('session key') && value.includes('not found'),
      (value) => value.includes('mls') && value.includes('key') && value.includes('not found'),
      (value) => value.includes('failed to decrypt') && value.includes('key'),
    ];
    return checks.some((fn) => {
      try {
        return fn(normalized);
      } catch {
        return false;
      }
    });
  }

  /**
   * Send a reaction to a specific message within a conversation (DM or group).
   */
  async sendReaction(
    conversationId: string,
    targetMessageId: string,
    emoji: string,
    action: 'added' | 'removed' = 'added',
    schema: 'unicode' | 'shortcode' | 'custom' = 'unicode',
    referenceInboxId?: string,
  ): Promise<void> {
    if (!this.client) throw new Error('Client not connected');
    const conv = await this.client.conversations.getConversationById(conversationId);
    if (!conv) throw new Error('Conversation not found');
    const content: XmtpReaction = {
      action,
      content: emoji,
      reference: targetMessageId,
      referenceInboxId,
      schema,
    };
    await conv.send(content, ContentTypeReaction);
    logNetworkEvent({ direction: 'outbound', event: 'message:reaction', details: `Reacted ${emoji}` });
  }

  /**
   * Reply to a specific message with text content using ContentTypeReply.
   */
  async sendReply(
    conversationId: string,
    targetMessageId: string,
    text: string,
    referenceInboxId?: string,
  ): Promise<XmtpMessage> {
    if (!this.client) {
      console.warn('[XMTP] Client not connected; queuing reply locally for conversation', conversationId);
      const localMessage = this.createLocalMessage(conversationId, text);
      logNetworkEvent({
        direction: 'status',
        event: 'messages:reply:offline',
        details: `Stored local reply for ${conversationId}`,
        payload: this.formatPayload(text),
      });
      return localMessage;
    }

    const conv = await this.client.conversations.getConversationById(conversationId);
    if (!conv) throw new Error('Conversation not found');
    const replyContent = {
      reference: targetMessageId,
      referenceInboxId,
      content: text,
      contentType: ContentTypeText,
    };
    const messageId = await conv.send(replyContent, ContentTypeReply);
    const now = Date.now();
    const message: XmtpMessage = {
      id: messageId,
      conversationId,
      senderAddress: this.client?.inboxId ?? this.identity?.address ?? 'unknown',
      content: text,
      sentAt: now,
    };
    logNetworkEvent({
      direction: 'outbound',
      event: 'message:reply',
      details: `Reply sent`,
      payload: this.formatPayload({ id: messageId }),
    });
    return message;
  }

  /**
   * Send a read receipt (lightweight signal, not pushed) to the peer.
   */
  async sendReadReceipt(conversationId: string): Promise<void> {
    if (!this.client) throw new Error('Client not connected');
    const conv = await this.client.conversations.getConversationById(conversationId);
    if (!conv) throw new Error('Conversation not found');
    await conv.send({}, ContentTypeReadReceipt);
    logNetworkEvent({ direction: 'outbound', event: 'message:read_receipt', details: `Read receipt sent` });
  }

  /**
   * Produce a user-facing label for known content types.
   * Unknown types are treated as generic system messages.
   */
  private labelForContentType(typeId: string | undefined): string {
    if (!typeId) return 'System message';
    const t = typeId.toLowerCase();
    if (t.includes('text')) return 'Text';
    if (t.includes('reaction')) return 'Reaction';
    if (t.includes('reply')) return 'Reply';
    if (t.includes('read') && t.includes('receipt')) return 'Read receipt';
    if (t.includes('delivery') && t.includes('receipt')) return 'Delivery receipt';
    if (t.includes('attachment') || t.includes('file') || t.includes('image') || t.includes('media')) return 'Attachment';
    if (t.includes('typing')) return 'Typing';
    if (t.includes('group') && (t.includes('update') || t.includes('updated'))) return 'Group updated';
    if (t.includes('membership')) return 'Group membership changed';
    if (t.includes('invite') || t.includes('invitation')) return 'Invitation';
    if (t.includes('profile')) return 'Profile update';
    return 'System message';
  }

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

      const { getXmtpUtils } = await import('./utils-singleton');
      const utils = await getXmtpUtils();

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

      // Don't call generateInboxId - that's only for unregistered users
      // If we got here, the user is likely registered but we couldn't find their inbox ID
      // This shouldn't happen, but if it does, return null instead of the address
      console.warn('[XMTP] deriveInboxIdFromAddress: Could not resolve inbox ID for registered user');
      return null;
    } catch (error) {
      console.error('[XMTP] deriveInboxIdFromAddress failed:', error);
      return null;
    }
  }

  async fetchInboxProfile(inboxId: string): Promise<InboxProfile> {
    let normalizedInboxId = inboxId.toLowerCase();

    // Heuristic: skip remote lookups for values that clearly aren't inbox IDs
    // (e.g., ENS names like "deanpierce.eth" or arbitrary labels). This avoids
    // backend errors such as "invalid hexadecimal digit" when identity services
    // attempt to parse non-inbox inputs.
    const looksLikeInboxId = (value: string): boolean => {
      const v = value.trim();
      if (!v) return false;
      if (v.startsWith('0x')) return false; // that's an address, not an inbox id
      if (v.includes('.') || v.includes('@') || v.includes(' ')) return false; // ENS/email-like
      if (v.length < 10) return false; // too short to be a real inbox id
      // Allow lowercase alphanumerics, dash, underscore (broad, non-breaking)
      return /^[a-z0-9_-]+$/.test(v);
    };

    // If this inboxId previously produced an identity parse error (e.g., invalid hex),
    // avoid hammering the API for a cooldown period and return a minimal profile.
    const cooldownUntil = this.inboxErrorCooldown.get(normalizedInboxId) || 0;
    if (cooldownUntil > Date.now()) {
      return {
        inboxId: normalizedInboxId,
        displayName: undefined,
        avatarUrl: undefined,
        primaryAddress: undefined,
        addresses: [],
        identities: [],
      };
    }

    // If input looks like an Ethereum address, resolve to canonical inboxId first.
    if (/^0x[0-9a-f]{40}$/i.test(normalizedInboxId)) {
      try {
        const resolved = await this.deriveInboxIdFromAddress(normalizedInboxId);
        if (resolved) normalizedInboxId = resolved.toLowerCase();
      } catch (e) {
        // Non-fatal; continue with provided value
      }
    }

    // If the value still doesn't look like an inbox id, return a minimal profile
    // and avoid identity/preferences calls.
    if (!looksLikeInboxId(normalizedInboxId)) {
      return {
        inboxId: normalizedInboxId,
        displayName: inboxId,
        avatarUrl: undefined,
        primaryAddress: undefined,
        addresses: [],
        identities: [],
      };
    }

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

    const buildProfile = (
      identifiers: Identifier[] | undefined,
      overrides?: { displayName?: string; avatarUrl?: string }
    ): InboxProfile => {
      const identityRecords = (identifiers ?? []).map(toIdentityRecord);
      const addresses = addressesFromIdentifiers(identifiers);
      return {
        inboxId: normalizedInboxId,
        displayName: overrides?.displayName || addresses[0],
        avatarUrl: overrides?.avatarUrl,
        primaryAddress: addresses[0],
        addresses,
        identities: identityRecords,
      };
    };

    try {
      // Prefer profile message embedded in DM (our convention) if available
      // getDmByInboxId gets the DM with this peer (not a self-DM)
      if (this.client) {
        try {
          // Look for a DM with this peer inbox ID and scan recent messages for profile payload
          const dm = await this.client.conversations.getDmByInboxId(normalizedInboxId);
          if (dm) {
            const msgs = await dm.messages();
            const myInboxId = this.client.inboxId?.toLowerCase();
            for (let i = msgs.length - 1; i >= 0; i--) {
              const m = msgs[i];
              // Only look at messages from the peer (not from us)
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const senderInboxId = (m as any).senderInboxId?.toLowerCase();
              if (senderInboxId === myInboxId) continue; // Skip our own messages

              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const raw = typeof m.content === 'string' ? m.content : (m as any).encodedContent?.content;
              if (typeof raw !== 'string') continue;
              if (!raw.startsWith(XmtpClient.PROFILE_PREFIX)) continue;
              try {
                const obj = JSON.parse(raw.slice(XmtpClient.PROFILE_PREFIX.length)) as {
                  displayName?: string;
                  avatarUrl?: string;
                };
                // Build with overrides from profile message + identifiers from preferences if possible
                try {
                  const latest = await this.client.preferences.getLatestInboxState(normalizedInboxId);
                  if (latest) return buildProfile(latest.identifiers ?? [], obj);
                } catch {
                  // fallthrough
                }
                return buildProfile([], obj);
              } catch {
                // ignore malformed profile messages
              }
            }
          }
        } catch (err) {
          console.warn('[XMTP] fetchInboxProfile: DM profile scan failed', err);
        }
      }

      if (this.client) {
        try {
          const latest = await this.retryWithBackoff('preferences.getLatestInboxState', () => this.client!.preferences.getLatestInboxState(normalizedInboxId));
          if (latest) {
            return buildProfile(latest.identifiers ?? []);
          }
        } catch (error) {
          console.warn('[XMTP] fetchInboxProfile: getLatestInboxState failed, falling back to inboxStateFromInboxIds', error);
        }

        try {
          const states = await this.retryWithBackoff('preferences.inboxStateFromInboxIds', () => this.client!.preferences.inboxStateFromInboxIds([normalizedInboxId], true));
          if (states?.length) {
            return buildProfile(states[0]?.identifiers ?? []);
          }
      } catch (error) {
        console.warn('[XMTP] fetchInboxProfile: inboxStateFromInboxIds failed', error);
        // Apply cooldown for association/identity errors to reduce noise
        this.applyInboxErrorCooldown(normalizedInboxId, error);
      }
      }

      const { getXmtpUtils } = await import('./utils-singleton');
      const utils = await getXmtpUtils();
      try {
        const states = await this.retryWithBackoff('utils.inboxStateFromInboxIds', () => utils.inboxStateFromInboxIds([normalizedInboxId], 'production'));
        if (states?.length) {
          const state = states[0] as SafeInboxState;
          return buildProfile(state.identifiers);
        }
      } catch (error) {
        console.warn('[XMTP] fetchInboxProfile: Utils inboxStateFromInboxIds failed', error);
        // Apply cooldown for association/identity errors to reduce noise
        this.applyInboxErrorCooldown(normalizedInboxId, error);
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

    // Be conservative: some DM wrappers might expose a members-like field.
    // Require presence of at least one group-only API to classify as group.
    const hasMembersFn = typeof (conversation as { members?: () => Promise<SafeGroupMember[]> }).members === 'function';
    const hasGroupApi =
      typeof (conversation as { addMembersByIdentifiers?: (ids: Identifier[]) => Promise<void> }).addMembersByIdentifiers ===
      'function' ||
      typeof (conversation as { addMembers?: (ids: string[]) => Promise<void> }).addMembers === 'function' ||
      typeof (conversation as { updateName?: (name: string) => Promise<void> }).updateName === 'function' ||
      typeof (conversation as { permissions?: () => Promise<unknown> }).permissions === 'function';

    if (!hasMembersFn || !hasGroupApi) {
      // Not a group; treat as DM
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
      permissions?: () => Promise<{
        policyType: number;
        policySet: {
          addMemberPolicy: number;
          removeMemberPolicy: number;
          addAdminPolicy: number;
          removeAdminPolicy: number;
          updateGroupDescriptionPolicy: number;
          updateGroupImageUrlSquarePolicy: number;
          updateGroupNamePolicy: number;
          updateMessageDisappearingPolicy: number;
        };
      }>;
      updatePermission?: (
        permissionType: PermissionUpdateType,
        policy: PermissionPolicy,
        metadataField?: unknown,
      ) => Promise<void>;
      debugInfo?: () => Promise<SafeConversationDebugInfo>;
      getHmacKeys?: () => Promise<Map<string, SafeHmacKey[]>>;
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

    let permissions: GroupPermissionsState | undefined;
    try {
      // SDKs have exposed permissions both as a method and as a getter across versions.
      // Support both shapes defensively.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const maybeAny: any = safeGroup as any;
      const rawPermissions =
        typeof maybeAny.permissions === 'function'
          ? await maybeAny.permissions()
          : maybeAny.permissions;

      if (rawPermissions?.policySet) {
        permissions = {
          policyType: rawPermissions.policyType as GroupPermissionsState['policyType'],
          policySet: {
            addMemberPolicy: toGroupPermissionPolicyCode(rawPermissions.policySet.addMemberPolicy),
            removeMemberPolicy: toGroupPermissionPolicyCode(rawPermissions.policySet.removeMemberPolicy),
            addAdminPolicy: toGroupPermissionPolicyCode(rawPermissions.policySet.addAdminPolicy),
            removeAdminPolicy: toGroupPermissionPolicyCode(rawPermissions.policySet.removeAdminPolicy),
            updateGroupDescriptionPolicy: toGroupPermissionPolicyCode(
              rawPermissions.policySet.updateGroupDescriptionPolicy,
            ),
            updateGroupImageUrlSquarePolicy: toGroupPermissionPolicyCode(
              rawPermissions.policySet.updateGroupImageUrlSquarePolicy,
            ),
            updateGroupNamePolicy: toGroupPermissionPolicyCode(rawPermissions.policySet.updateGroupNamePolicy),
            updateMessageDisappearingPolicy: toGroupPermissionPolicyCode(
              rawPermissions.policySet.updateMessageDisappearingPolicy,
            ),
          },
        };
      }
    } catch (error) {
      console.warn('[XMTP] Failed to load group permissions:', conversationId, error);
    }

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
      permissions,
    };
  }

  async getGroupKeySummary(conversationId: string): Promise<GroupKeySummary | null> {
    if (!this.client) {
      throw new Error('Client not connected');
    }

    const group = await this.getGroupConversation(conversationId);
    if (!group) {
      return null;
    }

    const summary: GroupKeySummary = {
      currentEpoch: null,
      maybeForked: false,
      forkDetails: undefined,
      epochRange: null,
    };

    if (typeof group.debugInfo === 'function') {
      try {
        const info = await group.debugInfo();
        if (info) {
          summary.currentEpoch = typeof info.epoch === 'bigint' ? Number(info.epoch) : Number(info.epoch ?? 0);
          summary.maybeForked = Boolean(info.maybeForked);
          summary.forkDetails = info.forkDetails || undefined;
        }
      } catch (error) {
        console.warn('[XMTP] Failed to load conversation debug info:', conversationId, error);
      }
    }

    if (typeof group.getHmacKeys === 'function') {
      try {
        const keyMap = await group.getHmacKeys();
        const epochs: number[] = [];
        keyMap.forEach((entries) => {
          entries.forEach((entry) => {
            if (typeof entry.epoch === 'bigint') {
              epochs.push(Number(entry.epoch));
            } else if (typeof entry.epoch === 'number') {
              epochs.push(entry.epoch);
            }
          });
        });
        if (epochs.length > 0) {
          const min = epochs.reduce((acc, value) => Math.min(acc, value), epochs[0]);
          const max = epochs.reduce((acc, value) => Math.max(acc, value), epochs[0]);
          summary.epochRange = { min, max };
          if (summary.currentEpoch === null || summary.currentEpoch === undefined) {
            summary.currentEpoch = max;
          }
        }
      } catch (error) {
        console.warn('[XMTP] Failed to load group HMAC key epochs:', conversationId, error);
      }
    }

    return summary;
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

  async updateGroupPermission(
    conversationId: string,
    permissionType: PermissionUpdateType,
    policy: PermissionPolicy,
  ): Promise<GroupDetails | null> {
    const group = await this.getGroupConversation(conversationId);
    if (!group) {
      return null;
    }

    if (typeof group.updatePermission !== 'function') {
      console.warn('[XMTP] Group updatePermission unavailable, refreshing details instead.');
      return this.fetchGroupDetails(conversationId);
    }

    try {
      await group.updatePermission(permissionType, policy);
      logNetworkEvent({
        direction: 'outbound',
        event: 'group:permission_updated',
        details: `Updated permission ${permissionType} for group ${conversationId} to ${policy}`,
      });
      return await this.buildGroupDetails(conversationId, group);
    } catch (error) {
      console.error('[XMTP] Failed to update group permission:', error);
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
            // For Identifier payloads passed to the XMTP API, the identity service
            // expects raw hex without the 0x prefix. Normalize and strip prefix.
            const with0x = this.normalizeEthereumAddress(trimmed).toLowerCase();
            const rawHex = toIdentifierHex(with0x).toLowerCase();
            const identifier: Identifier = {
              identifier: rawHex,
              identifierKind: 'Ethereum',
            };
            identifierPayloads.push(identifier);
          } catch (error) {
            console.warn('[XMTP] Skipping invalid Ethereum address during addMembers:', trimmed, error);
          }
        } else {
          // Assume value is an inboxId; do not force case changes
          inboxIds.push(trimmed);
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

    let client: Client<unknown> | null = null;

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
      // Explicitly set DB path to ensure persistence stability across reloads
      // and prevent creating new installations (which hits the 10 limit).
      const dbPath = `xmtp-production-${identity.address.toLowerCase()}.db3`;
      
      console.log('[XMTP] Client.create options:', {
        env: 'production',
        dbPath,
        disableAutoRegister: true,
        loggingLevel: 'warn',
      });

      try {
        client = await Client.create(signer, {
          env: 'production',
          dbPath,
          loggingLevel: 'warn',
          structuredLogging: false,
          performanceLogging: false,
          debugEventsEnabled: false,
          disableAutoRegister: true,
          codecs: [
            new ReactionCodec(),
            new ReplyCodec(),
            new ReadReceiptCodec(),
            new RemoteAttachmentCodec(),
            new GroupUpdatedCodec(),
          ],
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const looksLikeCors = /get[_-]?inbox[_-]?ids/i.test(msg) || /CORS policy/i.test(msg);
        if (looksLikeCors) {
          console.warn('[XMTP] Client.create failed during identity probe (possibly CORS). Retrying without disableAutoRegister.');
          try {
            client = await Client.create(signer, {
              env: 'production',
              dbPath,
              loggingLevel: 'warn',
              structuredLogging: false,
              performanceLogging: false,
              debugEventsEnabled: false,
              // Let SDK perform its default registration path; some identity probes are avoided
              disableAutoRegister: false,
              codecs: [
                new ReactionCodec(),
                new ReplyCodec(),
                new ReadReceiptCodec(),
                new RemoteAttachmentCodec(),
                new GroupUpdatedCodec(),
              ],
            });
          } catch (e2) {
            console.warn('[XMTP] Fallback Client.create also failed:', e2);
            throw e; // bubble original for upstream handling
          }
        } else {
          throw e;
        }
      }

      // Decide whether we must register a new installation
      let mustRegister = shouldRegister;
      try {
        const preState: SafeInboxState = await this.retryWithBackoff('preferences.inboxState(true)', () => client!.preferences.inboxState(true));
        const existing = preState.installations || [];
        const hasOurInstallation = existing.some((inst: unknown) => {
          const id = (inst as { id?: string }).id;
          return id && client && id === client.installationId;
        });
        const count = existing.length;

        if (hasOurInstallation) {
          // Our device is already registered; do not register again
          mustRegister = false;
          console.log('[XMTP] Installation already present; skipping register()');
        } else if (mustRegister && count >= 10) {
          // Cannot register a new installation when already at limit
          throw new Error('⚠️ Installation limit reached (10/10). Please revoke old installations in Settings → XMTP Installations or use Force Recover.');
        } else if (count >= 8) {
          console.warn('[XMTP] Installation count nearing limit:', count);
          logNetworkEvent({ direction: 'status', event: 'connect:installation_warning', details: `Installation count ${count}/10` });
        }
      } catch (preCheckErr) {
        console.warn('[XMTP] Installation pre-check failed (continuing):', preCheckErr);
      }

      if (mustRegister) {
        console.log('[XMTP] Registering inbox/installation after probe');
        await client.register();
      } else {
        console.log('[XMTP] Skipping register() per options or pre-check');
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
            inboxState = await this.retryWithBackoff('preferences.inboxState(true)', () => this.client!.preferences.inboxState(true));
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
    let client: Client<unknown> | null = null;

    try {
      console.log('[XMTP] probeIdentity: Creating probe client...');
      client = await Client.create(signer, {
        env: 'production',
        loggingLevel: 'warn',
        structuredLogging: false,
        performanceLogging: false,
        debugEventsEnabled: false,
        disableAutoRegister: true,
        codecs: [
          new ReactionCodec(),
          new ReplyCodec(),
          new ReadReceiptCodec(),
          new RemoteAttachmentCodec(),
          new GroupUpdatedCodec(),
        ],
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
          inboxState = await this.retryWithBackoff('preferences.inboxState(true)', () => client!.preferences.inboxState(true));
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
      const storage = await getStorage();
      // Build a set of DM ids to avoid misclassifying them as groups
      let dmIdSet = new Set<string>();
      try {
        const dms = await this.client.conversations.listDms();
        
        dmIdSet = new Set((dms || []).map((d) => (d.id || '').toString()).filter(Boolean));

        // Persist DMs to storage to ensure they appear after a resync
        for (const dm of dms) {
          try {
            const dmAny = dm as unknown as { id?: string; topic?: string; peerAddress?: string; createdAt?: Date };
            const id = dmAny.id || dmAny.topic;
            if (!id) continue;
            
            const exists = await storage.getConversation(id);
            if (exists) continue;

            const createdAt = dmAny.createdAt ? dmAny.createdAt.getTime() : Date.now();
            
            const conversation: Conversation = {
              id,
              topic: dmAny.topic || id,
              peerId: dmAny.peerAddress || id, // Will be canonicalized to inboxId by background cleanup
              createdAt,
              lastMessageAt: createdAt,
              unreadCount: 0,
              pinned: false,
              archived: false,
              isGroup: false,
              lastMessagePreview: '',
            };
            
            await storage.putConversation(conversation);
          } catch (dmErr) {
            console.warn('[XMTP] Failed to persist DM during sync:', dmErr);
          }
        }
      } catch (e) {
        // If listDms fails, proceed without the set; group detection below is still conservative
        console.warn('[XMTP] listDms failed during syncConversations; continuing without DM filter', e);
      }
      console.log(`[XMTP] ✅ Synced ${convos.length} conversations`);

      // Ensure group conversations are present in local storage even if no messages were backfilled yet
      try {
        const myInboxLower = this.client?.inboxId?.toLowerCase?.() ?? this.identity?.inboxId?.toLowerCase?.();
        for (const c of convos as Array<{ id?: string; createdAtNs?: bigint }>) {
          const id = c?.id as string | undefined;
          if (!id) continue;
          const exists = await storage.getConversation(id);
          if (exists) continue;
          // Never classify known DM ids as groups
          if (dmIdSet.has(id)) {
            continue;
          }
          // Probe if this is a group by checking for group APIs on the conversation
          let group = null as Awaited<ReturnType<typeof this.getGroupConversation>> | null;
          try {
            group = await this.getGroupConversation(id);
          } catch {
            group = null;
          }
          if (!group) continue; // Not a group (DMs will be created via message backfill)

          try {
            const details = await this.buildGroupDetails(id, group);
            const isMember = (() => {
              if (!myInboxLower) {
                return true;
              }
              return details.members.some(
                (member) => member.inboxId && member.inboxId.toLowerCase() === myInboxLower
              );
            })();
            if (!isMember) {
              console.info('[XMTP] Skipping group sync because current inbox is no longer a member:', id);
              continue;
            }
            const createdAt = c?.createdAtNs ? Number((c.createdAtNs as bigint) / 1000000n) : Date.now();
            const memberIdentifiers = details.members.map((m) => (m.address ? m.address : m.inboxId)).filter(Boolean);
            const uniqueMembers = Array.from(new Set(memberIdentifiers));
            const memberInboxes = details.members.map((m) => m.inboxId).filter(Boolean);
            const adminInboxes = Array.from(new Set(details.adminInboxes));
            const superAdminInboxes = Array.from(new Set(details.superAdminInboxes));
            const groupMembers = details.members.map((m) => ({
              inboxId: m.inboxId,
              address: m.address,
              permissionLevel: m.permissionLevel,
              isAdmin: m.isAdmin,
              isSuperAdmin: m.isSuperAdmin,
            }));
            const conversation: Conversation = {
              id,
              topic: id,
              peerId: id,
              createdAt,
              lastMessageAt: createdAt,
              unreadCount: 0,
              pinned: false,
              archived: false,
              isGroup: true,
              groupName: details.name?.trim() || undefined,
              groupImage: details.imageUrl?.trim() || undefined,
              groupDescription: details.description?.trim() || undefined,
              members: uniqueMembers,
              memberInboxes,
              adminInboxes,
              superAdminInboxes,
              groupMembers,
            };
            await storage.putConversation(conversation);
            logNetworkEvent({ direction: 'status', event: 'conversations:sync:group_added', details: `Inserted group ${id}` });
          } catch (persistErr) {
            console.warn('[XMTP] Failed to persist group conversation after sync', persistErr);
          }
        }
      } catch (ensureErr) {
        console.warn('[XMTP] Failed ensuring groups in storage during sync', ensureErr);
      }

      useXmtpStore.getState().setLastSyncedAt(Date.now());

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
      // First sync the list of conversations from the network
      await this.client.conversations.sync();

      // Backfill DMs into our app store by dispatching the same custom events
      // we use for live streaming messages.
      const storage = await getStorage();
      const dms = await this.client.conversations.listDms();
      console.log(`[XMTP] Backfilling messages for ${dms.length} DM conversations`);

      for (const dm of dms) {
        try {
          // Force sync messages for this conversation to ensure we have latest
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          if (typeof (dm as any).sync === 'function') {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (dm as any).sync();
          }

          const dmId = dm.id?.toString();
          if (!dmId) {
            continue;
          }
          if (await storage.isConversationDeleted(dmId)) {
            console.info('[XMTP] Skipping deleted DM conversation during history sync:', dmId);
            continue;
          }
          const decodedMessages = await dm.messages();
          // Oldest first so previews/unreads evolve naturally
          decodedMessages.sort((a, b) => (a.sentAtNs < b.sentAtNs ? -1 : a.sentAtNs > b.sentAtNs ? 1 : 0));

          for (const m of decodedMessages) {
            const content = typeof m.content === 'string' ? m.content : m.encodedContent.content;
            const typeId = this.getContentTypeIdFromAny(m);
            // Reactions: aggregate onto target message instead of surfacing as bubbles
            try {
              const lowerType = (typeId || '').toLowerCase();
              const isReaction = lowerType.includes('reaction');
              if (isReaction && m && typeof m.content === 'object') {
                try {
                  const r = m.content as unknown as { content?: string; reference?: string; action?: string };
                  const emoji = (r.content ?? '').toString();
                  const ref = (r.reference ?? '').toString();
                  const action = (r.action ?? 'added').toString();
                  window.dispatchEvent(
                    new CustomEvent('xmtp:reaction', {
                      detail: {
                        conversationId: m.conversationId,
                        referenceMessageId: ref,
                        emoji,
                        action,
                        senderInboxId: m.senderInboxId,
                      },
                    })
                  );
                } catch (rxErr) {
                  console.warn('[XMTP] Failed to parse reaction (backfill)', rxErr);
                }
                continue;
              }
            } catch (rxOuter) {
              // ignore
            }
            // Handle profile broadcasts silently (do not surface as chat messages)
            if (typeof content === 'string' && content.startsWith(XmtpClient.PROFILE_PREFIX)) {
              try {
                const json = content.slice(XmtpClient.PROFILE_PREFIX.length);
                const obj = JSON.parse(json) as { displayName?: string; avatarUrl?: string };
                const senderInboxId = m.senderInboxId;
                if (senderInboxId) {
                  const contactStore = useContactStore.getState();
                  const existingContact =
                    contactStore.getContactByInboxId(senderInboxId) ??
                    contactStore.getContactByAddress(senderInboxId);
                  if (existingContact) {
                    await contactStore.upsertContactProfile({
                      inboxId: senderInboxId,
                      displayName: obj.displayName,
                      avatarUrl: obj.avatarUrl,
                      source: 'inbox',
                      metadata: { ...existingContact, lastSyncedAt: Date.now() },
                    });
                  }
                  logNetworkEvent({
                    direction: 'inbound',
                    event: 'profile:received',
                    details: `Profile update from ${senderInboxId}`,
                    payload: JSON.stringify(obj),
                  });
                }
              } catch (e) {
                console.warn('[XMTP] Failed to process profile backfill message', e);
              }
              continue;
            }
            // Treat non-text content types in history too
            try {
              const lowerType = (typeId || '').toLowerCase();
              // Reactions: aggregate onto target message and skip bubble
              if (lowerType.includes('reaction')) {
                try {
                  const r = (m as unknown as { content?: unknown }).content as
                    | { content?: string; reference?: string; action?: string }
                    | undefined;
                  const emoji = (r?.content ?? '').toString();
                  const ref = (r?.reference ?? '').toString();
                  const action = (r?.action ?? 'added').toString();
                  window.dispatchEvent(
                    new CustomEvent('xmtp:reaction', {
                      detail: {
                        conversationId: m.conversationId,
                        referenceMessageId: ref,
                        emoji,
                        action,
                        senderInboxId: m.senderInboxId,
                      },
                    })
                  );
                } catch (rxErr) {
                  console.warn('[XMTP] Failed to parse reaction (stream)', rxErr);
                }
                continue;
              }
              // Reply messages: render as normal text bubbles with reply metadata
              if (lowerType.includes('reply')) {
                try {
                  const reply = (m as unknown as { content?: unknown }).content as
                    | { content?: unknown; reference?: string }
                    | undefined;
                  const body =
                    typeof reply?.content === 'string'
                      ? reply.content
                      : this.formatPayload(reply?.content ?? '');
                  const replyToId = (reply?.reference ?? '').toString() || undefined;
                  const sentAt = m.sentAtNs ? Number(m.sentAtNs / 1000000n) : Date.now();
                  const xmsg: XmtpMessage = {
                    id: m.id,
                    conversationId: m.conversationId,
                    senderAddress: m.senderInboxId,
                    content: body,
                    sentAt,
                    replyToId,
                  };
                  window.dispatchEvent(
                    new CustomEvent('xmtp:message', {
                      detail: { conversationId: m.conversationId, message: xmsg, isHistory: true },
                    })
                  );
                } catch (replyErr) {
                  console.warn('[XMTP] Failed to parse reply (backfill)', replyErr);
                }
                continue;
              }
              const isReadReceipt = lowerType.includes('read') && lowerType.includes('receipt');
              const isGroupUpdated = lowerType.includes('group') && lowerType.includes('updated');
              if (isReadReceipt) {
                const ts = m.sentAtNs ? Number(m.sentAtNs / 1000000n) : Date.now();
                try {
                  window.dispatchEvent(
                    new CustomEvent('xmtp:read-receipt', {
                      detail: {
                        conversationId: m.conversationId,
                        senderInboxId: m.senderInboxId,
                        sentAt: ts,
                      },
                    })
                  );
                } catch (err) {
                  // ignore
                }
                continue;
              }
              if (isGroupUpdated) {
                try {
                  const contentObj = (m as unknown as Record<string, unknown>)['content'];
                  // Structured event for UI/state updates
                  window.dispatchEvent(
                    new CustomEvent('xmtp:group-updated', {
                      detail: {
                        conversationId: m.conversationId,
                        content: contentObj,
                      },
                    })
                  );
                  const label = this.formatGroupUpdatedLabel(contentObj);
                  const body = label || 'Group updated';
                  const ts = m.sentAtNs ? Number(m.sentAtNs / 1000000n) : Date.now();
                  window.dispatchEvent(
                    new CustomEvent('xmtp:system', {
                      detail: {
                        conversationId: m.conversationId,
                        system: {
                          id: `sys_${m.id}`,
                          senderInboxId: m.senderInboxId,
                          body,
                          sentAt: ts,
                        },
                      },
                    })
                  );
                } catch (err) {
                  console.warn('[XMTP] Failed to dispatch group-updated events', err);
                }
                continue;
              }
              const isTextLike = typeof content === 'string' && (!typeId || this.labelForContentType(typeId) === 'Text');
              if (!isTextLike) {
                const label = this.labelForContentType(typeId);
                const ts = m.sentAtNs ? Number(m.sentAtNs / 1000000n) : Date.now();
                window.dispatchEvent(
                  new CustomEvent('xmtp:system', {
                    detail: {
                      conversationId: m.conversationId,
                      system: {
                        id: `sys_${m.id}`,
                        senderInboxId: m.senderInboxId,
                        body: label,
                        sentAt: ts,
                      },
                    },
                  })
                );
                continue;
              }
            } catch (e) {
              console.warn('[XMTP] Failed to classify backfill message type', e);
            }
            const xmsg = {
              id: m.id,
              conversationId: m.conversationId,
              senderAddress: m.senderInboxId,
              content,
              sentAt: Number(m.sentAtNs / 1000000n),
            } as XmtpMessage;

            window.dispatchEvent(
              new CustomEvent('xmtp:message', {
                detail: { conversationId: m.conversationId, message: xmsg, isHistory: true },
              })
            );
          }
        } catch (dmErr) {
          if (this.isMissingConversationKeyError(dmErr)) {
            console.info('[XMTP] Skipping DM history backfill due to missing key:', dm.id);
            continue;
          }
          console.warn('[XMTP] Failed to backfill messages for DM:', dm.id, dmErr);
        }
      }

      // Backfill Groups as well (group conversations may not have recent DMs)
      try {
        const allConvs = await this.client.conversations.list();
        const dmIds = new Set(dms.map((d) => d.id));
        const maybeGroups = allConvs.filter((c) => !dmIds.has(c.id));
        console.log(`[XMTP] Backfilling messages for ${maybeGroups.length} group conversations`);
        for (const conv of maybeGroups) {
          try {
            // Force sync messages for this conversation
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            if (typeof (conv as any).sync === 'function') {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              await (conv as any).sync();
            }

            if (!conv.id) {
              continue;
            }
            if (await storage.isConversationDeleted(conv.id)) {
              console.info('[XMTP] Skipping deleted group conversation during history sync:', conv.id);
              continue;
            }
            const decodedMessages = await conv.messages();
            decodedMessages.sort((a, b) => (a.sentAtNs < b.sentAtNs ? -1 : a.sentAtNs > b.sentAtNs ? 1 : 0));
            for (const m of decodedMessages) {
              const content = typeof m.content === 'string' ? m.content : m.encodedContent.content;
              const typeId = this.getContentTypeIdFromAny(m);
              // Handle reactions first: aggregate onto target and skip bubble
              try {
                const lowerType = (typeId || '').toLowerCase();
                if (lowerType.includes('reaction')) {
                  try {
                    const r = (m as unknown as { content?: unknown }).content as
                      | { content?: string; reference?: string; action?: string }
                      | undefined;
                    const emoji = (r?.content ?? '').toString();
                    const ref = (r?.reference ?? '').toString();
                    const action = (r?.action ?? 'added').toString();
                    window.dispatchEvent(
                      new CustomEvent('xmtp:reaction', {
                        detail: {
                          conversationId: m.conversationId,
                          referenceMessageId: ref,
                          emoji,
                          action,
                          senderInboxId: m.senderInboxId,
                        },
                      })
                    );
                  } catch (rxErr) {
                    console.warn('[XMTP] Failed to parse reaction (group backfill)', rxErr);
                  }
                  continue;
                }
              } catch {
                // ignore
              }

              // Treat non-text/system content types in history
              try {
                const lowerType = (typeId || '').toLowerCase();
                const isReadReceipt = lowerType.includes('read') && lowerType.includes('receipt');
                const isGroupUpdated = lowerType.includes('group') && lowerType.includes('updated');
                if (isReadReceipt) {
                  const ts = m.sentAtNs ? Number(m.sentAtNs / 1000000n) : Date.now();
                  try {
                    window.dispatchEvent(
                      new CustomEvent('xmtp:read-receipt', {
                        detail: { conversationId: m.conversationId, senderInboxId: m.senderInboxId, sentAt: ts },
                      })
                    );
                  } catch (rrErr) {
                    // ignore read-receipt dispatch failure
                  }
                  continue;
                }
                if (isGroupUpdated) {
                  try {
                    const contentObj = (m as unknown as Record<string, unknown>)['content'];
                    window.dispatchEvent(new CustomEvent('xmtp:group-updated', { detail: { conversationId: m.conversationId, content: contentObj } }));
                    const label = this.formatGroupUpdatedLabel(contentObj);
                    const body = label || 'Group updated';
                    const ts = m.sentAtNs ? Number(m.sentAtNs / 1000000n) : Date.now();
                    window.dispatchEvent(
                      new CustomEvent('xmtp:system', {
                        detail: { conversationId: m.conversationId, system: { id: `sys_${m.id}`, senderInboxId: m.senderInboxId, body, sentAt: ts } },
                      })
                    );
                  } catch (err) {
                    console.warn('[XMTP] Failed to dispatch group-updated events (group backfill)', err);
                  }
                  continue;
                }
                const isReply = lowerType.includes('reply');
                if (isReply) {
                  try {
                    const reply = (m as unknown as { content?: unknown }).content as
                      | { content?: unknown; reference?: string }
                      | undefined;
                    const body =
                      typeof reply?.content === 'string'
                        ? reply.content
                        : this.formatPayload(reply?.content ?? '');
                    const replyToId = (reply?.reference ?? '').toString() || undefined;
                    const sentAt = m.sentAtNs ? Number(m.sentAtNs / 1000000n) : Date.now();
                    const xmsg: XmtpMessage = {
                      id: m.id,
                      conversationId: m.conversationId,
                      senderAddress: m.senderInboxId,
                      content: body,
                      sentAt,
                      replyToId,
                    };
                    window.dispatchEvent(
                      new CustomEvent('xmtp:message', {
                        detail: { conversationId: m.conversationId, message: xmsg, isHistory: true },
                      })
                    );
                  } catch (replyErr) {
                    console.warn('[XMTP] Failed to parse reply (group backfill)', replyErr);
                  }
                  continue;
                }
                const isTextLike = typeof content === 'string' && (!typeId || this.labelForContentType(typeId) === 'Text');
                if (!isTextLike) {
                  const label = this.labelForContentType(typeId);
                  const ts = m.sentAtNs ? Number(m.sentAtNs / 1000000n) : Date.now();
                  window.dispatchEvent(
                    new CustomEvent('xmtp:system', {
                      detail: { conversationId: m.conversationId, system: { id: `sys_${m.id}`, senderInboxId: m.senderInboxId, body: label, sentAt: ts } },
                    })
                  );
                  continue;
                }
              } catch (e) {
                console.warn('[XMTP] Failed to classify group backfill message type', e);
              }
              const xmsg = {
                id: m.id,
                conversationId: m.conversationId,
                senderAddress: m.senderInboxId,
                content,
                sentAt: Number(m.sentAtNs / 1000000n),
              } as XmtpMessage;

              window.dispatchEvent(
                new CustomEvent('xmtp:message', {
                  detail: { conversationId: m.conversationId, message: xmsg, isHistory: true },
                })
              );
            }
          } catch (gErr) {
            if (this.isMissingConversationKeyError(gErr)) {
              console.info('[XMTP] Skipping group history backfill due to missing key:', conv.id);
              continue;
            }
            console.warn('[XMTP] Failed to backfill messages for conversation:', conv.id, gErr);
          }
        }
      } catch (listErr) {
        console.warn('[XMTP] Failed to enumerate conversations for group backfill', listErr);
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

            // Filter out non-application messages (e.g., group membership changes) from surfacing as normal chat
            try {
              const maybeKind = (message as unknown as { kind?: unknown }).kind;
              let isMembershipChange = false;
              if (typeof maybeKind === 'number') {
                // In XMTP v5, GroupMessageKind.MembershipChange is 1, Application is 0
                isMembershipChange = maybeKind === 1;
              } else if (typeof maybeKind === 'string') {
                isMembershipChange = maybeKind.toLowerCase().includes('membership');
              }
              if (isMembershipChange) {
                logNetworkEvent({
                  direction: 'inbound',
                  event: 'group:membership_change',
                  details: `Ignored membership change in ${message.conversationId}`,
                });
                // Surface as a stylized system message via a dedicated event
                try {
                  const ts = message.sentAtNs ? Number(message.sentAtNs / 1000000n) : Date.now();
                  window.dispatchEvent(
                    new CustomEvent('xmtp:system', {
                      detail: {
                        conversationId: message.conversationId,
                        system: {
                          id: `sys_${message.id}`,
                          senderInboxId: message.senderInboxId,
                          body: 'Group membership changed',
                          sentAt: ts,
                        },
                      },
                    })
                  );
                } catch (err) {
                  console.warn('[XMTP] Failed to dispatch system message event', err);
                }
                continue;
              }
            } catch (err) {
              console.warn('[XMTP] Failed to inspect message kind', err);
            }

            // If content type is not text, surface appropriately
            try {
              const typeId = this.getContentTypeIdFromAny(message);
              const contentIsString = typeof message.content === 'string';
              const looksText = contentIsString && (!typeId || this.labelForContentType(typeId) === 'Text');
              const lowerType = (typeId || '').toLowerCase();
              const isReadReceipt = lowerType.includes('read') && lowerType.includes('receipt');
              const isGroupUpdated = lowerType.includes('group') && lowerType.includes('updated');
              if (isReadReceipt) {
                // Do not display as a bubble or system line; dispatch a dedicated event to update UI statuses
                const ts = message.sentAtNs ? Number(message.sentAtNs / 1000000n) : Date.now();
                try {
                  window.dispatchEvent(
                    new CustomEvent('xmtp:read-receipt', {
                      detail: {
                        conversationId: message.conversationId,
                        senderInboxId: message.senderInboxId,
                        sentAt: ts,
                      },
                    })
                  );
                } catch (err) {
                  // ignore
                }
                continue;
              }
              if (isGroupUpdated) {
                try {
                  // Dispatch structured event so UI can update conversation metadata
                  const contentObj = (message as unknown as Record<string, unknown>)['content'];
                  window.dispatchEvent(
                    new CustomEvent('xmtp:group-updated', {
                      detail: {
                        conversationId: message.conversationId,
                        content: contentObj,
                      },
                    })
                  );
                  // Also surface a stylized system message label
                  const label = this.formatGroupUpdatedLabel(contentObj);
                  const body = label || 'Group updated';
                  const ts = message.sentAtNs ? Number(message.sentAtNs / 1000000n) : Date.now();
                  window.dispatchEvent(
                    new CustomEvent('xmtp:system', {
                      detail: {
                        conversationId: message.conversationId,
                        system: {
                          id: `sys_${message.id}`,
                          senderInboxId: message.senderInboxId,
                          body,
                          sentAt: ts,
                        },
                      },
                    })
                  );
                } catch (err) {
                  console.warn('[XMTP] Failed to dispatch group-updated events', err);
                }
                continue;
              }
              const isReply = lowerType.includes('reply');
              if (isReply) {
                try {
                  const reply = (message as unknown as { content?: unknown }).content as
                    | { content?: unknown; reference?: string }
                    | undefined;
                  const body =
                    typeof reply?.content === 'string'
                      ? reply.content
                      : this.formatPayload(reply?.content ?? '');
                  const replyToId = (reply?.reference ?? '').toString() || undefined;
                  const sentAt = message.sentAtNs ? Number(message.sentAtNs / 1000000n) : Date.now();
                  const xmsg: XmtpMessage = {
                    id: message.id,
                    conversationId: message.conversationId,
                    senderAddress: message.senderInboxId,
                    content: body,
                    sentAt,
                    replyToId,
                  };
                  window.dispatchEvent(
                    new CustomEvent('xmtp:message', {
                      detail: { conversationId: message.conversationId, message: xmsg, isHistory: false },
                    })
                  );
                } catch (replyErr) {
                  console.warn('[XMTP] Failed to parse reply (stream)', replyErr);
                }
                continue;
              }
              if (!looksText) {
                const label = this.labelForContentType(typeId);
                const ts = message.sentAtNs ? Number(message.sentAtNs / 1000000n) : Date.now();
                window.dispatchEvent(
                  new CustomEvent('xmtp:system', {
                    detail: {
                      conversationId: message.conversationId,
                      system: {
                        id: `sys_${message.id}`,
                        senderInboxId: message.senderInboxId,
                        body: label,
                        sentAt: ts,
                      },
                    },
                  })
                );
                continue;
              }
            } catch (e) {
              console.warn('[XMTP] Failed to classify stream message type', e);
            }

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

            // Handle profile broadcasts silently (do not surface as chat messages)
            if (typeof message.content === 'string' && message.content.startsWith(XmtpClient.PROFILE_PREFIX)) {
              try {
                const payload = message.content.slice(XmtpClient.PROFILE_PREFIX.length);
                const obj = JSON.parse(payload) as { displayName?: string; avatarUrl?: string };
                const senderInboxId = message.senderInboxId;
                if (senderInboxId) {
                  const contactStore = useContactStore.getState();
                  const existingContact =
                    contactStore.getContactByInboxId(senderInboxId) ??
                    contactStore.getContactByAddress(senderInboxId);
                  if (existingContact) {
                    await contactStore.upsertContactProfile({
                      inboxId: senderInboxId,
                      displayName: obj.displayName,
                      avatarUrl: obj.avatarUrl,
                      source: 'inbox',
                      metadata: { ...existingContact, lastSyncedAt: Date.now() },
                    });
                  }
                  try {
                    window.dispatchEvent(
                      new CustomEvent('ui:toast', {
                        detail: `Profile updated for ${senderInboxId}`,
                      })
                    );
                  } catch (err) {
                    console.warn('[UI] Toast dispatch failed', err);
                  }
                  logNetworkEvent({
                    direction: 'inbound',
                    event: 'profile:received',
                    details: `Profile update from ${senderInboxId}`,
                    payload: JSON.stringify(obj),
                  });
                }
              } catch (e) {
                console.warn('[XMTP] Failed to process profile message', e);
              }
              continue;
            }

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
                isHistory: false,
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
   * Persist profile to the XMTP network by sending a small JSON record to a self-DM.
   * This makes display name/avatar retrievable on any device after local data is cleared.
   */
  async saveProfile(displayName?: string, avatarUrl?: string): Promise<void> {
    if (!this.client) {
      throw new Error('Client not connected');
    }

    const inboxId = this.client.inboxId;
    if (!inboxId) {
      throw new Error('No inbox ID available');
    }

    // Ensure payload stays reasonably small
    const payload = {
      type: 'profile',
      v: 1,
      displayName: displayName?.trim() || undefined,
      avatarUrl: avatarUrl && avatarUrl.length <= 256 * 1024 ? avatarUrl : undefined,
      ts: Date.now(),
    };

    const content = `${XmtpClient.PROFILE_PREFIX}${JSON.stringify(payload)}`;

    try {
      // 1) Save to self-DM for same-inbox multi-device sync
      let dm = await this.client.conversations.getDmByInboxId(inboxId);
      if (!dm) {
        dm = await this.client.conversations.newDm(inboxId);
      }
      await dm.send(content);
      console.log('[XMTP] ✅ Saved profile to self-DM');

      // 2) Broadcast to all DM peers so contacts can discover latest profile
      try {
        const dms = await this.client.conversations.listDms();
        for (const peerDm of dms) {
          try {
            await peerDm.send(content);
          } catch (e) {
            console.warn('[XMTP] profile broadcast failed for DM', peerDm.id, e);
          }
        }
        console.log('[XMTP] ✅ Broadcasted profile to', dms.length, 'DMs');
      } catch (e) {
        console.warn('[XMTP] profile broadcast skipped/failed:', e);
      }

      logNetworkEvent({
        direction: 'outbound',
        event: 'profile:save',
        details: 'Profile saved and broadcast to DMs',
      });
    } catch (error) {
      console.error('[XMTP] Failed to save profile to network:', error);
      throw error;
    }
  }

  /**
   * Load latest profile from the network (self-DM) and return values if found.
   */
  async loadOwnProfile(): Promise<{ displayName?: string; avatarUrl?: string } | null> {
    if (!this.client) {
      return null;
    }
    const inboxId = this.client.inboxId;
    if (!inboxId) {
      return null;
    }
    try {
      const dm = await this.client.conversations.getDmByInboxId(inboxId);
      if (!dm) {
        return null;
      }
      const msgs = await dm.messages();
      // Scan newest → oldest for a profile record
      for (let i = msgs.length - 1; i >= 0; i--) {
        const m = msgs[i];
        const raw = typeof m.content === 'string' ? m.content : m.encodedContent?.content;
        if (typeof raw !== 'string') continue;
        if (!raw.startsWith(XmtpClient.PROFILE_PREFIX)) continue;
        try {
          const json = raw.slice(XmtpClient.PROFILE_PREFIX.length);
          const obj = JSON.parse(json) as { displayName?: string; avatarUrl?: string };
          console.log('[XMTP] ✅ Loaded profile from network');
          logNetworkEvent({ direction: 'inbound', event: 'profile:load', details: 'Profile loaded from self-DM' });
          return { displayName: obj.displayName, avatarUrl: obj.avatarUrl };
        } catch (e) {
          console.warn('[XMTP] Failed to parse profile message', e);
        }
      }
    } catch (error) {
      console.warn('[XMTP] No profile found on network:', error);
    }
    return null;
  }

  /**
   * Check conversation history to see if we've sent our profile (displayName/avatar),
   * and send any missing profile data. Updates conversation record with sent flags.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async ensureProfileSent(conversationId: string, dmConversation?: any): Promise<{
    sentDisplayName: boolean;
    sentAvatar: boolean;
  }> {
    if (!this.client) {
      return { sentDisplayName: false, sentAvatar: false };
    }

    const myInboxId = this.client.inboxId;
    if (!myInboxId) {
      return { sentDisplayName: false, sentAvatar: false };
    }

    try {
      // Get conversation from storage to check existing flags
      const storage = await getStorage();
      const conversation = await storage.getConversation(conversationId);

      // If both flags are already set, skip checking
      if (conversation?.profileSentDisplayName && conversation?.profileSentAvatar) {
        return {
          sentDisplayName: true,
          sentAvatar: true,
        };
      }

      // Get the DM conversation if not provided
      let dm = dmConversation;
      if (!dm) {
        // Try to get DM by conversation ID
        try {
          const allDms = await this.client.conversations.listDms();
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          dm = allDms.find((d: any) => d.id?.toString() === conversationId);
        } catch (e) {
          console.warn('[XMTP] Failed to list DMs for profile check:', e);
        }
      }

      if (!dm) {
        console.log('[XMTP] No DM conversation found for profile check:', conversationId);
        return { sentDisplayName: false, sentAvatar: false };
      }

      // Scan all messages to see if we've sent profile messages
      let foundDisplayName = conversation?.profileSentDisplayName ?? false;
      let foundAvatar = conversation?.profileSentAvatar ?? false;

      if (!foundDisplayName || !foundAvatar) {
        try {
          const messages = await dm.messages();
          for (const msg of messages) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const senderInboxId = (msg as any).senderInboxId?.toLowerCase();
            if (senderInboxId !== myInboxId.toLowerCase()) continue;

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const content = typeof msg.content === 'string' ? msg.content : (msg as any).encodedContent?.content;
            if (typeof content !== 'string' || !content.startsWith(XmtpClient.PROFILE_PREFIX)) continue;

            try {
              const json = content.slice(XmtpClient.PROFILE_PREFIX.length);
              const profileData = JSON.parse(json) as { displayName?: string; avatarUrl?: string; type?: string };
              if (profileData.type === 'profile') {
                if (profileData.displayName && !foundDisplayName) {
                  foundDisplayName = true;
                }
                if (profileData.avatarUrl && !foundAvatar) {
                  foundAvatar = true;
                }
              }
            } catch (e) {
              // Ignore parse errors
            }
          }
        } catch (e) {
          console.warn('[XMTP] Failed to scan messages for profile check:', e);
        }
      }

      // Load our profile
      let myProfile = await this.loadOwnProfile();
      if (!myProfile || (!myProfile.displayName && !myProfile.avatarUrl)) {
        const { useAuthStore } = await import('@/lib/stores');
        const identity = useAuthStore.getState().identity;
        if (identity) {
          myProfile = {
            displayName: identity.displayName,
            avatarUrl: identity.avatar,
          };
        }
      }

      // Send missing profile data
      const needsDisplayName = !foundDisplayName && myProfile?.displayName;
      const needsAvatar = !foundAvatar && myProfile?.avatarUrl;

      if (needsDisplayName || needsAvatar) {
        const payload = {
          type: 'profile',
          v: 1,
          displayName: myProfile?.displayName?.trim() || undefined,
          avatarUrl: myProfile?.avatarUrl,
          ts: Date.now(),
        };
        const profileContent = `${XmtpClient.PROFILE_PREFIX}${JSON.stringify(payload)}`;
        await dm.send(profileContent);
        console.log('[XMTP] ✅ Sent missing profile data to conversation', {
          conversationId,
          sentDisplayName: needsDisplayName,
          sentAvatar: needsAvatar,
        });

        // Update flags based on what we sent
        if (needsDisplayName && myProfile?.displayName) {
          foundDisplayName = true;
        }
        if (needsAvatar && myProfile?.avatarUrl) {
          foundAvatar = true;
        }
      }

      // Update conversation record with sent flags (both storage and store)
      if (conversation) {
        const updates: Partial<Conversation> = {};
        if (foundDisplayName !== conversation.profileSentDisplayName) {
          updates.profileSentDisplayName = foundDisplayName;
        }
        if (foundAvatar !== conversation.profileSentAvatar) {
          updates.profileSentAvatar = foundAvatar;
        }
        if (Object.keys(updates).length > 0) {
          await storage.putConversation({ ...conversation, ...updates });
          // Also update the conversation store
          const { useConversationStore } = await import('@/lib/stores');
          useConversationStore.getState().updateConversation(conversationId, updates);
        }
      }

      return {
        sentDisplayName: foundDisplayName,
        sentAvatar: foundAvatar,
      };
    } catch (error) {
      console.warn('[XMTP] Failed to ensure profile sent:', error);
      return { sentDisplayName: false, sentAvatar: false };
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
  async getInboxState(): Promise<SafeInboxState> {
    const isE2E = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_E2E_TEST === 'true');
    const fallbackIdentifier: { identifier: string; identifierKind: 'Ethereum' } | undefined = this.identity?.address
      ? {
        identifier: toIdentifierHex(this.identity.address).toLowerCase(),
        identifierKind: 'Ethereum' as const,
      }
      : undefined;

    if (isE2E) {
      // Return a stubbed inbox state for E2E to avoid network calls
      const inboxId = this.identity?.inboxId ?? `local-${Date.now().toString(36)}`;
      return createStubInboxState({ identifier: fallbackIdentifier, inboxId });
    }
    const withTimeout = async <T>(p: Promise<T>, ms = 10000): Promise<T> => {
      return await Promise.race<T>([
        p,
        new Promise<T>((_, reject) => setTimeout(() => reject(new Error('Timeout fetching inbox state')), ms)) as Promise<T>,
      ]);
    };

    if (this.client) {
      // Force refresh from network to avoid stale state
      const state = (await withTimeout(
        this.retryWithBackoff('preferences.inboxState(true)', () => this.client!.preferences.inboxState(true)),
      )) as SafeInboxState | null | undefined;

      if (state) {
        return state;
      }

      console.warn('[XMTP] Preferences returned empty inbox state; using stub fallback');
      return createStubInboxState({
        identifier: fallbackIdentifier,
        inboxId: this.client?.inboxId ?? this.identity?.inboxId ?? null,
      });
    }

    if (!this.identity) {
      throw new Error('No identity available');
    }

    const identifier = fallbackIdentifier ?? {
      identifier: toIdentifierHex(this.identity.address).toLowerCase(),
      identifierKind: 'Ethereum' as const,
    };

    try {
      // Use Utils to resolve inboxId & fetch state without creating a full client
      const { getXmtpUtils } = await import('./utils-singleton');
      const utils = await getXmtpUtils();

      const inboxId = await withTimeout(this.retryWithBackoff('utils.getInboxIdForIdentifier', () => utils.getInboxIdForIdentifier(identifier, 'production')));
      if (!inboxId) {
        console.warn('[XMTP] No inbox registered for this identity; returning empty inbox state');
        return createStubInboxState({ identifier, inboxId: this.identity?.inboxId ?? null });
      }

      const states = (await withTimeout(
        this.retryWithBackoff('utils.inboxStateFromInboxIds', () => utils.inboxStateFromInboxIds([inboxId], 'production')),
      )) as Array<SafeInboxState | null | undefined>;
      const state = states.find((value) => Boolean(value)) ?? null;
      // Utils worker doesn't need explicit close; it dies with page lifecycle.
      if (state) {
        return state as SafeInboxState;
      }

      console.warn('[XMTP] Utils returned empty inbox state array; using stub fallback');
      return createStubInboxState({ identifier, inboxId });
    } catch (error) {
      console.warn('[XMTP] Failed to fetch inbox state via Utils; returning empty inbox state:', error);
      return createStubInboxState({ identifier, inboxId: this.identity?.inboxId ?? null });
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
      let inboxId = await this.retryWithBackoff('client.findInboxIdByIdentifier', () => this.client!.findInboxIdByIdentifier(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        identifier as any
      ));

      if (inboxId) {
        console.log('[XMTP] ✅ Found inbox ID:', inboxId, 'for address:', address);
        return inboxId;
      }

      // Try with full address (with 0x) in case the SDK expects it
      if (address.startsWith('0x')) {
        try {
          const identifierWith0x = {
            identifier: address.toLowerCase(),
            identifierKind: 'Ethereum' as const,
          };
          console.log('[XMTP] Trying findInboxId with 0x prefix:', identifierWith0x);
          inboxId = await this.retryWithBackoff('client.findInboxIdByIdentifier', () => this.client!.findInboxIdByIdentifier(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            identifierWith0x as any
          ));
          if (inboxId) {
            console.log('[XMTP] ✅ Found inbox ID (with 0x):', inboxId, 'for address:', address);
            return inboxId;
          }
        } catch (e) {
          console.warn('[XMTP] findInboxIdByIdentifier (with 0x) failed:', e);
        }
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
      const inboxIdInput = peerAddressOrInboxId;
      const originalInput = peerAddressOrInboxId;

      let dmConversation;

      let resolvedPeerInboxId: string | null = null;
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

        // Try multiple methods to get the actual inbox ID
        try {
          // Method 1: Direct lookup (most reliable for registered users)
          resolvedPeerInboxId = await this.getInboxIdFromAddress(peerAddressOrInboxId);
        } catch (e) {
          console.warn('[XMTP] getInboxIdFromAddress failed, trying deriveInboxIdFromAddress:', e);
        }

        // Method 2: Derive from address if direct lookup failed
        if (!resolvedPeerInboxId) {
          try {
            const derived = await this.deriveInboxIdFromAddress(peerAddressOrInboxId);
            // Only use if it's actually an inbox ID (not an address)
            if (derived && !derived.startsWith('0x')) {
              resolvedPeerInboxId = derived;
            }
          } catch (e) {
            console.warn('[XMTP] deriveInboxIdFromAddress also failed:', e);
          }
        }

        // Method 3: Try Utils.getInboxIdForIdentifier if both methods failed
        // The conversation was created successfully, so the peer is registered
        if (!resolvedPeerInboxId) {
          try {
            const { getXmtpUtils } = await import('./utils-singleton');
            const utils = await getXmtpUtils();
            const identifierForLookup = {
              identifier: toIdentifierHex(peerAddressOrInboxId).toLowerCase(),
              identifierKind: 'Ethereum' as const,
            };
            const inboxId = await utils.getInboxIdForIdentifier(identifierForLookup, 'production');
            if (inboxId && !inboxId.startsWith('0x')) {
              resolvedPeerInboxId = inboxId;
              console.log('[XMTP] ✅ Resolved inbox ID via Utils.getInboxIdForIdentifier:', resolvedPeerInboxId);
            }
          } catch (e) {
            console.warn('[XMTP] Utils.getInboxIdForIdentifier failed:', e);
          }
        }

        // Method 4: Try with full address (with 0x) in case the SDK expects it
        if (!resolvedPeerInboxId && isEthereumAddress(peerAddressOrInboxId)) {
          try {
            const { getXmtpUtils } = await import('./utils-singleton');
            const utils = await getXmtpUtils();
            const identifierWith0x = {
              identifier: peerAddressOrInboxId.toLowerCase(),
              identifierKind: 'Ethereum' as const,
            };
            const inboxId = await utils.getInboxIdForIdentifier(identifierWith0x, 'production');
            if (inboxId && !inboxId.startsWith('0x')) {
              resolvedPeerInboxId = inboxId;
              console.log('[XMTP] ✅ Resolved inbox ID via Utils.getInboxIdForIdentifier (with 0x):', resolvedPeerInboxId);
            }
          } catch (e) {
            console.warn('[XMTP] Utils.getInboxIdForIdentifier (with 0x) failed:', e);
          }
        }
      } else {
        console.log('[XMTP] Calling client.conversations.newDm with inbox ID:', inboxIdInput);
        dmConversation = await this.client.conversations.newDm(inboxIdInput);
        resolvedPeerInboxId = inboxIdInput;
      }

      console.log('[XMTP] ✅ DM conversation created:', {
        id: dmConversation.id,
        createdAtNs: dmConversation.createdAtNs,
        resolvedPeerInboxId,
      });

      // Never use an address as the inbox ID - if we can't resolve it, log a warning
      // But we'll still use the original input as fallback for the conversation
      const peerForStore = resolvedPeerInboxId && !resolvedPeerInboxId.startsWith('0x')
        ? resolvedPeerInboxId.toLowerCase()
        : originalInput.toLowerCase();

      if (peerForStore.startsWith('0x')) {
        console.warn('[XMTP] ⚠️  Could not resolve inbox ID for address, using address as peerId:', peerForStore);
      }

      // Ensure our profile (displayName/avatar) is sent to this conversation
      // This checks message history and sends missing profile data
      if (resolvedPeerInboxId && !resolvedPeerInboxId.startsWith('0x') && dmConversation) {
        try {
          await this.ensureProfileSent(dmConversation.id, dmConversation);
        } catch (profileSendError) {
          console.warn('[XMTP] Failed to ensure profile sent to new DM (non-fatal):', profileSendError);
        }
      }

      // Fetch peer's profile immediately after resolving inbox ID to get display name and avatar
      let profileDisplayName: string | undefined;
      let profileAvatar: string | undefined;
      if (resolvedPeerInboxId && !resolvedPeerInboxId.startsWith('0x')) {
        try {
          // First, try to get profile from any existing DM with this peer
          // (fetchInboxProfile checks getDmByInboxId which might find an existing DM)
          const profile = await this.fetchInboxProfile(resolvedPeerInboxId);
          profileDisplayName = profile.displayName;
          profileAvatar = profile.avatarUrl;
          console.log('[XMTP] ✅ Fetched profile via fetchInboxProfile:', {
            inboxId: resolvedPeerInboxId,
            displayName: profileDisplayName,
            hasAvatar: !!profileAvatar,
          });

          // If we didn't get profile from existing DM, check the DM we just created
          // Also check ALL DMs to see if we have any other DMs with this peer that might have profile messages
          if ((!profileDisplayName || !profileAvatar) && this.client) {
            try {
              // Check all DMs - sometimes there might be multiple DMs with the same peer
              const allDms = await this.client.conversations.listDms();
              const myInboxId = this.client.inboxId?.toLowerCase();

              // Look through all DMs for profile messages from this peer
              for (const dm of allDms) {
                try {
                  // Get peer inbox ID from DM (might be different format)
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  const dmPeerId = (dm as any).peerInboxId?.toLowerCase() || (dm as any).peerAddress?.toLowerCase();
                  if (dmPeerId !== resolvedPeerInboxId.toLowerCase()) continue;

                  // Sync and check messages
                  await dm.sync();
                  const msgs = await dm.messages();
                  for (let i = msgs.length - 1; i >= 0; i--) {
                    const m = msgs[i];
                    // Only look at messages from the peer (not from us)
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const senderInboxId = (m as any).senderInboxId?.toLowerCase();
                    if (senderInboxId === myInboxId) continue; // Skip our own messages
                    if (senderInboxId !== resolvedPeerInboxId.toLowerCase()) continue; // Must be from the peer

                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const raw = typeof m.content === 'string' ? m.content : (m as any).encodedContent?.content;
                    if (typeof raw !== 'string') continue;
                    if (!raw.startsWith(XmtpClient.PROFILE_PREFIX)) continue;

                    try {
                      const json = raw.slice(XmtpClient.PROFILE_PREFIX.length);
                      const obj = JSON.parse(json) as { displayName?: string; avatarUrl?: string };
                      if (obj.displayName) profileDisplayName = obj.displayName;
                      if (obj.avatarUrl) profileAvatar = obj.avatarUrl;
                      console.log('[XMTP] ✅ Found profile in DM:', {
                        inboxId: resolvedPeerInboxId,
                        displayName: profileDisplayName,
                        hasAvatar: !!profileAvatar,
                        dmId: dm.id,
                      });
                      break; // Use the most recent profile message
                    } catch (e) {
                      console.warn('[XMTP] Failed to parse profile message from DM:', e);
                    }
                  }

                  // If we found profile, stop searching
                  if (profileDisplayName || profileAvatar) break;
                } catch (dmError) {
                  console.warn('[XMTP] Failed to scan DM for profile messages:', dmError);
                }
              }
            } catch (allDmsError) {
              console.warn('[XMTP] Failed to scan all DMs for profile messages (non-fatal):', allDmsError);
            }
          }
        } catch (profileError) {
          console.warn('[XMTP] Failed to fetch profile for new conversation (non-fatal):', profileError);
        }
      }

      const conversation: Conversation = {
        id: dmConversation.id,
        topic: dmConversation.id, // Use conversation ID as topic
        peerId: peerForStore, // Store canonical inbox ID when available
        displayName: profileDisplayName, // Set display name from profile if available
        displayAvatar: profileAvatar, // Set avatar from profile if available
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
      const messageId = await conversation.send(content);

      console.log('[XMTP] ✅ Message sent successfully', { conversationId, messageId });

      // Create a message object to return
      const message: XmtpMessage = {
        id: messageId,
        conversationId: conversationId,
        senderAddress: this.client?.inboxId ?? this.identity?.address ?? 'unknown',
        content,
        sentAt: Date.now(),
      };

      logNetworkEvent({
        direction: 'status',
        event: 'messages:send:success',
        details: `Message sent on ${conversationId}`,
        payload: this.formatPayload({ id: messageId }),
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

  /**
   * Fetch low-level XMTP message details by ID (best-effort).
   * Returns null if not connected or not found.
   */
  async fetchMessageDetails(messageId: string): Promise<
    | {
      id: string;
      senderInboxId?: string;
      sentAtNs?: bigint;
      deliveryStatus?: unknown;
      kind?: unknown;
      contentType?: string;
    }
    | null
  > {
    if (!this.client) {
      return null;
    }
    try {
      const raw = await this.client.conversations.getMessageById(messageId);
      if (!raw) return null;
      // raw is a wasm-bindings Message; pull safe fields
      // We cannot import types here, so we access known keys defensively.
      const anyRaw = raw as unknown as { [k: string]: unknown };
      const sentAtNs: bigint | undefined = anyRaw['sentAtNs'] as bigint | undefined;
      const senderInboxId: string | undefined = anyRaw['senderInboxId'] as string | undefined;
      const deliveryStatus = anyRaw['deliveryStatus'];
      const kind = anyRaw['kind'];
      const content = anyRaw['content'] as unknown;
      const typeObj = (content && typeof content === 'object' && (content as Record<string, unknown>)['type']) as
        | Record<string, unknown>
        | undefined;
      const contentType = (typeObj?.['typeId'] as string | undefined) ?? (typeObj?.['type_id'] as string | undefined);

      return {
        id: messageId,
        senderInboxId,
        sentAtNs,
        deliveryStatus,
        kind,
        contentType: typeof contentType === 'string' ? contentType : undefined,
      };
    } catch (e) {
      console.warn('[XMTP] fetchMessageDetails failed:', e);
      return null;
    }
  }

  /**
   * Best-effort: scan recent messages for a conversation and dispatch xmtp:reaction
   * events for any reaction content found. Does not persist anything directly;
   * listeners (Layout) will aggregate and persist reactions on target messages.
   */
  async backfillReactionsForConversation(conversationId: string, max = 300): Promise<void> {
    if (!this.client) return;
    try {
      const conv = await this.client.conversations.getConversationById(conversationId);
      if (!conv) return;
      const decoded = await conv.messages();
      const start = Math.max(0, decoded.length - max);
      for (let i = start; i < decoded.length; i++) {
        const m = decoded[i] as unknown as { [k: string]: unknown };
        const typeId = this.getContentTypeIdFromAny(m);
        const lowerType = (typeId || '').toLowerCase();
        if (!lowerType.includes('reaction')) continue;
        try {
          const content = (m as unknown as { content?: unknown }).content as
            | { content?: string; reference?: string; action?: string }
            | undefined;
          const emoji = (content?.content ?? '').toString();
          const ref = (content?.reference ?? '').toString();
          const action = (content?.action ?? 'added').toString();
          const convId = (m as unknown as { conversationId?: string }).conversationId as string | undefined;
          const sender = (m as unknown as { senderInboxId?: string }).senderInboxId as string | undefined;
          if (!convId || !ref || !emoji) continue;
          window.dispatchEvent(
            new CustomEvent('xmtp:reaction', {
              detail: {
                conversationId: convId,
                referenceMessageId: ref,
                emoji,
                action,
                senderInboxId: sender,
              },
            })
          );
        } catch (e) {
          console.warn('[XMTP] backfillReactionsForConversation parse failed', e);
        }
      }
    } catch (e) {
      console.warn('[XMTP] backfillReactionsForConversation failed', e);
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
