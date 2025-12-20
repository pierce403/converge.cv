import { describe, expect, it } from 'vitest';
import { isDisplayableImageSrc, sanitizeImageSrc } from './image';

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
    expect(isDisplayableImageSrc('data:image/svg+xml;base64,abc')).toBe(false);
    expect(isDisplayableImageSrc('data:text/html;base64,abc')).toBe(false);
  });

  it('sanitizes image sources', () => {
    expect(sanitizeImageSrc(' https://example.com/img.png ')).toBe('https://example.com/img.png');
    expect(sanitizeImageSrc('data:image/jpeg;base64,abc')).toBe('data:image/jpeg;base64,abc');
    expect(sanitizeImageSrc('data:image/svg+xml;base64,abc')).toBeNull();
  });
});
