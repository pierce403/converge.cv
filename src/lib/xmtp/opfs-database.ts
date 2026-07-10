import { Opfs } from '@xmtp/browser-sdk';

interface OpfsDatabaseManager {
  fileExists(path: string): Promise<boolean>;
  deleteFile(path: string): Promise<boolean>;
  close(): void;
}

type OpfsDatabaseManagerFactory = () => Promise<OpfsDatabaseManager>;

export function getInboxDefaultDatabasePath(inboxId: string): string {
  const normalized = inboxId.trim().replace(/^(?:0x)+/i, '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Error('XMTP returned an invalid inbox ID for local database recovery.');
  }
  return `xmtp-production-${normalized}.db3`;
}

/** Delete only the SDK-default database for one inbox after its client is closed. */
export async function deleteInboxDefaultDatabase(
  inboxId: string,
  createManager: OpfsDatabaseManagerFactory = async () => await Opfs.create()
): Promise<boolean> {
  const path = getInboxDefaultDatabasePath(inboxId);
  const opfs = await createManager();
  try {
    if (!(await opfs.fileExists(path))) {
      return false;
    }
    if (!(await opfs.deleteFile(path))) {
      throw new Error(`XMTP could not delete the stale local database ${path}.`);
    }
    return true;
  } finally {
    opfs.close();
  }
}
