import 'server-only';
import { withPlatformReader } from '@yayatoh/db/platform';
import {
  type FakeIncidentRow,
  fakeIncident,
  type PostIncidentInput,
  postFakeIncidentSql,
  STATUS_HISTORY_DAYS,
  type StatusIncident,
  type UpdateIncidentInput,
  updateFakeIncidentSql,
} from '@yayatoh/platform';
import { sql } from 'drizzle-orm';
import type { Staff } from './staff.ts';

/**
 * Status-page incidents from the staff console (M3.11b). With the fake provider (development,
 * preview, CI) staff post and update them here, through the audited platform_reader and the
 * SECURITY DEFINER `platform.status_fake_*` functions. With Better Stack (production) incidents
 * are posted in Better Stack itself and this page only links there.
 */
export function incidentProvider(): 'fake' | 'betterstack' {
  const production = process.env.VERCEL_ENV === 'production';
  const provider = process.env.STATUS_PAGE_PROVIDER || (production ? 'betterstack' : 'fake');
  return provider === 'fake' && !production ? 'fake' : 'betterstack';
}

export async function listIncidents(staff: Staff): Promise<StatusIncident[]> {
  const rows = await withPlatformReader(
    { actor: staff.actor, reason: 'staff console: list status incidents' },
    (tx) =>
      tx.execute<FakeIncidentRow>(
        sql`select id::text as id, title, impact, status, components, updates, started_at, resolved_at
          from platform.status_fake_recent(${STATUS_HISTORY_DAYS})`,
      ),
  );
  return [...rows].map(fakeIncident);
}

export async function postIncident(staff: Staff, input: PostIncidentInput): Promise<string | null> {
  const [row] = await withPlatformReader(
    { actor: staff.actor, reason: `staff console: post status incident (${input.impact}): ${input.title}` },
    (tx) => tx.execute<{ id: string }>(postFakeIncidentSql(input, staff.actor)),
    { callsWritingFunctions: true },
  );
  return row?.id ?? null;
}

export async function updateIncident(staff: Staff, input: UpdateIncidentInput): Promise<boolean> {
  const [row] = await withPlatformReader(
    { actor: staff.actor, reason: `staff console: update status incident ${input.id} (${input.status})` },
    (tx) => tx.execute<{ updated: boolean }>(updateFakeIncidentSql(input)),
    { callsWritingFunctions: true },
  );
  return row?.updated === true;
}
