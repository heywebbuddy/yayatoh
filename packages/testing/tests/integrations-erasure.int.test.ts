import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eraseNow, exportNow } from '../src/dsar/helpers.ts';
import { type OrgFixture, systemCtx, twoOrgs } from '../src/index.ts';

/**
 * Batch 3l merge: integrations' erasure hook for every connector. The fixture's "Sheet Guest" is on
 * a Google Sheet (record links for their attendee row) with a last-writer conflict in the inbox.
 * An access request lists the remote links; an erasure unlinks them (no connector pushes the
 * person again or matches a provider row to them), deletes the inbox rows and conflict values
 * about them, and leaves everyone else's links and the other org untouched. Nothing is called at a
 * provider (the fakes would record it).
 */
let a: OrgFixture;
let b: OrgFixture;
const guest = (o: OrgFixture) => `sheet.guest.${o.org.id.slice(-8)}@fixture.test`;

async function counts(o: OrgFixture) {
  return withTenant(systemCtx(o.org.id), async (tx) => {
    const [r] = await tx.execute<{ person: number; all: number; errors: number; conflicts: number }>(sql`
      select
        (select count(*)::int from integrations.record_links l
           join attendees.attendees t on t.org_id = l.org_id and t.id = l.local_id
          where lower(t.email) = ${guest(o)}) as person,
        (select count(*)::int from integrations.record_links) as all,
        (select count(*)::int from integrations.sync_errors e
           join attendees.attendees t on t.org_id = e.org_id and t.id = e.local_id
          where lower(t.email) = ${guest(o)}) as errors,
        (select count(*)::int from integrations.sync_conflicts) as conflicts`);
    if (!r) throw new Error('no counts');
    return r;
  });
}

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
});
afterAll(closePools);

describe('integrations erasure (batch 3l merge)', () => {
  it('an access request lists the person’s remote links', async () => {
    const { modules } = await exportNow(guest(a), a.ctx());
    const doc = modules.integrations as { remoteLinks?: { connector: string; object: string }[] };
    expect(doc.remoteLinks?.length).toBeGreaterThan(0);
    expect(doc.remoteLinks?.every((l) => l.connector === 'google_sheets')).toBe(true);
  });

  it('erasure unlinks the person everywhere; other people and the other org keep their links', async () => {
    const before = await counts(a);
    const other = await counts(b);
    expect(before.person).toBeGreaterThan(0);
    expect(before.conflicts).toBeGreaterThan(0);
    const r = await eraseNow(guest(a), a.ctx());
    expect(r).toBeTruthy();
    const after = await withTenant(systemCtx(a.org.id), async (tx) => {
      const [x] = await tx.execute<{ all: number; conflicts: number }>(sql`
        select (select count(*)::int from integrations.record_links) as all,
               (select count(*)::int from integrations.sync_conflicts) as conflicts`);
      return x;
    });
    expect(after?.all).toBe(before.all - before.person);
    expect(after?.conflicts).toBe(0);
    expect(await counts(b)).toEqual(other);
  });
});
