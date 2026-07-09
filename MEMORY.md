---
summary: Compact map for Converge repo-local memory.
directories:
  notes: Durable project observations and reusable technical context.
  people: Collaborator preferences and working-style notes, recorded with restraint.
  logs: Dated records of completed operating-practice checks and lessons learned.
index: rg-first; qmd-compatible when available
---

# MEMORY.md

Start here when a task may depend on prior project context, then search only the
parts of `memory/` that are relevant.

## Search

Use fast local search before broad reading:

```bash
rg -n "keyword|path|feature" MEMORY.md memory AGENTS.md SKILLS.md skills
```

If `qmd` is installed later, this file is structured so it can become the repo's
compact qmd entry point without changing the directory layout.

## Directory Map

- `memory/notes/` - durable observations, pitfalls, and reusable project knowledge.
- `memory/people/` - collaborator preferences that help future work and are appropriate to retain.
- `memory/logs/` - dated work records for operating-practice checks and lessons learned.

## Current Entries

- `memory/logs/2026-07-09-recurse-bot-advice.md` - adopted useful `recurse.bot` operating suggestions for Converge.
