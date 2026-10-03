import { html } from './html.ts';

export interface InvoicePdfInput {
  readonly lang: string;
  readonly dir: 'ltr' | 'rtl';
  readonly title: string;
  readonly seller: string;
  /** Label → value rows (number, dates, terms, PO, billed to…), pre-formatted and translated. */
  readonly rows: readonly (readonly [string, string])[];
  readonly lineHeads: readonly [string, string, string, string];
  /** Item, quantity, unit price, line total (formatted). */
  readonly lines: readonly (readonly [string, string, string, string])[];
  /** Total, paid, balance due (label → formatted amount); the last one is emphasized. */
  readonly totals: readonly (readonly [string, string])[];
  readonly paymentsTitle: string;
  /** Date · method · reference → amount. */
  readonly payments: readonly (readonly [string, string])[];
  readonly note: string;
  readonly footer: string;
}

/**
 * An invoice (M5.1d): A4, plain HTML/CSS, no remote assets, `dir` for right-to-left languages.
 * Every value is escaped by the `html` template.
 */
export function invoiceHtml(input: InvoicePdfInput): string {
  const last = input.totals.length - 1;
  return html`<!doctype html>
<html lang="${input.lang}" dir="${input.dir}">
<head>
<meta charset="utf-8">
<title>${input.title}</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  body { margin: 0; color: #111; font: 10pt/1.5 'Noto Sans', 'Noto Sans Arabic', 'Noto Sans Devanagari', 'Noto Sans SC', 'Noto Sans TC', 'Noto Sans JP', sans-serif; }
  h1 { margin: 0; font-size: 18pt; font-weight: 600; }
  h2 { margin: 8mm 0 2mm; font-size: 11pt; font-weight: 600; }
  .seller { margin: 1mm 0 8mm; color: #52525b; }
  dl { display: grid; grid-template-columns: 50mm 1fr; gap: 1.2mm 4mm; margin: 0 0 6mm; }
  dt { color: #52525b; }
  dd { margin: 0; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: start; color: #52525b; font-weight: 400; border-block-end: 0.3mm solid #d4d4d8; padding: 1.5mm 0; }
  td { padding: 1.5mm 0; border-block-end: 0.2mm solid #e4e4e7; }
  .num { text-align: end; font-variant-numeric: tabular-nums; }
  .totals { margin-block-start: 4mm; margin-inline-start: auto; width: 75mm; }
  .totals div { display: flex; justify-content: space-between; padding: 1mm 0; }
  .due { border-block: 0.4mm solid #111; font-size: 13pt; font-weight: 600; padding: 2mm 0 !important; }
  .note { margin-block-start: 6mm; color: #3f3f46; white-space: pre-wrap; }
  footer { margin-block-start: 12mm; color: #71717a; font-size: 8pt; }
</style>
</head>
<body>
<h1>${input.title}</h1>
<p class="seller">${input.seller}</p>
<dl>${input.rows.map(([k, v]) => html`<dt>${k}</dt><dd>${v}</dd>`)}</dl>
<table>
<thead><tr><th>${input.lineHeads[0]}</th><th class="num">${input.lineHeads[1]}</th><th class="num">${input.lineHeads[2]}</th><th class="num">${input.lineHeads[3]}</th></tr></thead>
<tbody>${input.lines.map(([a, b, c, d]) => html`<tr><td>${a}</td><td class="num">${b}</td><td class="num">${c}</td><td class="num">${d}</td></tr>`)}</tbody>
</table>
<div class="totals">${input.totals.map(([k, v], i) => (i === last ? html`<div class="due"><span>${k}</span><span>${v}</span></div>` : html`<div><span>${k}</span><span>${v}</span></div>`))}</div>
${input.payments.length ? html`<h2>${input.paymentsTitle}</h2><table><tbody>${input.payments.map(([k, v]) => html`<tr><td>${k}</td><td class="num">${v}</td></tr>`)}</tbody></table>` : html``}
<p class="note">${input.note}</p>
<footer>${input.footer}</footer>
</body>
</html>`.toString();
}
