import {
  type AiDrafter,
  adjustCreditsCommand,
  type ComposeRequest,
  creditLedgerQuery,
  deleteBrandKitCommand,
  draftAgenda,
  draftCampaign,
  draftPage,
  failingDrafter,
  fakeDrafter,
  listBrandKitsQuery,
  refreshMatchmaking,
  saveBrandKitCommand,
  suggestAudience,
} from '@yayatoh/ai';
import { addGuestCommand } from '@yayatoh/attendees';
import { previewAudienceQuery } from '@yayatoh/audiences';
import { billingUsageMeter } from '@yayatoh/billing';
import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import {
  blockPersonCommand,
  matchmakingStatusQuery,
  optInCommand,
  optOutCommand,
  reportPersonCommand,
  resolveReportCommand,
  suggestedMatchesQuery,
  updateNetworkSettingsCommand,
  updateProfileCommand,
} from '@yayatoh/engagement';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { type Ctx, createCtx, executeCommand, executeQuery, isDomainError, uuidv7 } from '@yayatoh/kernel';
import { consumeEvent, recentEventsTx } from '@yayatoh/platform';
import { addMemberCommand } from '@yayatoh/tenancy';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

/*
 * M6.12b AI v2: drafts for campaigns, pages and agendas with a tone and a brand kit; audience
 * suggestions in the segment DSL; pgvector matchmaking for opted-in networking profiles. Every AI
 * call spends a credit (refunded on failure) and the AI meter counts exactly those credits.
 * Acceptance: matchmaking never includes someone not opted in; AI usage meters exactly; no prompt
 * or embedding crosses orgs.
 */

let a: OrgFixture;
let b: OrgFixture;
let marketer: Ctx;
let marketerId: string;
let finance: Ctx;

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'ok';
  } catch (err) {
    if (!isDomainError(err)) throw err;
    const reason = err.details?.reason;
    return typeof reason === 'string' ? `${err.code}:${reason}` : err.code;
  }
}

const setBalance = (f: OrgFixture, balance: number) =>
  executeCommand(adjustCreditsCommand, { balance, reason: 'ai v2 test' }, systemCtx(f.org.id), ports);

/** A drafter that records every request it sees (the isolation checks read them). */
function recording(): AiDrafter & { seen: string[] } {
  const seen: string[] = [];
  return {
    name: 'fake',
    seen,
    draft: (r) => {
      seen.push(JSON.stringify(r));
      return fakeDrafter.draft(r);
    },
    compose: (r: ComposeRequest) => {
      seen.push(JSON.stringify(r));
      return fakeDrafter.compose(r);
    },
    embed: (t) => {
      seen.push(JSON.stringify(t));
      return fakeDrafter.embed(t);
    },
  };
}

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  const m = uuidv7();
  const f = uuidv7();
  await executeCommand(addMemberCommand, { userId: m, role: 'marketing' }, a.ctx(), ports);
  await executeCommand(addMemberCommand, { userId: f, role: 'finance' }, a.ctx(), ports);
  marketerId = m;
  marketer = userCtx(m, a.org.id);
  finance = userCtx(f, a.org.id);
  await setBalance(a, 500);
  await setBalance(b, 500);
});
afterAll(async () => {
  await closePools();
});

describe('brand kits', () => {
  it('marketing creates, renames and deletes kits; one default; names unique per org', async () => {
    const kit = await executeCommand(
      saveBrandKitCommand,
      { name: 'Gala voice', voice: 'Elegant', tone: 'formal', keywords: 'gala, evening, gala', avoid: 'cheap\nfree', isDefault: true },
      marketer,
      ports,
    );
    expect(kit).toMatchObject({ name: 'Gala voice', tone: 'formal', keywords: ['gala', 'evening'], avoid: ['cheap', 'free'], isDefault: true });
    const kits = await executeQuery(listBrandKitsQuery, {}, marketer, ports);
    expect(kits[0]?.id).toBe(kit.id);
    // The fixture's default lost its flag: one default only.
    expect(kits.filter((k) => k.isDefault)).toHaveLength(1);
    expect(await codeOf(executeCommand(saveBrandKitCommand, { name: 'GALA VOICE' }, marketer, ports))).toBe('conflict');
    const renamed = await executeCommand(saveBrandKitCommand, { kitId: kit.id, name: 'Gala voice 2', tone: 'playful' }, marketer, ports);
    expect(renamed).toMatchObject({ id: kit.id, name: 'Gala voice 2', tone: 'playful', isDefault: false });
    expect(await codeOf(executeCommand(saveBrandKitCommand, { name: 'x', keywords: 'y'.repeat(41) }, marketer, ports))).toBe(
      'validation_failed',
    );
    expect(await codeOf(executeCommand(deleteBrandKitCommand, { kitId: kit.id }, marketer, ports))).toBe('ok');
    expect(await codeOf(executeCommand(deleteBrandKitCommand, { kitId: kit.id }, marketer, ports))).toBe('not_found');
  });

  it('viewers and finance read nothing they may not change; other orgs see nothing', async () => {
    const viewer = userCtx(a.viewerId, a.org.id);
    expect(await codeOf(executeCommand(saveBrandKitCommand, { name: 'Nope' }, viewer, ports))).toBe('forbidden');
    expect(await codeOf(executeCommand(saveBrandKitCommand, { name: 'Nope' }, finance, ports))).toBe('forbidden');
    const mine = await executeQuery(listBrandKitsQuery, {}, a.ctx(), ports);
    const theirs = await executeQuery(listBrandKitsQuery, {}, b.ctx(), ports);
    expect(theirs.map((k) => k.id)).not.toContain(mine[0]?.id);
    expect(await codeOf(executeCommand(deleteBrandKitCommand, { kitId: mine[0]?.id ?? '' }, b.ctx(), ports))).toBe('not_found');
  });
});

describe('drafting v2', () => {
  it('drafts a campaign in the brand voice and tone; nothing is saved or sent', async () => {
    const kit = await executeCommand(
      saveBrandKitCommand,
      { name: `Lake ${uuidv7().slice(-6)}`, keywords: 'lakeside, together', tone: 'friendly' },
      marketer,
      ports,
    );
    const res = await draftCampaign(marketer, ports, fakeDrafter, {
      tone: 'urgent',
      brandKitId: kit.id,
      brief: 'Early-bird ends Friday',
      eventId: a.event.id,
    });
    expect(res.draft.subject).toBe(`Last chance: ${a.event.name}`);
    expect(res.draft.heading).toContain('lakeside');
    expect(res.draft.paragraphs[0]).toContain('Early-bird ends Friday');
    // Org B's kit id is unknown here.
    const bKit = (await executeQuery(listBrandKitsQuery, {}, b.ctx(), ports))[0];
    expect(await codeOf(draftCampaign(marketer, ports, fakeDrafter, { brandKitId: bKit?.id ?? null }))).toBe('not_found');
  });

  it('who may draft what', async () => {
    const viewer = userCtx(a.viewerId, a.org.id);
    expect(await codeOf(draftCampaign(viewer, ports, fakeDrafter, {}))).toBe('forbidden');
    expect(await codeOf(draftCampaign(finance, ports, fakeDrafter, {}))).toBe('forbidden');
    expect(await codeOf(draftPage(marketer, ports, fakeDrafter, { brief: 'About us' }))).toBe('ok');
    expect(await codeOf(draftPage(finance, ports, fakeDrafter, {}))).toBe('forbidden');
    expect(await codeOf(draftAgenda(marketer, ports, fakeDrafter, { eventId: a.event.id }))).toBe('forbidden');
    expect(await codeOf(suggestAudience(viewer, ports, fakeDrafter, { brief: 'Everyone' }))).toBe('forbidden');
    expect(await codeOf(draftCampaign(marketer, ports, null, {}))).toBe('invalid_state:ai_unavailable');
    expect(await codeOf(draftCampaign(marketer, ports, fakeDrafter, { brief: 'x'.repeat(1001) }))).toBe('validation_failed');
  });

  it('drafts a page and agenda sessions inside the event, in its time zone', async () => {
    const page = await draftPage(a.ctx(), ports, fakeDrafter, { brief: 'Visiting the lake', tone: 'inspiring' });
    expect(page.draft.title).toBe('Visiting the lake');
    expect(page.draft.body).toContain(a.org.name);
    const agenda = await draftAgenda(a.ctx(), ports, fakeDrafter, {
      eventId: a.event.id,
      brief: 'Welcome, Keynote, Workshops',
      sessions: 3,
    });
    expect(agenda.sessions.map((s) => s.title)).toEqual(['Welcome', 'Keynote', 'Workshops']);
    expect(agenda.sessions[0]?.startsAt.getTime()).toBe(a.event.startsAt.getTime());
    expect(agenda.sessions[1]!.startsAt.getTime() - agenda.sessions[0]!.startsAt.getTime()).toBe(3_600_000);
    for (const s of agenda.sessions) {
      expect(s.endsAt.getTime() - s.startsAt.getTime()).toBe(45 * 60_000);
      expect(s.endsAt.getTime()).toBeLessThanOrEqual(a.event.endsAt.getTime());
    }
  });

  it('suggests an audience as a valid segment of the org, sized like the builder sizes it', async () => {
    const s = await suggestAudience(marketer, ports, fakeDrafter, { brief: `People who attended ${a.event.name}` });
    expect(s.definition.root.conditions[0]).toMatchObject({
      type: 'participation',
      scope: { kind: 'event', eventId: a.event.id },
      checkedIn: true,
    });
    const preview = await executeQuery(previewAudienceQuery, { definition: s.definition, limit: 1 }, marketer, ports);
    expect(s.count).toBe(preview.count);
    expect(s.explanation).toContain(a.event.name);
  });

  it('a failed call gives its credit back; no credits left refuses before calling', async () => {
    const before = (await executeQuery(creditLedgerQuery, { limit: 1 }, a.ctx(), ports))[0]?.balanceAfter;
    expect(await codeOf(draftPage(a.ctx(), ports, failingDrafter, {}))).toBe('invalid_state:ai_unavailable');
    const [last, prev] = await executeQuery(creditLedgerQuery, { limit: 2 }, a.ctx(), ports);
    expect(last).toMatchObject({ kind: 'refund', amount: 1, draftKind: 'page', balanceAfter: before });
    expect(prev).toMatchObject({ kind: 'debit', amount: -1, draftKind: 'page' });
    await setBalance(a, 0);
    const spy = recording();
    expect(await codeOf(draftCampaign(marketer, ports, spy, {}))).toBe('invalid_state:out_of_credits');
    expect(spy.seen).toHaveLength(0);
    await setBalance(a, 500);
  });
});

/* ------------------------------------------------------------------------------ matchmaking ---- */

interface Ev {
  readonly id: string;
  readonly emails: string[];
}

async function freshEvent(f: OrgFixture, n: number): Promise<Ev> {
  const tag = uuidv7().slice(-8);
  const startsAt = new Date(Date.UTC(2027, 10, 4, 15));
  const ev = await executeCommand(
    createEventCommand,
    {
      name: `Matchmaking ${tag}`,
      slug: `matchmaking-${tag}`,
      timezone: 'Europe/Lisbon',
      startsAt: startsAt.toISOString(),
      endsAt: new Date(startsAt.getTime() + 8 * 3_600_000).toISOString(),
    },
    f.ctx(),
    ports,
  );
  await executeCommand(transitionEventCommand, { eventId: ev.id, transition: 'publish' }, f.ctx(), ports);
  const emails: string[] = [];
  for (let i = 0; i < n; i++) {
    const email = `match-${tag}-${i}@example.test`;
    await executeCommand(addGuestCommand, { eventId: ev.id, name: `Guest ${i}`, email }, f.ctx(), ports);
    emails.push(email);
  }
  await executeCommand(updateNetworkSettingsCommand, { eventId: ev.id, enabled: true, meetingsEnabled: true }, f.ctx(), ports);
  return { id: ev.id, emails };
}

const INTERESTS = ['Data, AI, Analytics', 'AI, Data science', 'Gardening, Pottery', 'Data, AI, Startups', 'Pottery, Ceramics'];
const pub = (f: OrgFixture) => createCtx({ orgId: f.org.id });
const optIn = (f: OrgFixture, ev: Ev, i: number, interests = INTERESTS[i] ?? '') =>
  executeCommand(
    optInCommand,
    { eventId: ev.id, email: ev.emails[i], displayName: `Person ${i}`, headline: null, company: null, interests, consent: true },
    pub(f),
    ports,
  );
const matches = (f: OrgFixture, ev: Ev, i: number) =>
  executeQuery(suggestedMatchesQuery, { eventId: ev.id, email: ev.emails[i], limit: 10 }, pub(f), ports);
const names = async (f: OrgFixture, ev: Ev, i: number) => (await matches(f, ev, i)).matches.map((m) => m.displayName);
const embeddedCount = (f: OrgFixture, ev: Ev) =>
  withTenant(systemCtx(f.org.id), async (tx) => {
    const [r] = await tx.execute<{ n: number }>(
      sql`select count(*)::int as n from engagement.network_embeddings where event_id = ${ev.id}`,
    );
    return r?.n ?? 0;
  });

describe('matchmaking (opted-in profiles only)', () => {
  it('embeds only listed people and suggests the closest ones within the event', async () => {
    const ev = await freshEvent(a, 6);
    for (const i of [0, 1, 2, 3]) await optIn(a, ev, i);
    // Person 4 never opts in; person 5 opts in and out again.
    await optIn(a, ev, 5, 'Data, AI');
    await executeCommand(optOutCommand, { eventId: ev.id, email: ev.emails[5] }, pub(a), ports);
    expect((await matches(a, ev, 0)).ready).toBe(false);
    const spy = recording();
    const res = await refreshMatchmaking(a.ctx(), ports, spy, { eventId: ev.id });
    expect(res).toMatchObject({ embedded: 4, calls: 1, pending: 0 });
    // Only the four listed profiles' public fields were sent: never names or addresses.
    expect(spy.seen.join('\n')).not.toMatch(/Person|example\.test/);
    expect(await embeddedCount(a, ev)).toBe(4);
    expect(await executeQuery(matchmakingStatusQuery, { eventId: ev.id }, a.ctx(), ports)).toEqual({ listed: 4, embedded: 4 });
    const m = await matches(a, ev, 0);
    expect(m.ready).toBe(true);
    expect(m.matches.map((x) => x.displayName).slice(0, 2).sort()).toEqual(['Person 1', 'Person 3']);
    expect(m.matches.at(-1)?.displayName).toBe('Person 2');
    expect(m.matches[0]?.shared.length).toBeGreaterThan(0);
    expect(m.matches[0]!.score).toBeGreaterThan(m.matches.at(-1)!.score);
    const everyone = m.matches.map((x) => x.displayName);
    expect(everyone).not.toContain('Person 4');
    expect(everyone).not.toContain('Person 5');
    // Nothing new: a second refresh costs nothing.
    expect(await refreshMatchmaking(a.ctx(), ports, spy, { eventId: ev.id })).toMatchObject({ embedded: 0, calls: 0 });
    // Not opted in: no suggestions at all.
    expect(await codeOf(matches(a, ev, 4))).toBe('invalid_state:not_opted_in');
  });

  it('drops a profile when it opts out, is hidden or edits itself; blocks are respected', async () => {
    const ev = await freshEvent(a, 5);
    for (const i of [0, 1, 2, 3, 4]) await optIn(a, ev, i);
    await refreshMatchmaking(a.ctx(), ports, fakeDrafter, { eventId: ev.id });
    expect(await embeddedCount(a, ev)).toBe(5);
    await executeCommand(optOutCommand, { eventId: ev.id, email: ev.emails[1] }, pub(a), ports);
    expect(await embeddedCount(a, ev)).toBe(4);
    expect(await names(a, ev, 0)).not.toContain('Person 1');
    // Opting back in lists them again, but only a refresh embeds them anew.
    await optIn(a, ev, 1);
    expect(await names(a, ev, 0)).not.toContain('Person 1');
    await refreshMatchmaking(a.ctx(), ports, fakeDrafter, { eventId: ev.id });
    expect(await names(a, ev, 0)).toContain('Person 1');
    // Editing the profile forgets the old embedding until the next refresh.
    await executeCommand(
      updateProfileCommand,
      { eventId: ev.id, email: ev.emails[3], displayName: 'Person 3', interests: 'Sailing' },
      pub(a),
      ports,
    );
    expect(await names(a, ev, 0)).not.toContain('Person 3');
    expect((await matches(a, ev, 3)).ready).toBe(false);
    // Blocked either way: never suggested.
    const p2 = (await matches(a, ev, 0)).matches.find((x) => x.displayName === 'Person 2');
    await executeCommand(blockPersonCommand, { eventId: ev.id, email: ev.emails[0], personId: p2?.id ?? '' }, pub(a), ports);
    expect(await names(a, ev, 0)).not.toContain('Person 2');
    expect(await names(a, ev, 2)).not.toContain('Person 0');
    // Hidden by the organizer after a report: gone from everyone's suggestions, embedding dropped.
    const p4 = (await matches(a, ev, 1)).matches.find((x) => x.displayName === 'Person 4');
    await executeCommand(
      reportPersonCommand,
      { eventId: ev.id, email: ev.emails[1], personId: p4?.id ?? '', reason: 'spam' },
      pub(a),
      ports,
    );
    const [report] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ id: string }>(sql`select id from engagement.network_reports where reported_id = ${p4?.id ?? ''}`),
    );
    await executeCommand(resolveReportCommand, { eventId: ev.id, reportId: report?.id ?? '', action: 'hide' }, a.ctx(), ports);
    expect(await names(a, ev, 0)).not.toContain('Person 4');
    const left = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ n: number }>(sql`select count(*)::int as n from engagement.network_embeddings where profile_id = ${p4?.id ?? ''}`),
    );
    expect(left[0]?.n).toBe(0);
  });

  it('only the event organizer may refresh; a viewer may read the status', async () => {
    const ev = await freshEvent(a, 2);
    const viewer = userCtx(a.viewerId, a.org.id);
    expect(await codeOf(refreshMatchmaking(viewer, ports, fakeDrafter, { eventId: ev.id }))).toBe('forbidden');
    expect(await codeOf(refreshMatchmaking(marketer, ports, fakeDrafter, { eventId: ev.id }))).toBe('forbidden');
    expect(await executeQuery(matchmakingStatusQuery, { eventId: ev.id }, viewer, ports)).toEqual({ listed: 0, embedded: 0 });
  });
});

describe('isolation: no prompt or embedding crosses orgs', () => {
  it("org A's calls carry only org A's data; B's suggestions never include A's people", async () => {
    const evA = await freshEvent(a, 3);
    const evB = await freshEvent(b, 3);
    for (const i of [0, 1, 2]) {
      await optIn(a, evA, i, `Alpha secret ${i}, Data`);
      await optIn(b, evB, i, `Bravo secret ${i}, Data`);
    }
    const spy = recording();
    await refreshMatchmaking(a.ctx(), ports, spy, { eventId: evA.id });
    await draftCampaign(a.ctx(), ports, spy, { brief: 'Hello', eventId: a.event.id });
    await draftPage(a.ctx(), ports, spy, {});
    await draftAgenda(a.ctx(), ports, spy, { eventId: a.event.id });
    await suggestAudience(a.ctx(), ports, spy, { brief: 'Everyone' });
    const all = spy.seen.join('\n');
    expect(all).toContain('Alpha secret');
    for (const leak of [b.org.name, b.event.name, b.event.id, 'Bravo secret', evB.id]) expect(all).not.toContain(leak);
    // B can't refresh or read A's event; A's embeddings are invisible under B's tenant.
    expect(await codeOf(refreshMatchmaking(b.ctx(), ports, spy, { eventId: evA.id }))).toBe('not_found');
    const seenByB = await withTenant(systemCtx(b.org.id), (tx) =>
      tx.execute<{ n: number }>(sql`select count(*)::int as n from engagement.network_embeddings where event_id = ${evA.id}`),
    );
    expect(seenByB[0]?.n).toBe(0);
    await refreshMatchmaking(b.ctx(), ports, fakeDrafter, { eventId: evB.id });
    const bNames = (await matches(b, evB, 0)).matches;
    expect(bNames).toHaveLength(2);
    const aIds = new Set((await matches(a, evA, 0)).matches.map((m) => m.id));
    for (const m of bNames) expect(aIds.has(m.id)).toBe(false);
    // An A attendee's address means nothing at B's event.
    expect(await codeOf(executeQuery(suggestedMatchesQuery, { eventId: evB.id, email: evA.emails[0] ?? '' }, pub(b), ports))).toBe(
      'forbidden:not_attendee',
    );
  });
});

describe('metering: AI usage meters exactly', () => {
  it('every call debits one credit; the AI meter equals debits minus refunds', async () => {
    const ev = await freshEvent(a, 3);
    for (const i of [0, 1, 2]) await optIn(a, ev, i);
    // Fresh contexts (a context's clock is when it was made): every row below is after `since`.
    const since = new Date();
    const marketer = userCtx(marketerId, a.org.id);
    const calls = [
      () => draftCampaign(marketer, ports, fakeDrafter, { brief: 'one' }),
      () => draftPage(marketer, ports, fakeDrafter, { brief: 'two' }),
      () => draftAgenda(a.ctx(), ports, fakeDrafter, { eventId: a.event.id }),
      () => suggestAudience(marketer, ports, fakeDrafter, { brief: 'everyone' }),
      () => refreshMatchmaking(a.ctx(), ports, fakeDrafter, { eventId: ev.id }),
      () => draftCampaign(marketer, ports, failingDrafter, {}),
      () => draftAgenda(a.ctx(), ports, failingDrafter, { eventId: a.event.id }),
    ];
    for (const call of calls) await call().catch(() => undefined);
    const ledger = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ kind: string; n: number; total: number }>(sql`
        select kind, count(*)::int as n, coalesce(sum(amount), 0)::int as total from ai.credit_ledger
        where created_at >= ${since.toISOString()}::timestamptz and kind in ('debit', 'refund') group by kind`),
    );
    const by = Object.fromEntries(ledger.map((r) => [r.kind, r]));
    expect(by.debit).toMatchObject({ n: 7, total: -7 });
    expect(by.refund).toMatchObject({ n: 2, total: 2 });
    // Drain the AI usage events of this window through the billing meter.
    const meter = billingUsageMeter();
    const events = await withTenant(systemCtx(a.org.id), (tx) =>
      recentEventsTx(tx, a.org.id, ['ai.credits_spent', 'ai.credits_refunded'], 3_600_000),
    );
    for (const e of events) await consumeEvent(meter, e);
    // The meter's rows in this window equal the ledger's debits and refunds, one row per entry.
    const [window] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ q: number; n: number }>(sql`
        select coalesce(sum(quantity), 0)::int as q, count(*)::int as n from billing.usage_records
        where meter = 'ai_credits' and occurred_at >= ${since.toISOString()}::timestamptz`),
    );
    expect(window).toEqual({ q: 5, n: 9 });
    // Replaying the same events records nothing new.
    for (const e of events) expect(await consumeEvent(meter, e)).toBe(false);
  });
});
