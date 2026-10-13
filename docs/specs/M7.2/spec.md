# Spec: M7.2 — Mobile contract (server side)

## M7.2d — Links and versions

- **Milestone:** M7.2d (docs/plans/mobile.md, decision P7-9)
- **Risk tags:** mobile-contract, infra (shared routing: `proxy.ts`, hosts, Caddy)
- **Related ADRs:** 0011 (QR and offline check-in), 0024 (deployment), 0025 (mobile apps)

### What was built
- **App link files.** `apps/web/src/lib/app-links.ts` builds `/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json` from env (names in `.env.example`: `APPLE_TEAM_ID`, `IOS_ATTENDEE_BUNDLE_IDS`, `IOS_STAFF_BUNDLE_IDS`, `ANDROID_*_PACKAGES`, `ANDROID_*_SHA256_FINGERPRINTS`, `APP_LINK_EXTRA_HOSTS`). Malformed values are dropped; unconfigured, both files are valid and empty.
  - Path allowlist: `/events/*`, `/e/*`, `/my-tickets/*`, `/orders/*`, `/claim/*` (every locale prefix) for the attendee app; `/scan` with the `e=*` fragment for the Staff app. `webcredentials` lists both apps.
  - Served on marketplace hosts, `APP_HOSTS` and subdomains of `TENANT_APEX` (plus `APP_LINK_EXTRA_HOSTS`); 404 on a custom tenant domain, a preview, localhost or a look-alike. `Content-Type: application/json`, one-hour cache, no cookie, never a redirect. `HEAD` works; other methods get 405.
  - `proxy.ts` answers these two exact paths first, before the front door, the locale redirect, the host redirect and auth. Caddy forwards `/.well-known/*` to the web app unchanged (note added to the Caddyfile).
- **Enrolment QR.** `device-enroll-form.tsx` draws the setup link (`/scan#e={event}&k={token}`) as an SVG QR in the browser. The token stays in the fragment: the QR is drawn client-side from the link already on screen, so no server renders, receives or logs it. The link is a universal link the Staff app claims; in a browser it opens the Scan PWA.
- **Version enforcement.** `packages/api-v1/src/versions.ts`: middleware on `/v1` reads `X-Yayatoh-Client: <app>/<version> (<build>)` for the four app identifiers. Below the app's minimum → `426` problem+json (`code: upgrade_required`, `details.storeUrl`, `minimumVersion`, `latestVersion`), `Cache-Control: no-store`. Always answered: `/mobile/config`, `/health`, `/openapi.json`, `/docs*`. A missing, malformed or unknown header always passes.
  - A Staff device (`yyd_` token) is never refused from 24 h before its event starts to 2 h after it ends (`checkin.deviceInEventWindow`; the event is the manifest path's, else the device's last reported one, else any event of its org). Any failure of that lookup lets the request through.
  - `MobileSettings.apps` (per app: `minimumVersion`, `latestVersion`, `storeUrl`) is new; `/v1/mobile/config` gains `apps`. The existing fields are unchanged; attendee apps fall back to the per-platform values, Staff apps to no minimum. Store links also come from `IOS_/ANDROID_ATTENDEE_/STAFF_STORE_URL` (https only). The web mount now honours `MOBILE_CONFIG_JSON` too.
  - `openapi.json` and the SDK schema regenerated: additions only.

### Later / not yet
- Associated Domains for `yayatoh.com` verify only after its DNS moves to Caddy (cutover); `abc.yayatoh.com` needs `APP_LINK_EXTRA_HOSTS` (decision P7-4). Real team ID, bundle IDs, fingerprints and store URLs are owner tasks (`docs/owner-inbox.md`).
- The 426 response is described in the `/mobile/config` text, not as a response on every operation.
- Telemetry still counts a below-minimum app's refused request like any other.

### Acceptance
| ID | Criterion | Test |
|---|---|---|
| AC-M7.2d-01 | Both files: 200 `application/json`, no redirect, on `yayatoh.com`, `app.yayatoh.com`, a tenant subdomain; 404 on a custom domain | `apps/web/e2e/app-links.spec.ts` (e2e, 3 projects); `apps/web/tests/app-links.test.ts` (unit) |
| AC-M7.2d-02 | Contents: path allowlist, locales, both apps, webcredentials, fingerprints; malformed input dropped | `apps/web/tests/app-links.test.ts`, `app-links.spec.ts` |
| AC-M7.2d-03 | Front door, locale, host and auth handling do not intercept the files; other methods and look-alike paths are not served | `app-links.spec.ts`, `front-door.spec.ts`, `security.spec.ts`, `noindex.spec.ts` |
| AC-M7.2d-04 | The enrolment QR decodes to exactly the text link; no request carries the key; Arabic render; axe; a viewer cannot add a device | `app-links.spec.ts` (e2e) |
| AC-M7.2d-05 | A below-minimum attendee app gets 426 with the store link; versions compare numerically; config and health still answer | `apps/api/tests/versions.int.test.ts`, `packages/api-v1/tests/versions.test.ts` |
| AC-M7.2d-06 | A below-minimum Staff device gets no 426 from 24 h before to 2 h after its event, and a 426 outside it | `apps/api/tests/versions.int.test.ts` |
| AC-M7.2d-07 | Requests without the header (or with a malformed, unknown or non-app one) are never refused | `apps/api/tests/versions.int.test.ts` |
| AC-M7.2d-08 | `/v1/mobile/config` keeps its fields and adds `apps`; `/v1` changes are additions only | `versions.int.test.ts`, `pnpm contracts:check` (oasdiff runs in CI) |
| AC-M7.2d-09 | The Apple CDN and Android verification accept the files; the Staff app claims the enrolment link | device pass |
