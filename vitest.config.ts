import { configDefaults, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    exclude: [...configDefaults.exclude, 'tests/e2e/**', 'tmp/**'], // include Vitest defaults, skip Playwright, and ignore reference fixtures under tmp
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      reporter: ['text', 'json', 'html', 'json-summary'],
      include: [
        'src/lib/**/*.{ts,tsx}',
        'src/features/messages/MessageBubble.tsx',
        'src/features/conversations/useConversations.ts',
        'src/app/HandleXmtpProtocol.tsx',
        'postcss.config.js',
      ],
      exclude: [
        '**/*.d.ts',
        'tests/**',
        'tmp/**',
        '**/__mocks__/**',
        '**/*.test.*',
        'src/test/setup.ts',
        '**/node_modules/**',
        'dev-dist/**',
        'dist/**',
        'public/**',
        'src/lib/xmtp/client.ts',
        'src/lib/xmtp/resync-state.ts',
        'src/lib/xmtp/utils-singleton.ts',
        'src/lib/sw-bridge/**',
        'src/components/**',
        'scripts/**',
        'src/features/messages/ConversationView.tsx',
        'src/features/messages/MessageActionsModal.tsx',
        'src/features/messages/MessageComposer.tsx',
        'src/features/messages/useMessages.ts',
        'src/features/messages/index.ts',
        'src/lib/storage/dexie-driver.ts',
        'src/lib/utils/debug-console.ts',
        'src/lib/utils/ens.ts',
        'src/lib/utils/useVisualViewport.ts',
        'src/lib/wagmi/config.ts',
        'src/lib/wagmi/hooks.ts',
        'src/lib/wagmi/index.ts',
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@/app': path.resolve(__dirname, './src/app'),
      '@/features': path.resolve(__dirname, './src/features'),
      '@/lib': path.resolve(__dirname, './src/lib'),
      '@/components': path.resolve(__dirname, './src/components'),
      '@/types': path.resolve(__dirname, './src/types'),
    },
  },
});
