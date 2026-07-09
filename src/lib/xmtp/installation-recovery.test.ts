import { describe, expect, it } from 'vitest';
import {
  extractInstallationLimitInboxId,
  extractWrongChainIdDetails,
  selectOldestRevocableInstallations,
  shortInboxId,
} from './installation-recovery';

describe('installation recovery helpers', () => {
  it('extracts the full inbox ID from the XMTP installation-limit error', () => {
    const inboxId = '8352dd2ff13766a6d7aa18ed8795c2771f10c1f57d292aeb09a7cdebb88db0f4';
    expect(
      extractInstallationLimitInboxId(
        `Cannot register a new installation because the InboxID ${inboxId} has already registered 10/10 installations.`
      )
    ).toBe(inboxId);
  });

  it('selects the oldest revocable installations by client timestamp', () => {
    const selected = selectOldestRevocableInstallations(
      [
        { id: 'new', bytes: new Uint8Array([3]), clientTimestampNs: 30n },
        { id: 'old', bytes: new Uint8Array([1]), clientTimestampNs: 10n },
        { id: 'middle', bytes: new Uint8Array([2]), clientTimestampNs: 20n },
      ],
      2
    );

    expect(selected.map((installation) => installation.id)).toEqual(['old', 'middle']);
    expect(selected.map((installation) => Array.from(installation.bytes))).toEqual([[1], [2]]);
  });

  it('falls back to hex installation IDs when bytes are not present', () => {
    const selected = selectOldestRevocableInstallations([{ id: '0a0b', clientTimestampNs: 1n }]);

    expect(selected).toHaveLength(1);
    expect(Array.from(selected[0].bytes)).toEqual([10, 11]);
  });

  it('formats compact inbox IDs for status messages', () => {
    expect(shortInboxId('8352dd2ff13766a6d7aa18ed8795c2771f10c1f57d292aeb09a7cdebb88db0f4')).toBe(
      '8352dd2f...8db0f4'
    );
  });

  it('extracts XMTP wrong-chain-id retry details', () => {
    expect(
      extractWrongChainIdDetails(
        'Wrong chain id. Initially added with 0 but now signing from 8453'
      )
    ).toEqual({
      initiallyAddedWith: 0,
      signingFrom: 8453,
    });
  });
});
