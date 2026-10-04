# U11 — Whole-app UX sweep

## What was built
- **The route sweep** (`apps/web/e2e/ux-sweep.spec.ts`, its own Playwright project `ux-sweep`, run with `UX_SWEEP=1 pnpm --filter @yayatoh/web exec playwright test --project=ux-sweep`). It reads every `page.tsx` of apps/web and apps/admin, fills the params from the seed (five actors: the Lakeside owner, the Rosewood wedding owner, the Harbor content org, a throwaway agency, a visitor; staff for admin), follows links to find the templates the seed cannot fill, and screenshots each route at 1440, 1024 and 390 px in light and dark. It measures per page: horizontal overflow, native selects and date inputs, targets under 24 px, headings, raw message keys, console errors, long paragraphs and field counts; axe (serious and critical) in both themes at 1024 px; same-origin links that match no page (`dead-links.json`).
- **Coverage gate**: the last test fails if a page template is neither swept nor excluded with a reason in `ux-sweep/routes.ts`.
- **Contact sheets**: `node apps/web/e2e/ux-sweep/contact-sheets.ts` → `docs/ux/sweep/sheets/` and `index.md`. Full-size shots stay local (`docs/ux/sweep/full`, git-ignored). `findings.json` / `findings-before.json` hold the metrics.
- **Backlog**: `docs/ux/backlog.md` (hand-reviewed rows plus the measured table from `ux-sweep/backlog.ts`).

## Fixed at shared level
| Finding | Fix |
|---|---|
| 404 page had no level-1 heading | `EmptyState` takes `headingLevel`; `not-found.tsx` uses 1 |
| Global search input was 21 px high inside a 44 px pill (167 pages) | `SearchPill` input is `h-full` |
| Raw checkboxes and radios 13–20 px | base CSS: min 24 px |
| Breadcrumb links 21 px high | `inline-flex min-h-6` |
| Back / "Powered by" links 17–21 px on public pages | same 24 px target |
| Select could outgrow its container | trigger `max-inline-size: 100%`; audience template picker label `min-w-0 max-w-full` (New audience scrolled sideways at 375 px) |
| Dead "events" links (`/o/{org}/events`, a 404) in seating library, command center, contact insights | point to the org home, which lists events |

## Not yet
Page-specific findings are in `docs/ux/backlog.md`. 96 detail pages need signed links or records the seed lacks and are excluded (with reasons) from the sweep.

## Acceptance
| Criterion | Test |
|---|---|
| Contact sheet covers every route | `ux-sweep.spec.ts` › coverage; `docs/ux/sweep/index.md` |
| Every finding fixed or in the backlog with its screenshot | `docs/ux/backlog.md`, `docs/ux/sweep/backlog/` |
| Crawl runs as a project | `playwright.config.ts` project `ux-sweep` |
| Fixed pages: keyboard only, axe both themes, RTL | `ux-shared.spec.ts` (3 viewports); unit: `packages/ui/tests/components.test.tsx` |
| Before/after of main screens (light and dark, 1280 and 390) | `docs/ux/screenshots/u11/{before,after}/` |
