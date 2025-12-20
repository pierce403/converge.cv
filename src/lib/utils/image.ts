const SAFE_DATA_IMAGE_REGEX = /^data:image\/(png|jpe?g|gif|webp);base64,/i;

export function sanitizeImageSrc(src?: string): string | null {
  if (!src) return null;
  const s = src.trim();
  if (!s) return null;
  if (s.startsWith('blob:')) return s;
  if (s.startsWith('https://') || s.startsWith('http://')) return s;
  if (SAFE_DATA_IMAGE_REGEX.test(s)) return s;
  return null;
}

export function isDisplayableImageSrc(src?: string): boolean {
  return sanitizeImageSrc(src) !== null;
}
