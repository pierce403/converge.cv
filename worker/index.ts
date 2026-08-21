const HISTORY_ROUTE_PREFIX = '/api/xmtp-history/';
const HISTORY_ROUTE_ROOT = '/api/xmtp-history';
const HISTORY_UPLOAD_PATH = `${HISTORY_ROUTE_PREFIX}upload`;
const XMTP_PROXY_ROUTE_PREFIX = '/api/xmtp/';
const XMTP_PROXY_ROUTE_ROOT = '/api/xmtp';
const XMTP_API_UPSTREAM = 'https://api.production.xmtp.network:5558';
const XMTP_RPC_PATH = /^\/xmtp\.[A-Za-z0-9._]+\/[A-Za-z0-9_]+$/;
const HISTORY_FILE_PATH = new RegExp(
  `^${HISTORY_ROUTE_PREFIX}files/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$`,
  'i'
);
const HISTORY_UPSTREAM = 'https://message-history.production.ephemera.network';
const MAX_UPLOAD_BYTES = 15_000_000;

type FetchUpstream = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type FetchAsset = (request: Request) => Promise<Response>;

const secureHeaders = (contentType = 'text/plain; charset=utf-8', crossOrigin = false) => {
  const headers = new Headers({
    'Cache-Control': 'no-store',
    'Content-Type': contentType,
    'Cross-Origin-Resource-Policy': crossOrigin ? 'cross-origin' : 'same-origin',
    'Referrer-Policy': 'no-referrer',
    Vary: 'Origin, Sec-Fetch-Site',
    'X-Content-Type-Options': 'nosniff',
  });
  if (crossOrigin) headers.set('Access-Control-Allow-Origin', '*');
  return headers;
};

const plainResponse = (
  body: string,
  status: number,
  extraHeaders?: HeadersInit,
  crossOrigin = false
) => {
  const headers = secureHeaders(undefined, crossOrigin);
  if (extraHeaders) {
    new Headers(extraHeaders).forEach((value, name) => headers.set(name, value));
  }
  return new Response(body, { status, headers });
};

const isSameOriginUpload = (request: Request, url: URL) => {
  const origin = request.headers.get('Origin');
  const fetchSite = request.headers.get('Sec-Fetch-Site');

  if (origin !== null && origin !== url.origin) return false;
  if (fetchSite !== null && fetchSite !== 'same-origin') return false;

  return origin === url.origin;
};

const isSameOriginXmtpRequest = (request: Request, url: URL) => {
  const origin = request.headers.get('Origin');
  const fetchSite = request.headers.get('Sec-Fetch-Site');

  if (origin !== url.origin) return false;
  if (fetchSite !== null && fetchSite !== 'same-origin') return false;

  return true;
};

const xmtpRequestHeaders = (request: Request) => {
  const headers = new Headers();
  for (const [name, value] of request.headers) {
    const normalized = name.toLowerCase();
    if (
      normalized === 'accept' ||
      normalized === 'content-type' ||
      normalized === 'grpc-timeout' ||
      normalized.startsWith('grpc-') ||
      normalized.startsWith('x-app-') ||
      normalized.startsWith('x-client-') ||
      normalized.startsWith('x-grpc-') ||
      normalized.startsWith('x-xmtp-') ||
      normalized === 'x-user-agent'
    ) {
      headers.set(name, value);
    }
  }
  return headers;
};

const xmtpProxyResponse = (upstream: Response) => {
  const headers = new Headers(upstream.headers);
  headers.delete('Set-Cookie');
  headers.set('Cache-Control', 'no-store');
  headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('Vary', 'Origin, Sec-Fetch-Site');
  headers.set('X-Content-Type-Options', 'nosniff');
  const body = [101, 204, 205, 304].includes(upstream.status) ? null : upstream.body;

  return new Response(body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
};

const handleXmtpProxyRequest = async (
  request: Request,
  url: URL,
  fetchUpstream: FetchUpstream
) => {
  const upstreamPath = url.pathname.slice(XMTP_PROXY_ROUTE_ROOT.length);
  if (url.search !== '' || !XMTP_RPC_PATH.test(upstreamPath)) {
    return plainResponse('Not Found', 404);
  }
  if (request.method !== 'POST') {
    return plainResponse('Method Not Allowed', 405, { Allow: 'POST' });
  }
  if (!isSameOriginXmtpRequest(request, url)) {
    return plainResponse('Forbidden', 403);
  }

  try {
    const upstream = await fetchUpstream(`${XMTP_API_UPSTREAM}${upstreamPath}`, {
      method: 'POST',
      headers: xmtpRequestHeaders(request),
      body: request.body,
      cache: 'no-store',
      redirect: 'manual',
    });
    return xmtpProxyResponse(upstream);
  } catch {
    return plainResponse('XMTP service unavailable', 502);
  }
};

const proxyResponse = (upstream: Response, crossOrigin: boolean) => {
  const headers = secureHeaders(
    upstream.headers.get('Content-Type') ?? 'application/octet-stream',
    crossOrigin
  );
  const body = [101, 204, 205, 304].includes(upstream.status) ? null : upstream.body;

  return new Response(body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
};

export const handleRequest = async (
  request: Request,
  fetchAsset: FetchAsset,
  fetchUpstream: FetchUpstream
): Promise<Response> => {
  const url = new URL(request.url);
  const isHistoryRoute =
    url.pathname === HISTORY_ROUTE_ROOT || url.pathname.startsWith(HISTORY_ROUTE_PREFIX);
  const isXmtpProxyRoute =
    url.pathname === XMTP_PROXY_ROUTE_ROOT || url.pathname.startsWith(XMTP_PROXY_ROUTE_PREFIX);
  if (!isHistoryRoute && !isXmtpProxyRoute) {
    return fetchAsset(request);
  }

  if (isXmtpProxyRoute) {
    return handleXmtpProxyRequest(request, url, fetchUpstream);
  }

  const fileMatch = HISTORY_FILE_PATH.exec(url.pathname);
  const isUpload = url.pathname === HISTORY_UPLOAD_PATH;
  if ((!isUpload && !fileMatch) || url.search !== '') {
    return plainResponse('Not Found', 404);
  }

  const expectedMethod = isUpload ? 'POST' : 'GET';
  if (request.method !== expectedMethod) {
    return plainResponse('Method Not Allowed', 405, {
      Allow: expectedMethod,
    });
  }

  if (isUpload && !isSameOriginUpload(request, url)) {
    return plainResponse('Forbidden', 403);
  }

  if (isUpload) {
    const contentLength = request.headers.get('Content-Length');
    if (contentLength !== null) {
      const parsedLength = Number(contentLength);
      if (!Number.isSafeInteger(parsedLength) || parsedLength < 0) {
        return plainResponse('Invalid Content-Length', 400);
      }
      if (parsedLength > MAX_UPLOAD_BYTES) {
        return plainResponse('Payload Too Large', 413);
      }
    }
  }

  const upstreamUrl = isUpload
    ? `${HISTORY_UPSTREAM}/upload`
    : `${HISTORY_UPSTREAM}/files/${fileMatch![1].toLowerCase()}`;
  const headers = new Headers({ Accept: 'application/octet-stream' });
  const contentType = request.headers.get('Content-Type');
  if (contentType) headers.set('Content-Type', contentType);

  try {
    const upstream = await fetchUpstream(upstreamUrl, {
      method: expectedMethod,
      headers,
      body: isUpload ? request.body : null,
      cache: 'no-store',
      redirect: 'manual',
    });
    return proxyResponse(upstream, !isUpload);
  } catch {
    return plainResponse('History service unavailable', 502, undefined, !isUpload);
  }
};

export default {
  fetch(request, env) {
    return handleRequest(
      request,
      (assetRequest) => env.ASSETS.fetch(assetRequest),
      (input, init) => fetch(input, init)
    );
  },
} satisfies ExportedHandler<Env>;
