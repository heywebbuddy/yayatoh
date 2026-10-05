# Spec: M3.8 — Attribution and marketing analytics

- **Milestone:** M3.8 (roadmap Phase 3, "M3.8 Attribution and marketing analytics"; plan `docs/plans/phase-3.md` Wave A)
- **Status:** M3.8a built (defaults pending owner, see §16); M3.8b built (campaign analytics, tiles, deliverability; see "M3.8b")
- **Risk tags:** db-migration, tenancy, legal-copy (privacy notice / cookie list)
- **Related ADRs:** 0018 (tokens), 0019 (toolchain)

## M3.8a — click tracking and attribution

### 1. Goal and users
Organizers (owner, admin, manager, marketing) create **tracked links** for an event per source, medium and campaign, share them (copy or QR), and see what each link brought in: clicks, attributed orders, revenue per currency and conversion. Viewers and finance members read the results. Buyers notice nothing: a link redirects them to the event page on the same site. Acceptance (roadmap): **an end-to-end click → purchase is attributed.**

### 2. References
- **Vision:** §8 Marketing ("campaign analytics"), §7 Command Center (revenue by channel).
- **Roadmap:** M3.8; domain model `marketing: tracking_links, link_clicks, attributions` (§5.1); tenancy rules §4.3.
- **Built on:** event short links (M1.4d, `events/src/commands/short-links.ts`: code alphabet, SECURITY DEFINER lookup), legacy redirects (`marketplace/src/domain/redirects.ts`), tenant hosts (M1.11, `tenancy/src/hosting`, `proxy.ts`), checkout (M1.5), M1.12 facts (sold statuses, gross per currency), M1.14 rate limiter and the `yy_did` device cookie.

### 3. Scope
**In:**
- **Redirector** `/r/{code}` on the marketplace/app host and on every tenant host. The proxy rewrites a tenant host's `/r/{code}` to `/{locale}/t/{orgId}/r/{code}`, so the host's org is a route param and only its links resolve there. The response is always a **302** with `Cache-Control: no-store` and `X-Robots-Tag: noindex`. Unknown codes, drafts and other orgs' codes on a tenant host get a 404.
- **Open-redirect proof destinations.** A link's destination is a **path on the same host** (default: the event page `/events/{slug}`), never a URL:
  - `destinationProblem` refuses anything that isn't a clean path: schemes, `//` and `/\` prefixes, dot segments, encoded `/` `\` `.` or control characters, `?`, `#`, a bare `%`, and anything over 300 characters. A CHECK constraint enforces the same in the database.
  - `redirectTarget` builds the Location from the request's own origin and throws if it would leave it.
- **UTM.** The link's `utm_source`, `utm_medium` and `utm_campaign` (plus optional `utm_content` and `utm_term`) are added to the destination. Incoming `utm_*` values the link doesn't set are kept (the link's own always win). Every other incoming parameter is dropped, a `yyc` included.
- **Signed click ID.**
  - A human click writes a `link_clicks` row whose uuidv7 id is the click id. `yyc = <id>~<HMAC-SHA256("tracked-click:" + id)>` under `APP_TOKEN_SECRET`, truncated to 32 base64url characters.
  - The id is appended to the Location and set as the `yy_click` cookie (HttpOnly, SameSite=Lax, 24 h).
  - The proxy turns a **valid** `yyc` in any page URL into the cookie; a forged, altered, expired (older than 24 h) or future token is ignored.
- **Bot filtering.** These are redirected but never counted: user agents of crawlers, link-preview fetchers, headless browsers and HTTP libraries; empty or very short user agents; `HEAD` requests; and requests over the `trackedClick` rate limit (M1.14 limiter: 30 per device per 10 minutes, 60 per IP without a device cookie, a 600 IP ceiling). No click id is issued for them.
- **Attribution model** (`packages/modules/marketing/src/domain/window.ts`):
  - **Click → session → order.** Right after checkout creates an order, `recordCheckoutAttribution` (web) runs `marketing.attributeOrder` with the verified click cookie, the `yy_did` device id and the UTM cookie.
  - **Which clicks count:** clicks for the order's event, from that click id or from the same device, dated within the org's window before the order (`orderAt − window ≤ clickedAt ≤ orderAt + 2 min skew`).
  - **First touch** is the earliest counting click and **last touch** the latest; they may be the same click.
  - **UTM-only:** without a counting click, the landing page's UTM values (`yy_utm` cookie: first and last landing, each with its time, inside the window) give a `utm` record.
  - Without either, no record is written. There is one record per order at most (unique index; a second call returns `exists`). The record keeps the window it was made with.
- **Window:** default **30 days** (pending owner), configurable per org from 1 to 90 days on the Tracked links page.
- **Console** (event → *Tracked links*, module `marketing`, `marketing:read`):
  - **Create form** (`marketing:write`): source, medium and campaign; optional name, content, term and page path. Per-field errors.
  - **List:** each link with its URL, a copy button, clicks, orders (last touch), revenue per currency, conversion.
  - **UTM-only orders** grouped by source, medium and campaign.
  - **Attribution window** form.
  - **Per-link report:** URL, QR, copy, figures (clicks, visitors, last-touch orders, first-touch orders, revenue, conversion) and the orders the link touched (first, last or both; status; total), each linking to the order.
  - **Order page:** an "Where this order came from" section (first and last touch) when a record exists.
- **Hook for later waves:** `createTrackedLinkTx(tx, ctx, { eventId, source, medium, campaign, content?, term?, label?, destinationPath?, campaignId?, journeyStepId? })`, exported for M3.6b campaigns and M3.7a journeys. They call it inside their own commands, which carry the permission and the audit.

**Out:**
- Campaign → registrations and revenue tiles and deliverability alerts (M3.8b).
- Cross-event and multi-touch models (linear, time decay) and a warehouse (M6.2).
- Links not tied to an event (org home page links): campaigns may need them in M3.6b. The table can take a nullable event then (expand migration).
- Archiving or editing links, and a link's click time series (M3.8b / M3.1 metrics).
- The embeddable widget (M1.11c) does not carry the click cookie across the organizer's own domain.

### 4. `touches:`
```yaml
touches:
  - packages/modules/marketing/**              # new module (tier 5)
  - packages/modules/orders/src/facts.ts        # orderOutcomesTx (read-only facts)
  - packages/modules/orders/src/index.ts
  - packages/modules/tenancy/src/domain/permissions.ts   # marketing:read
  - packages/platform/src/security/rate-limit.ts          # trackedClick policy
  - packages/db/drizzle/0071_youthful_krista_starr.sql (+ meta)
  - packages/testing/src/fixtures.ts, packages/testing/tests/marketing.int.test.ts
  - apps/web/src/proxy.ts                        # /r rewrite, device id hand-over, landing capture
  - apps/web/src/lib/attribution-capture.ts, apps/web/src/lib/tracked-links.ts
  - apps/web/src/server/redirector.ts, apps/web/src/server/attribution.ts
  - apps/web/src/app/[locale]/r/[code]/route.ts, apps/web/src/app/[locale]/t/[org]/r/[code]/route.ts
  - apps/web/src/app/[locale]/events/[slug]/actions.ts   # the checkout hook (2 lines)
  - apps/web/src/app/[locale]/o/[org]/e/[event]/tracked-links/**
  - apps/web/src/app/[locale]/o/[org]/e/[event]/orders/[orderId]/page.tsx
  - apps/web/src/app/[locale]/o/[org]/e/[event]/layout.tsx, apps/web/src/components/{tracked-links,icons}.tsx
  - apps/web/messages/*.json (trackedLinks.*, nav.trackedLinks)
  - apps/web/e2e/tracked-links.spec.ts
```

### 5. Data model (schema `marketing`)
| Table | Change | Notes |
|---|---|---|
| `marketing.tracking_links` | new | `event_id`, global `code` (8 characters from the unambiguous alphabet, `tracking_links_code_key`), `label`, `utm_*`, `destination_path` (CHECK: a same-site path), `campaign_id`, `journey_step_id` (no FK until M3.6b/M3.7a), `created_by`. FK (org, event) → events (cascade) |
| `marketing.link_clicks` | new | id = click id (uuidv7), `link_id` (FK cascade), `event_id` (FK), `clicked_at`, `device_hash`, `ip_hash` (32 hex characters, HMAC). No user agent, referrer or raw IP |
| `marketing.attributions` | new | one per order (`attributions_org_order_key`). `model` is `click` or `utm`; first and last click and link (composite FKs); first and last time; last-touch UTM; first-touch source, medium and campaign; `window_days`. FK (org, order) → orders (cascade), (org, event) → events |
| `marketing.attribution_settings` | new | one per org, `window_days` 1–90 |

**RLS notes:**
- [x] All four tables use `tenantTable()`: `org_id NOT NULL`, ENABLE and FORCE, the canonical NULLIF policy, org-leading indexes, composite FKs. The only global unique is `tracking_links.code`, like event short codes (the redirector must resolve it before it knows the org).
- [x] Cross-tenant resolution only through the SECURITY DEFINER `marketing.tracked_link_target(code)` (allowlisted columns; live orgs; events with a public page).
- [x] Rows for both orgs in `createOrgFixture` (a link, a click, the fixture order's attribution, a settings row).
- [x] No `@private` columns: the hashes are one-way and never leave the module.

**Migration:** `packages/db/drizzle/0071_youthful_krista_starr.sql`. New schema and tables only, so it is additive. Hand-written between the markers:
- `tracking_links_event_fk`, `link_clicks_event_fk` and `attributions_event_fk` → `events.events(org_id, id)` ON DELETE CASCADE.
- `attributions_order_fk` → `orders.orders(org_id, id)` ON DELETE CASCADE (orders are never deleted).
- `CREATE FUNCTION marketing.tracked_link_target(text)` (SECURITY DEFINER, `search_path = pg_catalog`), then REVOKE from PUBLIC and GRANT EXECUTE to `app_user`.

### 6. API diff
- **`/v1`:** none.
- **Commands and queries** (entitlement `marketing`):

  | Name | Kind | Permission |
  |---|---|---|
  | `marketing.createTrackedLink` | command, audited | `marketing:write` |
  | `marketing.recordClick` | command, public (the org comes from the link) | `public:track` |
  | `marketing.attributeOrder` | command, public (the org comes from the checkout's event), idempotent per order | `public:checkout` |
  | `marketing.setAttributionWindow` | command | `marketing:write` |
  | `marketing.linkReport`, `marketing.linkDetail`, `marketing.utmOnlyReport`, `marketing.attributionSettings` | queries | `marketing:read` |
  | `marketing.orderAttribution` | query | `orders:read` |

  Every output is an allowlisted Zod DTO. There are no buyer names or emails, no hashes and no raw rows.
- **Orders:** a new read-only export `orderOutcomesTx(tx, orderIds)` (status, sold, total, currency, created). The marketing module never reads the orders schema.
- **`/api/v2`:** none.

### 7. Events
None emitted. Attribution runs synchronously in the checkout request, as a separate command after the order commits. Revenue is read at report time from the orders facts, so no `order.paid` subscriber is needed.

### 8. Entitlements and flags
- **Module key:** `marketing` (in `launch_standard`).
- **Nav:** "Tracked links" in every profile's build group when the org has `marketing` and the member has `marketing:read`.
- **Permission:** `marketing:read` is new. It is granted to owner, admin, manager, marketing, finance and viewer, and not to box office or scanner. Event-scoped door staff don't get it.

### 9. ELT impact
None. Legacy has no click tracking.

### 10. Acceptance criteria
| ID | Given / When / Then | Test |
|---|---|---|
| AC-M3.8a-01 | **Given** a link **When** a guest opens `/r/{code}` on the org's host and buys **Then** the order is attributed first and last touch and the report shows 1 click, 1 order, $25.00, 100 % | e2e `tracked-links.spec.ts` "creates a link by keyboard…"; int "click → purchase" |
| AC-M3.8a-02 | Two clicks from one device on two links → first touch is the earlier link, last touch the later; only sold orders count | int "click → purchase: first touch…" |
| AC-M3.8a-03 | A click outside the window (31 days by default; or older than a shorter window) is ignored | int "an expired click…"; unit "attribution window" |
| AC-M3.8a-04 | A tampered click id is ignored: no cookie is set, the order is not credited, and the untouched token is accepted | e2e "a tampered click id…"; unit "signed click id" |
| AC-M3.8a-05 | Destinations are same-site paths only (URLs, `//`, `/\`, encoded slashes and dot segments refused; the DB CHECK holds) | unit "open-redirect guard"; int "refuses destinations…"; e2e "validation…" |
| AC-M3.8a-06 | Bots are redirected (302, no-store) but not counted and get no click id; unknown and other-org codes are a 404 | e2e "the redirector…"; unit "bot filtering" |
| AC-M3.8a-07 | UTM-only attribution without a click; stale UTM landings ignored | int "UTM-only…"; e2e "UTM-only…" |
| AC-M3.8a-08 | Isolation: another org can't read, click, report or attribute with the org's links; every table is in the isolation suite | int "isolation"; `isolation.int.test.ts` |
| AC-M3.8a-09 | Permissions: a viewer reads but can't create (hidden control and refused action); a scanner reads nothing; the marketing role creates | int "permissions"; e2e "a viewer reads…" |
| AC-M3.8a-10 | The click log holds no raw IP or device id | int "the click log stores only keyed hashes" |
| AC-M3.8a-11 | Keyboard-only creation and copy, axe on every page, Arabic RTL with the locale kept through the redirect, 375/768/1280 | e2e (all tests run in 3 projects) |

### 11. Security and privacy
- **Open redirect:** covered by §3, a CHECK constraint, unit tests, and a final origin assertion in `redirectTarget`.
- **Tenancy:** the org comes from the link (SECURITY DEFINER lookup) or from the checkout's server-side event lookup, never from headers. A tenant host only serves its own org's codes. `attributeOrder` only sees clicks under the order's org (RLS), so another org's click id is invisible.
- **Integrity:** click ids are HMAC-signed and time-bounded. Bots and rate-limited floods can't inflate figures. Attribution never blocks checkout: a failure is logged and the order proceeds.
- **Privacy:**
  - The click log has keyed hashes of the IP and device id only.
  - The cookies are `yy_click` (24 h), `yy_utm` (90 days) and the existing `yy_did`. All are HttpOnly and SameSite=Lax.
  - The privacy notice, cookie list and click-log retention are pending the owner (§16).
- **Audit:** creating a link, each click, each attribution and window changes are audited through the command pipeline.

### 12. Performance budget
- The redirect does one DEFINER lookup, one rate-limit hit and one insert. It targets p95 ≤ 150 ms and never caches (no-store).
- Reports read one event's links (≤ 200), grouped click counts, and the order facts in batches of 5,000. That fits Phase 3 volumes; heavier analytics move to the M3.1 sink / M6.2.

### 13. Rollout
Behind the `marketing` module (on in `launch_standard`). No flag. Rollback: hide the nav item; the tables are additive.

### 14. Increment breakdown
| # | Increment | PR scope | Risk tags |
|---|---|---|---|
| 1 | M3.8a click tracking and attribution | this section | db-migration, tenancy, legal-copy |
| 2 | M3.8b campaign tiles and deliverability alerts | Wave C | — |

### 15. Demo checklist
- [ ] As `pani@lakeside.test`, open Lakeside Open House → Tracked links, and create `newsletter / email / spring` named "Spring newsletter".
- [ ] Copy the link, or open the report and scan the QR.
- [ ] In a private window, open `http://lakeside-events.yayatoh.events:3000/r/{code}`. The browser lands on the event page with `utm_*` and `yyc` in the address.
- [ ] Buy a pass and pay on the test page.
- [ ] Back in the console, the link shows 1 click, 1 order, the revenue and 100 %. The report lists the order as "First and last click", and the order page shows "Where this order came from".
- [ ] Sign in as `jordan@lakeside.test` (viewer): the page is read-only.

### 16. Owner tasks (also in `docs/owner-inbox.md`)
- [ ] Confirm the defaults:
  - a 30-day window, configurable from 1 to 90 days
  - last touch gets the revenue
  - only sold orders count, with gross revenue
  - clicks count for their own event only
  - `marketing:read` for viewers and finance
- [ ] Add click tracking and the `yy_click` / `yy_utm` cookies to the privacy notice and cookie list, and set a retention period for `marketing.link_clicks` (suggested: 13 months).

## M3.8b — campaign analytics and deliverability

- **Branch:** `agent/m3.8b` · **Risk tags:** db-migration (one nullable column)
- **Built on:** M3.8a (tracked links, clicks, attribution records), M3.2a (widget registry, role layouts), M3.2b (alert engine, `deliverability` rule), M3.5a/b (delivery events, complaint auto-pause, sending domains). Campaigns (M3.6b) are not merged yet: see "Campaign join point".

### Built
- **Campaign → registrations and revenue** (`@yayatoh/marketing`: `domain/analytics.ts` pure, `analytics.ts` queries):
  - `marketing.analyticsReport` (`marketing:read`): one row per **campaign**, **channel** (UTM medium) or **link**, over a date range of calendar days in the org's time zone (default the last 30 days, at most 366; bad input is `validation_failed` with `invalid_date` / `from_after_to` / `range_too_long`). Figures: sends and deliveries (messaging campaigns), clicks, unique clickers (distinct devices), first-touch and last-touch orders and revenue (integer minor units, org currency; other currencies counted apart), conversion (last-touch orders per click, basis points). Every link has a row even with zeros. Only sold orders created inside the range count.
  - A campaign row is either a messaging campaign (`c.{campaignId}`: its links' `campaign_id`) or a UTM campaign (`u.{utm_campaign}`: other links, and UTM-only orders by their first/last landing).
  - `marketing.campaignDetail`: one campaign's figures, delivery (sent, delivered, bounced, complained, rates), its links and the orders it touched (first, last or both; no buyer data).
  - CSV export (`analyticsCsv` through the `marketing.analyticsCsvRow` allowlist serializer; BOM, formula-like cells neutralised, localized header, totals line).
- **Deliverability** (`marketing.deliverability`, `messages:read`): email bounce and complaint rates over the alert window (7 days) for the org, each **sending domain** and each **campaign**, judged against the same thresholds as the alert (`@yayatoh/notifications/deliverability`: `DELIVERABILITY_THRESHOLDS`, `rateBps`, `deliverabilityVerdict`, pure), plus the M3.5a auto-pause state.
  - The dispatcher now records the domain each email went out from (`notifications.messages.sender_domain`: the org's verified sending domain, else the platform sender's).
  - **Alert engine:** `OrgFacts.emailScopes` (per domain and per campaign); the `deliverability` rule also fires when one domain or one campaign is over a threshold on its own (params `domains`, `campaigns`), and its fix link is now the suppression list (`/messaging#suppressions`). It resolves when the window passes.
- **Command Center tiles** (registered in `COMMAND_CENTER_WIDGETS`): `campaigns` (module `marketing`, `marketing:read`, owner + marketing, `revenue: true` — never the door) and `deliverability` (`messages:read`, owner + marketing, follows `org.alerts`). The marketing layout leads with them. The campaign tile has a bar chart with its data table (accessible alternative) and links into each campaign.
- **Console:** Marketing analytics (`/o/{org}/marketing-analytics`, org nav, `marketing:read`): range form (GET, keyboard), figure tiles, Campaigns / Channels / Links, chart + "Show the data" table + full table, Export CSV; campaign drill-down (`…/campaign?key={key}`: keys contain dots, which the proxy treats as files in a path); Email deliverability (`…/deliverability`, `messages:read`): alert card, pause banner, org / domain / campaign tables with status, links to the suppression list and alerts. 13 locales, Arabic RTL, strict CSP (SVG attributes only, no inline styles).

### Campaign join point
M3.6b queues one message per recipient under the dedupe key `campaign:{campaignId}:{contactId}` (`campaignDedupeKey`, `CAMPAIGN_DEDUPE_PREFIX` in notifications) and creates its links with `createTrackedLinkTx(…, { campaignId })`. Sends and deliverability read the campaign id from the dedupe key; clicks and orders from the links' `campaign_id`. A campaign's **name** is its links' label (M3.6b labels them with the campaign name); when campaigns merge, the web can swap in `campaigns.name` without a schema change. Test sends (`campaign-test:`) are never counted.

**Batch 3g merge (campaigns merged in 3e):** M3.6b's dedupe keys (`sendPrefix` = `campaign:{id}:`) and its tracked links (`createTrackedLinkTx(…, { campaignId })`) match the join point unchanged. Names now come from M3.6b through its public read (`campaignNamesTx`, `campaigns.campaignNames`, `marketing:read`): the Command Center tile takes them through a port (`campaignsWidget(names)`, the web passes `campaignNamesTx`; campaigns and the Command Center share tier 6), and the analytics page, CSV export, drill-down and deliverability page name messaging campaigns in the web. The links' label stays the fallback (readers without `marketing:read`, a deleted campaign).

### Migration
`packages/db/drizzle/0101_naive_scorpion.sql` (renumbered at merge from 0086): `ALTER TABLE notifications.messages ADD COLUMN sender_domain text` (nullable, metadata-only). **Hand-written** (between markers): `messages_sender_domain_check` added `NOT VALID`, then `VALIDATE CONSTRAINT`. No new tables (the isolation fixture needs no rows); the column is declared `internal` in `notifications/src/private-columns.ts`.

### Later / not yet
- Per-scope alert rows (one alert per domain or campaign) need the `alerts_scope_check` widened; today one org alert carries the counts.
- `/v1` read endpoints for the analytics (optional in the brief); open and click rates per message (no open tracking yet); time series per campaign (M3.1 metrics / M6.2 warehouse).
- Mail sent before this change has no recorded sender domain ("Not recorded").

### Acceptance
| ID | Criterion | Test |
|---|---|---|
| AC-M3.8b-01 | Fixture clicks → orders credited first and last touch exactly, per campaign, channel and link; totals | int `packages/testing/tests/marketing-analytics.int.test.ts`; unit `packages/modules/marketing/tests/analytics.test.ts` |
| AC-M3.8b-02 | Date range in the org zone (DST, exclusive end), validation errors, empty ranges | unit `analytics.test.ts`; int; e2e `apps/web/e2e/marketing-analytics.spec.ts` |
| AC-M3.8b-03 | Campaign drill-down (figures, delivery, links, orders with touch) | int; e2e |
| AC-M3.8b-04 | CSV export through the allowlist (header, rows, totals, formula neutralising, no buyer data) | int; e2e |
| AC-M3.8b-05 | Rate maths and thresholds (org, domain, campaign; minimum volume) | unit `notifications/tests/deliverability.test.ts`, `alerts/tests/rules.test.ts` |
| AC-M3.8b-06 | Thresholds raise the deliverability alert, idempotent, resolve when the window passes, reopen; auto-pause shows and is critical; alert links to the suppression list | int `marketing-analytics.int.test.ts`, `alerts-rules.int.test.ts`; e2e |
| AC-M3.8b-07 | Marketing layout tiles with exact fixture numbers; door gets no revenue (layout, customize, API 403) | unit `command-center/tests/domain.test.ts`; int; e2e |
| AC-M3.8b-08 | Permissions (viewer reads analytics not deliverability; scanner nothing) and isolation | int; e2e |
| AC-M3.8b-09 | The dispatcher records the sending domain | int |
| AC-M3.8b-10 | Keyboard, axe on every screen and state, Arabic RTL, 375/768/1280 | e2e |
| AC-M3.8b-11 (batch 3g) | A real M3.6b campaign sent through the scheduler and dispatcher: its own row with exactly its sends (test sends not counted), drill-down delivery and link, named from M3.6b on the tile, isolated | int `packages/testing/tests/campaign-analytics.int.test.ts` |
