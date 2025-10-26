/**
 * Settings page
 */

import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/features/auth';
import { getStorage } from '@/lib/storage';
import { useXmtpStore } from '@/lib/stores/xmtp-store';
import { getXmtpClient } from '@/lib/xmtp';

export function SettingsPage() {
  const navigate = useNavigate();
  const { identity, logout, lock } = useAuth();
  const { connectionStatus, lastConnected } = useXmtpStore();
  const [storageSize, setStorageSize] = useState<number | null>(null);
  const [isLoadingSize, setIsLoadingSize] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [displayName, setDisplayName] = useState(identity?.displayName || '');
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const handleLockVault = () => {
    lock();
  };

  const handleRemoveIdentity = async () => {
    if (
      confirm(
        'Are you sure you want to remove this identity? You will lose access to all messages associated with this identity unless you have a backup.'
      )
    ) {
      try {
        const storage = await getStorage();
        await storage.deleteIdentity();
        await storage.deleteVaultSecrets();
        
        // Disconnect from XMTP
        const xmtp = getXmtpClient();
        await xmtp.disconnect();
        
        await logout();
        navigate('/onboarding');
      } catch (error) {
        console.error('Failed to remove identity:', error);
        alert('Failed to remove identity');
      }
    }
  };

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Check file size (max 2MB)
    if (file.size > 2 * 1024 * 1024) {
      alert('Avatar image must be less than 2MB');
      return;
    }

    // Check file type
    if (!file.type.startsWith('image/')) {
      alert('Please select an image file');
      return;
    }

    try {
      // Convert to data URI
      const reader = new FileReader();
      reader.onload = async (event) => {
        const dataUri = event.target?.result as string;
        
        // Update identity with avatar
        if (identity) {
          const storage = await getStorage();
          const updatedIdentity = { ...identity, avatar: dataUri };
          await storage.putIdentity(updatedIdentity);
          window.location.reload(); // Refresh to show new avatar
        }
      };
      reader.readAsDataURL(file);
    } catch (error) {
      console.error('Failed to update avatar:', error);
      alert('Failed to update avatar');
    }
  };

  const handleSaveDisplayName = async () => {
    try {
      if (identity) {
        const storage = await getStorage();
        const updatedIdentity = { ...identity, displayName: displayName.trim() };
        await storage.putIdentity(updatedIdentity);
        setIsEditingName(false);
        window.location.reload(); // Refresh to show new name
      }
    } catch (error) {
      console.error('Failed to update display name:', error);
      alert('Failed to update display name');
    }
  };

  const handleAddIdentity = () => {
    // TODO: Implement add identity flow
    alert('Add Identity feature coming soon!\n\nThis will allow you to associate multiple identities (Ethereum addresses, passkeys, etc.) with your XMTP inbox.');
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

  const handleClearCache = async () => {
    try {
      // Clear all service worker caches
      if ('caches' in window) {
        const cacheNames = await caches.keys();
        await Promise.all(cacheNames.map(name => caches.delete(name)));
      }
      
      // Unregister service worker
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map(reg => reg.unregister()));
      }
      
      alert('Cache cleared! Refresh the page to see the latest version.');
    } catch (error) {
      console.error('Failed to clear cache:', error);
      alert('Failed to clear cache');
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

  const getConnectionStatusColor = () => {
    switch (connectionStatus) {
      case 'connected':
        return 'text-green-500';
      case 'connecting':
        return 'text-yellow-500';
      case 'error':
        return 'text-red-500';
      default:
        return 'text-slate-500';
    }
  };

  const getConnectionStatusText = () => {
    switch (connectionStatus) {
      case 'connected':
        return 'Connected';
      case 'connecting':
        return 'Connecting...';
      case 'error':
        return 'Connection Error';
      default:
        return 'Disconnected';
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="bg-slate-800 border-b border-slate-700 p-4">
        <div className="flex items-center justify-between max-w-2xl mx-auto">
          <h1 className="text-xl font-semibold">Settings</h1>
          <button onClick={() => navigate('/')} className="text-slate-400 hover:text-slate-300">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto bg-slate-900">
        <div className="max-w-2xl mx-auto p-4 space-y-6">
          
          {/* Profile Section */}
          <section>
            <h2 className="text-lg font-semibold mb-3">Profile</h2>
            <div className="bg-slate-800 rounded-lg p-4 space-y-4">
              {/* Avatar */}
              <div className="flex items-center gap-4">
                <div className="relative">
                  <div className="w-20 h-20 rounded-full bg-slate-700 flex items-center justify-center overflow-hidden">
                    {identity?.avatar ? (
                      <img src={identity.avatar} alt="Avatar" className="w-full h-full object-cover" />
                    ) : (
                      <svg className="w-10 h-10 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                        />
                      </svg>
                    )}
                  </div>
                  <button
                    onClick={() => avatarInputRef.current?.click()}
                    className="absolute bottom-0 right-0 bg-primary-600 hover:bg-primary-700 rounded-full p-1.5 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
                      />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  </button>
                  <input
                    ref={avatarInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleAvatarChange}
                    className="hidden"
                  />
                </div>
                <div className="flex-1">
                  <div className="text-sm text-slate-400 mb-1">Avatar</div>
                  <div className="text-sm text-slate-500">Click camera icon to change</div>
                </div>
              </div>

              {/* Display Name */}
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-2">Display Name (Optional)</label>
                {isEditingName ? (
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="Enter display name"
                      className="flex-1 bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                      maxLength={50}
                    />
                    <button onClick={handleSaveDisplayName} className="btn-primary text-sm px-3">
                      Save
                    </button>
                    <button
                      onClick={() => {
                        setDisplayName(identity?.displayName || '');
                        setIsEditingName(false);
                      }}
                      className="btn-secondary text-sm px-3"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <span className="text-sm">
                      {identity?.displayName || <span className="text-slate-500">Not set</span>}
                    </span>
                    <button onClick={() => setIsEditingName(true)} className="text-sm text-primary-500 hover:text-primary-400">
                      Edit
                    </button>
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* Identity & Connection */}
          <section>
            <h2 className="text-lg font-semibold mb-3">Identity & Connection</h2>
            <div className="bg-slate-800 rounded-lg divide-y divide-slate-700">
              {/* XMTP Connection Status */}
              <div className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <div className="font-medium">XMTP Network</div>
                    <div className="text-sm text-slate-400">Connection status</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${getConnectionStatusColor()}`} />
                    <span className={`text-sm font-medium ${getConnectionStatusColor()}`}>
                      {getConnectionStatusText()}
                    </span>
                  </div>
                </div>
                {lastConnected && connectionStatus === 'connected' && (
                  <div className="text-xs text-slate-500">
                    Connected since {new Date(lastConnected).toLocaleTimeString()}
                  </div>
                )}
              </div>

              {/* Current Identity */}
              <div className="p-4">
                <div className="font-medium mb-1">Current Identity</div>
                <div className="text-sm text-slate-400 mb-2">Ethereum Address</div>
                <div className="font-mono text-sm bg-slate-900 rounded px-3 py-2 break-all">
                  {identity?.address}
                </div>
                <div className="mt-2 text-xs text-slate-500">
                  This is your primary identity for sending and receiving messages
                </div>
              </div>

              {/* Add Identity */}
              <button
                onClick={handleAddIdentity}
                className="w-full p-4 text-left hover:bg-slate-700 transition-colors flex items-center justify-between"
              >
                <div>
                  <div className="font-medium">Add Identity</div>
                  <div className="text-sm text-slate-400">Associate another address with this inbox</div>
                </div>
                <svg className="w-5 h-5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
              </button>
            </div>
          </section>

          {/* Account Actions */}
          <section>
            <h2 className="text-lg font-semibold mb-3">Account</h2>
            <div className="bg-slate-800 rounded-lg divide-y divide-slate-700">
              <button
                onClick={handleLockVault}
                className="w-full p-4 text-left hover:bg-slate-700 transition-colors flex items-center justify-between"
              >
                <div>
                  <div className="font-medium">Lock Vault</div>
                  <div className="text-sm text-slate-400">Require authentication to access</div>
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
                onClick={handleRemoveIdentity}
                className="w-full p-4 text-left hover:bg-slate-700 transition-colors flex items-center justify-between text-red-400"
              >
                <div>
                  <div className="font-medium">Remove Identity</div>
                  <div className="text-sm text-slate-400">Delete this identity and all local data</div>
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
                    <div className="font-medium">Message Encryption</div>
                    <div className="text-sm text-slate-400">End-to-end encryption via XMTP</div>
                  </div>
                  <span className="text-sm text-green-500">✓ Enabled</span>
                </div>
              </div>
              <div className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">Local Storage</div>
                    <div className="text-sm text-slate-400">Data stored on your device only</div>
                  </div>
                  <span className="text-sm text-green-500">✓ Active</span>
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
                onClick={handleClearCache}
                className="w-full p-4 text-left hover:bg-slate-700 transition-colors flex items-center justify-between"
              >
                <div>
                  <div className="font-medium">Clear App Cache</div>
                  <div className="text-sm text-slate-400">Force refresh from server</div>
                </div>
                <svg className="w-5 h-5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
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
