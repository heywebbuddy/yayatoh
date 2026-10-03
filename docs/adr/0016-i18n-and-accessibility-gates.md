# ADR 0016 — i18n (13 locales, RTL) and accessibility gates

- **Status:** Accepted (M0.5, 2026-09-27; rationale from roadmap §3.1, §10)

## Context
- The legacy platform serves 13 locales, including Arabic (RTL). Parity requires all keys ported and `/lang/{code}` working.
- Events serve the public, so accessibility is a legal and product requirement.
- Seating, floor plans and drag assignment are canvas-heavy and risky for accessibility.

## Decision
- **i18n:** next-intl + Tolgee. 13 codes: ar (RTL), de, en, es, fr, hi, it, ja, nl, pt, ru, zh_CN, zh_TW.
- Every string goes through next-intl; lint blocks literal strings.
- Locales are path-based with `as-needed` prefixes, so legacy English URLs keep working.
- **Logical CSS** only (RTL-safe). Design tokens only (ADR 0018).
- problem+json error codes map to UI text in all 13 locales.
- Vocabulary overlays follow ADR 0013.
- **Accessibility:**
  - WCAG 2.2 AA is a merge gate; axe must report zero serious or critical findings.
  - Every canvas or drag interaction has an accessible alternative (list mode, keyboard).
  - Minimum target size 24 px. Hold timers are extendable.
  - Tagged PDFs (per the M0.5 spike, ADR 0017).
  - NVDA and VoiceOver pass before each phase exit. VPAT 2.5.
- Playwright runs critical journeys at 375, 768 and 1280 px, including `ar`/RTL.

## Alternatives
- **Lingui** (runner-up for i18n).

## Consequences
- An axe violation is one of the M0.5 gate canaries.
- 6 of the 13 locales are UCS-2 for SMS, which affects segment counting.
- Fonts need CJK, Devanagari and Arabic fallbacks. Since ADR 0022 the UI face is Manrope (Latin, Cyrillic), with self-hosted IBM Plex Sans Arabic and Noto Sans Devanagari loaded by `unicode-range`, and Noto Sans JP / SC / TC (then the platform CJK face) for Chinese and Japanese. All fonts are served from our origin through `next/font`, so the CSP is unchanged.
- Translation ownership and launch locales are open decision D27.

## Revisit when
- A new locale is added or WCAG is revised.
