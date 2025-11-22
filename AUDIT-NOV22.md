# Audit (Nov 22, 2025)

- Push service worker is now shipped (removed from .gitignore) and uses the correct `/icons/icon-192.png` assets for icon/badge. Web push flows should work once VAPID config is provided.
- PWA scaffolding remains disabled: `vite.config.ts` still comments out the PWA plugin; Workbox deps are present but unused; install/update prompt components are gone; no runtime SW registration beyond the push helper. Consider removing the unused deps or re-enabling the PWA plugin and prompts to match expectations.
- XMTP protocol handler now loads pre-auth and attempts to route `web+xmtp://` links to `/i/:inboxId` DMs, with group links rejected gracefully. Group/chat invite support is still absent.
- Protocol/version messaging has been refreshed to lead with XMTP protocol v3 (SDK v5.0.1). PWA copy has been toned down to note that offline caching is disabled; keep future edits aligned with the current minimal push-only service worker until full PWA features return.
- Dev server port documentation was inconsistent (3000 vs 3001); AGENTS.md now matches the configured 3000.
