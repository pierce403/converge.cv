/**
 * Complete browser data reset
 */

import Dexie from 'dexie';
import { closeStorage } from '@/lib/storage';
import {
  useAuthStore,
  useContactStore,
  useConversationStore,
  useDebugStore,
  useInboxRegistryStore,
  useMessageStore,
  useXmtpStore,
} from '@/lib/stores';
import { resetXmtpClient } from '@/lib/xmtp/client';
import { disablePush } from '@/lib/push';
import { clearLastRoute } from '@/lib/utils/route-persistence';
import { clearIntentionalEmptyInboxState } from '@/features/auth/onboarding-state';

async function withTimeout<T>(
  action: () => Promise<T> | T,
  ms: number,
  fallbackValue: T,
  description: string
): Promise<T> {
  return new Promise<T>((resolve) => {
    let timer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      timer = null;
      console.warn(
        `[ClearData] Operation '${description}' timed out after ${ms}ms - continuing.`
      );
      resolve(fallbackValue);
    }, ms);

    Promise.resolve()
      .then(action)
      .then((res) => {
        if (timer) {
          clearTimeout(timer);
          resolve(res);
        }
      })
      .catch((err) => {
        if (timer) {
          clearTimeout(timer);
          console.warn(`[ClearData] Operation '${description}' failed:`, err);
          resolve(fallbackValue);
        }
      });
  });
}

export async function clearAllCookies(): Promise<void> {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return;
  }

  try {
    const raw = document.cookie || '';
    const names = raw
      .split(';')
      .map((c) => c.trim().split('=')[0])
      .filter((n): n is string => Boolean(n));

    const hostname = window.location.hostname || '';
    const parts = hostname.split('.').filter(Boolean);
    const domainVariants = new Set<string>();
    domainVariants.add(hostname);
    domainVariants.add('.' + hostname);
    for (let i = 0; i < parts.length; i++) {
      const dom = parts.slice(i).join('.');
      if (dom) {
        domainVariants.add(dom);
        domainVariants.add('.' + dom);
      }
    }

    const path = window.location.pathname || '/';
    const segments = path.split('/').filter(Boolean);
    const pathVariants = new Set<string>(['/']);
    for (let i = 0; i < segments.length; i++) {
      pathVariants.add('/' + segments.slice(0, i + 1).join('/'));
    }

    const expires = 'Thu, 01 Jan 1970 00:00:00 GMT';
    const setExpired = (name: string, opts: string) => {
      try {
        document.cookie = `${name}=; Expires=${expires}; Max-Age=0; ${opts}`;
      } catch {
        /* ignore */
      }
      try {
        document.cookie = `${name}=; Expires=${expires}; ${opts}`;
      } catch {
        /* ignore */
      }
    };

    for (const name of names) {
      for (const p of pathVariants) {
        setExpired(name, `Path=${p}; SameSite=Lax`);
        setExpired(name, `Path=${p}; SameSite=None; Secure`);
      }
      for (const d of domainVariants) {
        for (const p of pathVariants) {
          setExpired(name, `Domain=${d}; Path=${p}; SameSite=Lax`);
          setExpired(name, `Domain=${d}; Path=${p}; SameSite=None; Secure`);
        }
      }
    }
  } catch (err) {
    console.warn('[ClearData] Failed to clear some cookies (non-fatal):', err);
  }
}

export async function clearAllBrowserData(options?: {
  skipNavigation?: boolean;
}): Promise<void> {
  console.log('[ClearData] Starting comprehensive browser data wipe...');

  // Step 1: Best-effort push cleanup with 2s timeout
  console.log('[ClearData] Step 1/8: Push cleanup...');
  await withTimeout(
    () => disablePush(),
    2000,
    false,
    'disablePush'
  );

  // Step 2: Disconnect XMTP client with 2s timeout to release OPFS/VFS handles
  console.log('[ClearData] Step 2/8: Resetting XMTP client...');
  await withTimeout(
    () => resetXmtpClient(),
    2000,
    undefined,
    'resetXmtpClient'
  );

  // Step 3: Close active Dexie connection with 1s timeout
  console.log('[ClearData] Step 3/8: Closing storage connections...');
  await withTimeout(
    () => closeStorage(),
    1000,
    undefined,
    'closeStorage'
  );

  // Step 4: Collect database names and delete all databases
  console.log('[ClearData] Step 4/8: Deleting IndexedDB databases...');
  const dbNamesToDelete = new Set<string>([
    'ConvergeDB',
    'ConvergeDB:default',
    'ConvergePushState',
    'ConvergeEphemeralState',
  ]);

  try {
    const registry = useInboxRegistryStore.getState();
    registry.hydrate();
    for (const entry of registry.entries) {
      if (entry.inboxId) {
        dbNamesToDelete.add(`ConvergeDB:${entry.inboxId.toLowerCase()}`);
        dbNamesToDelete.add(`ConvergeDB:${entry.inboxId}`);
      }
    }
  } catch {
    // ignore
  }

  try {
    if (typeof indexedDB !== 'undefined') {
      const idbWithDatabases = indexedDB as unknown as {
        databases?: () => Promise<Array<{ name?: string }>>;
      };
      if (typeof idbWithDatabases?.databases === 'function') {
        const dbs = await withTimeout(
          () => idbWithDatabases.databases!(),
          1000,
          [],
          'enumerateIDB'
        );
        if (Array.isArray(dbs)) {
          for (const db of dbs) {
            if (db.name) {
              dbNamesToDelete.add(db.name);
            }
          }
        }
      }
    }
  } catch (error) {
    console.warn('[ClearData] Failed to enumerate indexedDB databases:', error);
  }

  for (const name of dbNamesToDelete) {
    console.log('[ClearData] Deleting database:', name);
    // Try Dexie.delete with 1s timeout
    await withTimeout(
      () => Dexie.delete(name),
      1000,
      undefined,
      `deleteDexie:${name}`
    );

    if (typeof indexedDB !== 'undefined') {
      await withTimeout(
        () =>
          new Promise<void>((resolve) => {
            try {
              const req = indexedDB.deleteDatabase(name);
              req.onsuccess = () => resolve();
              req.onerror = () => resolve();
              req.onblocked = () => {
                console.warn(`[ClearData] deleteDatabase blocked for ${name}`);
                setTimeout(() => resolve(), 300);
              };
            } catch {
              resolve();
            }
          }),
        1000,
        undefined,
        `deleteRawIDB:${name}`
      );
    }
  }

  // Step 5: Delete all OPFS files (xmtp-*.db3 and SQLite files)
  console.log('[ClearData] Step 5/8: Cleaning OPFS files...');
  try {
    const storageManager =
      typeof navigator !== 'undefined'
        ? (navigator.storage as unknown as {
            getDirectory?: () => Promise<FileSystemDirectoryHandle>;
          })
        : undefined;
    if (storageManager?.getDirectory) {
      await withTimeout(
        async () => {
          const opfsRoot = await storageManager.getDirectory!();
          // @ts-expect-error - OPFS API types
          if (typeof opfsRoot.entries === 'function') {
            // @ts-expect-error - OPFS API types
            for await (const [name] of opfsRoot.entries()) {
              if (
                name.startsWith('xmtp-') ||
                name.endsWith('.db3') ||
                name.endsWith('.sqlite') ||
                name.includes('xmtp')
              ) {
                try {
                  await opfsRoot.removeEntry(name, { recursive: true });
                  console.log('[ClearData] Cleared OPFS entry:', name);
                } catch (fileErr) {
                  console.warn(`[ClearData] Failed to remove OPFS entry ${name}:`, fileErr);
                }
              }
            }
          }
        },
        1500,
        undefined,
        'clearOPFS'
      );
    }
  } catch (error) {
    console.warn('[ClearData] Failed to clear OPFS directory:', error);
  }

  // Step 6: Reset all in-memory Zustand stores
  console.log('[ClearData] Step 6/8: Resetting stores and clearing web storage...');
  try {
    useInboxRegistryStore.getState().reset();
    useAuthStore.getState().logout();
    useConversationStore.setState({
      conversations: [],
      activeConversationId: null,
      isLoading: false,
    });
    useMessageStore.setState({
      messagesByConversation: {},
      loadingConversations: {},
      loadedConversations: {},
      isSending: false,
    });
    useContactStore.setState({ contacts: [], isLoading: false });
    useXmtpStore.setState({
      connectionStatus: 'disconnected',
      lastConnected: null,
      error: null,
      lastSyncedAt: null,
      syncStatus: 'idle',
      syncProgress: 0,
    });
    useDebugStore.getState().clearAll();
    clearLastRoute();
    clearIntentionalEmptyInboxState();
  } catch (error) {
    console.warn('[ClearData] Failed to reset in-memory stores:', error);
  }

  // Clear Web Storage immediately after store resets
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.clear();
      window.sessionStorage.clear();
      console.log('[ClearData] Cleared localStorage and sessionStorage');
    }
  } catch (error) {
    console.warn('[ClearData] Failed to clear web storage:', error);
  }

  // Step 7: Clear Cookies & Service Worker Caches
  console.log('[ClearData] Step 7/8: Clearing cookies and service workers...');
  try {
    await clearAllCookies();
  } catch (error) {
    console.warn('[ClearData] Failed to clear cookies:', error);
  }

  try {
    if (typeof window !== 'undefined' && 'caches' in window) {
      await withTimeout(
        () => caches.keys().then((names) => Promise.all(names.map((n) => caches.delete(n)))),
        1000,
        [],
        'clearCaches'
      );
    }
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      await withTimeout(
        () =>
          navigator.serviceWorker.getRegistrations().then((regs) =>
            Promise.all(regs.map((r) => r.unregister()))
          ),
        1000,
        [],
        'unregisterSW'
      );
    }
  } catch (error) {
    console.warn('[ClearData] Failed to clear SW caches/registrations:', error);
  }

  console.log('[ClearData] Step 8/8: ✅ All browser data cleared successfully');

  if (!options?.skipNavigation && typeof window !== 'undefined') {
    // Navigate cleanly to onboarding
    window.location.replace('/onboarding');
  }
}
