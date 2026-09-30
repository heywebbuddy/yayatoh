# Service level objectives and alerts (M1.14d)

Targets are the roadmap §10 table. Each SLO has an SLI (what we measure), a 28-day window, an
error budget, and burn-rate alerts (fast burn pages, slow burn tickets). **A burned budget freezes
feature deploys** until it recovers (roadmap §10).

Alerting runs on the log/metrics stack once the owner's accounts exist (Axiom for logs and
monitors, Sentry for errors, Better Stack or similar for uptime and the status page — owner inbox).
Until then the SLIs below are measured by k6 (`k6/`) and the e2e suite.

| SLO | Target | SLI (source) | Budget / 28 d | Fast burn (page) | Slow burn (ticket) |
|---|---|---|---|---|---|
| Checkout success, excluding declines | ≥ 99.5 % | orders reaching `paid` ÷ checkout starts that reached the provider, excluding provider declines (orders module events) | 0.5 % | 14.4× over 1 h and 5 min | 3× over 6 h |
| `/v1` and `/api/v2` availability | 99.9 % | non-5xx ÷ all requests at the edge (Vercel logs) | 40 min | 14.4× over 1 h and 5 min | 6× over 6 h |
| Scan verify, online | p95 < 300 ms | `POST /v1/scans/batch` latency at the edge | 5 % of minutes over target | p95 > 300 ms for 10 min on an event day | p95 > 300 ms for 1 h |
| Scan verify, offline | ≤ 100 ms | device-side timing in heartbeats (checkin module) | — | device reports > 100 ms median | — |
| Live Command Center tiles | ≤ 3 s p95 | M3.1 (not built yet) | — | — | — |
| Other dashboard data | ≤ 60 s | report `as_of` age (always live today) | — | — | — |
| Transactional email enqueue → provider | p95 < 60 s | outbox relay lag + mailer send time (worker logs) | 5 % of minutes over | p95 > 5 min for 10 min | p95 > 60 s for 1 h |
| Webhook first attempt | p95 < 60 s | outbox → delivery (M1.13 webhooks) | — | — | — |
| RPO / RTO: checkout and check-in | ≤ 5 min / ≤ 1 h | Neon PITR window; restore drill time (runbooks/restore-drill.md) | — | backup job failed | drill over 45 min |
| RPO / RTO: other | 1 h / 4 h | as above | — | — | — |

**Security signals (not SLOs, but alerting):**
- CSP violation reports (`{"csp":"violation"}` log lines): more than 20/min after a deploy → ticket
  (a page lost its nonce or a new third party appeared).
- Rate-limit 429s (`tooManyRequests` responses): sign-in 429s from more than 50 distinct devices in
  10 min → possible credential stuffing → ticket; the limiter's `store_error` log → page (it fails
  open).
- Forged webhook 429s → ticket (someone is probing the endpoint).
- "Integrity check failed" on any org's Activity page → SEV1 (runbooks/incident.md).
- Retention job (`{"job":"retention"}`) with `failed > 0` → ticket.

**Performance budgets** (roadmap §10) are checked by k6 thresholds: event page p95 < 400 ms (SSR),
checkout start p95 < 800 ms, scan p95 < 300 ms, manifest page p95 < 1 s. Results:
docs/ops/security-testing.md.
