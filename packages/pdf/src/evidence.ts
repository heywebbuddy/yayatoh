import { html, type SafeHtml } from './html.ts';

/** A labelled section of the packet: rows of label → value, or a table. Values are pre-formatted. */
export interface EvidenceSection {
  readonly title: string;
  readonly rows?: readonly (readonly [string, string])[];
  readonly table?: { readonly head: readonly string[]; readonly body: readonly (readonly string[])[] };
  readonly text?: string;
  readonly note?: string;
}

export interface EvidencePdfInput {
  readonly lang: string;
  readonly title: string;
  readonly subtitle: string;
  readonly sections: readonly EvidenceSection[];
  readonly footer: string;
}

/**
 * The dispute evidence packet (M1.6d): A4, plain HTML/CSS, no remote assets. The caller bounds the
 * content (the card networks accept 4.5 MB / 19 pages); long text is cut, never the tables' meaning.
 */
export function disputeEvidenceHtml(input: EvidencePdfInput): string {
  const section = (s: EvidenceSection): SafeHtml => html`<section>
  <h2>${s.title}</h2>
  ${s.rows ? html`<dl>${s.rows.map(([k, v]) => html`<dt>${k}</dt><dd>${v}</dd>`)}</dl>` : ''}
  ${
    s.table
      ? html`<table><thead><tr>${s.table.head.map((h) => html`<th>${h}</th>`)}</tr></thead><tbody>${s.table.body.map(
          (r) => html`<tr>${r.map((c) => html`<td>${c}</td>`)}</tr>`,
        )}</tbody></table>`
      : ''
  }
  ${s.text ? html`<p class="text">${s.text.slice(0, 6_000)}</p>` : ''}
  ${s.note ? html`<p class="note">${s.note}</p>` : ''}
</section>`;
  return html`<!doctype html>
<html lang="${input.lang}">
<head>
<meta charset="utf-8">
<title>${input.title}</title>
<style>
  @page { size: A4; margin: 16mm 14mm; }
  body { margin: 0; color: #111; font: 9.5pt/1.45 'Noto Sans', sans-serif; }
  h1 { margin: 0; font-size: 16pt; font-weight: 500; }
  .sub { margin: 1mm 0 6mm; color: #52525b; }
  section { margin-block-end: 5mm; break-inside: avoid-page; }
  h2 { margin: 0 0 1.5mm; font-size: 11pt; font-weight: 600; border-block-end: 0.3mm solid #e4e4e7; padding-block-end: 1mm; }
  dl { display: grid; grid-template-columns: 45mm 1fr; gap: 0.8mm 4mm; margin: 0; }
  dt { color: #52525b; }
  dd { margin: 0; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: start; padding: 1mm 2mm 1mm 0; border-block-end: 0.2mm solid #f4f4f5; vertical-align: top; }
  th { color: #52525b; font-weight: 500; }
  .text { white-space: pre-wrap; margin: 0; }
  .note { color: #52525b; font-size: 8.5pt; margin: 1mm 0 0; }
  footer { margin-block-start: 8mm; color: #71717a; font-size: 8pt; }
</style>
</head>
<body>
<h1>${input.title}</h1>
<p class="sub">${input.subtitle}</p>
${input.sections.map(section)}
<footer>${input.footer}</footer>
</body>
</html>`.toString();
}
