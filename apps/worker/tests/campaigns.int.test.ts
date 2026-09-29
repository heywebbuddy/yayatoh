import { saveSegmentCommand } from '@yayatoh/audiences';
import {
  createCampaignCommand,
  saveCampaignCommand,
  sendNowCommand,
  setAudienceCommand,
} from '@yayatoh/campaigns';
import { withTenant } from '@yayatoh/db';
import { setPlatformAuditSink } from '@yayatoh/db/platform';
import { closePools } from '@yayatoh/db/testing';
import { executeCommand } from '@yayatoh/kernel';
import { createNotifier, dispatchDue, memoryTransports } from '@yayatoh/notifications';
import { type OrgFixture, ports, systemCtx, twoOrgs } from '@yayatoh/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { campaignTick, releaseAllocation } from '../src/campaigns.ts';

/**
 * M3.6b acceptance: "a 50k send stays fair across tenants". Org A sends to 50,000 people while
 * org B sends to 100; the leader's tick hands out recipients round-robin across orgs within each
 * org's per-minute rate, so B's campaign (and its transactional mail) goes out within its fair
 * share of the first ticks. Time is compressed: every tick is 2 s of the scheduler's clock, the
 * fake transport sends instantly.
 */
let a: OrgFixture;
let b: OrgFixture;
const BASE = new Date('2032-02-03T17:00:00Z'); // a Tuesday noon in Chicago: no quiet hours
const TICK_MS = 2_000;
const audited: string[] = [];

async function seedSubscribers(org: OrgFixture, n: number, prefix: string) {
  const ctx = systemCtx(org.org.id);
  await withTenant(ctx, async (tx) => {
    await tx.execute(sql`
      insert into crm.contacts (org_id, email, email_norm, name, source)
      select ${org.org.id}::uuid, ${prefix} || g || '@fans.test', ${prefix} || g || '@fans.test', 'Fan ' || g, 'import'
      from generate_series(1, ${n}) g`);
    await tx.execute(sql`
      insert into crm.consents (org_id, contact_id, channel, purpose, status, evidence, captured_at)
      select org_id, id, 'email', 'marketing', 'granted', 'fairness-test', now()
      from crm.contacts where email_norm like ${`${prefix}%@fans.test`}`);
    // The profile rows the projector would write (its rebuild over 50k fresh, unanalyzed rows is
    // slow to plan in a test database; production rebuilds per changed contact).
    await tx.execute(sql`
      insert into crm.contact_profile (org_id, contact_id, email_consent)
      select org_id, id, 'granted' from crm.contacts where email_norm like ${`${prefix}%@fans.test`}
      on conflict (org_id, contact_id) do update set email_consent = 'granted'`);
  });
}

async function subscribersCampaign(org: OrgFixture, name: string) {
  const seg = await executeCommand(
    saveSegmentCommand,
    {
      name: `Subscribers ${name}`,
      definition: {
        version: 1,
        root: { type: 'group', op: 'and', conditions: [{ type: 'consent', channel: 'email', granted: true }] },
      },
    },
    org.ctx(),
    ports,
  );
  const c = await executeCommand(createCampaignCommand, { name }, org.ctx(), ports);
  await executeCommand(
    saveCampaignCommand,
    {
      campaignId: c.id,
      name,
      locale: 'en',
      content: {
        subject: 'Hello {{first_name|there}}',
        preheader: '',
        font: 'sans',
        smsBody: '',
        blocks: [
          { id: 'b1', type: 'text', text: 'Season tickets are on sale.' },
          { id: 'b2', type: 'footer', postalAddress: '1 Lake St, Chicago IL', note: '' },
        ],
      },
    },
    org.ctx(),
    ports,
  );
  await executeCommand(setAudienceCommand, { campaignId: c.id, audience: { kind: 'segment', segmentId: seg.id } }, org.ctx(), ports);
  return executeCommand(sendNowCommand, { campaignId: c.id }, org.ctx({ idempotencyKey: `fair-${c.id}`, now: BASE }), ports);
}

beforeAll(async () => {
  setPlatformAuditSink(async ({ actor }) => void audited.push(actor));
  ({ a, b } = await twoOrgs());
  await seedSubscribers(a, 50_000, 'a');
  await seedSubscribers(b, 100, 'b');
}, 300_000);
afterAll(closePools);

describe('fair scheduling across tenants', () => {
  it('org A sends 50,000 while org B sends 100: B finishes within its fair share, A stays within its rate', async () => {
    const t0 = Date.now();
    const bigOne = await subscribersCampaign(a, 'Big season launch');
    const snapshotMs = Date.now() - t0;
    const small = await subscribersCampaign(b, 'Small recital');
    expect(bigOne.status).toBe('sending');
    expect(small.status).toBe('sending');
    const only = new Set([a.org.id, b.org.id]);
    const mem = memoryTransports();
    const sentTo = (suffix: string) => mem.emails.filter((e) => e.to.endsWith(suffix)).length;
    const releasedA: number[] = [];
    let bDoneTick: number | null = null;
    let bTransactionalTick: number | null = null;
    for (let tick = 0; tick < 8; tick++) {
      const now = new Date(BASE.getTime() + (tick + 1) * TICK_MS);
      const r = await campaignTick({
        now,
        tick,
        onlyOrgs: only,
        release: (al) => releaseAllocation(al, now),
      });
      releasedA.push(r.allocations.filter((x) => x.orgId === a.org.id).reduce((n, x) => n + x.size, 0));
      if (tick === 1)
        // B's transactional mail arrives while A's 50k send is running.
        await withTenant(systemCtx(b.org.id), (tx) =>
          createNotifier().enqueue(tx, {
            kind: 'tenancy.invitation',
            to: { email: 'invitee-fair@b.test' },
            params: { url: 'https://app.test/i', role: 'manager', orgName: 'Bravo' },
            dedupeKey: `fair-invite-${b.org.id}`,
          }),
        );
      // The dispatcher's tick: up to 100 messages per org (as the worker does).
      for (const org of [a, b]) await dispatchDue(org.org.id, { transports: mem.transports, appOrigin: 'https://app.test', now: () => now }, 100);
      if (bDoneTick === null && sentTo('@fans.test') > 0 && mem.emails.filter((e) => /^b\d+@fans\.test$/.test(e.to)).length === 100)
        bDoneTick = tick;
      if (bTransactionalTick === null && mem.emails.some((e) => e.to === 'invitee-fair@b.test')) bTransactionalTick = tick;
    }
    // B: 100 recipients, released in the first tick (its half of the 500 capacity covers them) and
    // delivered as soon as its dispatcher share allows (100 per tick).
    expect(bDoneTick).not.toBeNull();
    expect(bDoneTick ?? 99).toBeLessThanOrEqual(1);
    expect(bTransactionalTick).toBe(1);
    // A: never more than its 1,000 per minute (default email quota 10,000 ⇒ 1,000/min), still going.
    expect(releasedA.reduce((n, x) => n + x, 0)).toBeLessThanOrEqual(1_000);
    expect(releasedA[0]).toBeGreaterThan(0);
    expect(mem.emails.filter((e) => /^a\d+@fans\.test$/.test(e.to)).length).toBeLessThanOrEqual(1_000);
    // Every cross-org read of the tick was through the audited platform reader.
    expect(audited).toContain('system:campaigns');
    console.info(JSON.stringify({ snapshotMs, releasedA, bDoneTick }));
  }, 600_000);
});
