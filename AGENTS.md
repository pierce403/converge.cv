# Agents Context & Project Knowledge

**⚠️ IMPORTANT: Future agents working on this project should READ THIS FILE FIRST and UPDATE IT whenever they learn something new about the project or user preferences.**

---

## Project Overview

**Converge.cv** - A Signal-like, local-first Progressive Web App for XMTP v3 messaging protocol.

- **Live URL**: https://converge.cv
- **Tech Stack**: React 18 + TypeScript + Vite + Tailwind CSS
- **State Management**: Zustand
- **Storage**: Dexie (IndexedDB wrapper)
- **Messaging Protocol**: XMTP v3 (production network connection scaffolding in place)
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
- Component: `src/components/PWAInstallPrompt.tsx`
- Shows on mobile: "Install Converge - Install the app for faster access and offline messaging"
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

---

## Development Commands

```bash
pnpm dev              # Start dev server (port 3001 currently running)
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
- **XMTP v5.0.1 Integration**: ✅ Fully working!
  - **Upgraded from v3.0.5 → v5.0.1** (October 28, 2025)
  - Following xmtp.chat reference implementation
  - Identities properly registered on XMTP production network
  - Wallet generation uses proper secp256k1 (address derived from private key via `viem`)
  - Message streaming active via `conversations.streamAllMessages()`
  - Incoming messages displayed in real-time
  - Can message and be messaged from xmtp.chat and other XMTP v3+ clients
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

- Dev server runs on port 3001 (not 3000)
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

### While Working
- Keep the no-passphrase principle in mind
- Maintain the simple onboarding flow
- Test changes in browser (localhost:3001)
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
6. Always run the full test suite (`pnpm build` and `pnpm test --run`) before handing work back to the user to keep the deploy pipeline green.
7. **ALWAYS COMMIT AND PUSH ALL CHANGES** - This is mandatory after completing any work:
   ```bash
   git add -A
   git commit -m "feat: description of changes made"
   git push origin main
   ```
   - Commit message should follow conventional commits (feat:, fix:, docs:, etc.)
   - Include AGENTS.md updates in the same commit if applicable
   - Never leave uncommitted changes when completing work

### Communication Style
- Ask clarifying questions if passphrase/security features are needed
- Default to simplicity and low friction
- User prefers direct implementation over suggestions

---

## Contact & Links

- **Repository**: https://github.com/pierce403/converge.cv
- **Live App**: https://converge.cv
- **XMTP Docs**: https://xmtp.org

---

**Last Updated**: 2025-10-31 (Contacts now keyed by XMTP inbox IDs)
**Updated By**: AI Agent after refactoring contact storage and group management

## Latest Changes (2025-10-31)

### Inbox-Centric Contacts
- Reworked `contact-store` to key contacts by XMTP inbox ID, track all linked Ethereum addresses/identifiers, and merge remote profile updates safely.
- Added Dexie v3 migration (`contacts: '&inboxId, primaryAddress, *addresses'`) to move legacy address-keyed rows and prevent duplicates.
- `Layout` now fetches inbox profiles for every inbound message and asynchronously enriches contacts with Farcaster metadata when available (name, avatar, bio).
- `useMessages` auto-upserts recipients into the contact store with inferred primary addresses on first send.

### Group Settings & Picker
- Group settings page populates members with inbox-aware contacts, surfaces admin roles, and dedupes lookups across inbox IDs and addresses.
- Contact picker only lists contacts not already in the group, supports multi-select, and adds members via inbox IDs or Ethereum addresses as appropriate.
- XMTP client wrapper accepts mixed inbox IDs/addresses when adding or removing group members.

### People & UI Polish
- Conversation headers, chat list entries, and `UserInfoModal` pull preferred name/avatar from the updated contact store and list linked identities.
- Chat bubbles are capped at two-thirds width for improved readability; add-contact button respects inbox-centric lookups.
- Contacts page and new-group flow search across inbox IDs, preferred names, and known addresses, while hiding the current identity.

### Tooling
- Fixed lint failures (`react-hooks/rules-of-hooks`, dependency warnings) and restored `pnpm lint`/`pnpm typecheck` to green.

## Latest Changes (2025-10-30)

### OpenGraph Card
- `public/og-card.svg` now embeds the existing `icon-512.png` app logo so social previews reflect the current branding.
- Added a rounded clip path around the icon to keep the card layout consistent without maintaining an extra SVG illustration.

## Latest Changes (2025-10-29)

### Messaging: Outgoing DM Creation + First Send

**Problem**: Creating DMs from an Ethereum address sometimes failed ("not registered" / hex parsing errors) and first message wouldn’t send.

**Fixes**:
1. Removed `canMessage` pre-check gate. Create DMs directly via `conversations.newDmWithIdentifier({ identifier: address, identifierKind: 'Ethereum' })` and let SDK resolve inbox ids internally.
2. For sending, fetch the conversation by id via `conversations.getConversationById(id)`; if missing, `conversations.sync()` then retry before `send`.
3. Preserved checksum addresses (keep `0x` for identifier usage) to avoid `invalid hexadecimal digit: "x"` errors.

**Result**: Outgoing DM creation and first-message send work reliably on v5.

### Sync & History
- On first connect, run `conversations.sync()`, `conversations.syncAll()`, and a history backfill prior to `streamAllMessages()` so prior messages appear immediately.

### Installations & Device Management
- Added Force Network Refresh and Fetch Statuses actions. When connected, use `client.preferences.inboxState(true)`; when disconnected, use `new Utils(false)` with `getInboxIdForIdentifier`/`inboxStateFromInboxIds` as a fallback. Added timeouts and stricter typing.
- Clear All Data now disconnects wagmi, closes the XMTP client (important to release OPFS DB locks), wipes Dexie + XMTP OPFS, clears SW caches, and hard reloads.

### Debug: Web Workers Panel
- Added a live Workers panel: tracks dedicated workers via a patched `Worker` constructor and lists Service Worker registrations with scriptURL/state. Initialized tracker early in `Providers` to catch bootstrap workers.
- Type-safe tracker with minimal `any` shims where unavoidable.

### Router: WalletConnect Loop Prevention
- Only call `checkExistingIdentity()` when not authenticated to avoid WalletConnect reopen loops (e.g., Rainbow popping after onboarding).

### Telemetry & Logging
- Disabled structured/performance/debug telemetry in XMTP client options and reduced logging in production.

**Files Updated**
- `src/lib/xmtp/client.ts`: DM creation via identifier, fetch conversation by id before send, first-connect sync/backfill, reduced telemetry.
- `src/features/conversations/NewChatPage.tsx`: removed `canMessage` gate.
- `src/app/Router.tsx`: guard identity restore to prevent double-connect loops.
- `src/features/settings/SettingsPage.tsx`: expanded Clear All Data and ensured wallet disconnect.
- `src/features/settings/InstallationsSettings.tsx`: refresh and status actions; revocation handling.
- `src/app/Providers.tsx`: initialize worker tracker.
- `check_deploy.sh`: GitHub Pages deploy watcher.

---

## Latest Changes (2025-10-28)

### Wallet Connection Integration

**Problem**: App only supported random wallet generation, limiting users to a single device/identity.

**Solution**: Integrated `wagmi` (v2.16.9) for professional wallet management:

1. **Multiple Wallet Support**:
   - MetaMask
   - Coinbase Wallet
   - WalletConnect  
   - Injected wallets (browser-based)

2. **Three Signer Types** (from xmtp.chat):
   - `createEOASigner` - Normal wallets (EOA = Externally Owned Account)
   - `createSCWSigner` - Smart Contract Wallets (includes chainId for Base, etc.)
   - `createEphemeralSigner` - Generated wallets (existing flow)

3. **Onboarding Flow Enhanced**:
   - Welcome screen
   - Choice screen: Connect wallet OR Generate new
   - Wallet selector with visual wallet options
   - Creating/loading screen

4. **Configuration**:
   - Added WagmiProvider and QueryClientProvider to app
   - Configured for mainnet, Base, and Base Sepolia
   - Used exact versions from xmtp.chat for compatibility
   - **WalletConnect Project ID**: `de49d3fcfa0a614710c571a3484a4d0f` (from cloud.reown.com)

**Files Added**:
- `src/lib/wagmi/config.ts` - Wagmi configuration
- `src/lib/wagmi/hooks.ts` - Wallet connection hooks
- `src/lib/wagmi/signers.ts` - XMTP signer creation utilities
- `src/features/auth/WalletSelector.tsx` - Wallet selection UI

**Files Modified**:
- `src/app/Providers.tsx` - Added WagmiProvider
- `src/features/auth/OnboardingPage.tsx` - Added wallet choice flow
- `package.json` - Added wagmi, @tanstack/react-query

**Key Learning**: xmtp.chat uses wagmi for wallet management, which provides a robust, battle-tested solution for connecting multiple wallet types. Using their exact version numbers (wagmi@2.16.9, @wagmi/core@2.20.3, @wagmi/connectors@5.9.9, viem@2.37.6) prevents version conflicts.

**Still TODO**:
- Identity manager UI in settings (for switching between identities)
- Enhanced installations table with key package status and expiry
- Multi-identity support (store multiple identities, switch between them)

**Last Updated**: 2025-10-28 (Added wallet connection support with wagmi)
**Updated By**: AI Agent after adding multi-wallet support

### Messaging: Outgoing DM Creation + First Send (2025-10-28)

**Problem**: New conversations created from Converge failed with “not registered” or couldn’t send the first message.

**Root Causes & Fixes**:
1. Pre-check with `canMessage(address)` returned false negatives and blocked creation. We removed this gate in the UI and let the SDK validate during creation.
2. Inbox lookup before creating caused formatting pitfalls (0x vs raw hex). Instead of resolving inbox ids ourselves, we now call `conversations.newDmWithIdentifier({ identifier: address, identifierKind: 'Ethereum' })` for addresses. The SDK handles discovery and registration details internally.
3. First message send path tried to find the conversation via `conversations.list()` and missed newly created DMs. We now fetch directly with `conversations.getConversationById(id)` and retry after a `sync()` before sending.

**Extra Learnings**:
- `canMessage` returns a `Map<inboxId, boolean>`; its keys are inbox ids, not addresses.
- For identifier-based creation, pass the checksummed `0x…` address as the identifier. For direct lookup (`findInboxIdByIdentifier`), the lower-level worker expects raw hex (no `0x`)—but we no longer need that for creation.
- To avoid WalletConnect re-prompt loops, only call `checkExistingIdentity()` on mount when not authenticated.
- Added `check_deploy.sh` to watch GitHub Pages deploys via `gh` + `jq`.

**Files**:
- `src/features/conversations/NewChatPage.tsx`: remove `canMessage` pre-check gate.
- `src/lib/xmtp/client.ts`: create DMs with `newDmWithIdentifier` for addresses; fetch conversation by id before `send`.
- `src/app/Router.tsx`: skip identity restore when already authenticated (prevents WalletConnect loops).
- `check_deploy.sh`: convenience deploy watcher.

**Status**: ✅ Outgoing DM creation and first-message send working end-to-end on v5.
