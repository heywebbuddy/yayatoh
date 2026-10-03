import { csvRow, writeXlsx, XLSX_CONTENT_TYPE } from '@yayatoh/csv';
import { DomainError } from '@yayatoh/kernel';
import { bulkCommands, defineBulkAction } from '@yayatoh/platform';
import { z } from 'zod';
import { CRM_LAYOUTS, EXPORT_FIELDS, type ExportLabels, exportHeaders, exportRow } from './domain/crm.ts';
import { type DonationLine, LINE_METHODS, lineNet, REPORT_SOURCES } from './domain/report.ts';
import { donationFactsTx } from './report.ts';

const Word = z.string().trim().min(1).max(60);
const words = <T extends readonly string[]>(keys: T) =>
  z.object(Object.fromEntries(keys.map((k) => [k, Word])) as { [K in T[number]]: typeof Word });

/** The layout and, for the generic one, its words in the requester's language. */
export const DonorExportParams = z.object({
  layout: z.enum(CRM_LAYOUTS),
  labels: z.object({
    headers: words(EXPORT_FIELDS),
    yes: Word,
    no: Word,
    sources: words(REPORT_SOURCES),
    methods: words(LINE_METHODS),
  }),
});
export type DonorExportParams = z.infer<typeof DonorExportParams>;

/** A ticket line is exported with its order (one order can hold several donation lines). */
const itemIdOf = (l: DonationLine) => (l.source === 'ticket' ? (l.orderId ?? l.id) : l.id);

/** Lines worth a CRM row: something reached the charity (fully refunded gifts are left out). */
const exported = (lines: readonly DonationLine[]) => lines.filter((l) => lineNet(l) > 0);

async function resolveLines(
  tx: Parameters<typeof donationFactsTx>[0],
  sel: { eventId: string | null; ids?: readonly string[] },
) {
  if (!sel.eventId) throw new DomainError('validation_failed', 'An event is required');
  const ids = [...new Set(exported((await donationFactsTx(tx, sel.eventId)).lines).map(itemIdOf))];
  if (sel.ids) {
    const ok = new Set(ids);
    return sel.ids.filter((id) => ok.has(id));
  }
  return ids;
}

async function chunkRows(
  tx: Parameters<typeof donationFactsTx>[0],
  eventId: string | null,
  ids: readonly string[],
  params: DonorExportParams,
) {
  if (!eventId) throw new DomainError('validation_failed', 'An event is required');
  const facts = await donationFactsTx(tx, eventId);
  const byItem = new Map<string, DonationLine[]>();
  for (const l of exported(facts.lines)) byItem.set(itemIdOf(l), [...(byItem.get(itemIdOf(l)) ?? []), l]);
  const labels = params.labels as ExportLabels;
  const rows: string[][] = [];
  const results = ids.map((id) => {
    const lines = byItem.get(id);
    if (!lines) return { id, ok: false, code: 'not_found' };
    for (const l of lines) rows.push(exportRow(params.layout, l, { timeZone: facts.timeZone, labels }));
    return { id, ok: true };
  });
  return { rows, results, header: exportHeaders(params.layout, labels) };
}

const fileName = (ext: string) => (p: DonorExportParams, now: Date) =>
  `donations-${p.layout.replace(/_/g, '-')}-${now.toISOString().slice(0, 10)}.${ext}`;

/**
 * The donor CRM export as CSV (M4.8g): every gift, offline pledge payment and donation ticket of
 * the event in the chosen layout. A bulk export like the gift list: `finance:read` (it carries
 * every donor and amount), a recent step-up, audited, refused while staff act as a member. Read in
 * the event's tenant only, so another org's donors can never appear.
 */
export const donorCsvExportAction = defineBulkAction({
  key: 'donations.donorsCsv',
  entitlement: 'donations',
  permission: 'finance:read',
  params: DonorExportParams,
  filter: z.object({}),
  chunkSize: 1_000,
  file: { contentType: 'text/csv; charset=utf-8', name: fileName('csv') },
  resolve: (tx, sel) => resolveLines(tx, sel),
  run: async (tx, _ctx, ids, params, meta) => {
    const { rows, results, header } = await chunkRows(tx, meta.eventId, ids, params);
    let out = meta.first ? `﻿${csvRow(header)}` : '';
    for (const r of rows) out += csvRow(r);
    return { results, append: out };
  },
});

/**
 * The same export as an Excel workbook: the operation stores one JSON array per row (bulk files
 * are text) and the download turns them into the `.xlsx` (`donorRowsToXlsx`).
 */
export const donorXlsxExportAction = defineBulkAction({
  key: 'donations.donorsXlsx',
  entitlement: 'donations',
  permission: 'finance:read',
  params: DonorExportParams,
  filter: z.object({}),
  chunkSize: 1_000,
  file: { contentType: 'application/x-ndjson; charset=utf-8', name: fileName('xlsx') },
  resolve: (tx, sel) => resolveLines(tx, sel),
  run: async (tx, _ctx, ids, params, meta) => {
    const { rows, results, header } = await chunkRows(tx, meta.eventId, ids, params);
    let out = meta.first ? `${JSON.stringify(header)}\n` : '';
    for (const r of rows) out += `${JSON.stringify(r)}\n`;
    return { results, append: out };
  },
});

export const donorCsvExportBulk = bulkCommands(donorCsvExportAction);
export const donorXlsxExportBulk = bulkCommands(donorXlsxExportAction);

const DECIMAL = /^-?(0|[1-9]\d{0,14})(\.\d{1,4})?$/;

/**
 * The stored rows of a workbook export, as the `.xlsx` file: the header row as text, amounts and
 * paddle numbers as numbers (so sums work), everything else as text. Each stored line must be an
 * array of strings.
 */
export function donorXlsxFile(content: string): Uint8Array {
  const Row = z.array(z.string().max(32_767)).max(100);
  const rows = content
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => Row.parse(JSON.parse(l)));
  return writeXlsx(
    rows.map((r, i) => (i === 0 ? r : r.map((c) => (DECIMAL.test(c) ? Number(c) : c)))),
    { sheet: 'Donations' },
  );
}

/** The workbook's media type, for the download. */
export const DONOR_XLSX_CONTENT_TYPE = XLSX_CONTENT_TYPE;
