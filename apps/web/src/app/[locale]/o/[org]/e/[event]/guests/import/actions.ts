'use server';

import {
  GUEST_IMPORT_FIELDS,
  type GuestTableInput,
  guestImportBulk,
  MAX_IMPORT_BYTES,
  readGuestTable,
  stageGuestImportCommand,
  validateGuestImportCommand,
} from '@yayatoh/guests';
import { fetchGoogleSheetCsv } from '@yayatoh/guests/sheet';
import { DomainError, executeCommand, isDomainError } from '@yayatoh/kernel';
import { getLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation.ts';
import { runBulkInline } from '@/server/bulk.ts';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

/**
 * Guest-list import (M4.1b): read a pasted list, a file or a Google Sheet and stage it; check the
 * column mapping; start the import. Every step is a guests command (`guests:write`), so a viewer
 * posting a form is refused by the server. The sheet link is used for one read and not kept.
 */

const errorOf = (err: unknown) => {
  if (!isDomainError(err)) throw err;
  const reason = (err.details as { reason?: unknown } | undefined)?.reason;
  return typeof reason === 'string' ? `${err.code}:${reason}` : err.code;
};

const base = (org: string, event: string) => `/o/${org}/e/${event}/guests/import`;

async function stage(
  org: string,
  event: string,
  read: () => Promise<{ input: GuestTableInput; fileName?: string }>,
): Promise<void> {
  const { data, event: ev } = await loadEvent(org, event, 'guests');
  const locale = await getLocale();
  let batchId: string;
  try {
    const { input, fileName = '' } = await read();
    const t = readGuestTable(input);
    ({ batchId } = await executeCommand(
      stageGuestImportCommand,
      {
        eventId: ev.id,
        source: input.source,
        fileName: fileName.slice(0, 200),
        sheet: t.sheet,
        sheets: t.sheets.slice(0, 100).map((s) => s.slice(0, 200)),
        headers: [...t.headers],
        rows: t.rows.map((r) => [...r]),
      },
      data.ctx,
      ports,
    ));
  } catch (err) {
    return redirect({ href: `${base(org, event)}?error=${errorOf(err)}`, locale });
  }
  redirect({ href: `${base(org, event)}?batch=${batchId}`, locale });
}

const validation = (reason: string) => new DomainError('validation_failed', 'Unreadable list', { reason });

/** Pasted rows (tab-separated from a spreadsheet, or CSV text). */
export async function pasteImportAction(org: string, event: string, form: FormData): Promise<void> {
  await stage(org, event, async () => {
    const text = String(form.get('text') ?? '');
    if (!text.trim()) throw validation('empty');
    if (new TextEncoder().encode(text).length > MAX_IMPORT_BYTES) throw validation('too_large');
    return { input: { source: 'paste', text } };
  });
}

/** A CSV or XLSX upload (the content decides: a zip is a workbook). */
export async function uploadImportAction(org: string, event: string, form: FormData): Promise<void> {
  await stage(org, event, async () => {
    const file = form.get('file');
    if (!(file instanceof File) || file.size === 0) throw validation('empty');
    if (file.size > MAX_IMPORT_BYTES) throw validation('too_large');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const zip = bytes[0] === 0x50 && bytes[1] === 0x4b;
    // Legacy binary Excel (.xls, an OLE file): ask for .xlsx or CSV instead.
    if (bytes[0] === 0xd0 && bytes[1] === 0xcf) throw validation('old_excel');
    const sheet = String(form.get('sheet') ?? '').trim();
    return {
      input: zip ? { source: 'xlsx', bytes, sheet: sheet || null } : { source: 'csv', bytes },
      fileName: file.name || (zip ? 'guests.xlsx' : 'guests.csv'),
    };
  });
}

/** A Google Sheet shared as "anyone with the link" (P4-7): read once through the SSRF guard. */
export async function sheetImportAction(org: string, event: string, form: FormData): Promise<void> {
  await stage(org, event, async () => {
    const url = String(form.get('url') ?? '').trim();
    if (!url) throw validation('sheet_url');
    return { input: { source: 'sheet', bytes: await fetchGoogleSheetCsv(url.slice(0, 2_000)) } };
  });
}

const col = (v: FormDataEntryValue | null) => {
  const n = Number.parseInt(String(v ?? ''), 10);
  return Number.isInteger(n) && n >= 0 ? n : undefined;
};

/** Step 2: the host's column mapping; checks every row and plans the parties. */
export async function validateImportAction(org: string, event: string, batchId: string, form: FormData) {
  const { data, event: ev } = await loadEvent(org, event, 'guests');
  const locale = await getLocale();
  const href = `${base(org, event)}?batch=${batchId}`;
  try {
    await executeCommand(
      validateGuestImportCommand,
      {
        eventId: ev.id,
        batchId,
        mapping: Object.fromEntries(GUEST_IMPORT_FIELDS.map((f) => [f, col(form.get(f))])),
      },
      data.ctx,
      ports,
    );
  } catch (err) {
    return redirect({ href: `${href}&error=${errorOf(err)}`, locale });
  }
  redirect({ href: `${href}#check`, locale });
}

/** Step 3: import the planned parties (a bulk job; small lists finish before the page loads). */
export async function startImportAction(org: string, event: string, batchId: string) {
  const { data, event: ev } = await loadEvent(org, event, 'guests');
  const locale = await getLocale();
  const href = `${base(org, event)}?batch=${batchId}`;
  let operationId: string;
  try {
    ({ operationId } = await executeCommand(
      guestImportBulk.start,
      { eventId: ev.id, selection: { filter: { batchId } }, params: {} },
      data.ctx,
      ports,
    ));
  } catch (err) {
    return redirect({ href: `${href}&error=${errorOf(err)}`, locale });
  }
  await runBulkInline(data.org.id, operationId);
  redirect({ href: `${href}&op=${operationId}`, locale });
}
