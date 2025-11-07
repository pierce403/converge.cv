/**
 * Authentication hook
 */

import { useCallback } from 'react';
import { useAuthStore, useInboxRegistryStore } from '@/lib/stores';
import { getStorage } from '@/lib/storage';
import {
  generateVaultKey,
  deriveKeyFromPassphrase,
  wrapVaultKey,
  unwrapVaultKey,
  setVaultKey,
  lockVault,
  generateSalt,
} from '@/lib/crypto';
import { getXmtpClient } from '@/lib/xmtp';
import { privateKeyToAccount } from 'viem/accounts';
import type { VaultSecrets, Identity } from '@/types';
import { useAccount, useSignMessage } from 'wagmi';
import { clearLastRoute } from '@/lib/utils/route-persistence';

export function useAuth() {
  const authStore = useAuthStore();
  const { setIdentity, setVaultSecrets, setAuthenticated, setVaultUnlocked } = authStore;
  const isE2E = import.meta?.env?.VITE_E2E_TEST === 'true';
  
  // Get wagmi account info for wallet-based identities
  const { address: walletAddress, chainId: walletChainId } = useAccount();
  const { signMessageAsync } = useSignMessage();

  const connectXmtpSafely = useCallback(
    async (
      address: string,
      privateKey?: string,
      chainId?: number,
      signMessage?: (message: string) => Promise<string>,
      options?: {
        register?: boolean;
        enableHistorySync?: boolean;
        labelOverride?: string;
        skipRegistryUpdate?: boolean;
      }
    ) => {
      try {
        if (isE2E) {
          // Skip live XMTP connection during E2E.
          const storage = await getStorage();
          const identity = await storage.getIdentityByAddress(address);
          if (identity && identity.address === address) {
            const stubInboxId = `local-${address.slice(2, 8)}-${Date.now().toString(36)}`;
            identity.inboxId = stubInboxId;
            await storage.putIdentity(identity);
            setIdentity(identity);

            if (!options?.skipRegistryUpdate) {
              const registry = useInboxRegistryStore.getState();
              const label =
                options?.labelOverride ||
                identity.displayName ||
                `${identity.address.slice(0, 6)}…${identity.address.slice(-4)}`;

              registry.upsertEntry({
                inboxId: stubInboxId,
                displayLabel: label,
                primaryDisplayIdentity: identity.displayName || identity.address,
                lastOpenedAt: Date.now(),
                hasLocalDB: true,
              });
              registry.markOpened(stubInboxId, true);
            }
          }
          return;
        }

        const xmtp = getXmtpClient();
        await xmtp.connect(
          {
            address,
            privateKey,
            chainId,
            signMessage,
            displayName: options?.labelOverride,
          },
          {
            register: options?.register !== false,
            enableHistorySync:
              options?.enableHistorySync !== undefined ? options.enableHistorySync : true,
          }
        );

        const inboxId = xmtp.getInboxId();
        const installationId = xmtp.getInstallationId();

        if (inboxId && installationId) {
          const storage = await getStorage();
          const identity = await storage.getIdentityByAddress(address);
          if (identity && identity.address === address) {
            identity.inboxId = inboxId;
            identity.installationId = installationId;
            await storage.putIdentity(identity);

            setIdentity(identity);

            if (!options?.skipRegistryUpdate) {
              const registry = useInboxRegistryStore.getState();
              const label =
                options?.labelOverride ||
                identity.displayName ||
                `${identity.address.slice(0, 6)}…${identity.address.slice(-4)}`;

              registry.upsertEntry({
                inboxId,
                displayLabel: label,
                primaryDisplayIdentity: identity.displayName || identity.address,
                lastOpenedAt: Date.now(),
                hasLocalDB: true,
              });
              registry.markOpened(inboxId, true);
            }

            console.log('[Auth] Saved XMTP info to identity:', {
              inboxId,
              installationId: installationId.substring(0, 16) + '...',
            });

            // Try to load profile (display name/avatar) from network and persist locally
            try {
              const profile = await xmtp.loadOwnProfile();
              if (profile && (profile.displayName || profile.avatarUrl)) {
                const updated = { ...identity } as Identity;
                if (profile.displayName) updated.displayName = profile.displayName;
                if (profile.avatarUrl) (updated as Identity & { avatar?: string }).avatar = profile.avatarUrl;
                await storage.putIdentity(updated);
                setIdentity(updated);
                console.log('[Auth] Applied profile from network');
              }
            } catch (e) {
              console.warn('[Auth] Failed to load profile from network (non-fatal):', e);
            }
          }
        }
      } catch (error) {
        console.warn('XMTP connection failed (non-blocking):', error);
      }
    },
    [setIdentity, isE2E]
  );

  /**
   * Create a new identity without passphrase (simplified flow)
   */
  const createIdentity = useCallback(
    async (
      walletAddress: string,
      privateKey?: string,
      chainId?: number,
      signMessage?: (message: string) => Promise<string>,
      options?: {
        register?: boolean;
        enableHistorySync?: boolean;
        label?: string;
        skipRegistryUpdate?: boolean;
        mnemonic?: string;
      }
    ) => {
      try {
        const storage = await getStorage();

        let publicKeyHex = '';
        
        // Only derive public key if we have a valid private key (generated wallets)
        // For connected wallets, we don't have the private key (wallet keeps it secure)
        if (privateKey && privateKey !== '0x0000000000000000000000000000000000000000000000000000000000000000') {
          const account = privateKeyToAccount(privateKey as `0x${string}`);
          publicKeyHex = account.publicKey;
        }
        
        // Create identity
        const identity: Identity = {
          address: walletAddress,
          publicKey: publicKeyHex,
          privateKey: privateKey, // Store encrypted in production (or undefined for connected wallets)
          createdAt: Date.now(),
          displayName: options?.label,
        };
        if (options?.mnemonic) {
          identity.mnemonic = options.mnemonic;
        }
        await storage.putIdentity(identity);

        // For now, skip vault secrets - no passphrase needed
        // In production, we'd encrypt the private key with device-based keys

        // Update state
        setIdentity(identity);
        setAuthenticated(true);
        setVaultUnlocked(true);

        // Connect XMTP with appropriate signer
        await connectXmtpSafely(
          identity.address,
          privateKey && privateKey !== '0x0000000000000000000000000000000000000000000000000000000000000000' ? privateKey : undefined,
          chainId,
          signMessage,
          {
            register: options?.register !== false,
            enableHistorySync:
              options?.enableHistorySync !== undefined ? options.enableHistorySync : true,
            labelOverride: options?.label,
            skipRegistryUpdate: options?.skipRegistryUpdate,
          }
        );

        return true;
      } catch (error) {
        console.error('Failed to create identity:', error);
        if (error instanceof Error) {
          console.error('Error message:', error.message);
          console.error('Error stack:', error.stack);
        }
        return false;
      }
    },
    [setIdentity, setAuthenticated, setVaultUnlocked, connectXmtpSafely]
  );

  /**
   * Create a new identity with passphrase protection (advanced option)
   */
  const createIdentityWithPassphrase = useCallback(
    async (passphrase: string, walletAddress: string) => {
      try {
        const storage = await getStorage();

        // Generate vault key
        const vaultKey = await generateVaultKey();

        // Derive wrapper key from passphrase
        const salt = generateSalt();
        const wrapperKey = await deriveKeyFromPassphrase(passphrase, salt, 600000);

        // Wrap the vault key
        const wrappedKey = await wrapVaultKey(vaultKey, wrapperKey);

        // Store vault secrets
        const secrets: VaultSecrets = {
          wrappedVaultKey: wrappedKey,
          method: 'passphrase',
          salt: btoa(String.fromCharCode(...salt)),
          iterations: 600000,
        };
        await storage.putVaultSecrets(secrets);

        // Note: publicKey not derivable without private key in passphrase flow
        const identity: Identity = {
          address: walletAddress,
          publicKey: '', // Will be set when private key is available
          createdAt: Date.now(),
        };
        await storage.putIdentity(identity);

        // Set vault key in memory
        setVaultKey(vaultKey);

        // Update state
        setIdentity(identity);
        setVaultSecrets(secrets);
        setAuthenticated(true);
        setVaultUnlocked(true);

        // Connect XMTP
        await connectXmtpSafely(identity.address);

        return true;
      } catch (error) {
        console.error('Failed to create identity:', error);
        return false;
      }
    },
    [setIdentity, setVaultSecrets, setAuthenticated, setVaultUnlocked, connectXmtpSafely]
  );

  /**
   * Import an existing identity with wallet
   */
  const importIdentityWithWallet = useCallback(
    async (passphrase: string, walletAddress: string) => {
      try {
        const storage = await getStorage();

        // Check if identity already exists for this address
        const existingIdentity = await storage.getIdentityByAddress(walletAddress);
        if (existingIdentity && existingIdentity.address === walletAddress) {
          console.log('Identity already exists for this address, re-importing');
        }

        // Generate vault key
        const vaultKey = await generateVaultKey();

        // Derive wrapper key from passphrase
        const salt = generateSalt();
        const wrapperKey = await deriveKeyFromPassphrase(passphrase, salt, 600000);

        // Wrap the vault key
        const wrappedKey = await wrapVaultKey(vaultKey, wrapperKey);

        // Store vault secrets
        const secrets: VaultSecrets = {
          wrappedVaultKey: wrappedKey,
          method: 'passphrase',
          salt: btoa(String.fromCharCode(...salt)),
          iterations: 600000,
        };
        await storage.putVaultSecrets(secrets);

        // Import/create identity with existing wallet
        // Note: For wallet-imported identities, we don't have the private key
        const identity: Identity = {
          address: walletAddress,
          publicKey: '', // Not available for wallet-imported identities
          createdAt: Date.now(),
        };
        await storage.putIdentity(identity);

        // Set vault key in memory
        setVaultKey(vaultKey);

        // Update state
        setIdentity(identity);
        setVaultSecrets(secrets);
        setAuthenticated(true);
        setVaultUnlocked(true);

        // Connect XMTP
        await connectXmtpSafely(identity.address);

        return true;
      } catch (error) {
        console.error('Failed to import identity:', error);
        return false;
      }
    },
    [setIdentity, setVaultSecrets, setAuthenticated, setVaultUnlocked, connectXmtpSafely]
  );

  /**
   * Create identity with passkey protection
   */
  const createIdentityWithPasskey = useCallback(
    async (_walletAddress: string) => {
      try {
        // TODO: Implement passkey creation with PRF
        // For now, fall back to passphrase
        console.warn('Passkey not yet implemented, use passphrase');
        return false;
      } catch (error) {
        console.error('Failed to create identity with passkey:', error);
        return false;
      }
    },
    []
  );

  /**
   * Unlock vault with passphrase
   */
  const unlockWithPassphrase = useCallback(
    async (passphrase: string): Promise<boolean> => {
      try {
        const storage = await getStorage();

        // Get vault secrets
        const secrets = await storage.getVaultSecrets();
        if (!secrets || secrets.method !== 'passphrase') {
          return false;
        }

        // Derive wrapper key
        const salt = Uint8Array.from(atob(secrets.salt), (c) => c.charCodeAt(0));
        const wrapperKey = await deriveKeyFromPassphrase(
          passphrase,
          salt,
          secrets.iterations || 600000
        );

        // Unwrap vault key
        const vaultKey = await unwrapVaultKey(secrets.wrappedVaultKey, wrapperKey);

        // Set in memory
        setVaultKey(vaultKey);

        // Get identity
        const identity = walletAddress ? await storage.getIdentityByAddress(walletAddress) : undefined;
        if (!identity) {
          return false;
        }

        // Update state
        setIdentity(identity);
        setVaultSecrets(secrets);
        setAuthenticated(true);
        setVaultUnlocked(true);

        // Connect XMTP
        await connectXmtpSafely(identity.address);

        return true;
      } catch (error) {
        console.error('Failed to unlock with passphrase:', error);
        return false;
      }
    },
    [setIdentity, setVaultSecrets, setAuthenticated, setVaultUnlocked, connectXmtpSafely, walletAddress]
  );

  /**
   * Unlock vault with passkey
   */
  const unlockWithPasskey = useCallback(async (): Promise<boolean> => {
    try {
      // TODO: Implement passkey unlock
      console.warn('Passkey unlock not yet implemented');
      return false;
    } catch (error) {
      console.error('Failed to unlock with passkey:', error);
      return false;
    }
  }, []);

  /**
   * Lock vault
   */
  const lock = useCallback(() => {
    lockVault();
    setVaultUnlocked(false);
  }, [setVaultUnlocked]);

  /**
   * Logout completely
   */
  const logout = useCallback(async () => {
    try {
      console.log('[Auth] Logging out - clearing all data...');
      
      // Disconnect XMTP first
      const xmtp = getXmtpClient();
      await xmtp.disconnect();

      // Clear ALL local storage (IndexedDB + XMTP OPFS)
      const storage = await getStorage();
      await storage.clearAllData();

      // Lock vault
      lockVault();

      // Clear route persistence
      clearLastRoute();

      // Clear Zustand state
      authStore.logout();

      // Reset inbox registry
      useInboxRegistryStore.getState().reset();

      console.log('[Auth] ✅ Logout complete - all data cleared');
    } catch (error) {
      console.error('[Auth] Logout error:', error);
    }
  }, [authStore]);

  /**
   * Check if user has existing identity
   */
  const checkExistingIdentity = useCallback(async (): Promise<boolean> => {
    try {
      const registry = useInboxRegistryStore.getState();
      registry.hydrate();

      // If an explicit inbox was selected just before reload, honor it
      try {
        const forced = typeof window !== 'undefined' ? window.localStorage.getItem('converge.forceInboxId.v1') : null;
        if (forced && forced.trim().length > 0) {
          registry.setCurrentInbox(forced);
          // Persist storage namespace early so the next getStorage() uses the right shard
          await (await import('@/lib/storage')).setStorageNamespace(forced);
          // Clear the one-shot hint
          window.localStorage.removeItem('converge.forceInboxId.v1');
        }
      } catch (e) {
        // non-fatal
      }

      // Ensure storage namespace is aligned with the current registry inbox before instantiating storage
      if (registry.currentInboxId) {
        try {
          await (await import('@/lib/storage')).setStorageNamespace(registry.currentInboxId);
        } catch {
          // ignore
        }
      }

      const storage = await getStorage();

      const identities = await storage.listIdentities();
      if (!identities.length) {
        return false;
      }

      let identity: Identity | undefined;
      if (registry.currentInboxId) {
        identity = identities.find((item) => item.inboxId === registry.currentInboxId);
      }

      if (!identity) {
        // Fallback: pick the most recently opened from the registry list
        const currentId = registry.currentInboxId;
        if (currentId) {
          identity = identities.find((it) => it.inboxId === currentId) || identities[0];
        } else {
          identity = identities[0];
        }
      }

      if (!identity) {
        return false;
      }

      const secrets = await storage.getVaultSecrets();

      setIdentity(identity);
      setVaultSecrets(secrets ?? null);
      setAuthenticated(true);
      setVaultUnlocked(true);

      const registryEntry = identity.inboxId
        ? registry.entries.find((entry) => entry.inboxId === identity!.inboxId)
        : undefined;
      const shouldSyncHistory = registryEntry ? !registryEntry.hasLocalDB : true;

      if (identity.privateKey) {
        await connectXmtpSafely(identity.address, identity.privateKey, undefined, undefined, {
          register: true,
          enableHistorySync: shouldSyncHistory,
          labelOverride: identity.displayName,
        });
      } else if (walletAddress && walletAddress.toLowerCase() === identity.address.toLowerCase()) {
        console.log('[Auth] Reconnecting wallet-based identity with wagmi signer');
        const signMessage = async (message: string) => {
          return await signMessageAsync({ message });
        };
        await connectXmtpSafely(identity.address, undefined, walletChainId, signMessage, {
          register: true,
          enableHistorySync: shouldSyncHistory,
          labelOverride: identity.displayName,
        });
      } else {
        console.log('[Auth] Wallet-based identity found but wallet not connected - skipping XMTP connection');
      }

      if (identity.inboxId) {
        registry.markOpened(identity.inboxId, registryEntry?.hasLocalDB ?? true);
      }

      return true;
    } catch (error) {
      console.error('Failed to check existing identity:', error);
      return false;
    }
  }, [setIdentity, setVaultSecrets, setAuthenticated, setVaultUnlocked, connectXmtpSafely, walletAddress, walletChainId, signMessageAsync]);

  const probeIdentity = useCallback(
    async (
      walletAddress: string,
      privateKey?: string,
      chainId?: number,
      signMessage?: (message: string) => Promise<string>
    ) => {
      const xmtp = getXmtpClient();
      return await xmtp.probeIdentity({
        address: walletAddress,
        privateKey,
        chainId,
        signMessage,
      });
    },
    []
  );

  return {
    ...authStore,
    createIdentity,
    createIdentityWithPassphrase,
    importIdentityWithWallet,
    createIdentityWithPasskey,
    unlockWithPassphrase,
    unlockWithPasskey,
    lock,
    logout,
    checkExistingIdentity,
    probeIdentity,
  };
}
