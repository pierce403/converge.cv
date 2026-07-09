# Documentation

This folder contains Converge.cv developer documentation and pointers to the canonical project docs.

## Start Here

- **Project overview**: [`../README.md`](../README.md)
- **Architecture & context**: [`architecture.md`](architecture.md), [`../ARCHITECTURE.md`](../ARCHITECTURE.md), and [`../AGENTS.md`](../AGENTS.md)
- **Feature spec (keep up to date)**: [`../FEATURES.md`](../FEATURES.md)
- **Roadmap / tasks**: [`../TODO.md`](../TODO.md)
- **Deployment**: [`../DEPLOYMENT.md`](../DEPLOYMENT.md)
- **XMTP reference**: official XMTP docs plus the current integration notes in [`../AGENTS.md`](../AGENTS.md)

## Guides

- **Local development**: [`development.md`](development.md)
- **Storage schema (Dexie/IndexedDB)**: [`storage-schema.md`](storage-schema.md)
- **Contact management**: [`contacts.md`](contacts.md)
- **Conversation management**: [`conversations.md`](conversations.md)
- **Troubleshooting**: [`troubleshooting.md`](troubleshooting.md)

## Conventions

- Put new docs in `docs/` unless there’s a strong reason to keep them at repo root.
- When behavior changes, update `FEATURES.md` (source of truth for shipped UX).
- For agent context / user preferences, update `AGENTS.md`.
