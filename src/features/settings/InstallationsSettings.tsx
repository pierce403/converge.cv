/**
 * XMTP Installations Management
 */

import { useState, useEffect } from 'react';
import { useAuthStore } from '@/lib/stores';
import { getXmtpClient } from '@/lib/xmtp';

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

export function InstallationsSettings() {
  const identity = useAuthStore((state) => state.identity);
  const [installations, setInstallations] = useState<Installation[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [isFetchingStatuses, setIsFetchingStatuses] = useState(false);
  const [isForceRecovering, setIsForceRecovering] = useState(false);

  const loadInstallations = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const xmtp = getXmtpClient();
      
      // Try to get inbox state even if not connected
      // This allows viewing/revoking installations when connection failed due to 10/10 limit
      console.log('[Installations] Loading installations, connected:', xmtp.isConnected());
      
      type SafeInboxStateLite = {
        installations?: Array<{ id: string; clientTimestampNs?: bigint }>;
      };
      const inboxState = (await xmtp.getInboxState()) as unknown as SafeInboxStateLite;
      console.log('[Installations] Inbox state:', inboxState);
      
      // Sort installations by creation date (newest first)
      const sortedInstallations = [...(inboxState.installations || [])].sort((a, b) => {
        const aTime = a.clientTimestampNs || 0n;
        const bTime = b.clientTimestampNs || 0n;
        return aTime > bTime ? -1 : aTime < bTime ? 1 : 0;
      });

      console.log('[Installations] Found', sortedInstallations.length, 'installations');

      // Fetch key package statuses for all installations (requires connection)
      if (xmtp.isConnected() && sortedInstallations.length > 0) {
        try {
          const installationIds = sortedInstallations.map((inst) => inst.id);
          const statuses = await xmtp.getKeyPackageStatuses(installationIds);
          
          const installationsWithStatus = sortedInstallations.map((installation) => ({
            ...installation,
            keyPackageStatus: statuses.get(installation.id),
          }));
          
          setInstallations(installationsWithStatus as unknown as Installation[]);
        } catch (statusErr) {
          console.warn('[Installations] Failed to fetch key package statuses:', statusErr);
          // Still show installations even if status fetch fails
          setInstallations(sortedInstallations as unknown as Installation[]);
        }
      } else {
        // Show installations without status if not connected
        setInstallations(sortedInstallations as unknown as Installation[]);
      }
    } catch (err) {
      console.error('[Installations] Failed to load:', err);
      const errorMsg = err instanceof Error ? err.message : 'Failed to load installations';
      
      // Provide helpful error messages
      if (errorMsg.includes('10/10 installations')) {
        setError('⚠️ Installation limit reached (10/10). Cannot create management client to view installations. Please use another device or xmtp.chat to revoke old installations.');
      } else if (errorMsg.includes('Client not connected')) {
        setError('XMTP not connected. Please connect first to view installations.');
      } else {
        setError(errorMsg);
      }
    } finally {
      setIsLoading(false);
    }
  };

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

  const forceRecover = async () => {
    if (!confirm('Force recover will delete older installations from the XMTP network to make room for this device. Continue?')) {
      return;
    }
    setIsForceRecovering(true);
    setError(null);
    try {
      const xmtp = getXmtpClient();
      // Try to keep the newest 1 installation by default
      const result = await xmtp.forceRevokeOldestInstallations(1);
      await loadInstallations();
      const msg = result.revoked.length > 0 ? `Revoked ${result.revoked.length} installation(s)` : 'No installations revoked';
      try { window.dispatchEvent(new CustomEvent('ui:toast', { detail: msg })); } catch { /* ignore */ }
    } catch (err) {
      console.error('[Installations] Force recover failed:', err);
      setError(err instanceof Error ? err.message : 'Force recover failed');
    } finally {
      setIsForceRecovering(false);
    }
  };

  useEffect(() => {
    loadInstallations();
  }, []);

  const handleRevoke = async (installationBytes: Uint8Array, installationId: string) => {
    const identity = useAuthStore.getState().identity;
    const isCurrentDevice = installationId === identity?.installationId;
    
    const confirmMessage = isCurrentDevice
      ? 'Are you sure you want to revoke THIS device? You will be logged out and need to reconnect.'
      : 'Are you sure you want to revoke this installation? That device will no longer be able to send/receive messages.';
    
    if (!confirm(confirmMessage)) {
      return;
    }

    setRevokingId(installationId);
    setError(null);
    try {
      const xmtp = getXmtpClient();
      
      console.log('[Installations] Revoking installation:', installationId);
      await xmtp.revokeInstallations([installationBytes]);
      console.log('[Installations] ✅ Revocation successful');
      
      // If we revoked the current device, we need to disconnect and reconnect
      if (isCurrentDevice) {
        console.log('[Installations] Revoked current device - disconnecting and will need to reconnect');
        await xmtp.disconnect();
        alert('Current installation revoked. You will need to reconnect to create a new installation.');
      } else {
        alert('Installation revoked successfully!');
      }
      
      await loadInstallations();
    } catch (err) {
      console.error('[Installations] Failed to revoke:', err);
      setError(err instanceof Error ? err.message : 'Failed to revoke installation');
    } finally {
      setRevokingId(null);
    }
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

  const currentInstallationId = identity?.installationId;

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
            All Installations ({installations.length}/10)
          </h3>
          <div className="flex items-center gap-3">
            <button
              onClick={forceRecover}
              disabled={isForceRecovering}
              className="text-sm text-yellow-300 hover:text-yellow-200 disabled:opacity-50"
              title="Delete older installations to recover from 10/10 limit"
            >
              {isForceRecovering ? 'Force Recover…' : 'Force Recover'}
            </button>
            <button
              onClick={loadInstallations}
              disabled={isLoading}
              className="text-sm text-accent-300 hover:text-accent-200 disabled:opacity-50"
              title="Fetch latest inbox state from the network"
            >
              {isLoading ? 'Refreshing…' : 'Force Network Refresh'}
            </button>
            <button
              onClick={refreshStatuses}
              disabled={isFetchingStatuses || isLoading || installations.length === 0}
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
              <span className="text-yellow-400">Expired</span>,{' '}
              <span className="text-red-400">Error</span>, or{' '}
              <span className="text-orange-400">Likely stale</span> (old, unused) installations.
              Avoid revoking <span className="text-green-400">recent</span> installations as they may be active on other devices.
            </div>
            {installations.map((installation) => {
              const isCurrentDevice = installation.id === currentInstallationId;
              const isRevoking = revokingId === installation.id;
              const hasError = !!installation.keyPackageStatus?.validationError;
              const expiry = formatExpiry(installation.keyPackageStatus?.lifetime?.notAfter);
              const isExpired = expiry === 'Expired';
              
              // Determine if installation is likely stale (created > 30 days ago and not current device)
              const createdMs = installation.clientTimestampNs 
                ? Number(installation.clientTimestampNs / 1000000n) 
                : 0;
              const ageInDays = createdMs ? Math.floor((Date.now() - createdMs) / (24 * 60 * 60 * 1000)) : 0;
              const isLikelyStale = !isCurrentDevice && ageInDays > 30 && !hasError && !isExpired;
              const isRecent = !isCurrentDevice && ageInDays <= 7;

              return (
                <div
                  key={installation.id}
                  className={`p-3 rounded border ${
                    isCurrentDevice
                      ? 'bg-accent-500/10 border-accent-400/30'
                      : hasError || isExpired
                      ? 'bg-red-500/10 border-red-500/30'
                      : isLikelyStale
                      ? 'bg-orange-500/10 border-orange-500/30'
                      : isRecent
                      ? 'bg-green-500/5 border-green-500/20'
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
                        {isRecent && (
                          <span className="text-xs px-2 py-0.5 bg-green-500/20 text-green-400 rounded" title="Created within the last 7 days - likely an active device">
                            Recent
                          </span>
                        )}
                        {isLikelyStale && (
                          <span className="text-xs px-2 py-0.5 bg-orange-500/20 text-orange-400 rounded" title="Created over 30 days ago - likely safe to revoke">
                            Likely stale
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
                        disabled={isRevoking}
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

        {!isLoading && installations.length === 0 && !error && (
          <div className="text-center py-8 text-primary-200 text-sm">
            No installations found. Try connecting to XMTP first.
          </div>
        )}
      </div>
    </section>
  );
}
