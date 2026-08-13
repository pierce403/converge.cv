import { Opfs } from '@xmtp/browser-sdk';

interface OpfsDatabaseManager {
  fileExists(path: string): Promise<boolean>;
  deleteFile(path: string): Promise<boolean>;
  close(): void;
}

type OpfsDatabaseManagerFactory = () => Promise<OpfsDatabaseManager>;

export const XMTP_OPFS_VFS_NAME = 'opfs-libxmtp';
const OPFS_WORKER_RELEASE_DELAY_MS = 350;

const waitForOpfsWorkerRelease = async () =>
  await new Promise((resolve) => setTimeout(resolve, OPFS_WORKER_RELEASE_DELAY_MS));

function requireLogicalDatabasePath(path: string): string {
  const logicalPath = path.trim();
  if (
    !logicalPath.endsWith('.db3') ||
    logicalPath.startsWith('file:') ||
    logicalPath.includes('?') ||
    logicalPath.includes('#')
  ) {
    throw new Error('XMTP database access requires an exact logical .db3 path.');
  }
  return logicalPath;
}

/**
 * Pin persistent XMTP clients to libxmtp's named OPFS VFS.
 *
 * wasm-bindings 1.8.1 logs an OPFS initialization failure but otherwise lets
 * SQLite fall back to its default in-memory VFS. A client opened that way can
 * register successfully for the lifetime of its worker and then lose the
 * installation private key on refresh. Naming the VFS in the SQLite URI makes
 * Client.create fail closed when OPFS is unavailable instead.
 */
export function getPersistentXmtpDatabaseUri(
  path: string,
  mode: 'rw' | 'rwc' = 'rwc'
): string {
  const logicalPath = requireLogicalDatabasePath(path);
  return `file:${logicalPath}?mode=${mode}&vfs=${XMTP_OPFS_VFS_NAME}`;
}

export async function xmtpDatabaseFileExists(
  path: string,
  createManager: OpfsDatabaseManagerFactory = async () => await Opfs.create()
): Promise<boolean> {
  const logicalPath = requireLogicalDatabasePath(path);
  const opfs = await createManager();
  try {
    return await opfs.fileExists(logicalPath);
  } finally {
    opfs.close();
    // WorkerBridge.close() terminates the OPFS worker without a release
    // acknowledgement. Give its synchronous access handles time to return to
    // the pool before opening the real XMTP client worker.
    await waitForOpfsWorkerRelease();
  }
}

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
    // The replacement client opens this same filename immediately after this
    // helper returns. Do not race its worker against the terminated deletion
    // worker's synchronous access handles.
    await waitForOpfsWorkerRelease();
  }
}
