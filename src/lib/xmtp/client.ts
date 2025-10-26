/**
 * XMTP v3 client wrapper
 * 
 * NOTE: This is a placeholder implementation.
 * The actual @xmtp/browser-sdk v3 API may differ.
 * This provides the interface we'll use throughout the app.
 */

import { Client } from '@xmtp/browser-sdk';
import { useXmtpStore } from '@/lib/stores/xmtp-store';

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

  /**
   * Connect to XMTP network with an identity
   */
  async connect(identity: XmtpIdentity): Promise<void> {
    const { setConnectionStatus, setLastConnected, setError } = useXmtpStore.getState();
    
    try {
      setConnectionStatus('connecting');
      setError(null);
      
      this.identity = identity;

      const client = await Client.create(identity.address, {
        env: 'production',
      });

      this.client = client;

      setConnectionStatus('connected');
      setLastConnected(Date.now());

      console.log('XMTP client connected', identity.address);
    } catch (error) {
      console.error('Failed to connect XMTP client:', error);
      setConnectionStatus('error');
      setError(error instanceof Error ? error.message : 'Connection failed');
      throw new Error('XMTP connection failed');
    }
  }

  /**
   * Disconnect from XMTP network
   */
  async disconnect(): Promise<void> {
    const { setConnectionStatus } = useXmtpStore.getState();
    
    if (this.client) {
      this.client = null;
      this.identity = null;
      setConnectionStatus('disconnected');
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

    console.warn('XMTP message streaming is not implemented yet');

    return () => {
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
    return null;
  }

  /**
   * Create a new conversation with a peer
   */
  async createConversation(peerAddress: string): Promise<XmtpConversation> {
    if (!this.client) {
      throw new Error('Client not connected');
    }

    return {
      id: `conv_${Date.now()}`,
      topic: `topic_${peerAddress}`,
      peerAddress,
      createdAt: Date.now(),
    };
  }

  /**
   * Send a message to a conversation
   */
  async sendMessage(conversationId: string, content: string): Promise<XmtpMessage> {
    if (!this.client) {
      throw new Error('Client not connected');
    }

    return {
      id: `msg_${Date.now()}`,
      conversationTopic: conversationId,
      senderAddress: this.identity?.address || 'unknown',
      content,
      sentAt: Date.now(),
    };
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

