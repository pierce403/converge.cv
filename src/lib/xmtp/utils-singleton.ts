export type UtilsLike = {
  inboxStateFromInboxIds: (ids: string[], env: string) => Promise<unknown[]>;
  getInboxIdForIdentifier: (identifier: unknown, env: string) => Promise<string | undefined>;
  generateInboxId: (identifier: unknown) => string;
};

let utilsInstance: unknown | null = null;

export async function getXmtpUtils(): Promise<UtilsLike> {
  if (!utilsInstance) {
    const { Utils } = await import('@xmtp/browser-sdk');
    utilsInstance = new Utils(false);
  }
  return utilsInstance as UtilsLike;
}
