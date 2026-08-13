import { describe, expect, it, vi } from 'vitest';
import { handleRequest } from './index';

const APP_ORIGIN = 'https://converge.cv';
const FILE_ID = '01234567-89ab-cdef-0123-456789abcdef';
const UPSTREAM = 'https://message-history.production.ephemera.network';

type FetchAsset = Parameters<typeof handleRequest>[1];
type FetchUpstream = Parameters<typeof handleRequest>[2];

const assetFetch = () => vi.fn<FetchAsset>(async () => new Response('asset'));
const sameOriginHeaders = (method: 'GET' | 'POST') => {
  const headers = new Headers({ 'Sec-Fetch-Site': 'same-origin' });
  if (method === 'POST') headers.set('Origin', APP_ORIGIN);
  return headers;
};

describe('XMTP history Worker', () => {
  it.each(['/settings', '/api/xmtp-historyevil'])(
    'leaves non-history traffic on the static asset path: %s',
    async (path) => {
      const fetchAsset = assetFetch();
      const fetchUpstream = vi.fn<FetchUpstream>();
      const request = new Request(`${APP_ORIGIN}${path}`);

      const response = await handleRequest(request, fetchAsset, fetchUpstream);

      expect(await response.text()).toBe('asset');
      expect(fetchAsset).toHaveBeenCalledWith(request);
      expect(fetchUpstream).not.toHaveBeenCalled();
    }
  );

  it('streams an upload body to the fixed upstream without forwarding credentials', async () => {
    const fetchAsset = assetFetch();
    const upstreamBody = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(FILE_ID));
        controller.close();
      },
    });
    const upstreamResponse = new Response(upstreamBody, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'text/plain',
        'Set-Cookie': 'do-not-forward=true',
      },
    });
    const fetchUpstream = vi.fn<FetchUpstream>(async () => upstreamResponse);
    const headers = sameOriginHeaders('POST');
    headers.set('Authorization', 'do-not-forward');
    headers.set('Cookie', 'do-not-forward=true');
    headers.set('Content-Type', 'application/octet-stream');
    const request = new Request(`${APP_ORIGIN}/api/xmtp-history/upload`, {
      method: 'POST',
      headers,
      body: new Uint8Array([1, 2, 3]),
    });
    const requestBody = request.body;

    const response = await handleRequest(request, fetchAsset, fetchUpstream);

    expect(fetchAsset).not.toHaveBeenCalled();
    expect(fetchUpstream).toHaveBeenCalledOnce();
    const [url, init] = fetchUpstream.mock.calls[0];
    expect(url).toBe(`${UPSTREAM}/upload`);
    expect(init).toMatchObject({
      method: 'POST',
      body: requestBody,
      cache: 'no-store',
      redirect: 'manual',
    });
    expect(Object.fromEntries(new Headers(init?.headers))).toEqual({
      accept: 'application/octet-stream',
      'content-type': 'application/octet-stream',
    });
    expect(response.body).toBe(upstreamResponse.body);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('Set-Cookie')).toBeNull();
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('streams a canonical UUID download from the fixed upstream', async () => {
    const fetchAsset = assetFetch();
    const fetchUpstream = vi.fn<FetchUpstream>(
      async () =>
        new Response(new Uint8Array([4, 5, 6]), {
          headers: { 'Content-Type': 'application/octet-stream' },
        })
    );
    const request = new Request(`${APP_ORIGIN}/api/xmtp-history/files/${FILE_ID.toUpperCase()}`, {
      headers: sameOriginHeaders('GET'),
    });

    const response = await handleRequest(request, fetchAsset, fetchUpstream);

    const [url, init] = fetchUpstream.mock.calls[0];
    expect(url).toBe(`${UPSTREAM}/files/${FILE_ID}`);
    expect(init).toMatchObject({
      method: 'GET',
      body: null,
      cache: 'no-store',
      redirect: 'manual',
    });
    expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual([4, 5, 6]);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(response.headers.get('Cross-Origin-Resource-Policy')).toBe('cross-origin');
  });

  it.each([
    { headers: new Headers(), label: 'native request' },
    {
      headers: new Headers({
        Origin: 'https://other-client.example',
        'Sec-Fetch-Site': 'cross-site',
      }),
      label: 'cross-origin browser request',
    },
  ])('allows a UUID download from a $label', async ({ headers }) => {
    const fetchUpstream = vi.fn<FetchUpstream>(async () => new Response(new Uint8Array([7])));
    const response = await handleRequest(
      new Request(`${APP_ORIGIN}/api/xmtp-history/files/${FILE_ID}`, {
        headers,
      }),
      assetFetch(),
      fetchUpstream
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(fetchUpstream).toHaveBeenCalledOnce();
  });

  it.each([
    ['/api/xmtp-history/upload', 'GET', 'POST'],
    [`/api/xmtp-history/files/${FILE_ID}`, 'POST', 'GET'],
    [`/api/xmtp-history/files/${FILE_ID}`, 'HEAD', 'GET'],
  ])('rejects %s with %s', async (path, method, allowedMethod) => {
    const fetchUpstream = vi.fn<FetchUpstream>();
    const response = await handleRequest(
      new Request(`${APP_ORIGIN}${path}`, {
        method,
        headers: sameOriginHeaders(method === 'POST' ? 'POST' : 'GET'),
      }),
      assetFetch(),
      fetchUpstream
    );

    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe(allowedMethod);
    expect(fetchUpstream).not.toHaveBeenCalled();
  });

  it.each([
    '/api/xmtp-history/files/not-a-uuid',
    `/api/xmtp-history/files/${FILE_ID}/extra`,
    `/api/xmtp-history/files/${FILE_ID}?download=true`,
    '/api/xmtp-history/upload/',
  ])('rejects a non-canonical history path: %s', async (path) => {
    const fetchUpstream = vi.fn<FetchUpstream>();
    const response = await handleRequest(
      new Request(`${APP_ORIGIN}${path}`, {
        headers: sameOriginHeaders('GET'),
      }),
      assetFetch(),
      fetchUpstream
    );

    expect(response.status).toBe(404);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(fetchUpstream).not.toHaveBeenCalled();
  });

  it.each([
    ['https://attacker.example', 'cross-site'],
    [undefined, undefined],
    [APP_ORIGIN, 'same-site'],
  ])('rejects upload browser context origin=%s site=%s', async (origin, fetchSite) => {
    const headers = new Headers();
    if (origin) headers.set('Origin', origin);
    if (fetchSite) headers.set('Sec-Fetch-Site', fetchSite);
    const fetchUpstream = vi.fn<FetchUpstream>();
    const response = await handleRequest(
      new Request(`${APP_ORIGIN}/api/xmtp-history/upload`, {
        method: 'POST',
        headers,
        body: new Uint8Array([1]),
      }),
      assetFetch(),
      fetchUpstream
    );

    expect(response.status).toBe(403);
    expect(fetchUpstream).not.toHaveBeenCalled();
  });

  it('rejects an oversized upload before reading or forwarding its body', async () => {
    const fetchUpstream = vi.fn<FetchUpstream>();
    const headers = sameOriginHeaders('POST');
    headers.set('Content-Length', '15000001');
    const response = await handleRequest(
      new Request(`${APP_ORIGIN}/api/xmtp-history/upload`, {
        method: 'POST',
        headers,
        body: new Uint8Array([1]),
      }),
      assetFetch(),
      fetchUpstream
    );

    expect(response.status).toBe(413);
    expect(fetchUpstream).not.toHaveBeenCalled();
  });

  it('fails closed at the bare history route', async () => {
    const fetchAsset = assetFetch();
    const fetchUpstream = vi.fn<FetchUpstream>();
    const response = await handleRequest(
      new Request(`${APP_ORIGIN}/api/xmtp-history`),
      fetchAsset,
      fetchUpstream
    );

    expect(response.status).toBe(404);
    expect(fetchAsset).not.toHaveBeenCalled();
    expect(fetchUpstream).not.toHaveBeenCalled();
  });

  it('returns a generic no-store error when the upstream is unavailable', async () => {
    const fetchUpstream = vi.fn<FetchUpstream>(async () => {
      throw new Error(`sensitive ${FILE_ID}`);
    });
    const response = await handleRequest(
      new Request(`${APP_ORIGIN}/api/xmtp-history/upload`, {
        method: 'POST',
        headers: sameOriginHeaders('POST'),
        body: new Uint8Array([1]),
      }),
      assetFetch(),
      fetchUpstream
    );

    expect(response.status).toBe(502);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.text()).toBe('History service unavailable');
  });
});
