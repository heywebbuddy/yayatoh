# Design system v2 — foundation and full-product restyle

Owner decision 2026-10-02 (`docs/decisions.md`); brief `docs/agent-briefs/design-v2.md`; decision record [ADR 0022](../../adr/0022-design-system-v2.md); approved artboards `docs/design/system-v2/`.

## What was built
- **Tokens and theming:** semantic colour roles with light (default) and dark values in `packages/ui` (`tokens.ts` + `styles.css`); `data-theme` on `<html>` from the `yy_theme` cookie read on the server, plus `auth.users.theme` for signed-in people (migration `0102_bright_red_shift`, renumbered after batch 3g); Light / Dark / System switch in every shell; "System" resolved in CSS.
- **Fonts:** Manrope (Latin, Latin Extended, Cyrillic), IBM Plex Sans Arabic and Noto Sans Devanagari self-hosted via `next/font/local` with `unicode-range`; CJK by Noto Sans JP/SC/TC name, then the platform face.
- **Components:** the full ADR 0022 inventory (actions, surfaces, labels, people, navigation, inputs, data, overlays, states, layout), charts restyled.
- **Shells:** organizer console (floating dark sidebar, account card with "New event", topbar with search/theme/notifications, drawer under 1024 px), staff console, Scan PWA, attendee portal, sign-in and onboarding, public site, tenant sites, public event page.
- **Reference screens:** Command Center, event Guests tab, public event page (header bar, violet hero, sticky ticket box).
- **Every screen** in `apps/web` and `apps/admin` moved to role tokens by codemod (palette classes, form fields to the `field` utility, labels to the 13 px bold style, headings to 800, tabular numbers), QR codes kept black on white, print posters forced light.
- **Gate:** `check-modules design-tokens` now covers `apps/admin` and rejects `rgb()`/`hsl()` literals and default-palette classes (canary `raw-colour`).
- **Style guide:** `/dev/design` (development only).

## Batches 3f and 3g on v2 (second pass)
- **Portals (speaker, exhibitor):** `PortalFrame` (glass top bar: event mark and name, the sections as dark-tag links with `aria-current`, theme switch, sign out) and `PortalAuthFrame` for the signed-out pages (invitation, sign-in, magic link) in the sign-in frame. StatusPill for tasks and staff, Avatar person rows, SectionHeader.
- **Command Center live mode:** the TV mode button beside "Open scanner" in the PageHeader actions; live widgets with v2 fields, in-widget table rhythm (uppercase label headers, row hover), ProgressBar capacity gauges by level, person rows for staff on duty, guest-assistance mini stats. TV board: always dark (`data-theme="dark"` subtree, room-sized type, glass tiles); TV links page with breadcrumb, status pills.
- **Assistance queue:** StatCard summary (open, urgent, waiting, unassigned), segmented tabs, priority and state as StatusPill.
- **Marketing analytics:** StatCard figure tiles (delivery and conversion bars), segmented view tabs, numbers tabular (not mono), breadcrumbs on the drill-downs.
- **Event sub-pages** (speaker changes and tasks, exhibitor portal admin, booths, badges, badge designer): breadcrumbs instead of back links; viewer notices as info alerts.
- **Print and paper:** `print` tokens (paper, ink, ribbon colours) for badges, always white stock; the badge designer preview and booth floor plans render in a light subtree in both modes.
- **Org home events list:** 24 cards a page (on now and next first, then past), a count line, Previous/Next that keep the filters, and a name search (`searchEventsQuery.q`). Fixes the axe time-out on orgs with hundreds of events.

## Later / not yet
- The artboard's event-level tab row (org menu in the sidebar, event sections as tabs): not adopted, pending owner (owner inbox).
- CJK self-hosting (per-locale font CSS).
- Hand-polish of the screens listed as "inherited" in the design-v2 report (the area sweep).
- Charts get a dark-mode gridline pass when the analytics area is reworked (they already use roles).

## Acceptance
| Criterion | Test |
|---|---|
| Tokens: one source, light + dark sets, approved values | `packages/ui/tests/tokens.test.ts` |
| Every text/surface pair 4.5:1 (3:1 UI glyphs) in both modes; brand colour checked on both pages | `packages/ui/tests/contrast.test.ts` |
| Status never by hue alone | `packages/ui/tests/contrast.test.ts` ("status colours"), `components.test.tsx` (StatusPill) |
| Components: every variant and state, 24 px minimum targets, accessible names | `packages/ui/tests/components.test.tsx` |
| No raw colours (web, admin, ui); gate canary | `tools/check-modules/tests/check.test.ts` (raw-colour) |
| Light is the default; first HTML carries `data-theme` | `apps/web/e2e/theme.spec.ts` |
| Dark persists across reload with no flash; public pages follow | `apps/web/e2e/theme.spec.ts` |
| "System" follows emulated `prefers-color-scheme` | `apps/web/e2e/theme.spec.ts` |
| Signed-in choice saved to the profile and restored in a new browser | `apps/web/e2e/theme.spec.ts` |
| Theme switch is keyboard operable (menu pattern) | `apps/web/e2e/theme.spec.ts` |
| axe in light and dark on the shells and the three reference screens, no horizontal scroll | `apps/web/e2e/theme.spec.ts` (`expectAccessibleBothModes`) |
| Arabic RTL render of the new shell | `apps/web/e2e/theme.spec.ts` |
| Existing journeys keep working | whole web suite (3 projects) and admin suite |
| 3f/3g screens on v2 (portals, live Command Center, TV, assistance, analytics, badges, booths) | `live-mode`, `assistance`, `speaker-portal`, `exhibitor-portal`, `badges`, `marketing-analytics` specs |
| Org home pages 24 events, upcoming first, keeps filters, searches by name; RTL; axe | `apps/web/e2e/org-home.spec.ts`, `a11y.spec.ts`; `packages/testing/tests/venues.int.test.ts` (q) |

## Batch 3h on v2 (merge, 2026-10-03)
The Phase 4 Wave B and Phase 5 Wave 2 builders (M5.1c, M5.2b, M5.7a, M4.1d, M4.1e, M4.1f, M4.2b, M4.8a, M4.8b, M5.1d) were built on the old components and merged on top of v2:
- Their retired palette classes went through the v2 codemod mapping; `check:modules` design-tokens is clean.
- Their screens use the v2 pieces: Crumbs breadcrumbs, PageHeader actions, StatusPill for every status, StatCard summaries, Tabs filters, Table, EmptyState, info Alerts for read-only viewers, v2 fields; public pages (RSVP, collector, giving, group and invoice pages, live polls) on the v2 public cards with the theme switch where they have their own frame.
- The live-poll big screen is always dark, like the TV board. QR codes stay black on a light card in both modes.
- The receipt PDFs and the seat-map sponsor label moved from ADR 0018's `color` export to the `print`, `light` and `paper` tokens.

| Criterion | Test |
|---|---|
| Batch 3h screens pass axe in light and dark | `registration-approvals`, `enrollment`, `invoices`, `rsvp`, `rsvp-questions`, `guest-invites`, `gala-tables`, `engagement`, `donations`, `receipts`, `dev-login` specs (`expectAccessibleBothModes`) |
| No raw colours in the merged screens | `pnpm check:modules` (design-tokens) |
