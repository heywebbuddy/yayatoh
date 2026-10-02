import {
  createJourneyCommand,
  journeyTriggers,
  setJourneyEnabledCommand,
  visionTemplate,
} from '@yayatoh/automations';
import { setPlatformAuditSink } from '@yayatoh/db/platform';
import { type AdminSql, adminClient, closePools } from '@yayatoh/db/testing';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { createCtx, executeCommand } from '@yayatoh/kernel';
import { startCheckoutCommand } from '@yayatoh/orders';
import { catchUpSubscriber } from '@yayatoh/platform';
import { type OrgFixture, ports, twoOrgs } from '@yayatoh/testing';
import { createTicketTypeCommand } from '@yayatoh/ticketing';
import type { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { enqueueJourneyWork, JOURNEY_JOB, journeyJob } from '../src/journeys.ts';
import { subscribers } from '../src/registry.ts';
import { startWorker } from '../src/worker.ts';

/**
 * M3.7a: journey steps run as the pg-boss job `automations.run-due`, one job per org at a time
 * (an exclusive queue keyed by the org), queued by the leader's tick for orgs the SECURITY
 * DEFINER finder reports (platform_reader, audited).
 */
let a: OrgFixture;
let boss: PgBoss;
let admin: AdminSql;
let journeyId: string;
const audited: string[] = [];
const copy = { subject: 'Hi {name}', body: 'See you at {event}.' };

async function until(check: () => Promise<boolean>, ms = 30_000) {
  const deadline = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 200));
  }
}

beforeAll(async () => {
  setPlatformAuditSink(async ({ actor }) => void audited.push(actor));
  ({ a } = await twoOrgs());
  admin = adminClient();
  const start = new Date(Date.now() + 20 * 86_400_000);
  const ev = await executeCommand(
    createEventCommand,
    {
      name: 'Worker Journey',
      timezone: 'UTC',
      startsAt: start.toISOString(),
      endsAt: new Date(start.getTime() + 4 * 3_600_000).toISOString(),
    },
    a.ctx(),
    ports,
  );
  const pass = await executeCommand(
    createTicketTypeCommand,
    { eventId: ev.id, name: 'Pass', priceMinor: 0, quantityTotal: 10 },
    a.ctx(),
    ports,
  );
  await executeCommand(transitionEventCommand, { eventId: ev.id, transition: 'publish' }, a.ctx(), ports);
  const t = visionTemplate({ confirmation: copy, week: copy, day: copy, eventDay: copy });
  ({ id: journeyId } = await executeCommand(
    createJourneyCommand,
    { name: 'Worker', eventId: ev.id, ...t },
    a.ctx(),
    ports,
  ));
  await executeCommand(setJourneyEnabledCommand, { journeyId, enabled: true }, a.ctx(), ports);
  await executeCommand(
    startCheckoutCommand,
    {
      eventId: ev.id,
      items: [{ ticketTypeId: pass.id, quantity: 1 }],
      buyer: { email: 'wanda.worker@example.test', name: 'Wanda' },
    },
    createCtx({ orgId: a.org.id }),
    ports,
  );
  await catchUpSubscriber(journeyTriggers(), a.org.id);
  boss = await startWorker({
    connectionString: process.env.MIGRATOR_DATABASE_URL as string,
    jobs: [journeyJob()],
  });
});
afterAll(async () => {
  await boss?.stop({ graceful: false });
  await admin?.end();
  await closePools();
});

describe('journey job (M3.7a, pg-boss)', () => {
  it('the worker composes the journey subscribers', () => {
    const names = subscribers({
      APP_TOKEN_SECRET: 'x'.repeat(32),
      NEXT_PUBLIC_APP_ORIGIN: 'https://app.test',
    }).map((s) => s.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'automations.journey-triggers',
        'automations.journey-cancellations',
        'automations.journey-rescheduler',
      ]),
    );
  });

  it('one job per org at a time; the queued job runs the due step once', async () => {
    const first = await boss.send(
      JOURNEY_JOB,
      { orgId: a.org.id },
      { singletonKey: a.org.id, startAfter: 60 },
    );
    const second = await boss.send(JOURNEY_JOB, { orgId: a.org.id }, { singletonKey: a.org.id });
    expect(first).not.toBeNull();
    expect(second).toBeNull();
    await boss.cancel(JOURNEY_JOB, first as string);

    expect(await enqueueJourneyWork(boss, new Set([a.org.id]))).toBe(1);
    expect(audited).toContain('system:journeys');
    await until(async () => {
      const [row] = await admin<{ status: string }[]>`
        select status from automations.scheduled_actions where journey_id = ${journeyId} and position = 0`;
      return row?.status === 'done';
    });
    const sent = await admin`select id from notifications.messages
      where org_id = ${a.org.id} and kind = 'automations.message'`;
    expect(sent).toHaveLength(1);
    // Nothing due any more for this org: the steps left wait for their days.
    await until(async () => (await enqueueJourneyWork(boss, new Set([a.org.id]))) === 0);
  });
});
