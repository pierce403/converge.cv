import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export interface FarcasterFilterSettings {
  enabled: boolean;
  minScore?: number | null;
  minFollowerCount?: number | null;
  minFollowingCount?: number | null;
  requireActiveStatus?: boolean;
  requirePowerBadge?: boolean;
  requireFarcasterIdentity?: boolean;
}

interface FarcasterState {
  userNeynarApiKey?: string;
  defaultNeynarApiKey?: string;
  filters: FarcasterFilterSettings;
  setUserNeynarApiKey: (key?: string) => void;
  clearUserNeynarApiKey: () => void;
  setFilters: (updates: Partial<FarcasterFilterSettings>) => void;
  getEffectiveNeynarApiKey: () => string | undefined;
  hasNeynarApiKey: () => boolean;
}

const defaultFilters: FarcasterFilterSettings = {
  enabled: false,
  minScore: null,
  minFollowerCount: null,
  minFollowingCount: null,
  requireActiveStatus: false,
  requirePowerBadge: false,
  requireFarcasterIdentity: false,
};

const resolveDefaultNeynarKey = (): string | undefined => {
  const metaKey = typeof import.meta !== 'undefined' ? import.meta.env?.VITE_NEYNAR_API_KEY : undefined;
  if (metaKey) return metaKey;
  if (typeof process !== 'undefined') {
    const envKey = (process.env as Record<string, string | undefined>)?.VITE_NEYNAR_API_KEY;
    if (envKey) return envKey;
  }
  // Fallback to the Converge client key (provided by the user; not a secret)
  return 'e6927a99-c548-421f-a230-ee8bf11e8c48';
};

export const useFarcasterStore = create<FarcasterState>()(
  persist(
    (set, get) => ({
      userNeynarApiKey: undefined,
      defaultNeynarApiKey: resolveDefaultNeynarKey(),
      filters: defaultFilters,
      setUserNeynarApiKey: (key) => set({ userNeynarApiKey: key?.trim() || undefined }),
      clearUserNeynarApiKey: () => set({ userNeynarApiKey: undefined }),
      setFilters: (updates) => set((state) => ({ filters: { ...state.filters, ...updates } })),
      getEffectiveNeynarApiKey: () => get().userNeynarApiKey || get().defaultNeynarApiKey,
      hasNeynarApiKey: () => Boolean(get().userNeynarApiKey || get().defaultNeynarApiKey),
    }),
    {
      name: 'converge-farcaster-settings',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        userNeynarApiKey: state.userNeynarApiKey,
        filters: state.filters,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.defaultNeynarApiKey = resolveDefaultNeynarKey();
        }
      },
    }
  )
);

export { defaultFilters as defaultFarcasterFilters };
