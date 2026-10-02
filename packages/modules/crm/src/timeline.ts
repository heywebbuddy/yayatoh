import type { TenantTx } from '@yayatoh/db';
import { type Ctx, requireOrg } from '@yayatoh/kernel';
import { and, desc, eq, inArray, lt, or, sql } from 'drizzle-orm';
import { type TIMELINE_KINDS, timelineEntries } from './schema.ts';

export type TimelineKind = (typeof TIMELINE_KINDS)[number];

/** One fact for the person timeline, as an owning module reports it (M6.1a). */
export interface TimelineFact {
  readonly contactId: string;
  readonly kind: TimelineKind;
  readonly occurredAt: Date;
  readonly eventId?: string | null;
  /** The fact's own id (order, refund, admission, recipient row…): `(kind, sourceRef)` is unique. */
  readonly sourceRef: string;
  /** The row that ties the fact to the person (`schema.table` + id), e.g. the order or attendee. */
  readonly subject?: { readonly table: string; readonly id: string } | null;
  readonly amountMinor?: number | null;
  readonly currency?: string | null;
  /** A short display label (a campaign's or survey's name); never personal data. */
  readonly label?: string | null;
}

/**
 * The active record for each contact id: a merged contact resolves to the record it was merged
 * into (following a chain of merges). Unknown ids are left out.
 */
export async function activeContactIdsTx(
  tx: TenantTx,
  contactIds: readonly string[],
): Promise<Map<string, string>> {
  const ids = [...new Set(contactIds)];
  if (ids.length === 0) return new Map();
  const rows = await tx.execute<{ start_id: string; id: string }>(sql`
    with recursive chain(start_id, id, merged_into, depth) as (
      select c.id, c.id, c.merged_into, 0 from crm.contacts c
      where c.id = any(ARRAY[${sql.join(
        ids.map((id) => sql`${id}`),
        sql`, `,
      )}]::uuid[])
      union all
      select ch.start_id, c.id, c.merged_into, ch.depth + 1
      from chain ch join crm.contacts c on c.id = ch.merged_into
      where ch.merged_into is not null and ch.depth < 20
    )
    select start_id, id from chain where merged_into is null`);
  return new Map(rows.map((r) => [r.start_id, r.id]));
}

/**
 * Record timeline facts (the owning modules' outbox subscribers, M6.1a). Exactly once per
 * `(kind, sourceRef)`: a replayed event changes nothing. A fact about a merged contact lands on
 * the record it was merged into. Returns how many rows were new.
 */
export async function recordTimelineTx(tx: TenantTx, ctx: Ctx, facts: readonly TimelineFact[]): Promise<number> {
  if (facts.length === 0) return 0;
  const orgId = requireOrg(ctx);
  const active = await activeContactIdsTx(
    tx,
    facts.map((f) => f.contactId),
  );
  const values = facts.flatMap((f) => {
    const contactId = active.get(f.contactId);
    if (!contactId) return [];
    return [
      {
        orgId,
        contactId,
        kind: f.kind,
        occurredAt: f.occurredAt,
        eventId: f.eventId ?? null,
        sourceRef: f.sourceRef,
        subjectTable: f.subject?.table ?? null,
        subjectRef: f.subject?.id ?? null,
        amountMinor: f.amountMinor ?? null,
        currency: f.amountMinor === null || f.amountMinor === undefined ? null : (f.currency ?? null),
        label: f.label ? f.label.slice(0, 200) : null,
      },
    ];
  });
  let n = 0;
  for (let i = 0; i < values.length; i += 1_000) {
    const rows = await tx
      .insert(timelineEntries)
      .values(values.slice(i, i + 1_000))
      .onConflictDoNothing()
      .returning({ id: timelineEntries.id });
    n += rows.length;
  }
  return n;
}

export interface TimelineCursor {
  readonly at: Date;
  readonly id: string;
}

export interface TimelineRow {
  readonly id: string;
  readonly kind: TimelineKind;
  readonly occurredAt: Date;
  readonly eventId: string | null;
  readonly amountMinor: number | null;
  readonly currency: string | null;
  readonly label: string | null;
}

/**
 * One page of a person's timeline, newest first (keyset on `(occurred_at, id)`), optionally only
 * some kinds or one event. Reads the projection only.
 */
export async function timelinePageTx(
  tx: TenantTx,
  input: {
    contactId: string;
    kinds?: readonly TimelineKind[] | undefined;
    eventId?: string | undefined;
    before?: TimelineCursor | undefined;
    limit: number;
  },
): Promise<{ rows: TimelineRow[]; next: TimelineCursor | null }> {
  const t = timelineEntries;
  const where = [eq(t.contactId, input.contactId)];
  if (input.kinds && input.kinds.length > 0) where.push(inArray(t.kind, [...input.kinds]));
  if (input.eventId) where.push(eq(t.eventId, input.eventId));
  if (input.before) {
    const b = input.before;
    const cond = or(lt(t.occurredAt, b.at), and(eq(t.occurredAt, b.at), lt(t.id, b.id)));
    if (cond) where.push(cond);
  }
  const rows = await tx
    .select({
      id: t.id,
      kind: t.kind,
      occurredAt: t.occurredAt,
      eventId: t.eventId,
      amountMinor: t.amountMinor,
      currency: t.currency,
      label: t.label,
    })
    .from(t)
    .where(and(...where))
    .orderBy(desc(t.occurredAt), desc(t.id))
    .limit(input.limit + 1);
  const page = rows.slice(0, input.limit) as TimelineRow[];
  const last = page.at(-1);
  return { rows: page, next: rows.length > input.limit && last ? { at: last.occurredAt, id: last.id } : null };
}

/** The events a person's timeline mentions (the event filter), most recent first. */
export async function timelineEventIdsTx(tx: TenantTx, contactId: string): Promise<string[]> {
  const rows = await tx
    .select({ eventId: timelineEntries.eventId, last: sql<Date>`max(${timelineEntries.occurredAt})` })
    .from(timelineEntries)
    .where(and(eq(timelineEntries.contactId, contactId), sql`${timelineEntries.eventId} is not null`))
    .groupBy(timelineEntries.eventId)
    .orderBy(sql`max(${timelineEntries.occurredAt}) desc`);
  return rows.map((r) => r.eventId as string);
}
