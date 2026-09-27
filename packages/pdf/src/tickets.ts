import { html } from './html.ts';
import { qrPath } from './qr.ts';

export interface TicketsPdfInput {
  readonly lang: string;
  readonly dir: 'ltr' | 'rtl';
  readonly eventName: string;
  /** Already formatted in the event's timezone and the buyer's locale. */
  readonly when: string;
  readonly where: string | null;
  readonly organizer: string;
  readonly tickets: readonly {
    readonly typeName: string;
    readonly serialLabel: string;
    readonly shortCode: string;
    readonly holderName: string;
    readonly code: string;
    /** Accessible name of the QR image. */
    readonly qrLabel: string;
  }[];
  readonly labels: {
    readonly code: string;
    readonly holder: string;
    readonly footer: string;
  };
}

/**
 * One A6 page per ticket: event, pass, holder, the signed QR and the short code. Plain HTML/CSS
 * (logical properties, so RTL just works), system Noto fonts from the renderer, no remote assets.
 */
export function ticketsHtml(input: TicketsPdfInput): string {
  const pages = input.tickets.map((t) => {
    const qr = qrPath(t.code);
    return html`<section class="ticket">
  <header>
    <p class="eyebrow">${input.organizer}</p>
    <h1>${input.eventName}</h1>
    <p class="meta">${input.when}</p>
    ${input.where ? html`<p class="meta">${input.where}</p>` : ''}
  </header>
  <div class="pass"><span>${t.typeName}</span><span class="serial">${t.serialLabel}</span></div>
  <svg class="qr" role="img" aria-label="${t.qrLabel}" viewBox="0 0 ${qr.size} ${qr.size}" shape-rendering="crispEdges">
    <rect width="${qr.size}" height="${qr.size}" fill="#fff"/><path d="${qr.d}" fill="#111"/>
  </svg>
  <dl>
    <div><dt>${input.labels.code}</dt><dd class="code">${t.shortCode}</dd></div>
    <div><dt>${input.labels.holder}</dt><dd>${t.holderName}</dd></div>
  </dl>
  <footer>${input.labels.footer}</footer>
</section>`;
  });
  return html`<!doctype html>
<html lang="${input.lang}" dir="${input.dir}">
<head>
<meta charset="utf-8">
<title>${input.eventName}</title>
<style>
  @page { size: 105mm 148mm; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; color: #111; font-family: 'Noto Sans', 'Noto Sans Arabic', 'Noto Sans Devanagari', 'Noto Sans CJK JP', 'Noto Sans CJK SC', 'Noto Sans CJK TC', sans-serif; }
  .ticket { block-size: 148mm; padding: 9mm 8mm; display: flex; flex-direction: column; gap: 3mm; break-after: page; }
  .ticket:last-child { break-after: auto; }
  .eyebrow { margin: 0; font-size: 7.5pt; letter-spacing: 0.08em; text-transform: uppercase; color: #52525b; }
  h1 { margin: 1mm 0 0; font-size: 15pt; font-weight: 500; line-height: 1.2; }
  .meta { margin: 0.5mm 0 0; font-size: 9pt; color: #3f3f46; }
  .pass { display: flex; justify-content: space-between; gap: 4mm; padding-block: 2mm; border-block: 0.3mm solid #e4e4e7; font-size: 10pt; }
  .serial { font-variant-numeric: tabular-nums; color: #52525b; }
  .qr { inline-size: 58mm; block-size: 58mm; align-self: center; }
  dl { margin: 0; display: grid; gap: 1.5mm; font-size: 9pt; }
  dl div { display: flex; justify-content: space-between; gap: 4mm; }
  dt { color: #52525b; }
  dd { margin: 0; }
  .code { direction: ltr; unicode-bidi: isolate; font-family: 'Noto Sans Mono', monospace; letter-spacing: 0.2em; font-size: 11pt; }
  footer { margin-block-start: auto; font-size: 7pt; color: #71717a; }
</style>
</head>
<body>${pages}</body>
</html>`.value;
}
