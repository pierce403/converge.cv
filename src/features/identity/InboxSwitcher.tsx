import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { Menu, Transition, Portal } from '@headlessui/react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/features/auth';
import { useAuthStore, useInboxRegistryStore, getInboxDisplayLabel } from '@/lib/stores';
import { setStorageNamespace, closeStorage, getStorage } from '@/lib/storage';
import { QRCodeOverlay } from '@/components/QRCodeOverlay';
import { getXmtpClient } from '@/lib/xmtp';
import type { InboxRegistryEntry } from '@/types';

const shortAddress = (value: string) => `${value.slice(0, 6)}…${value.slice(-4)}`;

const dispatchOperationStep = (detail: {
  message: string;
  step: number;
  total: number;
  state?: 'running' | 'complete';
}) => {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(
      new CustomEvent('ui:operation-status', {
        detail: { id: 'inbox-switch', ...detail },
      })
    );
  } catch (e) {
    console.warn('[InboxSwitcher] Failed to dispatch inbox switch status:', e);
  }
};

export function InboxSwitcher() {
  const navigate = useNavigate();
  const { identity } = useAuthStore();
  const setIdentity = useAuthStore((s) => s.setIdentity);
  const hydrateRegistry = useInboxRegistryStore((state) => state.hydrate);
  const registryEntries = useInboxRegistryStore((state) => state.entries);
  const setCurrentInbox = useInboxRegistryStore((state) => state.setCurrentInbox);
  const { burnIdentity, checkExistingIdentity, createIdentity } = useAuth();
  const [displayNameInput, setDisplayNameInput] = useState(identity?.displayName ?? '');
  const [isSavingName, setIsSavingName] = useState(false);
  const [isSavingAvatar, setIsSavingAvatar] = useState(false);
  const [isSyncingProfile, setIsSyncingProfile] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    hydrateRegistry();
  }, [hydrateRegistry]);

  const sortedEntries = [...registryEntries].sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0));
  const currentInboxId = identity?.inboxId ?? null;
  const currentEntry = currentInboxId ? sortedEntries.find((entry) => entry.inboxId === currentInboxId) : undefined;

  const currentLabel = currentEntry
    ? getInboxDisplayLabel(currentEntry)
    : identity?.displayName || (identity?.address ? shortAddress(identity.address) : 'No identity connected');

  const currentBadge = identity?.displayName ? identity.displayName.charAt(0).toUpperCase() : currentLabel.charAt(0).toUpperCase();
  const currentAvatar = useMemo(() => identity?.avatar, [identity?.avatar]);

  useEffect(() => {
    setDisplayNameInput(identity?.displayName ?? '');
  }, [identity?.displayName, identity?.inboxId]);

  const handleSaveDisplayName = async () => {
    if (!identity) return;
    const nextName = displayNameInput.trim();
    setIsSavingName(true);
    try {
      const storage = await getStorage();
      const updated = { ...identity, displayName: nextName || undefined };
      await storage.putIdentity(updated);
      setIdentity(updated);
      try {
        await getXmtpClient().saveProfile(updated.displayName, updated.avatar);
      } catch (err) {
        console.warn('[InboxSwitcher] Failed to save display name to network (non-fatal):', err);
      }
    } catch (error) {
      console.error('[InboxSwitcher] Failed to save display name:', error);
      alert('Failed to update display name. Please try again.');
    } finally {
      setIsSavingName(false);
    }
  };

  const handleAvatarSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    if (!identity) return;
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      alert('Please select an image file');
      event.target.value = '';
      return;
    }

    const readAsDataURL = (f: File) =>
      new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string) ?? '');
        reader.onerror = reject;
        reader.readAsDataURL(f);
      });

    setIsSavingAvatar(true);
    try {
      const dataUri = await readAsDataURL(file);
      const storage = await getStorage();
      const updated = { ...identity, avatar: dataUri };
      await storage.putIdentity(updated);
      setIdentity(updated);
      try {
        await getXmtpClient().saveProfile(updated.displayName, dataUri);
      } catch (err) {
        console.warn('[InboxSwitcher] Failed to save avatar to network (non-fatal):', err);
      }
    } catch (error) {
      console.error('[InboxSwitcher] Failed to update avatar:', error);
      alert('Failed to update avatar. Please try again.');
    } finally {
      setIsSavingAvatar(false);
      event.target.value = '';
    }
  };

  const handleSyncProfile = async () => {
    if (!identity) return;
    setIsSyncingProfile(true);
    try {
      const xmtp = getXmtpClient();
      const profile = await xmtp.loadOwnProfile();
      if (profile && (profile.displayName || profile.avatarUrl)) {
        const storage = await getStorage();
        const updated = { ...identity };
        if (profile.displayName) {
          updated.displayName = profile.displayName;
          setDisplayNameInput(profile.displayName);
        }
        if (profile.avatarUrl) {
          (updated as typeof updated & { avatar?: string }).avatar = profile.avatarUrl;
        }
        await storage.putIdentity(updated);
        setIdentity(updated);
      }
    } catch (error) {
      console.warn('[InboxSwitcher] Failed to sync profile from network:', error);
      alert('Could not sync profile from the network. Please try again.');
    } finally {
      setIsSyncingProfile(false);
    }
  };

  const handleSwitch = async (entry: InboxRegistryEntry) => {
    const nextLabel = getInboxDisplayLabel(entry);
    const steps = [
      `Switching to ${nextLabel}…`,
      `Closing ${currentLabel || 'current inbox'}…`,
      'Preparing inbox storage…',
      'Loading selected inbox…',
      'Reloading for new inbox…',
    ];
    const totalSteps = steps.length;
    dispatchOperationStep({ message: steps[0], step: 1, total: totalSteps });
    setCurrentInbox(entry.inboxId);
    // Swap storage namespace to the selected inbox and hard reload state
    try {
      dispatchOperationStep({ message: steps[1], step: 2, total: totalSteps });
      await closeStorage();
      dispatchOperationStep({ message: steps[2], step: 3, total: totalSteps });
      await setStorageNamespace(entry.inboxId);
      // One-shot hint for next boot to force this inbox selection
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('converge.forceInboxId.v1', entry.inboxId);
      }
    } catch (e) {
      console.warn('[InboxSwitcher] Failed to reset storage (continuing):', e);
      dispatchOperationStep({
        message: 'Storage reset failed — continuing switch',
        step: 3,
        total: totalSteps,
      });
    }
    dispatchOperationStep({ message: steps[3], step: 4, total: totalSteps });
    await checkExistingIdentity();
    dispatchOperationStep({
      message: steps[4],
      step: totalSteps,
      total: totalSteps,
      state: 'complete',
    });
    // Reload the app to ensure in-memory stores hydrate from the new namespace
    setTimeout(() => window.location.reload(), 50);
  };

  const handleCreateEphemeral = async () => {
    try {
      const { generateMnemonic, mnemonicToAccount, english } = await import('viem/accounts');
      const { bytesToHex } = await import('viem');
      const mnemonic = generateMnemonic(english);
      const account = mnemonicToAccount(mnemonic, { path: "m/44'/60'/0'/0/0" });
      const pkBytes = account.getHdKey().privateKey;
      if (!pkBytes) throw new Error('Failed to derive private key');
      const privateKeyHex = bytesToHex(pkBytes);
      const label = `Identity ${shortAddress(account.address)}`;
      const ok = await createIdentity(account.address, privateKeyHex, undefined, undefined, {
        register: true,
        enableHistorySync: true,
        label,
        mnemonic,
      });
      if (!ok) throw new Error('createIdentity returned false');
      navigate('/');
    } catch (e) {
      console.error('[InboxSwitcher] Failed to create ephemeral identity:', e);
      alert('Failed to create a new identity. Please try again.');
    }
  };

  const handleBurnCurrent = async () => {
    if (!identity?.inboxId) {
      return;
    }

    const confirmed = window.confirm(
      'Burn this inbox on this device? This will delete the stored keys, messages, and contacts for this identity.'
    );
    if (!confirmed) {
      return;
    }

    const confirmedTwice = window.confirm('This cannot be undone. Continue?');
    if (!confirmedTwice) {
      return;
    }

    try {
      const success = await burnIdentity(identity.inboxId);
      if (!success) {
        throw new Error('burnIdentity returned false');
      }
      await checkExistingIdentity();
      window.location.reload();
    } catch (error) {
      console.error('[InboxSwitcher] Failed to burn identity:', error);
      alert('Failed to burn this inbox. Please try again.');
    }
  };

  return (
    <Menu as="div" className="relative inline-block text-left z-[12000]">
      <Menu.Button className="flex items-center gap-3 rounded-full border border-primary-700/70 bg-primary-900/80 px-3 py-1.5 text-left text-sm font-medium text-primary-100 shadow hover:border-accent-400 hover:text-white">
        {currentAvatar ? (
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-full overflow-hidden bg-primary-800/60">
            <img src={currentAvatar} alt="Avatar" className="h-full w-full object-cover" />
          </span>
        ) : (
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-accent-600 text-sm font-semibold text-white">
            {currentBadge}
          </span>
        )}
        <span className="hidden sm:block leading-tight">
          <span className="block text-xs text-primary-300">Current inbox</span>
          <span className="block text-sm font-semibold text-primary-100">{currentLabel}</span>
        </span>
        <svg
          className="h-4 w-4 text-primary-300"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 011.08 1.04l-4.25 4.25a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z"
            clipRule="evenodd"
          />
        </svg>
      </Menu.Button>

      <Transition
        as={Fragment}
        enter="transition ease-out duration-100"
        enterFrom="transform opacity-0 scale-95"
        enterTo="transform opacity-100 scale-100"
        leave="transition ease-in duration-75"
        leaveFrom="transform opacity-100 scale-100"
        leaveTo="transform opacity-0 scale-95"
      >
        <Portal>
          {/* Center dropdown under the viewport header and ensure it stays on screen */}
          <Menu.Items
            className="fixed left-1/2 -translate-x-1/2 top-16 z-[20000] w-80 max-w-[92vw] max-h-[70vh] overflow-auto origin-top rounded-xl border border-primary-800/80 bg-primary-950/95 p-3 text-primary-100 shadow-2xl backdrop-blur"
          >
            <div className="mb-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-primary-400">Profile</div>
              <div className="mt-2 rounded-lg border border-primary-800/60 bg-primary-900/60 p-3">
                <div className="flex items-center gap-3">
                  {currentAvatar ? (
                    <span className="inline-flex h-12 w-12 items-center justify-center overflow-hidden rounded-full border border-primary-800 bg-primary-950">
                      <img src={currentAvatar} alt="Avatar" className="h-full w-full object-cover" />
                    </span>
                  ) : (
                    <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-accent-600 text-lg font-semibold text-white">
                      {currentBadge}
                    </span>
                  )}
                  <div className="flex-1 min-w-0">
                    <label htmlFor="inbox-display-name" className="text-[11px] font-semibold uppercase tracking-wide text-primary-400">Display name</label>
                    <input
                      id="inbox-display-name"
                      value={displayNameInput}
                      onChange={(e) => setDisplayNameInput(e.target.value)}
                      placeholder={identity?.address ? shortAddress(identity.address) : 'Enter display name'}
                      className="mt-1 w-full rounded-md border border-primary-800/70 bg-primary-950/70 px-2 py-1 text-sm text-primary-100 placeholder-primary-600 focus:border-accent-500 focus:outline-none"
                    />
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    onClick={handleSaveDisplayName}
                    disabled={!identity || isSavingName}
                    className="inline-flex items-center rounded-md border border-accent-500/60 bg-accent-600/20 px-3 py-1.5 text-xs font-semibold text-accent-100 transition hover:border-accent-400 hover:bg-accent-600/30 disabled:cursor-not-allowed disabled:border-primary-800 disabled:bg-primary-900/60 disabled:text-primary-500"
                  >
                    {isSavingName ? 'Saving…' : 'Save display name'}
                  </button>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={!identity || isSavingAvatar}
                    className="inline-flex items-center rounded-md border border-primary-700/70 bg-primary-900 px-3 py-1.5 text-xs font-semibold text-primary-100 transition hover:border-accent-400 hover:text-white disabled:cursor-not-allowed disabled:border-primary-800 disabled:text-primary-500"
                  >
                    {isSavingAvatar ? 'Updating avatar…' : 'Update avatar'}
                  </button>
                  <button
                    onClick={handleSyncProfile}
                    disabled={!identity || isSyncingProfile}
                    className="inline-flex items-center rounded-md border border-primary-700/70 bg-primary-900 px-3 py-1.5 text-xs font-semibold text-primary-100 transition hover:border-accent-400 hover:text-white disabled:cursor-not-allowed disabled:border-primary-800 disabled:text-primary-500"
                  >
                    {isSyncingProfile ? 'Syncing…' : 'Sync from network'}
                  </button>
                  <button
                    onClick={() => setShowQR(true)}
                    disabled={!identity}
                    className="inline-flex items-center rounded-md border border-primary-700/70 bg-primary-900 px-3 py-1.5 text-xs font-semibold text-primary-100 transition hover:border-accent-400 hover:text-white disabled:cursor-not-allowed disabled:border-primary-800 disabled:text-primary-500"
                  >
                    Show QR Code
                  </button>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleAvatarSelected}
                />
              </div>
            </div>

            <div className="mb-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-primary-400">This identity&apos;s inbox</div>
              {identity?.inboxId ? (
                <div className="mt-2 rounded-lg border border-primary-800/60 bg-primary-900/60 p-3 text-xs text-primary-200">
                  <div className="font-semibold text-primary-100">{currentLabel}</div>
                  <div className="mt-1 break-all text-primary-300">Inbox ID: {identity.inboxId}</div>
                  <div className="mt-1 text-primary-400">
                    Address: {identity.address}
                  </div>
                  <div className="mt-2 text-[11px] text-primary-500">
                    Identities cannot be merged. Moving an identity routes future messages to the destination inbox only.
                  </div>
                  <button
                    onClick={handleBurnCurrent}
                    className="mt-3 inline-flex items-center rounded-lg border border-red-500/60 bg-red-900/30 px-3 py-1.5 text-[11px] font-semibold text-red-100 transition hover:border-red-400 hover:bg-red-800/40"
                  >
                    Burn this inbox on this device
                  </button>
                </div>
              ) : (
                <div className="mt-2 text-xs text-primary-300">
                  Connect an identity to see inbox details and linked devices.
                </div>
              )}
            </div>

            <div className="my-2 h-px bg-primary-800/60" />

            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-primary-400">On this device</div>
              {sortedEntries.length === 0 ? (
                <div className="mt-2 text-xs text-primary-300">No inboxes stored locally yet.</div>
              ) : (
                <div className="mt-2 space-y-2">
                  {sortedEntries.map((entry) => (
                    <Menu.Item key={entry.inboxId}>
                      {({ active }) => (
                        <button
                          onClick={() => handleSwitch(entry)}
                          disabled={entry.inboxId === currentInboxId}
                          className={`w-full rounded-lg border px-3 py-2 text-left text-xs transition ${
                            entry.inboxId === currentInboxId
                              ? 'cursor-default border-accent-500/60 bg-accent-600/20 text-accent-100'
                              : active
                              ? 'border-accent-500/60 bg-primary-900/70 text-primary-100'
                              : 'border-primary-800/60 bg-primary-900/40 text-primary-200 hover:border-accent-500/60'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-primary-100">{getInboxDisplayLabel(entry)}</span>
                            <span className="text-[10px] text-primary-400">{entry.hasLocalDB ? 'Local DB' : 'History sync pending'}</span>
                          </div>
                          <div className="mt-1 break-all text-[11px] text-primary-300">{entry.inboxId}</div>
                          <div className="mt-1 text-[11px] text-primary-400">
                            Primary identity: {entry.primaryDisplayIdentity}
                          </div>
                        </button>
                      )}
                    </Menu.Item>
                  ))}
                </div>
              )}
            </div>

            <div className="my-2 h-px bg-primary-800/60" />

            <Menu.Item>
              {({ active }) => (
                <button
                  onClick={() => navigate('/onboarding?connect=1')}
                  className={`w-full rounded-lg px-3 py-2 text-left text-sm font-semibold transition ${
                    active ? 'bg-accent-600/20 text-accent-200' : 'text-accent-300 hover:text-accent-200'
                  }`}
                >
                  Connect to another inbox…
                </button>
              )}
            </Menu.Item>

            <div className="my-2 h-px bg-primary-800/60" />

            <Menu.Item>
              {({ active }) => (
                <button
                  onClick={handleCreateEphemeral}
                  className={`w-full rounded-lg px-3 py-2 text-left text-sm font-semibold transition ${
                    active ? 'bg-primary-800/70 text-primary-100' : 'text-primary-200 hover:text-primary-100'
                  }`}
                >
                  Create ephemeral identity
                </button>
              )}
            </Menu.Item>
          </Menu.Items>
        </Portal>
      </Transition>
      {showQR && identity && <QRCodeOverlay address={identity.address} onClose={() => setShowQR(false)} />}
    </Menu>
  );
}
