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
import type { VaultSecrets, Identity } from '@/types';

export function useAuth() {
  const authStore = useAuthStore();

  /**
   * Create a new identity with passphrase protection
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

        // Create identity
        // TODO: Generate actual XMTP identity from wallet
        const identity: Identity = {
          address: walletAddress,
          publicKey: 'mock_public_key',
          createdAt: Date.now(),
        };
        await storage.putIdentity(identity);

        // Set vault key in memory
        setVaultKey(vaultKey);

        // Update state
        authStore.setIdentity(identity);
        authStore.setVaultSecrets(secrets);
        authStore.setAuthenticated(true);
        authStore.setVaultUnlocked(true);

        // Connect XMTP
        const xmtp = getXmtpClient();
        await xmtp.connect({ address: identity.address });

        return true;
      } catch (error) {
        console.error('Failed to create identity:', error);
        return false;
      }
    },
    [authStore]
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
        authStore.setIdentity(identity);
        authStore.setVaultSecrets(secrets);
        authStore.setAuthenticated(true);
        authStore.setVaultUnlocked(true);

        // Connect XMTP
        const xmtp = getXmtpClient();
        await xmtp.connect({ address: identity.address });

        return true;
      } catch (error) {
        console.error('Failed to unlock with passphrase:', error);
        return false;
      }
    },
    [authStore]
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
  }, [authStore]);

  /**
   * Lock vault
   */
  const lock = useCallback(() => {
    lockVault();
    authStore.setVaultUnlocked(false);
  }, [authStore]);

  /**
   * Logout completely
   */
  const logout = useCallback(async () => {
    try {
      // Disconnect XMTP
      const xmtp = getXmtpClient();
      await xmtp.disconnect();

      // Lock vault
      lockVault();

      // Clear state
      authStore.logout();
    } catch (error) {
      console.error('Logout error:', error);
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

      if (identity && secrets) {
        authStore.setIdentity(identity);
        authStore.setVaultSecrets(secrets);
        authStore.setAuthenticated(true);
        return true;
      }

      return false;
    } catch (error) {
      console.error('Failed to check existing identity:', error);
      return false;
    }
  }, [authStore]);

  return {
    ...authStore,
    createIdentityWithPassphrase,
    createIdentityWithPasskey,
    unlockWithPassphrase,
    unlockWithPasskey,
    lock,
    logout,
    checkExistingIdentity,
  };
}

