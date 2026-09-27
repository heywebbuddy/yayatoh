# ADR 0017 — PDF engine: Gotenberg (Chromium) behind `packages/pdf`

- **Status:** Accepted (spike run in M1.5c4, 2026-09-27)

## Context
- Tickets, invoices, badges and reports are PDFs.
- They must render Arabic (RTL shaping), Hindi (Devanagari) and CJK text correctly.
- Accessibility requires tagged PDFs (roadmap §10).
- Legacy ticket and invoice PDF URLs must keep resolving (parity matrix).

## Spike
The same A6 ticket (title, holder name, code) was rendered in Arabic, Hindi and Japanese with both candidates, using Noto fonts. Each output was checked by rendering it to an image and inspecting the PDF catalog.

| | `@react-pdf/renderer` 4 | Gotenberg 8 (Chromium) |
|---|---|---|
| Arabic shaping | **Broken:** a detached initial ت; final letters lose their dots | Correct; RTL layout, and the LTR code is isolated |
| Hindi (conjuncts, pre-base matra) | Correct | Correct |
| Japanese | Correct (thin weight from the variable font) | Correct; CJK line breaking |
| Tagged PDF (`/StructTreeRoot`, `/MarkInfo`) | **No** (not supported) | Yes (`generateTaggedPdf`) |
| `/Lang` | Yes | Yes (from `<html lang>`) |
| Layout | Own flexbox subset | Full HTML/CSS: design tokens and logical properties reused |

Side-by-side renders: [`assets/0017-pdf-spike.png`](assets/0017-pdf-spike.png).

## Decision
- **Gotenberg** renders all PDFs. It runs as its own service: next to the worker on Fly in production (ADR 0004), as a service container in CI, and in `docker-compose.yml` locally.
- `packages/pdf` owns:
  - the `PdfRenderer` port
  - the Gotenberg adapter (HTML + tagged output)
  - the HTML templates, which escape every value and set `lang`/`dir`
- Fonts come from the Gotenberg image's Noto families. There are no font files in the repo.
- On-demand downloads (a buyer's tickets) render in the web app through the port. Batch jobs (badges, reports, email attachments) render in the worker.
- If no renderer is configured, the download is simply not offered.

## Alternatives
- **`@react-pdf/renderer`:** in-process and light, but it fails the Arabic and tagged-PDF requirements.
- **Headless Chromium inside the web/worker process:** the same quality, but it adds ~300 MB to deploys and doesn't fit Vercel functions.

## Consequences
- One more service to run and monitor. It sits on Fly with a private address and is never exposed publicly.
- Ticket PDFs carry the Ed25519 QR (SVG) and the short code (ADR 0011).
- Theme tokens are shared with PDFs (roadmap §4.4).

## Revisit when
- PDF volume or latency exceeds one Gotenberg machine.
- `@react-pdf/renderer` gains tagged output and correct Arabic shaping.
