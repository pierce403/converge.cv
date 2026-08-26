import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MESSAGE_DISAPPEARING_MS,
  DEFAULT_MESSAGE_RETENTION_MS,
  getDefaultMessageDisappearingSettings,
  getMessageRetentionCutoff,
  getRetainedHistoryStartNs,
  shouldRetainMessage,
} from './message-retention-policy';

describe('message retention policy', () => {
  const now = 2_000_000_000_000;

  it('expires messages at the exact four-week boundary', () => {
    const cutoff = getMessageRetentionCutoff(now);

    expect(shouldRetainMessage({ sentAt: cutoff }, now)).toBe(false);
    expect(shouldRetainMessage({ sentAt: cutoff + 1 }, now)).toBe(true);
    expect(shouldRetainMessage({ sentAt: now, expiresAt: now }, now)).toBe(false);
  });

  it('uses a 14-day default for new XMTP conversations without shortening local history', () => {
    expect(getDefaultMessageDisappearingSettings(now)).toEqual({
      fromNs: BigInt(now) * 1_000_000n,
      inNs: BigInt(DEFAULT_MESSAGE_DISAPPEARING_MS) * 1_000_000n,
    });
    expect(DEFAULT_MESSAGE_RETENTION_MS).toBeGreaterThan(DEFAULT_MESSAGE_DISAPPEARING_MS);
  });

  it('never lets a requested history window cross the local cutoff', () => {
    const cutoffNs = BigInt(getMessageRetentionCutoff(now)) * 1_000_000n;

    expect(getRetainedHistoryStartNs(cutoffNs - 1n, now)).toBe(cutoffNs);
    expect(getRetainedHistoryStartNs(cutoffNs + 1n, now)).toBe(cutoffNs + 1n);
    expect(getRetainedHistoryStartNs(undefined, now)).toBe(cutoffNs);
  });
});
