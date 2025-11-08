const COOKIE_NAME = 'pending_group_invite';
const DEFAULT_TTL_MINUTES = 60; // 1 hour window to complete onboarding

const getDocument = (): Document | null => {
  if (typeof document === 'undefined') {
    return null;
  }
  return document;
};

const isHttps = (): boolean => {
  if (typeof window === 'undefined') {
    return false;
  }
  try {
    return window.location.protocol === 'https:';
  } catch {
    return false;
  }
};

const buildCookieAttributes = (expires: string): string => {
  const secure = isHttps() ? '; Secure' : '';
  return `; Path=/; Expires=${expires}; SameSite=Lax${secure}`;
};

export const getPendingGroupInvite = (): string | null => {
  const doc = getDocument();
  if (!doc || !doc.cookie) {
    return null;
  }

  const pairs = doc.cookie.split(';');
  for (const pair of pairs) {
    const trimmed = pair.trim();
    if (!trimmed) continue;
    if (!trimmed.startsWith(`${COOKIE_NAME}=`)) {
      continue;
    }
    const value = trimmed.slice(COOKIE_NAME.length + 1);
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  return null;
};

export const setPendingGroupInvite = (conversationId: string, ttlMinutes = DEFAULT_TTL_MINUTES): void => {
  const doc = getDocument();
  if (!doc || !conversationId) {
    return;
  }

  try {
    const ttlMs = Math.max(1, ttlMinutes) * 60 * 1000;
    const expires = new Date(Date.now() + ttlMs).toUTCString();
    const encoded = encodeURIComponent(conversationId);
    doc.cookie = `${COOKIE_NAME}=${encoded}${buildCookieAttributes(expires)}`;
  } catch (error) {
    console.warn('[Invites] Failed to set pending group invite cookie', error);
  }
};

export const clearPendingGroupInvite = (): void => {
  const doc = getDocument();
  if (!doc) {
    return;
  }

  try {
    const expires = new Date(0).toUTCString();
    doc.cookie = `${COOKIE_NAME}=;${buildCookieAttributes(expires)}`;
  } catch (error) {
    console.warn('[Invites] Failed to clear pending group invite cookie', error);
  }
};

export const consumePendingGroupInvite = (): string | null => {
  const value = getPendingGroupInvite();
  if (value) {
    clearPendingGroupInvite();
  }
  return value;
};
