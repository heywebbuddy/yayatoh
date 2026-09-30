import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { createCtx, executeCommand, executeQuery } from '@yayatoh/kernel';
import { startCheckoutCommand } from '@yayatoh/orders';
import {
  dismissReportsCommand,
  hideReviewCommand,
  listReviewsQuery,
  publicReviews,
  reportReviewCommand,
  reviewStateForOrder,
  submitReviewCommand,
  unhideReviewCommand,
} from '@yayatoh/reviews';
import { createTicketTypeCommand } from '@yayatoh/ticketing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, twoOrgs, userCtx } from '../src/index.ts';

let a: OrgFixture;
let b: OrgFixture;
let eventId: string;
let freeId: string;
const ENDS = new Date('2027-12-01T23:00:00Z');
const AFTER = new Date('2027-12-02T12:00:00Z');
const BEFORE = new Date('2027-12-01T20:00:00Z');

const anon = (now = AFTER, orgId = a.org.id) => createCtx({ orgId, now });
async function buy(n: string | number, name = `Buyer ${n}`) {
  const r = await executeCommand(
    startCheckoutCommand,
    {
      eventId,
      items: [{ ticketTypeId: freeId, quantity: 1 }],
      buyer: { email: `Reviewer${n}@Example.test`, name },
    },
    createCtx({ orgId: a.org.id, now: new Date('2027-11-01T00:00:00Z') }),
    ports,
  );
  return r.manageToken;
}
const submit = (manageToken: string, rating = 5, body: string | null = 'Loved it', ctx = anon()) =>
  executeCommand(submitReviewCommand, { manageToken, rating, body }, ctx, ports);
const list = (filter: 'all' | 'visible' | 'hidden' | 'reported' = 'all', ctx = a.ctx()) =>
  executeQuery(listReviewsQuery, { eventId, filter }, ctx, ports);

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  const e = await executeCommand(
    createEventCommand,
    {
      name: `Reviews ${a.org.slug}`,
      timezone: 'America/Chicago',
      startsAt: '2027-12-01T18:00:00Z',
      endsAt: ENDS.toISOString(),
    },
    a.ctx(),
    ports,
  );
  eventId = e.id;
  freeId = (
    await executeCommand(
      createTicketTypeCommand,
      { eventId, name: 'Free', priceMinor: 0, quantityTotal: 100 },
      a.ctx(),
      ports,
    )
  ).id;
  await executeCommand(transitionEventCommand, { eventId, transition: 'publish' }, a.ctx(), ports);
});
afterAll(closePools);

describe('reviews (M1.4g)', () => {
  it('a holder of a future (not yet ended) event is refused with not_ended', async () => {
    const token = await buy('early');
    await expect(submit(token, 5, 'x', anon(BEFORE))).rejects.toMatchObject({
      code: 'invalid_state',
      details: { reason: 'not_ended', opensAt: ENDS.toISOString() },
    });
    const state = await reviewStateForOrder(a.org.id, token, BEFORE);
    expect(state?.eligibility).toMatchObject({ ok: false, reason: 'not_ended' });
  });

  it('a holder of a past event reviews once; "First L." only, no email anywhere public', async () => {
    const token = await buy(1, 'Maria Garcia');
    const mine = await submit(token, 4, '  Great night ‮ ');
    expect(mine).toMatchObject({ rating: 4, body: 'Great night', status: 'visible' });
    await expect(submit(token, 5)).rejects.toMatchObject({
      code: 'conflict',
      details: { reason: 'already_reviewed' },
    });
    const state = await reviewStateForOrder(a.org.id, token, AFTER);
    expect(state?.review).toMatchObject({ rating: 4 });
    expect(state?.eligibility).toMatchObject({ ok: false, reason: 'already_reviewed' });
    const pub = await publicReviews(a.org.id, eventId);
    expect(pub.recent[0]).toMatchObject({ rating: 4, body: 'Great night', author: 'Maria G.' });
    expect(JSON.stringify(pub).toLowerCase()).not.toContain('reviewer1@example.test');
    expect(Object.keys(pub.recent[0] ?? {}).sort()).toEqual(['author', 'body', 'createdAt', 'id', 'rating']);
    const [stored] = await withTenant(a.ctx(), (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from reviews.reviews where author_key ilike '%@%' or body ilike '%@example%'`,
      ),
    );
    expect(stored?.n).toBe(0);
  });

  it('one review per holder holds under concurrency', async () => {
    const token = await buy('race');
    const results = await Promise.allSettled([submit(token, 5), submit(token, 3), submit(token, 1)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    for (const r of results.filter((x) => x.status === 'rejected'))
      expect((r as PromiseRejectedResult).reason).toMatchObject({ code: 'conflict' });
  });

  it('the same person with two orders still reviews once (keyed by holder, not order)', async () => {
    const t1 = await buy('twice');
    const t2 = await buy('twice');
    await submit(t1, 5);
    await expect(submit(t2, 1)).rejects.toMatchObject({ code: 'conflict' });
  });

  it('refuses unknown tokens, other orgs, and a cancelled event', async () => {
    await expect(submit('x'.repeat(43))).rejects.toMatchObject({ code: 'not_found' });
    const token = await buy('other-org');
    // The token belongs to org A: under org B's RLS it does not exist.
    await expect(submit(token, 5, null, anon(AFTER, b.org.id))).rejects.toMatchObject({ code: 'not_found' });
    expect(await reviewStateForOrder(b.org.id, token, AFTER)).toBeNull();
    await expect(
      executeCommand(submitReviewCommand, { manageToken: token, rating: 9 }, anon(), ports),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('aggregate counts visible reviews only; hide/unhide need a reason and are audited', async () => {
    const before = await publicReviews(a.org.id, eventId);
    expect(before.count).toBe(3);
    const race = (await list()).reviews.find((r) => r.author === 'Buyer R.')?.rating ?? 0;
    expect(before.average).toBeCloseTo((4 + 5 + race) / 3, 1);
    const target = (await list()).reviews.find((r) => r.author === 'Maria G.');
    if (!target) throw new Error('missing review');
    const viewer = userCtx(a.viewerId, a.org.id);
    // Viewers read the moderation list but can't moderate.
    expect((await list('all', viewer)).reviews.length).toBe(3);
    await expect(
      executeCommand(
        hideReviewCommand,
        { eventId, reviewId: target.id, reason: 'Contains a phone number' },
        viewer,
        ports,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      executeCommand(hideReviewCommand, { eventId, reviewId: target.id, reason: 'x' }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    // Another org can't see or hide it.
    await expect(
      executeCommand(
        hideReviewCommand,
        { eventId, reviewId: target.id, reason: 'Not yours' },
        b.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'not_found' });

    await executeCommand(
      hideReviewCommand,
      { eventId, reviewId: target.id, reason: 'Contains a phone number' },
      a.ctx(),
      ports,
    );
    const after = await publicReviews(a.org.id, eventId);
    expect(after.count).toBe(2);
    expect(after.recent.some((r) => r.id === target.id)).toBe(false);
    expect((await list('hidden')).reviews).toEqual([
      expect.objectContaining({ id: target.id, hiddenReason: 'Contains a phone number' }),
    ]);
    await expect(
      executeCommand(
        hideReviewCommand,
        { eventId, reviewId: target.id, reason: 'Again please' },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'invalid_state' });
    await executeCommand(
      unhideReviewCommand,
      { eventId, reviewId: target.id, reason: 'Number removed' },
      a.ctx(),
      ports,
    );
    expect((await publicReviews(a.org.id, eventId)).count).toBe(3);

    const audit = await withTenant(a.ctx(), (tx) =>
      tx.execute<{ action: string; data: { reason?: string } }>(
        sql`select action, data from platform.audit_events where target_id = ${target.id} order by seq`,
      ),
    );
    expect(audit.map((r) => [r.action, r.data.reason])).toEqual([
      ['review.hide', 'Contains a phone number'],
      ['review.unhide', 'Number removed'],
    ]);
    const events = await withTenant(a.ctx(), (tx) =>
      tx.execute<{ type: string }>(
        sql`select type from platform.domain_events where aggregate_id = ${target.id} order by id`,
      ),
    );
    expect(events.map((e) => e.type)).toEqual(['review.submitted', 'review.hidden', 'review.unhidden']);
  });

  it('reports: once per device, listed for moderation, dismissed or actioned by hiding', async () => {
    const [first, second] = (await list('visible')).reviews;
    if (!first || !second) throw new Error('missing reviews');
    const report = (reviewId: string, clientKey: string, orgId = a.org.id) =>
      executeCommand(
        reportReviewCommand,
        { reviewId, reason: 'offensive', note: 'Rude', clientKey },
        createCtx({ orgId }),
        ports,
      );
    await report(first.id, 'device-aaaaaaaaaaaa');
    await report(first.id, 'device-aaaaaaaaaaaa');
    await report(first.id, 'device-bbbbbbbbbbbb');
    await expect(report(first.id, 'device-cccccccccccc', b.org.id)).rejects.toMatchObject({
      code: 'not_found',
    });
    const reported = (await list('reported')).reviews;
    expect(reported.map((r) => [r.id, r.openReports])).toEqual([[first.id, 2]]);
    const dismissed = await executeCommand(
      dismissReportsCommand,
      { eventId, reviewId: first.id },
      a.ctx(),
      ports,
    );
    expect(dismissed.dismissed).toBe(2);
    expect((await list('reported')).reviews).toEqual([]);

    await report(second.id, 'device-dddddddddddd');
    await executeCommand(
      hideReviewCommand,
      { eventId, reviewId: second.id, reason: 'Abusive language' },
      a.ctx(),
      ports,
    );
    const row = (await list('hidden')).reviews.find((r) => r.id === second.id);
    expect(row?.reports.map((r) => r.status)).toEqual(['actioned']);
    // A hidden review can't be reported.
    await expect(report(second.id, 'device-eeeeeeeeeeee')).rejects.toMatchObject({ code: 'not_found' });
  });
});
