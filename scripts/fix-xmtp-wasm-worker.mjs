import fs from 'fs';
import path from 'path';
import url from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

const projectRoot = path.resolve(__dirname, '..');
const sourceFile = path.join(
  projectRoot,
  'scripts/templates/sqlite3-worker1-bundler-friendly.mjs'
);

if (!fs.existsSync(sourceFile)) {
  console.error('[fix-xmtp-wasm-worker] Source worker stub missing at', sourceFile);
  process.exit(1);
}

const require = createRequire(import.meta.url);

const resolveModulePath = (specifier) => {
  try {
    return require.resolve(specifier, {
      paths: [projectRoot],
    });
  } catch (error) {
    return null;
  }
};

const resolvePackageDir = (specifier) => {
  const resolvedEntry = resolveModulePath(specifier);
  return resolvedEntry ? path.resolve(path.dirname(resolvedEntry), '..') : null;
};

let bindingsRoot = resolvePackageDir('@xmtp/wasm-bindings');

if (!bindingsRoot) {
  const browserSdkRoot = resolvePackageDir('@xmtp/browser-sdk');

  if (browserSdkRoot) {
    const siblingCandidate = path.resolve(browserSdkRoot, '..', 'wasm-bindings');
    const nestedNodeModulesCandidate = path.join(
      browserSdkRoot,
      'node_modules',
      '@xmtp',
      'wasm-bindings'
    );

    if (fs.existsSync(siblingCandidate)) {
      bindingsRoot = siblingCandidate;
    } else if (fs.existsSync(nestedNodeModulesCandidate)) {
      bindingsRoot = nestedNodeModulesCandidate;
    }
  }
}

if (!bindingsRoot) {
  console.error(
    '[fix-xmtp-wasm-worker] Unable to locate @xmtp/wasm-bindings. Have dependencies been installed?'
  );
  process.exit(1);
}

const targetDir = path.join(
  bindingsRoot,
  'dist',
  'snippets',
  'diesel-wasm-sqlite-36e85657e47f3be3',
  'src',
  'js'
);

if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
}

const targetFile = path.join(targetDir, 'sqlite3-worker1-bundler-friendly.mjs');

try {
  const sourceContent = fs.readFileSync(sourceFile, 'utf8');
  const existingContent = fs.existsSync(targetFile)
    ? fs.readFileSync(targetFile, 'utf8')
    : null;

  if (existingContent === sourceContent) {
    console.log('[fix-xmtp-wasm-worker] Worker shim already up to date at', targetFile);
  } else {
    fs.writeFileSync(targetFile, sourceContent, 'utf8');
    console.log('[fix-xmtp-wasm-worker] Wrote worker shim to', targetFile);
  }
} catch (error) {
  console.error('[fix-xmtp-wasm-worker] Failed to write worker shim:', error);
  process.exit(1);
}
