import { databaseAuditSink, setPlatformAuditSink, withPlatformReader } from '@yayatoh/db/platform';
import { adminClient, closePools } from '@yayatoh/db/testing';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { createCtx, executeCommand, uuidv7 } from '@yayatoh/kernel';
import { catchUpListings, moderateListingCommand, moderationQueueTx } from '@yayatoh/marketplace';
import { type OrgFixture, ports, twoOrgs } from '@yayatoh/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * The staff listing moderation queue (M6.14a), as apps/admin reads it: across every org through
 * platform_reader (each read in the access log first) and changed by a platform command in the
 * listing's org as the staff member.
 */
let a: OrgFixture;
let b: OrgFixture;
const admin = adminClient();
const STAFF = 'staff:01900000-0000-7000-8000-00000000c4a8';
const staffCtx = (orgId: string) => createCtx({ orgId, actor: { type: 'system', name: STAFF } });
const tag = uuidv7().slice(-8);
const queue = (state: 'listed' | 'hidden', reason: string) =>
  withPlatformReader({ actor: STAFF, reason }, (tx) => moderationQueueTx(tx, { state, q: tag }));

async function published(o: OrgFixture, name: string) {
  const e = await executeCommand(
    createEventCommand,
    {
      name: `${name} ${tag}`,
      timezone: 'UTC',
      startsAt: '2031-06-01T18:00:00Z',
      endsAt: '2031-06-01T22:00:00Z',
      city: 'Oslo',
    },
    o.ctx(),
    ports,
  );
  await executeCommand(transitionEventCommand, { eventId: e.id, transition: 'publish' }, o.ctx(), ports);
  await catchUpListings(o.org.id);
  return e;
}

beforeAll(async () => {
  setPlatformAuditSink(databaseAuditSink);
  ({ a, b } = await twoOrgs());
});
afterAll(async () => {
  await closePools();
  await admin.end();
});

describe('staff listing moderation queue', () => {
  it('lists live listings of every org, then hidden ones with the reason, and logs each read', async () => {
    const ea = await published(a, 'Queue Alpha');
    const eb = await published(b, 'Queue Beta');
    const listed = await queue('listed', `test: listings ${tag}`);
    expect(listed.map((r) => r.eventId).sort()).toEqual([ea.id, eb.id].sort());
    expect(listed.find((r) => r.eventId === eb.id)).toMatchObject({
      orgId: b.org.id,
      orgSlug: b.org.slug,
      slug: eb.slug,
      hidden: false,
      city: 'Oslo',
    });
    await executeCommand(
      moderateListingCommand,
      { eventId: eb.id, hidden: true, reason: 'Duplicate of another listing' },
      staffCtx(b.org.id),
      ports,
    );
    expect((await queue('listed', `test: listings ${tag}`)).map((r) => r.eventId)).toEqual([ea.id]);
    const hidden = await queue('hidden', `test: hidden listings ${tag}`);
    expect(hidden).toEqual([
      expect.objectContaining({ eventId: eb.id, hidden: true, reason: 'Duplicate of another listing' }),
    ]);
    // The audit row names the staff member in the listing's org.
    const [row] = await admin.unsafe<{ actor: string }[]>(
      `select actor from platform.audit_events where org_id = $1 and target_id = $2 and action = 'marketplace.listing.hide'`,
      [b.org.id, eb.id],
    );
    expect(row?.actor).toBe(`system:${STAFF}`);
    // Each read went to the access log before it ran.
    const logged = await admin.unsafe<{ n: number }[]>(
      `select count(*)::int as n from platform.access_log where actor = $1 and reason like $2`,
      [STAFF, `test: %listings ${tag}`],
    );
    expect(logged[0]?.n).toBe(3);
  });
});
