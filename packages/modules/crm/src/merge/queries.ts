import { defineSerializer } from '@yayatoh/contracts';
import { DomainError } from '@yayatoh/kernel';
import { tenantQuery } from '@yayatoh/platform';
import { and, desc, eq, inArray, lt, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { consentSummaryTx } from '../contacts.ts';
import {
  contactMerges,
  contacts,
  DUPLICATE_REASONS,
  DUPLICATE_STATUSES,
  duplicateCandidates,
  duplicateScans,
  MERGE_STATUSES,
  timelineEntries,
} from '../schema.ts';
import type { TenantTx } from '@yayatoh/db';
import { defaultChoices, defaultSurvivor } from './domain.ts';
import { MergeChoicesInput } from './commands.ts';

/** What the console shows of a contact (org members with `contacts:read`): an allowlist. */
export const ContactCardDto = z.object({
  id: z.uuid(),
  name: z.string().nullable(),
  email: z.string(),
  phone: z.string().nullable(),
  company: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type ContactCardDto = z.infer<typeof ContactCardDto>;

const cardColumns = {
  id: contacts.id,
  name: contacts.name,
  email: contacts.email,
  phone: contacts.phoneE164,
  company: contacts.company,
  createdAt: contacts.createdAt,
  updatedAt: contacts.updatedAt,
};

async function cardsTx(tx: TenantTx, ids: readonly string[]): Promise<Map<string, ContactCardDto>> {
  if (ids.length === 0) return new Map();
  const rows = await tx.select(cardColumns).from(contacts).where(inArray(contacts.id, [...new Set(ids)]));
  return new Map(rows.map((r) => [r.id, r]));
}

const CandidateDto = z.object({
  id: z.uuid(),
  score: z.int(),
  reasons: z.array(z.enum(DUPLICATE_REASONS)),
  nameSimilarity: z.int().nullable(),
  companySimilarity: z.int().nullable(),
  status: z.enum(DUPLICATE_STATUSES),
  detectedAt: z.date(),
  a: ContactCardDto,
  b: ContactCardDto,
});

export const DuplicateQueueDto = z.object({
  rows: z.array(CandidateDto),
  next: z.object({ score: z.int(), id: z.uuid() }).nullable(),
  open: z.int(),
  lastScanAt: z.date().nullable(),
});
export const duplicateQueueSerializer = defineSerializer('crm.duplicateQueue', DuplicateQueueDto);

/** The duplicates queue (M6.1a): highest confidence first, keyset paged. */
export const duplicateQueueQuery = tenantQuery({
  name: 'crm.duplicateQueue',
  input: z.object({
    status: z.enum(DUPLICATE_STATUSES).default('open'),
    limit: z.int().min(1).max(100).default(25),
    after: z.object({ score: z.int(), id: z.uuid() }).optional(),
  }),
  output: DuplicateQueueDto,
  entitlement: 'marketing',
  permission: 'contacts:read',
  handler: async ({ input, tx }) => {
    const d = duplicateCandidates;
    const where = [eq(d.status, input.status)];
    if (input.after) {
      const c = or(lt(d.score, input.after.score), and(eq(d.score, input.after.score), lt(d.id, input.after.id)));
      if (c) where.push(c);
    }
    const rows = await tx
      .select()
      .from(d)
      .where(and(...where))
      .orderBy(desc(d.score), desc(d.id))
      .limit(input.limit + 1);
    const page = rows.slice(0, input.limit);
    const cards = await cardsTx(
      tx,
      page.flatMap((r) => [r.contactAId, r.contactBId]),
    );
    const [open] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(d)
      .where(eq(d.status, 'open'));
    const [scan] = await tx.select({ at: duplicateScans.lastRunAt }).from(duplicateScans);
    const last = page.at(-1);
    return duplicateQueueSerializer.serialize({
      rows: page.flatMap((r) => {
        const a = cards.get(r.contactAId);
        const b = cards.get(r.contactBId);
        return a && b ? [{ ...r, reasons: r.reasons as (typeof DUPLICATE_REASONS)[number][], a, b }] : [];
      }),
      next: rows.length > input.limit && last ? { score: last.score, id: last.id } : null,
      open: open?.n ?? 0,
      lastScanAt: scan?.at ?? null,
    });
  },
});

const ConsentStatusDto = z.enum(['granted', 'withdrawn', 'unknown_legacy']).nullable();
const SideDto = ContactCardDto.extend({
  /** Current marketing consent per channel (null: none recorded, which means no consent). */
  emailConsent: ConsentStatusDto,
  smsConsent: ConsentStatusDto,
  timelineEntries: z.int(),
  live: z.boolean(),
});

export const DuplicatePairDto = z.object({
  id: z.uuid(),
  score: z.int(),
  reasons: z.array(z.enum(DUPLICATE_REASONS)),
  nameSimilarity: z.int().nullable(),
  companySimilarity: z.int().nullable(),
  status: z.enum(DUPLICATE_STATUSES),
  a: SideDto,
  b: SideDto,
  /** The record that stays by default (the older one) and the default choices for that way round. */
  defaultTargetId: z.uuid(),
  defaultChoices: MergeChoicesInput,
});
export const duplicatePairSerializer = defineSerializer('crm.duplicatePair', DuplicatePairDto);

/** One candidate side by side (the compare and merge screen, M6.1a). */
export const duplicatePairQuery = tenantQuery({
  name: 'crm.duplicatePair',
  input: z.object({ candidateId: z.uuid() }),
  output: DuplicatePairDto,
  entitlement: 'marketing',
  permission: 'contacts:read',
  handler: async ({ input, tx }) => {
    const [c] = await tx.select().from(duplicateCandidates).where(eq(duplicateCandidates.id, input.candidateId));
    if (!c) throw new DomainError('not_found');
    const rows = await tx
      .select({ ...cardColumns, mergedInto: contacts.mergedInto, emailNorm: contacts.emailNorm })
      .from(contacts)
      .where(inArray(contacts.id, [c.contactAId, c.contactBId]));
    const counts = await tx
      .select({ contactId: timelineEntries.contactId, n: sql<number>`count(*)::int` })
      .from(timelineEntries)
      .where(inArray(timelineEntries.contactId, [c.contactAId, c.contactBId]))
      .groupBy(timelineEntries.contactId);
    const side = async (id: string) => {
      const r = rows.find((x) => x.id === id);
      if (!r) throw new DomainError('not_found');
      const consent = await consentSummaryTx(tx, id);
      return {
        ...r,
        emailConsent: consent.get('email:marketing')?.status ?? null,
        smsConsent: consent.get('sms:marketing')?.status ?? null,
        timelineEntries: counts.find((x) => x.contactId === id)?.n ?? 0,
        live: r.mergedInto === null && !r.emailNorm.endsWith('@erased.invalid'),
      };
    };
    const a = await side(c.contactAId);
    const b = await side(c.contactBId);
    const { keep, merge } = defaultSurvivor(a, b);
    return duplicatePairSerializer.serialize({
      ...c,
      reasons: c.reasons as (typeof DUPLICATE_REASONS)[number][],
      a,
      b,
      defaultTargetId: keep.id,
      defaultChoices: defaultChoices(
        { ...merge, phoneE164: merge.phone },
        { ...keep, phoneE164: keep.phone },
      ),
    });
  },
});

export const PeoplePageDto = z.object({
  rows: z.array(ContactCardDto),
  next: z.object({ at: z.date(), id: z.uuid() }).nullable(),
});
export const peoplePageSerializer = defineSerializer('crm.peoplePage', PeoplePageDto);

/** People (M6.1a): the org's live contacts, newest first, optionally matching a name or email. */
export const peopleQuery = tenantQuery({
  name: 'crm.people',
  input: z.object({
    q: z.string().trim().max(200).optional(),
    limit: z.int().min(1).max(100).default(25),
    after: z.object({ at: z.date(), id: z.uuid() }).optional(),
  }),
  output: PeoplePageDto,
  entitlement: 'marketing',
  permission: 'contacts:read',
  handler: async ({ input, tx }) => {
    const where = [sql`${contacts.mergedInto} is null`, sql`${contacts.emailNorm} not like '%@erased.invalid'`];
    const q = input.q?.toLowerCase();
    if (q)
      where.push(
        sql`(position(${q} in lower(${contacts.email})) > 0 or position(${q} in lower(coalesce(${contacts.name}, ''))) > 0 or position(${q} in lower(coalesce(${contacts.company}, ''))) > 0)`,
      );
    if (input.after) {
      const c = or(
        lt(contacts.createdAt, input.after.at),
        and(eq(contacts.createdAt, input.after.at), lt(contacts.id, input.after.id)),
      );
      if (c) where.push(c);
    }
    const rows = await tx
      .select(cardColumns)
      .from(contacts)
      .where(and(...where))
      .orderBy(desc(contacts.createdAt), desc(contacts.id))
      .limit(input.limit + 1);
    const page = rows.slice(0, input.limit);
    const last = page.at(-1);
    return peoplePageSerializer.serialize({
      rows: page,
      next: rows.length > input.limit && last ? { at: last.createdAt, id: last.id } : null,
    });
  },
});

const MergeSummaryDto = z.object({
  id: z.uuid(),
  status: z.enum(MERGE_STATUSES),
  mergedAt: z.date(),
  undoUntil: z.date(),
  undoneAt: z.date().nullable(),
  /** Whether an undo can be attempted now (applied, inside the window, snapshot kept). */
  canUndo: z.boolean(),
  /** The merged-away record as it was (null once erased). */
  source: z.object({ id: z.uuid(), name: z.string().nullable(), email: z.string() }).nullable(),
  moved: z.int(),
  kept: z.int(),
});

export const PersonDto = z.object({
  contact: ContactCardDto,
  /** Set when this record was merged into another one (open that one instead). */
  mergedInto: z.uuid().nullable(),
  erased: z.boolean(),
  merges: z.array(MergeSummaryDto),
});
export const personSerializer = defineSerializer('crm.person', PersonDto);

const sum = (v: unknown) =>
  v && typeof v === 'object' ? Object.values(v as Record<string, number>).reduce((a, b) => a + Number(b), 0) : 0;

/** One person (M6.1a): their record and the merges into it (newest first, undo state). */
export const personQuery = tenantQuery({
  name: 'crm.person',
  input: z.object({ contactId: z.uuid() }),
  output: PersonDto,
  entitlement: 'marketing',
  permission: 'contacts:read',
  handler: async ({ input, ctx, tx }) => {
    const [c] = await tx
      .select({ ...cardColumns, mergedInto: contacts.mergedInto, emailNorm: contacts.emailNorm })
      .from(contacts)
      .where(eq(contacts.id, input.contactId));
    if (!c) throw new DomainError('not_found');
    const merges = await tx
      .select()
      .from(contactMerges)
      .where(eq(contactMerges.targetContactId, input.contactId))
      .orderBy(desc(contactMerges.mergedAt), desc(contactMerges.id))
      .limit(50);
    return personSerializer.serialize({
      contact: c,
      mergedInto: c.mergedInto,
      erased: c.emailNorm.endsWith('@erased.invalid'),
      merges: merges.map((m) => {
        const snap = m.snapshot as { source?: { name: string | null; email: string } } | null;
        const s = (m.summary ?? {}) as { moved?: unknown; kept?: unknown };
        return {
          id: m.id,
          status: m.status as (typeof MERGE_STATUSES)[number],
          mergedAt: m.mergedAt,
          undoUntil: m.undoUntil,
          undoneAt: m.undoneAt,
          canUndo: m.status === 'applied' && ctx.now <= m.undoUntil && snap !== null && c.mergedInto === null,
          source: snap?.source ? { id: m.sourceContactId, name: snap.source.name, email: snap.source.email } : null,
          moved: sum(s.moved),
          kept: sum(s.kept),
        };
      }),
    });
  },
});
