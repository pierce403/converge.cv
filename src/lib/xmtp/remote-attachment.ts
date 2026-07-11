import {
  decryptAttachment,
  type Attachment,
  type EncryptedAttachment,
  type RemoteAttachment,
} from '@xmtp/browser-sdk';

const DEFAULT_RETRY_DELAYS_MS = [250, 750, 1_500] as const;
const DEFAULT_ATTEMPT_TIMEOUT_MS = 10_000;

type FetchAttachment = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

type DecryptRemoteAttachment = (
  payload: Uint8Array,
  remoteAttachment: RemoteAttachment,
) => Promise<Attachment>;

interface VerifyRemoteAttachmentOptions {
  fetchFn?: FetchAttachment;
  decryptFn?: DecryptRemoteAttachment;
  sleepFn?: (delayMs: number) => Promise<void>;
  retryDelaysMs?: readonly number[];
  attemptTimeoutMs?: number;
}

function requireHttpsUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('Attachment storage returned an invalid URL');
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('Attachment storage must return an HTTPS URL');
  }
  return parsed.toString();
}

export function createRemoteAttachment(
  encrypted: EncryptedAttachment,
  uploadedUrl: string,
  fallbackFilename?: string,
): RemoteAttachment {
  return {
    url: requireHttpsUrl(uploadedUrl),
    contentDigest: encrypted.contentDigest,
    salt: encrypted.salt,
    nonce: encrypted.nonce,
    secret: encrypted.secret,
    scheme: 'https',
    contentLength: encrypted.contentLength,
    filename: encrypted.filename ?? fallbackFilename,
  };
}

async function fetchWithTimeout(
  fetchFn: FetchAttachment,
  url: string,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchFn(url, {
      cache: 'no-store',
      method: 'GET',
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function verifyUploadedRemoteAttachment(
  remoteAttachment: RemoteAttachment,
  options: VerifyRemoteAttachmentOptions = {},
): Promise<void> {
  const url = requireHttpsUrl(remoteAttachment.url);
  const fetchFn = options.fetchFn ?? fetch;
  const decryptFn = options.decryptFn ?? decryptAttachment;
  const sleepFn = options.sleepFn ?? ((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)));
  const retryDelaysMs = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const attemptTimeoutMs = options.attemptTimeoutMs ?? DEFAULT_ATTEMPT_TIMEOUT_MS;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
    try {
      const response = await fetchWithTimeout(fetchFn, url, attemptTimeoutMs);
      if (!response.ok) {
        throw new Error(`storage returned HTTP ${response.status}`);
      }

      const payload = new Uint8Array(await response.arrayBuffer());
      if (payload.byteLength !== remoteAttachment.contentLength) {
        throw new Error(
          `storage returned ${payload.byteLength} bytes; expected ${remoteAttachment.contentLength}`,
        );
      }

      await decryptFn(payload, remoteAttachment);
      return;
    } catch (error) {
      lastError = error;
      const delayMs = retryDelaysMs[attempt];
      if (delayMs === undefined) break;
      await sleepFn(delayMs);
    }
  }

  throw new Error(
    `Uploaded attachment could not be verified after ${retryDelaysMs.length + 1} attempts: ${errorMessage(lastError)}`,
  );
}
