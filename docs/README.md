# Documentation

This folder contains Converge.cv developer documentation and pointers to the canonical project docs.

The current 2026-08-24 product contract is one visible active identity, with
legacy registry/namespaced storage retained only for compatibility. Onboarding
keeps local creation, external-wallet connection, and keyfile restore; ENS,
XMTP/Convos profiles, contacts, and push remain, while Farcaster/Neynar and
power-user sync controls are removed.

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
- **Active identity, compatibility storage, and push contracts**: [`../ARCHITECTURE.md`](../ARCHITECTURE.md)
- **Troubleshooting**: [`troubleshooting.md`](troubleshooting.md)
- **2026-08-24 core simplification audit**: [`audits/2026-08-24-core-simplification.md`](audits/2026-08-24-core-simplification.md)
- **2026-08-12 retention/XMTP/code-size audit**: [`audits/2026-08-12-retention-xmtp-size.md`](audits/2026-08-12-retention-xmtp-size.md)

## Conventions

- Put new docs in `docs/` unless there’s a strong reason to keep them at repo root.
- When behavior changes, update `FEATURES.md` (source of truth for shipped UX).
- For agent context / user preferences, update `AGENTS.md`.
