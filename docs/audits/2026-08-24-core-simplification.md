# Core Messaging Simplification Audit

Date: 2026-08-24

## Goal

Restore Converge's main app to a small, dependable messaging product: one
visible active identity, straightforward onboarding, ENS recognition, contacts,
push notifications, and disappearing messages. Remove social enrichment and
manual controls that duplicate automatic XMTP behavior.

## Product Boundary

The visible product now has one active identity. The legacy inbox registry and
per-inbox database namespaces remain as an internal compatibility seam so an
upgrade cannot silently orphan an existing user's messages or keys. They are
not exposed as inbox creation or switching controls.

New XMTP conversations start with a 14-day disappearing-message policy. Local
retention remains 28 days and existing conversations are not rewritten.

## Findings and Remediation

| Severity | Finding | Remediation |
| --- | --- | --- |
| High | Farcaster/Neynar enrichment added failing browser calls, cooldown state, duplicated identity data, filters, settings, and contact migration complexity. | Removed the runtime integration, settings, filters, stores, helpers, and tests. Startup purges the old persisted API credential and Neynar caches; legacy social fields are discarded while usable contact identity data is retained. |
| High | A failed local-only conversation could trap New Chat: retries reused the unsendable fallback instead of creating the real XMTP conversation. | Connected creation no longer falls back locally; successful retries replace stale fallback rows and repair canonical peer inbox IDs. |
| High | Failed sends could clear the user's draft while leaving an optimistic message that appeared sent. | The composer awaits publishing, blocks duplicate submissions and IME Enter, preserves the draft on failure, and removes failed optimistic rows. Attachment errors now propagate too. |
| High | Disappearing system events lost SDK expiry metadata, and native deletion could leave the legacy projected system row behind. | Expiry is projected on every system-event path; deletion removes both authoritative and legacy local projections. |
| High | Routine push enablement included stale cached inboxes, allowing inactive identities to keep relay routes and produce a false partial/failure state. | Normal setup registers only the active inbox, retires stale routes with retryable deletion tombstones, and evaluates user-facing status only against the active inbox. Batch helpers remain internal for migration cleanup. |
| High | Local persistence failures could leave optimistic send rows out of sync with an XMTP publish, inviting duplicate retries or phantom messages. | Text and attachment sends persist before publish, reconcile the authoritative SDK result atomically, clean up unpublished rows, and treat post-publish cache failures as sent rather than failed. |
| Medium | Multi-inbox menus, creation/import paths, and separate wallet controls multiplied state without helping the core workflow. | Replaced the switcher with a focused profile menu and kept only first-run local creation, external-wallet connection, and keyfile restore. |
| Medium | Manual “Check now,” “Full Sync,” pull-to-refresh, mute, install, and cache controls competed with automatic streams, background sync, and push. | Removed the redundant controls. Recovery and installation management are grouped under Settings; diagnostics are under Advanced. |
| Medium | Production debug instrumentation intercepted console traffic, tracked workers, and retained message payloads. | Dev-only instrumentation is dynamically loaded only in development, worker tracking was removed, and debug records retain metadata rather than message bodies. |
| Medium | Contact refresh could burst requests and reported blanket success even when individual lookups failed. | Refresh work is capped at four concurrent lookups and reports inline partial results. Contact rows are keyboard-accessible buttons. |
| Medium | ENS detection accepted arbitrary dotted strings and URL/email-like inputs. | Recognition is normalized and limited to valid `.eth` names, including subnames such as `.base.eth`. |
| Medium | Burning the active inbox could silently select another identity left behind by the former switcher. | Burn now returns to explicit onboarding and records intentional empty state; compatibility identities are retained but never auto-selected afterward. |

## Removed Surface

- Farcaster and Neynar API clients, stores, enrichment, reputation fields,
  filters, settings, and default-contact scaffolding.
- Visible inbox switching, additional-inbox creation/import, and duplicate
  add-wallet settings.
- Header and chat-list sync buttons, remote pull-to-refresh, mute controls, and
  the bottom-nav Debug entry.
- Production console interception, worker diagnostics, and message-body debug
  payloads.

## Retained Surface

- Local inbox creation, external-wallet onboarding, and keyfile recovery.
- ENS recognition plus XMTP/Convos profile hydration.
- Per-active-identity contacts, share links, QR flows, groups, reactions,
  replies, attachments, and push.
- Installation/recovery tools and destructive reset behind explicit Settings
  sections.
- Compatibility storage needed to read data created by earlier multi-inbox
  releases.

## Residual Risks

1. `src/lib/xmtp/client.ts` remains a large integration boundary. Splitting it
   is worthwhile, but only after the simplified behavior has soaked because its
   sync, invite, profile, and stream paths share ordering constraints.
2. Removing the compatibility registry and namespaced databases requires an
   explicit export/migration plan for users who previously created more than
   one local identity. Hiding those internals is safe; deleting them is not yet.
3. Live push delivery and Cloudflare deployment remain environment-level
   checks. Unit coverage now locks active-inbox registration semantics, while
   release CI and the deployed worker must verify the live relay.

## Verification Contract

The change is gated by application and worker TypeScript checks, strict ESLint,
the full Vitest suite, a production Vite build, Cloudflare's dry-run check in
CI, and desktop/mobile first-run smoke coverage.
