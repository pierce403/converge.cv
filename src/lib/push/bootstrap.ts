export type PushBuildIdentity = {
  version?: string;
  gitHash?: string;
};

/** A release-specific session key makes each deployed build repair topics once. */
export function pushRegistrationRefreshCooldownKey(
  installationId: string,
  build: PushBuildIdentity,
): string {
  const version = build.version?.trim() || 'unknown-version';
  const gitHash = build.gitHash?.trim() || 'unknown-build';
  return `converge.push.refresh.${installationId.trim().toLowerCase()}.${version}.${gitHash}`;
}
