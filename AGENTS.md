# Agents Context & Project Knowledge

**⚠️ IMPORTANT: Future agents working on this project should READ THIS FILE FIRST and UPDATE IT whenever they learn something new about the project or user preferences.**

---

## Project Overview

**Converge.cv** - A Signal-like, local-first Progressive Web App for XMTP protocol v3 (currently running @xmtp/browser-sdk v5.0.1).

- **Live URL**: https://converge.cv
- **Tech Stack**: React 18 + TypeScript + Vite + Tailwind CSS
- **State Management**: Zustand
- **Storage**: Dexie (IndexedDB wrapper)
- **Messaging Protocol**: XMTP protocol v3 (production network) via XMTP SDK v5.0.1
- **PWA**: vite-plugin-pwa with Workbox
- **Deployment**: GitHub Pages (auto-deploy on push to master)

---

## Critical User Preferences

### 🚫 NO PASSPHRASES BY DEFAULT
- **User strongly prefers**: Zero friction authentication
- **Never require passphrases** for onboarding or regular use
- Passphrase functions exist (`createIdentityWithPassphrase`) but are NOT in the default flow
- Auto-generate wallets in the background - users should never manually enter Ethereum addresses
- **Exception**: Could add passphrase as an advanced/optional security feature if explicitly requested

### 🔓 NO VAULT LOCKING BY DEFAULT
- App should stay unlocked by default after initial setup
- Users can manually lock from Settings if they want
- Don't force lock screen on every app reload
- `checkExistingIdentity()` sets `isVaultUnlocked: true` automatically

### ⚡ ONE-CLICK ONBOARDING
- Current flow: Welcome screen → Click "Get Started" → Automatically create identity → Ready to use
- **No manual wallet address entry**
- **No passphrase setup**
- **No multi-step wizard** unless absolutely necessary

### 🚫 NO FAKE/MOCK DATA OR IDs
- **NEVER use placeholder, fake, or mock API keys, project IDs, or credentials**
- If a service requires an API key or project ID, **ASK THE USER** to generate it
- Do not use placeholder values like `'your-api-key-here'`, `'fake-id'`, `'default-project'`
- Real production services need real credentials - don't assume defaults will work
- **Exception**: Development/testing stubs for XMTP message handling are acceptable if clearly marked

---

## Architecture Decisions

### Identity & Storage
- **Identities stored in IndexedDB** (via Dexie), NOT localStorage
- Wallet addresses auto-generated using `crypto.getRandomValues()`
- Private keys stored in identity record (would be device-encrypted in production)
- No vault secrets required for default flow

### Authentication Flow
```
Welcome → handleStart() → 
  Generate wallet (crypto.getRandomValues) → 
  createIdentity(address, privateKey) → 
  Store in IndexedDB → 
  Navigate to main app
```

### Key Functions
- `createIdentity(address, privateKey)` - Simple, no passphrase
- `createIdentityWithPassphrase(passphrase, address)` - Advanced option (not in default flow)
- `checkExistingIdentity()` - Auto-unlocks vault on app load

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
│   │   ├── OnboardingPage.tsx    # Simplified 1-click onboarding
│   │   ├── useAuth.ts            # Auth hook with createIdentity()
│   │   └── LockScreen.tsx        # Optional manual lock
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

- CodeQL scanning: Configured via `.github/workflows/codeql.yml` to run on pushes, PRs to `main`, and weekly. Results appear in GitHub code scanning alerts.
- Socket.dev supply-chain scan: Configured via `.github/workflows/socket.yml` using the Socket CLI.
  - The job runs `npx -y @socketsecurity/cli scan --ci` on pushes/PRs to `main`.
  - Optional: add a repository secret `SOCKET_API_KEY` for enriched results/logging.
  - No server components are required; this runs fully in GitHub Actions.


---

## Current State (as of this session)

### ✅ Completed
- Simplified onboarding (no passphrases, auto wallet generation with proper secp256k1 key derivation)
- PWA install prompt with localStorage persistence (currently disabled for debugging)
- Update notification system with hourly checks (currently disabled for debugging)
- Vault unlocked by default
- Identity storage in IndexedDB
- Clean UI with proper feature messaging
- Debug log control in bottom navigation captures console output and surfaces state snapshots
- Full-screen Debug tab (`/debug`) aggregates console, XMTP network, and runtime error logs
- Default conversations seeded from `DEFAULT_CONTACTS` when a new inbox has no history
- Watchdog reloads the PWA if the UI thread stalls for ~10s to restore responsiveness automatically
  - **XMTP SDK v5.0.1 on protocol v3**: ✅ Fully working!
  - **Upgraded from v3.0.5 → v5.0.1** (October 28, 2025)
  - Following xmtp.chat reference implementation
  - Identities properly registered on XMTP production network
  - Wallet generation uses proper secp256k1 (address derived from private key via `viem`)
  - Message streaming active via `conversations.streamAllMessages()`
  - Incoming messages displayed in real-time
  - Can message and be messaged from xmtp.chat and other XMTP protocol v3+ clients
  - **Key difference from v3**: `getIdentifier()` is synchronous in v5 (was async in v3)

### 🚧 TODO
- Message sending: ✅ First-message send path fixed (use `getConversationById` before `send`) and DM creation via identifier. Monitor for edge cases and delivery state UX.
- Device-based encryption for private keys (currently stored in plain text in IndexedDB)
- Group chat support (SDK supports it, UI not implemented)
- Attachments (text messages only for now)
- Re-enable PWA features (install prompt, update notifications, service worker)
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
- Current Vitest status: `pnpm test --run` fails because the XMTP upstream fixtures under `tmp/xmtp-js/**` resolve bare module aliases and because `fix-xmtp-wasm-worker.test.ts` and `crypto/vault.test.ts` need environment shims—expect these failures until the suite is triaged.

---

## User's Goals

User wants to enable:
1. **Create new identity from nothing** → ✅ DONE (identities now properly registered on XMTP network)
2. **Message someone on the Base app** → ✅ DM creation + sending working (v5, identifier-based)
3. Worry about connecting existing identities later → Deferred

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
2. **Check for time gaps**: If the last update timestamp seems old or there's been time since the last session:
   ```bash
   cd /home/pierce/projects/converge.cv && git pull
   git log --oneline --no-merges HEAD~20..HEAD  # Review recent commits
   ```
3. Check `TODO.md` for planned features
4. Review `PROJECT_SUMMARY.md` for technical overview
5. Look at recent git history to understand latest changes
6. Load XMTP LLM + content-type docs into context for reference:
   - https://docs.xmtp.org/chat-apps/intro/build-with-llms
   - https://raw.githubusercontent.com/xmtp/docs-xmtp-org/main/llms/llms-full.txt
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
6. Always run the full CI-equivalent checks before handing work back: `pnpm typecheck && pnpm lint && pnpm test --run && pnpm build` (matches the GitHub Pages workflow order: typecheck → lint → build/deploy).
7. **ALWAYS COMMIT AND PUSH ALL CHANGES** - This is mandatory after completing any work:
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
- Full LLMs guide (raw): https://raw.githubusercontent.com/xmtp/docs-xmtp-org/main/llms/llms-full.txt

These links are high-signal for XMTP behaviors and should be considered required reading for future agents working on AI/agent features. Keep them in working memory while making protocol/UI decisions.

### XMTP + LLMs (Always Load in Context)
- Build-with-LLMs overview: https://docs.xmtp.org/chat-apps/intro/build-with-llms
- Full reference text (raw): https://raw.githubusercontent.com/xmtp/docs-xmtp-org/main/llms/llms-full.txt

Guidance:
- Before starting related work, open and keep these two docs in your session context. If needed, fetch the raw text locally for quick grep:
  - `curl -L https://raw.githubusercontent.com/xmtp/docs-xmtp-org/main/llms/llms-full.txt -o tmp/xmtp-llms-full.txt`
- Treat these as required context when implementing or debugging anything that involves LLMs, assistants, or message flows that may be model-driven.

### Farcaster / Neynar Docs (Load for Farcaster features)
- Neynar API reference: https://docs.neynar.com/reference/overview
- Users by verification endpoint: https://docs.neynar.com/reference/get-users-by-verifications
- General Neynar developer docs: https://docs.neynar.com

Use the Converge Neynar client key `e6927a99-c548-421f-a230-ee8bf11e8c48` as the baked-in default (user-provided and not secret). Prefer `VITE_NEYNAR_API_KEY` when present.

---

**Last Updated**: 2025-12-20 (clear-all-data + reconnect fixes)
**Updated By**: AI Agent

## Latest Changes (2025-12-20)

### Clear All Data Hard Reset
- `clear_all_data` is now handled at the router level to wipe IndexedDB/OPFS/web storage/caches and reset stores before reloading, preventing “ghost” inboxes on onboarding.
- Logout now also clears identity + vault secrets and resets the storage namespace to fully remove local identity state.

### XMTP Reconnect Resilience
- XMTP connect no longer skips when a stale client exists; failed connects now null out the client so the Settings reconnect button actually retries.

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
