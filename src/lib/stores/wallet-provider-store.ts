import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { WalletProvider } from '@/lib/wallets/providers';
import { DEFAULT_WALLET_PROVIDER } from '@/lib/wallets/providers';

interface WalletProviderState {
  provider: WalletProvider;
  setProvider: (provider: WalletProvider) => void;
}

export const useWalletProviderStore = create<WalletProviderState>()(
  persist(
    (set) => ({
      provider: DEFAULT_WALLET_PROVIDER,
      setProvider: (provider) => set({ provider }),
    }),
    {
      name: 'converge-wallet-provider',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ provider: state.provider }),
    }
  )
);
