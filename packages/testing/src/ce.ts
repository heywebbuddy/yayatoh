import { withTenant } from '@yayatoh/db';
import { createCtx } from '@yayatoh/kernel';
import { sql } from 'drizzle-orm';

const systemCtx = (orgId: string) => createCtx({ orgId, actor: { type: 'system', name: 'fixture' } });

/**
 * M6.9b rows for the Zoom tables (`virtual.zoom_*`) and every `ce` table (isolation coverage): the
 * event's first session linked to a Zoom webinar, the first ticket registered and attending for
 * 50 minutes, a CE rule on that session, and its certificate with one award. Rows only.
 */
export async function ceFixture(orgId: string, eventId: string): Promise<void> {
  await withTenant(systemCtx(orgId), async (tx) => {
    const [row] = await tx.execute<{ session_id: string; ticket_id: string; holder_email: string }>(sql`
      select s.id as session_id, t.id as ticket_id, lower(t.holder_email) as holder_email
      from program.sessions s, ticketing.tickets t
      where s.event_id = ${eventId} and t.event_id = ${eventId} and t.status = 'active'
      order by s.starts_at, s.id, t.created_at, t.id limit 1`);
    if (!row) throw new Error('fixture: the fixture event has no session or ticket for CE rows');
    const [link] = await tx.execute<{ id: string }>(sql`insert into virtual.zoom_webinars
        (org_id, event_id, session_id, webinar_id)
      values (${orgId}, ${eventId}, ${row.session_id}, '81234567890') returning id`);
    await tx.execute(sql`insert into virtual.zoom_registrants
        (org_id, event_id, session_id, webinar_link_id, ticket_id, email, first_name, last_name)
      values (${orgId}, ${eventId}, ${row.session_id}, ${link?.id}, ${row.ticket_id}, ${row.holder_email},
        'Fixture', 'Holder')`);
    await tx.execute(sql`insert into virtual.zoom_attendance
        (org_id, event_id, session_id, webinar_link_id, ticket_id, email, joined_at, left_at)
      values (${orgId}, ${eventId}, ${row.session_id}, ${link?.id}, ${row.ticket_id}, ${row.holder_email},
        '2026-01-01T10:00:00Z', '2026-01-01T10:50:00Z')`);
    await tx.execute(sql`insert into ce.settings (org_id, event_id, credit_label, accreditor)
      values (${orgId}, ${eventId}, 'CPE credits', 'Fixture Board')`);
    await tx.execute(sql`insert into ce.session_rules
        (org_id, event_id, session_id, credits, min_minutes, count_in_person, count_virtual)
      values (${orgId}, ${eventId}, ${row.session_id}, 150, 45, true, true)`);
    const code = orgId
      .replace(/[^0-9]/g, '')
      .padEnd(10, '7')
      .slice(0, 10);
    const [cert] = await tx.execute<{ id: string }>(sql`insert into ce.certificates
        (org_id, event_id, ticket_id, code, holder_name, holder_email, locale, total_credits, content_hash,
         issued_at, revised_at, copy_version)
      values (${orgId}, ${eventId}, ${row.ticket_id}, ${`${code.slice(0, 5)}-${code.slice(5)}`}, 'Fixture Holder',
        ${row.holder_email}, 'en', 150, ${'0'.repeat(64)}, now(), now(), 'fixture')
      returning id`);
    await tx.execute(sql`insert into ce.awards
        (org_id, event_id, certificate_id, session_id, ticket_id, in_person_minutes, virtual_minutes, minutes, credits)
      values (${orgId}, ${eventId}, ${cert?.id}, ${row.session_id}, ${row.ticket_id}, 0, 50, 50, 150)`);
  });
}
