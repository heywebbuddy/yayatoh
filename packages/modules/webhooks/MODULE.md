# webhooks (tier 6)

Outbound webhooks (M6.3b, roadmap §6.3, P6-3, D21): the public event catalog, the org's webhook endpoints, and the outbox subscriber that hands public events to Svix. Owns Postgres schema `webhooks`.

**Invariants**
- **The catalog is the only way out.** `EVENT_CATALOG` lists every public event with a versioned Zod schema, a description and an example; `INTERNAL_EVENTS` lists every other outbox event with a reason. `catalog.test.ts` scans the code for emitted and subscribed `type@version` keys and fails on any that is in neither list or in both.
- **Thin payloads (D21).** Every catalog field is in `THIN_FIELDS` and every string is a uuid, a date, a date-time, an enum or a short pattern: no names, emails, phones, addresses, answers, notes or messages. `toPublicData` parses the internal payload through the schema (the allowlist), so unknown keys never leave; the leak canary (`catalog.test.ts`, `webhooks.int.test.ts`) plants personal data in payloads and checks none of it reaches a delivery.
- **Versioned.** A breaking change is a new `version` (and Svix event type) next to the old one; v1 keeps flowing.
- `WebhookPublisher` is a port: `svixPublisher` (REST, `SVIX_API_KEY`, owner inbox) and `fakePublisher` (dev, preview, CI: signs and records deliveries, never sends; a URL path segment `fail` answers 503). Production without Svix has no publisher: the console says webhooks are not available and nothing is sent.
- Svix holds secrets, messages, attempts and the customer portal; `webhooks.endpoints` mirrors the org's endpoints (url, description, event types, status) so the console lists them and the publisher can skip orgs with no active endpoint. Application uid = org id, endpoint uid = our row id, message eventId = the outbox event id: every provider call is safe to retry.
- Endpoint URLs: https on 443, no credentials, public names and addresses only (`@yayatoh/platform/ssrf` at registration; Svix re-checks at send). The fake publisher resolves reserved test names (`.test`, `example.com`) to a public address.
- Everything needs `webhooks:manage` (owners and admins) and the `api_access` module. Rotating a secret needs step-up; revealing one is audited. Audit entries name the endpoint's host only (a URL's path can carry the receiver's token).
- Signatures are Standard Webhooks (`signing.ts`); the receiver example on the docs (`examples.ts`) is run by `examples.test.ts` against deliveries the fake signed.
