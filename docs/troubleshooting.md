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

## Saved browser installation unavailable

If Settings says the correct inbox opened a different or unregistered local
XMTP installation, do not clear site data or delete OPFS manually. Ordinary
**Check Saved Installation Again** never registers or revokes an XMTP
installation: it can reopen an existing legacy/default database and repair
local path/installation metadata only when both local and network state verify
the exact installation.

When the warning remains, choose **Repair This Browser** and review the
confirmation. Converge persists the already-inspected candidate before any
network mutation. A recovery-authority signer may remove only the exact saved
unavailable installation; another authorized account key uses one free slot.
At 10/10 the operation stops before registering unless that exact removal is
available. A successful replacement requests encrypted device history, so an
older installation may need to be online for old messages to arrive.

The installations panel remains readable while disconnected and labels the
saved unavailable ID. Revocation buttons stay disabled until the repaired live
installation is verified. Lock, quota, or ambiguous local-registration errors
leave the database untouched instead of guessing that it is corrupt.
An 8/10 count is only capacity information; it is not the cause of the saved-ID
mismatch and still leaves room for an authorized exact-candidate repair.

## Trace a missing XMTP notification

Open **Debug -> Push Trace**. It checks the delivery path in order instead of
treating a test notification as proof that XMTP matching works:

1. **Site and service worker**: notification permission must be granted and the
   Converge service worker must be active.
2. **Browser provider**: a physical Web Push subscription must exist. **Test
   local display** checks only this browser and service worker; it does not
   contact vapid.party or XMTP.
3. **Logical relay registration**: the current inbox should have exactly one
   welcome topic plus conversation group topics and HMAC epochs when it has
   conversations. The private relay counts must match the local counts and the
   listener route must be synced.
4. **Relay delivery**: **Send relay test** checks D1 -> Queue -> Web Push
   provider -> service worker for exactly the current logical registration. A
   provider-accepted result still does not prove that an XMTP message matched.
5. **XMTP match**: send a new message from a different XMTP inbox, then refresh
   Push Trace. Messages authored by another installation of the recipient's
   same inbox are intentionally suppressed and are not a valid test.

If an inbox with conversations is `welcome_only`, or shows zero group topics or
zero HMAC epochs, select **Re-register current inbox**. This synchronizes the
active conversation list and preferences, publishes the current topic snapshot,
and verifies the private relay copy. Reloading a newly deployed Converge build
also performs one build-aware repair refresh, but the explicit Debug action does
not wait for that cooldown.

vapid.party's public landing-page status is intentionally coarse. It can prove
that the global listener and registration bridge are ready, but it cannot expose
or verify a particular inbox registration. Push Trace uses a private capability
stored in `ConvergePushState` for that check. Never paste that capability, a Web
Push endpoint, HMAC key, or copied IndexedDB registration into an issue or chat.

XMTP listener subscriptions are live-only. Repairing a registration affects new
traffic; notifications missed before the repair are not replayed. Opening
Converge still performs authoritative XMTP sync and can recover the messages.

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

Push Trace reports the last enable attempt and separately checks vapid.party's
health, public key, and the private logical registration when a management
capability exists. A browser-provider failure should say that no subscription
or inbox data was sent; the public-key GET is expected.

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
