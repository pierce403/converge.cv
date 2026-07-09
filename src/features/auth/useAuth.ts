/**
 * Authentication hook
 */

import { useCallback } from 'react';
import { useAuthStore, useInboxRegistryStore } from '@/lib/stores';
import { closeStorage, getStorage, getStorageNamespace, setStorageNamespace } from '@/lib/storage';
import { ensureInboxStorageNamespace } from '@/lib/storage/namespacing';
import { useXmtpStore } from '@/lib/stores/xmtp-store';
import { lockVault } from '@/lib/crypto';
import { getXmtpClient } from '@/lib/xmtp';
import type { ConnectResult } from '@/lib/xmtp/client';
import {
  registrationPolicyForStoredIdentity,
  type ClientRegistrationPolicy,
} from '@/lib/xmtp/registration-policy';
import { privateKeyToAccount } from 'viem/accounts';
import type { Identity } from '@/types';
import { useWalletConnection } from '@/lib/wagmi';
import { clearLastRoute } from '@/lib/utils/route-persistence';
import { inboxIdsMatch, normalizeInboxId } from '@/lib/utils/inbox';
import { generateLocalAppIdentity } from '@/lib/identity/local-app-key';
import {
  extractWrongChainIdDetails,
  isLegacyScwChainZeroMismatch,
  legacyScwChainZeroRecoveryMessage,
} from '@/lib/xmtp/installation-recovery';
import {
  completeProvisioning,
  getScwRetryChainId,
  recordInstallationReady,
  StaleInstallationError,
} from '@/lib/xmtp/device-provisioning';

export function useAuth() {
  const authStore = useAuthStore();
  const { setIdentity, setVaultSecrets, setAuthenticated, setVaultUnlocked } = authStore;
  const isE2E = import.meta?.env?.VITE_E2E_TEST === 'true';
  const { address: walletAddress, chainId: walletChainId, signMessage: walletSignMessage } = useWalletConnection();

  const connectXmtpSafely = useCallback(
    async (
      address: string,
      privateKey?: string,
      chainId?: number,
      signMessage?: (message: string) => Promise<string>,
      options?: {
        register?: boolean;
        registrationPolicy?: ClientRegistrationPolicy;
        enableHistorySync?: boolean;
        labelOverride?: string;
        skipRegistryUpdate?: boolean;
        required?: boolean;
        expectedInboxId?: string;
        expectedInstallationId?: string;
        requestHistorySync?: boolean;
        walletType?: 'EOA' | 'SCW';
      }
    ): Promise<ConnectResult | null> => {
      try {
        if (isE2E) {
          // Skip live XMTP connection during E2E.
          const storage = await getStorage();
          const identity = await storage.getIdentityByAddress(address);
          if (identity && identity.address === address) {
            const stubInboxId = identity.inboxId || `local-${address.slice(2, 10)}`;
            const stubInstallationId =
              identity.installationId || `local-installation-${address.slice(2, 10)}`;
            identity.inboxId = stubInboxId;
            identity.installationId = stubInstallationId;
            identity.provisioningPending = false;
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

            await ensureInboxStorageNamespace(stubInboxId, identity);
            return {
              inboxId: stubInboxId,
              installationId: stubInstallationId,
              installationRegistered: true,
              historySyncRequested: false,
              historySyncRequired: false,
            };
          }
          return null;
        }

      const xmtp = getXmtpClient();
      const shouldSyncHistory =
        options?.enableHistorySync !== undefined ? options.enableHistorySync : false;

      // Pull the persisted identity so the XMTP client can throttle redundant syncs across reloads.
      let lastSyncedAt: number | undefined;
      let storedIdentity: Identity | undefined;
      try {
        const storage = await getStorage();
        storedIdentity = await storage.getIdentityByAddress(address);
        if (storedIdentity && typeof storedIdentity.lastSyncedAt === 'number') {
          lastSyncedAt = storedIdentity.lastSyncedAt;
        }
      } catch {
        // ignore
      }

      if (options?.requestHistorySync && storedIdentity && !storedIdentity.needsHistorySync) {
        storedIdentity.needsHistorySync = true;
        const storage = await getStorage();
        await storage.putIdentity(storedIdentity);
        setIdentity(storedIdentity);
      }

      const result = await xmtp.connect(
        {
          address,
          privateKey,
          chainId,
          walletType: options?.walletType ?? storedIdentity?.walletType,
          signMessage,
          displayName: options?.labelOverride,
          lastSyncedAt,
          inboxId: storedIdentity?.inboxId,
          installationId: storedIdentity?.installationId,
          xmtpDbPathMode: storedIdentity?.xmtpDbPathMode,
        },
        {
          registrationPolicy:
            options?.registrationPolicy ??
            (options?.register === true ? 'new-inbox' : 'resume-only'),
          enableHistorySync: shouldSyncHistory,
          expectedInboxId: options?.expectedInboxId,
          expectedInstallationId: options?.expectedInstallationId,
          requestHistorySync: options?.requestHistorySync,
          onInstallationReady: async (ready) => {
            const storage = await getStorage();
            const identity = await storage.getIdentityByAddress(address);
            if (!identity) {
              return;
            }
            const updated = recordInstallationReady(identity, ready);
            await storage.putIdentity(updated);
            setIdentity(updated);
            await ensureInboxStorageNamespace(updated.inboxId, updated);
          },
        }
      );

        const inboxIdRaw = xmtp.getInboxId();
        const inboxId = normalizeInboxId(inboxIdRaw);
        const installationId = xmtp.getInstallationId();

        if (inboxId && installationId) {
          const storage = await getStorage();
          const identity = await storage.getIdentityByAddress(address);
          if (identity && identity.address === address) {
            const completedIdentity = completeProvisioning(
              {
                ...identity,
                needsHistorySync:
                  identity.needsHistorySync ||
                  (result.historySyncRequired && !result.historySyncRequested),
              },
              result
            );
            await storage.putIdentity(completedIdentity);

            setIdentity(completedIdentity);

            if (!options?.skipRegistryUpdate) {
              const registry = useInboxRegistryStore.getState();
              const label =
                options?.labelOverride ||
                completedIdentity.displayName ||
                `${completedIdentity.address.slice(0, 6)}…${completedIdentity.address.slice(-4)}`;

              registry.upsertEntry({
                inboxId,
                displayLabel: label,
                primaryDisplayIdentity: completedIdentity.displayName || completedIdentity.address,
                lastOpenedAt: Date.now(),
                hasLocalDB: true,
              });
              registry.markOpened(inboxId, true);
            }

            await ensureInboxStorageNamespace(inboxId, completedIdentity);

            console.log('[Auth] Saved XMTP info to identity:', {
              inboxId,
              installationId: installationId.substring(0, 16) + '...',
            });

            // Try to load profile (display name/avatar) from network and persist locally
            try {
              const profile = await xmtp.loadOwnProfile();
              if (profile && (profile.displayName || profile.avatarUrl)) {
                const updated = { ...completedIdentity } as Identity;
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
        return result;
      } catch (error) {
        if (options?.required) {
          throw error;
        }
        console.warn('XMTP connection failed (non-blocking):', error);
        return null;
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
        registrationPolicy?: ClientRegistrationPolicy;
        enableHistorySync?: boolean;
        label?: string;
        skipRegistryUpdate?: boolean;
        mnemonic?: string;
        identityKind?: Identity['identityKind'];
        linkedWalletAddress?: string;
        linkedWalletChainId?: number;
        linkedAt?: number;
        previousInboxId?: string;
        provisioningMode?: Identity['provisioningMode'];
        xmtpDbPathMode?: Identity['xmtpDbPathMode'];
        expectedInboxId?: string;
        expectedInstallationId?: string;
        requestHistorySync?: boolean;
      }
    ) => {
      const previousSession = useAuthStore.getState();
      const previousNamespace = getStorageNamespace();
      let attemptedAddress = walletAddress;
      try {
        const storage = await getStorage();

        let pendingIdentity: Identity | undefined;
        if (options?.provisioningMode === 'new-inbox') {
          pendingIdentity = (await storage.listIdentities()).find(
            (candidate) =>
              candidate.provisioningMode === 'new-inbox' &&
              candidate.provisioningPending === true &&
              Boolean(candidate.privateKey)
          );
        }

        const effectiveAddress = pendingIdentity?.address ?? walletAddress;
        const effectivePrivateKey = pendingIdentity?.privateKey ?? privateKey;
        const effectiveMnemonic = pendingIdentity?.mnemonic ?? options?.mnemonic;

        let publicKeyHex = '';
        
        // Only derive public key if we have a valid private key (generated wallets)
        // For connected wallets, we don't have the private key (wallet keeps it secure)
        if (effectivePrivateKey && effectivePrivateKey !== '0x0000000000000000000000000000000000000000000000000000000000000000') {
          const account = privateKeyToAccount(effectivePrivateKey as `0x${string}`);
          publicKeyHex = account.publicKey;
        }
        
        // Create identity
        const identity: Identity = {
          ...pendingIdentity,
          address: effectiveAddress,
          publicKey: publicKeyHex,
          privateKey: effectivePrivateKey, // Stored as plaintext in browser IndexedDB today.
          createdAt: pendingIdentity?.createdAt ?? Date.now(),
          displayName: pendingIdentity?.displayName ?? options?.label,
          identityKind: pendingIdentity?.identityKind ?? options?.identityKind,
          walletType: effectivePrivateKey ? 'EOA' : undefined,
          walletChainId: effectivePrivateKey ? undefined : chainId,
          linkedWalletAddress: options?.linkedWalletAddress,
          linkedWalletChainId: options?.linkedWalletChainId,
          linkedAt: options?.linkedAt,
          previousInboxId: options?.previousInboxId,
          provisioningMode: options?.provisioningMode,
          provisioningPending: true,
          xmtpDbPathMode: options?.xmtpDbPathMode ?? 'inbox-default',
          expectedInboxId: pendingIdentity?.expectedInboxId ?? options?.expectedInboxId,
          installationId: pendingIdentity?.installationId,
          inboxId: pendingIdentity?.inboxId,
          needsHistorySync:
            pendingIdentity?.needsHistorySync ?? options?.requestHistorySync ?? false,
        };
        attemptedAddress = identity.address;
        if (effectiveMnemonic) {
          identity.mnemonic = effectiveMnemonic;
        }
        await storage.putIdentity(identity);

        // Keep the key available while XMTP provisions, but do not mark onboarding
        // complete until the live inbox and installation have been verified.
        setIdentity(identity);

        // Connect XMTP with appropriate signer
        const connection = await connectXmtpSafely(
          identity.address,
          effectivePrivateKey && effectivePrivateKey !== '0x0000000000000000000000000000000000000000000000000000000000000000' ? effectivePrivateKey : undefined,
          chainId,
          signMessage,
          {
            register: options?.register !== false,
            registrationPolicy:
              options?.registrationPolicy ??
              (options?.register === false ? 'resume-only' : 'new-inbox'),
            enableHistorySync:
              options?.enableHistorySync !== undefined ? options.enableHistorySync : false,
            labelOverride: options?.label,
            skipRegistryUpdate: options?.skipRegistryUpdate,
            required: true,
            expectedInboxId: identity.expectedInboxId,
            expectedInstallationId:
              options?.expectedInstallationId ??
              (identity.provisioningPending ? identity.installationId : undefined),
            requestHistorySync: options?.requestHistorySync || identity.needsHistorySync,
          }
        );

        if (!connection) {
          throw new Error('XMTP did not return a verified inbox installation.');
        }

        setAuthenticated(true);
        setVaultUnlocked(true);

        return true;
      } catch (error) {
        console.error('Failed to create identity:', error);
        if (error instanceof Error) {
          console.error('Error message:', error.message);
          console.error('Error stack:', error.stack);
        }
        if (
          previousSession.isAuthenticated &&
          previousSession.identity &&
          previousSession.identity.address.toLowerCase() !== attemptedAddress.toLowerCase()
        ) {
          try {
            await setStorageNamespace(previousNamespace);
            setIdentity(previousSession.identity);
            setAuthenticated(true);
            setVaultUnlocked(previousSession.isVaultUnlocked);
            if (previousSession.identity.privateKey) {
              await connectXmtpSafely(
                previousSession.identity.address,
                previousSession.identity.privateKey,
                undefined,
                undefined,
                {
                  register: false,
                  enableHistorySync: false,
                  labelOverride: previousSession.identity.displayName,
                  skipRegistryUpdate: true,
                  expectedInboxId:
                    previousSession.identity.expectedInboxId ?? previousSession.identity.inboxId,
                }
              );
            }
          } catch (restoreError) {
            console.warn('[Auth] Failed to restore the previous session after provisioning:', restoreError);
          }
        }
        throw error;
      }
    },
    [setIdentity, setAuthenticated, setVaultUnlocked, connectXmtpSafely]
  );


  /**
   * Logout completely
   */
  const logout = useCallback(async () => {
    console.log('[Auth] Logging out - clearing all data...');

    try {
      const xmtp = getXmtpClient();
      await xmtp.disconnect();
    } catch (error) {
      console.warn('[Auth] Failed to disconnect XMTP (non-fatal):', error);
    }

    try {
      const storage = await getStorage();
      await storage.clearAllData();
      await storage.deleteIdentity();
      await storage.deleteVaultSecrets();
    } catch (error) {
      console.warn('[Auth] Failed to clear local storage (non-fatal):', error);
    }

    try {
      await setStorageNamespace('default');
    } catch (error) {
      console.warn('[Auth] Failed to reset storage namespace (non-fatal):', error);
    }

    try {
      lockVault();
    } catch (error) {
      console.warn('[Auth] Failed to lock vault (non-fatal):', error);
    }

    try {
      clearLastRoute();
    } catch (error) {
      console.warn('[Auth] Failed to clear last route (non-fatal):', error);
    }

    try {
      authStore.logout();
    } catch (error) {
      console.warn('[Auth] Failed to clear auth store (non-fatal):', error);
    }

    try {
      useInboxRegistryStore.getState().reset();
    } catch (error) {
      console.warn('[Auth] Failed to reset inbox registry (non-fatal):', error);
    }

    console.log('[Auth] ✅ Logout complete - all data cleared');
  }, [authStore]);

  const burnIdentity = useCallback(
    async (inboxId: string): Promise<boolean> => {
      const targetInboxId = normalizeInboxId(inboxId);
      if (!targetInboxId) {
        return false;
      }

      try {
        const registry = useInboxRegistryStore.getState();
        registry.hydrate();

        const previousNamespace = getStorageNamespace();
        const storage = await getStorage();
        const identities = await storage.listIdentities();
        const targetIdentity = identities.find((item) => inboxIdsMatch(item.inboxId, targetInboxId));
        const wasCurrent = inboxIdsMatch(useAuthStore.getState().identity?.inboxId, targetInboxId);

        await setStorageNamespace(targetInboxId);
        const targetStorage = await getStorage();

        await targetStorage.clearAllData({
          opfsAddresses: targetIdentity
            ? [targetIdentity.address, targetIdentity.inboxId].filter(
                (value): value is string => Boolean(value)
              )
            : undefined,
        });
        if (targetIdentity?.address) {
          await targetStorage.deleteIdentityByAddress(targetIdentity.address);
        }

        await closeStorage();
        await setStorageNamespace(previousNamespace);
        await getStorage();

        registry.removeEntry(targetInboxId);
        if (typeof window !== 'undefined') {
          const forced = window.localStorage.getItem('converge.forceInboxId.v1');
          if (forced && inboxIdsMatch(forced, targetInboxId)) {
            window.localStorage.removeItem('converge.forceInboxId.v1');
          }
        }

        if (wasCurrent) {
          try {
            await getXmtpClient().disconnect();
          } catch (error) {
            console.warn('[Auth] Failed to disconnect XMTP client during burn:', error);
          }
          authStore.logout();
          setVaultSecrets(null);
        }

        return true;
      } catch (error) {
        console.error('[Auth] Failed to burn identity:', error);
        return false;
      }
    },
    [authStore, setVaultSecrets]
  );

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
          const normalizedForced = normalizeInboxId(forced);
          registry.setCurrentInbox(normalizedForced);
          // Persist storage namespace early so the next getStorage() uses the right shard
          if (normalizedForced) {
            await setStorageNamespace(normalizedForced);
          }
          // Clear the one-shot hint
          window.localStorage.removeItem('converge.forceInboxId.v1');
        }
      } catch (e) {
        // non-fatal
      }

      // Ensure storage namespace is aligned with the current registry inbox before instantiating storage
      const normalizedRegistryInbox = normalizeInboxId(registry.currentInboxId);
      if (normalizedRegistryInbox) {
        try {
          await setStorageNamespace(normalizedRegistryInbox);
        } catch {
          // ignore
        }
      }

      const ensureNamespaceAndReload = async (inboxId: string) => {
        const normalizedInboxId = normalizeInboxId(inboxId);
        if (!normalizedInboxId) {
          throw new Error('Invalid inbox id for namespace reload');
        }

        await setStorageNamespace(normalizedInboxId);
        const targetStorage = await getStorage();
        const identitiesForInbox = await targetStorage.listIdentities();
        return { storage: targetStorage, identities: identitiesForInbox };
      };

      let storage = await getStorage();
      let identities = await storage.listIdentities();
      if (!identities.length) {
        try {
          await setStorageNamespace('default');
        } catch {
          // ignore; storage may already be on the default namespace
        }

        // Onboarding owns identity creation. In particular, a user choosing to
        // join an existing inbox must not get a standalone inbox first.
        return false;
      }

      let identity: Identity | undefined;

      if (normalizedRegistryInbox) {
        identity = identities.find((item) => inboxIdsMatch(item.inboxId, normalizedRegistryInbox));

        // If we have a registry-selected inbox but the current namespace doesn't contain it,
        // switch namespaces to that inbox and reload identities from that shard.
        if (!identity) {
          try {
            const result = await ensureNamespaceAndReload(normalizedRegistryInbox);
            storage = result.storage;
            identities = result.identities;
            identity = identities.find((item) => inboxIdsMatch(item.inboxId, normalizedRegistryInbox));
          } catch (error) {
            console.warn('[Auth] Failed to switch storage namespace for registry inbox:', error);
          }
        }
      }

      // If no identity is selected yet, iterate through registry entries to locate the correct namespace
      if (!identity && registry.entries.length > 0) {
        for (const entry of registry.entries) {
          try {
            const result = await ensureNamespaceAndReload(entry.inboxId);
            storage = result.storage;
            identities = result.identities;
            identity = identities.find((item) => inboxIdsMatch(item.inboxId, entry.inboxId));
            if (identity) {
              registry.setCurrentInbox(entry.inboxId);
              break;
            }
          } catch (error) {
            console.warn('[Auth] Failed to switch storage namespace while searching registry entries:', error);
          }
        }
      }

      // If a preferred inbox was selected (e.g., via the inbox switcher) but no identity
      // was found in that namespace, avoid falling back to a different inbox. Continuing
      // with another identity causes the UI to show the wrong avatar/name after the
      // hard reload triggered by the switcher.
      if (!identity && normalizedRegistryInbox) {
        console.warn('[Auth] Current inbox selected but no identity found for it; aborting auto-login');
        return false;
      }

      if (!identity) {
        // Fallback: pick the most recently opened from the registry list or the first identity in this namespace
        const currentId = registry.currentInboxId;
        if (currentId) {
          identity = identities.find((it) => inboxIdsMatch(it.inboxId, currentId)) || identities[0];
        } else {
          identity = identities[0];
        }
      }

      if (!identity) {
        return false;
      }

      const normalizedIdentityInboxId = normalizeInboxId(identity.inboxId);
      if (normalizedIdentityInboxId && identity.inboxId !== normalizedIdentityInboxId) {
        identity = { ...identity, inboxId: normalizedIdentityInboxId } as Identity;
      }

      const secrets = await storage.getVaultSecrets();

      setIdentity(identity);
      setVaultSecrets(secrets ?? null);
      const isPendingProvisioning = identity.provisioningPending === true || !identity.inboxId;
      if (!isPendingProvisioning) {
        setAuthenticated(true);
        setVaultUnlocked(true);
      }

      if (
        isPendingProvisioning &&
        identity.provisioningMode === 'device-join' &&
        identity.privateKey
      ) {
        const pendingProbe = await getXmtpClient().probeIdentity({
          address: identity.address,
          privateKey: identity.privateKey,
        });
        if (
          !pendingProbe.inboxId ||
          !inboxIdsMatch(
            pendingProbe.inboxId,
            identity.expectedInboxId ?? identity.inboxId
          )
        ) {
          console.info(
            '[Auth] Pending device key is not associated with its target inbox yet; returning to wallet approval.'
          );
          return false;
        }
      }

      if (typeof identity.lastSyncedAt === 'number') {
        useXmtpStore.getState().setLastSyncedAt(identity.lastSyncedAt);
      }

      const registryEntry = identity.inboxId
        ? registry.entries.find((entry) => inboxIdsMatch(entry.inboxId, identity!.inboxId))
        : undefined;
      const shouldSyncHistory = registryEntry ? !registryEntry.hasLocalDB : true;
      const shouldRequestDeviceHistory = Boolean(
        identity.needsHistorySync ||
          (shouldSyncHistory && identity.provisioningMode !== 'new-inbox')
      );

      if (identity.privateKey) {
        const connection = await connectXmtpSafely(identity.address, identity.privateKey, undefined, undefined, {
          register: false,
          registrationPolicy: registrationPolicyForStoredIdentity(
            identity,
            isPendingProvisioning
          ),
          enableHistorySync: shouldSyncHistory,
          requestHistorySync: shouldRequestDeviceHistory,
          labelOverride: identity.displayName,
          required: isPendingProvisioning,
          expectedInboxId: identity.expectedInboxId ?? identity.inboxId,
          expectedInstallationId: isPendingProvisioning ? identity.installationId : undefined,
        });
        if (isPendingProvisioning && connection) {
          setAuthenticated(true);
          setVaultUnlocked(true);
        }
      } else if (walletAddress && walletAddress.toLowerCase() === identity.address.toLowerCase()) {
        console.log('[Auth] Reconnecting wallet-based identity with wallet signer');
        const signMessage = async (message: string) => {
          if (!walletSignMessage) {
            throw new Error('Wallet signing is not available. Please reconnect your wallet.');
          }
          return await walletSignMessage(message, identity.address);
        };
        const connection = await connectXmtpSafely(identity.address, undefined, walletChainId, signMessage, {
          register: false,
          registrationPolicy: 'resume-only',
          enableHistorySync: shouldSyncHistory,
          requestHistorySync: shouldRequestDeviceHistory,
          walletType: identity.walletType,
          labelOverride: identity.displayName,
          required: isPendingProvisioning,
          expectedInboxId: identity.expectedInboxId ?? identity.inboxId,
          expectedInstallationId: isPendingProvisioning ? identity.installationId : undefined,
        });
        if (isPendingProvisioning && connection) {
          setAuthenticated(true);
          setVaultUnlocked(true);
        }
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
  }, [
    setIdentity,
    setVaultSecrets,
    setAuthenticated,
    setVaultUnlocked,
    connectXmtpSafely,
    walletAddress,
    walletChainId,
    walletSignMessage,
  ]);

  const probeIdentity = useCallback(
    async (
      walletAddress: string,
      privateKey?: string,
      chainId?: number,
      signMessage?: (message: string) => Promise<string>,
      walletType?: 'EOA' | 'SCW'
    ) => {
      const xmtp = getXmtpClient();
      return await xmtp.probeIdentity({
        address: walletAddress,
        privateKey,
        chainId,
        signMessage,
        walletType,
      });
    },
    []
  );

  const reconnectCurrentIdentity = useCallback(
    async (options?: {
      chainId?: number;
      signMessage?: (message: string) => Promise<string>;
      walletType?: 'EOA' | 'SCW';
    }): Promise<ConnectResult> => {
      const identity = useAuthStore.getState().identity;
      if (!identity) {
        throw new Error('No identity is currently loaded.');
      }

      const result = await connectXmtpSafely(
        identity.address,
        identity.privateKey,
        options?.chainId,
        options?.signMessage,
        {
          register: false,
          registrationPolicy: 'resume-only',
          enableHistorySync: false,
          labelOverride: identity.displayName,
          required: true,
          requestHistorySync: identity.needsHistorySync,
          walletType: options?.walletType ?? identity.walletType,
          expectedInboxId: identity.expectedInboxId ?? identity.inboxId,
        }
      );

      if (!result) {
        throw new Error('XMTP did not reconnect the current identity.');
      }
      return result;
    },
    [connectXmtpSafely]
  );

  const addDeviceToExistingWalletInbox = useCallback(
    async (
      targetWalletAddress: string,
      chainId: number | undefined,
      signMessage: (message: string) => Promise<string>,
      options?: {
        walletType?: 'EOA' | 'SCW';
        label?: string;
        onStatus?: (message: string) => void;
      }
    ): Promise<{ inboxId: string; installationId: string; deviceKeyAddress: string }> => {
      const previousSession = useAuthStore.getState();
      const previousNamespace = getStorageNamespace();
      const xmtp = getXmtpClient();
      const walletType = options?.walletType ?? 'EOA';
      const probe = await xmtp.probeIdentity({
        address: targetWalletAddress,
        chainId,
        walletType,
        signMessage,
      });

      if (!probe.inboxId) {
        throw new Error('No existing XMTP inbox was found for that wallet.');
      }
      const targetInboxId = normalizeInboxId(probe.inboxId);
      if (!targetInboxId) {
        throw new Error('XMTP returned an invalid inbox ID for that wallet.');
      }

      const currentStorage = await getStorage();
      const pendingIdentity = (await currentStorage.listIdentities()).find(
        (candidate) =>
          candidate.provisioningMode === 'device-join' &&
          candidate.provisioningPending === true &&
          Boolean(candidate.privateKey) &&
          inboxIdsMatch(candidate.expectedInboxId, targetInboxId)
      );
      const pendingInstallationIsRegistered = Boolean(
        pendingIdentity?.installationId &&
          probe.inboxState?.installations?.some(
            (installation) =>
              installation.id.replace(/^0x/i, '').toLowerCase() ===
              pendingIdentity.installationId?.replace(/^0x/i, '').toLowerCase()
          )
      );
      const pendingStaleInstallationIsRegistered = Boolean(
        pendingIdentity?.staleInstallationId &&
          probe.inboxState?.installations?.some(
            (installation) =>
              installation.id.replace(/^0x/i, '').toLowerCase() ===
              pendingIdentity.staleInstallationId?.replace(/^0x/i, '').toLowerCase()
          )
      );
      if (pendingIdentity?.staleInstallationId && !pendingStaleInstallationIsRegistered) {
        pendingIdentity.staleInstallationId = undefined;
        await currentStorage.putIdentity({ ...pendingIdentity });
      }
      if (pendingIdentity?.staleInstallationId && pendingStaleInstallationIsRegistered) {
        throw new StaleInstallationError(
          targetInboxId,
          pendingIdentity.staleInstallationId
        );
      }
      if (probe.installationCount >= 10 && !pendingInstallationIsRegistered) {
        throw new Error(
          'Installation limit reached (10/10). Revoke an old installation before adding this device.'
        );
      }
      const generated = pendingIdentity
        ? {
            identity: pendingIdentity,
            privateKey: pendingIdentity.privateKey as `0x${string}`,
            mnemonic: pendingIdentity.mnemonic ?? '',
          }
        : generateLocalAppIdentity();
      const stagedIdentity: Identity = {
        ...generated.identity,
        inboxId: targetInboxId,
        identityKind: 'local-app',
        provisioningMode: 'device-join',
        provisioningPending: true,
        xmtpDbPathMode: 'inbox-default',
        linkedWalletAddress: targetWalletAddress,
        linkedWalletChainId: chainId,
        linkedAt: pendingIdentity?.linkedAt ?? Date.now(),
        displayName: options?.label || generated.identity.displayName,
        needsHistorySync: true,
        expectedInboxId: targetInboxId,
      };

      // Persist the fresh key before the first ledger mutation. If association
      // succeeds but a later verification is interrupted, startup can safely
      // resume this exact key without registering it as a standalone inbox.
      await currentStorage.putIdentity(stagedIdentity);

      let lastProvisioningPhase = 'preflight';
      const provision = async (provisioningChainId = chainId) => {
        try {
          return await xmtp.provisionDeviceKeyForInbox({
            targetIdentity: {
              address: targetWalletAddress,
              chainId: provisioningChainId,
              walletType,
              signMessage,
            },
            deviceIdentity: {
              address: stagedIdentity.address,
              privateKey: generated.privateKey,
              xmtpDbPathMode: 'inbox-default',
            },
            expectedInboxId: targetInboxId,
            knownInstallationId: stagedIdentity.installationId,
            onInstallationReady: async (installationId) => {
              stagedIdentity.installationId = installationId;
              if (
                stagedIdentity.staleInstallationId?.replace(/^0x/i, '').toLowerCase() ===
                installationId.replace(/^0x/i, '').toLowerCase()
              ) {
                stagedIdentity.staleInstallationId = undefined;
              }
              await currentStorage.putIdentity({ ...stagedIdentity, installationId });
            },
            onPhase: async (phase) => {
              lastProvisioningPhase = phase;
              const messages = {
                preflight: 'Checking the target inbox and fresh device key…',
                'opening-manager': 'Opening this browser installation…',
                'manager-ready': 'Browser installation ready…',
                'registering-installation': 'Approve this browser installation in your wallet…',
                'installation-registered': 'Installation approved. Preparing the device key…',
                'associating-key': 'Associating the fresh device key…',
                'association-submitted': 'Device key accepted. Waiting for XMTP confirmation…',
                'verifying-association': 'Verifying the new key against your existing inbox…',
                complete: 'Device key verified. Opening your inbox…',
              } as const;
              options?.onStatus?.(messages[phase]);
            },
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error('[Auth] Device provisioning stopped', {
            phase: lastProvisioningPhase,
            message,
          });
          const provisioningError = new Error(
            `Device setup stopped during ${lastProvisioningPhase}: ${message}`
          );
          Object.assign(provisioningError, { cause: error });
          throw provisioningError;
        }
      };

      try {
        let provisioned: Awaited<ReturnType<typeof provision>>;
        try {
          provisioned = await provision();
        } catch (error) {
          const mismatch = extractWrongChainIdDetails(
            error instanceof Error ? error.message : String(error)
          );
          const retryChainId = mismatch
            ? getScwRetryChainId(walletType, chainId, mismatch.initiallyAddedWith)
            : null;
          if (mismatch && isLegacyScwChainZeroMismatch(mismatch)) {
            throw new Error(legacyScwChainZeroRecoveryMessage());
          }
          if (retryChainId !== null) {
            provisioned = await provision(retryChainId);
          } else {
            throw error;
          }
        }

        const deviceIdentity: Identity = {
          ...stagedIdentity,
          inboxId: targetInboxId,
          installationId: provisioned.installationId,
          needsHistorySync: true,
        };

        await setStorageNamespace(targetInboxId);
        const storage = await getStorage();
        await storage.putIdentity(deviceIdentity);
        setIdentity(deviceIdentity);

        const connection = await connectXmtpSafely(
          deviceIdentity.address,
          deviceIdentity.privateKey,
          undefined,
          undefined,
          {
            register: false,
            registrationPolicy: 'resume-only',
            enableHistorySync: true,
            labelOverride: deviceIdentity.displayName,
            required: true,
            expectedInboxId: targetInboxId,
            expectedInstallationId: provisioned.installationId,
            requestHistorySync: true,
          }
        );

        if (
          !connection ||
          !inboxIdsMatch(connection.inboxId, targetInboxId) ||
          connection.installationId !== provisioned.installationId
        ) {
          throw new Error(
            'The local device key did not reopen the wallet-approved XMTP installation.'
          );
        }

        setAuthenticated(true);
        setVaultUnlocked(true);

        const registry = useInboxRegistryStore.getState();
        registry.upsertEntry({
          inboxId: targetInboxId,
          displayLabel: deviceIdentity.displayName || targetWalletAddress,
          primaryDisplayIdentity: targetWalletAddress,
          lastOpenedAt: Date.now(),
          hasLocalDB: true,
        });
        registry.setCurrentInbox(targetInboxId);

        return {
          inboxId: targetInboxId,
          installationId: connection.installationId,
          deviceKeyAddress: deviceIdentity.address,
        };
      } catch (error) {
        let surfacedError = error;
        const provisioningMessage = error instanceof Error ? error.message : String(error);
        if (
          /different local installation while resuming device setup|did not reopen the wallet-approved browser installation/i.test(
            provisioningMessage
          ) &&
          stagedIdentity.installationId
        ) {
          stagedIdentity.staleInstallationId = stagedIdentity.installationId;
          stagedIdentity.installationId = undefined;
          await currentStorage.putIdentity({ ...stagedIdentity });
          setIdentity({ ...stagedIdentity });
          surfacedError = new StaleInstallationError(
            targetInboxId,
            stagedIdentity.staleInstallationId
          );
        }
        if (previousSession.isAuthenticated && previousSession.identity) {
          try {
            await setStorageNamespace(previousNamespace);
            setIdentity(previousSession.identity);
            setAuthenticated(true);
            setVaultUnlocked(previousSession.isVaultUnlocked);
            if (previousSession.identity.privateKey) {
              await connectXmtpSafely(
                previousSession.identity.address,
                previousSession.identity.privateKey,
                undefined,
                undefined,
                {
                  register: false,
                  enableHistorySync: false,
                  labelOverride: previousSession.identity.displayName,
                  skipRegistryUpdate: true,
                  expectedInboxId:
                    previousSession.identity.expectedInboxId ?? previousSession.identity.inboxId,
                }
              );
            }
          } catch (restoreError) {
            console.warn('[Auth] Failed to restore the prior inbox after device setup:', restoreError);
          }
        }
        throw surfacedError;
      }
    },
    [connectXmtpSafely, setAuthenticated, setIdentity, setVaultUnlocked]
  );

  return {
    ...authStore,
    createIdentity,
    logout,
    burnIdentity,
    checkExistingIdentity,
    probeIdentity,
    reconnectCurrentIdentity,
    addDeviceToExistingWalletInbox,
  };
}
