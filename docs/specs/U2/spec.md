# U2: Console navigation, Create menu, contextual help and empty states

Source: `docs/plans/ux-review-1.md` (approved 2026-10-03), principles 2, 3, 6 and 8 and row U2.

## What was built

### Grouped, collapsible sidebar (org console)
- `apps/web/src/lib/org-nav.ts` is the single model: five sections in the review's order, **Events · Audience & marketing · Money · Site & content · Settings**, each item with its path, icon, module (entitlement) and the permission it needs (`needs`). `visibleOrgSections()` filters by module, role permission, the content org (help center and marketing site) and collaborators (home only). Empty sections disappear.
- Every org page belongs to exactly one item (`owns` maps extra first segments, e.g. `contacts` → Audiences, `events` → Home). The search results page is reached from the top bar search (`TOP_BAR_ROUTES`).
- Pages that had no sidebar entry now have one: Seating library, Coupons (new), Charity profile, Plan & billing, Webhooks, Sandboxes, Notifications.
- Sections are native `<details>` (keyboard and screen reader ready, work before hydration). A member's closed sections are kept in the `yy_nav_closed` cookie, which the server reads, so the sidebar renders as they left it. The section that holds the current page always opens.
- Item visibility now follows each page's real permission. The door role (`scanner`) sees only Home and Notifications; the viewer sees no Money pages that need `finance:read`, no settings, domains or API keys. The pages still refuse by URL as before.
- The event console keeps its profile-driven sections (unchanged).

### Create menu and Help (top bar, org and event consoles)
- `components/create-menu.tsx`: a WAI-ARIA menu button with Event (`/events/new/guided`), Series (`/series#new-series`), Template (`/templates#new-template`, the open "How templates work" panel), Venue (`/venues#new-venue`), Coupon (`/coupons`) and Page or blog post (`/content/new`). Entries need `events:write` (coupon: also the ticketing module) or `marketing:write` (page). Read-only roles get no menu.
- A **Help** icon link to the platform help center `/help` on every console page.

### "How it works" panels
- `components/how-it-works.tsx` + `how-it-works-panel.tsx`, topics in `lib/help-topics.ts`: a collapsible panel with an intro, 3–4 numbered steps and "Read the guide" (a help-center search, so the link survives article renames). Collapsing is remembered per topic (`yy_help_closed` cookie, read on the server). Arriving on the panel's anchor opens it.
- On: Domains, Templates, Series, Payouts, Sending, Coupons, and the event type and category (create event, guided create, event Details).

### Coupons page (Money › Coupons)
- `/o/{org}/coupons`: promo codes are per event today, so the page explains that and lists the org's events with a link to each event's promo codes (`tickets-orders#promo-codes`). Org-wide coupons (UX-5) come with U9.

### Empty states
- Every `<EmptyState>` in the org and event console (123 across 86 files) now has a primary action: create the first item (anchored to the add form), clear a filter, go where the items come from, or (for refused or unavailable states) a way out such as "Find an owner or admin". Read-only roles get a read-only next step.
- The scanner's org home no longer crashes on the event list it may not read (a pre-existing error): it says scanning happens in the Scan app and links there.

### Page anatomy
- `components/org-trail.tsx`: every org page (except the home) shows the breadcrumb organization › section › page, derived from the nav model, above its PageHeader. Deeper pages (a venue, a connection) link back to their list. The five org pages that built their own breadcrumb now use the shared one (no duplicate breadcrumb landmarks).

## Not yet / later
- Org-wide coupons (U9), a "New template" from scratch (U6); the Create menu entries already point at the pages those increments extend.
- Doc links search the help center; deep links to specific articles once the help team has written them.
- The sidebar preference is per browser (a cookie), not stored on the account (that would need a migration on `auth.users`).
- The event console's sidebar keeps the overview/build/run grouping (profile-driven, out of scope).
- `merge/next-3j` was not merged into this branch (it conflicts with 3i in ~80 files including migration snapshots; the merge session combines them). It adds event-level and public pages only, which the profile nav already covers; no new org pages.

## Acceptance

| Criterion | Test |
|---|---|
| Every org page is reachable from the grouped nav (route sweep) | `apps/web/tests/org-nav.test.ts` (one case per org page) |
| Each item lands in exactly one section, has a label and a page | `apps/web/tests/org-nav.test.ts` |
| Door role and other limited roles see only their allowed groups | `apps/web/tests/org-nav.test.ts` (every grantable role); `e2e/console-nav.spec.ts` (viewer, scanner, refused URL) |
| Section open state remembered; current section always opens; keyboard | `e2e/console-nav.spec.ts` "sections collapse by keyboard…" |
| Navigate every group, breadcrumb names the section | `e2e/console-nav.spec.ts` "five sections in order…" |
| Create menu: entries, permissions, keyboard | `e2e/console-nav.spec.ts` "keyboard: open the menu…", "each entry opens its page", viewer/scanner have none |
| Help entry | `e2e/console-nav.spec.ts` "Help opens the platform help center" |
| Each page named in the review has a help panel; collapse remembered | `e2e/console-nav.spec.ts` "every page named in the review…", "collapse, remembered…" |
| Empty-state audit lists zero pages without an action | `apps/web/tests/empty-state-audit.test.ts` (walks every file under `/o/` and the components they import) |
| Two empty states with actions | `e2e/console-nav.spec.ts` "a new organization…" (venues, coupons, series) |
| Axe in both themes, Arabic RTL | `e2e/console-nav.spec.ts` (`expectAccessibleBothModes`, `/ar/…` tests) |
| Screenshots before/after (light, dark; 1280, 390) | `docs/ux/screenshots/u2/` |
