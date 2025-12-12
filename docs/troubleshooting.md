# Troubleshooting

## Clear local state

If UI state is stuck or you want a clean onboarding run:

```js
indexedDB.deleteDatabase('ConvergeDB')
```

## XMTP SQLite worker missing / build errors

If you see errors referring to `sqlite3-worker1-bundler-friendly.mjs`, re-run:

```bash
pnpm install
```

This repo includes a postinstall fix script (`scripts/fix-xmtp-wasm-worker.mjs`) that patches XMTP’s missing worker file inside `node_modules`.

## Known test failures

Some Vitest suites may fail depending on local environment/fixtures. See `AGENTS.md` “Testing Notes” for current status and constraints.

