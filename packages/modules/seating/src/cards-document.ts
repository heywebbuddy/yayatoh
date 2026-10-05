import { html, SafeHtml } from '@yayatoh/pdf';
import { paper as paperInk, print } from '@yayatoh/ui/tokens';
import {
  type CardKind,
  type CardsOf,
  isTent,
  PAPER,
  type PaperSize,
  paginate,
  type SheetLayout,
  sheetLayout,
} from './domain/cards.ts';

/**
 * Place, escort and table cards as one self-contained HTML document for the PDF renderer
 * (ADR 0017): pages at the chosen paper size, cards on the grid of `sheetLayout` with light cut
 * outlines (tent cards also show their fold), text in the Noto fonts of the renderer (Chromium
 * shapes Arabic; the document is `dir="rtl"` for Arabic, so cards fill each row from the right),
 * names isolated so a Latin name reads right inside an Arabic card. No remote assets, no scripts.
 */

/** The words on the cards, in the cards' language (the web app builds them with next-intl). */
export interface CardsCopy {
  /** The document title ("Place cards"). */
  readonly title: string;
  /** Over the table on an escort card ("Your table"). */
  readonly yourTable: string;
  /** An unnamed plus-one ("Guest of Ana García"). */
  readonly guestOf: (name: string) => string;
  /** A sponsored table ("Hosted by Acme"). */
  readonly hostedBy: (name: string) => string;
}

export interface CardsHtmlInput<K extends CardKind = CardKind> {
  readonly kind: K;
  readonly paper: PaperSize;
  readonly lang: string;
  readonly dir: 'ltr' | 'rtl';
  readonly copy: CardsCopy;
  readonly event: { readonly name: string; readonly startsAt: Date; readonly timeZone: string };
  readonly cards: readonly CardsOf[K][];
}

const n = (v: number) => Number(v.toFixed(2));

const nameOf = (g: { name: string | null; guestOf: string | null }, copy: CardsCopy) =>
  g.name ?? copy.guestOf(g.guestOf ?? '');

/** A name or label from the host: its own direction, inside the card's. */
const iso = (text: string) => html`<bdi>${text}</bdi>`;

function placeFace(c: CardsOf['place'], copy: CardsCopy) {
  return html`<p class="name">${iso(nameOf(c, copy))}</p><p class="place">${iso(c.place)}</p>`;
}

function tableFace(c: CardsOf['table'], copy: CardsCopy, event: string, date: string) {
  return html`<p class="table-label">${iso(c.place)}</p>${
    c.sponsor ? html`<p class="sponsor">${copy.hostedBy(c.sponsor)}</p>` : ''
  }<p class="event">${iso(event)} · ${date}</p>`;
}

function card<K extends CardKind>(kind: K, c: CardsOf[K], input: CardsHtmlInput<K>, date: string): SafeHtml {
  const { copy } = input;
  if (kind === 'escort') {
    const e = c as CardsOf['escort'];
    return html`<div class="face"><p class="party">${iso(e.party)}</p><p class="names">${e.names.map(
      (g, i) => html`${i ? ' · ' : ''}${iso(nameOf(g, copy))}`,
    )}</p><p class="caption">${copy.yourTable}</p><p class="place-big">${iso(e.place)}</p></div>`;
  }
  const face =
    kind === 'place'
      ? placeFace(c as CardsOf['place'], copy)
      : tableFace(c as CardsOf['table'], copy, input.event.name, date);
  // Folded across the middle: the top half is printed upside down so both faces stand upright.
  return html`<div class="half back" aria-hidden="true">${face}</div><div class="half front">${face}</div>`;
}

function css(layout: SheetLayout): SafeHtml {
  const p = PAPER[layout.paper];
  const tent = isTent(layout.kind);
  const slots = layout.slots.map((s, i) => `.s${i} { left: ${n(s.x)}mm; top: ${n(s.y)}mm; }`).join('\n  ');
  const big = layout.kind === 'table' ? Math.min(72, n(layout.cardWidthMm * 0.4)) : 0;
  // Our own constant stylesheet (token colours, numbers we computed): trusted, so not escaped.
  return new SafeHtml(`
  @page { size: ${n(p.widthMm)}mm ${n(p.heightMm)}mm; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; }
  body { color: ${print.ink}; background: ${print.paper}; font-family: 'Noto Sans', 'Noto Sans Arabic', 'Noto Sans Devanagari', 'Noto Sans CJK JP', 'Noto Sans CJK SC', 'Noto Sans CJK TC', sans-serif; }
  .sheet { position: relative; width: ${n(p.widthMm)}mm; height: ${n(p.heightMm)}mm; overflow: hidden; break-after: page; }
  .sheet:last-child { break-after: auto; }
  .card { position: absolute; width: ${n(layout.cardWidthMm)}mm; height: ${n(layout.cardHeightMm)}mm; outline: 0.2mm dashed ${paperInk.outline}; outline-offset: -0.1mm; overflow: hidden; }
  ${slots}
  p { margin: 0; overflow-wrap: anywhere; }
  .face, .half { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1.5mm; text-align: center; padding: 4mm 6mm; }
  .face { width: 100%; height: 100%; }
  .half { position: absolute; inset-inline-start: 0; width: 100%; height: 50%; }
  .back { top: 0; transform: rotate(180deg); }
  .front { top: 50%; ${tent ? `border-block-start: 0.2mm dotted ${paperInk.outline};` : ''} }
  .name { font-size: 18pt; line-height: 1.15; font-weight: 600; }
  .place { font-size: 10pt; color: ${paperInk.muted}; }
  .party { font-size: 12pt; font-weight: 600; line-height: 1.2; }
  .names { font-size: 8pt; color: ${paperInk.muted}; line-height: 1.3; }
  .caption { font-size: 8pt; color: ${paperInk.muted}; text-transform: uppercase; letter-spacing: 0.06em; margin-block-start: 1mm; }
  .place-big { font-size: 16pt; font-weight: 700; line-height: 1.1; }
  .table-label { font-size: ${big || 48}pt; font-weight: 700; line-height: 1.05; }
  .sponsor { font-size: 14pt; color: ${paperInk.muted}; }
  .event { font-size: 10pt; color: ${paperInk.muted}; margin-block-start: 4mm; }
`);
}

/** The cards as a self-contained HTML document (one `.sheet` per page). */
export function cardsHtml<K extends CardKind>(input: CardsHtmlInput<K>): string {
  const layout = sheetLayout(input.kind, input.paper, input.dir);
  const date = new Intl.DateTimeFormat(input.lang, {
    dateStyle: 'long',
    timeZone: input.event.timeZone,
  }).format(input.event.startsAt);
  const pages = paginate(input.cards, layout.perPage).map(
    (cards) =>
      html`<section class="sheet">${cards.map(
        (c, i) => html`<div class="${`card s${i}`}">${card(input.kind, c, input, date)}</div>`,
      )}</section>`,
  );
  return html`<!doctype html>
<html lang="${input.lang}" dir="${input.dir}">
<head>
<meta charset="utf-8">
<title>${input.copy.title} · ${input.event.name}</title>
<style>${css(layout)}</style>
</head>
<body>${pages}</body>
</html>`.toString();
}
