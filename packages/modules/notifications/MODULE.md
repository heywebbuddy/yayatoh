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
- Providers (SES, Twilio, WhatsApp, FCM v1, APNs, VAPID) are owner accounts: until they exist,
  `devMailboxTransports` (dev/CI) and `memoryTransports` (tests) stand in.
