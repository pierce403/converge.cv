import { describe, expect, it } from 'vitest';
import { inboxIdsMatch, normalizeInboxId } from './inbox';

describe('inbox utils', () => {
  it('normalizes inbox ids', () => {
    expect(normalizeInboxId(' ABC ')).toBe('abc');
    expect(normalizeInboxId('')).toBeNull();
    expect(normalizeInboxId(null)).toBeNull();
  });

  it('compares normalized inbox ids', () => {
    expect(inboxIdsMatch(' Test ', 'test')).toBe(true);
    expect(inboxIdsMatch('abc', 'def')).toBe(false);
    expect(inboxIdsMatch(undefined, 'def')).toBe(false);
  });
});
