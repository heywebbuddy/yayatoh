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
- `scripts/generate-mobile.sh` generates the Swift 6 and Kotlin clients with openapi-generator
  (Docker, local only; `mobile/*.yaml` hold the settings). Mobile apps are deferred (roadmap §8.3).
