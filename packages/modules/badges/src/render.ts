import { html, qrPath, SafeHtml } from '@yayatoh/pdf';
import { print } from '@yayatoh/ui/tokens';
import { type ResolvedElement, resolveBadge } from './domain/content.ts';
import type { BadgeDesign } from './domain/design.ts';
import { faceOrigin } from './domain/layout.ts';
import type { BadgeRow } from './domain/row.ts';
import { type BadgeSize, pageSizeMm, SIZES } from './domain/sizes.ts';

export interface BadgesHtmlInput {
  readonly lang: string;
  /** The document title (the event's name). */
  readonly title: string;
  /** The org logo as a data: URI (the renderer fetches nothing), with its alt text. */
  readonly logo: { readonly dataUri: string; readonly alt: string } | null;
  readonly badges: readonly {
    readonly design: BadgeDesign;
    readonly row: BadgeRow;
    /** Accessible name of the QR image. */
    readonly qrLabel: string;
  }[];
}

const n = (v: number) => Number(v.toFixed(2));

function element(
  e: ResolvedElement,
  logo: BadgesHtmlInput['logo'],
  code: string,
  qrLabel: string,
): SafeHtml | string {
  if (e.empty) return '';
  const box = `left:${n(e.x)}mm;top:${n(e.y)}mm;width:${n(e.w)}mm;height:${n(e.h)}mm`;
  if (e.kind === 'qr') {
    const q = qrPath(code);
    const side = Math.min(e.w, e.h);
    return html`<svg class="qr" style="${`left:${n(e.x + (e.w - side) / 2)}mm;top:${n(e.y + (e.h - side) / 2)}mm;width:${n(side)}mm;height:${n(side)}mm`}" role="img" aria-label="${qrLabel}" viewBox="0 0 ${q.size} ${q.size}" shape-rendering="crispEdges"><rect width="${q.size}" height="${q.size}" fill="${print.paper}"/><path d="${q.d}" fill="${print.ink}"/></svg>`;
  }
  if (e.kind === 'logo' && logo)
    return html`<img class="logo" style="${box}" src="${logo.dataUri}" alt="${logo.alt}">`;
  const style = `${box};font-size:${e.fontPt}pt;text-align:${e.align};justify-content:${
    e.align === 'left' ? 'flex-start' : e.align === 'right' ? 'flex-end' : 'center'
  };font-weight:${e.bold ? 700 : 400}${e.fill ? `;background:${e.fill};color:${e.color}` : ''}`;
  return html`<div class="${e.kind === 'ribbon' ? 'el ribbon' : 'el'}" style="${style}"><span dir="auto">${e.text}</span></div>`;
}

/** Named pages per stock size, so one PDF may mix sizes (templates differ per ticket type). */
function pageRules(sizes: ReadonlySet<BadgeSize>): string {
  return [...sizes]
    .map((s) => {
      const p = pageSizeMm(s);
      return `@page ${s} { size: ${n(p.widthMm)}mm ${n(p.heightMm)}mm; margin: 0; }`;
    })
    .join('\n  ');
}

/**
 * Badges as one self-contained HTML document for the PDF renderer (ADR 0017): one page per badge
 * at its stock size, text in system Noto fonts (Arabic is shaped by the browser engine, RTL
 * designs are mirrored in `resolveBadge`), the QR drawn as an SVG path, no remote assets.
 */
export function badgesHtml(input: BadgesHtmlInput): string {
  const sizes = new Set(input.badges.map((b) => b.design.size));
  const pages = input.badges.map(({ design, row, qrLabel }) => {
    const els = resolveBadge(design, row, input.logo !== null);
    const s = SIZES[design.size];
    const p = pageSizeMm(design.size);
    const faces = (['front', 'back'] as const)
      .filter((f) => f === 'front' || s.foldOver)
      .map((f) => {
        const o = faceOrigin(design.size, f);
        return html`<div class="${`face ${f}`}" style="${`top:${n(o.y)}mm;width:${n(s.widthMm)}mm;height:${n(s.heightMm)}mm${o.rotate ? ';transform:rotate(180deg)' : ''}`}">${els
          .filter((e) => e.face === f)
          .map((e) => element(e, input.logo, row.code, qrLabel))}</div>`;
      });
    return html`<section class="badge" dir="${design.direction}" style="${`page:${design.size};width:${n(p.widthMm)}mm;height:${n(p.heightMm)}mm`}">${faces}</section>`;
  });
  return html`<!doctype html>
<html lang="${input.lang}">
<head>
<meta charset="utf-8">
<title>${input.title}</title>
<style>
  ${new SafeHtml(pageRules(sizes))}
  * { box-sizing: border-box; }
  body { margin: 0; color: ${print.ink}; font-family: 'Noto Sans', 'Noto Sans Arabic', 'Noto Sans Devanagari', 'Noto Sans CJK JP', 'Noto Sans CJK SC', 'Noto Sans CJK TC', sans-serif; }
  .badge { position: relative; overflow: hidden; break-after: page; }
  .badge:last-child { break-after: auto; }
  .face { position: absolute; inset-inline-start: 0; overflow: hidden; transform-origin: center; }
  /* Boxes are placed physically (RTL is already mirrored); the text keeps its own direction. */
  .el { position: absolute; display: flex; align-items: center; overflow: hidden; line-height: 1.15; direction: ltr; }
  .el span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; unicode-bidi: plaintext; }
  .ribbon { padding-inline: 2mm; letter-spacing: 0.04em; }
  .qr, .logo { position: absolute; }
  .logo { object-fit: contain; }
</style>
</head>
<body>${pages}</body>
</html>`.value;
}
