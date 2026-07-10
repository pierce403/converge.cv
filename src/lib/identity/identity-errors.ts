const normalizeMessage = (error: unknown) => {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  const printable = Array.from(raw, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint >= 32 && codePoint !== 127 ? character : ' ';
  }).join('');
  return printable.replace(/\s+/g, ' ').trim();
};

export function formatCreateInboxError(error: unknown): string {
  const message = normalizeMessage(error);
  if (!message || /createIdentity returned false/i.test(message)) {
    return 'Unable to create a new Converge inbox. XMTP did not return a verified inbox installation.';
  }
  if (/missing identity update|uninitialized identity/i.test(message)) {
    return 'Unable to create a new Converge inbox. XMTP has not published the identity update yet. Retry to resume this same local key.';
  }
  const bounded = message.length > 280 ? `${message.slice(0, 277)}...` : message;
  return `Unable to create a new Converge inbox: ${bounded}`;
}
