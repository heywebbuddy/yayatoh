import { EventSectionDto } from '@yayatoh/events';
import {
  htmlToMarkdown,
  type LegacySectionItem,
  plainLine,
  privateInfoMarkdown,
  sectionFromLegacy,
  speakerLinks,
  sponsorTier,
  webUrl,
} from '../content.ts';
import { detUuid, legacyKey } from '../ids.ts';
import {
  exec,
  type Finding,
  hasColumn,
  hasTable,
  insertRows,
  recordExceptions,
  recordQuarantine,
  recordRefs,
  rows,
  type StepContext,
} from './context.ts';

type Ref = { legacyId: string; newId: string; orgId: string; compatId?: number | null };
const EPOCH = '1970-01-01T00:00:00Z';

/**
 * T3/T5 typed sub-entities (M2.2d) → the program module (M1.4f) and the event content tables
 * (M1.4d). Set-based reads, rules in `src/content.ts`, batched idempotent writes (deterministic ids,
 * `on conflict do nothing`: a row edited on the new platform is never overwritten by a rerun).
 *
 * - `event_speakers` → `program.speakers` (bio HTML → Markdown, social links http(s) only).
 * - `tags` (Eventmie's organizer-wide performer/speaker pages) linked through `event_tag` →
 *   one `program.speakers` row per linked event; switched-off tags and tags without an event are
 *   listed; contact fields are not carried (listed).
 * - `event_sessions` → `program.sessions` + `program.rooms` (from `room_location`) +
 *   `program.session_speakers` (from `speaker_ids`, same event only). Legacy session times are the
 *   organizer's wall clock as typed (the form saved them unconverted), read in the event's
 *   timezone. An end at or before the start becomes start + 1 h (listed); sessions outside the
 *   event are migrated and listed (the module treats that as a warning); paid/invitation access is
 *   not a program feature (listed).
 * - `event_exhibitors` → `program.exhibitors`; a sponsor level also makes a `program.sponsors`
 *   row in its tier (Platinum, Gold, Silver, Bronze). Staff, videos, email and phone are not
 *   carried (listed); a website without http(s) is dropped (listed).
 * - `event_announcements` → `events.event_announcements` (public; inactive ones as drafts; alert
 *   and warning types pinned).
 * - `event_custom_sections` + items → `events.event_sections` (accordion → FAQ, cards/list →
 *   text), validated with the events module's own section schema.
 * - `events.private_info` (Wi-Fi, parking, door codes: ticket holders only) →
 *   `events.event_private_info`, never any public table.
 * Events that gained a program and still have the default profile take the `conference` profile,
 * whose console has the program pages (pending owner, like seating's `gala`).
 * Rows of unknown events, or without a name/title/time, are quarantined (content: ≤ 0.5%).
 */
export async function t3Program(ctx: StepContext): Promise<void> {
  const inst = ctx.instance;
  const speakerIds = new Map<string, { id: string; legacyEvent: string }>();
  const programEvents = new Set<string>();

  // ---- speakers ---------------------------------------------------------------------------------
  if (await hasTable(ctx, 'event_speakers')) {
    const src = await rows<{
      id: string;
      legacy_event: string;
      event_id: string | null;
      org_id: string | null;
      name: string | null;
      designation: string | null;
      company: string | null;
      avatar: string | null;
      bio: string | null;
      social_links: string | null;
      created: Date | null;
    }>(
      ctx,
      `select s.id::text as id, s.event_id::text as legacy_event, ev.new_id as event_id, ev.org_id, s.name,
              s.designation, s.company, s.avatar, s.bio, s.social_links::text as social_links,
              (s.created_at at time zone {tz}) as created
       from {s}.event_speakers s
       left join legacy.ref ev on ev.instance = {inst} and ev.entity = 'events' and ev.legacy_id = s.event_id::text
       order by s.id`,
    );
    const out: Record<string, unknown>[] = [];
    const refs: Ref[] = [];
    const quarantine: Finding[] = [];
    const exceptions: Finding[] = [];
    for (const s of src) {
      if (!s.event_id || !s.org_id) {
        quarantine.push({ legacyId: s.id, kind: 'unknown_event', detail: { event: s.legacy_event } });
        continue;
      }
      const name = plainLine(s.name, 120);
      if (!name) {
        quarantine.push({ legacyId: s.id, kind: 'name_missing', detail: { column: 'name' } });
        continue;
      }
      const id = detUuid(s.created, legacyKey(inst, 'event_speakers', s.id));
      const { links, dropped } = speakerLinks(s.social_links);
      if (dropped)
        exceptions.push({ legacyId: s.id, kind: 'speaker_link_dropped', detail: { links: dropped } });
      out.push({
        id,
        org_id: s.org_id,
        event_id: s.event_id,
        name,
        title: plainLine(s.designation, 120) || null,
        company: plainLine(s.company, 120) || null,
        bio: htmlToMarkdown(s.bio, 5000),
        links: JSON.stringify(links),
        created_at: s.created ?? EPOCH,
        updated_at: s.created ?? EPOCH,
      });
      refs.push({ legacyId: s.id, newId: id, orgId: s.org_id, compatId: Number(s.id) });
      speakerIds.set(s.id, { id, legacyEvent: s.legacy_event });
      programEvents.add(s.event_id);
    }
    await insertRows(ctx, 'program.speakers', out);
    await recordRefs(ctx, 'event_speakers', refs);
    await recordQuarantine(ctx, 'event_speakers', quarantine);
    await recordExceptions(ctx, 'event_speakers', exceptions);
  }

  // ---- performer/speaker tags → speakers per linked event -----------------------------------------
  if ((await hasTable(ctx, 'tags')) && (await hasTable(ctx, 'event_tag'))) {
    const tags = await rows<{
      id: string;
      title: string | null;
      type: string | null;
      sub_title: string | null;
      description: string | null;
      website: string | null;
      facebook: string | null;
      instagram: string | null;
      twitter: string | null;
      linkedin: string | null;
      status: number | null;
      contact: boolean;
      linked: number;
      created: Date | null;
    }>(
      ctx,
      `select t.id::text as id, t.title, t.type, t.sub_title, t.description, t.website, t.facebook, t.instagram,
              t.twitter, t.linkedin, t.status::int as status,
              (nullif(btrim(coalesce(t.email, '')), '') is not null or nullif(btrim(coalesce(t.phone, '')), '') is not null) as contact,
              (select count(*)::int from {s}.event_tag et where et.tag_id = t.id) as linked,
              (t.created_at at time zone {tz}) as created
       from {s}.tags t order by t.id`,
    );
    const links = await rows<{
      tag_id: string;
      legacy_event: string;
      event_id: string | null;
      org_id: string | null;
    }>(
      ctx,
      `select distinct et.tag_id::text as tag_id, et.event_id::text as legacy_event, ev.new_id as event_id, ev.org_id
       from {s}.event_tag et
       left join legacy.ref ev on ev.instance = {inst} and ev.entity = 'events' and ev.legacy_id = et.event_id::text
       order by 1, 2`,
    );
    const byTag = new Map(tags.map((t) => [t.id, t]));
    const exceptions: Finding[] = [];
    const quarantine: Finding[] = [];
    for (const t of tags) {
      if (Number(t.status ?? 1) !== 1)
        exceptions.push({ legacyId: t.id, kind: 'tag_inactive_not_migrated', detail: { links: t.linked } });
      else if (!t.linked) exceptions.push({ legacyId: t.id, kind: 'tag_without_event', detail: {} });
      if (t.contact) exceptions.push({ legacyId: t.id, kind: 'tag_contact_not_migrated', detail: {} });
    }
    const out: Record<string, unknown>[] = [];
    const refs: Ref[] = [];
    for (const l of links) {
      const t = byTag.get(l.tag_id);
      const key = `${l.tag_id}:${l.legacy_event}`;
      if (!t) {
        quarantine.push({ legacyId: key, kind: 'unknown_tag', detail: { tag: l.tag_id } });
        continue;
      }
      if (Number(t.status ?? 1) !== 1) continue;
      if (!l.event_id || !l.org_id) {
        quarantine.push({ legacyId: key, kind: 'unknown_event', detail: { event: l.legacy_event } });
        continue;
      }
      const name = plainLine(t.title, 120);
      if (!name) {
        quarantine.push({ legacyId: key, kind: 'name_missing', detail: { column: 'title' } });
        continue;
      }
      const social = speakerLinks({
        website: t.website,
        facebook: t.facebook,
        instagram: t.instagram,
        twitter: t.twitter,
        linkedin: t.linkedin,
      });
      if (social.dropped)
        exceptions.push({ legacyId: t.id, kind: 'speaker_link_dropped', detail: { links: social.dropped } });
      const type = plainLine(t.type, 60);
      const id = detUuid(t.created, legacyKey(inst, 'event_tag', key));
      out.push({
        id,
        org_id: l.org_id,
        event_id: l.event_id,
        name,
        title: plainLine(t.sub_title, 120) || (type ? type.charAt(0).toUpperCase() + type.slice(1) : null),
        company: null,
        bio: htmlToMarkdown(t.description, 5000),
        links: JSON.stringify(social.links),
        created_at: t.created ?? EPOCH,
        updated_at: t.created ?? EPOCH,
      });
      refs.push({ legacyId: key, newId: id, orgId: l.org_id });
      programEvents.add(l.event_id);
    }
    await insertRows(ctx, 'program.speakers', out);
    await recordRefs(ctx, 'event_tag', refs);
    await recordQuarantine(ctx, 'event_tag', quarantine);
    await recordExceptions(ctx, 'tags', exceptions);
  }

  // ---- sessions, rooms, session speakers ------------------------------------------------------------
  if (await hasTable(ctx, 'event_sessions')) {
    const src = await rows<{
      id: string;
      legacy_event: string;
      event_id: string | null;
      org_id: string | null;
      title: string | null;
      description: string | null;
      starts_at: Date | null;
      ends_at: Date | null;
      event_starts: Date | null;
      event_ends: Date | null;
      room: string | null;
      speaker_ids: string | null;
      access_type: string | null;
      fee: string | null;
      created: Date | null;
    }>(
      ctx,
      `select x.id::text as id, x.event_id::text as legacy_event, ev.new_id as event_id, ev.org_id, x.title, x.description,
              (x.start_time at time zone e.timezone) as starts_at, (x.end_time at time zone e.timezone) as ends_at,
              e.starts_at as event_starts, e.ends_at as event_ends, x.room_location as room,
              x.speaker_ids::text as speaker_ids, x.access_type, x.additional_fee::text as fee,
              (x.created_at at time zone {tz}) as created
       from {s}.event_sessions x
       left join legacy.ref ev on ev.instance = {inst} and ev.entity = 'events' and ev.legacy_id = x.event_id::text
       left join events.events e on e.id = ev.new_id
       order by x.id`,
    );
    const quarantine: Finding[] = [];
    const exceptions: Finding[] = [];
    const rooms = new Map<string, Record<string, unknown>>();
    const sessions: (Record<string, unknown> & { roomKey: string | null })[] = [];
    const links: Record<string, unknown>[] = [];
    const refs: Ref[] = [];
    for (const x of src) {
      if (!x.event_id || !x.org_id) {
        quarantine.push({ legacyId: x.id, kind: 'unknown_event', detail: { event: x.legacy_event } });
        continue;
      }
      const title = plainLine(x.title, 160);
      if (!title) {
        quarantine.push({ legacyId: x.id, kind: 'title_missing', detail: { column: 'title' } });
        continue;
      }
      if (!x.starts_at) {
        quarantine.push({ legacyId: x.id, kind: 'time_missing', detail: { column: 'start_time' } });
        continue;
      }
      const start = new Date(x.starts_at);
      let end = x.ends_at ? new Date(x.ends_at) : null;
      if (!end || end.getTime() <= start.getTime()) {
        end = new Date(start.getTime() + 3_600_000);
        exceptions.push({ legacyId: x.id, kind: 'session_end_fixed', detail: { ends: 'start + 1 h' } });
      }
      if (
        x.event_starts &&
        x.event_ends &&
        (start < new Date(x.event_starts) || end > new Date(x.event_ends))
      )
        exceptions.push({ legacyId: x.id, kind: 'session_outside_event', detail: {} });
      const access = (x.access_type ?? 'free').trim().toLowerCase();
      if (access !== 'free' && access !== '')
        exceptions.push({
          legacyId: x.id,
          kind: 'session_access_not_migrated',
          detail: { access, fee: x.fee },
        });
      const id = detUuid(x.created, legacyKey(inst, 'event_sessions', x.id));
      const roomName = plainLine(x.room, 80);
      let roomKey: string | null = null;
      if (roomName) {
        roomKey = `${x.event_id}|${roomName.toLowerCase()}`;
        if (!rooms.has(roomKey))
          rooms.set(roomKey, {
            id: detUuid(null, legacyKey(inst, 'rooms', `${x.legacy_event}|${roomName.toLowerCase()}`)),
            org_id: x.org_id,
            event_id: x.event_id,
            name: roomName,
          });
      }
      sessions.push({
        id,
        org_id: x.org_id,
        event_id: x.event_id,
        title,
        description: htmlToMarkdown(x.description, 5000),
        starts_at: start.toISOString(),
        ends_at: end.toISOString(),
        roomKey,
        created_at: x.created ?? EPOCH,
        updated_at: x.created ?? EPOCH,
      });
      refs.push({ legacyId: x.id, newId: id, orgId: x.org_id, compatId: Number(x.id) });
      programEvents.add(x.event_id);
      // Speakers named by legacy id; only this event's speakers can be linked.
      let named: unknown = null;
      try {
        named = x.speaker_ids ? JSON.parse(x.speaker_ids) : null;
      } catch {
        named = null;
      }
      const seen = new Set<string>();
      let missing = 0;
      for (const raw of Array.isArray(named) ? named : []) {
        const key = String(raw).trim();
        const sp = speakerIds.get(key);
        if (!sp || sp.legacyEvent !== x.legacy_event) {
          missing++;
          continue;
        }
        if (seen.has(sp.id) || seen.size >= 20) continue;
        links.push({
          id: detUuid(null, legacyKey(inst, 'session_speakers', `${x.id}:${key}`)),
          org_id: x.org_id,
          session_id: id,
          speaker_id: sp.id,
          position: seen.size,
        });
        seen.add(sp.id);
      }
      if (missing)
        exceptions.push({ legacyId: x.id, kind: 'session_speaker_missing', detail: { speakers: missing } });
    }
    await insertRows(ctx, 'program.rooms', [...rooms.values()]);
    // A room of that name may already exist (made on the new platform): reuse it.
    const existing = programEvents.size
      ? await ctx.sql<{ id: string; event_id: string; key: string }[]>`
          select id, event_id, lower(name) as key from program.rooms where event_id = any(${[...new Set(sessions.map((s) => s.event_id as string))]}::uuid[])`
      : [];
    const roomIds = new Map(existing.map((r) => [`${r.event_id}|${r.key}`, r.id]));
    await insertRows(
      ctx,
      'program.sessions',
      sessions.map(({ roomKey, ...s }) => ({
        ...s,
        room_id: roomKey ? (roomIds.get(roomKey) ?? null) : null,
      })),
    );
    await insertRows(ctx, 'program.session_speakers', links);
    await recordRefs(ctx, 'event_sessions', refs);
    await recordQuarantine(ctx, 'event_sessions', quarantine);
    await recordExceptions(ctx, 'event_sessions', exceptions);
  }

  // ---- exhibitors and sponsors ----------------------------------------------------------------------
  if (await hasTable(ctx, 'event_exhibitors')) {
    const src = await rows<{
      id: string;
      legacy_event: string;
      event_id: string | null;
      org_id: string | null;
      name: string | null;
      description: string | null;
      website: string | null;
      booth: string | null;
      level: string | null;
      contact: string[];
      created: Date | null;
    }>(
      ctx,
      `select x.id::text as id, x.event_id::text as legacy_event, ev.new_id as event_id, ev.org_id, x.name, x.description,
              x.website, x.booth_number as booth, x.sponsor_type as level,
              array_remove(array[
                case when x.staff is not null and x.staff::text not in ('null', '[]', '{}') then 'staff' end,
                case when x.videos is not null and x.videos::text not in ('null', '[]', '{}') then 'videos' end,
                case when nullif(btrim(coalesce(x.email, '')), '') is not null then 'email' end,
                case when nullif(btrim(coalesce(x.phone, '')), '') is not null then 'phone' end], null) as contact,
              (x.created_at at time zone {tz}) as created
       from {s}.event_exhibitors x
       left join legacy.ref ev on ev.instance = {inst} and ev.entity = 'events' and ev.legacy_id = x.event_id::text
       order by x.id`,
    );
    const quarantine: Finding[] = [];
    const exceptions: Finding[] = [];
    const exhibitors: Record<string, unknown>[] = [];
    const tiers = new Map<string, Record<string, unknown>>();
    const sponsors: (Record<string, unknown> & { tierKey: string })[] = [];
    const refs: Ref[] = [];
    const sponsorRefs: Ref[] = [];
    for (const x of src) {
      if (!x.event_id || !x.org_id) {
        quarantine.push({ legacyId: x.id, kind: 'unknown_event', detail: { event: x.legacy_event } });
        continue;
      }
      const name = plainLine(x.name, 120);
      if (!name) {
        quarantine.push({ legacyId: x.id, kind: 'name_missing', detail: { column: 'name' } });
        continue;
      }
      const website = webUrl(x.website);
      if (!website && x.website?.trim())
        exceptions.push({ legacyId: x.id, kind: 'exhibitor_website_dropped', detail: {} });
      if (x.contact.length)
        exceptions.push({
          legacyId: x.id,
          kind: 'exhibitor_contact_not_migrated',
          detail: { fields: x.contact },
        });
      const id = detUuid(x.created, legacyKey(inst, 'event_exhibitors', x.id));
      const description = htmlToMarkdown(x.description, 3000);
      exhibitors.push({
        id,
        org_id: x.org_id,
        event_id: x.event_id,
        name,
        description,
        booth_label: plainLine(x.booth, 40) || null,
        website_url: website,
        created_at: x.created ?? EPOCH,
        updated_at: x.created ?? EPOCH,
      });
      refs.push({ legacyId: x.id, newId: id, orgId: x.org_id, compatId: Number(x.id) });
      programEvents.add(x.event_id);
      const tier = sponsorTier(x.level);
      if (!tier) continue;
      const tierKey = `${x.event_id}|${tier.name.toLowerCase()}`;
      if (!tiers.has(tierKey))
        tiers.set(tierKey, {
          id: detUuid(null, legacyKey(inst, 'sponsor_tiers', `${x.legacy_event}|${tier.name.toLowerCase()}`)),
          org_id: x.org_id,
          event_id: x.event_id,
          name: tier.name,
          position: tier.position,
        });
      const sid = detUuid(x.created, legacyKey(inst, 'exhibitor_sponsors', x.id));
      sponsors.push({
        id: sid,
        org_id: x.org_id,
        event_id: x.event_id,
        tierKey,
        name,
        description,
        website_url: website,
        created_at: x.created ?? EPOCH,
        updated_at: x.created ?? EPOCH,
      });
      sponsorRefs.push({ legacyId: x.id, newId: sid, orgId: x.org_id, compatId: Number(x.id) });
    }
    await insertRows(ctx, 'program.exhibitors', exhibitors);
    await insertRows(ctx, 'program.sponsor_tiers', [...tiers.values()]);
    const tierRows = sponsors.length
      ? await ctx.sql<{ id: string; event_id: string; key: string }[]>`
          select id, event_id, lower(name) as key from program.sponsor_tiers where event_id = any(${[...new Set(sponsors.map((s) => s.event_id as string))]}::uuid[])`
      : [];
    const tierIds = new Map(tierRows.map((t) => [`${t.event_id}|${t.key}`, t.id]));
    await insertRows(
      ctx,
      'program.sponsors',
      sponsors.flatMap(({ tierKey, ...s }) => {
        const tierId = tierIds.get(tierKey);
        return tierId ? [{ ...s, tier_id: tierId }] : [];
      }),
    );
    await recordRefs(ctx, 'event_exhibitors', refs);
    await recordRefs(ctx, 'exhibitor_sponsors', sponsorRefs);
    await recordQuarantine(ctx, 'event_exhibitors', quarantine);
    await recordExceptions(ctx, 'event_exhibitors', exceptions);
  }

  // ---- announcements ---------------------------------------------------------------------------------
  if (await hasTable(ctx, 'event_announcements')) {
    const src = await rows<{
      id: string;
      legacy_event: string;
      event_id: string | null;
      org_id: string | null;
      title: string | null;
      message: string | null;
      type: string | null;
      active: number | null;
      created: Date | null;
    }>(
      ctx,
      `select a.id::text as id, a.event_id::text as legacy_event, ev.new_id as event_id, ev.org_id, a.title, a.message,
              a.type, a.is_active::int as active, (a.created_at at time zone {tz}) as created
       from {s}.event_announcements a
       left join legacy.ref ev on ev.instance = {inst} and ev.entity = 'events' and ev.legacy_id = a.event_id::text
       order by a.id`,
    );
    const quarantine: Finding[] = [];
    const out: Record<string, unknown>[] = [];
    const refs: Ref[] = [];
    for (const a of src) {
      if (!a.event_id || !a.org_id) {
        quarantine.push({ legacyId: a.id, kind: 'unknown_event', detail: { event: a.legacy_event } });
        continue;
      }
      const title = plainLine(a.title, 160);
      const body = htmlToMarkdown(a.message, 5000);
      if (!title || !body) {
        quarantine.push({
          legacyId: a.id,
          kind: title ? 'message_missing' : 'title_missing',
          detail: { column: title ? 'message' : 'title' },
        });
        continue;
      }
      const id = detUuid(a.created, legacyKey(inst, 'event_announcements', a.id));
      const created = a.created ?? EPOCH;
      out.push({
        id,
        org_id: a.org_id,
        event_id: a.event_id,
        title,
        body,
        audience: 'public',
        pinned: ['alert', 'warning', 'danger', 'urgent'].includes((a.type ?? '').trim().toLowerCase()),
        published_at: Number(a.active ?? 1) === 1 ? created : null,
        created_at: created,
        updated_at: created,
      });
      refs.push({ legacyId: a.id, newId: id, orgId: a.org_id, compatId: Number(a.id) });
    }
    await insertRows(ctx, 'events.event_announcements', out);
    await recordRefs(ctx, 'event_announcements', refs);
    await recordQuarantine(ctx, 'event_announcements', quarantine);
  }

  // ---- custom sections --------------------------------------------------------------------------------
  if (await hasTable(ctx, 'event_custom_sections')) {
    const src = await rows<{
      id: string;
      legacy_event: string;
      event_id: string | null;
      org_id: string | null;
      title: string | null;
      display: string | null;
      active: number | null;
      rank: number;
      created: Date | null;
    }>(
      ctx,
      `select c.id::text as id, c.event_id::text as legacy_event, ev.new_id as event_id, ev.org_id, c.title,
              c.display_type as display, c.is_active::int as active,
              row_number() over (partition by c.event_id order by c."order", c.id)::int as rank,
              (c.created_at at time zone {tz}) as created
       from {s}.event_custom_sections c
       left join legacy.ref ev on ev.instance = {inst} and ev.entity = 'events' and ev.legacy_id = c.event_id::text
       order by c.id`,
    );
    const items = (await hasTable(ctx, 'event_custom_section_items'))
      ? await rows<{
          section_id: string;
          title: string | null;
          content: string | null;
          active: number | null;
        }>(
          ctx,
          `select section_id::text as section_id, title, content, is_active::int as active
           from {s}.event_custom_section_items order by section_id, "order", id`,
        )
      : [];
    const bySection = new Map<string, LegacySectionItem[]>();
    for (const i of items)
      bySection.set(i.section_id, [
        ...(bySection.get(i.section_id) ?? []),
        { title: i.title, content: i.content, active: Number(i.active ?? 1) === 1 },
      ]);
    const quarantine: Finding[] = [];
    const exceptions: Finding[] = [];
    const out: Record<string, unknown>[] = [];
    const refs: Ref[] = [];
    for (const c of src) {
      if (!c.event_id || !c.org_id) {
        quarantine.push({ legacyId: c.id, kind: 'unknown_event', detail: { event: c.legacy_event } });
        continue;
      }
      const title = plainLine(c.title, 120);
      const section = sectionFromLegacy(
        (c.display ?? 'cards').trim().toLowerCase(),
        bySection.get(c.id) ?? [],
      );
      const id = detUuid(c.created, legacyKey(inst, 'event_custom_sections', c.id));
      const candidate = section && {
        id,
        eventId: c.event_id,
        kind: section.kind,
        title: title || 'Information',
        position: c.rank,
        visible: Number(c.active ?? 1) === 1,
        content: section.content,
      };
      if (!candidate || !EventSectionDto.safeParse(candidate).success) {
        exceptions.push({ legacyId: c.id, kind: 'section_empty_not_migrated', detail: {} });
        continue;
      }
      if (section.skipped)
        exceptions.push({
          legacyId: c.id,
          kind: 'section_items_skipped',
          detail: { items: section.skipped },
        });
      out.push({
        id,
        org_id: c.org_id,
        event_id: c.event_id,
        kind: candidate.kind,
        title: candidate.title,
        position: candidate.position,
        content: JSON.stringify(candidate.content),
        visible: candidate.visible,
        created_at: c.created ?? EPOCH,
        updated_at: c.created ?? EPOCH,
      });
      refs.push({ legacyId: c.id, newId: id, orgId: c.org_id, compatId: Number(c.id) });
    }
    await insertRows(ctx, 'events.event_sections', out);
    await recordRefs(ctx, 'event_custom_sections', refs);
    await recordQuarantine(ctx, 'event_custom_sections', quarantine);
    await recordExceptions(ctx, 'event_custom_sections', exceptions);
  }

  // ---- private info (ticket holders only) --------------------------------------------------------------
  const privateInfo = !(await hasColumn(ctx, 'events', 'private_info'))
    ? []
    : await rows<{
        legacy_event: string;
        event_id: string;
        org_id: string;
        info: string;
        created: Date | null;
      }>(
        ctx,
        `select le.id::text as legacy_event, ev.new_id as event_id, ev.org_id, le.private_info::text as info,
            (le.created_at at time zone {tz}) as created
     from {s}.events le
     join legacy.ref ev on ev.instance = {inst} and ev.entity = 'events' and ev.legacy_id = le.id::text
     where jsonb_typeof(le.private_info) = 'object' and le.private_info <> '{}'::jsonb
     order by le.id`,
      );
  {
    const out: Record<string, unknown>[] = [];
    const refs: Ref[] = [];
    const exceptions: Finding[] = [];
    for (const p of privateInfo) {
      const body = privateInfoMarkdown(p.info);
      if (!body) {
        exceptions.push({ legacyId: p.legacy_event, kind: 'private_info_empty', detail: {} });
        continue;
      }
      const id = detUuid(p.created, legacyKey(inst, 'event_private_info', p.legacy_event));
      out.push({
        id,
        org_id: p.org_id,
        event_id: p.event_id,
        body,
        created_at: p.created ?? EPOCH,
        updated_at: p.created ?? EPOCH,
      });
      refs.push({ legacyId: p.legacy_event, newId: id, orgId: p.org_id });
    }
    await insertRows(ctx, 'events.event_private_info', out);
    // An event whose private info was already written on the new platform keeps it: map the
    // legacy row to the row that exists.
    const existing = out.length
      ? await ctx.sql<{ id: string; event_id: string }[]>`
          select id, event_id from events.event_private_info where event_id = any(${out.map((o) => o.event_id as string)}::uuid[])`
      : [];
    const byEvent = new Map(existing.map((e) => [e.event_id, e.id]));
    await recordRefs(
      ctx,
      'event_private_info',
      refs.map((r, i) => ({ ...r, newId: byEvent.get(out[i]?.event_id as string) ?? r.newId })),
    );
    await recordExceptions(ctx, 'events', exceptions);
  }

  // ---- console profile for events that gained a program ------------------------------------------------
  if (programEvents.size) {
    await exec(
      ctx,
      `drop table if exists t3_program_events;
       create temp table t3_program_events (event_id uuid primary key);`,
    );
    await insertRows(
      ctx,
      't3_program_events',
      [...programEvents].map((event_id) => ({ event_id })),
    );
    await exec(
      ctx,
      `
      update events.events e set profile = 'conference'
      from t3_program_events p where p.event_id = e.id and e.profile = 'other';

      insert into legacy.exceptions (run_id, instance, kind, legacy_table, legacy_id, detail)
      select {run}, {inst}, 'event_profile_conference', 'events', r.legacy_id, '{}'::jsonb
      from events.events e join t3_program_events p on p.event_id = e.id
      join legacy.ref r on r.instance = {inst} and r.entity = 'events' and r.new_id = e.id
      where e.profile = 'conference';
    `,
    );
  }
}
