import { LOCALES, type Locale, RTL_LOCALES } from '@yayatoh/contracts';
import { html, SafeHtml } from '@yayatoh/pdf';
import { light, print } from '@yayatoh/ui/tokens';
import { IntlMessageFormat } from 'intl-messageformat';
import { formatCredits } from './domain/credits.ts';
import { CERTIFICATE_COPY } from './legal/certificate-copy.ts';

/**
 * The CE certificate document (M6.9b): the same words (the `legal-copy` file) for the PDF, the
 * email body and the verification page. Session dates print in the event's timezone; credits in
 * the holder's locale. Everything here is computed from the stored awards, so a certificate
 * reproduces exactly from the scans and watch time it was calculated from.
 */
export interface CertificateDocInput {
  readonly code: string;
  readonly revision: number;
  readonly status: 'issued' | 'revoked';
  readonly holderName: string;
  readonly eventName: string;
  readonly orgName: string;
  /** The organizer's credit name, or null (the copy's default). */
  readonly creditLabel: string | null;
  readonly accreditor: string | null;
  /** The event's timezone (session dates). */
  readonly timeZone: string;
  readonly issuedAt: Date;
  readonly revisedAt: Date;
  /** Hundredths. */
  readonly totalCredits: number;
  readonly sessions: readonly {
    readonly title: string;
    readonly startsAt: Date;
    readonly inPersonMinutes: number;
    readonly virtualMinutes: number;
    readonly minutes: number;
    /** Hundredths. */
    readonly credits: number;
  }[];
  /** The public verification page for this code. */
  readonly verifyUrl: string;
}

export interface CertificateText {
  readonly lang: Locale;
  readonly dir: 'ltr' | 'rtl';
  readonly title: string;
  readonly certifies: string;
  readonly name: string;
  readonly attended: string;
  readonly earned: string;
  readonly headers: readonly [string, string, string, string, string, string];
  readonly rows: readonly (readonly [string, string, string, string, string, string])[];
  readonly totalRow: readonly [string, string];
  readonly statements: readonly string[];
  readonly facts: readonly (readonly [string, string])[];
  readonly revoked: string | null;
  readonly footer: string;
}

export function certificateLocale(locale: string | null | undefined): Locale {
  return (LOCALES as readonly string[]).includes(locale ?? '') ? (locale as Locale) : 'en';
}

const fmt = (msg: string, lang: Locale, values: Record<string, string | number>) =>
  String(new IntlMessageFormat(msg, lang, undefined, { ignoreTag: true }).format(values));

/** A certificate's words in one locale (the PDF, the email body and tests read the same). */
export function certificateText(d: CertificateDocInput, locale: string): CertificateText {
  const lang = certificateLocale(locale);
  const c = CERTIFICATE_COPY[lang];
  const label = d.creditLabel ?? c.defaultLabel;
  const n = new Intl.NumberFormat(lang);
  const day = new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeZone: d.timeZone });
  const issued = new Intl.DateTimeFormat(lang, { dateStyle: 'long', timeZone: d.timeZone });
  const statements = [c.basis];
  if (d.accreditor)
    statements.unshift(fmt(c.accreditation, lang, { org: d.orgName, accreditor: d.accreditor }));
  statements.push(fmt(c.verify, lang, { url: d.verifyUrl, code: d.code }));
  const facts: (readonly [string, string])[] = [
    [c.labels.code, d.code],
    [c.labels.issued, issued.format(d.issuedAt)],
  ];
  if (d.revision > 1)
    facts.push([c.labels.revision, `${n.format(d.revision)} · ${issued.format(d.revisedAt)}`]);
  return {
    lang,
    dir: RTL_LOCALES.has(lang) ? 'rtl' : 'ltr',
    title: c.title,
    certifies: c.certifies,
    name: d.holderName,
    attended: fmt(c.attended, lang, { event: d.eventName, org: d.orgName }),
    earned: fmt(c.earned, lang, { credits: formatCredits(d.totalCredits, lang), label }),
    headers: [
      c.labels.session,
      c.labels.date,
      c.labels.inPerson,
      c.labels.online,
      c.labels.minutes,
      c.labels.credits,
    ],
    rows: d.sessions.map((s) => [
      s.title,
      day.format(s.startsAt),
      n.format(s.inPersonMinutes),
      n.format(s.virtualMinutes),
      n.format(s.minutes),
      formatCredits(s.credits, lang),
    ]),
    totalRow: [c.labels.total, formatCredits(d.totalCredits, lang)],
    statements,
    facts,
    revoked: d.status === 'revoked' ? c.revoked : null,
    footer: fmt(c.footer, lang, { org: d.orgName }),
  };
}

/** The certificate as plain text: the email body. */
export function certificateEmailBody(d: CertificateDocInput, locale: string): string {
  const t = certificateText(d, locale);
  return [
    `${t.certifies} ${t.name} ${t.attended} ${t.earned}`,
    t.rows.map((r) => `${r[0]} (${r[1]}): ${r[5]} · ${r[4]} min`).join('\n'),
    t.facts.map(([k, v]) => `${k}: ${v}`).join('\n'),
    ...t.statements,
  ].join('\n\n');
}

// Our own constant stylesheet (token colours): trusted, so not escaped.
const CSS = new SafeHtml(`
  @page { size: A4 landscape; margin: 14mm 16mm; }
  body { margin: 0; color: ${print.ink}; font: 10pt/1.5 'Noto Sans', 'Noto Sans Arabic', 'Noto Sans Devanagari', 'Noto Sans SC', 'Noto Sans TC', 'Noto Sans JP', sans-serif; }
  .frame { border: 0.8mm solid ${print.ink}; padding: 10mm 14mm; min-height: 150mm; }
  h1 { margin: 0 0 6mm; font-size: 24pt; font-weight: 600; text-align: center; }
  .lead { margin: 0; text-align: center; font-size: 12pt; }
  .name { margin: 2mm 0; text-align: center; font-size: 20pt; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; margin: 6mm 0 4mm; }
  th, td { text-align: start; padding: 1.4mm 2mm; border-block-end: 0.2mm solid ${light.line}; }
  th { color: ${light.ink2}; font-weight: 600; }
  td.num, th.num { text-align: end; font-variant-numeric: tabular-nums; }
  tfoot td { font-weight: 600; border-block-start: 0.4mm solid ${print.ink}; }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: 1mm 4mm; margin: 4mm 0; }
  dt { color: ${light.ink2}; }
  dd { margin: 0; }
  .code { font-family: 'Noto Sans Mono', monospace; direction: ltr; unicode-bidi: embed; }
  .statement { margin: 0 0 2mm; font-size: 9pt; }
  .revoked { margin: 0 0 4mm; padding: 2mm 3mm; border: 0.4mm solid ${print.ink}; font-weight: 600; text-align: center; }
  footer { margin-block-start: 6mm; color: ${light.ink2}; font-size: 8pt; }
`);

/** The certificate as a self-contained A4 landscape HTML document for the PDF renderer. */
export function certificateHtml(d: CertificateDocInput, locale: string): string {
  const t = certificateText(d, locale);
  return html`<!doctype html>
<html lang="${t.lang}" dir="${t.dir}">
<head>
<meta charset="utf-8">
<title>${t.title} ${d.code}</title>
<style>${CSS}</style>
</head>
<body>
<main class="frame">
${t.revoked ? html`<p class="revoked" role="status">${t.revoked}</p>` : ''}
<h1>${t.title}</h1>
<p class="lead">${t.certifies}</p>
<p class="name">${t.name}</p>
<p class="lead">${t.attended}</p>
<p class="lead">${t.earned}</p>
<table>
<thead><tr>${t.headers.map((h, i) => html`<th scope="col"${i >= 2 ? new SafeHtml(' class="num"') : ''}>${h}</th>`)}</tr></thead>
<tbody>${t.rows.map(
    (r) =>
      html`<tr><td>${r[0]}</td><td>${r[1]}</td><td class="num">${r[2]}</td><td class="num">${r[3]}</td><td class="num">${r[4]}</td><td class="num">${r[5]}</td></tr>`,
  )}</tbody>
<tfoot><tr><td colspan="5">${t.totalRow[0]}</td><td class="num">${t.totalRow[1]}</td></tr></tfoot>
</table>
<dl>${t.facts.map(([k, v], i) => html`<dt>${k}</dt><dd${i === 0 ? new SafeHtml(' class="code"') : ''}>${v}</dd>`)}</dl>
${t.statements.map((s) => html`<p class="statement">${s}</p>`)}
<footer>${t.footer}</footer>
</main>
</body>
</html>`.toString();
}
