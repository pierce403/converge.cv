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
inbox registration to vapid.party.

1. Retry once from Settings. Converge coalesces repeated setup requests and
   backs off when Chromium is still deleting an older VAPID subscription.
2. In Brave, enable **Use Google Services for Push Messaging** at
   `brave://settings/privacy`, relaunch Brave, and retry.
3. In Chromium-based browsers, inspect `chrome://gcm-internals` or
   `brave://gcm-internals`. Check whether GCM is enabled and whether the
   registration log records a provider failure.
4. Try another standard browser profile. If push registration also fails in a
   generic Web Push demo, the problem is the browser/provider rather than
   Converge or vapid.party.

The Debug page reports the last enable attempt and separately checks the
vapid.party health and public-key routes. A browser-provider failure should say
that the relay was not contacted.

## XMTP SQLite worker missing / build errors

If you see errors referring to `sqlite3-worker1-bundler-friendly.mjs`, re-run:

```bash
pnpm install
```

This repo includes a postinstall fix script (`scripts/fix-xmtp-wasm-worker.mjs`) that patches XMTP’s missing worker file inside `node_modules`.

## Tests

Use `pnpm test --run` for a one-shot Vitest run. See `AGENTS.md` Testing Notes
for the current verified status and environment-specific browser requirements.
