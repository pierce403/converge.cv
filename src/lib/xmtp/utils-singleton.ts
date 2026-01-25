export type UtilsLike = {
  inboxStateFromInboxIds: (ids: string[], env: string) => Promise<unknown[]>;
  getInboxIdForIdentifier: (identifier: unknown, env: string) => Promise<string | undefined>;
  generateInboxId: (identifier: unknown) => Promise<string>;
};

export async function getXmtpUtils(): Promise<UtilsLike> {
  const { Client, getInboxIdForIdentifier, generateInboxId } = await import('@xmtp/browser-sdk');
  return {
    inboxStateFromInboxIds: (ids, env) => Client.fetchInboxStates(ids, env as never),
    getInboxIdForIdentifier: (identifier, env) => getInboxIdForIdentifier(identifier as never, env as never),
    generateInboxId: (identifier) => generateInboxId(identifier as never),
  };
}
