const SAFE_DATA_IMAGE_REGEX = /^data:image\/[a-z0-9.+-]+(?:;[a-z0-9.+-]+=[^;,]+)*(?:;base64)?,/i;
const URLISH_VALUE_REGEX = /^(?:https?:|data:|blob:)/i;

export function sanitizeImageSrc(src?: string): string | null {
  if (!src) return null;
  const s = src.trim();
  if (!s) return null;
  if (s.startsWith('blob:')) return s;
  if (s.startsWith('https://') || s.startsWith('http://')) return s;
  if (SAFE_DATA_IMAGE_REGEX.test(s)) return s;
  return null;
}

export function sanitizeAvatarGlyph(src?: string): string | null {
  if (!src) return null;
  const s = src.trim();
  if (!s) return null;
  if (URLISH_VALUE_REGEX.test(s)) return null;
  if (s.length > 8) return null;
  if (/\s{2,}/.test(s) || /\n|\r/.test(s)) return null;
  return s;
}

export function isDisplayableImageSrc(src?: string): boolean {
  return sanitizeImageSrc(src) !== null;
}
