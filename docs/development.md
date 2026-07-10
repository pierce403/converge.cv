# Development

## Prerequisites

- Node.js 20 or newer
- pnpm 10 (use the version pinned in `package.json`)

## Commands

```bash
pnpm dev         # http://localhost:3000
pnpm typecheck
pnpm lint
pnpm test --run  # exits (Vitest); avoids watch mode
pnpm build
pnpm preview
```

## Testing notes

- Unit tests: use `pnpm test --run` to avoid hanging watch mode.
- E2E tests: Playwright specs live under `tests/e2e/`.

## Local data reset

Open the app with `?clear_all_data=true` to remove the global/namespaced Dexie
databases, XMTP OPFS files, push state, registry metadata, caches, and service
workers before returning to true-first-run onboarding. Deleting only
`ConvergeDB` is not a complete multi-inbox reset.

## Environment variables

- Use `VITE_*` env vars for local configuration.
- Avoid committing secrets. If a service needs credentials, keep them in local env only.
