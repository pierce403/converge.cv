/**
 * XMTP connection state store
 */

import { create } from 'zustand';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';
export type SyncStatus = 'idle' | 'syncing-conversations' | 'syncing-messages' | 'complete';

interface XmtpState {
  // State
  connectionStatus: ConnectionStatus;
  lastConnected: number | null;
  error: string | null;
  syncStatus: SyncStatus;
  syncProgress: number; // 0-100

  // Actions
  setConnectionStatus: (status: ConnectionStatus) => void;
  setLastConnected: (timestamp: number) => void;
  setError: (error: string | null) => void;
  setSyncStatus: (status: SyncStatus) => void;
  setSyncProgress: (progress: number) => void;
}

export const useXmtpStore = create<XmtpState>((set) => ({
  // Initial state
  connectionStatus: 'disconnected',
  lastConnected: null,
  error: null,
  syncStatus: 'idle',
  syncProgress: 0,

  // Actions
  setConnectionStatus: (status) => set({ connectionStatus: status }),
  setLastConnected: (timestamp) => set({ lastConnected: timestamp }),
  setError: (error) => set({ error }),
  setSyncStatus: (status) => set({ syncStatus: status }),
  setSyncProgress: (progress) => set({ syncProgress: progress }),
}));

