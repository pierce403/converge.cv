export interface XmtpBrowserSdkRuntimeSources {
  indexSource: string;
  workerSource: string;
}

export const XMTP_BROWSER_SDK_VERSION: string;
export const XMTP_DIRECT_API_LITERAL: string;
export const XMTP_SAME_ORIGIN_API_EXPRESSION: string;
export const XMTP_CLIENT_INIT_ORIGINAL: string;
export const XMTP_CLIENT_INIT_PATCHED: string;

export function patchXmtpBrowserSdkRuntime(
  sources: XmtpBrowserSdkRuntimeSources
): XmtpBrowserSdkRuntimeSources;

export function patchInstalledXmtpBrowserSdk(): void;
