import { personTimelineQuery } from '@yayatoh/audiences';
import {
  contactColumnsTx,
  contactIdByEmailTx,
  currentConsentTx,
  dismissDuplicateCommand,
  eraseContactDsarTx,
  duplicatePairQuery,
  duplicateQueueQuery,
  mergeContactsCommand,
  mergeDuplicatesBulkCommand,
  peopleQuery,
  personQuery,
  scanDuplicatesCommand,
  setContactPhoneTx,
  uncoveredContactColumnsTx,
  undoMergeCommand,
  upsertContactTx,
} from '@yayatoh/crm';
import { withTenant } from '@yayatoh/db';
import { type AdminSql, adminClient, closePools } from '@yayatoh/db/testing';
import { executeCommand, executeQuery, isDomainError } from '@yayatoh/kernel';
import { consumeEvent } from '@yayatoh/platform';
import { addMemberCommand } from '@yayatoh/tenancy';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CONTACT_REFERENCE_OWNERS,
  catchUpTimeline,
  type MergeScenario,
  mergeScenario,
  type OrgFixture,
  ports,
  staleCtx,
  systemCtx,
  TIMELINE_SUBSCRIBERS,
  twoOrgs,
  userCtx,
} from '../src/index.ts';

/**
 * M6.1a contact merges on real Postgres: duplicate detection, a merge that moves every reference
 * across modules exactly once, an exact undo, consent (an opt-out wins), the timeline from the
 * projection only, tenant isolation, permissions and step-up.
 */
let a: OrgFixture;
let b: OrgFixture;
let sa: MergeScenario;
let sb: MergeScenario;
let admin: AdminSql;

const refusal = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (err) {
    return isDomainError(err) ? `${err.code}:${String(err.details?.reason ?? '')}` : String(err);
  }
};

/** Every reference to these contacts in every module, by table (ids and owner), plus crm's own rows. */
async function stateOf(org: OrgFixture, ids: readonly string[]) {
  const cols = await withTenant(systemCtx(org.org.id), (tx) => contactColumnsTx(tx));
  const out: Record<string, unknown> = {};
  for (const col of cols) {
    const [schema, table, column] = col.split('.') as [string, string, string];
    out[col] = await admin.unsafe(
      `select id, ${column} as contact from "${schema}"."${table}" where org_id = $1 and ${column} = any($2::uuid[]) order by id`,
      [org.org.id, ids as string[]],
    );
  }
  out.contacts = await admin`
    select id, email, email_norm, name, phone_e164, company, user_id, merged_into, updated_at
    from crm.contacts where id = any(${ids as string[]}::uuid[]) order by id`;
  out.consents = await admin`
    select id, contact_id, channel, purpose, status, evidence from crm.consents
    where contact_id = any(${ids as string[]}::uuid[]) order by id`;
  out.timeline = await admin`
    select id, contact_id, kind from crm.timeline_entries
    where contact_id = any(${ids as string[]}::uuid[]) order by id`;
  // Projections are recomputed (new row ids): compare what they say.
  out.participation = await admin`
    select contact_id, event_id, tickets, orders, spend_minor, checked_in, registered, has_seat
    from crm.event_participation where contact_id = any(${ids as string[]}::uuid[]) order by contact_id, event_id`;
  out.profiles = await admin`
    select contact_id, events, events_attended, tickets, orders, email_consent, sms_consent
    from crm.contact_profile where contact_id = any(${ids as string[]}::uuid[]) order by contact_id`;
  return out;
}

const scan = (org: OrgFixture, full = true) =>
  executeCommand(scanDuplicatesCommand, { full }, org.ctx(), ports);
const pairOf = async (org: OrgFixture, x: string, y: string) => {
  const q = await executeQuery(duplicateQueueQuery, { limit: 100 }, org.ctx(), ports);
  return q.rows.find((r) => [r.a.id, r.b.id].sort().join() === [x, y].sort().join());
};

beforeAll(async () => {
  admin = adminClient();
  ({ a, b } = await twoOrgs());
  sa = await mergeScenario(a.org.id);
  sb = await mergeScenario(b.org.id);
}, 240_000);

afterAll(async () => {
  await admin?.end();
  await closePools();
});

describe('M6.1a owners', () => {
  it('every contact column in the database has a registered owner', async () => {
    const uncovered = await withTenant(systemCtx(a.org.id), (tx) => uncoveredContactColumnsTx(tx));
    expect(uncovered).toEqual([]);
    const cols = await withTenant(systemCtx(a.org.id), (tx) => contactColumnsTx(tx));
    expect(cols.length).toBeGreaterThanOrEqual(10);
    expect(CONTACT_REFERENCE_OWNERS.flatMap((o) => o.columns).sort()).toEqual([...cols].sort());
  });
});

describe('M6.1a duplicate detection', () => {
  it('finds the same Gmail mailbox, with a score and the reason; never someone else', async () => {
    const r = await scan(a);
    expect(r.found).toBeGreaterThanOrEqual(1);
    const c = await pairOf(a, sa.keep.contactId, sa.dup.contactId);
    expect(c).toMatchObject({ score: 90, reasons: ['email'], status: 'open' });
    const q = await executeQuery(duplicateQueueQuery, { limit: 100 }, a.ctx(), ports);
    expect(q.rows.some((x) => [x.a.id, x.b.id].includes(sa.other.contactId))).toBe(false);
    expect(q.lastScanAt).not.toBeNull();
  });

  it('is incremental: a new contact with the same phone, and a similar name at the same company', async () => {
    const ctx = systemCtx(a.org.id);
    const phoneTwin = await withTenant(ctx, async (tx) => {
      const { id } = await upsertContactTx(tx, ctx, {
        email: `tay.${sa.tag}@example.test`,
        name: 'Tay R.',
        source: 'manual',
      });
      const [dup] = await tx.execute<{ phone_e164: string }>(
        sql`select phone_e164 from crm.contacts where id = ${sa.dup.contactId}`,
      );
      await setContactPhoneTx(tx, ctx, id, dup?.phone_e164 ?? null);
      return id;
    });
    const coworker = await withTenant(ctx, async (tx) => {
      const { id } = await upsertContactTx(tx, ctx, {
        email: `t.reed.${sa.tag}@lakeside-partners.test`,
        name: 'Taylor Reed',
        source: 'manual',
      });
      await tx.execute(sql`update crm.contacts set company = 'Lakeside Partners' where id = ${id}`);
      return id;
    });
    const r = await scan(a, false);
    // Only what changed since the last scan was compared with everyone.
    expect(r.scanned).toBeLessThan(10);
    expect(await pairOf(a, sa.dup.contactId, phoneTwin)).toMatchObject({ score: 80, reasons: ['phone'] });
    expect(await pairOf(a, sa.dup.contactId, coworker)).toMatchObject({
      score: 85,
      reasons: ['name_company'],
      nameSimilarity: 100,
      companySimilarity: 100,
    });
    // Dismissed pairs are never raised again.
    const c = await pairOf(a, sa.dup.contactId, phoneTwin);
    await executeCommand(dismissDuplicateCommand, { candidateId: c?.id as string }, a.ctx(), ports);
    await scan(a);
    expect(await pairOf(a, sa.dup.contactId, phoneTwin)).toBeUndefined();
    const dismissed = await executeQuery(duplicateQueueQuery, { status: 'dismissed' }, a.ctx(), ports);
    expect(dismissed.rows.map((x) => x.id)).toContain(c?.id);
    const nc = await pairOf(a, sa.dup.contactId, coworker);
    await executeCommand(dismissDuplicateCommand, { candidateId: nc?.id as string }, a.ctx(), ports);
  });

  it('the compare view: both sides, consents, default survivor (older) and field choices', async () => {
    const c = await pairOf(a, sa.keep.contactId, sa.dup.contactId);
    const p = await executeQuery(duplicatePairQuery, { candidateId: c?.id as string }, a.ctx(), ports);
    expect(p.defaultTargetId).toBe(sa.keep.contactId);
    const keep = p.a.id === sa.keep.contactId ? p.a : p.b;
    const dup = p.a.id === sa.dup.contactId ? p.a : p.b;
    expect(keep).toMatchObject({ emailConsent: 'granted', live: true });
    expect(dup).toMatchObject({ emailConsent: 'withdrawn', company: 'Lakeside Partners' });
    expect(dup.timelineEntries).toBeGreaterThan(0);
    // The duplicate changed last: its values by default, the phone and company only it has.
    expect(p.defaultChoices).toEqual({ name: 'source', email: 'source', phone: 'source', company: 'source' });
  });
});

describe('M6.1a merge and undo', () => {
  it('moves every reference exactly once across modules, opt-out wins, and undo restores the split exactly', async () => {
    const ids = [sa.keep.contactId, sa.dup.contactId];
    const before = await stateOf(a, ids);
    const r = await executeCommand(
      mergeContactsCommand,
      {
        sourceContactId: sa.dup.contactId,
        targetContactId: sa.keep.contactId,
        // Keep the older email; take the duplicate's phone and company; name from the target.
        choices: { name: 'target', email: 'target', phone: 'source', company: 'source' },
      },
      a.ctx(),
      ports,
    );
    const after = await stateOf(a, ids);
    const onDup = (rows: unknown) =>
      (rows as { id: string; contact: string }[]).filter((x) => x.contact === sa.dup.contactId).length;
    const movedModules = new Set<string>();
    for (const [k, rows] of Object.entries(before)) {
      if (k.split('.').length !== 3) continue;
      const table = k.split('.').slice(0, 2).join('.');
      const was = rows as { id: string; contact: string }[];
      const now = after[k] as { id: string; contact: string }[];
      // Same rows; each of the duplicate's rows moved, or was kept on a unique clash (counted).
      expect(now.map((x) => x.id), k).toEqual(was.map((x) => x.id));
      expect(r.moved[table] ?? 0, k).toBe(onDup(was) - onDup(now));
      expect(onDup(now), k).toBe(r.kept[table] ?? 0);
      if (onDup(was) - onDup(now) > 0) movedModules.add(k.split('.')[0] as string);
    }
    // The duplicate's references moved in at least five modules (one kept a clashing journey run).
    expect([...movedModules].sort()).toEqual(
      expect.arrayContaining(['attendees', 'automations', 'campaigns', 'notifications', 'orders']),
    );
    expect(r.kept['automations.journey_runs']).toBe(1);
    // Exactly once: the moves ledger has one row per moved row.
    const [ledger] = await admin<{ n: number; d: number }[]>`
      select count(*)::int as n, count(distinct (ref_table, row_id))::int as d
      from crm.contact_merge_moves where merge_id = ${r.mergeId}`;
    expect(ledger?.n).toBe(ledger?.d);
    expect(ledger?.n).toBe(Object.values(r.moved).reduce((x, y) => x + y, 0));

    // Fields: the choices; the duplicate's address still resolves to the person.
    const keepRow = (after.contacts as { id: string }[]).find((x) => x.id === sa.keep.contactId) as {
      email: string;
      phone_e164: string | null;
      company: string | null;
      name: string;
    };
    expect(keepRow).toMatchObject({ email: sa.keep.email, company: 'Lakeside Partners', name: 'Taylor Reed' });
    expect(keepRow.phone_e164).toMatch(/^\+1312555\d{4}$/);
    await withTenant(systemCtx(a.org.id), async (tx) => {
      expect(await contactIdByEmailTx(tx, sa.dup.email)).toBe(sa.keep.contactId);
      // Opt-out wins: the kept record's marketing email consent is now withdrawn.
      expect(await currentConsentTx(tx, sa.keep.contactId, 'email', 'marketing')).toBe('withdrawn');
    });
    // The participation projection now says one person: both events, three tickets.
    const part = after.participation as { contact_id: string; event_id: string; tickets: number }[];
    expect(part.filter((p) => p.contact_id === sa.dup.contactId)).toEqual([]);
    expect(
      part
        .filter((p) => p.contact_id === sa.keep.contactId && [sa.summit, sa.gala].includes(p.event_id))
        .map((p) => [p.event_id === sa.summit ? 'summit' : 'gala', p.tickets])
        .sort(),
    ).toEqual([
      ['gala', 1],
      ['summit', 2],
    ]);

    // The merged timeline: one feed (orders of both, the check-in, the campaign send).
    const tl = await executeQuery(personTimelineQuery, { contactId: sa.keep.contactId, limit: 100 }, a.ctx(), ports);
    const kinds = tl.rows.map((x) => x.kind);
    expect(kinds.filter((k) => k === 'order_paid')).toHaveLength(3);
    expect(kinds).toContain('checked_in');
    expect(kinds).toContain('campaign_sent');
    expect(tl.events.map((e) => e.name).sort()).toEqual([sa.galaName, sa.summitName].sort());
    const person = await executeQuery(personQuery, { contactId: sa.keep.contactId }, a.ctx(), ports);
    expect(person.merges[0]).toMatchObject({ id: r.mergeId, status: 'applied', canUndo: true });
    expect(person.merges[0]?.source?.email).toBe(sa.dup.email);
    const gone = await executeQuery(personQuery, { contactId: sa.dup.contactId }, a.ctx(), ports);
    expect(gone.mergedInto).toBe(sa.keep.contactId);
    // People lists live records only.
    const people = await executeQuery(peopleQuery, { q: sa.tag }, a.ctx(), ports);
    expect(people.rows.map((x) => x.id)).toContain(sa.keep.contactId);
    expect(people.rows.map((x) => x.id)).not.toContain(sa.dup.contactId);
    // A second merge of the same duplicate is refused.
    expect(
      await refusal(
        executeCommand(
          mergeContactsCommand,
          { sourceContactId: sa.dup.contactId, targetContactId: sa.keep.contactId },
          a.ctx(),
          ports,
        ),
      ),
    ).toBe('invalid_state:already_merged');

    // Undo: the exact pre-merge state (references, fields, consents, timeline, projections).
    await executeCommand(undoMergeCommand, { mergeId: r.mergeId }, a.ctx(), ports);
    expect(await stateOf(a, ids)).toEqual(before);
    expect(await refusal(executeCommand(undoMergeCommand, { mergeId: r.mergeId }, a.ctx(), ports))).toBe(
      'invalid_state:undone',
    );
    // The pair is a candidate again.
    expect(await pairOf(a, sa.keep.contactId, sa.dup.contactId)).toMatchObject({ status: 'open' });
  });

  it('facts recorded after a merge follow their subject back on undo; a replayed event changes nothing', async () => {
    const r = await executeCommand(
      mergeContactsCommand,
      { sourceContactId: sa.dup.contactId, targetContactId: sa.keep.contactId },
      a.ctx(),
      ports,
    );
    // Default choices: the duplicate's (more recent) email moved onto the kept record.
    const [row] = await admin<{ email: string }[]>`select email from crm.contacts where id = ${sa.keep.contactId}`;
    expect(row?.email).toBe(sa.dup.email);
    // Replaying every timeline event: exactly once (processed_events and the unique key).
    const [n0] = await admin<{ n: number }[]>`select count(*)::int as n from crm.timeline_entries where org_id = ${a.org.id}`;
    const events = await admin<
      { id: string; org_id: string; type: string; version: number; aggregate_type: string; aggregate_id: string; payload: unknown; created_at: Date }[]
    >`select id, org_id, type, version, aggregate_type, aggregate_id, payload, created_at from platform.domain_events where org_id = ${a.org.id}`;
    for (const s of TIMELINE_SUBSCRIBERS())
      for (const e of events)
        if (s.events.includes(`${e.type}@${e.version}`))
          await consumeEvent(s, {
            id: e.id,
            orgId: e.org_id,
            type: e.type,
            version: e.version,
            aggregateType: e.aggregate_type,
            aggregateId: e.aggregate_id,
            payload: e.payload,
            logSeq: 0,
          });
    expect(await catchUpTimeline(a.org.id)).toBe(0);
    const [n1] = await admin<{ n: number }[]>`select count(*)::int as n from crm.timeline_entries where org_id = ${a.org.id}`;
    expect(n1?.n).toBe(n0?.n);
    // A fact recorded while merged about a row that goes back on undo goes back with it.
    const [order] = await admin<{ id: string }[]>`
      select o.id from orders.orders o where o.org_id = ${a.org.id} and o.event_id = ${sa.gala}
        and o.buyer_contact_id = ${sa.keep.contactId}`;
    await admin`delete from crm.timeline_entries where source_ref = ${order?.id as string} and kind = 'order_paid'`;
    await admin`delete from platform.processed_events where org_id = ${a.org.id} and consumer = 'orders.timeline'`;
    await catchUpTimeline(a.org.id);
    const [late] = await admin<{ contact_id: string }[]>`
      select contact_id from crm.timeline_entries where source_ref = ${order?.id as string} and kind = 'order_paid'`;
    expect(late?.contact_id).toBe(sa.keep.contactId);
    await executeCommand(undoMergeCommand, { mergeId: r.mergeId }, a.ctx(), ports);
    const [back] = await admin<{ contact_id: string }[]>`
      select contact_id from crm.timeline_entries where source_ref = ${order?.id as string} and kind = 'order_paid'`;
    expect(back?.contact_id).toBe(sa.dup.contactId);
    const [email] = await admin<{ email: string }[]>`select email from crm.contacts where id = ${sa.keep.contactId}`;
    expect(email?.email).toBe(sa.keep.email);
  });

  it('refuses an undo after 30 days, and while the kept record is merged into another one', async () => {
    const r = await executeCommand(
      mergeContactsCommand,
      { sourceContactId: sa.dup.contactId, targetContactId: sa.keep.contactId },
      a.ctx(),
      ports,
    );
    const later = new Date(Date.now() + 31 * 86_400_000);
    expect(
      await refusal(executeCommand(undoMergeCommand, { mergeId: r.mergeId }, a.ctx({ now: later }), ports)),
    ).toBe('invalid_state:undo_expired');
    // The kept record merged into someone else: undo that one first.
    const r2 = await executeCommand(
      mergeContactsCommand,
      { sourceContactId: sa.keep.contactId, targetContactId: sa.other.contactId },
      a.ctx(),
      ports,
    );
    expect(await refusal(executeCommand(undoMergeCommand, { mergeId: r.mergeId }, a.ctx(), ports))).toBe(
      'invalid_state:undo_blocked',
    );
    await executeCommand(undoMergeCommand, { mergeId: r2.mergeId }, a.ctx(), ports);
    await executeCommand(undoMergeCommand, { mergeId: r.mergeId }, a.ctx(), ports);
    expect(await refusal(executeCommand(undoMergeCommand, { mergeId: r.mergeId }, a.ctx(), ports))).toBe(
      'invalid_state:undone',
    );
  });
});

describe('M6.1a permissions, step-up and isolation', () => {
  it('a viewer (and a marketing member) can not merge; marketing can read people and the timeline', async () => {
    const viewer = userCtx(a.viewerId, a.org.id);
    expect(
      await refusal(
        executeCommand(
          mergeContactsCommand,
          { sourceContactId: sa.dup.contactId, targetContactId: sa.keep.contactId },
          viewer,
          ports,
        ),
      ),
    ).toBe('forbidden:');
    expect(await refusal(executeQuery(peopleQuery, {}, viewer, ports))).toBe('forbidden:');
    const marketer = crypto.randomUUID();
    await executeCommand(addMemberCommand, { userId: marketer, role: 'marketing' }, a.ctx(), ports);
    const m = userCtx(marketer, a.org.id);
    expect(await refusal(executeQuery(personTimelineQuery, { contactId: sa.keep.contactId }, m, ports))).toBe('ok');
    expect(await refusal(executeCommand(scanDuplicatesCommand, { full: false }, m, ports))).toBe('forbidden:');
    const c = await pairOf(a, sa.keep.contactId, sa.dup.contactId);
    expect(await refusal(executeCommand(dismissDuplicateCommand, { candidateId: c?.id as string }, m, ports))).toBe(
      'forbidden:',
    );
  });

  it('bulk merges need step-up and merge each open pair with the defaults', async () => {
    await scan(b);
    const c = await pairOf(b, sb.keep.contactId, sb.dup.contactId);
    expect(c).toBeDefined();
    expect(
      await refusal(
        executeCommand(mergeDuplicatesBulkCommand, { candidateIds: [c?.id as string] }, staleCtx(b.ctx()), ports),
      ),
    ).toBe('step_up_required:');
    const r = await executeCommand(mergeDuplicatesBulkCommand, { candidateIds: [c?.id as string] }, b.ctx(), ports);
    expect(r).toMatchObject({ merged: 1, skipped: 0 });
    const [m] = await admin<{ source_contact_id: string; target_contact_id: string; bulk_id: string }[]>`
      select source_contact_id, target_contact_id, bulk_id from crm.contact_merges where id = ${r.mergeIds[0] as string}`;
    expect(m).toMatchObject({ source_contact_id: sb.dup.contactId, target_contact_id: sb.keep.contactId, bulk_id: r.bulkId });
    const [audit] = await admin<{ n: number }[]>`
      select count(*)::int as n from platform.audit_events where org_id = ${b.org.id} and action = 'crm.mergeDuplicatesBulk'`;
    expect(audit?.n).toBe(1);
    // Already merged: skipped, not an error.
    const again = await executeCommand(mergeDuplicatesBulkCommand, { candidateIds: [c?.id as string] }, b.ctx(), ports);
    expect(again).toMatchObject({ merged: 0, skipped: 1 });
  });

  it("never reads or merges another org's people", async () => {
    // Org A can't see org B's records, timeline or candidates…
    expect(await refusal(executeQuery(personQuery, { contactId: sb.keep.contactId }, a.ctx(), ports))).toBe(
      'not_found:',
    );
    const tl = await executeQuery(personTimelineQuery, { contactId: sb.keep.contactId, limit: 100 }, a.ctx(), ports);
    expect(tl.rows).toEqual([]);
    expect(tl.events).toEqual([]);
    const q = await executeQuery(duplicateQueueQuery, { limit: 100, status: 'merged' }, a.ctx(), ports);
    const bIds = new Set([sb.keep.contactId, sb.dup.contactId]);
    expect(q.rows.some((r) => bIds.has(r.a.id) || bIds.has(r.b.id))).toBe(false);
    // …nor merge across orgs (the other record is simply not found).
    expect(
      await refusal(
        executeCommand(
          mergeContactsCommand,
          { sourceContactId: sb.other.contactId, targetContactId: sa.other.contactId },
          a.ctx(),
          ports,
        ),
      ),
    ).toBe('not_found:');
    // Every timeline row of each org is about that org's own contacts.
    const [leak] = await admin<{ n: number }[]>`
      select count(*)::int as n from crm.timeline_entries t
      join crm.contacts c on c.id = t.contact_id where c.org_id <> t.org_id`;
    expect(leak?.n).toBe(0);
  });

  it('erasure scrubs the merge snapshot: that merge can no longer be undone', async () => {
    const [m] = await admin<{ id: string }[]>`
      select id from crm.contact_merges where org_id = ${b.org.id} and source_contact_id = ${sb.dup.contactId}
        and status = 'applied'`;
    await withTenant(systemCtx(b.org.id), (tx) => eraseContactDsarTx(tx, sb.dup.email, new Date()));
    const [row] = await admin<{ snapshot: unknown }[]>`select snapshot from crm.contact_merges where id = ${m?.id as string}`;
    expect(row?.snapshot).toBeNull();
    expect(await refusal(executeCommand(undoMergeCommand, { mergeId: m?.id as string }, b.ctx(), ports))).toBe(
      'invalid_state:erased',
    );
    const person = await executeQuery(personQuery, { contactId: sb.keep.contactId }, b.ctx(), ports);
    expect(person.merges[0]).toMatchObject({ canUndo: false, source: null });
  });
});
