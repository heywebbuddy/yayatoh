import type { TenantTx } from '@yayatoh/db';
import { actorId, type Ctx, DomainError, type DomainEvent, requireOrg, uuidv7 } from '@yayatoh/kernel';
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { consentSummaryTx } from '../contacts.ts';
import { refreshContactProfilesTx } from '../projection.ts';
import {
  CONSENT_CHANNELS,
  CONSENT_PURPOSES,
  consents,
  contactMergeMoves,
  contactMerges,
  contacts,
  duplicateCandidates,
  timelineEntries,
} from '../schema.ts';
import {
  defaultChoices,
  type MergeChoices,
  type MergeRecord,
  mergedFields,
  strictestConsent,
  UNDO_WINDOW_MS,
} from './domain.ts';
import { contactReferenceOwners, type MovedRow, uncoveredContactColumnsTx } from './owners.ts';

/** A contact's fields as the merge snapshot keeps them (exact undo). */
export interface ContactSnapshot {
  readonly email: string;
  readonly emailNorm: string;
  readonly name: string | null;
  readonly phoneE164: string | null;
  readonly company: string | null;
  readonly userId: string | null;
  readonly updatedAt: string;
}

interface Snapshot {
  readonly source: ContactSnapshot;
  readonly target: ContactSnapshot;
}

const TIMELINE_TABLE = 'crm.timeline_entries';
const isErased = (emailNorm: string) => emailNorm.endsWith('@erased.invalid');
/** A unique, check-passing placeholder while two records swap emails inside one transaction. */
const swapPlaceholder = (id: string) => `merging+${id}@merging.invalid`;

type ContactRow = typeof contacts.$inferSelect;

async function lockContactsTx(tx: TenantTx, ids: readonly string[]): Promise<Map<string, ContactRow>> {
  // Lock in id order: two merges touching the same records never deadlock.
  const rows = await tx
    .select()
    .from(contacts)
    .where(inArray(contacts.id, [...ids]))
    .orderBy(contacts.id)
    .for('update');
  return new Map(rows.map((r) => [r.id, r]));
}

const snap = (c: ContactRow): ContactSnapshot => ({
  email: c.email,
  emailNorm: c.emailNorm,
  name: c.name,
  phoneE164: c.phoneE164,
  company: c.company,
  userId: c.userId,
  updatedAt: c.updatedAt.toISOString(),
});

const asRecord = (c: ContactRow): MergeRecord => ({
  email: c.email,
  name: c.name,
  phoneE164: c.phoneE164,
  company: c.company,
  createdAt: c.createdAt,
  updatedAt: c.updatedAt,
});

async function recordMovesTx(
  tx: TenantTx,
  ctx: Ctx,
  mergeId: string,
  module: string,
  rows: readonly MovedRow[],
): Promise<void> {
  const orgId = requireOrg(ctx);
  for (let i = 0; i < rows.length; i += 1_000) {
    await tx
      .insert(contactMergeMoves)
      .values(
        rows.slice(i, i + 1_000).map((r) => ({ orgId, mergeId, module, refTable: r.table, rowId: r.id })),
      )
      .onConflictDoNothing();
  }
}

export interface MergeInput {
  readonly sourceContactId: string;
  readonly targetContactId: string;
  /** Field by field; default: the most recent non-empty value. */
  readonly choices?: MergeChoices | undefined;
  readonly bulkId?: string | null | undefined;
}

export interface MergeResult {
  readonly mergeId: string;
  readonly sourceContactId: string;
  readonly targetContactId: string;
  readonly moved: Readonly<Record<string, number>>;
  readonly kept: Readonly<Record<string, number>>;
}

/**
 * Merge a duplicate into the record that stays (M6.1a), in the caller's transaction:
 * 1. both records are locked and must be live (not merged away, not erased);
 * 2. the merge refuses while any contact column in the database has no registered owner;
 * 3. the target takes the chosen fields (an email chosen from the duplicate is swapped, so both
 *    addresses keep resolving to the person), the duplicate is marked `merged_into`;
 * 4. consent is merged by the strictest rule (an opt-out wins), as new ledger rows on the target;
 * 5. timeline entries and every owning module's references move, each recorded once;
 * 6. profiles are rebuilt, the pair's candidates are closed, `crm.contacts_merged@1` is emitted.
 */
export async function mergeContactsTx(
  tx: TenantTx,
  ctx: Ctx,
  input: MergeInput,
  emit: (event: DomainEvent) => void,
): Promise<MergeResult> {
  const orgId = requireOrg(ctx);
  const { sourceContactId: sourceId, targetContactId: targetId } = input;
  if (sourceId === targetId) throw new DomainError('validation_failed', 'A record cannot merge into itself');
  const locked = await lockContactsTx(tx, [sourceId, targetId]);
  const source = locked.get(sourceId);
  const target = locked.get(targetId);
  if (!source || !target) throw new DomainError('not_found');
  if (source.mergedInto || target.mergedInto)
    throw new DomainError('invalid_state', 'Already merged', { reason: 'already_merged' });
  if (isErased(source.emailNorm) || isErased(target.emailNorm))
    throw new DomainError('invalid_state', 'An erased record cannot be merged', { reason: 'erased' });
  const uncovered = await uncoveredContactColumnsTx(tx);
  if (uncovered.length > 0)
    throw new DomainError('invalid_state', 'Merging is not available', {
      reason: 'owners_missing',
      columns: uncovered,
    });

  const choices = input.choices ?? defaultChoices(asRecord(source), asRecord(target));
  const mergeId = uuidv7();
  const snapshot: Snapshot = { source: snap(source), target: snap(target) };
  await tx.insert(contactMerges).values({
    id: mergeId,
    orgId,
    sourceContactId: sourceId,
    targetContactId: targetId,
    status: 'applied',
    choices,
    snapshot,
    bulkId: input.bulkId ?? null,
    mergedBy: actorId(ctx.actor),
    mergedAt: ctx.now,
    undoUntil: new Date(ctx.now.getTime() + UNDO_WINDOW_MS),
  });

  // 3. Fields. Swapping emails goes through a placeholder (email_norm is unique per org).
  const fields = mergedFields(asRecord(source), asRecord(target), choices);
  const takeEmail = choices.email === 'source';
  const userId = target.userId ?? source.userId;
  if (takeEmail) {
    const p = swapPlaceholder(sourceId);
    await tx.update(contacts).set({ email: p, emailNorm: p }).where(eq(contacts.id, sourceId));
  }
  await tx
    .update(contacts)
    .set({
      ...(takeEmail ? { email: source.email, emailNorm: source.emailNorm } : {}),
      name: fields.name,
      phoneE164: fields.phoneE164,
      company: fields.company,
      userId,
      updatedAt: ctx.now,
    })
    .where(eq(contacts.id, targetId));
  await tx
    .update(contacts)
    .set({
      ...(takeEmail ? { email: target.email, emailNorm: target.emailNorm } : {}),
      // One account link per person: the target took the duplicate's, if it had none.
      userId: target.userId === null ? null : source.userId,
      mergedInto: targetId,
      updatedAt: ctx.now,
    })
    .where(eq(contacts.id, sourceId));

  // 4. Consent: the strictest current status per (channel, purpose); new rows on the target only.
  const [mine, theirs] = [await consentSummaryTx(tx, targetId), await consentSummaryTx(tx, sourceId)];
  const consentRowIds: string[] = [];
  for (const channel of CONSENT_CHANNELS)
    for (const purpose of CONSENT_PURPOSES) {
      const key = `${channel}:${purpose}`;
      const t = mine.get(key);
      const s = theirs.get(key);
      const merged = strictestConsent(t?.status ?? null, s?.status ?? null);
      if (merged.from !== 'source' || !s || merged.status === (t?.status ?? null)) continue;
      const [version] = await tx
        .select({ version: consents.version })
        .from(consents)
        .where(
          and(eq(consents.contactId, sourceId), eq(consents.channel, channel), eq(consents.purpose, purpose)),
        )
        .orderBy(sql`${consents.capturedAt} desc, ${consents.id} desc`)
        .limit(1);
      const [row] = await tx
        .insert(consents)
        .values({
          orgId,
          contactId: targetId,
          channel,
          purpose,
          status: s.status,
          evidence: `merge:${mergeId}; ${s.evidence}`.slice(0, 2000),
          capturedAt: ctx.now,
          version: version?.version ?? null,
        })
        .returning({ id: consents.id });
      if (row) consentRowIds.push(row.id);
    }

  // 5. The timeline (crm's own), then every owning module, references before projections.
  const moved: Record<string, number> = {};
  const kept: Record<string, number> = {};
  const timeline = await tx
    .update(timelineEntries)
    .set({ contactId: targetId, updatedAt: ctx.now })
    .where(eq(timelineEntries.contactId, sourceId))
    .returning({ id: timelineEntries.id });
  await recordMovesTx(
    tx,
    ctx,
    mergeId,
    'crm',
    timeline.map((r) => ({ table: TIMELINE_TABLE, id: r.id })),
  );
  if (timeline.length) moved[TIMELINE_TABLE] = timeline.length;
  const step = { mergeId, fromContactId: sourceId, toContactId: targetId };
  for (const owner of contactReferenceOwners()) {
    const r = await owner.move(tx, ctx, step);
    await recordMovesTx(tx, ctx, mergeId, owner.module, r.moved);
    for (const m of r.moved) moved[m.table] = (moved[m.table] ?? 0) + 1;
    for (const [table, n] of Object.entries(r.kept ?? {})) if (n > 0) kept[table] = (kept[table] ?? 0) + n;
  }

  // 6. Profiles, candidates, the merge record's summary, the event.
  await refreshContactProfilesTx(tx, ctx, [sourceId, targetId]);
  await tx
    .update(duplicateCandidates)
    .set({ status: 'merged', resolvedAt: ctx.now, resolvedBy: actorId(ctx.actor), updatedAt: ctx.now })
    .where(
      and(
        eq(duplicateCandidates.status, 'open'),
        or(eq(duplicateCandidates.contactAId, sourceId), eq(duplicateCandidates.contactBId, sourceId)),
      ),
    );
  await tx
    .update(contactMerges)
    .set({ consentRowIds, summary: { moved, kept } })
    .where(eq(contactMerges.id, mergeId));
  emit({
    type: 'crm.contacts_merged',
    version: 1,
    aggregateType: 'contact',
    aggregateId: targetId,
    payload: { orgId, mergeId, sourceContactId: sourceId, targetContactId: targetId },
  });
  return { mergeId, sourceContactId: sourceId, targetContactId: targetId, moved, kept };
}

/**
 * Undo a merge within its 30 days (M6.1a), restoring the split exactly: every recorded row moves
 * back (owners first, the participation projection last), timeline entries go back with their
 * subjects, the consent rows the merge added are removed, and both records get their fields back.
 * Refused once the window has passed, after either record was erased, or while the kept record
 * has itself been merged into another one since (undo that merge first).
 */
export async function undoMergeTx(
  tx: TenantTx,
  ctx: Ctx,
  mergeId: string,
  emit: (event: DomainEvent) => void,
): Promise<{ sourceContactId: string; targetContactId: string }> {
  const orgId = requireOrg(ctx);
  const [merge] = await tx.select().from(contactMerges).where(eq(contactMerges.id, mergeId)).for('update');
  if (!merge) throw new DomainError('not_found');
  if (merge.status !== 'applied')
    throw new DomainError('invalid_state', 'Already undone', { reason: 'undone' });
  if (ctx.now > merge.undoUntil)
    throw new DomainError('invalid_state', 'The undo window has passed', { reason: 'undo_expired' });
  const snapshot = merge.snapshot as Snapshot | null;
  if (!snapshot)
    throw new DomainError('invalid_state', 'An erased record cannot be restored', { reason: 'erased' });
  const sourceId = merge.sourceContactId;
  const targetId = merge.targetContactId;
  const locked = await lockContactsTx(tx, [sourceId, targetId]);
  const source = locked.get(sourceId);
  const target = locked.get(targetId);
  if (!source || !target) throw new DomainError('not_found');
  if (target.mergedInto)
    throw new DomainError('invalid_state', 'Undo the later merge first', { reason: 'undo_blocked' });
  if (isErased(source.emailNorm) || isErased(target.emailNorm))
    throw new DomainError('invalid_state', 'An erased record cannot be restored', { reason: 'erased' });

  const moves = await tx
    .select({
      module: contactMergeMoves.module,
      table: contactMergeMoves.refTable,
      id: contactMergeMoves.rowId,
    })
    .from(contactMergeMoves)
    .where(eq(contactMergeMoves.mergeId, mergeId));
  const step = { mergeId, fromContactId: sourceId, toContactId: targetId };
  const restored: MovedRow[] = [];
  for (const owner of contactReferenceOwners()) {
    const rows = moves.filter((m) => m.module === owner.module).map((m) => ({ table: m.table, id: m.id }));
    restored.push(...(await owner.restore(tx, ctx, { ...step, rows })));
  }
  // Timeline entries: the ones the merge moved, and any recorded since whose subject went back.
  const movedEntries = moves.filter((m) => m.table === TIMELINE_TABLE).map((m) => m.id);
  const conds = [];
  if (movedEntries.length) conds.push(inArray(timelineEntries.id, movedEntries));
  const bySubject = new Map<string, string[]>();
  for (const r of restored) bySubject.set(r.table, [...(bySubject.get(r.table) ?? []), r.id]);
  for (const [table, ids] of bySubject)
    conds.push(and(eq(timelineEntries.subjectTable, table), inArray(timelineEntries.subjectRef, ids)));
  if (conds.length)
    await tx
      .update(timelineEntries)
      .set({ contactId: sourceId, updatedAt: ctx.now })
      .where(and(eq(timelineEntries.contactId, targetId), or(...conds)));
  if (merge.consentRowIds.length)
    await tx
      .delete(consents)
      .where(and(eq(consents.contactId, targetId), inArray(consents.id, merge.consentRowIds)));

  // Both records' fields back (through a placeholder: the emails may have been swapped).
  const p = swapPlaceholder(sourceId);
  await tx.update(contacts).set({ email: p, emailNorm: p, userId: null }).where(eq(contacts.id, sourceId));
  const restore = (s: ContactSnapshot) => ({
    email: s.email,
    emailNorm: s.emailNorm,
    name: s.name,
    phoneE164: s.phoneE164,
    company: s.company,
    userId: s.userId,
    updatedAt: new Date(s.updatedAt),
  });
  await tx.update(contacts).set(restore(snapshot.target)).where(eq(contacts.id, targetId));
  await tx
    .update(contacts)
    .set({ ...restore(snapshot.source), mergedInto: null })
    .where(eq(contacts.id, sourceId));
  await refreshContactProfilesTx(tx, ctx, [sourceId, targetId]);

  await tx
    .update(contactMerges)
    .set({ status: 'undone', undoneAt: ctx.now, undoneBy: actorId(ctx.actor), updatedAt: ctx.now })
    .where(eq(contactMerges.id, mergeId));
  // The pair is a candidate again (unless someone dismissed it before).
  const [a, b] = sourceId < targetId ? [sourceId, targetId] : [targetId, sourceId];
  await tx
    .update(duplicateCandidates)
    .set({ status: 'open', resolvedAt: null, resolvedBy: null, updatedAt: ctx.now })
    .where(
      and(
        eq(duplicateCandidates.contactAId, a),
        eq(duplicateCandidates.contactBId, b),
        eq(duplicateCandidates.status, 'merged'),
      ),
    );
  emit({
    type: 'crm.contacts_unmerged',
    version: 1,
    aggregateType: 'contact',
    aggregateId: targetId,
    payload: { orgId, mergeId, sourceContactId: sourceId, targetContactId: targetId },
  });
  return { sourceContactId: sourceId, targetContactId: targetId };
}

/**
 * Erasure (DSAR) of a contact also scrubs the merge snapshots that hold its old fields: such a
 * merge can no longer be undone.
 */
export async function scrubMergeSnapshotsTx(
  tx: TenantTx,
  contactIds: readonly string[],
  now: Date,
): Promise<number> {
  if (contactIds.length === 0) return 0;
  const rows = await tx
    .update(contactMerges)
    .set({ snapshot: null, updatedAt: now })
    .where(
      or(
        inArray(contactMerges.sourceContactId, [...contactIds]),
        inArray(contactMerges.targetContactId, [...contactIds]),
      ),
    )
    .returning({ id: contactMerges.id });
  return rows.length;
}
