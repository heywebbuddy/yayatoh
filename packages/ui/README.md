# @yayatoh/ui — design system v2

Tokens and components for every Yayatoh screen ([ADR 0022](../../docs/adr/0022-design-system-v2.md)). The living style guide is at **`/dev/design`** in development (every component in every state, light and dark, LTR and RTL).

## Rules
- **Tokens only.** Colours, radii, shadows and fonts come from `src/tokens.ts` + `src/styles.css` (kept in sync by `tests/tokens.test.ts`). `pnpm check:modules` rejects hex, `rgb()`/`hsl()` literals and Tailwind default-palette classes in `apps/web`, `apps/admin` and this package.
- **Use roles, not colours:** `bg-surface`, `text-ink-2`, `border-line`, `bg-primary text-on-primary`, `bg-success-soft text-success`. Every role has a light and a dark value, so a page written with roles works in both themes with no `dark:` classes.
- **Contrast is tested** (`tests/contrast.test.ts`): if you add a role or a pair, add it to `PAIRS` in `src/contrast.ts`.
- **Status = dot + word** (`StatusPill`, `StatusDot`), never hue alone.
- **No `style` attributes** (strict CSP): sizes and widths are static classes (`widthClass(pct)` for progress).
- **Logical CSS only** (`ms-`, `pe-`, `start-`, `end-`), so RTL mirrors itself.

## Roles
| Group | Roles |
|---|---|
| Page and cards | `canvas`, `surface` (glass in dark), `surface-solid` (menus, dialogs), `surface-2`, `surface-3`, `line`, `line-strong` |
| Text | `ink`, `ink-2` (muted, 4.5:1), `ink-3` (placeholders, glyphs) |
| Action | `primary`, `primary-hover`, `primary-pressed`, `on-primary`, `primary-ink`, `primary-soft`, `focus` |
| Brand | `brand` (mark, dots), `brand-strong` (white text), `brand-ink`, `brand-soft` |
| Status | `success`, `success-soft`, `success-dot`; `warning`…; `danger`… |
| Dark bits | `tag`, `tag-ink` (uppercase tags, the dark button); `side*` (the sidebar) |
| People | `lavender`, `blush`, `sky`, `sand`, `mint`, `avatar-ink` |
| Constants | `white`, `black` (text on photos and the violet hero; QR codes) |

Gradients and elevation are utilities: `bg-page`, `bg-highlight`, `bg-hero`, `bg-promo`, `bg-feature`, `bg-tab-on`, `bg-side-row`; `elevation-card`, `elevation-pop`, `elevation-primary`; `glass` (blur in dark mode).
Radii: `rounded-tag` 8, `rounded-control` 14, `rounded-tile` 18, `rounded-card` 24, `rounded-panel` 28, `rounded-pill`.
Type: `text-display`, `text-title`, `text-section`, `text-card`, `text-stat`, `text-prose`, `text-body`, `text-caption`, `text-label` (uppercase).

## Fields
Give every input, select and textarea the `field` class (or use `Input`, `Select`, `Textarea`): 44 px, 14 px radius, a 3:1 border, focus ring, `aria-invalid` turns it red. `field-sm` (32 px, dense tables), `field-lg` (56 px, scanner), `field-invalid` (error without `aria-invalid`). Labels are 13 px bold (`text-[13px] font-bold text-ink`); help and errors sit below (`FieldMessage`).

## Form controls (U1)
No native `<select>` or `type="date|time|datetime-local"` input outside this package (check-modules `no-native-select`). Use:

| Need | Use |
|---|---|
| One choice from a list | `Select` — keeps the native API: `name`, `defaultValue`/`value`, `<option>`/`<optgroup>` children (or `options`), `required`, `disabled`, `error`, `hint`, `fieldSize`. `onValueChange(value)` replaces `onChange`; `submitOnChange` for filter forms that submit on change. A hidden input carries `name`, so server actions get the same value. Search appears above 8 options. |
| Search, async, several values, "create new" | `Combobox` (`loadOptions`, `multiple` with chips, `onCreate`) |
| Dates and times | `DatePicker`, `DateTimePicker`, `TimePicker` — same submitted strings as the native inputs (`YYYY-MM-DD`, `YYYY-MM-DDTHH:MM`, `HH:MM`); typed entry in the reader's format (ISO always works); `min`/`max`; `timeZone` shows the event zone next to the field (`valueFormat="utc"` submits the instant). |
| Time zone, currency | `TimeZonePicker` (IANA, grouped by region, current offset), `CurrencyPicker` (ISO 4217, symbol and localized name) |

The trigger draws our own chevron (16 px, `text-ink-2`) inside the field, centred, 12 px from the inline end (`field-chevron` keeps the text clear of it); it turns 180° when open and mirrors in RTL. The open list is a top-layer popover in our theme. The apps wrap the tree in `UiLocaleProvider` (root layouts) with the `formControls.*` messages and the locale. In e2e, pick with `pickOption(page.getByLabel('Status'), 'draft')` from `e2e/helpers.ts` (by value or `{ label }`), and type dates with `fill('2026-11-05')`/`fill('2026-11-05T19:00')` as before.

## Components
| Need | Use |
|---|---|
| The one main action, top right | `Button` (primary) in `PageHeader` `actions` |
| Other actions | `Button` secondary / dark / ghost; destructive `danger` behind a `Modal` |
| Icon-only | `IconButton label="…"` (or `iconButtonClass` on a link with `aria-label`) |
| A number with context | `StatCard` (value, delta, progress, footnote); the hero number `HighlightCard` |
| A list or table | `Table` (`select`, `density`, `stackOnPhone`); always an `EmptyState` that says what to do next |
| Loading | `Skeleton`, `SkeletonText`, `SkeletonCard` (no spinners for content) |
| Failure | `ErrorState` with a retry; inline problems `Alert` |
| People | `Avatar` (pastel by name), `AvatarStack`, `PersonChip` |
| Sections and modes | `Tabs` + `tabClass` + `TabCount`; filters `filterChipClass` with `aria-pressed` |
| Wayfinding | `Breadcrumb` (pass the app's `Link`), `Pagination`, `Stepper` |
| Menus and overlays | `Menu`, `Modal`, `Sheet`, `ToastProvider` + `useToast`, `Tooltip` |
| Time | `ScheduleLane` (run of show), `Timeline` (history) |

`cx(...)` joins classes and lets a later colour utility win over an earlier one on the same property and variant, so `className="border-danger"` reliably overrides a component's `border-line`.

## Theme
`data-theme="light" | "dark" | "system"` on `<html>` (or any subtree). The apps read the `yy_theme` cookie on the server (`THEME_COOKIE`, `isThemeChoice`, `DEFAULT_THEME = 'light'`) and the switch saves it, plus `auth.users.theme` when signed in.
