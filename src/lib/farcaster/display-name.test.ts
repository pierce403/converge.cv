import { describe, expect, it } from 'vitest';
import { pickFarcasterDisplayName } from './display-name';

describe('pickFarcasterDisplayName', () => {
  it('prefers display_name over username/fname', () => {
    expect(
      pickFarcasterDisplayName({
        display_name: 'Alice',
        username: 'alice',
        fname: 'alice',
      })
    ).toBe('Alice');
  });

  it('falls back to displayName when display_name is missing', () => {
    expect(
      pickFarcasterDisplayName({
        displayName: 'Alice Camel',
        username: 'alice',
      })
    ).toBe('Alice Camel');
  });

  it('falls back to username/fname when no display name exists', () => {
    expect(
      pickFarcasterDisplayName({
        username: 'alice',
      })
    ).toBe('alice');

    expect(
      pickFarcasterDisplayName({
        fname: 'alice',
      })
    ).toBe('alice');
  });

  it('returns null when all candidates are empty', () => {
    expect(
      pickFarcasterDisplayName({
        display_name: ' ',
        displayName: '',
        username: '   ',
        fname: '',
      })
    ).toBeNull();
    expect(pickFarcasterDisplayName(undefined)).toBeNull();
  });
});
