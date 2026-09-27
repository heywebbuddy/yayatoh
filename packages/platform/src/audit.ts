import { csvRow } from '@yayatoh/csv';
import type { TenantTx } from '@yayatoh/db';
import { DomainError } from '@yayatoh/kernel';
import { and, desc, eq, gte, inArray, lt, type SQL, sql } from 'drizzle-orm';
import { z } from 'zod';
import { bulkCommands, defineBulkAction, MAX_BULK_ITEMS } from './bulk.ts';
import { tenantQuery } from './commands/define.ts';
import { auditEvents } from './schema.ts';

/**
 * The org-facing audit view (M1.14b): who did what, when, to what. Owner/admin only
 * (`audit:read`). Output is an allowlist: the raw `data` column is never returned; only scalar
 * details under known keys are (no emails, names, tokens or free text).
 */

export const AUDIT_DETAIL_KEYS = [
  'role',
  'status',
  'kind',
  'total',
  'count',
  'currency',
  'amountMinor',
  'action',
  'eventId',
  'ticketTypeId',
  'orderId',
  'reason',
] as const;

const Detail = z.union([z.string().max(80), z.number(), z.boolean()]);

export const AuditEntryDto = z.object({
  id: z.uuid(),
  seq: z.int(),
  at: z.date(),
  /** `user:<id>`, `system:<name>`, `api_key:<id>` or `anonymous`. */
  actor: z.string(),
  action: z.string(),
  targetType: z.string(),
  targetId: z.string().nullable(),
  details: z.record(z.string(), Detail),
});
export type AuditEntryDto = z.infer<typeof AuditEntryDto>;

const REASON_CODE = /^[a-z][a-z0-9_]{0,39}$/;

/** Scalar details under allowlisted keys; `reason` only as a machine code, never free text. */
export function auditDetails(data: unknown): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!data || typeof data !== 'object' || Array.isArray(data)) return out;
  for (const key of AUDIT_DETAIL_KEYS) {
    const v = (data as Record<string, unknown>)[key];
    if (typeof v === 'number' && Number.isFinite(v)) out[key] = v;
    else if (typeof v === 'boolean') out[key] = v;
    else if (typeof v === 'string' && v.length <= 80 && !v.includes('@')) {
      if (key === 'reason' && !REASON_CODE.test(v)) continue;
      out[key] = v;
    }
  }
  return out;
}

export const AuditFilter = z.object({
  actor: z.string().max(120).optional(),
  action: z.string().max(80).optional(),
  /** Instants (the caller turns org-timezone days into them). `to` is exclusive. */
  from: z.date().optional(),
  to: z.date().optional(),
});
export type AuditFilter = z.infer<typeof AuditFilter>;

function where(f: AuditFilter): SQL | undefined {
  const parts: SQL[] = [];
  if (f.actor) parts.push(eq(auditEvents.actor, f.actor));
  if (f.action) parts.push(eq(auditEvents.action, f.action));
  if (f.from) parts.push(gte(auditEvents.createdAt, f.from));
  if (f.to) parts.push(lt(auditEvents.createdAt, f.to));
  return parts.length ? and(...parts) : undefined;
}

type Row = typeof auditEvents.$inferSelect;
const toDto = (r: Row): AuditEntryDto => ({
  id: r.id,
  seq: r.seq,
  at: r.createdAt,
  actor: r.actor,
  action: r.action,
  targetType: r.targetType,
  targetId: r.targetId,
  details: auditDetails(r.data),
});

/** Newest first, keyset-paged by `seq` (stable while entries are appended). */
export async function auditEntriesTx(
  tx: TenantTx,
  filter: AuditFilter,
  page: { before?: number; limit: number },
): Promise<{ entries: AuditEntryDto[]; nextBefore: number | null }> {
  const cond = and(where(filter), page.before ? lt(auditEvents.seq, page.before) : undefined);
  const rows = await tx
    .select()
    .from(auditEvents)
    .where(cond)
    .orderBy(desc(auditEvents.seq))
    .limit(page.limit + 1);
  const more = rows.length > page.limit;
  const entries = rows.slice(0, page.limit).map(toDto);
  return { entries, nextBefore: more ? (entries.at(-1)?.seq ?? null) : null };
}

export interface AuditChainStatus {
  readonly verified: boolean;
  readonly entries: number;
  /** The first entry whose hash, link or number does not check out. */
  readonly brokenAt: number | null;
  /** The chain head (what an external anchor would record). */
  readonly head: string | null;
}

/**
 * Recompute every entry's hash in the database (`platform.audit_hash`, the trigger's own
 * function) and check each link and the gap-free numbering. Detects edits, deletions and
 * re-orderings inside the chain; truncating the newest entries needs an external anchor of the
 * head (WORM storage, owner inbox).
 */
export async function verifyAuditChainTx(tx: TenantTx): Promise<AuditChainStatus> {
  const [row] = await tx.execute<{ entries: number; broken_at: number | null; head: string | null }>(sql`
    with chain as (
      select seq, hash, prev_hash,
        platform.audit_hash(prev_hash, org_id, seq, actor, action, target_type, target_id, data, request_id, created_at) as expected,
        lag(hash) over (order by seq) as lag_hash,
        lag(seq) over (order by seq) as lag_seq
      from platform.audit_events
    )
    select
      (select count(*)::int from chain) as entries,
      (select min(seq)::int from chain
        where hash <> expected or prev_hash <> coalesce(lag_hash, '') or seq <> coalesce(lag_seq, 0) + 1) as broken_at,
      (select hash from chain order by seq desc limit 1) as head
  `);
  const entries = row?.entries ?? 0;
  const brokenAt = row?.broken_at ?? null;
  return { verified: brokenAt === null, entries, brokenAt, head: row?.head ?? null };
}

const PageInput = z.object({
  filter: AuditFilter.default({}),
  before: z.int().positive().optional(),
  limit: z.int().min(1).max(100).default(25),
});

export const AuditPageDto = z.object({
  entries: z.array(AuditEntryDto),
  nextBefore: z.int().nullable(),
  /** Distinct actors and actions in the org's log, for the filter menus. */
  actors: z.array(z.string()),
  actions: z.array(z.string()),
  chain: z.object({
    verified: z.boolean(),
    entries: z.int(),
    brokenAt: z.int().nullable(),
    head: z.string().nullable(),
  }),
});
export type AuditPageDto = z.infer<typeof AuditPageDto>;

/** Settings → Activity: a page of entries, the filter options and the chain check. */
export const auditLogQuery = tenantQuery({
  name: 'platform.auditLog',
  input: PageInput,
  output: AuditPageDto,
  entitlement: 'core',
  permission: 'audit:read',
  handler: async ({ input, tx }) => {
    const page = await auditEntriesTx(tx, input.filter, { before: input.before, limit: input.limit });
    const actors = await tx
      .selectDistinct({ v: auditEvents.actor })
      .from(auditEvents)
      .orderBy(auditEvents.actor)
      .limit(500);
    const actions = await tx
      .selectDistinct({ v: auditEvents.action })
      .from(auditEvents)
      .orderBy(auditEvents.action)
      .limit(500);
    return {
      ...page,
      actors: actors.map((a) => a.v),
      actions: actions.map((a) => a.v),
      chain: await verifyAuditChainTx(tx),
    };
  },
});

export const AUDIT_EXPORT_COLUMNS = [
  'seq',
  'at',
  'actor',
  'action',
  'targetType',
  'targetId',
  'details',
] as const;

const Text = z.string().trim().min(1).max(60);
const AuditExportParams = z.object({
  headers: z.object(
    Object.fromEntries(AUDIT_EXPORT_COLUMNS.map((c) => [c, Text])) as Record<
      (typeof AUDIT_EXPORT_COLUMNS)[number],
      typeof Text
    >,
  ),
  /** The org's timezone: times are written as `YYYY-MM-DD HH:mm:ss` there. */
  timeZone: z.string().min(1).max(64),
  /** Display names for `user:<id>` actors (from the requester's member list). */
  actorNames: z.record(z.string().max(120), z.string().max(200)).default({}),
});

const AuditExportFilter = z.object({
  actor: z.string().max(120).optional(),
  action: z.string().max(80).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

function stamp(d: Date, timeZone: string): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

/**
 * The Activity CSV (M1.14b) through the bulk framework: the entries the current filters match,
 * oldest first, allowlisted columns, CSV-injection safe (csvRow), times in the org timezone.
 */
export const auditExportAction = defineBulkAction({
  key: 'platform.auditCsv',
  entitlement: 'core',
  permission: 'audit:read',
  params: AuditExportParams,
  filter: AuditExportFilter,
  chunkSize: 2_000,
  file: {
    contentType: 'text/csv; charset=utf-8',
    name: (_p, now) => `activity-${now.toISOString().slice(0, 10)}.csv`,
  },
  resolve: async (tx, sel) => {
    if (sel.ids) throw new DomainError('validation_failed', 'Export activity by filter');
    const rows = await tx
      .select({ id: auditEvents.id })
      .from(auditEvents)
      .where(where(sel.filter ?? {}))
      .orderBy(auditEvents.seq)
      .limit(MAX_BULK_ITEMS + 1);
    return rows.map((r) => r.id);
  },
  run: async (tx, _ctx, ids, params, meta) => {
    const rows = await tx
      .select()
      .from(auditEvents)
      .where(inArray(auditEvents.id, [...ids]));
    const byId = new Map(rows.map((r) => [r.id, r]));
    let out = meta.first ? `﻿${csvRow(AUDIT_EXPORT_COLUMNS.map((c) => params.headers[c]))}` : '';
    const results = [];
    for (const id of ids) {
      const r = byId.get(id);
      if (!r) {
        results.push({ id, ok: false, code: 'not_found' });
        continue;
      }
      const d = toDto(r);
      out += csvRow([
        d.seq,
        stamp(d.at, params.timeZone),
        params.actorNames[d.actor] ?? d.actor,
        d.action,
        d.targetType,
        d.targetId,
        Object.entries(d.details)
          .map(([k, v]) => `${k}=${v}`)
          .join('; '),
      ]);
      results.push({ id, ok: true });
    }
    return { results, append: out };
  },
});

export const auditExportBulk = bulkCommands(auditExportAction);
