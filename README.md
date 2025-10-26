# Converge.cv - XMTP v3 PWA

A Signal-like, local-first messaging Progressive Web App built with XMTP v3.

**🚀 Live Demo**: [converge.cv](https://converge.cv) (coming soon)  
**📦 Repository**: [github.com/pierce403/converge.cv](https://github.com/pierce403/converge.cv)

## ✨ Features

### Core Features
- **Local-First Architecture**: All data encrypted and stored locally on your device
- **Progressive Web App**: Install on iOS, Android, and desktop - works offline
- **XMTP v3 Protocol**: Decentralized messaging via the XMTP v3 browser SDK (production network)
- **End-to-End Encrypted**: Military-grade AES-GCM 256-bit encryption with WebCrypto
- **Passkey Support**: WebAuthn PRF integration prepared for passwordless authentication
- **Signal-like UX**: Clean, intuitive interface with familiar messaging patterns

### Messaging
- Send and receive encrypted text messages
- Real-time message status indicators (pending → sent → delivered)
- Message reactions support
- Conversation management (pin, archive, search)
- Unread message badges
- Full-text search across conversations

### Security & Privacy
- Vault key encryption with passphrase (PBKDF2 600k iterations)
- Local message encryption at rest
- No server-side storage of messages
- Lock screen with vault protection
- Secure key management in memory

### PWA Features
- Offline app shell caching
- Installable on all platforms
- Push notification support (with VAPID setup)
- Badge API for unread counts
- Service worker for background sync

## 🛠️ Tech Stack

- **Framework**: React 18 + TypeScript + Vite
- **Routing**: react-router-dom
- **State Management**: Zustand
- **Styling**: Tailwind CSS
- **PWA**: vite-plugin-pwa (Workbox)
- **Messaging**: XMTP v3 browser SDK (production network connection in progress)
- **Storage**: Dexie (IndexedDB) with SQLite WASM migration path
- **Crypto**: WebCrypto API + WebAuthn
- **Testing**: Vitest + Playwright
- **CI/CD**: GitHub Actions

## 📦 Quick Start

### Prerequisites
- Node.js 18+ or 20+
- pnpm (recommended) or npm

### Installation

```bash
# Clone the repository
git clone https://github.com/pierce403/converge.cv.git
cd converge.cv

# Install dependencies
pnpm install

# Start development server
pnpm dev

# Open http://localhost:3000
```

### Development Commands

```bash
# Development
pnpm dev              # Start dev server with HMR
pnpm build            # Build for production
pnpm preview          # Preview production build
pnpm typecheck        # Run TypeScript checks

# Code Quality
pnpm lint             # Run ESLint
pnpm format           # Format code with Prettier

# Testing
pnpm test             # Run unit tests
pnpm test:e2e         # Run E2E tests (Playwright)
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

**For AI Agents**: Read [AGENTS.md](./AGENTS.md) first! It contains critical context about user preferences, architectural decisions, and project conventions. Update it whenever you learn something new.

## 🏗️ Architecture

```
src/
├── app/              # App shell, router, providers, layout
├── features/         # Feature modules
│   ├── auth/         # Authentication, onboarding, lock screen
│   ├── conversations/# Chat list, new chat
│   ├── messages/     # Conversation view, message bubbles, composer
│   ├── settings/     # Settings page
│   └── search/       # Search functionality
├── lib/              # Core libraries
│   ├── xmtp/         # XMTP client wrapper
│   ├── storage/      # Storage driver (Dexie)
│   ├── crypto/       # Vault, encryption, key management
│   ├── stores/       # Zustand state stores
│   ├── push/         # Push notification utilities
│   └── sw-bridge/    # Service worker communication
├── components/       # Shared UI components
└── types/            # TypeScript type definitions
```

## 🚢 Deployment

### Automatic Deployment (GitHub Actions)

Every push to `master` automatically:
1. Runs type checking and linting
2. Builds the production bundle
3. Deploys to GitHub Pages

See [DEPLOYMENT.md](./DEPLOYMENT.md) for detailed deployment instructions.

### Manual Deployment

```bash
pnpm build
# Deploy the dist/ folder to your hosting provider
```

## 🧪 Testing

### Unit Tests (Vitest)
```bash
pnpm test                    # Run all tests
pnpm test -- --coverage      # Run with coverage
pnpm test -- --watch         # Watch mode
```

### E2E Tests (Playwright)
```bash
pnpm test:e2e                # Run E2E tests
```

## 🔒 Security

- **Client-Side Encryption**: All encryption happens in the browser
- **Vault Key Protection**: Keys derived from passphrase with PBKDF2 (600k iterations)
- **No Server Storage**: Messages never leave your device unencrypted
- **Local Storage Only**: IndexedDB with encrypted data at rest
- **WebAuthn Ready**: Passkey integration prepared for production

## 🛣️ Roadmap

### Current Status (MVP v0.1.0)
- ✅ Complete authentication flow
- ✅ Message sending and receiving (local pipeline while XMTP integration matures)
- ✅ Encrypted local storage
- ✅ Search functionality
- ✅ Settings and vault management
- ✅ PWA with offline support
- ✅ Push notification infrastructure

### Next Steps
- [ ] Complete end-to-end XMTP v3 messaging flows
- [ ] Implement attachment support
- [ ] Add message reactions (interactive)
- [ ] Disappearing messages
- [ ] SQLite WASM migration for FTS
- [ ] Group chat support
- [ ] Voice messages
- [ ] Link previews
- [ ] Multi-device sync

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'feat: add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

MIT License - see [LICENSE](./LICENSE) for details

## 🔗 Links

- **Live App**: [converge.cv](https://converge.cv)
- **Repository**: [github.com/pierce403/converge.cv](https://github.com/pierce403/converge.cv)
- **Issues**: [GitHub Issues](https://github.com/pierce403/converge.cv/issues)
- **XMTP Protocol**: [xmtp.org](https://xmtp.org)

## 📧 Contact

Pierce Brantley - [@pierce403](https://github.com/pierce403)

---

Built with ❤️ using React, TypeScript, and XMTP

