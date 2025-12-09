import { describe, expect, it } from 'vitest';
import { isDisplayableImageSrc } from './image';

describe('image utils', () => {
  it('validates displayable sources', () => {
    expect(isDisplayableImageSrc('https://example.com/img.png')).toBe(true);
    expect(isDisplayableImageSrc('http://example.com/img.png')).toBe(true);
    expect(isDisplayableImageSrc('data:image/png;base64,abc')).toBe(true);
    expect(isDisplayableImageSrc('blob:abc')).toBe(true);
  });

  it('rejects invalid sources', () => {
    expect(isDisplayableImageSrc(undefined)).toBe(false);
    expect(isDisplayableImageSrc('   ')).toBe(false);
    expect(isDisplayableImageSrc('ftp://example.com/img.png')).toBe(false);
  });
});
