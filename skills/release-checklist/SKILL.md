# Release Checklist

Use this skill when finishing Converge changes that should be committed and
pushed.

## Required Checks

Run the CI-equivalent sequence before handing work back unless the user
explicitly scopes the work away from verification:

```bash
pnpm typecheck
pnpm lint
pnpm test --run
pnpm build
```

For docs-only changes, still run at least `pnpm lint` if practical, and explain
if the full sequence was intentionally skipped.

## Publish Flow

1. Inspect `git status --short --branch` and the staged diff.
2. Do not revert unrelated user changes.
3. Commit with a conventional message.
4. Push to `main` when that is the active project flow.
5. Use `gh`/HTTPS credentials for GitHub pushes; do not use SSH when the user has requested avoiding it.
6. After pushing, refresh `origin/main` and verify `git rev-list --left-right --count origin/main...HEAD` is `0 0`.

## Build Info Note

`pnpm build` may rewrite `src/build-info.json` with sandbox fallback values.
Restore intended checked-in fields before committing if the build environment
cannot read git metadata.
