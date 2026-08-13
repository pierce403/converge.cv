const HISTORY_ROUTE_PREFIX = '/api/xmtp-history/';
const HISTORY_ROUTE_ROOT = '/api/xmtp-history';
const HISTORY_UPLOAD_PATH = `${HISTORY_ROUTE_PREFIX}upload`;
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
  if (url.pathname !== HISTORY_ROUTE_ROOT && !url.pathname.startsWith(HISTORY_ROUTE_PREFIX)) {
    return fetchAsset(request);
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
