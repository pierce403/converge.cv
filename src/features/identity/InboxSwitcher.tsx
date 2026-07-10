import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { Menu, Portal, Transition } from '@headlessui/react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/features/auth';
import {
  getInboxDisplayLabel,
  INBOX_ALREADY_LOADED_MESSAGE,
  useAuthStore,
  useInboxRegistryStore,
  useXmtpStore,
} from '@/lib/stores';
import { getStorage } from '@/lib/storage';
import { getXmtpClient } from '@/lib/xmtp';
import type { InboxRegistryEntry } from '@/types';
import { generateLocalAppIdentity } from '@/lib/identity/local-app-key';
import { formatCreateInboxError } from '@/lib/identity/identity-errors';
import { isInboxLoadedLocally } from '@/lib/identity/loaded-inbox';
import {
  assertKeyfileInboxMatch,
  deriveIdentityFromKeyfile,
  parseKeyfile,
} from '@/lib/keyfile';
import { getResumableKeyfileInstallationId } from '@/features/auth/keyfile-resume';
import { requestProfileEditor } from '@/features/auth/onboarding-state';
import {
  clearPushActivityForInbox,
  listPendingPushActivity,
  listenForPushActivity,
  listenForPushActivityCleared,
} from '@/lib/push';
import { normalizeInboxId } from '@/lib/utils/inbox';

const dispatchOperationStep = (detail: {
  message: string;
  step: number;
  total: number;
  state?: 'running' | 'complete';
}) => {
  try {
    window.dispatchEvent(
      new CustomEvent('ui:operation-status', {
        detail: { id: 'inbox-switch', ...detail },
      })
    );
  } catch (error) {
    console.warn('[InboxSwitcher] Failed to dispatch operation status:', error);
  }
};

function InboxAvatar({ entry, activeAvatar }: { entry?: InboxRegistryEntry; activeAvatar?: string }) {
  const label = entry ? getInboxDisplayLabel(entry) : 'Inbox';
  const avatar = entry?.avatar || activeAvatar;

  if (avatar) {
    return (
      <span className="inline-flex h-9 w-9 shrink-0 overflow-hidden rounded-full bg-primary-800">
        <img src={avatar} alt="" className="h-full w-full object-cover" />
      </span>
    );
  }

  return (
    <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-600 text-sm font-semibold text-white">
      {label.charAt(0).toUpperCase()}
    </span>
  );
}

export function InboxSwitcher() {
  const navigate = useNavigate();
  const identity = useAuthStore((state) => state.identity);
  const hydrateRegistry = useInboxRegistryStore((state) => state.hydrate);
  const registryEntries = useInboxRegistryStore((state) => state.entries);
  const setCurrentInbox = useInboxRegistryStore((state) => state.setCurrentInbox);
  const syncStatus = useXmtpStore((state) => state.syncStatus);
  const { createIdentity, probeIdentity } = useAuth();
  const keyfileInputRef = useRef<HTMLInputElement | null>(null);
  const activityRevisionRef = useRef(0);
  const syncedInboxIdRef = useRef<string | null>(null);
  const [operation, setOperation] = useState<string | null>(null);
  const [pendingInboxIds, setPendingInboxIds] = useState<Set<string>>(new Set());
  const currentInboxId = identity?.inboxId
    ? normalizeInboxId(identity.inboxId) ?? identity.inboxId.trim().toLowerCase()
    : null;

  useEffect(() => {
    hydrateRegistry();
  }, [hydrateRegistry]);

  useEffect(() => {
    if (syncStatus === 'complete' && currentInboxId) {
      syncedInboxIdRef.current = currentInboxId;
    } else if (syncedInboxIdRef.current !== currentInboxId) {
      syncedInboxIdRef.current = null;
    }
  }, [currentInboxId, syncStatus]);

  useEffect(() => {
    let active = true;
    const initialRevision = activityRevisionRef.current;
    void listPendingPushActivity().then((activity) => {
      if (!active || activityRevisionRef.current !== initialRevision) return;
      setPendingInboxIds(
        new Set(
          activity.flatMap((item) => {
            const inboxId = item.inboxId ? normalizeInboxId(item.inboxId) : null;
            return inboxId ? [inboxId] : [];
          })
        )
      );
    });
    const stopListening = listenForPushActivity((activity) => {
      activityRevisionRef.current += 1;
      const inboxId = activity.inboxId ? normalizeInboxId(activity.inboxId) : null;
      if (!inboxId) return;
      const activeInboxId = normalizeInboxId(useAuthStore.getState().identity?.inboxId);
      if (
        inboxId === activeInboxId &&
        useXmtpStore.getState().connectionStatus === 'connected' &&
        (useXmtpStore.getState().syncStatus === 'complete' ||
          syncedInboxIdRef.current === inboxId)
      ) {
        void clearPushActivityForInbox(inboxId);
        return;
      }
      setPendingInboxIds((current) => new Set(current).add(inboxId));
    });
    const stopListeningForClears = listenForPushActivityCleared((inboxId) => {
      activityRevisionRef.current += 1;
      setPendingInboxIds((current) => {
        if (!inboxId) return current.size > 0 ? new Set() : current;
        if (!current.has(inboxId)) return current;
        const next = new Set(current);
        next.delete(inboxId);
        return next;
      });
    });
    return () => {
      active = false;
      stopListening();
      stopListeningForClears();
    };
  }, []);

  const sortedEntries = useMemo(
    () => [...registryEntries].sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0)),
    [registryEntries]
  );
  const currentEntry = currentInboxId
    ? sortedEntries.find((entry) => entry.inboxId === currentInboxId)
    : undefined;
  const currentLabel = currentEntry
    ? getInboxDisplayLabel(currentEntry)
    : identity?.displayName || 'Inbox';
  const hasPendingActivity = pendingInboxIds.size > 0;

  const reloadIntoInbox = async (inboxId: string) => {
    setCurrentInbox(inboxId);
    window.localStorage.setItem('converge.forceInboxId.v1', inboxId);
    // Keep the old namespace bound until navigation tears down this page. The
    // next boot selects the requested namespace before connecting, preventing
    // in-flight work from the old inbox from writing into the new inbox.
    window.location.assign('/');
  };

  const handleSwitch = async (entry: InboxRegistryEntry) => {
    if (entry.inboxId === currentInboxId || operation) {
      return;
    }

    const label = getInboxDisplayLabel(entry);
    setOperation(`Opening ${label}…`);
    dispatchOperationStep({ message: `Opening ${label}…`, step: 1, total: 3 });
    try {
      await getXmtpClient().disconnect();
      dispatchOperationStep({ message: 'Loading inbox storage…', step: 2, total: 3 });
      await reloadIntoInbox(entry.inboxId);
      dispatchOperationStep({
        message: `${label} ready`,
        step: 3,
        total: 3,
        state: 'complete',
      });
    } catch (error) {
      console.error('[InboxSwitcher] Failed to switch inbox:', error);
      setOperation(null);
      alert('Unable to open that inbox. Please try again.');
    }
  };

  const handleCreateInbox = async () => {
    if (operation) {
      return;
    }
    setOperation('Creating inbox…');
    try {
      const generated = generateLocalAppIdentity();
      await createIdentity(generated.identity.address, generated.privateKey, undefined, undefined, {
        registrationPolicy: 'new-inbox',
        enableHistorySync: false,
        label: generated.identity.displayName,
        mnemonic: generated.mnemonic,
        identityKind: generated.identity.identityKind,
        provisioningMode: 'new-inbox',
        xmtpDbPathMode: 'inbox-default',
      });

      const created = useAuthStore.getState().identity;
      if (!created?.inboxId) {
        throw new Error('XMTP did not return the new inbox ID.');
      }
      requestProfileEditor({
        address: created.address,
        inboxId: created.inboxId,
        reason: 'new-inbox',
      });
      await reloadIntoInbox(created.inboxId);
    } catch (error) {
      console.error('[InboxSwitcher] Failed to create inbox:', error);
      setOperation(null);
      alert(formatCreateInboxError(error));
    }
  };

  const handleImportKeyfile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || operation) {
      return;
    }

    setOperation('Importing keyfile…');
    try {
      const candidate = deriveIdentityFromKeyfile(parseKeyfile(await file.text()));
      const probe = await probeIdentity(candidate.address, candidate.privateKey);
      assertKeyfileInboxMatch(candidate.expectedInboxId, probe.inboxId);

      if (probe.inboxId && (await isInboxLoadedLocally(probe.inboxId))) {
        setOperation(null);
        alert(INBOX_ALREADY_LOADED_MESSAGE);
        return;
      }

      const storage = await getStorage();
      const resumableInstallationId = getResumableKeyfileInstallationId(
        await storage.listIdentities(),
        {
          address: candidate.address,
          privateKey: candidate.privateKey,
          inboxId: candidate.expectedInboxId ?? probe.inboxId ?? undefined,
          inboxState: probe.inboxState,
        }
      );
      if (probe.installationCount >= 10 && !resumableInstallationId) {
        throw new Error(
          'Installation limit reached (10/10). Revoke an old installation before importing this key on this browser.'
        );
      }

      await createIdentity(candidate.address, candidate.privateKey, undefined, undefined, {
        registrationPolicy: probe.isRegistered ? 'existing-inbox' : 'new-inbox',
        enableHistorySync: true,
        mnemonic: candidate.mnemonic,
        identityKind: 'imported',
        provisioningMode: 'keyfile-restore',
        xmtpDbPathMode: 'inbox-default',
        expectedInboxId: candidate.expectedInboxId ?? probe.inboxId ?? undefined,
        expectedInstallationId: resumableInstallationId,
        requestHistorySync: probe.isRegistered,
      });

      const imported = useAuthStore.getState().identity;
      if (!imported?.inboxId) {
        throw new Error('XMTP did not return the imported key’s inbox ID.');
      }
      await reloadIntoInbox(imported.inboxId);
    } catch (error) {
      console.error('[InboxSwitcher] Failed to import keyfile:', error);
      setOperation(null);
      alert(error instanceof Error ? error.message : 'Unable to import that keyfile.');
    }
  };

  return (
    <Menu as="div" className="relative z-[12000] inline-block text-left">
      <Menu.Button
        aria-label={`Inbox switcher, current inbox ${currentLabel}`}
        className="relative flex max-w-[15rem] items-center gap-2 rounded-full border border-primary-700/70 bg-primary-900/80 px-2 py-1.5 text-left text-sm font-medium text-primary-100 shadow transition hover:border-accent-400 hover:text-white"
      >
        <InboxAvatar entry={currentEntry} activeAvatar={identity?.avatar} />
        <span className="hidden min-w-0 sm:block">
          <span className="block truncate text-xs text-primary-400">Inbox</span>
          <span className="block truncate text-sm font-semibold text-primary-100">
            {operation || currentLabel}
          </span>
        </span>
        <svg className="h-4 w-4 shrink-0 text-primary-300" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 011.08 1.04l-4.25 4.25a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z" clipRule="evenodd" />
        </svg>
        {hasPendingActivity && (
          <span
            className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-primary-950 bg-accent-400"
            aria-label="Inbox activity pending"
          />
        )}
      </Menu.Button>

      <Transition
        as={Fragment}
        enter="transition ease-out duration-100"
        enterFrom="scale-95 opacity-0"
        enterTo="scale-100 opacity-100"
        leave="transition ease-in duration-75"
        leaveFrom="scale-100 opacity-100"
        leaveTo="scale-95 opacity-0"
      >
        <Portal>
          <Menu.Items className="fixed left-1/2 top-16 z-[20000] max-h-[75vh] w-80 max-w-[92vw] -translate-x-1/2 overflow-auto rounded-lg border border-primary-800/80 bg-primary-950/95 p-3 text-primary-100 shadow-2xl backdrop-blur focus:outline-none">
            <div className="px-2 pb-2 text-xs font-semibold uppercase text-primary-400">
              Inboxes on this browser
            </div>
            <div className="space-y-1">
              {sortedEntries.map((entry) => {
                const isCurrent = entry.inboxId === currentInboxId;
                const hasActivity = pendingInboxIds.has(normalizeInboxId(entry.inboxId) ?? entry.inboxId);
                return (
                  <Menu.Item key={entry.inboxId}>
                    {({ active }) => (
                      <button
                        type="button"
                        onClick={() => void handleSwitch(entry)}
                        disabled={isCurrent || Boolean(operation)}
                        className={`flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition ${
                          isCurrent
                            ? 'bg-accent-600/20 text-accent-100'
                            : active
                              ? 'bg-primary-800/80 text-white'
                              : 'text-primary-200'
                        } disabled:cursor-default`}
                      >
                        <InboxAvatar entry={entry} />
                        <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                          {getInboxDisplayLabel(entry)}
                        </span>
                        {hasActivity && !isCurrent && (
                          <span className="h-2.5 w-2.5 rounded-full bg-accent-400" aria-label="New activity" />
                        )}
                        {isCurrent && <span className="text-xs text-accent-300">Current</span>}
                      </button>
                    )}
                  </Menu.Item>
                );
              })}
            </div>

            <div className="my-3 h-px bg-primary-800/70" />
            <div className="px-2 pb-1 text-xs font-semibold uppercase text-primary-400">Add inbox</div>
            <Menu.Item>
              {({ active }) => (
                <button
                  type="button"
                  onClick={() => void handleCreateInbox()}
                  disabled={Boolean(operation)}
                  className={`w-full rounded-md px-3 py-2 text-left text-sm ${active ? 'bg-primary-800/80 text-white' : 'text-primary-200'}`}
                >
                  Create new inbox
                </button>
              )}
            </Menu.Item>
            <Menu.Item>
              {({ active }) => (
                <button
                  type="button"
                  onClick={() => keyfileInputRef.current?.click()}
                  disabled={Boolean(operation)}
                  className={`w-full rounded-md px-3 py-2 text-left text-sm ${active ? 'bg-primary-800/80 text-white' : 'text-primary-200'}`}
                >
                  Import keyfile
                </button>
              )}
            </Menu.Item>
            <Menu.Item>
              {({ active }) => (
                <button
                  type="button"
                  onClick={() => navigate('/settings?connectInbox=1')}
                  disabled={Boolean(operation)}
                  className={`w-full rounded-md px-3 py-2 text-left text-sm ${active ? 'bg-primary-800/80 text-white' : 'text-primary-200'}`}
                >
                  Add this device to existing inbox
                </button>
              )}
            </Menu.Item>

            <div className="my-3 h-px bg-primary-800/70" />
            <Menu.Item>
              {({ active }) => (
                <button
                  type="button"
                  onClick={() => navigate('/settings')}
                  className={`w-full rounded-md px-3 py-2 text-left text-sm ${active ? 'bg-primary-800/80 text-white' : 'text-primary-300'}`}
                >
                  Inbox settings
                </button>
              )}
            </Menu.Item>
          </Menu.Items>
        </Portal>
      </Transition>
      <input
        ref={keyfileInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={handleImportKeyfile}
      />
    </Menu>
  );
}
