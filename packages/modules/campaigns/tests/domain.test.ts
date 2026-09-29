import { reachable } from '@yayatoh/kernel';
import { applyMerge, mergeProblems, recipientValues, splitName } from '@yayatoh/notifications/merge';
import { describe, expect, it } from 'vitest';
import { CampaignContent, linkBlocks, moveBlock, newBlockId, starterContent } from '../src/domain/blocks.ts';
import { campaignLifecycle, exclusionReason, type ReachFacts } from '../src/domain/lifecycle.ts';
import { renderCampaign } from '../src/domain/render.ts';
import { allocate, type OrgLane, ratePerMinute } from '../src/domain/scheduler.ts';

const E = '0190a3f0-0000-7000-8000-000000000001';

describe('merge fields', () => {
  it('fills known fields and uses the fallback when a value is empty', () => {
    const v = recipientValues({ name: 'Amina Diallo', email: 'a@x.test', orgName: 'Lakeside' });
    expect(applyMerge('Hi {{first_name|there}}, from {{ org_name }}', v)).toBe('Hi Amina, from Lakeside');
    expect(applyMerge('{{last_name}} / {{name}} / {{email}}', v)).toBe('Diallo / Amina Diallo / a@x.test');
    const empty = recipientValues({ name: null, email: null, orgName: 'Lakeside' });
    expect(applyMerge('Hi {{first_name|there}}!', empty)).toBe('Hi there!');
    expect(applyMerge('Hi {{first_name}}!', empty)).toBe('Hi !');
  });

  it('escapes recipient values in HTML, never the organizer fallback twice', () => {
    const v = recipientValues({ name: '<script>x</script>', email: null, orgName: 'O' });
    expect(applyMerge('<p>{{first_name|friend}}</p>', v, { html: true })).toBe('<p>&lt;script&gt;x&lt;/script&gt;</p>');
    expect(applyMerge('<p>{{first_name|Tom &amp; Jo}}</p>', recipientValues({ orgName: 'O' }), { html: true })).toBe(
      '<p>Tom &amp; Jo</p>',
    );
  });

  it('does not re-expand tokens inside values', () => {
    const v = { ...recipientValues({ name: '{{@unsubscribe}}', orgName: 'O' }), system: { unsubscribe: 'U' } };
    expect(applyMerge('{{first_name}} {{@unsubscribe}}', v)).toBe('{{@unsubscribe}} U');
  });

  it('reports unknown and malformed fields; system tokens are not typeable', () => {
    expect(mergeProblems('Hi {{first_name|there}} {{name}}')).toEqual([]);
    expect(mergeProblems('Hi {{firstname}}')).toEqual(['{{firstname}}']);
    expect(mergeProblems('{{@unsubscribe}}')).toEqual(['{{@unsubscribe}}']);
    expect(mergeProblems('{{first_name|a{b}}')).toHaveLength(1);
  });

  it('splits names', () => {
    expect(splitName('  Mary  Ann Lee ')).toEqual({ first: 'Mary', last: 'Ann Lee' });
    expect(splitName(null)).toEqual({ first: '', last: '' });
  });
});

describe('blocks', () => {
  const valid = {
    subject: 'Spring news for {{first_name|you}}',
    blocks: [
      { id: 'b1', type: 'heading', text: 'Hello' },
      { id: 'b2', type: 'button', label: 'Get tickets', eventId: E },
      { id: 'b3', type: 'eventCard', eventId: E },
      { id: 'b9', type: 'footer', postalAddress: '1 Lake St, Chicago IL' },
    ],
  };

  it('accepts a document with the footer last and fills defaults', () => {
    const c = CampaignContent.parse(valid);
    expect(c.font).toBe('sans');
    expect(linkBlocks(c).map((b) => b.id)).toEqual(['b2', 'b3']);
  });

  it('requires exactly one footer, last, with a postal address', () => {
    const noFooter = { ...valid, blocks: valid.blocks.slice(0, 3) };
    expect(CampaignContent.safeParse(noFooter).success).toBe(false);
    const footerFirst = { ...valid, blocks: [valid.blocks[3], ...valid.blocks.slice(0, 3)] };
    expect(CampaignContent.safeParse(footerFirst).success).toBe(false);
    const noAddress = { ...valid, blocks: [...valid.blocks.slice(0, 3), { id: 'b9', type: 'footer', postalAddress: '' }] };
    expect(CampaignContent.safeParse(noAddress).success).toBe(false);
  });

  it('refuses unknown merge fields, unsafe paths and images, duplicate ids', () => {
    const bad = (blocks: unknown[]) =>
      CampaignContent.safeParse({ ...valid, blocks: [...blocks, valid.blocks[3]] }).success;
    expect(bad([{ id: 'b1', type: 'text', text: 'Hi {{nickname}}' }])).toBe(false);
    expect(bad([{ id: 'b1', type: 'button', label: 'Go', eventId: E, path: '//evil.test' }])).toBe(false);
    expect(bad([{ id: 'b1', type: 'button', label: 'Go', eventId: E, path: '/events/../admin' }])).toBe(false);
    expect(bad([{ id: 'b1', type: 'button', label: 'Go', eventId: E, path: '/events/spring' }])).toBe(true);
    expect(bad([{ id: 'b1', type: 'image', src: 'javascript:alert(1)', alt: 'x' }])).toBe(false);
    expect(bad([{ id: 'b1', type: 'image', src: 'http://x.test/a.png', alt: 'x' }])).toBe(false);
    expect(bad([{ id: 'b1', type: 'image', src: 'https://x.test/a.png', alt: '' }])).toBe(false);
    expect(bad([{ id: 'b1', type: 'image', src: 'https://x.test/a.png', alt: 'Stage' }])).toBe(true);
    expect(
      bad([
        { id: 'b1', type: 'divider' },
        { id: 'b1', type: 'divider' },
      ]),
    ).toBe(false);
  });

  it('moves blocks up and down (the keyboard alternative to drag); the footer stays last', () => {
    const blocks = CampaignContent.parse(valid).blocks;
    expect(moveBlock(blocks, 'b2', -1).map((b) => b.id)).toEqual(['b2', 'b1', 'b3', 'b9']);
    expect(moveBlock(blocks, 'b1', -1).map((b) => b.id)).toEqual(['b1', 'b2', 'b3', 'b9']);
    expect(moveBlock(blocks, 'b3', 1).map((b) => b.id)).toEqual(['b1', 'b2', 'b3', 'b9']);
    expect(moveBlock(blocks, 'b9', -1).map((b) => b.id)).toEqual(['b1', 'b2', 'b3', 'b9']);
    expect(newBlockId(blocks)).not.toMatch(/^(b1|b2|b3|b9)$/);
  });

  it('starts from a heading, a paragraph and the footer', () => {
    const s = starterContent({ subject: 'Hi', postalAddress: '1 Lake St' });
    expect(s.blocks.map((b) => b.type)).toEqual(['heading', 'text', 'footer']);
  });
});

describe('lifecycle and snapshot rules', () => {
  it('draft → scheduled → sending → sent, pause/resume, cancel; sent and cancelled are terminal', () => {
    expect(reachable(campaignLifecycle)).toEqual(
      new Set(['draft', 'scheduled', 'sending', 'paused', 'sent', 'cancelled']),
    );
    expect(reachable(campaignLifecycle, 'sent')).toEqual(new Set(['sent']));
    expect(reachable(campaignLifecycle, 'cancelled')).toEqual(new Set(['cancelled']));
    expect(() => campaignLifecycle.next('sent', 'cancel')).toThrow();
    expect(campaignLifecycle.next('paused', 'resume')).toBe('sending');
  });

  const ok: ReachFacts = { address: 'a@x.test', consent: 'granted', suppressed: false, unsubscribed: false, erased: false };
  it('only express marketing consent for the channel counts', () => {
    expect(exclusionReason(ok)).toBeNull();
    expect(exclusionReason({ ...ok, consent: null })).toBe('consent_missing');
    expect(exclusionReason({ ...ok, consent: 'unknown_legacy' })).toBe('consent_missing');
    expect(exclusionReason({ ...ok, consent: 'withdrawn' })).toBe('consent_withdrawn');
  });
  it('checks address, erasure, suppression and unsubscribe first, in that order', () => {
    expect(exclusionReason({ ...ok, address: null, suppressed: true })).toBe('no_address');
    expect(exclusionReason({ ...ok, erased: true, suppressed: true })).toBe('erased');
    expect(exclusionReason({ ...ok, suppressed: true, unsubscribed: true })).toBe('suppressed');
    expect(exclusionReason({ ...ok, unsubscribed: true, consent: 'withdrawn' })).toBe('unsubscribed');
  });
});

describe('fair scheduler', () => {
  it('derives the per-org rate from the monthly quota, within bounds', () => {
    expect(ratePerMinute(10_000)).toBe(1_000);
    expect(ratePerMinute(500)).toBe(50);
    expect(ratePerMinute(10)).toBe(30);
    expect(ratePerMinute(10_000_000)).toBe(2_000);
  });

  it('round-robins chunks across orgs within capacity and each org budget', () => {
    const lanes: OrgLane[] = [
      { orgId: 'a', budget: 1_000, campaigns: [{ campaignId: 'a1', pending: 50_000 }] },
      { orgId: 'b', budget: 1_000, campaigns: [{ campaignId: 'b1', pending: 100 }] },
      { orgId: 'c', budget: 20, campaigns: [{ campaignId: 'c1', pending: 500 }] },
    ];
    const out = allocate(lanes, { capacity: 300, chunk: 50 });
    const size = (id: string) => out.find((x) => x.campaignId === id)?.size ?? 0;
    expect(size('b1')).toBe(100);
    expect(size('c1')).toBe(20);
    expect(size('a1')).toBe(180);
    expect(out.reduce((n, x) => n + x.size, 0)).toBe(300);
  });

  it("an org's campaigns take turns too", () => {
    const out = allocate(
      [
        {
          orgId: 'a',
          budget: 100,
          campaigns: [
            { campaignId: 'a1', pending: 1_000 },
            { campaignId: 'a2', pending: 1_000 },
          ],
        },
      ],
      { capacity: 100, chunk: 25 },
    );
    expect(out).toEqual([
      { orgId: 'a', campaignId: 'a1', size: 50 },
      { orgId: 'a', campaignId: 'a2', size: 50 },
    ]);
  });

  it('gives nothing to an org without budget or pending recipients', () => {
    expect(allocate([{ orgId: 'a', budget: 0, campaigns: [{ campaignId: 'a1', pending: 5 }] }], { capacity: 10, chunk: 5 })).toEqual([]);
    expect(allocate([{ orgId: 'a', budget: 9, campaigns: [{ campaignId: 'a1', pending: 0 }] }], { capacity: 10, chunk: 5 })).toEqual([]);
  });

  it('50,000 vs 100 (time-compressed): org B finishes within its fair share while org A keeps going', () => {
    // Two orgs at 1,000/min each, a 2 s tick releasing at most 500 across orgs in chunks of 50.
    const TICK_MS = 2_000;
    const released = { a: [] as { at: number; n: number }[], b: [] as { at: number; n: number }[] };
    const pending = { a: 50_000, b: 0 };
    let bDoneAt: number | null = null;
    let bStartAt = 0;
    for (let tick = 0; tick < 200; tick++) {
      const at = tick * TICK_MS;
      if (tick === 30) {
        // Org B starts its 100-person send while A is mid-way through its 50,000.
        pending.b = 100;
        bStartAt = at;
      }
      const budget = (org: 'a' | 'b') =>
        1_000 - released[org].filter((r) => r.at > at - 60_000).reduce((n, r) => n + r.n, 0);
      const lanes: OrgLane[] = (['a', 'b'] as const).map((org) => ({
        orgId: org,
        budget: budget(org),
        campaigns: [{ campaignId: `${org}1`, pending: pending[org] }],
      }));
      for (const x of allocate(lanes, { capacity: 500, chunk: 50, tick })) {
        const org = x.orgId as 'a' | 'b';
        pending[org] -= x.size;
        released[org].push({ at, n: x.size });
      }
      if (bDoneAt === null && tick >= 30 && pending.b === 0) bDoneAt = at;
    }
    // B's fair share is half the tick (250) and its own 1,000/min: 100 people fit in one tick.
    expect(bDoneAt).not.toBeNull();
    expect((bDoneAt ?? 0) - bStartAt).toBeLessThanOrEqual(TICK_MS);
    // A never exceeded its rate in any minute, and it is still sending (no starvation of B, no burst).
    for (let t = 0; t < 200 * TICK_MS; t += TICK_MS) {
      const inWindow = released.a.filter((r) => r.at > t - 60_000 && r.at <= t).reduce((n, r) => n + r.n, 0);
      expect(inWindow).toBeLessThanOrEqual(1_000);
    }
    expect(pending.a).toBeGreaterThan(0);
  });
});

describe('render', () => {
  const content = CampaignContent.parse({
    subject: 'Hi {{first_name|there}}',
    preheader: 'Spring season',
    blocks: [
      { id: 'b1', type: 'heading', text: 'Spring <b>season</b>' },
      { id: 'b2', type: 'text', text: 'Line one\nline two\n\nPara two' },
      { id: 'b3', type: 'image', src: '/media/x/y.png', alt: 'The stage' },
      { id: 'b4', type: 'button', label: 'Buy', eventId: E },
      { id: 'b5', type: 'eventCard', eventId: E },
      { id: 'b6', type: 'divider' },
      { id: 'b7', type: 'footer', postalAddress: '1 Lake St, Chicago', note: 'See you soon' },
    ],
  });
  const input = {
    content,
    brand: { name: 'Lakeside', brandColor: '#1d4ed8', logoUrl: null, logoAlt: null, poweredByVisible: true },
    events: new Map([[E, { name: 'Jazz Night', startsAt: new Date('2027-05-01T23:00:00Z'), timezone: 'America/Chicago', venue: 'Pavilion' }]]),
    links: new Map([
      ['b4', '{{@origin}}/r/abcdefgh'],
      ['b5', '{{@origin}}/r/bcdefghj'],
    ]),
    imageOrigin: '{{@origin}}',
  };

  it('renders blocks with the brand kit, escaped text, tracked links and the mandatory footer', () => {
    const r = renderCampaign({ ...input, locale: 'en' });
    expect(r.html).toContain('Spring &lt;b&gt;season&lt;/b&gt;');
    expect(r.html).toContain('href="{{@origin}}/r/abcdefgh"');
    expect(r.html).toContain('src="{{@origin}}/media/x/y.png"');
    expect(r.html).toContain('1 Lake St, Chicago');
    expect(r.html).toContain('href="{{@unsubscribe}}"');
    expect(r.html).toContain('Jazz Night');
    expect(r.html).toContain('Saturday, May 1, 2027');
    expect(r.html).toContain('background:#1d4ed8');
    expect(r.html).not.toContain('data-test-banner');
    expect(r.text).toContain('Unsubscribe: {{@unsubscribe}}');
    expect(r.subject).toBe('Hi {{first_name|there}}');
  });

  it('marks test sends and renders Arabic right to left', () => {
    const t = renderCampaign({ ...input, locale: 'en', test: true });
    expect(t.subject).toBe('[Test] Hi {{first_name|there}}');
    expect(t.html).toContain('data-test-banner');
    const ar = renderCampaign({ ...input, locale: 'ar' });
    expect(ar.dir).toBe('rtl');
    expect(ar.html).toContain('dir="rtl"');
  });
});
