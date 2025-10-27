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
pnpm test             # Run unit tests
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
- Simplified onboarding (no passphrases, auto wallet generation)
- PWA install prompt with localStorage persistence
- Update notification system with hourly checks
- Vault unlocked by default
- Identity storage in IndexedDB
- Clean UI with proper feature messaging
- Debug log control in bottom navigation captures console output and surfaces state snapshots
- Full-screen Debug tab (`/debug`) aggregates console, XMTP network, and runtime error logs
- Default conversations seeded from `DEFAULT_CONTACTS` when a new inbox has no history
- Watchdog reloads the PWA if the UI thread stalls for ~10s to restore responsiveness automatically
- **XMTP v3 Identity Registration**: Fully working! Identities are now properly registered on the XMTP production network with wallet signatures. Each new identity:
  1. Creates XMTP client with address
  2. Checks if already registered (via `isRegistered()`)
  3. If not registered: gets signature text, signs with Ethereum private key (using viem), adds signature, and calls `registerIdentity()`
  4. Results in a valid inbox ID that can be messaged from xmtp.chat and other XMTP clients

### 🚧 Mock/TODO
- Actual message sending/receiving (XMTP client connected, but message flows still need implementation)
- Proper wallet key derivation (currently random bytes)
- Device-based encryption for private keys
- Group chat support
- Attachments
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
- PWA prompts only trigger on HTTPS or localhost

---

## User's Goals

User wants to enable:
1. **Create new identity from nothing** → ✅ DONE (identities now properly registered on XMTP network)
2. **Message someone on the Base app** → 🚧 Registration done, message send/receive flows next
3. Worry about connecting existing identities later → Deferred

Focus on **friction-free onboarding** for new users first.

### Key Technical Learning: XMTP v3 Registration Flow
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
6. Always run the full test suite (`pnpm build` and `pnpm test`) before handing work back to the user to keep the deploy pipeline green.
7. **COMMIT AND PUSH** your changes to keep the knowledge base synced:
   ```bash
   git add AGENTS.md
   git commit -m "docs: update AGENTS.md with new learnings"
   git push
   ```

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

**Last Updated**: 2025-10-27 (Fixed XMTP identity registration - addresses now properly register on network with inbox IDs)
**Updated By**: AI Agent after implementing proper XMTP v3 registration flow with wallet signatures

