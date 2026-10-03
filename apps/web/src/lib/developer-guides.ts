import {
  RECEIVER_EXAMPLE_EXPRESS,
  VERIFY_EXAMPLE_LIBRARY,
  VERIFY_EXAMPLE_NODE,
} from '@yayatoh/webhooks/examples';

/**
 * The developer guides (M6.3b). Reference content stays in English in every locale (the brief);
 * the docs shell around it is translated. Blocks are Markdown (rendered by `Markdown`, which
 * never injects HTML) or code shown verbatim. The webhook verification code is the tested example
 * from `@yayatoh/webhooks/examples`.
 */
export type GuideBlock =
  | { readonly kind: 'md'; readonly text: string }
  | { readonly kind: 'code'; readonly lang: string; readonly title: string; readonly code: string };

export interface Guide {
  readonly slug: string;
  readonly title: string;
  readonly summary: string;
  readonly blocks: readonly GuideBlock[];
}

const md = (text: string): GuideBlock => ({ kind: 'md', text: text.trim() });
const code = (lang: string, title: string, src: string): GuideBlock => ({
  kind: 'code',
  lang,
  title,
  code: src.trim(),
});

export const GUIDES: readonly Guide[] = [
  {
    slug: 'authentication',
    title: 'Authentication with API keys',
    summary: 'Create an org API key, choose its scopes, and send it as a bearer token.',
    blocks: [
      md(`
An **org API key** identifies your organization to \`/v1\`. Owners and admins create keys in the console under **Settings → API keys**. A key is shown **once**: store it in a secret manager, never in code or a browser.

- Live keys start with \`yy_live_\`. They can read and write what their **scopes** allow, and never more than the role of the person who created them.
- Test keys start with \`yy_test_\`. They are read-only and see no personal data (\`org:read\`, \`events:read\`), with a smaller rate limit. Build against a test key, ship with a live key.
- Keys can expire (30, 90 or 365 days) and can be **rotated** with an overlap window, so you can deploy the new key before the old one stops.
- Every org resource lives under \`/v1/orgs/{org}\`. The \`{org}\` must be the key's own organization; the tenant is never read from a header.
      `),
      code(
        'bash',
        'curl',
        `
curl https://api.yayatoh.com/v1/orgs/lakeside-events/events \\
  -H "Authorization: Bearer $YAYATOH_KEY"
        `,
      ),
      code(
        'ts',
        'TypeScript SDK',
        `
import { createYayatohClient, unwrap } from '@yayatoh/sdk';

const api = createYayatohClient({ baseUrl: 'https://api.yayatoh.com', token: process.env.YAYATOH_KEY });
const org = await unwrap(api.GET('/v1/orgs/{org}', { params: { path: { org: 'lakeside-events' } } }));
        `,
      ),
      md(`
A missing, revoked, expired or rotated-out key answers **401**. A key without the scope a route needs answers **403** with the code \`forbidden\`. Errors are RFC 9457 \`application/problem+json\` with a stable \`code\` and a \`requestId\` to quote to support.
      `),
    ],
  },
  {
    slug: 'pagination',
    title: 'Pagination',
    summary: 'Walk long lists with `limit` and an opaque `cursor`.',
    blocks: [
      md(`
Lists return at most \`limit\` items (1 to 100, default 25) and a \`nextCursor\`. Pass it back as \`cursor\` for the next page; when it is \`null\`, you have everything. Cursors are opaque: never build or parse them, and do not store them for long (a cursor always points just after the last item you received, so a list that changes between pages never repeats or skips an item).
      `),
      code(
        'bash',
        'curl',
        `
curl "https://api.yayatoh.com/v1/orgs/lakeside-events/events?limit=100" -H "Authorization: Bearer $YAYATOH_KEY"
# → { "data": [ … ], "nextCursor": "eyJ…" }
curl "https://api.yayatoh.com/v1/orgs/lakeside-events/events?limit=100&cursor=eyJ…" -H "Authorization: Bearer $YAYATOH_KEY"
        `,
      ),
      code(
        'ts',
        'TypeScript SDK',
        `
import { paginate, unwrap } from '@yayatoh/sdk';

for await (const event of paginate((cursor) =>
  unwrap(api.GET('/v1/orgs/{org}/events', { params: { path: { org: 'lakeside-events' }, query: { cursor, limit: 100 } } })),
)) {
  console.log(event.name);
}
        `,
      ),
    ],
  },
  {
    slug: 'idempotency',
    title: 'Idempotency and retries',
    summary: 'Send an `Idempotency-Key` with every write so a retry never does it twice.',
    blocks: [
      md(`
Every write (\`POST\`, \`PATCH\`, \`DELETE\`) needs an **\`Idempotency-Key\`** header: any 8–255 printable characters, unique per operation. A UUID works well.

- Retrying with the **same key and the same request** returns the stored result instead of acting again (kept for **24 hours**). Retry freely after a timeout or a dropped connection.
- The same key with a **different request** answers **422** \`idempotency_key_reused\`: use a new key for a new operation.
- While the first request is still running, a retry answers **409**; wait and retry.
- Rate limits answer **429** with \`Retry-After\` and the \`RateLimit-*\` headers. Back off for that long.
      `),
      code(
        'ts',
        'TypeScript SDK',
        `
import { idempotencyKey, unwrap } from '@yayatoh/sdk';

const key = idempotencyKey(); // reuse it if you retry this same write
const event = await unwrap(api.POST('/v1/orgs/{org}/events', {
  params: { path: { org: 'lakeside-events' }, header: { 'idempotency-key': key } },
  body: { name: 'Launch', timezone: 'America/Chicago', startsAt: '2030-03-01T23:00:00Z', endsAt: '2030-03-02T02:00:00Z' },
}));
        `,
      ),
    ],
  },
  {
    slug: 'webhooks',
    title: 'Webhooks and signature verification',
    summary: 'Receive events at your endpoint, verify each signature, and answer fast.',
    blocks: [
      md(`
Add an endpoint under **Settings → Webhooks** (owners and admins): an **https** URL on port 443 that the public internet can reach, and the events it should receive (or all of them). Every endpoint has its own **signing secret** (\`whsec_…\`).

Each message is a JSON envelope: \`id\`, \`type\` (for example \`order.paid\`), \`version\`, \`apiVersion\`, \`occurredAt\`, \`orgId\` and \`data\`. Payloads are **thin**: ids, statuses, amounts and times, never names, emails, phones, answers or messages. Read the details you need from \`/v1\` with an API key (its scopes apply). The **event catalog** lists every type with its versioned schema and an example.

**Verify every delivery** before you trust it. Messages follow [Standard Webhooks](https://www.standardwebhooks.com/): three headers, \`webhook-id\`, \`webhook-timestamp\` and \`webhook-signature\`. The signature is an HMAC-SHA256 of \`<id>.<timestamp>.<raw body>\` with your secret's key (the base64 after \`whsec_\`). Use the **raw** body: re-serialized JSON will not match.
      `),
      code('js', 'verify.js (Node 18+, no dependencies)', VERIFY_EXAMPLE_NODE),
      code('js', 'Or with the Standard Webhooks library', VERIFY_EXAMPLE_LIBRARY),
      code('js', 'An Express receiver', RECEIVER_EXAMPLE_EXPRESS),
      code(
        'ts',
        'TypeScript SDK (Web Crypto: Node, Deno, Bun, Workers)',
        `
import { verifyWebhook } from '@yayatoh/sdk';

const message = await verifyWebhook<'order.paid'>(secret, request.headers, await request.text());
console.log(message.data.orderId, message.data.totalMinor);
        `,
      ),
      md(`
**Delivery and retries.** Answer any **2xx** within 15 seconds; do the work afterwards. Anything else is retried with backoff (5 seconds, 5 minutes, 30 minutes, 2 hours, 5 hours, 10 hours, 10 hours: about 28 hours in all). A retry reuses the same \`webhook-id\`, so **deduplicate on it**. Order is not guaranteed: use \`occurredAt\`.

**Replay.** Each endpoint's page lists its recent deliveries. **Resend** sends one message again; **Recover** resends every failed message since a time (after your receiver was down). The embedded webhook portal shows the same logs.

**Test sends.** The endpoint page sends \`webhook.test\` (or any event's documented example) to that endpoint only, signed like a real message.

**Secret rotation.** Rotating an endpoint's secret (it asks you to confirm it's you) makes a new secret; for 24 hours both sign each message (two signatures, space-separated), so deploy the new secret within a day.

**Versions.** A breaking change to a payload ships as a new \`version\` next to the old one, announced ahead; \`v1\` keeps flowing.
      `),
    ],
  },
  {
    slug: 'sandbox',
    title: 'Sandbox orgs and test data',
    summary: 'Build against a sandbox org with seeded data and fake payments.',
    blocks: [
      md(`
A **sandbox org** is a separate organization linked to yours, with seeded events, ticket types and orders, and a **fake payment provider**: it never takes real money. Owners and admins create one under **Settings → Sandboxes**.

- Create API keys **inside the sandbox org**: they work exactly like live keys, on the sandbox's data only, with the sandbox's rate limits.
- Webhook endpoints in a sandbox org receive the sandbox's events, signed like any other. Point them at a staging receiver.
- Checkouts in a sandbox complete on a fake payment page; refunds and payouts are simulated.
- Test keys (\`yy_test_…\`) are another option for read-only work: no personal data, no writes.

When you go live, create live keys and endpoints in your real organization; nothing carries over from the sandbox.
      `),
    ],
  },
];

export function guide(slug: string): Guide | null {
  return GUIDES.find((g) => g.slug === slug) ?? null;
}
