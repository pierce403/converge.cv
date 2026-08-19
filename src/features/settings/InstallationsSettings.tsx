/**
 * XMTP Installations Management
 */

import { useCallback, useState, useEffect, useRef } from 'react';
import { IdentifierKind, type Identifier } from '@xmtp/browser-sdk';
import { useAuthStore } from '@/lib/stores';
import { getXmtpClient, type XmtpIdentity } from '@/lib/xmtp';
import { installationIdsMatch } from '@/lib/xmtp/client-registration';
import { useXmtpStore } from '@/lib/stores/xmtp-store';
import { useWalletConnection, wagmiConfigNative } from '@/lib/wagmi';
import { getPublicClient } from '@wagmi/core';
import {
  ethereumAddressesEqual,
  normalizeEthereumAddress,
} from '@/lib/utils/ethereum';
import { classifyWalletBytecode } from '@/lib/wagmi/wallet-account';
import {
  walletInspectionChainIds,
  withWalletInspectionTimeout,
} from '@/lib/wagmi/wallet-inspection';
import { formatWalletConnectionError } from '@/features/auth/wallet-connection-error';

interface KeyPackageStatus {
  lifetime?: {
    notAfter?: bigint;
    notBefore?: bigint;
  };
  validationError?: string;
}

interface Installation {
  id: string;
  bytes: Uint8Array;
  clientTimestampNs?: bigint;
  keyPackageStatus?: KeyPackageStatus;
}

interface SafeInboxState {
  inboxId?: string;
  recoveryIdentifier?: Identifier;
  accountIdentifiers?: Identifier[];
  installations?: Array<{ id: string; bytes: Uint8Array; clientTimestampNs?: bigint }>;
}

async function resolveWalletType(
  accountAddress: string,
  connectedChainId?: number
): Promise<{ walletType: 'EOA' | 'SCW'; chainId?: number }> {
  for (const inspectionChainId of walletInspectionChainIds(connectedChainId)) {
    try {
      const publicClient = getPublicClient(wagmiConfigNative, {
        chainId: inspectionChainId,
      });
      if (!publicClient) continue;
      const bytecode = await withWalletInspectionTimeout(
        publicClient.getBytecode({ address: accountAddress as `0x${string}` })
      );
      if (classifyWalletBytecode(bytecode) === 'SCW') {
        return { walletType: 'SCW', chainId: inspectionChainId };
      }
    } catch (error) {
      console.warn(`[Installations] Bytecode inspection on chain ${inspectionChainId} failed:`, error);
    }
  }
  return { walletType: 'EOA', chainId: connectedChainId };
}

export function InstallationsSettings() {
  const identity = useAuthStore((state) => state.identity);
  const connectionStatus = useXmtpStore((state) => state.connectionStatus);
  const installationRecovery = useXmtpStore((state) => state.installationRecovery);
  const [installations, setInstallations] = useState<Installation[]>([]);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [isFetchingStatuses, setIsFetchingStatuses] = useState(false);
  const [verifiedCurrentInstallationId, setVerifiedCurrentInstallationId] = useState<string | null>(null);
  const [recoveryAddress, setRecoveryAddress] = useState<string | null>(null);
  const [pendingRevocation, setPendingRevocation] = useState<{ id: string; bytes: Uint8Array } | null>(null);
  const [showRecoveryWalletModal, setShowRecoveryWalletModal] = useState(false);
  const [recoveryWalletError, setRecoveryWalletError] = useState<string | null>(null);
  const [isRevokingWithWallet, setIsRevokingWithWallet] = useState(false);
  const loadGenerationRef = useRef(0);

  const {
    connectWallet,
    walletOptions,
    isConnected: isWalletConnected,
    address: connectedWalletAddress,
    chainId: connectedWalletChainId,
    signMessage,
  } = useWalletConnection();

  const isDirectRecoverySigner = Boolean(
    identity?.privateKey &&
      (!recoveryAddress || (identity?.address && ethereumAddressesEqual(identity.address, recoveryAddress)))
  );

  const loadInstallations = useCallback(async () => {
    const loadGeneration = ++loadGenerationRef.current;
    const isCurrentLoad = () => loadGeneration === loadGenerationRef.current;
    setIsLoading(true);
    setError(null);
    setVerifiedCurrentInstallationId(null);
    try {
      const xmtp = getXmtpClient();
      console.log('[Installations] Loading installations, connected:', xmtp.isConnected());
      const inboxState = (
        xmtp.isConnected()
          ? await xmtp.getInboxState()
          : identity?.inboxId
            ? await xmtp.getInboxStateById(identity.inboxId)
            : await xmtp.getInboxState()
      ) as unknown as SafeInboxState;
      if (!isCurrentLoad()) return;
      console.log('[Installations] Inbox state:', inboxState);

      const recoveryIdent = inboxState?.recoveryIdentifier;
      let recAddress: string | null = null;
      if (recoveryIdent?.identifierKind === IdentifierKind.Ethereum && recoveryIdent.identifier) {
        recAddress = normalizeEthereumAddress(recoveryIdent.identifier);
      }
      setRecoveryAddress(recAddress);

      // Sort installations by creation date (newest first)
      const sortedInstallations = [...(inboxState?.installations || [])].sort((a, b) => {
        const aTime = a.clientTimestampNs || 0n;
        const bTime = b.clientTimestampNs || 0n;
        return aTime > bTime ? -1 : aTime < bTime ? 1 : 0;
      });

      console.log('[Installations] Found', sortedInstallations.length, 'installations');
      setHasLoaded(true);

      const liveInstallationId = xmtp.getInstallationId();
      const verifiedLiveInstallationId = liveInstallationId
        ? sortedInstallations.find((installation) =>
            installationIdsMatch(installation.id, liveInstallationId)
          )?.id ?? null
        : null;
      setVerifiedCurrentInstallationId(verifiedLiveInstallationId);

      // Fetch key package statuses for all installations (requires connection)
      if (xmtp.isConnected() && sortedInstallations.length > 0) {
        try {
          const installationIds = sortedInstallations.map((inst) => inst.id);
          const statuses = await xmtp.getKeyPackageStatuses(installationIds);

          const installationsWithStatus = sortedInstallations.map((installation) => ({
            ...installation,
            keyPackageStatus: statuses.get(installation.id),
          }));

          if (!isCurrentLoad()) return;
          setInstallations(installationsWithStatus as unknown as Installation[]);
        } catch (statusErr) {
          if (!isCurrentLoad()) return;
          console.warn('[Installations] Failed to fetch key package statuses:', statusErr);
          // Still show installations even if status fetch fails
          setInstallations(sortedInstallations as unknown as Installation[]);
        }
      } else {
        // Show installations without status if not connected
        setInstallations(sortedInstallations as unknown as Installation[]);
      }
    } catch (err) {
      if (!isCurrentLoad()) return;
      setHasLoaded(false);
      console.error('[Installations] Failed to load:', err);
      const errorMsg = err instanceof Error ? err.message : 'Failed to load installations';

      // Provide helpful error messages
      if (errorMsg.includes('Client not connected')) {
        setError('XMTP not connected. Please connect first to view installations.');
      } else {
        setError(errorMsg);
      }
    } finally {
      if (isCurrentLoad()) {
        setIsLoading(false);
      }
    }
  }, [identity?.inboxId]);

  const refreshStatuses = async () => {
    setIsFetchingStatuses(true);
    setError(null);
    try {
      const xmtp = getXmtpClient();
      if (!xmtp.isConnected()) {
        setError('Must be connected to XMTP to fetch key package statuses.');
        return;
      }
      if (installations.length === 0) return;
      const installationIds = installations.map((i) => i.id);
      const statuses = await xmtp.getKeyPackageStatuses(installationIds);
      const updated = installations.map((inst) => ({
        ...inst,
        keyPackageStatus: statuses.get(inst.id),
      }));
      setInstallations(updated);
    } catch (err) {
      console.error('[Installations] Status refresh failed:', err);
      setError(err instanceof Error ? err.message : 'Failed to refresh statuses');
    } finally {
      setIsFetchingStatuses(false);
    }
  };

  useEffect(() => {
    if (
      connectionStatus === 'connected' ||
      connectionStatus === 'error' ||
      (connectionStatus === 'disconnected' && identity?.inboxId)
    ) {
      void loadInstallations();
    } else {
      setHasLoaded(false);
      setVerifiedCurrentInstallationId(null);
    }
    return () => {
      loadGenerationRef.current += 1;
    };
  }, [connectionStatus, identity?.inboxId, loadInstallations]);

  const executeRevocation = async (
    target: { id: string; bytes: Uint8Array },
    signerIdentity: XmtpIdentity,
    inboxId: string
  ) => {
    setRevokingId(target.id);
    setError(null);
    try {
      const xmtp = getXmtpClient();
      console.log('[Installations] Revoking installation:', target.id, 'with identity:', signerIdentity.address);
      await xmtp.revokeInstallationsWithRecoveryIdentity(
        signerIdentity,
        inboxId,
        [target.bytes]
      );
      console.log('[Installations] ✅ Revocation successful');
      alert('Installation revoked successfully!');
      setShowRecoveryWalletModal(false);
      setPendingRevocation(null);
      await loadInstallations();
    } catch (err) {
      console.error('[Installations] Failed to revoke:', err);
      throw err;
    } finally {
      setRevokingId(null);
    }
  };

  const handleRevoke = async (installationBytes: Uint8Array, installationId: string) => {
    if (!verifiedCurrentInstallationId) {
      setError('Reconnect XMTP and refresh installations before revoking a device.');
      return;
    }
    const targetInboxId = identity?.inboxId;
    if (!targetInboxId) {
      setError('Inbox ID is unavailable. Please reconnect.');
      return;
    }

    const target = { id: installationId, bytes: installationBytes };

    // 1. If local key is the recovery signer (e.g. standalone Converge inbox):
    if (isDirectRecoverySigner && identity?.privateKey && identity?.address) {
      if (
        !confirm(
          'Are you sure you want to revoke this installation? That device will no longer be able to send or receive messages.'
        )
      ) {
        return;
      }
      try {
        await executeRevocation(
          target,
          {
            address: identity.address,
            privateKey: identity.privateKey,
            inboxId: targetInboxId,
          },
          targetInboxId
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to revoke installation');
      }
      return;
    }

    // 2. If recovery wallet is connected:
    const hasMatchingConnectedWallet =
      isWalletConnected &&
      Boolean(connectedWalletAddress) &&
      Boolean(recoveryAddress) &&
      ethereumAddressesEqual(connectedWalletAddress, recoveryAddress);

    if (hasMatchingConnectedWallet && signMessage) {
      if (
        !confirm(
          `Revoke installation ${formatInstallationId(installationId)}?\n\nThis will send an XMTP revocation signature request to your connected recovery wallet (${formatInstallationId(recoveryAddress!)}).`
        )
      ) {
        return;
      }
      try {
        let walletType: 'EOA' | 'SCW' = 'EOA';
        let chainId = connectedWalletChainId;
        try {
          const inspectionResult = await resolveWalletType(connectedWalletAddress!, connectedWalletChainId);
          walletType = inspectionResult.walletType;
          chainId = inspectionResult.chainId;
        } catch (inspErr) {
          console.warn('[Installations] Could not inspect wallet bytecode:', inspErr);
        }
        await executeRevocation(
          target,
          {
            address: connectedWalletAddress!,
            chainId,
            walletType,
            signMessage: async (msg) => await signMessage(msg, connectedWalletAddress!),
          },
          targetInboxId
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to revoke installation');
      }
      return;
    }

    // 3. Otherwise open the recovery wallet modal
    setPendingRevocation(target);
    setRecoveryWalletError(null);
    setShowRecoveryWalletModal(true);
  };

  const formatInstallationId = (id: string) => {
    if (id.length <= 16) return id;
    return `${id.substring(0, 8)}...${id.substring(id.length - 8)}`;
  };

  const formatTimestamp = (timestampNs?: bigint) => {
    if (!timestampNs) return 'Unknown';
    try {
      const ms = Number(timestampNs) / 1_000_000;
      const date = new Date(ms);
      const now = Date.now();
      const diff = now - ms;

      // Show relative time if within last 30 days
      if (diff < 30 * 24 * 60 * 60 * 1000) {
        const seconds = Math.floor(diff / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        if (days > 0) return `${days}d ago`;
        if (hours > 0) return `${hours}h ago`;
        if (minutes > 0) return `${minutes}m ago`;
        return 'Just now';
      }

      return date.toLocaleDateString();
    } catch {
      return 'Unknown';
    }
  };

  const formatExpiry = (notAfter?: bigint) => {
    if (!notAfter) return null;
    try {
      const ms = Number(notAfter) * 1000; // notAfter is in seconds
      const now = Date.now();
      const diff = ms - now;

      if (diff < 0) return 'Expired';

      const days = Math.floor(diff / (24 * 60 * 60 * 1000));
      if (days > 365) return `${Math.floor(days / 365)}y`;
      if (days > 30) return `${Math.floor(days / 30)}mo`;
      if (days > 0) return `${days}d`;

      const hours = Math.floor(diff / (60 * 60 * 1000));
      return `${hours}h`;
    } catch {
      return null;
    }
  };

  const currentInstallationId = verifiedCurrentInstallationId;

  return (
    <section>
      <h2 className="text-lg font-semibold mb-3">XMTP Installations</h2>
      <div className="bg-primary-900/60 border border-primary-800/60 rounded-lg p-4 space-y-4 backdrop-blur">
        <div className="text-sm text-primary-200">
          <p className="mb-2">
            Each device where you use Converge registers an installation with XMTP.
            You can have up to <strong>10 installations</strong> per inbox.
          </p>
          {currentInstallationId && (
            <div className="mt-2 p-3 bg-primary-950/30 rounded border border-primary-800/60">
              <div className="font-medium text-primary-100">This Device</div>
              <div className="text-xs text-primary-200 font-mono mt-1">
                {formatInstallationId(currentInstallationId)}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3">
          <h3 className="font-medium text-primary-100">
            {hasLoaded
              ? `All Installations (${installations.length}/10)`
              : 'All Installations (checking...)'}
          </h3>
          <div className="flex items-center gap-3">
            <button
              onClick={loadInstallations}
              disabled={
                isLoading ||
                connectionStatus === 'connecting'
              }
              className="text-sm text-accent-300 hover:text-accent-200 disabled:opacity-50"
              title="Fetch latest inbox state from the network"
            >
              {isLoading ? 'Refreshing…' : 'Force Network Refresh'}
            </button>
            <button
              onClick={refreshStatuses}
              disabled={
                isFetchingStatuses ||
                isLoading ||
                installations.length === 0 ||
                connectionStatus !== 'connected'
              }
              className="text-sm text-green-400 hover:text-green-300 disabled:opacity-50"
              title="Fetch key package statuses for current installations"
            >
              {isFetchingStatuses ? 'Fetching Statuses…' : 'Fetch Statuses'}
            </button>
          </div>
        </div>

        {error && (
          <div className="p-3 bg-red-500/10 border border-red-500/20 rounded text-sm text-red-400">
            {error}
          </div>
        )}

        {!hasLoaded && connectionStatus === 'connecting' && !error && (
          <div className="p-3 bg-primary-950/30 border border-primary-800/60 rounded text-sm text-primary-200">
            Waiting for XMTP to reconnect before loading installation state.
          </div>
        )}

        {!isLoading && installations.length > 0 && !verifiedCurrentInstallationId && (
          <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded text-sm text-amber-200">
            <div>This browser installation could not be verified against the live inbox state. Revocation is disabled until XMTP reconnects and the list is refreshed.</div>
            {installationRecovery && (
              <div className="mt-2 text-xs">
                Use <strong>Repair This Browser</strong> in Identity &amp; Connection above when it is offered. Ambiguous or full-inbox states stay read-only.
              </div>
            )}
          </div>
        )}

        {isLoading && !error && (
          <div className="text-center py-8 text-primary-200">
            <div className="animate-spin inline-block w-6 h-6 border-2 border-current border-t-transparent rounded-full" />
          </div>
        )}

        {!isLoading && installations.length > 0 && (
          <div className="space-y-2">
            {/* Guidance for users */}
            <div className="text-xs text-primary-300 bg-primary-950/40 p-2 rounded border border-primary-800/40 mb-3">
              <span className="font-medium">Safe to revoke:</span>{' '}
              <span className="text-yellow-400">Expired</span> or{' '}
              <span className="text-red-400">Error</span> installations.
              Creation date doesn't indicate activity — an old installation may still be active on another device.
            </div>
            {installations.map((installation) => {
              const isCurrentDevice = installationIdsMatch(
                installation.id,
                currentInstallationId
              );
              const isUnavailableSavedInstallation = Boolean(
                installationIdsMatch(
                  installation.id,
                  installationRecovery?.expectedInstallationId
                ) ||
                  installationIdsMatch(
                    installation.id,
                    identity?.staleInstallationId
                  )
              );
              const isRevoking = revokingId === installation.id;
              const hasError = !!installation.keyPackageStatus?.validationError;
              const expiry = formatExpiry(installation.keyPackageStatus?.lifetime?.notAfter);
              const isExpired = expiry === 'Expired';

              return (
                <div
                  key={installation.id}
                  className={`p-3 rounded border ${
                    isCurrentDevice
                      ? 'bg-accent-500/10 border-accent-400/30'
                      : hasError || isExpired
                      ? 'bg-red-500/10 border-red-500/30'
                      : 'bg-primary-950/30 border-primary-800/60'
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-primary-100">
                          {formatInstallationId(installation.id)}
                        </span>
                        {isCurrentDevice && (
                          <span className="text-xs px-2 py-0.5 bg-accent-500/20 text-accent-200 rounded">
                            This Device
                          </span>
                        )}
                        {isUnavailableSavedInstallation && !isCurrentDevice && (
                          <span className="text-xs px-2 py-0.5 bg-yellow-500/20 text-yellow-300 rounded">
                            Saved, unavailable here
                          </span>
                        )}
                        {hasError && (
                          <span className="text-xs px-2 py-0.5 bg-red-500/20 text-red-400 rounded" title="This installation has errors - safe to revoke">
                            Error
                          </span>
                        )}
                        {isExpired && (
                          <span className="text-xs px-2 py-0.5 bg-yellow-500/20 text-yellow-400 rounded" title="Key package expired - safe to revoke">
                            Expired
                          </span>
                        )}
                        {expiry && !isExpired && (
                          <span className="text-xs px-2 py-0.5 bg-green-500/20 text-green-400 rounded">
                            Expires in {expiry}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-primary-200 mt-1 space-y-0.5">
                        <div>Created: {formatTimestamp(installation.clientTimestampNs)}</div>
                        {hasError && (
                          <div className="text-red-400 font-mono text-xs break-all">
                            {installation.keyPackageStatus?.validationError}
                          </div>
                        )}
                      </div>
                    </div>
                    {!isCurrentDevice && (
                      <button
                        onClick={() => handleRevoke(installation.bytes, installation.id)}
                        disabled={isRevoking || !verifiedCurrentInstallationId}
                        className="px-3 py-1 text-xs bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded border border-red-500/30 disabled:opacity-50 transition-colors"
                      >
                        {isRevoking ? 'Revoking...' : 'Revoke'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {!isLoading && hasLoaded && installations.length === 0 && !error && (
          <div className="text-center py-8 text-primary-200 text-sm">
            No installations found. Try connecting to XMTP first.
          </div>
        )}
      </div>

      {showRecoveryWalletModal && pendingRevocation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="relative w-full max-w-md rounded-2xl border border-primary-800/70 bg-primary-950/95 p-6 text-primary-50 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold">Authorize Revocation</h3>
              <button
                type="button"
                onClick={() => {
                  setShowRecoveryWalletModal(false);
                  setPendingRevocation(null);
                  setRecoveryWalletError(null);
                }}
                className="rounded-full p-1.5 text-primary-300 transition hover:bg-primary-900/70"
                aria-label="Close modal"
              >
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <path d="M6 6l12 12M6 18L18 6" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>

            <p className="text-xs text-primary-200">
              XMTP protocol rules require authorization from the inbox <strong>Recovery Wallet</strong> to revoke device installations.
            </p>

            {recoveryAddress && (
              <div className="rounded-lg border border-primary-800/60 bg-primary-900/40 p-3 space-y-1">
                <div className="text-xs font-semibold uppercase tracking-wider text-primary-300">
                  Required Recovery Wallet
                </div>
                <div className="font-mono text-xs text-accent-300 break-all">
                  {recoveryAddress}
                </div>
              </div>
            )}

            {recoveryWalletError && (
              <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-300">
                {recoveryWalletError}
              </div>
            )}

            {isWalletConnected && connectedWalletAddress && (
              <div className="text-xs text-primary-300">
                Currently connected: <span className="font-mono text-primary-100">{formatInstallationId(connectedWalletAddress)}</span>
                {recoveryAddress && !ethereumAddressesEqual(connectedWalletAddress, recoveryAddress) && (
                  <div className="text-yellow-400 mt-1">
                    Connected address does not match the recovery wallet. Connect the recovery wallet below.
                  </div>
                )}
              </div>
            )}

            <div className="space-y-2 pt-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-primary-300">
                Connect Recovery Wallet
              </div>
              <div className="space-y-2">
                {walletOptions.map((option) => (
                  <button
                    key={option.id}
                    onClick={async () => {
                      setRecoveryWalletError(null);
                      setIsRevokingWithWallet(true);
                      try {
                        const connected = await connectWallet(option);
                        const address = connected?.accounts?.[0];
                        if (!address || !connected?.signMessage) {
                          throw new Error('Wallet connected without an account-bound signer. Please reconnect.');
                        }
                        if (recoveryAddress && !ethereumAddressesEqual(address, recoveryAddress)) {
                          throw new Error(
                            `Connected wallet (${formatInstallationId(address)}) does not match the recovery wallet (${formatInstallationId(recoveryAddress)}). Please switch to the recovery account in your wallet.`
                          );
                        }
                        let walletType: 'EOA' | 'SCW' = 'EOA';
                        let chainId = connected.chainId;
                        try {
                          const inspectionResult = await resolveWalletType(address, connected.chainId);
                          walletType = inspectionResult.walletType;
                          chainId = inspectionResult.chainId;
                        } catch (inspErr) {
                          console.warn('[Installations] Could not inspect wallet bytecode:', inspErr);
                        }
                        await executeRevocation(
                          pendingRevocation,
                          {
                            address,
                            chainId,
                            walletType,
                            signMessage: connected.signMessage,
                          },
                          identity?.inboxId ?? ''
                        );
                      } catch (err) {
                        setRecoveryWalletError(formatWalletConnectionError(err));
                      } finally {
                        setIsRevokingWithWallet(false);
                      }
                    }}
                    disabled={isRevokingWithWallet || option.disabled}
                    className="w-full p-3 bg-primary-950/60 hover:bg-primary-900 border border-primary-800/60 hover:border-accent-400 rounded-lg flex items-center gap-3 transition-colors text-left disabled:opacity-50"
                  >
                    <span className="text-2xl">{option.icon}</span>
                    <div>
                      <div className="text-sm font-medium text-primary-50">{option.name}</div>
                      {option.description && (
                        <div className="text-xs text-primary-300">{option.description}</div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

