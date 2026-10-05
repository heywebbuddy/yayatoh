import { html } from './html.ts';

export interface CreditNotePdfInput {
  readonly lang: string;
  readonly dir: 'ltr' | 'rtl';
  readonly title: string;
  readonly seller: string;
  /** Label → value rows, pre-formatted and translated by the caller. */
  readonly rows: readonly (readonly [string, string])[];
  readonly amountLabel: string;
  readonly amount: string;
  readonly note: string;
  readonly footer: string;
}

/**
 * A credit note (M3.10c): A4, plain HTML/CSS, no remote assets, `dir` for right-to-left
 * languages. Every value is escaped by the `html` template.
 */
export function creditNoteHtml(input: CreditNotePdfInput): string {
  return html`<!doctype html>
<html lang="${input.lang}" dir="${input.dir}">
<head>
<meta charset="utf-8">
<title>${input.title}</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  body { margin: 0; color: #111; font: 10pt/1.5 'Noto Sans', 'Noto Sans Arabic', 'Noto Sans Devanagari', 'Noto Sans SC', 'Noto Sans TC', 'Noto Sans JP', sans-serif; }
  h1 { margin: 0; font-size: 18pt; font-weight: 600; }
  .seller { margin: 1mm 0 8mm; color: #52525b; }
  dl { display: grid; grid-template-columns: 50mm 1fr; gap: 1.2mm 4mm; margin: 0 0 8mm; }
  dt { color: #52525b; }
  dd { margin: 0; }
  .total { display: flex; justify-content: space-between; border-block: 0.4mm solid #111; padding: 3mm 0; font-size: 13pt; font-weight: 600; }
  .note { margin-block-start: 6mm; color: #3f3f46; white-space: pre-wrap; }
  footer { margin-block-start: 12mm; color: #71717a; font-size: 8pt; }
</style>
</head>
<body>
<h1>${input.title}</h1>
<p class="seller">${input.seller}</p>
<dl>${input.rows.map(([k, v]) => html`<dt>${k}</dt><dd>${v}</dd>`)}</dl>
<div class="total"><span>${input.amountLabel}</span><span>${input.amount}</span></div>
<p class="note">${input.note}</p>
<footer>${input.footer}</footer>
</body>
</html>`.toString();
}
