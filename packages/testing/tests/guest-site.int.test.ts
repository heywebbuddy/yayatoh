import { type AdminSql, adminClient, closePools } from '@yayatoh/db/testing';
import {
  addGuestSiteBlockCommand,
  guestSitePublishedQuery,
  guestSiteQuery,
  guestSiteTarget,
  moveGuestSiteBlockCommand,
  publicGuestSiteQuery,
  publishGuestSiteCommand,
  removeGuestSiteBlockCommand,
  saveGuestSiteCommand,
  setGuestSitePasswordCommand,
  subEventsQuery,
  unlockGuestSiteQuery,
  updateGuestSiteBlockCommand,
} from '@yayatoh/guests';
import { type Ctx, createCtx, executeCommand, executeQuery, isDomainError, uuidv7 } from '@yayatoh/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  GUEST_SITE_PASSWORD,
  type GuestSiteScenario,
  guestSiteScenario,
  type OrgFixture,
  ports,
  rsvpScenario,
  twoOrgs,
  userCtx,
} from '../src/index.ts';

/**
 * M4.5a: the guest website. Acceptance: the password gate (locked pages show the event's name
 * only; a new password locks earlier visitors out; publishing needs a password) and no guest data
 * on the page (the program shows sub-events everyone is invited to, never a guest, a party or an
 * answer). Plus the host's block editing, validation, isolation, permissions, impersonation and
 * the read-only freeze; and nothing reaches the marketplace (no domain events).
 */

let admin: AdminSql;
let a: OrgFixture;
let b: OrgFixture;

beforeAll(async () => {
  admin = adminClient();
  ({ a, b } = await twoOrgs());
});
afterAll(async () => {
  await admin`select platform.set_ops_flag('read_only_freeze', null::jsonb, 'test', 'test:guest-site')`;
  await admin.end();
  await closePools();
});

/** A visitor: the org comes from the site's address (never a header), nobody signed in. */
const visitor = (orgId: string): Ctx => createCtx({ orgId });

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'ok';
  } catch (err) {
    if (!isDomainError(err)) throw err;
    const reason = (err.details as { reason?: string } | undefined)?.reason;
    return `${err.code}${reason ? `:${reason}` : ''}`;
  }
}

const site = (f: OrgFixture, publish = true) => guestSiteScenario(f.org.id, { ctx: f.ctx(), publish });

async function unlock(s: GuestSiteScenario, orgId: string, password: string) {
  return (await executeQuery(unlockGuestSiteQuery, { eventId: s.eventId, password }, visitor(orgId), ports))
    .access;
}

describe('the host builds the guest website (M4.5a)', () => {
  it('title, blocks of every kind in order, move and remove; the console never sees the password', async () => {
    const s = await site(a, false);
    const ev = { eventId: s.eventId };
    let view = await executeQuery(guestSiteQuery, ev, a.ctx(), ports);
    expect(view).toMatchObject({ exists: true, status: 'draft', title: 'Ana & Luis', hasPassword: true });
    expect(view.code).toMatch(/^[0-9A-Z]{8}$/);
    expect(view.blocks.map((x) => x.kind)).toEqual(['text', 'program', 'travel', 'registry', 'faq']);
    expect(JSON.stringify(view)).not.toMatch(/scrypt|Lake House|passwordHash/i);
    const [first, second] = view.blocks;
    await executeCommand(
      moveGuestSiteBlockCommand,
      { ...ev, blockId: second?.id as string, direction: 'up' },
      a.ctx(),
      ports,
    );
    expect(
      (await executeCommand(moveGuestSiteBlockCommand, { ...ev, blockId: second?.id as string, direction: 'up' }, a.ctx(), ports))
        .moved,
    ).toBe(false);
    await executeCommand(removeGuestSiteBlockCommand, { ...ev, blockId: first?.id as string }, a.ctx(), ports);
    view = await executeQuery(guestSiteQuery, ev, a.ctx(), ports);
    expect(view.blocks.map((x) => x.kind)).toEqual(['program', 'travel', 'registry', 'faq']);
    const rows = await admin<{ position: number }[]>`
      select position from guests.site_blocks where org_id = ${a.org.id} and event_id = ${s.eventId} order by position`;
    expect(rows.map((r) => r.position)).toEqual([0, 1, 2, 3]);
    // Only a scrypt hash is stored; the audit log names fields, never the password or content.
    const [stored] = await admin<{ password_hash: string }[]>`
      select password_hash from guests.sites where org_id = ${a.org.id} and event_id = ${s.eventId}`;
    expect(stored?.password_hash).toMatch(/^scrypt\$16384\$8\$1\$/);
    const audit = await admin<{ data: string }[]>`
      select data::text from platform.audit_events where org_id = ${a.org.id} and action like 'guests.site.%'`;
    expect(audit.length).toBeGreaterThan(5);
    expect(audit.map((r) => r.data).join(' ')).not.toMatch(/Lake House|lake house|gifts\.example|kids|scrypt/i);
  });

  it('refuses bad input: short passwords, http links, unknown sub-events, publishing without a password', async () => {
    const w = await rsvpScenario(a.org.id, { ctx: a.ctx() });
    const ev = { eventId: w.eventId };
    // A site that never got a password can't go live (P4-3c).
    expect(await codeOf(executeCommand(publishGuestSiteCommand, { ...ev, published: true }, a.ctx(), ports))).toBe(
      'invalid_state:password_required',
    );
    expect(
      await codeOf(executeCommand(setGuestSitePasswordCommand, { ...ev, password: ' abc  ' }, a.ctx(), ports)),
    ).toBe('validation_failed:too_short');
    const reg = await executeCommand(addGuestSiteBlockCommand, { ...ev, kind: 'registry' }, a.ctx(), ports);
    expect(
      await codeOf(
        executeCommand(
          updateGuestSiteBlockCommand,
          { ...ev, blockId: reg.id, heading: null, content: { items: [{ label: 'Gifts', url: 'http://x.test' }] } },
          a.ctx(),
          ports,
        ),
      ),
    ).toBe('validation_failed:https_only');
    const program = await executeCommand(addGuestSiteBlockCommand, { ...ev, kind: 'program' }, a.ctx(), ports);
    expect(
      await codeOf(
        executeCommand(
          updateGuestSiteBlockCommand,
          { ...ev, blockId: program.id, heading: null, content: { show: 'chosen', subEventIds: [uuidv7()] } },
          a.ctx(),
          ports,
        ),
      ),
    ).toBe('validation_failed:unknown');
    // A block of another event of the same org is not this event's.
    const other = await rsvpScenario(a.org.id, { ctx: a.ctx() });
    expect(
      await codeOf(
        executeCommand(removeGuestSiteBlockCommand, { eventId: other.eventId, blockId: reg.id }, a.ctx(), ports),
      ),
    ).toBe('not_found');
    expect(
      await codeOf(executeCommand(saveGuestSiteCommand, { ...ev, title: '  ', intro: null }, a.ctx(), ports)),
    ).toBe('validation_failed');
  });

  it('marks the wedding checklist item done once published', async () => {
    const s = await site(a, false);
    const ev = { eventId: s.eventId };
    expect((await executeQuery(guestSitePublishedQuery, ev, a.ctx(), ports)).published).toBe(false);
    await executeCommand(publishGuestSiteCommand, { ...ev, published: true }, a.ctx(), ports);
    expect((await executeQuery(guestSitePublishedQuery, ev, a.ctx(), ports)).published).toBe(true);
  });
});

describe('the password gate (M4.5a acceptance)', () => {
  it('a draft site has no address; published, the locked page shows the event name only', async () => {
    const s = await site(a, false);
    expect(await guestSiteTarget(s.code)).toBeNull();
    await executeCommand(publishGuestSiteCommand, { eventId: s.eventId, published: true }, a.ctx(), ports);
    const target = await guestSiteTarget(s.code.toLowerCase());
    expect(target).toEqual({ orgId: a.org.id, eventId: s.eventId });
    const locked = await executeQuery(publicGuestSiteQuery, { eventId: s.eventId, access: null }, visitor(a.org.id), ports);
    expect(locked).toEqual({ state: 'locked', eventName: s.eventName });
    for (const access of ['', 'forged', `${'A'.repeat(43)}`])
      expect(
        (await executeQuery(publicGuestSiteQuery, { eventId: s.eventId, access }, visitor(a.org.id), ports)).state,
      ).toBe('locked');
  });

  it('the right password opens it (any case); a wrong one never does', async () => {
    const s = await site(a);
    expect(await unlock(s, a.org.id, 'lake houses')).toBeNull();
    expect(await unlock(s, a.org.id, '')).toBeNull();
    const access = await unlock(s, a.org.id, '  LAKE HOUSE ');
    expect(access).toEqual(expect.any(String));
    const open = await executeQuery(publicGuestSiteQuery, { eventId: s.eventId, access }, visitor(a.org.id), ports);
    if (open.state !== 'open') throw new Error('expected open');
    expect(open.title).toBe('Ana & Luis');
    expect(open.timezone).toBe('America/Chicago');
    expect(open.blocks.map((x) => x.kind)).toEqual(['text', 'program', 'travel', 'registry', 'faq']);
  });

  it('a new password locks out everyone who used the old one', async () => {
    const s = await site(a);
    const old = await unlock(s, a.org.id, GUEST_SITE_PASSWORD);
    await executeCommand(setGuestSitePasswordCommand, { eventId: s.eventId, password: 'Second Pass' }, a.ctx(), ports);
    expect(
      (await executeQuery(publicGuestSiteQuery, { eventId: s.eventId, access: old }, visitor(a.org.id), ports)).state,
    ).toBe('locked');
    expect(await unlock(s, a.org.id, GUEST_SITE_PASSWORD)).toBeNull();
    expect(await unlock(s, a.org.id, 'second pass')).toEqual(expect.any(String));
  });

  it('taken down, the address answers "not found" even with a valid cookie', async () => {
    const s = await site(a);
    const access = await unlock(s, a.org.id, GUEST_SITE_PASSWORD);
    await executeCommand(publishGuestSiteCommand, { eventId: s.eventId, published: false }, a.ctx(), ports);
    expect(await guestSiteTarget(s.code)).toBeNull();
    expect(
      await codeOf(executeQuery(publicGuestSiteQuery, { eventId: s.eventId, access }, visitor(a.org.id), ports)),
    ).toBe('not_found:site_unpublished');
    expect(await codeOf(unlock(s, a.org.id, GUEST_SITE_PASSWORD))).toBe('not_found:site_unpublished');
  });
});

describe('no guest data on the guest website (M4.5a acceptance, P4-3)', () => {
  it('the program lists sub-events everyone is invited to; no guest, party, answer or contact ever', async () => {
    const s = await site(a);
    const access = await unlock(s, a.org.id, GUEST_SITE_PASSWORD);
    const open = await executeQuery(publicGuestSiteQuery, { eventId: s.eventId, access }, visitor(a.org.id), ports);
    if (open.state !== 'open') throw new Error('expected open');
    const program = open.blocks.find((x) => x.kind === 'program');
    expect(program?.kind === 'program' ? program.items.map((i) => [i.name, i.place]) : []).toEqual([
      ['Ceremony', 'The garden'],
    ]);
    const text = JSON.stringify(open);
    // The reception is for Luis only: it never appears on a page anyone with the password reads.
    expect(text).not.toContain('Reception');
    // The host's own words may name the couple ("Ana & Luis"); guest records never appear.
    for (const name of ['Luis López', 'López', 'Ana García', 'Mei Chen', 'Garcia family', 'Chen family', s.garcia.pin, s.lookupCode])
      expect(text).not.toContain(name);
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
    // The host may still pick the reception explicitly.
    const host = await executeQuery(guestSiteQuery, { eventId: s.eventId }, a.ctx(), ports);
    const block = host.blocks.find((x) => x.kind === 'program');
    const subs = await executeQuery(subEventsQuery, { eventId: s.eventId }, a.ctx(), ports);
    await executeCommand(
      updateGuestSiteBlockCommand,
      {
        eventId: s.eventId,
        blockId: block?.id as string,
        heading: 'The day',
        content: { show: 'chosen', subEventIds: subs.map((x) => x.id).reverse() },
      },
      a.ctx(),
      ports,
    );
    const again = await executeQuery(publicGuestSiteQuery, { eventId: s.eventId, access }, visitor(a.org.id), ports);
    const p2 = again.state === 'open' ? again.blocks.find((x) => x.kind === 'program') : undefined;
    expect(p2?.kind === 'program' ? p2.items.map((i) => i.name) : []).toEqual(['Ceremony', 'Reception']);
  });

  it('nothing reaches the marketplace: site commands emit no domain events', async () => {
    const w = await rsvpScenario(a.org.id, { ctx: a.ctx() });
    const count = async () =>
      (
        await admin<{ n: number }[]>`
          select count(*)::int as n from platform.domain_events where org_id = ${a.org.id}
            and (aggregate_id = ${w.eventId} or payload::text like ${`%${w.eventId}%`})`
      )[0]?.n ?? 0;
    const before = await count();
    const ev = { eventId: w.eventId };
    await executeCommand(saveGuestSiteCommand, { ...ev, title: 'Quiet', intro: null }, a.ctx(), ports);
    const blk = await executeCommand(addGuestSiteBlockCommand, { ...ev, kind: 'text' }, a.ctx(), ports);
    await executeCommand(
      updateGuestSiteBlockCommand,
      { ...ev, blockId: blk.id, heading: null, content: { body: 'Hi' } },
      a.ctx(),
      ports,
    );
    await executeCommand(setGuestSitePasswordCommand, { ...ev, password: 'quiet pass' }, a.ctx(), ports);
    await executeCommand(publishGuestSiteCommand, { ...ev, published: true }, a.ctx(), ports);
    expect(await count()).toBe(before);
  });
});

describe('guest website: isolation, permissions, impersonation, freeze', () => {
  it('another org’s site, block or event is unknown here', async () => {
    const sb = await site(b);
    expect((await guestSiteTarget(sb.code))?.orgId).toBe(b.org.id);
    const hostB = await executeQuery(guestSiteQuery, { eventId: sb.eventId }, b.ctx(), ports);
    const blockB = hostB.blocks[0]?.id as string;
    const accessB = await unlock(sb, b.org.id, GUEST_SITE_PASSWORD);
    // B's event under A's org (a header can't pick the org; even if it could, RLS hides B's rows).
    for (const run of [
      () => executeQuery(publicGuestSiteQuery, { eventId: sb.eventId, access: accessB }, visitor(a.org.id), ports),
      () => executeQuery(unlockGuestSiteQuery, { eventId: sb.eventId, password: GUEST_SITE_PASSWORD }, visitor(a.org.id), ports),
      () => executeQuery(guestSiteQuery, { eventId: sb.eventId }, a.ctx(), ports),
      () => executeCommand(publishGuestSiteCommand, { eventId: sb.eventId, published: false }, a.ctx(), ports),
      () =>
        executeCommand(removeGuestSiteBlockCommand, { eventId: sb.eventId, blockId: blockB }, a.ctx(), ports),
      () =>
        executeCommand(
          moveGuestSiteBlockCommand,
          { eventId: sb.eventId, blockId: blockB, direction: 'down' },
          a.ctx(),
          ports,
        ),
    ])
      expect((await codeOf(run())).startsWith('not_found')).toBe(true);
    // A's own event with B's block id: still not found.
    const sa = await site(a, false);
    expect(
      await codeOf(executeCommand(removeGuestSiteBlockCommand, { eventId: sa.eventId, blockId: blockB }, a.ctx(), ports)),
    ).toBe('not_found');
    const [n] = await admin<{ n: number }[]>`
      select count(*)::int as n from guests.site_blocks where org_id = ${b.org.id} and event_id = ${sb.eventId}`;
    expect(n?.n).toBe(5);
    // An access proof from B's site never opens A's.
    const sa2 = await site(a);
    expect(
      (await executeQuery(publicGuestSiteQuery, { eventId: sa2.eventId, access: accessB }, visitor(a.org.id), ports))
        .state,
    ).toBe('locked');
  });

  it('viewers read the editor but change nothing; visitors never reach the host tools', async () => {
    const s = await site(a, false);
    const viewer = userCtx(a.viewerId, a.org.id);
    const view = await executeQuery(guestSiteQuery, { eventId: s.eventId }, viewer, ports);
    expect(view.blocks).toHaveLength(5);
    const ev = { eventId: s.eventId };
    const blockId = view.blocks[0]?.id as string;
    for (const run of [
      () => executeCommand(saveGuestSiteCommand, { ...ev, title: 'X', intro: null }, viewer, ports),
      () => executeCommand(setGuestSitePasswordCommand, { ...ev, password: 'viewer pass' }, viewer, ports),
      () => executeCommand(publishGuestSiteCommand, { ...ev, published: true }, viewer, ports),
      () => executeCommand(addGuestSiteBlockCommand, { ...ev, kind: 'faq' }, viewer, ports),
      () =>
        executeCommand(updateGuestSiteBlockCommand, { ...ev, blockId, heading: 'X', content: { body: 'x' } }, viewer, ports),
      () => executeCommand(moveGuestSiteBlockCommand, { ...ev, blockId, direction: 'down' }, viewer, ports),
      () => executeCommand(removeGuestSiteBlockCommand, { ...ev, blockId }, viewer, ports),
      () => executeQuery(guestSiteQuery, ev, visitor(a.org.id), ports),
      () => executeCommand(publishGuestSiteCommand, { ...ev, published: true }, visitor(a.org.id), ports),
    ])
      expect(await codeOf(run())).toBe('forbidden');
  });

  it('staff acting as a member can edit the site but not remove blocks (a deletion)', async () => {
    const s = await site(a, false);
    const acting = a.ctx({ impersonatedBy: { staffUserId: uuidv7(), impersonationId: uuidv7() } });
    const ev = { eventId: s.eventId };
    await executeCommand(saveGuestSiteCommand, { ...ev, title: 'Staff edit', intro: null }, acting, ports);
    const view = await executeQuery(guestSiteQuery, ev, acting, ports);
    expect(view.title).toBe('Staff edit');
    expect(
      await codeOf(executeCommand(removeGuestSiteBlockCommand, { ...ev, blockId: view.blocks[0]?.id as string }, acting, ports)),
    ).toBe('impersonation_blocked:delete');
  });

  it('a read-only freeze refuses every site write; guests still unlock and read the site', async () => {
    const s = await site(a);
    const ev = { eventId: s.eventId };
    const blockId = (await executeQuery(guestSiteQuery, ev, a.ctx(), ports)).blocks[0]?.id as string;
    await admin`select platform.set_ops_flag('read_only_freeze', ${JSON.stringify({ scope: 'orgs', orgIds: [a.org.id] })}::text::jsonb, 'test', 'test:guest-site')`;
    try {
      for (const run of [
        () => executeCommand(saveGuestSiteCommand, { ...ev, title: 'X', intro: null }, a.ctx(), ports),
        () => executeCommand(setGuestSitePasswordCommand, { ...ev, password: 'frozen pass' }, a.ctx(), ports),
        () => executeCommand(publishGuestSiteCommand, { ...ev, published: false }, a.ctx(), ports),
        () => executeCommand(addGuestSiteBlockCommand, { ...ev, kind: 'faq' }, a.ctx(), ports),
        () => executeCommand(moveGuestSiteBlockCommand, { ...ev, blockId, direction: 'down' }, a.ctx(), ports),
        () => executeCommand(removeGuestSiteBlockCommand, { ...ev, blockId }, a.ctx(), ports),
      ])
        expect((await codeOf(run())).startsWith('read_only_freeze')).toBe(true);
      const access = await unlock(s, a.org.id, GUEST_SITE_PASSWORD);
      expect(
        (await executeQuery(publicGuestSiteQuery, { eventId: s.eventId, access }, visitor(a.org.id), ports)).state,
      ).toBe('open');
    } finally {
      await admin`select platform.set_ops_flag('read_only_freeze', null::jsonb, 'test', 'test:guest-site')`;
    }
  });
});
