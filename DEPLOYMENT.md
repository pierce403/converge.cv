# Deployment Guide for Converge.cv

Converge is an assets-only Cloudflare Worker. The production Worker owns the
`converge.cv` Custom Domain; `converge-miniapp` is a separate Worker at
`miniapp.converge.cv`. Do not combine the two apps under one Worker or wildcard
route because their service workers, IndexedDB, OPFS, and XMTP installations
must remain origin-isolated.

The canonical app origin is the apex. Leave `www.converge.cv` absent unless a
Cloudflare Redirect Rule sends it directly to `https://converge.cv`; never serve
a second copy of the app there because it would create a separate browser data
and XMTP installation namespace.

## Repository Contract

- `wrangler.jsonc` defines the production and preview Workers.
- `dist/` is the deployed Static Assets directory.
- `assets.not_found_handling` serves `index.html` with `200` for React routes.
- `public/_headers` sets security, immutable hashed-asset caching, root QR-camera
  access, and no-cache service-worker behavior.
- GitHub Actions runs the provider-neutral CI gate, including a Wrangler
  production-manifest dry run. Cloudflare Workers Builds or an authenticated
  operator performs deployment; GitHub Pages is no longer a deployment target.
- `CNAME`, `.nojekyll`, and the GitHub Pages `404.html` redirect shim are not part
  of the Cloudflare build.

## Live State (2026-07-15)

- `converge-cv` serves `https://converge.cv` as a Worker Custom Domain.
- `converge-miniapp` independently serves `https://miniapp.converge.cv`.
- The zone has **Always Use HTTPS** enabled. Both application hosts redirect
  HTTP to the same HTTPS path and query before the Worker handles the request.
- The zone-level `http_config_settings` ruleset disables automatic Cloudflare
  Web Analytics injection for `converge.cv` and `miniapp.converge.cv`. Keep
  Workers observability and server-side analytics separate from browser RUM.
- The five Namecheap forwarding MX records and the SPF TXT record are present in
  the Cloudflare zone and remain DNS-only.
- Each repository has a main-only Cloudflare Workers Builds trigger. Cloudflare
  pulls source through its GitHub App, runs the repository gate, and deploys with
  a Cloudflare-owned scoped build token.
- GitHub Actions is read-only CI. Do not add Cloudflare API tokens, account
  credentials, or deployment secrets to GitHub Actions or GitHub repository
  secrets.

## Local Verification

Requirements: Node.js 22 and the pnpm version pinned by `packageManager`.

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm preview:cloudflare
```

The Cloudflare preview serves the production bundle with the same SPA routing
and `_headers` rules used at the edge. Verify `/`, `/debug`, `/sw.js`, the web
manifest, the XMTP WASM asset, and at least one hashed JavaScript asset.

## First Cloudflare Deployment

1. Add the `converge.cv` zone to the intended Cloudflare account and preserve
   every existing DNS record, especially MX, SPF, DKIM, DMARC, and unrelated
   subdomains.

   The pre-cutover Namecheap email-forwarding records are:

   ```text
   @  MX  10  eforward1.registrar-servers.com
   @  MX  10  eforward2.registrar-servers.com
   @  MX  10  eforward3.registrar-servers.com
   @  MX  15  eforward4.registrar-servers.com
   @  MX  20  eforward5.registrar-servers.com
   @  TXT     "v=spf1 include:spf.efwd.registrar-servers.com ~all"
   ```

   Keep MX records DNS-only. Verify them from a Cloudflare authoritative
   nameserver before relying on recursive resolvers, which may retain the old
   delegation for its full TTL.
2. Change the registrar nameservers and wait until Cloudflare marks the zone
   active. A recursive resolver changing early is not sufficient; verify the
   `.cv` parent delegation.
3. Authenticate Wrangler against that account.
4. Deploy the isolated preview Worker:

   ```bash
   pnpm run deploy:preview
   ```

5. Smoke-test the returned `workers.dev` URL. Preview responses carry
   `X-Robots-Tag: noindex`.
6. Deploy production only after preview verification and zone activation:

   ```bash
   pnpm run deploy
   ```

The production configuration uses a Worker Custom Domain. Do not create a
competing apex CNAME first; Cloudflare creates the DNS record and certificate
when it attaches the Custom Domain.

## Automatic Deployments

Use Cloudflare Workers Builds for production deployment so Cloudflare owns the
build credential and GitHub retains CI only:

1. Create or open the `converge-cv` Worker in **Workers & Pages**.
2. Connect `pierce403/converge.cv` under **Settings > Build**.
3. Select production branch `main` and repository root `/`.
4. Use build command `pnpm check`.
5. Use deploy command `pnpm exec wrangler deploy --env=""`.
6. Enable build caching. The checked-in `.nvmrc` selects Node.js 22 and
   `packageManager` pins pnpm.

Workers Builds creates and retains its own scoped API token. Do not add a fake
token, account ID, private VAPID key, or other credential to this repository or
to GitHub Actions. GitHub grants the Cloudflare GitHub App repository access;
Cloudflare performs the checkout, build, and deployment inside Cloudflare.

## Environment Variables

Converge is static. Only browser-public `VITE_*` values may enter its build:

- `VITE_VAPID_PARTY_API_BASE` selects the public vapid.party API origin.
- `VITE_VAPID_PUBLIC_KEY` is an optional public-key override; normal production
  fetches the public key from vapid.party.
- `VITE_WALLETCONNECT_PROJECT_ID` enables WalletConnect/Reown.
- `VITE_THIRDWEB_CLIENT_ID` enables the current attachment upload provider.
- `VITE_NEYNAR_API_KEY`, `VITE_FARCASTER_API_BASE`, `VITE_MAINNET_RPC_URLS`, and
  `VITE_OG_BASE` are optional public client configuration.

Never place server credentials, private VAPID material, or XMTP private keys in
a `VITE_*` variable.

## Cutover Verification

After attaching `converge.cv`, verify all of the following before removing the
old GitHub Pages custom-domain setting:

```bash
curl -fsSI https://converge.cv/
curl -fsSI https://converge.cv/debug
curl -fsSI https://converge.cv/sw.js
curl -fsSI https://converge.cv/manifest.json
```

- `/` and `/debug` return `200` from Cloudflare, not `server: GitHub.com`.
- HTML includes the checked-in security headers without Cloudflare HTML
  transformations, Rocket Loader, Zaraz, or challenge injection.
- A clean browser records no `static.cloudflareinsights.com` request, no
  `/cdn-cgi/rum` request, and no injected `data-cf-beacon` markup.
- `/sw.js` includes `Cache-Control: no-cache, no-store, must-revalidate` and
  `Service-Worker-Allowed: /`.
- Hashed `/assets/*` responses are immutable.
- The existing inbox reopens without a new XMTP installation. Keeping the exact
  `https://converge.cv` origin preserves browser IndexedDB, OPFS, service-worker,
  and Push API state across the hosting-provider change.
- Push Trace can run its local display test, relay test, and current-inbox route
  refresh without creating a second physical subscription.
- Direct navigation and refresh work for `/debug` and conversation routes.

Keep the old GitHub Pages artifact available until this checklist passes. DNS
rollback changes the origin server, not the browser origin, so it does not erase
local Converge state.

## Rollback

List and restore a known-good Worker version:

```bash
pnpm exec wrangler deployments list --name converge-cv
pnpm exec wrangler rollback VERSION_ID --name converge-cv --message "rollback: describe reason"
```

After rollback, repeat the cutover verification, including `/debug`, `/sw.js`,
inbox reopen, and Push Trace.

## Security Reality

XMTP encrypts message transport end to end, but Converge currently stores local
private keys, mnemonics, decrypted app data, attachment caches, and the Browser
SDK database without encryption at rest. Keyfile exports contain plaintext
recovery material. Hosting the static bundle on Cloudflare does not change those
local-storage properties and does not move decrypted messages to Cloudflare.
