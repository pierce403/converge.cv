/**
 * XMTP connection state store
 */

import { create } from 'zustand';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

interface XmtpState {
  // State
  connectionStatus: ConnectionStatus;
  lastConnected: number | null;
  error: string | null;

  // Actions
  setConnectionStatus: (status: ConnectionStatus) => void;
  setLastConnected: (timestamp: number) => void;
  setError: (error: string | null) => void;
}

export const useXmtpStore = create<XmtpState>((set) => ({
  // Initial state
  connectionStatus: 'disconnected',
  lastConnected: null,
  error: null,

  // Actions
  setConnectionStatus: (status) => set({ connectionStatus: status }),
  setLastConnected: (timestamp) => set({ lastConnected: timestamp }),
  setError: (error) => set({ error }),
}));

