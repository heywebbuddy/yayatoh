# Runbook — export and mask a legacy database

**Who runs it:** the owner or the owner's Laravel developer, on a machine that already has
access to the production data (the database server, a replica, or wherever backups are kept).
**What leaves that machine:** only `masked.sql.gz`. The raw dump and the masking key never do.

Run it once per instance: `yayatoh.com` and `abc.yayatoh.com`.

## 0. Before you start

- Use a **backup or a read replica**, never the live primary under load (roadmap §7.1).
- You need Node.js 24 (`node --version`), or Docker to run it (step 3b).
- Get the tool: clone `heywebbuddy/yayatoh` or copy the folder `tools/legacy-mask/` (it has no dependencies).
- Allow about 3× the dump's size in free disk space.

## 1. Dump

```bash
# Structure + data, consistent snapshot, utf8mb4, one INSERT per table chunk.
mysqldump --single-transaction --quick --no-tablespaces \
  --default-character-set=utf8mb4 --hex-blob \
  -u <read-only user> -p <database> | gzip > dump.sql.gz
chmod 600 dump.sql.gz
```

Structure only (safe to send as-is, no customer rows):

```bash
mysqldump --no-data --no-tablespaces -u <user> -p <database> > schema.sql
```

## 2. Create a masking key (once, keep it)

```bash
node tools/legacy-mask/cli.ts keygen --out mask.key
```

The key makes masking **repeatable**: the same person becomes the same fake person every
time you mask a newer dump, so later rehearsals line up. Keep `mask.key` with the raw dumps.
**Never send it with the masked file**: whoever has both could test guesses against it.

## 3. Mask

```bash
node tools/legacy-mask/cli.ts mask --in dump.sql.gz --out masked.sql.gz \
  --key-file mask.key --report mask-report.json
```

3b. With Docker instead of a local Node:

```bash
docker run --rm -v "$PWD:/w" -w /w node:24 \
  node tools/legacy-mask/cli.ts mask --in dump.sql.gz --out masked.sql.gz --key-file mask.key --report mask-report.json
```

The command prints any text columns it kept without a rule ("review"). They are normally public
event content (titles, descriptions, CMS pages). If one of them holds personal data, stop and
tell the build team; a rule is added and you mask again.

## 4. Verify (must say OK)

```bash
node tools/legacy-mask/cli.ts verify --original dump.sql.gz --masked masked.sql.gz
```

It checks that every table kept its rows (tables emptied on purpose must be empty), that no
original email address or masked-column value survives anywhere, and that unique keys are
still unique. **Any FAILED line: don't send the file.**

Optional, proves the masked file loads into MySQL like the original (needs a scratch MySQL 8):

```bash
MYSQL="mysql -h127.0.0.1 -uroot -p<scratch password>" \
  tools/legacy-mask/scripts/import-check.sh dump.sql.gz masked.sql.gz
```

## 5. Send and clean up

- Send `masked.sql.gz` and `mask-report.json` (the report has table and column names and counts, no data) through a private link (a private bucket or a one-time download link). Never email it and never put it in git.
- Keep `dump.sql.gz` and `mask.key` in the encrypted `legacy-ref` store only; delete other copies.

## What masking changes

| Data | Becomes |
|---|---|
| Emails (everywhere, including inside JSON and free text) | `u.<12 hex>@masked.yayatoh.test`, the same for the same person across tables |
| Names | Fictional names from a fixed list |
| Phones | Fictional `+1555…` numbers (E.164) |
| Street addresses, postcodes, IPs | Look-alike fakes (IPs in documentation ranges) |
| Passwords | One bcrypt hash of the word `password` (the legacy login path still runs) |
| Tokens, API keys, access codes, event passwords | Same length and shape, new value |
| Stripe/PayPal ids | Same prefix (`pi_`, `cus_`, `acct_`), new value |
| Bank and tax fields | Empty |
| Messages, reviews, notes, bios | Placeholder text of about the same length |
| Event private info, notifications (incl. generated guest passwords) | Same JSON shape, every value replaced |
| `failed_bookings.payment_method` (raw card data) | `{}` |
| Sessions, password resets, OTPs, cache, queues, webhook logs | Emptied (tables kept) |
| Secrets in `settings` (payment, mail, storage, AI keys) | `masked` |
| Ids, amounts, currencies, dates, statuses, public event content | Unchanged |
