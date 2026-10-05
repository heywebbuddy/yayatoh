# Task: Design system v2, foundation and full-product restyle (branch agent/design-v2)

You are the lead product designer and front-end engineer for **Yayatoh 2.0**. The owner approved a new design system on 2026-10-02. They want it applied to the **whole product**, light mode by default, and in their words **"30% more improvement to make it pixel perfect and looking awesome, and very good UX"**. There is no further mockup round: you make the improvements directly in code. This brief covers the foundation and the restyle. A later sweep may fan out by area after your branch lands, so build the system so that others can follow it without guessing.

Read `docs/agent-briefs/common.md` (environment, rules, test style, gate, push early, report) and `CLAUDE.md`. Both apply. Branch: **`agent/design-v2`**.

## The approved design (source of truth)
- `docs/design/system-v2/*.dc.html` are the approved artboards. They are plain HTML with inline styles; each file's script holds the LIGHT and DARK token strings.
  - `Main`: Command Center
  - `Guests`: event workspace, Guests tab
  - `EventPage`: public event page and ticket box
  - `Tokens`: colour, type and components
- Read them first and take exact values from them. The owner's decision is in `docs/decisions.md` (2026-10-02).
- The two reference shots are on Dribbble and are not in the repo (copyright). What they are:
  - **Light:** a white/grey-white canvas, a **floating near-black sidebar** (rounded 28 px, inset 16 px), the active nav item a lighter row with a white icon tile, count badges, a violet primary CTA, a pink brand mark, pastel (lavender/blush) person cards, **dark uppercase tags** ("WEBSITE"), a soft pink-to-lavender highlight card with a huge number, and thin-bordered stat cards with "+16% last month" lines.
  - **Dark:** a violet-black canvas with a soft violet light glow from the top, **glassy cards** (translucent, thin violet border, blur), glossy violet gradient tiles, name chips (pill, avatar, name, role, mint check), a week schedule with dashed grid lines, the selected item outlined in mint, and a violet gradient active nav row.
- Shared: violet primary (`#6A3BFF` light, `#7B5CFF` dark), pink brand `#FF3D86`, mint success, amber waiting; **Manrope** (weights 400–800, headings 800 with tight tracking); radii 14/18/24/28; 8-pt spacing; generous whitespace.

## Deliverables

### 1. ADR 0022: Design system v2
Use the next free ADR number (0021 is taken). It supersedes ADR 0018's **visual** layer; ADR 0018's rules stay (tokens only, no raw colours, the lint rule). Record:
- the palettes for both modes and the type scale
- radii, spacing, elevation, motion (150–200 ms ease-out, `prefers-reduced-motion` honoured)
- the focus ring
- icon style (24 px grid, 2 px stroke, round caps)
- the component inventory

Update ADR 0016's font note: Manrope has no Arabic, CJK or Devanagari, so define per-script fallbacks:
- Arabic: IBM Plex Sans Arabic or Noto Sans Arabic
- CJK: Noto Sans JP/SC
- Devanagari: Noto Sans Devanagari

Load fonts self-hosted through `next/font` so the strict CSP stays intact.

### 2. Tokens and theming
`packages/ui/src/tokens.ts` and `styles.css` stay the single source of truth. Every value is a CSS custom property with a light set (default) and a dark set.
- **Light is the default for everyone.** Dark is opt-in through a theme switch in the shell and on public pages.
- Persist the choice in a cookie read on the server, so the first paint is correct with no flash, and in the user's profile preference when signed in.
- Set it as `data-theme` on `<html>`.
- Do not follow the OS setting unless the user picks "System". Offer Light / Dark / System, with Light as the default.
- Public pages follow the same switch.
- An org's brand colour (existing `brand-styled.tsx`, `BrandSection`/`BrandLink`) keeps working on public pages in both modes. Its contrast is checked against both surfaces.
- Extend `contrast.ts` and its tests:
  - every text/surface pair is 4.5:1 in both modes (3:1 for 24 px+ and UI glyphs)
  - status colours are never told apart by hue alone (dot plus text)
- Update the raw-colour gate in check-modules if token names change. Never weaken it.

### 3. Components (`packages/ui`)
Rebuild or add components to the approved look, each with every state (rest, hover, pressed, focus-visible, disabled, loading) in both modes and RTL:
- **Actions:** Button (primary, secondary, dark, ghost, danger; sizes 36/44/54), IconButton (with `aria-label`)
- **Surfaces:** Card, KPI/Stat card (value, delta, progress), Highlight card
- **Labels:** Tag (dark uppercase), StatusPill (dot plus text: success, waiting, danger, info, neutral), Badge/Count
- **People:** Avatar (initials, pastel by stable hash), AvatarStack, PersonChip (with a check state)
- **Navigation:** Tabs (segmented, with counts), SidebarNav (sections, icon tiles, active row, badges, collapsible on small screens), Topbar (search ⌘K, theme switch, notifications), Breadcrumb, Pagination
- **Inputs:** Input, Select, Textarea, Checkbox, Radio, Switch, DatePicker skin; inline validation with an icon and message, field help
- **Data:** Table (sticky header, row hover, density, selectable rows, responsive card fallback on phones)
- **Overlays:** Dropdown/Menu, Modal, Sheet/Drawer, Toast, Tooltip
- **States:** EmptyState (icon, title, one-line help, primary action), Skeleton loaders, ErrorState with retry
- **Layout:** PageHeader (breadcrumb, title, meta row, actions), Section header, Stepper, Timeline/Schedule lane

Keep the public API of existing components where pages use it, so most screens restyle by inheriting. Delete dead variants.

### 4. App shells
- The organizer console (`console-shell.tsx` and the org/event layouts) gets:
  - the floating sidebar: org switcher, MENU/ACCOUNT sections, the account card with the "New event" CTA, collapsing to a drawer under 1024 px
  - the topbar
  - the PageHeader pattern
  - event workspace tabs
- The admin app, the Scan PWA (big touch targets, high contrast, works in sunlight), the speaker/exhibitor portals, sign-in and onboarding, and the public site/event/checkout pages each get the matching shell.
- Keep every route, `aria-current`, the skip link and the RTL mirroring. Logical CSS only.

### 5. Restyle every screen
Go through every page in `apps/web` and `apps/admin`; list them from the route tree. The approved artboards set the bar for the Command Center, the event Guests tab and the public event page; match or beat them.
- **Polish ("30% better"):**
  - one spacing rhythm
  - aligned baselines and optical alignment of icons
  - consistent radii by role
  - hover and pressed feedback everywhere
  - 150 ms transitions
  - tabular numbers
  - no orphan words in headings (`text-wrap: balance`)
  - no layout shift on load
  - skeletons instead of spinners
  - charts restyled to the palette (both modes)
- **UX:**
  - one primary action per screen, top right in the PageHeader
  - destructive actions confirm and are undoable where the domain allows
  - every list has search/filter and an empty state that says what to do next
  - forms in one column with clear groups, inline validation on blur, submit errors summarised at the top with links to the fields
  - success toasts
  - keyboard shortcuts where they help (⌘K search, `/` focus search, Esc closes)
  - visible focus everywhere
  - 44 px touch targets on touch screens, 24 px minimum anywhere
  - phone layouts that are designed, not just stacked: no horizontal scroll except wide tables in their own scroller

### 6. Tests (never weaken)
- Keep every existing e2e green. Where a spec asserted a class or a style that the redesign changes, update the selector to a role or label, never drop the assertion.
- Add an e2e for the theme switch:
  - the default is light
  - the dark choice persists across reload with no flash (check `data-theme` in the first HTML response)
  - "System" follows the emulated `prefers-color-scheme`
  - the public pages follow too
- Run `expectAccessible(page)` in **both modes** on the shells and the three reference screens; add a dark-mode variant to the shared helper.
- Add the Arabic RTL render of the new shell.
- Add unit tests for the token contrast pairs in both modes.

### 7. Living style guide
Add a dev-only page (`/dev/design` behind the existing dev gate, never in production builds). It shows every component in every state, light and dark, LTR and RTL. A later sweep and the owner can then check it at a glance. Document usage in `packages/ui/README.md`.

## Base, merges and conflicts
Batches 3d (Command Center shell, alerts, staff mode, providers) and 3e (campaigns, journeys, support tools, registration types and forms, agenda v2, guest import, sub-events) are being merged in parallel and add pages.

1. Start from `origin/merge/next-3d`:
   `git fetch origin && git checkout -B agent/design-v2 origin/merge/next-3d && git merge --no-edit origin/m0.5-foundation-ey5gqp`
2. Every few hours, and again before your final gate, `git merge` the latest `origin/merge/next-3e` (if it exists) and `origin/m0.5-foundation-ey5gqp`, then restyle any page those brought in.

Work in this order so the foundation lands early and pages inherit it:
1. Tokens and theming
2. Components
3. Shells
4. The three reference screens
5. Everything else, area by area

Commit and push after each area.

## Gate
- `pnpm verify`.
- Build web and admin.
- Because you change shared infrastructure, run the **whole** web e2e suite on all three projects and the admin suite, on a fresh DB.
- Fix real failures honestly.

Your final commit message is the report:
- the screens restyled, by area
- the components added or changed
- the token names
- the ADR
- test counts
- anything left for the area sweep: list the screens you only inherited and did not hand-polish

Push to `agent/design-v2` and stop.
