import { html } from './html.ts';

export interface ReportTable {
  readonly title: string;
  readonly headers: readonly string[];
  readonly rows: readonly (readonly string[])[];
  /** Shown instead of an empty table. */
  readonly empty: string;
}

export interface AnalyticsReportPdfInput {
  readonly lang: string;
  readonly dir: 'ltr' | 'rtl';
  readonly title: string;
  /** The org and the period, pre-formatted by the caller. */
  readonly subtitle: string;
  /** When it was made and the time zone its days are in. */
  readonly meta: string;
  /** Figure tiles: label → value, pre-formatted and translated by the caller. */
  readonly figures: readonly (readonly [string, string])[];
  readonly tables: readonly ReportTable[];
  readonly footer: string;
}

/**
 * A scheduled analytics report (M6.2b): A4, plain HTML/CSS, no remote assets, `dir` for
 * right-to-left languages, tables with real headers (tagged PDF). Every value is escaped by the
 * `html` template; the caller formats numbers and money in the recipient's locale.
 */
export function analyticsReportHtml(input: AnalyticsReportPdfInput): string {
  return html`<!doctype html>
<html lang="${input.lang}" dir="${input.dir}">
<head>
<meta charset="utf-8">
<title>${input.title}</title>
<style>
  @page { size: A4; margin: 16mm 14mm; }
  body { margin: 0; color: #111; font: 10pt/1.5 'Noto Sans', 'Noto Sans Arabic', 'Noto Sans Devanagari', 'Noto Sans SC', 'Noto Sans TC', 'Noto Sans JP', sans-serif; }
  h1 { margin: 0; font-size: 18pt; font-weight: 600; }
  h2 { margin: 7mm 0 2mm; font-size: 12pt; font-weight: 600; }
  .sub { margin: 1mm 0 0; color: #3f3f46; }
  .meta { margin: 0 0 6mm; color: #71717a; font-size: 8.5pt; }
  .figures { display: grid; grid-template-columns: repeat(3, 1fr); gap: 3mm; margin: 0; padding: 0; list-style: none; }
  .figures li { border: 0.3mm solid #d4d4d8; border-radius: 2mm; padding: 2.5mm 3mm; }
  .figures .label { display: block; color: #52525b; font-size: 8.5pt; }
  .figures .value { display: block; font-size: 14pt; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: start; padding: 1.4mm 2mm; border-block-end: 0.2mm solid #e4e4e7; }
  th { color: #52525b; font-weight: 600; font-size: 8.5pt; }
  td.num, th.num { text-align: end; font-variant-numeric: tabular-nums; }
  .empty { color: #71717a; }
  footer { margin-block-start: 10mm; color: #71717a; font-size: 8pt; }
</style>
</head>
<body>
<h1>${input.title}</h1>
<p class="sub">${input.subtitle}</p>
<p class="meta">${input.meta}</p>
<ul class="figures">${input.figures.map(
    ([k, v]) => html`<li><span class="label">${k}</span><span class="value">${v}</span></li>`,
  )}</ul>
${input.tables.map(
  (t) => html`<h2>${t.title}</h2>
${
  t.rows.length
    ? html`<table><thead><tr>${t.headers.map((h, i) => html`<th scope="col" class="${i ? 'num' : ''}">${h}</th>`)}</tr></thead>
<tbody>${t.rows.map((r) => html`<tr>${r.map((c, i) => (i ? html`<td class="num">${c}</td>` : html`<th scope="row">${c}</th>`))}</tr>`)}</tbody></table>`
    : html`<p class="empty">${t.empty}</p>`
}`,
)}
<footer>${input.footer}</footer>
</body>
</html>`.toString();
}
