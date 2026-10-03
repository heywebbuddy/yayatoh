# privacy (tier 5)

Data-subject requests and retention (M1.14c). Owns Postgres schema `privacy`
(`dsar_requests`, the accountability record; `account_requests`, the global record of account DSARs). Reads and redacts other modules only through
their exported `*DsarTx` / retention functions, inside the caller's tenant transaction.

**Invariants**
- Only owners and admins (`privacy:manage`) find, export or erase a person. Every request is
  recorded in `privacy.dsar_requests` and audited; neither keeps the address (SHA-256 of the
  normalized email plus a masked hint).
- Erasure redacts in place; it never deletes rows other data depends on. Paid orders and the
  ledger are kept for 7 years (legal hold) with the buyer's name, email, account link, payment
  reference and manage link removed. Tickets stay valid (holder redacted, devices resync).
  Consent rows and check-in admissions are kept; they hold no personal data.
- Export files that mention an erased address are deleted; the access-request file itself expires
  after 7 days and the email in the export operation's params is cleared after a day.
- The access document is an allowlist (`yayatoh.dsar/1` JSON): no tokens, hashes, signing keys,
  provider ids or internal contact ids.
- Retention (`retentionCommand`) is idempotent, runs per org as a system actor, and uses the
  defaults in `src/retention.ts` (pending the owner's confirmation).

- Account requests (M1.14e, Yayatoh as controller; `src/account.ts`): the `yayatoh.account/1`
  document is an allowlist (a Zod schema drops every undeclared key). Self-service export and
  deletion need a step-up in the last 10 minutes; staff need a reason (10–500 characters). Deletion
  is refused while the person is the only owner of an org, sends the confirmation to the old
  address first, detaches the account in each org through `privacy.detachAccount` (a platform
  command: system actors only, audited in the org's chain), then anonymises the identity (packages/
  auth), adds the address to the platform-wide erased list and records the request in the global
  `privacy.account_requests` (hash + masked hint, actor, reason; SECURITY DEFINER insert only).
- Org-side erasure also removes team invitations addressed to the person and adds the address to
  the platform-wide erased list (`platform.erased_addresses`).

- M6.1c DSAR propagation: every module that holds personal data exports a `DataSubjectContributor`
  (`@yayatoh/platform`); the apps register them. A table with a personal or holder column and no
  contributor fails the coverage test. One open request per person per org (partial unique index),
  due 30 days after it is opened; the address is sealed with the org's key vault while the request is
  open and cleared when it closes. Fulfilling needs a recent step-up and is refused while staff act as
  a member (export / delete categories).
- The archive is a ZIP with a manifest of SHA-256 checksums signed with Ed25519 (`DsarSigner`;
  local key from APP_TOKEN_SECRET outside production); it is kept 7 days in the media store. The
  erasure receipt holds no personal data (masked hint, SHA-256) and is signed the same way.
- Erasure runs every contributor in one tenant transaction, then the media subscriber deletes stored
  files and the connector-hook subscriber tells M6.4 integrations (`privacy.subject_erased@1`).
- Events emitted: `privacy.subject_erased@1` (request id, subject SHA-256, media asset ids).

- Networking and chat (M5.8a/b): covered by engagement's data-subject contributor (batch 3u
  merge; batch 3j had moved privacy to tier 6 to call engagement directly, which M6.1c's
  contributors made unnecessary, so privacy stays tier 5). The access document lists the person's
  networking profiles, the notes on requests they sent, the reports they filed and the chat
  messages they sent; erasure redacts and opts out their profiles, clears those notes and report
  details, and deletes the chat messages they sent.

**Public surface:** `.` only.
