/**
 * Onboarding page for new users
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { IdentifierKind, type Identifier } from '@xmtp/browser-sdk';
import { WalletSelector } from './WalletSelector';
import { useAuth } from './useAuth';
import { useInboxRegistryStore, getInboxDisplayLabel } from '@/lib/stores';
import type { IdentityProbeResult } from '@/lib/xmtp/client';
import type { InboxRegistryEntry } from '@/types';
import { resetXmtpClient } from '@/lib/xmtp/client';
import { assertKeyfileInboxMatch, deriveIdentityFromKeyfile, parseKeyfile } from '@/lib/keyfile';
import type { KeyfileIdentity } from '@/lib/keyfile';
import { useWalletConnection } from '@/lib/wagmi';
import { generateLocalAppIdentity } from '@/lib/identity/local-app-key';
import { getXmtpClient } from '@/lib/xmtp';
import { usePublicClient } from 'wagmi';

const BASE_CHAIN_ID = 8453;

const shortAddress = (value: string) => `${value.slice(0, 6)}…${value.slice(-4)}`;

const formatRelativeFromMs = (ms?: number | null): string | null => {
  if (!ms) {
    return null;
  }

  const diff = Date.now() - ms;
  if (!Number.isFinite(diff) || diff < 0) {
    return null;
  }

  const minutes = Math.round(diff / 60000);
  if (minutes <= 1) {
    return 'just now';
  }
  if (minutes < 60) {
    return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  }

  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  }

  const days = Math.round(hours / 24);
  if (days < 30) {
    return `${days} day${days === 1 ? '' : 's'} ago`;
  }

  const months = Math.round(days / 30);
  if (months < 12) {
    return `${months} month${months === 1 ? '' : 's'} ago`;
  }

  const years = Math.round(months / 12);
  return `${years} year${years === 1 ? '' : 's'} ago`;
};

const formatInstallationTimestamp = (value?: bigint): { absolute: string; relative: string | null } => {
  if (!value) {
    return { absolute: 'Unknown', relative: null };
  }

  try {
    const milliseconds = Number(value / BigInt(1_000_000));
    if (!Number.isFinite(milliseconds)) {
      return { absolute: 'Unknown', relative: null };
    }
    const date = new Date(milliseconds);
    if (Number.isNaN(date.getTime())) {
      return { absolute: 'Unknown', relative: null };
    }
    return {
      absolute: date.toLocaleString(),
      relative: formatRelativeFromMs(milliseconds),
    };
  } catch (error) {
    console.warn('[Onboarding] Failed to format installation timestamp:', error);
    return { absolute: 'Unknown', relative: null };
  }
};

const ensure0xPrefix = (value: string): string =>
  value.startsWith('0x') ? value : `0x${value}`;

const formatIdentifier = (identifier: Identifier): string => {
  const kind = identifier.identifierKind;

  if (kind === IdentifierKind.Ethereum) {
    return ensure0xPrefix(identifier.identifier);
  }

  return identifier.identifier;
};

const getPreferredLabel = (identifiers: Identifier[] | undefined, address: string): string => {
  if (!identifiers || identifiers.length === 0) {
    return `Wallet ${shortAddress(address)}`;
  }

  const ethereumIdentifier = identifiers.find((item) => item.identifierKind === IdentifierKind.Ethereum);
  if (ethereumIdentifier) {
    return ensure0xPrefix(ethereumIdentifier.identifier);
  }

  return identifiers[0]?.identifier || `Wallet ${shortAddress(address)}`;
};

interface WalletIdentityCandidate {
  address: string;
  chainId?: number;
  walletType: 'EOA' | 'SCW';
  signMessage: (message: string) => Promise<string>;
}

const renderRegistryEntry = (
  entry: InboxRegistryEntry,
  onOpen: (entry: InboxRegistryEntry) => void,
  isActive: boolean
) => {
  const relative = formatRelativeFromMs(entry.lastOpenedAt);

  return (
    <div
      key={entry.inboxId}
      className="rounded-lg border border-primary-800/60 bg-primary-950/60 p-4 shadow-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-primary-100">
            {getInboxDisplayLabel(entry)}
          </div>
          <div className="text-xs text-primary-300 break-all">Inbox ID: {entry.inboxId}</div>
          <div className="text-xs text-primary-400 mt-1">
            Primary identity: {entry.primaryDisplayIdentity}
          </div>
          <div className="text-xs text-primary-500 mt-1">
            Last opened: {entry.lastOpenedAt ? new Date(entry.lastOpenedAt).toLocaleString() : 'never'}
          </div>
          {relative && (
            <div className="text-[10px] uppercase tracking-wide text-primary-600">({relative})</div>
          )}
          {!entry.hasLocalDB && (
            <div className="mt-2 text-xs text-amber-300">
              No local XMTP database yet. Full history may require an older device to be online.
            </div>
          )}
        </div>
        <div>
          <button
            onClick={() => onOpen(entry)}
            disabled={isActive}
            className="rounded-md border border-accent-500/60 bg-accent-600/90 px-3 py-1 text-sm font-medium text-white shadow-sm transition hover:bg-accent-500 disabled:cursor-not-allowed disabled:border-primary-700 disabled:bg-primary-900 disabled:text-primary-400"
          >
            {isActive ? 'Current' : 'Open'}
          </button>
        </div>
      </div>
    </div>
  );
};

export function OnboardingPage() {
  const navigate = useNavigate();
  const auth = useAuth();
  const { disconnectWallet, signMessage } = useWalletConnection();
  const basePublicClient = usePublicClient({ chainId: BASE_CHAIN_ID });

  const hydrateRegistry = useInboxRegistryStore((state) => state.hydrate);
  const registryEntries = useInboxRegistryStore((state) => state.entries);
  const setCurrentInbox = useInboxRegistryStore((state) => state.setCurrentInbox);

  const [view, setView] = useState<'landing' | 'wallet' | 'probing' | 'results' | 'processing' | 'keyfile'>('landing');
  const [statusMessage, setStatusMessage] = useState('Setting things up…');
  const [error, setError] = useState<string | null>(null);
  const [walletCandidate, setWalletCandidate] = useState<WalletIdentityCandidate | null>(null);
  const [probeResult, setProbeResult] = useState<IdentityProbeResult | null>(null);
  const [isRecoveringInstallation, setIsRecoveringInstallation] = useState(false);
  const [keyfileCandidate, setKeyfileCandidate] = useState<KeyfileIdentity | null>(null);
  const [keyfileProbeResult, setKeyfileProbeResult] = useState<IdentityProbeResult | null>(null);
  const [isRecoveringKeyfileInstallation, setIsRecoveringKeyfileInstallation] = useState(false);
  const [keyfileError, setKeyfileError] = useState<string | null>(null);
  const [keyfileName, setKeyfileName] = useState<string | null>(null);
  const keyfileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    hydrateRegistry();
  }, [hydrateRegistry]);

  // If navigated with ?connect=1 from a deep link or older route, jump straight into wallet selection.
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('connect') === '1') {
        setView('wallet');
      }
    } catch {
      // ignore
    }
  }, []);

  const sortedRegistry = useMemo(
    () => [...registryEntries].sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0)),
    [registryEntries]
  );

  const resetKeyfileFlow = () => {
    setKeyfileCandidate(null);
    setKeyfileProbeResult(null);
    setKeyfileError(null);
    setKeyfileName(null);
    if (keyfileInputRef.current) {
      keyfileInputRef.current.value = '';
    }
  };

  const getPendingTargetUrl = useCallback((): string | null => {
    try {
      const params = new URLSearchParams(window.location.search);
      const inviteTarget = params.get('invite');
      if (inviteTarget) {
        const inviteAuto = params.get('inviteAuto') === '1' ? '&auto=1' : '';
        return `/invite?i=${encodeURIComponent(inviteTarget)}${inviteAuto}`;
      }
      const inboxTarget = params.get('i');
      if (inboxTarget) {
        return `/i/${encodeURIComponent(inboxTarget)}`;
      }
      const userTarget = params.get('u');
      if (userTarget) {
        return `/u/${encodeURIComponent(userTarget)}`;
      }
    } catch {
      // ignore deep-link parse failure
    }
    return null;
  }, []);

  const navigateToPendingTarget = useCallback(() => {
    const target = getPendingTargetUrl();
    if (target) {
      navigate(target);
      return true;
    }
    return false;
  }, [getPendingTargetUrl, navigate]);

  const handleKeyfileSelected = async (file: File | null) => {
    setError(null);
    if (!file) {
      resetKeyfileFlow();
      return;
    }

    try {
      const content = await file.text();
      const parsed = parseKeyfile(content);
      const derived = deriveIdentityFromKeyfile(parsed);
      setKeyfileCandidate(derived);
      setKeyfileProbeResult(null);
      setKeyfileError(null);
      setKeyfileName(file.name);
    } catch (err) {
      console.error('[Onboarding] Failed to parse keyfile:', err);
      setKeyfileCandidate(null);
      setKeyfileProbeResult(null);
      setKeyfileName(file.name);
      setKeyfileError(
        err instanceof Error ? err.message : 'Unable to read that keyfile. Please double-check the file.'
      );
    } finally {
      if (keyfileInputRef.current) {
        keyfileInputRef.current.value = '';
      }
    }
  };

  const resetWalletFlow = async () => {
    console.log('[Onboarding] Resetting wallet flow - disconnecting XMTP and wallet...');

    // Disconnect XMTP client first to release OPFS locks
    try {
      await resetXmtpClient();
      console.log('[Onboarding] ✅ XMTP client disconnected');
      // Wait for OPFS locks to be fully released
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      console.warn('[Onboarding] Error disconnecting XMTP client:', error);
      // Still wait even if disconnect failed
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Disconnect wallet
    try {
      await disconnectWallet();
      console.log('[Onboarding] ✅ Wallet disconnected');
    } catch (error) {
      console.warn('[Onboarding] Error disconnecting wallet:', error);
    }

    // Clear local state
    setWalletCandidate(null);
    setProbeResult(null);
    setError(null);

    console.log('[Onboarding] ✅ Wallet flow reset complete');
  };

  const handleCreateGeneratedIdentity = async () => {
    setError(null);
    setKeyfileError(null);
    setStatusMessage('Creating your new inbox…');
    setView('processing');

    try {
      const generated = generateLocalAppIdentity();

      const success = await auth.createIdentity(generated.identity.address, generated.privateKey, undefined, undefined, {
        register: true,
        enableHistorySync: false,
        label: generated.identity.displayName,
        mnemonic: generated.mnemonic,
        identityKind: generated.identity.identityKind,
        provisioningMode: 'new-inbox',
        xmtpDbPathMode: 'inbox-default',
      });

      if (!success) {
        throw new Error('createIdentity returned false');
      }

      // Force a reload to ensure a clean state for the new inbox
      if (!navigateToPendingTarget()) {
        window.location.assign('/');
      }
    } catch (err) {
      console.error('[Onboarding] Failed to create generated identity:', err);
      setError('Unable to create a new identity. Please try again.');
      setView('landing');
    }
  };

  const handleImportKeyfileIdentity = async () => {
    if (!keyfileCandidate) {
      setKeyfileError('Select a valid keyfile to continue.');
      return;
    }

    setError(null);
    setKeyfileError(null);
    setStatusMessage('Importing identity from keyfile…');
    setView('processing');

    try {
      const keyProbe = await auth.probeIdentity(
        keyfileCandidate.address,
        keyfileCandidate.privateKey
      );
      assertKeyfileInboxMatch(keyfileCandidate.expectedInboxId, keyProbe.inboxId);
      setKeyfileProbeResult(keyProbe);
      if (keyProbe.installationCount >= 10) {
        setKeyfileError(
          'Installation limit reached (10/10). Revoke the oldest installation before restoring this key on a new browser.'
        );
        setView('keyfile');
        return;
      }

      // Don't use label from keyfile - will fetch from XMTP after connection
      const success = await auth.createIdentity(
        keyfileCandidate.address,
        keyfileCandidate.privateKey,
        undefined,
        undefined,
        {
          register: false,
          enableHistorySync: true,
          // Don't pass label - will fetch from XMTP
          mnemonic: keyfileCandidate.mnemonic,
          identityKind: 'imported',
          provisioningMode: 'keyfile-restore',
          xmtpDbPathMode: 'inbox-default',
          expectedInboxId: keyfileCandidate.expectedInboxId ?? keyProbe.inboxId ?? undefined,
          requestHistorySync: keyProbe.isRegistered,
        }
      );

      if (!success) {
        throw new Error('createIdentity returned false');
      }

      // Fetch display name from XMTP after connection
      try {
        const { getXmtpClient } = await import('@/lib/xmtp');
        const { getStorage } = await import('@/lib/storage');
        const { useAuthStore } = await import('@/lib/stores');

        const xmtp = getXmtpClient();

        // Wait for XMTP connection and inbox ID to be set (with timeout)
        let attempts = 0;
        let identity = useAuthStore.getState().identity;
        while ((!identity?.inboxId || !xmtp.isConnected()) && attempts < 20) {
          await new Promise(resolve => setTimeout(resolve, 250));
          identity = useAuthStore.getState().identity;
          attempts++;
        }

        if (identity?.inboxId && xmtp.isConnected()) {
          const profile = await xmtp.refreshInboxProfile(identity.inboxId);
          if (profile.displayName) {
            const storage = await getStorage();
            const updatedIdentity = { ...identity, displayName: profile.displayName };
            await storage.putIdentity(updatedIdentity);
            useAuthStore.getState().setIdentity(updatedIdentity);
            console.log('[Onboarding] ✅ Updated display name from XMTP:', profile.displayName);
          }
        }
      } catch (profileError) {
        // Non-fatal - continue even if profile fetch fails
        console.warn('[Onboarding] Failed to fetch display name from XMTP:', profileError);
      }

      if (!navigateToPendingTarget()) {
        window.location.assign('/');
      }
    } catch (err) {
      console.error('[Onboarding] Failed to import keyfile identity:', err);
      setKeyfileError(
        err instanceof Error ? err.message : 'Failed to import that keyfile. Please try again.'
      );
      setView('keyfile');
    }
  };

  const startConnectFlow = async () => {
    await resetWalletFlow();
    setView('wallet');
  };

  const handleWalletConnected = async (address: string, chainId?: number) => {
    let walletType: WalletIdentityCandidate['walletType'] = 'EOA';
    if (basePublicClient) {
      try {
        const bytecode = await basePublicClient.getBytecode({ address: address as `0x${string}` });
        if (bytecode && bytecode !== '0x') {
          walletType = 'SCW';
          chainId = BASE_CHAIN_ID;
        }
      } catch (error) {
        console.warn('[Onboarding] Could not inspect wallet bytecode; using EOA signer:', error);
      }
    }

    const candidate: WalletIdentityCandidate = {
      address,
      chainId,
      walletType,
      signMessage: async (message: string) => {
        if (!signMessage) {
          throw new Error('Wallet signing is not available. Please reconnect your wallet.');
        }
        return await signMessage(message);
      },
    };

    setWalletCandidate(candidate);
    setStatusMessage('Checking XMTP for inboxes…');
    setView('probing');

    try {
      const result = await auth.probeIdentity(
        address,
        undefined,
        chainId,
        candidate.signMessage,
        candidate.walletType
      );
      setProbeResult(result);
      setError(null);
      setView('results');
    } catch (err) {
      console.error('[Onboarding] Wallet probe failed:', err);
      setError('Unable to reach XMTP right now. Please try again.');
      setView('wallet');
    }
  };

  const finalizeWalletIdentity = async () => {
    if (!walletCandidate) {
      return;
    }

    if (probeResult && probeResult.installationCount >= 10) {
      setError('Installation limit reached (10/10). Revoke an old installation to continue.');
      return;
    }

    const inboxId = probeResult?.inboxId ?? null;
    if (!inboxId) {
      setError('No existing XMTP inbox was found for that wallet.');
      return;
    }

    setStatusMessage('Adding this device to your existing inbox…');
    setView('processing');

    try {
      const label = getPreferredLabel(probeResult?.inboxState?.accountIdentifiers, walletCandidate.address);
      await auth.addDeviceToExistingWalletInbox(
        walletCandidate.address,
        walletCandidate.chainId,
        walletCandidate.signMessage,
        {
          walletType: walletCandidate.walletType,
          label,
        }
      );

      // Force a reload to ensure a clean state for the new inbox
      const pendingTarget = getPendingTargetUrl();
      window.location.assign(pendingTarget ?? '/');
    } catch (err) {
      console.error('[Onboarding] Failed to connect app key to wallet inbox:', err);
      setError(err instanceof Error ? err.message : 'Failed to connect this app key. Please try again.');
      setView('results');
    }
  };

  const recoverOldestInstallation = async () => {
    if (!walletCandidate || !probeResult?.inboxId || isRecoveringInstallation) {
      return;
    }
    if (
      !window.confirm(
        'Revoke the oldest installation to make room for this browser? Creation time does not prove that device is inactive.'
      )
    ) {
      return;
    }

    setIsRecoveringInstallation(true);
    setError(null);
    setStatusMessage('Revoking one old installation…');
    setView('processing');

    try {
      const xmtp = getXmtpClient();
      await xmtp.revokeOldestInstallationsForIdentity(
        {
          address: walletCandidate.address,
          chainId: walletCandidate.chainId,
          walletType: walletCandidate.walletType,
          signMessage: walletCandidate.signMessage,
        },
        1,
        {
          inboxId: probeResult.inboxId,
          inboxState: probeResult.inboxState,
          requireAtLimit: true,
          onStatus: setStatusMessage,
        }
      );

      const refreshed = await auth.probeIdentity(
        walletCandidate.address,
        undefined,
        walletCandidate.chainId,
        walletCandidate.signMessage,
        walletCandidate.walletType
      );
      setProbeResult(refreshed);
      setView('results');
    } catch (err) {
      console.error('[Onboarding] Installation recovery failed:', err);
      setError(err instanceof Error ? err.message : 'Failed to revoke an installation.');
      setView('results');
    } finally {
      setIsRecoveringInstallation(false);
    }
  };

  const recoverOldestKeyfileInstallation = async () => {
    if (
      !keyfileCandidate ||
      !keyfileProbeResult?.inboxId ||
      isRecoveringKeyfileInstallation
    ) {
      return;
    }
    if (
      !window.confirm(
        'Revoke the oldest installation to make room for this keyfile on this browser? Creation time does not prove that device is inactive.'
      )
    ) {
      return;
    }

    setIsRecoveringKeyfileInstallation(true);
    setKeyfileError(null);
    try {
      const xmtp = getXmtpClient();
      await xmtp.revokeOldestInstallationsForIdentity(
        {
          address: keyfileCandidate.address,
          privateKey: keyfileCandidate.privateKey,
        },
        1,
        {
          inboxId: keyfileProbeResult.inboxId,
          inboxState: keyfileProbeResult.inboxState,
          requireAtLimit: true,
        }
      );
      const refreshed = await auth.probeIdentity(
        keyfileCandidate.address,
        keyfileCandidate.privateKey
      );
      setKeyfileProbeResult(refreshed);
      setKeyfileError(
        refreshed.installationCount >= 10
          ? 'XMTP still reports 10 installations. Wait a moment and retry the recovery check.'
          : null
      );
    } catch (err) {
      console.error('[Onboarding] Keyfile installation recovery failed:', err);
      setKeyfileError(
        err instanceof Error
          ? err.message
          : 'This key could not authorize installation recovery for the inbox.'
      );
    } finally {
      setIsRecoveringKeyfileInstallation(false);
    }
  };

  const handleOpenLocalInbox = async (entry: InboxRegistryEntry) => {
    setStatusMessage('Opening local inbox…');
    setView('processing');
    setError(null);

    try {
      setCurrentInbox(entry.inboxId);
      const success = await auth.checkExistingIdentity();
      if (!success) {
        throw new Error('Unable to rehydrate identity');
      }
      // Reload to ensure clean state
      window.location.reload();
    } catch (err) {
      console.error('[Onboarding] Failed to open local inbox:', err);
      setError('Unable to open that inbox from local storage. Try reconnecting its identity.');
      setView(walletCandidate && probeResult ? 'results' : 'landing');
    }
  };

  const renderLocalRegistry = (activeInboxId: string | null) => (
    <div className="rounded-xl border border-primary-800/60 bg-primary-950/70 p-6 shadow-lg">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-primary-50">On this device</h3>
        <span className="rounded-full bg-primary-800 px-3 py-1 text-xs font-medium text-primary-200">
          {sortedRegistry.length} saved
        </span>
      </div>

      {sortedRegistry.length === 0 ? (
        <p className="mt-4 text-sm text-primary-200">
          No local inboxes yet. Connect an identity to populate the registry.
        </p>
      ) : (
        <div className="mt-4 space-y-3">
          {sortedRegistry.map((entry) =>
            renderRegistryEntry(entry, handleOpenLocalInbox, activeInboxId === entry.inboxId)
          )}
        </div>
      )}

      <div className="mt-6 text-xs text-primary-300">
        Need to connect another identity? You can always do so later from Settings → Identities.
      </div>
    </div>
  );

  const renderLanding = () => (
    <div className="flex h-screen overflow-y-auto items-center justify-center bg-gradient-to-br from-primary-950 via-primary-900 to-primary-800 p-4">
      <div className="w-full max-w-xl space-y-8 text-center">
        <div>
          <div className="mx-auto mb-4 flex h-24 w-24 items-center justify-center rounded-full border border-primary-700/60 bg-primary-900/60 shadow-lg">
            <span className="text-4xl font-bold text-accent-300">C</span>
          </div>
          <h1 className="text-4xl font-bold text-primary-50">Welcome to Converge</h1>
          <p className="mt-2 text-primary-200">Secure, local-first messaging powered by XMTP identities.</p>
        </div>

        {error && (
          <div className="rounded-lg border border-red-500/60 bg-red-900/30 p-4 text-left text-sm text-red-200">
            {error}
          </div>
        )}

        <div className="grid gap-4 text-left">
          <button
            onClick={startConnectFlow}
            className="w-full rounded-xl border border-primary-800/60 bg-primary-950/70 p-6 transition hover:border-accent-400 hover:bg-primary-900/60"
          >
            <div className="text-3xl">🔐</div>
            <div className="mt-2 text-xl font-semibold text-primary-50">Add this device to existing inbox</div>
            <div className="mt-1 text-sm text-primary-200">
              Use a wallet that already controls the inbox to approve a new private key for this browser.
            </div>
          </button>
          <button
            onClick={handleCreateGeneratedIdentity}
            className="w-full rounded-xl border border-primary-800/60 bg-primary-950/70 p-6 transition hover:border-accent-400 hover:bg-primary-900/60"
          >
            <div className="text-3xl">✨</div>
            <div className="mt-2 text-xl font-semibold text-primary-50">Create new Converge inbox</div>
            <div className="mt-1 text-sm text-primary-200">
              Generate a local key and register a brand-new XMTP inbox in one step.
            </div>
          </button>
          <button
            onClick={() => {
              setError(null);
              resetKeyfileFlow();
              setView('keyfile');
            }}
            className="w-full rounded-xl border border-primary-800/60 bg-primary-950/70 p-6 transition hover:border-accent-400 hover:bg-primary-900/60"
          >
            <div className="text-xl font-semibold text-primary-50">Restore from keyfile</div>
            <div className="mt-1 text-sm text-primary-200">
              Reuse the exact private key or recovery phrase. On a new browser, XMTP creates a new installation for the same inbox.
            </div>
          </button>
        </div>

        {sortedRegistry.length > 0 && renderLocalRegistry(null)}
      </div>
    </div>
  );

  const renderWalletSelection = () => (
    <div className="flex h-screen overflow-y-auto items-center justify-center bg-gradient-to-br from-primary-950 via-primary-900 to-primary-800 p-4">
      <WalletSelector
        onWalletConnected={handleWalletConnected}
        onBack={() => {
          resetWalletFlow();
          setView('landing');
        }}
        backLabel="← Back"
      />
    </div>
  );

  const renderKeyfileImport = () => (
    <div className="flex h-screen overflow-y-auto items-center justify-center bg-gradient-to-br from-primary-950 via-primary-900 to-primary-800 p-4">
      <div className="w-full max-w-2xl space-y-6 rounded-xl border border-primary-800/60 bg-primary-950/70 p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-semibold text-primary-50">Restore from keyfile</h2>
            <p className="mt-1 text-sm text-primary-200">
              This reuses the same private key or recovery phrase. It does not create a separate per-device account key.
            </p>
          </div>
          <button
            onClick={() => {
              resetKeyfileFlow();
              setView('landing');
            }}
            className="rounded-md border border-primary-700 bg-primary-900 px-3 py-1 text-sm text-primary-200 transition hover:border-primary-500 hover:text-primary-100"
          >
            ← Back
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-primary-200">Keyfile</label>
            <input
              ref={keyfileInputRef}
              type="file"
              accept="application/json,.json"
              onChange={(event) => handleKeyfileSelected(event.target.files?.[0] ?? null)}
              className="mt-2 w-full cursor-pointer rounded-md border border-dashed border-primary-700 bg-primary-950/60 p-4 text-sm text-primary-100 file:hidden"
            />
            <div className="mt-2 text-xs text-primary-300">
              The imported private key and recovery phrase are stored unencrypted in this browser&rsquo;s IndexedDB. Protect the source file and this browser profile.
            </div>
          </div>

          {keyfileName && (
            <div className="rounded-md border border-primary-800/60 bg-primary-900/60 px-4 py-3 text-sm text-primary-100">
              Selected: <span className="font-mono">{keyfileName}</span>
            </div>
          )}

          {keyfileError && (
            <div className="rounded-md border border-red-500/60 bg-red-900/30 px-4 py-3 text-sm text-red-200">
              {keyfileError}
            </div>
          )}

          {keyfileProbeResult && keyfileProbeResult.installationCount >= 10 && (
            <button
              type="button"
              onClick={recoverOldestKeyfileInstallation}
              disabled={isRecoveringKeyfileInstallation}
              className="w-full rounded-md border border-amber-500/60 bg-amber-950/50 px-4 py-3 text-sm font-semibold text-amber-100 transition hover:bg-amber-900/50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isRecoveringKeyfileInstallation
                ? 'Revoking installation...'
                : 'Revoke oldest installation'}
            </button>
          )}

          {keyfileCandidate && (
            <div className="space-y-3 rounded-lg border border-primary-800/60 bg-primary-900/60 p-4">
              <div>
                <div className="text-xs uppercase tracking-wide text-primary-400">Recovered identity</div>
                <div className="text-lg font-semibold text-primary-50">{keyfileCandidate.label || 'Unlabeled identity'}</div>
                <div className="font-mono text-sm text-primary-200 break-all mt-1">{keyfileCandidate.address}</div>
              </div>
              {keyfileCandidate.mnemonic && (
                <div className="rounded-md border border-accent-400/40 bg-accent-600/10 px-3 py-2 text-xs text-accent-200">
                  Includes 12-word recovery phrase
                </div>
              )}
              <div className="text-xs text-primary-300">
                A fresh browser gets a new XMTP installation for the same inbox. Keep an older device online while encrypted history sync runs.
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-primary-800/60 pt-4">
          <div className="text-xs text-primary-400">
            Need help? Contact hello@converge.cv from any connected device.
          </div>
          <button
            onClick={handleImportKeyfileIdentity}
            disabled={
              !keyfileCandidate ||
              isRecoveringKeyfileInstallation ||
              Boolean(keyfileProbeResult && keyfileProbeResult.installationCount >= 10)
            }
            className="rounded-md border border-accent-500/60 bg-accent-600/90 px-4 py-2 text-sm font-semibold text-white shadow transition hover:bg-accent-500 disabled:cursor-not-allowed disabled:border-primary-700 disabled:bg-primary-900 disabled:text-primary-400"
          >
            Restore identity
          </button>
        </div>
      </div>
    </div>
  );

  const renderLoading = (message: string) => (
    <div className="flex h-screen overflow-y-auto items-center justify-center bg-gradient-to-br from-primary-950 via-primary-900 to-primary-800 p-4">
      <div className="w-full max-w-md space-y-4 text-center">
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full border border-primary-700/60 bg-primary-900/60">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-accent-400 border-t-transparent" />
        </div>
        <h2 className="text-2xl font-semibold text-primary-50">{message}</h2>
        <p className="text-sm text-primary-300">
          {view === 'probing'
            ? 'We check the XMTP identity ledger without registering anything.'
            : 'Hold tight while we finish setting up this device.'}
        </p>
      </div>
    </div>
  );

  const renderResults = () => {
    if (!walletCandidate || !probeResult) {
      return renderLanding();
    }

    const remoteInstallations = probeResult.inboxState?.installations ?? [];
    const remoteIdentifiers: Identifier[] = probeResult.inboxState?.accountIdentifiers ?? [];
    const recoveryIdentifier = probeResult.inboxState?.recoveryIdentifier;
    const recoveryAddress = recoveryIdentifier ? `0x${recoveryIdentifier.identifier}` : null;
    const installationCount = probeResult.installationCount ?? 0;
    const installationWarning = installationCount >= 8 && installationCount < 10;
    const installationBlocked = installationCount >= 10;
    const hasInbox = probeResult.isRegistered && Boolean(probeResult.inboxId);
    const preferredLabel = getPreferredLabel(remoteIdentifiers, walletCandidate.address);

    return (
      <div className="flex h-screen overflow-y-auto items-center justify-center bg-gradient-to-br from-primary-950 via-primary-900 to-primary-800 p-4">
        <div className="w-full max-w-4xl space-y-6">
          <div className="rounded-xl border border-primary-800/60 bg-primary-950/70 p-6 shadow-lg">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div>
                <div className="text-xs uppercase tracking-wide text-primary-400">Connected wallet</div>
                <div className="text-2xl font-semibold text-primary-50">{preferredLabel}</div>
                <div className="text-sm text-primary-300 break-all">{walletCandidate.address}</div>
              </div>
              <div className="flex flex-col gap-2 text-right">
                <button
                  onClick={async () => {
                    await resetWalletFlow();
                    setView('wallet');
                  }}
                  className="self-end rounded-md border border-primary-700 bg-primary-900 px-4 py-2 text-sm font-medium text-primary-200 transition hover:border-primary-500 hover:text-primary-100"
                >
                  Switch identity
                </button>
                <button
                  onClick={async () => {
                    await resetWalletFlow();
                    setView('landing');
                  }}
                  className="self-end text-xs text-primary-300 hover:text-primary-100"
                >
                  ← Back to start
                </button>
              </div>
            </div>
            {error && (
              <div className="mt-4 rounded-md border border-red-500/60 bg-red-900/30 px-4 py-3 text-sm text-red-200">
                {error}
              </div>
            )}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-primary-800/60 bg-primary-950/70 p-6 shadow-lg space-y-4">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-lg font-semibold text-primary-50">XMTP inbox</h3>
                  {walletCandidate && (
                    <button
                      onClick={async () => {
                        if (!walletCandidate) return;
                        setStatusMessage('Rechecking XMTP inbox…');
                        setView('probing');
                        setError(null);
                        try {
                          const result = await auth.probeIdentity(
                            walletCandidate.address,
                            undefined,
                            walletCandidate.chainId,
                            walletCandidate.signMessage,
                            walletCandidate.walletType
                          );
                          setProbeResult(result);
                          setView('results');
                        } catch (err) {
                          console.error('[Onboarding] Retry probe failed:', err);
                          setError('Failed to recheck inbox. Please try again.');
                          setView('results');
                        }
                      }}
                      className="text-xs px-2 py-1 rounded border border-primary-700 bg-primary-900/50 text-primary-300 hover:border-primary-600 hover:text-primary-100 transition-colors"
                      title="Retry inbox check"
                    >
                      🔄 Retry
                    </button>
                  )}
                </div>
                {hasInbox ? (
                  <>
                    <div className="mt-2 text-sm text-primary-200 break-all">
                      Inbox ID: {probeResult.inboxId}
                    </div>
                    <div className="text-xs text-primary-300">Installations: {installationCount}/10</div>
                    {installationWarning && !installationBlocked && (
                      <div className="text-xs text-amber-300 mt-1">
                        Approaching installation limit — consider revoking unused devices.
                      </div>
                    )}
                    {installationBlocked && (
                      <div className="text-xs text-red-300 mt-1">
                        Installation limit reached (10/10). Revoke an old installation to continue.
                      </div>
                    )}
                  </>
                ) : (
                  <div className="mt-2 space-y-2">
                    <div className="text-sm text-primary-200">
                      {probeResult.isRegistered
                        ? 'Inbox detected but ID not found. Try refreshing or check console for details.'
                        : 'No XMTP inbox is registered for this wallet yet.'}
                    </div>
                    {probeResult.isRegistered && !probeResult.inboxId && (
                      <div className="text-xs text-primary-400">
                        💡 This may be a temporary network issue. Try clicking Retry or refreshing the page.
                      </div>
                    )}
                  </div>
                )}
              </div>

              {remoteInstallations.length > 0 && (
                <div>
                  <div className="text-xs uppercase tracking-wide text-primary-400">Known installations</div>
                  <div className="mt-2 space-y-2">
                    {remoteInstallations.map((installation) => {
                      const timestamp = formatInstallationTimestamp(installation.clientTimestampNs);
                      return (
                        <div
                          key={installation.id}
                          className="rounded-md border border-primary-800/60 bg-primary-900/60 p-3 text-xs text-primary-200"
                        >
                          <div className="font-mono text-[11px] break-all">{installation.id}</div>
                          <div className="mt-1 text-primary-300">
                            Last activity: {timestamp.absolute}
                          </div>
                          {timestamp.relative && (
                            <div className="text-[10px] uppercase tracking-wide text-primary-500">
                              ({timestamp.relative})
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {remoteIdentifiers.length > 0 && (
                <div>
                  <div className="text-xs uppercase tracking-wide text-primary-400">Linked identifiers</div>
                  <ul className="mt-2 space-y-1 text-xs text-primary-200">
                    {remoteIdentifiers.map((identifier) => {
                      const kindLabel = IdentifierKind[identifier.identifierKind] ?? String(identifier.identifierKind);
                      return (
                        <li key={`${identifier.identifier}-${identifier.identifierKind}`}>
                          {kindLabel}: {formatIdentifier(identifier)}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              {recoveryAddress && (
                <div className="rounded-md border border-sky-400/40 bg-sky-900/30 px-4 py-3 text-xs text-sky-200">
                  Recovery identity: <code className="font-mono text-sky-100">{recoveryAddress}</code>. Use that identity to
                  manage installations if you hit the limit.
                </div>
              )}

              <div className="pt-2">
                {hasInbox ? (
                  installationBlocked ? (
                    <button
                      onClick={recoverOldestInstallation}
                      disabled={isRecoveringInstallation}
                      className="w-full rounded-md border border-amber-500/60 bg-amber-700 px-4 py-3 text-sm font-semibold text-white shadow transition hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isRecoveringInstallation ? 'Revoking…' : 'Revoke oldest installation'}
                    </button>
                  ) : (
                    <button
                      onClick={() => finalizeWalletIdentity()}
                      className="w-full rounded-md border border-accent-500/60 bg-accent-600/90 px-4 py-3 text-sm font-semibold text-white shadow transition hover:bg-accent-500"
                    >
                      Add this device
                    </button>
                  )
                ) : (
                  <div className="rounded-md border border-primary-800/60 bg-primary-900/50 px-4 py-3 text-sm text-primary-200">
                    This wallet does not control an existing XMTP inbox. Go back and choose Create new Converge inbox instead.
                  </div>
                )}
              </div>
            </div>

            {renderLocalRegistry(probeResult.inboxId ?? null)}
          </div>

          <div className="rounded-xl border border-primary-800/40 bg-primary-950/40 p-4 text-xs text-primary-300">
            Converge generates a fresh key only after approval. It does not create or abandon a temporary inbox. Matching the inbox ID does not restore old messages by itself; an older installation may need to be online.
          </div>
        </div>
      </div>
    );
  };

  if (view === 'landing') {
    return renderLanding();
  }

  if (view === 'wallet') {
    return renderWalletSelection();
  }

  if (view === 'keyfile') {
    return renderKeyfileImport();
  }

  if (view === 'probing') {
    return renderLoading('Checking identity…');
  }

  if (view === 'processing') {
    return renderLoading(statusMessage);
  }

  if (view === 'results') {
    return renderResults();
  }

  return renderLanding();
}
