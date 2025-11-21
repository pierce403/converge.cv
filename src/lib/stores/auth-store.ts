/**
 * Authentication state store
 */

import { create } from 'zustand';
import type { Identity, VaultSecrets } from '@/types';

interface AuthState {
  // State
  isAuthenticated: boolean;
  isVaultUnlocked: boolean;
  identity: Identity | null;
  vaultSecrets: VaultSecrets | null;

  // Actions
  setAuthenticated: (authenticated: boolean) => void;
  setVaultUnlocked: (unlocked: boolean) => void;
  setIdentity: (identity: Identity | null) => void;
  setVaultSecrets: (secrets: VaultSecrets | null) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  // Initial state
  isAuthenticated: false,
  isVaultUnlocked: false,
  identity: null,
  vaultSecrets: null,

  // Actions
  setAuthenticated: (authenticated) => set({ isAuthenticated: authenticated }),
  setVaultUnlocked: (unlocked) => set({ isVaultUnlocked: unlocked }),
  setIdentity: (identity) => set({ identity }),
  setVaultSecrets: (secrets) => set({ vaultSecrets: secrets }),
  logout: () =>
    set({
      isAuthenticated: false,
      isVaultUnlocked: false,
      identity: null,
      vaultSecrets: null,
    }),
}));
