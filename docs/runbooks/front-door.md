# Front door (coexistence, M2.4)

The new app answers yayatoh.com and abc.yayatoh.com during the move and forwards everything it
doesn't serve yet to the legacy Laravel site (ADR 0020, roadmap §7.4). This runbook covers turning
it on, moving routes, watching, and getting out. Claude Code prepares; the owner runs every
production step (CLAUDE.md → Safety). Nothing here changes DNS until step 4, which is the owner's.

## 0. Before anything (owner, with the Laravel developer)
- [ ] **Origins:** `origin-yay.yayatoh.com` and `origin-abc.yayatoh.com` point at the Laravel box with valid certificates. nginx on both **refuses** requests without `X-Yayatoh-Front-Door: <secret>` (403), so nobody bypasses the front door.
- [ ] **Laravel:** `TrustProxies` trusts the hosting egress (else `throttle` sees one IP for everyone and locks everyone out); `APP_URL` checked; `SESSION_DOMAIN` **unset** (host-only cookies); no Laravel cookie name starts with `yy`, `__Host-` or is `NEXT_LOCALE` (the front door drops those).
- [ ] **Certificate pinning** ruled out (ADR 0006). If the mobile apps pin, stop: nginx on the Laravel box stays the router until the bridge build is adopted.
- [ ] **Preview spike on Vercel** (ADR 0020): a 25 MB upload, a 150 s response and a 60 MB stream through the preview with the origins set. Record the results in ADR 0020. If the upload or the long response fails and can't move direct-to-storage, stop and switch to the Cloudflare Worker fallback.

## 1. Configuration (Doppler, per environment)
| Name | Value |
|---|---|
| `LEGACY_ORIGIN_URL` | `https://origin-yay.yayatoh.com` (turns the front door on for the yayatoh.com hosts) |
| `LEGACY_ABC_ORIGIN_URL` | `https://origin-abc.yayatoh.com` (on for abc) |
| `LEGACY_YAY_HOSTS` / `LEGACY_ABC_HOSTS` | Defaults `yayatoh.com,www.yayatoh.com` / `abc.yayatoh.com` |
| `LEGACY_ORIGIN_SECRET` | The nginx secret (rotate with `key-rotation.md`) |
| `FRONT_DOOR_TIMEOUT_MS` | Wait for legacy's response headers; default 170000 |
| `FRONT_DOOR_MAX_BODY` | Largest upload forwarded, bytes; default 64 MiB (set at **build** time too: next.config) |
| `FRONT_DOOR_FLAG_TTL_MS` / `FRONT_DOOR_FLUSH_MS` | Flag cache and counter flush; defaults 5000 / 5000 |

The origin variables must be present at **build** time as well (next.config.ts leaves the new app's baseline headers off legacy responses). Redeploy after changing them.

## 2. Check the preview (local/staging)
```sh
# Every request to the preview host with the origin set shows who served it:
curl -sI https://<preview>/login | grep -i x-front-door          # legacy
curl -sI https://<preview>/sign-in | grep -i x-front-door        # next (never forwarded)
curl -s -o /dev/null -w '%{http_code}\n' https://<preview>/api/v2/ping   # not legacy's answer
```
Locally: `pnpm --filter @yayatoh/web exec playwright test front-door` runs the whole behaviour against the stub origin (`apps/web/e2e/legacy-stub.ts`).

## 3. Staff console
`admin.yayatoh.com/front-door`:
- **Moved routes**: per host, who serves each route, requests, 404s, proxy errors, latency (avg/max), last change.
- **Other traffic**: everything legacy still serves, and the new app's own paths.
- **404 top list** (7 days) and **Recent changes** (who, when, why, from → to).
- **Move a route** (admins): host, route, Legacy / Canary / New app, a reason, and your authenticator code or password. It applies within seconds. Canary serves the new app only to browsers with the cookie `yy_canary=next` (set it in the browser's dev tools to test); `yy_legacy=1` always gets legacy.

## 4. Stages (owner)
1. **A0, pass-through** (every route Legacy): lower the DNS TTL to 60 s a week ahead; point yayatoh.com at Vercel; watch for a week: proxy errors ≈ 0, legacy 5xx unchanged from the Laravel logs, forwarding latency (avg under 100 ms added), 404 top list unchanged from the daily report. Then abc the same way.
2. **A1**: `seo.robots`, `seo.sitemaps`, `content.blogs`, `content.pages` → Canary for staff, then New app. Freeze Voyager editing for yayatoh.com first.
3. **A2** (optional): `home`, `events.listing`, `events.search`, `venues.page`, `organizers.page` (legacy root org URLs then 308 to `/o/{slug}` in one hop). `events.page` only when checkout can live with it (roadmap: it stays on Laravel in A2 because checkout lives there).
4. After each move: 404 top list and proxy errors for that route for 24 h; Search Console clicks; Core Web Vitals.

Never within ±72 h of an event with sales or check-ins (ADR 0006 freeze rules).

## 5. Roll back
- **One route:** move it back to Legacy in the console (seconds). Or tell a user to set `yy_legacy=1`.
- **Everything:** unset `LEGACY_ORIGIN_URL` / `LEGACY_ABC_ORIGIN_URL` and redeploy: the new app stops forwarding and serves only its own pages, so this is only right after DNS is back on the Laravel box. **Fastest full rollback: point DNS back at the Laravel box** (TTL 60 s) — the front door is then out of the path.
- Legacy unreachable: visitors get the front door's "not available right now" page (502/504); check nginx and the secret header first.

## 6. Troubleshooting
| Symptom | Check |
|---|---|
| Every legacy page 403 | `LEGACY_ORIGIN_SECRET` differs from nginx's |
| Everyone rate-limited on legacy | `TrustProxies` doesn't trust the hosting egress |
| Logged out of legacy on every page | Laravel cookie named `yy…`/`__Host-…`, or `SESSION_DOMAIN` set to another host |
| Uploads fail with 413 | Over `FRONT_DOOR_MAX_BODY`; move that upload direct-to-storage |
| Uploads fail on Vercel under 64 MiB | The platform's own body limit (ADR 0020); Worker fallback |
| A route moved but legacy still answers | `yy_legacy=1` in that browser; flag cache (≤ 5 s); on abc, the host isn't attached to the org yet |
| Redirect loop | `legacy_redirects` loop: the front door drops it (no redirect); fix the rows |
