import { normalizeEmail, upsertContactsTx } from '@yayatoh/crm';
import { CsvError, csvRow, parseCsv } from '@yayatoh/csv';
import type { TenantTx } from '@yayatoh/db';
import { DomainError, requireOrg, uuidv7 } from '@yayatoh/kernel';
import {
  bulkCommands,
  defineBulkAction,
  erasedAddressesTx,
  normalizeAddress,
  tenantCommand,
  tenantQuery,
} from '@yayatoh/platform';
import { and, asc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { Label, MAX_LABELS } from './attendees.ts';
import { emitAttendeesChangedTx } from './participation.ts';
import { attendees, IMPORT_FIELDS, type ImportField, importBatches, importRows } from './schema.ts';

export const IMPORT_ERROR_CODES = [
  'missing_email',
  'invalid_email',
  'invalid_label',
  'too_many_labels',
  'duplicate_in_file',
  'already_on_list',
  /** The address was erased at someone's request (M1.14e): it can't be added to a list again. */
  'erased',
] as const;
export type ImportErrorCode = (typeof IMPORT_ERROR_CODES)[number];

/** Pragmatic address check: one @, a dot in the domain, no spaces. Delivery proves the rest. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_BYTES = 5_000_000;
const HEADER_GUESSES: Record<ImportField, RegExp> = {
  name: /^(full[\s_-]?name|name|guest|attendee|nom|nombre|nome|naam|имя|名前|姓名)$/i,
  email: /e-?mail|courriel|correo|posta|почта|メール|邮箱|郵箱/i,
  labels: /^(labels?|tags?|groups?|table|étiquettes?|etiquetas?)$/i,
};

/** Best-effort column mapping from header names; the organizer confirms or changes it. */
export function guessMapping(headers: readonly string[]): Partial<Record<ImportField, number>> {
  const out: Partial<Record<ImportField, number>> = {};
  for (const f of IMPORT_FIELDS) {
    const i = headers.findIndex((h) => HEADER_GUESSES[f].test(h.trim()));
    if (i >= 0 && !Object.values(out).includes(i)) out[f] = i;
  }
  return out;
}

const splitLabels = (cell: string) =>
  cell
    .split(/[;|,]/)
    .map((l) => l.trim())
    .filter(Boolean);

type RowOut = { name: string; email: string; labels: string[]; error: ImportErrorCode | null };

/** Map one row's cells through the mapping and check it (duplicates are checked across rows). */
function mapRow(
  cells: readonly string[],
  m: Partial<Record<ImportField, number>>,
  extra: readonly string[],
): RowOut {
  const cell = (f: ImportField) => (m[f] === undefined ? '' : (cells[m[f]] ?? '').trim());
  const email = cell('email');
  const name = cell('name').replace(/\s+/g, ' ').slice(0, 200) || email.split('@')[0] || '';
  const raw = [...splitLabels(cell('labels')), ...extra];
  const labels: string[] = [];
  let error: ImportErrorCode | null = null;
  for (const l of raw) {
    const p = Label.safeParse(l);
    if (!p.success) error ??= 'invalid_label';
    else if (!labels.includes(p.data)) labels.push(p.data);
  }
  if (labels.length > MAX_LABELS) error ??= 'too_many_labels';
  if (!email) error = 'missing_email';
  else if (!EMAIL.test(email) || email.length > 254) error = 'invalid_email';
  return { name, email, labels, error };
}

async function loadBatch(tx: TenantTx, batchId: string, eventId?: string | null) {
  const [b] = await tx
    .select()
    .from(importBatches)
    .where(and(eq(importBatches.id, batchId), eventId ? eq(importBatches.eventId, eventId) : undefined));
  if (!b) throw new DomainError('not_found', 'Import not found');
  return b;
}

/**
 * Step 1: parse an uploaded CSV (≤5 MB, ≤20,000 rows, ≤50 columns) and stage its rows. Nothing
 * reaches the guest list until the organizer maps, validates and starts the import.
 */
export const stageImportCommand = tenantCommand({
  name: 'attendees.stageImport',
  input: z.object({
    eventId: z.uuid(),
    fileName: z.string().trim().min(1).max(200),
    csv: z.string().min(1).max(MAX_BYTES),
  }),
  output: z.object({ batchId: z.uuid(), rowCount: z.int(), headers: z.array(z.string()) }),
  entitlement: 'attendees',
  permission: 'attendees:write',
  handler: async ({ input, ctx, tx }) => {
    let parsed: ReturnType<typeof parseCsv>;
    try {
      parsed = parseCsv(input.csv);
    } catch (err) {
      if (err instanceof CsvError)
        throw new DomainError('validation_failed', 'The file is not a readable CSV', {
          reason: err.code,
          line: err.line,
        });
      throw err;
    }
    if (parsed.rows.length === 0)
      throw new DomainError('validation_failed', 'The file has no rows', { reason: 'empty' });
    const orgId = requireOrg(ctx);
    const [b] = await tx
      .insert(importBatches)
      .values({
        orgId,
        eventId: input.eventId,
        fileName: input.fileName,
        headers: [...parsed.headers],
        mapping: guessMapping(parsed.headers),
        rowCount: parsed.rows.length,
        uploadedBy: ctx.actor.type === 'user' ? ctx.actor.userId : null,
      })
      .returning({ id: importBatches.id });
    if (!b) throw new DomainError('internal');
    for (let i = 0; i < parsed.rows.length; i += 1_000)
      await tx.insert(importRows).values(
        parsed.rows.slice(i, i + 1_000).map((cells, j) => ({
          orgId,
          batchId: b.id,
          rowNo: i + j + 1,
          cells: [...cells],
        })),
      );
    return { batchId: b.id, rowCount: parsed.rows.length, headers: [...parsed.headers] };
  },
  audit: (input, r) => ({
    action: 'attendees.import.stage',
    targetType: 'event',
    targetId: input.eventId,
    data: { fileName: input.fileName, rows: r?.rowCount ?? 0 },
  }),
});

const Mapping = z
  .object({ name: z.int().min(0).optional(), email: z.int().min(0), labels: z.int().min(0).optional() })
  .refine((m) => new Set(Object.values(m)).size === Object.values(m).length, {
    message: 'Each column can map to one field',
  });

/**
 * Step 2: apply the mapping to every staged row and record why each bad row can't be imported
 * (invalid email, duplicate in the file, already on the guest list, …).
 */
export const validateImportCommand = tenantCommand({
  name: 'attendees.validateImport',
  input: z.object({
    eventId: z.uuid(),
    batchId: z.uuid(),
    mapping: Mapping,
    extraLabels: z.array(Label).max(5).default([]),
  }),
  output: z.object({ valid: z.int(), invalid: z.int() }),
  entitlement: 'attendees',
  permission: 'attendees:write',
  handler: async ({ input, ctx, tx }) => {
    const b = await loadBatch(tx, input.batchId, input.eventId);
    if (Object.values(input.mapping).some((i) => i >= b.headers.length))
      throw new DomainError('validation_failed', 'Unknown column', { field: 'mapping' });
    const imported = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(importRows)
      .where(and(eq(importRows.batchId, b.id), isNotNull(importRows.attendeeId)));
    if ((imported[0]?.n ?? 0) > 0) throw new DomainError('invalid_state', 'This file was already imported');
    const rows = await tx
      .select({ id: importRows.id, cells: importRows.cells })
      .from(importRows)
      .where(eq(importRows.batchId, b.id))
      .orderBy(asc(importRows.rowNo));
    const existing = new Set(
      (
        await tx
          .select({ email: sql<string>`lower(${attendees.email})` })
          .from(attendees)
          .where(and(eq(attendees.eventId, b.eventId), eq(attendees.status, 'active')))
      ).map((r) => r.email),
    );
    const mappedRows = rows.map((r) => ({ id: r.id, m: mapRow(r.cells, input.mapping, input.extraLabels) }));
    // The platform-wide erased-address list (M1.14e): an erased person can't be imported again.
    const erased = await erasedAddressesTx(
      tx,
      mappedRows.filter((r) => !r.m.error).map((r) => r.m.email),
    );
    const seen = new Set<string>();
    const codes: { id: string; code: string | null }[] = [];
    for (const { id, m } of mappedRows) {
      let code = m.error;
      const key = normalizeEmail(m.email);
      if (!code && erased.has(normalizeAddress(m.email))) code = 'erased';
      if (!code && seen.has(key)) code = 'duplicate_in_file';
      if (!code && existing.has(key)) code = 'already_on_list';
      if (!code) seen.add(key);
      codes.push({ id, code });
    }
    for (let i = 0; i < codes.length; i += 1_000) {
      const part = codes.slice(i, i + 1_000);
      await tx.execute(sql`
        update ${importRows} set error_code = v.code, updated_at = ${ctx.now.toISOString()}::timestamptz
        from (values ${sql.join(
          part.map((c) => sql`(${c.id}::uuid, ${c.code}::text)`),
          sql`, `,
        )}) as v(id, code)
        where ${importRows.id} = v.id`);
    }
    await tx
      .update(importBatches)
      .set({
        mapping: input.mapping,
        extraLabels: input.extraLabels,
        validatedAt: ctx.now,
        updatedAt: ctx.now,
      })
      .where(eq(importBatches.id, b.id));
    const invalid = codes.filter((c) => c.code).length;
    return { valid: codes.length - invalid, invalid };
  },
});

export const ImportSummaryDto = z.object({
  batchId: z.uuid(),
  fileName: z.string(),
  headers: z.array(z.string()),
  mapping: z.object({ name: z.int().optional(), email: z.int().optional(), labels: z.int().optional() }),
  extraLabels: z.array(z.string()),
  rowCount: z.int(),
  validated: z.boolean(),
  valid: z.int(),
  imported: z.int(),
  invalidByCode: z.record(z.string(), z.int()),
  /** The first rows as they will be imported (after mapping). */
  preview: z.array(
    z.object({
      rowNo: z.int(),
      name: z.string(),
      email: z.string(),
      labels: z.array(z.string()),
      errorCode: z.string().nullable(),
    }),
  ),
});

export const importSummaryQuery = tenantQuery({
  name: 'attendees.importSummary',
  input: z.object({ eventId: z.uuid(), batchId: z.uuid() }),
  output: ImportSummaryDto,
  entitlement: 'attendees',
  permission: 'attendees:write',
  handler: async ({ input, tx }) => {
    const b = await loadBatch(tx, input.batchId, input.eventId);
    const counts = await tx
      .select({
        code: importRows.errorCode,
        imported: sql<boolean>`${importRows.attendeeId} is not null`,
        n: sql<number>`count(*)::int`,
      })
      .from(importRows)
      .where(eq(importRows.batchId, b.id))
      .groupBy(importRows.errorCode, sql`${importRows.attendeeId} is not null`);
    const invalidByCode: Record<string, number> = {};
    let valid = 0;
    let imported = 0;
    for (const c of counts) {
      if (c.imported) imported += c.n;
      if (c.code) invalidByCode[c.code] = (invalidByCode[c.code] ?? 0) + c.n;
      else valid += c.n;
    }
    const first = await tx
      .select()
      .from(importRows)
      .where(eq(importRows.batchId, b.id))
      .orderBy(asc(importRows.rowNo))
      .limit(10);
    return {
      batchId: b.id,
      fileName: b.fileName,
      headers: b.headers,
      mapping: b.mapping,
      extraLabels: b.extraLabels,
      rowCount: b.rowCount,
      validated: b.validatedAt !== null,
      valid: b.validatedAt ? valid : 0,
      imported,
      invalidByCode: b.validatedAt ? invalidByCode : {},
      preview: first.map((r) => {
        const m = mapRow(r.cells, b.mapping, b.extraLabels);
        return { rowNo: r.rowNo, name: m.name, email: m.email, labels: m.labels, errorCode: r.errorCode };
      }),
    };
  },
});

/**
 * The rows that were not imported, as CSV: the organizer's own columns plus the reason, ready
 * to fix and upload again. Reason texts come from the caller's locale.
 */
export const importFailuresQuery = tenantQuery({
  name: 'attendees.importFailures',
  category: 'export',
  input: z.object({
    eventId: z.uuid(),
    batchId: z.uuid(),
    reasonHeader: z.string().trim().min(1).max(60),
    reasons: z.record(z.string(), z.string().max(200)),
  }),
  output: z.object({ fileName: z.string(), csv: z.string() }),
  entitlement: 'attendees',
  permission: 'attendees:write',
  handler: async ({ input, tx }) => {
    const b = await loadBatch(tx, input.batchId, input.eventId);
    const rows = await tx
      .select({ cells: importRows.cells, code: importRows.errorCode })
      .from(importRows)
      .where(and(eq(importRows.batchId, b.id), isNotNull(importRows.errorCode)))
      .orderBy(asc(importRows.rowNo));
    let csv = `﻿${csvRow([...b.headers, input.reasonHeader])}`;
    for (const r of rows) csv += csvRow([...r.cells, input.reasons[r.code ?? ''] ?? r.code]);
    return { fileName: `${b.fileName.replace(/\.csv$/i, '')}-not-imported.csv`, csv };
  },
});

const ImportFilter = z.object({ batchId: z.uuid() });

/**
 * Step 3: the import job. Each chunk creates (or reuses) contacts in one statement, then the
 * attendees (source `import`). A row whose email reached the guest list since validation fails
 * as `already_on_list`. Undo within 10 minutes removes the attendees this import created.
 */
export const attendeeImportAction = defineBulkAction({
  key: 'attendees.import',
  entitlement: 'attendees',
  permission: 'attendees:write',
  params: z.object({}),
  filter: ImportFilter,
  chunkSize: 500,
  undoWindowMs: 10 * 60_000,
  resolve: async (tx, sel) => {
    if (!sel.filter) throw new DomainError('validation_failed', 'An import file is required');
    const b = await loadBatch(tx, sel.filter.batchId, sel.eventId);
    if (!b.validatedAt) throw new DomainError('invalid_state', 'Check the column mapping first');
    const rows = await tx
      .select({ id: importRows.id })
      .from(importRows)
      .where(and(eq(importRows.batchId, b.id), isNull(importRows.errorCode), isNull(importRows.attendeeId)))
      .orderBy(asc(importRows.rowNo));
    return rows.map((r) => r.id);
  },
  run: async (tx, ctx, ids, _params, meta) => {
    if (ids.length === 0 || !meta.eventId) return { results: [] };
    const rows = await tx
      .select()
      .from(importRows)
      .where(inArray(importRows.id, [...ids]));
    const batchId = rows[0]?.batchId;
    if (!batchId) return { results: ids.map((id) => ({ id, ok: false, code: 'not_found' })) };
    const b = await loadBatch(tx, batchId, meta.eventId);
    const mapped = new Map(rows.map((r) => [r.id, mapRow(r.cells, b.mapping, b.extraLabels)]));
    const emails = [...mapped.values()].map((m) => normalizeEmail(m.email));
    const taken = new Set(
      (
        await tx
          .select({ email: sql<string>`lower(${attendees.email})` })
          .from(attendees)
          .where(
            and(
              eq(attendees.eventId, b.eventId),
              eq(attendees.status, 'active'),
              inArray(sql`lower(${attendees.email})`, emails),
            ),
          )
      ).map((r) => r.email),
    );
    // Erased since validation (M1.14e): skipped with that reason.
    const erased = await erasedAddressesTx(
      tx,
      [...mapped.values()].filter((m) => !m.error).map((m) => m.email),
    );
    const erasedRows = new Set(
      [...mapped].filter(([, m]) => !m.error && erased.has(normalizeAddress(m.email))).map(([id]) => id),
    );
    const go = [...mapped].filter(
      ([id, m]) => !m.error && !erasedRows.has(id) && !taken.has(normalizeEmail(m.email)),
    );
    const contactIds = await upsertContactsTx(
      tx,
      ctx,
      go.map(([, m]) => ({ email: m.email, name: m.name, source: 'import' as const })),
    );
    const orgId = requireOrg(ctx);
    // Ids are assigned here, so each staged row links to its own attendee without relying on
    // RETURNING order.
    const attendeeOf = new Map(go.map(([rowId]) => [rowId, uuidv7()]));
    if (go.length)
      await tx.insert(attendees).values(
        go.map(([rowId, m]) => ({
          id: attendeeOf.get(rowId) as string,
          orgId,
          eventId: b.eventId,
          contactId: contactIds.get(normalizeEmail(m.email)) as string,
          source: 'import',
          name: m.name,
          email: m.email.trim(),
          labels: m.labels,
        })),
      );
    await emitAttendeesChangedTx(
      tx,
      ctx,
      go.map(([, m]) => ({
        eventId: b.eventId,
        contactId: contactIds.get(normalizeEmail(m.email)) as string,
      })),
    );
    const failedRows = [...mapped]
      .filter(([id]) => !attendeeOf.has(id) && !erasedRows.has(id))
      .map(([id]) => id);
    if (erasedRows.size)
      await tx
        .update(importRows)
        .set({ errorCode: 'erased', updatedAt: ctx.now })
        .where(inArray(importRows.id, [...erasedRows]));
    if (attendeeOf.size)
      await tx.execute(sql`
        update ${importRows} set attendee_id = v.aid, updated_at = ${ctx.now.toISOString()}::timestamptz
        from (values ${sql.join(
          [...attendeeOf].map(([rid, aid]) => sql`(${rid}::uuid, ${aid}::uuid)`),
          sql`, `,
        )}) as v(rid, aid)
        where ${importRows.id} = v.rid`);
    if (failedRows.length)
      await tx
        .update(importRows)
        .set({ errorCode: 'already_on_list', updatedAt: ctx.now })
        .where(inArray(importRows.id, failedRows));
    return {
      results: ids.map((id) => {
        const aid = attendeeOf.get(id);
        if (aid) return { id, ok: true, undo: { attendeeId: aid } };
        if (erasedRows.has(id)) return { id, ok: false, code: 'erased' };
        return { id, ok: false, code: mapped.has(id) ? 'already_on_list' : 'not_found' };
      }),
    };
  },
  undo: async (tx, ctx, items) => {
    const ids = items.map((i) => z.object({ attendeeId: z.uuid() }).parse(i.undo).attendeeId);
    // Imported guests have no tickets; the row link clears itself (ON DELETE SET NULL).
    if (ids.length)
      await emitAttendeesChangedTx(
        tx,
        ctx,
        await tx
          .delete(attendees)
          .where(and(inArray(attendees.id, ids), eq(attendees.source, 'import')))
          .returning({ eventId: attendees.eventId, contactId: attendees.contactId }),
      );
  },
});

export const attendeeImportBulk = bulkCommands(attendeeImportAction);
