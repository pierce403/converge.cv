/**
 * Settings page
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/features/auth';
import { getStorage } from '@/lib/storage';

export function SettingsPage() {
  const navigate = useNavigate();
  const { identity, logout, lock } = useAuth();
  const [storageSize, setStorageSize] = useState<number | null>(null);
  const [isLoadingSize, setIsLoadingSize] = useState(false);

  const handleLockVault = () => {
    lock();
  };

  const handleLogout = async () => {
    if (confirm('Are you sure you want to log out? Make sure you remember your passphrase!')) {
      await logout();
      navigate('/onboarding');
    }
  };

  const handleExportData = async () => {
    try {
      // TODO: Implement encrypted backup export
      alert('Export feature coming soon');
    } catch (error) {
      console.error('Export failed:', error);
      alert('Export failed');
    }
  };

  const handleClearData = async () => {
    if (
      confirm(
        'This will delete ALL your local data including messages. This action cannot be undone. Continue?'
      )
    ) {
      try {
        const storage = await getStorage();
        // Clear all data
        await storage.deleteIdentity();
        await storage.deleteVaultSecrets();
        // Reload to reset state
        window.location.reload();
      } catch (error) {
        console.error('Failed to clear data:', error);
        alert('Failed to clear data');
      }
    }
  };

  const loadStorageSize = async () => {
    setIsLoadingSize(true);
    try {
      const storage = await getStorage();
      const size = await storage.getStorageSize();
      setStorageSize(size);
    } catch (error) {
      console.error('Failed to load storage size:', error);
    } finally {
      setIsLoadingSize(false);
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="bg-slate-800 border-b border-slate-700 px-4 py-3 flex items-center gap-3">
        <button
          onClick={() => navigate('/')}
          className="p-2 hover:bg-slate-700 rounded-lg transition-colors"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h1 className="text-xl font-bold">Settings</h1>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto p-4 space-y-6">
          {/* Account Section */}
          <section>
            <h2 className="text-lg font-semibold mb-3">Account</h2>
            <div className="bg-slate-800 rounded-lg divide-y divide-slate-700">
              <div className="p-4">
                <div className="text-sm text-slate-400 mb-1">Wallet Address</div>
                <div className="font-mono text-sm">
                  {identity?.address ? (
                    <>
                      {identity.address.slice(0, 10)}...{identity.address.slice(-8)}
                    </>
                  ) : (
                    'Not available'
                  )}
                </div>
              </div>

              <button
                onClick={handleLockVault}
                className="w-full p-4 text-left hover:bg-slate-700 transition-colors flex items-center justify-between"
              >
                <div>
                  <div className="font-medium">Lock Vault</div>
                  <div className="text-sm text-slate-400">Require passphrase to unlock</div>
                </div>
                <svg className="w-5 h-5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                  />
                </svg>
              </button>

              <button
                onClick={handleLogout}
                className="w-full p-4 text-left hover:bg-slate-700 transition-colors flex items-center justify-between text-red-400"
              >
                <div>
                  <div className="font-medium">Log Out</div>
                  <div className="text-sm text-slate-400">Sign out of this device</div>
                </div>
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                  />
                </svg>
              </button>
            </div>
          </section>

          {/* Privacy & Security */}
          <section>
            <h2 className="text-lg font-semibold mb-3">Privacy & Security</h2>
            <div className="bg-slate-800 rounded-lg divide-y divide-slate-700">
              <div className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">Vault Method</div>
                    <div className="text-sm text-slate-400">Passphrase protection</div>
                  </div>
                  <span className="text-sm text-slate-500">Active</span>
                </div>
              </div>

              <div className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">Message Encryption</div>
                    <div className="text-sm text-slate-400">AES-GCM 256-bit at rest</div>
                  </div>
                  <span className="text-sm text-green-500">✓ Enabled</span>
                </div>
              </div>
            </div>
          </section>

          {/* Data Management */}
          <section>
            <h2 className="text-lg font-semibold mb-3">Data Management</h2>
            <div className="bg-slate-800 rounded-lg divide-y divide-slate-700">
              <div className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <div className="font-medium">Storage Usage</div>
                    <div className="text-sm text-slate-400">Local database size</div>
                  </div>
                  {storageSize !== null && (
                    <span className="text-sm text-slate-300">{formatBytes(storageSize)}</span>
                  )}
                </div>
                <button
                  onClick={loadStorageSize}
                  disabled={isLoadingSize}
                  className="text-sm text-primary-500 hover:text-primary-400"
                >
                  {isLoadingSize ? 'Calculating...' : 'Calculate Size'}
                </button>
              </div>

              <button
                onClick={handleExportData}
                className="w-full p-4 text-left hover:bg-slate-700 transition-colors flex items-center justify-between"
              >
                <div>
                  <div className="font-medium">Export Data</div>
                  <div className="text-sm text-slate-400">Create encrypted backup</div>
                </div>
                <svg className="w-5 h-5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                  />
                </svg>
              </button>

              <button
                onClick={handleClearData}
                className="w-full p-4 text-left hover:bg-slate-700 transition-colors flex items-center justify-between text-red-400"
              >
                <div>
                  <div className="font-medium">Clear All Data</div>
                  <div className="text-sm text-slate-400">Delete everything locally</div>
                </div>
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                  />
                </svg>
              </button>
            </div>
          </section>

          {/* Notifications (PWA) */}
          <section>
            <h2 className="text-lg font-semibold mb-3">Notifications</h2>
            <div className="bg-slate-800 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium">Push Notifications</div>
                  <div className="text-sm text-slate-400">Get notified of new messages</div>
                </div>
                <button className="btn-secondary text-sm">
                  Enable
                </button>
              </div>
              <p className="text-xs text-slate-500 mt-2">
                Requires app to be installed and browser permissions
              </p>
            </div>
          </section>

          {/* About */}
          <section>
            <h2 className="text-lg font-semibold mb-3">About</h2>
            <div className="bg-slate-800 rounded-lg divide-y divide-slate-700">
              <div className="p-4">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Version</span>
                  <span>0.1.0 MVP</span>
                </div>
              </div>
              <div className="p-4">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Protocol</span>
                  <span>XMTP v3</span>
                </div>
              </div>
              <div className="p-4">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Storage</span>
                  <span>IndexedDB (Dexie)</span>
                </div>
              </div>
              <div className="p-4">
                <a
                  href="https://github.com/pierce403/converge.cv"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between text-primary-500 hover:text-primary-400"
                >
                  <span>View on GitHub</span>
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                    />
                  </svg>
                </a>
              </div>
            </div>
          </section>

          {/* Footer info */}
          <div className="text-center text-sm text-slate-500 pb-8">
            <p>Converge - Local-first XMTP messaging</p>
            <p className="mt-1">End-to-end encrypted · No server storage</p>
          </div>
        </div>
      </div>
    </div>
  );
}

