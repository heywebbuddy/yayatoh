import { html } from './html.ts';

export interface DsarReceiptPdfInput {
  readonly lang: string;
  readonly dir: 'ltr' | 'rtl';
  readonly title: string;
  readonly org: string;
  /** Label → value rows (request, subject hint, dates), pre-formatted and translated. */
  readonly rows: readonly (readonly [string, string])[];
  readonly erasedTitle: string;
  readonly erasedHeaders: readonly [string, string, string];
  readonly erased: readonly (readonly [string, string, string])[];
  readonly erasedEmpty: string;
  readonly heldTitle: string;
  readonly heldHeaders: readonly [string, string, string, string];
  readonly held: readonly (readonly [string, string, string, string])[];
  readonly heldEmpty: string;
  /** Sentences after the tables (files deleted, suppression, connectors). */
  readonly notes: readonly string[];
  readonly signatureTitle: string;
  readonly signatureRows: readonly (readonly [string, string])[];
  readonly publicKeyPem: string;
  readonly footer: string;
}

/**
 * The data-subject erasure receipt (M6.1c): A4, plain HTML/CSS, no remote assets, `dir` for
 * right-to-left languages, every value escaped. It lists what was erased and what was kept under
 * a legal hold and why, then the Ed25519 signature and the key that checks it.
 */
export function dsarReceiptHtml(input: DsarReceiptPdfInput): string {
  return html`<!doctype html>
<html lang="${input.lang}" dir="${input.dir}">
<head>
<meta charset="utf-8">
<title>${input.title}</title>
<style>
  @page { size: A4; margin: 16mm 14mm; }
  body { margin: 0; color: #111; font: 9.5pt/1.45 'Noto Sans', 'Noto Sans Arabic', 'Noto Sans Devanagari', 'Noto Sans SC', 'Noto Sans TC', 'Noto Sans JP', sans-serif; }
  h1 { margin: 0; font-size: 17pt; font-weight: 600; }
  h2 { margin: 7mm 0 2mm; font-size: 11.5pt; font-weight: 600; }
  .org { margin: 1mm 0 6mm; color: #52525b; }
  dl { display: grid; grid-template-columns: 48mm 1fr; gap: 1mm 4mm; margin: 0; }
  dt { color: #52525b; }
  dd { margin: 0; overflow-wrap: anywhere; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: start; padding: 1.2mm 2mm; border-block-end: 0.2mm solid #d4d4d8; vertical-align: top; overflow-wrap: anywhere; }
  th { color: #52525b; font-weight: 600; }
  .empty { color: #52525b; }
  .notes p { margin: 1.5mm 0; }
  pre { margin: 2mm 0 0; padding: 2mm; background: #f4f4f5; font: 7.5pt/1.3 'Noto Sans Mono', monospace; white-space: pre-wrap; overflow-wrap: anywhere; direction: ltr; text-align: left; }
  .mono { font-family: 'Noto Sans Mono', monospace; font-size: 8pt; direction: ltr; unicode-bidi: embed; }
  footer { margin-block-start: 8mm; color: #71717a; font-size: 8pt; }
</style>
</head>
<body>
<h1>${input.title}</h1>
<p class="org">${input.org}</p>
<dl>${input.rows.map(([k, v]) => html`<dt>${k}</dt><dd>${v}</dd>`)}</dl>
<h2>${input.erasedTitle}</h2>
${
  input.erased.length
    ? html`<table><thead><tr>${input.erasedHeaders.map((h) => html`<th scope="col">${h}</th>`)}</tr></thead><tbody>${input.erased.map(
        ([a, b, c]) => html`<tr><td class="mono">${a}</td><td>${b}</td><td>${c}</td></tr>`,
      )}</tbody></table>`
    : html`<p class="empty">${input.erasedEmpty}</p>`
}
<h2>${input.heldTitle}</h2>
${
  input.held.length
    ? html`<table><thead><tr>${input.heldHeaders.map((h) => html`<th scope="col">${h}</th>`)}</tr></thead><tbody>${input.held.map(
        ([a, b, c, d]) =>
          html`<tr><td class="mono">${a}</td><td class="mono">${b}</td><td>${c}</td><td>${d}</td></tr>`,
      )}</tbody></table>`
    : html`<p class="empty">${input.heldEmpty}</p>`
}
<div class="notes">${input.notes.map((n) => html`<p>${n}</p>`)}</div>
<h2>${input.signatureTitle}</h2>
<dl>${input.signatureRows.map(([k, v]) => html`<dt>${k}</dt><dd class="mono">${v}</dd>`)}</dl>
<pre>${input.publicKeyPem}</pre>
<footer>${input.footer}</footer>
</body>
</html>`.toString();
}
