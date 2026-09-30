# Security, load and accessibility testing (M1.14d)

## ZAP baseline (passive scan)
`bash zap/run-baseline.sh <url>` runs the ZAP baseline in Docker with `zap/baseline.conf` (rules set
to FAIL for missing CSP, anti-clickjacking, nosniff, SameSite, vulnerable JS libraries,
cross-domain scripts and missing SRI on third-party scripts; accepted WARNs carry their reason). The
script exits non-zero on any High alert or FAIL rule.

**Local run, 2026-09-27** (production build, `next start`, seeded data, 3-minute spider):

| Risk | Count | Alerts |
|---|---|---|
| High | **0** | — |
| Medium | 1 | Absence of Anti-CSRF Tokens (low confidence): Server Action forms are protected by Next's Origin check and SameSite=Lax cookies; the other form is `/dev/login` (never in production) |
| Low | 3 | Big redirect (signed-out `/o` → sign-in; public content only) · CSP notice (`report-uri` kept next to `report-to` on purpose) · `NEXT_LOCALE` cookie not HttpOnly (locale only) |
| Info | 6 | Authentication/session identification, modern web app, user-controllable attributes (React-escaped Server Action fields) |

**Fixed because of ZAP:**
- Before hydration (or without JS) the sign-in form fell back to GET and would have put the email
  and password in the URL. It is now `method="post"` (e2e: security.spec.ts).
- 404s for dotted paths (`/robots.txt`) bypassed the proxy and had no CSP; the proxy now covers
  every path, and `/robots.txt` exists (keeps crawlers out of console and secret-link pages).

Staging and production-like scans (and the optional active scan / pen test before launch) need the
owner's hosting (owner inbox).

## k6 load tests
`k6/checkout.js` and `k6/scan.js` (k6/README.md). **Local run, 2026-09-27** — one `next start`
process and Postgres 18 in Docker on the same small cloud VM:

| Run | Load | Result | Thresholds |
|---|---|---|---|
| Scan (online verify) | 30 scans/s for 60 s + 2 manifest readers | scan p95 **37 ms** (avg 25 ms), manifest p95 103 ms, 0 errors, 3 330 requests | ✓ all |
| Checkout, realistic pacing | 20 buyers, 1–3 s think time, 70 s | checkout p95 **147 ms**, event page p95 48 ms, 0 errors, 546 orders | ✓ all |
| Checkout, stress (no think time) | 10 buyers back to back (~21 checkouts/s on **one** ticket type) | checkout p95 **914 ms** (median 237 ms), 0 errors, 1 507 orders | ✗ p95 < 800 ms |

The stress run exceeds the 800 ms budget because every checkout locks the same ticket-type row on
a single small machine. That is the "large on-sale" risk the roadmap assigns to the waiting room /
Queue-it (§10) and to M2.3 capacity work; it is not a correctness problem (no errors, no
oversell). Staging runs at 3× the expected peak are the real gate before M2.1 (owner inbox).

## Accessibility
- Every new screen and state in M1.14 has an axe check (WCAG 2.2 AA tags, zero serious/critical):
  Activity (list, filters, empty, export, refused), Privacy requests (find, results, export, erase,
  refused), privacy notice, sub-processors, sign-in rate-limit state, each in English and Arabic
  (RTL). Across the suite, 30 spec files make 86 axe checks at 375, 768 and 1280 px.
- Keyboard-only paths are tested for the Activity filters/export and the privacy find/export flow.
- Still manual (owner or a contracted tester): NVDA and VoiceOver passes before the phase exit,
  and the VPAT 2.5 (roadmap §10).

## Threat model
docs/ops/threat-model.md (STRIDE per surface).
