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
import { usePublicClient } from 'wagmi';
import { QRCodeOverlay } from '@/components/QRCodeOverlay';
import { enablePushForCurrentUser, disablePush, isPushEnabled, getPushPermissionStatus } from '@/lib/push';
import { exportIdentityToKeyfile, serializeKeyfile } from '@/lib/keyfile';
import { FarcasterSettings } from './FarcasterSettings';
import { WalletProviderSelector } from '@/components/WalletProviderSelector';
import { ThirdwebConnectButton } from '@/components/ThirdwebConnectButton';

const BASE_CHAIN_ID = 8453;

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
      'Orca', 'Dolphin', 'Whale', 'Penguin', 'Seal', 'Otter', 'Shark', 'Turtle', 'Eagle', 'Falcon', 'Hawk', 'Owl', 'Fox', 'Wolf', 'Bear', 'Tiger', 'Lion', 'Zebra', 'Giraffe', 'Elephant', 'Monkey', 'Panda', 'Koala', 'Kangaroo', 'Rabbit', 'Deer', 'Horse', 'Bison', 'Buffalo', 'Camel', 'Hippo', 'Rhino', 'Leopard', 'Cheetah', 'Jaguar', 'Goat', 'Sheep', 'Cow', 'Pig', 'Dog', 'Cat', 'Goose', 'Duck', 'Swan', 'Frog', 'Toad', 'Lizard', 'Snake', 'Chimpanzee', 'Gorilla',
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
    return v.startsWith('Identity ') || v.startsWith('Wallet ') || v.toLowerCase().startsWith('0x');
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
  const {
    disconnectWallet,
    connectDefaultWallet,
    connectWallet,
    walletOptions,
    isConnected: isWalletConnected,
    address: walletAddress,
    signMessage,
    provider: walletProvider,
  } = useWalletConnection();
  const basePublicClient = usePublicClient({ chainId: BASE_CHAIN_ID });
  const [showQR, setShowQR] = useState(false);
  // Track push status
  const [pushStatus, setPushStatus] = useState<'unknown' | 'enabled' | 'disabled' | 'unsupported'>('unknown');
  const [isPushLoading, setIsPushLoading] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [showConnectorList, setShowConnectorList] = useState(false);
  const [showAddIdentityModal, setShowAddIdentityModal] = useState(false);
  const [isAddingIdentity, setIsAddingIdentity] = useState(false);
  const [addIdentityError, setAddIdentityError] = useState<string | null>(null);
  const canDownloadKeyfile = Boolean(identity?.privateKey || identity?.mnemonic);

  // Helper to reconnect to XMTP
  const handleReconnect = async () => {
    if (!identity || isReconnecting) return;

    setIsReconnecting(true);
    try {
      setConnectError(null);
      setShowConnectorList(false);
      const xmtp = getXmtpClient();

      // If identity has a private key (Converge-generated), use it directly
      if (identity.privateKey) {
        await xmtp.connect({
          address: identity.address,
          privateKey: identity.privateKey,
        });
        return;
      }

      // For wallet-connected identities, ensure the wallet is connected to the right address
      let effectiveWallet = walletAddress?.toLowerCase();
      try {
        if (!isWalletConnected || effectiveWallet !== identity.address.toLowerCase()) {
          const result = await connectDefaultWallet();
          const connectedAccounts = (result as { accounts?: readonly string[] } | undefined)?.accounts;
          const connected = connectedAccounts?.[0];
          effectiveWallet = typeof connected === 'string' ? connected.toLowerCase() : effectiveWallet;
        }
      } catch (connectErr) {
        setConnectError('No wallet provider found. Choose a wallet below to reconnect.');
        setShowConnectorList(true);
        throw connectErr;
      }

      if (effectiveWallet !== identity.address.toLowerCase()) {
        throw new Error('Please connect the wallet that owns this identity to continue.');
      }

      if (!signMessage) {
        throw new Error('Wallet signing is not available. Try reconnecting your wallet.');
      }

      await xmtp.connect({
        address: identity.address,
        signMessage: async (message: string) => await signMessage(message),
      });
    } catch (error) {
      console.error('Reconnect failed:', error);
      if (!showConnectorList && !isWalletConnected) {
        setShowConnectorList(true);
      }
      if (error instanceof Error && !connectError) {
        setConnectError(error.message);
      }
    } finally {
      setIsReconnecting(false);
    }
  };

  // Check push status on mount
  useEffect(() => {
    const checkPushStatus = async () => {
      const permission = getPushPermissionStatus();
      if (permission === 'unsupported') {
        setPushStatus('unsupported');
        return;
      }
      const enabled = await isPushEnabled();
      setPushStatus(enabled ? 'enabled' : 'disabled');
    };
    checkPushStatus();
  }, []);

  const handleLockVault = () => {
    lock();
  };

  const handleEnablePush = async () => {
    if (isPushLoading) return;
    setIsPushLoading(true);
    try {
      const userId = identity?.inboxId || identity?.address || 'anon';
      const result = await enablePushForCurrentUser({ userId, channelId: 'default' });

      if (result.success) {
        setPushStatus('enabled');
        alert('Notifications enabled! You will receive push notifications for new messages.');
      } else {
        alert(`Failed to enable notifications: ${result.error || 'Unknown error'}`);
      }
    } catch (e) {
      console.warn('[Settings] Enable push failed', e);
      alert('Failed to enable notifications');
    } finally {
      setIsPushLoading(false);
    }
  };

  const handleDisablePush = async () => {
    if (isPushLoading) return;
    setIsPushLoading(true);
    try {
      const success = await disablePush();
      if (success) {
        setPushStatus('disabled');
        alert('Notifications disabled');
      } else {
        alert('Failed to disable notifications');
      }
    } catch (e) {
      console.warn('[Settings] Disable push failed', e);
      alert('Failed to disable notifications');
    } finally {
      setIsPushLoading(false);
    }
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

  const pickBaseSmartWalletAddress = async (accounts: string[]): Promise<string | null> => {
    const normalized = Array.from(new Set(accounts.filter(Boolean)));
    if (normalized.length === 0) return null;

    // Prefer an address that appears to be a contract on Base (common for smart wallets).
    if (basePublicClient) {
      for (const account of normalized) {
        try {
          const bytecode = await basePublicClient.getBytecode({ address: account as `0x${string}` });
          if (bytecode && bytecode !== '0x') {
            return account;
          }
        } catch {
          // ignore and continue
        }
      }
    }

    // Otherwise prefer a non-primary-identity address if multiple are returned.
    const my = identity?.address?.toLowerCase();
    const notMine = my ? normalized.find((acct) => acct.toLowerCase() !== my) : undefined;
    return notMine ?? normalized[0];
  };

  const addBaseSmartWalletIdentity = async (accounts: readonly string[] | undefined) => {
    if (!identity) {
      throw new Error('No identity is currently loaded.');
    }

    const xmtp = getXmtpClient();
    if (!xmtp.isConnected()) {
      throw new Error('Connect to the XMTP network first, then try again.');
    }

    const addressList = Array.from(new Set((accounts ?? []).filter(Boolean)));
    const smartWalletAddress = await pickBaseSmartWalletAddress(addressList);

    if (!smartWalletAddress) {
      throw new Error('No wallet address was returned. Try connecting your Base app wallet again.');
    }

    if (smartWalletAddress.toLowerCase() === identity.address.toLowerCase()) {
      throw new Error('That wallet address is already your current identity.');
    }

    await xmtp.addAccount({
      address: smartWalletAddress,
      chainId: BASE_CHAIN_ID,
      walletType: 'SCW',
      signMessage: async (message: string) => {
        if (!signMessage) {
          throw new Error('Wallet signing is not available. Connect your wallet and try again.');
        }
        return await signMessage(message, smartWalletAddress);
      },
    });

    alert(
      `✅ Linked Base smart wallet ${smartWalletAddress} to this inbox.\n\nOther XMTP apps may take a moment to pick up the new association.`
    );
  };

  const handleAddIdentity = () => {
    setAddIdentityError(null);
    setShowAddIdentityModal(true);
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
        // Helper: robustly clear cookies for all paths/domains on this origin
        const clearAllCookies = async () => {
          try {
            const raw = document.cookie;
            if (!raw) return;
            const cookiePairs = raw.split(';');
            const names = cookiePairs
              .map((c) => c.trim())
              .filter(Boolean)
              .map((c) => (c.includes('=') ? c.slice(0, c.indexOf('=')) : c));

            // Generate domain variants: exact host, parent domains, and dotted forms
            const host = location.hostname;
            const parts = host.split('.');
            const domainVariants = new Set<string>([host]);
            for (let i = 0; i < parts.length; i++) {
              const dom = parts.slice(i).join('.');
              if (dom) {
                domainVariants.add(dom);
                domainVariants.add('.' + dom);
              }
            }

            // Generate path variants from deepest to root
            const path = location.pathname || '/';
            const segments = path.split('/').filter(Boolean);
            const pathVariants = new Set<string>(['/']);
            for (let i = 0; i < segments.length; i++) {
              pathVariants.add('/' + segments.slice(0, i + 1).join('/'));
            }

            const expires = 'Thu, 01 Jan 1970 00:00:00 GMT';
            const setExpired = (name: string, opts: string) => {
              try { document.cookie = `${name}=; Expires=${expires}; Max-Age=0; ${opts}`; } catch (e) { /* ignore set-cookie failure */ }
              try { document.cookie = `${name}=; Expires=${expires}; ${opts}`; } catch (e) { /* ignore set-cookie failure */ }
            };

            // Without domain attribute (current host implied)
            for (const name of names) {
              for (const p of pathVariants) {
                setExpired(name, `Path=${p}; SameSite=Lax`);
                // Try with Secure attribute as some cookies were set with SameSite=None; Secure
                setExpired(name, `Path=${p}; SameSite=None; Secure`);
              }
            }

            // With explicit domain attribute variants
            for (const name of names) {
              for (const d of domainVariants) {
                for (const p of pathVariants) {
                  setExpired(name, `Domain=${d}; Path=${p}; SameSite=Lax`);
                  setExpired(name, `Domain=${d}; Path=${p}; SameSite=None; Secure`);
                }
              }
            }
          } catch (err) {
            console.warn('[Settings] Failed to clear some cookies (non-fatal):', err);
          }
        };



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

        // 4) Clear cookies for this origin (best-effort)
        await clearAllCookies();

        // 5) Clear service worker caches and unregister SW (force a fresh start)
        try {
          if ('caches' in window) {
            const cacheNames = await caches.keys();
            await Promise.all(cacheNames.map((name) => caches.delete(name)));
            console.log('[Settings] Cleared service worker caches');
          }
          if ('serviceWorker' in navigator) {
            // Unregister all known registrations
            const registrations = await navigator.serviceWorker.getRegistrations();
            await Promise.all(registrations.map((reg) => reg.unregister()));
            // Also try the current scope registration (Safari compatibility)
            try {
              const reg = await navigator.serviceWorker.getRegistration();
              if (reg) await reg.unregister();
            } catch (e) {
              console.warn('[Settings] SW getRegistration/unregister failed (non-fatal):', e);
            }
            console.log('[Settings] Unregistered service workers');
          }
        } catch (e) {
          console.warn('[Settings] Failed to clear SW caches or unregister SW (non-fatal):', e);
        }

        // 6) Trigger a hard reload with a clear flag to wipe databases on fresh load
        // This avoids "blocked" events from open connections in the current session
        console.log('[Settings] scheduling clear-all-data via reload');
        window.location.href = '/settings?clear_all_data=true';
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

  const shouldShowReconnect = connectionStatus === 'error' || connectionStatus === 'disconnected';
  const walletNeedsReconnect = Boolean(identity && !identity.privateKey && !isWalletConnected);

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
                {shouldShowReconnect && (
                  <div className="mt-2 space-y-2">
                    {connectionStatus === 'error' && xmtpError && (
                      <div className="text-xs text-red-400 bg-red-500/10 rounded p-2">
                        {xmtpError}
                      </div>
                    )}
                    {connectionStatus === 'disconnected' && (
                      <div className="text-xs text-primary-300">
                        Not connected to the XMTP network. Messages won't sync until reconnected.
                      </div>
                    )}
                    {walletNeedsReconnect && (
                      <div className="text-xs text-yellow-400">
                        Wallet not connected. Please reconnect your wallet to sign in.
                      </div>
                    )}
                    {connectError && (
                      <div className="text-xs text-red-400 bg-red-500/10 rounded p-2">
                        {connectError}
                      </div>
                    )}
                    <button
                      onClick={handleReconnect}
                      disabled={isReconnecting || !identity}
                      className="btn-primary text-xs disabled:opacity-50"
                    >
                      {isReconnecting ? 'Connecting...' : connectionStatus === 'error' ? 'Retry Connection' : 'Connect'}
                    </button>
                    {showConnectorList && (
                      <div className="space-y-2">
                        <div className="text-xs text-primary-300">Choose a wallet to reconnect:</div>
                        {walletProvider === 'thirdweb' ? (
                          <ThirdwebConnectButton
                            label="Connect with Thirdweb"
                            className="w-full"
                            onConnected={() => {
                              if (!isReconnecting) {
                                void handleReconnect();
                              }
                            }}
                          />
                        ) : (
                          <div className="flex flex-wrap gap-2">
                            {walletOptions.map((option) => (
                              <button
                                key={option.id}
                                onClick={async () => {
                                  try {
                                    setConnectError(null);
                                    await connectWallet(option);
                                    await handleReconnect();
                                  } catch (err) {
                                    setConnectError(
                                      err instanceof Error ? err.message : 'Failed to connect wallet'
                                    );
                                  }
                                }}
                                className="btn-secondary text-xs px-3 py-1"
                                disabled={isReconnecting || option.disabled}
                              >
                                {option.name}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
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

              {/* Wallet Provider */}
              <div className="p-4">
                <WalletProviderSelector dense />
                <div className="mt-2 text-xs text-primary-400">
                  Controls which wallet system is used for onboarding and linking identities.
                </div>
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

          <FarcasterSettings />

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
                    <div className="font-medium">Notifications</div>
                    <div className="text-sm text-primary-200">
                      {pushStatus === 'unsupported'
                        ? 'Not supported in this browser'
                        : pushStatus === 'enabled'
                          ? 'Push notifications are active'
                          : 'Web push (requires permission)'}
                    </div>
                  </div>
                  <div className="flex gap-2 items-center">
                    {pushStatus === 'enabled' && (
                      <span className="text-sm text-green-500">✓</span>
                    )}
                    {pushStatus !== 'unsupported' && (
                      <>
                        {pushStatus !== 'enabled' && (
                          <button
                            onClick={handleEnablePush}
                            disabled={isPushLoading}
                            className="btn-primary text-sm disabled:opacity-50"
                          >
                            {isPushLoading ? '...' : 'Enable'}
                          </button>
                        )}
                        {pushStatus === 'enabled' && (
                          <button
                            onClick={handleDisablePush}
                            disabled={isPushLoading}
                            className="btn-secondary text-sm disabled:opacity-50"
                          >
                            {isPushLoading ? '...' : 'Disable'}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
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
                  <span>XMTP protocol v3 (SDK v5.0.1)</span>
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

      {/* Add Identity Modal */}
      {showAddIdentityModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-lg rounded-xl border border-primary-800/60 bg-primary-950 shadow-2xl">
            <div className="p-4 border-b border-primary-800/60 flex items-center justify-between">
              <div>
                <div className="text-lg font-semibold text-primary-50">Add Identity (Base)</div>
                <div className="text-sm text-primary-200">Link your Base App smart wallet to this inbox.</div>
              </div>
              <button
                onClick={() => {
                  if (isAddingIdentity) return;
                  setShowAddIdentityModal(false);
                }}
                className="text-primary-300 hover:text-primary-100 transition-colors"
                aria-label="Close"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-4 space-y-3">
              <p className="text-sm text-primary-200">
                You&apos;ll be asked to sign a message in your wallet. This associates your Base smart wallet address with your existing XMTP inbox so other clients can resolve the same inbox from either address.
              </p>

              {addIdentityError && (
                <div className="text-xs text-red-400 bg-red-500/10 rounded p-2">
                  {addIdentityError}
                </div>
              )}

              {isWalletConnected && walletAddress && (
                <div className="rounded-lg border border-primary-800/60 bg-primary-900/50 p-3">
                  <div className="text-xs text-primary-300 mb-1">Connected wallet</div>
                  <div className="font-mono text-xs text-primary-100 break-all">{walletAddress}</div>
                  <div className="mt-2">
                    <button
                      onClick={async () => {
                        if (isAddingIdentity) return;
                        setIsAddingIdentity(true);
                        setAddIdentityError(null);
                        try {
                          await addBaseSmartWalletIdentity([walletAddress]);
                          setShowAddIdentityModal(false);
                        } catch (err) {
                          setAddIdentityError(err instanceof Error ? err.message : 'Failed to add identity');
                        } finally {
                          setIsAddingIdentity(false);
                        }
                      }}
                      disabled={isAddingIdentity}
                      className="btn-primary text-sm px-3 py-2 disabled:opacity-50"
                    >
                      {isAddingIdentity ? 'Linking…' : 'Link Connected Wallet'}
                    </button>
                  </div>
                </div>
              )}

              <div className="text-sm text-primary-200">Or connect a wallet:</div>
              {walletProvider === 'thirdweb' ? (
                <ThirdwebConnectButton
                  label={isAddingIdentity ? 'Working…' : 'Connect with Thirdweb'}
                  className="w-full"
                  onConnected={async (addr) => {
                    if (isAddingIdentity) return;
                    setIsAddingIdentity(true);
                    setAddIdentityError(null);
                    try {
                      await addBaseSmartWalletIdentity([addr]);
                      setShowAddIdentityModal(false);
                    } catch (err) {
                      setAddIdentityError(err instanceof Error ? err.message : 'Failed to connect wallet');
                    } finally {
                      setIsAddingIdentity(false);
                    }
                  }}
                />
              ) : (
                <div className="flex flex-wrap gap-2">
                  {walletOptions.map((option) => (
                    <button
                      key={option.id}
                      onClick={async () => {
                        if (isAddingIdentity) return;
                        setIsAddingIdentity(true);
                        setAddIdentityError(null);
                        try {
                          const result = await connectWallet(option);
                          const accounts = (result as { accounts?: readonly string[] } | undefined)?.accounts;
                          await addBaseSmartWalletIdentity(accounts);
                          setShowAddIdentityModal(false);
                        } catch (err) {
                          setAddIdentityError(err instanceof Error ? err.message : 'Failed to connect wallet');
                        } finally {
                          setIsAddingIdentity(false);
                        }
                      }}
                      disabled={isAddingIdentity || option.disabled}
                      className="btn-secondary text-sm px-3 py-2 disabled:opacity-50"
                    >
                      {isAddingIdentity ? 'Working…' : option.name}
                    </button>
                  ))}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  onClick={() => setShowAddIdentityModal(false)}
                  disabled={isAddingIdentity}
                  className="btn-secondary text-sm px-3 py-2 disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
