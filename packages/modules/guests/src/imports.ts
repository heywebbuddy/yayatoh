import { CsvError, csvRow, decodeText, parseCsv, parseXlsx } from '@yayatoh/csv';
import type { TenantTx } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import { type Ctx, DomainError, requireOrg, uuidv7 } from '@yayatoh/kernel';
import { bulkCommands, defineBulkAction, keyVault, tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, asc, eq, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { fullName, type GuestLike, nextPrimary } from './domain/guests.ts';
import {
  GUEST_IMPORT_FIELDS,
  type GuestMapping,
  groupGuestRows,
  guessGuestMapping,
  type MappedGuestRow,
  mapGuestRow,
  type PlannedParty,
} from './domain/import.ts';
import {
  MAX_GUESTS_PER_EVENT,
  MAX_GUESTS_PER_PARTY,
  MAX_PARTIES_PER_EVENT,
  recordHistoryTx,
  seal,
} from './guests.ts';
import {
  guests,
  IMPORT_SOURCES,
  IMPORT_STATUSES,
  type ImportSource,
  importBatches,
  importRows,
  parties,
} from './schema.ts';

/** Uploads and pasted text: 5 MB, 5,000 rows (the event holds at most 3,000 guests), 50 columns. */
export const MAX_IMPORT_BYTES = 5_000_000;
export const MAX_IMPORT_ROWS = 5_000;
const LIMITS = { maxRows: MAX_IMPORT_ROWS, maxColumns: 50, maxCell: 1_000 };
/** Staged rows (and rejected rows after the import) are purged this long after staging. */
export const IMPORT_TTL_MS = 72 * 3_600_000;
const GROUP_LIMITS = {
  maxGuestsPerParty: MAX_GUESTS_PER_PARTY,
  maxPartiesPerEvent: MAX_PARTIES_PER_EVENT,
  maxGuestsPerEvent: MAX_GUESTS_PER_EVENT,
};

/* ------------------------------------------------------------------------------ reading ---- */

export type GuestTableInput =
  | { readonly source: 'paste'; readonly text: string }
  | { readonly source: 'csv' | 'sheet'; readonly bytes: Uint8Array }
  | { readonly source: 'xlsx'; readonly bytes: Uint8Array; readonly sheet?: string | null };

export interface GuestTable {
  readonly headers: readonly string[];
  readonly rows: readonly (readonly string[])[];
  readonly sheet: string | null;
  readonly sheets: readonly string[];
}

/**
 * Pasted text (tab-separated from a spreadsheet, or comma/semicolon), a CSV file in any common
 * encoding, an XLSX workbook, or a Google Sheet's CSV export → header and rows. Unreadable
 * input is `validation_failed` with the reader's reason (`too_many_rows`, `not_a_spreadsheet`…).
 */
export function readGuestTable(input: GuestTableInput): GuestTable {
  try {
    if (input.source === 'xlsx') {
      const x = parseXlsx(input.bytes, { sheet: input.sheet ?? null, limits: LIMITS });
      return { headers: x.headers, rows: x.rows, sheet: x.sheet, sheets: x.sheets };
    }
    const text = input.source === 'paste' ? input.text : decodeText(input.bytes);
    const t = parseCsv(text, LIMITS);
    return { headers: t.headers, rows: t.rows, sheet: null, sheets: [] };
  } catch (err) {
    if (err instanceof CsvError)
      throw new DomainError('validation_failed', 'The list is not readable', {
        reason: err.code,
        line: err.line,
      });
    throw err;
  }
}

/* ------------------------------------------------------------------------------ sealing ---- */

const sealJson = (orgId: string, value: unknown) =>
  keyVault().encrypt(orgId, new TextEncoder().encode(JSON.stringify(value)));

async function openJson<T>(orgId: string, ciphertext: string): Promise<T> {
  return JSON.parse(new TextDecoder().decode(await keyVault().decrypt(orgId, ciphertext))) as T;
}

const openCells = async (orgId: string, c: string | null): Promise<string[]> =>
  c ? ((await openJson<{ cells: string[] }>(orgId, c)).cells ?? []) : [];

const openHeaders = async (orgId: string, c: string | null): Promise<string[]> =>
  c ? ((await openJson<{ headers: string[] }>(orgId, c)).headers ?? []) : [];

/** Seal many values without holding thousands of promises at once. */
async function sealAll<T>(items: readonly T[], f: (x: T) => Promise<string>): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < items.length; i += 500)
    out.push(...(await Promise.all(items.slice(i, i + 500).map(f))));
  return out;
}

/* ------------------------------------------------------------------------------ helpers ---- */

type BatchRow = typeof importBatches.$inferSelect;

async function batchOf(tx: TenantTx, eventId: string, batchId: string, lock = false): Promise<BatchRow> {
  const q = tx
    .select()
    .from(importBatches)
    .where(and(eq(importBatches.id, batchId), eq(importBatches.eventId, eventId)));
  const [b] = lock ? await q.for('update') : await q;
  if (!b) throw new DomainError('not_found', 'Import not found');
  return b;
}

const expired = (b: BatchRow, now: Date) => b.purgedAt !== null || b.expiresAt <= now;

/** Clears the sealed header and rows of this org's expired imports (and says how many). */
async function purgeExpiredTx(tx: TenantTx, now: Date): Promise<{ batches: number; rows: number }> {
  const gone = await tx
    .update(importBatches)
    .set({ headersCiphertext: null, purgedAt: now, updatedAt: now })
    .where(and(isNull(importBatches.purgedAt), lte(importBatches.expiresAt, now)))
    .returning({ id: importBatches.id });
  if (gone.length === 0) return { batches: 0, rows: 0 };
  const rows = await tx
    .update(importRows)
    .set({ cellsCiphertext: null, updatedAt: now })
    .where(
      and(
        inArray(
          importRows.batchId,
          gone.map((g) => g.id),
        ),
        isNotNull(importRows.cellsCiphertext),
      ),
    )
    .returning({ id: importRows.id });
  return { batches: gone.length, rows: rows.length };
}

async function existingOf(tx: TenantTx, eventId: string) {
  const [names, [g]] = await Promise.all([
    tx.select({ name: parties.name }).from(parties).where(eq(parties.eventId, eventId)),
    tx.select({ n: sql<number>`count(*)::int` }).from(guests).where(eq(guests.eventId, eventId)),
  ]);
  return {
    existingPartyNames: names.map((n) => n.name),
    existing: { parties: names.length, guests: g?.n ?? 0 },
    limits: GROUP_LIMITS,
  };
}

/** Rows of a batch with their cells opened and read through the mapping. */
async function mappedRowsTx(
  tx: TenantTx,
  orgId: string,
  mapping: GuestMapping,
  where: ReturnType<typeof and>,
): Promise<(MappedGuestRow & { id: string; plannedPartyId: string | null; cells: string[] })[]> {
  const rows = await tx
    .select({
      id: importRows.id,
      rowNo: importRows.rowNo,
      c: importRows.cellsCiphertext,
      plannedPartyId: importRows.plannedPartyId,
    })
    .from(importRows)
    .where(where)
    .orderBy(asc(importRows.rowNo));
  const cells = await Promise.all(rows.map((r) => openCells(orgId, r.c)));
  return rows.map((r, i) => {
    const c = cells[i] ?? [];
    return { ...mapGuestRow(r.rowNo, c, mapping), id: r.id, plannedPartyId: r.plannedPartyId, cells: c };
  });
}

/* ------------------------------------------------------------------------------- stage ---- */

const Cell = z.string().max(1_000);

/**
 * Step 1: stage a list (already read with `readGuestTable`). The header and every row are
 * sealed with the org's key; the mapping is guessed from the header. Nothing reaches the guest
 * list yet. Expired imports of the org are purged on the way.
 */
export const stageGuestImportCommand = tenantCommand({
  name: 'guests.stageImport',
  input: z.object({
    eventId: z.uuid(),
    source: z.enum(IMPORT_SOURCES),
    fileName: z.string().trim().max(200).default(''),
    sheet: z.string().trim().min(1).max(200).nullable().default(null),
    sheets: z.array(z.string().max(200)).max(100).default([]),
    headers: z.array(Cell).min(1).max(50),
    rows: z.array(z.array(Cell).max(50)).max(MAX_IMPORT_ROWS),
  }),
  output: z.object({ batchId: z.uuid(), rowCount: z.int() }),
  entitlement: 'guests',
  permission: 'guests:write',
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    if (!(await findEventTx(tx, input.eventId))) throw new DomainError('not_found');
    if (input.rows.length === 0)
      throw new DomainError('validation_failed', 'The list has no rows', { reason: 'empty' });
    await purgeExpiredTx(tx, ctx.now);
    const headers = input.headers.map((h) => h.trim());
    const [b] = await tx
      .insert(importBatches)
      .values({
        orgId,
        eventId: input.eventId,
        source: input.source,
        fileName: input.fileName,
        sheet: input.sheet,
        sheets: [...input.sheets],
        headersCiphertext: await sealJson(orgId, { headers }),
        columnCount: headers.length,
        mapping: guessGuestMapping(headers),
        rowCount: input.rows.length,
        expiresAt: new Date(ctx.now.getTime() + IMPORT_TTL_MS),
        uploadedBy: ctx.actor.type === 'user' ? ctx.actor.userId : null,
      })
      .returning({ id: importBatches.id });
    if (!b) throw new DomainError('internal');
    const sealed = await sealAll(input.rows, (cells) => sealJson(orgId, { cells }));
    for (let i = 0; i < sealed.length; i += 1_000)
      await tx.insert(importRows).values(
        sealed.slice(i, i + 1_000).map((c, j) => ({
          orgId,
          batchId: b.id,
          rowNo: i + j + 1,
          cellsCiphertext: c,
        })),
      );
    return { batchId: b.id, rowCount: input.rows.length };
  },
  // Counts only: never the file name, header or cells.
  audit: (input, r) => ({
    action: 'guests.import.stage',
    targetType: 'guest_import',
    targetId: r?.batchId ?? null,
    data: { eventId: input.eventId, source: input.source, rows: r?.rowCount ?? 0 },
  }),
});

/* ---------------------------------------------------------------------------- validate ---- */

const Col = z.int().min(0).max(49).optional();
export const GuestMappingInput = z
  .object(
    Object.fromEntries(GUEST_IMPORT_FIELDS.map((f) => [f, Col])) as Record<
      (typeof GUEST_IMPORT_FIELDS)[number],
      typeof Col
    >,
  )
  .refine(
    (m) => {
      const used = Object.values(m).filter((v) => v !== undefined);
      return new Set(used).size === used.length;
    },
    { message: 'Each column can map to one field', path: ['mapping'] },
  );

/**
 * Step 2: apply the host's mapping, group the rows into parties and record why each rejected
 * row can't be imported. Each planned party gets its id now; the import creates it with that
 * id exactly once. Can be run again with another mapping until the import starts.
 */
export const validateGuestImportCommand = tenantCommand({
  name: 'guests.validateImport',
  input: z.object({ eventId: z.uuid(), batchId: z.uuid(), mapping: GuestMappingInput }),
  output: z.object({ parties: z.int(), guests: z.int(), rejected: z.int() }),
  entitlement: 'guests',
  permission: 'guests:write',
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    const b = await batchOf(tx, input.eventId, input.batchId, true);
    if (b.status !== 'staged' && b.status !== 'validated')
      throw new DomainError('invalid_state', 'Already imported', { reason: 'already_imported' });
    if (expired(b, ctx.now)) throw new DomainError('invalid_state', 'Expired', { reason: 'expired' });
    const mapping = Object.fromEntries(
      Object.entries(input.mapping).filter(([, v]) => v !== undefined),
    ) as GuestMapping;
    if (Object.values(mapping).some((i) => (i as number) >= b.columnCount))
      throw new DomainError('validation_failed', 'Unknown column', {
        field: 'mapping',
        reason: 'unknown_column',
      });
    if (mapping.firstName === undefined && mapping.fullName === undefined)
      throw new DomainError('validation_failed', 'Map a name column', {
        field: 'mapping',
        reason: 'name_required',
      });
    const rows = await mappedRowsTx(tx, orgId, mapping, and(eq(importRows.batchId, b.id)));
    const { parties: planned, rejected } = groupGuestRows(rows, await existingOf(tx, b.eventId));
    const plannedOf = new Map<number, string>();
    for (const p of planned) {
      const id = uuidv7();
      for (const n of p.rowNos) plannedOf.set(n, id);
    }
    const updates = rows.map((r) => ({
      id: r.id,
      code: rejected.get(r.rowNo) ?? null,
      pid: rejected.has(r.rowNo) ? null : (plannedOf.get(r.rowNo) ?? null),
    }));
    for (let i = 0; i < updates.length; i += 1_000) {
      const part = updates.slice(i, i + 1_000);
      await tx.execute(sql`
        update ${importRows} set error_code = v.code, planned_party_id = v.pid,
          updated_at = ${ctx.now.toISOString()}::timestamptz
        from (values ${sql.join(
          part.map((u) => sql`(${u.id}::uuid, ${u.code}::text, ${u.pid}::uuid)`),
          sql`, `,
        )}) as v(id, code, pid)
        where ${importRows.id} = v.id`);
    }
    const guestCount = planned.reduce((n, p) => n + p.guests.length, 0);
    await tx
      .update(importBatches)
      .set({
        mapping,
        status: 'validated',
        partiesPlanned: planned.length,
        guestsPlanned: guestCount,
        validatedAt: ctx.now,
        updatedAt: ctx.now,
      })
      .where(eq(importBatches.id, b.id));
    return { parties: planned.length, guests: guestCount, rejected: rejected.size };
  },
  audit: (input, r) => ({
    action: 'guests.import.validate',
    targetType: 'guest_import',
    targetId: input.batchId,
    data: { eventId: input.eventId, parties: r?.parties ?? 0, rejected: r?.rejected ?? 0 },
  }),
});

/* ----------------------------------------------------------------------------- summary ---- */

const PreviewGuest = z.object({
  kind: z.enum(['guest', 'plus_one']),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  ageClass: z.enum(['adult', 'child', 'infant']),
  /** For a plus-one: who brings them. */
  guestOf: z.string().nullable(),
});

export const GuestImportSummaryDto = z.object({
  batchId: z.uuid(),
  source: z.enum(IMPORT_SOURCES),
  fileName: z.string(),
  sheet: z.string().nullable(),
  sheets: z.array(z.string()),
  status: z.enum(IMPORT_STATUSES),
  /** The staged rows were purged (72 hours after staging): nothing more can happen. */
  expired: z.boolean(),
  expiresAt: z.date(),
  headers: z.array(z.string()),
  mapping: z.record(z.string(), z.int()),
  rowCount: z.int(),
  /** The first rows as read, to help pick columns. */
  sample: z.array(z.array(z.string())),
  partiesPlanned: z.int(),
  guestsPlanned: z.int(),
  partiesImported: z.int(),
  guestsImported: z.int(),
  rejected: z.int(),
  rejectedByCode: z.record(z.string(), z.int()),
  /** The first parties the import will create. */
  preview: z.array(
    z.object({
      name: z.string(),
      side: z.string().nullable(),
      vip: z.boolean(),
      tags: z.array(z.string()),
      guests: z.array(PreviewGuest),
    }),
  ),
  /** The first rejected rows, with a name to recognise them by. */
  rejectedRows: z.array(z.object({ rowNo: z.int(), name: z.string().nullable(), code: z.string() })),
});
export type GuestImportSummaryDto = z.infer<typeof GuestImportSummaryDto>;

const PREVIEW_PARTIES = 20;

/** Where an import stands: mapping, planned parties (a preview), rejected rows, progress. */
export const guestImportSummaryQuery = tenantQuery({
  name: 'guests.importSummary',
  input: z.object({ eventId: z.uuid(), batchId: z.uuid() }),
  output: GuestImportSummaryDto,
  entitlement: 'guests',
  permission: 'guests:write',
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    const b = await batchOf(tx, input.eventId, input.batchId);
    const gone = expired(b, ctx.now);
    const mapping = b.mapping as GuestMapping;
    const counts = await tx
      .select({ code: importRows.errorCode, n: sql<number>`count(*)::int` })
      .from(importRows)
      .where(and(eq(importRows.batchId, b.id), isNotNull(importRows.errorCode)))
      .groupBy(importRows.errorCode);
    const rejectedByCode = Object.fromEntries(counts.map((c) => [c.code ?? '', c.n]));
    const validated = b.status !== 'staged';
    let preview: GuestImportSummaryDto['preview'] = [];
    let rejectedRows: GuestImportSummaryDto['rejectedRows'] = [];
    let sample: string[][] = [];
    if (!gone) {
      const first = await tx
        .select({ c: importRows.cellsCiphertext })
        .from(importRows)
        .where(and(eq(importRows.batchId, b.id), isNotNull(importRows.cellsCiphertext)))
        .orderBy(asc(importRows.rowNo))
        .limit(3);
      sample = await Promise.all(first.map((r) => openCells(orgId, r.c)));
    }
    if (validated && !gone) {
      if (b.status === 'validated') {
        const ids = await tx
          .select({ pid: importRows.plannedPartyId, first: sql<number>`min(${importRows.rowNo})` })
          .from(importRows)
          .where(and(eq(importRows.batchId, b.id), isNotNull(importRows.plannedPartyId)))
          .groupBy(importRows.plannedPartyId)
          .orderBy(sql`min(${importRows.rowNo})`)
          .limit(PREVIEW_PARTIES);
        const rows = ids.length
          ? await mappedRowsTx(
              tx,
              orgId,
              mapping,
              and(
                eq(importRows.batchId, b.id),
                inArray(
                  importRows.plannedPartyId,
                  ids.map((i) => i.pid as string),
                ),
              ),
            )
          : [];
        const grouped = groupGuestRows(rows, {
          existingPartyNames: [],
          existing: { parties: 0, guests: 0 },
          limits: { ...GROUP_LIMITS, maxPartiesPerEvent: Number.MAX_SAFE_INTEGER },
        });
        preview = grouped.parties.map(previewOf);
      }
      const bad = await mappedRowsTx(
        tx,
        orgId,
        mapping,
        and(eq(importRows.batchId, b.id), isNotNull(importRows.errorCode)),
      );
      const codes = await tx
        .select({ rowNo: importRows.rowNo, code: importRows.errorCode })
        .from(importRows)
        .where(and(eq(importRows.batchId, b.id), isNotNull(importRows.errorCode)))
        .orderBy(asc(importRows.rowNo))
        .limit(20);
      const byNo = new Map(bad.map((r) => [r.rowNo, r]));
      rejectedRows = codes.map((c) => {
        const r = byNo.get(c.rowNo);
        const name = r ? (fullName(r) ?? r.household) : null;
        return { rowNo: c.rowNo, name: name || null, code: c.code ?? 'rejected' };
      });
    }
    return {
      batchId: b.id,
      source: b.source as ImportSource,
      fileName: b.fileName,
      sheet: b.sheet,
      sheets: b.sheets,
      status: b.status as (typeof IMPORT_STATUSES)[number],
      expired: gone,
      expiresAt: b.expiresAt,
      headers: gone ? [] : await openHeaders(orgId, b.headersCiphertext),
      mapping: b.mapping,
      rowCount: b.rowCount,
      sample,
      partiesPlanned: b.partiesPlanned,
      guestsPlanned: b.guestsPlanned,
      partiesImported: b.partiesImported,
      guestsImported: b.guestsImported,
      rejected: counts.reduce((n, c) => n + c.n, 0),
      rejectedByCode,
      preview,
      rejectedRows,
    };
  },
});

function previewOf(p: PlannedParty): GuestImportSummaryDto['preview'][number] {
  return {
    name: p.name,
    side: p.side,
    vip: p.vip,
    tags: [...p.tags],
    guests: p.guests.map((g) => {
      const host = g.host === null ? null : p.guests[g.host];
      return {
        kind: g.kind,
        firstName: g.firstName,
        lastName: g.lastName,
        ageClass: g.ageClass,
        guestOf: host ? fullName(host) : null,
      };
    }),
  };
}

/**
 * The rows that were not imported, as CSV: the host's own columns plus the reason (in the
 * host's language), ready to fix and import again. Cells are formula-safe (`csvRow`).
 */
export const guestImportRejectedQuery = tenantQuery({
  name: 'guests.importRejected',
  category: 'export',
  input: z.object({
    eventId: z.uuid(),
    batchId: z.uuid(),
    reasonHeader: z.string().trim().min(1).max(60),
    reasons: z.record(z.string(), z.string().max(200)),
  }),
  output: z.object({ fileName: z.string(), csv: z.string() }),
  entitlement: 'guests',
  permission: 'guests:write',
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    const b = await batchOf(tx, input.eventId, input.batchId);
    if (expired(b, ctx.now)) throw new DomainError('not_found', 'Expired');
    const rows = await tx
      .select({ c: importRows.cellsCiphertext, code: importRows.errorCode })
      .from(importRows)
      .where(and(eq(importRows.batchId, b.id), isNotNull(importRows.errorCode)))
      .orderBy(asc(importRows.rowNo));
    const headers = await openHeaders(orgId, b.headersCiphertext);
    let csv = `﻿${csvRow([...headers, input.reasonHeader])}`;
    for (const r of rows) {
      const cells = await openCells(orgId, r.c);
      const padded = [...cells, ...Array(Math.max(0, headers.length - cells.length)).fill('')];
      csv += csvRow([...padded, input.reasons[r.code ?? ''] ?? r.code]);
    }
    const base = b.fileName.replace(/\.(csv|xlsx|txt)$/i, '').trim() || 'guests';
    return { fileName: `${base}-not-imported.csv`, csv };
  },
});

/* ------------------------------------------------------------------------------ import ---- */

const ImportFilter = z.object({ batchId: z.uuid() });

const presentFields = (o: Record<string, unknown>) =>
  Object.entries(o)
    .filter(([k, v]) =>
      Array.isArray(v)
        ? v.length > 0
        : v !== null && v !== '' && v !== false && !(k === 'ageClass' && v === 'adult'),
    )
    .map(([k]) => k);

/**
 * Step 3: the import job (a bulk operation: small lists finish inline, large ones on the worker
 * with progress). One item per planned party: the party is created with its planned id, whole,
 * with its guests and plus-ones (source `import`, history with the batch id), and its rows'
 * cells are purged. A party that no longer fits (the event filled up, or a party of that name
 * was added since the check) is rejected whole. Starting it again is refused; running a chunk
 * again creates nothing twice.
 */
export const guestImportAction = defineBulkAction({
  key: 'guests.import',
  entitlement: 'guests',
  permission: 'guests:write',
  params: z.object({}),
  filter: ImportFilter,
  chunkSize: 50,
  resolve: async (tx, sel) => {
    if (!sel.filter || !sel.eventId) throw new DomainError('validation_failed', 'An import is required');
    const b = await batchOf(tx, sel.eventId, sel.filter.batchId, true);
    if (b.status === 'importing' || b.status === 'imported')
      throw new DomainError('invalid_state', 'Already imported', { reason: 'already_imported' });
    if (b.status !== 'validated')
      throw new DomainError('invalid_state', 'Check the columns first', { reason: 'not_validated' });
    const now = new Date();
    if (expired(b, now)) throw new DomainError('invalid_state', 'Expired', { reason: 'expired' });
    const ids = await tx
      .select({ pid: importRows.plannedPartyId })
      .from(importRows)
      .where(
        and(eq(importRows.batchId, b.id), isNotNull(importRows.plannedPartyId), isNull(importRows.errorCode)),
      )
      .groupBy(importRows.plannedPartyId)
      .orderBy(sql`min(${importRows.rowNo})`);
    if (ids.length === 0)
      throw new DomainError('validation_failed', 'Nothing to import', { reason: 'nothing_to_import' });
    await tx
      .update(importBatches)
      .set({ status: 'importing', updatedAt: now })
      .where(eq(importBatches.id, b.id));
    return ids.map((i) => i.pid as string);
  },
  run: async (tx, ctx, ids) => {
    if (ids.length === 0) return { results: [] };
    const orgId = requireOrg(ctx);
    const [one] = await tx
      .select({ batchId: importRows.batchId })
      .from(importRows)
      .where(inArray(importRows.plannedPartyId, [...ids]))
      .limit(1);
    if (!one) return { results: ids.map((id) => ({ id, ok: false, code: 'not_found' })) };
    const [b] = await tx.select().from(importBatches).where(eq(importBatches.id, one.batchId));
    if (!b) return { results: ids.map((id) => ({ id, ok: false, code: 'not_found' })) };
    const done = new Set(
      (
        await tx
          .select({ id: parties.id })
          .from(parties)
          .where(inArray(parties.id, [...ids]))
      ).map((p) => p.id),
    );
    const rows = await mappedRowsTx(
      tx,
      orgId,
      b.mapping as GuestMapping,
      and(
        eq(importRows.batchId, b.id),
        inArray(importRows.plannedPartyId, [...ids]),
        isNull(importRows.errorCode),
        isNull(importRows.importedAt),
      ),
    );
    const byParty = new Map<string, typeof rows>();
    for (const r of rows) {
      const k = r.plannedPartyId as string;
      byParty.set(k, [...(byParty.get(k) ?? []), r]);
    }
    const ctxNow = await existingOf(tx, b.eventId);
    const names = [...ctxNow.existingPartyNames];
    let counts = { ...ctxNow.existing };
    const results: { id: string; ok: boolean; code?: string }[] = [];
    let createdParties = 0;
    let createdGuests = 0;
    for (const id of ids) {
      const mine = byParty.get(id) ?? [];
      if (done.has(id) || mine.length === 0) {
        // Created by an earlier run of this chunk (or nothing left to do).
        results.push(done.has(id) ? { id, ok: true } : { id, ok: false, code: 'not_found' });
        continue;
      }
      const g = groupGuestRows(mine, { existingPartyNames: names, existing: counts, limits: GROUP_LIMITS });
      const party = g.parties[0];
      if (!party || g.parties.length !== 1) {
        const code = [...g.rejected.values()].find((c) => c !== 'party_has_errors') ?? 'party_has_errors';
        await tx
          .update(importRows)
          .set({ errorCode: code, plannedPartyId: null, updatedAt: ctx.now })
          .where(
            inArray(
              importRows.id,
              mine.map((r) => r.id),
            ),
          );
        results.push({ id, ok: false, code });
        continue;
      }
      await createPartyTx(tx, ctx, b, id, party);
      names.push(party.name);
      counts = { parties: counts.parties + 1, guests: counts.guests + party.guests.length };
      createdParties += 1;
      createdGuests += party.guests.length;
      await tx
        .update(importRows)
        .set({ importedAt: ctx.now, cellsCiphertext: null, updatedAt: ctx.now })
        .where(
          inArray(
            importRows.id,
            mine.map((r) => r.id),
          ),
        );
      results.push({ id, ok: true });
    }
    const [left] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(importRows)
      .where(
        and(
          eq(importRows.batchId, b.id),
          isNotNull(importRows.plannedPartyId),
          isNull(importRows.errorCode),
          isNull(importRows.importedAt),
        ),
      );
    await tx
      .update(importBatches)
      .set({
        partiesImported: sql`${importBatches.partiesImported} + ${createdParties}`,
        guestsImported: sql`${importBatches.guestsImported} + ${createdGuests}`,
        ...((left?.n ?? 0) === 0 ? { status: 'imported', importedAt: ctx.now } : {}),
        updatedAt: ctx.now,
      })
      .where(eq(importBatches.id, b.id));
    return { results };
  },
});

export const guestImportBulk = bulkCommands(guestImportAction);

/** One planned party, whole: the party, its guests (sealed answers), plus-ones and history. */
async function createPartyTx(tx: TenantTx, ctx: Ctx, b: BatchRow, partyId: string, p: PlannedParty) {
  const orgId = requireOrg(ctx);
  await tx.insert(parties).values({
    id: partyId,
    orgId,
    eventId: b.eventId,
    name: p.name,
    side: p.side,
    vip: p.vip,
    tags: [...p.tags],
    source: 'import',
  });
  const ids = p.guests.map(() => uuidv7());
  const like: GuestLike[] = p.guests.map((g, i) => ({
    id: ids[i] as string,
    kind: g.kind,
    hostGuestId: g.host === null ? null : (ids[g.host] ?? null),
    firstName: g.firstName,
    lastName: g.lastName,
    ageClass: g.ageClass,
  }));
  const primary = nextPrimary(like);
  const sealed = await Promise.all(
    p.guests.map((g) =>
      seal(orgId, {
        dietary: g.dietary,
        accessibility: g.accessibility,
        address: g.address,
        email: g.email,
        phone: g.phone,
      }),
    ),
  );
  await tx.insert(guests).values(
    p.guests.map((g, i) => ({
      id: ids[i] as string,
      orgId,
      eventId: b.eventId,
      partyId,
      kind: g.kind,
      hostGuestId: like[i]?.hostGuestId ?? null,
      firstName: g.firstName,
      lastName: g.lastName,
      ageClass: g.ageClass,
      meal: g.meal,
      privateCiphertext: sealed[i] ?? null,
      isPrimary: ids[i] === primary,
    })),
  );
  const at = { eventId: b.eventId, partyId, source: 'import' as const };
  await recordHistoryTx(tx, ctx, [
    {
      ...at,
      action: 'party_created',
      fields: presentFields({ name: p.name, side: p.side, vip: p.vip, tags: p.tags }),
      detail: { batchId: b.id },
    },
    ...p.guests.map((g, i) => ({
      ...at,
      guestId: ids[i] as string,
      action: g.kind === 'plus_one' ? ('plus_one_added' as const) : ('guest_added' as const),
      fields: presentFields({
        firstName: g.firstName,
        lastName: g.lastName,
        ageClass: g.ageClass,
        meal: g.meal,
        dietary: g.dietary,
        accessibility: g.accessibility,
        address: g.address,
        email: g.email,
        phone: g.phone,
        isPrimary: ids[i] === primary,
      }),
      detail: (g.kind === 'plus_one'
        ? { batchId: b.id, hostGuestId: like[i]?.hostGuestId ?? '' }
        : { batchId: b.id }) as Record<string, string>,
    })),
  ]);
}

/* ------------------------------------------------------------------------------- purge ---- */

/**
 * The daily purge (worker retention pass, system actor): expired imports lose their sealed
 * header and every remaining row's cells. Counts only in the audit.
 */
export const purgeGuestImportsCommand = tenantCommand({
  name: 'guests.purgeImports',
  category: 'delete',
  input: z.object({}),
  output: z.object({ batches: z.int(), rows: z.int() }),
  entitlement: 'core',
  permission: 'platform:guests.purgeImports',
  handler: async ({ ctx, tx }) => purgeExpiredTx(tx, ctx.now),
  audit: (_input, r) => ({
    action: 'guests.import.purge',
    targetType: 'guest_import',
    targetId: null,
    data: { batches: r?.batches ?? 0, rows: r?.rows ?? 0 },
  }),
});
