export function normalizeInboxId(value?: string | null): string | null {
  if (!value || typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

export function inboxIdsMatch(a?: string | null, b?: string | null): boolean {
  return normalizeInboxId(a) === normalizeInboxId(b);
}
