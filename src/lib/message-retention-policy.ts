import type { Message } from '@/types';

export const DEFAULT_MESSAGE_RETENTION_DAYS = 28;
export const DEFAULT_MESSAGE_RETENTION_MS =
  DEFAULT_MESSAGE_RETENTION_DAYS * 24 * 60 * 60 * 1_000;

const NS_PER_MS = 1_000_000n;

export function getMessageRetentionCutoff(now = Date.now()): number {
  return now - DEFAULT_MESSAGE_RETENTION_MS;
}

export function getRetainedHistoryStartNs(
  requestedStartNs?: bigint,
  now = Date.now(),
): bigint {
  const cutoffNs = BigInt(getMessageRetentionCutoff(now)) * NS_PER_MS;
  return requestedStartNs && requestedStartNs > cutoffNs ? requestedStartNs : cutoffNs;
}

export function shouldRetainMessage(
  message: Pick<Message, 'sentAt' | 'expiresAt'>,
  now = Date.now(),
): boolean {
  return (
    message.sentAt > getMessageRetentionCutoff(now) &&
    (message.expiresAt === undefined || message.expiresAt > now)
  );
}

export function getDefaultMessageDisappearingSettings(now = Date.now()): {
  fromNs: bigint;
  inNs: bigint;
} {
  return {
    fromNs: BigInt(now) * NS_PER_MS,
    inNs: BigInt(DEFAULT_MESSAGE_RETENTION_MS) * NS_PER_MS,
  };
}
