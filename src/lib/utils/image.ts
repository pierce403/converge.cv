export function isDisplayableImageSrc(src?: string): boolean {
  if (!src) return false;
  const s = src.trim();
  return (
    s.startsWith('http://') ||
    s.startsWith('https://') ||
    s.startsWith('data:image/') ||
    s.startsWith('blob:')
  );
}

