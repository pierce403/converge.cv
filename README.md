# Converge.cv

Converge is a static, local-first messaging PWA for XMTP protocol v3. It uses React 18, TypeScript, Vite, Dexie, and `@xmtp/browser-sdk` 6.1.2 on the XMTP production network.

- Live app: [converge.cv](https://converge.cv)
- Repository: [github.com/pierce403/converge.cv](https://github.com/pierce403/converge.cv)
- Architecture: [ARCHITECTURE.md](./ARCHITECTURE.md)
- Shipped behavior: [FEATURES.md](./FEATURES.md)
- Developer docs: [docs/README.md](./docs/README.md)

## Identity Model

Converge treats XMTP accounts, inboxes, and installations as separate things:

- **Create new Converge inbox** generates a local secp256k1 account key, creates a new XMTP inbox, and registers this browser installation.
- **Restore from keyfile** reuses the exact private key or mnemonic from the file. On a browser without its XMTP database, that same account resolves to the same inbox and registers a new installation.
- **Add this device to existing inbox** generates a fresh local account key for this browser. A wallet that already controls the target inbox registers or reuses one browser installation, approves the fresh account, and Converge reopens the same inbox database with the fresh key.
- **Wallet approval** is authority for an existing inbox. It does not silently create a wallet inbox or move an already-registered Converge key.

An XMTP inbox can have up to 10 active installations. Converge checks the target inbox before registration and offers static recovery only when the connected signer is the inbox recovery identity. It rechecks the live count and revokes only enough explicitly confirmed installations to return to 9/10.

Ethereum addresses are canonicalized to one lowercase `0x` prefix plus 40 hexadecimal characters before they reach XMTP or local identity storage. Existing repairable records such as `0X...`, prefixless addresses, and repeated `0x0x...` prefixes are migrated when read; malformed values are rejected.

New installations explicitly request XMTP device history. A pre-existing installation must be online to produce the encrypted archive. Matching the same `inboxId` does not by itself restore decrypted historical messages.

## Features

- End-to-end encrypted XMTP text messaging on the production network
- Convos-compatible single-peer groups, group messaging, profiles, typing, invites, and metadata
- Real-time message streams plus local IndexedDB conversation and message caches
- Image attachments encrypted before IPFS upload
- Multiple local inboxes with isolated app-data namespaces
- Wallet providers through Native/Wagmi, Thirdweb, and Privy
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

A keyfile or browser profile containing this data must be protected as sensitive account material. Converge does not currently expose passphrase, passkey, or vault-lock controls; those incomplete paths were removed from the UI until real key encryption and recovery semantics exist.

## Push Status

Web Push support is experimental. Converge can register a browser `PushSubscription` and send inbox, installation, and locally available conversation HMAC metadata to the configured vapid.party XMTP relay contract. Live end-to-end delivery and welcome/new-conversation topic coverage have not been verified. The app must not claim that push delivery is complete until a real relay test passes.

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

Pushes to `main` use pnpm 10.5.2 with the frozen lockfile, then run typecheck, lint, Vitest, build, and deploy through GitHub Pages. The static app is served at [https://converge.cv](https://converge.cv). See [DEPLOYMENT.md](./DEPLOYMENT.md) for details.

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
