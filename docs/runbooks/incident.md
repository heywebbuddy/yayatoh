# Incident response

Follows NIST SP 800-61r3 (prepare → detect/analyse → contain/eradicate/recover → post-incident).

## Severity
| Sev | Examples | Response |
|---|---|---|
| **SEV1** | Cross-tenant exposure; check-in outage during an event; payment outage; key or credential compromise; audit chain reported **broken** | Page primary + backup now; status page within 15 min; owner decides on legal notification |
| **SEV2** | Checkout success < 99.5 % for 15 min; scan p95 > 1 s; webhook backlog > 30 min; restore needed | Page primary; status page within 30 min |
| **SEV3** | A single org or feature degraded; rate-limit false positives; CSP report spike after a deploy | Next business day |

## On-call rota
**The rota, escalation, response targets and communication templates are in
[on-call.md](on-call.md)** (M3.11b). In short: the owner is primary; a contracted backup covers
nights and the owner's absences and is paged when the primary hasn't acknowledged in 10 minutes.
Until a paging tool exists (owner inbox: Better Stack, PagerDuty or Opsgenie), alerts go to both by
SMS and email. Event days over 1,000 attendees: both are reachable from doors-open − 1 h to
doors-close + 1 h.

## First 15 minutes
1. Acknowledge the alert; open an incident note (time, symptoms, links).
2. Stop the bleeding with the pre-authorized actions (roadmap §8.2): pause checkout, extend the
   check-in window, force offline mode for scanners, pause messaging, roll back
   ([rollback.md](rollback.md)).
3. Post on the status page (templates below and in [on-call.md](on-call.md)); the console and
   marketplace banners follow it automatically. Don't name customers.

## Suspected tenant leak (SEV1)
1. Contain: roll back the change or pause the affected surface; keep logs (don't rotate them).
2. Scope: which orgs, which records, which time window. The isolation suite
   (`pnpm test:isolation`) against the deployed commit; the org's Activity log (hash chain check)
   and `platform.access_log` for staff reads.
3. **72-hour clock (GDPR Art. 33)** starts when we are reasonably sure personal data was exposed.
   Yayatoh is processor for organizer data: notify affected organizers *without undue delay* so they
   can notify their authority; the owner and counsel decide on direct notifications.
4. Rotate anything that may have leaked ([key-rotation.md](key-rotation.md)).

## Audit chain reported broken
Settings → Activity shows "Integrity check failed at entry #N". Treat as SEV1 (possible database
tampering): snapshot the database (Neon branch), compare with the latest off-account dump, check
`platform.access_log` and database role logins, rotate database credentials.

## Status page template
> **Investigating** — Some organizers can't {what}. We're working on it; next update in 30 min.
> **Identified** — Cause found: {plain words}. {What people should do meanwhile}.
> **Resolved** — Fixed at {time UTC}. {Anything people need to do}. A summary will follow.

## Post-incident review (within 72 h)
Timeline · impact (orgs, attendees, money) · root cause · what went well · what didn't · action
items with owners (each a PR or an issue) · runbook changes.
