# @yayatoh/sdk

TypeScript client for the Yayatoh `/v1` API, typed from `apps/api/openapi.json`
(openapi-typescript types + the 6 kB `openapi-fetch` client). Publish-ready, not published.

```ts
import { createYayatohClient, idempotencyKey, paginate, unwrap } from '@yayatoh/sdk';

const api = createYayatohClient({ baseUrl: 'https://api.yayatoh.com', token: process.env.YAYATOH_KEY });

// Reads
const org = await unwrap(api.GET('/v1/orgs/{org}', { params: { path: { org: 'lakeside-events' } } }));
for await (const event of paginate((cursor) =>
  unwrap(api.GET('/v1/orgs/{org}/events', { params: { path: { org: org.slug }, query: { cursor } } })),
)) console.log(event.name);

// Writes need an Idempotency-Key; reuse it when you retry the same write.
const key = idempotencyKey();
const created = await unwrap(api.POST('/v1/orgs/{org}/events', {
  params: { path: { org: org.slug }, header: { 'idempotency-key': key } },
  body: { name: 'Launch', timezone: 'America/Chicago', startsAt: '2030-03-01T23:00:00Z', endsAt: '2030-03-02T02:00:00Z' },
}));
```

Errors throw `YayatohApiError` (`status`, stable `code`, `requestId`, `retryAfter`).

- `pnpm --filter @yayatoh/sdk generate` regenerates `src/schema.ts` after `/v1` changes
  (`pnpm contracts:check` fails while it is stale).
- `pnpm --filter @yayatoh/sdk generate:mobile` (`scripts/generate-mobile.sh`) generates the Swift 6
  and Kotlin clients with openapi-generator (Docker, local only; `mobile/*.yaml` hold the settings;
  output in `mobile/out/`, git-ignored). Mobile apps are deferred (roadmap §8.3). Every operation
  has an `operationId` and every enum is a named schema (Spectral, `pnpm contracts:check`), so the
  generated methods and types have stable names.

Content reads for a future app (M1.13d), all public without a credential:

```ts
const agenda = await unwrap(api.GET('/v1/public/events/{slug}/agenda', { params: { path: { slug } } }));
for (const day of agenda.days) for (const s of day.sessions) console.log(day.date, s.title, s.room);
// Also: …/sections, …/announcements, …/dates, …/speakers(/{speakerId}), …/exhibitors,
// …/sponsors, …/images (absolute, immutable URLs), /v1/public/venues(/{slug}).
```

Test keys (`yy_test_…`) are read-only and see no personal data: build against one, ship with a
live key.
