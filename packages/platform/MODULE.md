# platform (tier 0)

Cross-cutting kernel services. Owns Postgres schema `platform`.

**Invariants**
- `domain_events`, `processed_events` and `audit_events` are append-only for `app_user` (UPDATE/DELETE revoked).
- `log_seq` is stamped only under the `platform.relay_stamp` transaction advisory lock (the relay, and the legacy migration's backfill, which takes the same lock): global, gap-free, monotonic.
- Backfilled history is written with `replayed = true` (legacy migration T9): it is logged and published, but the relay never enqueues it and `consumeEvent` records it without running the handler, unless the subscriber sets `acceptsReplayed` (projectors that rebuild history). Mailers, notifications, journeys and automations never opt in.
- `metric_timeseries`: monthly metric history per org (`source` legacy or live).
- A subscriber handles each event at most once (`processed_events` unique on org × consumer × event, same transaction as the handler).
- Event payloads are versioned contracts (`type@version`); a breaking change is a new version.
- Code checks module keys (`MODULE_KEYS`), never plan or profile names.
- Rate limits (`rate_limits`, `hitRateLimitTx`): fixed windows per org and bucket, counted inside the caller's tenant transaction; buckets never hold raw personal data (hash device ids and addresses). Windows older than a day are pruned as new requests are counted.
- The human-check port (`HumanCheck`) is how public lookups past their limit ask "are you a person?": Cloudflare Turnstile (owner account) or the fake adapter, which is never used in production.
