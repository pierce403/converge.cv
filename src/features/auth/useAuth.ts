/**
 * Authentication hook
 */

import { useCallback } from 'react';
import { useAuthStore } from '@/lib/stores';
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

export function useAuth() {
  const authStore = useAuthStore();
  const { setIdentity, setVaultSecrets, setAuthenticated, setVaultUnlocked } = authStore;
  
  // Get wagmi account info for wallet-based identities
  const { address: walletAddress, chainId: walletChainId } = useAccount();
  const { signMessageAsync } = useSignMessage();

  const connectXmtpSafely = useCallback(
    async (
      address: string,
      privateKey?: string,
      chainId?: number,
      signMessage?: (message: string) => Promise<string>
    ) => {
      try {
        const xmtp = getXmtpClient();
        await xmtp.connect({
          address,
          privateKey,
          chainId,
          signMessage,
        });
        
        // After successful connection, save inboxId and installationId to identity
        const inboxId = xmtp.getInboxId();
        const installationId = xmtp.getInstallationId();
        
        if (inboxId && installationId) {
          const storage = await getStorage();
          const identity = await storage.getIdentity();
          if (identity && identity.address === address) {
            // Update identity with XMTP info
            identity.inboxId = inboxId;
            identity.installationId = installationId;
            await storage.putIdentity(identity);
            
            // Update state
            setIdentity(identity);
            
            console.log('[Auth] Saved XMTP info to identity:', {
              inboxId,
              installationId: installationId.substring(0, 16) + '...',
            });
          }
        }
      } catch (error) {
        console.error('XMTP connection failed (non-blocking):', error);
      }
    },
    [setIdentity]
  );

  /**
   * Create a new identity without passphrase (simplified flow)
   */
  const createIdentity = useCallback(
    async (
      walletAddress: string,
      privateKey?: string,
      chainId?: number,
      signMessage?: (message: string) => Promise<string>
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
        };
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
          signMessage
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
        const existingIdentity = await storage.getIdentity();
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
        const identity = await storage.getIdentity();
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
    [setIdentity, setVaultSecrets, setAuthenticated, setVaultUnlocked, connectXmtpSafely]
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

      // Clear Zustand state
      authStore.logout();
      
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
      const storage = await getStorage();
      const identity = await storage.getIdentity();
      const secrets = await storage.getVaultSecrets();

      if (!identity) {
        return false;
      }

      setIdentity(identity);
      setVaultSecrets(secrets ?? null);
      setAuthenticated(true);
      // Keep vault unlocked by default - user can manually lock from settings
      setVaultUnlocked(true);

      // Reconnect to XMTP
      if (identity.privateKey) {
        // Generated wallet - has private key
        await connectXmtpSafely(identity.address, identity.privateKey);
      } else if (walletAddress && walletAddress.toLowerCase() === identity.address.toLowerCase()) {
        // Wallet-based identity and wallet is connected - get signMessage from wagmi
        console.log('[Auth] Reconnecting wallet-based identity with wagmi signer');
        const signMessage = async (message: string) => {
          return await signMessageAsync({ message });
        };
        await connectXmtpSafely(identity.address, undefined, walletChainId, signMessage);
      } else {
        // Wallet-based identity but wallet not connected
        console.log('[Auth] Wallet-based identity found but wallet not connected - skipping XMTP connection');
        // Don't throw - just skip XMTP connection. User can reconnect wallet from settings.
      }

      return true;
    } catch (error) {
      console.error('Failed to check existing identity:', error);
      return false;
    }
  }, [setIdentity, setVaultSecrets, setAuthenticated, setVaultUnlocked, connectXmtpSafely, walletAddress, walletChainId, signMessageAsync]);

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
  };
}

