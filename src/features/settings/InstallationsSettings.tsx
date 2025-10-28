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

  const loadInstallations = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const xmtp = getXmtpClient();
      
      // Try to get inbox state even if not connected
      // This allows viewing/revoking installations when connection failed due to 10/10 limit
      console.log('[Installations] Loading installations, connected:', xmtp.isConnected());
      
      const inboxState = await xmtp.getInboxState();
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
          
          setInstallations(installationsWithStatus);
        } catch (statusErr) {
          console.warn('[Installations] Failed to fetch key package statuses:', statusErr);
          // Still show installations even if status fetch fails
          setInstallations(sortedInstallations);
        }
      } else {
        // Show installations without status if not connected
        setInstallations(sortedInstallations);
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
      <div className="bg-slate-800 rounded-lg p-4 space-y-4">
        <div className="text-sm text-slate-300">
          <p className="mb-2">
            Each device where you use Converge registers an installation with XMTP.
            You can have up to <strong>10 installations</strong> per inbox.
          </p>
          {currentInstallationId && (
            <div className="mt-2 p-3 bg-slate-900 rounded border border-slate-700">
              <div className="font-medium text-slate-200">This Device</div>
              <div className="text-xs text-slate-400 font-mono mt-1">
                {formatInstallationId(currentInstallationId)}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between">
          <h3 className="font-medium text-slate-200">
            All Installations ({installations.length}/10)
          </h3>
          <button
            onClick={loadInstallations}
            disabled={isLoading}
            className="text-sm text-blue-400 hover:text-blue-300 disabled:opacity-50"
          >
            {isLoading ? 'Loading...' : 'Refresh'}
          </button>
        </div>

        {error && (
          <div className="p-3 bg-red-500/10 border border-red-500/20 rounded text-sm text-red-400">
            {error}
          </div>
        )}

        {isLoading && !error && (
          <div className="text-center py-8 text-slate-400">
            <div className="animate-spin inline-block w-6 h-6 border-2 border-current border-t-transparent rounded-full" />
          </div>
        )}

        {!isLoading && installations.length > 0 && (
          <div className="space-y-2">
            {installations.map((installation) => {
              const isCurrentDevice = installation.id === currentInstallationId;
              const isRevoking = revokingId === installation.id;
              const hasError = !!installation.keyPackageStatus?.validationError;
              const expiry = formatExpiry(installation.keyPackageStatus?.lifetime?.notAfter);
              const isExpired = expiry === 'Expired';

              return (
                <div
                  key={installation.id}
                  className={`p-3 rounded border ${
                    isCurrentDevice
                      ? 'bg-blue-500/10 border-blue-500/30'
                      : hasError || isExpired
                      ? 'bg-red-500/10 border-red-500/30'
                      : 'bg-slate-900 border-slate-700'
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-slate-200">
                          {formatInstallationId(installation.id)}
                        </span>
                        {isCurrentDevice && (
                          <span className="text-xs px-2 py-0.5 bg-blue-500/20 text-blue-400 rounded">
                            This Device
                          </span>
                        )}
                        {hasError && (
                          <span className="text-xs px-2 py-0.5 bg-red-500/20 text-red-400 rounded">
                            Error
                          </span>
                        )}
                        {isExpired && (
                          <span className="text-xs px-2 py-0.5 bg-yellow-500/20 text-yellow-400 rounded">
                            Expired
                          </span>
                        )}
                        {expiry && !isExpired && (
                          <span className="text-xs px-2 py-0.5 bg-green-500/20 text-green-400 rounded">
                            Expires in {expiry}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-400 mt-1 space-y-0.5">
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
          <div className="text-center py-8 text-slate-400 text-sm">
            No installations found. Try connecting to XMTP first.
          </div>
        )}
      </div>
    </section>
  );
}

