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

  // 1. Best-effort push cleanup (do not allow remote push errors to block local wipe)
  try {
    await disablePush();
  } catch (error) {
    console.warn('[ClearData] Push cleanup encountered an error (continuing):', error);
  }

  // 2. Disconnect XMTP client so open OPFS/VFS handles are released
  try {
    await resetXmtpClient();
  } catch (error) {
    console.warn('[ClearData] Failed to reset XMTP client (continuing):', error);
  }

  // 3. Close the active Dexie singleton connection
  try {
    await closeStorage();
  } catch (error) {
    console.warn('[ClearData] Failed to close storage (continuing):', error);
  }

  // 4. Collect all known database names
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
        const dbs = await idbWithDatabases.databases();
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

  // 5. Delete every database
  for (const name of dbNamesToDelete) {
    try {
      console.log('[ClearData] Deleting Dexie DB:', name);
      await Dexie.delete(name);
    } catch (e) {
      console.warn(`[ClearData] Dexie.delete failed for ${name}, trying raw IDB:`, e);
      if (typeof indexedDB !== 'undefined') {
        try {
          await new Promise<void>((resolve) => {
            const req = indexedDB.deleteDatabase(name);
            req.onsuccess = () => resolve();
            req.onerror = () => resolve();
            req.onblocked = () => {
              console.warn(`[ClearData] deleteDatabase blocked for ${name}`);
              setTimeout(() => resolve(), 300);
            };
          });
        } catch (idbErr) {
          console.warn(`[ClearData] indexedDB.deleteDatabase failed for ${name}:`, idbErr);
        }
      }
    }
  }

  // 6. Delete all OPFS files (xmtp-*.db3 and SQLite files)
  try {
    const storageManager = typeof navigator !== 'undefined'
      ? (navigator.storage as unknown as { getDirectory?: () => Promise<FileSystemDirectoryHandle> })
      : undefined;
    if (storageManager?.getDirectory) {
      const opfsRoot = await storageManager.getDirectory();
      // @ts-expect-error - OPFS API types
      for await (const [name] of opfsRoot.entries()) {
        if (name.startsWith('xmtp-') || name.endsWith('.db3') || name.endsWith('.sqlite')) {
          try {
            await opfsRoot.removeEntry(name, { recursive: true });
            console.log('[ClearData] Cleared OPFS entry:', name);
          } catch (fileErr) {
            console.warn(`[ClearData] Failed to remove OPFS entry ${name}:`, fileErr);
          }
        }
      }
    }
  } catch (error) {
    console.warn('[ClearData] Failed to clear OPFS directory:', error);
  }

  // 7. Clear Cookies
  try {
    await clearAllCookies();
  } catch (error) {
    console.warn('[ClearData] Failed to clear cookies:', error);
  }

  // 8. Clear Service Worker Caches & Unregister Workers
  try {
    if (typeof window !== 'undefined' && 'caches' in window) {
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.map((name) => caches.delete(name)));
    }
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((reg) => reg.unregister()));
    }
  } catch (error) {
    console.warn('[ClearData] Failed to clear SW caches/registrations:', error);
  }

  // 9. Reset all in-memory Zustand stores
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

  // 10. Clear Web Storage (localStorage & sessionStorage) after store resets
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.clear();
      window.sessionStorage.clear();
    }
  } catch (error) {
    console.warn('[ClearData] Failed to clear web storage:', error);
  }

  console.log('[ClearData] ✅ All browser data cleared successfully');

  if (!options?.skipNavigation && typeof window !== 'undefined') {
    window.location.replace('/onboarding');
  }
}
