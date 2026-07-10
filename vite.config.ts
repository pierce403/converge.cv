import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  base: '/', // Custom domain - use root path
  // Browser SDK resolves its own module worker URL. Vite dependency prebundling
  // rewrites that relationship and leaves the XMTP worker blank in dev mode.
  optimizeDeps: {
    exclude: ['@xmtp/browser-sdk'],
  },
  plugins: [
    react(),
    // Service worker disabled - not needed for XMTP protocol v3 (cthulhu.bot works without it)
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@/app': path.resolve(__dirname, './src/app'),
      '@/features': path.resolve(__dirname, './src/features'),
      '@/lib': path.resolve(__dirname, './src/lib'),
      '@/components': path.resolve(__dirname, './src/components'),
      '@/types': path.resolve(__dirname, './src/types'),
      '@xmtp/wasm-bindings/dist/snippets/diesel-wasm-sqlite-36e85657e47f3be3/src/js/sqlite3-worker1-bundler-friendly.mjs':
        path.resolve(
          __dirname,
          './scripts/templates/sqlite3-worker1-bundler-friendly.mjs',
        ),
    },
  },
  server: {
    port: 3000,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
