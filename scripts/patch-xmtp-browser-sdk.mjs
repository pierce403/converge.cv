import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);

export const XMTP_BROWSER_SDK_VERSION = '6.1.2';
export const XMTP_DIRECT_API_LITERAL = '"https://api.production.xmtp.network:5558"';
export const XMTP_SAME_ORIGIN_API_EXPRESSION =
  '(globalThis.location?.origin||"https://converge.cv")+"/api/xmtp"';
export const XMTP_CLIENT_INIT_ORIGINAL = 'u=await t(o,c,d,e)||s(e)';
export const XMTP_CLIENT_INIT_PATCHED = 'u=a?.knownInboxId||await t(o,c,d,e)||s(e)';

const countOccurrences = (source, value) => source.split(value).length - 1;

const replacePinnedExpression = (source, original, patched, label) => {
  const originalCount = countOccurrences(source, original);
  const patchedCount = countOccurrences(source, patched);
  if (originalCount === 0 && patchedCount === 1) {
    return source;
  }
  if (originalCount !== 1 || patchedCount !== 0) {
    throw new Error(
      `${label} did not match the pinned @xmtp/browser-sdk@${XMTP_BROWSER_SDK_VERSION} runtime`
    );
  }
  return source.replace(original, patched);
};

export const patchXmtpBrowserSdkRuntime = ({ indexSource, workerSource }) => ({
  indexSource: replacePinnedExpression(
    indexSource,
    XMTP_DIRECT_API_LITERAL,
    XMTP_SAME_ORIGIN_API_EXPRESSION,
    'Browser SDK main API URL'
  ),
  workerSource: replacePinnedExpression(
    replacePinnedExpression(
      workerSource,
      XMTP_DIRECT_API_LITERAL,
      XMTP_SAME_ORIGIN_API_EXPRESSION,
      'Browser SDK worker API URL'
    ),
    XMTP_CLIENT_INIT_ORIGINAL,
    XMTP_CLIENT_INIT_PATCHED,
    'Browser SDK known-inbox client initialization'
  ),
});

const resolveBrowserSdkRoot = () => {
  const packageJsonPath = require.resolve('@xmtp/browser-sdk/package.json', {
    paths: [projectRoot],
  });
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  if (packageJson.version !== XMTP_BROWSER_SDK_VERSION) {
    throw new Error(
      `Expected @xmtp/browser-sdk@${XMTP_BROWSER_SDK_VERSION}, found ${packageJson.version ?? 'unknown'}`
    );
  }
  return path.dirname(packageJsonPath);
};

export const patchInstalledXmtpBrowserSdk = () => {
  const browserSdkRoot = resolveBrowserSdkRoot();
  const indexPath = path.join(browserSdkRoot, 'dist', 'index.js');
  const workerPath = path.join(browserSdkRoot, 'dist', 'workers', 'client.js');
  const originalIndex = fs.readFileSync(indexPath, 'utf8');
  const originalWorker = fs.readFileSync(workerPath, 'utf8');
  const patched = patchXmtpBrowserSdkRuntime({
    indexSource: originalIndex,
    workerSource: originalWorker,
  });

  if (patched.indexSource !== originalIndex) {
    fs.writeFileSync(indexPath, patched.indexSource, 'utf8');
  }
  if (patched.workerSource !== originalWorker) {
    fs.writeFileSync(workerPath, patched.workerSource, 'utf8');
  }

  console.log(
    '[patch-xmtp-browser-sdk] XMTP production traffic uses /api/xmtp and trusted known-inbox initialization is enabled.'
  );
};

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === url.fileURLToPath(import.meta.url)) {
  try {
    patchInstalledXmtpBrowserSdk();
  } catch (error) {
    console.error('[patch-xmtp-browser-sdk] Failed to patch the pinned Browser SDK:', error);
    process.exit(1);
  }
}
