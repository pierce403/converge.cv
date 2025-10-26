// @vitest-environment node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

// Ensure we run in a Node environment without jsdom APIs interfering

describe('fix-xmtp-wasm-worker script', () => {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const projectRoot = path.resolve(__dirname, '..', '..');
  const pnpmStore = path.join(projectRoot, 'node_modules', '.pnpm');
  const templatePath = path.join(
    projectRoot,
    'scripts',
    'templates',
    'sqlite3-worker1-bundler-friendly.mjs',
  );

  const locateWorkerPath = () => {
    const entries = fs
      .readdirSync(pnpmStore, { withFileTypes: true })
      .filter((dirent) => dirent.isDirectory())
      .map((dirent) => dirent.name);

    const wasmBindingsEntry = entries.find((name) => name.startsWith('@xmtp+wasm-bindings@'));
    if (!wasmBindingsEntry) {
      throw new Error('Unable to locate @xmtp/wasm-bindings virtual store entry');
    }

    return path.join(
      pnpmStore,
      wasmBindingsEntry,
      'node_modules',
      '@xmtp',
      'wasm-bindings',
      'dist',
      'snippets',
      'diesel-wasm-sqlite-36e85657e47f3be3',
      'src',
      'js',
      'sqlite3-worker1-bundler-friendly.mjs',
    );
  };

  it('copies the bundler-friendly worker file into @xmtp/wasm-bindings', () => {
    const workerPath = locateWorkerPath();
    const originalContent = fs.existsSync(workerPath) ? fs.readFileSync(workerPath, 'utf8') : null;

    if (fs.existsSync(workerPath)) {
      fs.unlinkSync(workerPath);
    }

    const result = spawnSync('node', ['scripts/fix-xmtp-wasm-worker.mjs'], {
      cwd: projectRoot,
      stdio: 'pipe',
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(fs.existsSync(workerPath)).toBe(true);

    const templateContent = fs.readFileSync(templatePath, 'utf8');
    const workerContent = fs.readFileSync(workerPath, 'utf8');
    expect(workerContent).toBe(templateContent);

    if (originalContent !== null && originalContent !== templateContent) {
      fs.writeFileSync(workerPath, originalContent, 'utf8');
    }
  });
});
