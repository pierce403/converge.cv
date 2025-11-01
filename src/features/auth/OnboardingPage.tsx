/**
 * Onboarding page for new users
 */

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './useAuth';
import { privateKeyToAccount } from 'viem/accounts';
import { WalletSelector } from './WalletSelector';
import { useSignMessage } from 'wagmi';
import { useInboxRegistryStore, getInboxDisplayLabel } from '@/lib/stores';
import type { Identifier } from '@xmtp/browser-sdk';
import type { IdentityProbeResult } from '@/lib/xmtp/client';
import type { InboxRegistryEntry } from '@/types';

const shortAddress = (value: string) => `${value.slice(0, 6)}…${value.slice(-4)}`;
const normalizeAddress = (value: string) => value.toLowerCase();
const identifierHexFromAddress = (value: string) => normalizeAddress(value).replace(/^0x/, '');
interface PendingIdentity {
  address: string;
  privateKey?: string;
  chainId?: number;
  signMessage?: (message: string) => Promise<string>;
  source: 'generated' | 'wallet';
}

const getRemoteAccessInfo = (
  probe: IdentityProbeResult | null,
  identity: PendingIdentity | null
) => {
  if (!probe || !identity) {
    return {
      remoteExists: false,
      canAttach: false,
      isRecoveryIdentity: false,
      recoveryAddress: undefined as string | undefined,
      remoteIdentifiers: [] as Identifier[],
    };
  }

  const remoteExists = probe.isRegistered && Boolean(probe.inboxId);
  const remoteIdentifiers = probe.inboxState?.identifiers ?? [];
  const normalizedIdentifier = identifierHexFromAddress(identity.address);
  const isRecoveryIdentity =
    probe.inboxState?.recoveryIdentifier?.identifier?.toLowerCase() === normalizedIdentifier;
  const isLinkedIdentity = remoteIdentifiers.some(
    (identifier) =>
      identifier.identifierKind === 'Ethereum' && identifier.identifier.toLowerCase() === normalizedIdentifier
  );
  const recoveryAddress = probe.inboxState?.recoveryIdentifier
    ? `0x${probe.inboxState.recoveryIdentifier.identifier}`
    : undefined;

  return {
    remoteExists,
    canAttach: remoteExists && (isRecoveryIdentity || isLinkedIdentity),
    isRecoveryIdentity,
    recoveryAddress,
    remoteIdentifiers,
  };
};

type FlowKind = 'connect' | 'recover' | 'create';
type Step = 'landing' | 'source' | 'wallet' | 'probing' | 'results' | 'processing';

function renderRegistryEntry(
  entry: InboxRegistryEntry,
  onOpen: (entry: InboxRegistryEntry) => void,
  isActive: boolean
) {
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
          <div className="text-xs text-primary-300 break-all">
            Inbox ID: {entry.inboxId}
          </div>
          <div className="text-xs text-primary-400 mt-1">
            Primary identity: {entry.primaryDisplayIdentity}
          </div>
          <div className="text-xs text-primary-500 mt-1">
            Last opened: {entry.lastOpenedAt ? new Date(entry.lastOpenedAt).toLocaleString() : 'never'}
          </div>
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
}

function RecoveryNotice({
  recoveryAddress,
  isCurrentIdentityRecovery,
}: {
  recoveryAddress: string | undefined;
  isCurrentIdentityRecovery: boolean;
}) {
  if (!recoveryAddress) {
    return null;
  }

  if (isCurrentIdentityRecovery) {
    return (
      <div className="mt-3 rounded-md border border-amber-400/40 bg-amber-900/20 px-4 py-3 text-xs text-amber-200">
        You are using this inbox&rsquo;s designated recovery identity (<code className="font-mono text-amber-100">{recoveryAddress}</code>
        ). Recovery identities cannot be reassigned without rotating recovery from within that inbox first.
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-md border border-sky-400/40 bg-sky-900/20 px-4 py-3 text-xs text-sky-200">
      Recovery identity for this inbox: <code className="font-mono text-sky-100">{recoveryAddress}</code>. To recover or manage
      installations you&rsquo;ll need to connect with that identity.
    </div>
  );
}

export function OnboardingPage() {
  const navigate = useNavigate();
  const auth = useAuth();
  const { signMessageAsync } = useSignMessage();

  const hydrateRegistry = useInboxRegistryStore((state) => state.hydrate);
  const registryEntries = useInboxRegistryStore((state) => state.entries);
  const setCurrentInbox = useInboxRegistryStore((state) => state.setCurrentInbox);

  const [step, setStep] = useState<Step>('landing');
  const [flow, setFlow] = useState<FlowKind | null>(null);
  const [pendingIdentity, setPendingIdentity] = useState<PendingIdentity | null>(null);
  const [probeResult, setProbeResult] = useState<IdentityProbeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmCreate, setConfirmCreate] = useState(false);
  const [statusMessage, setStatusMessage] = useState('Connecting to XMTP…');

  useEffect(() => {
    hydrateRegistry();
  }, [hydrateRegistry]);

  useEffect(() => {
    if (step !== 'results') {
      setConfirmCreate(false);
    }
  }, [step]);

  const sortedRegistry = useMemo(
    () => [...registryEntries].sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0)),
    [registryEntries]
  );

  const resetFlow = () => {
    setPendingIdentity(null);
    setProbeResult(null);
    setError(null);
    setConfirmCreate(false);
  };

  const startFlow = (next: FlowKind) => {
    resetFlow();
    setFlow(next);
    setStep('source');
  };

  const handleGenerateLocalIdentity = async () => {
    setError(null);
    setConfirmCreate(false);
    setStep('probing');

    try {
      const privateKeyBytes = crypto.getRandomValues(new Uint8Array(32));
      const privateKeyHex = (`0x${Array.from(privateKeyBytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')}`) as `0x${string}`;
      const account = privateKeyToAccount(privateKeyHex);
      const candidate: PendingIdentity = {
        address: account.address,
        privateKey: privateKeyHex,
        source: 'generated',
      };
      setPendingIdentity(candidate);
      const result = await auth.probeIdentity(candidate.address, candidate.privateKey);
      setProbeResult(result);
      setStep('results');
    } catch (err) {
      console.error('[Onboarding] Failed to generate identity:', err);
      setError('Unable to generate an identity. Please try again.');
      setStep('source');
    }
  };

  const runProbe = async (candidate: PendingIdentity) => {
    setError(null);
    setConfirmCreate(false);
    setPendingIdentity(candidate);
    setStep('probing');

    try {
      const result = await auth.probeIdentity(
        candidate.address,
        candidate.privateKey,
        candidate.chainId,
        candidate.signMessage
      );
      setProbeResult(result);
      setStep('results');
    } catch (err) {
      console.error('[Onboarding] Probe failed:', err);
      setError('Unable to reach XMTP to inspect this identity. Please try again.');
      setStep('source');
    }
  };

  const handleWalletConnected = async (address: string, chainId?: number) => {
    const candidate: PendingIdentity = {
      address,
      chainId,
      signMessage: async (message: string) => await signMessageAsync({ message }),
      source: 'wallet',
    };
    await runProbe(candidate);
  };

  const handleCreateInbox = async () => {
    if (!pendingIdentity) {
      return;
    }

    if (!confirmCreate) {
      setConfirmCreate(true);
      return;
    }

    await finalizeConnection('create');
  };

  const finalizeConnection = async (mode: 'attach' | 'create') => {
    if (!pendingIdentity) {
      return;
    }

    if (mode === 'attach') {
      const { canAttach, recoveryAddress } = getRemoteAccessInfo(probeResult, pendingIdentity);
      if (!canAttach) {
        setError(
          recoveryAddress
            ? `Connect with the recovery identity (${recoveryAddress}) to manage installations for this inbox.`
            : 'This identity cannot attach to that inbox. Try another identity.'
        );
        setStep('results');
        return;
      }
    }

    setError(null);
    setStatusMessage(mode === 'create' ? 'Creating your inbox…' : 'Connecting to your inbox…');
    setStep('processing');

    try {
      const remoteInboxId = probeResult?.inboxId ?? null;
      const registryEntry = remoteInboxId
        ? registryEntries.find((entry) => entry.inboxId === remoteInboxId)
        : undefined;
      const enableHistorySync = mode === 'create' ? true : !(registryEntry?.hasLocalDB ?? false);

      const success = await auth.createIdentity(
        pendingIdentity.address,
        pendingIdentity.privateKey,
        pendingIdentity.chainId,
        pendingIdentity.signMessage,
        {
          register: true,
          enableHistorySync,
          label: pendingIdentity.source === 'generated' ? `Identity ${shortAddress(pendingIdentity.address)}` : undefined,
        }
      );

      if (success) {
        navigate('/');
        return;
      }

      throw new Error('createIdentity returned false');
    } catch (err) {
      console.error('[Onboarding] finalizeConnection error:', err);
      setError(
        mode === 'create'
          ? 'Failed to create a new inbox. Revoke any stale installs and try again.'
          : 'Failed to connect this identity. Check installation limits and try again.'
      );
      setStep('results');
    }
  };

  const handleOpenLocalInbox = async (entry: InboxRegistryEntry) => {
    setStatusMessage('Opening local inbox…');
    setStep('processing');
    setError(null);

    try {
      setCurrentInbox(entry.inboxId);
      const success = await auth.checkExistingIdentity();
      if (success) {
        navigate('/');
        return;
      }
      throw new Error('Unable to rehydrate identity');
    } catch (err) {
      console.error('[Onboarding] Failed to open local inbox:', err);
      setError('Unable to open that inbox from local storage. Try reconnecting its identity.');
      setStep('results');
    }
  };

  const renderLanding = () => (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-primary-950 via-primary-900 to-primary-800 p-4">
      <div className="w-full max-w-xl space-y-8 text-center">
        <div>
          <div className="mx-auto mb-4 flex h-24 w-24 items-center justify-center rounded-full border border-primary-700/60 bg-primary-900/60 shadow-lg">
            <span className="text-4xl font-bold text-accent-300">C</span>
          </div>
          <h1 className="text-4xl font-bold text-primary-50">Welcome to Converge</h1>
          <p className="mt-2 text-primary-200">
            Secure, local-first messaging powered by XMTP identities.
          </p>
        </div>

        <div className="grid gap-4">
          <button
            onClick={() => startFlow('connect')}
            className="w-full rounded-xl border border-primary-800/60 bg-primary-950/70 p-6 text-left transition hover:border-accent-400 hover:bg-primary-900/60"
          >
            <div className="text-3xl">🔐</div>
            <div className="mt-2 text-xl font-semibold text-primary-50">Connect identity</div>
            <div className="mt-1 text-sm text-primary-200">
              Attach an existing XMTP identity (EOA, smart contract wallet, or passkey).
            </div>
          </button>
          <button
            onClick={() => startFlow('recover')}
            className="w-full rounded-xl border border-primary-800/60 bg-primary-950/70 p-6 text-left transition hover:border-accent-400 hover:bg-primary-900/60"
          >
            <div className="text-3xl">🛠️</div>
            <div className="mt-2 text-xl font-semibold text-primary-50">Recover inbox</div>
            <div className="mt-1 text-sm text-primary-200">
              Reattach this device to an inbox you already use elsewhere.
            </div>
          </button>
          <button
            onClick={() => startFlow('create')}
            className="w-full rounded-xl border border-primary-800/60 bg-primary-950/70 p-6 text-left transition hover:border-accent-400 hover:bg-primary-900/60"
          >
            <div className="text-3xl">✨</div>
            <div className="mt-2 text-xl font-semibold text-primary-50">Create new inbox</div>
            <div className="mt-1 text-sm text-primary-200">
              Generate a fresh XMTP identity with explicit confirmation.
            </div>
          </button>
        </div>
      </div>
    </div>
  );

  const renderSourceSelection = () => (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-primary-950 via-primary-900 to-primary-800 p-4">
      <div className="w-full max-w-xl space-y-6 text-center">
        <div>
          <h2 className="text-3xl font-bold text-primary-50">
            {flow === 'create' ? 'Choose how to create your identity' : 'Choose your identity source'}
          </h2>
          <p className="mt-2 text-primary-200">
            Probe identities safely — nothing is registered without your confirmation.
          </p>
        </div>

        {error && (
          <div className="rounded-lg border border-red-500/60 bg-red-900/30 p-4 text-left text-sm text-red-200">
            {error}
          </div>
        )}

        <div className="space-y-4 text-left">
          <button
            onClick={() => setStep('wallet')}
            className="w-full rounded-xl border border-primary-800/60 bg-primary-950/70 p-5 transition hover:border-accent-400 hover:bg-primary-900/60"
          >
            <div className="text-2xl">🔗</div>
            <div className="mt-2 text-lg font-semibold text-primary-50">Connect existing wallet</div>
            <div className="mt-1 text-sm text-primary-200">
              Supports EOAs and smart contract wallets via WalletConnect, MetaMask, Coinbase Wallet, and more.
            </div>
          </button>
          <button
            onClick={handleGenerateLocalIdentity}
            className="w-full rounded-xl border border-primary-800/60 bg-primary-950/70 p-5 transition hover:border-accent-400 hover:bg-primary-900/60"
          >
            <div className="text-2xl">🧬</div>
            <div className="mt-2 text-lg font-semibold text-primary-50">Generate local identity</div>
            <div className="mt-1 text-sm text-primary-200">
              Create a device-held identity instantly (compatible with future passkey upgrades).
            </div>
          </button>
          <button
            disabled
            className="w-full rounded-xl border border-primary-800/40 bg-primary-950/40 p-5 text-left text-primary-400"
          >
            <div className="text-2xl">🔑</div>
            <div className="mt-2 text-lg font-semibold">Use passkey (coming soon)</div>
            <div className="mt-1 text-sm">Passkey-protected identities are on the roadmap.</div>
          </button>
        </div>

        <button
          onClick={() => setStep('landing')}
          className="text-sm text-primary-300 hover:text-primary-100"
        >
          ← Back
        </button>
      </div>
    </div>
  );

  const renderWalletStep = () => (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-primary-950 via-primary-900 to-primary-800 p-4">
      <WalletSelector
        onWalletConnected={handleWalletConnected}
        onBack={() => {
          setError(null);
          setStep('source');
        }}
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
          {step === 'probing'
            ? 'We probe with disableAutoRegister so no inbox is created or modified without your approval.'
            : 'Hold tight while we finish setting up this device.'}
        </p>
      </div>
    </div>
  );

  const renderResults = () => {
    if (!pendingIdentity || !probeResult) {
      return renderLanding();
    }

    const remoteInboxId = probeResult.inboxId ?? null;
    const installationCount = probeResult.installationCount ?? 0;
    const hasInstallBlock = installationCount >= 10;
    const hasInstallWarning = installationCount >= 8 && installationCount < 10;
    const {
      remoteExists,
      canAttach,
      isRecoveryIdentity,
      recoveryAddress,
      remoteIdentifiers,
    } = getRemoteAccessInfo(probeResult, pendingIdentity);
    const needsRecoveryIdentity = remoteExists && !canAttach && Boolean(recoveryAddress);

    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-primary-950 via-primary-900 to-primary-800 p-4">
        <div className="w-full max-w-4xl space-y-6">
          <div className="rounded-xl border border-primary-800/60 bg-primary-950/70 p-6 shadow-lg">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-sm uppercase tracking-wide text-primary-400">Identity</div>
                <div className="text-2xl font-semibold text-primary-50">{pendingIdentity.address}</div>
                <div className="text-sm text-primary-300">
                  Source: {pendingIdentity.source === 'wallet' ? 'Wallet connector (EOA / SCW)' : 'Generated locally'}
                </div>
              </div>
              <button
                onClick={() => {
                  setError(null);
                  setStep('source');
                }}
                className="self-start rounded-md border border-primary-700 bg-primary-900 px-4 py-2 text-sm font-medium text-primary-200 transition hover:border-primary-500 hover:text-primary-100"
              >
                Choose another identity
              </button>
            </div>
            {error && (
              <div className="mt-4 rounded-md border border-red-500/60 bg-red-900/30 px-4 py-3 text-sm text-red-200">
                {error}
              </div>
            )}
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <div className="rounded-xl border border-primary-800/60 bg-primary-950/70 p-6 shadow-lg">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-primary-50">Remote inbox</h3>
                <span className={`rounded-full px-3 py-1 text-xs font-medium ${remoteExists ? 'bg-emerald-500/20 text-emerald-200' : 'bg-primary-800 text-primary-200'}`}>
                  {remoteExists ? 'Found' : 'Not found'}
                </span>
              </div>

              {remoteExists ? (
                <div className="mt-4 space-y-2 text-sm text-primary-200">
                  <div>
                    Inbox ID: <code className="font-mono text-primary-100">{remoteInboxId}</code>
                  </div>
                  <div>
                    Installations: {installationCount}/10{' '}
                    {hasInstallWarning && <span className="text-amber-300">(warning at 8/10)</span>}
                    {hasInstallBlock && <span className="text-red-300">(limit reached)</span>}
                  </div>
                  {remoteIdentifiers.length > 0 && (
                    <div>
                      Linked identities:
                      <ul className="mt-2 list-disc pl-5 text-xs text-primary-300">
                        {remoteIdentifiers.map((identifier) => (
                          <li key={`${identifier.identifier}-${identifier.identifierKind}`}>
                            0x{identifier.identifier}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <RecoveryNotice
                    recoveryAddress={recoveryAddress}
                    isCurrentIdentityRecovery={isRecoveryIdentity}
                  />
                  {needsRecoveryIdentity && (
                    <div className="mt-3 rounded-md border border-red-400/40 bg-red-900/30 px-4 py-3 text-xs text-red-200">
                      This identity can see the inbox but cannot attach a new installation. Connect using the recovery identity
                      above to continue.
                    </div>
                  )}
                  <div className="text-xs text-primary-300">
                    Moving an identity routes future messages to the new inbox and does not migrate history.
                  </div>
                </div>
              ) : (
                <div className="mt-4 space-y-2 text-sm text-primary-200">
                  <p>No XMTP inbox is currently linked to this identity.</p>
                  <p className="text-xs text-primary-300">
                    You can create one now — creation is always explicit and never happens during probing.
                  </p>
                </div>
              )}

              <div className="mt-6 space-y-2">
                {remoteExists ? (
                  <>
                    <button
                      onClick={() => finalizeConnection('attach')}
                      disabled={hasInstallBlock || !canAttach}
                      className="w-full rounded-md border border-accent-500/60 bg-accent-600/90 px-4 py-3 text-sm font-semibold text-white shadow transition hover:bg-accent-500 disabled:cursor-not-allowed disabled:border-primary-700 disabled:bg-primary-900 disabled:text-primary-400"
                    >
                      {flow === 'recover' ? 'Recover this inbox on this device' : 'Open this inbox'}
                    </button>
                    {hasInstallBlock && (
                      <div className="text-xs text-red-300">
                        Installation limit reached (10/10). Revoke old installations from another device and retry.
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <button
                      onClick={handleCreateInbox}
                      className="w-full rounded-md border border-accent-500/40 bg-transparent px-4 py-3 text-sm font-semibold text-accent-200 transition hover:border-accent-400 hover:bg-accent-500/10"
                    >
                      {confirmCreate ? 'Confirm create new inbox' : 'Create new inbox'}
                    </button>
                    <div className="text-xs text-primary-300">
                      Inboxes cannot be merged. Future messages will land in the new inbox.
                    </div>
                  </>
                )}
              </div>
            </div>

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
                    renderRegistryEntry(entry, handleOpenLocalInbox, remoteInboxId === entry.inboxId)
                  )}
                </div>
              )}

              <div className="mt-6 text-xs text-primary-300">
                Need to connect another identity? You can always do so later from Settings → Identities.
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  if (step === 'landing' || !flow) {
    return renderLanding();
  }

  if (step === 'source') {
    return renderSourceSelection();
  }

  if (step === 'wallet') {
    return renderWalletStep();
  }

  if (step === 'probing') {
    return renderLoading('Checking identity…');
  }

  if (step === 'processing') {
    return renderLoading(statusMessage);
  }

  if (step === 'results') {
    return renderResults();
  }

  return renderLanding();
}
