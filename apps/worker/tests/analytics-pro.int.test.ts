import { createAlertRuleCommand, createReportScheduleCommand } from '@yayatoh/analytics';
import { setPlatformAuditSink } from '@yayatoh/db/platform';
import { type AdminSql, adminClient, closePools } from '@yayatoh/db/testing';
import { executeCommand } from '@yayatoh/kernel';
import { createNotifier } from '@yayatoh/notifications';
import { type OrgFixture, ports, twoOrgs } from '@yayatoh/testing';
import type { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ANALYTICS_TICK_JOB,
  analyticsTickJob,
  enqueueAnalyticsTicks,
  orgsWithAnalyticsWork,
} from '../src/analytics-pro.ts';
import { startWorker } from '../src/worker.ts';

/**
 * M6.2b: the leader's minute tick finds orgs with alert rules or report schedules (platform_reader,
 * audited) and queues one `analytics.tick` per org (exclusive per org); the job evaluates the rules
 * and sends the due reports — each period once, however many times the job runs.
 */
let a: OrgFixture;
let b: OrgFixture;
let boss: PgBoss;
let admin: AdminSql;
const audited: string[] = [];
const rendered: string[] = [];

async function until(check: () => Promise<boolean>, ms = 30_000) {
  const deadline = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 200));
  }
}

beforeAll(async () => {
  setPlatformAuditSink(async ({ actor }) => void audited.push(actor));
  ({ a, b } = await twoOrgs());
  admin = adminClient();
  boss = await startWorker({
    connectionString: process.env.MIGRATOR_DATABASE_URL as string,
    jobs: [
      analyticsTickJob({
        notifier: createNotifier(),
        renderer: {
          render: async ({ html }) => {
            rendered.push(html);
            return new TextEncoder().encode('%PDF-1.7 worker test');
          },
        },
        userLocales: async () => new Map(),
      }),
    ],
  });
}, 600_000);
afterAll(async () => {
  await boss?.stop({ graceful: false });
  await admin.end();
  await closePools();
});

describe('analytics tick in the worker (M6.2b)', () => {
  it('finds orgs with rules or schedules, audited, and queues one tick per org', async () => {
    // The fixture gave both orgs a rule and a schedule.
    const orgs = await orgsWithAnalyticsWork();
    expect(orgs).toEqual(expect.arrayContaining([a.org.id, b.org.id]));
    expect(audited).toContain('system:analytics');
    expect(await enqueueAnalyticsTicks(boss, new Set([a.org.id]))).toBe(1);
    // One queued job per singleton key at a time (the queue is exclusive).
    const key = `probe-${a.org.id}`;
    const first = await boss.send(
      ANALYTICS_TICK_JOB,
      { orgId: a.org.id },
      { singletonKey: key, startAfter: 60 },
    );
    const second = await boss.send(ANALYTICS_TICK_JOB, { orgId: a.org.id }, { singletonKey: key });
    expect(first).not.toBeNull();
    expect(second).toBeNull();
    await boss.cancel(ANALYTICS_TICK_JOB, first as string);
  });

  it('the job sends a due report once, whatever runs it', async () => {
    const s = await executeCommand(
      createReportScheduleCommand,
      { name: `Worker daily ${Date.now()}`, frequency: 'daily', sendHour: 0, recipients: [b.ownerId] },
      b.ctx(),
      ports,
    );
    await admin`update analytics.report_schedules set active_since = now() - interval '3 days' where id = ${s.id}`;
    await executeCommand(
      createAlertRuleCommand,
      {
        name: `Worker rule ${Date.now()}`,
        measure: 'registrations',
        condition: 'above',
        threshold: 0,
        windowDays: 30,
      },
      b.ctx(),
      ports,
    );
    const runs = () =>
      admin<{ period_key: string; status: string }[]>`
        select period_key, status from analytics.report_runs where schedule_id = ${s.id} order by period_key`;
    for (let i = 0; i < 3; i++)
      await boss.send(ANALYTICS_TICK_JOB, { orgId: b.org.id }, { singletonKey: `${b.org.id}:${i}` });
    await until(async () => (await runs()).filter((r) => r.status === 'sent').length >= 2);
    await new Promise((r) => setTimeout(r, 1500));
    const sent = await runs();
    expect(new Set(sent.map((r) => r.period_key)).size).toBe(sent.length);
    const [mails] = await admin<{ n: number }[]>`
      select count(*)::int as n from notifications.messages
      where org_id = ${b.org.id} and channel = 'email' and dedupe_key like ${`report:${s.id}:%`}`;
    expect(mails?.n).toBe(sent.length);
  });
});
