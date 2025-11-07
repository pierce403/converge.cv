// Utilities for building shareable deep links that prefer an OG-capable base URL

const OG_BASE = import.meta.env.VITE_OG_BASE as string | undefined;

export function getOgBase(): string {
  try {
    const configured = (OG_BASE || '').trim();
    if (configured) return configured.replace(/\/$/, '');
    return window.location.origin;
  } catch {
    // SSR/edge safety
    return OG_BASE?.replace(/\/$/, '') || '';
  }
}

export function groupShareUrl(conversationId: string): string {
  return `${getOgBase()}/g/${encodeURIComponent(conversationId)}`;
}

export function inboxShareUrl(inboxId: string): string {
  return `${getOgBase()}/i/${encodeURIComponent(inboxId)}`;
}

export function userShareUrl(userId: string): string {
  return `${getOgBase()}/u/${encodeURIComponent(userId)}`;
}

