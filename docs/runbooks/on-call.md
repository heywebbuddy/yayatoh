# On-call rota (M3.11b)

Who answers when something breaks, how fast, and what we tell people. It complements
[incident.md](incident.md), which says *what to do* once an incident is open. Roadmap §8.2 and
§10: **on-call is human.** The owner is primary with a contracted backup; Claude Code helps with
read-only observability, and fixes go through reviewed PRs unless a runbook says otherwise.

> Names, phone numbers and the paging tool are **placeholders** until the owner fills them in
> (docs/owner-inbox.md, M3.11b). Never put personal phone numbers in this public repo: keep them
> in the paging tool and in the password manager's "On-call" vault item.

## 1. The rota

| Role | Who | Reach them | Covers |
|---|---|---|---|
| **Primary** | `<OWNER NAME>` | Paging tool (push + SMS), then phone | Business hours in `<OWNER TIMEZONE>`, and every event day |
| **Backup** | `<CONTRACTED BACKUP>` | Paging tool (push + SMS) | Nights, weekends, the primary's time off, and any page the primary hasn't acknowledged in 10 min |
| **Escalation** | `<OWNER NAME>` (decision-maker) | Phone | SEV1 decisions: legal notification, pausing payments, public statements |
| **Vendors** | Hosting, database, payments, email, SMS support | Support portals (links in the password manager) | Provider outages (see §6) |

**Weekly schedule** (hand-over every Monday 09:00 `<OWNER TIMEZONE>`):

| Week starting | Primary | Backup | Notes (events over 1,000 attendees, planned maintenance) |
|---|---|---|---|
| `<YYYY-MM-DD>` | `<name>` | `<name>` | |
| `<YYYY-MM-DD>` | `<name>` | `<name>` | |

**Event days.** For any event with more than 1,000 expected attendees (the organizer tells us, or
the attendee count says so), both primary and backup are reachable from **doors-open − 1 h to
doors-close + 1 h** in the event's timezone. Put these windows in the schedule's notes a week ahead.

**Hand-over checklist** (5 minutes, every Monday):
1. Open incidents and their next update time (admin console → **Incidents**, or the status page provider).
2. Events this week over 1,000 attendees, and their doors-open times in each event's timezone.
3. Deploys planned this week and anything frozen (see [deploy.md](deploy.md)).
4. Test page: the outgoing person sends a test page to the incoming one, who acknowledges it.

## 2. Severity levels

Same levels as [incident.md](incident.md), with who is paged and how fast.

| Sev | What it looks like | Examples | Page |
|---|---|---|---|
| **SEV1** — critical | People can't get in, can't pay, or data may be exposed | Cross-tenant exposure; check-in down during an event; payments down; key compromise; audit chain broken | Primary **and** backup, at once, any hour |
| **SEV2** — major | A core flow is badly degraded for many | Checkout success < 99.5 % for 15 min; scan p95 > 1 s; webhook backlog > 30 min; a restore is needed | Primary; backup if not acknowledged in 10 min |
| **SEV3** — minor | One org or one feature is affected; a workaround exists | One organizer's emails bouncing; rate-limit false positives; a CSP report spike after a deploy | Ticket; next business day |
| **SEV4** — cosmetic | No real impact | A typo, a layout glitch on one screen | Ticket; normal backlog |

When unsure between two levels, **pick the higher one**; downgrading later is cheap.

## 3. Response targets

| Sev | Acknowledge | First status-page post | Updates | Target to mitigate | Post-incident review |
|---|---|---|---|---|---|
| SEV1 | 5 min | 15 min | Every 30 min | 1 h | Within 72 h (required) |
| SEV2 | 15 min | 30 min | Every 60 min | 4 h | Within 72 h (required) |
| SEV3 | Next business day | Only if organizers notice | When it changes | 3 business days | Optional |
| SEV4 | — | No | — | Next release | No |

"Mitigate" means people can use the service again (a rollback, a pause, a workaround), not that the
root cause is fixed. Business hours are `<09:00–18:00, Mon–Fri, OWNER TIMEZONE>` (placeholder).

## 4. Escalation

1. **Alert fires** (SLO burn-rate alerts in [docs/ops/slos.md](../ops/slos.md), a vendor status
   page, or a report from an organizer) → the paging tool pages the primary.
2. **10 minutes without acknowledgement** → the backup is paged automatically.
3. **20 minutes without acknowledgement** (SEV1) → the backup phones the primary; if still no answer,
   the backup is incident commander until the primary joins.
4. **Decisions that need the owner** (always the owner, whoever is on call): notifying authorities
   or organizers about personal data (GDPR Art. 33, 72-hour clock; see incident.md), pausing all
   payments, public statements beyond the status page, refunds at platform cost.
5. **Vendors**: open a ticket at the provider's highest severity as soon as the cause is theirs;
   note the ticket number in the incident note.

The first person to acknowledge is the **incident commander** until they hand it over out loud
(in the incident note: "IC is now `<name>`").

## 5. Communicating

**Where:** the public **status page** is the single source of truth. The console and the
marketplace show a banner automatically while an incident or a maintenance window is open (they
read the status page through the `StatusPage` port). Organizer emails go only for SEV1/SEV2 that
affect their events. Never name customers or attendees in public.

**How to post** (production): in the status page provider (Better Stack, pending owner), create a
report, pick the affected components and the impact. In development, preview and CI, staff use the
admin console → **Incidents** (the fake provider); the web's banner and `/status` page read it the
same way.

**Impact → what people see:** *minor* = "Degraded", *major* = "Partial outage", *critical* =
"Major outage", *maintenance* = "Maintenance". Pick the impact from the severity: SEV1 → critical,
SEV2 → major, SEV3 → minor.

### Templates

Status page — **Investigating**
> We're looking into {what people notice, in plain words — e.g. "slow or failing checkouts"} affecting
> {some organizers / all ticket buyers}. Next update in {30|60} minutes.

Status page — **Identified**
> We've found the cause: {plain words, no internals}. {What people can do meanwhile — e.g. "Door staff can
> keep scanning: the app works offline and will sync."} Next update in {30|60} minutes.

Status page — **Monitoring**
> A fix is in place and {checkouts are completing / scans are syncing} again. We're watching closely
> and will confirm shortly.

Status page — **Resolved**
> Resolved at {HH:MM} UTC. {Anything people need to do — e.g. "Orders placed between 14:05 and 14:40 UTC were
> completed; no one was charged twice."} We'll publish a summary within 3 days.

Scheduled maintenance (post at least 48 h ahead; avoid event days)
> On {date} from {HH:MM} to {HH:MM} UTC we'll {upgrade the database}. {Checkout and check-in keep
> working / the console is read-only for up to 10 minutes}. No action is needed.

Email to affected organizers (SEV1/SEV2; from the platform sender)
> Subject: {Checkout issue} on {date} — what happened and what we're doing
>
> Hi {first name}, between {HH:MM} and {HH:MM} ({organizer's timezone}) {what happened, in one
> sentence}. {Your event(s): name} {were / were not} affected: {numbers, e.g. "12 buyers saw an error;
> none were charged"}. {What we did and what you may need to do}. The full timeline is on our status
> page: {link}. Reply to this email if you have questions. — {name}, Yayatoh

Internal note (first message in the incident channel)
> SEV{n} — {one-line symptom}. IC: {name}. Started {HH:MM} UTC. Status page: {posted HH:MM / not yet}.
> Next update {HH:MM} UTC. Links: {dashboards, logs, the alert}.

## 6. Provider outages

When the cause is a provider (hosting, database, payments, email, SMS): post on our status page
with the affected components anyway ("Our payment provider is having an issue…"), link their
status page, and follow incident.md's pre-authorized actions (pause checkout, force scanners
offline, pause messaging). Don't blame the provider in public beyond naming them.

## 7. After the incident

- Close the status-page report with the **Resolved** template.
- SEV1/SEV2: the post-incident review within 72 h (template in [incident.md](incident.md)), and a PR
  that updates any runbook that was wrong or missing.
- Add the incident to the rota's notes for the week so the next person knows.

## 8. Tools (pending owner)

| Need | Tool | Status |
|---|---|---|
| Status page + incident posts | Better Stack status page (recommended; `STATUS_PAGE_PROVIDER=betterstack`, `BETTER_STACK_API_TOKEN`, `BETTER_STACK_STATUS_PAGE_ID`) | Fake provider until the account exists |
| Paging + schedules | Better Stack on-call (or PagerDuty / Opsgenie) | Until then: SMS and email to both people |
| Alerts | SLO alerts from docs/ops/slos.md via the paging tool | After Axiom/Sentry |
| Password manager vault "On-call" | Phone numbers, vendor portals, break-glass steps | Owner |
