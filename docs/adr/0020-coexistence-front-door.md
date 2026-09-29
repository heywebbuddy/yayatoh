# ADR 0020 — Coexistence front door: Next.js proxy.ts forwards with fetch; Cloudflare Worker only as fallback

- **Status:** Proposed (M2.4a, 2026-09-29). Implements ADR 0006's "Next.js front door". Pending owner: the preview spike on Vercel (below) before any DNS change.

## Context
- Roadmap §7.4: during coexistence the new platform answers yayatoh.com and abc.yayatoh.com and sends everything it doesn't serve yet to the Laravel origins (`origin-yay.` / `origin-abc.yayatoh.com`, nginx accepting only a secret header). Stages A0 (100 % pass-through, one-week soak), A1 (content, robots, sitemaps), A2 (public reads), then B-Y / B-A.
- The front door must preserve method, body, headers (minus hop-by-hop), cookies (scoped correctly), status, streaming and timeouts; never forward `/api/v2` (the frozen facade stays on the new backend) or the new app's own routes; count 404s, proxy errors and latency per route.
- Gating spike (§7.4): a 25 MB upload, a 150 s response and a 60 MB stream through the front door. If any fails and can't move direct-to-storage, fall back to a Cloudflare Worker for the migration period only.
- Hosting is Vercel (ADR 0004), no Cloudflare proxy in front of Vercel.

## Options
| | A. `NextResponse.rewrite(legacyUrl)` (platform external rewrite) | B. **proxy.ts decides, then forwards with `fetch` and returns the streamed response** | C. Cloudflare Worker in front of Vercel and Laravel |
|---|---|---|---|
| Route table and flags | In proxy.ts | In proxy.ts | Duplicated in the Worker (a second deploy, a second copy of the table) |
| Upstream status, latency, 404 list | **Not visible** (the platform proxies after proxy.ts returns) | Visible for every forwarded request | Visible, but in another system |
| Cookie scoping (drop `Domain`, refuse the new app's names) | **Not possible** (response headers can't be rewritten) | Yes | Yes |
| Hop-by-hop, client-set `X-Forwarded-*` | Partly (request headers only) | Yes, both directions | Yes |
| Redirect `Location` to the origin host | Leaks the origin host | Rewritten to the public host | Rewritten |
| Response streaming (60 MB) | Yes | Yes (the body stream is returned as is) | Yes |
| Long responses (150 s) | Platform limits | Header timeout of our own (`FRONT_DOOR_TIMEOUT_MS`, 170 s default); function duration limit on Vercel (Fluid compute: up to 800 s on Pro) | Worker limits (no wall-clock limit while streaming) |
| Upload bodies | **Truncated at the proxy body limit** (measured: a 25 MB upload arrived as 10 MiB under the default `proxyClientMaxBodySize`) | Buffered copy up to `proxyClientMaxBodySize`, raised to 64 MiB (`FRONT_DOOR_MAX_BODY`); a body that reaches the limit gets **413, never a truncated forward** | Streams (100 MB+ plans) |
| Cost and moving parts | None | None | Cloudflare account, DNS proxying (contradicts ADR 0004), one more deploy |

## Decision
**Option B.** `apps/web/src/proxy.ts` runs the front door first on the configured legacy hosts:
1. **Decide** with the versioned route-ownership table (`@yayatoh/platform/front-door`, `ROUTE_TABLE_VERSION`), per-host flags (`legacy` default / `canary` / `next`, in `platform.front_door_flags`, read through a SECURITY DEFINER function and cached a few seconds) and the `yy_canary=next` / `yy_legacy=1` cookies. The new app's own namespaces (`/api` incl. `/api/v2`, `/_next`, `/media`, sign-in, the widget, …) are never forwarded; `/api`, `/_next`, `/_vercel` and `/media` don't even reach proxy.ts.
2. **Redirect** legacy URL shapes (`legacy_redirects`) in one hop to the final URL, but only when that URL is served by the new app; until then legacy keeps answering its own URL.
3. **Forward** everything else with `fetch` to the host's instance origin: headers minus hop-by-hop/`expect`, minus client-set `X-Forwarded-*`/`X-Real-IP`/`X-Yayatoh-*`, minus the new app's cookies; plus `X-Forwarded-Host/Proto/For` and the origin secret; `redirect: 'manual'`; the response streamed back with `Set-Cookie` made host-only and the new app's cookie names refused, `Location` on the origin moved to the public host. Legacy responses get none of the new app's page headers (CSP, device cookie).
4. **Count** in process and flush every few seconds through `platform.record_front_door`.
5. When legacy doesn't answer in time: the new app's localized 504 (502 when unreachable).

With neither `LEGACY_ORIGIN_URL` nor `LEGACY_ABC_ORIGIN_URL` set, nothing changes (development, CI, every deployment that is not the coexistence front door).

## Spike results (local, `next start`, e2e against a stub origin)
- 60 MB stream: passes (streamed, ~0.2 s locally).
- 25 MB upload: passes with `proxyClientMaxBodySize` = 64 MiB (SHA-256 checked end to end). With the platform rewrite (option A) and the default limit it was silently truncated to 10 MiB; that is why option A was dropped for uploads too.
- Slow response: bounded by the header timeout only (3 s in e2e: 1.5 s passes, 5 s gets the 504 page); the body then streams without a limit. The 150 s case is a configuration value (170 s default) and must be run on the Vercel preview.

## Consequences
- One place (proxy.ts) owns routing, redirects, cookies and counters; the staff console (`/front-door` in apps/admin) shows the table, flags and counters, and moves routes (admins, step-up, audited).
- Uploads are buffered in memory up to 64 MiB. Larger uploads get 413 (the legacy dashboard's uploads are well under that; direct-to-storage is the answer if one isn't).
- **To verify on the Vercel preview before any DNS change (pending owner):** the request body limit of functions/middleware on Vercel (4.5 MB is documented for function bodies; if it applies to proxy.ts, the 25 MB upload fails there), and a 150 s response within the function's max duration. If the upload fails and can't move direct-to-storage, the fallback is option C for the migration period only, as the roadmap says; the route table module is pure and can be bundled into a Worker unchanged.
- Laravel behind the front door: `TrustProxies` for our egress, `APP_URL` checked, `SESSION_DOMAIN` unset (host-only cookies), cookie names distinct from `yy*`/`NEXT_LOCALE`/`__Host-`, nginx requiring `X-Yayatoh-Front-Door`.
- The new app's baseline headers (next.config.ts) skip the legacy hosts when their origins are set at build time, so legacy pages keep their own opener policy.

## Alternatives considered and rejected
- A (external rewrite): no observability, no cookie scoping, truncated uploads.
- C (Worker): kept as the fallback only (ADR 0004: no Cloudflare proxy in front of Vercel).
- nginx on the Laravel box as router: only if Phase 0 finds certificate pinning (ADR 0006).

## Revisit when
- The Vercel preview spike fails (upload size or duration).
- Traffic at A0 shows forwarding latency above the §3.6 budget.
- Coexistence ends (B-Y and B-A done): the forwarding path and the table are removed.
