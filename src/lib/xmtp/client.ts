/**
 * XMTP v3 client wrapper
 * 
 * NOTE: This is a placeholder implementation.
 * The actual @xmtp/browser-sdk v3 API may differ.
 * This provides the interface we'll use throughout the app.
 */

import { Client, type Signer } from '@xmtp/browser-sdk';
import { privateKeyToAccount } from 'viem/accounts';
import { logNetworkEvent } from '@/lib/stores';
import { useXmtpStore } from '@/lib/stores/xmtp-store';
import buildInfo from '@/build-info.json';

export interface XmtpIdentity {
  address: string;
  privateKey?: string;
}

export interface XmtpConversation {
  id: string;
  topic: string;
  peerAddress: string;
  createdAt: number;
}

export interface XmtpMessage {
  id: string;
  conversationTopic: string;
  senderAddress: string;
  content: string | Uint8Array;
  sentAt: number;
}

export type MessageCallback = (message: XmtpMessage) => void;
export type Unsubscribe = () => void;

/**
 * XMTP Client wrapper for v3 SDK
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

  /**
   * Create an XMTP Signer from an Ethereum private key (v3 format)
   */
  private createSigner(address: string, privateKeyHex: string): Signer {
    const account = privateKeyToAccount(privateKeyHex as `0x${string}`);
    
    return {
      type: 'EOA', // Externally Owned Account
      getIdentifier: async () => {
        // v3 uses: { identifier: "0x...", identifierKind: "Ethereum" }
        // Must be async to match v3 SDK expectations
        // NOTE: Do NOT lowercase - use address as-is like cthulhu.bot
        return {
          identifier: address,
          identifierKind: 'Ethereum',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any; // Identifier type from WASM bindings
      },
      signMessage: async (message: string) => {
        const signature = await account.signMessage({ message });
        // Convert hex signature to Uint8Array
        return new Uint8Array(
          signature.replace('0x', '').match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16))
        );
      },
    };
  }

  /**
   * Connect to XMTP network with an identity
   */
  async connect(identity: XmtpIdentity): Promise<void> {
    const { setConnectionStatus, setLastConnected, setError } = useXmtpStore.getState();

    logNetworkEvent({
      direction: 'outbound',
      event: 'connect',
      details: `Connecting as ${identity.address}`,
    });

    this.identity = identity;

    const globalScope: typeof globalThis | undefined =
      typeof globalThis !== 'undefined' ? globalThis : undefined;
    const hasSharedArrayBuffer =
      !!globalScope &&
      typeof globalScope.SharedArrayBuffer !== 'undefined' &&
      globalScope.SharedArrayBuffer !== null;
    const isCrossOriginIsolated =
      !!globalScope && typeof globalScope.crossOriginIsolated === 'boolean'
        ? globalScope.crossOriginIsolated
        : false;

    if (!hasSharedArrayBuffer || !isCrossOriginIsolated) {
      const message =
        'XMTP WebAssembly bindings require SharedArrayBuffer and cross-origin isolation, which are unavailable in this environment.';
      console.warn('Skipping XMTP connection:', message);
      setConnectionStatus('error');
      setError(message);
      logNetworkEvent({
        direction: 'status',
        event: 'connect:unsupported',
        details: message,
      });
      return;
    }

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
      console.log('[XMTP] Cross-origin isolated:', isCrossOriginIsolated);
      console.log('[XMTP] SharedArrayBuffer available:', hasSharedArrayBuffer);
      console.log('[XMTP] WebAssembly available:', typeof WebAssembly !== 'undefined');
      console.log('[XMTP] SDK version: @xmtp/browser-sdk@3.0.5');
      console.log('[XMTP] User Agent:', navigator.userAgent);

      // Create a signer if we have a private key
      if (!identity.privateKey) {
        throw new Error('Private key required for XMTP client creation');
      }

      console.log('[XMTP] Creating signer for address:', identity.address);
      const signer = this.createSigner(identity.address, identity.privateKey);

        // Add timeout to detect hanging
      console.log('[XMTP] Calling Client.create() with signer...');
      console.log('[XMTP] Client.create options:', {
        env: 'production',
        loggingLevel: 'debug',
        structuredLogging: false,
        performanceLogging: false,
      });
      
      const client = await Client.create(signer, {
        env: 'production',
        loggingLevel: 'debug',
        structuredLogging: false,
        performanceLogging: false,
      });

      console.log('[XMTP] ✅ Client created successfully');
      console.log('[XMTP] Client properties:', {
        inboxId: client.inboxId,
        installationId: client.installationId,
        isReady: client.isReady,
      });
      this.client = client;

      // Step 2: Check if already registered (v3 auto-registers during Client.create)
      console.log('[XMTP] Checking if identity is registered...');
      try {
        const isRegistered = await client.isRegistered();
        console.log('[XMTP] isRegistered:', isRegistered);
        logNetworkEvent({
          direction: 'status',
          event: 'connect:registration_check',
          details: `Identity registered: ${isRegistered}, inbox ID: ${client.inboxId}`,
        });
      } catch (e) {
        console.log('[XMTP] isRegistered() check failed:', e);
        // Non-fatal - continue anyway
      }

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
      await this.syncConversations();
      await this.startMessageStream();
    } catch (error) {
      console.error('[XMTP] Connection failed:', error);
      console.error('[XMTP] Error type:', typeof error);
      console.error('[XMTP] Error constructor:', error?.constructor?.name);
      
      // Log full error details
      if (error instanceof Error) {
        console.error('[XMTP] Error message:', error.message);
        console.error('[XMTP] Error stack:', error.stack);
      } else {
        console.error('[XMTP] Error value:', error);
      }
      
      const errorMessage = error instanceof Error ? error.message : String(error);
      setConnectionStatus('error');
      setError(errorMessage);
      
      logNetworkEvent({
        direction: 'status',
        event: 'connect:error',
        details: errorMessage,
      });
      
      throw error; // Re-throw the original error
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

      this.client = null;
      this.identity = null;
      setConnectionStatus('disconnected');

      logNetworkEvent({
        direction: 'status',
        event: 'disconnect:success',
        details: 'XMTP client disconnected',
      });
      console.log('XMTP client disconnected');
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
                  conversationTopic: message.conversationId,
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
  async listConversations(): Promise<XmtpConversation[]> {
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
  async getConversation(peerAddress: string): Promise<XmtpConversation | null> {
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
   * Create a new conversation with a peer (by inbox ID)
   */
  async createConversation(peerInboxId: string): Promise<XmtpConversation> {
    if (!this.client) {
      throw new Error('Client not connected');
    }

    console.log('[XMTP] Creating conversation with inbox ID:', peerInboxId);

    logNetworkEvent({
      direction: 'outbound',
      event: 'conversations:create',
      details: `Creating conversation with ${peerInboxId}`,
    });

    try {
      // Create a new DM conversation using the inbox ID
      const dmConversation = await this.client.conversations.newDm(peerInboxId);
      
      console.log('[XMTP] ✅ DM conversation created:', {
        id: dmConversation.id,
        createdAtNs: dmConversation.createdAtNs,
      });

      const conversation: XmtpConversation = {
        id: dmConversation.id,
        topic: dmConversation.id, // Use conversation ID as topic
        peerAddress: peerInboxId,
        createdAt: dmConversation.createdAtNs ? Number(dmConversation.createdAtNs / 1000000n) : Date.now(),
      };

      logNetworkEvent({
        direction: 'status',
        event: 'conversations:create:success',
        details: `Conversation ${conversation.id} created`,
        payload: this.formatPayload(conversation),
      });

      return conversation;
    } catch (error) {
      console.error('[XMTP] Failed to create conversation:', error);
      logNetworkEvent({
        direction: 'status',
        event: 'conversations:create:error',
        details: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Send a message to a conversation
   */
  async sendMessage(conversationId: string, content: string): Promise<XmtpMessage> {
    if (!this.client) {
      throw new Error('Client not connected');
    }

    console.log('[XMTP] Sending message to conversation:', conversationId);

    logNetworkEvent({
      direction: 'outbound',
      event: 'messages:send',
      details: `Sending message on ${conversationId}`,
      payload: this.formatPayload(content),
    });

    try {
      // Sync conversations to ensure we have the latest
      await this.client.conversations.sync();
      
      // Find the conversation by ID
      const conversations = await this.client.conversations.list();
      const conversation = conversations.find((c) => c.id === conversationId);
      
      if (!conversation) {
        throw new Error(`Conversation ${conversationId} not found`);
      }

      console.log('[XMTP] Found conversation, sending message...');
      
      // Send the message
      await conversation.send(content);
      
      console.log('[XMTP] ✅ Message sent successfully');

      // Create a message object to return
      const message: XmtpMessage = {
        id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        conversationTopic: conversationId,
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
      console.error('[XMTP] Failed to send message:', error);
      logNetworkEvent({
        direction: 'status',
        event: 'messages:send:error',
        details: error instanceof Error ? error.message : String(error),
      });
      throw error;
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
   * Check if an inbox ID can receive XMTP messages
   */
  async canMessage(inboxId: string): Promise<boolean> {
    if (!this.client) {
      throw new Error('Client not connected');
    }

    console.log('[XMTP] Checking if inbox ID can receive messages:', inboxId);
    
    logNetworkEvent({
      direction: 'outbound',
      event: 'canMessage',
      details: `Checking if ${inboxId} can receive XMTP messages`,
    });

    try {
      // In XMTP v3, canMessage expects an array of Identifier objects
      const identifier = {
        identifier: inboxId.toLowerCase(),
        identifierKind: 'Ethereum' as const,
      };
      
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const canMsgMap = await this.client.canMessage([identifier as any]);
      const result = canMsgMap.get(inboxId.toLowerCase()) || false;
      
      console.log(`[XMTP] canMessage result for ${inboxId}:`, result);
      
      logNetworkEvent({
        direction: 'status',
        event: 'canMessage:result',
        details: `${inboxId} ${result ? 'can' : 'cannot'} receive messages`,
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

export function resetXmtpClient(): void {
  if (xmtpClientInstance) {
    xmtpClientInstance.disconnect();
    xmtpClientInstance = null;
  }
}

