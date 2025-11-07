/**
 * Settings page
 */

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/features/auth';
import { getStorage } from '@/lib/storage';
import { useXmtpStore } from '@/lib/stores/xmtp-store';
import { getXmtpClient } from '@/lib/xmtp';
import { InstallationsSettings } from './InstallationsSettings';
import { useWalletConnection } from '@/lib/wagmi';
import { QRCodeOverlay } from '@/components/QRCodeOverlay';
import { exportIdentityToKeyfile, serializeKeyfile } from '@/lib/keyfile';

export function SettingsPage() {
  const navigate = useNavigate();
  const { identity, logout, lock } = useAuth();
  const { connectionStatus, lastConnected, error: xmtpError } = useXmtpStore();
  const [storageSize, setStorageSize] = useState<number | null>(null);
  const [isLoadingSize, setIsLoadingSize] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  // Deterministic "Color Animal" suggestion (seeded by inboxId/address)
  const suggestDisplayName = (seed?: string) => {
    const colors = [
      'Red', 'Blue', 'Green', 'Yellow', 'Purple', 'Orange', 'Pink', 'Brown', 'Black', 'White',
    ];
    const animals = [
      'Orca','Dolphin','Whale','Penguin','Seal','Otter','Shark','Turtle','Eagle','Falcon','Hawk','Owl','Fox','Wolf','Bear','Tiger','Lion','Zebra','Giraffe','Elephant','Monkey','Panda','Koala','Kangaroo','Rabbit','Deer','Horse','Bison','Buffalo','Camel','Hippo','Rhino','Leopard','Cheetah','Jaguar','Goat','Sheep','Cow','Pig','Dog','Cat','Goose','Duck','Swan','Frog','Toad','Lizard','Snake','Chimpanzee','Gorilla',
    ];
    const s = (seed || 'converge').toLowerCase();
    let h = 2166136261 >>> 0; // FNV-1a 32-bit
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
    }
    const c = colors[Math.abs(h) % colors.length];
    const a = animals[Math.abs((h >>> 1)) % animals.length];
    return `${c} ${a}`;
  };

  const isAutoLabel = (val?: string | null) => {
    if (!val) return true;
    const v = val.trim();
    return v.startsWith('Identity ') || v.startsWith('Wallet ');
  };

  const computeInitialDisplayName = () => {
    const raw = identity?.displayName?.trim();
    if (!raw || isAutoLabel(raw)) {
      const seed = identity?.inboxId || identity?.address;
      return suggestDisplayName(seed);
    }
    return raw;
  };

  const [displayName, setDisplayName] = useState<string>(computeInitialDisplayName());
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const { disconnectWallet } = useWalletConnection();
  const [showQR, setShowQR] = useState(false);
  const canDownloadKeyfile = Boolean(identity?.privateKey || identity?.mnemonic);

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
        // First, disconnect any connected wallet so we don't auto-reconnect
        try {
          await disconnectWallet();
          console.log('[Settings] Disconnected wallet via wagmi');
        } catch (e) {
          console.warn('[Settings] Wallet disconnect failed (non-fatal):', e);
        }

        // Use logout which now clears everything properly (IndexedDB + OPFS + XMTP)
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

    // Check file size (max 256KB to keep XMTP messages small)
    if (file.size > 256 * 1024) {
      alert('Avatar image must be less than 256KB');
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

          // Persist to XMTP so it survives clear-all
          try {
            const xmtp = getXmtpClient();
            await xmtp.saveProfile(updatedIdentity.displayName, dataUri);
          } catch (err) {
            console.warn('[Settings] Failed to save avatar to network (non-fatal):', err);
          }

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
        // Persist to XMTP so it survives clear-all
        try {
          const xmtp = getXmtpClient();
          await xmtp.saveProfile(updatedIdentity.displayName, updatedIdentity.avatar);
        } catch (err) {
          console.warn('[Settings] Failed to save display name to network (non-fatal):', err);
        }
        setIsEditingName(false);
        window.location.reload(); // Refresh to show new name
      }
    } catch (error) {
      console.error('Failed to update display name:', error);
      alert('Failed to update display name');
    }
  };

  // Keep suggested name in sync when identity changes
  useEffect(() => {
    setDisplayName(computeInitialDisplayName());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity?.inboxId, identity?.address, identity?.displayName]);

  const handleAddIdentity = () => {
    // TODO: Implement add identity flow
    alert('Add Identity feature coming soon!\n\nThis will allow you to associate multiple identities (Ethereum addresses, passkeys, etc.) with your XMTP inbox.');
  };

  const handleDownloadKeyfile = () => {
    try {
      if (!identity) {
        alert('No identity is currently loaded.');
        return;
      }

      if (!identity.privateKey && !identity.mnemonic) {
        alert('This identity is managed by an external wallet. Connect on the device where it was generated to export a keyfile.');
        return;
      }

      const keyfile = exportIdentityToKeyfile(identity);
      const serialized = serializeKeyfile(keyfile);
      const blob = new Blob([serialized], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const safeAddress = identity.address.replace(/[^a-zA-Z0-9]/g, '').slice(0, 10) || 'identity';
      const timestamp = new Date().toISOString().replace(/[:]/g, '-');
      const filename = `converge-keyfile-${safeAddress}-${timestamp}.json`;

      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to export keyfile:', error);
      alert('Failed to export keyfile. Please try again.');
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
        'This will delete ALL your local data including messages, conversations, and XMTP databases. This action cannot be undone. Continue?'
      )
    ) {
      try {
        // 1) Disconnect wallet to prevent auto-reconnect on next load
        try {
          await disconnectWallet();
          console.log('[Settings] Disconnected wallet via wagmi');
        } catch (e) {
          console.warn('[Settings] Wallet disconnect failed (non-fatal):', e);
        }

        // 2) Fully logout (disconnect XMTP, clear IndexedDB + XMTP OPFS, reset state)
        try {
          await logout();
          console.log('[Settings] Performed app logout and storage cleanup');
        } catch (e) {
          console.warn('[Settings] Logout encountered an error (continuing):', e);
        }

        // 3) Clear personalization reminder flags and any local/session storage app data
        try {
          if (typeof window !== 'undefined') {
            // Remove legacy global key
            try { window.localStorage.removeItem('personalization-reminder'); } catch (e) {
              console.warn('[Settings] Failed to remove legacy personalization key:', e);
            }
            // Remove per-identity keys
            try {
              const keys: string[] = [];
              for (let i = 0; i < window.localStorage.length; i++) {
                const k = window.localStorage.key(i);
                if (k) keys.push(k);
              }
              for (const k of keys) {
                if (k.startsWith('personalization-reminder:')) {
                  window.localStorage.removeItem(k);
                }
              }
            } catch (e) {
              console.warn('[Settings] Failed to enumerate personalization keys:', e);
            }
            // As this is "Clear All Data", clear all local/session storage as a final sweep
            try { window.localStorage.clear(); } catch (e) {
              console.warn('[Settings] Failed to clear localStorage:', e);
            }
            try { window.sessionStorage.clear(); } catch (e) {
              console.warn('[Settings] Failed to clear sessionStorage:', e);
            }
          }
        } catch (e) {
          console.warn('[Settings] Failed to clear personalization flags or web storage (non-fatal):', e);
        }

        // 4) Clear service worker caches and unregister SW (force a fresh start)
        try {
          if ('caches' in window) {
            const cacheNames = await caches.keys();
            await Promise.all(cacheNames.map((name) => caches.delete(name)));
            console.log('[Settings] Cleared service worker caches');
          }
          if ('serviceWorker' in navigator) {
            const registrations = await navigator.serviceWorker.getRegistrations();
            await Promise.all(registrations.map((reg) => reg.unregister()));
            console.log('[Settings] Unregistered service workers');
          }
        } catch (e) {
          console.warn('[Settings] Failed to clear SW caches or unregister SW (non-fatal):', e);
        }

        // 5) Hard reload the page to ensure a completely clean slate
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
        return 'text-primary-300';
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
    <div className="flex flex-col h-full text-primary-50">
      {/* Header */}
      <div className="bg-primary-950/70 border-b border-primary-800/60 p-4 backdrop-blur-md">
        <div className="flex items-center justify-between max-w-2xl mx-auto">
          <h1 className="text-xl font-semibold">Settings</h1>
          <button onClick={() => navigate('/')} className="text-primary-200 hover:text-primary-100">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto bg-primary-950/20">
        <div className="max-w-2xl mx-auto p-4 space-y-6">

          {/* Profile Section */}
          <section>
            <h2 className="text-lg font-semibold mb-3">Profile</h2>
            <div className="bg-primary-900/60 border border-primary-800/60 rounded-lg p-4 space-y-4 backdrop-blur">
              {/* Avatar */}
              <div className="flex items-center gap-4">
                <div className="relative">
                  <div className="w-20 h-20 rounded-full bg-primary-950/60 border border-primary-800/60 flex items-center justify-center overflow-hidden">
                    {identity?.avatar ? (
                      <img src={identity.avatar} alt="Avatar" className="w-full h-full object-cover" />
                    ) : (
                      <svg className="w-10 h-10 text-primary-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
                    className="absolute bottom-0 right-0 bg-accent-500 hover:bg-accent-600 rounded-full p-1.5 transition-colors shadow-lg"
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
                  <div className="text-sm text-primary-200 mb-1">Avatar</div>
                  <div className="text-sm text-primary-300">Click camera icon to change</div>
                </div>
              </div>

              {/* Display Name */}
              <div>
                <label className="block text-sm font-medium text-primary-200 mb-2">Display Name (Optional)</label>
                {isEditingName ? (
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="Enter display name"
                      className="flex-1 bg-primary-950/60 border border-primary-800/60 rounded-lg px-3 py-2 text-sm text-primary-100 focus:outline-none focus:ring-2 focus:ring-accent-400 focus:ring-offset-2 focus:ring-offset-primary-950"
                      maxLength={50}
                    />
                    <button onClick={handleSaveDisplayName} className="btn-primary text-sm px-3">
                      Save
                    </button>
                    <button
                      onClick={() => {
                        // Reset to suggested/actual value on cancel
                        const raw = identity?.displayName?.trim();
                        if (!raw || raw.startsWith('Identity ') || raw.startsWith('Wallet ')) {
                          const seed = identity?.inboxId || identity?.address;
                          setDisplayName(suggestDisplayName(seed));
                        } else {
                          setDisplayName(raw);
                        }
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
                      {identity?.displayName || <span className="text-primary-300">Not set</span>}
                    </span>
                    <button
                      onClick={() => {
                        // Prefill with suggested name when entering edit if auto-label
                        const raw = identity?.displayName?.trim();
                        if (!raw || raw.startsWith('Identity ') || raw.startsWith('Wallet ')) {
                          const seed = identity?.inboxId || identity?.address;
                          setDisplayName(suggestDisplayName(seed));
                        }
                        setIsEditingName(true);
                      }}
                      className="text-sm text-accent-300 hover:text-accent-200"
                    >
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
            <div className="bg-primary-900/60 border border-primary-800/60 rounded-lg divide-y divide-primary-800/60 backdrop-blur">
              {/* XMTP Connection Status */}
              <div className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex-1">
                    <div className="font-medium">XMTP Network</div>
                    <div className="text-sm text-primary-200">Connection status</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${getConnectionStatusColor()}`} />
                    <span className={`text-sm font-medium ${getConnectionStatusColor()}`}>
                      {getConnectionStatusText()}
                    </span>
                  </div>
                </div>
                {lastConnected && connectionStatus === 'connected' && (
                  <div className="text-xs text-primary-300">
                    Connected since {new Date(lastConnected).toLocaleTimeString()}
                  </div>
                )}
                {xmtpError && connectionStatus === 'error' && (
                  <div className="mt-2">
                    <div className="text-xs text-red-400 bg-red-500/10 rounded p-2 mb-2">
                      {xmtpError}
                    </div>
                    <button
                      onClick={async () => {
                        const xmtp = getXmtpClient();
                        if (identity) {
                          try {
                            await xmtp.connect({ 
                              address: identity.address, 
                              privateKey: identity.privateKey 
                            });
                          } catch (error) {
                            console.error('Retry failed:', error);
                          }
                        }
                      }}
                      className="text-xs text-accent-300 hover:text-accent-200 underline"
                    >
                      Retry Connection
                    </button>
                  </div>
                )}
                {connectionStatus === 'connecting' && (
                  <div className="mt-2 text-xs text-primary-200">
                    <div className="flex items-center gap-2">
                      <svg className="animate-spin h-3 w-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      <span>Registering identity on XMTP network...</span>
                    </div>
                    <div className="mt-1 text-primary-300">
                      Check the <button onClick={() => navigate('/debug')} className="underline hover:text-primary-200">Debug tab</button> for details
                    </div>
                  </div>
                )}
              </div>

              {/* Current Identity */}
              <div className="p-4">
                <div className="flex items-center justify-between mb-1">
                  <div className="font-medium">Current Identity</div>
                  <button
                    onClick={() => setShowQR(true)}
                    className="flex items-center gap-1 text-sm text-accent-300 hover:text-accent-200 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
                    </svg>
                    Show QR Code
                  </button>
                </div>
                <div className="text-sm text-primary-200 mb-2">Ethereum Address</div>
                <div className="font-mono text-sm bg-primary-950/20 rounded px-3 py-2 break-all">
                  {identity?.address}
                </div>
                <div className="mt-2 text-xs text-primary-300">
                  This is your primary identity for sending and receiving messages
                </div>
              </div>

              {/* Add Identity */}
              <button
                onClick={handleAddIdentity}
                className="w-full p-4 text-left hover:bg-primary-950/60 transition-colors flex items-center justify-between"
              >
                <div>
                  <div className="font-medium">Add Identity</div>
                  <div className="text-sm text-primary-200">Associate another address with this inbox</div>
                </div>
                <svg className="w-5 h-5 text-primary-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
              </button>
            </div>
          </section>

          {/* Account Actions */}
          <section>
            <h2 className="text-lg font-semibold mb-3">Account</h2>
            <div className="bg-primary-900/60 border border-primary-800/60 rounded-lg divide-y divide-primary-800/60 backdrop-blur">
              <button
                onClick={handleDownloadKeyfile}
                disabled={!canDownloadKeyfile}
                className="w-full p-4 text-left flex items-center justify-between transition-colors hover:bg-primary-950/60 disabled:cursor-not-allowed disabled:text-primary-400 disabled:bg-primary-950/40"
              >
                <div>
                  <div className="font-medium">Download keyfile</div>
                  <div className="text-sm text-primary-200">
                    {canDownloadKeyfile
                      ? 'Save a backup with your recovery phrase'
                      : 'Available for Converge-generated identities only'}
                  </div>
                </div>
                <svg className="w-5 h-5 text-primary-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5m0 0l5-5m-5 5V4"
                  />
                </svg>
              </button>
              <button
                onClick={handleLockVault}
                className="w-full p-4 text-left hover:bg-primary-950/60 transition-colors flex items-center justify-between"
              >
                <div>
                  <div className="font-medium">Lock Vault</div>
                  <div className="text-sm text-primary-200">Require authentication to access</div>
                </div>
                <svg className="w-5 h-5 text-primary-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
                className="w-full p-4 text-left hover:bg-primary-950/60 transition-colors flex items-center justify-between text-red-400"
              >
                <div>
                  <div className="font-medium">Remove Identity</div>
                  <div className="text-sm text-primary-200">Delete this identity and all local data</div>
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
            <div className="bg-primary-900/60 border border-primary-800/60 rounded-lg divide-y divide-primary-800/60 backdrop-blur">
              <div className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">Message Encryption</div>
                    <div className="text-sm text-primary-200">End-to-end encryption via XMTP</div>
                  </div>
                  <span className="text-sm text-green-500">✓ Enabled</span>
                </div>
              </div>
              <div className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">Local Storage</div>
                    <div className="text-sm text-primary-200">Data stored on your device only</div>
                  </div>
                  <span className="text-sm text-green-500">✓ Active</span>
                </div>
              </div>
            </div>
          </section>

          {/* Data Management */}
          <section>
            <h2 className="text-lg font-semibold mb-3">Data Management</h2>
            <div className="bg-primary-900/60 border border-primary-800/60 rounded-lg divide-y divide-primary-800/60 backdrop-blur">
              <div className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <div className="font-medium">Storage Usage</div>
                    <div className="text-sm text-primary-200">Local database size</div>
                  </div>
                  {storageSize !== null && (
                    <span className="text-sm text-primary-100">{formatBytes(storageSize)}</span>
                  )}
                </div>
                <button
                  onClick={loadStorageSize}
                  disabled={isLoadingSize}
                  className="text-sm text-accent-300 hover:text-accent-200"
                >
                  {isLoadingSize ? 'Calculating...' : 'Calculate Size'}
                </button>
              </div>

              <button
                onClick={handleExportData}
                className="w-full p-4 text-left hover:bg-primary-950/60 transition-colors flex items-center justify-between"
              >
                <div>
                  <div className="font-medium">Export Data</div>
                  <div className="text-sm text-primary-200">Create encrypted backup</div>
                </div>
                <svg className="w-5 h-5 text-primary-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
                className="w-full p-4 text-left hover:bg-primary-950/60 transition-colors flex items-center justify-between"
              >
                <div>
                  <div className="font-medium">Clear App Cache</div>
                  <div className="text-sm text-primary-200">Force refresh from server</div>
                </div>
                <svg className="w-5 h-5 text-primary-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
                className="w-full p-4 text-left hover:bg-primary-950/60 transition-colors flex items-center justify-between text-red-400"
              >
                <div>
                  <div className="font-medium">Clear All Data</div>
                  <div className="text-sm text-primary-200">Delete everything locally</div>
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

          {/* App */}
          <section>
            <h2 className="text-lg font-semibold mb-3">App</h2>
            <div className="bg-primary-900/60 border border-primary-800/60 rounded-lg divide-y divide-primary-800/60 backdrop-blur">
              <div className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">Install App</div>
                    <div className="text-sm text-primary-200">
                      Add Converge to your home screen for quick access
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      // Trigger install prompt via beforeinstallprompt event
                      // The browser will handle this natively
                      const nav = navigator as { standalone?: boolean };
                      if ('standalone' in navigator && !nav.standalone) {
                        // iOS Safari - show instructions
                        alert('To install:\n1. Tap the Share button\n2. Tap "Add to Home Screen"');
                      } else {
                        // Android Chrome and others - browser will show native prompt
                        alert('Use your browser\'s "Add to Home Screen" or "Install" option to install the app.');
                      }
                    }}
                    className="btn-primary text-sm"
                  >
                    Install
                  </button>
                </div>
              </div>
            </div>
          </section>

          {/* XMTP Installations */}
          <InstallationsSettings />

          {/* About */}
          <section>
            <h2 className="text-lg font-semibold mb-3">About</h2>
            <div className="bg-primary-900/60 border border-primary-800/60 rounded-lg divide-y divide-primary-800/60 backdrop-blur">
              <div className="p-4">
                <div className="flex items-center justify-between">
                  <span className="text-primary-200">Version</span>
                  <span>0.1.0 MVP</span>
                </div>
              </div>
              <div className="p-4">
                <div className="flex items-center justify-between">
                  <span className="text-primary-200">Protocol</span>
                  <span>XMTP v3</span>
                </div>
              </div>
              <div className="p-4">
                <div className="flex items-center justify-between">
                  <span className="text-primary-200">Storage</span>
                  <span>IndexedDB (Dexie)</span>
                </div>
              </div>
              <div className="p-4">
                <a
                  href="https://github.com/pierce403/converge.cv"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between text-accent-300 hover:text-accent-200"
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
          <div className="text-center text-sm text-primary-300 pb-8">
            <p>Converge - Local-first XMTP messaging</p>
            <p className="mt-1">End-to-end encrypted · No server storage</p>
          </div>
        </div>
      </div>

      {/* QR Code Overlay */}
      {showQR && identity && (
        <QRCodeOverlay address={identity.address} onClose={() => setShowQR(false)} />
      )}
    </div>
  );
}
