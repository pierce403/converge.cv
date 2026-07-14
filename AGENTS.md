# Agents Context & Project Knowledge

**⚠️ IMPORTANT: Future agents working on this project should READ THIS FILE FIRST and UPDATE IT whenever they learn something new about the project or user preferences.**

`AGENTS.md` is the canonical instruction file for this repository. `CLAUDE.md`
and `GEMINI.md` are compatibility symlinks that point here so other harnesses
read the same source of truth.

---

## Agent Responsibilities

- Keep Converge static and local-first unless the user explicitly changes the architecture.
- Preserve the low-friction identity flow: no passphrases, no lock screen, no wallet prompts by default.
- Use repo-local indexes before important work: `AGENTS.md`, `MEMORY.md`, and `SKILLS.md`.
- Record durable project learnings where future agents will look: `AGENTS.md` for canonical rules, `MEMORY.md`/`memory/` for searchable context, and `SKILLS.md`/`skills/` for reusable procedures.
- Work in focused steps, verify real behavior when practical, then commit and push completed changes.

## Project Overview

**Converge.cv** - A Signal-like, local-first Progressive Web App for XMTP protocol v3 (currently running @xmtp/browser-sdk v6.1.2).

- **Live URL**: https://converge.cv
- **Tech Stack**: React 18 + TypeScript + Vite + Tailwind CSS
- **State Management**: Zustand
- **Storage**: Dexie (IndexedDB wrapper)
- **Messaging Protocol**: XMTP protocol v3 (production network) via XMTP SDK v6.1.2
- **PWA**: hand-maintained service worker and web app manifest
- **Deployment**: GitHub Pages (auto-deploy on push to main)

---

## Critical User Preferences

### 🚫 NO PASSPHRASES BY DEFAULT
- **User strongly prefers**: Zero friction authentication
- **Never require passphrases** for onboarding or regular use
- Incomplete passphrase and passkey paths are hidden; do not expose or document them until encryption and recovery are implemented end to end.
- A true first visit should show the inbox choice screen. Creating a local-key inbox remains one click, followed by the dismissible profile editor; do not add passphrase or wallet steps to that action.
- **Exception**: A passphrase may return as an advanced feature only if explicitly requested and fully implemented.

### 🔓 NO VAULT LOCKING BY DEFAULT
- App should stay unlocked by default after initial setup
- The former lock-screen control is hidden because current private material is not encrypted at rest.
- Don't imply that a UI lock encrypts IndexedDB or the XMTP database.
- An intentionally empty state after Burn Inbox must remain empty; do not treat it as a true first visit and silently create a replacement inbox.

### ⚡ ONE-CLICK ONBOARDING
- On every unauthenticated visit, show Create new inbox, Restore from keyfile, and Add this device to existing inbox before any identity or wallet action. The Color Animal name/avatar editor follows successful creation and is dismissible.
- Empty onboarding after an intentional final-inbox burn uses the same choice screen without auto-creating another inbox.
- "Create new Converge inbox" remains a one-click generated-key flow from the Inbox Switcher or empty onboarding.
- **No manual wallet address entry**
- **No passphrase setup**
- **No multi-step wizard** except where wallet approval or installation-limit recovery requires it.
- Wallets are authority for an existing inbox. They must not silently create an unrelated local-key inbox first.

### 🚫 NO FAKE/MOCK DATA OR IDs
- **NEVER use placeholder, fake, or mock API keys, project IDs, or credentials**
- If a service requires an API key or project ID, **ASK THE USER** to generate it
- Do not use placeholder values like `'your-api-key-here'`, `'fake-id'`, `'default-project'`
- Real production services need real credentials - don't assume defaults will work
- **Exception**: Development/testing stubs for XMTP message handling are acceptable if clearly marked

---

## Product Decisions (updated 2026-07-11)

- Treat the top-left identity control as an Inbox Switcher with one profile-name/avatar entry per XMTP inbox, not one entry per key. Each inbox is an independent social identity and storage namespace; only the selected inbox connects and syncs.
- Add Inbox supports Create new inbox, Import keyfile, and Add this device to existing inbox. Import reuses the exact key and its resolved inbox. If that inbox is already loaded, say "This inbox is already loaded" and change nothing.
- Use "local account key" or "Converge key" for the app-held signer. Reserve "installation" for the XMTP SDK device/app-instance key. Do not expose a message-level key selector; recipients see the sender inbox. A future transaction-signing key selector is a separate wallet feature.
- Keep plaintext key export in Advanced and never prompt users to write down or export a seed phrase. Loss of the only local copy is an accepted default tradeoff.
- Warn before wallet/account association that address-to-inbox identity links are publicly queryable and effectively permanent.
- Burn Inbox lives only in the selected inbox's Settings. After one quick confirmation, attempt installation revocation, then wipe every local inbox-scoped key, database, message, contact, draft, attachment, profile, and cache regardless of revoke success. Explain failed remote revocation and return to empty onboarding after the last inbox.
- Contacts are separate per inbox, created after active participation, and display the peer's published profile. Do not add private aliases, notes, or custom contact sync. XMTP consent is network-synced per inbox, cached locally, and refreshed when that inbox becomes active.
- Follow current Convos behavior by default, including profile messages that carry human and agent names, unless a Converge-specific difference is explicitly documented.
- Notifications are app/browser-level: one physical browser subscription, one logical relay registration per loaded inbox/installation, and batched conversation topics per registration. Enable covers all loaded inboxes; disable deletes all logical registrations before unsubscribing. Inactive pushes set an approximate switcher activity dot without syncing. Visible copy may name the full inbox profile from local state but must not expose that name, the sender, or message content to the relay. Real group/welcome delivery is verified; keep this experimental until an always-on listener is deployed and mobile/PWA reliability is characterized.
- Notification clicks open or focus Converge without automatically switching inboxes. The target inbox remains marked with an approximate activity dot until the user selects it.
- Inbound RemoteAttachments are descriptor-first: receipt/history sync must never contact the attachment host. Only an XMTP-allowed conversation can fetch after a coalesced preferences sync inside the download slot; trusted hosts auto-load only for visible bubbles, unknown hosts require a hostname-labelled click, and every fetched payload must pass the bounded HTTPS/decrypt/static-raster policy documented in `FEATURES.md`. Attachment Accept and conversation Block/Unblock publish XMTP consent. Keep Thirdweb as the outbound ciphertext host until a separate hosting feature is requested.

`FEATURES.md` contains the shipped user-facing contract. `ARCHITECTURE.md` is the canonical technical implementation contract after context compaction.

---

## Architecture Decisions

### Identity & Storage
- **Identities stored in IndexedDB** (via Dexie), NOT localStorage
- Local app keys are generated with secp256k1 wallet primitives and stored as exportable identity records.
- Private keys and mnemonics are currently stored unencrypted in IndexedDB. Decrypted messages and attachment bytes are also local plaintext; the XMTP OPFS database is not encrypted by Converge.
- A local account key is an XMTP account identity. An XMTP installation is a separate SDK-generated installation key stored in the inbox-aware XMTP database.
- New identities use the SDK's inbox-aware default database path. Existing identities without a path marker retain the legacy address-based path to avoid installation churn.

### Authentication Flow
```
App start → checkExistingIdentity() →
  Existing identity: reopen its persisted XMTP database → verify inbox and installation
  No usable identity: show inbox choice screen without creating an inbox or opening a wallet

Create new Converge inbox →
  Generate a fresh local key → explicitly register one inbox/installation → verify and store IDs

Restore from keyfile →
  Reuse the same private key/mnemonic → resolve the same inbox → register only a new installation if needed

Add this device to existing inbox →
  Connect wallet that owns existing inbox →
  Probe target inbox and installation limit without creating a client for the new key →
  Generate a fresh local account key →
  Register/reuse this browser installation under wallet authority →
  Refresh that exact installation through the manager and independent network state →
  Retry only XMTP's rejected `Missing existing member` response while a fresh registration propagates →
  If locally ready but still network-absent, preserve the key and replace the pending default DB/installation once after a new 10/10 check →
  Associate the fresh key only after proving it is unassociated and the wallet is still current authority →
  Reopen the same inbox database with the fresh key → verify inbox and installation IDs → request history
```

### Key Functions
- `createIdentity(address, privateKey, options)` - Creates a new inbox or restores a key, then persists verified runtime IDs.
- `checkExistingIdentity()` - Reconnects a stored identity; returns to onboarding when none exists.
- `addDeviceToExistingWalletInbox()` - Generates a fresh key, provisions it into the wallet's existing inbox, reconnects with that key, and verifies both IDs.
- `provisionDeviceKeyForInbox()` - Low-level wallet-authorized association path with ledger and 10/10 preflight checks.
- `reassignAccountToInbox()` - Refuses cross-inbox reassignment. Any future destructive reassignment needs a separate explicit confirmation flow and stranding warning.

---

## PWA Features

### Install Prompt
- Component: `src/components/PWAInstallPrompt.tsx` (currently removed/disabled)
- Original copy referenced “offline messaging”; avoid promising offline until the service worker is re-enabled.
- Remembers dismissal in localStorage (`pwa-install-dismissed`)
- Only shows once per device

### Update Notifications
- Component: `src/components/UpdatePrompt.tsx`
- Checks for updates every hour automatically
- Shows banner: "Update Available" with "Update Now" and "Later" buttons
- `registerType: 'prompt'` in vite.config.ts for user control
- Non-intrusive - users can dismiss and continue

---

## UI/UX Guidelines

### Messaging About Features
- ❌ DON'T say "Works offline" (confusing for messaging app)
- ✅ DO emphasize:
  - "End-to-end encrypted messaging"
  - "Your data stays on your device"
  - "No phone number required"
  - "Decentralized protocol"

### Onboarding Copy
- Keep it simple and welcoming
- No technical jargon about keys, encryption, etc.
- Focus on benefits, not implementation details

---

## File Structure

```
src/
├── app/
│   ├── Layout.tsx          # Main layout with PWA prompts
│   ├── Router.tsx          # Route configuration
│   └── Providers.tsx       # Context providers
├── features/
│   ├── auth/
│   │   ├── OnboardingPage.tsx    # First-run creation plus empty-state new/join/restore
│   │   ├── useAuth.ts            # Auth hook with createIdentity()
│   ├── conversations/
│   ├── messages/
│   ├── settings/
│   └── search/
├── lib/
│   ├── xmtp/              # XMTP client wrapper (in-progress mainnet integration)
│   ├── storage/           # Dexie IndexedDB driver
│   ├── crypto/            # Vault & encryption (optional)
│   ├── stores/            # Zustand state stores
│   └── utils/
├── components/
│   ├── PWAInstallPrompt.tsx     # Install app prompt
│   └── UpdatePrompt.tsx         # Update notification
└── types/
    └── index.ts           # TypeScript interfaces
```

- `docs/`                  # Developer documentation (index: `docs/README.md`)

---

## Development Commands

```bash
pnpm dev              # Start dev server (port 3000)
pnpm build            # Build for production
pnpm preview          # Preview production build
pnpm test --run       # Run Vitest suite once (avoids hanging watch mode)
pnpm lint             # Run ESLint
pnpm typecheck        # TypeScript type checking
```

---

## Deployment

- **Auto-deploy**: Every push to `main` triggers GitHub Actions
- **Process**: Type check → Build → Deploy to GitHub Pages
- **Domain**: converge.cv (CNAME configured)
- See `DEPLOYMENT.md` for details

---

## Security & Supply Chain

- CodeQL scanning: Configured via `.github/workflows/codeql.yml` to run on pushes, PRs to `main`, weekly, and manual dispatch. Results appear in GitHub code scanning alerts.
- Socket.dev supply-chain scan: Configured via `.github/workflows/socket.yml` using the Socket CLI.
  - The job runs `npx -y @socketsecurity/cli scan --ci` on pushes/PRs to `main`.
  - Optional: add a repository secret `SOCKET_API_KEY` for enriched results/logging.
  - No server components are required; this runs fully in GitHub Actions.


---

## Current State (as of this session)

### ✅ Completed
- Choice-first onboarding shows Create, Restore, and Add this device before any identity or wallet action; successful creation registers the inbox before showing the dismissible Color Animal name/avatar editor
- The top-left Inbox Switcher has one profile-name/avatar row per inbox, keeps only the selected inbox connected, and provides Create, Import keyfile, and Add this device actions; duplicate imports stop with "This inbox is already loaded"
- Burn Inbox is Settings-only, attempts current-installation revocation, then wipes the inbox namespace, keys, XMTP OPFS data, messages, contacts, attachments, profile metadata, caches, and runtime state even when revocation fails
- Contact persistence is inbox-scoped and action-gated, uses peer-published profiles, and discards legacy private aliases/avatar overrides/notes instead of adding custom contact sync
- Plaintext keyfile export is available only under collapsed Advanced settings; wallet association requires acknowledging that the address-to-inbox link is public and effectively permanent
- Notifications use one app/browser toggle, one shared physical `PushSubscription`, cached logical per-inbox/installation relay records, and inactive-inbox activity dots. Active-inbox registration canonicalizes MLS group topics, preserves every HMAC epoch, and adds the deterministic installation welcome topic. Notification clicks always focus/open Converge's root without switching. Real production group/welcome delivery is verified, but automatic delivery remains experimental because no always-on XMTP listener is deployed.
- Explicit onboarding model for new inbox creation, same-key keyfile restore, and fresh-device-key association with an existing wallet inbox
- Wallet-approved device provisioning verifies membership through the manager's own network refresh, prevents accidental reassignment, and persists the final installation ID. A locally ready but network-absent pending default database is replaced at most once while preserving the staged account key and rechecking 10/10 capacity.
- Ethereum addresses are canonicalized before signer construction and persistence; repeated `0x0x...` display/storage values are repaired only when the remaining payload is a valid 20-byte address
- Mobile wallet connectors own their redirect/deep-link lifecycle, can resume with an account-bound signer before chain state arrives, and every XMTP signature is bound to the selected wallet account
- Explicit wallet choices never fall through to another connector. Bytecode inspection is bounded; if all inspection RPCs fail, onboarding and Settings ask the user to choose regular wallet or smart account, and require a real connected chain for the smart-account choice.
- Existing-inbox and reload connections fail closed under explicit registration policies instead of falling back to standalone inbox creation
- Fresh inbox registration uses `client.isRegistered()`, persists the installation before mutation, registers at most once, and verifies the signer plus exact installation in network state before onboarding completes
- New installations request XMTP device history and explain that an older installation may need to be online
- `Client.create` now uses the app version, disables auto-registration, and compares the full signer identity including source, wallet type, and SCW chain ID
- Incomplete passphrase/passkey/vault-lock UI is hidden; documentation and Settings describe current plaintext local storage accurately
- The 2026-07-14 dependency remediation removes the unused Proto, Dexie React hook, Workbox/PWA helper, patch, and full Thirdweb SDK trees; patched direct/transitive releases produce a zero-finding `pnpm audit --audit-level low` without changing the XMTP or Wagmi major versions
- GitHub Pages, CodeQL, and dormant Socket workflows use their current Node 24-based action majors, while Converge build commands run on Node.js 22; do not reintroduce Node 20 action majors
- Native Wagmi/Reown is the only wallet connection stack; encrypted attachment uploads call Thirdweb's narrow storage HTTP contract without shipping the Thirdweb SDK
- Browser push setup waits for the active root service worker, validates the VAPID public key, single-flights provider registration, and backs off across Chromium's stale-subscription deletion race. Provider failures explicitly say that vapid.party was not contacted; Settings and Debug retain inline results instead of push setup alerts.
- PWA install prompt with localStorage persistence (currently disabled for debugging)
- Update notification system with hourly checks (currently disabled for debugging)
- Local identities remain available by default; no lock/vault UI is exposed
- Identity storage in IndexedDB
- Clean UI with proper feature messaging
- Desktop browser chat view now uses a persistent split pane (conversation list left, selected thread right)
- Wallet-backed XMTP signing now dedupes concurrent prompts and reuses valid signatures to prevent wallet popup loops
- External wallet signing now shows a global blocking modal so users clearly see when Converge is waiting on signature approval/rejection
- Contact Details refresh treats the peer-published XMTP/Convos profile as canonical; Farcaster/ENS are optional secondary identity and reputation metadata
- Address→inbox identity lookup uses a shared cached resolver (`resolveInboxIdForAddress`) and `canMessageWithInbox`, reducing repeated `IdentityApi/GetInboxIds` calls across conversation, send, and contact refresh paths
- Debug log control in bottom navigation captures console output and surfaces state snapshots
- Full-screen Debug tab (`/debug`) aggregates console, XMTP network, and runtime error logs
- Debug Invite Tools: "Claim Invite Code" parses Convos invite links and sends a Convos `join_request` custom content payload to the creator inbox via XMTP DM
- Group settings now include a member validation tool to flag inboxes missing XMTP identity updates.
- Convos profile compatibility now treats self-authored `profile_update` and roster `profile_snapshot` messages as primary, with compressed protobuf `appData` as a legacy fallback. Current Convos iOS resolves canonical name/member kind by inbox while keeping encrypted avatar slots per conversation; Converge's wire implementation is compatible but its stored relayed profile state remains conversation-scoped.
- New one-to-one chats now use Convos-style single-peer XMTP groups; legacy DMs remain readable and invite requests still use creator DMs.
- Group activation/sends/profile saves publish the sender's Convos `profile_update`; group creation and member additions publish roster snapshots so newly joined MLS members can see existing names and agents.
- Convos typing indicators, profile updates/snapshots, thinking messages, and join requests are registered as SDK custom content types and handled without surfacing side-channel bubbles.
- XMTP Browser SDK upgraded to 6.1.2 (built-in content types + updated send/create APIs; Utils removed).
- Default conversations seeded from `DEFAULT_CONTACTS` when a new inbox has no history
- Image attachments use encrypted XMTP RemoteAttachment payloads hosted through Thirdweb IPFS via a narrow direct HTTPS upload transport. Incoming descriptors are stored without fetching; allowed/visible trusted-host images use bounded authenticated raster downloads, unknown hosts require explicit approval, and recoverable plaintext bytes use a 100 MiB per-inbox LRU cache.
- Watchdog reloads the PWA if the UI thread stalls for ~10s to restore responsiveness automatically
- Root `ARCHITECTURE.md` is now the canonical architecture/decision tracker, with `docs/architecture.md` linking to it.
- Static PWA push registration is wired to the intended app-level vapid.party XMTP relay contract without shipping any vapid.party API key:
  - public config only: `VITE_VAPID_PARTY_API_BASE` and optional `VITE_VAPID_PUBLIC_KEY`;
  - `Enable notifications` registers `/sw.js`, requests browser permission, creates/reuses one physical `PushSubscription`, and upserts logical registrations for every loaded inbox with available material;
  - the active inbox synchronizes preferences, includes Allowed/Unknown conversations and stitched-DM backing groups, preserves every distinct HMAC epoch, canonicalizes group topics, and adds `/xmtp/mls/1/w-<installation-id>/proto`;
  - sync/conversation changes plus XMTP HMAC-key and consent updates trigger debounced, serialized refreshes that preserve a trailing newest snapshot;
  - disable deletes every cached logical relay record before unsubscribing, retaining failed deletion tombstones for retry;
  - the service worker stores opaque per-inbox activity hints, resolves the profile name only from local state, and always focuses/opens the Converge root without accepting relay navigation; plaintext XMTP message content is not sent through push.
- vapid.party's contract separates one physical endpoint from logical inbox/installation registrations and accepts minimal opaque delivery events. A 2026-07-12 live test passed with real production XMTP clients, the official v3 listener, production D1/Queue, FCM, and Converge's live service worker. No always-on XMTP listener is deployed yet, so the feature remains experimental and is not continuously delivering.
- XMTP protocol runtime:
  - **XMTP SDK v6.1.2 on protocol v3**: ✅ Fully working!
  - **Upgraded from v5.0.1 → v6.1.2** (January 25, 2026)
  - Following xmtp.chat reference implementation
  - Identities properly registered on XMTP production network
  - Wallet generation uses proper secp256k1 (address derived from private key via `viem`)
  - Message streaming active via `conversations.streamAllMessages()`
  - Incoming messages displayed in real-time
  - Can message and be messaged from xmtp.chat and other XMTP protocol v3+ clients
  - **Key difference from v3**: `getIdentifier()` is synchronous in v5+ (was async in v3)

### 🚧 TODO
- Device-based encryption for private keys (currently stored in plain text in IndexedDB)
- Video + multi-file attachments (image attachments are now supported)
- Re-enable non-push PWA features (install prompt, update notifications/full app-shell service worker) when ready.
- Push follow-up: deploy an always-on XMTP listener with durable PostgreSQL into vapid.party's authenticated delivery ingest, then characterize installed-PWA and mobile platform reliability before claiming notifications are complete.
- **Default Contacts/Bots**: `src/lib/default-contacts.ts` has placeholder addresses for suggested bots (Welcome Bot, Base Agent, ENS Resolver, etc.). Replace with actual XMTP-enabled addresses when available. Check:
  - https://docs.xmtp.org for official XMTP bots
  - https://base.org for Base ecosystem agents
  - XMTP community Discord/forums for verified bot addresses
- **Hosting Limitation (Resolved)**: GitHub Pages itself cannot set COOP/COEP headers, so the PWA service worker now injects
  `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: credentialless` on navigations. The app shows a
  one-time "Enabling advanced mode…" banner while waiting for isolation, reloads after the SW takes control, and then proceeds
  with XMTP initialization.

---

## Testing Notes

- Dev server runs on port 3000
- Browser testing done via Playwright MCP tools
- Clear IndexedDB with: `indexedDB.deleteDatabase('ConvergeDB')`
- For Vitest, use `pnpm test --run` so the command exits; plain `pnpm test` starts watch mode and can hang automation.
- PWA prompts only trigger on HTTPS or localhost
- Current Vitest status (2026-07-14): `pnpm test --run` passes (81 files, 519 tests).

---

## User's Goals

User wants to enable:
1. **Create new identity from nothing** → ✅ DONE (identities now properly registered on XMTP network)
2. **Message someone on the Base app** → ✅ DM creation + sending working (v6, identifier-based)
3. **Manage multiple independent inboxes and add a fresh local key to an existing wallet-controlled inbox** → ✅ Implemented; continue live cross-device validation

Focus on **friction-free onboarding** for new users first.

### Key Technical Learning: XMTP Browser SDK Integration Journey

**v3 Integration (Initial)**:
**Problem**: XMTP v4 and v5 had persistent worker initialization failures, and initial v3 integration had "Unknown signer" errors.

**Root Causes**:
1. **v4/v5 incompatibility** - Newer SDK versions had worker issues (turned out to be related to our COOP/COEP hack)
2. **Wrong Identifier format** - v3 uses `{ identifier: "0x...", identifierKind: "Ethereum" }`
3. **Vite bundling** - The worker file tried to import `@xmtp/wasm-bindings` as a bare module, which failed because we excluded it from Vite's optimizeDeps
4. **CRITICAL: Wallet generation bug** - We generated random bytes for BOTH private key AND address separately! In Ethereum, the address must be derived from the private key using secp256k1 elliptic curve cryptography
5. **Message streaming** - Must explicitly call `conversations.sync()` and `conversations.streamAllMessages()` to receive messages

**v5 Upgrade (October 28, 2025)**:
**Why it works now**: The v4/v5 worker issues were caused by our COOP/COEP service worker hack (for SharedArrayBuffer). After removing that hack, v5 works perfectly!

**Breaking changes v3 → v5**:
- `getIdentifier()` is now **synchronous** (was async in v3)
- All other APIs remained the same

**Benefits of v5**:
- Latest bug fixes and performance improvements
- Aligned with xmtp.chat reference implementation
- Better future compatibility (v2 deprecating June 2025)

**v6 Upgrade (January 25, 2026)**:
- Built-in content types; removed `@xmtp/content-type-*` dependencies and codec registration.
- New message helpers (`sendText`, `sendReaction`, `sendReply`, `sendRemoteAttachment`, `sendReadReceipt`) replace manual `send()` for core types.
- Conversation APIs renamed to `createDm`/`createGroup` and `createDmWithIdentifier`/`createGroupWithIdentifiers`.
- `Utils` class removed; use `getInboxIdForIdentifier`, `generateInboxId`, and `Client.fetchInboxStates`.
- Attachment helpers now live in the SDK (`encryptAttachment`/`decryptAttachment`); `Attachment.content` replaces `data`.
- Identifier kind is now an enum (`IdentifierKind`); inbox state exposes `accountIdentifiers`.

**Solution**:
1. **Downgrade to v3.0.5** - The version that cthulhu.bot uses successfully
2. **Fix Identifier format** for v3 API compatibility  
3. **Remove Vite exclusions** - Let Vite bundle dependencies into the worker
4. **Properly derive address from private key**:
```typescript
// ❌ WRONG - Two unrelated random values
const privateKeyBytes = crypto.getRandomValues(new Uint8Array(32));
const addressBytes = crypto.getRandomValues(new Uint8Array(20)); // BUG!

// ✅ CORRECT - Derive address from private key
const privateKeyBytes = crypto.getRandomValues(new Uint8Array(32));
const account = privateKeyToAccount(privateKeyHex);
const address = account.address; // Derived via secp256k1
```

5. **v3 Signer implementation**:
```typescript
private createSigner(address: string, privateKeyHex: string): Signer {
  return {
    type: 'EOA',
    getIdentifier: async () => ({  // MUST be async
      identifier: address,          // DON'T lowercase!
      identifierKind: 'Ethereum',
    }),
    signMessage: async (message: string) => {
      const account = privateKeyToAccount(privateKeyHex);
      const signature = await account.signMessage({ message });
      return new Uint8Array(/*...convert hex to bytes...*/);
    },
  };
}
```

6. **No manual registration needed** - Just call `Client.create()`, v3 auto-registers
7. **Message streaming setup**:
```typescript
// After successful connection:
await client.conversations.sync();
const stream = await client.conversations.streamAllMessages();
for await (const message of stream) {
  // Handle incoming messages
}
```

**Key Learnings**:
- Always check working examples (cthulhu.bot) when debugging
- Worker errors with undefined fields = import/module loading failure
- v3 SDK doesn't require COOP/COEP headers (but they improve performance)
- Vite's `optimizeDeps.exclude` breaks worker module imports
- **CRITICAL**: In Ethereum, address = `secp256k1_public_key(private_key)` - they're mathematically related!
- v3 SDK auto-registers, v4/v5 require manual `register()` call
- `getIdentifier` must be async in v3
- Don't lowercase Ethereum addresses - they have checksums
- Must explicitly start message streaming, it's not automatic

### Key Technical Learning: XMTP v3 Registration Flow (DEPRECATED - v4/v5 only)
**Problem**: Randomly generated Ethereum addresses were being stored locally but NOT registered with XMTP, causing "no inbox ID" errors when trying to message them from xmtp.chat.

**Solution**: XMTP v3 SDK requires a multi-step registration process:
```typescript
const client = await Client.create(address, { env: 'production' });
const isRegistered = await client.isRegistered();

if (!isRegistered) {
  // Get message to sign
  const signatureText = await client.getCreateInboxSignatureText();
  
  // Sign with Ethereum wallet (secp256k1 ECDSA)
  const account = privateKeyToAccount(privateKey);
  const signature = await account.signMessage({ message: signatureText });
  
  // Submit signature and register
  await client.addSignature(WasmSignatureRequestType.CreateInbox, signatureBytes);
  await client.registerIdentity();
  
  // Now client.inboxId is set and address is discoverable on XMTP network
}
```

**Key Dependencies**:
- `viem` for proper Ethereum message signing (secp256k1, not P-256)
- XMTP SDK's `registerIdentity()` must be called to persist on network
- Without registration, addresses are only local and can't receive messages

---

### Git Learnings

- When filtering `git log` by date, be mindful of timezone differences and the exact interpretation of date strings by Git.
- `git log --since="YYYY-MM-DD" --until="YYYY-MM-DD"` should work for specific date ranges.
- `git log -1 --format=%cd` is reliable for getting the exact commit date of the most recent commit.
- If initial date-based filtering doesn't yield expected results, consider broader searches or direct commit inspection.

## Instructions for Future Agents

### Before Starting Work
1. **Read this file completely**
2. Check `MEMORY.md` and `SKILLS.md` for relevant repo-local context and reusable procedures.
3. **Check for time gaps**: If the last update timestamp seems old or there's been time since the last session:
   ```bash
   cd /home/pierce/projects/converge.cv && git pull
   git log --oneline --no-merges HEAD~20..HEAD  # Review recent commits
   ```
4. Check `TODO.md` for planned features
5. Review root `ARCHITECTURE.md`, `FEATURES.md`, and `docs/README.md` for current technical/product context
6. Look at recent git history to understand latest changes
7. Load XMTP LLM + content-type docs into context for reference:
   - https://docs.xmtp.org/chat-apps/intro/build-with-llms
   - https://docs.xmtp.org/llms/llms-full.txt
   These links help with content-type handling and message classification; prefer using them when extending system-message support.

### While Working
- Keep the no-passphrase principle in mind
- Maintain the simple onboarding flow
- Test changes in browser (localhost:3000)
- Check for linter errors after edits
- `pnpm install` now runs `scripts/fix-xmtp-wasm-worker.mjs` automatically to patch
  the missing XMTP sqlite worker file inside `node_modules`. If the build complains
  about `sqlite3-worker1-bundler-friendly.mjs`, re-run `pnpm install` or invoke the
  script manually with `node scripts/fix-xmtp-wasm-worker.mjs` to regenerate it.

### After Completing Work
1. **UPDATE THIS FILE** with new learnings
2. Add any new user preferences discovered
3. Document new architectural decisions
4. Update the "Current State" section
5. Note any new dependencies or tools added
6. Update `MEMORY.md`/`memory/` when durable context is useful but too detailed for this file.
7. Update `SKILLS.md`/`skills/` when a reusable procedure changes.
8. Always run the full CI-equivalent checks before handing work back: `pnpm typecheck && pnpm lint && pnpm test --run && pnpm build` (matches the GitHub Pages workflow order: typecheck → lint → test → build/deploy).
9. **ALWAYS COMMIT AND PUSH ALL CHANGES** - This is mandatory after completing any work:
   ```bash
   git add -A
   git commit -m "feat: description of changes made"
   git push origin main
   ```
   - Commit message should follow conventional commits (feat:, fix:, docs:, etc.)
   - Include AGENTS.md updates in the same commit if applicable
   - Never leave uncommitted changes when completing work

## Documentation Expectations

- Whenever a feature is added, removed, or meaningfully modified, **update `FEATURES.md`** with the current behavior and specification details so future agents stay in sync with the shipped experience.
- Developer docs live under `docs/` (start at `docs/README.md`).

### Communication Style
- Ask clarifying questions if passphrase/security features are needed
- Default to simplicity and low friction
- User prefers direct implementation over suggestions

---

## Contact & Links

- **Repository**: https://github.com/pierce403/converge.cv
- **Live App**: https://converge.cv
- **XMTP Docs**: https://xmtp.org

### XMTP + LLMs (Always Load In Context)
- Build with LLMs overview: https://docs.xmtp.org/chat-apps/intro/build-with-llms
- Full LLMs guide (raw): https://docs.xmtp.org/llms/llms-full.txt

These links are high-signal for XMTP behaviors and should be considered required reading for future agents working on AI/agent features. Keep them in working memory while making protocol/UI decisions.

### XMTP + LLMs (Always Load in Context)
- Build-with-LLMs overview: https://docs.xmtp.org/chat-apps/intro/build-with-llms
- Full reference text (raw): https://docs.xmtp.org/llms/llms-full.txt

Guidance:
- Before starting related work, open and keep these two docs in your session context. If needed, fetch the raw text locally for quick grep:
  - `curl -L https://docs.xmtp.org/llms/llms-full.txt -o code/xmtp-llms-full.txt`
- Treat these as required context when implementing or debugging anything that involves LLMs, assistants, or message flows that may be model-driven.

### Farcaster / Neynar Docs (Load for Farcaster features)
- Neynar API reference: https://docs.neynar.com/reference/overview
- Users by verification endpoint: https://docs.neynar.com/reference/get-users-by-verifications
- General Neynar developer docs: https://docs.neynar.com

Use the Converge Neynar client key `e6927a99-c548-421f-a230-ee8bf11e8c48` as the baked-in default (user-provided and not secret). Prefer `VITE_NEYNAR_API_KEY` when present.

### Operating Practice References
- Agent etiquette/advice review source: https://recurse.bot

---
**Last Updated**: 2026-07-14 (app version 0.5.6 + browser push-provider recovery)
**Updated By**: AI Agent


## Latest Changes (2026-07-14)

### Browser Push Provider Recovery
- Cloudflare Workers Logs showed zero vapid.party error-level events over the inspected 48-hour window, while its XMTP public-key route returned 200 and its stored VAPID key remained structurally valid. A clean Chrome profile created and removed a real FCM subscription against the live Converge service worker and production key.
- `AbortError: Registration failed - push service error` occurs inside Chromium before Converge has a browser endpoint and therefore before any vapid.party registration POST. Chromium can produce it when a stale subscription is removed and its asynchronous provider deletion is still pending, as well as when browser push services are disabled or unhealthy.
- Push setup now waits for the active root service worker, validates the VAPID key's 65-byte uncompressed-point encoding, shares concurrent provider work, rechecks asynchronous completion, and uses bounded retry/backoff for stale-key replacement. A final provider failure explains that vapid.party was not contacted and points users toward browser push settings.
- Settings shows persistent inline push results instead of browser alerts. Debug prevents overlapping enable attempts and retains the last setup result.
- CI-equivalent verification passes: typecheck, zero-warning lint, 81 Vitest files (519 tests), and the production build.


## Latest Changes (2026-07-12)

### XMTP Push Topic And Service-Worker Hardening
- Browser SDK 6.1.2 returns raw MLS group IDs from its HMAC-key APIs. Push registration now synchronizes preferences, collects Allowed/Unknown conversations with duplicate-DM backing groups, canonicalizes group topics, preserves every distinct HMAC epoch, and appends the installation's deterministic no-HMAC welcome topic.
- Active-inbox relay snapshots refresh after sync/conversation changes and XMTP HMAC-key or consent events. Refresh work is debounced, serialized, and coalesced while retaining a trailing newest snapshot. Disable/Burn synchronously invalidate stale work and abort bounded relay requests; permission/VAPID preparation stays outside the lock, and post-POST persistence failures roll back or retain a tombstone. Inactive inboxes remain cached without opening additional XMTP clients.
- One physical browser endpoint supports logical registrations for multiple inboxes/installations. Endpoint rotation cleans up the old logical registration, while deleting one logical inbox leaves other registrations on that endpoint intact.
- Push payloads identify an inbox only by an opaque local handle. The service worker resolves profile copy locally, records approximate activity, and ignores all relay-supplied navigation by always opening/focusing the Converge root.
- The public registration and authenticated delivery contracts do not replace an XMTP listener. Real production welcome/group delivery passed through a disposable official v3 listener, temporary PostgreSQL, the production relay, FCM, and Converge's live service worker; no always-on listener is deployed, so continuous delivery remains experimental and unclaimed.


## Latest Changes (2026-07-11)

### Consent-Aware Attachment Downloads
- Bumped Converge from `0.5.4` to `0.5.5` for the inbound RemoteAttachment security policy.
- Receipt and history processing persist only inbox-scoped attachment metadata plus the encrypted XMTP descriptor; they never fetch remote bytes. Replayed descriptors can repair older metadata-only rows.
- Remote loads refresh XMTP preferences inside the bounded download slot, recheck active-inbox consent, require a visible bubble for trusted-host auto-load or an explicit hostname-labelled action for unknown hosts, and enforce HTTPS/privacy fetch settings, no redirects, timeout/concurrency controls, actual streamed byte bounds, digest/decryption, static JPEG/PNG/WebP signatures, and dimension limits. Attachment Accept/Unblock plus conversation Block/Unblock now publish protocol consent; group attachment consent never changes an individual member's local block.
- Plaintext remote bytes use a 100 MiB per-inbox LRU cache whose reservation/eviction/write is atomic and preserves the encrypted descriptor. Cache completion/failure cannot resurrect a deleted or blocked row; conversation/message expiry and deletion cascade through attachment metadata, payloads, and descriptors. The v10 migration drops unvalidated legacy remote bytes.
- Attachment blobs render only as image sources, never navigation links. `FEATURES.md` records the guarantees and limitations, including host network-metadata exposure, DNS/browser boundaries, image decoder risk, and unencrypted local storage.


## Latest Changes (2026-07-10)

### Group And RemoteAttachment Interoperability
- Bumped Converge from `0.5.3` to `0.5.4` after live Convos testing exposed group-shape, cross-installation update, participant-discovery, and image-send failures.
- Treat SDK conversation type as authoritative. Unknown inbound groups are classified before sender-based DM guards, normal sync repairs older DM-shaped rows, and one shared hydrator persists complete metadata, membership, admins, permissions, and explicit metadata clears.
- Do not discard a streamed event merely because `senderInboxId` matches the active inbox. Another Convos/Converge installation can author that event; process it and deduplicate by authoritative message ID.
- Keep XMTP group transport separate from presentation. Generic single-peer Convos groups can look like direct chats, while real groups never reuse peer display fields and visibly expose Group Info plus the participant roster.
- Convos supports the standard XMTP `RemoteAttachment` type. Converge now verifies the uploaded HTTPS ciphertext by retrieving and decrypting it before publish, and propagates upload/publish failures so the UI marks them failed instead of leaving deceptive local pending images.

### Choice-First Onboarding And Native Wallet Stack
- Bumped Converge from `0.5.1` to `0.5.2` for the onboarding entry and wallet-stack cleanup.
- Onboarding now always starts on the inbox choice screen and never creates an inbox or opens wallet approval automatically. Interrupted device joins appear as an explicit resume action that reuses the pending key and installation.
- Native Wagmi/Reown is the only wallet connection stack. Privy and Thirdweb wallet-provider UI are removed; encrypted attachment payloads use only Thirdweb's direct storage HTTP contract.

### XMTP Pending-Installation Repair
- Bumped Converge from `0.5.2` to `0.5.3` for stale pending-installation recovery.
- Wallet-approved joins use `manager.preferences.fetchInboxState()` for the current manager installation's network membership proof. A separate static reader remains an independent convergence check, not the sole authority for deciding whether the manager may sign the next update.
- After a fresh registration, if `unsafe_addAccount` returns the exact transient `Missing existing member` rejection while state readers converge, Converge refetches manager state and retries only that rejected association within a bounded window. The XMTP server remains the authorization gate.
- A pending inbox-default XMTP database that is locally ready but still network-absent after bounded registration polling is automatically replaced once. The repair preserves the staged local account key, removes only the unusable pending database/installation marker, refetches the target inbox, and rechecks the 10/10 limit before creating the replacement installation.
- Network-visible installations, legacy/custom database paths, and repeated failures are never auto-replaced. At 10/10 the replacement stops before client creation and returns to the existing safe recovery flow.

### XMTP Existing-Member Publication Gate
- Bumped Converge from `0.5.0` to `0.5.1` after a real deanpierce.eth device join reached `unsafe_addAccount` and XMTP rejected `PublishIdentityUpdate` with `Missing existing member`.
- Root cause: libxmtp pre-signs add-account requests with the manager installation key as the existing inbox member. Converge detected that the installation was absent from the published inbox state but deliberately continued based only on local `manager.isRegistered()`, so XMTP could not authorize that existing-member signature.
- Device joins now poll for the exact manager `installationId` in the target inbox state before account association. If it remains absent, setup preserves the pending key/installation, makes no add-account request, and asks the user to retry the same setup.
- The connected wallet must also still appear as a current account identifier or the inbox recovery identifier before Converge opens the manager client.
- The generic account-association helper applies the same installation-membership preflight, and normalized installation comparison no longer treats two missing IDs as equal.
- Tests now cover delayed installation visibility, permanent non-visibility, interrupted registration followed by visibility, locally ready but remotely absent installations, and a wallet that resolves historically but is no longer a current authority.
- Browser SDK stable `7.0.0` retains the same add-account authorization sequence and does not itself fix this race. XMTP merged a later `waitForRegistrationVisible` option, but Converge must keep its app-level published-membership gate until it upgrades to a release that actually exposes and verifies that behavior.
- The first 0.5.1 Pages run exposed two test-only `Array.prototype.at()` calls that local dependency state allowed but the clean ES2020 CI typecheck rejected. Tests now use target-compatible indexing, and release verification includes a fresh `/tmp` install plus typecheck when local and CI results diverge.

### Implemented Multi-Inbox Product Contract
- Bumped Converge from `0.4.5` to `0.5.0` for the complete multi-inbox lifecycle, honest local-key security model, app-level notification state, and inbox-scoped contact behavior.
- Historical `0.5.0` behavior created the first local-key inbox automatically. Version `0.5.2` supersedes that entry with choice-first onboarding; burning the final inbox uses the same choice screen.
- The top-left control is an Inbox Switcher with one profile-name/avatar row per inbox. It closes the active client before switching and offers Create new inbox, Import keyfile, and Add this device to existing inbox. Duplicate imports stop before mutation with "This inbox is already loaded".
- Burn Inbox moved to the selected inbox's Settings, closes the client and uses static revocation for the exact current installation, then performs the complete local namespace/key/OPFS/cache wipe even when remote revocation fails. A blocked local wipe preserves the key and registry for retry. Key export is Advanced-only, and wallet association requires acknowledging its public, effectively permanent identity link.
- Contacts remain isolated per inbox, are created through explicit participation, use peer-published profiles, and discard legacy private aliases/notes. No custom contact-sync protocol was added.
- Notifications now use one browser subscription plus cached per-inbox/installation relay records. Inactive pushes create approximate switcher dots and locally named generic notifications without syncing. Clicking focuses/opens Converge without automatically switching inboxes. This historical 0.5.0 implementation did not yet include the canonical group/welcome-topic hardening documented in the 2026-07-12 entry; live relay delivery remains experimental.
- Reload and manual reconnect pin the persisted installation ID; a different local installation is rejected instead of being accepted and written over the saved identity. The Vite E2E flag now uses a statically replaceable expression, and the multi-inbox smoke covers desktop and mobile viewports without touching production XMTP.
- Explicit wallet choices now fail closed when their connector is unavailable instead of opening a different wallet. Mobile continuation can advance from an account-bound signer before chain state arrives; failed bytecode inspection offers an explicit regular-wallet/smart-account choice, with a real chain ID required for smart accounts.
- Cryptographic key/signature inputs and installation IDs canonicalize missing, uppercase, and repeated `0x` prefixes before parsing. SCW signer creation never defaults an unknown chain to mainnet, and disconnect waits for in-flight stream handling before closing the XMTP worker/database.
- The 2026-07-10 release gate passed typecheck, zero-warning ESLint, 73 Vitest files (376 tests), and the production build. Live two-browser XMTP history transfer and vapid.party delivery remain explicit follow-up validation work.
- Rechecked Convos profile compatibility through upstream `convos-ios origin/dev@47ddd6e7`; the commits after the prior `590d2689` baseline did not change the profile wire schema or precedence model.

### XMTP Device-Join Registration and Stream Lifecycle Repair
- Bumped Converge from `0.4.4` to `0.4.5` after a real Settings device-join attempt stopped during `registering-installation` even though XMTP had accepted the installation.
- Browser SDK 6.1.2 can return from `register()` before a separate static `Client.fetchInboxStates()` reader observes the new installation. Version 0.4.5 incorrectly made that lag nonfatal based only on local `isRegistered()` state; version 0.5.1 supersedes that policy because the next add-account update requires the published installation as its existing-member signer.
- Wallet-approved device joins require local readiness and bounded polling for the exact installation in published inbox state. The 10/10 capacity preflight remains strict, and the fresh local account key must still converge through the manager resolver, independent resolver, and target inbox identity state before setup completes.
- Interrupted joins reuse the persisted installation and local database without calling `register()` again when the manager is already locally registered. A returned registration that leaves `isRegistered()` false still fails closed.
- The pinned SDK predates the April 2026 `waitForRegistrationVisible` quorum option, and published stable 7.0.0 does not contain it either; do not pass that option until upgrading to a release that actually exposes it.
- `streamAllMessages()` returns an `AsyncStreamProxy`, whose cancellation API is asynchronous `end()`/`return()`. Disconnect now awaits `end()` once before closing the XMTP client instead of calling the nonexistent `close()` method.
- Regression coverage includes delayed and permanently stale published state after local registration, interrupted registration, reload/resume without duplicate registration, local registration failure, 10/10 blocking, and stream cleanup ordering/failure behavior.

### Convos Profile and Agent-Name Interoperability
- Bumped Converge from `0.4.2` to `0.4.3` after auditing the current local `convos-ios` profile repository, codecs, merge rules, group-ready lifecycle, and invite-acceptance flow.
- Important model: names are not XMTP identity/inbox properties. Convos recognizes names through silent group `profile_update` and `profile_snapshot` protobuf messages; compressed `group.appData` is a lower-authority compatibility fallback. Since the July 6 unified-profile rewrite, current Convos iOS stores canonical name, member kind, and general received metadata by inbox while keeping encrypted avatars per conversation.
- Profile precedence is `profile_update > profile_snapshot > appData > contact`; same-source updates use XMTP `sentAt`, and blank names do not clear known names. Converge now persists this provenance with group members so history replay cannot regress names.
- Local names such as "Orange Orca" publish when a group becomes active, before sends, and after profile saves. New groups and every successful member addition/invite acceptance send a current-roster snapshot for MLS post-join visibility.
- Typed join-request profiles are retained locally through approval and included in the post-add snapshot instead of being discarded. Inbound snapshots refresh the authoritative XMTP roster before filtering so member-add event ordering cannot drop the new name.
- Agent `memberKind=1` and typed metadata maps now encode/decode and survive inbound state plus outbound snapshots. Message labels, typing, mentions, member settings, and single-peer group titles prefer the resolved Convos profile name over placeholder contacts.
- Profile publication reads legacy appData as a fallback but does not rewrite the shared blob because the SDK has no compare-and-swap and a profile write could clobber concurrent group metadata. Invite-tag edits remain a separate explicit operation.
- Snapshot publication requires a successful group sync and authoritative roster read; it aborts instead of relaying stale or phantom members. Tests cover these failures along with precedence/recency, empty metadata semantics, typed agent metadata, concurrent/reload publication deduplication, cached-roster races, and post-join snapshots.

### Current Convos Unified-Profile Source Audit
- Bumped Converge from `0.4.3` to `0.4.4` after checking the profile specification and implementation against the latest upstream source rather than the stale ADR.
- Revalidated the profile contract against `convos-ios origin/dev@47ddd6e7` rather than the partially stale upstream ADR 005. The relevant profile changes remain `0dc31f48` (2026-07-06, unified profiles) and `b4e62896` (2026-07-08, scoped grant/timezone metadata); later commits through the current head did not change the wire model.
- `CONVOS_PROFILE_SPEC.md` now separates the unchanged wire schema from Convos' current local storage: global `DBProfile` identity by inbox, global local `DBMyProfile`, per-conversation encrypted `DBProfileAvatar`, and per-conversation outgoing `connections`/`timezone` overlays.
- Current Convos publication is lazy per conversation, durably retried, stamped only after delivery, and still best-effort mirrored into appData. Converge intentionally does not mirror profile writes into appData because the Browser SDK lacks Convos' atomic metadata helper.
- Current Convos snapshot triggers also include verified already-member invite replays and a post-device-pair broadcast to all allowed groups. Converge does not yet implement that post-pair profile fan-out or Convos' durable profile retry queue.
- Agent kind `1` is an unverified declaration. Convos verifies `attestation`, `attestation_ts`, and `attestation_kid` against a trusted keyset and prevents verified kinds from being downgraded; Converge does not yet implement this trust step.
- Two upstream transitional risks were recorded in the spec instead of copied: direct-add/invite seeding still targets legacy `DBMemberProfile`, and received conversation-scoped metadata still lands in global `DBProfile.metadata`.
- Corrected `CONVERGE_PROFILE_SPEC.md` and `docs/contacts.md`: groups are message-primary with appData fallback, while `converge.cv/profile:1.0` is the structured legacy-DM/self-DM channel; `cv:profile:` is accepted only as legacy cleanup input.
- Fixed two implementation drifts found during the source audit: appData decoding now accepts both raw-DEFLATE (iOS) and zlib-wrapped bodies, and a fieldless `ProfileUpdate` now reaches the scoped `connections`/`timezone` clear merge instead of being discarded.

## Latest Changes (2026-07-09)

### XMTP Registration Lifecycle Repair
- Bumped Converge from `0.4.1` to `0.4.2` after real browser testing found that Create New Converge Inbox always stopped at `Association error: Missing identity update`.
- Root cause: `Client.create({ disableAutoRegister: true })` returns a prospective deterministic `inboxId` before registration, but Converge queried `preferences.fetchInboxState()` as if that proved a network identity update existed. The unit suite covered policy booleans but did not model a real fresh Browser SDK client, and onboarding discarded the underlying error.
- Replaced the state guess with one tested lifecycle: resolve the signer, inspect `client.isRegistered()`, persist the prospective installation, call `register()` no more than once when the explicit policy permits it, and require the signer plus normalized installation ID in live inbox state. Missing policy now defaults to `resume-only`; the contradictory `register` boolean was removed.
- Identity registration success is no longer coupled to optional conversation sync or stream startup. Onboarding surfaces bounded actionable XMTP errors instead of the generic identity-creation message.
- Malformed unrelated identity rows no longer brick onboarding, identity-storage failures stop before opening a different XMTP database, interrupted account association waits for the independent resolver, and exact pending keyfile installations can resume at 10/10.
- Native wallet callbacks preserve real continuation errors. Native, Privy, and Thirdweb completion paths now carry the returned account-bound signer directly into onboarding/Settings instead of reading stale hook state after a mobile wallet return.
- New-inbox retries resume only a validated pending key with both inbox and installation IDs; incomplete pre-registration rows cannot trap every future Create New attempt. Inbox Switcher uses the same bounded actionable error formatter as onboarding.
- Interrupted-installation recovery is exact-match-only: if the saved stale ID has disappeared, Converge must not fall back to revoking the oldest device. Keep stale recovery state until fresh ledger reads confirm removal.
- XMTP profile fallbacks that echo an address or inbox ID no longer overwrite generated Color Animal names.
- Production drift was part of the verification failure: the Pages workflow used pnpm 8 against a pnpm 10 lockfile, ignored it, and resolved the caret SDK range to 6.5.0. The SDK is now pinned to 6.1.2; CI takes pnpm 10.5.2 from the single `packageManager` declaration, uses `--frozen-lockfile`, and runs Vitest before build. Do not also set the action's `version`, because pnpm/action-setup v4 rejects duplicate declarations.
- Vite dev dependency optimization now excludes the Browser SDK so its module worker URL remains intact during local browser verification. Public metadata was corrected from the stale v5.0.1 claim.
- Build-info generation invokes Git without a shell and accepts successful stdout from restricted runners that report a spurious child-process `EPERM`, preventing valid local metadata from being overwritten with `unknown`.

### XMTP Wallet and Onboarding Hardening
- Bumped Converge from `0.4.0` to `0.4.1` after auditing the shipped provisioning flow against the pinned `@xmtp/browser-sdk` 6.1.2 implementation.
- Added one strict Ethereum-address boundary used by XMTP signers, identity storage, contacts, member profiles, and UI formatting. Repairable missing/uppercase/repeated prefixes migrate to one lowercase `0x`; malformed values stop before XMTP.
- Removed Converge's pre-connector mobile Coinbase/Base redirect. The selected connector owns the wallet request and return lifecycle, callbacks dedupe, and signatures verify the active account. Version `0.5.2` standardizes this on native Wagmi/Reown.
- EIP-7702 delegated EOAs are no longer misclassified as smart-contract wallets. If bytecode inspection fails on every relevant chain, provisioning stops automatic inference and requires an explicit regular-wallet or smart-account choice instead of guessing; smart accounts also require the connector's real chain ID.
- Existing-inbox setup now shows explicit connection and approval steps plus phase status. It persists the manager installation before mutation, verifies registration and association in live inbox state, tolerates interrupted responses that already reached the ledger, and reopens only the exact approved installation under `resume-only` policy.
- A remote pending installation whose local inbox database now opens a different ID is marked stale. Retry is blocked until the recovery identity explicitly removes that exact stale ID, including below the installation limit, so setup does not strand an extra slot or revoke an older device unnecessarily.
- At 10/10, a previously registered pending installation may resume without creating another. Static recovery is limited to the inbox recovery identity and revokes only enough confirmed installations to return to 9/10.

### XMTP Device Provisioning and Honest Key Model
- Bumped Converge from `0.3.9` to `0.4.0` after separating XMTP account identities, inboxes, and installations in onboarding and reconnect behavior.
- In version `0.4.0`, empty browsers stopped auto-registering a generated standalone inbox. Version `0.5.0` briefly restored automatic first-visit creation; version `0.5.2` supersedes both with one consistent choice-first entry.
- Wallet-approved joins statically resolve the target and fresh identifiers, enforce the 10-installation limit before mutation, register/reuse one inbox-aware browser database, add only a proven-unassociated key, then reconnect and verify the target `inboxId` and exact `installationId`.
- Pending keys are stored before ledger mutation and resumed after interruption. Failed Settings/switcher provisioning restores the previous active identity and namespace instead of leaving an authenticated half-transition.
- Wallet and keyfile 10/10 recovery refetch current inbox state immediately before the recovery signature and stop without revocation if capacity is already available.
- Cross-inbox reassignment is refused rather than silently using `unsafe_addAccount(..., true)`; a future destructive flow must explicitly warn that the old inbox is stranded.
- New installations explicitly request device-history sync and surface that an older installation may need to be online. Matching an inbox ID is not presented as proof that history has arrived.
- `Client.create` now includes `appVersion`, always disables auto-registration, and uses full signer fingerprints. Legacy address-based XMTP databases remain pinned while new identities use the SDK inbox-aware default.
- Settings now verifies the live installation against inbox state before enabling revocation. Conversation ordering and legacy-DM deduplication regressions are covered by tests.
- README, architecture, feature, and Settings copy now state that private keys, mnemonics, decrypted messages, attachment caches, and the local XMTP database are not encrypted at rest by Converge. Incomplete passphrase/passkey/lock paths are hidden.

### Generated-Key Animal Onboarding
- Bumped Converge from `0.3.8` to `0.3.9` after restoring the friendly Color Animal display-name path for generated local app keys.
- `generateLocalAppIdentity()` now assigns the deterministic Color Animal suggestion immediately instead of `App key 0x...`, so startup-created ephemeral/local app keys keep the same low-friction onboarding identity style.
- Added shared `src/lib/identity/profile-suggestions.ts` so Settings, the personalization reminder, inbox switching, Farcaster self-profile fill, and local app-key generation use one display-name suggestion and auto-label detection rule.
- Legacy labels like `App key 0x1234...abcd` are now treated as generated placeholders alongside `Identity ...`, `Wallet ...`, and raw `0x...` labels, allowing profile prompts and hydration to replace them.

### Neynar Cooldown and Farcaster Fallback Gating
- Bumped Converge from `0.3.7` to `0.3.8` after live browser logs showed repeated Neynar CORS/network failures during automatic self-profile refresh.
- Browser Neynar calls now open a temporary cooldown after CORS/network failures, auth failures, rate limits, or server errors; requests during cooldown are skipped instead of repeatedly hitting the API.
- Neynar verification 404s are cached per address for 24 hours, so app-generated local wallet addresses that have no Farcaster account are not queried repeatedly.
- The static PWA no longer calls Neynar's legacy fallback host after a v2 404, because the fallback host does not reliably provide browser CORS headers and caused repeated preflight failures.
- `Layout` self-profile Farcaster refresh now honors its hourly cooldown even when display name/avatar/FID are missing.
- `resolveFidFromAddress` now skips ENS and Farcaster API fallback work unless `VITE_FARCASTER_API_BASE` is configured; without that backend, ENS lookup cannot complete the FID resolution path and only adds browser RPC/CORS noise.

### XMTP Address Resolver and Local Chat Fallback Fix
- Bumped Converge from `0.3.6` to `0.3.7` after live logs showed sends going to `local-conversation-*` with peer IDs like `0x7ab...` and then failing because the SDK could not find that fake conversation after sync.
- Root cause: Converge's address resolver stripped `0x` before calling XMTP identifier lookup APIs, while current `@xmtp/browser-sdk` signers identify Ethereum accounts with `0x`-prefixed lowercase addresses. Known wallet inboxes could therefore resolve as `null`.
- Fixed all local XMTP Ethereum identifier construction paths to preserve the `0x` prefix.
- Connected XMTP conversation creation now throws on network creation failure instead of returning a local-only placeholder conversation that cannot send.
- Existing local-only `local-conversation-*` threads now refuse sends before creating pending messages and show a toast telling the user to start a fresh network chat with that address.

### Existing Inbox Reassignment Diagnostics
- Bumped Converge from `0.3.5` to `0.3.6` after investigating `Account already associated with inbox ...` during Settings → Connect Existing Inbox.
- Added verbose browser/debug-console logs at the Settings, auth, and XMTP client layers so future debugging can distinguish:
  - the connected wallet / target inbox owner,
  - the generated local app key being added,
  - the local app key's current XMTP inbox before reassignment,
  - the temporary manager client's inbox,
  - and the exact SDK preflight state before `unsafe_addAccount(..., true)`.
- Do not log private keys. Full addresses and inbox IDs are intentionally logged in this diagnostic path because they are needed to verify whether the SDK error refers to the target wallet inbox or the local app-key inbox.

### Legacy SCW Chain-Zero Recovery Blocker
- Bumped Converge from `0.3.4` to `0.3.5` after real recovery attempts showed `Wrong chain id. Initially added with 0 but now signing from 8453` followed by `Signature validation failed`.
- Important learning: retrying an XMTP smart-wallet identity update with SCW chain ID `0` is not useful in browser-wallet recovery. The second signature is over the same challenge and XMTP cannot validate the chain-zero smart-wallet signature from the browser wallet.
- Converge now stops after XMTP reports the legacy chain-zero mismatch, avoids asking for the second doomed signature, hides the stale recovery retry panel, and tells the user to use an already-connected Convos/XMTP device to revoke devices or pair/export the inbox.
- Nonzero SCW chain mismatches still retry with the XMTP-registered chain ID from the error.

### SCW Chain-ID Retry For Existing Inbox Recovery
- Bumped Converge from `0.3.3` to `0.3.4` after fixing XMTP smart-wallet recovery errors like `Wrong chain id. Initially added with 0 but now signing from 8453`.
- Added parsing for XMTP wrong-chain-id errors and retry recovery/reassignment with the SCW chain ID XMTP says was originally registered. Later follow-up in `0.3.5` excludes legacy chain ID `0` because browser-wallet signatures cannot validate that path.
- This matters for legacy Convos/Base smart-wallet inboxes where the address has Base bytecode but XMTP identity updates expect chain ID `0`.
- The retry is used for both Settings → Connect Existing Inbox → "Revoke Oldest Installation" and the subsequent "Use Connected Wallet" reassignment attempt only for nonzero registered chain IDs.

### Static Existing Inbox Installation Recovery
- Bumped Converge from `0.3.2` to `0.3.3` after hardening the Settings → Connect Existing Inbox 10/10 recovery flow.
- The connect modal now extracts the blocked InboxID from XMTP's raw installation-limit error, displays that InboxID and step-by-step recovery status, and logs recovery start/completion to the console.
- The recovery action now fetches the target inbox state with SDK static helpers and calls `Client.revokeInstallations(...)` with the wallet signer, instead of creating another temporary XMTP manager client just to revoke an installation.
- Added `src/lib/xmtp/installation-recovery.ts` plus regression coverage for InboxID extraction and oldest-installation selection.

### Recurse.bot Operating Practice Adoption
- Checked https://recurse.bot and adapted its useful repository-etiquette suggestions to Converge.
- Kept `AGENTS.md` canonical and added `CLAUDE.md` / `GEMINI.md` symlinks back to it for harness compatibility.
- Added root `MEMORY.md` plus `memory/notes/`, `memory/people/`, and `memory/logs/` so durable context can be searched without bloating this file.
- Added root `SKILLS.md` plus focused repo-local skills for curation, memory search, release checklist, collaborator notes, and future recurse.bot advice checks.
- Removed obsolete root Markdown plans/summaries that were superseded by `ARCHITECTURE.md`, `FEATURES.md`, `AGENTS.md`, and `docs/`.
- Future operating-practice reviews should adopt only changes that fit Converge; do not copy external guidance wholesale over existing project conventions.

### Existing Inbox Installation Recovery
- Bumped Converge from `0.3.1` to `0.3.2` after adding a recovery action for wallet inboxes that hit XMTP's 10/10 installation limit.
- Settings → Connect Existing Inbox now detects installation-limit errors and offers "Revoke Oldest Installation" directly in the modal.
- The original recovery action signed with the target WalletConnect/Browser Wallet account and used a temporary XMTP manager client with `disableAutoRegister: true`; version `0.3.3` replaced this with the static revoke path above.
- This intentionally frees one slot rather than deleting most installations. Warn users that the oldest installation may still be an active device because creation time is not activity time.

### Existing Inbox Connector Narrowing
- Bumped Converge from `0.3.0` to `0.3.1` after narrowing the Settings → Connect Existing Inbox wallet choices.
- Historical `0.3.1` behavior isolated this modal from the then-selectable Thirdweb and Privy providers. Version `0.5.2` removes those wallet providers and uses the native Wagmi context app-wide.
- That modal filters wallet choices to only WalletConnect and Browser Wallet (`injected`) so users approve XMTP reassignment from external wallets such as Rainbow or MetaMask.
- Thirdweb now remains only as attachment storage; it is not a wallet provider.

### Local App Key Startup + Existing Inbox Connection
- **Historical only:** this `0.3.0` behavior was replaced by the explicit `0.4.0` provisioning model above. Do not restore it.
- Bumped Converge from `0.2.0` to `0.3.0` for the identity startup/reassignment behavior change.
- Startup now auto-generates an exportable local app key when no identity exists, stores it in IndexedDB, registers it with XMTP, and opens the app without passphrases or wallet prompts.
- Wallet providers are no longer the default persistent identity path. Settings → Connect Existing Inbox uses the wallet only to approve moving the local app key into an already-existing wallet-owned XMTP inbox.
- The wallet connection flow probes the wallet inbox, blocks at XMTP's 10-installation limit, then calls the browser SDK's `unsafe_addAccount(..., true)` through a temporary manager client to reassign the local app key to the target inbox.
- After reassignment, Converge persists the local app key with the destination `inboxId`, switches the storage namespace, removes the generated inbox from the visible registry, reconnects using the local key, and syncs history from the existing inbox.
- The generated inbox is intentionally abandoned after reassignment. This pass removes it from the visible registry but does not aggressively delete every old namespace/OPFS artifact.
- At the time, `FEATURES.md` and root `ARCHITECTURE.md` documented this as current. The approved 2026-07-10 contract now supersedes the startup and reassignment-product assumptions while retaining wallet-optional messaging.

### App Version Bump
- Bumped Converge from `0.1.0` to `0.2.0` after the Convos XMTP interop feature work.
- Updated app version surfaces:
  - `package.json`,
  - `src/build-info.json`,
  - Settings About version display.
- `scripts/generate-build-info.mjs` now reads the version from `package.json` instead of carrying a duplicate hardcoded app version.
- Settings About now reads the generated build-info version instead of carrying a duplicate hardcoded app version.
- Settings About protocol copy now reports `@xmtp/browser-sdk` v6.1.2 instead of stale v5.0.1 copy.

### Convos XMTP Interop Refresh
- Inspected `/home/pierce/src/convos-ios` messaging, appData, profile, typing, and invite flows.
- New user-created one-to-one chats now create Convos-style single-peer XMTP MLS groups instead of fresh DMs, while existing DMs remain readable and sendable.
- Added Convos custom XMTP codecs for:
  - `convos.org/profile_update:1.0`
  - `convos.org/profile_snapshot:1.0`
  - `convos.org/typing_indicator:1.0`
  - `convos.org/join_request:1.0`
- Convos profile update/snapshot and typing/thinking messages are consumed silently; profile names hydrate contacts/member display, typing emits transient UI state, and side channels are not persisted as visible chat bubbles.
- Group sends, replies, and attachments now publish a silent Convos `profile_update`; current profile publication no longer mutates the shared appData blob.
- Invite claiming now sends a Convos `join_request` custom content message with invite-slug fallback instead of raw invite slug text; incoming join requests and legacy raw invite slugs both feed the existing approval UI.
- Limitation: no live Converge-to-Convos delivery test was run in this pass; local codec/appData tests cover the protocol assumptions.

### vapid.party XMTP-Aware Push Registration
- Created root `ARCHITECTURE.md` as the canonical architecture/decision tracker and linked `docs/architecture.md` to it.
- Documented the vapid.party XMTP Web Push contract:
  - `GET /xmtp/vapid-public-key` for the public VAPID key,
  - `POST /xmtp/subscriptions` for idempotent Web Push + XMTP topic/HMAC registration,
  - `DELETE /xmtp/subscriptions` for best-effort unsubscribe,
  - minimal generic push payload shape and privacy/non-goals.
- Removed client-side vapid.party API-key usage from the Converge push path. Converge now only uses public `VITE_VAPID_PARTY_API_BASE` and optional `VITE_VAPID_PUBLIC_KEY`.
- `Enable notifications` now registers/reuses `/sw.js`, requests notification permission, creates/reuses a browser `PushSubscription`, gathers the current XMTP `inboxId` and `installationId`, normalizes SDK-exposed `conversations.hmacKeys()` topic keys, and posts a versioned XMTP registration payload directly to vapid.party.
- `public/sw.js` now treats push payloads as metadata only, shows generic "New encrypted message" fallback copy, preserves same-origin click URLs, and focuses/opens Converge for local XMTP sync/decryption.
- The stale `src/lib/sw-bridge` push helper is now a compatibility shim over `@/lib/push` instead of carrying a placeholder VAPID key.
- Debug push tooling no longer attempts client-side `/send`; real push tests must be initiated by the relay/backend side.
- Historical limitation: no live end-to-end push delivery was claimed in this 2026-07-09 pass, when public vapid.party source still documented only generic API-key endpoints. See the 2026-07-12 entry for the current contract and remaining listener requirement.

## Latest Changes (2026-07-07)

### Convos Popup v2 Invite Claim Parsing
- Invite claim parsing now accepts current `https://popup.convos.org/v2?i=...` links whose signed payload stores the encrypted conversation token as raw bytes instead of a UTF-8 base64url string.
- Added regression coverage for extracting and parsing the current popup v2 link format, including creator inbox and invite tag extraction.

## Latest Changes (2026-03-05)

### Self-DM Read Receipt Spam Guard
- Fixed a cross-client interop issue where Converge self-chat sessions could produce repeated `{}` entries in xmtp.chat.
- Root cause:
  - Converge emitted DM read-receipt payloads for self DMs.
  - Read-receipt throttling used the last acknowledged message timestamp as a send-time limiter, which could allow rapid duplicate emits when ack timestamps were old.
- Changes shipped (`src/features/messages/useMessages.ts`):
  - Added identity normalization for address/inbox comparisons (including inbox IDs with/without `0x` prefix).
  - Skipped read-receipt sends for self DMs entirely.
  - Split receipt state into `{ ackedAt, sentAt }` so dedupe and rate-limit checks are independent.
  - Kept backward compatibility for existing in-memory numeric receipt entries.
- Added regression tests (`src/features/messages/useMessages.test.tsx`):
  - `does not send read receipts for self DMs`
  - `throttles repeated read receipts even when latest message timestamps are old`
- Validation:
  - `pnpm test --run src/features/messages/useMessages.test.tsx` passes.

### Incoming Conversation Discovery Reliability
- Fixed a regression where existing chats continued receiving live messages, but brand-new inbound DMs could fail to appear until manual reload/resync.
- Root cause:
  - `syncConversations(...)` persisted newly discovered DMs/groups to IndexedDB but did not refresh `useConversationStore`, so UI state could miss network-discovered conversations.
  - No periodic post-connect discovery pass existed, so if message stream delivery missed first-contact discovery, new chats could remain invisible.
- Changes shipped (`src/lib/xmtp/client.ts`):
  - Added a throttled background discovery loop (60s, visibility-aware, single-flight) that runs `syncConversations({ soft: true, minIntervalMs: 45s, reason: 'background-discovery' })` and invite scanning while connected.
  - Added `refreshConversationStoreFromStorage(...)` and now call it at the end of `syncConversations(...)` so any newly persisted conversations are reflected in UI state immediately.
  - Background discovery loop now starts after successful connect/stream startup and is always stopped during disconnect and connect-error paths.

### Chat List Duplicate Collapse During Message Load
- Fixed an intermittent duplicate-row issue in Chats while XMTP history replay was dispatching many `xmtp:message` events.
- Root cause:
  - `conversation-store` `addConversation(...)` prepended blindly, so concurrent inserts could duplicate entries in memory.
  - Layout-level DM dedupe sometimes keyed off the current message sender instead of the conversation peer; during self-authored history messages this prevented peer-level collapse.
- Changes shipped:
  - `src/lib/stores/conversation-store.ts` now dedupes conversation state on `setConversations`, `addConversation`, and `updateConversation`:
    - dedupe by conversation ID,
    - dedupe DMs by canonical peer key,
    - prefer non-local conversation IDs and newer `lastMessageAt`.
  - `src/app/Layout.tsx` peer-level dedupe now uses `conversation.peerId` first (instead of sender-derived key), so history replays of self messages still collapse duplicate DMs correctly.
  - `src/features/conversations/useConversations.ts` DM precheck now treats both the resolved inbox ID and the original normalized address as existing-peer candidates before creating a new conversation.
  - Added regression coverage in `src/lib/stores/conversation-store.test.ts` for duplicate-by-ID and duplicate-by-peer collapse behavior.
- Validation:
  - CI-equivalent checks pass: `pnpm typecheck && pnpm lint && pnpm test --run && pnpm build`.

## Latest Changes (2026-02-25)

### XMTP Identity Lookup Pressure Reduction (Web App)
- Added `resolveInboxIdForAddress(...)` to `src/lib/xmtp/client.ts` with:
  - address→inbox TTL cache (15m hit, 60s negative),
  - in-flight dedupe via `KeyedAsyncCache`,
  - identity-cooldown skip handling,
  - bounded fallback (`fetchInboxIdByIdentifier` first, `getInboxIdForIdentifier` fallback).
- Added `canMessageWithInbox(...)` returning `{ canMessage, inboxId }`, and updated legacy `canMessage(...)`, `getInboxIdFromAddress(...)`, and `deriveInboxIdFromAddress(...)` to delegate to the shared resolver pipeline.
- Simplified `createConversation(...)` address handling to a single resolver lookup before `createDm`, with `createDmWithIdentifier` as fallback only when unresolved.
- Updated high-frequency UI/store call paths to avoid chained lookups:
  - `src/features/messages/useMessages.ts` send preflight now performs one inbox resolve attempt.
  - `src/features/conversations/useConversations.ts` address canonicalization and create flow use the shared resolver.
  - `src/features/contacts/ContactsPage.tsx` refresh action uses one resolver call.
  - `src/lib/stores/contact-store.ts` Farcaster sync uses `canMessageWithInbox` once per address instead of separate derive + canMessage calls.
- Added resolver instrumentation counters to cache summary logs (`resolveInboxIdForAddress hit/miss/network/cooldownSkip`) plus debug network events for lookup and cooldown skips.
- Added regression coverage:
  - `src/lib/xmtp/address-resolver.test.ts` (concurrent dedupe, negative TTL cache, cooldown short-circuit).
  - `src/features/messages/useMessages.test.tsx` (send preflight only resolves once).
  - `src/features/conversations/useConversations.test.tsx` (address cleanup uses a single resolver call).
  - `src/lib/stores/contact-store.test.ts` (Farcaster sync uses `canMessageWithInbox` and avoids extra derive lookup).

### Mobile Composer Send + Alignment
- Fixed mobile send-button tap behavior while the software keyboard is open by preventing pointer-down focus-steal on the send button; taps now send immediately instead of first collapsing the keyboard.
- Tightened composer control sizing/alignment by standardizing attachment button, textarea min-height/padding, and send button dimensions so the orange send button lines up with the input field.
- Removed `self-end` from the send button class list so it no longer anchors to the bottom edge of the composer row when the textarea is taller than 44px.
- Added `MessageComposer` regression coverage to assert send-button pointer interactions still submit trimmed text content.

## Latest Changes (2026-02-24)

### Mobile PWA Keyboard Layout Stability
- Updated viewport meta with `interactive-widget=resizes-content` so supported mobile browsers resize content areas correctly when software keyboards open.
- App root sizing now remains bounded by both VisualViewport-derived `--vh` and `100dvh`, with root overflow clipped to prevent extra keyboard-induced scroll regions.
- Bottom nav now uses a stable class (`app-bottom-nav`) and is fully removed from layout (`display: none`) while keyboard mode is active, eliminating the gap above the keyboard.
- Keyboard detection now also uses the last non-focused viewport height as a baseline plus focused-input heuristics, fixing cases where mobile PWAs keep `window.innerHeight` and `visualViewport.height` in lockstep while the keyboard is open.
- `useVisualViewport` cleanup now clears stale keyboard state (`keyboard-open` class and keyboard offset variable) on unmount.
- Added regression tests in `src/lib/utils/useVisualViewport.test.tsx` for viewport var updates, keyboard-open toggle thresholds, and cleanup behavior.

### Wallet Signing Loop Prevention
- Added signer-side single-flight dedupe for wallet signatures so concurrent identical XMTP sign requests trigger only one wallet prompt.
- Added signature reuse cache keyed by wallet/challenge with expiry-aware validity tracking and a refresh skew window (refresh only near expiration).
- Added short failure cooldown after signing errors to prevent immediate repeated wallet prompt loops.
- Added an auth restore in-flight guard in `AppRouter` so `checkExistingIdentity()` cannot run concurrently during startup.
- Added unit coverage in `src/lib/wagmi/signers.test.ts` for concurrent dedupe and expiry-based refresh behavior.

### Wallet Signature Waiting Modal
- Added a global `WalletSignatureModal` mounted in `Layout` that blocks UI while wallet signatures are pending.
- Added `runWithWalletSignatureStatus(...)` (`src/lib/wagmi/signature-status.ts`) to emit pending/resolved/rejected events around wallet sign calls.
- Wrapped every then-supported wallet `signMessage` path with this tracker. Version `0.5.2` retains the tracker on the sole native Wagmi path.
- Added tests in `src/lib/wagmi/signature-status.test.ts` for pending→resolved and pending→rejected event flows.

### Farcaster Contact Name Consistency
- Added shared `pickFarcasterDisplayName(...)` helper (`src/lib/farcaster/display-name.ts`) with precedence `display_name` → `displayName` → `username`/`fname`.
- Updated Contact Details refresh (`ContactCardModal`) to use this helper so Converge display names prefer Farcaster display names across desktop and mobile refresh flows.
- Fixed Contact Details reopen regression where a second identity-state upsert could overwrite the freshly resolved Farcaster display name with stale placeholder metadata (falling back to inboxId after closing/reopening).
- Contact refresh now stabilizes follow-up upsert metadata from the first persisted refresh result (`name` / `preferredName` / avatar) so the resolved display label remains durable.
- Updated self-profile Farcaster sync to reuse the same helper for consistent name selection rules.
- Added unit tests in `src/lib/farcaster/display-name.test.ts` to lock the selection order.

### Profile Avatar Rendering + Metadata Safety
- Relaxed image source sanitization to accept valid `data:image/*` URLs with additional metadata params (e.g., charset/name), matching Converge profile avatar payloads more reliably.
- Added `sanitizeAvatarGlyph(...)` and switched avatar renderers (Chat list, Message bubbles, Conversation header, Group settings) to only render short non-URL glyphs as text; unreadable long payloads now fall back to initials instead of dumping raw base64 strings.
- Added defensive parsing in `useMessages` so legacy/stray text profile payloads (`type: "profile"`) are consumed as metadata and excluded from visible message history/previews.
- Added image utility test coverage for richer data-URL formats and glyph sanitization.

### Desktop Chat Workspace
- Added a responsive `ChatWorkspace` route wrapper for `/` and `/chat/:id`.
- On desktop-width viewports (>= `lg`), chats now stay in a two-pane layout: `ChatList` is always visible on the left and the selected `ConversationView` renders on the right.
- On mobile viewports, existing behavior is preserved (`/` shows chat list, `/chat/:id` shows a single conversation).
- `ConversationView` now accepts `showBackButton` so the desktop pane can hide the mobile back affordance.

### Docs + Dev Setup
- Added `CONVOS_PROFILE_SPEC.md` documenting how convos-cli writes per-conversation profiles into XMTP group `appData`.
- Added `CONVERGE_PROFILE_SPEC.md` documenting Converge's DM profile metadata flow.
- Removed legacy `cv:profile:` handling in favor of the `converge.cv/profile:1.0` content type only.
- Renamed the local scratch directory from `tmp/` to `code/` and updated ignore/exclude rules and references.
- Reviewed `convos-web` `appData` usage: group `appData` stores protobuf metadata (profiles, invite tag, expiry, image encryption key, encrypted group image) with optional deflate-raw compression + base64url encoding; profile avatars are re-encrypted with the group image key before upload.

### Local-First XMTP Caching + Sync Dedupe
- `fetchInboxProfile(...)` is now local-first by default (`mode: 'local'`) and never triggers identity/profile network calls unless explicitly refreshed via `refreshInboxProfile(...)`.
- Added class-local TTL + in-flight dedupe caches around the biggest offenders:
  - `conversations.getDmByInboxId()` (10m hit, 60s negative)
  - `preferences.fetchInboxStates()` / `Client.fetchInboxStates()` (6h hit)
- Fixed “Uninitialized identity” by forcing `client.register()` when the current installation is missing (even when `register:false`), plus an on-demand `client.register()` retry path (send / inbox check) before asking the user to reconnect a wallet.
- Message streaming now uses `streamAllMessages({ disableSync: true, consentStates: [Allowed, Unknown] })` to avoid redundant implicit sync and to receive unknown-consent invite requests without periodic DM scans.
- Connect-time sync is incremental by default:
  - `enableHistorySync` defaults to `false`
  - recent backfill lookback tightened to ~30s
  - per-conversation `dm.sync()`/`group.sync()` throttled via persisted `lastSyncedAt` (5m)
- Removed background “remote profile refresh” loops; profile ingestion is event-driven (persisted on receipt of `converge.cv/profile:1.0` messages).
- Added debug-only “Run Deep History Sync” control and cache/sync instrumentation entries in the Debug Network Log.

## Latest Changes (2026-02-23)

### Convos Profiles + Group Metadata Interop
- Pulled latest `code/convos-ios` (`origin/dev`) and aligned Converge with Convos’ current profile channel: group `appData` metadata (not DM profile text blobs).
- Added Convos `appData` parser/encoder support for:
  - compressed payload format (`0x1f` marker + 4-byte BE original size + zlib data),
  - invite tag (`field 1`),
  - member profiles (`field 2`, inboxId bytes + name/image/encryptedImage),
  - expiration timestamp (`field 3`, `sfixed64` unix seconds),
  - image encryption metadata passthrough (`fields 4-5`).
- Group detail hydration now reads Convos appData and maps member profile names/avatars into `groupMembers`, so Converge can display Convos profile names in group chats.
- Invite-tag updates now prefer `group.updateAppData(...)`; legacy description-embedded metadata remains as fallback for older groups.
- Group profile appData remains readable for legacy compatibility; current Convos profile updates/snapshots are the authoritative publication path.
- Added tests in `src/lib/utils/convos-invite.test.ts` covering appData roundtrip, compressed parsing, profile upsert normalization, and Convos display-name limits.

### XMTP Identity Rate-Limit Hardening
- Tightened `Client.create` fallback logic so `connect()` only retries the fallback path for real CORS-style failures, not generic `GetInboxIds` errors.
- Added explicit identity cooldown checks before `connect()` / `probeIdentity()` client creation calls to avoid repeated identity endpoint hits during active rate-limit windows.
- On identity rate-limit failures, `connect()` now records identity cooldown immediately and surfaces a user-facing retry window message instead of repeatedly retrying.

## Latest Changes (2026-02-07)

### Messaging: Lazy History Loading
- Conversations now load the newest message window first and only prepend older history when the user scrolls upward, keeping long threads performant while preserving full IndexedDB history.

## Latest Changes (2026-02-04)

### Dependency Security: Dependabot Remediation
- Resolved Dependabot moderate advisories by bumping the `hono` override to `4.11.7` (patched), which is pulled transitively via wagmi/porto.

## Latest Changes (2026-02-03)

### Profile: Custom Content Type + Consent-Safe Sending
- Profile updates now use a silent custom content type (`converge.cv/profile:1.0`) instead of plain-text `cv:profile:` messages (legacy messages are still parsed for backward compatibility).
- Profile updates are never auto-sent in response to inbound messages; they are only sent when the user saves their profile (broadcast to **allowed** DMs) or when the user sends a DM message.
- Updated personalization copy to avoid claiming profiles are “discoverable” via XMTP.

## Latest Changes (2026-01-25)

### Group Settings: Member Validation Tool
- Added a Group Settings diagnostic that validates member identity updates and lists invalid/unknown inbox IDs for troubleshooting invite failures.

### XMTP SDK: Browser SDK 6.1.2 Upgrade
- Upgraded `@xmtp/browser-sdk` to 6.1.2 and removed `@xmtp/content-type-*` dependencies in favor of built-in content types + `send*` helpers.
- Replaced `Utils` usage with `generateInboxId`/`getInboxIdForIdentifier` and `Client.fetchInboxStates`; updated identifier-kind enum handling across onboarding, profiles, and contact cards.
- Updated conversation APIs to `createDm`/`createGroup` and `createDmWithIdentifier`/`createGroupWithIdentifiers`, plus attachment helpers (`encryptAttachment`/`decryptAttachment`) and `sendSyncRequest` for resync.

## Latest Changes (2026-01-24)

### Dependency Security: Dependabot Remediation
- Resolved pnpm audit findings by bumping react-router-dom and pinning patched transitive deps via pnpm overrides (preact, hono, lodash, undici, h3).
- `pnpm audit` now reports zero vulnerabilities.

### Messaging: History Backfill Dedupe
- Incoming history/backfill events now hydrate existing conversations from storage before creating new ones, preserving last-read state and preventing old messages from lighting up as unread.
- Duplicate history messages are skipped early, and profile fetch / profile-send checks are bypassed during backfill to cut redundant network traffic.
- Recent history sync now skips the redundant `conversations.sync` call after connect, respects per-conversation cooldowns, and narrows message windows using stored `lastMessageAt` to avoid replaying old messages.

### Convos Invites: Stub Messages
- Invite slugs now render as readable system messages in DMs (group name/tag/expiry), and follow-up system notices report acceptance or failure.

### Convos Invites: Wallet-Signed Fallback
- Invite creation now falls back to a wallet signature-derived key when no local private key exists, allowing wallet-based identities to generate and process invites.

### Convos Invites: Unknown DM Scan
- Invite requests are now detected by scanning DMs that are still in the XMTP "unknown consent" state on connect and every minute, dispatching synthetic message events so admins see the request blob.

### Convos Invites: Approval Modal
- Invite requests now trigger a modal that shows group details and requester reputation, allowing the creator to explicitly approve or decline before any wallet signature prompt is shown.

### Convos Invites: Inline Actions
- Invite request stubs in chat history now include Accept/Reject/Review actions so admins can approve directly or open the detailed modal later.

### Convos Invites: Group Resolution Diagnostics
- Invite approval now logs detailed diagnostics when a referenced group cannot be found after sync attempts (conversation ID, local deletion state, sample group IDs, and listGroups/getConversation errors) to pinpoint why approval fails.

### Convos Invites: Group ID Normalization
- Invite approvals normalize UUID-style group IDs by stripping dashes before lookups, matching XMTP’s 32-char group IDs and preventing “group not found” errors.

### Convos Invites: Onboarding Auto-Claim
- Invite deep links now survive onboarding and auto-send the invite request once the new user completes onboarding, so the link only needs to be opened once.
- Wallet connect onboarding now preserves deep-link targets even when forcing a reload, so invite links still auto-claim after the identity is created.

### Convos Invites: Smaller Payloads
- Invite creation no longer embeds group avatars in the payload to keep Convos invite links short enough for their handler.

### Convos Invites: Wallet Signer Attach
- Invite approvals now attach the active wallet signer on demand, ensuring the signature prompt appears when the creator doesn’t have a local private key.

### Convos Invites: Stable Wallet Key
- Invite key derivation now recovers the wallet public key from the signature message to avoid failures caused by non-deterministic signatures.

### Convos Invites: Key Persistence
- Wallet-derived invite keys are persisted in the local identity so invite approvals survive reloads; missing keys can be re-derived by re-signing the invite key message with the wallet.

### Convos Invites: Group Sync Retry
- Invite approvals now trigger a conversation sync before failing when the target group isn’t found locally.

### Convos Invites: Group Sync Escalation
- Invite approvals now force a full sync and listGroups fallback before failing when the target group isn’t found.

### Convos Invites: Membership Validation
- Invite creation and approval now verify that all group members have identity updates; invites are blocked when invalid members would trigger XMTPiOS “SequenceId not found in local db” sync errors.

### ENS Resolution: RPC Fallbacks
- ENS lookups now use a fallback transport with multiple public mainnet RPC endpoints (configurable via `VITE_MAINNET_RPC_URLS`) to avoid single-provider outages.

### Messaging: Group @-Mentions
- Group chat composer now offers @-mention suggestions based on current group members, inserts mentions into the message text, and renders mentions with inline styling.
- Incoming messages that mention the current user are visually highlighted to make mentions stand out.

## Latest Changes (2026-01-22)

### Messaging: Image Attachments
- Paperclip now opens an image picker, encrypts the file client-side, uploads to IPFS via Thirdweb storage, and sends a RemoteAttachment.
- Incoming RemoteAttachment messages are downloaded/decrypted, cached in IndexedDB, and rendered inline with blob previews.

### Groups: Creation + Membership Refresh
- Group creation now uses XMTP identifier-based APIs so address-based group creation produces real network groups (no local-only fallback when passing addresses).
- Membership-change messages now trigger group detail refreshes and create missing group conversation entries so newly added members see the group appear.

### Debug: XMTP Envelope Stream Dump
- Added `dump-stream.py` in the repo root to stream the global XMTP envelope feed via `message/v1/subscribe-all`.
- Supports env/base URL selection, topic filters, truncation, and optional message byte decoding for inspection.

### Debug: Convos Invite Claim
- Added a Debug menu tool to parse Convos invite links/codes and send the raw invite slug to the creator inbox.
- Invite parsing now tolerates non-base64url characters by stripping them, extracts creator inbox ID, tag, name, and image URL from the protobuf payload, and then sends the slug via XMTP DM.
- Invite claim now logs parsing and send steps to the console for easier debugging.
- Creator inbox IDs embedded as raw 32-byte values are now normalized to 64-char hex before DM creation to avoid XMTP API errors.

### Messaging: Group Send Contact Guard
- Skip auto-adding contacts when sending in group chats so group IDs aren’t treated as inbox IDs (prevents “Missing identity update” errors from profile lookups).

### XMTP Profiles: Expected Identity Errors
- When profile lookups return expected identity/association errors, stop further fallbacks to the Utils worker and return a minimal profile to avoid repeated “Missing identity update” console noise.

### Convos-Compatible Group Invites
- Group menus can generate Convos-style invite slugs, copy Convos/Converge links, and preserve invite tags in group metadata (base64 protobuf description).
- Incoming DM invite slugs are verified (secp256k1 signature + encrypted conversation token) and automatically add the sender to the group when valid.

### Farcaster Filters: Settings Only
- Removed the per-conversation Farcaster filter toggle panel from the chat view.
- Filters are now adjusted solely from Settings and still apply globally across conversations.

### XMTP Identity Rate-Limit Backoff
- Identity/profile lookups now detect resource-exhausted/rate-limit responses and apply an adaptive cooldown that pauses identity API calls to avoid hammering the network.

## Latest Changes (2026-01-05)

### Settings Native Reconnect
- Settings reconnect no longer auto-connects Coinbase for native wallets; it now shows the full native wallet list (styled like onboarding) and requires an explicit selection.

### Privy + WalletConnect Fix
- Forced WalletConnect stack to 2.22.4 via pnpm overrides to eliminate `publishCustom` missing errors during Privy/Rainbow connects.

### Privy App + Client ID
- Restored Privy app ID fallback and added a separate client ID fallback (`VITE_PRIVY_CLIENT_ID` support) so PrivyProvider gets the correct `appId` and optional `clientId`.

## Latest Changes (2026-01-05)

### Privy Reconnect Crash Fix
- Wrapped wallet provider stacks with `QueryClientProvider` so Privy’s internal `useReconnect` hooks can access a React Query client during reconnect.

## Latest Changes (2025-12-31)

### Wallet Providers: Native / Thirdweb / Privy
- Historical: added a wallet provider selector (Native, Thirdweb, Privy) used in onboarding and Settings. Version `0.5.2` removes this selector and both alternate wallet-provider stacks.
- Historical: Thirdweb used its standard Connect modal UI. Version `0.5.2` removed that wallet path, and version `0.5.6` removed the full SDK; `VITE_THIRDWEB_CLIENT_ID` now only overrides the public client ID used by the direct encrypted-attachment storage request.
- Privy app ID is now baked in as a fallback (`VITE_PRIVY_APP_ID` overrides), so the provider is always available.
- Added Solana peer deps (`@solana/kit`, `@solana/sysvars`, `@solana-program/system`) to keep Privy’s build pipeline happy.

## Latest Changes (2025-12-21)

### Sender Display: Address First
- Incoming message handling now prefers primary Ethereum addresses over raw inbox IDs when labeling new conversations.
- Conversation profile refresh treats inbox IDs as “address-like,” allowing address fallbacks to replace raw inbox IDs when no display name exists.

### Group Membership Validation
- Group member add flow now validates inbox IDs/addresses before sending updates, skipping unregistered members and toasting a warning to avoid MLS commit validation errors (`InboxValidationFailed`).

### History Sync Resilience
- Conversation and message sync now retries on transient MLS/network errors and treats partial sync failures as non-fatal, reducing missed messages after refreshes.
- Connect flow uses a soft conversation sync to avoid disconnecting when MLS sync throws.

### Gentle Sync Mode
- Default conversation sync interval increased to reduce rate limits; connect now runs a light “recent” backfill when local data exists.
- Recent backfill limits to latest conversations + message window, avoiding full inbox refreshes on every connect.

### Adaptive Sync Backoff
- Added global + per-conversation cooldowns that expand on 429s and throttle sync calls to be gentler.
- Per-conversation sync timestamps persist to storage and are used to skip redundant refreshes while keeping live streaming intact.

## Latest Changes (2025-12-20)

### Dependency Security Fixes
- Resolved GitHub/Dependabot advisories by bumping wagmi connector stack and viem, plus pnpm overrides for esbuild/glob.
- `pnpm audit` now reports zero vulnerabilities.

### CodeQL Alert Mitigation
- Added image source sanitization and use it before rendering avatars/group images to avoid unsafe data URLs (addresses CodeQL js/xss-through-dom alert in `GroupSettingsPage`).

## Latest Changes (2025-12-20)

### Clear All Data Hard Reset
- `clear_all_data` is now handled at the router level to wipe IndexedDB/OPFS/web storage/caches and reset stores before reloading, preventing “ghost” inboxes on onboarding.
- Logout now also clears identity + vault secrets and resets the storage namespace to fully remove local identity state.

### XMTP Reconnect Resilience
- XMTP connect no longer skips when a stale client exists; failed connects now null out the client so the Settings reconnect button actually retries.

### Logout Hardening + Disconnect Reset
- Logout now best-effort per step so a disconnect/storage failure doesn’t block clearing registry/auth state.
- XMTP `disconnect()` clears the connection error even when there is no client to avoid “disconnected but error set” UI limbo.

### Settings Reconnect UX
- Settings connection panel now shows reconnect controls (including wallet connector choices) in both error and disconnected states.

### Playwright: Ping-Pong Extended
- Added `tests/e2e/ping-pong-extended.spec.ts` to cover reply, reactions, and `/u/:userId` deep-link routing.

## Latest Changes (2025-12-17)

### Push + Wallet Disconnect Fix
- Fixed an intermittent “Wallet not connected” / “Provider not found” state after enabling push notifications: registering `public/sw.js` triggers a service worker `controllerchange`, and we previously forced a full page reload on that event. That reload drops the wagmi wallet connection for wallet-backed identities. The app no longer reloads on `controllerchange` (see `src/main.tsx`).

### Deep Links: Message Someone
- `/u/:userId` now acts like a “start DM” deep link (supports ENS names by resolving to an address). If the app needs onboarding, it routes through onboarding and then returns to the deep link to open the chat.
- While `checkExistingIdentity()` is running on boot, the router shows a loading screen instead of prematurely redirecting deep links to onboarding (prevents losing `/u/...` URLs for already-signed-in users).

## Latest Changes (2025-12-13)

### Contacts Schema Cleanup
- Removed runtime usage of `contacts_v3`; Dexie schema v9 now uses a single canonical `contacts` table keyed by XMTP `inboxId` (and resets contacts on detected legacy/mismatched rows).
- Fixed the “address becomes display name” issue by preventing Ethereum addresses from being treated as profile/contact names (XMTP `fetchInboxProfile` no longer falls back to `primaryAddress` for `displayName`, and contact upserts sanitize name fields).
- Updated docs (`docs/contacts.md`, `docs/storage-schema.md`) and added unit tests (`src/lib/stores/contact-store.test.ts`) to lock the behavior in.
- Contact card refresh now uses the signed-in identity’s Farcaster FID (when available) and checks all linked Ethereum addresses for Neynar verification, so “self” profiles populate Farcaster metadata even when the generated wallet isn’t verified.

### Push Notifications
- Improved subscription reliability by ensuring a service worker registration exists before awaiting `navigator.serviceWorker.ready`, and by reusing an existing `PushSubscription` when possible (covered by unit tests).
- Updated `public/sw.js` to handle payloads wrapped as `{ payload: ... }` and to focus/navigate an existing tab on notification click.
- Debug “Send Test Push” uses an absolute `payload.url` (vapid.party rejects relative URLs like `/` with a 400).

### XMTP Recovery
- Recovered from “client: identity error: Uninitialized identity” by forcing `client.register()` when `Client.create()` yields no `inboxId` and retrying after the same error during sync.
- Persisted `identity.lastSyncedAt` (IndexedDB) and used it to throttle redundant `syncConversations()` calls across reloads (manual “Check now” forces a sync).
- Hydrated the local identity’s `displayName`/`avatar` for Settings + InboxSwitcher by preferring XMTP profile history (self-DM/preferences) and falling back to Farcaster when missing; also keep the inbox registry `displayLabel` in sync so the switcher doesn’t show stale labels.

### Coinbase Wallet Telemetry
- Disabled Coinbase Wallet SDK telemetry via wagmi connector `preference.telemetry = false` to avoid `cca-lite.coinbase.com` requests (commonly blocked by content blockers).

## Latest Changes (2025-12-12)

### Docs Folder
- Added `docs/` with a documentation index and starter guides (`docs/README.md`, `docs/development.md`, `docs/architecture.md`, `docs/troubleshooting.md`).
- Added a full Dexie/IndexedDB schema reference (`docs/storage-schema.md`) and inline schema comments in `src/lib/storage/dexie-driver.ts`.

### Farcaster / Contacts
- Implemented `.fcast.id` and `.base.eth` enrichment in `src/lib/utils/ens.ts` (Neynar verification + reverse-ENS filter) with unit tests.
- Added rate limiting/backoff helpers for Neynar + ENS RPC calls (Vitest-safe no-delay).
- Updated Farcaster contact sync to bulk-fetch Neynar profiles (`fetchNeynarUsersBulk`) and persist enriched stats; added store unit tests.

### Debug
- Added a Database Explorer panel on `/debug` to inspect Dexie-backed tables (contacts, conversations, messages) with string filtering + paging.

## Latest Changes (2025-12-10)

### Neynar Default Key + FID Resolution
- Default Neynar key baked in as the Converge client key (not a demo) for Farcaster sync when no env key is provided.
- `resolveFidFromAddress` now tries Neynar’s verification lookup first, enabling FID discovery from an ETH address (e.g., the user’s XMTP identity) before ENS/REST fallbacks.
- Contacts page can auto-resolve a FID from the signed-in wallet when no FID is typed, then sync Farcaster contacts via Neynar.

### Coverage + Tests
- Vitest coverage scope focuses on core logic (`src/lib/**`, targeted UI hooks/components) with exclusions for heavy UI/XMTP/storage workers defined in `vitest.config.ts`.
- Additional unit tests cover keyfile export/import, contact/conversation/message/debug stores, push subscription permissions, Neynar helpers, and Farcaster helpers. Line coverage sits around ~58% within the included scope (see `coverage/coverage-summary.json`).

### E2E Rename
- Two-browser messaging Playwright spec renamed to `tests/e2e/ping-pong.spec.ts` (stubs XMTP when `VITE_E2E_TEST=true`).

## Latest Changes (2025-11-20)

### XMTP Client Persistence Fix (Critical)
- **Problem**: Users were hitting the "Installation limit reached (10/10)" error even on new setups.
- **Root Cause**: The XMTP client was not consistently resolving the local storage path for keys in OPFS, causing it to generate new keys (and thus a new installation ID) on every page reload.
- **Fix**: Explicitly set `dbPath` in `Client.create` options to `xmtp-production-{address}.db3`. This forces a deterministic file path based on the wallet address, ensuring existing keys are reused across sessions.

### Force Recover Fix (Critical)
- **Problem**: "Force Recover" button in Settings failed with "Installation limit reached (10/10)" error because it created a new ephemeral client (ID #11) which the network rejected even for management/revocation tasks.
- **Fix**: Updated `forceRevokeOldestInstallations` in `src/lib/xmtp/client.ts` to:
  1. Use the existing connected client if available.
  2. If creating a temporary client is necessary, create a **fresh ephemeral DB** (with a random name) and `disableAutoRegister: true`. This allows the client to start up, sign the key bundle, and act as a manager/revoker without the network interpreting it as a new installation attempt (which would fail at 10/10). Trying to reuse the existing DB path when it might correspond to an unregistered 11th installation was still causing the limit error.

### Resync All Fix
- **Problem**: "Resync All" button cleared local messages but failed to restore them from the network. After the fix to call `conv.sync()`, conversations were still not appearing.
- **Root Causes**: 
  1. The code was calling `client.conversations.syncAll()`, which does not exist in the JS SDK. This likely threw an error or did nothing, preventing the message fetch loop from running.
  2. The loop was only calling `conv.messages()` (which reads from the local SDK cache) without ensuring `conv.sync()` was called first to pull new messages from the network.
  3. **Critical**: `syncConversations()` was only persisting Groups to storage, not DMs. DMs were expected to be created via message backfill events, but if `loadConversations()` ran before those events fired, the UI would show no conversations.
- **Fix**: 
  1. Removed the invalid `syncAll()` call.
  2. Added explicit `await this.client.conversations.sync()` to update the conversation list.
  3. Added explicit `await conv.sync()` inside the loop for every conversation before fetching messages. This ensures that even if the local cache is empty/stale, the SDK forces a network fetch for that conversation's messages.
  4. **Most Important**: Modified `syncConversations()` to persist DM conversation records to storage immediately after listing them, not just groups. This ensures that when `loadConversations()` runs, it finds the conversations in storage even if message backfill hasn't completed yet.

### Build Failure Fix
- Fixed a TypeScript error in `IgnoredConversationsModal.tsx` where `formatDistanceToNow` was called with invalid arguments. Updated `src/lib/utils/date.ts` to support the `{ addSuffix: boolean }` option, matching the expected API.

## Latest Changes (2025-11-19)

### Worker Tracking & Cleanup
- `src/lib/debug/worker-tracker.ts` now exposes `terminateAll()`, `terminateByUrlSubstring(substring)`, and `pruneTerminated()` on `window.__workerTracker` to make it easy to shut down large batches of dedicated workers and keep the registry compact over time.
- A background interval runs every 60 seconds to automatically prune terminated workers from the in-memory registry so the Web Workers debug panel does not grow without bound during long-lived sessions.

### Debug UI: Web Workers Panel
- `src/features/debug/WebWorkersPanel.tsx` gained new controls:
  - `Prune Terminated` removes already-terminated workers from the list without touching live threads.
  - `Kill XMTP Workers` calls `terminateByUrlSubstring('sqlite3-worker1')` (falling back to `'xmtp'`), targeting XMTP’s SQLite-related worker instances that can accumulate during repeated connects.
  - `Kill All` calls `terminateAll()` to terminate every tracked dedicated worker for the current page in one click.
- Existing service worker listing and unregister controls are unchanged; the panel is now the primary place to inspect and aggressively clean up web workers if the browser shows many XMTP/sqlite threads.

### Messaging: Reply Rendering
- XMTP client wrapper (`src/lib/xmtp/client.ts`) now treats `ContentTypeReply` messages as first-class text messages instead of generic `"Reply"` system lines: replies are decoded into an `XmtpMessage` with `replyToId` pointing at the referenced message and `content` set to the reply body.
- History backfill and live stream classification special-case reply content types, emitting `xmtp:message` events with structured reply metadata rather than `xmtp:system` events.
- Message store plumbing (`src/features/messages/useMessages.ts`) persists `replyTo` on `Message` records for both locally sent and remotely received replies and filters legacy system-only `"Reply"` placeholders when loading messages from IndexedDB.
- `MessageBubble` (`src/features/messages/MessageBubble.tsx`) now renders a compact “Replying to …” header above the reply body, resolving the quoted snippet from the target message when available and falling back gracefully if the original message is missing.

### Testing / Coverage (Local Note)
- `pnpm test:coverage` now runs Vitest with the `v8` coverage provider (`@vitest/coverage-v8`) and writes standard reports to `coverage/` (HTML at `coverage/index.html`, summary JSON at `coverage/coverage-summary.json`). The old `scripts/report-v8-coverage.mjs` flow is no longer needed.
- Coverage scope is focused on core logic: `src/lib/**`, message bubble rendering, conversations hook, HandleXmtpProtocol, and config files. Large UI shells (`components/**`, most `features/messages/**`, XMTP client, Dexie driver, wagmi config/hooks, etc.) are excluded via `vitest.config.ts` to keep percentages meaningful.

### E2E Testing with Playwright (2025-12-09)

**Location**: `tests/e2e/ping-pong.spec.ts` (renamed from two-browser-messaging)

**Key Issues Discovered**:

1. **"Make it yours" Modal Double-Show Bug**:
   - **Root Cause 1**: The localStorage reminder key was based on `inboxId || address`. When XMTP connects, `inboxId` gets set, changing the key. Prefs written to the address-based key weren't found when reading from the inboxId-based key.
   - **Fix**: Always use address-based key (it's stable from identity creation).
   - **Root Cause 2**: Modal showed if EITHER displayName OR avatar was missing. Avatar is optional.
   - **Fix**: Only nag about displayName, not avatar. `shouldShowPersonalizationNag = missingDisplayName`.
   - **Root Cause 3**: Auto-generated labels like "Identity 0x1234…" were not treated as "missing".
   - **Fix**: Added `isAutoLabel()` check - treat "Identity X" and "Wallet X" prefixes as missing.

2. **Playwright Two-Browser Test**:
   - The test creates two separate browser contexts and runs them against the same local preview server.
   - **Critical**: Don't use `isVisible()` for buttons - it checks instantly without waiting. Use `waitFor({ state: 'visible' })` instead.
   - **Critical**: The test timeout (120s default) may not be enough for XMTP connections. Consider 300s+.
   - **E2E Mode**: When `VITE_E2E_TEST=true`, the app uses stub inboxIds instead of real XMTP connections.
   - The auth store is exposed on `window.useAuthStore` only in E2E mode.

3. **Onboarding Flow After Identity Creation**:
   - After `handleCreateGeneratedIdentity`, the app does `window.location.assign('/')` which causes a full page reload.
   - On reload, `checkExistingIdentity()` runs and loads identity from storage.
   - The inboxId should be set either from storage (if saved) or via XMTP connection.

**Test Structure**:
```typescript
// Correct pattern for waiting for elements:
const button = page.getByRole('button', { name: /create new identity/i });
await button.waitFor({ state: 'visible', timeout: 30000 });
await button.click();

// NOT this (checks instantly, doesn't wait):
if (await button.isVisible()) { ... }
```

**Running E2E Tests**:
```bash
pnpm exec playwright test tests/e2e/ping-pong.spec.ts --headed
```

**Limitation**: In E2E mode (`VITE_E2E_TEST=true`), XMTP connections are stubbed. This means:
- Each browser can onboard and create identities ✓
- Each browser can open the "New Chat" UI and send messages ✓
- Messages are NOT synced between browsers (no real XMTP network)
- Cross-browser message verification won't work without real XMTP

### Bug Fixes (2025-12-09)
- **XMTP Client Connection Hang**: Fixed a critical issue where `deriveInboxIdFromAddress` would hang indefinitely when the Utils worker failed to respond or the network was unstable.
  - Added a timeout to the `utils.getInboxIdForIdentifier` call.
  - Added a check for client existence before calling `getInboxIdFromAddress` to prevent "Client not connected" error noise.
  - This resolves the "Creating..." stuck state when starting new chats.

### UI Refinement (2025-12-09)
- **Message Composer Alignment**:
  - Rotating the send icon 90 degrees to point right (more intuitive).
  - Enforced equal height (42px) for the text input, attachment button, and send button to ensure perfect alignment.
  - Added transparent borders to buttons to match the input's box model.
