# Yayatoh for Zapier (M6.4c)

A Zapier Platform CLI app (`zapier-platform-core` 19.1.0). **Not published**: publishing waits for
the owner's Zapier partner review (`docs/owner-inbox.md`).

- **Authentication:** an org API key (`yy_live_…`, Settings → API keys) and the org's id or slug.
  Settings → Integrations → Zapier lists the scopes: `webhooks:subscribe` (triggers),
  `events:read` (the event picker), `attendees:write` (Create Registration), `contacts:write`
  (Add Contact), `checkin:scan` (Check In Ticket).
- **Triggers** (REST hooks on Yayatoh's webhooks): Order Paid, Ticket Checked In, Registration Form
  Submitted, Event Published. Payloads are thin (ids and facts).
- **Actions** (on `/v1`): Create Registration, Add Contact, Check In Ticket. Every write sends an
  `Idempotency-Key` derived from the Zap and the input, so Zapier's retries apply once.
- `YAYATOH_API_URL` points the app at another API (default `https://api.yayatoh.com`).

## Tests

- `tests/zapier.test.ts` (in `pnpm test`): every trigger and action through Zapier's app tester
  (what `zapier test` runs) against `tests/fake-api.ts`, the app definition through Zapier's
  schema validation (what `zapier validate` runs locally), and the fake's responses against
  `apps/api/openapi.json`.
- `tests/zapier-v1.int.test.ts` (in `pnpm test:int`): the same app against the real `/v1`.

With the Zapier CLI installed (not a dependency here), `zapier test --skip-validate` runs the
same suite (`npm test`), and `zapier validate --without-style` validates offline. Never run
`zapier push` or `zapier validate` with style checks from CI: both call Zapier.
