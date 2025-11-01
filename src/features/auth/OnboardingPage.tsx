/**
 * Onboarding page for new users
 */

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { privateKeyToAccount } from 'viem/accounts';
import { useSignMessage } from 'wagmi';
import type { Identifier } from '@xmtp/browser-sdk';
import { WalletSelector } from './WalletSelector';
import { useAuth } from './useAuth';
import { useInboxRegistryStore, getInboxDisplayLabel } from '@/lib/stores';
import type { IdentityProbeResult } from '@/lib/xmtp/client';
import type { InboxRegistryEntry } from '@/types';

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

const formatIdentifier = (identifier: Identifier): string => {
  const kind = identifier.identifierKind.toLowerCase();

  if (kind === 'ethereum') {
    return `0x${identifier.identifier}`;
  }

  return identifier.identifier;
};

const getPreferredLabel = (identifiers: Identifier[] | undefined, address: string): string => {
  if (!identifiers || identifiers.length === 0) {
    return `Wallet ${shortAddress(address)}`;
  }

  const priorityOrder = ['ens', 'lens'];
  for (const priority of priorityOrder) {
    const match = identifiers.find((item) => item.identifierKind.toLowerCase() === priority);
    if (match) {
      return match.identifier;
    }
  }

  const ethereumIdentifier = identifiers.find((item) => item.identifierKind.toLowerCase() === 'ethereum');
  if (ethereumIdentifier) {
    return `0x${ethereumIdentifier.identifier}`;
  }

  return `Wallet ${shortAddress(address)}`;
};

interface WalletIdentityCandidate {
  address: string;
  chainId?: number;
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
              No local XMTP database yet — history sync will run on first open.
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
  const { signMessageAsync } = useSignMessage();

  const hydrateRegistry = useInboxRegistryStore((state) => state.hydrate);
  const registryEntries = useInboxRegistryStore((state) => state.entries);
  const setCurrentInbox = useInboxRegistryStore((state) => state.setCurrentInbox);

  const [view, setView] = useState<'landing' | 'wallet' | 'probing' | 'results' | 'processing'>(
    'landing'
  );
  const [statusMessage, setStatusMessage] = useState('Setting things up…');
  const [error, setError] = useState<string | null>(null);
  const [walletCandidate, setWalletCandidate] = useState<WalletIdentityCandidate | null>(null);
  const [probeResult, setProbeResult] = useState<IdentityProbeResult | null>(null);

  useEffect(() => {
    hydrateRegistry();
  }, [hydrateRegistry]);

  const sortedRegistry = useMemo(
    () => [...registryEntries].sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0)),
    [registryEntries]
  );

  const resetWalletFlow = () => {
    setWalletCandidate(null);
    setProbeResult(null);
    setError(null);
  };

  const handleCreateGeneratedIdentity = async () => {
    setError(null);
    setStatusMessage('Creating your new inbox…');
    setView('processing');

    try {
      const privateKeyBytes = crypto.getRandomValues(new Uint8Array(32));
      const privateKeyHex = (`0x${Array.from(privateKeyBytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')}`) as `0x${string}`;
      const account = privateKeyToAccount(privateKeyHex);

      const success = await auth.createIdentity(account.address, privateKeyHex, undefined, undefined, {
        register: true,
        enableHistorySync: true,
        label: `Identity ${shortAddress(account.address)}`,
      });

      if (!success) {
        throw new Error('createIdentity returned false');
      }

      navigate('/');
    } catch (err) {
      console.error('[Onboarding] Failed to create generated identity:', err);
      setError('Unable to create a new identity. Please try again.');
      setView('landing');
    }
  };

  const startConnectFlow = () => {
    resetWalletFlow();
    setView('wallet');
  };

  const handleWalletConnected = async (address: string, chainId?: number) => {
    const candidate: WalletIdentityCandidate = {
      address,
      chainId,
      signMessage: async (message: string) => await signMessageAsync({ message }),
    };

    setWalletCandidate(candidate);
    setStatusMessage('Checking XMTP for inboxes…');
    setView('probing');

    try {
      const result = await auth.probeIdentity(address, undefined, chainId, candidate.signMessage);
      setProbeResult(result);
      setError(null);
      setView('results');
    } catch (err) {
      console.error('[Onboarding] Wallet probe failed:', err);
      setError('Unable to reach XMTP right now. Please try again.');
      setView('wallet');
    }
  };

  const finalizeWalletIdentity = async (mode: 'connect' | 'create') => {
    if (!walletCandidate) {
      return;
    }

    if (mode === 'connect' && probeResult && probeResult.installationCount >= 10) {
      setError('Installation limit reached (10/10). Revoke an old installation to continue.');
      return;
    }

    const inboxId = probeResult?.inboxId ?? null;
    const registryEntry = inboxId
      ? registryEntries.find((entry) => entry.inboxId === inboxId)
      : undefined;
    const enableHistorySync = registryEntry ? !registryEntry.hasLocalDB : true;

    setStatusMessage(mode === 'create' ? 'Creating your inbox…' : 'Connecting to your inbox…');
    setView('processing');

    try {
      const label = getPreferredLabel(probeResult?.inboxState?.identifiers, walletCandidate.address);
      const success = await auth.createIdentity(
        walletCandidate.address,
        undefined,
        walletCandidate.chainId,
        walletCandidate.signMessage,
        {
          register: true,
          enableHistorySync,
          label,
        }
      );

      if (!success) {
        throw new Error('createIdentity returned false');
      }

      if (mode === 'connect' && inboxId) {
        setCurrentInbox(inboxId);
      }

      navigate('/');
    } catch (err) {
      console.error('[Onboarding] Failed to finalize wallet identity:', err);
      setError(
        mode === 'create'
          ? 'Failed to create a new inbox. Please try again.'
          : 'Failed to connect this identity. Please try again.'
      );
      setView('results');
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
      navigate('/');
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
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-primary-950 via-primary-900 to-primary-800 p-4">
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
            <div className="mt-2 text-xl font-semibold text-primary-50">Connect identity</div>
            <div className="mt-1 text-sm text-primary-200">
              Attach an existing XMTP identity via WalletConnect, MetaMask, Coinbase Wallet, and more.
            </div>
          </button>
          <button
            onClick={handleCreateGeneratedIdentity}
            className="w-full rounded-xl border border-primary-800/60 bg-primary-950/70 p-6 transition hover:border-accent-400 hover:bg-primary-900/60"
          >
            <div className="text-3xl">✨</div>
            <div className="mt-2 text-xl font-semibold text-primary-50">Create new identity</div>
            <div className="mt-1 text-sm text-primary-200">
              We&rsquo;ll generate everything for you instantly — no passphrases or extra steps.
            </div>
          </button>
        </div>

        {sortedRegistry.length > 0 && renderLocalRegistry(null)}
      </div>
    </div>
  );

  const renderWalletSelection = () => (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-primary-950 via-primary-900 to-primary-800 p-4">
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

  const renderLoading = (message: string) => (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-primary-950 via-primary-900 to-primary-800 p-4">
      <div className="w-full max-w-md space-y-4 text-center">
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full border border-primary-700/60 bg-primary-900/60">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-accent-400 border-t-transparent" />
        </div>
        <h2 className="text-2xl font-semibold text-primary-50">{message}</h2>
        <p className="text-sm text-primary-300">
          {view === 'probing'
            ? 'We probe with disableAutoRegister so nothing is created without your approval.'
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
    const remoteIdentifiers = probeResult.inboxState?.identifiers ?? [];
    const recoveryIdentifier = probeResult.inboxState?.recoveryIdentifier;
    const recoveryAddress = recoveryIdentifier ? `0x${recoveryIdentifier.identifier}` : null;
    const installationCount = probeResult.installationCount ?? 0;
    const installationWarning = installationCount >= 8 && installationCount < 10;
    const installationBlocked = installationCount >= 10;
    const hasInbox = probeResult.isRegistered && Boolean(probeResult.inboxId);
    const preferredLabel = getPreferredLabel(remoteIdentifiers, walletCandidate.address);

    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-primary-950 via-primary-900 to-primary-800 p-4">
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
                  onClick={() => {
                    resetWalletFlow();
                    setView('wallet');
                  }}
                  className="self-end rounded-md border border-primary-700 bg-primary-900 px-4 py-2 text-sm font-medium text-primary-200 transition hover:border-primary-500 hover:text-primary-100"
                >
                  Switch identity
                </button>
                <button
                  onClick={() => {
                    resetWalletFlow();
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
                <h3 className="text-lg font-semibold text-primary-50">XMTP inbox</h3>
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
                  <div className="mt-2 text-sm text-primary-200">
                    No XMTP inbox is registered for this wallet yet.
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
                    {remoteIdentifiers.map((identifier) => (
                      <li key={`${identifier.identifier}-${identifier.identifierKind}`}>
                        {identifier.identifierKind}: {formatIdentifier(identifier)}
                      </li>
                    ))}
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
                  <button
                    onClick={() => finalizeWalletIdentity('connect')}
                    disabled={installationBlocked}
                    className="w-full rounded-md border border-accent-500/60 bg-accent-600/90 px-4 py-3 text-sm font-semibold text-white shadow transition hover:bg-accent-500 disabled:cursor-not-allowed disabled:border-primary-700 disabled:bg-primary-900 disabled:text-primary-400"
                  >
                    Connect to this inbox
                  </button>
                ) : (
                  <button
                    onClick={() => finalizeWalletIdentity('create')}
                    className="w-full rounded-md border border-accent-500/60 bg-transparent px-4 py-3 text-sm font-semibold text-accent-200 transition hover:border-accent-400 hover:bg-accent-500/10"
                  >
                    Create new inbox with this wallet
                  </button>
                )}
              </div>
            </div>

            {renderLocalRegistry(probeResult.inboxId ?? null)}
          </div>

          <div className="rounded-xl border border-primary-800/40 bg-primary-950/40 p-4 text-xs text-primary-300">
            XMTP associates one inbox per identity. If you need a fresh start, you can always create a brand-new inbox with the
            connect wallet button above. History stays with the original inbox.
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
