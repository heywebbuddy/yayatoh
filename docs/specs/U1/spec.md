# U1 — Form controls: Select, Combobox, date/time, time zone and currency pickers

Approved plan: `docs/plans/ux-review-1.md` (UX principle 1, row U1). Brief: `docs/agent-briefs/u1.md`. Builds on ADR 0022 (design system v2).

The organizer review's first complaint was "dropdowns look bad everywhere": every dropdown was the browser's native `<select>`, with the arrow stuck in the corner, and dates showed `dd/mm/yyyy, --:--`. U1 replaces all of them with our own controls.

## What was built
- **`Select`** (`packages/ui/src/components/select.tsx`): a single-choice listbox in place of the native select.
  - **The chevron fix:** our own 16 px chevron (`text-ink-2`) sits inside the field, vertically centred (`inset-y-0 my-auto`), 12 px from the inline end (`end-3`), at all three sizes. The text stops short of it: the `field-chevron` utility sets `--field-pe: 40px`, and `field` now pads each side on its own. It turns 180° while the list is open, mirrors in RTL (logical properties) and never touches the radius. Inline padding carried over from an old native select can't undo this (`selectTriggerClass` drops it).
  - **The open list:** a manual `popover` in the top layer, so a card's `overflow: hidden` never clips it and it keeps the theme of the place it opened from. Placed under the field, or above it when there's no room; lined up with the field's right edge in RTL. Selected tick, hover and keyboard highlight, long labels wrap, maximum height with scrolling, group headings for `<optgroup>`, and "No matches" when a search finds nothing.
  - **Keyboard:** WAI-ARIA select-only combobox. ArrowDown/ArrowUp/Enter/Space open it. In the list: arrows, Home/End, PageUp/PageDown (10), type-ahead, Enter/Space choose, Esc closes without a change, Tab chooses and moves on, Alt+ArrowUp chooses. On a closed field, type-ahead chooses directly, as a native select does. Above eight options a search box opens with the list (filtering ignores case and accents and also matches values and keywords).
  - **Forms:** a hidden input carries `name`, so server actions get exactly the value the native select sent. It defaults to the first enabled option, honours `<option selected>`, and doesn't submit when disabled. `required` uses a constraint-validated input, so the browser refuses the submit. `error` and `hint` work as on `Input`. It keeps the native markup: `<option>`/`<optgroup>` children or `options`. It also takes `onValueChange`, `submitOnChange` (for filters that submit on change), `ref`, `aria-*` and `data-*`, number values, and the `form` attribute.
- **`Combobox`**: an editable combobox. Static or async options (debounced, latest answer wins), multiple values as chips with a remove button each (Backspace on an empty box removes the last chip), a "Create “…”" option hook, and one hidden input per value.
- **`DatePicker`, `DateTimePicker`, `TimePicker`** (`date-picker.tsx`, logic in `dates.ts`):
  - You can type a date in your locale's format. ISO always works too, so `fill('2026-11-05T19:00')` still works. The field reformats it on blur.
  - Our calendar popover is a WAI-ARIA date-picker dialog: arrows (mirrored in RTL), Home/End, PageUp/PageDown, Shift for years, and Esc. Times are a listbox with a step (`minuteStep`).
  - `min`/`max` grey out days in the calendar and block the submit with a message.
  - The submitted strings are the native ones: `YYYY-MM-DD`, `HH:MM` and `YYYY-MM-DDTHH:MM` as wall time.
  - `timeZone` shows the event zone next to the field (city and current offset, and "Times in {zone}" for screen readers). `valueFormat="utc"` submits the instant instead.
  - Arabic shows Arabic-Indic digits. The week start comes from the locale.
- **`TimeZonePicker`**: IANA zones grouped by region, each with its current offset ("Kolkata · UTC+05:30"). ICU's legacy names map to the current ones. You can search by city, zone ID or offset.
- **`CurrencyPicker`**: ISO 4217 codes with the symbol and a localized name (`Intl.DisplayNames`). You can search by code, name or symbol, and `currencies` limits the list. It is ready for U9; no current form had a currency select.
- **Strings and locale:** `UiLocaleProvider` in both root layouts passes the `formControls.*` messages (17 keys, all 13 locales; admin `en`) and the locale.
- **Replacement:** every native `<select>` (≈160 in 87 files) and every `type="date|time|datetime-local"` input (≈40) in `apps/web` and `apps/admin` now uses these components. The same names and values submit. The event wizard's time-zone list is now the `TimeZonePicker` (full IANA list, still IANA values), and its start/end pickers show the event zone. Program forms render `DateTimePicker` for their `datetime-local` fields.
- **Gate:** check-modules `no-native-select` rejects a raw `<select>` or a native date/time/month/week input in any app (canary `native-select`). Biome knows the new controls as label targets.
- **Style guide:** `/dev/design` has a "Form controls (U1)" block with every control in every state (three sizes, placeholder, hint, error, disabled, long labels, groups, search, chips, async, calendar, zone, currency) in light, dark and RTL.
- **E2E helpers** (`apps/web/e2e/helpers.ts`, `apps/admin/e2e/helpers.ts`):
  - `pickOption(trigger, value | { label | value | index })` replaces `selectOption`.
  - `pickWithKeyboard` and `stepOption` keep the keyboard-only paths keyboard-only.
  - `inOptions` reads a list's options.
  - `expectPicked` checks the submitted value.
  - No assertion was dropped: option checks moved to the listbox roles, and value checks moved to the trigger's `data-value` or text.

## Later / not yet
- Typed entry for a date-time takes the locale's date, then the time. A single segmented field (day/month/year spinbuttons) could come later if organizers ask.
- `CurrencyPicker` gets its first form in U9 (org and per-event currency).
- Native `<datalist>` suggestions (program form) stay as they are: they're a text input with hints, not a select.
- Batch 3j's new screens: `merge/next-3j` conflicts with 3i across ~80 files, including migration snapshots 0113–0122, so it couldn't be merged here. The merge-3k brief converts any native select or date input those branches add, and the `no-native-select` gate will name each one.

## Acceptance
| Criterion | Test |
|---|---|
| Zero native selects or date/time inputs outside the UI kit; the gate fails on a violation | `tools/check-modules/tests/check.test.ts` (no-native-select canary, "zero on the repo") |
| Chevron inside the field, centred, 16 px, 12 px end padding, text clear of it, at sm/md/lg, LTR and RTL | `apps/web/e2e/form-controls.spec.ts` ("the chevron sits inside the field": geometry and visual snapshots), `packages/ui/tests/form-controls.test.tsx` |
| Turns 180° when open; the list is our opaque themed panel | `form-controls.spec.ts` |
| Listbox keyboard: arrows, Home/End, PageUp/PageDown, type-ahead, Enter, Esc, Tab | `packages/ui/tests/listbox.test.ts`, `form-controls.spec.ts` |
| Search above 8 options; long labels wrap; groups; disabled; error | `form-controls.spec.ts` |
| Combobox: chips, remove, create, async | `form-controls.spec.ts`, `form-controls.test.tsx` |
| Date grid keyboard (mirrored in RTL), typed entry, min/max, event zone, locale formats and Arabic digits | `packages/ui/tests/dates.test.ts`, `form-controls.test.tsx`, `form-controls.spec.ts` |
| Time zone and currency pickers (IANA groups and offsets, ISO 4217 names and symbols) | `form-controls.test.tsx`, `form-controls.spec.ts` |
| axe clean with lists and the calendar open, light and dark, and in Arabic | `form-controls.spec.ts` ("accessibility"), `theme.spec.ts` (style guide in both modes) |
| Forms submit the same values; existing e2e pass with role-based selectors | `wizard.spec.ts` (create event), `venues.spec.ts`, `settings.spec.ts`, plus every spec moved to `pickOption`/`expectPicked` |
| 13 locales | `apps/web/tests/messages.test.ts` (`formControls.*` parity) |
