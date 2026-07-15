import { normalizeInboxId } from '@/lib/utils/inbox';

export const PUSH_STATE_DB_NAME = 'ConvergePushState';
export const PUSH_STATE_DB_VERSION = 1;
export const PUSH_META_STORE = 'meta';
export const PUSH_REGISTRATIONS_STORE = 'registrations';
export const PUSH_PROFILES_STORE = 'profiles';
export const PUSH_ACTIVITY_STORE = 'activity';

const PREFERENCES_KEY = 'preferences';

export type PushPreferenceState = {
  enabled: boolean;
  endpoint?: string;
  updatedAt: number;
};

export type PushStateIdentity = {
  inboxId: string;
  installationId: string;
  address?: string;
};

export type PushStateTopic = {
  topic: string;
  hmacKeys: Array<{ epoch: string; key: string }>;
};

/**
 * Bearer capability returned by vapid.party for one logical registration.
 * Never render or log these values; possession authorizes refresh, endpoint
 * replacement, deletion, status checks, and a bounded diagnostic push for only
 * this logical registration.
 */
export type PushRelayDiagnosticsCapability = {
  receipt: string;
  statusPath: string;
  testPath?: string;
};

export type CachedInboxPushRegistration = {
  key: string;
  identity: PushStateIdentity;
  inboxHandle: string;
  displayName?: string;
  topics: PushStateTopic[];
  endpoint?: string;
  relayRegistrationId?: string;
  relayDiagnostics?: PushRelayDiagnosticsCapability;
  registeredAt?: string;
  updatedAt: number;
  /** The relay route is active, but the local finalization step needs an idempotent retry. */
  pendingRegistration?: boolean;
  pendingDeletion?: boolean;
};

export type PushInboxProfile = {
  inboxHandle: string;
  inboxId: string;
  displayName?: string;
  updatedAt: number;
};

export type PushActivityHint = {
  inboxHandle: string;
  receivedAt: number;
  count: number;
};

export type PushDiagnosticReceipt = {
  testId: string;
  receivedAt: number;
  source: 'local' | 'relay';
};

export interface PushStateStore {
  getPreferences(): Promise<PushPreferenceState>;
  setPreferences(preferences: PushPreferenceState): Promise<void>;
  listRegistrations(): Promise<CachedInboxPushRegistration[]>;
  putRegistration(registration: CachedInboxPushRegistration): Promise<void>;
  deleteRegistration(key: string): Promise<void>;
  getProfileByInboxId(inboxId: string): Promise<PushInboxProfile | undefined>;
  getProfileByHandle(inboxHandle: string): Promise<PushInboxProfile | undefined>;
  putProfile(profile: PushInboxProfile): Promise<void>;
  deleteProfile(inboxHandle: string): Promise<void>;
  listActivity(): Promise<PushActivityHint[]>;
  putActivity(activity: PushActivityHint): Promise<void>;
  deleteActivity(inboxHandle: string): Promise<void>;
  clearActivity(): Promise<void>;
  getLastDiagnosticReceipt(): Promise<PushDiagnosticReceipt | undefined>;
  putLastDiagnosticReceipt(receipt: PushDiagnosticReceipt): Promise<void>;
}

type StoredMetaRecord = {
  key: string;
  value: PushPreferenceState;
};

const DEFAULT_PREFERENCES: PushPreferenceState = {
  enabled: false,
  updatedAt: 0,
};
const LAST_DIAGNOSTIC_KEY = 'lastDiagnosticReceipt';

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'));
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
  });
}

export class BrowserPushStateStore implements PushStateStore {
  private databasePromise: Promise<IDBDatabase> | null = null;

  private openDatabase(): Promise<IDBDatabase> {
    if (this.databasePromise) {
      return this.databasePromise;
    }

    this.databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(PUSH_STATE_DB_NAME, PUSH_STATE_DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(PUSH_META_STORE)) {
          database.createObjectStore(PUSH_META_STORE, { keyPath: 'key' });
        }
        if (!database.objectStoreNames.contains(PUSH_REGISTRATIONS_STORE)) {
          database.createObjectStore(PUSH_REGISTRATIONS_STORE, { keyPath: 'key' });
        }
        if (!database.objectStoreNames.contains(PUSH_PROFILES_STORE)) {
          database.createObjectStore(PUSH_PROFILES_STORE, { keyPath: 'inboxHandle' });
        }
        if (!database.objectStoreNames.contains(PUSH_ACTIVITY_STORE)) {
          database.createObjectStore(PUSH_ACTIVITY_STORE, { keyPath: 'inboxHandle' });
        }
      };
      request.onsuccess = () => {
        const database = request.result;
        database.onversionchange = () => {
          database.close();
          this.databasePromise = null;
        };
        resolve(database);
      };
      request.onerror = () => {
        this.databasePromise = null;
        reject(request.error ?? new Error('Unable to open push state database'));
      };
      request.onblocked = () => {
        console.warn('[Push] Push state database upgrade is blocked by another tab');
      };
    });

    return this.databasePromise;
  }

  private async readAll<T>(storeName: string): Promise<T[]> {
    const database = await this.openDatabase();
    const transaction = database.transaction(storeName, 'readonly');
    return requestResult(transaction.objectStore(storeName).getAll()) as Promise<T[]>;
  }

  private async read<T>(storeName: string, key: IDBValidKey): Promise<T | undefined> {
    const database = await this.openDatabase();
    const transaction = database.transaction(storeName, 'readonly');
    return requestResult(transaction.objectStore(storeName).get(key)) as Promise<T | undefined>;
  }

  private async write(storeName: string, value: unknown): Promise<void> {
    const database = await this.openDatabase();
    const transaction = database.transaction(storeName, 'readwrite');
    transaction.objectStore(storeName).put(value);
    await transactionComplete(transaction);
  }

  private async remove(storeName: string, key: IDBValidKey): Promise<void> {
    const database = await this.openDatabase();
    const transaction = database.transaction(storeName, 'readwrite');
    transaction.objectStore(storeName).delete(key);
    await transactionComplete(transaction);
  }

  async getPreferences(): Promise<PushPreferenceState> {
    const record = await this.read<StoredMetaRecord>(PUSH_META_STORE, PREFERENCES_KEY);
    const value = record?.value;
    if (!value || typeof value.enabled !== 'boolean') {
      return { ...DEFAULT_PREFERENCES };
    }
    return {
      enabled: value.enabled,
      endpoint: typeof value.endpoint === 'string' ? value.endpoint : undefined,
      updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : 0,
    };
  }

  async setPreferences(preferences: PushPreferenceState): Promise<void> {
    await this.write(PUSH_META_STORE, { key: PREFERENCES_KEY, value: preferences });
  }

  async listRegistrations(): Promise<CachedInboxPushRegistration[]> {
    return this.readAll<CachedInboxPushRegistration>(PUSH_REGISTRATIONS_STORE);
  }

  async putRegistration(registration: CachedInboxPushRegistration): Promise<void> {
    await this.write(PUSH_REGISTRATIONS_STORE, registration);
  }

  async deleteRegistration(key: string): Promise<void> {
    await this.remove(PUSH_REGISTRATIONS_STORE, key);
  }

  async getProfileByInboxId(inboxId: string): Promise<PushInboxProfile | undefined> {
    const normalized = normalizeInboxId(inboxId);
    if (!normalized) return undefined;
    const profiles = await this.readAll<PushInboxProfile>(PUSH_PROFILES_STORE);
    return profiles.find((profile) => normalizeInboxId(profile.inboxId) === normalized);
  }

  async getProfileByHandle(inboxHandle: string): Promise<PushInboxProfile | undefined> {
    return this.read<PushInboxProfile>(PUSH_PROFILES_STORE, inboxHandle);
  }

  async putProfile(profile: PushInboxProfile): Promise<void> {
    await this.write(PUSH_PROFILES_STORE, profile);
  }

  async deleteProfile(inboxHandle: string): Promise<void> {
    await this.remove(PUSH_PROFILES_STORE, inboxHandle);
  }

  async listActivity(): Promise<PushActivityHint[]> {
    return this.readAll<PushActivityHint>(PUSH_ACTIVITY_STORE);
  }

  async putActivity(activity: PushActivityHint): Promise<void> {
    await this.write(PUSH_ACTIVITY_STORE, activity);
  }

  async deleteActivity(inboxHandle: string): Promise<void> {
    await this.remove(PUSH_ACTIVITY_STORE, inboxHandle);
  }

  async clearActivity(): Promise<void> {
    const database = await this.openDatabase();
    const transaction = database.transaction(PUSH_ACTIVITY_STORE, 'readwrite');
    transaction.objectStore(PUSH_ACTIVITY_STORE).clear();
    await transactionComplete(transaction);
  }

  async getLastDiagnosticReceipt(): Promise<PushDiagnosticReceipt | undefined> {
    const record = await this.read<{ key: string; value: PushDiagnosticReceipt }>(
      PUSH_META_STORE,
      LAST_DIAGNOSTIC_KEY,
    );
    const value = record?.value;
    if (
      !value ||
      typeof value.testId !== 'string' ||
      !Number.isFinite(value.receivedAt) ||
      (value.source !== 'local' && value.source !== 'relay')
    ) {
      return undefined;
    }
    return { testId: value.testId, receivedAt: value.receivedAt, source: value.source };
  }

  async putLastDiagnosticReceipt(receipt: PushDiagnosticReceipt): Promise<void> {
    await this.write(PUSH_META_STORE, { key: LAST_DIAGNOSTIC_KEY, value: receipt });
  }
}

export class MemoryPushStateStore implements PushStateStore {
  private preferences: PushPreferenceState = { ...DEFAULT_PREFERENCES };
  private registrations = new Map<string, CachedInboxPushRegistration>();
  private profiles = new Map<string, PushInboxProfile>();
  private activity = new Map<string, PushActivityHint>();
  private lastDiagnosticReceipt: PushDiagnosticReceipt | undefined;

  async getPreferences(): Promise<PushPreferenceState> {
    return { ...this.preferences };
  }

  async setPreferences(preferences: PushPreferenceState): Promise<void> {
    this.preferences = { ...preferences };
  }

  async listRegistrations(): Promise<CachedInboxPushRegistration[]> {
    return Array.from(this.registrations.values()).map((entry) => structuredClone(entry));
  }

  async putRegistration(registration: CachedInboxPushRegistration): Promise<void> {
    this.registrations.set(registration.key, structuredClone(registration));
  }

  async deleteRegistration(key: string): Promise<void> {
    this.registrations.delete(key);
  }

  async getProfileByInboxId(inboxId: string): Promise<PushInboxProfile | undefined> {
    const normalized = normalizeInboxId(inboxId);
    const profile = Array.from(this.profiles.values()).find(
      (entry) => normalizeInboxId(entry.inboxId) === normalized,
    );
    return profile ? { ...profile } : undefined;
  }

  async getProfileByHandle(inboxHandle: string): Promise<PushInboxProfile | undefined> {
    const profile = this.profiles.get(inboxHandle);
    return profile ? { ...profile } : undefined;
  }

  async putProfile(profile: PushInboxProfile): Promise<void> {
    this.profiles.set(profile.inboxHandle, { ...profile });
  }

  async deleteProfile(inboxHandle: string): Promise<void> {
    this.profiles.delete(inboxHandle);
  }

  async listActivity(): Promise<PushActivityHint[]> {
    return Array.from(this.activity.values()).map((entry) => ({ ...entry }));
  }

  async putActivity(activity: PushActivityHint): Promise<void> {
    this.activity.set(activity.inboxHandle, { ...activity });
  }

  async deleteActivity(inboxHandle: string): Promise<void> {
    this.activity.delete(inboxHandle);
  }

  async clearActivity(): Promise<void> {
    this.activity.clear();
  }

  async getLastDiagnosticReceipt(): Promise<PushDiagnosticReceipt | undefined> {
    return this.lastDiagnosticReceipt ? { ...this.lastDiagnosticReceipt } : undefined;
  }

  async putLastDiagnosticReceipt(receipt: PushDiagnosticReceipt): Promise<void> {
    this.lastDiagnosticReceipt = { ...receipt };
  }
}

let defaultStore: PushStateStore | null = null;

export function getPushStateStore(): PushStateStore {
  if (!defaultStore) {
    defaultStore = typeof indexedDB === 'undefined' ? new MemoryPushStateStore() : new BrowserPushStateStore();
  }
  return defaultStore;
}

export function pushRegistrationKey(identity: PushStateIdentity): string {
  const inboxId = normalizeInboxId(identity.inboxId);
  return `${inboxId ?? identity.inboxId.trim()}::${identity.installationId.trim().toLowerCase()}`;
}
