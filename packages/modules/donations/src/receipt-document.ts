import { LOCALES, type Locale, RTL_LOCALES } from '@yayatoh/contracts';
import { formatMoney, money } from '@yayatoh/kernel';
import { html, SafeHtml } from '@yayatoh/pdf';
import { light, print } from '@yayatoh/ui/tokens';
import { IntlMessageFormat } from 'intl-messageformat';
import { formatReceiptNumber } from './domain/receipts.ts';
import { RECEIPT_COPY, type ReceiptCopy } from './legal/receipt-copy.ts';

/**
 * Receipt and year-end statement documents (M4.8b): the same words (the `legal-copy` file) for the
 * email body, the PDF and the console. Dates print in the org's timezone (reports and statements
 * use the org timezone); money in the receipt's currency, formatted for the donor's locale.
 */

export interface ReceiptDocInput {
  readonly number: number;
  readonly deductible: boolean;
  readonly donorName: string;
  readonly currency: string;
  readonly amountMinor: number;
  readonly fmvMinor: number;
  readonly deductibleMinor: number;
  readonly goods: string | null;
  readonly charityName: string;
  readonly charityEin: string | null;
  readonly sponsorName: string | null;
  readonly sponsorEin: string | null;
  readonly charityAddress: string | null;
  readonly eventName: string;
  readonly paidAt: Date;
  /** The org's timezone (the receipt's date). */
  readonly timeZone: string;
}

export interface StatementDocInput {
  readonly taxYear: number;
  readonly donorName: string;
  readonly currency: string;
  readonly amountMinor: number;
  readonly fmvMinor: number;
  readonly deductibleMinor: number;
  readonly charityName: string;
  readonly charityEin: string;
  readonly sponsorName: string | null;
  readonly sponsorEin: string | null;
  readonly charityAddress: string | null;
  readonly timeZone: string;
  readonly lines: readonly {
    readonly number: number;
    readonly paidAt: Date;
    readonly eventName: string;
    readonly amountMinor: number;
    readonly fmvMinor: number;
    readonly deductibleMinor: number;
  }[];
}

export interface ReceiptText {
  readonly lang: Locale;
  readonly dir: 'ltr' | 'rtl';
  readonly title: string;
  readonly rows: readonly (readonly [string, string])[];
  /** The legal statements, in order: exemption, goods or services (or not deductible), keep. */
  readonly statements: readonly string[];
  readonly footer: string;
}

export function receiptLocale(locale: string | null | undefined): Locale {
  return (LOCALES as readonly string[]).includes(locale ?? '') ? (locale as Locale) : 'en';
}

const fmt = (msg: string, lang: Locale, values: Record<string, string | number>) =>
  String(new IntlMessageFormat(msg, lang, undefined, { ignoreTag: true }).format(values));

const moneyOf = (lang: Locale, currency: string) => (minor: number) =>
  formatMoney(money(minor, currency), lang);

function exemption(c: ReceiptCopy, lang: Locale, d: Omit<ReceiptDocInput, 'number'>): string | null {
  if (!d.charityEin) return null;
  if (d.sponsorName && d.sponsorEin)
    return fmt(c.sponsored, lang, {
      charity: d.charityName,
      sponsor: d.sponsorName,
      sponsorEin: d.sponsorEin,
    });
  return fmt(c.exempt, lang, { charity: d.charityName, ein: d.charityEin });
}

/** A receipt's title, rows and legal statements in one locale. */
export function receiptText(d: ReceiptDocInput, locale: string): ReceiptText {
  const lang = receiptLocale(locale);
  const c = RECEIPT_COPY[lang];
  const m = moneyOf(lang, d.currency);
  const date = new Intl.DateTimeFormat(lang, { dateStyle: 'long', timeZone: d.timeZone }).format(d.paidAt);
  const rows: (readonly [string, string])[] = [
    [c.labels.number, formatReceiptNumber(d.number)],
    [c.labels.date, date],
    [c.labels.donor, d.donorName],
    [c.labels.charity, d.sponsorName ? `${d.charityName} · ${d.sponsorName}` : d.charityName],
  ];
  if (d.deductible && d.charityEin) rows.push([c.labels.ein, d.sponsorEin ?? d.charityEin]);
  if (d.charityAddress) rows.push([c.labels.address, d.charityAddress]);
  rows.push([c.labels.event, d.eventName], [c.labels.amount, m(d.amountMinor)]);
  const statements: string[] = [];
  if (d.deductible) {
    if (d.goods) rows.push([c.labels.goods, d.goods]);
    if (d.fmvMinor > 0 || d.goods) rows.push([c.labels.fmv, m(d.fmvMinor)]);
    rows.push([c.labels.deductible, m(d.deductibleMinor)]);
    const ex = exemption(c, lang, d);
    if (ex) statements.push(ex);
    statements.push(
      d.fmvMinor > 0 || d.goods
        ? fmt(c.quidProQuo, lang, {
            amount: m(d.amountMinor),
            fmv: m(d.fmvMinor),
            deductible: m(d.deductibleMinor),
          })
        : c.noGoods,
    );
  } else {
    statements.push(c.notDeductible);
  }
  statements.push(c.keep);
  return {
    lang,
    dir: RTL_LOCALES.has(lang) ? 'rtl' : 'ltr',
    title: d.deductible ? c.receiptTitle : c.plainTitle,
    rows,
    statements,
    footer: fmt(c.footer, lang, { charity: d.charityName }),
  };
}

/** The receipt as plain text: the email body (each row a line, then the statements). */
export function receiptEmailBody(d: ReceiptDocInput, locale: string): string {
  const t = receiptText(d, locale);
  return [t.rows.map(([k, v]) => `${k}: ${v}`).join('\n'), ...t.statements].join('\n\n');
}

// Our own constant stylesheet (token colours): trusted, so not escaped.
const CSS = new SafeHtml(`
  @page { size: A4; margin: 18mm 16mm; }
  body { margin: 0; color: ${print.ink}; font: 10pt/1.5 'Noto Sans', 'Noto Sans Arabic', 'Noto Sans Devanagari', 'Noto Sans SC', 'Noto Sans TC', 'Noto Sans JP', sans-serif; }
  h1 { margin: 0; font-size: 18pt; font-weight: 600; }
  .charity { margin: 1mm 0 8mm; color: ${light.ink2}; }
  dl { display: grid; grid-template-columns: 62mm 1fr; gap: 1.2mm 4mm; margin: 0 0 8mm; }
  dt { color: ${light.ink2}; }
  dd { margin: 0; }
  .statement { margin: 0 0 3mm; }
  table { width: 100%; border-collapse: collapse; margin: 0 0 6mm; }
  th, td { text-align: start; padding: 1.5mm 2mm; border-block-end: 0.2mm solid ${light.line}; }
  td.num, th.num { text-align: end; font-variant-numeric: tabular-nums; }
  tfoot td { font-weight: 600; border-block-start: 0.4mm solid ${print.ink}; }
  footer { margin-block-start: 12mm; color: ${light.ink2}; font-size: 8pt; }
`);

/** A receipt as a self-contained A4 HTML document for the PDF renderer. */
export function receiptHtml(d: ReceiptDocInput, locale: string): string {
  const t = receiptText(d, locale);
  return html`<!doctype html>
<html lang="${t.lang}" dir="${t.dir}">
<head>
<meta charset="utf-8">
<title>${t.title} ${formatReceiptNumber(d.number)}</title>
<style>${CSS}</style>
</head>
<body>
<h1>${t.title}</h1>
<p class="charity">${d.charityName}</p>
<dl>${t.rows.map(([k, v]) => html`<dt>${k}</dt><dd>${v}</dd>`)}</dl>
${t.statements.map((s) => html`<p class="statement">${s}</p>`)}
<footer>${t.footer}</footer>
</body>
</html>`.toString();
}

/** A year-end statement as a self-contained A4 HTML document. */
export function statementHtml(s: StatementDocInput, locale: string): string {
  const lang = receiptLocale(locale);
  const c = RECEIPT_COPY[lang];
  const m = moneyOf(lang, s.currency);
  const date = new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeZone: s.timeZone });
  const title = fmt(c.statementTitle, lang, { year: String(s.taxYear) });
  const ex = exemption(c, lang, {
    ...s,
    deductible: true,
    goods: null,
    eventName: '',
    paidAt: new Date(0),
  });
  return html`<!doctype html>
<html lang="${lang}" dir="${RTL_LOCALES.has(lang) ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>${CSS}</style>
</head>
<body>
<h1>${title}</h1>
<p class="charity">${s.charityName}</p>
<dl>
<dt>${c.labels.donor}</dt><dd>${s.donorName}</dd>
<dt>${c.labels.charity}</dt><dd>${s.sponsorName ? `${s.charityName} · ${s.sponsorName}` : s.charityName}</dd>
<dt>${c.labels.ein}</dt><dd>${s.sponsorEin ?? s.charityEin}</dd>
${s.charityAddress ? html`<dt>${c.labels.address}</dt><dd>${s.charityAddress}</dd>` : ''}
<dt>${c.labels.year}</dt><dd>${String(s.taxYear)}</dd>
</dl>
<p class="statement">${fmt(c.statementIntro, lang, { charity: s.charityName, year: String(s.taxYear) })}</p>
<table>
<caption>${c.labels.payments}</caption>
<thead><tr><th>${c.labels.number}</th><th>${c.labels.date}</th><th>${c.labels.event}</th><th class="num">${c.labels.amount}</th><th class="num">${c.labels.fmv}</th><th class="num">${c.labels.deductible}</th></tr></thead>
<tbody>${s.lines.map(
    (l) =>
      html`<tr><td>${formatReceiptNumber(l.number)}</td><td>${date.format(l.paidAt)}</td><td>${l.eventName}</td><td class="num">${m(l.amountMinor)}</td><td class="num">${m(l.fmvMinor)}</td><td class="num">${m(l.deductibleMinor)}</td></tr>`,
  )}</tbody>
<tfoot><tr><td colspan="3">${c.labels.total}</td><td class="num">${m(s.amountMinor)}</td><td class="num">${m(s.fmvMinor)}</td><td class="num">${m(s.deductibleMinor)}</td></tr></tfoot>
</table>
<p class="statement">${fmt(c.statementTotal, lang, { year: String(s.taxYear), deductible: m(s.deductibleMinor) })}</p>
${ex ? html`<p class="statement">${ex}</p>` : ''}
<p class="statement">${c.keep}</p>
<footer>${fmt(c.footer, lang, { charity: s.charityName })}</footer>
</body>
</html>`.toString();
}

/** The year-end statement as plain text (the email body). */
export function statementEmailBody(s: StatementDocInput, locale: string): string {
  const lang = receiptLocale(locale);
  const c = RECEIPT_COPY[lang];
  const m = moneyOf(lang, s.currency);
  return [
    fmt(c.statementIntro, lang, { charity: s.charityName, year: String(s.taxYear) }),
    fmt(c.statementTotal, lang, { year: String(s.taxYear), deductible: m(s.deductibleMinor) }),
    c.keep,
  ].join('\n\n');
}

/** The ticket page's quid-pro-quo notice in one locale. */
export function taxNoticeText(
  n: { priceMinor: number; fmvMinor: number; deductibleMinor: number; currency: string },
  locale: string,
): { title: string; text: string } {
  const lang = receiptLocale(locale);
  const c = RECEIPT_COPY[lang];
  const m = moneyOf(lang, n.currency);
  return {
    title: c.noticeTitle,
    text: fmt(c.notice, lang, {
      price: m(n.priceMinor),
      deductible: m(n.deductibleMinor),
      fmv: m(n.fmvMinor),
    }),
  };
}
