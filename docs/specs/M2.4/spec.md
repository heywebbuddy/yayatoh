# M2.4 — Front door and read surfaces

Roadmap M2.4: "Front-door spike; A0–A2 per §7.4. Acceptance: one-week soak with no regressions; Core Web Vitals and 404s watched." Roadmap §7.4 (coexistence, stages A0–A2, gating spike), §7.7 (SEO and URL continuity, `legacy_redirects`), §4.2 (hosts), ADR 0006 (Next.js front door), ADR 0020 (this milestone's decision). Risk tags: `infra`, `db-migration`, `tenancy` (global tables), `auth` (staff step-up). Development and preview only: no DNS change, no production, no call to the live legacy sites (tests use a local stub origin).

## M2.4a — the front door, the route table and the watch (built)

### Decision (ADR 0020, proposed)
`apps/web/src/proxy.ts` runs the front door first. It decides who serves each request on a legacy host, then either lets the new app serve it, answers a legacy URL with one redirect, or forwards it to that instance's legacy origin with `fetch` and streams the answer back. Rejected: the platform's external rewrite (no status, latency or cookie control; the spike showed it truncating a 25 MB upload at 10 MiB); a Cloudflare Worker (kept as the fallback if the Vercel preview spike fails, ADR 0004 has no Cloudflare proxy).

### Where it lives
- **`@yayatoh/platform/front-door`** (pure, runtime-agnostic):
  - `routes.ts`: the **versioned route-ownership table** (`ROUTE_TABLE_VERSION = 2` since the batch 3c merge), `decideFrontDoor()`, the new app's own paths (`PLATFORM_PREFIXES`, `PLATFORM_FILES`), locale stripping, the `yy_canary` / `yy_legacy` cookies.
  - `http.ts`: configuration from env (`frontDoorConfig`, `frontDoorHostList`), request and response header rules, cookie scoping, `Location` rewriting.
- **`@yayatoh/platform`**: `frontDoorFlags()` and `recordFrontDoor()` (SECURITY DEFINER calls as `app_user`).
- **`apps/web/src/lib/front-door/`**: `index.ts` (the proxy step: decide, redirect, forward, count), `forward.ts` (the forwarder), `meter.ts` (in-process counters, flushed every `FRONT_DOOR_FLUSH_MS`), `constants.ts`. The error page `app/api/front-door/unavailable/[status]/[locale]` (502/504, 13 locales, RTL). The 404 beacon `components/front-door-beacon.tsx` + `app/api/front-door/not-found`.
- **`apps/admin`**: `/front-door` (page, action), `server/front-door-store.ts` (platform_reader reads and the flag function), staff action `frontDoor` (admins only).

### The route table (version 2)
| Key | Stage | Instances | URL shapes |
|---|---|---|---|
| `home` | A2 | yay, abc | `/` |
| `events.search` | A2 | yay | `/events?q=…` (also legacy `search`, `city`, `category`, `price`, `from`, `to`, `type`) |
| `events.listing` | A2 | yay | `/events` |
| `events.page` | A2 | yay, abc | `/events/{slug}` (not `/attendee`, checkout or tags) |
| `organizers.page` | A2 | yay | `/o/{slug}`, its blog and pages |
| `venues.page` | A2 | yay | `/venues/{slug}` |
| `content.blogs` | A1 | yay, abc | `/blogs`, `/blogs/{slug}` |
| `content.pages` | A1 | yay, abc | `/pages/{slug}` |
| `seo.robots` | A1 | yay, abc | `/robots.txt` |
| `seo.sitemaps` | A1 | yay, abc | `/sitemap.xml`, `/sitemaps/{file}` |
| `site.pricing` | A1 | yay | `/pricing` (M3.11a; added in version 2 at the batch 3c merge) |
| `site.features` | A1 | yay | `/features` (M3.11b) |
| `site.contact` | A1 | yay | `/contact` (M3.11b) |
| `help.center` | A1 | yay | `/help`, `/help/search`, `/help/{category}`, `/help/{category}/{article}` (M3.11b) |
| `site.status` | A1 | yay | `/status` (M3.11b) |

- **Decision order:** the new app's own paths (never forwarded: `/api` including `/api/v2`, `/_next`, `/_vercel`, `/media`, `/embed`, `/auth`, `/sign-in`, `/signup`, `/my-tickets`, `/claim`, `/invite`, `/survey`, `/sub-processors`, the widget and service-worker files) → a moved route → its flag for that exact host (`legacy` by default, `canary` = only with `yy_canary=next`, `next`), with `yy_legacy=1` forcing legacy for moved routes → everything else goes to legacy. A locale prefix (`/ar/events`) is ignored for matching and dropped when forwarding (legacy has none).
- **abc before B-A:** a moved route on a tenant-kind legacy host is served by the new app only once the host is attached to an org (`org_domains`); until then legacy keeps it (never "Unknown site").
- **A flag naming a key the table no longer has changes nothing.** Flag changes record the table version.

### A0: forwarding
- On for an instance only when its origin is set: `LEGACY_ORIGIN_URL` (hosts `LEGACY_YAY_HOSTS`, default `yayatoh.com,www.yayatoh.com`) and `LEGACY_ABC_ORIGIN_URL` (hosts `LEGACY_ABC_HOSTS`, default `abc.yayatoh.com`). Unset everywhere by default: dev, CI and the normal e2e hosts behave as before.
- **Preserved:** method, body (SHA-256 checked end to end), query, status (404/5xx included), response headers, HEAD without body, streaming of the response body.
- **Removed:** hop-by-hop headers (and any named in `Connection`), `expect`, client-set `X-Forwarded-*`, `X-Real-IP`, `Forwarded`, `X-Yayatoh-*`, `X-Middleware-*`; the new app's cookies (`__Host-*`, `yy.*`/`yy-*`/`yy_*`, `NEXT_LOCALE`).
- **Added:** `X-Forwarded-Host` (the public host), `X-Forwarded-Proto`, `X-Forwarded-For`/`X-Real-IP` (the edge's client IP, for Laravel's `TrustProxies` and throttling), `X-Yayatoh-Front-Door: $LEGACY_ORIGIN_SECRET` (nginx accepts only this).
- **Cookies scoped correctly:** legacy `Set-Cookie` loses its `Domain` attribute (host-only: a yayatoh.com cookie never reaches abc.yayatoh.com or app.yayatoh.com) and a legacy cookie named like one of the new app's is dropped.
- **Redirects:** not followed; a `Location` on the origin moves to the public host.
- **Timeouts:** only the wait for the response headers is bounded (`FRONT_DOOR_TIMEOUT_MS`, default 170 s); then the new app's localized 504 page (502 when unreachable), `no-store`, `Retry-After`. The body streams without a limit.
- **Bodies:** up to `FRONT_DOOR_MAX_BODY` (default 64 MiB, also next.config `proxyClientMaxBodySize`). A body over it, or one that may have been cut short by the runtime, gets 413; it is never forwarded incomplete.
- Legacy responses carry `x-front-door: legacy` and none of the new app's page headers (CSP, robots, device cookie); new-app responses on a legacy host carry `x-front-door: next`. The next.config baseline headers skip legacy hosts whose origin is set at build time.

### A1–A2: legacy URL shapes
- `legacy_redirects` (M1.11b) are served on legacy hosts by the front door, **in one hop**: `matchLegacyRedirect` follows a stored chain (`/organiser/x` → `/org/x` → `/o/x`) to the final URL with the first rule's status (at most 5 rules; a loop gives no redirect). The rule is new in `followRedirectChain` (marketplace domain) and applies on every host.
- A legacy URL is redirected only when its target is served by the new app (a flag on, or an absolute URL); until then legacy keeps answering its own URL.

### Watch
- **Counters** (`platform.front_door_stats`, per UTC day × host × route × served-by): requests, 404s, proxy errors (the front door's own 502/504/413), legacy 5xx, forwarding latency (count, sum, max). **404 top list** (`platform.front_door_not_found`, day × host × path without query × served-by, path capped at 300). Written in batches through `platform.record_front_door(jsonb, jsonb)` (app_user). New-app 404s on legacy hosts are reported by a beacon on the not-found page (Next prepares that page for every request, so the server can't tell), re-checked on the server: only a front-door host, and only a path the new app serves there.
- **Staff console `/front-door`** (apps/admin, nav "Front door"): route table version; legacy hosts and whether their origin is set; every moved route per host with its state, requests, 404s, proxy errors, latency (avg / max) and last change; other traffic (legacy catch-all, the new app's own paths); the 404 top list (7 days); recent changes. Everything read as platform_reader (access-logged).
- **Moving a route** (admins; support and finance see the page without the form): host, route, state, reason (3–500), and the staff member's authenticator code or password (step-up) in the same form. `platform.set_front_door_flag` re-checks that the step-up is under ten minutes old and the actor is staff, and writes the flag and its audit row (`platform.front_door_flag_changes`: from, to, table version, actor, reason, step-up time) in one statement. Takes effect within `FRONT_DOOR_FLAG_TTL_MS` (5 s).

### Migration `0080_ambiguous_wrecking_crew` (renumbered from 0069 at the batch 3c merge)
- New global tables (registered in `GLOBAL_TABLES` with reasons): `platform.front_door_flags`, `platform.front_door_flag_changes`, `platform.front_door_stats`, `platform.front_door_not_found`. Additive only.
- **Hand-written** (between `-- hand-written: begin/end`): `REVOKE ALL` from `app_user` and `platform_reader` on the four tables; `GRANT SELECT` to `platform_reader`; functions `platform.front_door_flags()` (app_user), `platform.set_front_door_flag(text, text, text, integer, text, text, timestamptz)` (platform_reader; step-up, actor, host and route checks; audit row) and `platform.record_front_door(jsonb, jsonb)` (app_user; clamps, truncates, ignores invalid rows), each `SECURITY DEFINER SET search_path = pg_catalog` with `REVOKE ALL … FROM PUBLIC`.

### Messages
- Web (13 locales): `frontDoor.slowTitle`, `frontDoor.downTitle`, `frontDoor.body`.
- Admin (English; the console is English-only, owner inbox): `shell.frontDoor`, namespace `frontDoor.*`.

### Acceptance (M2.4a)
| ID | Criterion | Test |
|---|---|---|
| AC1 | The route table resolves every shape to its route; unmoved legacy paths (attendee pages, checkout, `/login`, `/storage`, root org URLs, `/stripe/webhook`) stay legacy; abc has no listing/search/organizer/venue routes | `packages/platform/tests/front-door.test.ts` |
| AC2 | Flags are per host; canary needs `yy_canary=next`; `yy_legacy=1` forces legacy; an unknown route key changes nothing | `front-door.test.ts`; `apps/admin/tests/front-door.int.test.ts` |
| AC3 | `/api/v2`, `/api/v1`, `/_next`, sign-in and the widget are never forwarded, whatever the cookies and flags; the stub never sees `/api` | `front-door.test.ts`; `apps/web/e2e/front-door.spec.ts` ("/api/v2 and the new app's own paths…") |
| AC4 | An unowned path is forwarded to its instance's origin with method, body (SHA-256), query and status (404, 500, HEAD); abc goes to the abc origin | `apps/web/e2e/front-door.spec.ts`; `apps/web/tests/front-door-forward.test.ts` |
| AC5 | Hop-by-hop headers, client-set proxy headers and the new app's cookies never reach legacy; forwarded headers and the origin secret do | `front-door.test.ts`; `front-door-forward.test.ts`; e2e |
| AC6 | Legacy cookies are host-only and can't shadow the new app's; the browser keeps them on their host and abc never receives them | `front-door.test.ts`; e2e ("a legacy cookie stays on its host") |
| AC7 | An owned route is served by the new app (CSP, `x-front-door: next`); keyboard, axe and Arabic RTL on the moved listing | e2e ("a moved page is the new app…") |
| AC8 | Legacy URL shapes redirect in one hop to the final URL, only once it is served here; loops and chains never reach the client | `packages/modules/marketplace/tests/domain.test.ts`; `packages/testing/tests/marketplace.int.test.ts`; e2e |
| AC9 | 60 MB response streams; 25 MB upload arrives intact; gzip decoded; slow headers within the timeout pass, beyond it the localized 504 (Arabic RTL, axe); unreachable 502; over-limit or cut-short bodies 413 | e2e; `front-door-forward.test.ts` |
| AC10 | Same path on two hosts is two answers; new-app pages on the front-door host keep per-org content (cache keys stay org-scoped: the existing `publicCached` rule is unchanged, flags are keyed by host) | e2e ("the same path on two hosts…"); `front-door.test.ts` |
| AC11 | Counters: requests, 404s, proxy errors, 5xx, latency per route; 404 top list for legacy and new-app 404s; invalid rows ignored | `apps/web/tests/front-door-meter.test.ts`; `front-door.int.test.ts`; e2e |
| AC12 | Flag change needs a staff actor and a step-up under 10 minutes; flag and audit row written together; the access log names the staff member; app_user can't read or write the tables or call the setter; platform_reader can't write directly | `apps/admin/tests/front-door.int.test.ts` |
| AC13 | Console: admins move a route by keyboard with a step-up (wrong password changes nothing), the change persists after reload, shows in the audit list and takes effect on the web; support sees no control and a replayed form is refused; axe; the layout holds right to left at 375 px | `apps/admin/e2e/front-door.spec.ts`; `apps/admin/tests/staff-roles.test.ts` |

### Not yet
- **The Vercel preview spike** (25 MB upload and a 150 s response through proxy.ts on Vercel; the function body limit there may be lower than 64 MiB). Pending owner (hosting account); fallback per ADR 0020.
- **Rollout percentages** (roadmap: "with rollout %"): states are legacy / canary (cookie) / next. A percentage with sticky bucketing on the device cookie is a small addition if the owner wants it.
- **A0 soak** and the one-week acceptance: needs DNS and production (owner).
- **Core Web Vitals** for moved pages: the RUM feed is not wired (Vercel Speed Insights or Sentry, owner accounts).
- **Retention of the counters** (90 days suggested) and a daily 404 report by email: not scheduled yet.
- **Legacy route inventory:** `PLATFORM_PREFIXES` lists only namespaces the new app has and the legacy app is not known to have; confirm against the legacy route list (M0.2 audit) before A0.
- **Marketing pages** of A1 (`/about-us`, `/features`, `/faq`, `/contact`) have no new-app pages yet; they stay legacy until the CMS has them.
- **Counting new-app 404s without JavaScript** (crawlers): the beacon needs JS; the platform's request logs (Axiom drain, owner account) cover the rest.
- **The console is English-only** (existing owner-inbox item); its layout is checked mirrored.

### Gate (M2.4a)
`pnpm verify` green: lint, check:modules, typecheck, unit 1259, integration 854. Whole web e2e suite 1331 passed, 52 skipped, 0 failed (front-door spec: 21 passed, 18 request-level repeats skipped by design). Whole admin suite 60 passed (front-door console: 6).
