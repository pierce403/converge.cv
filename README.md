# Converge.cv - XMTP v3 PWA

A Signal-like, local-first messaging Progressive Web App built with XMTP v3.

## 🚀 Features

- **Local-First**: All data encrypted and stored locally on your device
- **PWA**: Install on iOS, Android, and desktop - works offline
- **XMTP v3**: Decentralized messaging protocol
- **End-to-End Encrypted**: Military-grade encryption with WebCrypto
- **Passkey Support**: Modern passwordless authentication
- **Signal-like UX**: Clean, intuitive interface

## 🛠️ Tech Stack

- **Framework**: React + TypeScript + Vite
- **Routing**: react-router-dom
- **State**: Zustand
- **Styling**: Tailwind CSS + Headless UI
- **PWA**: vite-plugin-pwa (Workbox)
- **Messaging**: XMTP v3 browser SDK
- **Storage**: Dexie (IndexedDB) with SQLite WASM path
- **Crypto**: WebCrypto API + WebAuthn
- **Testing**: Vitest + Playwright

## 📦 Installation

```bash
# Install dependencies
pnpm install

# Start development server
pnpm dev

# Build for production
pnpm build

# Preview production build
pnpm preview

# Run tests
pnpm test

# Run E2E tests
pnpm test:e2e
```

## 🏗️ Project Structure

```
src/
├── app/              # App shell, router, providers
├── features/         # Feature modules
│   ├── auth/         # Authentication & vault
│   ├── conversations/
│   ├── messages/
│   ├── settings/
│   └── search/
├── lib/              # Core libraries
│   ├── xmtp/         # XMTP client wrapper
│   ├── storage/      # Storage drivers (Dexie/SQLite)
│   ├── crypto/       # Encryption & key management
│   ├── push/         # Web Push notifications
│   └── sw-bridge/    # Service worker communication
├── components/       # Shared UI components
└── types/            # TypeScript types
```

## 🔐 Security

- Messages encrypted at rest with AES-GCM
- Vault key derived from passkey (WebAuthn PRF) or passphrase (PBKDF2)
- No plaintext message storage
- Optional disappearing messages

## 📱 PWA Features

- Installable on all platforms
- Offline support
- Web Push notifications
- Background sync
- App shell caching

## 🤝 Contributing

See [TODO.md](./TODO.md) for development roadmap and tasks.

## 📄 License

MIT

## 🌐 Deployment

This app is hosted on GitHub Pages at [converge.cv](https://converge.cv)

Repository: [github.com/pierce403/converge.cv](https://github.com/pierce403/converge.cv)

