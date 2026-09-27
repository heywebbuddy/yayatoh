# M1.1 — Design system, shell and i18n

**Roadmap:** Phase 1 → M1.1; ADR 0018 (Superpower style), ADR 0016 (i18n and accessibility gates).
**Reference:** Superpower row of the design canvas "Yayatoh 2.0 Design Directions" (owner-approved), i.e. the event dashboard, attendees + profile, public event page and mobile attendee portal screens.
**Risk tags:** none. The dev-only persona sign-in is off unless `YAYATOH_DEV_AUTH=1` and never on in production.

## Goal
Every later screen builds on this console, and it already looks and behaves like the approved reference. Navigation and wording follow the event profile and the org's entitlements. Every string is translated into 13 locales, Arabic runs right-to-left, and accessibility is a merge gate.

## Scope
**In:**
- **Shell:** white sidebar with a zinc-100 active pill and groups, a context switcher across the user's orgs, a pill search, and a notification-centre popover. A skip link is included, and below `lg` the sidebar becomes a menu.
- **Profile-driven navigation:** navigation comes from the event profile via `composeNav`, filtered by effective entitlements.
- **Vocabulary overlay:** for example, attendees become Guests (gala), Members (community) or Fans (concert).
- **Pages:**
  - org home (event cards)
  - Team, backed by **real members** from the database
  - event dashboard (KPIs, trend chart, ticket mix, needs-attention, readiness)
  - attendees (segments, search, table, profile panel)
  - section placeholders for navigation items later milestones fill
  - public event page (all-in prices)
  - mobile attendee portal
- **States:** empty, loading (skeleton) and error. problem+json and `DomainError` codes map to localized messages (`errors.*`), and `/v1` now returns RFC 9457 problem+json.
- **Locales:** 13 (en, ar RTL, de, es, fr, hi, it, ja, nl, pt, ru, zh-CN, zh-TW).
- **Gates:**
  - a literal-UI-string check in `check-modules`, with a canary
  - Playwright + axe at 375/768/1280 px in en and ar

**Demo data (temporary):** events, sales and attendees arrive with M1.4/M1.5.
- Until then the event screens read typed view-models from `apps/web/src/demo/events.ts`. These are scoped by org slug, never written to the database, and 404 in production.
- Org, membership, role, entitlements, navigation and the Team page are real.

**Out (later):**
- shadcn/Base UI: native elements and `@yayatoh/ui` cover M1.1; they will be adopted when a complex widget (combobox, date picker) is needed.
- Pixel visual-diff baselines: screenshots are captured per breakpoint and locale as CI artifacts for owner review, and baselines will be added once the fonts are licensed and final.
- Drag alternatives: nothing is draggable yet; the requirement applies from seating (M1.7).
- Checkout, seat editor, scanner, Command Center and RSVP screens: they arrive with their milestones.

## Acceptance criteria
| ID | Given / When / Then | Test |
|---|---|---|
| AC1 | Every page in en and ar at 375, 768 and 1280 px has zero serious or critical axe violations, correct `lang`/`dir`, and no horizontal scroll | `apps/web/e2e/a11y.spec.ts` |
| AC2 | Switching profile swaps labels with no code change (conference → Attendees, gala → Guests, community → Members; the wedding navigation shows Guests and RSVP) | `packages/platform/tests/profiles.test.ts`, `e2e/console.spec.ts` |
| AC3 | Revoking an entitlement hides its navigation item | `profiles.test.ts`, M0.6 `tenancy.int.test.ts` |
| AC4 | A non-member gets a 404 for another org; a signed-out user is sent to sign in; unknown sections return 404 | `e2e/console.spec.ts` |
| AC5 | Lint blocks literal strings in the web app | `tools/check-modules` rule `i18n-literal` and its canary |
| AC6 | All 13 locales have exactly the English keys | `apps/web/tests/messages.test.ts` |
| AC7 | `/v1` errors are RFC 9457 problem+json | `apps/api/tests/app.test.ts` |
| AC8 | Design tokens only: no raw colours outside the token files | `check-modules` rule `design-tokens` |

## Demo
1. `docker compose up -d`, then `pnpm db:bootstrap && pnpm db:migrate && pnpm seed`.
2. `YAYATOH_DEV_AUTH=1 pnpm dev`, open http://localhost:3000/dev/login, and sign in as **Pani Digital** (Lakeside Events, conference).
3. Open the Midwest Leadership Summit dashboard, then Attendees; click a name to open the profile.
4. Switch to `/ar/...` for Arabic RTL.
5. Sign in as **Maya Chen** (Rosewood Weddings): the navigation shows Guests, RSVP, Seat finder and Day-of.
6. Try `/o/rosewood-weddings` as Pani: you get a 404.
