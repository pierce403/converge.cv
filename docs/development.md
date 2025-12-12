# Development

## Prerequisites

- Node.js 18+ or 20+
- pnpm

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

To wipe the local app DB during development:

```js
indexedDB.deleteDatabase('ConvergeDB')
```

## Environment variables

- Use `VITE_*` env vars for local configuration.
- Avoid committing secrets. If a service needs credentials, keep them in local env only.

