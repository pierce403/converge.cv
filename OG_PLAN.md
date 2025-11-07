# OpenGraph Previews for Deep Links (Groups, Inboxes, Users)

Social platforms do not execute JavaScript, so static GitHub Pages cannot emit dynamic OG tags for routes like `/g/:id`, `/i/:inboxId`, or `/u/:userId`. To provide rich previews, host a small edge/server app that returns HTML with per‑resource `<meta property="og:*">` and then routes humans to the PWA.

## Overview

- Share domain (suggested): `share.converge.cv`
- Routes:
  - `/g/:conversationId` → group name/image/description → redirect to `https://converge.cv/g/:conversationId`
  - `/i/:inboxId` → inbox display name/avatar → redirect to `https://converge.cv/i/:inboxId`
  - `/u/:userId` (ENS/inbox) → user profile meta → redirect to `https://converge.cv/u/:userId`
- Frontend change: when building share links, prefer `VITE_OG_BASE` if set; otherwise fallback to `window.location.origin`.

## Data Sources (public only)

- XMTP profile lookups (displayName, avatarUrl) over public identity endpoints; do NOT decrypt message content.
- Group metadata via XMTP SDK identity/preferences APIs (name, imageUrl, description). Only public/metadata fields; no message text.

## Frontend Changes (done)

- Added `src/lib/utils/links.ts` with `getOgBase()`, `groupShareUrl()`, `inboxShareUrl()`, `userShareUrl()`.
- Updated share link builders in:
  - `src/features/conversations/GroupSettingsPage.tsx`
  - `src/features/messages/ConversationView.tsx`
- Set `VITE_OG_BASE` in the deployment environment to point to your OG host (e.g., `https://share.converge.cv`).

## Cloudflare Worker Template

Create a Worker that serves OG HTML for `/g/:id`, `/i/:id`, `/u/:id`. The example uses best‑effort metadata fetch (optional) and emits an HTML page with meta tags plus an auto‑redirect.

```ts
// og-worker.ts
export default {
  async fetch(request: Request, env: Record<string, unknown>) {
    const url = new URL(request.url);
    const [_, kind, id] = url.pathname.split('/'); // ['', 'g'|'i'|'u', ':id']
    if (!kind || !id) return new Response('Not Found', { status: 404 });

    const safeId = decodeURIComponent(id);
    const canonical = `https://converge.cv/${kind}/${encodeURIComponent(safeId)}`;

    // Best‑effort metadata (replace with real calls to your metadata endpoint)
    let title = 'Converge';
    let description = 'Open decentralized conversation on XMTP';
    let image = 'https://converge.cv/icon-512.png';

    if (kind === 'g') {
      title = `Group • ${safeId.slice(0, 8)}…`;
      description = 'Join this group on Converge';
    } else if (kind === 'i') {
      title = `Inbox • ${safeId.slice(0, 8)}…`;
      description = 'Start a 1:1 conversation';
    } else if (kind === 'u') {
      title = `User • ${safeId}`;
      description = 'View profile and start a chat';
    }

    const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:image" content="${escapeHtml(image)}" />
    <meta property="og:url" content="${escapeHtml(canonical)}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta http-equiv="refresh" content="0; url=${escapeHtml(canonical)}" />
    <style>body{background:#0b0f19;color:#cbd5e1;font-family:system-ui, sans-serif;display:flex;align-items:center;justify-content:center;height:100svh;margin:0}</style>
  </head>
  <body>
    <div>
      <h1 style="margin:0 0 .5rem 0">${escapeHtml(title)}</h1>
      <p>${escapeHtml(description)}</p>
      <p><a href="${escapeHtml(canonical)}">Continue to Converge →</a></p>
    </div>
    <script>setTimeout(function(){ location.replace(${JSON.stringify(canonical)}); }, 10);</script>
  </body>
</html>`;
    return new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
  },
};

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
```

Deploy via `wrangler` and map DNS `share.converge.cv` → Worker. Ensure it returns an HTML 200 for bots and redirects humans.

## Optional: OG Image Endpoint

Add an endpoint like `/api/og?type=g&id=...` that renders a branded image (Vercel OG/Satori). Point `og:image` to that URL for richer previews.

## Validation

- Use Facebook Sharing Debugger, Twitter Card Validator, and Discord to test `/g/:id`, `/i/:id`, `/u/:id` on the OG domain.
- Confirm meta tags are visible in the raw HTML without running JS.

## Environment Variables

- `VITE_OG_BASE` in the PWA to prefer the OG domain when copying links.

