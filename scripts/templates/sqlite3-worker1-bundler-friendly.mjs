// Custom bundler-friendly worker entry for XMTP's wa-sqlite bindings.
//
// This mirrors the upstream sqlite.org helper. The published
// @xmtp/wasm-bindings package (v0.0.1) omits this file, which breaks
// bundlers when they attempt to resolve the worker entry. We recreate the
// worker bootstrap here using the same initialization steps expected by
// `sqlite3Worker1Promiser`.

import './wa-sqlite-diesel-bundle.js';
import './sqlite3-opfs-async-proxy.js';

const initModule = self.sqlite3InitModule;

if (typeof initModule !== 'function') {
  throw new Error('sqlite3InitModule was not registered on the worker global scope');
}

initModule().catch((error) => {
  console.error('Failed to initialize sqlite3 worker', error);
  throw error;
});
