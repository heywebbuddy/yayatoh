import { withoutTenant } from '@yayatoh/db';
import { databaseAuditSink, setPlatformAuditSink, withPlatformReader } from '@yayatoh/db/platform';
import { closePools } from '@yayatoh/db/testing';
import {
  fakeStatusPage,
  incidentBanner,
  postFakeIncident,
  postFakeIncidentSql,
  updateFakeIncident,
  updateFakeIncidentSql,
} from '@yayatoh/platform';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

beforeAll(() => setPlatformAuditSink(databaseAuditSink));
afterAll(async () => {
  // Leave no open incident behind for other suites.
  await withPlatformReader(
    { actor: 'test', reason: 'close test incidents' },
    (tx) =>
      tx.execute(
        sql`select platform.status_fake_update(id, 'resolved', 'Test cleanup') from platform.status_fake_recent(90) where resolved_at is null`,
      ),
    { callsWritingFunctions: true },
  );
  await closePools();
});

const tag = `t${Date.now().toString(36)}`;
/** The database's own message (drizzle wraps it as "Failed query: …" with the cause). */
const dbError = (p: Promise<unknown>) =>
  p.then(
    () => 'no error',
    (e: { cause?: { message?: string }; message: string }) => e.cause?.message ?? e.message,
  );

describe('fake status page (M3.11b)', () => {
  it('app_user reads only through the function; the table itself is closed', async () => {
    expect(
      await dbError(
        withoutTenant((tx) => tx.execute(sql`select count(*) from platform.status_fake_incidents`)),
      ),
    ).toMatch(/permission denied/);
    expect(
      await dbError(
        withoutTenant((tx) =>
          tx.execute(
            sql`insert into platform.status_fake_incidents (title, impact, status, created_by) values ('x','minor','investigating','x')`,
          ),
        ),
      ),
    ).toMatch(/permission denied/);
  });

  it('staff post an incident (platform_reader, audited); it shows on the page and in the banner; updates resolve it', async () => {
    const [row] = await withPlatformReader(
      { actor: 'staff:test', reason: `staff console: post status incident ${tag}` },
      (tx) =>
        tx.execute<{ id: string }>(
          postFakeIncidentSql(
            {
              title: `Scanner sync delayed ${tag}`,
              impact: 'major',
              components: ['checkin'],
              body: 'Looking into it.',
            },
            'staff:test',
          ),
        ),
      { callsWritingFunctions: true },
    );
    const id = row?.id ?? '';
    let snap = await fakeStatusPage.snapshot();
    const mine = snap.incidents.find((i) => i.id === id);
    expect(mine).toMatchObject({
      status: 'investigating',
      active: true,
      impact: 'major',
      components: ['checkin'],
    });
    expect(snap.components.find((c) => c.key === 'checkin')?.status).toBe('partial_outage');
    expect(['partial_outage', 'major_outage']).toContain(snap.overall);
    expect(incidentBanner(snap)).not.toBeNull();

    await withPlatformReader(
      { actor: 'staff:test', reason: 'update' },
      (tx) => tx.execute(updateFakeIncidentSql({ id, status: 'identified', body: 'Cause found.' })),
      { callsWritingFunctions: true },
    );
    expect(await updateFakeIncident({ id, status: 'resolved', body: 'Fixed.' })).toBe(true);
    // A closed incident takes no more updates.
    expect(await updateFakeIncident({ id, status: 'monitoring', body: 'Again?' })).toBe(false);
    snap = await fakeStatusPage.snapshot();
    const done = snap.incidents.find((i) => i.id === id);
    expect(done).toMatchObject({ status: 'resolved', active: false });
    expect(done?.updates.map((u) => u.status)).toEqual(['resolved', 'identified', 'investigating']);
    expect(done?.resolvedAt).toBeInstanceOf(Date);

    const [log] = await withPlatformReader({ actor: 'test', reason: 'read log' }, (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from platform.access_log where reason like ${`%${tag}`}`,
      ),
    );
    expect(log?.n).toBe(1);
  });

  it('maintenance starts in progress; the database refuses bad values', async () => {
    const id = await postFakeIncident(
      { title: `Upgrade ${tag}`, impact: 'maintenance', components: ['api'], body: 'Planned upgrade.' },
      'dev:e2e',
    );
    const snap = await fakeStatusPage.snapshot();
    expect(snap.incidents.find((i) => i.id === id)).toMatchObject({
      status: 'in_progress',
      impact: 'maintenance',
    });
    expect(snap.components.find((c) => c.key === 'api')?.status).toBe('maintenance');
    await updateFakeIncident({ id: id ?? '', status: 'completed', body: 'Done.' });
    expect(
      await dbError(
        withoutTenant((tx) =>
          tx.execute(sql`select platform.status_fake_post('x', 'apocalyptic', '{}'::text[], 'b', 'a')`),
        ),
      ),
    ).toMatch(/check constraint/);
    expect(
      await dbError(
        withoutTenant((tx) =>
          tx.execute(sql`select platform.status_fake_post('x', 'minor', '{}'::text[], '', 'a')`),
        ),
      ),
    ).toMatch(/invalid body/);
  });
});
