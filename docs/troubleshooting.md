# Troubleshooting

## Clear local state

If UI state is stuck or you want a clean onboarding run:

Open Converge with `?clear_all_data=true`. The router closes XMTP, deletes all
Converge IndexedDB namespaces and XMTP OPFS databases, clears browser metadata,
and returns to the inbox choice screen.

Deleting only `ConvergeDB` from DevTools is incomplete: namespaced
`ConvergeDB:<inbox>` databases, `ConvergePushState`, OPFS XMTP databases, and the
cross-inbox registry can remain.

## XMTP SQLite worker missing / build errors

If you see errors referring to `sqlite3-worker1-bundler-friendly.mjs`, re-run:

```bash
pnpm install
```

This repo includes a postinstall fix script (`scripts/fix-xmtp-wasm-worker.mjs`) that patches XMTP’s missing worker file inside `node_modules`.

## Tests

Use `pnpm test --run` for a one-shot Vitest run. See `AGENTS.md` Testing Notes
for the current verified status and environment-specific browser requirements.
