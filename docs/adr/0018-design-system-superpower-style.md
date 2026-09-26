# ADR 0018 — Design system: Superpower-style

- **Status:** Accepted (owner decision, 2026-09-26)
- **Supersedes:** the "three directions" exploration in roadmap §3.1 (UI row).

## Context
The owner reviewed several directions on the design canvas "Yayatoh 2.0 Design Directions" (claude.ai artifact `Ut72TBKDbMCKykkSRZmxaf`):
- three generic directions, which the owner rejected
- a RainFocus-style direction
- a Superpower-style direction, modelled on superpower.com

The owner chose the Superpower style for the whole app: **"everything same for our app, font, styles, colors, everything."**

## Decision
Yayatoh 2.0 uses Superpower's visual language across the console, the public pages and the attendee portal. The tokens below were measured from superpower.com on 2026-09-26. They live in `packages/ui/src/tokens.ts` and `packages/ui/src/styles.css`, which are the source of truth. No colour, radius or font appears outside the tokens (lint rule).

### Type
- **Target font:** NB International Pro (Neubau), a **commercial font** that needs a web licence. **Until it is licensed, use Geist** (UI and headings) and **Geist Mono** (labels, numbers in tables, codes). Swapping is a one-token change: `--font-sans` and `--font-mono`.
- **Weights:** headings use weight **300–400**, never bold, with tight tracking (−0.03 to −0.045 em). Body uses 400; emphasis uses 500. Nothing above 600.

| Role | Size / line height | Notes |
|---|---|---|
| Display | 56–64 / 1.0 | |
| Page title | 40–44 / 1.1 | |
| Section | 16–20 | |
| Body | 14–15 / 1.45 | |
| Caption | 12–13 | |
| Label | 11 | Mono, uppercase, 0.06 em tracking |

### Colour
| Role | Value |
|---|---|
| Neutrals | Zinc scale: 50 `#FAFAFA` (page), 100 `#F4F4F5` (chips, active nav), 200 `#E4E4E7` (borders), 300 `#D4D4D8`, 400 `#A1A1AA` (tertiary text, decorative only), 500 `#71717A` (secondary text), 600 `#52525B`, 700 `#3F3F46`, 800 `#27272A`, 900 `#18181B` (text) |
| Ink | `#111111`: primary buttons, the dark ticket card, hero backgrounds (with `#000000`) |
| Brand accent: vermillion | 900 `#FC5F2B` (accent, key data series, live dots), 700 `#F7861E`, 500 `#FDBA74`, 300 `#FED7AA`, 100 `#FFEDD5`, 50 `#FFF6EA`. The accent is **never** used as body-text colour on white (contrast). Accessible text on light backgrounds uses `#C2410C`. |
| Secondary accents (data and status) | green 500 `#11C182` / 700 `#26936B` / 50 `#E9F9F3`; pink 500 `#FF68DE` / 700 `#B90090` / 50 `#FBF2F9`; yellow 500 `#D7DB0E` / 700 `#938700` |
| Status | success = green; warning = vermillion 700; danger = pink 700; info = zinc |

Status uses a **small coloured dot plus text**, not filled badges.

### Shape and elevation
- **Buttons, inputs, tabs, search:** pills (9999 px).
- **Cards:** 20 px radius; large panels and heroes 24 px; 1 px zinc-200 borders; **no shadows** except floating overlays.
- **Primary button:** black `#111` fill, white text, weight 400, padding 11 × 18.
- **Secondary button:** white fill with a zinc-200 border.
- **On dark backgrounds:** a white pill, plus a "glass" pill (`rgba(255,255,255,0.12)`).
- **Navigation:**
  - Console: a white sidebar; the active item is a zinc-100 pill; thin 400-weight labels.
  - Public pages: a floating dark translucent pill nav (`rgba(63,63,70,0.55)` + blur) centred on a black hero with a warm vermillion radial glow.

### Data visualisation
- Thin lines, 1.5–2 px. The current series is vermillion; comparison series are zinc-400/300.
- Dashed gridlines. End-point dots. Mono axis labels.
- Donut and category colours: vermillion, green, pink, yellow.

## Consequences
- **Tenant theming** (white-label, roadmap §4.4) overrides only `--accent` (plus derived tints), the logo and, from an allowlist, the fonts. Everything else stays Yayatoh's system, so tenant sites keep the premium feel.
- **Accessibility:** vermillion on white fails 4.5:1 for small text. The accent therefore marks data, dots and large numbers, while text links use ink with an underline. Contrast checks run in CI (axe).
- **Arabic, Hindi, Chinese and Japanese:** Geist has no coverage, so the font stack falls back to Noto Sans Arabic / Devanagari / SC / TC / JP.
- **Owner action:** licence NB International Pro and NB International Mono Pro from Neubau if the exact Superpower typeface is wanted (roadmap owner inbox).

## Reference
The design canvas holds the four reference screens (Event dashboard, Attendees + profile, Public event page, Mobile attendee portal) in both directions. The **Superpower-style row** is the approved reference for M1.1.
