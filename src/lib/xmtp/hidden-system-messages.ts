const LEGACY_HIDDEN_SYSTEM_LABELS = new Set([
  'reaction',
  'reply',
  'thinking',
  'typing',
]);

export function isLegacyHiddenSystemMessage(body: string): boolean {
  return LEGACY_HIDDEN_SYSTEM_LABELS.has(body.trim().toLowerCase());
}
