# M2.2 — Migration completeness

Roadmap M2.2: "Transforms T1–T9 at 100%; user dedupe; affiliates; series inference; media. Acceptance: V1–V12 pass for both instances; full run ≤60 min." Ground rules §7.1: extraction from backups or a replica; production dumps only in the encrypted `legacy-ref` environment; development uses a deterministic masked dataset built with keyed hashes that keeps duplicate structure intact.

## M2.2a — legacy export and masking tool (done)

`tools/legacy-mask` (no dependencies; plain Node 24 or Docker) and `docs/runbooks/legacy-export.md`. The owner runs it next to the production dump; only the masked file leaves that machine.

- **Reader/writer:** a streaming mysqldump parser (statements split across any chunk size; strings with `;`, `),(`, escapes, emoji; `NULL`, numbers, `0x…` hex, `_binary`; `CREATE TABLE` columns with lengths, nullability and unique keys; extended and `--complete-insert` INSERTs). Values are written back with MySQL's escaping; `.sql.gz` in and out.
- **Masking:** keyed HMAC-SHA256 (a 32-byte key the owner keeps), so the same person masks to the same values in every table and every later dump, and nobody without the key can link them back. Strategies: email, first/last/full name, phone (E.164 `+1555…`), street, postcode, IP (documentation ranges), user agent, token (same length and alphabet), provider reference (prefix kept), text (placeholder of similar length), password (bcrypt of `password`), image path, birth date (year kept), JSON (personal keys) and JSON-all (every value), empty JSON (card data), contact (email or street), email-or-reference, last four (`4242`).
- **Rules:** `src/rules.ts` covers the 70 legacy tables from the migrations' column inventory: users (incl. bank/tax/seller fields, tokens, Stripe ids), bookings, attendees (`address` holds emails), transactions, failed bookings (raw card data emptied), events' private info, notifications (plain-text guest passwords), guests, newsletter, contacts, messages, reviews, reports, exhibitors, event codes, Voyager settings (secret keys by name; contact email/phone/address). Sessions, password resets, OTPs, cache, jobs and webhook logs are emptied. Columns without a rule fall back to name heuristics (text and binary columns), and every email anywhere in kept text is swapped for its masked twin.
- **Never breaks the import:** ids, foreign keys, amounts, currencies, dates, statuses and public event content are unchanged; unique columns stay unique (collisions re-drawn); NOT NULL columns are never set to NULL; values fit their column length; JSON stays valid JSON; the output is valid SQL that loads into MySQL 8 with the same row counts.
- **Fail-closed:** rows of a table without a definition are omitted and reported; the report holds names and counts only; `verify` rejects any surviving original email or masked-column value, a lost row or a duplicate key.

### Acceptance (M2.2a)
| ID | Criterion | Test |
|---|---|---|
| AC1 | The reader splits statements identically at any chunk size and round-trips every value kind | `tools/legacy-mask/tests/sql.test.ts` |
| AC2 | No original email, card number, code, key, token, bank detail, IP or name survives; secrets in settings replaced; card data emptied; credential tables emptied | `tools/legacy-mask/tests/mask.test.ts` |
| AC3 | Ids, amounts and dates unchanged; one person keeps one identity across tables; values pass the new product's email/E.164/JSON/bcrypt/length checks; NOT NULL respected | `mask.test.ts` |
| AC4 | Unique columns stay unique across 20,000 rows with forced collisions; deterministic per key; fail-closed on unknown tables; the verifier catches leaks, lost rows and duplicates | `mask.test.ts` |
| AC5 | The CLI: private key file, no overwrites, gzip in/out, verify exit codes | `tools/legacy-mask/tests/cli.test.ts` |
| AC6 | The masked dump loads into MySQL 8 with every row count equal (emptied tables empty) and valid JSON | CI job `legacy mask` (`tools/legacy-mask/scripts/import-check.sh`) |

### Legacy findings (for M0.0)
- `failed_bookings.payment_method` stores full card numbers, expiry, CVC and cardholder name for failed checkouts (legacy BookingsController); session payloads can carry the same. Storing CVCs is forbidden by PCI DSS.
- `notifications.data` and queued jobs hold generated guest passwords in plain text.
- `events.private_info` holds Wi-Fi passwords, parking and door codes.

## Next
- M2.2b: the ELT transforms T1–T9 from the masked dataset into the new schema, user dedupe, and the V1–V12 checks.
