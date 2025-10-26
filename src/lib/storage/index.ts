/**
 * Storage module exports
 */

export * from './interface';
export * from './dexie-driver';

import { DexieDriver } from './dexie-driver';
import type { StorageDriver } from './interface';

// Singleton storage instance
let storageInstance: StorageDriver | null = null;

export async function getStorage(): Promise<StorageDriver> {
  if (!storageInstance) {
    // Default to Dexie, but can be swapped for SQLite later
    storageInstance = new DexieDriver();
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

