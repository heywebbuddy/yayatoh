import { saveSegmentCommand } from '@yayatoh/audiences';
import {
  campaignNamesQuery,
  campaignNamesTx,
  createCampaignCommand,
  runOrgCampaigns,
  saveCampaignCommand,
  sendNowCommand,
  setAudienceCommand,
  testSendCommand,
} from '@yayatoh/campaigns';
import { campaignsWidget } from '@yayatoh/command-center';
import { recordConsentTx, upsertContactTx } from '@yayatoh/crm';
import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { createEventCommand } from '@yayatoh/events';
import { executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import { analyticsReportQuery, campaignDetailQuery } from '@yayatoh/marketing';
import { dispatchDue, memoryTransports } from '@yayatoh/notifications';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs } from '../src/index.ts';

/**
 * Batch 3g wiring: M3.8b's marketing analytics on M3.6b's real campaigns. A campaign sent through
 * the scheduler and the dispatcher shows up under its own key (`c.{campaignId}`, from its tracked
 * links' `campaign_id` and its messages' dedupe keys) with exactly its sends; test sends never
 * count; the Command Center tile and the console name it from M3.6b (its current name, through
 * the campaigns module's public read), never from another module's schema.
 */

let a: OrgFixture;
let b: OrgFixture;

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
});
afterAll(closePools);

const ORIGIN = 'https://app.yayatoh.test';
/** A weekday noon in Chicago (no quiet hours), and an hour later for the reads. */
const NOON = new Date('2030-07-16T17:00:00Z');
const LATER = new Date('2030-07-16T18:00:00Z');
const DAY = '2030-07-16';

async function person(org: OrgFixture, email: string) {
  const ctx = systemCtx(org.org.id);
  await withTenant(ctx, async (tx) => {
    const { id } = await upsertContactTx(tx, ctx, { email, name: 'Rae Contact', source: 'manual' });
    await recordConsentTx(tx, ctx, {
      contactId: id,
      channel: 'email',
      purpose: 'marketing',
      status: 'granted',
      evidence: 'test',
    });
  });
}

describe('campaign analytics on M3.6b campaigns (batch 3g wiring)', () => {
  it('counts a sent campaign under its own key with exactly its sends, and names it from M3.6b', async () => {
    const t = uuidv7().slice(-8);
    await person(b, `ca1+${t}@x.test`);
    await person(b, `ca2+${t}@x.test`);
    // Its own event: the event-scoped tile then lists this campaign alone.
    const event = await executeCommand(
      createEventCommand,
      {
        name: `Analytics wiring ${t}`,
        slug: `ca-${t}`,
        timezone: 'America/Chicago',
        startsAt: '2030-08-01T00:00:00.000Z',
        endsAt: '2030-08-01T04:00:00.000Z',
      },
      b.ctx(),
      ports,
    );
    const c = await executeCommand(
      createCampaignCommand,
      { name: `Summer ${t}`, channel: 'email' },
      b.ctx(),
      ports,
    );
    const content = {
      subject: 'Summer for {{first_name|you}}',
      preheader: '',
      font: 'sans' as const,
      smsBody: '',
      blocks: [
        { id: 'b1', type: 'heading' as const, text: 'Hello {{first_name|there}}' },
        { id: 'b2', type: 'button' as const, label: 'Get tickets', eventId: event.id, path: null },
        { id: 'b3', type: 'footer' as const, postalAddress: '1 Lake St, Chicago IL 60601', note: '' },
      ],
    };
    await executeCommand(
      saveCampaignCommand,
      { campaignId: c.id, name: c.name, locale: 'en', content },
      b.ctx(),
      ports,
    );
    // A test send creates the tracked links, labelled with the name at the time…
    await executeCommand(
      testSendCommand,
      { campaignId: c.id, addresses: [`proof+${t}@x.test`] },
      b.ctx(),
      ports,
    );
    // …then the campaign is renamed before it goes out.
    await executeCommand(
      saveCampaignCommand,
      { campaignId: c.id, name: `Summer launch ${t}`, locale: 'en', content },
      b.ctx(),
      ports,
    );
    const seg = await executeCommand(
      saveSegmentCommand,
      {
        name: `Wiring ${t}`,
        definition: {
          version: 1,
          root: {
            type: 'group',
            op: 'and',
            conditions: [{ type: 'consent', channel: 'email', granted: true }],
          },
        },
      },
      b.ctx(),
      ports,
    );
    await executeCommand(
      setAudienceCommand,
      { campaignId: c.id, audience: { kind: 'segment', segmentId: seg.id } },
      b.ctx(),
      ports,
    );
    await executeCommand(
      sendNowCommand,
      { campaignId: c.id },
      b.ctx({ idempotencyKey: `wiring-${c.id}`, now: NOON }),
      ports,
    );
    await runOrgCampaigns(b.org.id, ports, { now: NOON });
    const mem = memoryTransports();
    for (let i = 0; i < 20; i++) {
      const r = await dispatchDue(
        b.org.id,
        { transports: mem.transports, appOrigin: ORIGIN, now: () => NOON },
        200,
      );
      if (r.sent + r.suppressed + r.failed + r.held === 0) break;
    }
    const sent = await withTenant(systemCtx(b.org.id), (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from notifications.messages
          where dedupe_key like ${`campaign:${c.id}:%`} and status = 'sent'`,
      ),
    );
    const sends = Number(sent[0]?.n ?? 0);
    expect(sends).toBeGreaterThanOrEqual(2);

    // Marketing analytics: the campaign's own row, its sends exactly (the test send not counted).
    const ctx = b.ctx({ now: LATER });
    const report = await executeQuery(
      analyticsReportQuery,
      { dimension: 'campaign', from: DAY, to: DAY },
      ctx,
      ports,
    );
    const row = report.rows.find((r) => r.key === `c.${c.id}`);
    expect(row).toMatchObject({ kind: 'campaign', sends, clicks: 0 });
    // On its own, marketing names it after its links' label (the name when they were made).
    expect(row?.name).toBe(`Summer ${t}`);
    const detail = await executeQuery(
      campaignDetailQuery,
      { key: `c.${c.id}`, from: DAY, to: DAY },
      ctx,
      ports,
    );
    expect(detail.delivery).toMatchObject({ channels: ['email'], sent: sends });
    expect(detail.links).toHaveLength(1);

    // M3.6b's public read gives the current name; the tile uses it through its port.
    expect(await executeQuery(campaignNamesQuery, { ids: [c.id] }, ctx, ports)).toEqual([
      { id: c.id, name: `Summer launch ${t}` },
    ]);
    const tile = (names: Parameters<typeof campaignsWidget>[0]) =>
      executeQuery(campaignsWidget(names).loader, { eventId: event.id }, ctx, ports);
    const named = await tile(campaignNamesTx);
    expect(named.campaigns).toEqual([
      expect.objectContaining({ key: `c.${c.id}`, kind: 'campaign', name: `Summer launch ${t}`, sends }),
    ]);
    expect(named.totals.sends).toBe(sends);
    expect((await tile(null)).campaigns[0]?.name).toBe(`Summer ${t}`);

    // Another org learns nothing: no names, no row.
    expect(await executeQuery(campaignNamesQuery, { ids: [c.id] }, a.ctx({ now: LATER }), ports)).toEqual([]);
    const other = await executeQuery(
      analyticsReportQuery,
      { dimension: 'campaign', from: DAY, to: DAY },
      a.ctx({ now: LATER }),
      ports,
    );
    expect(other.rows.find((r) => r.key === `c.${c.id}`)).toBeUndefined();
  }, 120_000);
});
