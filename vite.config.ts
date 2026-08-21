import { defineConfig, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

const xmtpHistoryUpstream = 'https://message-history.production.ephemera.network';
const xmtpApiUpstream = 'https://api.production.xmtp.network:5558';
const maxXmtpHistoryUploadBytes = 15_000_000;
const xmtpRpcPath = /^\/xmtp\.[A-Za-z0-9._]+\/[A-Za-z0-9_]+$/;

const xmtpHistoryProxy = (
  method: 'GET' | 'POST',
  rewrite: (path: string) => string
): ProxyOptions => ({
  target: xmtpHistoryUpstream,
  changeOrigin: true,
  secure: true,
  rewrite,
  bypass(request, response) {
    if (!response) return false;

    const origin = request.headers.origin;
    const fetchSite = request.headers['sec-fetch-site'];
    const host = request.headers.host;
    let originMatches = false;
    if (origin && host) {
      try {
        originMatches = new URL(origin).host === host;
      } catch {
        originMatches = false;
      }
    }
    const sameOrigin = originMatches && fetchSite !== 'cross-origin' && fetchSite !== 'same-site';
    const contentLength = request.headers['content-length'];
    const parsedLength = contentLength === undefined ? 0 : Number(contentLength);
    const validLength =
      Number.isSafeInteger(parsedLength) &&
      parsedLength >= 0 &&
      parsedLength <= maxXmtpHistoryUploadBytes;

    if (request.method === method && (method === 'GET' || (sameOrigin && validLength))) {
      return;
    }

    const status = request.method !== method ? 405 : !validLength ? 413 : 403;
    response.writeHead(status, {
      Allow: method,
      'Cache-Control': 'no-store',
      'Content-Type': 'text/plain; charset=utf-8',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(
      status === 403 ? 'Forbidden' : status === 413 ? 'Payload Too Large' : 'Method Not Allowed'
    );
    return request.url ?? '/';
  },
  configure(proxy) {
    proxy.on('proxyReq', (proxyRequest) => {
      proxyRequest.removeHeader('authorization');
      proxyRequest.removeHeader('cookie');
      proxyRequest.removeHeader('origin');
      proxyRequest.removeHeader('referer');
    });
    proxy.on('proxyRes', (proxyResponse) => {
      delete proxyResponse.headers['access-control-allow-origin'];
      delete proxyResponse.headers['set-cookie'];
      proxyResponse.headers['cache-control'] = 'no-store';
      proxyResponse.headers['cross-origin-resource-policy'] =
        method === 'GET' ? 'cross-origin' : 'same-origin';
      if (method === 'GET') {
        proxyResponse.headers['access-control-allow-origin'] = '*';
      }
      proxyResponse.headers['referrer-policy'] = 'no-referrer';
      proxyResponse.headers['x-content-type-options'] = 'nosniff';
    });
  },
});

const rejectXmtpHistoryProxy: ProxyOptions = {
  target: xmtpHistoryUpstream,
  bypass(request, response) {
    if (!response) return false;
    response.writeHead(404, {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end('Not Found');
    return request.url ?? '/';
  },
};

const xmtpApiProxy = (): ProxyOptions => ({
  target: xmtpApiUpstream,
  changeOrigin: true,
  secure: true,
  rewrite: (requestPath) => requestPath.replace(/^\/api\/xmtp/, ''),
  bypass(request, response) {
    if (!response) return false;

    const requestUrl = new URL(request.url ?? '/', 'http://vite.local');
    const upstreamPath = requestUrl.pathname.replace(/^\/api\/xmtp/, '');
    const origin = request.headers.origin;
    const fetchSite = request.headers['sec-fetch-site'];
    const host = request.headers.host;
    let sameOrigin = false;
    if (origin && host) {
      try {
        sameOrigin = new URL(origin).host === host;
      } catch {
        sameOrigin = false;
      }
    }

    const validPath = requestUrl.search === '' && xmtpRpcPath.test(upstreamPath);
    const validOrigin = sameOrigin && fetchSite !== 'cross-origin' && fetchSite !== 'same-site';
    if (validPath && request.method === 'POST' && validOrigin) return;

    const status = !validPath ? 404 : request.method !== 'POST' ? 405 : 403;
    response.writeHead(status, {
      Allow: 'POST',
      'Cache-Control': 'no-store',
      'Content-Type': 'text/plain; charset=utf-8',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(
      status === 404 ? 'Not Found' : status === 405 ? 'Method Not Allowed' : 'Forbidden'
    );
    return request.url ?? '/';
  },
  configure(proxy) {
    proxy.on('proxyReq', (proxyRequest) => {
      proxyRequest.removeHeader('authorization');
      proxyRequest.removeHeader('cookie');
      proxyRequest.removeHeader('origin');
      proxyRequest.removeHeader('referer');
    });
    proxy.on('proxyRes', (proxyResponse) => {
      delete proxyResponse.headers['set-cookie'];
      proxyResponse.headers['cache-control'] = 'no-store';
      proxyResponse.headers['cross-origin-resource-policy'] = 'same-origin';
      proxyResponse.headers['referrer-policy'] = 'no-referrer';
      proxyResponse.headers['x-content-type-options'] = 'nosniff';
    });
  },
});

const createApiProxyRoutes = () => ({
  '^/api/xmtp-history/upload$': xmtpHistoryProxy('POST', () => '/upload'),
  '^/api/xmtp-history/files/[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$':
    xmtpHistoryProxy('GET', (requestPath) =>
      requestPath.replace(/^\/api\/xmtp-history/, '').toLowerCase()
    ),
  '^/api/xmtp-history(?:/.*)?$': rejectXmtpHistoryProxy,
  '^/api/xmtp(?:/.*)?$': xmtpApiProxy(),
});

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
    // Push and isolation use the hand-authored public/sw.js. App-shell
    // precaching through a Vite PWA plugin remains intentionally disabled.
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
        path.resolve(__dirname, './scripts/templates/sqlite3-worker1-bundler-friendly.mjs'),
    },
  },
  server: {
    port: 3000,
    proxy: createApiProxyRoutes(),
  },
  preview: {
    proxy: createApiProxyRoutes(),
  },
  build: {
    outDir: 'dist',
    // Production source maps previously shipped the full application source.
    // Keep them local to development unless a private upload path is added.
    sourcemap: false,
  },
});
