import { describe, expect, it } from 'vitest';
import { canonicalizeHexInput } from './hex';

describe('canonicalizeHexInput', () => {
  it('normalizes missing, uppercase, and repeated hexadecimal prefixes', () => {
    expect(canonicalizeHexInput('1234')).toBe('0x1234');
    expect(canonicalizeHexInput('0X1234')).toBe('0x1234');
    expect(canonicalizeHexInput(' 0X0x1234 ')).toBe('0x1234');
  });
});
