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
        return {
          identifier: address.toLowerCase(),
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

      // Intercept Worker constructor to catch errors
      const OriginalWorker = Worker;
      let workerErrorCaught = false;
      
      const WorkerWrapper = function(scriptURL: string | URL, options?: WorkerOptions) {
        const urlString = scriptURL instanceof URL ? scriptURL.href : String(scriptURL);
        console.log('[XMTP] Worker being created with URL:', urlString);
        console.log('[XMTP] Worker options:', options);
        
        try {
          const worker = new OriginalWorker(scriptURL, options);
          
          worker.addEventListener('error', (event) => {
            console.error('[XMTP] ❌ Worker error event:', {
              message: event.message,
              filename: event.filename,
              lineno: event.lineno,
              colno: event.colno,
              error: event.error,
              type: event.type,
            });
            console.error('[XMTP] ❌ Worker script URL was:', urlString);
            console.error('[XMTP] ❌ This usually means the worker script has a JavaScript error or failed to load');
            workerErrorCaught = true;
          });
          
          worker.addEventListener('messageerror', (event) => {
            console.error('[XMTP] ❌ Worker message error:', event);
            console.error('[XMTP] ❌ Worker script URL was:', urlString);
            workerErrorCaught = true;
          });
          
          worker.addEventListener('message', (event) => {
            console.log('[XMTP] ✅ Worker message received:', event.data);
          });
          
          console.log('[XMTP] ✅ Worker object created successfully');
          return worker;
        } catch (err) {
          console.error('[XMTP] ❌ Failed to create worker:', err);
          console.error('[XMTP] ❌ Script URL was:', urlString);
          throw err;
        }
      } as unknown as typeof Worker;
      
      WorkerWrapper.prototype = OriginalWorker.prototype;
      
      // Temporarily replace Worker
      const originalWorkerConstructor = globalThis.Worker;
      (globalThis as typeof globalThis & { Worker: typeof Worker }).Worker = WorkerWrapper;

      try {
        // Create a signer if we have a private key
        if (!identity.privateKey) {
          throw new Error('Private key required for XMTP client creation');
        }

        console.log('[XMTP] Creating signer for address:', identity.address);
        const signer = this.createSigner(identity.address, identity.privateKey);

        // Add timeout to detect hanging
        console.log('[XMTP] Calling Client.create() with signer...');
        console.log('[XMTP] Using production environment');
        
        const clientPromise = Client.create(signer, {
          env: 'production',
          loggingLevel: 'debug', // Enable SDK logging
        }).then(async (client) => {
          console.log('[XMTP] ✅ Client.create() promise resolved!');
          return client;
        }).catch(error => {
          console.error('[XMTP] ❌ Client.create() promise rejected:', error);
          if (workerErrorCaught) {
            console.error('[XMTP] ❌ Worker errors were detected during client creation');
          }
          throw error;
        });

        const timeoutPromise = new Promise<never>((_, reject) => {
          const intervalId = setInterval(() => {
            console.log('[XMTP] ⏳ Still waiting for Client.create()... (checking every 5s)');
            if (workerErrorCaught) {
              console.warn('[XMTP] ⚠️  Worker error detected but Client.create() still pending');
            }
          }, 5000);
          
          setTimeout(() => {
            clearInterval(intervalId);
            console.error('[XMTP] ❌ Client.create() timeout reached!');
            if (workerErrorCaught) {
              console.error('[XMTP] ❌ Worker errors occurred before timeout');
            }
            reject(new Error('Client.create() timed out after 30 seconds' + 
              (workerErrorCaught ? ' (worker errors detected)' : '')));
          }, 30000);
        });

        console.log('[XMTP] Waiting for Client.create() to complete...');
        const client = await Promise.race([clientPromise, timeoutPromise]);

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
      } finally {
        // Restore original Worker constructor
        (globalThis as typeof globalThis & { Worker: typeof Worker }).Worker = originalWorkerConstructor;
      }
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
   * Create a new conversation with a peer
   */
  async createConversation(peerAddress: string): Promise<XmtpConversation> {
    if (!this.client) {
      throw new Error('Client not connected');
    }

    logNetworkEvent({
      direction: 'outbound',
      event: 'conversations:create',
      details: `Creating conversation with ${peerAddress}`,
    });

    const conversation: XmtpConversation = {
      id: `conv_${Date.now()}`,
      topic: `topic_${peerAddress}`,
      peerAddress,
      createdAt: Date.now(),
    };

    logNetworkEvent({
      direction: 'status',
      event: 'conversations:create:local',
      details: `Conversation ${conversation.id} created locally (stub)`,
      payload: this.formatPayload(conversation),
    });

    return conversation;
  }

  /**
   * Send a message to a conversation
   */
  async sendMessage(conversationId: string, content: string): Promise<XmtpMessage> {
    if (!this.client) {
      throw new Error('Client not connected');
    }

    logNetworkEvent({
      direction: 'outbound',
      event: 'messages:send',
      details: `Sending message on ${conversationId}`,
      payload: this.formatPayload(content),
    });

    const message: XmtpMessage = {
      id: `msg_${Date.now()}`,
      conversationTopic: conversationId,
      senderAddress: this.identity?.address || 'unknown',
      content,
      sentAt: Date.now(),
    };

    logNetworkEvent({
      direction: 'status',
      event: 'messages:send:queued',
      details: `Message ${message.id} queued for delivery`,
      payload: this.formatPayload(message),
    });

    return message;
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
   * Check if an address can receive XMTP messages
   */
  async canMessage(address: string): Promise<boolean> {
    if (!this.client) {
      throw new Error('Client not connected');
    }

    console.warn('XMTP canMessage fallback for', address);
    logNetworkEvent({
      direction: 'outbound',
      event: 'canMessage',
      details: `Checking if ${address} can receive XMTP messages`,
    });

    logNetworkEvent({
      direction: 'status',
      event: 'canMessage:result',
      details: `Assuming ${address} is XMTP enabled (stub implementation)`,
    });
    return true;
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

