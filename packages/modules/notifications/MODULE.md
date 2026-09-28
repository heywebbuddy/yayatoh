# notifications (tier 2)

Outbound messages and the member inbox (M1.10). Owns Postgres schema `notifications`. Implements
the platform `Notifier` port: modules describe what to send (`kind`, recipient, params, dedupe
key) inside their own transaction; this module records, gates, renders and sends.

**Invariants**
- Every message is one of the kinds in `src/kinds.ts`; the kind fixes its category, default
  channels, required params and whether quiet hours apply.
- One row per `(org, channel, dedupe_key)` in `messages`: a replayed or duplicated event never
  creates a second delivery. The dispatcher claims due rows with `FOR UPDATE SKIP LOCKED`, so two
  dispatchers never hand the same row to a provider.
- Template params are stored encrypted with the org's key envelope (they can carry link tokens).
- Transactional messages (tickets, refunds, invitations, ticket links, replies the customer asked
  for) are never suppressed. Every other category checks, in order: the org kill switch
  (`pause_messaging` holds them), unsubscribes (`suppressions`), the recipient's preferences, then
  quiet hours (21:00–08:00 in the recipient's timezone: theirs, else the event's, else the org's).
- Unsubscribable email carries RFC 8058 `List-Unsubscribe` + `List-Unsubscribe-Post`; the token is
  an HMAC of the message id (nothing secret stored). Unsubscribing never needs an account.
- Inbox items and preferences belong to one user; queries and commands take the user from the
  session, never from input.
- Push tokens keep their real platform; legacy APNs tokens are imported as `apns` (the legacy app
  sent them through FCM).
- Providers (SES, Twilio, WhatsApp, FCM v1, APNs) are owner accounts: until they exist,
  `devMailboxTransports` (dev/CI) and `memoryTransports` (tests) stand in. Web push (M1.10e) is a
  real adapter (RFC 8030/8291/8292 with `node:crypto`) that only contacts known push services.
- Web push devices belong to a member (`user_id`) or a guest buyer (`email_norm`), never both; at
  most 10 per person and org. Push is queued only for people with an active device, sent once per
  device (`push_deliveries`, also across retries), and pruned on 404/410. Payloads are an
  allowlist (title, body, a link on our origin); endpoints and keys never leave the server.
- Delivery reports (M1.10d) come from a verified provider webhook and are kept once per provider
  event id (`message_events`, append-only). Hard bounces, complaints and repeated soft bounces put
  the address on `address_suppressions`, which the dispatcher honours for every category,
  transactional included (the message is `suppressed`, reason `bounced`/`complained`).
- Erased addresses (M1.14e): the global `platform.erased_addresses` list (hashes only) is checked
  for every org's email. Order mail (transactional kinds about an order or ticket) goes out; account
  mail (invitations, member notifications) only after the person signed up again; everything else
  is `suppressed` (`erased`) until the org records a marketing consent given after the erasure.
- `cancelQueuedTx` cancels queued messages by dedupe key with a reason (a survey reminder once the person answered, M3.9a); sent messages never change.
- Reminders are the day before at the same wall-clock time in the event's timezone; queued
  reminders are re-planned from the event's (or date's) current start whenever it changes, so
  replays are harmless. Sent messages are never rewritten.
- Member notifications render in the member's own email language, looked up at send time.
- Email previews are stored for ten minutes (`email_previews`, creator only) and served from their
  own URL with their own sandboxed CSP; drafts never travel in URLs.
