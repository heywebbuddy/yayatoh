import { placedSeats } from '@yayatoh/floorplan';
import { detUuid, legacyKey } from '../ids.ts';
import { type ConvertedChart, checksumOf, convertChart, type LegacySeat, mergeCharts } from '../seatchart.ts';
import { exec, hasTable, rows, type StepContext } from './context.ts';

/**
 * Seat charts (roadmap §7.5 "Seat charts", M2.2c). Each legacy chart (one per seated ticket type)
 * becomes a reusable org floor plan (`seating.layouts`, `layout_v1` with the chart image as its
 * underlay; `src/seatchart.ts`), and each seated event gets its event plan (`event_layouts`, all its
 * charts, one section per chart) with materialized seats:
 * - a seat's price category is its chart's ticket type;
 * - a switched-off legacy seat is blocked (`kill`);
 * - a seat an attendee booked is sold to that attendee's migrated ticket (a table's attendees take
 *   its places in booking order), and the ticket carries the seat label; the plan is then locked;
 * - a seat booked by a void ticket stays available (listed);
 * - repetitive events: legacy seats are booked per date, the new plan is per event (per-occurrence
 *   plans are Later), so the plan is migrated but its bookings stay on the tickets only (listed).
 * Charts whose seats cannot be read are placed at the origin and listed. Idempotent: ids are
 * derived, the event plan is rewritten while no new-platform sale has touched it.
 */
export async function t3Seating(ctx: StepContext): Promise<void> {
  const inst = ctx.instance;
  if (!(await hasTable(ctx, 'seatcharts')) || !(await hasTable(ctx, 'seats'))) return;
  const charts = await rows<{
    id: number;
    image: string;
    ticket_type_id: string | null;
    ticket_name: string | null;
    event_id: string | null;
    org_id: string | null;
    legacy_event: string;
    event_name: string | null;
    repetitive: boolean;
    published: boolean;
    created: Date | null;
    natural_w: number | null;
    natural_h: number | null;
  }>(
    ctx,
    `select c.id::int as id, c.chart_image as image, tt.new_id as ticket_type_id, t.name as ticket_name,
            ev.new_id as event_id, ev.org_id, c.event_id::text as legacy_event, e.name as event_name,
            coalesce(le.repetitive, 0) = 1 as repetitive, e.status = 'published' as published,
            (c.created_at at time zone {tz}) as created, m.width_px as natural_w, m.height_px as natural_h
     from {s}.seatcharts c
     left join legacy.ref tt on tt.instance = {inst} and tt.entity = 'tickets' and tt.legacy_id = c.ticket_id::text
     left join ticketing.ticket_types t on t.id = tt.new_id
     left join legacy.ref ev on ev.instance = {inst} and ev.entity = 'events' and ev.legacy_id = c.event_id::text
     left join events.events e on e.id = ev.new_id
     left join {s}.events le on le.id = c.event_id
     left join legacy.media_images m on m.instance = {inst} and m.path = c.chart_image
     order by c.id`,
  );
  const seats = await rows<LegacySeat & { seatchart_id: number }>(
    ctx,
    `select id::int as id, seatchart_id::int as seatchart_id, coalesce(name, '') as name, coalesce(coordinates, '') as coordinates,
            greatest(coalesce(capacity, 1), 1)::int as capacity, coalesce(status, 1)::int as status, width, height
     from {s}.seats order by seatchart_id, id`,
  );
  const byChart = new Map<number, LegacySeat[]>();
  for (const s of seats) byChart.set(s.seatchart_id, [...(byChart.get(s.seatchart_id) ?? []), s]);

  await exec(
    ctx,
    `drop table if exists t3_seat_places;
     create temp table t3_seat_places (legacy_seat bigint, place int, seat_uuid uuid, event_id uuid, org_id uuid,
                                       ticket_type_id uuid, disabled boolean, primary key (legacy_seat, place))`,
  );
  const perEvent = new Map<
    string,
    {
      org: string;
      published: boolean;
      repetitive: boolean;
      name: string;
      charts: { label: string; converted: ConvertedChart; chartId: number }[];
    }
  >();
  const exceptions: { kind: string; legacy_id: string; detail: Record<string, unknown> }[] = [];
  for (const c of charts) {
    if (!c.event_id || !c.org_id || !c.ticket_type_id) {
      exceptions.push({
        kind: 'seatchart_orphan',
        legacy_id: String(c.id),
        detail: { event: c.legacy_event },
      });
      continue;
    }
    const legacySeats = byChart.get(c.id) ?? [];
    if (!legacySeats.length) {
      exceptions.push({ kind: 'seatchart_empty', legacy_id: String(c.id), detail: {} });
      continue;
    }
    const label = c.ticket_name?.trim() || `Chart ${c.id}`;
    const converted = convertChart(inst, {
      id: c.id,
      image: c.image,
      label,
      seats: legacySeats,
      natural: c.natural_w && c.natural_h ? { width: c.natural_w, height: c.natural_h } : null,
    });
    for (const s of converted.unreadable)
      exceptions.push({ kind: 'seat_coordinates_unreadable', legacy_id: String(s), detail: { chart: c.id } });
    // The reusable org plan for this chart.
    const layoutId = detUuid(c.created, legacyKey(inst, 'seatcharts', c.id));
    const name = `Legacy chart · ${c.event_name ?? ''} · ${label}`.slice(0, 120);
    await ctx.sql`
      insert into seating.layouts (id, org_id, name, doc, checksum, seat_count, created_at, updated_at)
      values (${layoutId}, ${c.org_id}, ${name}, ${JSON.stringify(converted.doc)}::jsonb, ${converted.checksum},
              ${placedSeats(converted.doc).length}, ${c.created ?? '1970-01-01T00:00:00Z'}, ${c.created ?? '1970-01-01T00:00:00Z'})
      on conflict (id) do update set doc = excluded.doc, checksum = excluded.checksum, seat_count = excluded.seat_count, name = excluded.name`;
    await ctx.sql`
      insert into legacy.ref (instance, entity, legacy_id, new_id, org_id, compat_id)
      values (${inst}, 'seatcharts', ${String(c.id)}, ${layoutId}, ${c.org_id}, ${c.id})
      on conflict (instance, entity, legacy_id) do update set new_id = excluded.new_id`;
    const places = [...converted.places.entries()].flatMap(([seat, ids]) =>
      ids.map((uuid, k) => ({
        legacy_seat: seat,
        place: k + 1,
        seat_uuid: uuid,
        event_id: c.event_id,
        org_id: c.org_id,
        ticket_type_id: c.ticket_type_id,
        disabled: converted.disabled.has(seat),
      })),
    );
    for (let i = 0; i < places.length; i += 5000)
      await ctx.sql`insert into t3_seat_places ${ctx.sql(places.slice(i, i + 5000))} on conflict do nothing`;
    const ev = perEvent.get(c.event_id) ?? {
      org: c.org_id,
      published: c.published,
      repetitive: c.repetitive,
      name: c.event_name ?? '',
      charts: [],
    };
    ev.charts.push({ label, converted, chartId: c.id });
    perEvent.set(c.event_id, ev);
  }

  // Event plans and their seats.
  for (const [eventId, ev] of perEvent) {
    const [current] = await ctx.sql<{ id: string; touched: boolean }[]>`
      select l.id, exists (select 1 from seating.event_seats s where s.event_id = ${eventId} and s.org_id = ${ev.org}
                           and (s.status = 'held' or (s.status = 'sold' and not exists (
                             select 1 from legacy.ref r where r.new_id = s.ticket_id and r.instance = ${inst}
                             and r.entity = 'booking_units')))) as touched
      from seating.event_layouts l where l.event_id = ${eventId} and l.org_id = ${ev.org}`;
    if (current?.touched) {
      exceptions.push({ kind: 'seat_plan_in_use_kept', legacy_id: eventId, detail: {} });
      continue;
    }
    const doc = mergeCharts(inst, eventId, ev.charts);
    const planId = detUuid(null, legacyKey(inst, 'event_layouts', eventId));
    const sourceLayout =
      ev.charts.length === 1
        ? detUuid(null, legacyKey(inst, 'seatcharts', ev.charts[0]?.chartId ?? 0))
        : null;
    const placed = placedSeats(doc);
    await ctx.sql`delete from seating.event_seats where event_id = ${eventId} and org_id = ${ev.org}`;
    await ctx.sql`
      insert into seating.event_layouts (id, org_id, event_id, source_layout_id, doc, checksum, seat_count, status)
      values (${current?.id ?? planId}, ${ev.org}, ${eventId}, null, ${JSON.stringify(doc)}::jsonb, ${checksumOf(doc)},
              ${placed.length}, ${ev.published ? 'published' : 'draft'})
      on conflict (org_id, event_id) do update set doc = excluded.doc, checksum = excluded.checksum,
        seat_count = excluded.seat_count, status = excluded.status, locked_at = null`;
    if (sourceLayout)
      await ctx.sql`update seating.event_layouts set source_layout_id = (select id from seating.layouts where id = ${sourceLayout})
                    where event_id = ${eventId} and org_id = ${ev.org}`;
    const seatRows = placed.map((p) => ({
      id: detUuid(null, legacyKey(inst, 'event_seats', `${eventId}|${p.seatId}`)),
      org_id: ev.org,
      event_id: eventId,
      seat_uuid: p.seatId,
      label: p.label,
      item_id: p.itemId,
      section_id: p.sectionId,
      accessible: p.accessible,
    }));
    for (let i = 0; i < seatRows.length; i += 5000)
      await ctx.sql`insert into seating.event_seats ${ctx.sql(seatRows.slice(i, i + 5000))}`;
  }
  await exec(
    ctx,
    `
    update seating.event_seats s set ticket_type_id = p.ticket_type_id,
      status = case when p.disabled then 'blocked' else 'available' end,
      block_reason = case when p.disabled then 'kill' end
    from t3_seat_places p where s.org_id = p.org_id and s.event_id = p.event_id and s.seat_uuid = p.seat_uuid;

    -- Booked seats: the attendee's migrated ticket (T4 maps a booking's n-th distinct attendee row
    -- to its n-th unit; hand-on rows map to the child booking's ticket).
    drop table if exists t3_seat_bookings;
    create temp table t3_seat_bookings as
    with att as (
      select a.id, a.booking_id, a.seat_id, a.event_date,
             row_number() over (partition by a.booking_id order by a.id) as rn
      from (select distinct on (booking_id, lower(coalesce(address, '')), coalesce(name, '')) * from {s}.attendees
            where booking_id is not null order by booking_id, lower(coalesce(address, '')), coalesce(name, ''), id) a
    ), booked as (
      select att.id as attendee_id, att.seat_id, att.event_date,
             coalesce(u.new_id, h.new_id) as ticket_id
      from att
      left join legacy.ref u on u.instance = {inst} and u.entity = 'booking_units' and u.legacy_id = att.booking_id || ':' || att.rn
      left join {s}.bookings b on b.id = att.booking_id
      left join legacy.ref h on h.instance = {inst} and h.entity = 'bookings' and h.legacy_id = att.booking_id::text
                             and b.distributed_from_booking_id is not null
      where att.seat_id is not null
    )
    select b.*, row_number() over (partition by b.seat_id, b.event_date order by b.attendee_id) as place,
           t.status as ticket_status, t.event_id, t.org_id
    from booked b left join ticketing.tickets t on t.id = b.ticket_id;

    insert into legacy.exceptions (run_id, instance, kind, legacy_table, legacy_id, detail)
    select {run}, {inst}, 'seat_reference_unresolved', 'attendees', b.attendee_id::text, jsonb_build_object('seat', b.seat_id)
    from t3_seat_bookings b
    where b.ticket_id is null or not exists (select 1 from t3_seat_places p where p.legacy_seat = b.seat_id);

    insert into legacy.exceptions (run_id, instance, kind, legacy_table, legacy_id, detail)
    select {run}, {inst}, 'seat_over_capacity', 'attendees', b.attendee_id::text, jsonb_build_object('seat', b.seat_id, 'place', b.place)
    from t3_seat_bookings b
    where exists (select 1 from t3_seat_places p where p.legacy_seat = b.seat_id)
      and not exists (select 1 from t3_seat_places p where p.legacy_seat = b.seat_id and p.place = b.place);

    insert into legacy.exceptions (run_id, instance, kind, legacy_table, legacy_id, detail)
    select {run}, {inst}, 'seat_per_date_not_migrated', 'attendees', b.attendee_id::text, jsonb_build_object('seat', b.seat_id)
    from t3_seat_bookings b
    join t3_seat_places p on p.legacy_seat = b.seat_id and p.place = b.place
    join events.events e on e.id = p.event_id
    join legacy.ref r on r.new_id = e.id and r.instance = {inst} and r.entity = 'events'
    join {s}.events le on le.id::text = r.legacy_id
    where coalesce(le.repetitive, 0) = 1;

    insert into legacy.exceptions (run_id, instance, kind, legacy_table, legacy_id, detail)
    select {run}, {inst}, 'seat_released_void_ticket', 'attendees', b.attendee_id::text, jsonb_build_object('seat', b.seat_id)
    from t3_seat_bookings b where b.ticket_status = 'void';

    drop table if exists t3_seat_sold;
    create temp table t3_seat_sold as
    select p.org_id, p.event_id, p.seat_uuid, b.ticket_id
    from t3_seat_bookings b
    join t3_seat_places p on p.legacy_seat = b.seat_id and p.place = b.place
    join legacy.ref r on r.new_id = p.event_id and r.instance = {inst} and r.entity = 'events'
    join {s}.events le on le.id::text = r.legacy_id
    where b.ticket_status = 'active' and b.event_id = p.event_id and coalesce(le.repetitive, 0) = 0;

    update seating.event_seats s set status = 'sold', ticket_id = x.ticket_id, block_reason = null
    from t3_seat_sold x where s.org_id = x.org_id and s.event_id = x.event_id and s.seat_uuid = x.seat_uuid;

    update ticketing.tickets t set seat_label = s.label
    from t3_seat_sold x join seating.event_seats s on s.org_id = x.org_id and s.event_id = x.event_id and s.seat_uuid = x.seat_uuid
    where t.id = x.ticket_id and t.seat_label is distinct from s.label;

    update seating.event_layouts l set status = 'locked', locked_at = coalesce(l.locked_at, now())
    where exists (select 1 from t3_seat_sold x where x.org_id = l.org_id and x.event_id = l.event_id)
      and l.status <> 'locked';
  `,
  );
  if (exceptions.length)
    await ctx.sql`insert into legacy.exceptions ${ctx.sql(
      exceptions.map((e) => ({
        run_id: ctx.runId,
        instance: inst,
        kind: e.kind,
        legacy_table: 'seatcharts',
        legacy_id: e.legacy_id,
        detail: JSON.stringify(e.detail),
      })),
    )}`;
}
