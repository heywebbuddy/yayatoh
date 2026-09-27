import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import {
  ACCESS_ATTEMPTS_PER_WINDOW,
  accessGrant,
  accessTarget,
  addSectionCommand,
  announcementsQuery,
  createAccessCodeCommand,
  createAnnouncementCommand,
  createEventCommand,
  deleteSectionCommand,
  type EventDto,
  eventSectionsQuery,
  holderEventContent,
  listAccessCodesQuery,
  pageTarget,
  privateInfoQuery,
  publicEventBySlug,
  publicEventContent,
  redeemAccessCodeCommand,
  reorderSectionsCommand,
  resolveShortLink,
  setAccessCodeActiveCommand,
  setEventDetailsCommand,
  setPrivateInfoCommand,
  setVanityShortLinkCommand,
  shortLinksQuery,
  transitionEventCommand,
  updateAnnouncementCommand,
  updateEventCommand,
  updateSectionCommand,
} from '@yayatoh/events';
import { createCtx, executeCommand, executeQuery } from '@yayatoh/kernel';
import { startCheckoutCommand } from '@yayatoh/orders';
import { createTicketTypeCommand, publicTicketTypes } from '@yayatoh/ticketing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, twoOrgs, userCtx } from '../src/index.ts';

let a: OrgFixture;
let b: OrgFixture;
let ev: EventDto;
const CANARY = `__CANARY_private_info_${Date.now()}__`;
const JOIN = `https://meet.example.com/__CANARY_join_${Date.now()}__`;

const newEvent = async (name: string, extra: Record<string, unknown> = {}, f = a) =>
  executeCommand(
    createEventCommand,
    {
      name: `${name} ${f.org.slug}`,
      timezone: 'UTC',
      startsAt: '2030-03-01T18:00:00Z',
      endsAt: '2030-03-01T22:00:00Z',
      ...extra,
    },
    f.ctx(),
    ports,
  );
const publish = (id: string, f = a) =>
  executeCommand(transitionEventCommand, { eventId: id, transition: 'publish' }, f.ctx(), ports);
const redeem = (
  eventId: string,
  code: string,
  clientKey = 'client-key-0000000001',
  orgId = a.org.id,
  now?: Date,
) =>
  executeCommand(
    redeemAccessCodeCommand,
    { eventId, code, clientKey },
    createCtx({ orgId, ...(now ? { now } : {}) }),
    ports,
  );

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  ev = await newEvent('Content Night');
  await publish(ev.id);
});
afterAll(closePools);

describe('content sections (M1.4d)', () => {
  it('adds, validates, reorders (full order and one step), hides and deletes sections', async () => {
    const add = (kind: string, title: string, content: unknown) =>
      executeCommand(addSectionCommand, { eventId: ev.id, kind, title, content }, a.ctx(), ports);
    const about = await add('text', 'About', { markdown: '**Hello** <script>x</script>' });
    const faq = await add('faq', 'FAQ', { items: [{ question: 'Parking?', answer: 'Lot B.' }] });
    const links = await add('links', 'Links', { items: [{ label: 'Site', url: 'https://example.com' }] });
    expect([about.position, faq.position, links.position]).toEqual([0, 1, 2]);
    await expect(
      add('links', 'Bad', { items: [{ label: 'x', url: 'javascript:alert(1)' }] }),
    ).rejects.toMatchObject({
      code: 'validation_failed',
    });
    await expect(add('schedule', 'Bad', { items: [{ time: '9am', title: 'x' }] })).rejects.toMatchObject({
      code: 'validation_failed',
    });
    // Keyboard path: one step at a time.
    let order = await executeCommand(
      reorderSectionsCommand,
      { eventId: ev.id, sectionId: links.id, move: 'up' },
      a.ctx(),
      ports,
    );
    expect(order.map((s) => s.title)).toEqual(['About', 'Links', 'FAQ']);
    // Moving the first one up is a no-op.
    order = await executeCommand(
      reorderSectionsCommand,
      { eventId: ev.id, sectionId: about.id, move: 'up' },
      a.ctx(),
      ports,
    );
    expect(order.map((s) => s.title)).toEqual(['About', 'Links', 'FAQ']);
    // Drag path: the full order; a stale or partial order is refused.
    order = await executeCommand(
      reorderSectionsCommand,
      { eventId: ev.id, order: [faq.id, about.id, links.id] },
      a.ctx(),
      ports,
    );
    expect(order.map((s) => [s.title, s.position])).toEqual([
      ['FAQ', 0],
      ['About', 1],
      ['Links', 2],
    ]);
    await expect(
      executeCommand(reorderSectionsCommand, { eventId: ev.id, order: [faq.id, about.id] }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'conflict', details: { reason: 'stale_order' } });
    // Content is validated against the section's own kind.
    await expect(
      executeCommand(
        updateSectionCommand,
        { eventId: ev.id, sectionId: faq.id, content: { markdown: 'not a faq' } },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await executeCommand(
      updateSectionCommand,
      { eventId: ev.id, sectionId: links.id, visible: false },
      a.ctx(),
      ports,
    );
    const pub = await publicEventContent({ orgId: a.org.id, eventId: ev.id });
    expect(pub.sections.map((s) => s.title)).toEqual(['FAQ', 'About']);
    expect(pub.sections[1]).toMatchObject({
      kind: 'text',
      content: { markdown: '**Hello** <script>x</script>' },
    });
    const rest = await executeCommand(
      deleteSectionCommand,
      { eventId: ev.id, sectionId: faq.id },
      a.ctx(),
      ports,
    );
    expect(rest.map((s) => [s.title, s.position])).toEqual([
      ['About', 0],
      ['Links', 1],
    ]);
  });

  it('viewers read but cannot change sections; other orgs cannot touch them', async () => {
    const viewer = userCtx(a.viewerId, a.org.id);
    expect(
      (await executeQuery(eventSectionsQuery, { eventId: ev.id }, viewer, ports)).length,
    ).toBeGreaterThan(0);
    await expect(
      executeCommand(
        addSectionCommand,
        { eventId: ev.id, kind: 'text', title: 'x', content: { markdown: 'x' } },
        viewer,
        ports,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      executeCommand(
        addSectionCommand,
        { eventId: ev.id, kind: 'text', title: 'x', content: { markdown: 'x' } },
        b.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
    expect(await executeQuery(eventSectionsQuery, { eventId: ev.id }, b.ctx(), ports)).toEqual([]);
  });
});

describe('announcements (M1.4d)', () => {
  it('publishes and unpublishes; holders-only never reach the public page; emits once per publish', async () => {
    const pub = await executeCommand(
      createAnnouncementCommand,
      { eventId: ev.id, title: 'Doors at six', body: 'Come early.', pinned: true, publish: true },
      a.ctx(),
      ports,
    );
    const holders = await executeCommand(
      createAnnouncementCommand,
      { eventId: ev.id, title: 'Backstage code', body: 'Ask for Sam.', audience: 'holders', publish: true },
      a.ctx(),
      ports,
    );
    const draft = await executeCommand(
      createAnnouncementCommand,
      { eventId: ev.id, title: 'Draft note', body: 'Not yet.' },
      a.ctx(),
      ports,
    );
    const content = await publicEventContent({ orgId: a.org.id, eventId: ev.id });
    expect(content.announcements.map((x) => x.title)).toEqual(['Doors at six']);
    const holder = await holderEventContent({ orgId: a.org.id, eventId: ev.id });
    expect(holder?.announcements.map((x) => x.title).sort()).toEqual(['Backstage code', 'Doors at six']);
    await executeCommand(
      updateAnnouncementCommand,
      { eventId: ev.id, announcementId: pub.id, published: false },
      a.ctx(),
      ports,
    );
    expect((await publicEventContent({ orgId: a.org.id, eventId: ev.id })).announcements).toEqual([]);
    await executeCommand(
      updateAnnouncementCommand,
      { eventId: ev.id, announcementId: draft.id, published: true },
      a.ctx(),
      ports,
    );
    const emitted = await withTenant(a.ctx(), (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from platform.domain_events
          where type = 'event.announcement_published' and aggregate_id = ${ev.id}`,
      ),
    );
    // pub, holders, draft: three publishes (the unpublish emits nothing).
    expect(emitted[0]?.n).toBe(3);
    expect((await executeQuery(announcementsQuery, { eventId: ev.id }, a.ctx(), ports))[0]?.id).toBe(pub.id);
    await expect(
      executeCommand(
        updateAnnouncementCommand,
        { eventId: ev.id, announcementId: holders.id, published: false },
        userCtx(a.viewerId, a.org.id),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      executeCommand(
        updateAnnouncementCommand,
        { eventId: ev.id, announcementId: holders.id, published: false },
        b.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('private info and online events (M1.4d)', () => {
  it('private info never appears in any public output; viewers cannot read it', async () => {
    await executeCommand(
      setEventDetailsCommand,
      { eventId: ev.id, attendanceMode: 'hybrid' },
      a.ctx(),
      ports,
    );
    await executeCommand(
      setPrivateInfoCommand,
      { eventId: ev.id, body: `Wi-Fi: ${CANARY}`, joinUrl: JOIN, joinOpensMinutes: 30 },
      a.ctx(),
      ports,
    );
    const target = await pageTarget(ev.slug);
    expect(target).toEqual({ orgId: a.org.id, eventId: ev.id });
    const outputs = JSON.stringify([
      await publicEventBySlug(ev.slug),
      await publicEventContent({ orgId: a.org.id, eventId: ev.id }),
      await publicTicketTypes(ev.slug),
      await executeQuery(eventSectionsQuery, { eventId: ev.id }, a.ctx(), ports),
      await executeQuery(announcementsQuery, { eventId: ev.id }, a.ctx(), ports),
    ]);
    expect(outputs).not.toContain('__CANARY_');
    expect(await publicEventBySlug(ev.slug)).toMatchObject({ attendanceMode: 'hybrid' });
    await expect(
      executeQuery(privateInfoQuery, { eventId: ev.id }, userCtx(a.viewerId, a.org.id), ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      executeCommand(
        setPrivateInfoCommand,
        { eventId: ev.id, body: 'x' },
        userCtx(a.viewerId, a.org.id),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(executeQuery(privateInfoQuery, { eventId: ev.id }, b.ctx(), ports)).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(
      executeCommand(
        setPrivateInfoCommand,
        { eventId: ev.id, body: 'x', joinUrl: 'http://insecure.example' },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('holders see private info; the join link only inside its window', async () => {
    const t = { orgId: a.org.id, eventId: ev.id };
    const before = await holderEventContent(t, new Date('2030-03-01T17:00:00Z'));
    expect(before).toMatchObject({ privateInfo: `Wi-Fi: ${CANARY}`, joinUrl: null, joinClosed: false });
    expect(before?.joinOpensAt).toEqual(new Date('2030-03-01T17:30:00Z'));
    const during = await holderEventContent(t, new Date('2030-03-01T17:31:00Z'));
    expect(during).toMatchObject({ joinUrl: JOIN, joinOpensAt: null });
    const after = await holderEventContent(t, new Date('2030-03-01T22:00:00Z'));
    expect(after).toMatchObject({ joinUrl: null, joinClosed: true });
    // In person: no join link at all, whatever is stored.
    await executeCommand(
      setEventDetailsCommand,
      { eventId: ev.id, attendanceMode: 'in_person' },
      a.ctx(),
      ports,
    );
    expect(await holderEventContent(t, new Date('2030-03-01T18:00:00Z'))).toMatchObject({ joinUrl: null });
    // Another org's id pairing reads nothing.
    expect(await holderEventContent({ orgId: b.org.id, eventId: ev.id })).toBeNull();
  });
});

describe('access codes (M1.4d)', () => {
  it('unlocks a hidden pass for checkout; wrong, expired and used-up codes fail alike', async () => {
    const e = await newEvent('Hidden Pass');
    const hidden = await executeCommand(
      createTicketTypeCommand,
      { eventId: e.id, name: 'Friends', priceMinor: 0, quantityTotal: 10, visibility: 'hidden' },
      a.ctx(),
      ports,
    );
    await publish(e.id);
    const code = await executeCommand(
      createAccessCodeCommand,
      { eventId: e.id, code: 'friends-2030', ticketTypeIds: [hidden.id], maxUses: 2 },
      a.ctx(),
      ports,
    );
    expect(code.code).toBe('FRIENDS-2030');
    expect((await publicTicketTypes(e.slug)).map((p) => p.id)).not.toContain(hidden.id);
    const buy = (accessCodeId?: string) =>
      executeCommand(
        startCheckoutCommand,
        {
          eventId: e.id,
          items: [{ ticketTypeId: hidden.id, quantity: 1 }],
          buyer: { email: 'friend@example.test', name: 'Friend' },
          ...(accessCodeId ? { accessCodeId } : {}),
        },
        createCtx({ orgId: a.org.id }),
        ports,
      );
    await expect(buy()).rejects.toMatchObject({ code: 'not_found' });
    const r = await redeem(e.id, '  Friends-2030 ');
    expect(r).toMatchObject({ ok: true, grant: { ticketTypeIds: [hidden.id], unlocksEvent: false } });
    if (!r.ok) throw new Error('expected ok');
    const passes = await publicTicketTypes(e.slug, new Date(), { unlocked: r.grant.ticketTypeIds });
    expect(passes.find((p) => p.id === hidden.id)).toMatchObject({ unlocked: true });
    const order = await buy(r.grant.codeId);
    expect(order.order.status).toBe('paid');
    // Uses: 1 of 2; one more unlock, then used up (a new visitor gets the generic failure).
    expect(await redeem(e.id, 'FRIENDS-2030', 'client-key-0000000002')).toMatchObject({ ok: true });
    expect(await redeem(e.id, 'FRIENDS-2030', 'client-key-0000000003')).toEqual({ ok: false });
    // Someone who already unlocked keeps access until expiry or deactivation.
    expect(await accessGrant(a.org.id, e.id, r.grant.codeId)).not.toBeNull();
    await executeCommand(
      setAccessCodeActiveCommand,
      { eventId: e.id, accessCodeId: code.id, active: false },
      a.ctx(),
      ports,
    );
    expect(await accessGrant(a.org.id, e.id, r.grant.codeId)).toBeNull();
    await expect(buy(r.grant.codeId)).rejects.toMatchObject({ code: 'not_found' });
    expect(await redeem(e.id, 'NOPE-NOPE')).toEqual({ ok: false });
    // Expiry.
    const soon = await executeCommand(
      createAccessCodeCommand,
      { eventId: e.id, code: 'SOON', ticketTypeIds: [hidden.id], expiresAt: new Date(Date.now() + 60_000) },
      a.ctx(),
      ports,
    );
    expect(
      await redeem(e.id, 'soon', 'client-key-0000000004', a.org.id, new Date(Date.now() + 120_000)),
    ).toEqual({
      ok: false,
    });
    expect(await accessGrant(a.org.id, e.id, soon.id, new Date(Date.now() + 120_000))).toBeNull();
    await expect(
      executeCommand(
        createAccessCodeCommand,
        { eventId: e.id, code: 'PAST', unlocksEvent: true, expiresAt: new Date(Date.now() - 1000) },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(
      executeCommand(
        createAccessCodeCommand,
        { eventId: e.id, code: 'soon', unlocksEvent: true },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'conflict' });
    await expect(
      executeCommand(createAccessCodeCommand, { eventId: e.id, code: 'NOTHING' }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('opens a private event page only with a code that unlocks it', async () => {
    const e = await newEvent('Private Party', { visibility: 'private' });
    await executeCommand(
      createTicketTypeCommand,
      { eventId: e.id, name: 'Guest', priceMinor: 0, quantityTotal: 10 },
      a.ctx(),
      ports,
    );
    await publish(e.id);
    expect(await publicEventBySlug(e.slug)).toBeNull();
    expect(await pageTarget(e.slug)).toBeNull();
    expect(await publicTicketTypes(e.slug)).toEqual([]);
    expect(await accessTarget(e.slug)).toEqual({ orgId: a.org.id, eventId: e.id, visibility: 'private' });
    const code = await executeCommand(
      createAccessCodeCommand,
      { eventId: e.id, label: 'Invitations', unlocksEvent: true },
      a.ctx(),
      ports,
    );
    expect(code.code).toMatch(/^[A-Z0-9]{8}$/);
    const r = await redeem(e.id, code.code.toLowerCase());
    if (!r.ok) throw new Error('expected ok');
    expect(r.grant.unlocksEvent).toBe(true);
    expect(await publicEventBySlug(e.slug, { includePrivate: true })).toMatchObject({
      visibility: 'private',
    });
    expect(await publicTicketTypes(e.slug, new Date(), { privateOk: true })).toHaveLength(1);
    // Drafts are never opened, even with includePrivate.
    const draft = await newEvent('Private Draft', { visibility: 'private' });
    expect(await publicEventBySlug(draft.slug, { includePrivate: true })).toBeNull();
    expect(await accessTarget(draft.slug)).toBeNull();
  });

  it('rate-limits failed attempts per client and event; codes are isolated per org', async () => {
    const e = await newEvent('Guarded');
    await publish(e.id);
    await executeCommand(
      createAccessCodeCommand,
      { eventId: e.id, code: 'REAL-CODE', unlocksEvent: true },
      a.ctx(),
      ports,
    );
    const key = `attacker-${Date.now()}-0001`;
    for (let i = 0; i < ACCESS_ATTEMPTS_PER_WINDOW; i++)
      expect(await redeem(e.id, `WRONG${i}XX`, key)).toEqual({ ok: false });
    // Even the right code is refused once the limit is hit.
    await expect(redeem(e.id, 'REAL-CODE', key)).rejects.toMatchObject({ code: 'rate_limited' });
    // Another client is unaffected.
    expect(await redeem(e.id, 'REAL-CODE', `someone-else-${Date.now()}`)).toMatchObject({ ok: true });
    // Org B's context cannot redeem org A's event, list its codes or deactivate them.
    await expect(redeem(e.id, 'REAL-CODE', `b-client-${Date.now()}`, b.org.id)).rejects.toMatchObject({
      code: 'not_found',
    });
    expect(await executeQuery(listAccessCodesQuery, { eventId: e.id }, b.ctx(), ports)).toEqual([]);
    const [c] = await executeQuery(listAccessCodesQuery, { eventId: e.id }, a.ctx(), ports);
    await expect(
      executeCommand(
        setAccessCodeActiveCommand,
        { eventId: e.id, accessCodeId: c?.id ?? '', active: false },
        b.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      executeCommand(
        createAccessCodeCommand,
        { eventId: e.id, code: 'VIEWER-CODE', unlocksEvent: true },
        userCtx(a.viewerId, a.org.id),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    // Draft events take no codes.
    const draft = await newEvent('Guarded Draft');
    await expect(redeem(draft.id, 'ANYTHING')).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('short links (M1.4d)', () => {
  it('every new event gets an automatic code; drafts do not resolve', async () => {
    const e = await newEvent('Shorty');
    const [auto] = await executeQuery(shortLinksQuery, { eventId: e.id }, a.ctx(), ports);
    expect(auto).toMatchObject({ kind: 'auto' });
    expect(auto?.code).toMatch(/^[a-z2-9]{7}$/);
    expect(await resolveShortLink(auto?.code ?? '')).toBeNull();
    await publish(e.id);
    expect(await resolveShortLink((auto?.code ?? '').toUpperCase())).toBe(e.slug);
  });

  it('vanity codes are validated, case-insensitive and never collide across orgs', async () => {
    const e = await newEvent('Vanity');
    await publish(e.id);
    const vanity = `Gala-${Date.now()}`;
    const set = (code: string | null, eventId = e.id, f = a) =>
      executeCommand(setVanityShortLinkCommand, { eventId, code }, f.ctx(), ports);
    const links = await set(vanity);
    expect(links.find((l) => l.kind === 'vanity')?.code).toBe(vanity.toLowerCase());
    expect(await resolveShortLink(vanity)).toBe(e.slug);
    // Org B cannot take it, in any case.
    const other = await newEvent('Other Vanity', {}, b);
    await publish(other.id, b);
    await expect(set(vanity.toUpperCase(), other.id, b)).rejects.toMatchObject({
      code: 'conflict',
      details: { reason: 'short_code_taken' },
    });
    for (const [bad, reason] of [
      ['ab', 'too_short'],
      ['bad--code', 'invalid_characters'],
      ['has space', 'invalid_characters'],
      ['admin', 'reserved'],
    ] as const)
      await expect(set(bad)).rejects.toMatchObject({ code: 'validation_failed', details: { reason } });
    // Changing it frees the old code; clearing removes it.
    const next = `${vanity}-b`;
    await set(next);
    expect(await resolveShortLink(vanity)).toBeNull();
    await set(vanity, other.id, b);
    expect(await resolveShortLink(vanity)).toBe(other.slug);
    await set(null);
    expect(await resolveShortLink(next)).toBeNull();
    await expect(
      set('viewer-try', e.id, { ...a, ctx: () => userCtx(a.viewerId, a.org.id) }),
    ).rejects.toMatchObject({
      code: 'forbidden',
    });
  });

  it('archived events stop resolving; slugs changed before publish keep the same short code', async () => {
    const e = await newEvent('Archive Me');
    await executeCommand(
      updateEventCommand,
      { eventId: e.id, slug: `archive-me-renamed-${a.org.slug}` },
      a.ctx(),
      ports,
    );
    await publish(e.id);
    const [auto] = await executeQuery(shortLinksQuery, { eventId: e.id }, a.ctx(), ports);
    expect(await resolveShortLink(auto?.code ?? '')).toBe(`archive-me-renamed-${a.org.slug}`);
    await executeCommand(transitionEventCommand, { eventId: e.id, transition: 'cancel' }, a.ctx(), ports);
    await executeCommand(transitionEventCommand, { eventId: e.id, transition: 'archive' }, a.ctx(), ports);
    expect(await resolveShortLink(auto?.code ?? '')).toBeNull();
  });
});
