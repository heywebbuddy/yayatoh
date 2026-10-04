import { currencyExponent } from '@yayatoh/kernel';
import { type DonationLine, type LINE_METHODS, lineNet, type REPORT_SOURCES } from './report.ts';

/**
 * M4.8g donor CRM exports: one row per gift (or offline pledge payment, or donation ticket line),
 * with columns named the way common donor CRMs' gift imports expect them. `generic` uses the
 * requester's language; the CRM layouts keep each CRM's own (English) field names so the file
 * imports without remapping. Every layout keeps the anonymous flag (P4-13): the charity sees who
 * gave, and its CRM must not thank or list an anonymous donor publicly.
 */
export const CRM_LAYOUTS = ['generic', 'salesforce_npsp', 'bloomerang', 'little_green_light'] as const;
export type CrmLayout = (typeof CRM_LAYOUTS)[number];

export const EXPORT_FIELDS = [
  'date',
  'firstName',
  'lastName',
  'donor',
  'email',
  'anonymous',
  'amount',
  'gift',
  'feeCover',
  'refunded',
  'currency',
  'campaign',
  'level',
  'source',
  'method',
  'employer',
  'tribute',
  'paddle',
  'reference',
] as const;
export type ExportField = (typeof EXPORT_FIELDS)[number];

/** Each layout's columns, in order: the field and, for the CRM layouts, the CRM's header. */
export const CRM_COLUMNS: Readonly<Record<CrmLayout, readonly (readonly [ExportField, string | null])[]>> = {
  generic: [
    ['date', null],
    ['donor', null],
    ['email', null],
    ['anonymous', null],
    ['amount', null],
    ['gift', null],
    ['feeCover', null],
    ['refunded', null],
    ['currency', null],
    ['campaign', null],
    ['level', null],
    ['source', null],
    ['method', null],
    ['employer', null],
    ['tribute', null],
    ['paddle', null],
    ['reference', null],
  ],
  // Salesforce Nonprofit Success Pack: the NPSP Data Import object's field labels.
  salesforce_npsp: [
    ['firstName', 'Contact1 First Name'],
    ['lastName', 'Contact1 Last Name'],
    ['email', 'Contact1 Personal Email'],
    ['amount', 'Donation Amount'],
    ['date', 'Donation Date'],
    ['campaign', 'Donation Campaign Name'],
    ['method', 'Payment Method'],
    ['level', 'Donation Description'],
    ['anonymous', 'Anonymous'],
    ['employer', 'Contact1 Employer'],
    ['tribute', 'Honoree Name'],
    ['reference', 'Donation Import Reference'],
  ],
  // Bloomerang: the transaction import's columns.
  bloomerang: [
    ['firstName', 'First Name'],
    ['lastName', 'Last Name'],
    ['email', 'Email'],
    ['date', 'Date'],
    ['amount', 'Amount'],
    ['method', 'Method'],
    ['campaign', 'Campaign'],
    ['source', 'Appeal'],
    ['level', 'Note'],
    ['anonymous', 'Is Anonymous'],
    ['tribute', 'Tribute'],
    ['reference', 'Transaction Reference'],
  ],
  // Little Green Light: the gift import's columns.
  little_green_light: [
    ['firstName', 'First Name'],
    ['lastName', 'Last Name'],
    ['email', 'Email'],
    ['date', 'Gift Date'],
    ['amount', 'Gift Amount'],
    ['campaign', 'Campaign'],
    ['source', 'Appeal'],
    ['method', 'Payment Type'],
    ['level', 'Gift Note'],
    ['anonymous', 'Anonymous'],
    ['employer', 'Employer'],
    ['tribute', 'Tribute'],
    ['reference', 'External Gift ID'],
  ],
};

/** The words the generic layout uses, in the requester's language (the web passes them). */
export interface ExportLabels {
  readonly headers: Readonly<Record<ExportField, string>>;
  readonly yes: string;
  readonly no: string;
  readonly sources: Readonly<Record<(typeof REPORT_SOURCES)[number], string>>;
  readonly methods: Readonly<Record<(typeof LINE_METHODS)[number], string>>;
}

const EN_SOURCES = {
  online: 'Online',
  qr: 'QR code',
  paddle: 'Paddle raise',
  ticket: 'Ticket donation',
} as const;
const EN_METHODS = {
  card: 'Credit Card',
  check: 'Check',
  wire: 'Wire',
  stock: 'Stock',
  daf: 'Donor-Advised Fund',
  cash: 'Cash',
  other: 'Other',
} as const;

/** `1234.50`: a plain decimal in the currency's minor unit, as spreadsheets and CRMs read it. */
export function decimalAmount(minor: number, currency: string): string {
  const exp = currencyExponent(currency);
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  if (exp === 0) return `${sign}${abs}`;
  const div = 10 ** exp;
  return `${sign}${Math.floor(abs / div)}.${String(abs % div).padStart(exp, '0')}`;
}

/** "Ada King Lovelace" → first "Ada King", last "Lovelace"; one word is a last name. */
export function splitName(name: string): { first: string; last: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { first: '', last: parts[0] ?? '' };
  return { first: parts.slice(0, -1).join(' '), last: parts.at(-1) ?? '' };
}

/** `YYYY-MM-DD` in the event's time zone. */
export function localDate(d: Date, timeZone: string): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}`;
}

/** The header row of a layout. */
export function exportHeaders(layout: CrmLayout, labels: ExportLabels): string[] {
  return CRM_COLUMNS[layout].map(([field, header]) => header ?? labels.headers[field]);
}

/** One line's cells in a layout (text, except numbers kept as decimals for spreadsheets). */
export function exportRow(
  layout: CrmLayout,
  line: DonationLine,
  ctx: { timeZone: string; labels: ExportLabels },
): string[] {
  const generic = layout === 'generic';
  const { first, last } = splitName(line.donorName);
  const value = (field: ExportField): string => {
    switch (field) {
      case 'date':
        return localDate(line.date, ctx.timeZone);
      case 'firstName':
        return first;
      case 'lastName':
        return last;
      case 'donor':
        return line.donorName;
      case 'email':
        return line.donorEmail ?? '';
      case 'anonymous':
        return generic
          ? line.anonymous
            ? ctx.labels.yes
            : ctx.labels.no
          : line.anonymous
            ? 'TRUE'
            : 'FALSE';
      case 'amount':
        return decimalAmount(lineNet(line), line.currency);
      case 'gift':
        return decimalAmount(line.amountMinor, line.currency);
      case 'feeCover':
        return decimalAmount(line.feeCoverMinor, line.currency);
      case 'refunded':
        return decimalAmount(line.refundedMinor, line.currency);
      case 'currency':
        return line.currency;
      case 'campaign':
        return line.campaignName ?? '';
      case 'level':
        return line.levelName ?? '';
      case 'source':
        return generic ? ctx.labels.sources[line.source] : EN_SOURCES[line.source];
      case 'method':
        return generic ? ctx.labels.methods[line.method] : EN_METHODS[line.method];
      case 'employer':
        return line.employer ?? '';
      case 'tribute':
        return line.tributeName ?? '';
      case 'paddle':
        return line.paddleNumber === null ? '' : String(line.paddleNumber);
      case 'reference':
        return line.id;
    }
  };
  return CRM_COLUMNS[layout].map(([field]) => value(field));
}
