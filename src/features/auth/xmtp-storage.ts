import { getStorage } from '@/lib/storage';
import type { StorageDriver } from '@/lib/storage';
import type { Identity } from '@/types';

type IdentityStorage = Pick<StorageDriver, 'getIdentityByAddress'>;
type OpenIdentityStorage = () => Promise<IdentityStorage>;

export class XmtpIdentityStorageError extends Error {
  readonly cause: unknown;

  constructor(cause: unknown) {
    super(
      "Converge could not read this browser's saved identity. XMTP connection was stopped to avoid opening a different installation. Reload Converge and make sure browser storage is available."
    );
    this.name = 'XmtpIdentityStorageError';
    this.cause = cause;
  }
}

export async function loadStoredIdentityForXmtp(
  address: string,
  openStorage: OpenIdentityStorage = getStorage
): Promise<Identity | undefined> {
  try {
    const storage = await openStorage();
    return await storage.getIdentityByAddress(address);
  } catch (error) {
    throw new XmtpIdentityStorageError(error);
  }
}
