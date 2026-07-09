import type { Installation } from '@xmtp/browser-sdk';

export interface RevocableInstallation {
  id?: string;
  bytes: Uint8Array;
  clientTimestampNs?: bigint;
}

export interface WrongChainIdDetails {
  initiallyAddedWith: number;
  signingFrom: number;
}

const LEGACY_CHAIN_ZERO_SCW_MESSAGE =
  'This legacy smart-wallet inbox was registered in XMTP with SCW chain ID 0. Browser wallets now sign that wallet on its real chain, so XMTP rejects Converge wallet-based recovery/reassignment signatures. Use an already-connected Convos/XMTP device to revoke devices or pair/export the inbox; Converge cannot repair this inbox from WalletConnect alone.';

type InstallationLike = Partial<Installation> & {
  installationId?: Uint8Array;
  idBytes?: Uint8Array;
};

export function extractInstallationLimitInboxId(message: string | null | undefined): string | null {
  if (!message) return null;
  const match = message.match(/\b(?:InboxID|inbox)\s+([a-f0-9]{64})\b/i);
  return match?.[1]?.toLowerCase() ?? null;
}

export function extractWrongChainIdDetails(message: string | null | undefined): WrongChainIdDetails | null {
  if (!message) return null;
  const match = message.match(/Wrong chain id\.\s*Initially added with\s+(\d+)\s+but now signing from\s+(\d+)/i);
  if (!match?.[1] || !match[2]) return null;
  const initiallyAddedWith = Number(match[1]);
  const signingFrom = Number(match[2]);
  if (!Number.isFinite(initiallyAddedWith) || !Number.isFinite(signingFrom)) {
    return null;
  }
  return { initiallyAddedWith, signingFrom };
}

export function isSignatureValidationFailure(message: string | null | undefined): boolean {
  return Boolean(message && /(?:signature error:\s*)?signature validation failed/i.test(message));
}

export function isLegacyScwChainZeroMismatch(details: WrongChainIdDetails | null): boolean {
  return details?.initiallyAddedWith === 0;
}

export function legacyScwChainZeroRecoveryMessage(): string {
  return LEGACY_CHAIN_ZERO_SCW_MESSAGE;
}

function hexToBytes(hex: string | undefined): Uint8Array | null {
  if (!hex) return null;
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (!/^[a-f0-9]+$/i.test(clean) || clean.length % 2 !== 0) {
    return null;
  }
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    bytes[i / 2] = parseInt(clean.slice(i, i + 2), 16);
  }
  return bytes;
}

function getInstallationBytes(installation: InstallationLike): Uint8Array | null {
  return installation.bytes ?? installation.installationId ?? installation.idBytes ?? hexToBytes(installation.id);
}

export function selectOldestRevocableInstallations(
  installations: InstallationLike[],
  revokeCount = 1
): RevocableInstallation[] {
  const selected: RevocableInstallation[] = [];
  for (const installation of [...installations].sort((a, b) => {
    const aTime = a.clientTimestampNs ?? 0n;
    const bTime = b.clientTimestampNs ?? 0n;
    return aTime < bTime ? -1 : aTime > bTime ? 1 : 0;
  })) {
    const bytes = getInstallationBytes(installation);
    if (!bytes) continue;
    selected.push({
      id: installation.id,
      bytes,
      clientTimestampNs: installation.clientTimestampNs,
    });
    if (selected.length >= Math.max(1, revokeCount)) {
      break;
    }
  }
  return selected;
}

export function shortInboxId(inboxId: string | null | undefined): string {
  if (!inboxId) return 'unknown inbox';
  return `${inboxId.slice(0, 8)}...${inboxId.slice(-6)}`;
}

export function ensureInstallationRecoveryNeeded(installationCount: number): void {
  if (installationCount < 10) {
    throw new Error(
      `Installation recovery stopped because the inbox now has ${installationCount}/10 installations; no revocation is needed.`
    );
  }
}
