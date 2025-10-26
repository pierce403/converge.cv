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

let bindingsDir;
try {
  const pnpmRoot = path.join(projectRoot, 'node_modules', '.pnpm');
  const entries = fs
    .readdirSync(pnpmRoot, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => dirent.name);
  const wasmBindingEntry = entries.find((name) =>
    name.startsWith('@xmtp+wasm-bindings@')
  );
  if (!wasmBindingEntry) {
    throw new Error('pnpm virtual store missing @xmtp/wasm-bindings entry');
  }
  bindingsDir = path.join(
    pnpmRoot,
    wasmBindingEntry,
    'node_modules',
    '@xmtp',
    'wasm-bindings',
    'dist'
  );
} catch (error) {
  console.error('[fix-xmtp-wasm-worker] Unable to locate @xmtp/wasm-bindings:', error);
  process.exit(1);
}

const targetDir = path.join(
  bindingsDir,
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
  fs.writeFileSync(targetFile, sourceContent, 'utf8');
  console.log('[fix-xmtp-wasm-worker] Wrote worker shim to', targetFile);
} catch (error) {
  console.error('[fix-xmtp-wasm-worker] Failed to write worker shim:', error);
  process.exit(1);
}
