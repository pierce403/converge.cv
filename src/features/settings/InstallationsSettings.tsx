/**
 * XMTP Installations Management
 */

import { useState, useEffect } from 'react';
import { useAuthStore } from '@/lib/stores';
import { getXmtpClient } from '@/lib/xmtp';

interface Installation {
  id: string;
  bytes: Uint8Array;
  clientTimestampNs?: bigint;
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
      if (!xmtp.isConnected()) {
        setError('XMTP not connected');
        return;
      }

      const inboxState = await xmtp.getInboxState();
      console.log('[Installations] Inbox state:', inboxState);
      setInstallations(inboxState.installations || []);
    } catch (err) {
      console.error('[Installations] Failed to load:', err);
      setError(err instanceof Error ? err.message : 'Failed to load installations');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadInstallations();
  }, []);

  const handleRevoke = async (installationBytes: Uint8Array, installationId: string) => {
    if (!confirm('Are you sure you want to revoke this installation? This device will no longer be able to send/receive messages.')) {
      return;
    }

    setRevokingId(installationId);
    setError(null);
    try {
      const xmtp = getXmtpClient();
      await xmtp.revokeInstallations([installationBytes]);
      alert('Installation revoked successfully! Reloading installations...');
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
      return date.toLocaleString();
    } catch {
      return 'Unknown';
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

              return (
                <div
                  key={installation.id}
                  className={`p-3 rounded border ${
                    isCurrentDevice
                      ? 'bg-blue-500/10 border-blue-500/30'
                      : 'bg-slate-900 border-slate-700'
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-slate-200">
                          {formatInstallationId(installation.id)}
                        </span>
                        {isCurrentDevice && (
                          <span className="text-xs px-2 py-0.5 bg-blue-500/20 text-blue-400 rounded">
                            This Device
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-400 mt-1">
                        Created: {formatTimestamp(installation.clientTimestampNs)}
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

