# 2026-07-09 Recurse.bot Advice Check

Source checked: https://recurse.bot

Useful suggestions adopted for Converge:

- Keep `AGENTS.md` as the canonical instruction file.
- Add harness compatibility links so `CLAUDE.md` and `GEMINI.md` resolve to the same instructions.
- Add a compact root `MEMORY.md` that maps durable notes, collaborator notes, and dated logs.
- Add a compact root `SKILLS.md` with detailed reusable procedures in `skills/<name>/SKILL.md`.
- Add a `recurse-advice-sync` skill so future agents can repeat this check deliberately instead of copying advice blindly.

Notes:

- Converge already had a strong `AGENTS.md`, so this pass adds supporting indexes instead of replacing the existing project guidance.
- No runtime app behavior changed in this pass.
