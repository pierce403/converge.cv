## XMTP Identity, Inboxes, and Installations

This note summarizes how XMTP v5 models wallet identities, inbox records, and device installations. It draws heavily on the official documentation and the xmtp.chat reference implementation.

### Core Terms

- **Account Identifier**  
  Arbitrary identifier that proves control of an account (most commonly an Ethereum EOA). (`identifierKind: "Ethereum"`) [^identity]
- **Inbox**  
  Network record that binds one or more account identifiers to a cryptographic key bundle. An inbox owns the message history and consent state. [^inboxes]
- **Installation**  
  A device-specific key pair registered under an inbox. Each installation signs and decrypts messages on behalf of the inbox. [^installations]

### Identity Lifecycle

1. **Signer creation** – Provide XMTP with a signer capable of returning the account identifier (wallet address) and signing payloads. Converge uses `createEOASigner` / `createEphemeralSigner`, mirroring xmtp.chat. [^chat_signers]
2. **Client bootstrap** – `Client.create(signer, { env: "production" })` asks the network for the inbox that corresponds to the identifier. Under the hood the SDK calls `getInboxIdForIdentifier` and falls back to `generateInboxId` when none exists. [^createClient]
3. **Registration (one-time)** – If an inbox ID does not exist, XMTP issues a registration challenge (`createInboxSignatureRequest`). The wallet signs this payload and the SDK submits it to `registerIdentity`. On success the network persists the inbox id and associated key material. [^registration]
4. **Installation provisioning** – Each `Client.create` call also provisions an installation for the current device (installation ID + key package). That installation is stored locally (OPFS) and announced to the network so peers can fetch the appropriate pre-key bundle. [^installations]

### Inbox Discovery

- **`Client.canMessage`** – Takes an array of identifiers and returns a `Map<inboxId, boolean>` showing which inboxes can be reached. The v5 SDK now resolves inbox IDs internally; you still must inspect the keys in the returned map. [^canMessage]
- **`Client.findInboxIdByIdentifier`** – Direct lookup that returns the inbox ID (or `undefined`) for a single identifier. Prefers cached state, hits the `get_identity_updates_v2` endpoint on cache miss. [^findInbox]
- **`Client.getInboxState` / `inboxStateFromInboxIds`** – Provide all identifiers + installations registered to an inbox, which is how xmtp.chat renders the “Installations” table and revocation UI. [^inboxState]

For Converge, the safest way to start a DM from an Ethereum address is:

1. Normalize the address (checksum preserved) and construct `{ identifier, identifierKind: "Ethereum" }`.
2. Call `client.findInboxIdByIdentifier` and bail if `undefined` (user not registered / wrong network).
3. Call `client.conversations.newDm(inboxId)` with the returned inbox ID.

### Installations & Device Limits

- Every inbox can register **up to 10 installations**. The SDK exposes `client.installationId` and `client.installationIdBytes` for the current device. [^installations]
- Installations are tracked in network state and can be listed through `client.getInboxState()`; revocation requires signing a network-issued challenge (`revokeInstallationsSignatureRequest`). [^revoke]
- Installations publish **key packages**. Peers fetch the latest key package before encrypting messages to your inbox. If an installation’s key package expires or is revoked, peers must fall back to another current installation. [^keypackages]

### Message Flow Recap

1. **Handshake** – When sending to a new inbox, the SDK fetches its key package (one per installation) and caches it locally.
2. **Encrypt & Send** – `conversation.send("hello")` encodes the string with `ContentTypeText` and submits it via the worker.
3. **Streaming** – `client.conversations.streamAllMessages()` yields incoming messages. Each message includes the sending installation’s signature, which the SDK verifies against the inbox/installation metadata.

### Why Converge DMs Fail Right Now

The current conversation creation logic in `src/lib/xmtp/client.ts` is still passing the raw `0x…` address to `client.findInboxIdByIdentifier` and `client.canMessage`, which triggers `get_identity_updates_v2` with a string Postgres cannot parse as hex (`ERROR: invalid hexadecimal digit: "x"`). The fix is:

- Preserve the full checksum address (including `0x`) when you send requests to XMTP.  
  Do **not** strip the prefix before constructing the `Identifier`.  
  Example: `{ identifier: addressChecksum, identifierKind: "Ethereum" }`.
- Rely on `client.findInboxIdByIdentifier` to return the canonical inbox id; pass that inbox id to `client.conversations.newDm`.
- Continue to use `canMessage` only as an availability check (its return keys are inbox ids, not addresses).

Once the address normalization bug is resolved, the message send path (`conversation.send`) should succeed because the SDK handles encoding and publishing under the hood.

> **Tip:** The XMTP APIs expect the identifier string to be raw hex without the `0x` prefix. Passing the checksummed address directly (with `0x`) leads to the Postgres error above. Strip `0x` and lowercase the remainder before invoking `findInboxIdByIdentifier` or `canMessage`.

### References

[^identity]: XMTP Concepts – Identity & Account Identifiers. <https://xmtp.org/docs/build/concepts/identity>
[^inboxes]: XMTP Concepts – Inboxes and Messages. <https://xmtp.org/docs/build/concepts/inbox>
[^installations]: XMTP Concepts – Installations & Device Keys. <https://xmtp.org/docs/build/concepts/installations>
[^chat_signers]: xmtp.chat reference implementation – `packages/client/src/signers.ts`. <https://github.com/xmtp/xmtp-chat/blob/main/packages/client/src/signers.ts>
[^createClient]: XMTP Browser SDK – `createClient` helper (v5.0.1). <https://github.com/xmtp/xmtp-node-js/blob/main/packages/browser-sdk/src/utils/createClient.ts>
[^registration]: XMTP Identity Registration Flow. <https://xmtp.org/docs/build/get-started/account-registration>
[^canMessage]: XMTP Browser SDK – `Client.canMessage`. <https://xmtp.org/docs/build/javascript/conversations#check-if-you-can-message-a-peer>
[^findInbox]: XMTP Browser SDK – `Client.findInboxIdByIdentifier`. <https://xmtp.org/docs/build/javascript/inbox#look-up-inbox-id>
[^inboxState]: XMTP Browser SDK – `Client.getInboxState`. <https://xmtp.org/docs/build/javascript/inbox#inspect-installations>
[^revoke]: XMTP Browser SDK – Revoke Installations. <https://xmtp.org/docs/build/javascript/installations#revoke-installations>
[^keypackages]: XMTP Concepts – Key Packages and Pre-Keys. <https://xmtp.org/docs/build/concepts/key-packages>
