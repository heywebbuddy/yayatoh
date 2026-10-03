# UX review 1 — organizer feedback plan

Status: **draft for the owner** (2026-10-03). Source: `Yayatoh_organizer_review.docx`, one organizer's review of the build branch with 9 screenshots. The headline complaint: **UX is not good across the whole app.**

Each point was checked against the code (build branch at 784d0b6c, 2026-10-03). There are three kinds of finding:
- **Bug**: built, but broken.
- **Hidden**: built, but the organizer couldn't find it. This is a UX failure too.
- **Missing**: not built.

## 1. The review, point by point

| # | Review point | Finding | Kind |
|---|---|---|---|
| 1 | Dropdowns look bad everywhere | Every dropdown is the browser's native `<select>` (about 150 across 70 files). `packages/ui` has no custom Select or Combobox. Native date/time inputs (`dd/mm/yyyy, --:--`) have the same problem. | Missing (design system) |
| 2 | Blog published but no public page | The public blog exists (`/blogs/{slug}` on the org's site, "Blog" in the site header). "View on your site" builds the wrong URL on hosts without a tenant site (`contentHome` ignores `organizerBase()`), so it 404s. | Bug |
| 3 | How to connect a domain? | The flow exists and shows DNS records once a domain is added. The screenshot shows the step-up error ("Please confirm it's you") instead of the confirm dialog: the dialog didn't open or the retry failed. There is no explanation of what happens next. | Bug + Hidden |
| 4 | How to create a new template? | You can only make a template from an existing event ("Duplicate & template" inside the event). There is no "New template" button. | Missing |
| 5 | How to add or remove an event type? | Event types are fixed product profiles (conference, gala, wedding…), and each one decides which sections an event has. Categories are a fixed list. Nobody can manage either. Event tags don't exist. | Missing (decision) |
| 6 | Venue image field missing | Venue photos exist, but only on the venue's own page after creating it. The "Add a venue" form has no photo. | Hidden |
| 7 | Payout dashboard | The Payouts page explains settlements and receivables in prose with no numbers, charts or timeline. | Missing (UX) |
| 8 | Financial dashboard | Org sales sit on the Home page (`OrgSales`); reconciliation is at `/finance`; per-event gross-to-net is under each event's Analysis. Nothing is in the nav as "Finance" or "Reports". | Hidden |
| 9 | Series and events not connected | Create-event has no series field; you attach a series later in the event's Dates tab. The public event page never mentions its series. | Hidden + Missing |
| 10 | Command Center UI not good | The widget grid leaves empty holes (no dense packing; a 2-column readiness card beside nothing). The alerts tile is a placeholder. There is no clear hero: what to do next, money, countdown. | Bug + design |
| 11 | Missing from the PHP app: tags, categories, event types, commissions, coupons, currencies, media | Tags missing. Categories and types fixed (see 5). Commissions: admin-only per-org fee override plus a commission report; organizers see nothing. Coupons: per-event promo codes exist (Tickets & orders), but there is no org-wide coupon list or reusable codes. Currencies: org currency is a free-text box, with no per-event picker. Media library: missing (images attach to one item at a time). | Mixed |
| 12 | Organizer settings from PHP: storage, contact page, mail | Mail: a custom sending domain exists (`/sending`), but no from-name or reply-to. Storage: quotas exist in the backend, no page. Contact page: no org contact page or form. | Mixed (decision) |

**Pattern behind the complaint:** most features exist, but the console makes people hunt for them. The common causes:
- native form controls
- a long flat sidebar with no grouping
- forms that dump every field at once
- no in-product guidance ("How do I…?")
- prose where numbers belong
- dashboards that leave gaps

Fixing single screens won't change the overall impression. The plan therefore puts the shared fixes first: design-system controls, navigation and guidance. Feature gaps come after.

## 2. Decisions for the owner

| # | Decision | Recommendation |
|---|---|---|
| UX-1 | **Priority** | Run this UX track **next**, ahead of Phase 6 Waves 3–4 (SSO, Salesforce, agency v2, virtual…). Those serve future enterprise buyers; this serves today's organizers and the PHP migration. Merge batches already in flight (3i, 3j, 3k) continue. |
| UX-2 | **Event types** | Keep the **profiles** fixed: they are product modes that switch whole sections on and off, so a user-made "type" can't carry features. Add what organizers actually want: **org-managed categories** (rename, add, hide, reorder; platform defaults kept for the marketplace), **free tags** per event (filterable in the console and the public site), and a clearer **"What kind of event?"** picker with a description per profile. Staff manage the platform's default category list in admin. |
| UX-3 | **Storage and mail settings from PHP** | **No per-org storage or SMTP credentials** (security and support burden; storage is platform-managed). Instead: a **storage usage** page (quota, what uses it), and mail **from-name, reply-to and custom sending domain** on one "Email sending" page. |
| UX-4 | **Commissions** | Rates stay **set by Yayatoh staff** in admin (unchanged). Organizers see their fee plan and the fees taken per order and per payout on the new Finance pages. |
| UX-5 | **Coupons** | Keep per-event promo codes and add **org-wide coupons** that can apply to several or all events, with one list, usage counts and an expiry. |
| UX-6 | **Currencies** | A currency **picker** (ISO list) for the org default, plus a **per-event currency** (locked once anything is sold). No multi-currency display or conversion. |

## 3. UX principles for this track (every increment is checked against them)

1. **One look for every control.** No browser-default widgets, so Chrome, Safari, Windows and phones look the same.
   - **Select trigger:** `appearance: none`. Our own chevron icon (16 px, `--text-muted`) sits **inside** the field, centred vertically, with 12 px inline-end padding. The text gets enough end padding that it never runs under the chevron. RTL mirrors it.
   - **Chevron behaviour:** it turns 180° while the list is open and is never clipped by the border radius.
   - **The open list:** a floating panel in our theme (light and dark), never the OS grey popup. Selected item tick, hover and keyboard highlight, type-ahead, max height with scroll. Search appears automatically above 8 options. Long labels wrap; nothing truncates silently.
   - **Same rules everywhere:** date, time, time-zone and currency pickers, so `dd/mm/yyyy, --:--` placeholders disappear.
2. **Find it in two clicks.** A grouped navigation (Events · Audience & marketing · Money · Site & content · Settings) and a global **Create** button. Every "How do I…?" from the review has an obvious entry point.
3. **Explain, then ask.** Pages that need setup (Domains, Payouts, Sending, Templates) start with a short "How it works" panel and a step-by-step flow. They never open on a bare form with an error.
4. **Short forms, progressive detail.** Ask only what's needed to create something: name, date, type. Everything else follows on the next screen in sections. The Add venue form becomes create → photos → details.
5. **Numbers before prose.** Money and status pages lead with figures, trends and the next date. Explanations sit in a help panel, not in paragraphs.
6. **No dead ends.**
   - Every empty state says what goes there and has a primary action.
   - Every error says how to fix it.
   - Every created item links back to where it is used (series ↔ events, template → events, image → where it appears).
7. **Dashboards have a hero.** The top shows the one thing that matters now: countdown, mode, next action, money. The grid packs with no holes at any width.
8. **Consistent page anatomy.** Breadcrumb → title and primary action → summary → content. Same spacing, same table and card patterns, the same place for Save.

## 4. Increments

Eleven increments. Each is one agent session in the design v2 system, tested end to end (keyboard, axe in both themes, Arabic RTL), under the usual rules. U1 and U2 go first because everything else uses them; the rest run in parallel once U1 is merged.

### Wave U-A — foundations (first)
| Increment | Scope | Acceptance |
|---|---|---|
| **U1 Form controls** | (Principle 1 spec, incl. the chevron fix: own icon inside the field, centred, padded, RTL-mirrored.) New `@yayatoh/ui` **Select** (styled listbox), **Combobox** (searchable, async, multi-select with chips), **DatePicker / DateTimePicker / TimeZonePicker** (event-zone aware) and **CurrencyPicker**. Then **replace every native `<select>` and date/time input** in web and admin (~150). A check-modules rule forbids raw `<select>` and `type="datetime-local"` outside the UI kit. | No native select or date input left (the gate proves it); keyboard and screen-reader patterns per WAI-ARIA; RTL; 24 px targets; both themes; e2e selectors moved to roles, no assertion weakened |
| **U2 Console navigation and guidance** | **Grouped sidebar**: Events · Audience & marketing · Money · Site & content · Settings, collapsible, with the current section remembered. A global **Create** menu (event, series, template, venue, coupon, page). **Contextual help**: a "How it works" panel and doc links on Domains, Templates, Series, Payouts, Sending, Event types. A **Help** entry linking the platform help. **Every empty state** gets a primary action. Breadcrumbs everywhere. | Every org page is reachable from the grouped nav; each page in the review has a help panel; an empty-state audit test lists zero pages without an action |

### Wave U-B — the review's gaps (parallel after U1)
| Increment | Scope | Acceptance |
|---|---|---|
| **U3 Review bugs** | Blog "View on your site" uses `organizerBase()` on every host; a public-link test per host type. Domains: reproduce the step-up failure, fix it, and show a **step-by-step connect wizard** (enter domain → copy DNS records → live check → SSL ready). Venue "Add" form becomes create-then-photos with the uploader inline. | The blog link resolves on subdomain, custom domain, apex and dev hosts; adding a domain with an expired session opens the confirm dialog and completes; a venue can be created with a photo in one flow |
| **U4 Command Center v2** | Hero strip: countdown, the mode, the one next action. A KPI row (sales, tickets, check-ins, alerts). Dense grid packing with no holes at any breakpoint; real alerts (no placeholder); readiness as a checklist with deep links; an org-level overview with money per event. | Visual snapshots at 3 widths show no empty cells; the owner, ops and door views each pass their role rules (the door never sees revenue) |
| **U5 Finance and payouts dashboards** | A **Money** section: **Overview** (gross, fees, refunds, net, payouts, chart by day/week/month in the org time zone), **Payouts** (upcoming and past payouts as a timeline, held reserve with its release date, receivables, per-payout breakdown down to orders), **Sales by event**, **Fees** (fee plan and fees taken; UX-4), CSV export. Reads only existing ledgers and reports. | Totals match the ledger to the cent on the fixture org; a payout drills down to its orders; the reports and finance permissions are enforced |
| **U6 Templates** | **New template** from scratch: pick a profile, then sections, default tickets, page content, checklist and duration. Edit and archive templates. "Save as template" shown on the event header, not only under Duplicate. | A template made from scratch creates an event with exactly its tickets, sections and content |
| **U7 Series ↔ events** | Series field in create-event (pick or create inline). The event header shows its series with a link. The series page has an events tab with status and sales, add/remove events, and "Create next event in series". The public event page shows "Part of {series}" with a link. | An event created inside a series appears on the series page and the public series page; removing it unlinks both ways |
| **U8 Categories, tags, event-type picker** (UX-2) | Org categories (add, rename, hide, reorder; defaults from the platform), event tags (create on the fly, filter in the console and on the public site, `/v1` additive), the profile picker with descriptions, and admin management of platform default categories. | A hidden category disappears from pickers but keeps history; tag filters work in the console, the public site and `/v1` |
| **U9 Coupons and currencies** (UX-5, UX-6) | Org-wide coupons (apply to all or chosen events, limits, expiry, usage), one coupon list with per-event codes alongside. CurrencyPicker for the org; per-event currency locked after the first sale. | A coupon applies only to its events and limits; the event currency can't change after a sale (command test) |
| **U10 Media library and settings parity** (UX-3) | An org **Media library** (all images, reuse across events, venues and pages, alt text required, usage shown), a **storage usage** page, **Email sending** with from-name and reply-to next to the sending domain, and an **org contact page** block (contact form → organizer inbox, spam-protected, consent) for the org site. | Reusing an image never duplicates the file; quota usage matches stored files; the contact form delivers once and never exposes the org's email address |

### Wave U-C — the whole-app pass
| Increment | Scope | Acceptance |
|---|---|---|
| **U11 UX sweep** | A Playwright crawl screenshots every console, admin and public page at 3 widths in both themes into a contact sheet. A heuristic review (consistency, density, labels, empty and error states, long forms split into steps or sections, prose turned into numbers). Fix everything that is shared-component or copy level. Page-specific issues go to a backlog with screenshots. | The contact sheet is attached to the report; every finding is either fixed or in the backlog with its screenshot |

## 5. Timing and cost

- **Calendar time:** U1 and U2 take about 5–8 hours. U3–U10 then run in parallel for another 5–8 hours. U11 takes 4–6 hours. Merging adds 2 batches. That is roughly **1.5–2 days** with 10 slots.
- **Cost:** no new vendors, so no new monthly spend.

## 6. Owner to-dos

- Decisions UX-1 to UX-6.
- Optional, but it would sharpen U11: tell me the organizer's three most frequent tasks, or let them try the next preview.
