import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventSectionDto } from '@yayatoh/events';
import {
  isInsert,
  parseCreateTable,
  parseInsert,
  type SqlValue,
  StatementSplitter,
} from '@yayatoh/legacy-mask';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  decodeEntities,
  htmlToMarkdown,
  legacyTagPathSegment,
  plainLine,
  privateInfoMarkdown,
  sectionFromLegacy,
  speakerLinks,
  sponsorTier,
  urlSafeSegment,
  webUrl,
} from '../src/content.ts';
import { GOLDEN_QUERIES } from '../src/golden.ts';
import { STAGES } from '../src/run.ts';
import { DEMO, generateDumpFile, type SynthSummary } from '../src/synth/generate.ts';

/** M2.2d pure rules: legacy rich text, links, private info, sections, tags; the new synthetic tables. */
describe('legacy rich text → the Markdown subset', () => {
  it('keeps paragraphs, headings, lists, emphasis and safe links; drops scripts and unsafe links', () => {
    const md = htmlToMarkdown(
      '<h1>Title</h1><p>Hello <strong>bold</strong> and <em>it</em>.<br>Next line</p>' +
        '<ul><li>One</li><li>Two</li></ul><ol><li>First</li><li>Second</li></ol>' +
        '<p><a href="https://example.org/x">site</a> <a href="javascript:alert(1)">bad</a></p>' +
        '<script>alert("x")</script><style>p{}</style><p>&amp; &lt;tag&gt; &#8211; &#x2014;</p>',
    );
    expect(md).toBe(
      [
        '## Title',
        '',
        'Hello **bold** and *it*.',
        'Next line',
        '',
        '- One',
        '- Two',
        '',
        '1. First',
        '2. Second',
        '',
        '[site](https://example.org/x) bad',
        '',
        '& <tag> – —',
      ].join('\n'),
    );
    expect(md).not.toContain('alert');
    expect(md).not.toContain('javascript');
  });

  it('passes plain text through (entities decoded), strips control and bidi characters, caps the length', () => {
    expect(htmlToMarkdown('Fish &amp; chips‮')).toBe('Fish & chips');
    expect(htmlToMarkdown(null)).toBe('');
    expect(htmlToMarkdown('<p></p><div> </div>')).toBe('');
    expect(htmlToMarkdown(`<p>${'x'.repeat(50)}</p>`, 10)).toHaveLength(10);
    expect(decodeEntities('&unknown; &#0; &#xD800;')).toBe('&unknown;  ');
  });

  it('plain lines drop tags and collapse whitespace; web URLs are http(s) only', () => {
    expect(plainLine('  <b>Main</b>\n  Hall ', 80)).toBe('Main Hall');
    expect(plainLine('abcdef', 3)).toBe('abc');
    expect(webUrl('https://example.org/a')).toBe('https://example.org/a');
    expect(webUrl('www.example.org')).toBeNull();
    expect(webUrl('javascript:alert(1)')).toBeNull();
    expect(webUrl('ftp://example.org')).toBeNull();
  });
});

describe('speaker links', () => {
  it('reads the legacy object and array forms, keeps http(s) only and counts what it drops', () => {
    expect(
      speakerLinks('{"linkedin":"https://example.org/in/a","twitter":"javascript:alert(1)","x":""}'),
    ).toEqual({ links: [{ label: 'LinkedIn', url: 'https://example.org/in/a' }], dropped: 1 });
    expect(speakerLinks(['https://example.org/p', 'relative/path'])).toEqual({
      links: [{ label: 'example.org', url: 'https://example.org/p' }],
      dropped: 1,
    });
    expect(speakerLinks([{ label: 'Blog', url: 'https://example.org/b' }]).links).toEqual([
      { label: 'Blog', url: 'https://example.org/b' },
    ]);
    expect(speakerLinks('not json')).toEqual({ links: [], dropped: 0 });
    const many = Object.fromEntries(
      Array.from({ length: 15 }, (_, i) => [`l${i}`, `https://example.org/${i}`]),
    );
    expect(speakerLinks(many).links).toHaveLength(10);
  });
});

describe('private info (ticket holders only)', () => {
  it('renders the legacy keys in a fixed order, then any other key', () => {
    const md = privateInfoMarkdown(
      JSON.stringify({
        notes: '<p>Bring ID</p>',
        wifi: 'invented-network',
        parking: { lot: 'B', code: 1234 },
        program: ['Doors 6pm', 'Show 7pm'],
        visuals: ['a.jpg'],
        extra: 'Gate 3',
      }),
    );
    expect(md).toBe(
      [
        '**Wi-Fi:** invented-network',
        '**Parking:** lot: B; code: 1234',
        '**Program**\n\n- Doors 6pm\n- Show 7pm',
        '**Notes:** Bring ID',
        '**extra:** Gate 3',
      ].join('\n\n'),
    );
    expect(md).not.toContain('a.jpg');
  });

  it('is empty for nothing usable', () => {
    for (const v of ['{}', 'null', '[]', 'not json', '{"wifi": ""}', null])
      expect(privateInfoMarkdown(v)).toBe('');
  });
});

describe('custom sections', () => {
  const item = (title: string | null, content: string | null, active = true) => ({ title, content, active });

  it('an accordion becomes an FAQ the events module accepts; incomplete items are skipped', () => {
    const s = sectionFromLegacy('accordion', [
      item('Is there parking?', '<p>Yes, <strong>free</strong>.</p>'),
      item('Empty', ''),
      item('Hidden', 'x', false),
    ]);
    expect(s).toEqual({
      kind: 'faq',
      content: { items: [{ question: 'Is there parking?', answer: 'Yes, **free**.' }] },
      skipped: 2,
    });
    const dto = EventSectionDto.safeParse({
      id: '00000000-0000-4000-8000-000000000001',
      eventId: '00000000-0000-4000-8000-000000000002',
      title: 'Questions',
      position: 1,
      visible: true,
      ...s,
    });
    expect(dto.success).toBe(true);
  });

  it('cards and lists become a text section with a bulleted list; nothing usable is null', () => {
    expect(sectionFromLegacy('cards', [item('Ticket', 'On your phone.'), item('Water', null)])).toEqual({
      kind: 'text',
      content: { markdown: '- **Ticket** — On your phone.\n- **Water**' },
      skipped: 0,
    });
    expect(sectionFromLegacy('list', [item(null, null)])).toBeNull();
    expect(sectionFromLegacy('accordion', [item('Q', null)])).toBeNull();
  });
});

describe('sponsor levels and legacy tag URLs', () => {
  it('maps the four legacy levels to ordered tiers', () => {
    expect(sponsorTier('Platinum')).toEqual({ name: 'Platinum', position: 1 });
    expect(sponsorTier(' bronze ')).toEqual({ name: 'Bronze', position: 4 });
    expect(sponsorTier('none')).toBeNull();
    expect(sponsorTier(null)).toBeNull();
  });

  it('builds the tag path segment as the legacy views did (spaces → hyphens), encoded', () => {
    expect(legacyTagPathSegment('Theo Brass')).toBe('tag_Theo-Brass');
    expect(legacyTagPathSegment('Café Trio')).toBe('tag_Caf%C3%A9-Trio');
    expect(legacyTagPathSegment("O'Neil & Co")).toBe("tag_O'Neil-%26-Co");
    expect(urlSafeSegment("tag_O'Neil-%26-Co")).toBe(true);
    expect(urlSafeSegment('a/b')).toBe(false);
    expect(urlSafeSegment('bad%zz')).toBe(false);
  });
});

describe('pipeline shape', () => {
  it('runs the M2.2d stages after the ones they read, and the URL inventory last', () => {
    const at = (s: string) => STAGES.indexOf(s as (typeof STAGES)[number]);
    expect(at('t3_program')).toBeGreaterThan(at('t3_seating'));
    expect(at('t7_content')).toBeGreaterThan(at('t6_comms'));
    expect(at('media_refs')).toBeGreaterThan(at('t7_content'));
    expect(STAGES[STAGES.length - 1]).toBe('url_inventory');
    expect(STAGES).toContain('t6_chats');
  });

  it('golden queries cover the program and CMS, and name the staging tables they need', () => {
    const ids = GOLDEN_QUERIES.map((g) => g.id);
    for (const id of ['G15', 'G16', 'G17', 'G18', 'G19', 'G20', 'G21']) expect(ids).toContain(id);
    for (const g of GOLDEN_QUERIES.filter((x) => Number(x.id.slice(1)) >= 15))
      expect(g.requires?.length, g.id).toBeGreaterThan(0);
  });
});

// --- the synthetic generator's M2.2d tables --------------------------------------------------------
const dir = mkdtempSync(join(tmpdir(), 'synth-m22d-'));
let summary: SynthSummary;
let rows: Map<string, Record<string, string | null>[]>;

function rowsOf(text: string): Map<string, Record<string, string | null>[]> {
  const stmts = new StatementSplitter().push(text);
  const cols = new Map<string, string[]>();
  const out = new Map<string, Record<string, string | null>[]>();
  const val = (v: SqlValue) => (v.kind === 'null' ? null : v.kind === 'str' ? v.value : v.raw);
  for (const st of stmts) {
    const def = parseCreateTable(st);
    if (def)
      cols.set(
        def.name,
        def.columns.map((c) => c.name),
      );
    else if (isInsert(st)) {
      const ins = parseInsert(st);
      const names = cols.get(ins.table) ?? [];
      const list = out.get(ins.table) ?? [];
      for (const r of ins.rows)
        list.push(Object.fromEntries(names.map((n, i) => [n, val(r[i] ?? { kind: 'null' })])));
      out.set(ins.table, list);
    }
  }
  return out;
}

beforeAll(async () => {
  const path = join(dir, 'yay.sql');
  summary = await generateDumpFile(path, { instance: 'yay', scale: 'small', demo: true });
  rows = rowsOf(readFileSync(path, 'utf8'));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('synthetic legacy generator (M2.2d tables)', () => {
  it('writes the program, content, tags, posts and chats tables', () => {
    for (const t of [
      'event_speakers',
      'event_sessions',
      'event_exhibitors',
      'event_announcements',
      'event_custom_sections',
      'event_custom_section_items',
      'tags',
      'event_tag',
      'posts',
      'chats',
      'messages',
      'blocked_users',
      'message_reports',
    ])
      expect(rows.get(t)?.length ?? 0, t).toBeGreaterThan(0);
    expect(rows.get('pages')?.length).toBe(summary.facts.pages.length);
    expect(summary.facts.chats).toEqual({
      chats: rows.get('chats')?.length,
      messages: rows.get('messages')?.length,
      blocks: 1,
      reports: 2,
    });
  });

  it('plants every M2.2d case', () => {
    const p = summary.facts.program;
    for (const k of [
      'endFixedSession',
      'missingSpeakerSession',
      'paidSession',
      'badWebsiteExhibitor',
      'inactiveTag',
    ] as const)
      expect(p[k], k).not.toBeNull();
    const sessions = new Map((rows.get('event_sessions') ?? []).map((s) => [Number(s.id), s]));
    const fixed = sessions.get(p.endFixedSession as number);
    expect(fixed?.end_time).toBe(fixed?.start_time);
    expect(sessions.get(p.paidSession as number)?.access_type).toBe('paid');
    const speakerIds = new Set((rows.get('event_speakers') ?? []).map((s) => s.id));
    const named = JSON.parse(
      sessions.get(p.missingSpeakerSession as number)?.speaker_ids ?? '[]',
    ) as number[];
    expect(named.some((id) => !speakerIds.has(String(id)))).toBe(true);
    expect(p.sponsorExhibitors.length).toBeGreaterThan(0);
    expect(p.tagLinks.length).toBeGreaterThan(0);
    // The organizer's page (e2e) and the old-style slug that must redirect.
    expect(summary.facts.pages.some((x) => x.slug === DEMO.page.slug)).toBe(true);
    expect(summary.facts.pages.some((x) => x.slug === 'Terms_Of_Service')).toBe(true);
    expect(summary.facts.pages.some((x) => !x.active)).toBe(true);
    expect(summary.facts.posts.map((x) => x.published)).toEqual([true, false]);
  });

  it('gives the demo weekly event its fixed program (e2e)', () => {
    const names = (rows.get('event_sessions') ?? []).map((s) => s.title);
    expect(names).toContain(DEMO.program.session);
    expect((rows.get('event_speakers') ?? []).map((s) => s.name)).toContain(DEMO.program.speaker);
    expect((rows.get('tags') ?? []).map((s) => s.title)).toContain(DEMO.program.tagSpeaker);
    expect((rows.get('event_exhibitors') ?? []).map((s) => s.name)).toContain(DEMO.program.exhibitor);
  });

  it('plants invalid rows only where the 0.5% content allowance holds (large scale)', () => {
    expect((rows.get('event_sessions') ?? []).some((s) => s.event_id === '999999')).toBe(false);
  });
});
