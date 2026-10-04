import { virtualAttendanceSubscriber } from '@yayatoh/checkin';
import { withTenant } from '@yayatoh/db';
import { createCtx, uuidv7 } from '@yayatoh/kernel';
import { consumeEvent } from '@yayatoh/platform';
import { sql } from 'drizzle-orm';
import { videoProvider } from './ports.ts';

const systemCtx = (orgId: string) => createCtx({ orgId, actor: { type: 'system', name: 'fixture' } });

/**
 * M6.9a rows for every `virtual` table and check-in's `virtual_attendance` (isolation coverage):
 * the fixture order's first ticket type made "both", a fake stream on the event's first session,
 * one viewing by the order's first ticket with one counted minute, and that minute's
 * `virtual.attended@1` run through check-in's subscriber (which creates the virtual checkpoint).
 * Rows only: the event's attendance mode is left as it is.
 */
export async function virtualFixture(orgId: string, eventId: string): Promise<void> {
  const [row] = await withTenant(systemCtx(orgId), (tx) =>
    tx.execute<{ session_id: string; ticket_id: string; ticket_type_id: string }>(sql`
      select s.id as session_id, t.id as ticket_id, t.ticket_type_id
      from program.sessions s, ticketing.tickets t
      where s.event_id = ${eventId} and t.event_id = ${eventId} and t.status = 'active'
      order by s.starts_at, s.id, t.created_at, t.id limit 1`),
  );
  if (!row) throw new Error('fixture: the fixture event has no session or ticket for virtual rows');
  const live = await videoProvider.createLiveStream({
    orgId,
    sessionId: row.session_id,
    idempotencyKey: row.session_id,
  });
  const minute = new Date(Math.floor(Date.now() / 60_000) * 60_000);
  await withTenant(systemCtx(orgId), async (tx) => {
    await tx.execute(sql`insert into virtual.ticket_access (org_id, event_id, ticket_type_id, access)
      values (${orgId}, ${eventId}, ${row.ticket_type_id}, 'both')`);
    const [stream] = await tx.execute<{ id: string }>(sql`insert into virtual.streams
        (org_id, event_id, session_id, provider, provider_stream_id, playback_id, ingest_url)
      values (${orgId}, ${eventId}, ${row.session_id}, 'fake', ${live.providerStreamId}, ${live.playbackId},
        ${live.ingestUrl})
      returning id`);
    const [view] = await tx.execute<{ id: string }>(sql`insert into virtual.views
        (org_id, event_id, session_id, stream_id, ticket_id, expires_at, beat_seq, last_beat_at)
      values (${orgId}, ${eventId}, ${row.session_id}, ${stream?.id}, ${row.ticket_id},
        now() + interval '10 minutes', 1, now())
      returning id`);
    await tx.execute(sql`insert into virtual.watch_minutes (org_id, event_id, session_id, ticket_id, view_id, minute)
      values (${orgId}, ${eventId}, ${row.session_id}, ${row.ticket_id}, ${view?.id}, ${minute.toISOString()}::timestamptz)`);
  });
  await consumeEvent(virtualAttendanceSubscriber(), {
    id: uuidv7(),
    orgId,
    type: 'virtual.attended',
    version: 1,
    aggregateType: 'event',
    aggregateId: eventId,
    payload: {
      orgId,
      eventId,
      sessionId: row.session_id,
      ticketId: row.ticket_id,
      at: minute.toISOString(),
    },
    logSeq: 0,
  });
}
