# Troubleshooting

## Clear local state

If UI state is stuck or you want a clean onboarding run:

Open Converge with `?clear_all_data=true`. The router closes XMTP, deletes all
Converge IndexedDB namespaces and XMTP OPFS databases, clears browser metadata,
and returns to the inbox choice screen.

Deleting only `ConvergeDB` from DevTools is incomplete: namespaced
`ConvergeDB:<inbox>` databases, `ConvergePushState`, OPFS XMTP databases, and the
cross-inbox registry can remain.

Do not use DevTools **Clear site data** as a routine troubleshooting step.
Converge's local account keys and messages live in browser storage and will be
removed with the rest of the site data.

## Push service registration error

`AbortError: Registration failed - push service error` comes from the browser's
push provider while Converge is calling `PushManager.subscribe()`. At that
point no subscription endpoint exists, so Converge has not yet sent a logical
inbox registration to vapid.party. Cloudflare logs for the reported failure
showed healthy vapid.party health/public-key responses and no subscription
POST.

`Notification.permission === 'granted'` means only that `converge.cv` may
display notifications. Choosing **Allow forever** in that site prompt does not
enable Brave's separate browser-wide Web Push provider. Websites cannot read
that provider setting. Already visible app, native, or extension notifications
do not prove that the browser will accept a new Web Push registration for
`converge.cv`.

1. Retry once from Settings. Converge coalesces repeated setup requests and
   backs off when Chromium is still deleting an older VAPID subscription. If
   the exact root registration remains stuck after a VAPID rotation, Converge
   automatically retries with a key-versioned service-worker recovery scope;
   this does not clear IndexedDB, OPFS, inbox keys, or messages.
2. In Brave, paste `brave://settings/privacy` into the address bar and verify
   **Use Google Services for Push Messaging** is enabled. Fully quit every Brave
   window/process and installed Converge window, relaunch, and retry. Converge
   detects Brave through `navigator.brave.isBrave()` rather than guessing from
   the user agent.
3. In Chromium-based browsers, `chrome://gcm-internals` or
   `brave://gcm-internals` can expose provider events, but Brave may still show
   GCM as initialized while its Google push-services preference blocks new Web
   Push registrations. Treat the Brave privacy setting and full relaunch as the
   authoritative recovery steps.
4. Try another standard browser profile. If push registration also fails in a
   generic Web Push demo, the problem is the browser/provider rather than
   Converge or vapid.party.

The Debug page reports the last enable attempt and separately checks the
vapid.party health and public-key routes. A browser-provider failure should say
that no subscription or inbox data was sent; the public-key GET is expected.

Do not clear site data to repair push. It would delete Converge's local account
keys and messages. A cache-only refresh must preserve service-worker
registrations and the browser subscription; use **Disable notifications** when
you intentionally want Converge to delete relay registrations and unsubscribe.

## XMTP SQLite worker missing / build errors

If you see errors referring to `sqlite3-worker1-bundler-friendly.mjs`, re-run:

```bash
pnpm install
```

This repo includes a postinstall fix script (`scripts/fix-xmtp-wasm-worker.mjs`) that patches XMTP’s missing worker file inside `node_modules`.

## Tests

Use `pnpm test --run` for a one-shot Vitest run. See `AGENTS.md` Testing Notes
for the current verified status and environment-specific browser requirements.
