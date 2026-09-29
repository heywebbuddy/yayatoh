import { createHash } from 'node:crypto';
import { type TenantTx, withTenant } from '@yayatoh/db';
import { subjectResponsesTx } from '@yayatoh/forms';
import {
  type CommandPorts,
  createCtx,
  DomainError,
  executeCommand,
  executeQuery,
  requireOrg,
} from '@yayatoh/kernel';
import { type MediaStore, mediaStore, readVariant } from '@yayatoh/media';
import type { PdfRenderer } from '@yayatoh/pdf';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { organizationLogoTx } from '@yayatoh/tenancy';
import { type BadgeTicket, badgeTicketsTx } from '@yayatoh/ticketing';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { BadgeDesign } from './domain/design.ts';
import { type BadgeRow, badgeRow, companyOf, placedKinds } from './domain/row.ts';
import { BATCH_SORTS, sortBadges } from './domain/sort.ts';
import { signBatchLink, verifyBatchLink } from './link.ts';
import { badgesHtml } from './render.ts';
import {
  BATCH_STATUSES,
  type BatchStatus,
  batches,
  batchParts,
  templates,
  templateVersions,
} from './schema.ts';
import { assignmentsOfTx, eventOfTx } from './templates.ts';

/** Badges per render call (≈1 s in Gotenberg); a batch is a series of these, then one merge. */
export const CHUNK_SIZE = 100;
export const MAX_BATCH_BADGES = 20_000;
const FILE_TTL_MS = 7 * 24 * 3_600_000;

export const BatchDto = z.object({
  id: z.uuid(),
  eventId: z.uuid(),
  status: z.enum(BATCH_STATUSES),
  sort: z.enum(BATCH_SORTS),
  ticketTypeIds: z.array(z.uuid()),
  total: z.int(),
  processed: z.int(),
  skipped: z.int(),
  hasFile: z.boolean(),
  bytes: z.int().nullable(),
  errorCode: z.string().nullable(),
  createdAt: z.date(),
  finishedAt: z.date().nullable(),
  expiresAt: z.date(),
  expired: z.boolean(),
});
export type BatchDto = z.infer<typeof BatchDto>;

type BatchRow = typeof batches.$inferSelect;
const toDto = (b: BatchRow, now: Date): BatchDto =>
  BatchDto.parse({
    ...b,
    hasFile: b.fileKey !== null,
    expired: b.expiresAt <= now,
  });

const VersionMap = z.object({
  byType: z.record(z.string(), z.uuid()),
  fallback: z.uuid().nullable(),
});
type VersionMap = z.infer<typeof VersionMap>;

/** The version each ticket type prints with now: its assignment, else the event's default. */
async function currentVersionMapTx(tx: TenantTx, eventId: string): Promise<VersionMap> {
  const rows = await tx
    .select({ id: templates.id, isDefault: templates.isDefault, versionId: templateVersions.id })
    .from(templates)
    .innerJoin(
      templateVersions,
      and(
        eq(templateVersions.templateId, templates.id),
        eq(templateVersions.version, templates.currentVersion),
      ),
    )
    .where(eq(templates.eventId, eventId));
  const byTemplate = new Map(rows.map((r) => [r.id, r.versionId]));
  const byType: Record<string, string> = {};
  for (const a of await assignmentsOfTx(tx, eventId)) {
    const v = byTemplate.get(a.templateId);
    if (v) byType[a.ticketTypeId] = v;
  }
  return { byType, fallback: rows.find((r) => r.isDefault)?.versionId ?? null };
}

async function designsTx(tx: TenantTx, versionIds: readonly string[]): Promise<Map<string, BadgeDesign>> {
  const ids = [...new Set(versionIds)];
  if (ids.length === 0) return new Map();
  const rows = await tx
    .select({ id: templateVersions.id, design: templateVersions.design })
    .from(templateVersions)
    .where(inArray(templateVersions.id, ids));
  return new Map(rows.map((r) => [r.id, BadgeDesign.parse(r.design)]));
}

const versionFor = (map: VersionMap, ticketTypeId: string) => map.byType[ticketTypeId] ?? map.fallback;

/** Non-sensitive checkout answers per order (only read when a template maps a question). */
async function answersByOrderTx(tx: TenantTx, eventId: string, orderIds: readonly string[]) {
  if (orderIds.length === 0) return new Map<string, Record<string, unknown>>();
  const { responses } = await subjectResponsesTx(
    tx,
    { kind: 'checkout_questions', subjectType: 'event', subjectId: eventId },
    [...new Set(orderIds)],
  );
  return new Map(responses.map((r) => [r.respondentId, r.answers]));
}

/** Each ticket's badge row (allowlisted) and design, in `tickets` order. */
async function badgeRowsTx(
  tx: TenantTx,
  eventId: string,
  tickets: readonly BadgeTicket[],
  map: VersionMap,
): Promise<{ design: BadgeDesign; row: BadgeRow; company: string; ticket: BadgeTicket }[]> {
  const designs = await designsTx(
    tx,
    tickets.flatMap((t) => versionFor(map, t.ticketTypeId) ?? []),
  );
  const needsAnswers = [...designs.values()].some((d) => d.sources.company || d.sources.jobTitle);
  const answers = needsAnswers
    ? await answersByOrderTx(
        tx,
        eventId,
        tickets.map((t) => t.orderId),
      )
    : new Map<string, Record<string, unknown>>();
  return tickets.flatMap((t) => {
    const v = versionFor(map, t.ticketTypeId);
    const design = v ? designs.get(v) : undefined;
    if (!design) return [];
    const a = answers.get(t.orderId) ?? {};
    const row = badgeRow(design, {
      ticketId: t.id,
      ticketTypeId: t.ticketTypeId,
      typeName: t.typeName,
      holderName: t.holderName,
      code: t.code,
      answers: a,
    });
    return [{ design, row, company: companyOf(design, a), ticket: t }];
  });
}

/** The org logo as a data: URI (only when some design places a logo). */
async function logoTx(tx: TenantTx, orgId: string): Promise<{ dataUri: string; alt: string } | null> {
  const logo = await organizationLogoTx(tx, orgId);
  const m = logo
    ? /^\/media\/([0-9a-f-]{36})\/([0-9a-f-]{36})\/([0-9]{1,5}-[0-9a-f]{32}\.(png|jpg))$/.exec(logo.path)
    : null;
  if (!logo || !m || m[1] !== orgId) return null;
  const bytes = await readVariant(orgId, m[2] as string, m[3] as string);
  if (!bytes) return null;
  const mime = m[4] === 'png' ? 'image/png' : 'image/jpeg';
  return { dataUri: `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`, alt: logo.alt };
}

/** The QR's accessible name: the holder and pass (data, so no translation is needed). */
const qrLabel = (t: BadgeTicket) => `${t.holderName} · ${t.typeName}`;

async function renderInputTx(
  tx: TenantTx,
  orgId: string,
  eventName: string,
  locale: string,
  rows: Awaited<ReturnType<typeof badgeRowsTx>>,
): Promise<string> {
  const wantsLogo = rows.some((r) => placedKinds(r.design).has('logo'));
  return badgesHtml({
    lang: locale,
    title: eventName,
    logo: wantsLogo ? await logoTx(tx, orgId) : null,
    badges: rows.map((r) => ({ design: r.design, row: r.row, qrLabel: qrLabel(r.ticket) })),
  });
}

/* ---------------------------------------------------------------------------- organizer ---- */

export const startBatchCommand = tenantCommand({
  name: 'badges.startBatch',
  input: z.object({
    eventId: z.uuid(),
    /** One per "Create PDF" press: a retried request returns the same batch. */
    requestKey: z.string().trim().min(8).max(80),
    sort: z.enum(BATCH_SORTS),
    ticketTypeIds: z.array(z.uuid()).max(100).default([]),
    locale: z
      .string()
      .regex(/^[a-z]{2}(-[A-Z]{2})?$/)
      .default('en'),
  }),
  output: BatchDto,
  entitlement: 'badges',
  permission: 'attendees:export',
  // Names (and mapped answers) leave the platform in bulk: like every export.
  stepUp: true,
  category: 'export',
  handler: async ({ input, ctx, tx }) => {
    const [prior] = await tx.select().from(batches).where(eq(batches.requestKey, input.requestKey));
    if (prior) {
      if (prior.eventId !== input.eventId) throw new DomainError('conflict', 'Request key already used');
      return toDto(prior, ctx.now);
    }
    await eventOfTx(tx, input.eventId);
    const map = await currentVersionMapTx(tx, input.eventId);
    if (!map.fallback && Object.keys(map.byType).length === 0)
      throw new DomainError('invalid_state', 'Create a badge template first', { reason: 'no_template' });
    const tickets = await badgeTicketsTx(tx, { eventId: input.eventId, ticketTypeIds: input.ticketTypeIds });
    if (tickets.length > MAX_BATCH_BADGES)
      throw new DomainError('validation_failed', `At most ${MAX_BATCH_BADGES} badges per PDF`, {
        reason: 'too_many',
      });
    const rows = await badgeRowsTx(tx, input.eventId, tickets, map);
    if (rows.length === 0)
      throw new DomainError('invalid_state', 'No badges to print', { reason: 'nothing_to_print' });
    const sorted = sortBadges(
      rows.map((r) => ({
        id: r.ticket.id,
        holderName: r.ticket.holderName,
        company: r.company,
        serial: r.ticket.serial,
      })),
      input.sort,
      input.locale,
    );
    const [row] = await tx
      .insert(batches)
      .values({
        orgId: requireOrg(ctx),
        eventId: input.eventId,
        requestKey: input.requestKey,
        status: 'queued',
        sort: input.sort,
        locale: input.locale,
        ticketTypeIds: input.ticketTypeIds,
        ticketIds: sorted.map((s) => s.id),
        versionMap: map,
        total: sorted.length,
        skipped: tickets.length - rows.length,
        requestedBy: ctx.actor.type === 'user' ? ctx.actor.userId : null,
        expiresAt: new Date(ctx.now.getTime() + FILE_TTL_MS),
      })
      .returning();
    if (!row) throw new DomainError('internal');
    return toDto(row, ctx.now);
  },
  audit: (input, r) => ({
    action: 'badges.batch.start',
    targetType: 'event',
    targetId: input.eventId,
    data: { batchId: r.id, total: r.total, sort: input.sort, ticketTypeIds: input.ticketTypeIds },
  }),
});

export const cancelBatchCommand = tenantCommand({
  name: 'badges.cancelBatch',
  input: z.object({ eventId: z.uuid(), batchId: z.uuid() }),
  output: BatchDto,
  entitlement: 'badges',
  permission: 'attendees:export',
  handler: async ({ input, ctx, tx }) => {
    const [b] = await tx
      .select()
      .from(batches)
      .where(and(eq(batches.id, input.batchId), eq(batches.eventId, input.eventId)))
      .for('update');
    if (!b) throw new DomainError('not_found', 'Batch not found');
    if (b.status !== 'queued' && b.status !== 'running')
      throw new DomainError('invalid_state', 'This PDF is no longer being prepared', {
        reason: 'not_running',
      });
    await tx.delete(batchParts).where(eq(batchParts.batchId, b.id));
    const [row] = await tx
      .update(batches)
      .set({ status: 'cancelled', finishedAt: ctx.now, updatedAt: ctx.now })
      .where(eq(batches.id, b.id))
      .returning();
    if (!row) throw new DomainError('internal');
    return toDto(row, ctx.now);
  },
  audit: (input) => ({
    action: 'badges.batch.cancel',
    targetType: 'event',
    targetId: input.eventId,
    data: { batchId: input.batchId },
  }),
});

/** Recent batches of an event (the Badges page polls this for progress). */
export const listBatchesQuery = tenantQuery({
  name: 'badges.listBatches',
  input: z.object({ eventId: z.uuid(), limit: z.int().min(1).max(50).default(10) }),
  output: z.array(BatchDto),
  entitlement: 'badges',
  permission: 'events:read',
  handler: async ({ input, ctx, tx }) => {
    const rows = await tx
      .select()
      .from(batches)
      .where(eq(batches.eventId, input.eventId))
      .orderBy(desc(batches.createdAt))
      .limit(input.limit);
    return rows.map((r) => toDto(r, ctx.now));
  },
});

/** A signed, 15-minute download link to a finished batch PDF. */
export const batchLinkQuery = tenantQuery({
  name: 'badges.batchLink',
  input: z.object({ eventId: z.uuid(), batchId: z.uuid() }),
  output: z.object({ token: z.string(), expiresAt: z.date() }),
  entitlement: 'badges',
  permission: 'attendees:export',
  category: 'export',
  handler: async ({ input, ctx, tx }) => {
    const [b] = await tx
      .select()
      .from(batches)
      .where(and(eq(batches.id, input.batchId), eq(batches.eventId, input.eventId)));
    if (!b) throw new DomainError('not_found', 'Batch not found');
    if (b.status !== 'done' || !b.fileKey) throw new DomainError('invalid_state', 'Still being prepared');
    if (b.expiresAt <= ctx.now) throw new DomainError('not_found', 'File expired', { reason: 'expired' });
    return signBatchLink(requireOrg(ctx), b.id, ctx.now);
  },
});

/**
 * The file behind a download link (the web route serves it). Null for a forged, expired or
 * revoked link, a batch that is not done, or an expired file.
 */
export async function batchFileByLink(
  token: string,
  opts: { now?: Date; store?: MediaStore } = {},
): Promise<{ bytes: Uint8Array; eventId: string } | null> {
  const now = opts.now ?? new Date();
  const ref = verifyBatchLink(token, now);
  if (!ref) return null;
  const ctx = createCtx({ orgId: ref.orgId, actor: { type: 'system', name: 'badges.download' } });
  const [b] = await withTenant(ctx, (tx) =>
    tx
      .select({
        status: batches.status,
        fileKey: batches.fileKey,
        expiresAt: batches.expiresAt,
        eventId: batches.eventId,
      })
      .from(batches)
      .where(eq(batches.id, ref.batchId)),
  );
  if (!b || b.status !== 'done' || !b.fileKey || b.expiresAt <= now) return null;
  const bytes = await (opts.store ?? mediaStore()).get(ref.orgId, b.fileKey);
  return bytes ? { bytes, eventId: b.eventId } : null;
}

/* ------------------------------------------------------------------- one badge and preview ---- */

/** One badge (onsite reprint or a single print at the desk): the HTML for the PDF renderer. */
export const singleBadgeQuery = tenantQuery({
  name: 'badges.singleBadge',
  input: z.object({ eventId: z.uuid(), ticketId: z.uuid(), locale: z.string().max(10).default('en') }),
  output: z.object({ html: z.string(), holderName: z.string() }),
  entitlement: 'badges',
  permission: 'attendees:write',
  handler: async ({ input, ctx, tx }) => {
    const ev = await eventOfTx(tx, input.eventId);
    const tickets = await badgeTicketsTx(tx, { eventId: input.eventId, ticketIds: [input.ticketId] });
    const t = tickets[0];
    if (!t) throw new DomainError('not_found', 'Ticket not found');
    const rows = await badgeRowsTx(tx, input.eventId, tickets, await currentVersionMapTx(tx, input.eventId));
    if (rows.length === 0)
      throw new DomainError('invalid_state', 'Create a badge template first', { reason: 'no_template' });
    return {
      html: await renderInputTx(tx, requireOrg(ctx), ev.name, input.locale, rows),
      holderName: t.holderName,
    };
  },
});

/** The event's tickets for the one-badge picker (name and pass; no email). */
export const badgeTicketsQuery = tenantQuery({
  name: 'badges.tickets',
  input: z.object({ eventId: z.uuid(), q: z.string().trim().max(80).default('') }),
  output: z.array(z.object({ id: z.uuid(), holderName: z.string(), typeName: z.string(), serial: z.int() })),
  entitlement: 'badges',
  permission: 'attendees:write',
  handler: async ({ input, tx }) => {
    const q = input.q.toLocaleLowerCase();
    const all = await badgeTicketsTx(tx, { eventId: input.eventId });
    return all
      .filter((t) => !q || t.holderName.toLocaleLowerCase().includes(q) || String(t.serial) === q)
      .slice(0, 50)
      .map((t) => ({ id: t.id, holderName: t.holderName, typeName: t.typeName, serial: t.serial }));
  },
});

/* ------------------------------------------------------------------------------- worker ---- */

const CHUNK_PERMISSION = 'platform:badges.render';

/** What the runner does next for a batch. */
const NextChunk = z.discriminatedUnion('state', [
  z.object({ state: z.literal('stop'), status: z.enum(BATCH_STATUSES) }),
  z.object({ state: z.literal('render'), seq: z.int(), count: z.int(), html: z.string() }),
  z.object({ state: z.literal('merge'), parts: z.int() }),
]);

/** Read the next chunk to render (and mark a queued batch running). */
export const nextBatchChunkCommand = tenantCommand({
  name: 'badges.nextBatchChunk',
  input: z.object({ batchId: z.uuid() }),
  output: NextChunk,
  entitlement: 'badges',
  permission: CHUNK_PERMISSION,
  handler: async ({ input, ctx, tx }) => {
    const [b] = await tx.select().from(batches).where(eq(batches.id, input.batchId));
    if (!b) throw new DomainError('not_found', 'Batch not found');
    if (b.status !== 'queued' && b.status !== 'running')
      return { state: 'stop' as const, status: b.status as BatchStatus };
    if (b.status === 'queued')
      await tx.update(batches).set({ status: 'running', updatedAt: ctx.now }).where(eq(batches.id, b.id));
    if (b.processed >= b.total) return { state: 'merge' as const, parts: Math.ceil(b.total / CHUNK_SIZE) };
    const ids = b.ticketIds.slice(b.processed, b.processed + CHUNK_SIZE);
    const found = await badgeTicketsTx(tx, { eventId: b.eventId, ticketIds: ids });
    // Keep the batch order; a ticket voided since the start is left out.
    const byId = new Map(found.map((t) => [t.id, t]));
    const tickets = ids.flatMap((id) => byId.get(id) ?? []);
    const rows = await badgeRowsTx(tx, b.eventId, tickets, VersionMap.parse(b.versionMap));
    const ev = await eventOfTx(tx, b.eventId);
    return {
      state: 'render' as const,
      seq: b.processed / CHUNK_SIZE,
      count: ids.length,
      html: rows.length ? await renderInputTx(tx, b.orgId, ev.name, b.locale, rows) : '',
    };
  },
  audit: () => ({ action: 'badges.batch.chunk', targetType: 'badge_batch', targetId: null }),
});

/**
 * Store one rendered chunk. Idempotent: the part is keyed by (batch, seq) and progress only
 * moves when it is still at this chunk, so a retried job never double-counts.
 */
export const storeBatchChunkCommand = tenantCommand({
  name: 'badges.storeBatchChunk',
  input: z.object({
    batchId: z.uuid(),
    seq: z.int().min(0),
    count: z.int().min(1).max(CHUNK_SIZE),
    pdf: z.instanceof(Uint8Array),
  }),
  output: z.object({ processed: z.int(), stored: z.boolean() }),
  entitlement: 'badges',
  permission: CHUNK_PERMISSION,
  handler: async ({ input, ctx, tx }) => {
    const [b] = await tx.select().from(batches).where(eq(batches.id, input.batchId)).for('update');
    if (!b) throw new DomainError('not_found', 'Batch not found');
    if (b.status !== 'running' || b.processed !== input.seq * CHUNK_SIZE)
      return { processed: b.processed, stored: false };
    await tx
      .insert(batchParts)
      .values({ orgId: b.orgId, batchId: b.id, seq: input.seq, badges: input.count, pdf: input.pdf })
      .onConflictDoUpdate({
        target: [batchParts.orgId, batchParts.batchId, batchParts.seq],
        set: { pdf: input.pdf, badges: input.count, updatedAt: ctx.now },
      });
    const processed = Math.min(b.total, b.processed + input.count);
    await tx.update(batches).set({ processed, updatedAt: ctx.now }).where(eq(batches.id, b.id));
    return { processed, stored: true };
  },
  audit: (input) => ({
    action: 'badges.batch.chunk_stored',
    targetType: 'badge_batch',
    targetId: input.batchId,
    data: { seq: input.seq, count: input.count },
  }),
});

/** The rendered parts of a batch, in order (for the merge). */
export const batchPartsQuery = tenantQuery({
  name: 'badges.batchParts',
  input: z.object({ batchId: z.uuid() }),
  output: z.array(z.instanceof(Uint8Array)),
  entitlement: 'badges',
  permission: CHUNK_PERMISSION,
  handler: async ({ input, tx }) => {
    const rows = await tx
      .select({ pdf: batchParts.pdf, badges: batchParts.badges })
      .from(batchParts)
      .where(eq(batchParts.batchId, input.batchId))
      .orderBy(asc(batchParts.seq));
    return rows.map((r) => r.pdf);
  },
});

export const finishBatchCommand = tenantCommand({
  name: 'badges.finishBatch',
  input: z.object({ batchId: z.uuid(), fileKey: z.string().max(200), bytes: z.int().min(1) }),
  output: z.object({ status: z.enum(BATCH_STATUSES) }),
  entitlement: 'badges',
  permission: CHUNK_PERMISSION,
  handler: async ({ input, ctx, tx }) => {
    const [b] = await tx.select().from(batches).where(eq(batches.id, input.batchId)).for('update');
    if (!b) throw new DomainError('not_found', 'Batch not found');
    if (b.status !== 'running' || b.processed < b.total) return { status: b.status as BatchStatus };
    await tx
      .update(batches)
      .set({
        status: 'done',
        fileKey: input.fileKey,
        bytes: input.bytes,
        finishedAt: ctx.now,
        updatedAt: ctx.now,
      })
      .where(eq(batches.id, b.id));
    await tx.delete(batchParts).where(eq(batchParts.batchId, b.id));
    return { status: 'done' as const };
  },
  audit: (input) => ({
    action: 'badges.batch.finish',
    targetType: 'badge_batch',
    targetId: input.batchId,
    data: { bytes: input.bytes },
  }),
});

export const failBatchCommand = tenantCommand({
  name: 'badges.failBatch',
  input: z.object({ batchId: z.uuid(), code: z.string().max(60) }),
  output: z.object({ ok: z.boolean() }),
  entitlement: 'badges',
  permission: CHUNK_PERMISSION,
  handler: async ({ input, ctx, tx }) => {
    await tx
      .update(batches)
      .set({ status: 'failed', errorCode: input.code, finishedAt: ctx.now, updatedAt: ctx.now })
      .where(and(eq(batches.id, input.batchId), inArray(batches.status, ['queued', 'running'])));
    await tx.delete(batchParts).where(eq(batchParts.batchId, input.batchId));
    return { ok: true };
  },
});

/** Content-addressed key of a batch file in the media store. */
export function batchFileKey(orgId: string, batchId: string, bytes: Uint8Array): string {
  const sha = createHash('sha256').update(bytes).digest('hex').slice(0, 32);
  return `${orgId}/${batchId}/0-${sha}.pdf`;
}

export interface BatchRunDeps {
  readonly ports: CommandPorts<TenantTx>;
  readonly renderer: PdfRenderer;
  readonly store?: MediaStore;
}

export interface BatchSlice {
  readonly status: (typeof BATCH_STATUSES)[number];
  readonly chunks: number;
}

/**
 * Work a batch for up to `budgetMs` (the worker's `badges.batch` job, or the dev runner): chunk
 * by chunk (read in one transaction, render outside any transaction, store in another), then one
 * merge into the media store. Safe to run again at any point (retries, a crash, two runners): a
 * chunk is stored only while the batch is still at it, and the file key is content-addressed.
 * A render or merge error fails the batch after `maxAttempts` tries (the job retries before that).
 */
export async function runBadgeBatch(
  deps: BatchRunDeps,
  orgId: string,
  batchId: string,
  opts: { budgetMs?: number; maxChunks?: number; failOnError?: boolean } = {},
): Promise<BatchSlice> {
  const deadline = Date.now() + (opts.budgetMs ?? 60_000);
  const ctx = () => createCtx({ orgId, actor: { type: 'system', name: 'badges.batch' } });
  const store = deps.store ?? mediaStore();
  let chunks = 0;
  try {
    while (Date.now() < deadline && chunks < (opts.maxChunks ?? Number.POSITIVE_INFINITY)) {
      const next = await executeCommand(nextBatchChunkCommand, { batchId }, ctx(), deps.ports);
      if (next.state === 'stop') return { status: next.status, chunks };
      if (next.state === 'merge') {
        const parts = await executeQuery(batchPartsQuery, { batchId }, ctx(), deps.ports);
        const merged = await mergeParts(deps.renderer, parts);
        const fileKey = batchFileKey(orgId, batchId, merged);
        await store.put(orgId, fileKey, merged, 'application/pdf');
        const r = await executeCommand(
          finishBatchCommand,
          { batchId, fileKey, bytes: merged.byteLength },
          ctx(),
          deps.ports,
        );
        return { status: r.status, chunks };
      }
      const pdf = next.html ? await deps.renderer.render({ html: next.html }) : null;
      if (pdf)
        await executeCommand(
          storeBatchChunkCommand,
          { batchId, seq: next.seq, count: next.count, pdf },
          ctx(),
          deps.ports,
        );
      // Every ticket of this chunk was voided since the start: nothing to store.
      else
        await executeCommand(
          storeBatchChunkCommand,
          { batchId, seq: next.seq, count: next.count, pdf: EMPTY_PDF_MARKER },
          ctx(),
          deps.ports,
        );
      chunks += 1;
    }
  } catch (err) {
    if (opts.failOnError) {
      await executeCommand(
        failBatchCommand,
        { batchId, code: err instanceof DomainError ? err.code : 'render_failed' },
        ctx(),
        deps.ports,
      );
      return { status: 'failed', chunks };
    }
    throw err;
  }
  return { status: 'running', chunks };
}

/** A zero-length part: skipped by the merge (a chunk whose tickets were all voided). */
const EMPTY_PDF_MARKER = new Uint8Array(0);

async function mergeParts(renderer: PdfRenderer, parts: readonly Uint8Array[]): Promise<Uint8Array> {
  const real = parts.filter((p) => p.byteLength > 0);
  if (real.length === 1) return real[0] as Uint8Array;
  if (real.length === 0)
    throw new DomainError('invalid_state', 'Nothing rendered', { reason: 'nothing_to_print' });
  if (!renderer.merge) throw new Error('badges: the PDF renderer cannot merge');
  return renderer.merge(real);
}
