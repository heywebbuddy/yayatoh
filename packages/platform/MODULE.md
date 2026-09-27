# platform (tier 0)

Cross-cutting kernel services. Owns Postgres schema `platform`.

**Invariants**
- `domain_events`, `processed_events` and `audit_events` are append-only for `app_user` (UPDATE/DELETE revoked).
- `log_seq` is stamped only by `platform.relay_stamp` under a transaction advisory lock: global, gap-free, monotonic.
- A subscriber handles each event at most once (`processed_events` unique on org × consumer × event, same transaction as the handler).
- Event payloads are versioned contracts (`type@version`); a breaking change is a new version.
- Code checks module keys (`MODULE_KEYS`), never plan or profile names.
