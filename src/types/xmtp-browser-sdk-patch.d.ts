import '@xmtp/browser-sdk';

declare module '@xmtp/browser-sdk' {
  interface OtherOptions {
    /**
     * Converge-only pinned SDK extension. Use only after independently verifying
     * the exact inbox and signer authority from fresh XMTP network state.
     */
    knownInboxId?: string;
  }
}
