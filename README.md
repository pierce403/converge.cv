# Converge.cv

Converge is a static, local-first messaging PWA for XMTP protocol v3. It uses React 18, TypeScript, Vite, Dexie, and `@xmtp/browser-sdk` 6.1.2 on the XMTP production network.

- Live app: [converge.cv](https://converge.cv)
- Repository: [github.com/pierce403/converge.cv](https://github.com/pierce403/converge.cv)
- Architecture: [ARCHITECTURE.md](./ARCHITECTURE.md)
- Shipped behavior: [FEATURES.md](./FEATURES.md)
- Developer docs: [docs/README.md](./docs/README.md)

## Identity Model

Converge treats XMTP accounts, inboxes, and installations as separate things:

- **Onboarding** always starts on the inbox choice screen. Nothing is created and no wallet opens until the user chooses Create new inbox, Restore from keyfile, or Add this device to existing inbox. After a new inbox is ready, Converge opens the dismissible Color Animal name/avatar editor before the main messaging UI.
- **Create new Converge inbox** generates a local secp256k1 account key, creates a new XMTP inbox, and registers this browser installation.
- **Restore from keyfile** reuses the exact private key or mnemonic from the file. On a browser without its XMTP database, that same account resolves to the same inbox and registers a new installation.
- **Add this device to existing inbox** generates a fresh local account key for this browser. A wallet that already controls the target inbox registers or reuses one browser installation, approves the fresh account, and Converge reopens the same inbox database with the fresh key.
- **Wallet approval** is authority for an existing inbox. It does not silently create a wallet inbox or move an already-registered Converge key.

Before Converge associates the fresh local account key, it waits for the exact browser installation to appear as a published member of the target XMTP inbox. Local `isRegistered()` state alone is not treated as authorization; if XMTP is still propagating the installation, setup stops without submitting the account association. The inbox choice screen then offers an explicit resume action for that same pending key and installation instead of opening wallet approval automatically.

The top-left Inbox Switcher has one profile-name/avatar row per inbox. Only the selected inbox connects and syncs. Add Inbox supports creation, exact-key import, and wallet-approved device join; importing a key that resolves to an already loaded inbox stops with `This inbox is already loaded`.

Before wallet-approved association can continue, Settings requires an explicit acknowledgment that wallet/account links to an XMTP inbox are publicly queryable and effectively permanent in XMTP identity history.

An XMTP inbox can have up to 10 active installations. Converge checks the target inbox before registration and offers static recovery only when the connected signer is the inbox recovery identity. It rechecks the live count and revokes only enough explicitly confirmed installations to return to 9/10.

Ethereum addresses are canonicalized to one lowercase `0x` prefix plus 40 hexadecimal characters before they reach XMTP or local identity storage. Existing repairable records such as `0X...`, prefixless addresses, and repeated `0x0x...` prefixes are migrated when read; malformed values are rejected.

New installations explicitly request XMTP device history. A pre-existing installation must be online to produce the encrypted archive. Matching the same `inboxId` does not by itself restore decrypted historical messages.

## Features

- End-to-end encrypted XMTP text messaging on the production network
- Convos-compatible single-peer groups, group messaging, profiles, typing, invites, and metadata
- Real-time message streams plus local IndexedDB conversation and message caches
- Image attachments encrypted before IPFS upload through Thirdweb storage
- Multiple local inboxes with isolated app-data namespaces
- Inbox-scoped contacts that use peer-published profiles and are created after active participation
- Settings-only Burn Inbox with static installation revocation, complete local wipe, and blocked-cleanup retry handling
- Wallet approval through the native Wagmi/Reown stack for Coinbase/Base, WalletConnect, MetaMask, and injected wallets
- Farcaster profile enrichment through Neynar
- Installable static PWA shell
- Debug, installation-management, and recovery tools

See [FEATURES.md](./FEATURES.md) for the detailed shipped specification.

## Security Reality

XMTP encrypts messages end to end before ciphertext is sent to the XMTP network. Converge does **not** currently encrypt its browser data at rest:

- Local private keys and mnemonics are stored directly in IndexedDB.
- Decrypted messages, contacts, attachment caches, and profile data are stored directly in IndexedDB.
- The Browser SDK's local XMTP SQLite database is not encrypted.
- Downloaded Converge keyfiles contain an unencrypted private key or mnemonic.

A keyfile or browser profile containing this data must be protected as sensitive account material. Plaintext key export is available only inside the collapsed **Advanced** Settings section and is never an onboarding requirement or backup nag. Converge does not currently expose passphrase, passkey, or vault-lock controls; those incomplete paths were removed from the UI until real key encryption and recovery semantics exist.

## Push Status

Web Push support is experimental. One app/browser toggle manages one physical `PushSubscription` plus a logical relay registration for each loaded inbox/installation. Only the selected inbox connects to XMTP. Inactive-inbox pushes record an approximate activity dot without connecting, syncing, or claiming an exact unread count.

For the active inbox, Converge registers canonical MLS group topics with every HMAC-key epoch exposed by XMTP and adds the installation's deterministic welcome topic for new conversations. The relay receives an opaque inbox handle, not the profile name or message plaintext. The service worker resolves notification copy from the locally cached profile, and every notification click opens or focuses Converge's root page; relay data cannot select an inbox, conversation, or external URL.

On July 12, 2026, the full path was verified with a real Chrome FCM subscription, real XMTP production inboxes, and the official XMTP v3 notification server: installation welcomes and inbound group messages reached the live Converge service worker, while the recipient's own message was suppressed. The listener and its temporary PostgreSQL database ran only for that test. No always-on listener is deployed, so automatic delivery is not continuously available and the user-facing feature remains experimental.

## Development

### Prerequisites

- Node.js 20 or newer
- pnpm 10

### Setup

```bash
git clone https://github.com/pierce403/converge.cv.git
cd converge.cv
pnpm install
pnpm dev
```

The development server listens on [http://localhost:3000](http://localhost:3000).

### Commands

```bash
pnpm dev
pnpm typecheck
pnpm lint
pnpm test --run
pnpm build
pnpm preview
pnpm test:e2e
```

Use `pnpm test --run` for a one-shot Vitest run. Plain `pnpm test` starts watch mode.

## Deployment

Pushes to `main` use the pnpm version pinned by `packageManager` with the frozen lockfile, then run typecheck, lint, Vitest, build, and deploy through GitHub Pages. The static app is served at [https://converge.cv](https://converge.cv). See [DEPLOYMENT.md](./DEPLOYMENT.md) for details.

## Project Layout

```text
src/
|-- app/             App shell, routing, and providers
|-- components/      Shared UI
|-- features/        Auth, conversations, messages, settings, search
|-- lib/
|   |-- identity/    Local account-key generation and profile suggestions
|   |-- storage/     Dexie/IndexedDB persistence
|   |-- xmtp/        Browser SDK wrapper and provisioning logic
|   |-- push/        Experimental Web Push registration
|   `-- stores/      Zustand state
`-- types/           Shared TypeScript types
```

## Contributing

Read [AGENTS.md](./AGENTS.md) before repository work. It is the canonical project instruction file; `CLAUDE.md` and `GEMINI.md` point to it for harness compatibility.

## License

MIT. See [LICENSE](./LICENSE).
