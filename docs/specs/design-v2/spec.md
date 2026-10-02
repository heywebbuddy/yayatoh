# Design system v2 — foundation and full-product restyle

Owner decision 2026-10-02 (`docs/decisions.md`); brief `docs/agent-briefs/design-v2.md`; decision record [ADR 0022](../../adr/0022-design-system-v2.md); approved artboards `docs/design/system-v2/`.

## What was built
- **Tokens and theming:** semantic colour roles with light (default) and dark values in `packages/ui` (`tokens.ts` + `styles.css`); `data-theme` on `<html>` from the `yy_theme` cookie read on the server, plus `auth.users.theme` for signed-in people (migration `0096_bright_red_shift`); Light / Dark / System switch in every shell; "System" resolved in CSS.
- **Fonts:** Manrope (Latin, Latin Extended, Cyrillic), IBM Plex Sans Arabic and Noto Sans Devanagari self-hosted via `next/font/local` with `unicode-range`; CJK by Noto Sans JP/SC/TC name, then the platform face.
- **Components:** the full ADR 0022 inventory (actions, surfaces, labels, people, navigation, inputs, data, overlays, states, layout), charts restyled.
- **Shells:** organizer console (floating dark sidebar, account card with "New event", topbar with search/theme/notifications, drawer under 1024 px), staff console, Scan PWA, attendee portal, sign-in and onboarding, public site, tenant sites, public event page.
- **Reference screens:** Command Center, event Guests tab, public event page (header bar, violet hero, sticky ticket box).
- **Every screen** in `apps/web` and `apps/admin` moved to role tokens by codemod (palette classes, form fields to the `field` utility, labels to the 13 px bold style, headings to 800, tabular numbers), QR codes kept black on white, print posters forced light.
- **Gate:** `check-modules design-tokens` now covers `apps/admin` and rejects `rgb()`/`hsl()` literals and default-palette classes (canary `raw-colour`).
- **Style guide:** `/dev/design` (development only).

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
