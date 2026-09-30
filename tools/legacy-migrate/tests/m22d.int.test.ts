import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { publicEntry } from '@yayatoh/cms';
import { closePools, withTenant } from '@yayatoh/db';
import { type MigratorSql, migratorSql } from '@yayatoh/db/migration';
import { holderEventContent, pageTarget, publicEventContent } from '@yayatoh/events';
import { createCtx } from '@yayatoh/kernel';
import { matchLegacyRedirect } from '@yayatoh/marketplace';
import { publicProgram, publicSpeaker } from '@yayatoh/program';
import { sql as dsql } from 'drizzle-orm';
// The testing package registers the composition root (key vault, ports) the transforms use.
import '@yayatoh/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type RunResult, runMigration } from '../src/run.ts';
import { legacyMediaUrl } from '../src/seatchart.ts';
import { DEMO, generateDumpFile, type SynthSummary } from '../src/synth/generate.ts';
import type { StepContext } from '../src/transforms/context.ts';
import { t3Program } from '../src/transforms/t3-program.ts';
import { validate } from '../src/validate.ts';

/**
 * M2.2d on synthetic data: the typed sub-entities (program, announcements, sections, private
 * info, performer tags), CMS content (T7), chats kept in staging (T6), the media manifest, and
 * their share of V1, V4, V7, V9 and V10. Negative cases run inside rolled-back transactions, so the
 * database only ever holds what the migration wrote.
 */
const FREEZE = new Date('2026-09-01T12:00:00Z');
const dir = mkdtempSync(join(tmpdir(), 'legacy-m22d-'));
const dumps = { yay: join(dir, 'yay.sql'), abc: join(dir, 'abc.sql') };
const facts: Partial<Record<'yay' | 'abc', SynthSummary>> = {};
let first: { yay: RunResult; abc: RunResult };
const quiet = () => {};
const sql = () => migratorSql();
const ROLLBACK = new Error('rollback');
async function one<T>(q: Promise<T[]>): Promise<T> {
  const [r] = await q;
  if (!r) throw new Error('no row');
  return r;
}
const check = (r: { report: { checks: { id: string; pass: boolean; details: unknown }[] } }, id: string) =>
  r.report.checks.find((c) => c.id === id);
function expectPass(r: RunResult) {
  const failed = r.report.checks.filter((c) => !c.pass);
  expect(failed.map((c) => `${c.id}: ${JSON.stringify(c.details).slice(0, 1500)}`)).toEqual([]);
  expect(r.report.quarantine.filter((q) => !q.pass)).toEqual([]);
  expect(r.pass).toBe(true);
}
const run = (instance: 'yay' | 'abc', dump?: string) =>
  runMigration({
    instance,
    mode: 'rehearsal',
    dump,
    freezeAt: FREEZE,
    log: quiet,
    extraHosts: instance === 'yay' ? ['yayatoh.localhost'] : [],
  });
/** Run `fn` in a transaction that is always rolled back. */
async function rolledBack(fn: (tx: MigratorSql) => Promise<void>) {
  await sql()
    .begin(async (tx) => {
      await fn(tx as unknown as MigratorSql);
      throw ROLLBACK;
    })
    .catch((err: unknown) => {
      if (err !== ROLLBACK) throw err;
    });
}
const ref = (entity: string, legacyId: string | number, instance = 'yay') =>
  one(
    sql()<{ new_id: string; org_id: string }[]>`
      select new_id, org_id from legacy.ref where instance = ${instance} and entity = ${entity} and legacy_id = ${String(legacyId)}`,
  );
const exceptionsOf = (r: RunResult, kind: string) => r.report.exceptions[kind] ?? 0;

beforeAll(async () => {
  facts.yay = await generateDumpFile(dumps.yay, { instance: 'yay', scale: 'small', demo: true });
  facts.abc = await generateDumpFile(dumps.abc, { instance: 'abc', scale: 'small' });
  first = { yay: await run('yay', dumps.yay), abc: await run('abc', dumps.abc) };
}, 240_000);
afterAll(async () => {
  rmSync(dir, { recursive: true, force: true });
  await closePools();
});

describe('runs', () => {
  it('both instances pass with the content lines in V1, V4 and V7', () => {
    for (const r of [first.yay, first.abc]) {
      expectPass(r);
      const v1 = check(r, 'V1')?.details as { lines: { name: string; legacy: number; migrated: number }[] };
      for (const name of [
        'program_sessions',
        'program_speakers',
        'session_speakers',
        'program_exhibitors',
        'program_sponsors',
        'event_announcements',
        'event_sections',
        'event_private_info',
        'cms_entries',
        'chats_kept_in_staging',
        'chat_blocks_kept_in_staging',
        'chat_reports_kept_in_staging',
      ]) {
        const line = v1.lines.find((l) => l.name === name);
        expect(line, name).toBeDefined();
        expect(line?.migrated, name).toBe(line?.legacy);
      }
      for (const name of ['program_sessions', 'program_speakers', 'cms_entries', 'chats_kept_in_staging'])
        expect(v1.lines.find((l) => l.name === name)?.legacy, name).toBeGreaterThan(0);
      const v4 = check(r, 'V4')?.details as Record<string, number>;
      for (const k of [
        'refs_without_session',
        'refs_without_speaker',
        'refs_without_cms_entry',
        'session_speakers_other_event',
        'media_refs_without_row',
        'underlays_without_manifest',
      ])
        expect(v4[k], k).toBe(0);
      const v7 = check(r, 'V7')?.details as { queries: { id: string; diffCount: number; keys?: number }[] };
      for (const id of ['G15', 'G16', 'G17', 'G18', 'G19', 'G20', 'G21']) {
        const g = v7.queries.find((q) => q.id === id);
        expect(g?.diffCount, id).toBe(0);
        expect(g?.keys, id).toBeGreaterThan(0);
      }
    }
  });
});

describe('the program', () => {
  it('sessions keep their legacy wall clock in the event timezone, rooms and same-event speakers', async () => {
    const weekly = await one(
      sql()<{ id: string; timezone: string; profile: string }[]>`
        select id, timezone, profile from events.events where slug = ${'lakeshore-jazz-weekly'}`,
    );
    const rows = await sql()<{ title: string; wall: string; room: string | null; speakers: string[] }[]>`
      select s.title, to_char(s.starts_at at time zone ${weekly.timezone}, 'YYYY-MM-DD HH24:MI') as wall, r.name as room,
             array(select sp.name from program.session_speakers l join program.speakers sp on sp.id = l.speaker_id
                   where l.session_id = s.id order by l.position) as speakers
      from program.sessions s left join program.rooms r on r.id = s.room_id
      where s.event_id = ${weekly.id} order by s.starts_at`;
    expect(rows).toEqual([
      {
        title: DEMO.program.session,
        wall: '2026-01-06 19:00',
        room: DEMO.program.room,
        speakers: [DEMO.program.speaker],
      },
      {
        title: DEMO.program.lateSession,
        wall: '2026-01-06 22:00',
        room: DEMO.program.room,
        speakers: ['Jo Ellison'],
      },
    ]);
    // One room for both sessions; the event takes the conference profile (its console has the program).
    const [rooms] = await sql()`select count(*)::int as n from program.rooms where event_id = ${weekly.id}`;
    expect(rooms?.n).toBe(1);
    expect(weekly.profile).toBe('conference');
    expect(exceptionsOf(first.yay, 'event_profile_conference')).toBeGreaterThan(0);
  });

  it('fixes an end before the start, drops unknown speakers and lists paid access', async () => {
    const p = facts.yay?.facts.program;
    const fixed = await ref('event_sessions', p?.endFixedSession ?? 0);
    const s = await one(
      sql()<{ minutes: number }[]>`
        select (extract(epoch from ends_at - starts_at) / 60)::int as minutes from program.sessions where id = ${fixed.new_id}`,
    );
    expect(s.minutes).toBe(60);
    expect(exceptionsOf(first.yay, 'session_end_fixed')).toBe(1);
    expect(exceptionsOf(first.yay, 'session_speaker_missing')).toBe(1);
    expect(exceptionsOf(first.yay, 'session_access_not_migrated')).toBe(1);
    // Speaker links: http(s) only.
    const [bad] = await sql()`
      select count(*)::int as n from program.speakers sp join legacy.ref r on r.new_id = sp.id and r.instance in ('yay', 'abc')
      where sp.links::text ilike '%javascript:%'`;
    expect(bad?.n).toBe(0);
    expect(exceptionsOf(first.yay, 'speaker_link_dropped')).toBeGreaterThan(0);
  });

  it('turns performer tags into a speaker per linked event, not the switched-off one, without contacts', async () => {
    const p = facts.yay?.facts.program;
    const links = p?.tagLinks ?? [];
    for (const [tag, event] of links) {
      const r = await ref('event_tag', `${tag}:${event}`);
      const ev = await ref('events', event);
      const sp = await one(
        sql()<{ event_id: string }[]>`select event_id from program.speakers where id = ${r.new_id}`,
      );
      expect(sp.event_id).toBe(ev.new_id);
    }
    const [off] = await sql()`
      select count(*)::int as n from legacy.ref where instance = 'yay' and entity = 'event_tag' and legacy_id like ${`${p?.inactiveTag}:%`}`;
    expect(off?.n).toBe(0);
    expect(exceptionsOf(first.yay, 'tag_inactive_not_migrated')).toBe(1);
    // Legacy contact fields (performers, exhibitor staff) are copied nowhere in the program.
    const [leaked] = await sql()`
      select (select count(*) from program.speakers where bio ilike '%@example.org%' or links::text ilike '%@example.org%')
           + (select count(*) from program.exhibitors where description ilike '%@example.org%')
           + (select count(*) from program.sponsors where description ilike '%@example.org%') as n`;
    expect(Number(leaked?.n)).toBe(0);
    expect(exceptionsOf(first.yay, 'tag_contact_not_migrated')).toBeGreaterThan(0);
    expect(exceptionsOf(first.yay, 'exhibitor_contact_not_migrated')).toBeGreaterThan(0);
  });

  it('makes sponsors of exhibitors with a level, in ordered tiers of the same event', async () => {
    const p = facts.yay?.facts.program;
    for (const id of p?.sponsorExhibitors ?? []) {
      const s = await ref('exhibitor_sponsors', id);
      const row = await one(
        sql()<{ tier: string; position: number; same: boolean }[]>`
          select t.name as tier, t.position, t.event_id = sp.event_id as same
          from program.sponsors sp join program.sponsor_tiers t on t.id = sp.tier_id where sp.id = ${s.new_id}`,
      );
      expect(['Platinum', 'Gold', 'Silver', 'Bronze']).toContain(row.tier);
      expect(row.position).toBe({ Platinum: 1, Gold: 2, Silver: 3, Bronze: 4 }[row.tier]);
      expect(row.same).toBe(true);
    }
    const bad = await ref('event_exhibitors', p?.badWebsiteExhibitor ?? 0);
    const ex = await one(
      sql()<
        { website_url: string | null }[]
      >`select website_url from program.exhibitors where id = ${bad.new_id}`,
    );
    expect(ex.website_url).toBeNull();
    expect(exceptionsOf(first.yay, 'exhibitor_website_dropped')).toBe(1);
  });

  it('is what the public event page and speaker page read (allowlisted)', async () => {
    const target = await pageTarget('lakeshore-jazz-weekly');
    if (!target) throw new Error('weekly event has no public page');
    const program = await publicProgram(target);
    expect(program.sessions.map((s) => s.title)).toEqual([DEMO.program.session, DEMO.program.lateSession]);
    expect(program.sessions[0]?.room).toBe(DEMO.program.room);
    expect(program.speakers.map((s) => s.name).sort()).toEqual(
      ['Jo Ellison', DEMO.program.speaker, DEMO.program.tagSpeaker].sort(),
    );
    expect(program.exhibitors.map((e) => e.name)).toEqual([DEMO.program.exhibitor]);
    expect(program.sponsorTiers).toEqual([
      { name: 'Gold', sponsors: [expect.objectContaining({ name: DEMO.program.exhibitor })] },
    ]);
    const mara = program.speakers.find((s) => s.name === DEMO.program.speaker);
    const page = await publicSpeaker(target, mara?.id ?? '');
    expect(page?.speaker.title).toBe(DEMO.program.speakerTitle);
    expect(page?.speaker.bio).toContain('**SYNTHETIC TEST DATA ONLY**');
    expect(page?.sessions.map((s) => s.title)).toEqual([DEMO.program.session]);
  });
});

describe('announcements, sections and private info', () => {
  it('announcements: active ones are published (alerts pinned), inactive ones drafts', async () => {
    const rows = await sql()<{ title: string; pinned: boolean; published: boolean; body: string }[]>`
      select a.title, a.pinned, a.published_at is not null as published, a.body from events.event_announcements a
      join legacy.ref r on r.new_id = a.id and r.instance = 'yay' and r.entity = 'event_announcements' order by r.compat_id`;
    expect(rows.some((a) => a.title === 'Parking update' && a.pinned && a.published)).toBe(true);
    expect(rows.some((a) => a.title === 'Draft note' && !a.published)).toBe(true);
    expect(rows.every((a) => !a.body.includes('<'))).toBe(true);
    const target = await pageTarget('lakeshore-jazz-weekly');
    if (!target) throw new Error('no target');
    const content = await publicEventContent(target);
    expect(content.announcements.map((a) => a.title)).toContain(DEMO.program.announcement);
  });

  it('custom sections: an accordion becomes an FAQ, cards a text list, both valid for the event page', async () => {
    const rows = await sql()<
      { kind: string; title: string; content: { items?: unknown[]; markdown?: string } }[]
    >`
      select s.kind, s.title, s.content from events.event_sections s
      join legacy.ref r on r.new_id = s.id and r.instance = 'yay' and r.entity = 'event_custom_sections' order by s.position`;
    expect(rows.map((r) => [r.kind, r.title])).toEqual([
      ['faq', 'Questions'],
      ['text', 'What to bring'],
    ]);
    expect(rows[0]?.content.items).toHaveLength(2);
    expect(rows[1]?.content.markdown).toContain('**Ticket**');
    expect(exceptionsOf(first.yay, 'section_items_skipped')).toBe(1);
    const ev = await one(sql()<{ slug: string; org_id: string; id: string }[]>`
      select e.slug, e.org_id, e.id from events.events e join events.event_sections s on s.event_id = e.id
      join legacy.ref r on r.new_id = s.id and r.entity = 'event_custom_sections' and r.instance = 'yay' limit 1`);
    const target = (await pageTarget(ev.slug)) ?? { orgId: ev.org_id, eventId: ev.id };
    const content = await publicEventContent(target);
    expect(content.sections.map((s) => s.kind)).toEqual(['faq', 'text']);
  });

  it('private info reaches ticket holders only, never a public read', async () => {
    const ev = await one(sql()<{ slug: string; org_id: string; id: string; body: string }[]>`
      select e.slug, e.org_id, e.id, p.body from events.event_private_info p join events.events e on e.id = p.event_id
      join legacy.ref r on r.new_id = p.id and r.instance = 'yay' and r.entity = 'event_private_info'
      where e.status = 'published' order by e.slug limit 1`);
    expect(ev.body).toBe('**Wi-Fi:** invented-network');
    const target = (await pageTarget(ev.slug)) ?? { orgId: ev.org_id, eventId: ev.id };
    expect(JSON.stringify(await publicEventContent(target))).not.toContain('invented-network');
    expect(JSON.stringify(await publicProgram(target))).not.toContain('invented-network');
    expect((await holderEventContent(target))?.privateInfo).toBe('**Wi-Fi:** invented-network');
  });
});

describe('T7 CMS content', () => {
  it('platform pages go to the platform org, an organizer’s page to its org, with CMS slugs and Markdown', async () => {
    const rows = await sql()<
      { legacy_id: string; org_slug: string; kind: string; slug: string; status: string; body: string }[]
    >`
      select r.entity || ':' || r.legacy_id as legacy_id, o.slug as org_slug, e.kind, e.slug, e.status, e.body
      from cms.entries e join legacy.ref r on r.new_id = e.id and r.instance = 'yay' and r.entity in ('pages', 'posts')
      join tenancy.organizations o on o.id = e.org_id order by 1`;
    const by = new Map(rows.map((r) => [r.legacy_id, r]));
    expect(by.get('pages:1')).toMatchObject({
      org_slug: 'yayatoh',
      kind: 'page',
      slug: 'about',
      status: 'published',
    });
    expect(by.get('pages:2')).toMatchObject({
      org_slug: 'yayatoh',
      slug: 'terms-of-service',
      status: 'published',
    });
    expect(by.get('pages:2')?.body).toContain('[Read more](https://example.org/terms)');
    expect(by.get('pages:2')?.body).not.toMatch(/<script|alert/);
    expect(by.get('pages:3')).toMatchObject({ slug: 'old-promo', status: 'draft' });
    expect(by.get('pages:4')).toMatchObject({
      org_slug: 'lakeshore-jazz-society',
      slug: DEMO.page.slug,
      status: 'published',
    });
    expect(by.get('posts:1')).toMatchObject({ kind: 'post', status: 'published' });
    expect(by.get('posts:2')).toMatchObject({ kind: 'post', status: 'draft' });
    // abc content goes to ABC.
    const [abc] = await sql()`
      select count(*)::int as n from cms.entries e join legacy.ref r on r.new_id = e.id and r.instance = 'abc' and r.entity = 'pages'
      join tenancy.organizations o on o.id = e.org_id where o.slug = 'abc'`;
    expect(abc?.n).toBeGreaterThan(0);
    // The public read serves the published organizer page and never the draft.
    const org = await one(
      sql()<{ id: string }[]>`select id from tenancy.organizations where slug = 'lakeshore-jazz-society'`,
    );
    expect((await publicEntry(org.id, 'page', DEMO.page.slug))?.title).toBe(DEMO.page.title);
    const platform = await one(
      sql()<{ id: string }[]>`select id from tenancy.organizations where slug = 'yayatoh'`,
    );
    expect(await publicEntry(platform.id, 'page', 'old-promo')).toBeNull();
  });
});

describe('T6 chats, blocks and reports (no target module)', () => {
  it('stay in staging, each listed for the owner, and are copied into no messaging table', async () => {
    const c = facts.yay?.facts.chats;
    expect(exceptionsOf(first.yay, 'chat_not_migrated')).toBe(c?.chats);
    expect(exceptionsOf(first.yay, 'chat_block_not_migrated')).toBe(c?.blocks);
    expect(exceptionsOf(first.yay, 'chat_report_not_migrated')).toBe(c?.reports);
    const [staged] = await sql()`select count(*)::int as n from legacy_yay.messages`;
    expect(staged?.n).toBe(c?.messages);
    const [copied] = await sql()`
      select (select count(*) from messaging.thread_messages where body like 'Invented chat message%')
           + (select count(*) from messaging.reports where note like 'Invented report%') as n`;
    expect(Number(copied?.n)).toBe(0);
  });
});

describe('media manifest', () => {
  it('lists every referenced upload under its R2 key with its target; underlays match their plans', async () => {
    const rows = await sql()<
      { entity: string; role: string; target: string; path: string; storage_key: string }[]
    >`
      select entity, role, target, path, storage_key from legacy.media_refs where instance = 'yay' order by entity, legacy_id, role, position`;
    const targets = new Set(rows.map((r) => `${r.entity}:${r.role}:${r.target}`));
    for (const t of [
      'seatcharts:underlay:underlay:seating.layouts',
      'events:cover:media:event:cover',
      'venues:photo:media:venue:photo',
      'event_speakers:avatar:none:program.speakers',
      'event_exhibitors:logo:none:program.exhibitors',
      'event_sessions:thumbnail:none:program.sessions',
      'event_tag:image:none:program.speakers',
      'pages:image:none:cms.entries',
    ])
      expect(targets.has(t), t).toBe(true);
    // The SQL key rule is the TypeScript one (legacyMediaUrl, used for the plan underlays).
    for (const r of rows) expect(r.storage_key).toBe(legacyMediaUrl('yay', r.path));
    const [mismatch] = await sql()`
      select count(*)::int as n from seating.layouts l join legacy.ref r on r.new_id = l.id and r.entity = 'seatcharts'
      where not exists (select 1 from legacy.media_refs m where m.new_id = l.id and m.storage_key = l.doc -> 'underlay' ->> 'url')`;
    expect(mismatch?.n).toBe(0);
    expect(exceptionsOf(first.yay, 'media_no_target')).toBeGreaterThan(0);
  });
});

describe('URL inventory (pages, posts, performer tags)', () => {
  it('redirects changed and organizer URLs, serves unchanged ones, and never redirects drafts', async () => {
    const urls = await sql()<{ path: string; kind: string; planned_status: number; target: string | null }[]>`
      select path, kind, planned_status, target from legacy.url_inventory
      where instance = 'yay' and host = 'yayatoh.com' and kind in ('page', 'post', 'tag') order by path`;
    const at = (p: string) => urls.find((u) => u.path === p);
    expect(at('/pages/about')).toMatchObject({ planned_status: 200, target: null });
    expect(at('/pages/Terms_Of_Service')).toMatchObject({
      planned_status: 308,
      target: '/pages/terms-of-service',
    });
    expect(at('/pages/terms_of_service')).toMatchObject({
      planned_status: 308,
      target: '/pages/terms-of-service',
    });
    expect(at('/pages/old-promo')).toMatchObject({ planned_status: 404 });
    expect(at(`/pages/${DEMO.page.slug}`)).toMatchObject({
      planned_status: 308,
      target: `/o/lakeshore-jazz-society/pages/${DEMO.page.slug}`,
    });
    expect(at(`/blogs/${facts.yay?.facts.posts[1]?.slug}`)).toMatchObject({ planned_status: 404 });
    for (const u of urls.filter((x) => x.planned_status === 308))
      expect(await matchLegacyRedirect('yayatoh.com', u.path), u.path).toMatchObject({
        location: u.target,
        status: 308,
      });
    for (const u of urls.filter((x) => x.planned_status !== 308))
      expect(await matchLegacyRedirect('yayatoh.com', u.path), u.path).toBeNull();
    const tag = urls.find(
      (u) => u.path === `/events/lakeshore-jazz-weekly/tag_${DEMO.program.tagSpeaker.replace(' ', '-')}`,
    );
    expect(tag?.target).toMatch(/^\/events\/lakeshore-jazz-weekly\/speakers\/[0-9a-f-]{36}$/);
    // abc: an affiliate's page lives on yayatoh.com (the abc host is ABC's own site).
    const [aff] = await sql()<{ target: string }[]>`
      select target from legacy.url_inventory where instance = 'abc' and kind = 'page' and target like 'https://yayatoh.com/o/%'`;
    expect(aff?.target).toMatch(/^https:\/\/yayatoh\.com\/o\/[a-z0-9-]+\/pages\/our-story-abc$/);
  });
});

describe('isolation of migrated content (app_user, RLS)', () => {
  it('an org sees none of another org’s migrated program, content and CMS rows', async () => {
    const orgs = (
      await sql()<{ org_id: string }[]>`
        select s.org_id from program.speakers s join legacy.ref r on r.new_id = s.id and r.entity in ('event_speakers', 'event_tag')
        group by s.org_id order by count(*) desc, s.org_id limit 2`
    ).map((r) => r.org_id);
    const [a, b] = orgs;
    if (!a || !b) throw new Error('need two orgs with a migrated program');
    const tables = [
      'program.sessions',
      'program.speakers',
      'program.session_speakers',
      'program.rooms',
      'program.exhibitors',
      'program.sponsors',
      'program.sponsor_tiers',
      'events.event_announcements',
      'events.event_sections',
      'events.event_private_info',
      'cms.entries',
    ];
    await withTenant(
      createCtx({ orgId: a, actor: { type: 'system', name: 'm22d-isolation' } }),
      async (tx) => {
        for (const t of tables) {
          const [other] = await tx.execute<{ n: number }>(
            dsql.raw(`select count(*)::int as n from ${t} where org_id = '${b}'`),
          );
          expect(other?.n, t).toBe(0);
        }
        const [own] = await tx.execute<{ n: number }>(dsql`select count(*)::int as n from program.speakers`);
        expect(own?.n).toBeGreaterThan(0);
      },
    );
    await expect(
      withTenant(createCtx({ orgId: a, actor: { type: 'system', name: 'm22d-isolation' } }), (tx) =>
        tx.execute(dsql`select 1 from legacy.media_refs limit 1`),
      ),
    ).rejects.toThrow();
  });
});

describe('quarantine (rolled back)', () => {
  it('quarantines content rows of unknown events or without a name, title or time, and writes nothing for them', async () => {
    await rolledBack(async (tx) => {
      await tx`insert into legacy_yay.event_sessions (id, event_id, title, start_time, end_time, access_type)
               values (990001, 999999, 'Orphan', '2025-01-01 10:00', '2025-01-01 11:00', 'free'),
                      (990002, ${facts.yay?.facts.program.events[0] ?? 1}, ' ', '2025-01-01 10:00', '2025-01-01 11:00', 'free')`;
      await tx`insert into legacy_yay.event_speakers (id, event_id, name, "order")
               values (990003, ${facts.yay?.facts.program.events[0] ?? 1}, '<b></b>', 0)`;
      const ctx: StepContext = {
        sql: tx,
        instance: 'yay',
        runId: -4242,
        platformTz: 'America/New_York',
        currency: 'USD',
        commissionBps: 0,
        eventClock: 'platform',
        freezeAt: FREEZE,
        log: quiet,
      };
      await t3Program(ctx);
      const q = await tx<{ table_name: string; legacy_id: string; reason: string }[]>`
        select table_name, legacy_id, reason from legacy.quarantine where run_id = -4242 order by legacy_id`;
      expect(q).toEqual([
        { table_name: 'event_sessions', legacy_id: '990001', reason: 'unknown_event' },
        { table_name: 'event_sessions', legacy_id: '990002', reason: 'title_missing' },
        { table_name: 'event_speakers', legacy_id: '990003', reason: 'name_missing' },
      ]);
      const [written] = await tx`
        select count(*)::int as n from legacy.ref where instance = 'yay' and legacy_id in ('990001', '990002', '990003')`;
      expect(written?.n).toBe(0);
    });
    const [left] = await sql()`select count(*)::int as n from legacy_yay.event_sessions where id > 990000`;
    expect(left?.n).toBe(0);
  });
});

describe('idempotence and V10', () => {
  it('a rerun changes nothing and reproduces the content checksums', async () => {
    const tables = [
      'program.sessions',
      'program.speakers',
      'program.session_speakers',
      'program.rooms',
      'program.exhibitors',
      'program.sponsor_tiers',
      'program.sponsors',
      'events.event_announcements',
      'events.event_sections',
      'events.event_private_info',
      'cms.entries',
    ];
    const print = async () => {
      const out: Record<string, string> = {};
      for (const t of tables) {
        const [r] = await sql().unsafe(
          `select count(*)::text || ':' || coalesce(md5(string_agg(id::text, ',' order by id)), '') as f from ${t}`,
        );
        out[t] = String((r as unknown as { f: string }).f);
      }
      return out;
    };
    const before = await print();
    const r = await run('yay', dumps.yay);
    expectPass(r);
    expect(await print()).toEqual(before);
    const v10 = check(r, 'V10')?.details as {
      baselineRun: number | null;
      changed: string[];
      migrated: Record<string, string>;
    };
    expect(v10.baselineRun).not.toBeNull();
    expect(v10.changed).toEqual([]);
    for (const k of [
      'program_sessions',
      'program_speakers',
      'event_sections',
      'event_private_info',
      'cms_entries',
    ])
      expect(v10.migrated[k], k).toMatch(/^[0-9a-f]{32}$/);
    // Exceptions are listed again on the rerun (the owner reads the latest run).
    for (const kind of ['cms_slug_changed', 'event_profile_conference', 'chat_not_migrated'])
      expect(exceptionsOf(r, kind), kind).toBe(exceptionsOf(first.yay, kind));
  });
});

describe('planted defects (rolled back)', () => {
  const opts = { platformTz: 'America/New_York', eventClock: 'platform' as const, freezeAt: FREEZE };
  const latestRun = async () =>
    Number(
      (
        await one(
          sql()<
            { id: string }[]
          >`select max(id)::text as id from legacy.runs where instance = 'yay' and status = 'succeeded'`,
        )
      ).id,
    );

  it('V1 and V7 catch a lost session; V4 a speaker linked across events; V9 a lost page redirect; V10 an edited page', async () => {
    const runId = await latestRun();
    await rolledBack(async (tx) => {
      const [s] = await tx<{ id: string }[]>`
        select s.id from program.sessions s join legacy.ref r on r.new_id = s.id and r.instance = 'yay' and r.entity = 'event_sessions'
        where not exists (select 1 from program.session_speakers l where l.session_id = s.id) limit 1`;
      await tx`delete from program.sessions where id = ${s?.id ?? ''}`;
      const r = await validate(tx, 'yay', runId, opts);
      expect(check({ report: r }, 'V1')?.pass).toBe(false);
      expect(check({ report: r }, 'V4')?.pass).toBe(false); // its legacy.ref now points nowhere
      expect(check({ report: r }, 'V7')?.pass).toBe(false);
      expect(r.pass).toBe(false);
    });
    await rolledBack(async (tx) => {
      // A session speaker moved to a speaker of another event of the same org.
      const [pair] = await tx<{ link: string; other: string }[]>`
        select l.id as link, o.id as other from program.session_speakers l
        join program.sessions s on s.id = l.session_id
        join legacy.ref r on r.new_id = s.id and r.instance = 'yay' and r.entity = 'event_sessions'
        join program.speakers o on o.org_id = s.org_id and o.event_id <> s.event_id
        limit 1`;
      await tx`update program.session_speakers set speaker_id = ${pair?.other ?? ''} where id = ${pair?.link ?? ''}`;
      const r = await validate(tx, 'yay', runId, opts);
      expect(
        (check({ report: r }, 'V4')?.details as Record<string, number> | undefined)
          ?.session_speakers_other_event,
      ).toBe(1);
      expect(check({ report: r }, 'V4')?.pass).toBe(false);
    });
    await rolledBack(async (tx) => {
      await tx`delete from marketplace.legacy_redirects where host = 'yayatoh.com' and source = ${`/pages/${DEMO.page.slug}`}`;
      await tx`update cms.entries set title = 'Edited after the run' where slug = 'about'
               and id in (select new_id from legacy.ref where instance = 'yay' and entity = 'pages')`;
      const r = await validate(tx, 'yay', runId, opts);
      expect(check({ report: r }, 'V9')?.pass).toBe(false);
      const v10 = check({ report: r }, 'V10')?.details as { changed: string[] };
      expect(v10.changed).toContain('migrated.cms_entries');
    });
    // Nothing of it stayed.
    expect((await validate(sql(), 'yay', runId, opts)).pass).toBe(true);
  });
});
