# ADR 0022 — Design system v2 (light default, dark opt-in)

- **Status:** Accepted (owner decision, 2026-10-02; `docs/decisions.md`)
- **Supersedes:** the **visual layer** of [ADR 0018](0018-design-system-superpower-style.md) (palette, type, shape, navigation look). ADR 0018's **rules stay**: tokens are the only source of colour, radius, shadow and font; no raw colours anywhere else (check-modules `design-tokens`); status is never hue alone.
- **Approved artboards:** `docs/design/system-v2/` (`Main` Command Center, `Guests` event workspace, `EventPage` public event page, `Tokens`).

## Context
The owner approved the canvas "Yayatoh Design System" (claude.ai artifact `UQPLQsrdwVXsoZ9q47n1oF`), modelled on two owner-chosen references: a light SaaS dashboard with a floating near-black sidebar, violet actions and a pink brand mark; and a dark violet-glass dashboard. They asked for the whole product, **light by default**, "30% more improvement to make it pixel perfect and looking awesome, and very good UX", with no further mockup round.

## Decision

### Theming
- Every colour is a **semantic role** (`canvas`, `surface`, `ink`, `ink-2`, `primary`, `success-soft`…) with a **light** and a **dark** value. Utilities use the role: `bg-surface`, `text-ink-2`, `border-line`, `bg-primary text-on-primary`. Tailwind's default palette is switched off (`--color-*: initial`), so `bg-zinc-100` generates nothing and the gate rejects it.
- `data-theme` on `<html>`: `light` (default for everyone), `dark` (chosen), `system` (follows `prefers-color-scheme` in CSS, no script). Any subtree may carry its own `data-theme` (printed posters force light; the style guide shows both).
- The choice lives in the `yy_theme` cookie, **read on the server** by the root layout, so the first HTML already carries it (no flash). Signed-in people also keep it in `auth.users.theme` (migration `0096`), which follows them to a new browser. Staff impersonating someone change only their own browser.
- The switch (Light / Dark / System) is a menu button in the console topbar, the staff console, the public site, tenant sites, the public event page and sign-in. Light is the default; the OS setting is followed only when "System" is chosen.

### Colour (light / dark)
| Role | Light | Dark |
|---|---|---|
| canvas | `#F2F1F6` | `#0A0812` + violet glow from the top (`gradient.dark.page`) |
| surface (cards) | `#FFFFFF` | glass `rgba(26,20,46,0.72)` + 20 px backdrop blur |
| surface-solid (menus, dialogs) | `#FFFFFF` | `#1C1631` |
| surface-2 / surface-3 | `#F6F5FA` / `#EEEAF5` | white 4 % / 8 % |
| line / line-strong (field borders, ≥3:1) | `#E7E4EE` / `#8F899C` | violet 16 % / `#7E76A3` |
| ink / ink-2 / ink-3 | `#16131D` / `#5E596A` / `#8F899C` | `#F4F1FF` / `#ABA4C6` / `#7E76A3` |
| primary (fill, white text) | `#6A3BFF` | `#6C4CF2` (see below) |
| primary-ink (violet text) / primary-soft | `#5528E8` / `#EEE8FF` | `#BBA9FF` / violet 20 % |
| brand (mark, dots) / brand-strong (white text) / brand-ink | `#FF3D86` / `#D61F66` / `#C41C5E` | `#FF5C9A` / `#D61F66` / `#FF7EAF` |
| success / soft / dot | `#0B7A50` / `#DDF6EA` / `#16C784` | `#4BE9AC` / mint 14 % / `#3BE6A4` |
| warning (waiting) | `#8A4F00` / `#FFF0D4` / `#FFB020` | `#FFC56E` / amber 14 % / `#FFB84D` |
| danger | `#B81F35` / `#FDE3E7` / `#E5364F` | `#FF8798` / red 15 % / `#FF6B81` |
| tag (dark uppercase tags, dark button) | `#2A2230` + white | white 8 % + `#ECE7FF` |
| side (floating sidebar) | `#17121B` | `rgba(15,11,28,0.86)` |
| avatar pastels | lavender `#E3D9FF`, blush `#FCDDE9`, sky `#D8E8FF`, sand `#FBE8CF`, mint `#D5F5E6` | translucent violet, pink, blue, amber, mint |
| focus ring | `#6A3BFF` | `#A48CFF` |

- **One deliberate deviation:** the approved dark primary `#7B5CFF` gives white button text only 4.36:1. It stays the dark violet of glows, rings, gradients and the active sidebar tile; the **solid fill under white text** is `#6C4CF2` (5.3:1).
- **Contrast is a unit test** (`packages/ui/tests/contrast.test.ts`): every text/surface pair in both modes reaches 4.5:1 (3:1 for field borders, focus ring and glyphs). Translucent dark surfaces are composited over the canvas **and** over the brightest point of the glow. An organizer's brand colour is checked against the page in both modes (`brandPalette().onPage`, `.onDarkPage`).
- **Status is never hue alone:** `StatusPill` and `StatusDot` always render a dot and a word.
- Emails stay light (mail clients ignore our theme): `email` tokens.
- Seat maps and floor plans (Konva canvas) draw on a light "paper" in both modes (`paper` tokens).

### Type
**Manrope** 400–800, self-hosted through `next/font/local` (Latin, Latin Extended and Cyrillic faces; size-adjusted fallback so text does not shift on load). Headings are 800 with tight tracking; numbers are tabular.

| Role | Size / line height / tracking |
|---|---|
| Display | 56 / 1.0 / −0.045 em |
| Page title | 40 / 1.05 / −0.035 em (30 on phones) |
| Section | 22 / 1.25 / −0.02 em; card title 20 |
| Stat | 38 / 1.0 / −0.04 em (highlight card 52) |
| Prose | 15 / 1.7 |
| Body | 14 / 1.5 |
| Caption | 12 / 1.45 |
| Label | 11, 800, uppercase, 0.1 em |
| Field label | 13, bold |

Per-script fallbacks (updates ADR 0016's font note): Manrope has no Arabic, CJK or Devanagari.
- **Arabic:** IBM Plex Sans Arabic (self-hosted, 400–700, loaded only for Arabic characters by `unicode-range`).
- **Devanagari:** Noto Sans Devanagari (self-hosted, variable, by `unicode-range`).
- **CJK:** Noto Sans JP / SC / TC by name, then the platform's CJK face (Hiragino, Yu Gothic, PingFang, Microsoft YaHei / JhengHei). Self-hosting CJK was rejected for now: a full face is 5–9 MB, and the subsetted alternative adds ~100 KB of `@font-face` CSS to every page in every locale. Revisit with per-locale CSS.
- All fonts are served from our own origin, so the strict CSP (`font-src 'self'`) is unchanged.

### Shape, spacing, elevation, motion
- **Radii by role:** tag 8, control (inputs, buttons) 14, tile and row 18, card 24, panel and sidebar 28, pill for status and chips.
- **Spacing:** 8-pt rhythm (4 for hairline adjustments); page gutter 16 on phones, 24 from md.
- **Elevation:** `elevation-card` (light: soft two-layer grey; dark: violet hairline + deep shadow), `elevation-pop` (menus, dialogs, toasts), `elevation-primary` (the violet glow under primary buttons).
- **Motion:** 150 ms (colours) to 200 ms, `cubic-bezier(0.2, 0, 0, 1)` ease-out; a 1 px press on buttons; `prefers-reduced-motion` turns transitions and animations off globally.
- **Focus ring:** 2 px solid `focus`, 2 px offset (fields: 1 px offset with a primary border); white on the dark sidebar. Every interactive element shows it.
- **Icons:** lucide on a 24 px grid, 2 px stroke, round caps and joins; 17–18 px in rows and buttons; decorative icons are `aria-hidden`.
- **Targets:** 24 px minimum everywhere, 44 px for fields and default buttons, 54–56 px in the Scan PWA.

### Components (`packages/ui`)
- **Actions:** `Button` (primary, secondary, dark, ghost, danger, inverse; 36 / 44 / 54; loading with `aria-busy`), `IconButton` (required `label`), `buttonClass`, `iconButtonClass`.
- **Surfaces:** `Card` (default, muted, ink, highlight, feature, hero; interactive), `CardHeader`, `StatCard` (value, delta, progress), `HighlightCard`, `ProgressBar`.
- **Labels:** `Tag`, `StatusPill` (success, waiting, danger, info, neutral, brand), `StatusDot`, `Badge`, `Kbd`, `Label`.
- **People:** `Avatar` (pastel by stable hash), `AvatarStack`, `PersonChip`, `CheckDisc`.
- **Navigation:** `navItemClass`/`navTileClass`/`NavSection` (sidebar), `Tabs`/`tabClass`/`TabCount` (segmented), `filterChipClass`, `Breadcrumb`, `Pagination`, `SearchPill`.
- **Inputs:** the `field` utility (`field-sm`, `field-lg`, `field-invalid`), `Input`, `Select`, `Textarea`, `Checkbox`, `Radio`, `Switch`, `Field`, `FieldMessage` (error with an icon).
- **Data:** `Table` (sticky header, row hover, density, selectable rows, card layout on phones), charts restyled to the palette (`LineChart`, `BarChart`, `Donut`, `ProgressRing`, `ChartTable`).
- **Overlays:** `Menu` (WAI-ARIA menu button, radio menus), `Modal` and `Sheet` (native `<dialog>`), `ToastProvider`/`useToast` (polite live region, pause on hover/focus, undo action), `Tooltip` (hover and focus, Esc).
- **States:** `EmptyState`, `Skeleton`, `SkeletonText`, `SkeletonCard`, `ErrorState`, `Alert`.
- **Layout:** `PageHeader` (breadcrumb, title, tag, meta row, actions), `SectionHeader`, `Stepper`, `ScheduleLane`, `Timeline`.
- `cx` resolves colour-utility conflicts (the later `border-danger` beats a component's `border-line`), so `className` overrides are deterministic.

### Shells
- **Organizer console:** floating near-black sidebar (260 px, inset 16, radius 28) with the org switcher, MENU section, the other groups, ACCOUNT card (avatar, role, security, sign out, "New event"); topbar with search (⌘K or /), the event status pill, theme switch and notifications; below 1024 px the sidebar is a drawer (closes on navigation, Esc and a tap outside).
- **Event workspace:** the sidebar lists the event's sections (one place for 15–20 sections, which a tab row cannot hold well), with breadcrumb PageHeaders; segmented `Tabs` are used for sub-sections and modes. The artboard's top tab row for the whole event (org menu in the sidebar, event sections as tabs) was not adopted: weddings have 6 sections but conferences have 20, and two navigations listing the same names hurt screen-reader and keyboard users. Revisit if the owner prefers the artboard's IA.
- **Staff console:** the same dark sidebar (a scrolling strip of the same links on phones).
- **Public site, tenant sites, public event page:** a floating header bar with the theme switch; the event page has the violet hero and a sticky ticket box beside the content (full width when a seat map is needed).
- **Sign-in and onboarding:** the wordmark and theme switch above a centred card.
- **Scan PWA:** segmented mode tabs, 56 px fields and buttons, large result text; duplicates are amber, refusals red, admits mint, each with words.

## Alternatives
- **Keep ADR 0018 (Superpower):** superseded by the owner's 2026-10-02 decision.
- **Map the old zinc/accent names to theme variables:** fewer edits, but `zinc-900` meaning "light text" in dark mode would mislead everyone who reads the code; semantic roles were chosen and the pages were moved by a codemod.
- **Follow the OS by default:** rejected by the owner ("light mode by default"); "System" is one click away.
- **localStorage + inline script for the theme:** needs a script before paint (the strict CSP forbids inline scripts without a nonce) and still flashes on the server render; the cookie is read on the server instead.

## Consequences
- Pages restyle by inheriting tokens and components; the remaining per-screen polish is listed in the design-v2 report for the area sweep.
- The gate is stronger: `design-tokens` now covers `apps/admin`, rejects `rgb()`/`hsl()` literals and Tailwind default-palette or retired ADR 0018 classes (canary `raw-colour`).
- `/dev/design` (development only) shows every component in every state, light and dark, LTR and RTL.
- A new tenant brand colour that is too dark for the dark page (or too light for the light one) is flagged in Settings.

## Revisit when
- The owner wants the artboard's event-tab IA, or a licensed display face.
- CJK self-hosting becomes cheap (per-locale CSS).
- Tenant theming beyond the brand colour (roadmap §4.4) is built.
