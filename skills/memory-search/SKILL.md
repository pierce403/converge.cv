# Memory Search

Use this skill before important Converge work when prior context may affect the
answer or implementation.

## Procedure

1. Start with targeted `rg` searches rather than broad file reads:

   ```bash
   rg -n "keyword|path|feature" MEMORY.md memory AGENTS.md SKILLS.md skills
   ```

2. Open only the files that match the task.
3. Treat `AGENTS.md` as canonical for current project instructions.
4. Treat `MEMORY.md` as an index, not a replacement for checking live repo state.
5. If memory is stale or contradicted by the checkout, update the durable note or add a dated log after completing the task.

## What To Record

Record commands that worked, commands that failed in non-obvious ways, protocol
pitfalls, deployment quirks, and user preferences that materially change how the
repo should be handled.
