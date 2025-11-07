/**
 * Storage module exports
 */

export * from './interface';
export * from './dexie-driver';

import { DexieDriver } from './dexie-driver';
import type { StorageDriver } from './interface';

// Singleton storage instance
let storageInstance: StorageDriver | null = null;
let storageNamespace = 'default';

// Initialize namespace from persisted value (survives reloads)
(() => {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const persisted = window.localStorage.getItem('converge.storageNamespace.v1');
      if (persisted && persisted.trim().length > 0) {
        storageNamespace = persisted;
      }
    }
  } catch {
    // ignore
  }
})();

function sanitizeNamespace(ns: string): string {
  const trimmed = (ns || '').toLowerCase().trim();
  if (!trimmed) return 'default';
  return trimmed.replace(/[^a-z0-9_-]/g, '_').slice(0, 64);
}

export async function setStorageNamespace(ns: string): Promise<void> {
  const next = sanitizeNamespace(ns);
  if (next === storageNamespace) return;
  storageNamespace = next;
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem('converge.storageNamespace.v1', storageNamespace);
    }
  } catch {
    // ignore
  }
  if (storageInstance) {
    await storageInstance.close();
    storageInstance = null;
  }
}

export async function getStorage(): Promise<StorageDriver> {
  if (!storageInstance) {
    // Default to Dexie, but can be swapped for SQLite later
    storageInstance = new DexieDriver(storageNamespace);
    await storageInstance.init();
  }
  return storageInstance;
}

export async function closeStorage(): Promise<void> {
  if (storageInstance) {
    await storageInstance.close();
    storageInstance = null;
  }
}
