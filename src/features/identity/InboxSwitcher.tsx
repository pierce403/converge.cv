import { Fragment, useEffect, useMemo } from 'react';
import { Menu, Transition, Portal } from '@headlessui/react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/features/auth';
import { useAuthStore, useInboxRegistryStore, getInboxDisplayLabel } from '@/lib/stores';
import { setStorageNamespace, closeStorage } from '@/lib/storage';
import type { InboxRegistryEntry } from '@/types';

const shortAddress = (value: string) => `${value.slice(0, 6)}…${value.slice(-4)}`;

const dispatchStepToast = (message: string) => {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent('ui:toast', { detail: message }));
  } catch (e) {
    console.warn('[InboxSwitcher] Failed to dispatch toast:', e);
  }
};

export function InboxSwitcher() {
  const navigate = useNavigate();
  const { identity } = useAuthStore();
  const hydrateRegistry = useInboxRegistryStore((state) => state.hydrate);
  const registryEntries = useInboxRegistryStore((state) => state.entries);
  const setCurrentInbox = useInboxRegistryStore((state) => state.setCurrentInbox);
  const { checkExistingIdentity, createIdentity } = useAuth();

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

  const handleSwitch = async (entry: InboxRegistryEntry) => {
    const nextLabel = getInboxDisplayLabel(entry);
    dispatchStepToast(`Switching to ${nextLabel}…`);
    setCurrentInbox(entry.inboxId);
    // Swap storage namespace to the selected inbox and hard reload state
    try {
      dispatchStepToast(`Closing ${currentLabel || 'current inbox'}…`);
      await closeStorage();
      dispatchStepToast('Preparing inbox storage…');
      await setStorageNamespace(entry.inboxId);
      // One-shot hint for next boot to force this inbox selection
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('converge.forceInboxId.v1', entry.inboxId);
      }
    } catch (e) {
      console.warn('[InboxSwitcher] Failed to reset storage (continuing):', e);
      dispatchStepToast('Storage reset failed — continuing switch');
    }
    dispatchStepToast('Loading selected inbox…');
    await checkExistingIdentity();
    dispatchStepToast('Reloading for new inbox…');
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
    </Menu>
  );
}
